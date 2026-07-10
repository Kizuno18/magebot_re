# Support region — `0x440000`–`0x465794` (MSVC CRT / STL)

The `.text` of `magebotv55.exe` (v10x) splits cleanly into two halves:

| Range | What | Coverage |
|---|---|---|
| `0x401000`–`0x440000` | **bot code** — 63 Lua impls (`MB_*`) + backbone + 222 catalogued bot functions | [catalog-bot.md](catalog-bot.md), [03-lua-api.md](../03-lua-api.md), [engine-core.md](engine-core.md) |
| `0x440000`–`0x465794` | **statically-linked MSVC C runtime + C++ STL** | this doc — boilerplate, not bot logic |

The upper region holds **~83 non-thunk CRT/STL functions** plus the import-thunk
stubs. It is confirmed boilerplate, not bot logic:

- **No bot signals.** Disassembly of the whole `0x440000+` band shows **zero**
  calls to `lua51`/`WSOCK32` imports and no references to the bot's client-address
  globals (`0x468fxx` / `0x4db3xxx`). Every cross-reference is CRT-internal.
- **CRT fingerprints present** in `.rdata`: the MSVC runtime-error table
  (`R6002` floating-point-not-loaded, `R6008` not-enough-space-for-arguments, …),
  the `Microsoft Visual C++ Runtime Library` banner, and a C++ `bad_alloc` string.
- The exe imports `msvcr100.dll` (VS2010) dynamically for most of the CRT; the
  in-binary functions here are the **statically-linked** portions the linker
  always emits (startup, `_ftol`, string/memory helpers, buffered stdio, the
  exception/`_purecall` machinery, locale glue).

Identified anchors (named in the IDB):

| Address | Name | Role |
|---|---|---|
| `0x0044b860` | `_ftol` | CRT double→int cast (used by every Lua numeric primitive) |
| `0x0044a458`+ | `luaL_checknumber` / `lua_pushnumber` / … thunks | the 18 `lua51` import stubs the bot calls through |
| `0x0044a750` | `memset` thunk | zero-init helper used across `WinMain` |
| `0x0044a9a0` / `0x0044a876` / `0x0044a820` | `fopen` / `fwrite` / `fclose` | the CRT stdio the named-pipe injector (`MB_InjectFrame`) uses |

**Scope decision.** These functions are off-the-shelf MSVC runtime, identical to
any VS2010 C/C++ binary; they carry no MageBot-specific behaviour. They are
labelled here as a class rather than documented one-by-one — the RE effort is
spent on the bot code below `0x440000`. If a specific CRT helper becomes
load-bearing for understanding a bot function, it is named inline where it is
called (e.g. `_ftol`, the `fopen`/`fwrite` pipe path in
[engine-core.md](engine-core.md) §5).
