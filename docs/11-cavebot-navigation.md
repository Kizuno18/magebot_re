# Cavebot / navigation engine — magebotv55.exe (v10x)

The cavebot is the walk subsystem: it turns a stored route (waypoint list or
recorded `.sav` step ring) into single-tile walk frames, planning around
obstacles with a cost-grid flood-fill and emitting the same `0x65`–`0x6C` walk
opcodes the arrow/numpad walker threads use. Like every other MageBot subsystem
it is **external**: it never runs inside `client.exe`. It reads self/creature/
map state through `MB_ReadClientState` (`0x4024a2`, thunk `0x4011b8`) and emits
walk steps through `MB_SendWalk` (`0x404a9b`, thunk `0x4011f4`), which frames a
3-byte `[01 00 <dir>]` packet and hands it to the injector `MB_InjectFrame`
(`0x40320a`) → `\\.\pipe\SamplePipe%i`. All addresses are file-absolute at
imagebase `0x400000`. See [engine-core.md](functions/engine-core.md) for the
backbone primitives this builds on.

There are **two independent route stores**, and confusing them is the main trap:

- **Lua waypoint list** — a `0x10`-byte-record table at base `0x61d5e8`
  (×1000, fields `+0`=x `+4`=y `+8`=z `+0xc`=type) plus a second `0x90`-byte
  labelled variant at `0x4743a0`. Written by the `Set*Waypoint` Lua API,
  consumed by `runWaypointNavigator` (`0x4333e1`). This is the scripted cavebot
  route.
- **Recorder step ring** — a `0x10`-stride ring buffer at `0x4da3cf8`(x)/
  `0x4da3cfc`(y)/`0x4da3d00`(z) with a terminator column at `0x4da3d04`,
  indexed by `[0x4db37e0]`, ≤4000 entries. Written by `recordPositionHistoryOnMove`
  (`0x41687f`) during a `.sav` recording, replayed by `waypointWalker`
  (`0x419c8c`). This is the "Record" macro path (`.sav`/`.savd`, string
  `:576` "Record done. Saving Record.", `:584` "Recording").

Both feed the same low-level step senders and the same flood-fill pathfinder;
they differ only in where the target tiles come from.

---

## Data / control flow

```
  ROUTE SOURCES
  ┌─────────────────────────────┐        ┌────────────────────────────┐
  │ Lua Set*Waypoint API        │        │ .sav Recorder              │
  │  SetWaypointInfo 0x434e89   │        │  recordStartRecording      │
  │  StartWaypoints  0x434f9f   │        │   0x42dabe (flag 0x4db3950)│
  │  → appendWaypointRecord     │        │  recordPositionHistoryOn-  │
  │    0x433a19  table 0x4743a0 │        │   Move 0x41687f → ring     │
  │  waypoint table  0x61d5e8   │        │   0x4da3cf8/cfc/d00        │
  └──────────────┬──────────────┘        │  recordSaveLoadDialog      │
                 │                        │   0x42d317 (fread/fwrite)  │
                 │                        └──────────────┬─────────────┘
                 ▼                                        ▼
  ┌──────────────────────────────┐        ┌────────────────────────────┐
  │ runWaypointNavigator 0x4333e1│        │ waypointWalker 0x419c8c     │
  │ phase machine [0x4db38e4]    │        │ "Near z change waypoint"    │
  │  0 idle / 1 select / 2 walk  │        │ ring idx [0x4db3818]        │
  │  self xyz 0x4db372c/28,468f30│        │ dir byte from self-vs-wp    │
  └──────────────┬───────────────┘        └──────────────┬─────────────┘
                 │  needs a reachable next tile           │
                 ▼                                        ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ PATHFINDER  (cost-grid flood-fill)                                 │
  │  buildPathToTileFloodFill 0x417c33  (reach window ±9x/±7y)         │
  │   ├ gridTileCostLookup   0x41865a   read grid 0xddc2c0             │
  │   ├ gridMarkPathAndRecurse 0x418786 write grid 0xddc2c0 (marker)   │
  │   ├ floodFillReachabilityStep 0x41814e  BFS ≤90 nodes → sub_401410 │
  │   └ walkability sub_401032 / checkTileWalkableAtDelta 0x40a6fb     │
  │        └ blocking-tile tables 0x4d2249c / 0x4d36104 / 0x4d38814    │
  │  scanBlockingTilesOctantA/B 0x40a7d2 / 0x40ab6e (LOS ray "blkingtile")│
  │  exploreStepPlanner 0x41899b  (anti-stuck, "New explore")          │
  └──────────────┬───────────────────────────────────────────────────┘
                 ▼   next-node (nx,ny)
  ┌──────────────────────────────┐
  │ STEP SENDERS                 │
  │  walkStepToTargetThrottled   │  checkDirectionBlocked 0x433294
  │   0x4331bc (200ms gate)      │   (per-axis hotkey gate)
  │  cavebotWalkToWaypointTarget │  computeLureWalkStep 0x40b0a3
  │   0x416b26 / Guarded 0x41701b│   (lure offset vs monster count)
  │  rotateMoveDirectionGrid     │
  │   0x42b4ba  (dir remap)      │
  └──────────────┬───────────────┘
                 ▼
       MB_SendWalk 0x404a9b (thunk 0x4011f4)
        frame [01 00 <dir>]  dir ∈ 0x65..0x6C
                 ▼
       MB_InjectFrame 0x40320a → \\.\pipe\SamplePipe%i
```

