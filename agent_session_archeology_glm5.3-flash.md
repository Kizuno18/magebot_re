# AGENT-ARCHAEOLOGY — magebot_re

Evidence base: current-code inspection (README, docs/00–18, tools/, recon/, samples/), sanitized standing rules, 2 transcript projections mined by the EXP-magebot_re workflow (2 transcript agents + 1 project-memory agent + hierarchical synthesis; 5 agents total, 0 null children). Transcript coverage was sampled (six stratified pages per projection), not exhaustive.

## What This Project Is

- Private reverse-engineering research repo for **MageBot v5.5** (aka TibiaMB), a memory-injection bot for the Tibia game client and OTServ servers — static analysis plus offline function recovery of binaries the operator legally owns; no live game servers touched.
- Two engine lineages of the same product: **v860** (2022 build, Tibia 8.60, no Lua — chat commands `.attack`/`.follow`, `.sav` cavebot recorder) and **v10x** (2017 build, Tibia 10.x, Lua 5.1 with 63 registered globals); Gunz/T10o/v1098 installers are the same Lua product recompiled per client.
- Architecture of the target: an out-of-process bot that attaches via `ReadProcessMemory` against a throttled polling mirror (~50 ms creatures/containers, ~5 ms map tiles, XOR-deobfuscated self scalars) and acts by injecting frames through `SendAction 0x405f1d` → named pipe `\\.\pipe\SamplePipe%i` → an injected `packet.dll` shim that LCG-pads, XTEA-encrypts and Adler-32-checks frames onto the real socket; a Team Server (`server.exe`) plus tibiadb.com HTTP licensing round it out.
- Repo layout: `docs/00-status.md…18-runtime-packet-verification.md` (19 architecture/flow/status docs), `docs/functions/` per-function catalogs, `recon/` regenerable static-analysis artifacts (JSON bindings/funcs/strings/summaries per binary), `tools/` Python recon scripts (`recon.py`, `lua_bindings.py`, `disasm.py`) and Node multi-agent workflow orchestrations (`wf_*.mjs`), `samples/{v860,v10x,shared}/` staged binaries and script assets.
- Complexity lives in the function catalogs (222 v10x bot funcs, ~83 CRT/STL support funcs, 195 server.exe funcs, 250 v860 funcs) and in the runtime-testing chain (patched client + local TFS 0.4 server + LoadLibrary injection + wire-level crypto verification, docs 17–18); most docs were themselves authored by a prior fan-out workflow (`tools/wf_docs.mjs`, meta `magebot-deep-docs`).

## Timeline of Agent Work

Coverage note: evidence from **2 transcript projections** (pass 1: 2,649-line / 1.6 MB projection; pass 2: 720-line / 449 KB projection — different snapshots of the same session lineage, each sampled at six stratified pages, not exhaustive) plus safe project memory (memory bundle `memory-000..041` unique, `042..083` verified byte-duplicates); **0 null children** in extraction. Earlier phases are reconstructed from repo artifacts where transcripts were sampled away.

- **Phase A — static RE corpus (pre-transcript, repo-evidenced):** offline triage tooling landed first (`tools/recon.py`, `tools/lua_bindings.py`, `tools/disasm.py`), producing the regenerable `recon/` artifacts for five binary tags (v10x_magebot, v860_magebot, v10x_packet, v860_packet, server).
- **Phase B — workflow-authored deep-doc pass:** `tools/wf_docs.mjs` (meta `magebot-deep-docs`) fanned out one agent per doc over the RE-lab MCP gateway; its backbone carried then-current facts ("packet parser fills the mirror", "exe patches the client send path") that later passes corrected (see Contradictions). Authored docs 01–06 and the Lua/engine catalogs.
- **Pass 1 (2,649-line projection) — intent arc:** full RE of MageBot v5.5 into `magebot_re` → live runtime testing → explain why the SAFEMODE build exists → 100% e2e in-game test + packet monitor vs docs → merge & publish private. Work branch `re/magebot-v55-static`: `samples/{v860,v10x,shared}/`, `tools/` (`build_corpus.py`, `merge_*_docs.py`, `wf_mb_decompile.mjs`, `wf_mb_docs.mjs`), prose docs 00–18 plus `catalog-bot/v860/server.md`; names persisted into all four `.i64` IDA databases; all 63 v10x Lua globals mapped to implementation addresses.
- **Key decisions recorded:** keep the two lineages separate; adopt Hex-Rays-over-IDA after the capstone-only corpus mis-segmented functions; RSA-patch the Cip 8.60 exe + hosts redirect; stand up a local TFS 0.4 server when BR public OTs blocked the custom client at world login; write a standalone frida driver over SSH after the re-ida MCP origin returned 502s.
- **Commit chain (chronological, from git-summary memory):** `e84736e`, `8f613ac` (subjects not captured by sampling), `3b13bed` (SAFEMODE = 2012 fallback build, doc 15), `8857ecf` (licensing-host fix, docs 14/18/00), `ba18a46` (injection-crash fix, docs 17/00/04/README), `320dfa1` (wire crypto proof, new docs/18), `cf57e57`+`d826667` (SAFE-MODE mechanism, docs 15/00). Branch merged to `main`, pushed to private GitHub `Kizuno18/magebot_re` at HEAD `d826667`; feature and stale `claude/*` branches deleted post-merge.
- **Runtime e2e proof (pass 1→2 arc):** patched Cip 8.60 client enters the world via local TFS 0.4 (Fir3element + SQLite, account 1/1); injection clean (zero `WerFault`, SamplePipe live, client window subclassed); RPM mirror fully populated in-game (2,620/2,625 reads hit real client addresses); every documented outgoing opcode captured on the wire (attack `0xA1`, walk `0x65`–`0x68`, turn `0x6F`, look `0x8C`, talk `0x96`) with end-to-end XTEA/Adler-32 cryptographic verification against the captured session key.
- **Attempted/unconfirmed:** the first SAFE-MODE runtime gate test (`safemode_test.py`) launched but its result read was cut off by a rate limit on-transcript; outcome never confirmed in-projection (see Contradictions).

