# Healer, looter, food & hotkey/rune subsystems (v10x)

MageBot v5.5's survival + farming logic lives in a band of per-tick loops around
`0x408xxx`–`0x41dxxx`. They are **consumers** of the RPM-polling mirror: none of
them touch the wire directly. Every one reads self scalars and the client's
container/creature tables through `MB_ReadClientState` (`0x4024a2`, thunk
`0x4011b8` = `sub_4011B8`) and emits actions through the `MB_SendAction`
builder family (thunk helpers `sub_40112C`/`sub_40123F`/`sub_4012CB`/`sub_4012DA`
/`sub_40105A`, all resolving into the `0x405f1d`→`0x40320a` pipe injector). The
engine drives these from the `MB_WinMain` region (`0x437aa5`–`0x43ba93`),
alongside `waypointWalker`/`dispatchTimerCallbacks`, on the `WM_TIMER`/Lua tick.

All addresses file-absolute at imagebase `0x400000`. Client-address globals in
the `0x4db3xxx`/`0x468fxx` bands are **resolved client addresses** (see
[functions/engine-core.md](functions/engine-core.md) §3), not values — a loop
that "reads `[0x4db3794]`" is passing that resolved address to `MB_ReadClientState`
which RPMs the client for the actual field.

---

## 1. Shared memory model these loops walk

Two client tables recur across every function here; both are polled and served
from the mirror caches described in engine-core §3.

**Creature array** — client base `[0x468f38]`, stride `0xE0`, id at entry `−4`,
per-entry flags/coords at `+0x4c`/`+8`. Used by `potionOnFriendTick`.

**Container/entity table** — client base `[0x468f2c]`, stride `0x1EC` per
container record, bound (end pointer) at `[0x4db377c]`. Per record:
`+0x30` = item/sub-entry count, `+0x34` = open/active flag. Item slots start at
`base + [0x468f5c] + 0x3b`, per-slot stride `0xC`; within a 12-byte slot the
item id is at `+1` and the stack count at `+0`. This exact walk is shared by
`healerAndReloader`, `containerFoodUseLoop`, `scanBattleListForUse`,
`pileLootStackableItems`, `castHotkeyOnMatchingCreatures`,
`walkAndCastAlongCreaturePath`, and the `ssaa` branch of `cavebotHealSafetyTick`
(same base, stride `0x1ec`).

Self scalars used for HP/mana math and range checks:

| Client-addr global | Field |
|---|---|
| `[0x4db3790]` | HP current (heal path in `0x41c274`) / also self band |
| `[0x4db3794]` | mana max (mana ratio denominator) |
| `[0x4db3798]` | mana current (mana ratio numerator) |
| `[0x4db37a8]` | HP max (heal path in `0x41c274`) |
| `[0x4db372c]` / `[0x4db3728]` / `[0x468f30]` | self x / y / z |
| `[0x468f90]` | generic per-action throttle (ms) passed to `Sleep` |

Note `cavebotHealSafetyTick` (`0x40850c`) uses a **different** self-scalar set —
HP-current `[0x4db3794]`, HP-max `[0x4db3798]`, mana `[0x4db37a8]`, level/cap
`[0x4db37b8]` — reflecting a different resolve pass than the reloader's. Both
compute `hp% = hpcur*100/hpmax`. (The `0x4db379x` addresses collide with the
guarded/XOR self band in engine-core §2; that band is resolved per build, so the
same global name serves HP vs mana depending on which loop resolved it —
**(unconfirmed which resolve wins at runtime)**.)

---

## 2. Data / control flow

