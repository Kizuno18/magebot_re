# Targeting & attack engine (v10x)

The subsystem that picks a creature, decides whether to melee-attack it, cast a
rune at it, or paint it on the battle-list, then routes the resulting action
through the packet backbone. It lives entirely in the `0x40a000`–`0x421800` band
and is driven from the `MB_WinMain` tick region (`0x437aa5`–`0x43ba93`, see
[engine-core.md](functions/engine-core.md) §6). Nothing here parses the wire; it
reads the RPM-polling creature-array cache and emits frames through the same two
primitives every other subsystem uses:

- **`MB_ReadClientState`** `0x4024a2` (thunk `sub_4011B8` / `0x4011b8`) — reads a
  client field via RPM (band-dispatched cache; [engine-core.md](functions/engine-core.md) §2).
- **`MB_SendAction`** `0x405f1d` (thunk `sub_401217` / `0x401217`) — the 2-arg
  packet builder; every attack in this subsystem calls it with opcode **`0xA1`**.
- **`sub_4011BD`** (`MB_write` helper, WPM) — back-writes a chosen target id into
  the client's own target field `[0x468f34]` and paints recolor bytes into
  creature records.

All addresses are `samples/v10x/magebotv55.exe`, imagebase `0x400000`.

---

## The creature array (shared substrate)

Every function in this doc walks the same client structure, batch-mirrored by
`MB_ReadClientState`:

```
base   = [0x468f38]      ; client creature-array base pointer
stride = 0xE0            ; bytes per creature record
end    = [0x4db37ac]     ; array terminator (resolved by resolveClientAddr_468f38_p45d30 @0x401b70)
```

Per-record fields used by the scoring/attack code (offsets confirmed across
`countWeightedMonstersNearPoint`, `isMonsterOnScreenSelf`, `recolorTargetCreatures`,
`autoAttackNearestTick`):

| Offset | Meaning |
|---|---|
| `-4`   | creature id (compared against self/follow id `[0x4db3784]`) |
| `-1`   | class/flag byte — monster gate is `== 0x40` |
| `+0x20`| floor / on-name field (compared to self floor `[0x468f30]`) |
| `+0x24`| map y |
| `+0x28`| map x |
| `+0x5c`| bot-owned marker/target-id slot (written by `sub_4011BD`) |
| `+0x60..+0x6c` | recolor bytes (battle-list highlight) |
| `+0x70`| recolor mode marker |
| `+0x88`| hp/alive field — alive gate is `>= 1` |

Self anchors (all via `MB_ReadClientState`):

```
self x = [0x4db372c]   self y = [0x4db3728]   self z/floor = [0x468f30]
follow id = [0x4db3784]    client target field = [0x468f34]
self hp% = [0x4db3790]     self mana = [0x4db37a8]
```

Two shared helpers gate every candidate: `sub_401041` (per-creature
visible/valid predicate) and `sub_44ACF5` (integer `abs`, used for the Chebyshev
box tests). The "monster" filter throughout is `[record-1] == 0x40`.

---

## Data / control flow

```
                       targeting.txt / enemies.txt / friends.txt
                                  │  (loadConfigLists 0x420393, boot)
                                  ▼
                    name tables: 0x4ce4d98 (stride 0x96, allow-list)
                                 0x4cc8c60 (stride 0x64, enemies, cnt [0x469064])
                                 0x4c8a2a8 (stride 0x80, per-monster spell)
                                  │
   ┌──────────────────────────────┼───────────────────────────────────────┐
   │ creature array cache  [0x468f38] .. [0x4db37ac] stride 0xE0           │
   │ (batch RPM-mirrored by MB_ReadClientState 0x4024a2)                   │
   └──────────────────────────────┼───────────────────────────────────────┘
        scan+score helpers         │            selection engines
   ┌───────────────────────────────┼─────────────────────────────────────┐
   │ countWeightedMonstersNearPoint │ runTargetSelectionEngine 0x411cae   │
   │ sumMonsterDistanceNearPoint    │   → picks target, announces         │
   │ isMonsterOnScreenSelf          │ targetNearestCreatureAndAttack      │
   │ isMonsterWithinRangeSelf       │   0x41e6fe → nearest + attack       │
   │ isCreatureInThrowRange         │ autoAttackNearestTick 0x40a3b5      │
   │ computeTargetScreenX/Y         │ attackScanAndFire 0x42176e          │
   └───────────────────────────────┼─────────────────────────────────────┘
                                    ▼
                 ┌──────────────────────────────────────────┐
                 │ attackComboEngineTick 0x40fbd9 (melee/combo) │
                 │ runRuneAttackTargeting 0x40cee4 (rune/area)  │
                 │ recolorTargetCreatures 0x40f018 (paint only) │
                 └──────────────────────────────────────────┘
                                    │
             melee: MB_SendAction(id, 0xA1)  sub_401217 → 0x405f1d
             rune : dynamic builders sub_4013F2 / sub_4012CB / sub_401339
             cast : say-path sub_401398 ("exori frigo", "exura sio \"%s\"")
             paint: sub_4011BD WPM into creature record  (no packet)
                                    │
                                    ▼   [0x469098]==1 gate → injector 0x40320a
                              \\.\pipe\SamplePipe%i  (packet.dll re-emits 0xA1 frame)
```

