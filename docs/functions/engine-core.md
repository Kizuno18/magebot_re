# magebotv55.exe (v10x) — engine core

The bot is an **external** RPM/named-pipe automation client, not an in-process
hook. It runs as its own process next to `client.exe`, `OpenProcess`es the
client, reads game state through `ReadProcessMemory`, and injects client→server
packets by `fwrite`ing pre-built Tibia frames into a named pipe served by a
small injected shim inside the client. Everything the Lua layer does routes
through the four primitives documented here.

All addresses are `samples/v10x/magebotv55.exe`, imagebase `0x400000`. The 63
Lua globals are the thunk table `0x40100x–0x40153x`; each thunk `jmp`s to its
impl (see `recon/v10x_magebot.bindings.json`). Where a thunk is named below it
is the impl VA it resolves to.

---

## 1. SendAction / packet builder family

There is no single monolithic dispatcher. Each Lua action func
(`AttackTarget`, `FollowTarget`, `Npc*`, `Throw*`, `Cast*`, `Use*`) is a thin
wrapper that: `luaL_checknumber`s its args → `_ftol` (`0x0044b860`) → pushes an
**opcode** and args into a **per-shape builder**, which lays out a fixed Tibia
frame in a stack buffer and hands it to the injector `0x0040320a`. The
"dispatch" is therefore the constant each wrapper feeds its builder.

### 1a. The 2-arg builder — `0x00405f1d` (thunk `0x401217`)

This is the builder `AttackTarget`/`FollowTarget` use. It also carries a
special-case for opcode `0xA1`.

```
0x00405f23  cmp  dword [0x469098], 1        ; global enable flag
0x00405f2c  cmp  dword [ebp+0xc], 0xa1       ; opcode == ATTACK ?
            ... if enabled && ATTACK -> fast path 0x405f48
0x00405f6e  push 4
0x00405f70  push [0x468ee8]                  ; a client addr global
0x00405f77  call 0x4011b8                    ; ReadClientState(addr, 4)
0x00405f82  mov  byte [ebp-0x10], 9          ; frame length = 9
0x00405f8a  ...  [ebp-0xe] = opcode (arg [ebp+0xc] & 0xff)
0x00405f95  ...  [ebp-0xd..-0xa] = arg1  ([ebp+8], 4 LE bytes)
0x00405fcd  ...  [ebp-9..-6]    = the value just read from the client
0x00406005  push 0x10 ; lea eax,[ebp-0x10] ; push eax
0x0040600b  call 0x401415                    ; inject (thunk -> 0x40320a)
```

Wire shape (9 payload bytes): `09 00 <opcode> <arg1:4 LE> <clientVal:4 LE>`.
The trailing 4 bytes are read live from the client via `ReadClientState`, i.e.
the builder splices a current client field (e.g. a sequence/target field at
`[0x468ee8]`) into the outgoing packet.

The `0xA1` fast path (`0x405f48`) calls `0x4014d8` and, on a zero result,
`0x4014a1` — an ATTACK-specific pre-step (target validation / stop-attack),
unconfirmed in detail.

### 1b. Static-shape builders (fixed byte layout, no client read)

| Wrapper | Builder VA | Opcode byte | Frame (payload) |
|---|---|---|---|
| `NpcBuy`  | `0x00404fde` | `0x7A` | `07 00 7A <id:2 LE> 00 <count> 00 00` |
| `NpcSell` | `0x00405039` | `0x7B` | `07 00 7B <id:2 LE> 00 <count> 00 00` |
| `Throw*`  | `0x0040656b` | `0x78` | `0F 00 78 FF FF <id> 00 <cnt> <x:2><cnt2> FF FF <y> 00 <z> <n>` |

`NpcBuy` (`0x00404fde`) is the clearest template — length byte `07`, opcode
`0x7A`, item id as 2 LE bytes from `[ebp+8]`, a `00`, then count from
`[ebp+0xc]`, two padding `00`. `NpcSell` is byte-identical with opcode `0x7B`.
`Throw*` (`0x0040656b`) writes a 15-byte (`0x0F`) frame with opcode `0x78`
(Tibia MOVE_ITEM / "throw"); the `FF FF` words are the Tibia "from/to
container" magic markers and the coordinate/count fields come from the six
`_ftol`'d args the wrappers pass in.

All three finish with `push 0x10|0x18 ; lea buf ; call 0x401415`.

### 1c. Dynamic builders (read client, then inject)

`CastRuneTarget` → builder `0x004053a4`, and the `Use*` funcs
(`UseGroundItem 0x00434c19`, etc.), do **not** lay out a static frame. They
issue multiple `ReadClientState` (`0x4011b8`) calls to fetch live coordinates /
tile stack positions from the client, compute a use/cast packet from them, then
inject. Their exact opcode bytes are built at runtime and are **(unconfirmed)** —
they are not immediates in `.text`.

