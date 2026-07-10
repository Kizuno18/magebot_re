# magebotv55.exe (v10x) — address-resolution bank & RPM-polling mirror

The **read half** of the whole bot. Everything the engine or the Lua `Get*`
layer knows about the game world flows through two stages documented here:

1. **Resolve** — after attach, ~50 tiny leaf functions in the `0x401aaa`–`0x402046`
   band compute *client.exe field addresses* from a handful of client base
   pointers (the `0x468exx`/`0x468fxx` table) plus fixed offsets, and cache each
   resolved address in a dedicated slot of the `0x4db37xx` **address band**.
2. **Read** — `MB_ReadClientState 0x004024a2` (thunk `0x4011b8`) takes one of
   those resolved client addresses, decides which *band* it falls in, and serves
   the value either from a **throttled batch-RPM cache** (creatures / containers /
   map) or by a **live, XOR-deobfuscated single RPM** (self scalars).

The `0x4db37xx` slots hold **addresses inside `client.exe`**, not values. The
values live in the client and are pulled across the process boundary on demand
(self scalars) or in bulk on a timer (creatures/containers/map). There is no
server→client packet parser; the mirror is filled entirely by re-reading client
memory (see [01-overview.md](01-overview.md), [engine-core.md](functions/engine-core.md) §2–3).

All addresses are `samples/v10x/magebotv55.exe`, imagebase `0x400000`. Resolver
names/purposes are from [functions/catalog-bot.md](functions/catalog-bot.md);
every offset/slot below was re-derived from the corpus disassembly.

---

## 1. Data / control flow

```
  attach (OpenProcess) → [0x4d22464]=client HANDLE, [0x4d22468]=client PID
  findClientPidByModuleName 0x402046 → client.exe DllBase
        │
        ▼   (post-attach, one-shot)
  ┌──────────────────────────────────────────────────────────────────┐
  │ RESOLVE BANK  0x401aaa..0x402046  (~50 leaf fns, no RPM)          │
  │                                                                   │
  │   client base ptrs           +/- fixed offset      resolved addr  │
  │   [0x468efc/eec/ee0/ef0/     ───────────────────►  [0x4db37xx]    │
  │    ef4/ef8/f0c/f14/f24/f28/                          slot          │
  │    f2c/f30/f34/f38/f44/f94]                                        │
  │                                                                   │
  │   some slots chain off an already-resolved slot                   │
  │   (e.g. [0x4db37c0]→[0x4db37bc], [0x4db37cc]→[0x4db3740/38/34])    │
  └───────────────────────────────┬──────────────────────────────────┘
                                   │ resolved client addr in [0x4db37xx]
                                   ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ MB_ReadClientState 0x4024a2 (thunk 0x4011b8)  — BAND DISPATCH      │
  │  arg1 = client addr (a 0x4db37xx slot value)   arg2 = 1/2/4        │
  │                                                                   │
  │  addr ∈ {0x4db3790/94/98/a8, 0x4db378c, 0x4db37a8}                 │
  │        → SELF SCALAR: double-RPM XOR deobfuscate; HP% ÷100         │
  │                                                                   │
  │  addr ∈ creature band ([0x468f38] … [0x4db37ac])                  │
  │        → serve from unk_4C1D3D8, batch-RPM refill ≥50ms            │
  │                                                                   │
  │  addr ∈ container band ([0x468f2c] … [0x4db377c])                 │
  │        → serve from byte_4C1AB74, per-node RPM parse ≥50ms         │
  │                                                                   │
  │  addr ∈ map band ([0x4db38c4] … [0x4db38c8])                      │
  │        → serve from byte_4B29044, batch-RPM refill ≥5ms            │
  │                                                                   │
  │  else → single RPM of arg2 bytes (uncached)                       │
  └───────────────────────────────┬──────────────────────────────────┘
                                   ▼
              Get* accessors, engine ticks (heal/target/cavebot/loot),
              dynamic packet builders (Cast*/Use*) — all read through here
```