Frame shape for the melee path (from `MB_SendAction` §1a in engine-core):
`09 00 A1 <targetId:4 LE> <clientField:4 LE>`, where the trailing 4 bytes are
spliced live from `[0x468ee8]`.

---

## Target selection scoring

There are three independent scoring notions in play; each engine uses a subset.

**Chebyshev viewport box.** The Tibia screen is 15×11 tiles with self near the
centre, so "on screen" is `abs(dx) <= 7 && abs(dy) <= 5..6`. `isMonsterOnScreenSelf`
uses the fixed `7 / 6` half-extents; `isMonsterWithinRangeSelf` takes a
caller-supplied radius for both axes; `autoAttackNearestTick` and
`isCreatureInThrowRange` use `dx<=7 && dy<=5` (attack/throw reach).

**Nearest by Manhattan/Chebyshev distance.** `sumMonsterDistanceNearPoint`
returns the minimum `abs(dx)+abs(dy)` over accepted monsters (seed `0x24`
sentinel = none). `targetNearestCreatureAndAttack` keeps the minimum Chebyshev
distance to self within `[0x469054]+1`, tie-broken by a per-monster priority
weight (`sub_401370 → sub_40121C`, must be `<=` running best).

**Weighted danger density.** `countWeightedMonstersNearPoint` accumulates a
score around a tile: `+1` per monster within box 3, `+2` within box 2, then
clamps `count>10 → (count-10)/3 + 10`. This is the crowd/danger metric the
cavebot/anti-lure logic consults, not an attack selector.

**Name allow-list.** The final gate for the announce/battle-list engines is the
creature name (resolved by `sub_401370`) matched against the config tables loaded
at boot — `0x4ce4d98` (stride `0x96`, the targeting allow-list) via `sub_44A4D0`,
and the enemy table `0x4cc8c60` (stride `0x64`, count `[0x469064]`).

---

## targeting.txt & the config tables — `loadConfigLists 0x420393`

The list loader `loadConfigLists` (`0x420393`, 5026 bytes) runs at boot and
`fopen`/`fgets`/`atoi`-parses the flat text config files into the lookup tables
the targeting engine reads:

- `enemies.txt` → records at `0x4cc8c60` (stride `0x64`) + pointer array
  `0x4caa7fc`, enemy count `[0x469064]` (drives `recolorTargetCreatures` and the
  battle-list picker).
- `friends.txt` → `0x4cb05c0`.
- `otitenids.txt` / `itenids.txt` (chosen by `sub_401177`) → item-id maps
  `0x4d78814` / `0x4d1d3f0`; `tradehelper.txt`, `customhotkeys.txt` also here.

