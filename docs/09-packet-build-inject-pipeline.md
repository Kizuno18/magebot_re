# magebotv55.exe (v10x) — client→server packet build + inject pipeline

The full act path: how a Lua/engine action becomes bytes on the client's real
socket. MageBot never touches the wire directly on the read side (it RPM-polls
the client, see [engine-core.md](functions/engine-core.md) §2–3), but on the
**act** side it *does* build genuine Tibia client→server frames and pushes them
into the client through a named pipe that an injected shim (`packet.dll`)
re-emits via `ws2_32!send`. There is a second, older act path — driving the
client window with `SendMessage`/mouse (`driveClient*` / `clientPress*`) — kept
as a fallback for interactions the pipe path can't cleanly express.

All addresses are `samples/v10x/magebotv55.exe`, imagebase `0x400000`. Frame
layouts and opcodes are grounded in [catalog-bot.md](functions/catalog-bot.md)
(the 222-function catalog) and [engine-core.md](functions/engine-core.md) §1/§5;
each `build*Frame*` below cites its catalog VA.

---

## 0. Data / control flow

```
  Lua action / engine tick (healerAndReloader, autoAttackNearestTick, cavebot…)
        │  args → luaL_checknumber → _ftol (0x44b860)
        ▼
  ┌───────────────────── per-shape FRAME BUILDER ─────────────────────┐
  │  build*Frame*  (0x404ad5 … 0x406f88)  — lay out fixed Tibia bytes  │
  │    static shape:  09 00 <op> …   /   read-client-then-splice       │
  │  MB_SendAction 0x405f1d  — the 2-arg builder (ATTACK 0xA1 /        │
  │    FOLLOW 0xA2), splices a live client field into the frame        │
  └───────────────┬───────────────────────────────┬──────────────────┘
                  │ sub_401415                     │ sub_40152D
                  ▼ (thunk)                        ▼ (thunk, +dst args)
        MB_InjectFrame 0x40320a  ◄─────────────────┘
        gate: [0x469098]==1 → DROP (safemode/paused)
        throttle: GetTickCount − [0x4db394c] ≥ 0x4b0 (1200) else DROP
        prepend <len:2 LE>, fopen("\\.\pipe\SamplePipe%i","wb+"), fwrite, fclose
                  │
                  ▼   named pipe  \\.\pipe\SamplePipe%i
        packet.dll shim (in client)  ──►  cached ws2_32!send  ──►  server

  ── alternative act path (NOT the pipe) ────────────────────────────
  driveClient* / clientPress*  →  SendMessageA(WM_KEY*/WM_*BUTTON*) to
        client HWND [0x4d22494]  →  client's own input handler → its send
  ── separate encrypted-socket path (mass-login worker, own socket) ──
  buildRsaLoginPacket 0x43124a → RSA(0x453d0b) → send() directly
  sendPipeXteaFrame 0x403574   → XTEA-encrypt → send() directly (own socket)
```

Two facts to keep straight:

- **The mainline in-game act path is plaintext.** `MB_InjectFrame` (`0x40320a`)
  fwrites the *unencrypted* frame into the pipe; the client's own send path (via
  the `packet.dll` shim) does the XTEA + RSA the protocol requires. The builders
  below therefore emit raw opcode+payload, no crypto.
- **`sendPipeXteaFrame` (`0x403574`) and `buildRsaLoginPacket` (`0x43124a`) are
  NOT on the mainline in-game path.** They encrypt and `send()` on their own
  socket (`[ebp+0x14]` / `[ebp+8]`), bypassing the pipe entirely. They belong to
  the login/teamserver worker flow, documented in §5.

---

## 1. Opcode table — every packet builder

Opcode = the Tibia client→server type byte the builder plants after the 2-byte
length header. "Frame" column is the on-pipe payload (before `MB_InjectFrame`
prepends its own outer `<len:2 LE>`). `id:2 LE` = little-endian 16-bit,
`FF FF` = Tibia from/to-container magic marker. Builder VAs are catalog-confirmed.

