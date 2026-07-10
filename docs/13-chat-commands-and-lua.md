# Chat commands & Lua integration (v10x lineage)

The chat-command surface and the embedded Lua VM are the two *control inlets*
into MageBot's engines. Neither one has its own actuator: both terminate in the
same primitives documented in [engine-core.md](functions/engine-core.md) —
`ReadClientState` (`0x4024a2`) to read the mirror and `SendAction`/injector
(`0x405f1d`/`0x40320a`) to emit client→server frames. A chat command flips an
engine-control global (`[0x4db3axx]`/`[0x4db39xx]`) or pokes a spell string
into the send path; a Lua `Run()` function calls the 63 registered C globals
which do the same thing. This doc walks the eight functions that make up the
inlet: the chat-command dispatcher and chat-line parser, the Lua state
bootstrap + 63-global registration, the timer-callback tick that drives Lua
`Run()`s, the four-function script-slot manager, and the file-open dialog.

All addresses are `samples/v10x/magebotv55.exe`, imagebase `0x400000`. Grounded
in the corpus entries for these addrs plus the shipped
`samples/v10x/lua/script_loader.lua` / `utils.lua`.

---

## 1. Two inlets, one engine

```
 in-client typed line                        Lua script file (*.lua)
 (client chat buffer, RPM-read)              loaded into a script slot
        │                                            │
        ▼                                            ▼
 parseChatCommandAndSpells 0x41ebd0          loadScriptFileIntoSlot 0x43430d
   RPM-reads [0x4db3778] chat line             → Lua scriptloader(name,num)
   matches ".say/.move/.mana/.channel/         (compiles chunk into per-slot env)
    .stopfire/.stopfollow" + spell words              │
        │  (spell strings)                            │  registers callbacks:
        │                                             │  SetTimerCallback("Run")
        ▼                                             ▼
 chatCommandDispatcher 0x42dd58            dispatchTimerCallbacks 0x4377b4
   token match AUTORING/AUTOSSA/               engine tick: for each slot,
   PUSHMAX/LOGOUT/SDCOMBO/PING/...              for each registered name,
   sets engine-control globals                 lua_pcall dotimercallback(name,num)
        │                                             │  → scriptlist[num][name]()
        │                                             │     i.e. the Lua Run()/OnDraw()
        ▼                                             ▼
   engine-control globals [0x4db3axx]        63 C globals (AttackTarget, MoveTo,
        │  read by healer/combo/                UseSpell, CastRuneTarget, DrawText…)
        │  cavebot engine ticks                       │
        └───────────────┬─────────────────────────────┘
                        ▼
        ReadClientState 0x4024a2  +  SendAction 0x405f1d → injector 0x40320a
        (mirror read)               (opcode frame → \\.\pipe\SamplePipe%i)
```

The chat inlet is *imperative over toggles*: it never emits a packet directly
(except the spell forwarders). It writes booleans/timestamps into the
`0x4db3xxx` engine-control band; the healer / attack-combo / cavebot ticks in
the `MB_WinMain` region (`0x437aa5`–`0x43ba93`) read those and act. The Lua
inlet is *imperative over primitives*: `Run()` calls the C globals directly and
each funnels through `SendAction`.

---

## 2. Function walk

### 2a. `chatCommandDispatcher` — `0x42dd58` (size 10855)

The chat/hotkey command switchboard. Takes a command index in `[ebp+8]`
(`idx-1` → `[ebp-0xc]`), then runs a long chain of `sub_44AF30` (case-insensitive
substring/token match, the `strstr`-family thunk) against the argument buffer,
one immediate command string per branch. On a match it flips the relevant
engine-control global and, for most, prints a status line via `sub_4010DC` (the
DrawText/print thunk). Clears `[0x4db38fc]=0` and `[0x4690d8]=0` on entry.

