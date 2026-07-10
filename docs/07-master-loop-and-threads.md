# Master loop & threading — magebotv55.exe (v10x)

How MageBot boots, attaches to the client, spawns its worker threads, and drives
the heal / combo / cavebot / timer engine. This is the control-flow spine that
sits above the four primitives in
[functions/engine-core.md](functions/engine-core.md) (MB_ReadClientState
`0x4024a2`, MB_SendAction `0x405f1d`, MB_InjectFrame `0x40320a`, MB_SendWalk
`0x404a9b`).

All addresses are `samples/v10x/magebotv55.exe`, imagebase `0x400000`. Boot-region
facts (entry, WinMain body, thread spawn, DialogBox) are Hex-Rays-confirmed in
engine-core.md §6; the six engine-tick bodies are grounded in
[functions/catalog-bot.md](functions/catalog-bot.md) at the addresses cited
inline. The v10x sample corpus tops out at `0x4377b4`, so the WinMain body
(`0x437aa5`+) and CRT entry (`0x44bf9f`) are read from the disassembler, not the
JSON corpus — flagged where a claim rests only on the doc.

---

## 1. The shape of the thing

MageBot has **no message pump**. `GetMessage`/`PeekMessage` are neither imported
nor called (engine-core.md §6). The process is structured as:

- **one MSVC CRT `WinMain`** that boots, licenses, attaches, spawns 5 worker
  threads, then **blocks** in a modal `DialogBoxParamA`;
- **5 `CreateThread` worker loops** — all input / intel / watch loops, none of
  them the state-mirror tick;
- **the game engine** (heal, combo/targeting, cavebot walk, Lua timers) is **not**
  on any of those 5 threads. It is driven from inside the modal dialog's window
  procedure via `USER32!SetTimer` → `WM_TIMER`, plus the Lua `SetTimerCallback`
  tick. The dialog thread is therefore the real master loop.

The RPM-polling state mirror is refilled **lazily on the calling thread** inside
MB_ReadClientState whenever a throttle window elapses (engine-core.md §3) — there
is no dedicated refresh thread. So "the engine tick" and "the state refresh" are
the same thread: whichever tick touches a creature/container/map address pays the
batch `ReadProcessMemory` if its timer is due.

---

## 2. Boot chain — entry `0x44bf9f` → WinMain `0x437aa5`

`0x44bf9f` is the stock `__tmainCRTStartup`: `GetVersion` → heap/IO init →
`GetCommandLineA` (`0x44c013`) → `GetModuleHandleA` → the WinMain thunk at
`0x44c068` (`call 0x40144c` → `0x437aa5`) with `WinMain(hInst,0,cmdline,nShow)`.

WinMain (`0x437aa5`, ~0x60xx bytes, ends `0x43ba8c`) boot order:

1. **Clear the gates.** `[0x4db38e0]=0`; `[0x469098]=0` at `0x437abd`. `0x469098`
   is the master **SendAction enable / safemode gate** — checked in
   MB_SendAction `0x405f23`, MB_InjectFrame `0x403249`, and the CastRune builder
   `0x4053aa`. It boots **OFF**: no packet leaves the process until the bot arms.
2. **First-run safemode gate.** Opens `safemode1st.txt` (`"a+t"`) and on first run
   `ShellExecuteA "notepad.exe"` to pop the note (`0x437ada`–`0x437b45`).
3. **Save `hInstance`** → `[0x4d22498]` (`0x437c0c`); memset several large stack
   config/timer blocks (`0x44a750` memset thunk).
4. **Machine-id for licensing.** `LoadLibrary("RPCRT4")` +
   `GetProcAddress("UuidCreateSequential")` (`0x437ca4`/`0x437cc5`); the
   sequential UUID is the `m=%d` machine-id in the tibiadb.com `key.php` /
   `addcomputer.php` requests (`v=55`). On a licensing failure it `MessageBox`es
   "The account that authorized this computer has been disabled" / "Internet
   Error" and jumps to exit `0x43ba8c` (`0x437f00`–`0x437f3c`).
