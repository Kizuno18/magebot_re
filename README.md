# magebot_re — MageBot v5.5 reverse engineering

Private research repo. Full static reverse engineering and function-by-function
documentation of **MageBot** (aka *TibiaMB*), a memory-injection bot for the
Tibia game client and OTServ private servers. Every binary in the distribution
is triaged with `pefile`/`capstone` and documented here; deep passes are driven
with IDA Pro + Hex-Rays / Ghidra over the RE-lab MCP gateway.

Everything is RE of binaries the operator legally possesses, on the operator's
own lab. No live game servers are touched; this is static analysis plus
offline function recovery.

## The distribution

MageBot ships as NSIS installers. Four were analysed
(`/home/kizudev/Downloads/MagebotSetup*.exe`). They split into two engine
lineages of the same product (MageBot **v5.5**):

| Lineage | Installers | Target | Scripting | Main build |
|---|---|---|---|---|
| **v860** | `MagebotSetupv860_new` | Tibia 8.60 / old OTServ | none — hardcoded features + chat commands + `.sav` cavebot | `magebotv55.exe` 2022-02-15 |
| **v10x** | `MagebotSetupv1098_new`, `MagebotSetupvT10o`, `MagebotSetupGunzOTOnly` | Tibia 10.x / GunzOT | **Lua 5.1** (63 registered globals) + chat commands | `magebotv55.exe` 2017-09-03 |

Core binaries (all clean MSVC PE32, no packer):

| File | Size | Imagebase | What it is |
|---|---|---|---|
| `magebotv55.exe` | ~600–670 KB | `0x400000` | **the bot** — reads/writes the Tibia client's memory, GUI, engine, scripting |
| `magebotv55_SAFEMODE.exe` | ~600–670 KB | `0x400000` | "safe mode" variant (in v10x it is byte-identical to the main exe) |
| `packet.dll` | ~64–70 KB | `0x10000000` | packet primitive, exports `fnPacket` / `nPacket` |
| `server.exe` | 117 KB | `0x400000` | **Team Server** — local combo/position coordination server (identical across all installers) |
| `lua51.dll` / `lua5.1.dll` | 195 / 80 KB | — | LuaJIT / Lua 5.1 runtime (v10x only) |
| `msvcr100.dll` | 402 KB | — | VS2010 CRT (off-the-shelf, out of scope) |

Data / script assets: `*.lua` (utils/library + sample cavebot/targeting
scripts), `*.sav`/`*.savd` (v860 binary cavebot recordings), `*.bin` tile maps
(`blktiles`, `mtiles`, `stoptiles`, `conttiles`), `*SETTINGS.txt`,
`itenids.txt`, `targeting.txt`, `customhotkeys.txt`.

## Docs

| Doc | What |
|---|---|
| [`docs/00-status.md`](docs/00-status.md) | Resume point — done / in progress / TODO |
| [`docs/01-overview.md`](docs/01-overview.md) | Architecture, the two lineages, memory-injection & teamserver model |
| [`docs/02-static-analysis.md`](docs/02-static-analysis.md) | PE structure, sections, imports/exports, strings per binary |
| [`docs/03-lua-api.md`](docs/03-lua-api.md) | The 63 registered Lua globals mapped to impl addresses + `sample.lua` contract |
| [`docs/04-packet-dll.md`](docs/04-packet-dll.md) | `packet.dll` — `fnPacket` / `nPacket` injection primitive |
| [`docs/05-teamserver.md`](docs/05-teamserver.md) | `server.exe` + `tibiadb.com` teamserver: licensing, combo/follow coordination |
| [`docs/06-v860-lineage.md`](docs/06-v860-lineage.md) | The non-Lua chat-command bot: healer, targeting, cavebot recorder, looter |
| [`docs/07-master-loop-and-threads.md`](docs/07-master-loop-and-threads.md) | Boot, the `WinMain` engine-tick driver, the 5 worker threads |
| [`docs/08-address-resolution-and-mirror.md`](docs/08-address-resolution-and-mirror.md) | The client-address resolver bank + the RPM-polling read cache (the read half) |
| [`docs/09-packet-build-inject-pipeline.md`](docs/09-packet-build-inject-pipeline.md) | Every packet builder → `SendAction` → `InjectFrame` → XTEA pipe → `packet.dll` |
| [`docs/10-targeting-and-attack.md`](docs/10-targeting-and-attack.md) | Target selection scoring, attack/combo, rune casting, creature scan |
| [`docs/11-cavebot-navigation.md`](docs/11-cavebot-navigation.md) | Waypoint navigator, `.sav` recorder ring, flood-fill cost-grid pathing |
| [`docs/12-healer-looter-hotkeys.md`](docs/12-healer-looter-hotkeys.md) | Healer/reloader, auto-food, potion/rune hotkeys, loot pile/scan |
| [`docs/13-chat-commands-and-lua.md`](docs/13-chat-commands-and-lua.md) | Chat-command dispatcher + Lua state, script slots, timer-callback tick |
| [`docs/14-login-crypto-licensing.md`](docs/14-login-crypto-licensing.md) | RSA login packet, bignum modexp, machine-id, `tibiadb.com` licensing, client patches |
| [`docs/15-version-comparison.md`](docs/15-version-comparison.md) | Gunz / T10o / v1098 / v860 — same product, per-client offsets + recompile churn; only v860 is a distinct lineage |
| [`docs/16-memory-map.md`](docs/16-memory-map.md) | Consolidated global map: client base pointers, the resolver→slot table, RPM caches, control globals |
| [`docs/17-runtime-testing.md`](docs/17-runtime-testing.md) | Live runtime pass: RSA+hosts patch, local TFS 0.4 server that gets the Cip 8.60 client **in-game**, full one-shot LoadLibrary injection capture, and the `0x10004C0B` ASLR-mismatch fault |
| [`docs/functions/`](docs/functions/) | Per-function catalog: [catalog-bot.md](docs/functions/catalog-bot.md) (222 bot funcs), Lua catalogs, [engine-core.md](docs/functions/engine-core.md), [support-region.md](docs/functions/support-region.md) (CRT/STL) |

## Method

- Offline triage: `tools/recon.py` (PE structure, imports/exports, strings,
  thunk-resolved Lua binding table, capstone function inventory),
  `tools/lua_bindings.py` (binding-table extractor). No IDA needed for the map.
- Deep passes: IDA Pro (idalib) + Hex-Rays / Ghidra over the RE-lab MCP gateway
  (`.mcp.json` → `re03-mcp.kizubot.com`). Binaries delivered to the analysis VM
  out-of-band, never through context.
- Findings written here as prose + tables. Addresses are file-absolute at the
  stated imagebase (`0x400000` for the EXEs, `0x10000000` for `packet.dll`).

## Conventions

LF endings, UTF-8, English. Binaries live in `samples/` (`v860/`, `v10x/`,
`shared/`). Recon artifacts in `recon/` (regenerable). IDA databases are not
committed. Addresses are `0xVA` at the stated imagebase.