Reads/writes: writes engine-control globals; **no** packet built here directly.
Reads client fields only in the `MWALLBEHIND` branch (see below). Ends every
branch with `jmp 0x4307b1` (common tail). Calls: `sub_44AF30` (token match),
`sub_4010DC` (print), `sub_44A590` (strcpy), `sub_44A6FB` (sprintf),
`sub_44A7A8` (GetTickCount-family clock), `sub_44AE5F` (atoi), `sub_4011B8`
(ReadClientState thunk), `sub_4012CB`, `sub_40143D`, `Sleep`.

Confirmed command → effect map (immediates in `.text`):

| Command token | Effect (global write) |
|---|---|
| `autosay` | copies arg → `[0x4af84dc]`, sets `[0x4db39a0]=0x32`, prints "Autosay %s On, Click Target to Activate", draws it |
| `PING` | writes marker bytes `40 21 20` into `[0x4d7d6d4]`, sets `[0x4db3de0]=1`, appends arg → `[0x4d7d6d7]` |
| `NEAR` | `[0x4db3ad0]=1` (targeting-distance mode) |
| `SDNEAR` | copies arg → `[0xdce048]` |
| `PUSHMAX` (in `SDNEAR` neighbour) | `[0x4db3ad0]=0` |
| `MWALLBEHIND` | reads follow-id `[0x4db3784]`, coord slots `[0x4db372c]`/`[0x4db3728]`, self `[0x468f30]` via `sub_4011B8`; computes a behind-target tile and emits a rune-cast frame via `sub_4012CB` (opcode `0xc6c` pushed), then `Sleep(0xa)` |
| `PAUSEBOT` | `[0x4db3948]=1` (injector throttle "paused" flag — suppresses sends, per engine-core §5) |
| `AUTORING` | ≥400ms-throttled toggle of `[0x4db3a08]` (ring-id from `sub_44AE5F(arg+9)`); "AutoRing On/Off" |
| `AUTOSSA` | ≥700ms-throttled toggle `[0x4db3a04]`; "AutoSSA On/Off" |
| `SDCOMBO` | ≥700ms-throttled toggle `[0x4db3a74]`; "sdcombo On/Off" |
| `STOPMANA` | `[0x4db3914]=1` — "Mana Refiller=OFF, press ESCAPE to turn ON" |
| `PUSHMAXD` | `[0x4db3928]=1`, `[0x469108]=-1` |
| `PUSHMAX` | `[0x4db3928]=1`, `[0x469108]=1` |
| `LOGOUT` | ≥700ms-throttled toggle `[0x4db39d0]`; "LOGOUTMAX ON/OFF" |
| `SSAFAST` | ≥700ms-throttled; copies `[0x468fd0]`→`[0x4afd494]`, sets ring interval `[0x4690a8]=atoi(arg+8)` (min-clamped 0x19→0x1f4), toggles `[0x4db39f0]`; "AutoSSAFAST On/Off" |

The pervasive `sub_44A7A8() - [0x4db3exx] >= <ms>` guard on the toggles is a
per-command cooldown (last-fire tick stored in the paired `[0x4db3exx]` slot).
These globals are exactly the ones the healer / attack-combo / auto-ring engine
ticks poll; the dispatcher is the *setter*, the ticks are the *readers*. The
`0xc6c`/`MWALLBEHIND` branch is the one place a chat command directly reaches
`sub_4012CB` (a packet builder) rather than only flipping a flag.

*(unconfirmed)* the exact source of the command index `[ebp+8]` — either the
hotkey table dispatch or a chat-line tokenizer; the caller isn't in this entry.

### 2b. `parseChatCommandAndSpells` — `0x41ebd0` (size 6083)

The in-client chat-line reader. Runs on a ≥500ms throttle
(`sub_44A7A8() - [0x4db3cec] < 0x1f4 → return 0`). Reads the client's chat/say
field directly by RPM: gates on `sub_4011B8(0x764434,1) == 0xAA` (a client-side
"line present" marker), clears it via `sub_4011BD`, then reads the chat-buffer
address `[0x4db3778]` and length prefix (`[0x4db3778]-2`, 2 bytes) and copies the
line text out with `sub_4012F3` (client-string reader) into scratch `0xdd6e80`.
The speaker name is read into `0x4d22278`. It then compares the line's leading
sender against the team roster table at `0x4ce4d98` (stride 0x96) to set an
"is-teammate" flag `[ebp-0x20]`.

