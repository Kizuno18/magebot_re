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
worker thread. **Version note:** the table above is the **v10x (9.2)** `packet.dll`
(`"Dll loaded 9.2"`, module `"client.exe"`, client globals in the 9.2 range —
`dword_1000C12C = 0x991F30`, `dword_1000C13C = 0xB1B4A8`). Injecting *this* DLL
into the 8.60 Cip client (`Tibia.exe`, image `0x400000`–`~0x650000`) makes `DllMain`
write to unmapped `0x991F30`+ and crash the client (see the runtime root-cause in
[17](17-runtime-testing.md)); the **v860** `packet.dll` (`samples/v860/`, 65536 B)
resolves the 8.60 client and injects cleanly. **The DLL is build-specific — match
it to the client.** Both the send path and the keyboard hook are disassembled
(worker `pkt_pipeServerThread` `0x10004c0b`, sender `pkt_xteaEncryptAndSend`
`0x10004726`, WndProc hook `pkt_hookedWndProc` `0x100052ba`):

**The pipe-server worker (`0x10004c0b`).** Reads `C:\pipe11.dat` for an instance
number and the client window handle; builds `\\.\pipe\SamplePipe%i`; caches four
client send-context pointers into a struct at `[0x1000c12c]+676/688/696/720`;
`SetWindowLongA(hWnd, GWL_WNDPROC, pkt_hookedWndProc)` to subclass the client
window. Then it loops: `CreateNamedPipeA` → `ConnectNamedPipe` → `ReadFile` a
frame the exe wrote. It reads the *live* client socket handle from
`[[g_clientSocketCtxPtr]+4]` (`g_clientSocketHandle 0x101c4b04`), calls
`setsockopt(sock, IPPROTO_TCP, TCP_NODELAY, 1)` once per socket change, and
hands the frame to `pkt_xteaEncryptAndSend`. Two magic frames (`19 6f` / `19 70`,
opcode 0x13 sub 111/112) toggle the Mwall-timer HUD (`g_mwallTimerOn 0x1000c308`)
instead of being sent.

**The sender (`pkt_xteaEncryptAndSend 0x10004726`) — the real `fnPacket`.** Given
a plaintext Tibia frame from the pipe it: (1) pads the tail with an LCG PRNG
(`0x1000d388`), (2) **XTEA-encrypts** it in 8-byte blocks — 32 rounds, delta
`0x9E3779B9`, 128-bit key at `g_xteaKey 0x1000c128` (the client's session key),
(3) computes an **Adler-32** checksum, prepends the `<len:2><adler:…>` header, and
(4) calls the runtime-resolved **`send`** (`g_ws2_send 0x101c4b10`) on the client's
live socket. So the exe writes *plaintext* frames to the pipe and the DLL does the
XTEA+checksum+send exactly as the client's own protocol layer would — the injected
packet is indistinguishable from a real client packet on the wire. (The earlier
"send-path patch via `VirtualProtectEx`/`Hooked`" inference was wrong: injection is
by *calling* the client's `send` with an encrypted frame, not by patching the send
routine.)

**The keyboard hook (`pkt_hookedWndProc 0x100052ba`).** The window subclass
intercepts `WM_KEYDOWN/UP/CHAR`: when the bot is armed (`[0x101c4c4c]==1` without
Ctrl/Shift, or `pkt_isInGameState`), it **swallows the arrow keys** (VK 0x25–0x28)
and numpad digits so the bot's walker owns movement, and tracks Ctrl(163)/Shift(161)
key-up state; everything else is forwarded via `CallWindowProcA(lpPrevWndFunc)`.
This is the input side of the injection — it pairs with the exe's arrow/numpad
walker threads ([07](07-master-loop-and-threads.md)).

The channel also uses `C:\pipechat%d.txt` / `C:\pipeteam%d.txt` /
`C:\pipeonline%d.txt` side files for the chat/team/who-is-online HUD data, and
writes diagnostics to `p124.txt`. The DLL is the in-client agent; the exe is the
out-of-process controller talking to it over the pipe.

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
- **Confirmed (now disassembled):** the real injection is
  `pkt_xteaEncryptAndSend 0x10004726` — it XTEA-encrypts the plaintext frame with
  the client session key `g_xteaKey 0x1000c128` (32 rounds, delta `0x9E3779B9`),
  Adler-32-checksums it, and calls the runtime-resolved `send` `g_ws2_send` on the
  client socket `g_clientSocketHandle`. The DLL does **not** patch the send routine;
  it *calls* `send` directly. The `SetWindowLongA` subclass `pkt_hookedWndProc
  0x100052ba` is a keyboard hook that swallows arrow/numpad keys while the bot walks.
- **Still open:** whether `nPacket` is a sequence counter or status word (its
  writers), and the v860 DLL's byte-level deltas (same mechanism, re-verify addrs).

## Follow-up

- Confirm `nPacket` semantics by finding its writers in DLL + exe.
- Re-verify the v860 packet.dll (`0x100052b7` `fnPacket`) shares the exact
  XTEA/Adler/send worker (addresses differ).