5. **Attach to client** (block ending `0x4381d4`, engine-core.md §3): formats the
   injection pipe name `\\.\pipe\SamplePipe%i`, `SetPriorityClass(BELOW_NORMAL)`
   on self, then `OpenProcess(PROCESS_ALL_ACCESS, [0x4d22468] /*client PID*/)` →
   handle stored at `[0x4d22464]`. Every RPM/WPM in the process uses that handle.
   PID/HWND discovery (FindWindow/EnumWindows over `TibiaClient*`) precedes this.
6. **Resolve client field addresses.** Post-attach, the bot resolves each game
   field's address inside `client.exe` and caches it into the `0x4db3xxx` /
   `0x468fxx` bands (the "address-resolver init bank"). These globals hold
   **resolved client addresses**, not values (overview §"Memory-injection");
   the base pointers `[0x468f38]` (creature array), `[0x468f2c]` (container
   array), `[0x468f30]` (self z), `[0x4db372c]`/`[0x4db3728]` (self x/y),
   `[0x4db3784]` (follow/self id), `[0x468f34]` (target id) are the ones every
   tick below reads through MB_ReadClientState. (The individual resolver
   functions are not isolated in the sample corpus; treat the bank as "populated
   by boot before the dialog opens" — resolver call-site enumeration is
   **unconfirmed**.)
7. **Boot the Lua VM.** `initLuaStateAndRegisterApi` (`0x4369e2`, catalog-bot.md):
   `luaL_newstate` → `lua_State*` stored at `[0x61d5e0]` → `luaL_openlibs`, then
   ~30+ `lua_pushcclosure`/`lua_setfield` pairs install the MB_* globals
   (DrawText, SetTimerCallback, Use*, waypoint/MoveTo helpers, …), feeding the
   63-global surface in [03](03-lua-api.md). This is what makes the Lua
   `SetTimerCallback` tick (§4) live. (Call ordering of this vs. thread-spawn
   inside WinMain is **unconfirmed** — both happen in the boot body before the
   dialog blocks.)
8. **Spawn 5 worker threads** (`CreateThread`, `0x437f55`–`0x437fbd`; §3).
9. **Enter the modal dialog** `DialogBoxParamA` (`0x437e19`) — this **blocks the
   main thread** for the rest of the run and is where the engine tick lives (§4).

---

## 3. The 5 worker threads (CreateThread, engine-core.md §6)

These are **input / intel / watch** loops. None of them is the heal/cavebot/target
engine — that is the dialog tick (§4). Roles are Hex-Rays-confirmed in
engine-core.md.

| Thread impl | Name | Role |
|---|---|---|
| `0x0042b49a` | `MB_ThreadConfigDialog` | just `DialogBoxParamA(dlg 0x65, DialogFunc)` — a second GUI thread, not a poller |
| `0x0042b7ec` | `MB_ThreadWalkFollow` | arrow-key walker + follow tracker; reads VK 37–40 → walk dir, resolves follow id `[0x4db3784]` in the creature array; `Sleep([0x469590])` |
| `0x0042ba17` | `MB_ThreadNumpadWalkAim` | numpad walker (VK 97–105 → walk opcodes `0x65`–`0x6D` incl. diagonals) + auto-turn: when target `[0x4db38b0]` ≤3 sqm same-floor, forwards arrow VKs to the client |
| `0x00431ff6` | `MB_ThreadEnemyGuildScraper` | HTTP-scrapes `tibia.com/community` every ~120 s → `BigVIP.txt`/`enemies.txt`/`<world>_<guild>.txt` (pure `strstr` HTML parse) |
| `0x00421d0b` | `MB_ThreadInGameWatch` | spins until `ReadClientState([0x468f28]) == 11` (in-game), then `sub_401280([0x468f0c])` — connection/attach state watcher |