Two dispatch classes:

1. **Team-relay spell words** — matched against immediates
   `exevo gran mas vis/tera/frigo/flam`, `exori gran`, `exevo mas san`,
   `utamo vita`, `utani gran hur`, … On a match (with ≥1000ms throttle vs
   `[0x4db3cec]` and enable-flag `[0x4db3ccc]==1`) it forwards the spell text to
   the say path `sub_401398` (say/UseSpell forwarder) or, if `[0x4694fc]==1` and
   not-self and `[0x4db3884]==1`, broadcasts `"*%s* %s %s"` (name, cmd, arg) via
   `sub_401320` (team-broadcast). This is the OTFollow/combo hotkey-broadcast
   relay: one leader's spell line is echoed to followers.

2. **Dot-commands** typed in chat:

   | Command | Effect |
   |---|---|
   | `.say` | say the text after offset +5 via `sub_401398`; if it starts with `*` route through `sub_401320` (broadcast) instead |
   | `.move` | `[0x4db388c]=1` (follow/move engaged), parse two atoi coords → `[0x4db3ac4]`/`[0x4db3ac8]` |
   | `.stopfire` | broadcast "*%s* stopping fire", zero `[0x4db39a0]`, `[0x4db3a5c]`, `[0x4db3ae4]`, `[0x4db3ae0]`, `[0x4db3cd0]` (kills autosay/combo state) |
   | `.stopfollow` | broadcast "*%s* stopping follow", `[0x4db388c]=0` |
   | `.channel` | set broadcast channel id `[0x46905c]=atoi(arg+9)`, call `sub_401005`, zero `[0x4db39a0]`/`[0x4db3a5c]` |
   | `.mana` | ≥1000ms-throttled call `sub_4011F9` (mana-share / report) |

   (further `.stopfire`/spell strings continue past the corpus cut.)

Reads/writes: RPM-reads the client chat line (`[0x4db3778]`, `0x764434`);
writes the same engine-control band as the dispatcher. Emits packets only
indirectly via the say/broadcast forwarders `sub_401398`/`sub_401320`/
`sub_401005`. Calls: `sub_4011B8`/`sub_4011BD` (ReadClientState + a
write-back/clear thunk), `sub_4011F9`, `sub_4012F3`, `sub_401320`, `sub_401398`,
`sub_401005`, `sub_44AF30`/`sub_44A590`/`sub_44A680`/`sub_44A6FB`/`sub_44A7A8`/
`sub_44AE5F`. This is a polled reader — it is one of the loops driven from the
`MB_WinMain` region, re-reading the client's chat field each tick.

Both 2a and 2b share the same `0x4db3xxx` control band, so a `.stopfire` typed
in-game and a `STOPMANA`/`AUTOSSA` hotkey command land in the same engine state
— chat and hotkey are two skins over one control surface.

### 2c. `initLuaStateAndRegisterApi` — `0x4369e2` (size 3092)

The Lua VM bootstrap. `memset`s a config block (`sub_44A750`), clears
`[0x4db3e60]=0` (the live-script count, §2f), then:

```
luaL_newstate()      → stored in global [0x61d5e0]  (the L, used everywhere)
luaL_openlibs(L)
lua_pushcclosure(L, <cfunc>, 0) ; lua_setfield(L, LUA_GLOBALSINDEX="0xffffd8ee", "<Name>")   ×63
```

`0xffffd8ee` = `LUA_GLOBALSINDEX` (-10002). The 63 `(pushcclosure, setfield)`
pairs are emitted back-to-back; the `cfunc` pushed is an incremental-link `jmp`
thunk in the `0x40100x`–`0x40153x` band and the string is the Lua global name.
This is the authoritative binding site for [03-lua-api.md](03-lua-api.md) — the
name→thunk map. Confirmed order (first ~40, thunk → name):