Walk opcode band (single byte, spliced into `[01 00 <dir>]`):
`0x65`=N `0x66`=E `0x67`=S `0x68`=W, `0x69`–`0x6C` the four diagonals
(the `e/f/g/h/j/k/l/m` letters seeded literally in `rotateMoveDirectionGrid`).

---

## The cost grid

The pathfinder works over a **3D map-cost mirror** at base `0xddc2c0`, indexed
`floor*0x3d0900 + x*0xfa0 + y*4 + 0xddc2c0` (dword cells). `0x1f4` (500) is the
grid-center origin, so map x/y are stored offset around 500; a floor plane is
`0x3d0900` bytes, a row `0xfa0`. This is a separate structure from the client
tile cache (`byte_4B29044`) — it is the bot's own walkability/reachability
scratch, filled and mutated during pathing.

- `gridTileCostLookup 0x41865a` — reads a cell's cost. Args `(x,y,floor)`. If
  `|x-0x1f4|` (or y) exceeds reach limit `[0x469284]` it returns a timestamped
  fallback (`clock() + |x-500|*0x3e8`), i.e. an "unreachably expensive" sentinel.
  In-bounds it returns the stored cell value, and its tail averages a 2×2
  neighborhood (sum / 4, rounded) to smooth the cost. Read-only on `0xddc2c0`;
  no packet.
- `gridMarkPathAndRecurse 0x418786` — writes reachability markers. Args
  `(x,y,floor,marker,selfBaseX,selfBaseY)`. Aborts if recursion depth
  `[0x4db3c50]` exceeds `[0x469288]`, if the cell already holds `> marker-2`, or
  if outside the ±7x/±5y reach box around self `[0x469278]`/`[0x46927c]`. On
  first entry it seeds an 8×6 neighborhood (dx −7..8, dy −5..6): each open tile
  (`sub_401032`==0) gets the marker written. It then writes `marker-1` into the
  current cell and recurses the 4-neighborhood via `sub_4013E8`. This is the
  flood-mark mutator that paints the walkable region into the grid.

Walkability of a single cell is decided against three blocking-tile id tables,
read via `MB_ReadClientState` from the client's live tile stack:
- `0x4d2249c` (word entries, count `[0x46906c]`) — tested by
  `checkTileWalkableAtDelta 0x40a6fb`.
- `0x4d36104` (word entries, count `[0x469068]`) — tested by the LOS scanners.
- `0x4d38814` (walkability flag table; bit `0x80000001` = blocked) — tested by
  `buildPathToTileFloodFill`.

---

## Function-by-function walk

### Route selection & phase machine