```
        MB_WinMain tick (WM_TIMER / Lua SetTimerCallback)  [0x437aa5..0x43ba93]
                                   │
     ┌──────────────┬─────────────┼───────────────┬────────────────┐
     ▼              ▼             ▼                ▼                ▼
 healerAndReloader  cavebotHeal   potionOnFriend  food scanners    hotkey/rune
   0x41c274         Safety 0x40850c 0x40a10d      0x4166ab/0x41bc76 0x41d0e5/…
     │                │              │              │                │
  reads self hp%/mana%  hp%/mana%   follow-id      self x/y/z       container/creature
  via ReadClientState   +PZ/attack  [0x4db3784]    tile grid /      table walk
     │                  watch        creature arr   container slots  [0x468f2c]
     ▼                  ▼            ▼              ▼                ▼
  container walk       heal spell/  use-on-        MB_SendAction    MB_SendAction
  [0x468f2c] +0x1ec    potion +ssaa creature       (eat/use item)   (rune/hotkey
  ammo/spear/food ids  friend-follow (potion)                        on target)
     │                  │            │              │                │
     └──────────────────┴───────────┴──────────────┴────────────────┘
                                   │
                     MB_SendAction family (sub_40112C / _40123F /
                       _4012CB / _4012DA / _40105A)
                                   │
                     0x405f1d builder → 0x40320a injector
                                   │
                     fwrite → \\.\pipe\SamplePipe%i  → packet.dll re-emit
```

Opcodes observed emitted by this band (via the `MB_SendAction` helper's payload
byte): use-item `0x5`, use-on-target / action `0xA`, rune/use-on-target `0x13`,
and coordinate step/attack packets built by `sub_4012DA`/`sub_40105A`. These are
the *helper's* leading payload byte, not the raw Tibia network opcode; the final
frame is assembled in `0x405f1d`/`0x40320a` (engine-core §1, §5).

---

## 3. HP/mana thresholds & potion/rune id config

Thresholds and ids are loaded from the config text files at boot into the
`0x4690xx`/`0x468fxx`/`0x4db38xx` globals, then compared per tick. `SETTINGS.txt`
is the ordered scalar list (spell names + numeric thresholds); the Lua
`Set*IDS` setters overwrite the id slots at runtime.

**`SetManaPotIDS` `0x435f40`, `SetHealPotIDS` `0x435fdf`, `SetRuneIDS` `0x43607e`**
(not in the corpus slice; from [03-lua-api.md](03-lua-api.md)). Signatures per
`sample.lua`:

- `SetManaPotIDS(n,s,g,pally)` — mana-potion ids by vocation tier.
- `SetHealPotIDS(...)` — heal-potion ids.
- `SetRuneIDS(UH,SD,GFB,MWALL,ROPE)` — the rune-id set the cast loops key on.

These write the id slots that the heal/rune loops below compare against
(`[0x468fb0]` target-id, the hard-coded consumable id whitelists, and the
`ssaa`/`utamo vita` gates). The exact global each setter writes is **(unconfirmed
— setters outside corpus slice)**, but the *consumer* ids are confirmed as
immediates in the loop bodies (§4).

`SETTINGS.txt` decoded against the healer path (positional, from the shipped
sorcerer profile): light-heal / heavy-heal spell names (`exura`, `exura gran`),
attack spell (`exori vis`), the `SDMAX`/`AUTOSSA`/`MWALLCOMBO`/`AUTOGRANHUR`
toggles, then the numeric block `300 300 80 60 60 60 20 70 0` — the `80/70`
values are the HP/mana **percent thresholds** the loops compare `hp%`/`mana%`
against, and `heal`/`gmana` name the heal & mana-restore actions. `exura vita`
+ `7171` is the emergency-heal spell + its id; `UH 3 1` and `SD 20` are the rune
labels + counts feeding `SetRuneIDS`. The healer compares `hp%` against a
threshold scaled `*0x50/100` (i.e. ×0.8) before pausing — see `0x41c274` below.

---

## 4. Function-by-function walk

### `healerAndReloader` — `0x41c274` (size 2588)

The HP%/mana% healer plus the ammo/spear/food **reloader**.

- **Reads:** `hp% = [0x4db37a8](max) vs [0x4db3790](cur)`; `mana% =
  [0x4db3798]*100/[0x4db3794]` — all via `MB_ReadClientState` (`sub_4011B8`).
- **Heal pause:** when `hp%` falls under the configured light-heal threshold
  (local `ebp-0x10c` scaled by `0x50/100` = ×0.8) it pauses and prints
  `"HP is below your light healing %, Pausing"` via `sub_4010DC`. (String
  confirmed in corpus `strs`.)
