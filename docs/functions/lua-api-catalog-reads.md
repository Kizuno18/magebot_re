# Lua API catalog — read / script / draw / input primitives

Offline recovery (capstone via `tools/disasm.py`) of the 31 MageBot v5.5 (v10x,
Tibia 10.x, Lua 5.1) globals that read the state mirror or drive the script
engine / HUD / input. Impl VAs from `recon/v10x_magebot.bindings.json`, resolved
past the `0x401xxx` jmp thunks. Signatures cross-checked against the shipped
`samples/v10x/lua/*.lua`.

> "Mirror" below means the bot's **RPM-polled cache**, not a wire-parsed copy.
> `ReadClientState` refills local caches by throttled batch `ReadProcessMemory`
> (creatures/containers ~50 ms, map ~5 ms) and reads self scalars live per call
> (XOR-deobfuscated). The `0x4db3xxx` / `0x468fxx` globals hold **resolved client
> addresses** (base pointers and per-field addresses inside `client.exe`), and the
> offsets/strides recovered here describe the *client's* struct layout. Band
> dispatch in [engine-core.md](engine-core.md) §2–3.

Every numeric field read goes through the `ReadClientState` helper
`0x004024a2` (thunk `0x4011b8`) — `ReadClientState(clientAddr, 4)` returns a dword
(from the RPM cache for creature/container/map addresses, or a live RPM for self
scalars), converted `fild`→double and pushed with `lua_pushnumber` (`0x44a45e`).
The `clientAddr` is loaded from one of the resolved-address globals below. Name strings are pushed with `lua_pushstring` (`0x44a46a`) from a
static char buffer, not through the dword helper. `_ftol` = `0x44b860`,
`luaL_checknumber` = `0x44a458`, `luaL_checkinteger` = `0x44a494`,
`luaL_checklstring` = `0x44a464`, `lua_gettop` = `0x44a470`,
`lua_pushnil` = `0x44a49a`.

| Global | Impl VA | Group | Args → | ← Returns |
|---|---|---|---|---|
| SetTimerCallback | `0x004375f6` | engine | name:str | — |
| GetScriptPause | `0x004339a9` | engine | — | pause:num |
| ResumeScripts | `0x004339cb` | engine | — | — |
| ReloadLua | `0x004348c8` | engine | — | — |
| LoadFile | `0x00434797` | engine | path:str | contents:str |
| SaveFile | `0x00434707` | engine | path:str, data:str | — |
| GetScriptInfo | `0x00433d1f` | engine | name:str | info:str |
| GetScriptNumber | `0x004348fe` | engine | — | n:num |
| EnableScript | `0x00433bc7` | engine | name:str | — |
| DisableScript | `0x00433c47` | engine | name:str | — |
| ListScripts | `0x00433dff` | engine | — | (script list) |
| SetGuiParams | `0x00434653` | engine | top:num, left:num, loaded:num | — |
| GetClock | `0x004348d4` | engine | — | t:num |
| Sleep | `0x004358f2` | engine | ms:num | — |
| DrawText | `0x00437688` | hud | text:str, x:int, y:int, color:num | — |
| printtext | `0x0043776a` | hud | text:str | — |
| PrintError | `0x0043487a` | hud | text:str | — |
| GetCursorX | `0x004345c0` | input | — | x:num |
| GetCursorY | `0x00434608` | input | — | y:num |
| IsKeyDown | `0x00433b5c` | input | vkey:num | down:num |
| PlaySound | `0x00433aa2` | input | "Beep"\|file:str | — |
| SetClipboard | `0x004361b7` | input | text:str | — |
| GetPlayerInfo | `0x00435046` | reads | — | 27 vals (self) |
| GetCreatureInfo | `0x004355f6` | reads | — | ≤60 vals (7/creature) |
| GetCreatureInt | `0x00436240` | reads | id:num | 14 vals |
| GetTargetInfo | `0x0043663a` | reads | — | 7 vals + nil |
| GetFollowInfo | `0x0043680e` | reads | — | 7 vals + nil |
| GetGroundInfo | `0x00435487` | reads | x:num, y:num | 2 vals |
| GetContainerItems | `0x00434920` | reads | contIdx:num | contnum,numitems,name,(id,num)* |
| GetMaxContainers | `0x00434ab1` | reads | — | max:num |