| Opcode | Action | Builder VA (catalog name) | Frame (payload) | Notes |
|---|---|---|---|---|
| `0x65`–`0x6C` | Walk N/E/S/W + 4 diagonals | `MB_SendWalk 0x404a9b` (thunk `0x4011f4`) | `01 00 <dir>` | 3-byte frame; `0x65`=N `0x66`=E `0x67`=S `0x68`=W, `0x69`–`0x6C` diagonals. Driven by the walk threads / `handleArrowKeyWalk 0x407491` |
| `0x05` | Look / describe by id | `buildLookFrame05 0x40601c` | `05 00 <sub> <val:4 LE>` | via `sub_40152D` (pipe-target inject) |
| `0x14` | Ping / keep-alive | `buildPingFrame14 0x40608c` | `01 00 14` | no args; single-byte payload, `sub_401415` |
| `0x64` | Talk (map/text describe w/ string) | `buildTalkFrame64 0x404e26` | `<len:2> 64 <sub=len-2> <string>` | dynamic, len∈[4..0x80], 8-byte rounded, `sub_401415` |
| `0x78` | Move / throw item | `buildMoveItemFrame 0x40656b` (+`0x4069b8`/`0x406a70` variants) | `0F 00 78 FF FF <src> 00 <cnt> <x:2><cnt2> FF FF <dst> 00 …` | 0x18-byte frame; variants add sub-byte `0x02` (→container) / `0x01` (→equip slot) |
| `0x7A` | NpcBuy | `buildNpcBuyFrame7A 0x404fde` | `07 00 7A <id:2 LE> 00 <count> 00 00` | static 8-byte |
| `0x7B` | NpcSell | `buildNpcSellFrame7B 0x405039` | `07 00 7B <id:2 LE> 00 <count> 00 00` | byte-identical to 7A bar opcode |
| `0x82` | Use item / map action | `buildUseHotkeyItemFrame 0x406f88` (+`driveClient*` fallthroughs) | `0x10`-byte frame, op `0x82`, packed 16-bit coord + slot | shared by left-click-tile/creature fallthroughs |
| `0x83` | Use-on (tile/creature/container/pos) | `buildUseOnTileOrCreatureFrame83 0x4056e5`, `…OnPosition 0x405bd2`, `…OnMappedTile 0x405c95`, `…OnContainer 0x405e74` | `11 00 83 FF FF … <id:2 LE> <coords> <stack> …` | 0x11-length family; container variant biases dst id by `+0x40` |
| `0x84` | Use-item-on-creature (rune/hand) | `buildUseItemOnCreatureFrame84 0x4055ca`, `…Frame84Static 0x405642` | `0D 00 84 FF FF 40 00 <stk> <tgtId:2> <stk> <itemId:4>` | static twin writes global scratch `0x4b032e8` + `sub_40152D` |
| `0x87` | Use inventory item | (fallthrough of `driveClientUseInventorySlot 0x406e98`) | 8-byte, op `0x87`, slot low byte | pipe fallthrough of the window-drive routine |
| `0x88` | Inventory slot action | `buildUseInventorySlotFrame 0x406f48` | `02 00 88 <slot> 00 00 00 00` | pure-frame sibling of `0x87` |
| `0x96` | Talk (channel / private) | `buildChannelTalkFrame96Sub1 0x404d2e` (sub `0x01`), `…Sub12 0x404eee` (sub `0x0C`), `buildPrivateMessageFrame96Sub6 0x405203` (sub `0x06`) | `<len:2> 96 <sub> <strlen:2> <string…>` | private-msg variant splits recipient/body on `'*'` |
| `0x98` | Single-word request (open channel etc.) | `buildOpcode98Frame 0x40519d` | `03 00 98 <val:2 LE>` | returns 0 (not 1) |
| `0xA1` | **Attack** target | `MB_SendAction 0x405f1d` (thunk `0x401217`) | `09 00 A1 <arg1:4 LE> <clientVal:4 LE>` | 2-arg builder; special fast-path (§2) |
| `0xA2` | **Follow** target | `MB_SendAction 0x405f1d` | `09 00 A2 <arg1:4 LE> <clientVal:4 LE>` | same builder, opcode swapped |
| `0xD3` | Use-item-on-creature (screen) | `buildUseOnCreatureFrame 0x4060b5` | `08 00 D3 <p5c> 00 <tgtId x3> <p70>` | resolves target from creature cache, `[0x468f38]` stride `0xE0` |
| control | Stop / control frame | `buildStopOrControlPacket 0x404ad5` | `01 00 <sub> 00 …` (8 bytes) | 1-byte-op control frame via `sub_40152D` |
| (dyn) | CastRuneTarget | `buildCastRuneTargetFrame 0x4053a4` | fallback `0x84`-subtype frame; primary path pokes client state | opcode not an immediate — built at runtime |
| (dyn) | UseGround/OnGround/Inventory/Container | `0x434b54`–`0x434d55` wrappers → the `0x83`/`0x82` builders above | — | dispatch via which builder they feed |
| login | RSA login (worker) | `buildRsaLoginPacket 0x43124a` | `0A 02 00 20 03 00 <16B key> <RSA(acct)>` | **own socket**, not the pipe (§5) |