**Walk sender.** The two walker threads emit through **MB_SendWalk** (`0x404a9b`,
thunk `0x4011f4`): a 3-byte frame `[01 00 <dir>]` handed to MB_InjectFrame. Walk
opcodes are single-byte: `0x65`=N `0x66`=E `0x67`=S `0x68`=W, `0x69`–`0x6C` the
diagonals (engine-core.md §6; overview "Walk opcodes 0x65-0x6C"). The lower-level
arrow-key path `handleArrowKeyWalk` (`0x407491`, catalog-bot.md) maps arrow VKs
`0x26/0x27/0x28/0x25` → `0x65/0x66/0x67/0x68` and emits via `sub_4011f4`
(MB_SendWalk) when direct-walk mode `[0x4db3884]==1`, else drives the client
window through `sub_401163` with `Sleep(0x32)`.

---

## 4. The engine tick — the dialog's `WM_TIMER` driver (`0x437aa5`–`0x43ba93`)

With no message pump, the main thread blocks in `DialogBoxParamA` (`0x437e19`).
`USER32!SetTimer` is imported; the modal dialog owns a `WM_TIMER` that fires the
engine on a fixed cadence, and separately the Lua `SetTimerCallback` machinery
fires script timers. This `WM_TIMER` path is the master loop. (The exact
`DialogFunc` `WM_TIMER` dispatch table is not in the sample corpus — the *set* of
tick functions below is grounded in catalog-bot.md, but their **call sequence
inside DialogFunc** is inferred from their gates/throttles and is
**unconfirmed** at the dispatch-site level; engine-core.md §6 "Open items" flags
the same gap.)

The six routines the tick drives, each with its own clock()-based throttle and
enable gate so they self-pace regardless of dispatch order:

### 4a. `attackComboEngineTick` — `0x40fbd9` (catalog-bot.md)
The healer/combo caster + targeting driver. A **state machine** on mode selector
`[0x4db39a0]` (values ~0x13 / 0x31–0x3b / 0x65), gated by
`[0x4db39c8]`/`[0x4db39a0]`/`[0x4db390c]` and precondition `sub_40145B`.
Reads: self pos (`[0x4db372c]` y, `[0x4db3728]` z, name base `[0x468f30]`), follow
id `[0x4db3784]`, target id `[0x468f34]` — all via MB_ReadClientState.
Throttled by `clock()` (`sub_44A7A8`) against interval `[0x469058]` / stamps
`[0x4db3b18]`/`[0x4db3a18]`. Per state:
- **0x32** — single cast via `sub_401398(0x4af84dc)`.
- **0x33** — loop the creature array (base `[0x468f38]`, stride `0xE0`, bound
  `[0x4db37ac]`), LOS/range-check with `sub_4013F2`/`sub_4014D8`, convert tile with
  `sub_40143D`, read tile-stack `+0x34`, issue an aimed rune/attack via
  `sub_4012CB` (else stop-attack `sub_401339`) using rune-id `[0x4db3aec]`.
- **0x34** — name-match each creature (`sub_401370`) against a per-monster spell
  table at `0x4c8a2a8` (128-byte stride, count `[0x4db38d4]`) and cast the paired
  spell from `0x4c6a2a8`, falling back to literal `"exori frigo"`.
Every send is a chat/hotkey string cast (`sub_401398`) or a packet action, each
followed by `Sleep(0xA/0x32)`. **Emits:** aimed rune/attack packets and chat-line
casts (opcode `0xA1` ATTACK via the SendAction path; rune casts via the dynamic
CastRune builder).

### 4b. `healerAndReloader` — `0x41c274` (catalog-bot.md)
HP%/mana% healer + ammo/spear reload. Computes hp% from max `[0x4db37a8]` vs
current `[0x4db3790]`, mana ratio from `[0x4db3798]*100/[0x4db3794]` (all via
MB_ReadClientState). Pauses and prints `"HP is below your light healing %,
Pausing"` when hp < the light-heal threshold. Scans the container array (base
`[0x468f2c]`, stride `0x1ec`, limit `[0x4db377c]`) for item ids (potions `0xc4b`,
spears `0xccd`/`0x1cc7`, food `0xdfe`/`0xdf9`/`0xe8b`/`0xdff`/`0xdfa`/`0xe8d`/
`0xe16`). On a match fires `sub_40123F`/`sub_40112C` (MB_SendAction use/move-item,
opcodes **0x5** and **0xA**) with `Sleep([0x468f90])` pacing, gated by
`[0x4db38a0]`/`[0x4db3878]` and rate stamp `[0x4db3cac]`/`[0x4db3834]`.
**Emits:** USE (`0x5`) and MOVE_ITEM (`0xA`) packets.