### 1d. Confirmed opcode → action map

| Opcode | Lua action | Wrapper VA | Builder |
|---|---|---|---|
| `0xA1` | AttackTarget | `0x004357da` | `0x00405f1d` (2-arg) |
| `0xA2` | FollowTarget | `0x00435818` | `0x00405f1d` (2-arg) |
| `0x7A` | NpcBuy | `0x00435990` | `0x00404fde` |
| `0x7B` | NpcSell | `0x004359e5` | `0x00405039` |
| `0x78` | ThrowItem{CtoC,CtoG,GtoC,GtoG,CtoI,ItoC} | `0x004359..0x435e69` | `0x0040656b` |
| (dyn)  | CastRuneTarget | `0x00435856` | `0x004053a4` |
| (dyn)  | UseGroundItem / UseItemOnGround / UseInventory / UseContainer | `0x00434b54..0x00434d55` | via `0x4011b8` reads |

Every action wrapper, after building, sleeps for the post-action delay
`[0x4696e0]` via `Sleep` (`AttackTarget` at `0x435805`) — this is the global
attack/action cooldown.

`NpcSay`/`CastHotkey` do not go through a binary builder; they write a text
command to `[0x4695a0]`/`[0x472c9c]` (a chat-line buffer) and let the chat path
send it.

---

## 2. ReadClientState — `0x004024a2` (thunk `0x4011b8`)

`int ReadClientState(uint32 clientAddr /*[ebp+8]*/, uint32 size /*[ebp+0xc]*/)`.
Reads `size` bytes (callers use 1/2/4) from address `clientAddr` **in the
client process** via `ReadProcessMemory`, applies a per-field fixup, and returns
the value in `eax`.

```
0x004024ab  cmp [ebp+8] against a set of "guarded" client-addr globals:
            [0x4db3798] [0x4db3794] [0x4db3790] [0x4db37a8] [0x4db378c]
0x004024e2  guarded path: TWO reads XOR'd together
0x004024fe  push [0x4d22464]               ; client process HANDLE
0x00402505  call ReadProcessMemory          ; read #1 -> [ebp-8]
0x0040251c  push [0x4d22464]
0x00402522  call ReadProcessMemory          ; read #2 (obf key) -> [ebp-0xc]
0x00402528  mov ecx,[ebp-8]; xor ecx,[ebp-0xc]  ; deobfuscate
0x00402534  cmp [ebp+8], [0x4db378c]        ; is this the HP-percent field?
0x00402540  mov ecx,0x64; idiv ecx           ;   -> divide by 100
0x0040254a  mov eax,[ebp-0xc]; jmp 0x402c49  ; return
0x00402552  (unguarded band) more addr comparisons -> single RPM read
```

Contract:
- **arg1** = a raw address inside the client (the resolved location of a game
  field; the Lua `Get*` funcs pass one of the `0x4db3xxx` client-addr globals).
- **arg2** = byte width; the function has `cmp [ebp+0xc], 4/2/1` branches
  further down (`0x4025fd`, `0x40261f`, `0x402642`) that size the read.
- **return** = the field value, in `eax`, after fixups. The guarded/XOR'd
  fields (`0x4db3798` and neighbours) are stored obfuscated in the client and
  need the double-read XOR; `[0x4db378c]` (HP%) is post-divided by 100.
- The client handle lives at `[0x4d22464]`; there are 5 distinct RPM call sites
  inside this one function (one per addr class).

Hex-Rays confirms `ReadClientState` is a **band dispatcher over a throttled
RPM-polling cache**, not a uniform per-call read. The requested `clientAddr` is
matched against several client-address ranges; three of them are backed by a
local cache that is refilled by a *batch* `ReadProcessMemory` on a timer, and the
individual read is then served from that cache (see §3).

---

## 3. State acquisition — the RPM-polling mirror

There is **no server→client packet parser** in this binary (imports are
`OpenProcess` / `ReadProcessMemory` / `WriteProcessMemory`, confirmed). But there
*is* a local mirror — it is filled by **throttled batch RPM polling of client
memory**, not by parsing a packet stream. `ReadClientState` (`0x004024a2`)
dispatches by which client-address band `clientAddr` falls in:

| Band (client addr) | Refresh | Local cache | Layout |
|---|---|---|---|
| self scalars `[0x4db3790/94/98/a8]`, HP% `[0x4db378c]` | **on-demand**, per call | none | double-RPM XOR deobfuscation; HP% ÷100 |
| creature array (client base `[0x468f38]` … `[0x4db37ac]`) | ≥ **50 ms** (`clock()`) | `unk_4C1D3D8` (lead −500 = `unk_4C1D1E4`) | one batch RPM of the whole client array; reads served as `*(cache + (addr − base))`; refresh ctr `[0x4db3930]` |
| open containers (client base `[0x468f2c]` … `[0x4db377c]`) | ≥ **50 ms** | `byte_4C1AB74` (parsed) + `unk_4C1AB84` | walks the client's container linked-list via per-node RPM, parses name/count/items → 492-byte stride/container, ≤50 conts, ≤40 items, count `[0x4b28550]`; refresh ctr `[0x4db3938]` |
| map/tile region (`[0x4db38c4]` … `[0x4db38c8]`) | ≥ **5 ms** | `byte_4B29044` | batch RPM of the region; debug `"mppartread %x %i"`; refresh ctr `[0x4db3934]` |
| anything else | on-demand | none | single RPM of `nSize` bytes |

So the ~92 MB `.data` BSS **does** hold client-state caches (`unk_4C1D3D8`
creatures, `byte_4C1AB74` containers, `byte_4B29044` map) plus the bot's own
buffers. The distinction from ElfBot-style bots is the *fill mechanism*: MageBot
never sees the wire — it re-reads `client.exe` memory on a timer. Fast bulk data
is cached (creatures/containers 50 ms, map 5 ms); small self scalars are read
live per call and XOR-deobfuscated. The `0x4db3xxx`/`0x468fxx` globals are
**local slots holding resolved client addresses** (base pointers + per-field
addresses inside `client.exe`), not the values themselves.

### Attach — `OpenProcess` block ending `0x004381d4`

```
0x0043817e  push "\\.\pipe\SamplePipe%i"      ; injection pipe name (fmt)
0x004381a4  call GetCurrentProcess            ; (transient, overwritten next)
0x004381aa  mov  [0x4d22464], eax
0x004381ba  call SetPriorityClass(0x80)       ; BELOW_NORMAL on self
0x004381c0  push [0x4d22468]                  ; target client PID
0x004381c9  push 0x1f0fff                      ; PROCESS_ALL_ACCESS
0x004381ce  call OpenProcess
0x004381d4  mov  [0x4d22464], eax             ; client handle stored
0x004381d9  push "client.exe"                  ; module lookup follows
```

So `[0x4d22468]` = client PID, `[0x4d22464]` = client handle. After attach the
bot resolves each game field's address inside `client.exe` and caches it in the
`0x4db3xxx` band; every `Get*` and every dynamic builder then reads through
`ReadClientState`.

### The worker threads (Section 5) are the "tick"

The five threads spawned by `WinMain` are the poll loops that periodically call
`ReadClientState` to refresh cached state and drive healing/cavebot/targeting.
They are Sleep-gated polling loops, not a packet parser.

---

## 4. Known globals (address table)

| Global | Meaning | Evidence |
|---|---|---|
| `0x469098` | master enable flag (`==1` gate) | checked in `0x405f23`, `0x403249`, `0x4053aa`; cleared in `WinMain` `0x437abd` |
| `0x4696e0` | post-action delay (ms), passed to `Sleep` | `AttackTarget 0x435805`, every action wrapper |
| `0x4d22464` | client process **handle** (`OpenProcess` result) | stored `0x4381d4`; used by all 5 RPM sites in `ReadClientState` |
| `0x4d22468` | client process **PID** (`OpenProcess` arg) | `0x4381c0` |
| `0x4d22498` | saved `hInstance` (`WinMain` arg) | `0x437c0c` |
| `0x468ee8` | client addr spliced into 2-arg packets | `0x405f70` |
| `0x4db378c` | HP-percent field addr (post `/100`) | `0x402534`, `0x402545` |
| `0x4db3790/94/98` | guarded (XOR-obfuscated) self-field addrs | `0x4024ae`–`0x4024c4` |
| `0x4db37a8`, `0x4db37ac` | more self-field addrs | `0x4024cf`, `0x402555` |
| `0x4db377c`, `0x4db38c4/c8`, `0x4db3930/34/38` | further cached client-field addrs | dispatched in `ReadClientState` body |
| `0x4db3918` | flag checked by helper `0x0041ce04` (thunk `0x401177`) | `0x41ce07` |
| `0x4db3948` / `0x4db394c` | injector throttle: last-send tick + init flag | `0x403210`–`0x40323d` |
| `0x4db3944` | injector "pipe open failed" flag | `0x4032a0` |
| `0x4695a0` / `0x472c9c` | chat-line buffer (NpcSay/CastHotkey path) | `0x4358d5`, `0x435968` |

The `0x4db3xxx` set are **client addresses**, resolved post-attach; they are not
a local mirror. `_ftol` = `0x0044b860`, `RPCRT4!UuidCreateSequential` resolved in
`WinMain 0x437cc5` (machine-id for the tibiadb.com licensing `m=%d`).