- **Container reload scan:** walks the container table (base `[0x468f2c]`,
  stride `0x1ec`, limit `[0x4db377c]`, slots via `[0x468f5c]`) matching item ids:
  - `0xc4b` (ammo);
  - spear ids `0xccd` / `0x1cc7`, verified against the `"exeta con"` string
    (`sub_44A4D0` strcmp; logs `"spear loaded"` — both strings confirmed);
  - food/consumable ids `0xdfe,0xdf9,0xe8b,0xdff,0xdfa,0xe8d,0xe16`.
- **Emit:** on a match fires `sub_40123F`/`sub_40112C` (`MB_SendAction`
  use/move-item, helper payload bytes `0x5` and `0xa`) with `Sleep([0x468f90])`
  pacing.
- **Gates:** `[0x4db38a0]`/`[0x4db3878]`; rate stamps `[0x4db3cac]` / `[0x4db3834]`.
  `sub_44A680`(strlen)/`sub_401398` manage the `exeta-con` string buffers
  `0x4caa2ac` / `0x4d22410`.
- **Emits:** use-item (`0x5`) / move-item (`0xa`) packets for potions, ammo
  restock and food; no walk opcode.

### `cavebotHealSafetyTick` — `0x40850c` (size 7169)

The central heal + safety driver; the largest loop in the band. Returns 1 to
keep the tick alive.

- **Reads/timers:** self x=`[0x4db372c]`, y=`[0x4db3728]`, z=`[0x468f30]`; bumps
  loop counter `[0x4db3a40]`; runs a ~1s parity toggle `[0x4db39c8]`/`[0x4db39cc]`
  (clock via `sub_44A7A8`=GetTickCount) feeding a per-second gate `[0x4db3a00]`.
- **Safemode decoy:** while master enable `[0x469098]==0` and warmed up it
  computes `([0x4db39e0]/2)+0x4bb vs [0x4db39e4]` and early-returns — an
  anti-idle/decoy path that runs when actions are disabled.
- **PZ watch:** detects PZ transitions (`[0x4db379c]` bit `0x80` with
  `[0x4db39d0]`), prints `"PZ Gone"` (`sub_4010DC`/`sub_401050`), then
  `Sleep([0x4afd380])`. (String confirmed.)
- **HP/mana:** loads HP-cur `[0x4db3794]`, HP-max `[0x4db3798]`, mana
  `[0x4db37a8]`, level/cap `[0x4db37b8]`; clamps mana to `0xffff`; computes
  `hp% = hpcur*100/hpmax` and `mana%`. Selects heal spells/potions vs thresholds
  `[0x4690c4]` and flags `[0x4db3844]`/`[0x4db3848]`/`[0x4db3a04]`/`[0x4db3a08]`,
  then injects them.
- **Attack auto-reply:** scans the battle/message list (`[0x468f44]` via
  `sub_401370`) with `sub_44AF30` for `"due to an attack by"`; gated by
  `[0x4db3838]`/`[0x469050]`/`[0x4db3884]` + a 5000 ms cooldown `[0x4db3a48]`,
  builds an `"*%s*%s"` auto-reply (`sub_44A6FB`) and sends it (`sub_401320`).
  Optionally casts `"utamo vita"` (`sub_401398`) when `[0x4db39e8]==1`. (All
  three strings confirmed in corpus.)
- **`ssaa` friend-follow:** branch gated `[0x4db39f0]`, cooldown `[0x4690a8]`,
  container base `[0x468f2c]` stride `0x1ec`; walks open containers matching
  item `[0x4afd494]` (the "active item id" slot written by
  `setActiveContainerItemId` `0x4084e4`, which copies `[0x468fd0]`) and fires
  `sub_40123F` — logs `"ssaa loaded"` (confirmed).
- **Emits:** heal spell/potion use packets + the auto-reply chat send +
  `utamo vita` cast; the `ssaa` action.

### `potionOnFriendTick` — `0x40a10d` (size 680)

The `!potion!` friend/self potion-use pass.

- **Reads:** follow-id `[0x4db3784]`, self x=`[0x4db372c]`, y=`[0x4db3728]`,
  z=`[0x468f30]`.
