# Memory map — magebotv55.exe (v10x)

Consolidated reference for the bot's global memory, recovered from the named
resolver bank ([functions/catalog-bot.md](functions/catalog-bot.md)) and the
engine primitives ([functions/engine-core.md](functions/engine-core.md)). All
addresses are in `magebotv55.exe`'s own `.data` (imagebase `0x400000`) and are
**T10o-absolute** — the other Lua builds hold the same layout at recompiled
offsets ([15-version-comparison.md](15-version-comparison.md)).

## The two-band model

1. **Client base pointers** — `0x468exx` / `0x468fxx`: each holds a base address
   *inside `client.exe`* (a struct root: self, creature array, container list,
   map). Written once at attach.
2. **Resolved-address slots** — the `0x4db3xxx` band: the ~50 resolver functions
   (`0x401aaa`–`0x402037`) compute `base + offset` from a `0x468fxx` root and
   store the resulting *client field address* into a `0x4db3xxx` slot.
3. `MB_ReadClientState` (`0x004024a2`) is handed a `0x4db3xxx` slot value and
   `ReadProcessMemory`s the field from the client — directly for self scalars,
   or from a throttled batch cache for the bulk bands.

So: `0x468fxx root → resolver → 0x4db3xxx slot (client field addr) → RPM → value`.

## Client base pointers (`client.exe` struct roots)

| Global | Role (from resolver usage) |
|---|---|
| `0x468ef0` | primary self/player field cluster (13 resolvers offset off it) |
| `0x468f24` | a large sub-struct (10 resolvers, offsets −0x48…−0x168) |
| `0x468f30` | self position / status cluster (self X `−8`→`0x4db372c`, Y `−4`→`0x4db3728`) |
| `0x468f38` | **creature array base**, stride `0xE0`, end `[0x4db37ac]` |
| `0x468f2c` | **open-container list base** → `[0x4db377c]` |
| `0x468ee0/eec/ef4/ef8/efc`, `0x468f14/f28/f34/f44` | further field-cluster roots |

## Resolver → slot table

| Resolver | client base | → slot |
|---|---|---|
| `resolveClientAddr_468efc_p13` | `0x468efc` | `0x4db37c8` |
| `resolveClientAddr_468eec_m4` | `0x468eec` | `0x4db37c4` |
| `resolveClientAddr_468ee0_p7cc354` | `0x468ee0` | `0x4db37c0` |
| `resolveClientAddr_468ef0_p18` | `0x468ef0` | `0x4db37b8` |
| `resolveClientAddr_468ef0_p10` | `0x468ef0` | `0x4db37b4` |
| `resolveClientAddr_468ef0_p24` | `0x468ef0` | `0x4db37b0` |
| `resolveClientAddr_468f38_p45d30` | `0x468f38` | `0x4db37ac` (creature count/end) |
| `resolveClientAddr_468ef0_p4` | `0x468ef0` | `0x4db37a8` (guarded self) |
| `resolveClientAddr_468ef0_m0c` | `0x468ef0` | `0x4db37a4` |
| `resolveClientAddr_468ef0_m48` | `0x468ef0` | `0x4db379c` |
| `resolveClientAddr_468f30_m5c` | `0x468f30` | `0x4db3798` (guarded, XOR) |
| `resolveClientAddr_468f30_m14` | `0x468f30` | `0x4db3794` (guarded, XOR) |
| `resolveClientAddr_468f34_p4` | `0x468f34` | `0x4db3790` (guarded, XOR) |
| `resolveClientAddr_468f30_m1c` | `0x468f30` | `0x4db378c` (**HP %**, ÷100) |
| `initAddrClientBaseP8` | `0x468ef0` | `0x4db3788` |
| `initAddrClientBaseF30M0C` | `0x468f30` | `0x4db3784` |
| `initAddrClientBaseP20` | `0x468ef0` | `0x4db3780` |
| `initAddrClientBaseF2CP1EB0` | `0x468f2c` | `0x4db377c` (container list end) |
| `initAddrClientBaseF8P18` | `0x468ef8` | `0x4db3778` |
| `initAddrClientBaseF28M28` | `0x468f28` | `0x4db3774` |
| `initAddrClientBaseF24M168` | `0x468f24` | `0x4db3770` |
| `initAddrClientBaseF24M48` | `0x468f24` | `0x4db376c` |
| `initAddrClientBaseF24MC8` | `0x468f24` | `0x4db3764` |
| `initAddrClientBaseF24ME8` | `0x468f24` | `0x4db375c` |
| `initAddrClientBaseF24M88` | `0x468f24` | `0x4db3754` |
| `initAddrClientBaseF24M68` | `0x468f24` | `0x4db3750` |
| `initAddrClientBaseF24M148` | `0x468f24` | `0x4db374c` |
| `resolveClientAddr_468f24_minus108` | `0x468f24` | `0x4db3748` |
| `resolveClientAddr_468f24_minus128` | `0x468f24` | `0x4db3744` |
| `resolveClientAddr_468f44_minus8` | `0x468f44` | `0x4db3730` |
| `resolveClientAddr_468f30_minus8` | `0x468f30` | `0x4db372c` (**self X**) |
| `resolveClientAddr_468f30_minus4` | `0x468f30` | `0x4db3728` (**self Y**) |
| `resolveClientAddr_468ef4_minus4` | `0x468ef4` | `0x4db3724` |
| `resolveClientAddr_468ef4_minus88` | `0x468ef4` | `0x4db3720` |
| `resolveClientAddrFrom468f28` | `0x468f28` | `0x4db3704` |
| `resolveClientAddrFrom468f14` | `0x468f14` | `0x4db36f8` |

(Plus alias/chained resolvers that recompute an already-set slot from a prior
slot — `0x4db37c0`, `0x4db3720`, `0x4db37cc`, etc. — for ordering dependencies.)

## Local caches (RPM-polled, in the `.data` BSS)

| Global | Contents | Refill |
|---|---|---|
| `unk_4C1D3D8` | creature array copy (client base `[0x468f38]`, stride `0xE0`) | batch RPM ≥ 50 ms |
| `byte_4C1AB74` | parsed open-containers (492-byte stride, count `[0x4b28550]`) | ≥ 50 ms |
| `byte_4B29044` | map/tile region (`[0x4db38c4]`…`[0x4db38c8]`) | ≥ 5 ms |

## Control globals

| Global | Meaning |
|---|---|
| `0x469098` | master action gate (`==1`) |
| `0x4696e0` | post-action delay (ms) → `Sleep` |
| `0x4d22464` | client process HANDLE (`OpenProcess`) |
| `0x4d22468` | client process PID |
| `0x4d22498` | saved `hInstance` |
| `0x4d22494` | client HWND |
| `0x468ee8` | client field spliced into 2-arg attack/follow packets |
| `0x4db378c` | HP-percent field addr (÷100) |
| `0x4db3790/94/98`, `0x4db37a8` | guarded (XOR-obfuscated) self fields |
| `0x4db3930/38/34` | creature/container/map cache refresh counters |
| `0x4db3948/4c`, `0x4db3944` | injector throttle tick + init/fail flags |

## Open (needs live client version)

The *semantic* label of most `0x4db3xxx` slots (which client field each holds) is
only known where a `Get*` reads it ([functions/lua-api-catalog-reads.md](functions/lua-api-catalog-reads.md)):
HP%, self X/Y, creature base/count, container base. The rest are structurally
mapped (base+offset→slot) here but not semantically named — that requires reading
the live 10.x client's struct at each offset.