`NpcSay` / `CastHotkey` are **not** binary builders: they write a chat line to
`[0x4695a0]`/`[0x472c9c]` and let the client's own chat path emit it (engine-core
§1). The map-click hybrid `sendMapClickWalkOrUse 0x404b0d` builds a `0x96 01`-tagged
interaction frame when it can't resolve a live creature slot.

### 1a. The two inject thunks

Every builder ends in one of two thunks, both landing at `MB_InjectFrame`:

- **`sub_401415`** — plain `inject(buf, len)`. 23 builders use it. Default path.
- **`sub_40152D`** — `inject(buf, len, dstA, dstB)` — the *addressed* variant,
  forwarding two extra destination args (a specific pipe target). 6 builders use
  it: `buildLookFrame05`, the `84Static`, the `83`-position/mapped-tile builders,
  `buildStopOrControlPacket`, `buildChannelTalkFrame96Sub1`. Both funnel into the
  same `0x40320a` fwrite; the extra args select which pipe instance (`%i`).

---

## 2. MB_SendAction — the 2-arg builder / ATTACK 0xA1 gate — `0x405f1d`

`MB_SendAction(arg1 /*[ebp+8]*/, opcode /*[ebp+0xc]*/)` (thunk `0x401217`). The
one builder shared by `AttackTarget`(`0xA1`, wrapper `0x4357da`) and
`FollowTarget`(`0xA2`, wrapper `0x435818`). Confirmed body (engine-core §1a):

```
0x405f23  cmp  dword [0x469098], 1        ; master enable flag
0x405f2c  cmp  dword [ebp+0xc], 0xA1       ; opcode == ATTACK ?
          ...  if enabled && ATTACK -> fast path 0x405f48
0x405f48  call 0x4014d8                    ; ATTACK pre-step (target validate?)
          ...  on zero result: call 0x4014a1  ; stop-attack / clear (unconfirmed)
0x405f6e  push 4
0x405f70  push [0x468ee8]                  ; a client field addr
0x405f77  call 0x4011b8                    ; ReadClientState(addr, 4) — live read
0x405f82  mov  byte [ebp-0x10], 9          ; frame length = 9
0x405f8a  ...  [ebp-0xe]   = opcode & 0xff
0x405f95  ...  [ebp-0xd..] = arg1 (4 LE bytes)
0x405fcd  ...  [ebp-9..]   = the just-read client value (4 LE bytes)
0x406005  push 0x10 ; lea eax,[ebp-0x10] ; push eax
0x40600b  call 0x401415                    ; MB_InjectFrame
```

- **Reads:** master flag `[0x469098]`; client field at `[0x468ee8]` (4 bytes,
  live, spliced into the frame as the trailing 4 bytes — a sequence/target field).
- **Writes:** a 9-byte frame `09 00 <op> <arg1:4 LE> <clientVal:4 LE>`.
- **Emits opcode:** `0xA1` (ATTACK) or `0xA2` (FOLLOW), from `[ebp+0xc]`.
- **Calls:** `0x4014d8`/`0x4014a1` (ATTACK fast path, unconfirmed detail),
  `0x4011b8` (ReadClientState), `0x401415` (inject).