## Hard-Won Gotchas

All of these are failure→fix pairs that landed:

- The injection crash at `0x10004C0B` was long blamed on ASLR base mismatch — wrong: it was a wrong-version `packet.dll` (the v10x/9.2 build whose `DllMain` writes hard-coded 9.2 client globals unmapped in the smaller 8.60 image). Fix: deploy `samples/v860/packet.dll` (65,536 B); clean inject afterwards. The DLL is strictly build-specific.
- Never mix two bot RE projects in one IDA database — elfbot names got clobbered by magebot naming sweeps; beware FLIRT auto-name collisions too (`allow_overwrite:false` protects only user-assigned names, so renames were filtered past IDA-demangled symbols).
- `jnews.ueuo.com GET /s.php` telemetry seen on the wire belongs to the Tibia client itself, not the bot; magebot's licensing host is `tibiadb.com` (confirmed in both v860 builds).
- frida ≥17 removed `Module.findExportByName` → use `getGlobalExportByName`.
- Windows GUI/control automation must run in session 1 (`WinCtlS1` task); session 0 cannot grab screens or foreground windows.
- Flaky login clicks fixed with `AttachThreadInput` foregrounding; the Enter Game button sits at real coordinates (459,419).
- `frida.spawn` needs `cwd=C:\Tibia860` or the client dies loading Tibia.dat; the demo license self-closes the window — attach fast, the inject window is narrow.
- Remote file-write over SSH: drain stdin (chunked base64 + `</dev/null`); PowerShell `Add-Content` silently wrote 0 bytes → chunked `cmd /c echo>>` instead.
- re-ida MCP 502s / idle-expires → reopen the `.i64`, or fall back to local objdump/pefile.
- TFS 0.4 SQLite schema ships a missing-comma bug in the players INSERT (bit during runtime setup).
- Docs-side correction pair (from `docs/00-status.md`): the earlier "send-path patch" guess for packet.dll was replaced after internals were confirmed — real mechanism is `pkt_xteaEncryptAndSend` fed by the pipe-server thread, not a send-path hook.

## Open Threads

- SAFE-MODE runtime gate proof: only the static mechanism is fully documented; if the flag=0-vs-flag=1 direct-send result matters as transcript evidence it still needs a rerun — recovered memory records it as frida-verified (3/3 vs 0/3 packets), pass 2's summary said "unfinished: none", pass 1's result read was rate-limit-cut (see Contradictions).
- Dynamic `Cast*`/`Use*` opcode sub-bytes need a live-client trace (use-with sub-byte built from RPM reads).
- Per-build resolver constants for Gunz/v1098 installers (same code as T10o, different offsets; needs per-build IDA passes).
- v860 `.sav`/`.savd` cavebot recording framing + `*.bin` tile-map encoding undocumented.
- `DialogFunc` WM_TIMER dispatch order and the `targeting.txt`→table loader path still untraced (partially superseded by the recovered finding that the engine tick rides WM_TIMER + Lua pump — exact ordering remains open).
- Assorted `sub_*` semantics remain flagged "(unconfirmed)" across doc open-items sections.
- Hand-off location for the distilled reusable 8.60 runtime-testing recipe is undecided by the user.
- Housekeeping: `docs/00-status.md` carries a stale "Remaining" block listing items already marked Done above it (server.exe catalog, v860 dispatcher, IDB name persistence) — worth pruning so the resume point stops contradicting itself.
- Standing-rules gap: the repo has no root `CLAUDE.md`/`AGENTS.md` documenting build/run/test commands (global rules suggest adding one); `.mcp.json` URLs carry credential-bearing query params whose values are redacted by the sanitizer — flagged as a potential secrets-in-versioned-files tension only because the redaction marker proves such a value existed; the value itself was never read or reconstructed here.

