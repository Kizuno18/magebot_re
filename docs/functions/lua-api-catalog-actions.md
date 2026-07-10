# Lua API catalog — action primitives (v10x)

Covered globals (36): `AttackTarget`, `FollowTarget`, `CastRuneTarget`,
`CastHotkey`, `SetHuntingOn`, `UseInventoryItem`, `UseContainerItem`,
`UseGroundItem`, `UseItemOnGround`, `UseSpell`, `NpcSay`, `NpcBuy`, `NpcSell`,
`SetAutoLoot`, `SetLootTimer`, `ThrowItemCtoC`, `ThrowItemCtoI`, `ThrowItemCtoG`,
`ThrowItemItoC`, `ThrowItemGtoC`, `ThrowItemGtoG`, `MoveTo`, `SetWaypointInfo`,
`GetCurrentWaypoint`, `SetStopPoint`, `ClearWaypoints`, `StartWaypoints`,
`StopWaypoints`, `StartAutoExplorer`, `StopAutoExplorer`, `SetManaPotIDS`,
`SetHealPotIDS`, `SetRuneIDS`.

impl VAs from `recon/v10x_magebot.bindings.json`. Sample-level signatures from
`samples/v10x/lua/sample.lua`. All addresses are v10x `magebotv55.exe`
(imagebase 0x400000). Every Lua arg is pulled with `luaL_checknumber`
(`0x44a458`) and truncated through `_ftol` (`0x44b860`, "double->int"), or
`luaL_checklstring` (`0x44a464`) / `luaL_checkinteger` (`0x44a494`) where noted.

## Two emission paths, not one

The action primitives do **not** all funnel through the opcode `SendAction`
builder (`0x405f1d`, thunk `0x401217`). There are four distinct ways an action
reaches the game, and confusing them is the main trap in this API:

| Path | Mechanism | Used by |
|---|---|---|
| **A. opcode SendAction** `0x405f1d` | takes Tibia opcode in arg, `[0x469098]==1` gate, injects client→server packet | AttackTarget (0xA1), FollowTarget (0xA2) |
| **B. dedicated packet builders** | per-action helper fills a byte buffer with a fixed opcode, emits it | Use*/Throw*/Npc*/Spell — opcodes 0x82/0x78/0x7a/0x7b/0x96 |
| **C. window messages** | `SendMessageA` to client HWND `[0x4d22494]` (WM_KEY / WM_MOUSE / drag) | CastHotkey, CastRuneTarget, some Throw* (drag), UseItemOnGround key |
| **D. pure state writes** | write a bot-side global / dialog control, no packet | SetHuntingOn, waypoint control, Set*IDS, SetAutoLoot, SetLootTimer |