The resolve bank runs **once** after attach; the read dispatch runs **per call**
on the calling thread (the cache refill is lazy — whoever reads a stale
creature/container/map address pays the batch RPM inside `ReadClientState`).

---

## 2. The client base-pointer table (`0x468exx`/`0x468fxx`)

These globals hold **base pointers into `client.exe`** (themselves resolved
elsewhere post-attach — the module-base walk is `findClientPidByModuleName`
`0x402046`, which late-binds `psapi.dll` and returns `client.exe`'s `DllBase`).
The resolvers below never read a base's *target*; they only do pointer
arithmetic on the base value and store the result. Bases referenced by the bank:

| Base global | Used by resolvers off it | Role (inferred from consumers) |
|---|---|---|
| `[0x468f38]` | `+0x45d30`→`_37ac`, `−[0x468f94]−0xa3`→`_37a0` | **creature-array base** (stride `0xE0`; `[0x4db37ac]`=array end) |
| `[0x468f2c]` | `+0x1eb0`→`_377c` | **container-array base** (stride `0x1ec`; `[0x4db377c]`=window end) |
| `[0x468ef0]` | `+0x18/+0x10/+0x24/+0/−0xc/−0x48/+0x20` | self/player field cluster (8 sibling fields) |
| `[0x468f30]` | `−0x5c/−0x14/−0x1c/−0xc/+0/+0/−8` | self cluster incl. HP% and the guarded XOR fields |
| `[0x468f34]` | `+0` (`+4` per catalog)→`_3790` | guarded self field |
| `[0x468f24]` | 10 negative offsets `−0x48…−0x168` | a large client struct (10 sibling fields) |
| `[0x468ef4]` | `−4`, `−0x88`(→anchor `_3720`) | struct base for the `_3720` field group |
| `[0x468efc/eec/ee0]` | `+0x13`/`+0`/`+0x7cc354` | misc single fields |
| `[0x468ef8]` | `+0x18` | single field |
| `[0x468f0c]` | `−0x3c` | waypoint/map tree base (`[0x4db3708]`, see §5) |
| `[0x468f14/f28/f44]` | `+0` / `+0`,`−0x28` / `+0` | connection-state / battle-list bases |

---

## 3. The resolver → slot table (complete, corpus-verified)

Every leaf in `0x401aaa`–`0x402037` has the identical body
`mov eax,[base]; {add|sub} eax,off; mov [slot],eax; ret` — pure arithmetic, no
RPM, no packet. Reconstructed directly from disassembly:

| Resolver VA | Resolved slot | Expression | Notes |
|---|---|---|---|
| `0x401aaa` | `0x4db37c8` | `[0x468efc] + 0x13` | |
| `0x401ac6` | `0x4db37c4` | `[0x468eec] + 0` | |
| `0x401ae2` | `0x4db37c0` | `[0x468ee0] + 0x7cc354` | deep client region; anchor for `_37bc` |
| `0x401b00` | `0x4db37bc` | `[0x4db37c0] + 0` | **chains** off `_37c0` |
| `0x401b1c` | `0x4db37b8` | `[0x468ef0] + 0x18` | level/cap field (read in heal tick) |
| `0x401b38` | `0x4db37b4` | `[0x468ef0] + 0x10` | X-offset scalar (screen origin) |
| `0x401b54` | `0x4db37b0` | `[0x468ef0] + 0x24` | Y-offset scalar |
| `0x401b70` | `0x4db37ac` | `[0x468f38] + 0x45d30` | **creature-array end** |
| `0x401b8e` | `0x4db37a8` | `[0x468ef0] + 0` | guarded self scalar (mana) |
| `0x401baa` | `0x4db37a4` | `[0x468ef0] − 0xc` | |
| `0x401bc6` | `0x4db37a0` | `[0x468f38] − [0x468f94] − 0xa3` | two-base gap fixup |
| `0x401bea` | `0x4db379c` | `[0x468ef0] − 0x48` | status byte (PZ/battle) |
| `0x401c06` | `0x4db3798` | `[0x468f30] − 0x5c` | **guarded** (HP-max, XOR) |
| `0x401c22` | `0x4db3794` | `[0x468f30] − 0x14` | **guarded** (HP-cur, XOR) |
| `0x401c3e` | `0x4db3790` | `[0x468f34] + 0` | **guarded** (XOR); catalog notes `+4` |
| `0x401c5a` | `0x4db378c` | `[0x468f30] − 0x1c` | **HP-percent** (ReadClientState ÷100) |
| `0x401c76` | `0x4db3788` | `[0x468ef0] + 0` | |
| `0x401c92` | `0x4db3784` | `[0x468f30] − 0xc` | **self/follow creature id** |
| `0x401cae` | `0x4db3780` | `[0x468ef0] + 0x20` | |
| `0x401cca` | `0x4db377c` | `[0x468f2c] + 0x1eb0` | **container-window end** |
| `0x401ce8` | `0x4db3778` | `[0x468ef8] + 0x18` | |
| `0x401d04` | `0x4db3774` | `[0x468f28] − 0x28` | client-state mode field |
| `0x401d20` | `0x4db3770` | `[0x468f24] − 0x168` | anchor for `_3768` |
| `0x401d3e` | `0x4db376c` | `[0x468f24] − 0x48` | |
| `0x401d5a` | `0x4db3768` | `[0x4db3770] + 0` | **chains** off `_3770` |
| `0x401d76` | `0x4db3764` | `[0x468f24] − 0xc8` | anchor for `_3760` |
| `0x401d94` | `0x4db3760` | `[0x4db3764] + 0` | **chains** off `_3764` |
| `0x401db0` | `0x4db375c` | `[0x468f24] − 0xe8` | anchor for `_3758` |
| `0x401dce` | `0x4db3758` | `[0x4db375c] + 0` | **chains** off `_375c` |
| `0x401dea` | `0x4db3754` | `[0x468f24] − 0x88` | |
| `0x401e08` | `0x4db3750` | `[0x468f24] − 0x68` | |
| `0x401e24` | `0x4db374c` | `[0x468f24] − 0x148` | |
| `0x401e42` | `0x4db3748` | `[0x468f24] − 0x108` | |
| `0x401e60` | `0x4db3744` | `[0x468f24] − 0x128` | |
| `0x401e7e` | `0x4db3740` | `[0x4db37cc] + 0x2430` | **chains** off `_37cc` |
| `0x401e9c` | `0x4db373c` | `[0x4db37cc] + 0` | alias of `_37cc` (creature-slot cursor base) |
| `0x401eb5` | `0x4db3738` | `[0x4db37cc] + 0x2590` | on-screen slot flags/table |
| `0x401ed3` | `0x4db3734` | `[0x4db37cc] + 0x24d0` | slot flag table |
| `0x401ef1` | `0x4db3730` | `[0x468f44] − 8` | battle-list header |
| `0x401f0d` | `0x4db372c` | `[0x468f30] + 0` | **self map X** (catalog: `−8`) |
| `0x401f29` | `0x4db3728` | `[0x468f30] + 0` | **self map Y** (catalog: `−4`) |
| `0x401f45` | `0x4db3724` | `[0x468ef4] + 0` | |
| `0x401f61` | `0x4db3720` | `[0x468ef4] − 0x88` | **anchor** for the `_3720` group |
| `0x401f7f` | `0x4db371c` | `[0x4db3720] + 0` (`+4` per catalog) | field of `_3720` |
| `0x401f9b` | `0x4db3718` | `[0x4db3720] + 0` (`+8` per catalog) | field of `_3720` |
| `0x401fb7` | `0x4db3714` | `[0x4db3718] + 0` | **alias** of `_3718` |
| `0x401fd0` | `0x4db3710` | `[0x4db371c] + 0` | **alias** of `_371c` |
| `0x401fe9` | `0x4db370c` | `[0x4db3720] + 0` | **alias** of `_3720` (base+0) |
| `0x402002` | `0x4db3708` | `[0x468f0c] − 0x3c` | **map/creature tree base** (see §5) |
| `0x40201e` | `0x4db3704` | `[0x468f28] + 0` | in-game/connection base (`==11` gate) |
| `0x402037` | `0x4db36f8` | `[0x468f14] + 0` | |

Notes on the `+ 0` rows: the corpus disassembly shows a bare
`mov eax,[base]; mov [slot],eax` (no `add`/`sub`) — a verbatim copy/alias. Where
the catalog records a small non-zero offset (`_3790 +4`, `_372c −8`, `_3728 −4`,
`_371c +4`, `_3718 +8`) the disassembler folded the displacement into the load's
addressing mode, so both descriptions agree on the resolved target; the effective
offset is as the catalog states. The `_37cc` anchor itself is resolved outside
this scanned range (its consumers `_3740/_373c/_3738/_3734` chain off it).

---

## 4. `MB_ReadClientState 0x004024a2` — band dispatch

`int MB_ReadClientState(uint32 clientAddr /*[ebp+8]*/, uint32 size /*[ebp+0xc]*/)`.
Reads `size` (1/2/4) bytes from `clientAddr` in the client and returns the value
in `eax` after per-band fixups. The client `HANDLE` is `[0x4d22464]`; there are
five distinct `ReadProcessMemory` sites, one per address class. Confirmed body
(from [engine-core.md](functions/engine-core.md) §2):

```
0x4024ab  cmp [ebp+8] against guarded self-field slots:
          0x4db3798 / 0x4db3794 / 0x4db3790 / 0x4db37a8 / 0x4db378c
0x4024e2  guarded path: TWO RPM reads, XOR'd → deobfuscate
0x4024fe  push [0x4d22464]                 ; client HANDLE
0x402505  call ReadProcessMemory           ; read #1  → [ebp-8]   (value)
0x40251c  push [0x4d22464]
0x402522  call ReadProcessMemory           ; read #2  → [ebp-0xc] (obf key)
0x402528  mov ecx,[ebp-8]; xor ecx,[ebp-0xc]
0x402534  cmp [ebp+8], [0x4db378c]         ; is this HP-percent?
0x402540  mov ecx,0x64; idiv ecx           ;   → ÷100
0x40254a  return
0x402552  (unguarded) → band tests → creature/container/map cache or single RPM
```

Dispatch summary:

| `clientAddr` band | Refresh | Local cache | Fixup |
|---|---|---|---|
| self scalars `0x4db3790/94/98/a8`, HP% `0x4db378c` | on-demand, per call | none | double-RPM XOR; HP% ÷100 |
| creature array `[0x468f38]…[0x4db37ac]` (stride `0xE0`) | ≥50 ms (`clock()`) | `unk_4C1D3D8` (lead −500 = `unk_4C1D1E4`) | serve `*(cache+(addr−base))`; ctr `[0x4db3930]` |
| containers `[0x468f2c]…[0x4db377c]` (stride `0x1ec`) | ≥50 ms | `byte_4C1AB74` (parsed) + `unk_4C1AB84` | serve `*(cache+(addr−base))`; ctr `[0x4db3938]` |
| map/tiles `[0x4db38c4]…[0x4db38c8]` | ≥5 ms | `byte_4B29044` | debug `"mppartread %x %i"`; ctr `[0x4db3934]` |
| anything else | on-demand | none | single RPM of `size` bytes |

The guarded self-field slots are exactly the ones the resolvers marked
**guarded** in §3 (`_3798`,`_3794`,`_3790` off `[0x468f30]`/`[0x468f34]`; `_37a8`
off `[0x468ef0]`; HP% `_378c`). They are stored XOR-obfuscated in the client and
the double-read/XOR recovers the plaintext value.

---

## 5. Cache-band reader functions (corpus-verified)

`ReadClientState` inlines most of the band logic, but the codebase also has
standalone helpers that implement the same cache-vs-RPM split for callers that
want a whole block. These make the mirror model concrete.

### `readContainerCacheOrRpm 0x402d4f` — container band

The clearest illustration of the "serve from cache when in-band, else RPM"
pattern. Confirmed asm:

```
mov eax,[0x4db377c]; add eax,1;  cmp [ebp+8],eax; jae fallback   ; addr > window end?
mov ecx,[0x468f2c]; add ecx,1;   cmp [ebp+8],ecx; jbe fallback   ; addr < base?
edx = [ebp+8] - [0x468f2c] + 0x4c1ab74                            ; cache offset
sub_44A590(0x4b28020, edx)        ; memcpy from container cache → scratch 0x4b28020
return 0x4b28020
fallback:
ReadProcessMemory([0x4d22464], src=[ebp+8], dst=0x4b28020, 0x400, 0)  ; direct RPM
return 0x4b28020
```

So a container read whose resolved address lies within `[0x468f2c] …
[0x4db377c]` is served from `byte_4C1AB74` at offset `(addr − [0x468f2c])`; out of
band it does a raw 1 KB RPM into scratch `0x4b28020`. This is the container
mirror's read side; the container linked-list *parse* that fills `byte_4C1AB74`
(492-byte stride/container, ≤50 conts, ≤40 items) is the writer side per
[engine-core.md](functions/engine-core.md) §3.

### Container slot-index helpers

- `findNthActiveContainerSlot 0x40319f` — maps a logical container index to the
  Nth open physical slot: cursor from `[0x468f2c]`, `+0x1ec` stride, end
  `[0x4db377c]`, reads the open flag at `slot+0x34` via `ReadClientState`. This
  is the same base/stride/window the container band uses, confirming the layout.

### Creature-array field readers (all via `ReadClientState`)

These scan the creature array using exactly the resolved band bounds
(base `[0x468f38]`, stride `0xE0`, end `[0x4db37ac]`), reading the id at
`entry−4` and returning one field on match:

| VA | Returns field | Not-found sentinel | Meaning |
|---|---|---|---|
| `creatureLookupField34ById 0x407c00` | `entry+0x34` | `1` | attribute at +0x34 |
| `creatureLookupField4cById 0x407b9c` | `entry+0x4c` | `0` | flag/skull |
| `creatureLookupField88ById 0x407c67` | `entry+0x88` | `0x64` | health-percent (defaults 100) |

Map coords are read at `entry+0x28` (x) / `entry+0x24` (y), floor at `entry+0x20`
(seen in `autoAttackNearestTick 0x40a3b5`, `isCreatureInThrowRange 0x40aef2`).
Every one of these is a `ReadClientState(entry+off, 4)` against the creature band,
i.e. served from `unk_4C1D3D8`.

### Map/tile tree base `[0x4db3708]`

`[0x4db3708]` (`= [0x468f0c] − 0x3c`, resolver `0x402002`) is the base of the
client's ordered map/creature tree. It is walked by 4-byte `ReadClientState`
reads in:

- `walkClientMapNodeSumMatch 0x402e09` / `…Inclusive 0x402ee4` — index-of / rank
  over the ordered structure (`+0x38` list head, per-node `+0x2c` key vs
  `[ebp+8]+0x40`, `+0x10` next, `+0x20` subtree size).
- `copyClientTreeLeafField 0x402fd8` — two-level descent (`+0x40`→`+0x40`→`+0x2c`)
  publishing a resolved leaf into mirror slot `0x4d7d6d4`.
- `computeTargetScreenX/Y 0x407e11 / 0x407f2a` — read `[0x4db3708]+0x30`→node,
  then node `+0x34/+0x38/+0x3c` viewport spans to project a world tile into the
  15×11 on-screen grid (self near col 7 / row 5).

---

## 6. Who consumes the band (read half → engine)

The resolved slots are the sole interface between the mirror and the bot logic.
Representative consumers, all reading through `ReadClientState`
(`sub_4011b8`):

- **Self scalars** — `cavebotHealSafetyTick 0x40850c` reads HP-cur `[0x4db3794]`,
  HP-max `[0x4db3798]`, mana `[0x4db37a8]`, level `[0x4db37b8]`, status
  `[0x4db379c]`; computes `hp% = hpcur*100/hpmax`.
- **Self position** — `[0x4db372c]` (x) / `[0x4db3728]` (y) plus offset scalars
  `[0x4db37b4]`/`[0x4db37b0]`, floor via `[0x468f30]` — read by the walker,
  targeting, and every `driveClient*` click routine.
- **Self/follow id** — `[0x4db3784]` — targeting (`autoAttackNearestTick`),
  follow (`MB_ThreadWalkFollow`), potion (`potionOnFriendTick`).
- **Creature band** — `autoAttackNearestTick 0x40a3b5`, `isCreatureInThrowRange
  0x40aef2`, `buildUseOnCreatureFrame 0x4060b5` scan `[0x468f38]`…`[0x4db37ac]`.
- **Container band** — the looter / `ssaa` branch of `cavebotHealSafetyTick`
  walks `[0x468f2c]` `+0x1ec` up to `[0x4db377c]`.
- **Slot-flag tables** — `[0x4db3734]`/`[0x4db3738]`/`[0x4db3740]` (off the
  `_37cc` anchor) drive the on-screen creature-slot select logic in
  `buildCastRuneTargetFrame 0x4053a4`, `sendMapClickWalkOrUse 0x404b0d`,
  `buildUseOnTileOrCreatureFrame83 0x4056e5`.

Write-back to the client (the rare inverse) goes through `sub_4011a9`
(`WriteClientState`) / the `writeDwordArgToClientMemory*` helpers against the same
resolved addresses — e.g. targeting writes the current target id to client base
`[0x468f34]` after choosing it.

---

## 7. Global reference (this subsystem)

| Global | Meaning |
|---|---|
| `0x4d22464` | client process **HANDLE** (every RPM site) |
| `0x4d22468` | client process **PID** |
| `[0x468exx]/[0x468fxx]` | client base-pointer table (resolver inputs) — see §2 |
| `0x4db36f8`–`0x4db37c8` | **resolved client-address band** (resolver outputs) — see §3 |
| `0x4db3708` | map/creature tree base (`[0x468f0c]−0x3c`) |
| `0x4db372c` / `0x4db3728` | self map X / Y |
| `0x4db3784` | self/follow creature id |
| `0x4db378c` | HP-percent field addr (ReadClientState ÷100) |
| `0x4db3790/94/98`, `0x4db37a8` | guarded XOR self fields (HP/mana) |
| `0x4db37ac` | creature-array end (base `[0x468f38]`, stride `0xE0`) |
| `0x4db377c` | container-window end (base `[0x468f2c]`, stride `0x1ec`) |
| `0x4db3930/34/38` | creature / map / container cache refresh counters |
| `unk_4C1D3D8` | creature batch-RPM cache (lead −500 = `unk_4C1D1E4`) |
| `byte_4C1AB74` | parsed container cache (+`unk_4C1AB84`) |
| `byte_4B29044` | map-region batch-RPM cache |
| `0x4b28020` | container read scratch buffer |
| `0x4d7d6d4` | published tree-leaf mirror slot (`copyClientTreeLeafField`) |

---

### Open items

- `[0x4db37cc]` anchor: resolved outside the scanned `0x401aaa`–`0x402046` range;
  its own base/offset **(unconfirmed)** — only its `_3740/_373c/_3738/_3734`
  children are visible here.
- Map band bounds `[0x4db38c4]`/`[0x4db38c8]`: these slots are **not** set by the
  §3 bank (they sit above `_37c8`); the resolver that computes them is
  **(unconfirmed)** — likely part of the map-tree setup around `[0x4db3708]`.
- The exact writer that fills `unk_4C1D3D8` / `byte_4B29044` (the batch-RPM refill
  bodies inside `ReadClientState 0x4024a2` past `0x402552`) is described in
  [engine-core.md](functions/engine-core.md) §3 but not disassembled field-by-field
  here.
- `[0x468f94]` (used only by the two-base gap fixup `_37a0 = [0x468f38]−[0x468f94]−0xa3`)
  role **(unconfirmed)**.