`0x437688 DrawText`, `0x4375f6 SetTimerCallback`, `0x43776a printtext`,
`0x40119a IsKeyDown`, `0x4014d3 GetCursorX`, `0x40146f GetCursorY`,
`0x401190 PrintError`, `0x401131 ReloadLua`, `0x4014c9 LoadFile`,
`0x40118b SaveFile`, `0x4013ac GetScriptInfo`, `0x40141a EnableScript`,
`0x4013a2 DisableScript`, `0x4014ce GetClock`, `0x40127b ListScripts`,
`0x40137f SetGuiParams`, `0x40122b GetScriptNumber`, `0x4014dd GetMaxContainers`,
`0x4012d0 GetContainerItems`, `0x401311 UseInventoryItem`,
`0x4011fe UseContainerItem`, `0x4014f6 UseSpell`, `0x40111d UseGroundItem`,
`0x40109b UseItemOnGround`, `0x401249 StopWaypoints`, `0x4012c6 StartWaypoints`,
`0x401023 SetStopPoint`, `0x401064 ClearWaypoints`, `0x4012f8 SetWaypointInfo`,
`0x401212 MoveTo`, `0x4013c0 StartAutoExplorer`, `0x4011e5 StopAutoExplorer`, …
(the corpus cut ends mid-table; the full 63 continue with the reads/combat/npc/
throw/id-config groups — see [03-lua-api.md](03-lua-api.md) §"Binding table").

Reads/writes: creates the global `L` at `[0x61d5e0]`; every other function in
this doc dereferences it. No packet, no RPM. This runs once from `MB_WinMain`
during boot (after attach, before the dialog pump).

The `LUA_GLOBALSINDEX` registration is the boundary: after it, everything the
scripts can do is the 63 C primitives. `script_loader.lua` and `utils.lua` build
the higher-level API (`GetCreatureData`, `SetWaypoint`, `scriptConfig`,
`Say`, `CastRuneXY`) as pure Lua wrappers over these — no extra native surface.

### 2d. `dispatchTimerCallbacks` — `0x4377b4` (size 753)

The engine tick that runs every script's registered Lua callbacks. This is what
makes `Run()` fire. Structured as two nested loops over the script-slot table:

```
for slot = 0 .. ([0x4db3e64] ? 1 : [0x4db3e60]):        ; outer: [0x4db3e60] = live-script count
    for name_i = 0 .. slot.callbackCount([slot*0xb9c + 0x5e40b0]):
        cbName = slot*0xb9c + name_i*0x100 + 0x5e36b0    ; the registered callback NAME string
        [0x4db3e54] = slot                               ; "current script" for GetScriptNumber
        lua_getfield(L, GLOBALS, "dotimercallback")
        lua_pushstring(L, cbName)                        ; arg1 = callback name (e.g. "Run")
        lua_pushnumber(L, slot)                          ; arg2 = script slot number
        lua_pcall(L, 2, 1, 0)
        if err: sprintf "%s crash:%s" → sub_4013F7 (print), lua_settop, sub_401424 (recover)
```

So the native side does **not** call `Run()` directly — it calls the Lua shim
`dotimercallback(name, num)` (defined in `script_loader.lua`, see §3), which
looks up `scriptlist[num][name]` and `xpcall`s it. `SetTimerCallback("Run")`
(a C global at thunk `0x4375f6`) is what stored the name `"Run"` into the slot's
callback-name table `[slot*0xb9c + 0x5e36b0]` that this loop walks.