### 4c. `waypointWalker` — `0x419c8c` (catalog-bot.md)
The cavebot walk driver (`"Near z change waypoint"`). Reads self x/y/z + stance
via MB_ReadClientState (`[0x4db372c]`=x, `[0x4db3728]`=y, `[0x468f30]`=z, plus the
`[0x4db3790/98/94]` hp-ratio guard). Walks the waypoint array at base
`0x4da3cf8`(x)/`0x4da3cfc`(y)/`0x4da3d00`(z), stride `0x10`, index `[0x4db3818]`;
caches current wp into `[0x4db3c78/7c]`. Computes a direction byte (1=N, 3/5/7 for
other axes by comparing self tile `[0x469278/7c]` to wp coords), validates the
step string (`sub_44A680` strlen) and dispatches via `sub_40146A` (the send-walk /
step emitter). Handles z-change waypoints, reached-target detection (match within
`0x384`/`0x578` ms of stamp `[0x4db3c8c]`), diagonal-corner smoothing
(`[0x4db3c5c]`), and honors pause counter `[0x4db3b44]`; paced `Sleep(0x14)`.
**Emits:** walk steps (opcodes `0x65`–`0x6C`) via the MB_SendWalk path.

### 4d. `dispatchTimerCallbacks` — `0x4377b4` (catalog-bot.md)
The Lua `SetTimerCallback` pump. SEH-wrapped (`fs:[0]` handler `0x4641da`). Outer
loop walks scripts up to `[0x4db3e60]` (script count, gated by `[0x4db3e64]`);
inner loop walks each script's registered timer entries (count at
`script*0xb9c + 0x5e40b0`, callback-id string at
`script*0xb9c + (entry<<8) + 0x5e36b0`). Per entry: record script index into
`[0x4db3e54]`, `lua_getfield(L, GLOBALS, "dotimercallback")`, push callback-id
(`lua_pushstring`) + script index (`lua_pushnumber`), `lua_pcall(L, 2, 1, 0)`. On
error: format via `sub_44A590`, emit through `sub_4013F7`, set crash flag
`[0x4db3e78]=1`, `lua_settop` reset, `sub_401424` (disable/cleanup); the non-error
tail builds a `"%s crash:%s"` message from the script name at
`script*0xb9c + 0x5e3520`. **Emits:** nothing directly — fires Lua callbacks that
may in turn call any MB_* acting global.

### 4e. `advanceAllTimerCounters` — `0x432d36` (catalog-bot.md)
The per-tick clock advance. Adds its single delta arg to ~70 accumulator globals
across two bands: the `0x468exx`/`0x468fxx` license+base band
(`0x468ee4`..`0x468f44`) and the `0x4db37xx` timing/state band
(`0x4db3708`..`0x4db37cc`), plus `0xdce040`/`0xdce044`. Returns 0. This is the
"age every counter/pointer by delta" step; every throttle the other ticks compare
against (`clock()` stamps, `[0x468f90]` sub-fields) is kept current here.
**Emits:** nothing — pure bookkeeping.

### Per-tick ordering (inferred)
No single dispatcher orders these; each self-gates. The functional order implied
by the gates/data-deps is:

```
advanceAllTimerCounters   (age all counters first — everyone reads these stamps)
      │
      ├─ healerAndReloader        (survival first; hp/mana gate)
      ├─ attackComboEngineTick    (combo/targeting; mode [0x4db39a0])
      ├─ waypointWalker           (cavebot movement; only when not paused)
      └─ dispatchTimerCallbacks   (Lua user scripts last)
```