**`runWaypointNavigator 0x4333e1`** — the Lua-route cavebot executor.
Reads self position via `MB_ReadClientState`: X `[0x4db372c]`, Y `[0x4db3728]`,
Z `[0x468f30]`. Drives phase var `[0x4db38e4]` (0=idle, 1=select-target,
2=walking). Phase 1 scans the `0x10`-byte waypoint records at base `0x61d5e8`
(`+0`=x `+4`=y `+8`=z `+0xc`=type), picks the nearest reachable one by Chebyshev
distance (`sub_44ACF5` abs) filtered through the reachability solver
`sub_401410`, saving the chosen index in `[0x4db3e38]` (this is what
`GetCurrentWaypoint 0x43617d` returns) and a stall timer in `[0x4db3e50]`.
Phase 2 loads the selected waypoint's x/y/z and, when in range, either emits a
floor-change command for **type `0x32`** (`"GOUP"`, string, via
`sub_44A590`+`sub_401140` with fmt `0x46e208`) or takes discrete ≤7-tile steps —
each checked with tile-walkability `sub_40108C` and stepped via `sub_4010EB` —
advancing to the next waypoint on arrival. `[0x4db3e40]` = in-progress flag,
`[0x469114]` = walk speed. Emits walk frames indirectly through `sub_4010EB`
(the step sender) → `MB_SendWalk`.

**`waypointWalker 0x419c8c`** — the recorder-replay driver (string `:195`
"Near z change waypoint"). Reads self x/y/z + an hp-ratio stance guard
(`0x4db3790/98/94` vs `0x4afd388`). Walks the recorder ring at `0x4da3cf8`(x)/
`0x4da3cfc`(y)/`0x4da3d00`(z), stride `0x10`, indexed by `[0x4db3818]`; caches
the current waypoint into `[0x4db3c78]`/`[0x4db3c7c]` and the previous index into
`0xdd9b8c`. For each pending step it computes a **direction byte** into a local
buffer by comparing the self tile scalars `[0x469278]`/`[0x46927c]` against the
waypoint coords (1=north, 3/5/7 for the other axes), validates the built step
string with `sub_44A680` (strlen), and dispatches it through `sub_40146A` (the
send-walk/step emitter → `MB_SendWalk`). Handles **z-change** waypoints (skip/
advance when the ring's z column `0x4da3d00` differs), reached-target detection
(current-waypoint match within `0x384`/`0x578` ms of stamp `[0x4db3c8c]`), pause
counter `[0x4db3b44]`, and diagonal-corner smoothing when `[0x4db3c5c]` is set.
Paces retries with `Sleep(0x14)`. Only `Sleep` is imported; all I/O is through
`sub_4011B8`/`sub_40146A`.

**`exploreStepPlanner 0x41899b`** — anti-stuck / auto-explorer tick (strings
`:181` "Doing quicktest:%d", `:182` "New explore %d %d %d:%d"). Reads self x/y/z
(`0x4db372c`/`28`/`0x468f30`), compares to last-seen coords `0xdd9ba0/a4/a8` and
a stuck-tracking triple `0xdd9b94/98/9c`. On a real position change it decrements
the walk-budget timer `0x469290` by `0x12c`. Clamps the current target tile
scalars `0x469278/7c/80` (x/y/z) to the visible band (x `[0x14..0x3d4]`, z
`[1..0xb]`); `Beep`s 200 Hz once via `[0x5c5d548]` when out of range and
re-syncs. Builds candidate step tiles (stride `0xc`: dx,dy,z) around the target,
scores them against neighbor-offset tables `0x4ae8328`(x)/`0x4ae7388`(y)/
`0x4ae63e8`(z) with a Manhattan cost (`sub_44ACF5`), seeding `rand` via
`sub_44ADB6`. Reads the recorder ring `0x4da3d00` (indexed `[0x4db3c54]`), the
current waypoint index `[0x4db3818]`, and explore-state flags
`[0x4db3c14/c24/c38/c58/c60]`. This is the fallback that picks a new tile when
the direct route is blocked ("quicktest failed", string `:187`).

### The flood-fill pathfinder

**`buildPathToTileFloodFill 0x417c33`** — pathfinding entry. Args
`(destX,destY,srcX,srcY)`. Increments call counter `[0x4db3c28]`; reads a
step-cost config from `[0x4db3784]` via `MB_ReadClientState`. Throttles a retry
budget `[0x4db3c30]` every `0x190` (400 ms) via `clock()` (`sub_44A7A8`) vs
`[0x4db3c34]`. Fast-outs: **returns 1 if src==dst**; **returns 0 if dx>9 / dx<−8
/ dy>7 / dy<−6** (bounded reach window). When both mode flags
`[0x4db3c14]`/`[0x4db3c18]` are 0 it consults a precomputed reachable-tile cache
(parallel arrays `0x4ae99e0`=X, `0x4ae96c0`=Y, `0x4ae93a0`=result), bumping hit
counter `[0x4db3c2c]`. Otherwise it calls the path-node expander `sub_40143D`
with `(dx,dy)`, walks its node table (stride `[0x468f6c]` off base+`0x2c`),
reading each node's type(+8)/id(+4) via `MB_ReadClientState`. Node type `0x63` is
the goal/self marker; tile ids are checked against walkability table `0x4d38814`
(`0x80000001` = blocked). Blocking creatures are recorded into avoid-lists
`0x4ae8400`(X)/`0x4ae7460`(Y)/`0x4ae64c0`(dir) keyed on `[0x4db3c24]`, and a
second obstacle map `0x4da04c4`/`0x4da04c0` (16-byte stride) is consulted.
Special item ids (`0x15a6,0x79c,0x7b0,0x182,0x1a5,0x2faa,0x1b3,0x79d`) get
direction-tagged (stairs/holes/rope-spots — the warp/stair handling; see below).
Returns 1 if a walkable path/tile is found. Reach margin `[0x469054]`, abs via
`sub_44ACF5`. Builds no packet itself — it only computes reachability.

**`floodFillReachabilityStep 0x41814e`** — the BFS/flood recursion behind the
entry. Args `(goalX,goalY,curX,curY,selfX,selfY)`. Increments visited counter
`[0x4db3b40]`; records the current tile into visited-list arrays `0x4aeb7e4`(X)/
`0x4aeb1a4`(Y) at index `[0x4db3b3c]`. **Returns 1 if cur==goal**. Aborts
(return 0) if visited count exceeds `0x5a` (90 nodes) or list cap `[0x469114]`.
When distance-limit mode `[0x4db3c38]` is set it bounds the walk to `|dx|<8`,
`|dy|<6` relative to self and reads the region-grid array (same
`floor*0x3d0900 + x*0xfa0 + y*4 + 0xddc2c0` indexing) to reject already-marked
tiles; on first call it memsets a `0xa80`-byte visited bitmap `0x4ae5a40`. Calls
walkability `sub_401032` before recursing. Computes step-direction signs toward
the goal (`setge` tricks), preferring the axis with the larger abs-delta, and
recurses into `sub_401410` (the recursive neighbor-visit expander). On success
and re-entry flag `[0x4db3c3c]` it sweeps a 2×2/4-neighborhood block.

**`gridTileCostLookup 0x41865a`** and **`gridMarkPathAndRecurse 0x418786`** —
the read and write halves of the cost grid, documented above under "The cost
grid". Lookup reads `0xddc2c0` (with a 2×2 smoothing average); the mutator
flood-marks walkable tiles into `0xddc2c0` and reads self position `0x469278/7c`.
Neither emits a packet.

**`checkTileWalkableAtDelta 0x40a6fb`** — the elementary is-blocking predicate.
Args `(curX,curY,refX,refY)`; forms the delta and resolves the tile record via
`sub_40143D`. Returns 0 if the record is 0 (off-map). Otherwise it walks the
client's tile-stack for that cell (stride `[0x468f6c]`, per-item `+8`=id `+4`,
each read through `MB_ReadClientState`) and, for each stacked item id, scans the
blocking-tile id table `0x4d2249c` (word entries, count `[0x46906c]`); a match
returns 0 (blocked), else returns 1. This is what the higher line/flood pathers
call per candidate tile.