The monster **allow-list** the selection engines test names against is the
stride-`0x96` table at `0x4ce4d98` (the "Character will autoattack monsters in
Targeting.txt" surface, strings `:288`, `:437`). `loadConfigLists` uses
`0x4ce4d98` as its parse scratch; the persistent allow-list contents the target
picker consults live there and in the enemy/friend tables above. The precise
`targeting.txt → 0x4ce4d98` population path is **(unconfirmed)** from the asm —
`loadConfigLists` names six files and `targeting.txt` is not one of the literals
in its body, so the allow-list is filled either by a sibling loader or by the
GUI/Lua layer. What *is* confirmed is the consumer: every selection engine reads
`0x4ce4d98` (stride `0x96`) with `sub_44A4D0` (strcmp).

---

## Function-by-function walk

### `runTargetSelectionEngine` — `0x411cae` (11177 bytes)

The monster/enemy **target picker + battle announcer**. Sets busy flag
`[0x4db39b0]=1` on entry, clears it on exit.

- **Reads:** self x/y/z (`[0x4db372c]`/`[0x4db3728]`/`[0x468f30]`), follow id
  `[0x4db3784]`, all via `sub_4011B8`.
- **Scan:** walks the creature array with a per-node dirty check against the
  mirror `0x4aec914[idx]` (`idx = (node-base)/0xE0`) — only re-evaluates changed
  records. Skips self (`[node-4]==[0x4db3784]`) and an optional exclude id
  (`[ebp+0xc]`). Applies `sub_401041`, an id-in-list check against a 5-entry
  recent table `0x4d1d3dc` and a `0xC8`-entry table `0x4aec5f4` (counter
  `[0x4db3ba0]`), resolves the name (`sub_401370`), runs it through the
  name→setting tables (`0x4c8a2a8` stride `0x80`, values `0x4af4614`), and
  matches the config allow-list `0x4ce4d98` (stride `0x96`, `sub_44A4D0`).
- **Announce:** on a selected target formats human distance strings
  (`"*%s*%s %i west and %i south and %i below.."` / `"..on the same level!.."`)
  from `dx=x-[ebp-0x504]`, `dy=y-[ebp-0x4f8]` into `0x4ce9430` / `0x4d22278`
  (`sub_44A6FB`), throttled by `sub_44A7A8` timestamps `[0x4db3b8c]`/`[0x4db3b90]`
  with cooldown `[0x469124]`; compares against configured strings at
  `0x469c5c`/`0x469c60` (`sub_44AF30` strstr).
- **Emits:** no packet directly — it *chooses* the target (returns it in AL on
  the picked path). The chosen id is consumed by the attack engines below.

### `attackComboEngineTick` — `0x40fbd9` (6421 bytes)

The **main attack/combo/targeting state machine** — the healer/combo caster + melee
driver referenced in the overview. Dispatched on mode selector `[0x4db39a0]`
(values ~`0x13`/`0x31`–`0x3b`/`0x65`), gated by `[0x4db39c8]`/`[0x4db39a0]`/
`[0x4db390c]` and precondition `sub_40145B`.

- **Reads:** self y `[0x4db372c]`, z `[0x4db3728]`, name base `[0x468f30]`,
  follow id `[0x4db3784]`, client target `[0x468f34]`. Per-state throttled by
  `sub_44A7A8` (`clock()`) vs interval `[0x469058]`, stamps `[0x4db3b18]`/
  `[0x4db3a18]`.
- **State `0x32`:** single cast via say-builder `sub_401398(0x4af84dc)`.
- **State `0x33`:** loops the creature array, finds the target record,
  LOS/range-checks with `sub_4013F2` + `sub_4014D8`, converts its tile
  (`sub_40143D`), reads tile-stack field `+0x34`, and issues an aimed
  rune/attack via `sub_4012CB` (else stop-attack `sub_401339`) using rune id
  `[0x4db3aec]`.
- **State `0x34`:** matches each creature name (`sub_401370`, `sub_44A590`,
  tolower `sub_40100F`) against the per-monster spell table `0x4c8a2a8` (stride
  `0x80`, count `[0x4db38d4]`) and casts the paired spell string from
  `0x4c6a2a8` (`sub_401398`), falling back to the literal **`"exori frigo"`**.
- **Emits:** chat/hotkey-string casts via `sub_401398` (path C say), or aimed
  packet actions via `sub_4012CB`/`sub_401339` (dynamic-opcode, built from RPM
  reads — exact bytes **(unconfirmed)**, not immediates). Each send is followed
  by `Sleep(0xA)` or `Sleep(0x32)`.

### `autoAttackNearestTick` — `0x40a3b5` (838 bytes)

The **auto-target/auto-attack engine tick**.

- **Gate:** if `[0x4db390c]==0 && [0x4db3a58]==0` return 1 (disabled); if
  `sub_40145B()==1` (busy) return 1.
- **Re-attack path:** when `arg1==1` and client target `[0x468f34]==` saved
  `[0x4db3a60]` and attack-mode `[0x4db3a58]==1`, re-issues
  `MB_SendAction(0, 0xA1)` (`sub_401217`) and writes the target back to
  `[0x468f34]` via `sub_4011BD`.
- **Scan:** otherwise records `arg1` into `[0x4db3a60]`, loads follow id, self
  x/y/z, scans the array skipping self + follow id, matching `arg1`. On the
  match: floor `+0x20` must equal self z, hp `+0x88 >= 1`, coords `+0x28`/`+0x24`,
  `sub_44ACF5` box `dx<=7 && dy<=5`. Computes an aggression ratio
  `hp%([0x4db3790])*100/(mana+1 [0x4db37a8])`; when `>0x28` and `arg2` set it
  flags `[0x4db39f8]` and (within 2 sqm) stamps clocks `[0x4db39fc]`.
- **Emits:** when in range and armed (`[0x4db3a58]`/`[0x4db3a54]`),
  `MB_SendAction(target, 0xA1)` via `sub_401217`, writes target to `[0x468f34]`
  (`sub_4011BD`), optionally `sub_401339` (turn/face) when `[0x4db390c]==1`,
  `Sleep(0x32)`, stamps `[0x4db3a64]`. Returns 1 on attack issued, 0 otherwise.

### `targetNearestCreatureAndAttack` — `0x41e6fe` (1234 bytes)

**Nearest-target selection + auto-attack driver** — the "pick closest, hit it"
loop.

- **Gate:** main-attack-enabled `[0x4db38b8]==1`, monster gate `-0x3C==0x40`.
- **Scan:** for each live creature (`-4 != 0`, `+0x88 != 0`) reads
  `sub_401041` liveness (flag `[ebp-0x28]`), a blob at `+0x5C` (when
  `[0x4db3cd8]==1` and blob `==0` it back-writes `0x119` via `sub_4011BD`), floor
  `+0x20` vs self z `[0x468f30]`, category `-1`. Reads coords `+0x28`/`+0x24`,
  computes Chebyshev distance to self (`sub_44ACF5`) and keeps the minimum within
  `[0x469054]+1`, tie-broken by priority weight `sub_401370 → sub_40121C`
  (must be `<=` running best `[ebp-8]`).
- **Fire:** after the scan, throttled by `sub_44A7A8` vs `[0x4db3ce8]` (100 ms)
  and re-gated `[0x4db38b8]==1 && [0x4db3838]==0`, it locks the chosen id
  `[ebp-0x30]`, builds its screen tile (`sub_40143D` + `sub_4011B8`), then:
  - if `[0x469098]==1` (safemode/inject gate) calls `sub_4014A1(id)` — the
    ATTACK pre-step (target validation) — **without** emitting;
  - else emits `sub_401217(id, 0xA1)` (**ATTACK**) and back-writes the id to
    `[0x468f34]` (`sub_4011BD`).
- Records target `[0x4db3ce4]`, timestamps `[0x4db3ce8]`, `Sleep 5`. Uses
  cooldowns `[0x4db3cdc]`/`[0x4db3ce0]` and refreshes the client base `[0x468f38]`
  (magic `0x11875`) when idle past `0x1B58` ms.

### `attackScanAndFire` — `0x42176e` (641 bytes)

A second **attack driver** that scans a *different* client table first, then
confirms against the mirror.

- **Scan:** walks the client creature table from base `[0x468f20]` in stride
  `[0x468f9c]` up to `base+0x1100` (note: distinct base/stride from the `0x468f38`
  mirror), reading each entry via `sub_4011B8`. For a candidate re-reads id at
  `+0x20`, then **rescans** the mirror `[0x468f38]..[0x4db37ac]` (stride `0xE0`,
  id at `-4`) to confirm the target is still present.
- **Emits:** if confirmed, `sub_401217(id, 0xA1)` (**ATTACK**, `MB_SendAction`
  2-arg builder), then `Sleep([0x468f90]+0xFA)`.
- **Status handling:** reads the client status-message field `[0x468f44]`
  (`sub_401370`) and string-compares (`sub_44A4D0`) against
  `"This action is not permitted in a protection zone."` and **`"Target lost."`**
  to set a status byte and clear the message (`sub_4013BB`).
- **Abort:** returns 1 when `GetAsyncKeyState(VK_ESCAPE 0x1b)` is pressed.

### `runRuneAttackTargeting` — `0x40cee4` (3157 bytes)

The **rune/attack targeting-and-cast engine** (single tick, returns bool).
Throttled by `sub_44A7A8` (`clock()`) vs last-tick `[0x4db3aa4]` and interval
`[0x469058]`.

- **Reads:** target id `[0x4db3784]`, self coords `[0x468f30]`/`[0x4db372c]`/
  `[0x4db3728]`.
- **Sub-mode select:** from an enable-flag bank — single-target rune modes
  `[0x4db3aa0]`/`[0x4db3a9c]`/`[0x4db3a98]` vs area/multi modes
  `[0x4db3a8c]`/`[0x4db3a90]`/`[0x4db3a94]`; returns 0 if none set.
- **`[0x4db3a8c]` branch:** follows a target linked-list (`sub_401370` deref,
  `sub_401456` validity, name compare `sub_44A590`/`sub_44A4D0`), then scans the
  creature array filtering by id (`-4` vs self), monster type `sub_401041`,
  target-id `+0x20` vs self, alive `+0x88` vs cap `[0x4690f0]`, adjacency
  (`sub_44ACF5`). Picks a rune/spell id (default `0xc50`, or `[0x468fdc]` when
  `[record-1] != 0x40`) and calls dynamic builders `sub_4013F2` / `sub_401339`
  to emit the rune-use / attack frame.
- **Heal-self side path:** with mode `[0x4db3a9c]` and hp threshold
  (`[0x4db3790]` read, `> 0x46`) it fires the say-path `sub_44A6FB` formatting
  **`exura sio "%s"`**.
- **Post-cast:** `Sleep(10)`, re-reads status field `[0x468f44]` (`sub_401370`),
  compares (`sub_44A4D0`) against `"You cannot throw there."`,
  `"This action is not permitted in a protection zone."`,
  `"Destination is out of range."`; on none-matched reports via `sub_4010DC`
  (`0x469b5c`), and on a throw-error resets the throttle `[0x4db3aa4]`.
- **`[0x4db3a94]` branch:** a second creature-scan variant with an
  item-count/priority gate (`[0x4690f0]`, `0x64` cap, `[0x469094]`).
- **Opcodes** are built dynamically inside `sub_401339`/`sub_4013F2`, **not**
  immediates here **(unconfirmed byte layout)**.

### `recolorTargetCreatures` — `0x40f018` (989 bytes)

**Battle-list target highlighter** — writes into the client, emits no packet.
Throttled ~300 ms (`sub_44A7A8` vs `[0x4db3af8]`, gap `0x12c`).

- **Scan:** loops the creature array skipping records with flag `[record-1]==0x40`
  (note: this branch skips the monster-flag records, i.e. it targets the
  non-`0x40` set), off-name (`[record+0x20] != [0x468f30]`), hp `<1` (`+0x88`),
  or invisible (`sub_401041`).
- **Match:** name (`sub_401370`) against the enemy table `0x4cc8c60` (stride
  `0x64`, count `[0x469064]`) and, when enabled (`[0x4db3af4]`), a second id list
  `0x4d072bc` / table `0x4cb05c0` (count `[0x4db38d8]`).
- **Write:** on a match, `sub_4011BD` (WPM) paints recolor/priority bytes into
  the creature record — a color code (`0x5e`/`0x4f`/`0x4d`, chosen by the class
  array `[i*4 + 0x4caa7fc]`) into `+0x60`/`+0x64`/`+0x68`/`+0x6c`, plus
  mode-specific markers (`0x84`/`0xfb`/`0x80` into `+0x5c`, `3` into `+0x70`).
  This colours matched targets inside the client's own creature struct.

---

## Creature scan / scoring helpers

### `countWeightedMonstersNearPoint` — `0x4114ee` (425 bytes)

Monster-density / danger score around a tile `(x=[ebp+8], y=[ebp+0xc])`, type
`[ebp+0x10]`. Per node: skip self (`-4 == [0x4db3784]`), require alive
(`+0x88 >= 1`), type `+0x20 == [ebp+0x10]`, predicate `sub_401041`, flag
`-1 == 0x40`. Adds `+1` within box 3, `+2` within box 2 (Chebyshev via
`sub_44ACF5`) into `[ebp-4]`. Clamp: `count>10 → (count-10)/3 + 10`.

### `sumMonsterDistanceNearPoint` — `0x411697` (412 bytes)

Same scan/filter as above, but acceptance is `abs(dx)<=9 && abs(dy)<=9` (screen
box). For each accepted creature computes Manhattan `abs(dx)+abs(dy)`, keeps the
running minimum (seed `0x24`). Returns distance to the closest matching monster,
`0x24` if none.

### `isMonsterOnScreenSelf` — `0x411833` (374 bytes)

Boolean "is there a monster in my screen box on my floor". Scan skips self;
accepts `abs(cx-selfx[0x4db372c])<=7 && abs(cy-selfy[0x4db3728])<=6`, alive
`+0x88>=1`, floor `+0x20 == [0x468f30]`, `sub_401041`, flag `-1==0x40`. Returns 1
on first hit.

### `isMonsterWithinRangeSelf` — `0x4119a9` (612 bytes)

Same as `isMonsterOnScreenSelf` but both box half-extents are the caller radius
`[ebp+8]` instead of fixed `7/6`. Returns 1 if any matching monster is within N
sqm.

### `isCreatureInThrowRange` — `0x40aef2` (433 bytes)

Predicate: is a creature present, alive and within throw/cast reach. Reads target
id `[0x4db3784]` and self coords `[0x4db372c]`/`[0x4db3728]` (`sub_4011B8`), plus
three client scalars read directly from `0x4b03780`/`0x4b03782` (2 bytes) and
`0x4b03784` (1 byte) via `sub_44A9C0` (a target coord pair + flag byte). Iterates
the array: id `-4`, type `+0x20 == flag byte`, alive `+0x88 >= 1`, coords
`+0x28`/`+0x24`; range `abs(tx-cx)<=7 && abs(ty-cy)<=5` (`sub_44ACF5`), then calls
`sub_40115E(tx, ty, cy, cx, ...)` — a line/reachability sub-check — returning 1
only if that passes. Excludes own creature and self id `[0x4db3784]`.

### `computeTargetScreenX` — `0x407e11` (281 bytes)

Screen-to-map **X** projection for click/aim. Reads self x `[0x4db372c]`, self y
`[0x4db3728]`, target-x field `[0x4db37c0]`, creature base `[0x4db3708]` →
`node = ReadClientState(base+0x30)`, then node fields `+0x0`(px), `+0x4`, `+0x8`,
`+0xc`, `+0x3c`(span), `+0x34`(lo), `+0x38`(added to lo → hi). Interpolates
`result = selfX + ((px-lo)*0xf/(hi-lo)) - 7` — maps a viewport pixel into a
15-wide tile grid with self near column 7.

### `computeTargetScreenY` — `0x407f2a` (273 bytes)

Y counterpart. Same self anchors, target-y field `[0x4db37bc]`, same
`[0x4db3708]->+0x30` node and fields. Computes `result = selfY + (fieldC*0xb/span)
- 5` — projects into an 11-tall tile grid with self near row 5. Paired with
`computeTargetScreenX` to produce `(x,y)` aim coords.

---

## Open questions

- **targeting.txt → `0x4ce4d98` population.** `loadConfigLists 0x420393` names
  six files but not `targeting.txt`; the stride-`0x96` allow-list at `0x4ce4d98`
  is the confirmed *consumer* side (read by every selection engine via
  `sub_44A4D0`), but which loader writes `targeting.txt` into it is unconfirmed —
  likely a sibling loader or the GUI/Lua layer.
- **Dynamic rune/cast opcodes.** `sub_4013F2` / `sub_4012CB` / `sub_401339` build
  their frames from live RPM reads, not immediates; the exact rune-use / aimed-
  attack opcode bytes are unconfirmed (they are not in `.text`).
- **`0xA1` pre-step `sub_4014A1`.** Called in the `[0x469098]==1` (safemode)
  branch of `targetNearestCreatureAndAttack` instead of emitting — target
  validation vs stop-attack is unconfirmed in detail (matches the engine-core
  `0x4014d8`/`0x4014a1` TODO).
- **`recolorTargetCreatures` flag polarity.** It skips `[record-1]==0x40`
  (the monster flag the attack engines *require*), so it appears to paint the
  non-monster (player/NPC/enemy) set; confirm the intended target class.