Reads/writes: reads the slot table (stride `0xb9c`, name base `0x5e36b0`, count
field `+0x5e40b0`); sets `[0x4db3e54]` (current-script index, read by
`GetScriptNumber`), `[0x4db3e7c]`, and on crash `[0x4db3e78]=1`. Calls
`lua_getfield/gettop/pushstring/pushnumber/pcall/tolstring/settop`,
`sub_44A6FB`/`sub_44A590` (sprintf/strcpy), `sub_4013F7` (print),
`sub_401424`/`sub_4013F7` (error recovery). No RPM, no direct packet — packets
happen *inside* the pcall'd Lua as it calls the C action globals.

This tick is driven from the `MB_WinMain` dialog region (`WM_TIMER`, per
engine-core §6 open item), alongside the native healer/combo/cavebot ticks.
Each engine pass = native ticks + this one Lua tick.

### 2e. `loadScriptFileIntoSlot` — `0x43430d` (size 691)

Loads one script file into a slot and runs its top-level chunk. Guarded by
`[0x4db3e5c]==1` (Lua VM initialized) and, if `[ebp+8]==0`, calls `sub_4014BF`
(lazy init). Filename in `[ebp+0xc]`. Steps:

1. Trim the path: strip at the first `' '` (`sub_44B2E0` = strchr, `0x20`), then
   at `'\r'` (`0xd`) and `'\n'` (`0xa`) — normalizes a possibly newline-terminated
   filename.