- **Loop 1 (locate follow target):** creature array base `[0x468f38]`, stride
  `0xe0`, id at entry `−4`. Reads `entry+0x4c` (a flag); when set and
  `[0x4690b8]==0` it aborts (`return 0`) — a guard that skips potioning under
  some condition **(unconfirmed exact condition)**.
- **Loop 2 (select recipients):** rescans the array; range-checks each candidate
  vs self with `sub_44ACF5` (abs distance); formats debug `"testing potioning:%x"`
  / `"used !potion! on:%x"` (`sub_44A6FB`, both strings confirmed) and prints via
  `sub_40114F`. Emits the use-on-creature action via `sub_401339`; helpers
  `sub_401041`/`sub_40143D`.
- **Emits:** use-item-on-creature (potion) packet per in-range recipient.

### `containerFoodUseLoop` — `0x41bc76` (size 1534)

The throttled container-slot use loop (eat-food / consumable spam).

- **Gates:** counter `[0x4db3c90] < 0x4f` (clears `[0x46929c]`) and enable flag
  `[0x4db3c98] != 0`; rate-limited to once per `0x186a0` (100000) ms via
  last-fire stamp `[0x4db3834]` (`sub_44A7A8`=GetTickCount).
- **Walk:** container table base `[0x468f2c]` stride `0x1ec` up to `[0x4db377c]`;
  reads `+0x34` (open flag), `+0x30` (item count); each slot id at
  `base + [0x468f5c] + 0x3b + slot*0xc + 1`.
- **Predicate + emit:** an id passing `sub_4011D1` is used via `sub_40112C`
  (`MB_SendAction` use-item) **three times** with `Sleep(0x64)` between each,
  then re-stamps `[0x4db3834]` and prints status (`sub_40114F`). The triple-use
  with 100 ms spacing is the eat-food/consumable action.
- **Emits:** use-item (`0x5`) packets, ×3 per matching slot.

### `scanBattleListForUse` — `0x41bafa` (size 380)

Obfuscation-gated rune/spell-on-target dispatcher keyed off the polled entity
list.

- **Entry gate:** `xor [0x4db3c94] with 0x251`, `* [0x4db3c90] and 0xc7`,
  `mod 100`; proceeds only when remainder `== 0x1b`, and requires enable flag
  `[0x4db3c9c] != 0`, writing marker `0x659340` into `[0x469298]`. (An
  anti-tamper/self-check gate common to this band.)
- **Reads:** two client scalars via `MB_ReadClientState` (`[0x4db3768]`,
  `[0x4db3770]`) bounding a valid count `[2..9]`.
- **Walk:** record array base `[0x468f2c]`, stride `0x1ec`, limit `[0x4db377c]`;
  per record `+0x34` active flag, `+0x30` sub-count; per sub-entry reads id at
  `base + [0x468f5c] + 0x3b + i*0xc + 1` and a second field at `+0x40`.
- **Emit:** when the id matches the target in `ebp-0xc` it calls `sub_40123F`
  (`MB_SendAction`, opcode `0xa` payload) on that entry, then `Sleep([0x468f90])`.
- **Emits:** action-on-target (`0xa`) packet.

### `pileLootStackableItems` — `0x4169e0` (size 326)

The `"pile loot2"` routine — merges partial stacks of a configured stackable
loot item into full stacks. (Label logged via `sub_40114F`; string confirmed.)

- **Walk:** open containers base `[0x468f2c]`, stride `0x1ec`, end `[0x4db377c]`;
  per container checks open flag `+0x34` and item count `+0x30`, then each item
  slot base `+0x3b + [0x468f5c]`, per-item stride `0xc`, id at slot `+1`, stack
  count at slot `+0` (via `MB_ReadClientState`).
- **Match:** item id `== [0x468fb0]` (the configured target/loot id) **and**
  count `> 1 && < 0x64` (a partial stack, 2..99) **and** a full-stack reference
  (`count >= 0x64`) exists elsewhere.
- **Emit:** `sub_4012DA` with drag source (container index `ebp-4`, slot
  `ebp-0x1c`, id) and stack coords from `0x4ae9d00/04/08`, then `Sleep([0x468f90])`.
- **Emits:** move/drag-item (stack-merge) packet. Cross-ref: `[0x468fb0]` is the
  shared loot/target-id slot (also read by `castHotkeyOnMatchingCreatures`).

