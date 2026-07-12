# Version comparison — the four installers

The distribution ships four NSIS installers. They carry **five distinct
`magebotv55.exe` builds** but only **two real code lineages**; the rest of the
spread is target-client identity plus recompilation vintage.

| Installer | `magebotv55.exe` md5 | Size | Build date | Lineage | Target client |
|---|---|---|---|---|---|
| `MagebotSetupGunzOTOnly` | `f9f0f642` | 671840 | 2016-12-06 | Lua | GunzOT — `"Tibia Testserver"` window + `tibia.bin` |
| `MagebotSetupvT10o` | `850b9b6d` | 671840 | 2017-09-03 | Lua | Cipsoft `client.exe` (Tibia 10.x) |
| `MagebotSetupv1098_new` | `32afc001` | 671840 | 2022-02-15 | Lua | Tibia 10.98 |
| `MagebotSetupv860_new` | `ff6e51a2` | 614500 | 2022-02-15 | **non-Lua** | Tibia 8.60 |

(The `_SAFEMODE.exe` variants collapse onto these: v10x safemode == main;
v860 has its own 2012/2022 safemode. `server.exe` is byte-identical in all four.
`packet.dll` differs only by build vintage, same mechanism.)

## What is identical across all four

- **Imports** — byte-for-byte the same DLL set and counts across the three Lua
  builds (`wsock32 12, kernel32 84, user32 32, gdi32 3, comdlg32 2, shell32 1,
  lua51 18, winmm 1`).
- **Strings** — identical except the one target-client identifier below. Same
  licensing (`tibiadb.com`, `GET %s%d&v=55&m=%d`, `key.php`/`resendkey.php`/
  `addcomputer.php`, "10 players per private server"), same HUD
  (`TibiaMB Exp/hr: %i TNL: %i`), same window classes
  (`TibiaClient`/`TibiaClientTest`/`TibiaClientPreview`), same `packet.dll`
  DirectX-SDK-tutorial origin path.
- **Architecture** — the whole RPM-polling mirror + SendAction/InjectFrame +
  XTEA-in-`packet.dll` + 63-global Lua API is the same product. The engine docs
  (00–14) and `catalog-bot.md` describe all three Lua builds.

## What actually differs

1. **Target client (the only functional string delta).**
   - Gunz: `"Tibia Testserver"` + `tibia.bin` — the old GunzOT client, no
     `client.exe`/`Outdated Client`.
   - T10o: adds `client.exe` + `"Tibia (Outdated Client)"` — the Cipsoft
     `client.exe` process.
   - v1098: `"Tibia (Outdated Client)"`, no `client.exe`/`Testserver` — locked to
     Tibia 10.98.
   Each build attaches to a different client version, so the **hardcoded client
   memory offsets in the address-resolver bank** (the `+0x18`, `+0x45d30`, … added
   to the `[0x468fxx]` bases in [functions/catalog-bot.md](functions/catalog-bot.md))
   track that client's struct layout and differ build-to-build. The resolver
   *code* is the same; the *constants* are per-client. (Confirmed: the string
   deltas above; inferred: the exact offset values, which need a per-build IDA
   pass to enumerate.)

2. **Recompilation vintage — not new logic.** A byte diff shows ~57 % of `.text`
   differing between Gunz (2016) and T10o (2017) and ~27 % between T10o and v1098
   (2022). That is **address-shift cascade + compiler churn**, not feature change:
   identical imports and (bar the client identifier) identical strings mean the
   same functions were recompiled and relocated. An insertion early in `.text`
   shifts every later function, so absolute-address operands diverge everywhere
   while the logic is unchanged. A structural (function-hash) diff would show the
   overlap; a raw byte diff overstates it.

3. **v860 is the genuine outlier.** No `lua51` import (chat-command driven, not
   Lua — [06-v860-lineage.md](06-v860-lineage.md)), Tibia 8.60 client, different
   base bands (`[0x45ff0c]` stride `0xA8` vs the v10x `[0x468f38]` stride `0xE0`).
   This is a separate catalog ([functions/catalog-v860.md](functions/catalog-v860.md)).

