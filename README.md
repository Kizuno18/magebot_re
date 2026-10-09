# MageBot Reverse Engineering

**Architecture, function catalogs, and runtime evidence for MageBot v5.5.**

[Start here](docs/01-overview.md) · [Documentation](#documentation) · [Function catalogs](docs/functions/README.md) · [Runtime evidence](docs/18-runtime-packet-verification.md)

`magebot_re` is a reverse-engineering reference for **MageBot**, also known as
*TibiaMB*, covering its Tibia 8.60 and Lua-enabled 10.x engine lineages. It connects
binary analysis to the behavior of the memory reader, packet shim, scripting
layer, gameplay subsystems, and Team Server.

The repository contains research documentation, recovered function maps, and
analysis tooling—not the original MageBot source code or a maintained bot release.

## Research highlights

- **Two engine lineages, kept separate.** The non-Lua v860 build and the Lua-enabled
  v10x builds share a product name, but differ in scripting, client offsets, and
  behavior. The [version comparison](docs/15-version-comparison.md) explains the split.
- **From API to implementation.** All **63 registered Lua globals** are mapped to
  implementation addresses, alongside catalogs for the bot, v860 engine, and
  coordination server. See the [Lua API](docs/03-lua-api.md) and
  [function index](docs/functions/README.md).
- **Static findings checked against runtime evidence.** The v860 reports document
  in-game memory reads, clean injection, and captured outgoing packets whose XTEA
  framing and Adler-32 checksums were independently verified in a local test setup.
  See [runtime testing](docs/17-runtime-testing.md) and
  [packet verification](docs/18-runtime-packet-verification.md).

## Architecture at a glance

MageBot is primarily an **external process**. It reads client memory into local
state caches and sends constructed actions through a named pipe to an injected
`packet.dll` inside the Tibia process.

```text
Tibia client memory
        |
        | ReadProcessMemory
        v
magebotv55.exe
  state caches -> feature engines / Lua -> action builders
                                                |
                                           named pipe
                                                v
                                packet.dll inside Tibia
                                  XTEA + Adler-32
                                                |
                                                v
                                      client network socket

server.exe: separate Team Server for combo / position coordination
```

The read side is a **memory-polling mirror**, not a server-to-client packet parser.
On the write side, the DLL's worker thread handles the pipe-to-socket path; its
`fnPacket` export is not the main implementation. The
[engine core](docs/functions/engine-core.md),
[memory mirror](docs/08-address-resolution-and-mirror.md), and
[packet DLL](docs/04-packet-dll.md) document these distinctions.

## Analyzed distribution

Four NSIS installers were examined and grouped into two engine lineages:

| Lineage | Installer variants | Client family | Scripting |
| --- | --- | --- | --- |
| **v860** | `MagebotSetupv860_new` | Tibia 8.60 / compatible OTServ clients | Hardcoded features, chat commands, `.sav` cavebot recordings; no Lua |
| **v10x** | `MagebotSetupv1098_new`, `MagebotSetupvT10o`, `MagebotSetupGunzOTOnly` | Tibia 10.x / GunzOT variants | Lua 5.1 API with 63 registered globals, plus chat commands |

| Component | Role |
| --- | --- |
| `magebotv55.exe` | External bot process: memory access, interface, feature engines, and scripting |
| `magebotv55_SAFEMODE.exe` | Build-dependent variant; the filename and runtime safe-mode toggle are distinguished in [doc 15](docs/15-version-comparison.md) |
| `packet.dll` | Client-specific injected shim for the named-pipe action path |
| `server.exe` | Team Server for coordinated actions and position sharing |
| `lua51.dll` / `lua5.1.dll` | LuaJIT / Lua runtime components in the v10x distribution |
| `msvcr100.dll` | Third-party Visual C++ runtime, outside the bot-logic scope |

Associated assets include Lua scripts, `.sav` / `.savd` cavebot recordings,
`.bin` tile maps, and settings, targeting, item, and hotkey data. Binary variants
are not interchangeable: the runtime investigation traced an injection crash to
a `packet.dll` built for the wrong client version.

## Documentation

### Choose a reading path

| Goal | Start with |
| --- | --- |
| Understand the system | [Overview](docs/01-overview.md) → [Engine loop](docs/07-master-loop-and-threads.md) → [Memory mirror](docs/08-address-resolution-and-mirror.md) |
| Follow an action to the network | [Packet pipeline](docs/09-packet-build-inject-pipeline.md) → [Packet DLL](docs/04-packet-dll.md) → [Runtime verification](docs/18-runtime-packet-verification.md) |
| Explore scripting and feature engines | [Lua API](docs/03-lua-api.md) → [Commands and Lua runtime](docs/13-chat-commands-and-lua.md) → [Function catalogs](docs/functions/README.md) |
| Compare builds and assess coverage | [Version comparison](docs/15-version-comparison.md) → [v860 lineage](docs/06-v860-lineage.md) → [Status and follow-ups](docs/00-status.md) |

<details>
<summary><strong>Complete documentation index — 19 chapters</strong></summary>

| Chapter | Subject |
| --- | --- |
| [00 — Status](docs/00-status.md) | Coverage, recorded milestones, and follow-up work |
| [01 — Overview](docs/01-overview.md) | Architecture, engine lineages, and coordination model |
| [02 — Static analysis](docs/02-static-analysis.md) | PE structure, imports, exports, and strings |
| [03 — Lua API](docs/03-lua-api.md) | The 63 registered globals and their implementation addresses |
| [04 — Packet DLL](docs/04-packet-dll.md) | Injected shim, worker thread, and socket-send mechanism |
| [05 — Team Server](docs/05-teamserver.md) | Licensing context and combo / follow coordination protocol |
| [06 — v860 lineage](docs/06-v860-lineage.md) | Non-Lua commands, healer, targeting, cavebot, and looter |
| [07 — Master loop and threads](docs/07-master-loop-and-threads.md) | Startup, timer-driven engine dispatch, and worker roles |
| [08 — Address resolution and mirror](docs/08-address-resolution-and-mirror.md) | Client-address resolvers and memory-polling caches |
| [09 — Packet pipeline](docs/09-packet-build-inject-pipeline.md) | Action builders, named-pipe transport, and injection |
| [10 — Targeting and attack](docs/10-targeting-and-attack.md) | Target selection, scoring, combos, and casting |
| [11 — Cavebot navigation](docs/11-cavebot-navigation.md) | Waypoints, recording, and pathfinding |
| [12 — Healer, looter, and hotkeys](docs/12-healer-looter-hotkeys.md) | Healing, reloaders, item use, and loot handling |
| [13 — Chat commands and Lua](docs/13-chat-commands-and-lua.md) | Command dispatch, script slots, and timer callbacks |
| [14 — Login, crypto, and licensing](docs/14-login-crypto-licensing.md) | RSA login, machine identity, and licensing behavior |
| [15 — Version comparison](docs/15-version-comparison.md) | Build differences, client offsets, and safe-mode behavior |
| [16 — Memory map](docs/16-memory-map.md) | Base pointers, resolver slots, caches, and control globals |
| [17 — Runtime testing](docs/17-runtime-testing.md) | Local in-game setup, injection validation, and crash diagnosis |
| [18 — Runtime packet verification](docs/18-runtime-packet-verification.md) | Captured opcodes and end-to-end framing verification |

</details>

### Function-level reference

The [catalog index](docs/functions/README.md) connects the subsystem documentation
to address-level analysis. Dedicated catalogs cover the
[v10x bot region](docs/functions/catalog-bot.md),
[v860 engine](docs/functions/catalog-v860.md),
[Team Server](docs/functions/catalog-server.md),
[Lua read primitives](docs/functions/lua-api-catalog-reads.md),
[Lua action primitives](docs/functions/lua-api-catalog-actions.md), and
[CRT / STL support region](docs/functions/support-region.md).

## Repository layout

```text
docs/               Numbered architecture, subsystem, and runtime reports
  functions/        Function catalogs and recovered implementation maps
recon/              Generated PE, string, function, and Lua-binding artifacts
samples/            Sample and asset layout, split into v860/, v10x/, shared/
tools/              Local reconnaissance and documentation helpers
```

No setup is needed to read the documentation. The analysis helpers serve different
parts of the research workflow:

| Tool | Purpose |
| --- | --- |
| [`tools/recon.py`](tools/recon.py) | PE triage, imports / exports, strings, and function inventory |
| [`tools/lua_bindings.py`](tools/lua_bindings.py) | Lua binding-table extraction |
| [`tools/disasm.py`](tools/disasm.py) | Annotated disassembly and thunk following |

Local triage uses `pefile` and `capstone`; deeper passes used IDA Pro / Hex-Rays
and Ghidra. Analysis databases and a live analysis environment are not required
to browse the committed findings.

## Evidence and limitations

The runtime evidence concerns the **tested v860 client / bot combination** on a
controlled local TFS 0.4 setup. It does not establish runtime parity across every
10.x installer or client version. Per-build offsets and some dynamically built
item-use fields remain follow-up topics in the linked reports.

The documentation records an evolving investigation: later subsystem and runtime
reports resolve some hypotheses preserved in earlier notes. Recovered function
names describe the analysis; they are not original vendor symbols.

Addresses are hexadecimal **virtual addresses at the stated image base**, not raw
file offsets: typically `0x00400000` for the executables and `0x10000000` for
`packet.dll`. Always identify the build before comparing addresses or behavior.

## Contributing research

Corrections are most useful when they include the exact binary / build, address,
and supporting disassembly, decompilation, or controlled runtime observation.
Distinguish confirmed behavior from inference, keep the two lineages separate,
and update the relevant chapter or catalog rather than only the summary.

Documentation and commit messages use English, UTF-8, LF endings, and a final
newline. Do not include credentials, personal lab endpoints, or unrelated
private data in research contributions.