**`scanBlockingTilesOctantA 0x40a7d2` / `scanBlockingTilesOctantB 0x40ab6e`** —
line-of-sight ray blockers (debug `"blkingtile %x"`, strings `:115–126`; cell
trace `"[%i,%i]"` into buffer `0x4ce9430`). Given endpoint `(x,y)`, origin
`(ox,oy)` and screen-offset `(sx,sy)`, they interpolate a straight line by the
major axis (abs compare via `sub_44ACF5`, minor coord by `idiv`), resolve each
cell with `sub_40143D`, and scan the second blocking table `0x4d36104` (count
`[0x469068]`); first blocking id → return 0. **Octant A** applies the screen-
offset correction (`+[ebp+0x14]-[ebp+0x1c]`) so it works in the offset/screen
frame; **Octant B** uses the raw interpolated coords, i.e. absolute map space.
Used to check whether a straight shot to a tile is clear before committing a
multi-tile step. No packet.

### Step senders (emit the walk frame)

**`walkStepToTargetThrottled 0x4331bc`** — throttled single step toward a target
tile. Rate-gates on `[0x4db3e3c]` with a `0xc8` (200 ms) minimum interval
(returns 1 if too soon). Sets walk-speed `[0x469114]=0x32`, clears path scratch
`[0x4db3b40]`/`[0x4db3b3c]`, memsets the two `0x640`-byte path buffers
`0x4aeb7e4`/`0x4aeb1a4`, then calls the A*/path solver `sub_401410` with
`(fromX,fromY,fromX,fromY,toX,toY)`. On success with path length
`[0x4db3b3c] > 2`, it reads the next-node coords from `0x4aeb7e8`/`0x4aeb1a8` and
issues the actual step via `sub_4010EB(x,y,nx,ny)` (→ `MB_SendWalk`), recording
the send time in `[0x4db3e3c]`.

