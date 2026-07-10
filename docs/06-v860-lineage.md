# v860 lineage — chat-command MageBot (TibiaMB)

`samples/v860/magebotv55.exe` is the second of the two magebotv55 lineages. It
targets **Tibia 8.60**, was built **2022-02-15** (`recon/v860_magebot.summary.json`,
`timestamp`), imports **no `lua51.dll`**, and carries **275 recovered functions**
(`n_functions`). Internally it brands itself **`TibiaMB %s`** (string @ VA
`0x4614xx` region) — the same product as v10x, minus the Lua control surface.

Same engine, different driver. Both lineages share the `ReadClientState`
RPM-polling reader (throttled batch `ReadProcessMemory` into local caches + live
self-scalar reads) and the `SendAction` command builder documented in the
backbone — neither binary has a server→client packet parser; the mirror is filled
by re-reading `client.exe` memory on a timer. Where v10x exposes 63 Lua globals,
**v860 has no interpreter at all**. It is driven by two inputs a human types or ships as
files:

- **in-client chat commands** — lines the player (or an allied "alert char")
  types into Tibia chat, prefixed with `.` — parsed straight out of the client's
  chat buffer.
- **settings / data files** — flat `.txt` config, `.bin` tile maps, and binary
  `.sav`/`.savd` cavebot recordings loaded from the MageBot directory.

Imagebase `0x400000`, clean MSVC, no packer. Imports match a screen-scraping
memory bot: `ReadProcessMemory`/`WriteProcessMemory`/`VirtualAllocEx`/
`CreateRemoteThread` (client injection), `BitBlt`/`GetDIBits` (tile reads off the
game window), `mouse_event`/`SetCursorPos`/`PostMessageA` (synthetic input),
`WSOCK32` (Team Server), `PlaySoundA` (the "beep if attacked" alarms).

## Chat-command dispatcher

The parser is a single linear `strstr`-chain over the client chat buffer at
global **`0x46d3d84`**. Every command handler is the same 6-instruction stanza,
laid out back-to-back across **`0x0041df85` … `0x0041f25b`** (`.text`). The head
of the chain (`.say`) at `0x0041df85`:

```
push  0x461290            ; ".say"
push  0x46d3d84           ; chat buffer
call  0x441230            ; strstr  -> ptr into buffer, or 0
add   esp, 8
mov   [ebp-4], eax
cmp   [ebp-4], 0
je    <next command>      ; miss -> fall through to ".move"
call  0x4413ad            ; GetTickCount
sub   eax, [0x86c3980]    ; time since last command
cmp   eax, 0x3e8          ; 1000 ms cooldown
jle   <next command>      ; too soon -> ignore
...                       ; skip token, act
mov   [0x86c3980], eax    ; stamp cooldown
```

Key facts, each grounded:

| element | value | evidence |
|---|---|---|
| chat buffer global | `0x46d3d84` | pushed as arg2 to every handler |
| `strstr` helper | `0x441230` | scans buffer for the command literal |
| `GetTickCount` thunk | `0x4413ad` | called before/after every handler |
| global command cooldown | `0x86c3980` (~1000 ms) | `cmp eax, 0x3e8` gate, shared by all |

Because matching is `strstr` (substring), not equality, longer literals must be
tested before their prefixes; the argument follows the command inline (`.attack`
skips 8 bytes to the name, `.say` skips 5, `.move` skips 6).

Command literals and their handler VAs (push-imm xref):

