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
- **Bot-region function catalog** — all **222 bot-logic functions** of the
  `0x401000`–`0x440000` region named + given a mechanism-level purpose
  ([functions/catalog-bot.md](functions/catalog-bot.md)); 209 persisted into the
  IDB (`allow_overwrite:false`, only `sub_*` touched — no curated name clobbered).
  Reveals the full flow: the client-address resolver bank (`0x401axx`–`0x402xxx`
  fills the `0x4db3xxx` band), RPM read/write helpers, the packet-builder family
  (`buildUseOnTileOrCreatureFrame83`, `buildNpcBuy/SellFrame`, `buildRsaLoginPacket`,
  `sendPipeXteaFrame`), client-input drivers, and the engines: `runTargetSelectionEngine`,
  `attackComboEngineTick`, `waypointWalker`, `runWaypointNavigator`,
  `buildPathToTileFloodFill`, `healerAndReloader`, `pileLootStackableItems`,
  `chatCommandDispatcher`, `initLuaStateAndRegisterApi`, `dispatchTimerCallbacks`.
- **Subsystem flow deep-dives** — 8 docs tracing every engine end-to-end:
  master loop/threads ([07](07-master-loop-and-threads.md)), address resolution +
  mirror ([08](08-address-resolution-and-mirror.md)), packet build/inject pipeline
  ([09](09-packet-build-inject-pipeline.md)), targeting/attack
  ([10](10-targeting-and-attack.md)), cavebot/navigation
  ([11](11-cavebot-navigation.md)), healer/looter/hotkeys
  ([12](12-healer-looter-hotkeys.md)), chat commands + Lua
  ([13](13-chat-commands-and-lua.md)), login/crypto/licensing
  ([14](14-login-crypto-licensing.md)).
- **Support region classified** — the `0x440000`–`0x465794` band (~83 funcs) is
  statically-linked MSVC CRT / STL, no bot logic
  ([functions/support-region.md](functions/support-region.md)); bot code is the
  `0x401000`–`0x440000` half, now fully catalogued.
- **packet.dll internals confirmed** — the injection is `pkt_xteaEncryptAndSend`
  (0x10004726): XTEA-encrypt (key `0x1000c128`) + Adler-32 + call runtime-resolved
  `ws2_32!send` on the client socket, fed by the named-pipe server thread
  (0x10004c0b); plus a `SetWindowLong` keyboard hook (0x100052ba) that swallows
  arrow/numpad keys. Corrected the earlier "send-path patch" guess.
  ([04-packet-dll.md](04-packet-dll.md))
- **server.exe cataloged** — all 195 functions of the Team Server documented
  ([functions/catalog-server.md](functions/catalog-server.md)); complements the
  protocol write-up in [05-teamserver.md](05-teamserver.md).
- **v860 lineage cataloged** — 250 functions of the non-Lua Tibia 8.60 build
  ([functions/catalog-v860.md](functions/catalog-v860.md)): the client-address
  resolver bank (base `[0x45ff0c]` stride `0xA8`), chat-command dispatcher,
  healer/targeting/cavebot/looter engines, packet builders at the v860 offsets.
- **Runtime pass — full e2e IN-GAME, injection crash root-caused + fixed** —
  patched the Cip 8.60 client (OT RSA + `login0X.tibia.com` hosts redirect); the
  BR public servers block it at game-world login (custom-client wall), so stood up
  a **local TFS 0.4 8.60 server** on the VM (Fir3element precompiled binary +
  SQLite, account `1/1`) which **removes the wall — the client enters the game
  world** (self + map rendered). Validated four docs at runtime: **tibiadb.com
  demo-licensing** (doc 14); the **full one-shot LoadLibrary injection**
  `OpenProcess(0x1F0FFF) → GetProcAddress(LoadLibraryA) → VirtualAllocEx(46,RWX) →
  WPM("…packet.dll") → CreateRemoteThread` (doc 09); the **injection thread at
  `0x10004C0B` = `pkt_pipeServerThread`** (doc 04); and the **live RPM/WPM mirror**
  (doc 08, 2,620/2,625 reads to real client addresses in-game). The
  `0x10004C0B`/`0x991F48` client fault — long assumed to be an ASLR base mismatch —
  was **root-caused and fixed**: it was the **wrong `packet.dll` version** (the
  v10x/9.2 build, whose `DllMain` writes hard-coded 9.2 client globals `0x991F30`/
  `0xB1B4A8` that are unmapped in the smaller 8.60 client image). Deploying the
  **v860 `packet.dll`** (`samples/v860/packet.dll`, 65536 B) makes injection
  **clean**: logged the client in-game, injected magebot → client alive, zero
  `WerFault`, `\\.\pipe\SamplePipe<pid>` live, client window subclassed
  (`*Magebot*`). The chain is now **100% end-to-end in-game — stable bot session**
  ([17-runtime-testing.md](17-runtime-testing.md)).