### `scanTilesForItemIdsThrottled` — `0x4166ab` (size 468)

The 500 ms-throttled tile-item scanner — fires a use action on nearby matching
ground items (eat food / use ground item).

- **Throttle:** `sub_44A7A8` elapsed since `[0x4db3bd0] >= 0x1F4` (500 ms).
- **Reads:** self x/y/z (`[0x4db372c]`, `[0x4db3728]`, `[0x468f30]`).
- **Grid walk:** 2×2 tile offset grid (`ebp-4`,`ebp-0x14` in 0..1); each tile's
  item-array base via `sub_40143D(offX,offY)`; reads tile stack count, iterates
  items with stride `[0x468f6c]` starting at `+0x2c`, id at item `+8`.
- **Whitelist:** `0x1074,0xfab,0xfcf,0xfd4,0xfd9,0xfb9,0x10be,0xfde,0x1010,
  0x10e1,0x10e4,0x10e7` — a fixed set of consumable/food type ids.
- **Emit:** on a hit calls `sub_4012CB(target=[0x469274], absX=self.x+offX,
  absY=self.y+offY, z=0, id, stackIndex)` then `Sleep(0x64)`.
- **Emits:** use-ground-item / eat-food packet.

### `castRuneOnCreaturesInContainer` — `0x41ce49` (size 668)

Rune/item-on-creature attack loop. ESC (`GetAsyncKeyState 0x1B`) aborts.

- **Snapshots (via `sub_4011B8`, 4-byte reads):** self coords `[0x4db372c]`/
  `[0x4db3728]`; pointers `[0x468f30]`,`[0x468ef4]`,`[0x4db3724]`,`[0x4db371c]`,
  `[0x4db3720]`.
- **Walk:** table base `[0x468f2c]`, stride `+0x1EC`, up to `[0x4db377c]`; per
  active slot (flag `+0x34 != 0`) reads slot id `+0x30`, iterates sub-entries
  with stride `[0x468f6c]` from `base+0x2C` to `base + count([−0x44])*[0x468f6c]`.
- **Match + emit:** for each sub-entry reads type/opcode at `+4`; if a valid
  creature-band id (`0 <= id < 0x65`, not the tile header at `+4`) it reads the
  target field at `+8` and calls the 6-arg builder
  `sub_40105A(0, id1, id2, x, opcode=0x13, target)` to emit a rune/use-on-target
  packet, then `Sleep([0x468f90])`.
- **Bounds:** `sub_44A7A8` timestamps bound per-slot scan `<= 0x44C` ms; if
  slot-id `+0x30` changed between passes it re-reads. `sub_4011C7(0)` resets a
  state flag before fallback `Sleep([0x468f90]+0x190)`.
- **Emits:** rune/use-on-target (`0x13`) packet.

### `castHotkeyOnMatchingCreatures` — `0x41d0e5` (size 1076)

Scans the creature/container table for a target id and fires a per-target
hotkey/action. ESC aborts (returns 0).

- **Walk:** base `[0x468f2c]`, stride `+0x1EC`, bound `[0x4db377c]`; per active
  slot (flag `+0x34`) walks inner entries (count `+0x30`) at
  `base + [0x468f5c] + 0x3B`, stride `0xC`, id at entry `+1`.
- **Match:** entry id `== [0x468fb0]` (shared target/loot-id slot).
- **Emit:** `sub_4012DA(index, [0x4db3718], [0x4db371c], [0x4db3720], matchId,
  matchIndex, 1)` — three live self scalars read through `MB_ReadClientState`.
  `Sleep(8)` (8 ms) between emissions.
- **Emits:** per-target action/hotkey packet.

### `walkAndCastAlongCreaturePath` — `0x41d519` (size 1229)

Movement + attack driver over the creature/tile table. ESC aborts (calls
`sub_4011C7(arg8)`, `Sleep([0x468f90]+0x64)`, returns 1).

