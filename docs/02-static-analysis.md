# Static analysis — PE structure, imports, strings

All five binaries are 32-bit x86 PE, clean MSVC, no packer. Data below is from
`recon/<tag>.summary.json` (`pefile`) and `recon/<tag>.strings.txt`. Two
lineages of `magebotv55.exe` ship: **v860** (Tibia 8.60, non-Lua chat-command +
`.sav` cavebot, 2022 build) and **v10x** (Tibia 10.x, Lua 5.1, 2017 build).
`packet.dll` and `server.exe` follow the same split, except `server.exe` is
shared. Imagebase `0x400000` for the EXEs, `0x10000000` for `packet.dll`.

| Binary | Tag | Timestamp | Entry | .data VSize |
|---|---|---|---|---|
| magebotv55.exe (v10x) | `v10x_magebot` | 2017-09-03 | `0x44bf9f` | **0x57f4854 (~92 MB)** |
| magebotv55.exe (v860) | `v860_magebot` | 2022-02-15 | `0x4426ef` | **0x9c78c54 (~156 MB)** |
| packet.dll (v10x) | `v10x_packet` | 2017-09-03 | `0x1000648b` | 0x1ba34c (~1.7 MB) |
| packet.dll (v860) | `v860_packet` | 2022-02-15 | `0x100060fb` | 0x4a2cc (~296 KB) |
| server.exe | `server` | 2011-05-12 | `0x40c77f` | 0x9028 (~36 KB) |

Timestamps look genuine (not packer-faked): 2017 for the Lua build, 2022 for
the 8.60 build, 2011 for the team server. The 8.60 build is the newest binary
but targets the older game — a maintained legacy fork.

---

## magebotv55.exe — v10x (Lua, Tibia 10.x)

### Sections

| Name | VA | VSize | RSize |
|---|---|---|---|
| `.text` | 0x401000 | 0x64794 | 0x65000 |
| `.rdata` | 0x466000 | 0x1f2d | 0x2000 |
| `.data` | 0x468000 | **0x57f4854** | 0xb000 |
| `.idata` | 0x5c5d000 | 0x14e3 | 0x2000 |
| `.rsrc` | 0x5c5f000 | 0x5e96 | 0x6000 |
| `.reloc` | 0x5c65000 | 0x280e6 | 0x29000 |

The **~92 MB `.data` BSS** is the defining feature: RSize `0xb000`
(~44 KB of initialized data) against VSize `0x57f4854`. The delta is
zero-filled BSS the loader commits at runtime. Part of it holds the bot's local
client-state caches (creatures `unk_4C1D3D8`, containers `byte_4C1AB74`, map
`byte_4B29044`), which `ReadClientState` `0x004024a2` refills by **throttled
batch `ReadProcessMemory`** from the client (not by parsing a packet stream — see
[functions/engine-core.md](functions/engine-core.md) §3); the rest is the bot's
own buffers (waypoint/script/tile-map). The `0x4db3xxx` / `0x468fxx` band holds
resolved *client* addresses (base pointers + per-field addresses inside
`client.exe`), not the values — small self scalars are read live per call, bulk
data served from the caches.

### Imports (385 functions recovered, 63 Lua bindings)

| DLL | Count | Notable |
|---|---|---|
| KERNEL32 | 79 | `OpenProcess`, `ReadProcessMemory`, `WriteProcessMemory`, `VirtualAllocEx`, `VirtualProtectEx`, `CreateRemoteThread`, `CreateThread` |
| USER32 | 31 | `FindWindowA`, `EnumWindows`, `GetWindowThreadProcessId`, `SendMessageA`/`PostMessageA`, `GetAsyncKeyState`, `mouse_event`, `SetCursorPos`, `DialogBoxParamA` |
| WSOCK32 | 12 | `WSAStartup`, `socket`, `connect`, `send`, `recv`, `gethostbyname`, `inet_addr`, `htons`, `ioctlsocket` |
| **lua51** | 17 | `luaL_newstate`, `luaL_openlibs`, `luaL_loadfile`, `lua_pcall`, `lua_pushcclosure`, `luaL_checkinteger/lstring/number`, `lua_getfield/setfield` |
| GDI32 | 3 | `TextOutA`, `SetBkMode`, `GetStockObject` |
| comdlg32 | 2 | `GetOpenFileNameA`, `GetSaveFileNameA` |
| SHELL32 | 1 | `ShellExecuteA` |
| WINMM | 1 | `PlaySoundA` |

