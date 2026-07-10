# Lua scripting API (v10x lineage)

The v10x `magebotv55.exe` links `lua51.dll` and registers **63 global
functions** into the Lua state at startup. This is the bot's public scripting
surface — the same 63 names documented informally in `samples/v10x/lua/sample.lua`.
Each is registered with the classic Lua 5.1 pattern:

```c
lua_pushcclosure(L, cfunc, 0);
lua_setfield(L, LUA_GLOBALSINDEX, "Name");
```

The 63 registrations are emitted back-to-back in a single init routine starting
at `0x00436a2a` (the `lua_pushcclosure`/`lua_setfield` call pairs). Each `cfunc`
is an incremental-link `jmp` thunk in the `0x401000`–`0x401550` band; the tables
below give the **resolved implementation address** (thunk target), which is the
function to decompile. Extractor: `tools/lua_bindings.py` / `tools/recon.py`
→ `recon/v10x_magebot.bindings.json`.

Lua runtime requirement: `utils.lua` aborts unless `jit` is present — the
shipped `lua51.dll` is **LuaJIT**, `lua5.1.dll` is stock Lua 5.1. The bot loads
`lua51.dll` (18 imported symbols, all plain Lua 5.1 C-API — no LuaJIT-specific
imports, so the exe treats it as a drop-in 5.1).

## Binding table (name → implementation VA)

### Script / engine control

| Lua global | impl VA |
|---|---|
| `SetTimerCallback` | 0x004375f6 |
| `GetScriptPause` | 0x004339a9 |
| `ResumeScripts` | 0x004339cb |
| `ReloadLua` | 0x004348c8 |
| `LoadFile` | 0x00434797 |
| `SaveFile` | 0x00434707 |
| `GetScriptInfo` | 0x00433d1f |
| `GetScriptNumber` | 0x004348fe |
| `EnableScript` | 0x00433bc7 |
| `DisableScript` | 0x00433c47 |
| `ListScripts` | 0x00433dff |
| `SetGuiParams` | 0x00434653 |
| `GetClock` | 0x004348d4 |
| `Sleep` | 0x004358f2 |

### Drawing / HUD / input

| Lua global | impl VA |
|---|---|
| `DrawText` | 0x00437688 |
| `printtext` | 0x0043776a |
| `PrintError` | 0x0043487a |
| `GetCursorX` | 0x004345c0 |
| `GetCursorY` | 0x00434608 |
| `IsKeyDown` | 0x00433b5c |
| `PlaySound` | 0x00433aa2 |
| `SetClipboard` | 0x004361b7 |

### Self / creatures / world reads

| Lua global | impl VA |
|---|---|
| `GetPlayerInfo` | 0x00435046 |
| `GetCreatureInfo` | 0x004355f6 |
| `GetCreatureInt` | 0x00436240 |
| `GetTargetInfo` | 0x0043663a |
| `GetFollowInfo` | 0x0043680e |
| `GetGroundInfo` | 0x00435487 |
| `GetContainerItems` | 0x00434920 |
| `GetMaxContainers` | 0x00434ab1 |

### Combat / control

| Lua global | impl VA |
|---|---|
| `AttackTarget` | 0x004357da |
| `FollowTarget` | 0x00435818 |
| `CastRuneTarget` | 0x00435856 |
| `CastHotkey` | 0x004358ad |
| `SetHuntingOn` | 0x00436141 |

### Items / containers / NPC

| Lua global | impl VA |
|---|---|
| `UseInventoryItem` | 0x00434b54 |
| `UseContainerItem` | 0x00434ae6 |
| `UseGroundItem` | 0x00434c19 |
| `UseItemOnGround` | 0x00434d55 |
| `UseSpell` | 0x00434e32 |
| `NpcSay` | 0x0043594d |
| `NpcBuy` | 0x00435990 |
| `NpcSell` | 0x004359e5 |
| `SetAutoLoot` | 0x00435a3a |
| `SetLootTimer` | 0x004361f2 |

### Item movement (throw)

| Lua global | impl VA |
|---|---|
| `ThrowItemCtoC` | 0x00435bee |
| `ThrowItemCtoI` | 0x00435a9e |
| `ThrowItemCtoG` | 0x00435cc1 |
| `ThrowItemItoC` | 0x00435b46 |
| `ThrowItemGtoC` | 0x00435d95 |
| `ThrowItemGtoG` | 0x00435e69 |

### Waypoints / cavebot

| Lua global | impl VA |
|---|---|
| `MoveTo` | 0x00433338 |
| `SetWaypointInfo` | 0x00434e89 |
| `GetCurrentWaypoint` | 0x0043617d |
| `SetStopPoint` | 0x00434f86 |
| `ClearWaypoints` | 0x00434f57 |
| `StartWaypoints` | 0x00434f9f |
| `StopWaypoints` | 0x00434fba |
| `StartAutoExplorer` | 0x00434fcb |
| `StopAutoExplorer` | 0x0043502b |