Mirror globals cluster in two bands: **self / creature scalars** in
`0x4db37xx`, **engine / script / HUD state** in `0x4db3exx`. Array base pointers
and the name buffer live in `0x468fxx`.

## Mirror anchors (shared)

| Addr | Meaning | Evidence |
|---|---|---|
| `0x468f38` | creature array base ptr | GetCreatureInfo/Int/Target/Follow iterate from here |
| `0x4db37ac` | creature count (loop bound) | `cmp ... [0x4db37ac]` / `jge` in every creature read |
| creature stride `0xe0` | per-creature record size | `add eax, 0xe0` in GetCreatureInfo loop |
| `0x468f30` | self name char buffer | loaded before self/creature name pushes |
| `0x468f34` | target-id source | GetTargetInfo `mov eax,[0x468f34]` |
| `0x4db37a4` | follow-id source | GetFollowInfo `mov eax,[0x4db37a4]` |
| `0x468f2c` | container array base ptr | GetContainerItems / GetMaxContainers |
| `0x468f5c` | container-item sub-array base | inner item loop |
| `0x4db377c` | container count (loop bound) | `cmp ... [0x4db377c]` |
| `0x4b28550` | max-containers constant | GetMaxContainers pushes it (0 in static image, runtime-set) |

---

## Self / creatures / world reads

### GetPlayerInfo — `0x00435046`

`local a = {GetPlayerInfo()}`. No args. 27 `ReadClientState`+`lua_pushnumber`
pairs followed by one `lua_pushstring` from the self-name buffer, `mov eax, 0x1b`
(27) `ret`. Wait — the terminal `mov eax` is `0x1b` = 27 total returns, the last
being the name string (the 27th push). The push order matches the `self.*` list
documented in `sample.lua` (lines 105–131):

| # | self field | mirror addr | # | self field | mirror addr |
|---|---|---|---|---|---|
| 1 | x | `0x4db3784` | 15 | exp | `0x4db3780` |
| 2 | y | `0x4db372c` | 16 | magiclevel | `0x4db3754` |
| 3 | z | `0x4db3728` | 17 | backpack | `0x4db374c` |
| 4 | id | `0x468f30`* | 18 | ring | `0x4db3750` |
| 5 | sx | `0x4db37b4` | 19 | ammy | `0x4db3770` |
| 6 | sy | `0x4db37b0` | 20 | arrow | `0x4db3768` |
| 7 | hp | `0x4db3798` | 21 | arrowct | `0x4db3764` |
| 8 | mp | `0x4db3790` | 22 | hand | `0x4db3760` |
| 9 | hpmax | `0x4db3794` | 23 | handct | `0x4db375c` |
| 10 | mpmax | `0x4db37a8` | 24 | handleft | `0x4db3758` |
| 11 | condition | `0x4db379c` | 25 | handleftct | `0x4db3744` |
| 12 | level | `0x4db37b8` | 26 | (extra) | `0x4db376c` |
| 13 | cap | `0x4db378c` | 27 | name (str) | `0x4caa2e0`* |
| 14 | (extra) | `0x4db3788` | | | |

`*` field 4's source is loaded from `0x468f30` (the name-buffer pointer band);
the name string at slot 27 is pushed from static buffer `0x4caa2e0` via
`lua_pushstring`, not through `ReadClientState`. The exact field labels for slots
4/14/26 follow the `sample.lua` self ordering but the two `(extra)` slots sit
between the documented `cap`/`exp` and `magiclevel`/`backpack` and are
**(unconfirmed)** in name — only their read addresses are certain. The mirror map
this recovers: the self scalar block is the contiguous `0x4db3728`–`0x4db37b8`
region, dword-strided but not densely packed (the bot reads specific offsets,
not a flat struct walk).

### GetCreatureInfo — `0x004355f6`

No args. Loops the creature array (base `0x468f38`, stride `0xe0`, bound
`[0x4db37ac]`), and for each *on-screen* creature pushes 7 values, capping the
total return count at 60 (`cmp [ebp-4], 0x3c` / `jle`). Per-creature fields, in
push order, match `creatures[i].*` in `sample.lua` (lines 160–167):