**`checkDirectionBlocked 0x433294`** — direction-permission gate, not a sender.
Checks whether movement from `(fromX,fromY)` to `(toX,toY)` is disallowed by a
disabled direction toggle: sets `[0x4db39a8]=1`, then per-axis delta tests a
hotkey/toggle id via `sub_401235` (dx>0 → `0x27` right, dx<0 → `0x25` left,
dy>0 → `0x28` down, dy<0 → `0x26` up — these are VK arrow codes). If the toggle
is set it returns blocked (1); otherwise clears `[0x4db39a8]=0` and returns
allowed (0). Lets the user fence off directions the cavebot may not walk.

**`cavebotWalkToWaypointTarget 0x416b26`** — waypoint approach step over the
open-container/creature record array (base `[0x468f2c]`, `0x1ec`=492-byte stride,
limit `[0x4db377c]`). Logs a debug line with waypoint index `[0x4db3820]`. Reads
each record's active flag(+0x34), sub-count(+0x30), and per-entry id/type fields
via `MB_ReadClientState` (offsets built from field-base globals `[0x468f5c]`/
`[0x468f60]`/`[0x468f64]`). Matches a target creature id against `[0x468fb0]`
(entry `[1..0x64)`) and, on a hit, calls the walk/step builder `sub_4012DA` with
the resolved coords plus self scalars `[0x4db3858/5c/60]` and waypoint counter
`[0x4db386c]`. A second pass (gated on `[0x4db386c]==1`) filters entry ids
through a **skip set `0xEA, 0xF0, 0x11A, 0x11E, 0x10A, 0x10C`** (non-walkable
tile types), runs dir helpers `sub_40112C`/`sub_4011C7`, and issues movement
frames through `sub_401208` and `sub_40123F`, throttling each phase with `Sleep`
on sub-fields of the timing table `[0x468f90]` (`+0x64/+0xc8/+0x190/+0x1f4`).
Retry state `[0x4db3bd4]`, stall marker `[0x4db3bdc]=0xFFFFFFF6`.

**`cavebotWalkToWaypointTargetGuarded 0x41701b`** — the larger, dwell-guarded
sibling. Takes a waypoint/label index (`[ebp+8]`) used to index a per-waypoint
stuck-counter array `0x4db3be0`. Bails if `[0x4db3820]==1`. Same 492-byte record
scan and `[0x468fb0]` id match; when mode `[0x4db3894]!=1` it enforces a `0x3a98`
(15000 ms) dwell using `clock()` vs `[0x4db3c08]`. Counts still-present targets,
aborting with `[0x4db3c0c]++` if the count mismatches `[ebp-0x20]`. Same tile-type
skip set; clamps a min-distance/priority into `[0x4db3c10]` (floored to 3),
honoring stand-still flag `[0x4db3878]`. The approach direction is **wrapped**:
`((stuckCtr[idx] / 0x14) + [0x4db386c]) mod 0x14`, then `sub_40123F` builds the
move and `stuckCtr[idx]` increments — so each failed approach rotates the tried
direction, an escape-from-stuck spiral. Returns 1 on stuck/abort. (asm tail
truncated in the sample; late blocks **unconfirmed**.)