- After returning, each wrapper `Sleep([0x4696e0])` — the post-action cooldown.

The `0x469098==1` check here is the *arm* gate for building; note the **same
global is re-checked with opposite sense inside `MB_InjectFrame`** (`==1` → drop,
§3) — so `0x469098` reads as a safemode/paused flag: when set it suppresses the
actual pipe write. (Consistent with engine-core §4/§5.)

---

## 3. MB_InjectFrame — the pipe injector — `0x40320a`

`inject(char *frame, int len)` (thunk `0x401415`; addressed thunk `0x40152D`).
The client→server send primitive. **Not** `WriteProcessMemory** — it is a CRT
`fopen`/`fwrite`/`fclose` to a named pipe (engine-core §5):

```
0x403210  cmp [0x4db3948], 1              ; first-send seed of last-tick
0x403232  sub eax,[0x4db394c]; cmp eax,0x4b0 ; throttle: ≥ 1200 GetTickCount units
0x40323d      < 1200 -> return 1 (DROP)
0x403249  cmp [0x469098], 1               ; safemode/paused -> DROP
0x40325c  push "Sending pipe:"            ; debug
0x403285  push "wb+"
0x40328a  push [0x4caa7c8]                 ; pipe path buffer  \\.\pipe\SamplePipe%i
0x40328f  call 0x44a9a0                    ; fopen
          ... on NULL: [0x4db3944]=0 ; return
0x4032b4  build 2-byte LE length header (len & 0x800000ff, signed fixup)
0x4032e2  call 0x44a876 (fwrite) x2        ; header, then payload
          ... fclose 0x44a820