4. **v860 `magebotv55.exe` (main, 2022) vs `magebotv55_SAFEMODE.exe` (2012).**
   Unlike the v10x SAFEMODE (byte-identical to its main), the v860 SAFEMODE is a
   genuinely older build — `TimeDateStamp` **2012-11-08** vs the main's
   **2022-02-15** (~9.3 years). Same product/engine: identical `tibiadb.com`
   licensing, team server, RSA/XTEA send path, and all the
   healer/targeting/cavebot/looter/chat-command engines; both inject via `wsock32`.
   The 2022 main is **1192 functions vs 1177** (+15) and adds **two features the
   2012 build lacks**:
   - a full-screen **freeze/crash-diagnostic screenshot** — `v860CaptureWindowRegion`
     (`0x42fcdd`) → `v860CaptureWindowToBmp` (`0x42fd90`) grabs the desktop DC via
     `BitBlt`/`GetDIBits` (sized with `GetSystemMetrics`) and writes **`froze.bmp`**;
     this is the whole of the `gdi32 9 vs 3` delta (6 capture imports over the 3
     shared HUD-text imports `TextOutA`/`GetStockObject`/`SetBkMode`);
   - an **IP Changer with a saved `iplist.txt`** + mouse-scroll IP history (the
     help string *"…put your IP for the IP Changer… scroll wheel to see previous
     IPs"* and `iplist.txt` are main-only).

   So the `_SAFEMODE.exe` binary is the **older 2012 build**, otherwise the same
   bot minus those two 2022 additions. The *name*, though, comes from a runtime
   toggle both builds carry — see §5.

5. **"SAFE MODE" is a no-full-packet toggle (the reason for the name).** Both v860
   builds contain a global flag **`dword_460048`** (`SAFE MODE` when set; the window
   title shows "SAFE MODE" and a `safemode1st.txt` first-run marker is written).
   When the flag is **1**, the bot **stops injecting packets and stops writing client
   memory**, driving the game with **keyboard/mouse** instead — the anti-detection
   "safe" path:
   - the pipe-send `v860PipeSendXteaEncrypted` (`0x402a08`) opens with
     `if (dword_460048 == 1) return 1;` — it never writes the frame to
     `\\.\pipe\SamplePipe`, so `packet.dll` never XTEA-encrypts or `send()`s it;
   - every packet builder (`v860StepDirFrame` `0x406575`, `v860BuildMouseWalkSequenceA/B`,
     the turn/use/walk builders — ~25 sites all test `cmp dword_460048, 1`) takes a
     **synthetic-input** branch instead of building the frame: it computes the target
     tile's screen pixel (`GetWindowRect` on the client HWND `[0x863213C]` + the
     `v860MapSelfXToScreenColumn`/`Row` game-coord→pixel mapping) and drives the client
     via **`SendMessageA` posted straight to the client window** — `v860MouseClickAt`
     (`0x406dcd`) posts `WM_LBUTTONDOWN`/`WM_LBUTTONUP` at that pixel, `v860SendKeyDownUp`
     (`0x4068c0`) posts `WM_KEYDOWN`/`WM_KEYUP` (hotkeys/arrows). These go to the client's
     message queue only — the real cursor never moves;
   - the client-memory writers `v860WriteClient*ModeGated` are gated by the same flag.

   The upshot: in SAFE MODE the bot still **reads** everything from client memory
   (RPM mirror) and runs the same targeting/cavebot/healer logic — it just
   **executes** actions as simulated clicks/keystrokes, and the **client itself**
   then builds and sends the real (legitimate) game packet. So nothing on the wire
   is bot-generated; the server sees only the client's own packets, which is why the
   mode is "safe" (undetectable) at the cost of speed/precision vs full-packet.

   Verified at runtime (frida, bot injected into an in-game client): with the flag
   forced **0**, directly calling `v860PipeSendXteaEncrypted` with a talk frame put
   a 22-byte encrypted packet on `ws2_32!send` every time (3/3); with the flag
   forced **1**, the same call returned immediately and **no packet reached the
   wire** (0/3), confirming the gate. So "SAFE MODE" = **external RPM-read +
   human-like input only, zero packet/memory injection** — much harder for the
   server/anti-cheat to detect. (Full-packet mode is the fast, feature-complete but
   detectable default of the main build; `dword_460048` defaults to `0` there.)

## Practical takeaway

Reverse it once, per lineage. The [catalog-bot.md](functions/catalog-bot.md)
addresses are **T10o-absolute**; they map to Gunz/v1098 by function identity, not
by the same VA. The only per-build re-derivation that matters is the resolver
bank's client offsets. v860 needs its own addresses throughout (done separately).
