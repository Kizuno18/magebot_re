# Overview — architecture & memory model

MageBot v5.5 (a.k.a. TibiaMB) is an **out-of-process memory bot** for the Tibia
client. Unlike ElfBot, it does **not** run its bot logic inside `Tibia.exe`. It
runs as its own process, opens a handle to the client, and reads game state
across the process boundary via `ReadProcessMemory`, on demand. It drives the
game by building client→server Tibia packets and handing them to a small shim it
injects into the client, which re-emits them onto the real socket.

It **does** keep a local mirror — but the mirror is filled by *throttled batch
`ReadProcessMemory` polling of the client*, not by parsing the server→client
packet stream (there is no packet parser). Bulk data is cached (creatures /
containers refreshed every ~50 ms, map tiles every ~5 ms); small self scalars are
read live per `Get*` call and XOR-deobfuscated. The local globals in the
`0x4db3xxx` / `0x468fxx` bands hold *resolved client addresses* (base pointers and
per-field addresses inside `client.exe`), not the values. Full band dispatch in
[functions/engine-core.md](functions/engine-core.md) §2–3.

Two binaries ship under the same name `magebotv55.exe`; both are clean MSVC PE32,
imagebase `0x400000`, no packer.

| Lineage | Client | Scripting | Build (link ts) | Automation surface |
|---|---|---|---|---|
| **v10x** | Tibia 10.x | Lua 5.1 (`lua51.dll`) | 2017-09-03 | 63 Lua globals ([03](03-lua-api.md)) |
| **v860** | Tibia 8.60 | none | 2022-02-15 | `.attack`/`.follow` chat commands + `.sav` cavebot ([06](06-v860-lineage.md)) |

The two lineages exist because the Tibia network protocol and client memory
layout changed across major versions. The 8.60 client has a different packet
structure and struct offsets than the 10.x client, so the mirror writer, the
offset band it reads, and the packet builder all differ. The v860 build is the
newer *code* (2022) targeting the *older* client; the v10x build is older code
(2017) targeting the 10.x client and adds an embedded Lua VM the v860 build lacks.
The rest of this doc describes the v10x lineage unless noted; per-version deltas
live in [06](06-v860-lineage.md).

## Memory-injection + mirror model

MageBot never lives inside the client. It attaches to a running client and
operates over the Win32 process-memory APIs (all statically imported):
`OpenProcess`, `ReadProcessMemory`, `WriteProcessMemory`, `VirtualAllocEx`,
`VirtualProtectEx`, `CreateRemoteThread`.

**Attach.** The bot finds the client by window class, then resolves its PID and
opens it. Window classes it accepts (strings, `.strings.txt:733,895–897`):

- `TibiaClient`, `TibiaClientTest`, `TibiaClientPreview`, `Tibia`

Statically it imports `FindWindowA`, `EnumWindows`, `GetWindowThreadProcessId`.
For module-base resolution it additionally loads **`psapi.dll`** at runtime
(`LoadLibraryA`; strings `psapi.dll` / `EnumProcesses` / `EnumProcessModules` /
`GetModuleBaseNameA` at `.strings.txt:67–70`) — these are not in the static
import table, only pulled in dynamically. The result is a live client `HANDLE`
stored at global `0x4d22464` (the handle argument passed to every RPM call, see
below).

**RPM-polling mirror.** The `.data` section is a ~92 MB virtual BSS
(`vsize 0x57f4854`, `rsize 0xb000`). Part of it holds the client-state caches
that `ReadClientState` refills by batch RPM — creatures at `unk_4C1D3D8`,
containers at `byte_4C1AB74`, map tiles at `byte_4B29044` — and the rest is the
bot's own large buffers (waypoint / script / tile-map storage). There is **no**
server→client packet parser; the caches are filled by re-reading `client.exe`
memory on a timer. The client's own struct layout — e.g. the creature list is an
array in the client at base `[0x468f38]`, stride `0xE0`, count `[0x4db37ac]` — is
recovered in [functions/lua-api-catalog-reads.md](functions/lua-api-catalog-reads.md);
those offsets describe the *client's* layout, batch-copied then read from cache.

**Read path — `ReadClientState` `0x004024a2`** (thunk `0x4011b8`). This is the
low-level client reader. Confirmed body:

```
cmp  arg, [0x4db3798]      ; guard: source addr must be one of a known set
je   ok                    ;   0x4db3790 / _94 / _98 / _37a8 / _378c
...
push 0 ; len ; &out ; srcAddr ; [0x4d22464]  ; client HANDLE
call ReadProcessMemory
```

