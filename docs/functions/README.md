# Function catalog

Per-function reverse engineering of MageBot v5.5, organised by subsystem.
Addresses are file-absolute at imagebase `0x400000` (`magebotv55.exe`) unless
noted. Recovered function starts and the Lua binding table live in `../../recon/`.

| File | Scope |
|---|---|
| [`engine-core.md`](engine-core.md) | The backbone: `SendAction` (0x00405f1d), the `ReadClientState` RPM reader (0x004024a2) that reads client memory on demand, the named-pipe injector, boot path, tick/thread model |
| [`lua-api-catalog-reads.md`](lua-api-catalog-reads.md) | Lua read/script/draw/input primitives (script control, HUD, self/creature/world reads) |
| [`lua-api-catalog-actions.md`](lua-api-catalog-actions.md) | Lua action primitives (combat, item use/move, NPC, waypoints, ID config) + the Lua-action → Tibia-opcode map |
| [`catalog-bot.md`](catalog-bot.md) | The remaining **222 bot-logic functions** of the `0x401000`–`0x440000` region, each named + given a mechanism-level purpose: client-address resolvers, RPM read/write helpers, packet builders (`buildUseOnTileOrCreatureFrame83`, `buildRsaLoginPacket`, …), input drivers, and the subsystem engines (targeting/cavebot/healer/looter/walker) |
| [`catalog-server.md`](catalog-server.md) | **195 `server.exe` functions** (the Team Server / combo relay hub) — the `select()` accept loop, per-client handshake, 2-char command relay, plus the CRT/iostream static-init cluster it links. Protocol in [05-teamserver.md](../05-teamserver.md) |
| [`support-region.md`](support-region.md) | The `0x440000`–`0x465794` MSVC CRT/STL band of `magebotv55.exe` (boilerplate, not bot logic) |

The 63 Lua globals and their thunk-resolved implementation addresses are the
entry points into the action/read layer; the engine backbone is what those
primitives call. See [`../03-lua-api.md`](../03-lua-api.md) for the binding table
and the `sample.lua` API contract. Beyond the Lua boundary, the bot's actual
engines (the tick subsystems the poller threads and Lua callbacks drive) are
catalogued in [`catalog-bot.md`](catalog-bot.md).

## Naming

Recovered function names follow the RE as it proceeds. Where a function is only
identified by address, it is written `sub_XXXXXXXX`. Confirmed roles get a
descriptive name (`SendAction`, `ReadClientState`, …). Library/CRT functions
(`_ftol` at 0x0044b860, etc.) are labelled and skipped.
