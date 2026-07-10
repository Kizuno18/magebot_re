# packet.dll — the injected client-side send/hook primitive

`packet.dll` is the piece MageBot writes *into the Tibia client* process. The exe
is the brain (RPM state reads, Lua, licensing) — it reads client memory with
throttled batch `ReadProcessMemory` into local caches plus on-demand reads (the
RPM-polling mirror, [functions/engine-core.md](functions/engine-core.md) §3); the
DLL is the hand inside the client that touches the game's network stack. It ships with two
C++-mangled exports and nothing else public:

| Export | Demangled | VA (v10x) | VA (v860) |
|---|---|---|---|
| `?fnPacket@@YAHPBDHH@Z` | `int fnPacket(const char*, int, int)` | `0x10005641` | `0x100052b7` |
| `?nPacket@@3HA` | `int nPacket` (global) | `0x101c4c58` | `0x10054bc4` |

Imagebase `0x10000000`, clean MSVC, no packer (both builds). v10x is a
2017-09-03 build, v860 a 2022-02-15 build.

## The exported `fnPacket` is a stub

Both shipped DLLs implement `fnPacket` as a constant `return 1`:

```
; v10x  0x10005641            ; v860  0x100052b7
push  ebp                     push  ebp
mov   ebp, esp                mov   ebp, esp
mov   eax, 1                  mov   eax, 1
pop   ebp                     pop   ebp
ret                           ret
```

No reference to its three arguments, no branch, no side effect. Byte-for-byte the
same across lineages. The export exists so the exe can `GetProcAddress` a valid
entry point and so the client's patched send path has a symbol to call, but the
on-disk body does no work. `nPacket` sits in `.data` (`0x101c4c58` / `0x10054bc4`,
inside the `0x1000c000` `.data` region) as a plain integer slot the exe/DLL write
at runtime.

**Confirmed:** the shipped `fnPacket` is a placeholder. **Inferred:** the real
send-routing is wired at runtime by the DLL's `DllMain`/worker thread and by the
exe patching client memory — see below. The stub is what a static disassembly of
the *file* sees; it is not what runs in-client.

## How the exe injects it — classic CreateRemoteThread LoadLibrary

The v10x and v860 exes both import the full remote-injection set:
`OpenProcess, VirtualAllocEx, WriteProcessMemory, CreateRemoteThread,
LoadLibraryA, GetProcAddress, GetModuleHandleA, ReadProcessMemory,
VirtualProtectEx`.

The injector lives at `0x00438222`+ (v10x). It is textbook LoadLibrary injection:

| Step | Address | What |
|---|---|---|
| build path | `0x438228` | `GetCurrentDirectoryA` then append `"\packet.dll"` (`0x46ede8`) → full path on stack |
| resolve loader | `0x43826f`–`0x438280` | `GetModuleHandleA("Kernel32")` + `GetProcAddress("LoadLibraryA")` → `[ebp-4]` |
| allocate in target | `0x43836c` | `VirtualAllocEx(hProc, 0, len, MEM_COMMIT, PAGE_EXECUTE_READWRITE)` |
| copy path | `0x438393` | `WriteProcessMemory(hProc, remoteBuf, "<cwd>\packet.dll", …)` |
| run loader | `0x4383b9` | `CreateRemoteThread(hProc, …, LoadLibraryA, remoteBuf, …)` |
| sync | `0x4383d1`/`0x4383dc` | `WaitForSingleObject` then `Sleep(0x1c2)` |

The target process handle is a global at `[0x4d22464]` (opened elsewhere via
`OpenProcess`). After the load, the exe writes several config words into client
memory through its own `WriteProcessMemory` thunk `0x4011a9` (e.g. at
`[client+0x320]`, `[client+0x32a]`), i.e. it patches the client's `.data`
directly in the same pass — the same primitive that seeds `nPacket`/enable flags
on the client side.

Two leftover strings pin the origin of this DLL: `"\packet.dll"` (`0x46ede8`,
the runtime name) and the debug build path
`"C:\DXSDK\Samples\C++\Direct3D\Tutorials\packet\Release\packet.dll"`
(`0x46ee10`) — the author built it from a stock DirectX SDK tutorial project
skeleton. The `"TibiaMB"` window class is set right after injection (`0x438408`).

## What actually runs inside the client — DLL DllMain + worker

The DLL's real behavior is in its load-time init, not `fnPacket`. The init block
at `0x1000546b`+ (reached from `DllMain`, DLL entry `0x1000648b`) does the
runtime wiring the stub stands in for:

| Address | Action |
|---|---|
| `0x1000547c` | log `"Dll loaded 9.2"` |
| `0x10005510` | locate `"client.exe"` module base (`0x1000171f`); if base ≠ default, rebase by `-0x400000` (`0x1000552f`) so hardcoded client offsets track ASLR |
| `0x10005548` | `CreateThread(…, 0x10004c0b, …)` — spawn the worker |
| `0x1000554e` | `LoadLibraryA("ws2_32.dll")` |
| `0x1000555c` | `GetProcAddress(ws2_32, "send")` → store at `[0x101c4b10]` |
| `0x10005570` | `GetProcAddress(ws2_32, "setsockopt")` → store at `[0x101c4b0c]` |

So the DLL caches the client's Winsock `send`/`setsockopt` addresses and starts a
worker thread. There is a separate `"Hooked 9.1"` string in `.rdata`
(`0x1000c5fd`) alongside `"Dll loaded 9.2"`, and the imports include
`SetWindowLongA` + `CallWindowProcA` (a subclass/WndProc hook) and
`VirtualProtectEx` (needed to make a code patch writable). The evidence points to
the DLL patching the client's outgoing-`send` path so client→server traffic
routes through DLL-controlled code — i.e. the real `fnPacket`-equivalent logic is
installed into the client at runtime, not resolved from the export table. **This
send-path patch is inferred from the cached `send` pointer + `VirtualProtectEx` +
`"Hooked"` string; the exact patch site is not yet disassembled.** (unconfirmed)

The worker thread `0x10004c0b` opens a named-pipe / file IPC channel
(`"Thread Started"`, `"C:\pipe11.dat"`, `\\.\pipe\SamplePipe%i`,
`C:\pipechat%d.txt`, `C:\pipeteam%d.txt`, `C:\pipeonline%d.txt`) — this is the
DLL↔exe transport. The DLL also pulls in `psapi.dll`
(`EnumProcesses/EnumProcessModules/GetModuleBaseNameA/GetModuleInformation`) to
find the client, and writes diagnostics to `packerrors.txt` / `p124.txt`. All of
this confirms the DLL is the in-client agent and the exe is the out-of-process
controller talking to it over pipes.

## v10x vs v860 — same code, different buffer size

The two DLLs are near-identical binaries; the differences are the `.data` BSS
size and a build-vintage function count, not the primitive itself.

| | v10x | v860 |
|---|---|---|
| file size | 69632 | 65536 |
| DLL entry | `0x1000648b` | `0x100060fb` |
| `fnPacket` | `0x10005641` (`ret 1`) | `0x100052b7` (`ret 1`) |
| `nPacket` (.data) | `0x101c4c58` | `0x10054bc4` |
| `.data` vsize | `0x1ba34c` (~1.8 MB) | `0x4a2cc` (~304 KB) |
| recovered funcs | 107 | 98 |
| build date | 2017-09-03 | 2022-02-15 |

Imports are identical between the two (same KERNEL32 + USER32 set, no direct
`ws2_32` import — it is `LoadLibraryA`-resolved at runtime in both). The big
delta is `.data` vsize: the v10x DLL reserves ~6× the BSS the v860 one does.
This is the DLL's own scratch/pipe-buffer BSS, not a client mirror; it scales
with the larger per-packet framing of Tibia 10.x versus 8.60. Same primitive,
sized to its client.

## Confirmed vs inferred

- **Confirmed (disassembled):** `fnPacket` is a `ret 1` stub in both DLLs;
  `nPacket` is a `.data` int; the exe injects the DLL by
  path via `VirtualAllocEx`+`WriteProcessMemory`+`CreateRemoteThread(LoadLibraryA)`
  with the client handle at `[0x4d22464]`; on load the DLL rebases to
  `client.exe`, spawns worker `0x10004c0b`, and caches `ws2_32!send`
  (`[0x101c4b10]`) and `setsockopt` (`[0x101c4b0c]`); the DLL↔exe channel is
  named pipes / `C:\pipe*` files.
- **Inferred (from imports + strings, not yet from the patch site):** the DLL
  hooks the client's `send` path (cached `send` ptr + `VirtualProtectEx` +
  `"Hooked 9.1"`), so the on-disk `fnPacket` stub is a placeholder and the real
  routing is installed at runtime.

## Follow-up

- Disassemble worker `0x10004c0b` fully and the `send`/`setsockopt` consumers at
  `[0x101c4b10]`/`[0x101c4b0c]` to pin the exact send-path patch and framing.
- Map the pipe protocol (`\\.\pipe\SamplePipe%i`, `C:\pipe11.dat`) to the exe
  side to show how `nPacket`/injected packets cross the boundary.
- Confirm whether `nPacket` is a sequence counter or a status word by finding its
  writers in both the DLL and the exe's post-injection `WriteProcessMemory` pass.