### ID configuration

| Lua global | impl VA |
|---|---|
| `SetManaPotIDS` | 0x00435f40 |
| `SetHealPotIDS` | 0x00435fdf |
| `SetRuneIDS` | 0x0043607e |

## API contract (from `sample.lua`)

The shipped `sample.lua` documents the intended calling convention for each
global. Reproduced here as the RE oracle — decompilation should match these
signatures and side effects.

**Callbacks / lifecycle**
- `SetTimerCallback(fn)` — register a Lua function called every engine tick;
  required for a script to persist. (`utils.lua` builds `Util__Callback` on top.)
- `GetScriptPause() → 0|1` — 1 while scripts are paused (Escape / F11 toggle).
- `Sleep(ms)`, `GetClock()` — timing.

**Drawing / input**
- `printtext(text)` → DOS console box; `DrawText(text,x,y,color)` → on-client
  overlay (ARGB, see `Color` table in `utils.lua`).
- `IsKeyDown(vk) → 0|n` — virtual-key state; `GetCursorX/Y()`.

**Actions (call ≤1 per callback)**
- `AttackTarget(id)`, `FollowTarget(id)`, `CastHotkey(text)`,
  `CastRuneTarget(runeid,targetid)`, `CastRuneXY(x,y,runeid)`, `MoveTo(x,y)`.
- `UseSpell(text)` — say/cast; `UseContainerItem(cont,slot,id)`,
  `UseInventoryItem(slot,id)`, `UseGroundItem(x,y,id)`, `UseItemOnGround(x,y,id)`.
- `ThrowItem{CtoC,CtoI,ItoC,CtoG,GtoC,GtoG}(...)` — 6 move primitives across
  container/inventory/ground.
- `NpcSay(text)`, `NpcBuy(id,amount)`, `NpcSell(id,amount)`.

**Reads**
- `GetCreatureData(id)` (Lua wrapper over `GetCreatureInfo`/`GetCreatureInt`) →
  `{x,y,z,hp,movespeed,name,atk,iswalking,direction,outfit,outfithead,light,
  isvisible,skull,walkingx,walkingy}`.
- `GetTarget()`/`GetFollow()` → `{name,id,x,y,z,hp,movespeed}`.
- `self` → `{name,x,y,z,id,sx,sy,hp,mp,hpmax,mpmax,condition,level,cap,exp,
  magiclevel,backpack,ring,ammy,arrow,arrowct,hand,handct,handleft,handleftct}`.
- `creatures[i]`, `conts[i].items[j]` — mirror arrays of the client's creature
  list and open containers.
- `FindItem(id)`/`FindNextItem(id)` → `{num,slot,quantity}`; `GetGround(x,y)` →
  interleaved `{id,qty,...}`.

**Waypoints / cavebot**
- `SetWaypoint(x,y,z)`, `SetHardWaypoint`, `SetWarpWaypoint` (stairs/holes),
  `SetStopPoint`, `ClearWaypoints`, `StartWaypoints`, `StopWaypoints`,
  `SetHuntingOn(0|1)`, `StartAutoExplorer(floors)`, `StopAutoExplorer()`.

**Config**
- `SetManaPotIDS(n,s,g,pally)`, `SetHealPotIDS(...)`,
  `SetRuneIDS(UH,SD,GFB,MWALL,ROPE)`, `SetLootTimer(ms)`.
- Inventory slot constants: `SLOT_HEAD=1 … SLOT_AMMO=10`.

Note the `sample.lua` names (`SetWaypoint`, `CastRuneXY`, `GetCreatureData`,
`GetTarget`, `FindItem`, `setTimerCallback` lowercase) do not all match the 63
C-registered globals 1:1 — several are **Lua-side wrappers** defined in
`utils.lua` / `script_loader.lua` over the C primitives (e.g. `GetCreatureData`
wraps `GetCreatureInfo`; `SetWaypoint` wraps `SetWaypointInfo`). The C table
above is authoritative for the native boundary.

## `scriptConfig` in-game menu system

`utils.lua` exposes a `scriptConfig(visibleName, uid)` builder with
`:addParam(...)` / `:permaShow(...)`, backed by `SetGuiParams`
(`0x00434653`) / `GetScriptInfo` (`0x00433d1f`). Param types:
`SCRIPT_PARAM_ONKEYDOWN`, `SCRIPT_PARAM_ONOFF`, `SCRIPT_PARAM_ONKEYTOGGLE`,
`SCRIPT_PARAM_INFO`, `SCRIPT_PARAM_NUMERICUPDOWN`, `SCRIPT_PARAM_DOMAINUPDOWN`.
These drive the bot's in-client script menu (the draggable "@ All Scripts"
overlay, F9 hide/show, F10 reload described in `sample.lua`).