2. Find a free slot: scan slots `0..0x50` (80 max), `sub_44A4D0` (strcmp) the
   filename against `[slot*0xb9c + 0x5e3520]` (the slot's stored path); on first
   free/empty match take it. **Slot stride `0xb9c`, path base `0x5e3520`.**
3. Mark slot live: `[slot*0xb9c + 0x5e40b8]=1`, store gui/config id
   `[0x4db3e68]`→`[slot*0xb9c + 0x5e3628]`, `sub_44A9C0` (memset/copy 0x78 bytes
   from `0x472e9c`) into `[slot*0xb9c + 0x5e362c]`.
4. If `[slot*0xb9c + 0x5e3624]==0` (not already loaded), invoke the Lua loader:

   ```
   [0x4db3e54] = slot
   lua_getfield(L, GLOBALS, "scriptloader")
   lua_pushstring(L, filename)
   lua_pushnumber(L, slot)
   lua_pcall(L, 2, 1, 0)                  ; → Lua scriptloader(name, num)
   ```

   On error, `lua_tolstring` the message → `0x5e3420`, `sub_4013F7` print,
   `[0x4db3e78]=1`.

So the native side hands the filename to the Lua `scriptloader(name, num)`
(§3), which `loadfile`s + `setfenv`s the chunk into a per-script sandbox env and
runs it — that top-level run is where the script calls `SetTimerCallback("Run")`
to register its tick callback. `dotimercallback` (§2d) then fires it every tick.

Reads/writes: the slot table (path `+0x5e3520`, live `+0x5e40b8`, config
`+0x5e3628/2c`, loaded `+0x5e3624`); `[0x4db3e54]`, `[0x4db3e68]`. Calls
`sub_4014BF`, `sub_44B2E0`, `sub_44A4D0`, `sub_44A9C0`, `sub_44A590`,
`sub_4013F7`, Lua C-API. No RPM/packet.

### 2f. `findScriptSlotByName` — `0x433af7` (size 101)

Slot lookup by filename. Linear scan `slot = 0 .. [0x4db3e60]` (live count),
`sub_44A4D0` (strcmp) filename `[ebp+8]` vs `[slot*0xb9c + 0x5e3520]`; returns
the matching slot index, or `-1` (`0xffffffff`) if none. Pure table walk — no
Lua, no RPM. Used by `EnableScript`/`DisableScript`/`ListScripts` and the reload
path to resolve a name to its `0xb9c`-stride slot. Confirms the slot-table
identity: stride `0xb9c`, path field at `+0x5e3520`, count global `[0x4db3e60]`.

### 2g. `resetScriptAndWaypointState` — `0x4341f7` (size 196)

The teardown / reload primitive. `memset`s a `0x3e80`-byte config block at
`0x61d5e8` (`sub_44A750`), then zeros a wall of state globals:
`[0x4db3e44]`, `[0x4db3e38]`, **`[0x4db3e60]=0`** (live-script count → all slots
dropped), `[0x4db3e6c]`, `[0x4db3e70]`, `[0x4db38e4]`; and conditionally (if
`[0x4db3d7c]!=0`) `[0x4db38bc]`, `[0x4db3838]`, `[0x4db3d7c]`, `[0x4db3e7c]`,
`[0x4db3e78]` — the waypoint/cavebot run-state band. Finally, if the Lua VM is up
(`[0x4db3e5c]==1` and `L=[0x61d5e0]!=0`): `lua_close(L)`, `[0x4db3e5c]=0`,
`sub_40103C`. Returns 1.

So this is "tear down the whole script subsystem": drop every slot, clear
waypoint/engine run-state, and close the Lua state. It is the back half of
`ReloadLua` — after this, `initLuaStateAndRegisterApi` (§2c) rebuilds `L` and
re-registers the 63 globals, and the loader re-reads the script files into fresh
slots. The co-clearing of the waypoint band shows the cavebot's live state
(current waypoint, hunting flag) lives outside Lua and is reset on reload.

Reads/writes: zeros the script-count + waypoint/cavebot control band; closes
`L`. Calls `sub_44A750` (memset), `lua_close`, `sub_40103C`.

### 2h. `openLuaScriptDialog` — `0x4241ad` (size 231)

The "open a script file" UI helper. Builds an `OPENFILENAMEA` on the stack:
default filename `"newscript.lua"` (copied via `sub_44A590` into the file
buffer), initial dir from `GetCurrentDirectoryA`, filter `"Lua Files"`, title
`"Open a file"`, flags `0x80000` (`OFN_EXPLORER`). Calls `GetOpenFileNameA`; on
cancel returns 0. On success it `ShellExecuteA`s the chosen path (verb NULL =
default "open") — i.e. it opens the selected `.lua` in the OS default editor
(Notepad), it does **not** load it into a slot. This is the "edit script" button,
distinct from `loadScriptFileIntoSlot` (§2e) which is the "run script" path.

Reads/writes: local `OPENFILENAMEA` only; no globals, no Lua, no RPM. Calls
`GetCurrentDirectoryA`, `GetOpenFileNameA`, `ShellExecuteA`, `sub_44A590`.

---

## 3. The script-slot model + `script_loader.lua` / `utils.lua`

The native slot table is a fixed array: **stride `0xb9c` bytes/slot, ≤ 0x50 (80)
slots**, with these confirmed fields (offsets are slot-base + global):

| Field | Meaning | Set by |
|---|---|---|
| `+0x5e3520` | script file path (strcmp key) | loader §2e step 2 |
| `+0x5e3624` | "already loaded" flag | loader (skip re-load) |
| `+0x5e3628` | gui/config id (`[0x4db3e68]`) | loader §2e step 3 |
| `+0x5e362c` | 0x78-byte config blob (from `0x472e9c`) | loader §2e step 3 |
| `+0x5e36b0` | callback-NAME table (stride 0x100 per name) | `SetTimerCallback` |
| `+0x5e40b0` | registered-callback count | `SetTimerCallback` |
| `+0x5e40b8` | slot-live flag | loader §2e step 3 |
| `[0x4db3e60]` (global) | live-slot count | loader++/reset=0 |
| `[0x4db3e54]` (global) | current slot (for `GetScriptNumber`) | loader / tick |

The native/Lua boundary is two Lua functions living in `script_loader.lua`, both
called by name via `lua_getfield`+`lua_pcall`:

- **`scriptloader(scriptname, scriptnum)`** — invoked by
  `loadScriptFileIntoSlot 0x43430d`. Creates a fresh per-script env table with
  `__index=_G`, `loadfile`s the chunk, `setfenv`s it into that sandbox, `xpcall`s
  it, and stores the env in `scriptlist[scriptnum]`. Each script therefore runs
  in an isolated global namespace but can read the shared globals (the 63 C
  funcs, `self`, `creatures`, `conts`, the `utils` API).

- **`dotimercallback(name, num)`** — invoked by `dispatchTimerCallbacks 0x4377b4`
  every tick. Marks `activescripts[num]=true`, then
  `f = scriptlist[num][name]; xpcall(f, handle_error)`. i.e. it fetches the
  named callback out of that script's sandbox env and runs it. `SetTimerCallback`
  is what put `name` (e.g. `"Run"`) into the slot's native callback-name table
  that the C loop iterates.

`utils.lua` sits *on top* of this as a normal loaded script. It hard-requires
LuaJIT (`if not jit then error(...)`, line 151 — the shipped `lua51.dll` is
LuaJIT) and, at load, registers its own tick with `SetTimerCallback("Util__Callback")`
(line 1441). `Util__Callback()` (line 189) fans out to `SendTickToLibraries()`
and `HandleOnDraw()` — so on every native tick, `dispatchTimerCallbacks` pcalls
`dotimercallback("Util__Callback", <utils slot>)`, which runs utils' library
ticks + all scripts' `OnDraw` handlers, and pcalls each user script's
`dotimercallback("Run", <that slot>)`. That is the whole chain from the C tick
to a user's `function Run()`:

```
WinMain WM_TIMER
  → dispatchTimerCallbacks 0x4377b4  (C loop over slots × callback names)
     → lua_pcall dotimercallback("Run", num)      (script_loader.lua)
        → scriptlist[num].Run()                    (user script's Run())
           → AttackTarget/MoveTo/UseSpell/CastRuneTarget/DrawText …  (63 C globals)
              → SendAction 0x405f1d → injector 0x40320a → pipe
```

`utils.lua`'s `scriptConfig(name, uid)` builder (line 574/943) is backed by the
C globals `SetGuiParams`/`GetScriptInfo` and is what draws the in-client script
menu; `script_loader.lua` also defines the read-wrappers (`GetCreatureData`,
`GetTarget`, `FixPlayer`, `FindItem`, `SetWaypoint`, `CastRuneXY`, `Say`) so the
`self`/`creatures`/`conts` mirror tables the docs reference are pure-Lua views
built by calling `GetPlayerInfo`/`GetCreatureInfo`/`GetContainerItems` each tick.
No extra native surface exists beyond the 63 registered globals — everything the
scripting layer exposes is either one of those or a Lua wrapper over them.

---

## Cross-refs

- The 63-global name→VA table: [03-lua-api.md](03-lua-api.md).
- `SendAction`/injector/`ReadClientState` primitives every callback funnels
  through: [functions/engine-core.md](functions/engine-core.md) §1–5.
- The `WM_TIMER` engine driver hypothesis for the tick: engine-core §6 open item.

## Open questions

- `chatCommandDispatcher 0x42dd58` caller: what produces the command index
  `[ebp+8]` — a hotkey table or an in-game chat tokenizer (the `.`-commands go
  through `parseChatCommandAndSpells` instead, so 0x42dd58 looks hotkey-fed).
  *(unconfirmed)*
- The `MWALLBEHIND` packet built via `sub_4012CB` with pushed `0xc6c` — confirm
  it is a rune-cast-on-tile frame and what opcode byte it lays down. *(unconfirmed)*
- Exact identity of `sub_401398` (say/UseSpell) vs `sub_401320`
  (team-broadcast) vs `sub_401005` (channel-set) — named here from the strings
  they consume, not yet from their bodies. *(unconfirmed)*
- Confirm `SetTimerCallback` (thunk `0x4375f6`) writes into the
  `[slot*0xb9c + 0x5e36b0]` name table + `+0x5e40b0` count that
  `dispatchTimerCallbacks` iterates (inferred from the loop's read layout; the
  impl body isn't in the corpus). *(unconfirmed)*