- **Runtime packet verification — send path proven byte-for-byte** — with a real
  Knight in the local TFS world, every documented outgoing opcode was captured
  entering `packet.dll`'s XTEA/Adler/send fn (**v860 `0x10004436`**, not the
  v10x `0x4726`): attack **`0xA1`**, walk `0x65`–`0x68`, turn `0x6F`, look `0x8C`,
  talk `0x96`. The wire framing `[len][adler32][xtea]` was confirmed, and the
  crypto was verified **end-to-end**: decrypting the captured wire ciphertext with
  the captured 16-byte XTEA session key (pointer at **`0x1000C138`**) with a stock
  XTEA (delta `0x9E3779B9`, 32 rounds) recovers the exact opcode, and an
  independent Adler-32 of the ciphertext matches — for all frames. RSA login and
  the demo licensing phone-home also fire (host is **jnews.ueuo.com**, not
  tibiadb.com) ([18-runtime-packet-verification.md](18-runtime-packet-verification.md)).

## Coverage

Every distinct binary in the distribution is documented function-by-function:

| Binary | Functions | Where |
|---|---|---|
| `magebotv55.exe` v10x (bot half) | ~300 named + purpose | [catalog-bot.md](functions/catalog-bot.md), [03-lua-api.md](03-lua-api.md), [engine-core.md](functions/engine-core.md) |
| `magebotv55.exe` v10x (CRT/STL half) | ~83, classified | [support-region.md](functions/support-region.md) |
| `packet.dll` (injector) | key funcs named, mechanism confirmed | [04-packet-dll.md](04-packet-dll.md) |
| `server.exe` (Team Server) | 195 | [catalog-server.md](functions/catalog-server.md) |
| `magebotv55.exe` v860 | 250 | [catalog-v860.md](functions/catalog-v860.md) |

Plus 14 architecture/flow docs (00–14) tracing every subsystem end-to-end.

## IDB name persistence — done

All four `.i64` on the RE VM now carry their names:

| IDB | Names persisted |
|---|---|
| `magebotv55_v10x.exe.i64` | 300 (`MB_*` Lua/backbone + 209 bot catalog) |
| `packet.dll.i64` | 6 (`pkt_*` shim + globals) |
| `server.exe.i64` | `srv_*` protocol + IDA's demangled STL names preserved |
| `magebotv55_v860.exe.i64` | 198 `v860*` bot functions |

Note: `allow_overwrite:false` protects only *user*-assigned names, **not** IDA's
auto FLIRT/demangled library names — so server/v860 renames were filtered to skip
addresses IDA had already demangled (a `name_regex ^[?]` sweep) and the CRT region.

## Remaining (need live-client / per-build analysis)

- The dynamic `Cast*`/`Use*` opcode *sub-bytes* (the main use opcodes
  `0x82`/`0x83`/`0x84` are documented; the exact use-with sub-byte is built from
  RPM reads and needs a live-client trace).
- Per-build client offsets for Gunz/v1098 (same code as T10o, different constants;
  needs a per-build IDA pass — [15-version-comparison.md](15-version-comparison.md)).

The `server.exe` per-client `0x5084` struct + command dispatch is now confirmed
([05-teamserver.md](05-teamserver.md)). The client-side struct map is consolidated
in [16-memory-map.md](16-memory-map.md).

The client-side struct map is consolidated in [16-memory-map.md](16-memory-map.md)
(structural: base→offset→slot for all ~50 resolvers; semantic labels where a
`Get*` reveals the field). Remaining slot semantics need the live 10.x client.
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