```

- **Reads/writes globals:** `[0x4db3948]` init flag, `[0x4db394c]` last-send tick,
  `[0x469098]` safemode gate, `[0x4db3944]` "pipe open failed" flag,
  `[0x4caa7c8]` pipe-path buffer.
- **On-pipe bytes:** `<len:2 LE>` + the builder's payload.
- **Throttle:** one send per ~1200 `GetTickCount` units; excess frames dropped
  (return 1). This is the bot's global send rate limiter.
- The `packet.dll` shim inside the client reads `\\.\pipe\SamplePipe%i` and
  re-emits the frame onto the real socket via the cached `ws2_32!send`
  (companion binary; `fnPacket` export, [04-packet-dll.md](04-packet-dll.md)).

The `%i` in the pipe name is instanced per client — the addressed inject thunk
`sub_40152D` forwards the destination selector so multi-client setups target the
right pipe.

---

## 4. The alternative act path — window drive (SendMessage / mouse)

Not every interaction goes through the pipe. A family of `driveClient*` routines
posts real Win32 input to the client window (HWND `[0x4d22494]`) instead, and
falls through to a pipe frame only if the window drive is unavailable/off-screen.
All are enable-gated `[0x469098]==1`:

| VA | Name | Input posted | Pipe fallthrough |
|---|---|---|---|
| `0x4061d1` | `driveClientArrowWalkOrDrag` | `SendMessageA(0x290)` + drag helpers | `0x78` move frame |
| `0x406600` | `driveClientDragItemBetweenTiles` | `GetWindowRect`+drag, `SendMessageA(0x290)` | `0x78` move frame |
| `0x406b4e` | `driveClientLeftClickTile` | `WM_KEYDOWN 0x11(CTRL)` + left-click + `WM_KEYUP` | `0x82` map-click frame |
| `0x406e98` | `driveClientUseInventorySlot` | click at computed slot pixel | `0x87` use-inventory frame |
| `0x406ff9` | `driveClientLeftClickCreature` | CTRL + left-click at projected pixel | `0x82` frame |

These do the world→screen tile projection themselves (30-wide `0x1e` / 22-tall
`0x16` viewport math) to hit the right pixel. Low-level key/mouse primitives they
build on:

- `clientPressKeyOnce 0x407254` — `WM_KEYDOWN`/`WM_KEYUP(vk)`, `Sleep(0xa)`.
- `clientPressTwoKeyChord 0x407425` — modifier+key chord, `Sleep(0x5a)`.
- `clientMouseMoveDrag 0x40775e` — `WM_MBUTTONDOWN`/`UP` at packed lParam.
- `clientRightClickAt 0x4077c9` — `WM_RBUTTONDOWN`/`UP` (context-menu use).

So the same logical action (e.g. use-item-on-tile) has two implementations: a
pipe frame (`0x83`/`0x82`) and a window-drive (`driveClientLeftClickTile`). Which
one runs is a config/mode choice; the window-drive path is the more "human"
fallback and is the only path that can express things the frame builders don't
model cleanly (free mouse drags, CTRL-click targeting).

`recordAndReplayActionPacket 0x4037ed` sits alongside this as a *capture* path:
it takes packets the client already produced (deobfuscating them — `sub_4012BC`
then XTEA-decrypt, delta `0x61c88647`, sum seed `0xc6ef3720`, 32 rounds, key from
`[0x468f08]`), and when record mode `[0x4db398c]==1` and the first byte ≠ `0x1e`
it stashes them into the recording table (`[0x4db3964]<<8 + 0x4b17b9c`). A
two-point map-bound state machine (packet signature `byte0==0x83, byte6==0x21,
byte7==1`) then derives replayable walk paths from captured movement. This is how
"record my actions and replay" cavebot legs are built from real client traffic
rather than synthesized frames.

---

## 5. Off-pipe encrypted paths (login / teamserver workers)

Two functions encrypt and `send()` on their **own socket**, not the pipe — they
are not part of the in-game act loop and must not be confused with it:

- **`sendPipeXteaFrame 0x403574`** — despite the name, XTEA-encrypts the payload
  (`[ebp+8]`, len `[ebp+0xc]`, key schedule `[ebp+0x10]`, standard 32-round loop,
  delta step `0x61c88647`), prepends a 2-byte LE length, and `send()`s on socket
  `[ebp+0x14]`. Busy-guarded on `[0x4b27b9c]` (`0x63`=busy → `Sleep(1)`, abort).
  Debug `"Sending pipeSP:"`. This is the *encrypted socket* send — distinct from
  the plaintext pipe injector `0x40320a`.
- **`buildRsaLoginPacket 0x43124a`** — assembles the Tibia login/challenge frame
  for a mass-login worker: header `0A 02 00 20 03 00`, 16-byte key/nonce, per-
  account fields (name/password/character) pulled from the account-record array
  (base `0x4d07488`, stride `0xbb8`), RSA modulus from `rsa.txt`, exponent
  `0x10001`, RSA-encrypt via `sub_453d0b`, then `send()`s a `0x87`-length header
  (`0x85` payload) on socket `[ebp+8]`. Backed by the bignum primitives
  `bigIntMultiply256 0x4310c2` / `bigIntSubtract256 0x430daf`.

These belong to the login/teamserver subsystem ([05-teamserver.md](05-teamserver.md)),
which opens its own `WSOCK32` sockets and does not route through
`MB_InjectFrame`.

---

## Open items

- `MB_SendAction` ATTACK fast-path helpers `0x4014d8` / `0x4014a1` — target
  validation vs stop-attack, exact semantics **(unconfirmed)**.
- Dynamic `CastRuneTarget` (`0x4053a4`) / `Use*` primary path emits opcode bytes
  computed at runtime (pokes client cursor state + `sub_401163(0x7A)` before
  falling back to a static `0x84` frame); the *primary* (non-fallback) wire bytes
  are not immediates in `.text` **(unconfirmed)**.
- The `sub_40152D` extra dst args → which `%i` pipe instance mapping: inferred
  from the addressed-inject signature, not yet traced end-to-end **(unconfirmed)**.
- Whether `0x87` (use-inventory) is ever emitted as a standalone frame or only as
  the `driveClientUseInventorySlot` fallthrough — only the fallthrough site is
  confirmed.