---

## 5. Injector — `0x0040320a` (thunk `0x401415`)

`inject(char *frame, int len)`. This is the client→server send primitive. It is
**not** `WriteProcessMemory`; it writes the frame to a named pipe (`fopen`/
`fwrite`/`fclose`, CRT thunks `0x44a9a0`/`0x44a876`/`0x44a820`) that an injected
shim inside the client reads and re-emits onto the real socket.

```
0x00403210  cmp [0x4db3948], 1              ; first send? seed last-tick
0x00403232  sub eax,[0x4db394c]; cmp eax,0x4b0 ; throttle: >= 1200 ticks apart
0x0040323d      < 1200 -> return 1 (drop)
0x00403249  cmp [0x469098], 1               ; if master flag set (safemode) -> drop
0x0040325c  push "Sending pipe:"            ; debug print
0x00403285  push "wb+"                       ; fopen mode
0x0040328a  push [0x4caa7c8]                 ; pipe path buffer (\\.\pipe\SamplePipe%i)
0x0040328f  call 0x44a9a0                    ; fopen
            ... on NULL: set [0x4db3944]=0, return
0x004032b4  build 2-byte length header (len & 0x800000ff, signed fixup)
0x004032e2  call 0x44a876 (fwrite) x2        ; header then payload
            ... fclose 0x44a820
```

So the outgoing frame is: `<len:2 LE>` + the payload built in Section 1, dropped
into `\\.\pipe\SamplePipe%i` and throttled to one send per ~1200 GetTickCount
units. The `[0x469098]==1` check here reads as a *safemode/paused* gate that
suppresses actual injection.

---

## 6. Boot — entry `0x0044bf9f` → `WinMain 0x00437aa5`

`0x0044bf9f` is the MSVC CRT startup (`__tmainCRTStartup`): `GetVersion`,
`__heap_init`, `GetCommandLineA` (`0x44c013`), CRT init, then at `0x44c068`
`WinMain(hInst, 0, cmdline, nShow)` (thunk `0x40144c` → `0x00437aa5`).

`WinMain` (`0x00437aa5`, ~0x60xx bytes, ends `0x43ba8c`):

1. `[0x4db38e0]=0`, `[0x469098]=0` — clear enable flag (`0x437abd`).
2. Optional `safemode1st.txt` handling + `ShellExecute notepad.exe` on first run
   (`0x437ada`–`0x437b45`).
3. Save `hInstance` → `[0x4d22498]` (`0x437c0c`); zero-init several large stack
   config blocks and timer buffers (the `0x44a750` memset thunk calls).
4. `LoadLibrary("RPCRT4")` + `GetProcAddress("UuidCreateSequential")`
   (`0x437ca4`) — the sequential UUID is the machine-id used in the tibiadb.com
   key/addcomputer requests. On licensing failure it `MessageBox`es
   "The account that authorized this computer has been disabled" / "Internet
   Error" and jumps to the exit `0x43ba8c` (`0x437f00`–`0x437f3c`).
5. **Spawn 5 worker threads** (`CreateThread`, `0x437f55`–`0x437fbd`):

   | Thread proc (thunk → impl) | Role (from body) |
   |---|---|
   | `0x4010b9` → `0x0042b49a` | poll loop |
   | `0x4012ee` → `0x0042ba17` | poll loop |
   | `0x4012e4` → `0x0042b7ec` | poll loop (Sleep-gated) |
   | `0x40134d` → `0x00431ff6` | poll loop (`Sleep`+`jmp 0x43201b`) |
   | `0x40140b` → `0x00421d0b` | poll loop (`Sleep`+`jmp 0x421d1a`) |

   Each is a `while(1){ … ; Sleep(n); }` tick that refreshes state via
   `ReadClientState` and drives a subsystem (heal / cavebot / target / loot).
   Exact per-thread mapping is **(unconfirmed)** — bodies are Sleep-gated loops;
   which is which needs their inner `ReadClientState`/action calls traced.

6. `DialogBoxParamA` (`0x437e19`) — the modal config GUI. There is **no**
   `GetMessage`/`PeekMessage` pump anywhere in the binary (confirmed: neither is
   imported); the bot logic lives entirely in the 5 poller threads, and the main
   thread blocks in the dialog.

---

### Open items

- Per-thread role assignment for the 5 workers (heal vs cavebot vs target).
- Exact opcode bytes for the dynamic `Cast*`/`Use*` builders (built from RPM
  reads, not immediates).
- The `0xA1` ATTACK fast-path helpers `0x4014d8`/`0x4014a1` (target validation?).
- Whether `WriteProcessMemory` (imported) is used for anything beyond the pipe
  path — no call site inspected yet.