| command | literal VA | handler VA | effect |
|---|---|---|---|
| `.say`  | `0x461290` | `0x0041df85` | speak the trailing text; leading `*` picks a private channel |
| `.move` | `0x461298` | `0x0041dff1` | manual step; sets `[0x86c3524]=1` |
| `.stopfire` | `0x4612a0` | `0x0041e06d` | stop autofire — `*%s* stopping fire` |
| `.stopfollow` | `0x4612c0` | `0x0041e0e5` | stop follow — `*%s* stopping follow` |
| `.channel` | `0x4612e4` | `0x0041e135` | open channel N (`.channel 10`) |
| `.mana` | `0x4612f0` | `0x0041e19d` | mana query/report |
| `.follow` | `0x461338` | `0x0041e357` | follow char — `*%s* Follow set on :%s: id:%i` |
| `.otfollow` | `0x4613b4` | `0x0041e7ba` | arrow-key follow — `*%s* OT style follow set on :%s: id:%i` |
| `.attack` | `0x4613e8` | `0x0041e917` | attack char — `*%s* Attack set on :%s: id:%i` |
| `.sd` | `0x461410` | `0x0041ea97` | rune a target (`.sd enemy` skulls, `.sd all` non-safelist) |
| `.mwall` | — | `0x0041ee?? region` | magic-wall combo trigger |
| `.players` | `0x46155c` | `0x0041f25b` | list players on screen — `::%s<hp>%i<z>%i` |
| `.log` | `0x461330` | `0x0041e276` | switch controlled character (`.log 1`) |

The `.attack` handler (`0x0041e917`) is representative: after the cooldown gate
it walks the client's creature array via RPM — the local slot `0x45ff0c` holds
the resolved base address inside `client.exe`, **stride `0xA8`**, count from
`0x86c3440` — `strcmp`-ing the typed name against each record read from the
client, then arms the target and emits `*%s* Attack set on :%s: id:%i`. So chat
commands act on the same client memory the RPM reader touches; they just replace
Lua's `Get*`/`AttackTarget` calls with a hard-coded name lookup.

The help/manual text spells the vocabulary out verbatim (strings @ ~L456):

```
 .say text
 .follow charname (.follow 0 to stop)
 .otfollow charname(uses arrowkeys)
 .stopfire
 .sd charname(.gfb + .hmm also work)
 .sd enemy(shoots skulls)
 .sd all (shoots non-safelist)
 .attack charname
 .players
 .channel 10(starts with 10)
 .mov x y(example .mov -1 4)
 .log (switches to the next character down .log 1 forthe next one up)
```

`.gfb` and `.hmm` are aliases into the `.sd` handler (great fireball / heavy
magic missile). Team-wide broadcast of these commands is the *"OTFollow mode"* /
*"All clients following the main client will respond to attack commands"* feature
(string @ L420) — issued through the Team Server, not locally.

## Healer

No spell scripting; the heal config is checkbox-driven and named by the literal
spell words it will `say`. The self/friend healer picks from a fixed spell menu
and pauses under a mana floor:

- self-heal spells: `exura`, `exura gran`, `exura vita`, `exura san`,
  `exura gran san`, `exura ico`, `exura gran ico`, `exura sio` (strings @ L98–110).
- friend/VIP heal: **`exura sio "%s"`** (targeted, L129) — *"Bot heals all players
  in VIP marked with a heart using EXURA SIO"* / *"Auto Heal Vip Characters with
  Heart Symbols"*.
- rune fallback: `sheal`/`gheal`/`uheal` (L375–377) — *"Change heavy and Light
  Healing Spells to UH runes"*.
- mana potions: `pmana`/`smana`/`gmana` (small/strong/great) — *"Restoring mana
  to %d using %s MP Potions"*, *"SSAs will be loaded below 80% mana"*.
- mana floor: **`HP is below your light healing %, Pausing`** (L214) — below the
  configured light-healing threshold the bot stops acting to conserve mana.

The `.follow`-set confirmations also announce the heal mode bound to a target:
`*%s* UH Heal set on :%s: id:%i` and `*%s* exura sio Heal set on :%s: id:%i`
(L255–256), i.e. the same name-lookup path that arms an attack can instead arm a
per-target heal.

## Targeting

Autoattack targets come from **`targeting.txt`** (a flat allow-list of monster
names): *"Character will autoattack monsters in Targeting.txt"* (L421). The
targeting loop annotates its own state:

- `Target lost.` (L307) — current target left range / died.
- `EXORIMAX` hotkey → *"AutoFire (exori frigo,exori tera,...) targeting.txt"*
  (L619) — area spells cycled against the targeting list.
- combat AoE spell menu present as literals: `exevo gran mas vis/tera/frigo/flam`,
  `exevo mas san`, `exori gran`, `exori vis`, `exori mort`, `exori frigo`.