So the "read a field from a fixed global" helper is literally an RPM against the
client, gated so it only reads from the whitelisted `0x4db3xxx` band. The Lua
`Get*` accessors (`GetPlayerInfo`, `GetCreatureInfo`, `GetGroundInfo`, …) load a
resolved client address from a `0x4db3xxx`/`0x468fxx` global and call through
here; every field is read live from the client per call (no cached copy).
Guarded fields in the `0x4db379x` band are stored XOR-obfuscated in the client
and read twice + XOR'd to deobfuscate; the HP-percent field is post-divided by
100 (see [functions/engine-core.md](functions/engine-core.md) §2).

**Act path — `SendAction` `0x00405f1d`** (thunk `0x401217`). Takes a Tibia opcode
plus args (e.g. `0xA1` = ATTACK), checks the master enable flag `[0x469098] == 1`,
then builds a client→server packet and injects it:

```
0x00405f23  cmp  dword [0x469098], 1     ; global "actions enabled" gate
0x00405f35  call 0x401177                ; builder / arg marshalling
0x00405f4c  call 0x4014d8
0x00405f5c  call 0x4014a1
0x00405f77  call 0x4011b8                ; ReadClientState thunk (read-back)
```

The enable flag `0x469098` is cleared to 0 at boot in WinMain (see below) and
flipped to 1 once the bot is armed. The built frame is handed to the injector
`0x0040320a`, which `fwrite`s it into a named pipe `\\.\pipe\SamplePipe%i` (with
a 2-byte length header, throttled ~1200 GetTickCount units); a shim inside the
injected `packet.dll` reads the pipe and re-emits the frame onto the client's
real socket via the cached `ws2_32!send`. Every acting Lua global —
`AttackTarget`, `MoveTo`, `Use*`, `Throw*`, `Npc*`, `CastRuneTarget`,
`CastHotkey` — funnels through `SendAction`.

Attack pacing uses `_ftol` (`0x0044b860`, CRT double→int) with a post-attack
delay global `0x4696e0`.

## Data flow

```
   Tibia client process (TibiaClient / …)
   ┌────────────────────────────────────────────────┐
   │  client memory / structs        ws2_32!send      │
   └──────────┬──────────────────────────▲───────────┘
   ReadProcessMemory (handle @0x4d22464)  │  packet.dll shim ← \\.\pipe\SamplePipe%i
              ▼                           │
   ┌──────────────────────────────┐      │
   │ ReadClientState 0x4024a2      │      │
   │ throttled batch RPM → caches: │      │
   │  creatures unk_4C1D3D8 (50ms) │      │
   │  conts    byte_4C1AB74 (50ms) │      │
   │  map      byte_4B29044 (5ms)  │      │
   │  self scalars: on-demand+XOR  │      │
   └──────────┬───────────────────┘      │
              ▼                           │
   ┌───────────────────────┐             │
   │  Get* accessors        │            │
   │  → engine + Lua VM     │            │
   │  (healer, targeting,   │            │
   │   cavebot, looter, …)  │            │
   └──────────┬────────────┘             │
              ▼                           │
   SendAction 0x405f1d  →  injector 0x40320a  ┘
   (gate [0x469098], opcode 0xA1=ATTACK …)   (fwrite pipe)
```

## Subsystem map

Grounded in strings + the Lua binding table (`recon/v10x_magebot.bindings.json`,
63 entries). Deep per-function docs hang off later files.

| Subsystem | Evidence | Lua surface |
|---|---|---|
| **Healer** | `HP is below your light healing %, Pausing` (`:211`), `UH Heal set on` (`:252`), `exura sio Heal` (`:253`) | `SetHealPotIDS`, `SetManaPotIDS`, `SetRuneIDS` |
| **Targeting** | `targeting.txt` (`:288`), `Target lost.` (`:306`) | `AttackTarget`, `CastRuneTarget`, `GetTargetInfo`, `GetCreatureInfo` |
| **Cavebot / waypoints** | `Near z change waypoint` (`:195`) | `StartWaypoints`/`StopWaypoints`, `SetWaypointInfo`, `MoveTo`, `SetStopPoint`, `ClearWaypoints`, `GetCurrentWaypoint`, `Start/StopAutoExplorer` |
| **Looter** | `pile loot2` (`:175`), `chking looter open %x` (`:176`) | `SetAutoLoot`, `SetLootTimer`, `GetContainerItems`, `GetMaxContainers`, `ThrowItem*` |
| **Hotkey broadcast / OTFollow** | `.follow`/`.stopfollow`/`.otfollow` (`:242–255`), `mwallcombosent` (`:81`) | `CastHotkey`, `FollowTarget`, `GetFollowInfo` |
| **HUD / DrawText** | GDI `TextOutA`/`SetBkMode` imports; `Welcome to MageBot this window will show help…` (`:349`) | `DrawText`, `printtext`, `SetGuiParams`, `GetCursorX/Y` |
| **Lua scripting** | `lua51.dll` import; `ReloadLua` binding | `EnableScript`/`DisableScript`, `ListScripts`, `LoadFile`/`SaveFile`, `SetTimerCallback`, `Sleep`, `GetClock`, full list in [03](03-lua-api.md) |
| **Teamserver** | `Welcome to the Tibiadb.com teamserver` (`:315`), `Connected to Team Server, hihi` (`:320`), `Combo request recved` (`:332`) | (host-side: [05](05-teamserver.md)) |
| **NPC trade** | — | `NpcSay`, `NpcBuy`, `NpcSell` |

