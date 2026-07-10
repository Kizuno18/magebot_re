# Status & roadmap

Resume point for the MageBot v5.5 RE. What is done, in progress, and TODO.

## Done

- **Distribution triage** — 4 NSIS installers unpacked; two engine lineages
  identified (v860 non-Lua / v10x Lua). Core binaries staged in `samples/`
  (`v860/`, `v10x/`, `shared/`). All clean MSVC PE32, no packer.
  ([README](../README.md), [02](02-static-analysis.md))
- **Offline recon tooling** — `tools/recon.py` (PE structure, imports/exports,
  strings, thunk-resolved Lua bindings, capstone function inventory),
  `tools/lua_bindings.py`, `tools/disasm.py` (thunk-following annotated
  disassembler). Artifacts under `recon/` (regenerable).
- **Lua scripting API** — all **63 registered globals** recovered and mapped to
  thunk-resolved implementation addresses; `sample.lua` contract documented.
  ([03](03-lua-api.md))
- **Engine backbone identified (Hex-Rays confirmed)** — the v10x bot is an
  **external RPM / named-pipe** automation client. `ReadClientState` 0x004024a2 is
  a band dispatcher over an **RPM-polling mirror**: throttled batch
  `ReadProcessMemory` refills local caches (creatures `unk_4C1D3D8` / containers
  `byte_4C1AB74` ~50 ms, map `byte_4B29044` ~5 ms), while self scalars are read
  live per call (XOR-deobfuscated, HP% ÷100); no server→client packet parser
  exists. `SendAction` 0x00405f1d builds a client→server Tibia frame (attack
  opcode `0xA1`, enable flag `[0x469098]`) and the injector 0x0040320a `fwrite`s
  it into `\\.\pipe\SamplePipe%i`, read by a shim inside the injected
  `packet.dll`. `_ftol` 0x0044b860.
  ([functions/engine-core.md](functions/engine-core.md))
- **Deep-doc pass (workflow-authored)** — architecture ([01](01-overview.md)),
  static analysis ([02](02-static-analysis.md)), Lua API catalog
  ([functions/](functions/)), packet.dll ([04](04-packet-dll.md)), teamserver
  ([05](05-teamserver.md)), v860 lineage ([06](06-v860-lineage.md)).
- **IDA db populated (v10x)** — `magebotv55_v10x.exe.i64` on the RE VM: 78
  functions named (`MB_` prefix — the 63 Lua impls, `MB_SendAction`,
  `MB_ReadClientState`, `MB_InjectFrame`, `MB_WinMain`, `MB_SendWalk`, the 5
  `WinMain` threads) + 12 client-mirror globals + backbone plate comments.
- **Worker threads + walk subsystem (Hex-Rays)** — the 5 `WinMain` threads are
  GUI / arrow-walk+follow / numpad-walk+aim / tibia.com enemy-guild scraper /
  in-game watcher (not the heal engine). Walk opcodes confirmed `0x65`–`0x6C`
  (`MB_SendWalk` frame `[01 00 <dir>]`).

## In progress / TODO (IDA-driven deep passes)

- **SendAction lower builder** — 0x00405f1d threads the opcode to a builder
  (`0x401415` / callees); enumerate the per-opcode packet layout for every action
  (attack, move, use, throw, npc, say) to a complete opcode→wire-format table.
- **Client struct layout** — extend the recovered client-side offset tables
  (self scalar block `0x4db3728`–`0x4db37b8`, creature array base `[0x468f38]`
  stride `0xE0`, container header `0x468f2c`) into a full map of `client.exe`
  fields the bot reads; label the currently-unnamed slots.
- **packet.dll runtime wiring** — the on-disk `fnPacket` is a `return 1` stub; the
  exe injects the DLL via `VirtualAllocEx`+`WriteProcessMemory`+
  `CreateRemoteThread(LoadLibraryA)` at 0x438222; confirm the exact `ws2_32!send`
  patch site the shim installs (inferred, not yet disassembled).
- **server.exe protocol** — byte-level Team Server handshake + combo/position
  message format (447 funcs; WSOCK32).
- **Heal/cavebot/target/loot engine** — not in the 5 threads; likely the
  `DialogFunc` (`0x4013b6`) `WM_TIMER` path (`USER32!SetTimer`) + the Lua tick.
  Trace `DialogFunc` and document the engine loop.
- **v860 chat-command dispatcher** — decompile the `.attack`/`.follow`/… parser
  and the healer/targeting/cavebot/looter engines; `.sav`/`.savd` + `*.bin`
  tile-map binary formats. Upload `magebotv55_v860.exe` is already on the VM.
- **Port IDA names to `.i64` for v860 / packet.dll / server.exe** — same `MB_`
  convention; then a scripted pass to name the remaining ~1300 v10x functions.

## Conventions

Addresses file-absolute at imagebase `0x400000` (EXEs) / `0x10000000`
(`packet.dll`). Recon artifacts in `recon/` are regenerable via `tools/`.
IDA/Ghidra databases are not committed.