The right-hand **Creaturelist** combo (`COMBOBOX`, L347) assigns a per-creature
behaviour mode, one of: `Normal`, **`Dodge/Hotkey`**, **`Cave_Run/Hotkey`**,
**`Open_Run/Hotkey`**, `Turn/Face`, `Paladin Run`, `Paladin Melee` (L349–355,
L384–392). "Dodge" = kite away; "Cave_Run"/"Open_Run" = run to the next
cave/open waypoint on contact; each can be bound to a hotkey.

## Waypoint recorder & cavebot

The v860 cavebot is a **recorder**, not a text script. The bot records the
player walking a route and replays it. Recorder strings:

- `Recording` / `Record done. Saving Record.` / `Loading Record` (L561–569).
- `Action Recorded` (L80), `RECORDACTION` → *"Do Action Now, and it will be
  recorded in Script"* (L607–608) — inline actions captured mid-route.
- `recording %i %i %i %i` (L177) and `moving from %i %i %i waypt %i to %i %i %i`
  (L205) — waypoints are `(x, y, z, wpIndex)` tuples.
- `Near z change waypoint` / `doing z wait` (L198) — special handling for
  floor-change tiles (ladders/ropes/holes), where the replayer must wait for the
  z-transition before continuing.
- deposit sub-script: *"Check this while recording a deposit script, from hunt to
  bank and hit save"* (L432) → `Starting deposit` / `Deposit Complete. Restarting
  Script` / `Deposit all` (L200–203). A same-named deposit `.sav` runs at the
  bank leg of the hunt.

### Recording file format

| file | role | evidence |
|---|---|---|
| `record.sav` | active/temp recording buffer | L556, L563, L566 |
| `*.sav` | saved cavebot recordings (binary) | file dialog filter `Sav Files`, `*.sav` (L558–559) |
| `.savd` | deposit-script variant of a `.sav` | L564 |
| `recordnons.dat` | non-script recorder data | L795 |

Save/open go through `comdlg32` (`GetSaveFileNameA`/`GetOpenFileNameA`), filter
labelled `Sav Files`. The `.sav`/`.savd` payload is binary (`FileLoad size %i`
logs a byte count on load); the internal tuple layout is `recording %i %i %i %i`
= `(x, y, z, waypt)` plus captured action records — the exact record framing is
not yet reversed (unconfirmed).

## Looter

Container-walking looter, driven by item-id lists and screen coordinates:

- `pile loot2` (L178) / *"This makes a 2nd lootpile if u need it"* (L430) — a
  second loot backpack.
- `chking looter open %x` (L179) — verifies the loot container handle is open.
- `opentosser` / `You cannot put any more objects in this container.` — the
  overflow/tosser path.
- corpse walk: `opencontid %x posit %i:: %i %i mouse %i %i`, `bag opened %x %x`,
  `found iten`, `baditen %x`, `This object is too heavy.` — the looter opens a
  corpse, reads item ids, and drag-drops matching ids into the loot pile via
  synthetic mouse events.

Loot ids come from **`itenids.txt`** (and the OT-server variant `otitenids.txt`,
L279–280) — note the misspelling "iten", used consistently across the binary.

## Settings & data files

All flat files live in the MageBot directory (help text references
`c:\program files\magebot\friends.txt`). Each is logged as `FileLoad size %i` on
load. The `SETTINGS.txt` / `sorcererSETTINGS.txt` pair is the main config;
`sorcererSETTINGS.txt` is the vocation-specific variant (the sorcerer profile —
this lineage's UI targets mages, cf. *"Mages should try the new hotkey
EXORIMAX"*).

| file | contents |
|---|---|
| `SETTINGS.txt` | main config (checkbox state, thresholds, spell choices) |
| `sorcererSETTINGS.txt` | sorcerer-profile config variant (not in v860 string table by that exact name — inferred from the SETTINGS + vocation UI; **unconfirmed**) |
| `config.txt` | secondary/UI config (L358) |
| `customhotkeys.txt` | user hotkey bindings (L286) |
| `targeting.txt` | autoattack monster allow-list (L291) |
| `itenids.txt` / `otitenids.txt` | loot item-id lists (L279–280) |
| `pzzones.txt` | protection-zone tile coordinates (L293) |
| `safelist.txt` | do-not-attack player names (L295) |
| `enemies.txt` / `friends.txt` | Team-Server enemy / heal-friend lists (L284, L289) |
| `tradehelper.txt` | NPC buy/sell helper table (L282) |
| `rsa.txt` | RSA key material for the login/proxy path (L341) |
| `iplist.txt` | server IP list (L343) |
| `bigVIP.txt` | on-screen VIP overlay list (help text @ L400 region) |
| `nav1st.txt` | AutoExplorer navigation data (L312–314) |
| `lognoobs.txt` | mass-login character list (L570) |

### Binary tile maps (`.bin`)

The pathfinder consumes precomputed tile grids, loaded as raw `.bin` blobs
(`FileLoad size %i` each):

| file | role | evidence |
|---|---|---|
| `stoptiles.bin` | tiles where the cavebot must halt | L297 |
| `blktiles.bin` / `blkktiles.bin` | blocking (impassable) tiles | L299, L302 |
| `mtiles.bin` | movement / walkable tiles | L304 |

`blktilesbin.txt` (L301) is the text source the `blktiles.bin` is compiled from.
Runtime tile-classification traces confirm the pathfinder reads these as a
blocking/goodtile grid: `blkingtile %x`, `goodtile %x %x`, `mpsq %x`,
`Push found %d %d %d %d`, `Blk Random`, `Going to %d:%d:%d distance:%d val:%d`.

Note: the assignment listed `conttiles.bin` — **not present** in the v860 string
table. The three tile classes shipped are stop / block / movement; there is no
container-tile map in this build (confirmed by absence).

## Contrast with v10x

Same core, different mouth. Both builds share: the big `.data` BSS (~92 MB v10x /
~156 MB v860) holding the RPM-polled client-state caches plus bot buffers, the
`ReadClientState` reader that refills those caches by throttled batch
`ReadProcessMemory` from `client.exe` (no server→client packet parser — it never
sees the wire), and the `SendAction` command builder that injects client→server
Tibia packets. They diverge only at the **control surface**:

| axis | v10x (2017) | v860 (2022) |
|---|---|---|
| Tibia target | 10.x | 8.60 |
| control language | Lua 5.1 (`lua51.dll`, 63 globals) | chat commands + files |
| cavebot | Lua waypoint scripts | `.sav`/`.savd` binary recordings |
| targeting | Lua callbacks | `targeting.txt` + Creaturelist combo |
| looting | Lua `Loot*` calls | `itenids.txt` + corpse-walk looter |
| heal logic | Lua-scripted | checkbox config + fixed spell menu |
| extensibility | scriptable | fixed feature set |

The 2022 v860 build is the *later* one but the *simpler* interface — it dropped
the embedded interpreter and shipped a self-contained mage-focused feature set
wired to a UI and flat files. Same Team Server backend (`WSOCK32`, `TibiaMB`,
`tibiadb.com`) as documented in the backbone.

## Open questions

- **`.sav`/`.savd` record framing.** We know the tuple is `(x, y, z, waypt)` plus
  action records and that load logs a byte size, but the on-disk record layout,
  action opcode set, and how the deposit `.savd` differs structurally are not yet
  reversed. Next: hook `CreateFileA("record.sav")` → the parser and dump a small
  recording to correlate bytes to the `recording %i %i %i %i` trace.
- **`.mwall` handler VA.** Its literal is at `0x461??` and it falls in the
  `0x0041ee` region of the chain but wasn't isolated by a single push-imm xref;
  needs a direct disasm pass of that stanza.
- **`sorcererSETTINGS.txt`.** Referenced by the assignment and consistent with
  the vocation-specific UI, but the exact filename literal was not found in
  `recon/v860_magebot.strings.txt`; the config it loads is `SETTINGS.txt` /
  `config.txt`. Confirm whether the sorcerer variant is a runtime-composed name
  (`%sSETTINGS.txt`) or absent in this build.
- **`.bin` tile-grid encoding.** Cell size and coordinate origin of
  `stoptiles.bin`/`blktiles.bin`/`mtiles.bin` are inferred from the `blkingtile
  %x` traces, not from the loader; disassemble the `FileLoad`-adjacent parser to
  fix the stride.