The opcode gate `[0x469098]==1` guards paths A and B (the "inject enabled" flag).
Path A actions additionally Sleep for the attack post-delay `[0x4696e0]` (the
`_ftol`'d ms value); most path-B/C actions Sleep on `[0x4696e0]` too, a few use a
hardcoded delay.

## Lua action -> Tibia opcode

| Lua fn | impl VA | Emits | Opcode | Post-delay |
|---|---|---|---|---|
| AttackTarget | 0x004357da | SendAction `0x405f1d` | **0xA1** (ATTACK) | Sleep `[0x4696e0]` |
| FollowTarget | 0x00435818 | SendAction `0x405f1d` | **0xA2** (FOLLOW) | Sleep `[0x4696e0]` |
| CastRuneTarget | 0x00435856 | container-scan + use helper `0x407254` | WM_KEY (path C) | Sleep `[0x4696e0]` |
| CastHotkey | 0x004358ad | WM_KEYDOWN/UP `0x407254` | 0x100/0x101 | — |
| UseInventoryItem | 0x00434b54 | use builder `0x406f88` | **0x82** (USE) | Sleep `[0x4696e0]` |
| UseContainerItem | 0x00434ae6 | use builder `0x406ff9` | **0x82** (USE) | Sleep `[0x4696e0]` |
| UseGroundItem | 0x00434c19 | use builder `0x406f88` (rel-coord) | **0x82** (USE) | — |
| UseItemOnGround | 0x00434d55 | use-with builder (rel-coord) | 0x82-family | — |
| UseSpell | 0x00434e32 | say builder `0x404b0d` | **0x96** (TALK) | Sleep `[0x4696e0]` |
| NpcSay | 0x0043594d | say builder `0x404eee` | **0x96** (TALK) | Sleep 0x46 (70ms fixed) |
| NpcBuy | 0x00435990 | trade builder `0x404fde` | **0x7A** (BUY) | Sleep `[0x4696e0]` |
| NpcSell | 0x004359e5 | trade builder `0x405039` | **0x7B** (SELL) | Sleep `[0x4696e0]` |
| ThrowItemCtoC | 0x00435bee | drag sim `0x4061d1` | mouse (GetWindowRect) | Sleep `[0x4696e0]` |
| ThrowItemCtoI | 0x00435a9e | move packet `0x40656b` | **0x78** (MOVE) | Sleep `[0x4696e0]` |
| ThrowItemItoC | 0x00435b46 | move packet `0x40656b` | **0x78** (MOVE) | Sleep `[0x4696e0]` |
| ThrowItemCtoG | 0x00435cc1 | drag sim `0x406600` | mouse (GetWindowRect) | Sleep `[0x4696e0]` |
| ThrowItemGtoC | 0x00435d95 | move packet `0x4069b8` | **0x78** (MOVE) | Sleep `[0x4696e0]` |
| ThrowItemGtoG | 0x00435e69 | move packet `0x406a70` | **0x78** (MOVE) | Sleep `[0x4696e0]` |
| MoveTo | 0x00433338 | pathfind step `0x40108c` | walk step (0x65–0x68) | — |

Set*IDS, SetHuntingOn, SetAutoLoot, SetLootTimer, and all waypoint control
functions emit no opcode — see the state-write sections below.

## Combat / control

### AttackTarget(targetid) — 0x004357da
Pulls arg1 → `_ftol` → creature id. `push 0xA1; push id; call 0x401217`
(SendAction `0x405f1d`), then `Sleep([0x4696e0])`. 0xA1 is the Tibia ATTACK
opcode and is special-cased inside SendAction itself
(`cmp [ebp+0xc], 0xa1` at `0x405f2c`/`0x405f3f`).

### FollowTarget(targetid) — 0x00435818
Byte-for-byte AttackTarget with opcode **0xA2** (FOLLOW). Same
`Sleep([0x4696e0])` tail.

### CastRuneTarget(runeid, targetid) — 0x00435856
Two args (rune id, target id). Does **not** SendAction an opcode. Calls builder
`0x4053a4` (thunk `0x401339`) which, gated by `[0x469098]==1`, scans the mirror's
open containers (via `ReadClientState 0x4011b8`, container base `[0x4db3738]`,
stride 0x30) to locate the rune's `{container,slot}`, then invokes use-on-target
helper `0x407254` — the same **WM_KEYDOWN/WM_KEYUP** path CastHotkey uses. It
does not build a 0x82 packet inline; it drives the client's own use-item-on-
creature action. `Sleep([0x4696e0])`.

### CastHotkey(text) — 0x004358ad
Pulls a string (`luaL_checklstring`). `sprintf`s it into scratch buffer
`0x472c9c`, sets `[0x4695a0]=0x2e` (a mode/flag byte), then calls `0x42dd58`
(thunk `0x401140`) which resolves and drives the hotkey. The underlying emitter
`0x407254` posts **WM_KEYDOWN (0x100)** then **WM_KEYUP (0x101)** via
`SendMessageA` to the client window handle `[0x4d22494]`, followed by a
hardcoded `Sleep(0xa)`. This is a real client-side keypress, not a packet.

### SetHuntingOn(n) — 0x00436141
Pure state. `[0x4db3838] = (n==1) ? 1 : 0`. This is the "player attacks while
running waypoints" flag; note `StopAutoExplorer` also clears it.

## Items / containers / NPC

### UseInventoryItem(inv_slot, id) — 0x00434b54
Args (slot, id) → use builder `0x406f88` (thunk `0x401073`). That builder writes
a fixed **USE (0x82)** packet:

```
[len=0x0a][00][0x82][ff ff][slot][00][subslot][id.lo][id.hi]...
```

The `ff ff` position marks "from inventory". `Sleep([0x4696e0])`.

### UseContainerItem(cont_number, item_slot, id) — 0x00434ae6
Three args → builder `0x406ff9` (thunk `0x40112c`), gated by `[0x469098]==1`.
Remaps the container index (`0x4014fb`), computes a byte offset with a **0x23**
stride, and fills the same **0x82** USE packet (opcode at `0x407139`) with the
container/slot position. `Sleep([0x4696e0])`.

### UseGroundItem(x,y,id) — 0x00434c19
Args (x,y,id). Converts absolute map coords to client-relative by subtracting
player position — X `[0x4db372c]`, Y `[0x4db3728]`, Z `[0x468f30]` — read via
`ReadClientState 0x4011b8`, offset through `0x41d9e6` (thunk `0x40143d`). Emits
the **0x82** USE packet at the resolved tile. No trailing Sleep.

### UseItemOnGround(x,y,id) — 0x00434d55
"Use item (rope/shovel/rune) from a bp onto the ground." Same rel-coord
conversion against `[0x4db372c]`/`[0x4db3728]`/`[0x468f30]`; builds the
**use-with** variant of the 0x82 family targeting the resolved tile. No trailing
Sleep.

### UseSpell(text) — 0x00434e32
Pulls a string, copies to a 0x200 stack buffer, calls say builder `0x404b0d`
(thunk `0x401398`), gated by `[0x469098]==1`. That builder writes a **TALK
(0x96)** packet (opcode byte at `0x404c9c`) carrying the spell/message text; it
also walks open-container / channel state (`[0x4db373c]` band) to pick the talk
mode. `Sleep([0x4696e0])`.

### NpcSay(text) — 0x0043594d
Pulls a string → scratch `0x472c9c` → say builder `0x404eee` (thunk `0x40149c`),
**TALK (0x96)** (opcode byte at `0x404f4c`). Unlike UseSpell it uses a hardcoded
`Sleep(0x46)` (70 ms), not `[0x4696e0]`.

### NpcBuy(id, amount) — 0x00435990
Args (id, amount) → trade builder `0x404fde` (thunk `0x4013de`), opcode **0x7A**
(NPC BUY, byte at `0x404fec`). `Sleep([0x4696e0])`.

### NpcSell(id, amount) — 0x004359e5
Args (id, amount) → trade builder `0x405039` (thunk `0x401104`), opcode **0x7B**
(NPC SELL, byte at `0x405047`). `Sleep([0x4696e0])`.

### SetAutoLoot(n) — 0x00435a3a
Pure state / UI. `n==1` → sets flag `[0x4db3bbc]=1` then `CheckDlgButton` (checks
the auto-loot box); else `[0x4db3bbc]=0` and unchecks. The dialog handle is
`[0x4db3d24]`. No opcode.

### SetLootTimer(time_in_ms) — 0x004361f2
Pulls ms. Formats it (`0x45d56a`) into scratch `0x472c9c`, pushes it into dialog
control **0x446** via `SetDlgItemTextA` on `[0x4db3d24]`, and stores the value to
global **`[0x468f90]`**. No opcode.

## Item movement (Throw*)

Six primitives, two strategies. Container↔container and container↔ground stay
inside the client GUI and are done by **mouse-drag simulation** (compute screen
coords from slot indices, `GetWindowRect` + mouse `SendMessageA`). Anything
touching the inventory or pure ground-to-ground is done with a real **MOVE
(0x78)** packet.

| Lua fn | impl VA | builder (thunk→impl) | Strategy |
|---|---|---|---|
| ThrowItemCtoC | 0x00435bee | `0x40123f`→`0x4061d1` | mouse-drag |
| ThrowItemCtoI | 0x00435a9e | `0x4013e3`→`0x40656b` | 0x78 packet |
| ThrowItemItoC | 0x00435b46 | `0x4013e3`→`0x40656b` | 0x78 packet |
| ThrowItemCtoG | 0x00435cc1 | `0x4012da`→`0x406600` | mouse-drag |
| ThrowItemGtoC | 0x00435d95 | `0x40105a`→`0x4069b8` | 0x78 packet |
| ThrowItemGtoG | 0x00435e69 | `0x4010d7`→`0x406a70` | 0x78 packet |

All six pull their full arg list through `luaL_checknumber`/`_ftol`, read the
player Z `[0x468f30]` for the source/dest floor, add **0x40** to container-index
args (the Tibia container-position flag, `cont | 0x40`), and `Sleep([0x4696e0])`.

Packet builders (e.g. `0x40656b`) write:

```
[len=0x0f][00][0x78][ff ff or from-pos][...][to-pos][id][count]
```

with `ff ff` marking inventory. Drag builders (e.g. `0x4061d1`) instead
`GetWindowRect` the client, translate `{container,slot}` to a screen pixel
(0x26-byte per-slot stride, +0x64 y-offset, gated by `[0x469098]==1`), and post
mouse messages to `[0x4d22494]`.

Signatures (from sample.lua):
```
ThrowItemCtoC(cont, slot, cont2, slot2, id, amount)
ThrowItemCtoI(cont, slot, inv_slot, id, amount)
ThrowItemItoC(inv_slot, cont2, slot2, id, amount)
ThrowItemCtoG(cont, slot, x, y, id, amount)
ThrowItemGtoC(x, y, cont2, slot2, id, amount)
ThrowItemGtoG(x, y, x2, y2, id, amount)
```

## Waypoints / cavebot

The waypoint table is a fixed array at **`0x61d5e8`**, 16-byte records
`{x@+0, y@+4, z@+8, type@+0xc}`, indexed by count global **`[0x4db3e44]`**
(<<4 = ×16). Capacity 1000 (`0x3e8`), wraps to 0. The run flag is
**`[0x4db38e4]`**.

### MoveTo(x,y[,z]) — 0x00433338
Three args (z optional). Reads player X `[0x4db372c]` and Y `[0x4db3728]` via
`ReadClientState`, then calls step/pathfinder `0x40108c` (thunk `0x40132f`
family) with `{playerXY, targetXY}`. On success it walks one step toward the
target; the emitted opcode is a Tibia directional walk (0x65 north / 0x66 east /
0x67 south / 0x68 west), chosen by the step delta inside `0x40108c`. No fixed
post-delay in the primitive itself.

### SetWaypointInfo(x,y,z,type) — 0x00434e89
Appends a record: writes `x,y,z,type` at `[0x4db3e44]<<4 + 0x61d5e8`, then
`[0x4db3e44]++`, wrapping at 1000. `type` observed in `script_loader.lua`:
0 = normal, 1 = hard/exact, 2 = warp (stairs/holes). No opcode.

### GetCurrentWaypoint() — 0x0043617d
Returns 2 numbers: `[0x4db3e38]` (current waypoint pointer/index) and
`[0x4db3e44]` (the count/write cursor), both `fild`→`lua_pushnumber`.

### SetStopPoint() — 0x00434f86
Writes marker **0x32** into the `type` field of the current record
(`[0x4db3e44]<<4 + 0x61d5f0`) — a stop/anchor sentinel in the waypoint list.
No index increment. No opcode.

### ClearWaypoints() — 0x00434f57
`memset`s (`0x44a750`) the whole table `0x61d5e8` for `0x3e80` (16000 = 1000×16)
bytes to 0, resets count `[0x4db3e44]=0` and run flag `[0x4db38e4]=0`.

### StartWaypoints() — 0x00434f9f
Sets run flag `[0x4db38e4]=1` and seeds the cursor `[0x4db3e74]` from
`[0x4db3e54]`. No opcode.

### StopWaypoints() — 0x00434fba
Clears run flag `[0x4db38e4]=0`.

### StartAutoExplorer(floors) — 0x00434fcb
Pulls `floors` with `luaL_checkinteger`, pushes it to dialog control **0x5ae**
(`SetDlgItemInt` on `[0x4db3d24]`), stores it to `[0x4db3c1c]`, sets enable
`[0x4db38bc]=1`, zeroes progress `[0x4db3c4c]=0`, calls init `0x40132f`, and
seeds `[0x4db3d7c]` from `[0x4db3e54]`. `floors` semantics from sample.lua:
`-2` = down 2 floors, `0` = current floor only. No opcode.

### StopAutoExplorer() — 0x0043502b
Clears explorer enable `[0x4db38bc]=0` **and** the hunting flag `[0x4db3838]=0`
(the same flag `SetHuntingOn` toggles).

## ID configuration

Each setter uses the "0 means don't change" idiom: every arg is `cmp …, 0; je`
past its store, so passing 0 leaves that global untouched. No opcodes; these just
retarget which item ids the C-side healer/rune logic uses.

### SetManaPotIDS(normal, strong, great, paladin) — 0x00435f40
`[0x468fe0]`=normal, `[0x468ff0]`=strong, `[0x468ff4]`=great, `[0x468ff8]`=paladin.

### SetHealPotIDS(normal, strong, great, paladin) — 0x00435fdf
`[0x468fec]`=normal, `[0x468fe4]`=strong, `[0x468fe8]`=great, `[0x468ffc]`=paladin.
(Different globals from the mana set; ordering of the stores is shuffled but the
arg→field mapping matches the mana layout.)

### SetRuneIDS(ITEM_UH, ITEM_SD, ITEM_GFB, ITEM_MWALL, ITEM_ROPE) — 0x0043607e
Five globals: UH `[0x468fdc]`, SD `[0x468fa0]`, GFB `[0x468fa4]`,
MWALL `[0x46902c]`, ROPE `[0x46903c]`. Example from sample.lua:
`SetRuneIDS(3160,0,0,0,0)` remaps only the UH rune to id 3160.

## Global reference

| Global | Meaning |
|---|---|
| `[0x469098]` | inject-enabled gate (packet paths A/B require `==1`) |
| `[0x4696e0]` | action post-delay in ms (`_ftol`'d), Sleep'd after most actions |
| `[0x4d22494]` | client window HWND (SendMessage target for path C) |
| `[0x4db372c]` / `[0x4db3728]` / `[0x468f30]` | player X / Y / Z (mirror, read via `0x4011b8`) |
| `[0x4db3838]` | hunting-on flag (SetHuntingOn / StopAutoExplorer) |
| `[0x4db38e4]` | waypoints run flag |
| `[0x4db38bc]` | auto-explorer enable flag |
| `[0x4db3e44]` | waypoint count / write cursor |
| `[0x4db3e38]` | current waypoint index (GetCurrentWaypoint) |
| `0x61d5e8` | waypoint table base (16-byte records ×1000) |
| `[0x4db3d24]` | main dialog handle (loot/explorer/timer controls) |
| `[0x468f90]` | loot timer ms |
| `0x472c9c` | shared string scratch buffer |

## Open / unconfirmed

- MoveTo walk opcodes 0x65–0x68 are now **confirmed**: the walk sender
  `MB_SendWalk` (`0x00404a9b`) builds a 3-byte frame `[01 00 <dir>]` with `dir` in
  `0x65`(N)/`0x66`(E)/`0x67`(S)/`0x68`(W) and `0x69`–`0x6C` diagonals, verified via
  the walker threads (`MB_ThreadWalkFollow` `0x42b7ec`, `MB_ThreadNumpadWalkAim`
  `0x42ba17`) that feed those opcodes from arrow/numpad keys. See
  [engine-core.md](engine-core.md) §6.
- UseItemOnGround's precise packet layout (0x82 "use-with" vs a distinct opcode)
  was not fully expanded; it shares the rel-coord conversion with UseGroundItem
  and calls the use-with variant. **(unconfirmed on exact opcode byte.)**
- CastRuneTarget resolving the rune to a container slot and then driving a
  *keypress* (path C) rather than a 0x82 packet is confirmed by the call into
  `0x407254`, but whether it ever falls back to a packet builder on a cache miss
  was not traced.
- The `[0x4db373c]` "talk mode" scan in UseSpell/NpcSay (channel vs NPC vs
  default) selects the 0x96 sub-mode byte; the full mode table was not decoded.
