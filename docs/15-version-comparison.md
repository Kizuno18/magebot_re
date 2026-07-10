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
   Lua — [06-v860-lineage.md](06-v860-lineage.md)), Tibia 8.60 client, `gdi32 9`
   vs `3` (the old hand-drawn HUD/Mwall overlay), different base bands
   (`[0x45ff0c]` stride `0xA8` vs the v10x `[0x468f38]` stride `0xE0`). This is a
   separate catalog ([functions/catalog-v860.md](functions/catalog-v860.md)).

## Practical takeaway

Reverse it once, per lineage. The [catalog-bot.md](functions/catalog-bot.md)
addresses are **T10o-absolute**; they map to Gunz/v1098 by function identity, not
by the same VA. The only per-build re-derivation that matters is the resolver
bank's client offsets. v860 needs its own addresses throughout (done separately).