## Process / threading model (statically visible)

- Single MSVC-CRT `WinMain`, no `pthread`-style pool visible in the entry graph;
  the bot uses `CreateThread` (KERNEL32 import) for worker loops and Win32
  `SetTimer` (USER32) for the HUD/engine tick. `GetTickCount` / `GetLocalTime`
  drive timing; `GetAsyncKeyState` polls hotkeys.
- Communication with the client is entirely cross-process (RPM/WPM against handle
  `0x4d22464`); there is no in-client hook thread. `CreateRemoteThread` is
  imported and is the likely SendAction injection trigger (*unconfirmed*, TODO).
- Networking: `WSOCK32` (`connect`/`send`/`recv`/`gethostbyname`) for the
  teamserver client and HTTP licensing to `tibiadb.com`
  (`key.php`/`resendkey.php`/`addcomputer.php`, `v=55`).

## Boot sequence

Entry `0x0044bf9f` is the standard MSVC CRT stub (`GetVersion` → heap/IO init →
`GetCommandLineA` → `GetModuleHandleA` → **WinMain**). The WinMain call site:

```
0x0044c061  call [GetModuleHandleA]
0x0044c068  call 0x40144c            ; WinMain thunk → 0x00437aa5
```

**WinMain `0x00437aa5`** (real body; thunk `0x40144c`). Boot highlights:

```
0x00437aa8  mov  eax, 0x7618 ; call 0x44a560   ; ~0x7618-byte stack frame (chkstk)
0x00437ab3  mov  dword [0x4db38e0], 0           ; clear state globals
0x00437abd  mov  dword [0x469098], 0            ; SendAction gate OFF at boot
0x00437ac7  cmp  dword [0x469098], 1            ; (dead branch at boot; flag just 0)
...         "safemode1st.txt1" / "a+t"          ; first-run gate:
0x00437b45  call [ShellExecuteA] ; "notepad.exe"  ;   opens a safe-mode note once
```

So boot: build the big local frame, zero the mirror/state control globals, hard-
disable actions (`0x469098=0`) until the bot arms, and on first run drop a
`safemode1st.txt` and pop it in Notepad. Attach-to-client, mirror allocation, Lua
state creation and the worker/timer install happen further into WinMain (deep
pass pending; the Lua registration of the 63 globals is catalogued in
[03](03-lua-api.md)).

## Companion binaries

- **`packet.dll`** (imagebase `0x10000000`) — exports `fnPacket`
  (`?fnPacket@@YAHPBDHH@Z` @ `0x10005641`) and `nPacket` (`?nPacket@@3HA`). On
  disk `fnPacket` is a `return 1` stub; how the exe wires it into the client send
  path at runtime is a TODO. Details in [04](04-packet-dll.md).
- **`server.exe`** — the local Team Server: combo-leader coordination,
  password-gated, `WSOCK32`, ~63-client Winsock cap. Protocol in
  [05](05-teamserver.md).

## Reading guide

Addresses are file-absolute at imagebase `0x400000` (EXEs) / `0x10000000`
(`packet.dll`). String references cite `recon/v10x_magebot.strings.txt` line
numbers. Recon artifacts under `recon/` are regenerable via `tools/`. See
[02](02-static-analysis.md) for the PE/import/section breakdown,
[03](03-lua-api.md) for the Lua API, [04](04-packet-dll.md) for `packet.dll`,
[05](05-teamserver.md) for the teamserver, and [06](06-v860-lineage.md) for the
v860 deltas.