The **process-memory quartet** (`OpenProcess`/`RPM`/`WPM`/`CreateRemoteThread`)
confirms the injection + memory-write model. **WSOCK32** is the raw client for
tibiadb.com licensing and the team-server link. **lua51** is present only in
this lineage — it hosts the 63-global scripting API (`recon/lua_bindings.json`,
`recon/v10x_magebot.bindings.json`).

**psapi is NOT in the static IAT** — `psapi.dll` / `EnumProcesses` /
`EnumProcessModules` appear as strings (lines 67-69) and are resolved
dynamically via `LoadLibraryA` + `GetProcAddress`. Used to enumerate running
processes and find the Tibia client PID. Same pattern in every binary below.

### Standout strings

- **License URLs (tibiadb.com):** `http://www.tibiadb.com/key.php`,
  `.../resendkey.php`, `.../addcomputer.php?computer=%d&id=%s&m=%d`,
  `/authorize.php?id=`. Request line `GET %s%d&v=55&m=%d HTTP/1.1`,
  `Host: tibiadb.com`. The `v=55` is the product version, `m=%d` the machine id.
- **Window classes:** `TibiaClient`, `TibiaClientTest`, `TibiaClientPreview`
  (the client windows it hunts via `FindWindowA`), `TibiaMB` (its own window /
  title, e.g. `TibiaMB    Exp/hr: %i TNL: %i`).
- **Lua script files:** `basic_functions.lua`, `script_loader.lua`,
  `script_gui.lua`, `spell_damage.lua`, `champdb.lua`, `itemdb.lua`,
  `simpleui_drawing.lua`, `SendInput.lua`, `SendInputScheduled.lua`, `SKeys.lua`,
  `utils.lua`, `uiconfig.lua`, `sample.lua`, `newscript.lua`, glob `*.lua`.