**`computeLureWalkStep 0x40b0a3`** — the lure planner (kite monsters to a spot).
Throttled: `clock() - [0x4db3a84]` must exceed interval `[0x469058]`, else return
1; a second gate `sub_40145B` can abort. Snapshots self target id `[0x4db3784]`
and self coords. Selects a walk-mode target value by matching mode global
`[0x4db39a0]` against a constant table (`2→[0x468fa4]`, `0xE→[0x4690e0]`,
`0x13→[0x4db3a10]`, `0x65→` literal `0xc5d`, `0x68→[0x4db3a7c]`). Dispatches on
the axis arg `[ebp+8]` (**−3 = X axis, −4 = Y axis**): scans the creature array
`[0x468f38]..[0x4db37ac]` (`0xE0` stride), filtering by id-band, type
(`sub_401041`), target match (rec+0x20), alive (rec+0x88) and range windows
(`|rec+0x28 − [0x4db3904]| ≤ 7`, `|rec+0x24 − [0x4db3906]| ≤ 5`). Counts matching
monsters against id/priority tables `0x4d072bc`/`0x4cfd4ec` (skips `0x63`),
computes a centred lure offset from that count (`(count+1)/2` signed), clamps the
destination to a ±7x/±5y box around self, and builds an 8-entry step array in
`[ebp-0x68]` scaled by the axis sign — the per-tick displacement the walk sender
then emits.

**`rotateMoveDirectionGrid 0x42b4ba`** — direction remap / emitter. Reads player
X/Y mirrors (`MB_ReadClientState` on `[0x4db372c]`/`[0x4db3728]`), seeds a 9-entry
local table with the walk-opcode constants
`0x6d,0x65,0x6a,0x68,0x68,0x66,0x6c,0x67,0x6b` (the `0x65`–`0x6C` band), computes
neighbor offsets with `sub_401032`, and for input opcode `0x66/0x68/0x65/0x67`
selects the matching cell and calls **`sub_4011F4` = `MB_SendWalk`** directly to
emit it. This is the transposition table that maps a desired compass direction
to the correct opcode given the player's grid parity. Returns 1.

### Warp / stair / floor-change handling

Floor changes are handled two ways:

- **In the Lua route**, `runWaypointNavigator` reads the waypoint `type` field
  (`+0xc`). **Type `0x32`** triggers the `"GOUP"` path — it emits a floor-change
  command string (`sub_44A590`+`sub_401140`, fmt `0x46e208`) instead of a walk
  step. `waypointWalker` handles the recorder-ring equivalent by watching the z
  column `0x4da3d00`: when the next ring entry's z differs from the current z it
  treats it as a z-change waypoint (string `:195` "Near z change waypoint") and
  skips/advances rather than trying to walk the delta.
- **In the pathfinder**, `buildPathToTileFloodFill` direction-tags a hardcoded
  set of special item ids — `0x15a6, 0x79c, 0x7b0, 0x182, 0x1a5, 0x2faa, 0x1b3,
  0x79d` — which are stair/hole/teleport tiles that change floor; tagging them
  lets the walker step onto them deliberately rather than treat them as blockers.
  (Exact per-id mapping of which is up-stairs vs down-hole vs rope-spot is
  **unconfirmed** from the asm.)

### The recorder

The `.sav`/`.savd` "Record" macro is a separate route producer:

- **`recordStartRecording 0x42dabe`** — prints "Recording", sets recording flag
  `[0x4db3950]=1`, zeroes the ring buffers (`0x4da3cf8` for `0xfa00` bytes,
  `0x4b17b9c` for `0x10000`), resets step counter `[0x4db37e0]=0`, `[0x4db37ec]=0`
  and playback index `[0x4db3964]=0`.
- **`recordPositionHistoryOnMove 0x41687f`** — the per-move appender. Reads self
  x/y/z + extra fields `0x4db3718/1c/20`; if `(x,y,z)` equals the last-recorded
  triple `[0x4db3800/04/08]` it returns 0 (no move). On a real move it appends
  x/y/z into the ring `0x4da3cf8/cfc/d00` at `[0x4db37e0]`, sets a boundary marker
  at `0x4da3d04` (index mod `0xFA0`=4000), increments the counter, logs
  `"recording %i %i %i %i"` (`:174`), and updates `[0x4db3800/04/08]`.