Healer-before-attack-before-walk is the natural gate order (stay alive → fight →
move), but the actual `WM_TIMER` dispatch sequence inside `DialogFunc` is
**unconfirmed** (dispatch site not in the sample corpus). What *is* confirmed:
each tick is independently throttled by `clock()`/`GetTickCount` and gated by its
own enable global, so correctness does not depend on the order.

---

## 5. Data / control-flow

```
 CRT entry 0x44bf9f ──► WinMain 0x437aa5
   │  clear gate [0x469098]=0 (SendAction OFF)
   │  safemode1st.txt ─► ShellExecute notepad (first run)
   │  RPCRT4!UuidCreateSequential ─► machine-id ─► tibiadb.com key.php/addcomputer.php
   │  OpenProcess(client PID [0x4d22468]) ─► HANDLE [0x4d22464]
   │  resolve client field addrs ─► fill 0x4db3xxx / 0x468fxx bank
   │  initLuaStateAndRegisterApi 0x4369e2 ─► lua_State* [0x61d5e0], 63 MB_* globals
   │
   ├─ CreateThread ×5 ──────────────────────────────────────────────┐
   │    0x42b49a ConfigDialog     0x42b7ec WalkFollow                │
   │    0x42ba17 NumpadWalkAim    0x431ff6 EnemyGuildScraper         │  input/intel/watch
   │    0x421d0b InGameWatch                                         │  (NOT the engine)
   │                                                                 │
   └─ DialogBoxParamA 0x437e19  ◄── main thread BLOCKS here (no msg pump)
        │  SetTimer ─► WM_TIMER ─────────────────► engine tick:
        │       advanceAllTimerCounters 0x432d36
        │       healerAndReloader       0x41c274 ─► SendAction use/move (0x5/0xA)
        │       attackComboEngineTick   0x40fbd9 ─► attack 0xA1 / rune casts
        │       waypointWalker          0x419c8c ─► SendWalk 0x65–0x6C
        │       dispatchTimerCallbacks  0x4377b4 ─► Lua "dotimercallback" → MB_* acts
        │
        ▼ every read ─► MB_ReadClientState 0x4024a2 (RPM vs HANDLE [0x4d22464],
        │               lazy batch-refill of creature/container/map caches on this thread)
        ▼ every act  ─► MB_SendAction 0x405f1d ─► MB_InjectFrame 0x40320a
                        (gate [0x469098]==1) ─► fwrite \\.\pipe\SamplePipe%i
                        (packet.dll shim re-emits on the real socket)
```

Walker threads bypass the SendAction builder and go straight to
MB_SendWalk `0x404a9b` → MB_InjectFrame `0x40320a`.

---

## 6. Summary of the threading model

- **Main thread**: boots → licenses → attaches → spawns 5 threads → **blocks in
  the modal dialog**, which runs the game engine off `WM_TIMER` + the Lua timer
  pump. This is the master loop.
- **5 worker threads**: config GUI, arrow-key walk+follow, numpad walk+auto-aim,
  enemy/guild HTTP scraper, in-game-state watcher — input/intel only.
- **No `GetMessage`/`PeekMessage`** anywhere (imports confirm). The only "loop"
  that ticks the engine is the dialog's timer.
- **State refresh is not a thread** — MB_ReadClientState refills the batch RPM
  caches lazily on whichever thread reads a due creature/container/map address.
- **Everything acting** funnels through MB_SendAction / MB_SendWalk →
  MB_InjectFrame → `\\.\pipe\SamplePipe%i`, gated by `[0x469098]` which boots OFF.

---

### Open items (carried from engine-core.md §6)
- Confirm the `DialogFunc` `0x4013b6` `WM_TIMER` dispatch and the **actual call
  order** of the six ticks (dispatch site is beyond the sample corpus range).
- Enumerate the address-resolver init bank call sites that populate `0x4db3xxx`
  (the resolvers are not isolated as named functions in the sample corpus).
- Ordering of `initLuaStateAndRegisterApi` vs. thread-spawn inside WinMain
  (both pre-dialog; relative order unconfirmed).
