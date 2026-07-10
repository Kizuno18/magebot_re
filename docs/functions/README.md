# Function catalog

Per-function reverse engineering of MageBot v5.5, organised by subsystem.
Addresses are file-absolute at imagebase `0x400000` (`magebotv55.exe`) unless
noted. Recovered function starts and the Lua binding table live in `../../recon/`.

| File | Scope |
|---|---|
| [`engine-core.md`](engine-core.md) | The backbone: `SendAction` (0x00405f1d), the `ReadClientState` RPM reader (0x004024a2) that reads client memory on demand, the named-pipe injector, boot path, tick/thread model |
| [`lua-api-catalog-reads.md`](lua-api-catalog-reads.md) | Lua read/script/draw/input primitives (script control, HUD, self/creature/world reads) |
| [`lua-api-catalog-actions.md`](lua-api-catalog-actions.md) | Lua action primitives (combat, item use/move, NPC, waypoints, ID config) + the Lua-action → Tibia-opcode map |

The 63 Lua globals and their thunk-resolved implementation addresses are the
entry points into the action/read layer; the engine backbone is what those
primitives call. See [`../03-lua-api.md`](../03-lua-api.md) for the binding table
and the `sample.lua` API contract.

## Naming

Recovered function names follow the RE as it proceeds. Where a function is only
identified by address, it is written `sub_XXXXXXXX`. Confirmed roles get a
descriptive name (`SendAction`, `ReadClientState`, …). Library/CRT functions
(`_ftol` at 0x0044b860, etc.) are labelled and skipped.