- **`recordSaveLoadDialog 0x42d317`** — the Save/Load UI. Fills an
  `OPENFILENAMEA` (filter "Sav Files" `:573`, default `record.sav`). On save
  (recording flag set) prints "Record done. Saving Record." (`:576`),
  force-appends `.sav`/`.savd`, **mirror-reverses** the recorded step table
  (entries stride `0x10`, count `[0x4db37e0]`) writing terminator markers `7`/`0xa`
  into `0x4da3d04`, and `fwrite`s it — the reversal produces the return trip
  (hunt→bank vs bank→hunt, cf. the deposit-script note `:448`). On load it
  `fread`s buffers `0x4da3cf8`/`0x4d8f118`/`0x4b17b9c`, sets `[0x4db3c40]=1`, and
  paces with `Sleep(0x32)`.

The Lua-list builder counterpart is **`appendWaypointRecord 0x433a19`**: appends
into the `0x90`-byte-stride labelled table at base `0x4743a0` (indexed by count
`[0x4db3e7c]`), storing `+0x4`=x `+0x8`=y `+0xc`=z, `+0x0`=1 (active), and the
label/action string into `+0x10` via `sub_44A590` (strcpy). `resetScriptAndWaypointState
0x4341f7` memsets the `0x61d5e8` table (`0x3e80` bytes) and zeroes the navigator
state on route clear / Lua reload.

---

## Contrast with the Lua `Set*Waypoint` API

The Lua bindings ([03-lua-api.md](03-lua-api.md)) are the scripted front door to
the `0x61d5e8`/`0x4743a0` waypoint list; they do **not** touch the `.sav` ring:

| Lua global | Impl VA | Effect |
|---|---|---|
| `SetWaypointInfo` | `0x434e89` | writes a waypoint record (x/y/z/type/label) into the list — the API face of `appendWaypointRecord` |
| `StartWaypoints` | `0x434f9f` | sets the run flag `[0x4db38e4]` → `runWaypointNavigator` begins phase 1 |
| `StopWaypoints` | `0x434fba` | clears the run flag → navigator idles |
| `ClearWaypoints` | `0x434f57` | resets the list (→ `resetScriptAndWaypointState`) |
| `SetStopPoint` | `0x434f86` | marks a waypoint as a stop/pause point |
| `MoveTo` | `0x433338` | one-shot walk toward an absolute tile (feeds the same step senders) |
| `GetCurrentWaypoint` | `0x43617d` | reads the live index `[0x4db3e38]` set by phase 1 |
| `StartAutoExplorer` / `StopAutoExplorer` | `0x434fcb` / `0x43502b` | toggle the auto-explorer flag `[0x4db38bc]` driving `exploreStepPlanner` |
| `SetHuntingOn` | `0x436141` | sets hunting flag `[0x4db3838]` |

So a Lua script builds a route by repeated `SetWaypointInfo` calls (populating
`0x61d5e8`), then `StartWaypoints` flips `[0x4db38e4]` and hands execution to
`runWaypointNavigator`, which uses the flood-fill pathfinder + step senders
described above and emits `[01 00 <dir>]` frames through `MB_SendWalk`. The
`.sav` recorder path (`waypointWalker` over `0x4da3cf8`) is the GUI "Record"
macro and runs the **same** pathfinder and senders but sources its tiles from the
recorded ring rather than the scripted list. Both ultimately gate on the master
enable flag `[0x469098]` and the injector throttle before a walk frame reaches
the pipe.

---

## Open / unconfirmed

- The precise stair/hole/rope semantics of the special item-id set in
  `buildPathToTileFloodFill` (`0x15a6, 0x79c, …`) — which id is up vs down vs
  rope-spot — is not decoded from the asm.
- `cavebotWalkToWaypointTargetGuarded 0x41701b` late blocks are truncated in the
  corpus sample; the tail approach logic is inferred, not fully confirmed.
- The exact byte layout that `sub_4010EB` / `sub_4012DA` / `sub_40123F` /
  `sub_40146A` hand to `MB_SendWalk` (single opcode vs a multi-step batch) was
  not expanded per-caller; all resolve into the `MB_SendWalk` `[01 00 <dir>]`
  frame, but whether any of them emit a click-walk (SendMessage path, cf.
  `walkPathToCreatureClick 0x40803b`) instead of a walk packet on some branches
  is unconfirmed.
- Whether `runWaypointNavigator`'s `"GOUP"` string is sent as a chat command or a
  distinct floor-change opcode was not traced to the wire.