| offset in record | field | push |
|---|---|---|
| record−4 | id | num |
| … | x | num |
| … | y | num |
| … | z | num |
| … | hp | num |
| … | movespeed | num |
| record name field | name | str (via `0x401370`) |

Each field is fetched with `ReadClientState(recBase + off, 4)`; the loop advances
`recBase += 0xe0`. The per-record field offsets inside the `0xe0` stride are
computed from `[ebp-8]` (running record pointer) minus/plus small constants
(id at `recBase-4`); the name uses helper `0x401370` (thunk → `0x00402d4f`,
which reads `[0x4db377c]`-adjacent index and returns a char*). Return count is
the accumulated push counter in `[ebp-4]`, so a script does
`for` over the flat `{id,x,y,z,hp,ms,name, …}` tuple. This confirms the creature
mirror = an array of `0xe0`-byte records at `0x468f38`, length `[0x4db37ac]`.

### GetCreatureInt — `0x00436240`

`local a = {GetCreatureInt(id)}`. `luaL_checknumber`→`_ftol` pulls the creature
`id` (arg#1). Iterates the same array (`0x468f38` / `[0x4db37ac]`) to find the
matching id, then pushes **two** 7-field blocks (id,x,y,z,hp,movespeed,name)
= 14 returns. Second block is the extended/secondary creature view (same field
shape, different record offsets read via the same `ReadClientState` helper).
If no match, the early `cmp [ebp-4], 0` / `jmp 0x436636` path pushes `nil`.
The extra block's semantic field names beyond the first id/x/y/z/hp/ms/name are
**(unconfirmed)** — structurally it is a duplicate 7-tuple.

### GetTargetInfo — `0x0043663a`

No args. Reads the current attack-target id from `0x468f34`, locates its record
in the creature array, pushes 7 values (id,x,y,z,hp,movespeed,name) then a
trailing `lua_pushnil`; `mov eax, 1`… actually the final `mov eax, 1` at
`0x436805` is the *no-target* early return (1 value = nil). The full-hit path
falls through the 7 pushes + name + nil. `sample.lua` (lines 92–99) documents
the follow/target short form: `target.name/id/x/y/z/hp/movespeed`. Reads:

| field | source |
|---|---|
| id | `0x468f34` (target id) → matched record |
| x,y,z,hp,movespeed | creature record fields via `ReadClientState` |
| name | record name field via `0x401370` |

### GetFollowInfo — `0x0043680e`

Identical shape to GetTargetInfo but the id source is `0x4db37a4` (the follow
target id) instead of `0x468f34`. Same 7 values + name + trailing nil; same
no-follow early `mov eax, 1` / nil path at `0x4369d9`.

### GetGroundInfo — `0x00435487`

`local a = {GetGroundInfo(x,y)}`. Two `luaL_checknumber`+`_ftol` pull tile x,y
(args#1,#2). Reads self z/position anchors `0x4db372c` (self y) and `0x4db3728`
(self z) via `ReadClientState`, converts the requested tile to a mirror map
index (`0x44acf5` helpers + the name-buffer base `0x468f30`, and a tile-array
base bias `[0x468f6c]`), then pushes 2 values. From the `sample.lua` usage the
two returns are the ground/tile item id and stack/count at that tile. Pushes:
2 `lua_pushnumber` after resolving the tile record; a `lua_pushnil` guards the
out-of-range case. Return count 2. The two field semantics (itemid, count) are
inferred from usage, marked **(unconfirmed)** at the field-name level.

### GetContainerItems — `0x00434920`

`local a = {GetContainerItems(contIdx)}`. `luaL_checknumber`→`_ftol` pulls the
0-based container index (arg#1), bounds-checked against maxcontainers
`[0x4db377c]` (`jge 0x434aaa` → nothing pushed if out of range). Container
record base `[0x468f2c]`. Pushes, matching `conts[i].*` in `sample.lua`
(lines 169–174):

| push | field | source |
|---|---|---|
| 1 | contnum | container record (`[0x468f2c]` + idx) |
| 2 | numitems | container record |
| 3 | name (str) | via `0x401370` |
| then per item j | items[j].id, items[j].num | item sub-array `[0x468f5c]`, stride `0xc` |

Inner loop over items: `imul ecx, 0xc` addressing (12-byte item records), each
pushing id then num (`lua_pushnumber` × 2). Bound is the per-container `numitems`
(`cmp edx, [ebp-0x1c]` / `jge 0x434aa3`). So the mirror container layout =
header record at `0x468f2c` (contnum, numitems, name) + a `0xc`-byte item array
at `0x468f5c`.

### GetMaxContainers — `0x00434ab1`

No args. `ReadClientState([0x468f2c]+4, 4)` touches the container header, then
pushes the fixed constant `[0x4b28550]` (the compiled max-container count, 0 in
the static image, runtime-initialised). Returns 1 value.

---

## Script / engine control

### SetTimerCallback — `0x004375f6`

`SetTimerCallback("FnName")`. `lua_gettop` then `luaL_checklstring` (arg#1). The
callback-name string is stored into the engine slot `0x4db3e54` (the "current
script number / callback registry" cell — same global GetScriptNumber reads).
Registers the named Lua function as the script's periodic tick handler. No return.

### GetScriptPause — `0x004339a9`

No args. `fild [0x4db3e64]` → `lua_pushnumber`. `0x4db3e64` = the global
script-pause flag (non-zero when paused). Returns 1 value.

### ResumeScripts — `0x004339cb`

No args, no return. Clears the pause flag `0x4db3e64 = 0` and sets a cluster of
engine run-state cells: `0x4db38e4 = 1` (running), `0x4db38bc = 1`,
`0x4db3c4c = 0`, compares against `0x4db3e6c`/`0x4db3e70`, then calls the
scheduler kick `0x40132f`. This is the counterpart to the pause set by clicking
the GUI / DisableScript.

### ReloadLua — `0x004348c8`

No args, no return. Tail-calls `0x4014bf` — tears down and re-inits the Lua VM,
re-loading all enabled scripts (bound to the F10 hotkey in `script_loader.lua`).

### LoadFile — `0x00434797`

`LoadFile(path)`. `luaL_checklstring` (arg#1). Opens the file (CRT `fopen`/read
helpers `0x44af30`/`0x44a9a0`/`0x44b39c`/`0x44b2e0`), slurps it, and pushes the
whole contents as one string (`lua_pushstring`). Used by `script_gui.lua` to
reload a backup. Returns 1 string.

### SaveFile — `0x00434707`

`SaveFile(path, data)`. Two `luaL_checklstring` (arg#1 path, arg#2 data). Opens
for write (`0x44af30`/`0x44a9a0`), writes the buffer (`0x44a680`/`0x44a876`),
closes (`0x44a820`). No return.

### GetScriptInfo — `0x00433d1f`

`GetScriptInfo(name)`. `luaL_checklstring` (arg#1) → looks up the named script in
the loaded-script table (`0x44a750`/`0x44a590` hashing), builds an info string
(state / filename), pushes it (`lua_pushstring`). Returns 1 string. In
`script_gui.lua` the returned info is drawn next to each script name.

### GetScriptNumber — `0x004348fe`

No args. `fild [0x4db3e54]` → `lua_pushnumber`. `0x4db3e54` = the current
script's index/id in the engine registry (the same cell SetTimerCallback writes).
Returns 1 value.

### EnableScript — `0x00433bc7`

`EnableScript(name)`. `luaL_checklstring` (arg#1) → resolve via `0x401474`, mark
the script enabled and clear the per-script disable flag `0x4db3e68 = 0`, then
`0x4014ab` (activate). No return.

### DisableScript — `0x00433c47`

`DisableScript(name)`. `luaL_checklstring` (arg#1) → resolve via `0x401474`, then
zero a wide block of run-state cells: `0x4db38e4`, `0x4db3e6c`, `0x4db3e74`,
`0x4db3838`, `0x4db38bc`, `0x4db3e70`, `0x4db3d7c`. This is the inverse of the
ResumeScripts cluster — it halts that script's tick. No return.

### ListScripts — `0x00433dff`

No args. Walks the loaded-script table (`0x44b887` iterator, repeated `0x44af30`
string builds — one per slot) and returns the set of script names/entries to
Lua. Used to populate the GUI script list.

### SetGuiParams — `0x00434653`

`SetGuiParams(top, left, loaded)`. Three `luaL_checknumber`+`_ftol` (args#1–3):
HUD top y, left x, and the loaded-flag. Stores them into the engine's GUI layout
state (`0x44b59f`/`0x44a6fb`/`0x44b6e2`). No return. Drives where the script list
HUD renders (`script_gui.lua` / `script_loader.lua`).

### GetClock — `0x004348d4`

No args. Calls `0x44a7a8` (millisecond/tick source) → `lua_pushnumber`. Returns a
monotonic clock value used for script timing. 1 value.

### Sleep — `0x004358f2`

`Sleep(ms)`. `luaL_checknumber`+`_ftol` (arg#1). Pumps the engine (`0x44adb6`)
then calls Win32 `Sleep` (imported at `[0x5c5d568]`). Blocks the calling script
thread. No return.

---

## Drawing / HUD / input

### DrawText — `0x00437688`

`DrawText(text, x, y, color)`. Arg pulls, in stack order (arg#4 first):
`luaL_checknumber`(arg#4 color) → `luaL_checkinteger`(arg#3 y) →
`luaL_checkinteger`(arg#2 x) → `luaL_checklstring`(arg#1 text). Appends a draw
command to the HUD overlay list keyed on `0x4db3e7c` (the HUD draw-list cursor:
loaded, incremented, stored back). `color` is a 0xAARRGGBB dword (sample uses
`0xFF11EEDD`, `4294967280` = `0xFFFFFFF0`). No return; the text renders on the
next frame. Emitter helper `0x44b760`.

### printtext — `0x0043776a`

`printtext(text)`. `lua_gettop` then `luaL_checklstring` (arg#1) →
`0x4013f7` (the console/log sink). Writes to the bot's text console. No return.

### PrintError — `0x0043487a`

`PrintError(text)`. `luaL_checklstring` (arg#1) → stores through `0x44a590`, sets
the error flag `0x4db3e78 = 1`, then routes to the same console sink `0x4013f7`
as printtext. The flag marks the line as an error (distinct colour). No return.

### GetCursorX — `0x004345c0`

No args. Win32 `GetCursorPos` (`[0x5c5d714]`) + `GetWindowRect`
(`[0x5c5d784]`), computes cursor x relative to the Tibia client window, pushes it
(`lua_pushnumber`). Returns 1 value.

### GetCursorY — `0x00434608`

As GetCursorX but returns the window-relative y. Same two Win32 calls, 1 value.

### IsKeyDown — `0x00433b5c`

`IsKeyDown(vkey)`. `luaL_checknumber`+`_ftol` (arg#1 = virtual-key code). Calls
`GetAsyncKeyState` (`[0x5c5d70c]`), gated by `GetForegroundWindow`
(`[0x5c5d760]`) so the key only counts when the client window is focused. Pushes
the down state (`lua_pushnumber`). 1 value.

### PlaySound — `0x00433aa2`

`PlaySound("Beep")` or `PlaySound("file.wav")`. `luaL_checklstring` (arg#1),
compared against the literal `"Beep"` (`0x46e210`, `lstrcmp`-style `0x44a4d0`):
on match calls Win32 `Beep` (`[0x5c5d548]`), otherwise `PlaySoundA`
(`[0x5c5d7cc]`) with the string as a filename. No return.

### SetClipboard — `0x004361b7`

`SetClipboard(text)`. `luaL_checklstring` (arg#1) → stored via `0x44a590`, then
`0x401528` performs the Win32 clipboard open/empty/`SetClipboardData` sequence.
No return.

---

## Open items

- GetPlayerInfo slots 4/14/26 and the "extra" reads (`0x468f30` at slot 4,
  `0x4db3788`, `0x4db376c`) have certain read addresses but their field labels
  are inferred from `sample.lua` ordering — **(unconfirmed)** which exact
  self.* name maps to each. The self scalar block spans `0x4db3728`–`0x4db37b8`.
- GetCreatureInt's second 7-field block field semantics beyond the mirrored
  id/x/y/z/hp/movespeed/name are **(unconfirmed)** — structurally a duplicate
  tuple, likely a "previous frame" or extended view.
- GetGroundInfo's two returns are itemid + count by usage but not confirmed by a
  string/label in the binary.
- `0x4b28550` (max containers) reads 0 statically; its runtime value is set
  during client attach and not recoverable from the static image.