## Recovered Memory

Settled, durable facts recovered from the safe project-memory bundle:

- **Repo state:** `main` single source of truth, synced with private origin `Kizuno18/magebot_re` at `d826667`; 95 tracked files; no secrets found by the memory pass; work/stale branches deleted after consolidation.
- **Two lineages** of `magebotv55.exe`: v10x (2017, Tibia 10.x, Lua 5.1/LuaJIT, 63 registered globals) and v860 (2022, Tibia 8.60, no Lua — chat commands `.attack/.follow/.sd`, `.sav` cavebot recorder, flat-file config). Gunz/T10o/v1098 installers are the same Lua product recompiled; only client strings + resolver constants differ.
- **Architecture:** external bot, no server→client packet parser — RPM-polling mirror (~50 ms creatures/containers, ~5 ms map; XOR-deobfuscated self scalars, HP%÷100). Act path: frame builders → `SendAction 0x405f1d` → `InjectFrame 0x40320a` → `\\.\pipe\SamplePipe%i` → injected packet.dll shim → LCG pad + XTEA (32 rounds) + Adler-32 + `ws2_32!send`. Exported `fnPacket` is a ret-1 stub; real work runs in the DllMain worker thread. Engine tick rides the modal dialog's WM_TIMER + Lua timer pump; the 5 WinMain threads are input/intel/watch only. Wire framing is `[len][adler32(ct)][xtea]` with non-deterministic LCG padding.
- **SAFE MODE (thread closed):** global `dword_460048` gates all packet sends/memory writes. Set → pipe-send early-returns and ~25 builders branch to synthetic input (`SendMessageA` WM_LBUTTONDOWN/UP via `v860MouseClickAt 0x406dcd`, WM_KEYDOWN/UP via `0x4068c0`) aimed at the client HWND; the real cursor never moves and the client emits its own legitimate packets — anti-detection mode. `magebotv55_SAFEMODE.exe` is an older 2012 fallback build (1177 vs 1192 funcs), not a different mode; the 2022 main adds freeze-screenshot (`froze.bmp`) + IP changer.
- **v860 offsets differ from v10x docs:** send fn `0x10004436` (not `0x10004726`), XTEA key pointer `0x1000C138`.
- **Licensing:** tibiadb.com endpoints `key/resendkey/addcomputer/authorize.php`; machine-id = UuidCreateSequential node XOR 0x5331.
- **Runtime recipe:** OT RSA modulus in-place swap + `login01-05.tibia.com` hosts redirect; local TFS 0.4 defeats the BR custom-client wall (with the SQLite schema gotcha above).
- **Paths:** resume point `docs/00-status.md`; catalogs `docs/functions/catalog-{bot,server,v860}.md`; binaries `samples/{v860,v10x,shared}/`; regenerable artifacts under `recon/`; memory bundle at `/home/kizudev/.dsh/exp/memory-safe/magebot_re`.

## Contradictions

- **Preserved, unresolved addresses:** `safemode_test.py` calls send-fn `0x402a08` directly (flag=0 vs flag=1 test) while the documented v860 wire-send offset is `0x10004436`. Plausibly a bot-exe `.text` wrapper vs the packet.dll export (the gate living at `0x460048` implies imagebase 0x400000), but the two were never explicitly reconciled on record.
- **Runtime gate proof status:** pass 2 states "unfinished: none", yet pass 1's runtime result read was cut off by a rate limit and never confirmed on-transcript — while recovered memory lists it as frida-verified (flag=0 → 3/3 talk frames on the wire, flag=1 → 0/3). Either it was confirmed off-transcript later or memory is optimistic; treat a direct-send rerun as optional-but-open if wire-level proof is required.
- **Catalog count mismatch:** transcripts cite `catalog-bot.md` at 222 functions; memory records ~300 v10x bot functions mapped (server.exe 195, v860 250). Counting scope likely differs (file entries vs subsystem coverage); unresolved.
- **Model evolution inside the repo itself (resolved, but historically contradictory):** `tools/wf_docs.mjs`'s backbone asserted "a packet parser reads the client's server→client stream and writes this mirror" and speculated about a send-path patch; final docs 00/01/08 state there is **no** packet parser (RPM-polling mirror) and confirm the pipe+shim mechanism instead. Anyone reading the tool script before the docs will inherit the outdated model.
- **Sanitization artifacts (not source contradictions):** in sanitized view, the README link target for doc 08 and one filename reference inside tools/wf_docs.mjs render as redaction markers even though the doc-08 file exists on disk — over-broad path masking, noted only as a reading hazard; no redacted value was inferred or reconstructed.