- **Snapshots:** self x=`[0x4db372c]`, y=`[0x4db3728]`, z=`[0x468f30]`.
- **Mode:** param `ebp+0xC` selects mode; `== 0xA` is a special index-match mode.
- **Walk:** slots from `[0x468f2c]`, stride `+0x1EC`, bound `[0x4db377c]`; per
  active slot (flag `+0x34`) inner entries (count `+0x30`) at
  `[0x468f5c]+0x3B`, stride `0xC`, id at entry `+1`.
- **Blocklist:** entry ids filtered against skippable walkable-tile/ground ids
  `0x1CAE, [0x469038], [0x468fd4], [0x468fd8], 0xB37, 0xDB0, 0xB26, 0xB31, 0`, and
  the `0xB30..0xB40` band. Surviving ids deduplicated through a 20-slot recent-id
  ring buffer at `[0x4d7d684]` (ids) / `[0x4d7d634]` (hit-counts, cap `0x14`);
  least-seen slot evicted.
- **Emit:** on a match, builds a directed step/attack packet — mode `0xA` path
  calls `sub_4012DA(arg8, self.x+delta, ...)` with a quadrant offset from
  `(slot&3)`/`(slot>>2)`; otherwise `sub_40123F(arg8, mode+0x40, id, slotIdx,
  entry)` (a coordinate/target action). Logs the picked id hi/lo bytes via
  `sub_44A6FB` into buffer `0x4ce9430` then `sub_40114F`.
- **Non-match branch (id != 0):** walk helper `sub_40112C(arg8, id, slotIdx)`,
  `Sleep([0x468f90]+0x1F4)`, then `sub_40126C(arg8, mode)` to confirm arrival —
  returns 0 if it fails; returns 1 on the ESC path.
- **Emits:** step (walk) + coordinate/target attack packets. This is the loot/
  attack path-walker that overlaps the waypoint walker; the walk-direction
  opcodes it feeds go through the same `MB_SendWalk` (`0x404a9b`) single-byte
  `0x65`–`0x6C` frames (engine-core §6).

---

## 5. Config file cross-reference

| File | Consumed by | Fields |
|---|---|---|
| `SETTINGS.txt` | `healerAndReloader` 0x41c274, `cavebotHealSafetyTick` 0x40850c | ordered scalar block: light/heavy-heal spell names, attack spell, toggles (`SDMAX`/`AUTOSSA`/`MWALLCOMBO`/`AUTOGRANHUR`), numeric `hp%`/`mana%` thresholds (`80`/`70`), emergency `exura vita`+`7171`, rune labels `UH 3 1` / `SD 20`, teamserver host/pass |
| `itenids.txt` | looter (`pileLootStackableItems` 0x4169e0, target `[0x468fb0]`) + `SetAutoLoot` 0x435a3a | `id;valueTier//name` lines; the value tier column drives auto-loot include/skip |
| `targeting.txt` | targeting engine (feeds ids/spells the cast loops key on); `;99`=do-not-attack, `;9`=do-not-loot, `EXORIMAX` gate | `monstername;spell;priority` — priority = attack order (lower first) |

The hard-coded consumable/spear id whitelists inside `0x41c274`, `0x4166ab` and
`0x41bc76` are **compiled immediates**, not read from `itenids.txt` — that file
governs the *looter* value table, while the *eat-food/reload* whitelists are
baked into `.text`. The Lua `Set*IDS` setters are the runtime override path for
the potion/rune id slots the heal & cast loops compare against.

---

### Open items

- Which global each of `SetManaPotIDS`/`SetHealPotIDS`/`SetRuneIDS`
  (`0x435f40`/`0x435fdf`/`0x43607e`) writes — impls outside the corpus slice.
- `potionOnFriendTick` loop-1 abort condition (`entry+0x4c` flag set &&
  `[0x4690b8]==0`) — the exact game meaning of the `+0x4c` flag is unconfirmed.
- The `0x4db379x` self-scalar aliasing between `healerAndReloader` (HP at
  `[0x4db3790]`/`[0x4db37a8]`) and `cavebotHealSafetyTick` (HP at
  `[0x4db3794]`/`[0x4db3798]`) — confirm which resolve pass assigns which.
- Whether `scanBattleListForUse`'s `xor/mul/mod 100 == 0x1b` gate is a
  license/anti-tamper self-check or a probabilistic throttle.