- **Licensing UX:** "Could not connect to tibiadb.com…", "Corrupt Packet
  Stream…", "Fully Registered %s", "YOU SHOULD BUY A MAGEBOT KEY OMG :(",
  "Magebot will close in a few minutes".
- **Team server:** "Welcome to the Tibiadb.com teamserver… limit is 10 players
  per private server".

---

## magebotv55.exe — v860 (chat-command, Tibia 8.60)

### Sections

| Name | VA | VSize | RSize |
|---|---|---|---|
| `.text` | 0x401000 | 0x5b2f3 | 0x5c000 |
| `.rdata` | 0x45d000 | 0x1e49 | 0x2000 |
| `.data` | 0x45f000 | **0x9c78c54** | 0xa000 |
| `.idata` | 0xa0d8000 | 0x11d4 | 0x2000 |
| `.rsrc` | 0xa0da000 | 0x5e10 | 0x6000 |
| `.reloc` | 0xa0e0000 | 0x2482e | 0x25000 |

Same architecture, even bigger BSS (**~156 MB `.data`**, RSize only
`0xa000`) — part RPM-polled client-state caches (v860 creature base `[0x45ff0c]`,
stride `0xA8`), part the bot's own waypoint/tile-map buffers, which the 8.60 build
reserves more of. Same RPM-polling model as v10x, not a wire-parsed mirror.

### Imports (275 functions, 0 Lua bindings)

| DLL | Count | Notable |
|---|---|---|
| KERNEL32 | 76 | same memory quartet as v10x (`OpenProcess`/`RPM`/`WPM`/`VirtualAllocEx`/`CreateRemoteThread`) |
| USER32 | 29 | `FindWindowA`, `EnumWindows`, `GetWindowThreadProcessId`, `mouse_event`, `SetCursorPos`, `GetAsyncKeyState` |
| WSOCK32 | 12 | identical set to v10x |
| **GDI32** | 9 | `BitBlt`, `CreateCompatibleDC`, `CreateCompatibleBitmap`, `GetDIBits`, `SelectObject`, `DeleteObject`, `TextOutA` |
| comdlg32 | 2 | file dialogs |
| SHELL32 | 1 | `ShellExecuteA` |
| WINMM | 1 | `PlaySoundA` |

Two deltas from v10x: **no lua51** (this build is script-less, driven by
in-game chat commands and `.sav` cavebot recordings), and a **fuller GDI32
set** — `BitBlt`/`CreateCompatibleDC`/`GetDIBits` indicate on-screen HUD /
overlay rendering (the "Mwall Timers and HUD", team-position display, timers)
the Lua build offloads to `simpleui_drawing.lua`.

### Standout strings

Same tibiadb.com license URLs and request line (`GET %s%d&v=55&m=%d HTTP/1.1`),
same window classes (`TibiaClient`, `TibiaClientTest`, `TibiaMB`), plus:

- **Client target:** `Tibia.exe`, `tibia.bin`, `Tibia Testserver`.
- **Cavebot / recordings:** `record.sav`, `*.sav`, `.savd`, cavebot help text
  ("Cavebot will toss loot on the ground…", "Cavebot Unloads after 20 minutes
  Please Buy a Key", "the cavebot will attempt to use map-clicks…").
- **Config:** `customhotkeys.txt`, `Targeting.txt`, `Safelist.txt`.
- **Team-server combo vocabulary** (chat-triggered hotkey commands):
  `SDCOMBO`, `GFBCOMBO`, `MWALLCOMBO`, `MWALLTEAM`, `UEMAX`, `EXORIMAX`,
  `RMAX`, `SDMAX`, `PARAMAX1`, `TEAMLOCFOUND`, `sendteam`. Status line
  "AutoFire(OFF) MC Formation Mode (OFF) Cavebot(OFF) Follow Mode (OFF)".
- **Team coordination:** "Connected to Team Server, hihi", "Combo request
  recved", "Attack the Team leader's target", `teamrecv %d byte: %x %x …`,
  "Team Chat Enabled, Type @What_you_want_to_say".

---

## packet.dll — v10x and v860

Near-identical between lineages: same imports, same two exports, same pipe
strings. This is the injected component that talks to the bot EXE over named
pipes. Only sizes and the timestamp differ.

| | v10x | v860 |
|---|---|---|
| Timestamp | 2017-09-03 | 2022-02-15 |
| Entry | 0x1000648b | 0x100060fb |
| `.text` VSize | 0x9a32 | 0x96a2 |
| `.data` VSize | 0x1ba34c (~1.7 MB) | 0x4a2cc (~296 KB) |
| Functions | 107 | 98 |

### Sections (v10x; v860 same layout)

| Name | VA | VSize | RSize |
|---|---|---|---|
| `.text` | 0x10001000 | 0x9a32 | 0xa000 |
| `.rdata` | 0x1000b000 | 0xcbb | 0x1000 |
| `.data` | 0x1000c000 | 0x1ba34c | 0x2000 |
| `.reloc` | 0x101c7000 | 0x2398 | 0x3000 |

### Exports (both)

| Symbol | Demangled | v10x VA | v860 VA |
|---|---|---|---|
| `?fnPacket@@YAHPBDHH@Z` | `int fnPacket(char const*, int, int)` | 0x10005641 | 0x100052b7 |
| `?nPacket@@3HA` | `int nPacket` (global) | 0x101c4c58 | 0x10054bc4 |

`fnPacket` is the single work function — takes a buffer pointer + two ints,
returns int. `nPacket` is an exported counter/state global.

### Imports

| DLL | Count | Notable |
|---|---|---|
| KERNEL32 | 63 | `CreateNamedPipeA`, `ConnectNamedPipe`, `DisconnectNamedPipe`, `CreateThread`, `VirtualProtectEx`, critical-section + TLS set |
| USER32 | 3 | `SetWindowLongA`, `CallWindowProcA`, `GetAsyncKeyState` |

The **named-pipe quartet** plus `SetWindowLongA`/`CallWindowProcA` is a
window-subclass hook: `packet.dll` subclasses a client window
(`SetWindowLongA` swaps the WndProc, chained through `CallWindowProcA`) and
bridges the intercepted packet stream to the bot EXE over named pipes. No
WSOCK32 here — networking stays in the EXE; this DLL only hooks and pipes.
`psapi`/`EnumProcesses` again appear as strings (dynamic load), not in the IAT.

### Standout strings

- **Named pipes:** `\\.\pipe\SamplePipe%i`, and the channel files
  `C:\pipechat%d.txt`, `C:\pipeteam%d.txt`, `C:\pipeonline%d.txt`
  (chat / team / online channels), plus `C:\pipe11.dat` (v10x only).
- **Hook diagnostics:** `Sending pipe:`, `Sending pipe:calced`, `pipe
  connected`, `pipefailed`, ` window handle %i` (v10x), `pipe:%s wnd:%d`
  (v860), `Tibia.exe` (v860).

---

## server.exe — team server (shared, 2011)

Local Team Server for combo-leader coordination. Password-gated Winsock hub,
no CRT frills. Documented behaviorally elsewhere; PE facts here.

### Sections (no `.idata`/`.rsrc`/`.reloc` — merged/absent)

| Name | VA | VSize | RSize |
|---|---|---|---|
| `.text` | 0x401000 | 0x1518e | 0x16000 |
| `.rdata` | 0x417000 | 0x2de2 | 0x3000 |
| `.data` | 0x41a000 | 0x9028 | 0x3000 |

### Imports (447 functions)

| DLL | Count | Notable |
|---|---|---|
| KERNEL32 | 60 | `CreateThread`, `CreateFileA`, locale/CRT startup APIs |
| WSOCK32 | 19 | `WSAStartup`, `socket`, `bind`, `listen`, `accept`, `select`, `send`, `recv`, `shutdown`, `getsockopt`, `__WSAFDIsSet`, `inet_ntoa`, `ntohs` |

A textbook `select()`-based single-listener TCP server: `socket` → `bind` →
`listen` → `accept` → `select` loop → `send`/`recv`. No memory-injection APIs
(no `OpenProcess`/`RPM`/`WPM`) — this binary never touches the game client.
`__WSAFDIsSet` + `select` is the fd-set multiplexing over connected clients.

### Standout strings

- **Password gate:** "Enter Server Password:", "Enter Server Leader
  Password(COMBO LEADER MUST USE THIS IN MAGEBOT):", "Password failed.",
  "LEADER", "bad leader attempt".
- **Combo relay:** "combo command recved", "Connected to Team Server", "Team
  Server is running…".
- **63-client cap:** "WARNING: More than 63 client connections accepted. This
  will not work reliably on some Winsock stacks!" — the hard limit noted in the
  backbone facts, enforced by the classic 64-entry `FD_SETSIZE` in `select`.
- Full Winsock error-string table (WSAStartup codes, "Too many open sockets",
  "Socket is not connected", etc.) — standard MSVC socket wrapper.

---

## Cross-binary notes

- **The RPM/injection logic is EXE-only.** Both `magebotv55.exe` variants carry
  the huge zero-filled `.data` (92 MB v10x / 156 MB v860); part of it is the
  local client-state cache the EXE refills by throttled batch `ReadProcessMemory`
  (creatures/containers ~50 ms, map ~5 ms — `ReadClientState` `0x004024a2`), the
  rest bot buffers. No binary contains a server→client packet parser; the mirror
  is RPM-polled, not wire-parsed. `packet.dll` and `server.exe` have small,
  ordinary `.data`.
- **Networking split by role.** WSOCK32 appears in the EXEs (license +
  team-client) and in `server.exe` (team hub). `packet.dll` has none — it hooks
  and pipes, it does not socket. RPM/WPM + injection (OpenProcess /
  ReadProcessMemory / WriteProcessMemory / VirtualAllocEx / CreateRemoteThread)
  lives only in the EXEs.
- **psapi is uniformly dynamic.** Every binary references
  `psapi.dll`/`EnumProcesses`/`EnumProcessModules` as strings but none import it
  statically — resolved at runtime to locate the Tibia client PID.
- **lua51 is the v10x fingerprint.** Its presence (17 imports, 63 bindings) vs.
  absence (v860, 0 bindings) is the cleanest static discriminator between the
  two lineages, matched by the `*.lua` vs `*.sav` string sets.
