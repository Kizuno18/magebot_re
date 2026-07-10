export const meta = {
  name: 'magebot-deep-docs',
  description: 'Fan out deep function-by-function documentation of MageBot v5.5',
  phases: [{ title: 'Author', detail: 'one agent per doc, each decompiles its cluster and writes its file' }],
}

const REPO = '/home/kizudev/Documents/Repos/magebot_re'

const BACKBONE = `
You are reverse-engineering MageBot v5.5 (aka TibiaMB), a memory-injection bot
for the Tibia client, in a private RE lab on binaries the operator legally owns.
Repo root: ${REPO}  (cd there before running anything).

VOICE: terse technical prose + small tables, English, like a senior RE engineer's
notes. Ground EVERY claim in an address or a recon artifact. Never invent offsets,
opcodes, or behavior — if unsure, disassemble more or mark it "(unconfirmed)".
No AI filler, no status-emoji, at most one table per idea. Match the tone of the
sibling repo /home/kizudev/Documents/Repos/elfbot_re/docs (read one of its docs
first to calibrate).

TOOLS (already present, use via Bash):
- python3 tools/disasm.py <sample> <hexVA> [maxInsn]   linear disasm; follows jmp
  thunks; annotates call targets with import names and referenced C-strings.
- recon/<tag>.summary.json  PE structure, imports/exports, sections
- recon/<tag>.strings.txt    extracted strings
- recon/<tag>.funcs.json     recovered function starts (call-target inventory)
- recon/v10x_magebot.bindings.json  the 63 Lua globals -> impl VA (thunk-resolved)
Tags: v10x_magebot, v860_magebot, v10x_packet, v860_packet, server.
Samples: samples/v10x/magebotv55.exe, samples/v860/magebotv55.exe,
samples/{v10x,v860}/packet.dll, samples/shared/server.exe, samples/v10x/lua/*.

BACKBONE FACTS (verified this session — reuse, do not re-derive):
- Two lineages of magebotv55.exe: v860 (Tibia 8.60, non-Lua, chat-command +
  .sav cavebot, 2022 build) and v10x (Tibia 10.x, Lua 5.1, 2017 build).
  Imagebase 0x400000. packet.dll imagebase 0x10000000. All clean MSVC, no packer.
- The bot maintains a full MIRROR of the client's game state in its own .data
  (huge ~92MB virtual BSS): self, creatures[], containers, map tiles. A packet
  parser reads the client's server->client stream and writes this mirror.
- ReadClientState helper = 0x004024a2 (thunk 0x4011b8): reads N bytes from the
  mirror at a fixed global addr; guarded by [0x4db3798]. The Lua Get* funcs read
  player/creature fields from fixed globals in the 0x4db3xxx band via this helper.
- SendAction/command builder = 0x00405f1d (thunk 0x401217): takes an opcode
  (e.g. 0xA1 = Tibia ATTACK) + args, checks enable flag [0x469098]==1, builds a
  client->server Tibia packet and injects it. This is how AttackTarget/MoveTo/
  Use*/Throw*/Npc* act on the game.
- 0x0044b860 = _ftol (CRT double->int). Attack post-delay global = 0x4696e0.
- Licensing/teamserver over HTTP to tibiadb.com (key.php/resendkey.php/
  addcomputer.php, "v=55", machine-id "m=%d"). server.exe = local Team Server
  (combo-leader coordination, password-gated, WSOCK, 63-client Winsock cap).

Write ONLY your assigned file. Do not edit other docs. Return a 2-line summary.
`

const AGENTS = [
  {
    file: 'docs/01-overview.md',
    label: 'overview',
    task: `Write docs/01-overview.md — the architecture doc. Cover: the two lineages
and why they exist; the memory-injection + mirror model (client process attach via
EnumProcesses/psapi and window classes TibiaClient/TibiaClientTest/
TibiaClientPreview/Tibia; how the packet parser fills the mirror; how Get* reads it
and actions inject packets via SendAction 0x405f1d); the subsystem map (healer,
targeting, cavebot/waypoints, looter, hotkey broadcast/OTFollow, HUD/DrawText,
Lua scripting, teamserver); the process/threading model as far as statically
visible. Include a compact ASCII data-flow (client mem/packets -> mirror -> Lua/
engine -> SendAction -> client). Decompile the entry 0x44bf9f and the WinMain it
calls enough to describe boot. Link to the other docs.`,
  },
  {
    file: 'docs/02-static-analysis.md',
    label: 'static',
    task: `Write docs/02-static-analysis.md — PE structure per binary. For each of
magebotv55.exe (v10x AND v860), packet.dll (v10x AND v860), server.exe: a section
table (name/VA/vsize/rsize), imports grouped by DLL with counts + the notable APIs,
exports, entry, timestamp, and the standout strings that reveal function. Read the
recon/*.summary.json and recon/*.strings.txt. Call out: the ~92MB .data BSS mirror;
WSOCK32 usage; psapi EnumProcesses; lua51 (v10x only); the tibiadb.com license URLs;
window class strings. Keep it a reference doc — tables + short notes.`,
  },
  {
    file: 'docs/functions/lua-api-catalog-reads.md',
    label: 'lua-reads',
    task: `Write docs/functions/lua-api-catalog-reads.md — decompile and document the
Lua "read / script / draw / input" primitives. Cover exactly these globals (impl VAs
from recon/v10x_magebot.bindings.json): the "Script/engine control" group
(SetTimerCallback, GetScriptPause, ResumeScripts, ReloadLua, LoadFile, SaveFile,
GetScriptInfo, GetScriptNumber, EnableScript, DisableScript, ListScripts,
SetGuiParams, GetClock, Sleep), the "Drawing/HUD/input" group (DrawText, printtext,
PrintError, GetCursorX, GetCursorY, IsKeyDown, PlaySound, SetClipboard), and the
"Self/creatures/world reads" group (GetPlayerInfo, GetCreatureInfo, GetCreatureInt,
GetTargetInfo, GetFollowInfo, GetGroundInfo, GetContainerItems, GetMaxContainers).
For each: one entry with impl VA, the Lua signature (from sample.lua), args pulled
(luaL_check*), values pushed (lua_push*), and the concrete mirror globals it reads
(list the fixed addresses, e.g. GetPlayerInfo reads 0x4db3784/0x4db372c/...). Where a
Get* reveals a struct field layout, record the offset table (this maps the mirror).
Use tools/disasm.py on each VA. Start the file with a one-line index table of all
globals covered.`,
  },
  {
    file: 'docs/functions/lua-api-catalog-actions.md',
    label: 'lua-actions',
    task: `Write docs/functions/lua-api-catalog-actions.md — decompile and document the
Lua "action" primitives. Cover exactly: Combat/control (AttackTarget, FollowTarget,
CastRuneTarget, CastHotkey, SetHuntingOn); Items/containers/NPC (UseInventoryItem,
UseContainerItem, UseGroundItem, UseItemOnGround, UseSpell, NpcSay, NpcBuy, NpcSell,
SetAutoLoot, SetLootTimer); Item movement (ThrowItemCtoC, ThrowItemCtoI,
ThrowItemCtoG, ThrowItemItoC, ThrowItemGtoC, ThrowItemGtoG); Waypoints/cavebot
(MoveTo, SetWaypointInfo, GetCurrentWaypoint, SetStopPoint, ClearWaypoints,
StartWaypoints, StopWaypoints, StartAutoExplorer, StopAutoExplorer); ID config
(SetManaPotIDS, SetHealPotIDS, SetRuneIDS). impl VAs in
recon/v10x_magebot.bindings.json. For each: impl VA, Lua signature (sample.lua), args
pulled, and CRUCIALLY the opcode it passes to SendAction 0x405f1d and any post-delay/
globals it writes (e.g. AttackTarget: SendAction(0xA1, id) then Sleep([0x4696e0])).
Build a table "Lua action -> Tibia opcode" as you go. Use tools/disasm.py. Start with
a one-line index of covered globals.`,
  },
  {
    file: 'docs/functions/engine-core.md',
    label: 'engine',
    task: `Write docs/functions/engine-core.md — the engine backbone. Decompile FULLY
and document: (1) SendAction 0x00405f1d — walk the ENTIRE opcode dispatch; enumerate
every opcode branch (cmp [ebp+0xc], <imm>) into a table opcode->action->packet shape;
this is the crown jewel (all client->server actions the bot can inject). (2)
ReadClientState 0x004024a2 — its (addr,size) contract, the [0x4db3798] guard, return
convention. (3) The packet parser / mirror writer — find where the server->client
stream is read and the mirror (0x4db3xxx and the creatures/containers arrays) is
written; identify the function and describe the loop. (4) The memory map of known
mirror globals discovered so far (self fields, attack delay 0x4696e0, enable flag
0x469098, guard 0x4db3798) as an address table. (5) entry 0x44bf9f -> WinMain boot
and the main tick loop. Use tools/disasm.py with generous maxInsn. Mark anything
unproven "(unconfirmed)".`,
  },
  {
    file: 'docs/04-packet-dll.md',
    label: 'packet',
    task: `Write docs/04-packet-dll.md — the packet.dll primitive. It exports
?fnPacket@@YAHPBDHH@Z (int fnPacket(const char*,int,int)) and ?nPacket@@3HA
(int nPacket). In the shipped v10x/v860 packet.dll, fnPacket is a stub that returns 1
(disassemble both versions at their export VAs to confirm; v10x export ~0x10005641).
Explain the likely design: the DLL is injected into the Tibia client; the exe patches
its .data (nPacket) and/or the client's send path so the client's socket-send routes
through it — i.e. the on-disk stub is a placeholder and the real work is runtime
wiring. Grep magebotv55.exe (v10x) strings/imports for "packet.dll"/"fnPacket"/
LoadLibrary/GetProcAddress/WriteProcessMemory/CreateRemoteThread to characterize how
the exe loads and uses it (use tools/disasm.py + recon strings; python3 -c pefile for
imports). Compare v10x vs v860 packet.dll (sizes 69632 vs 65536, entry, 107 vs 98
funcs). State clearly what is confirmed vs inferred.`,
  },
  {
    file: 'docs/05-teamserver.md',
    label: 'server',
    task: `Write docs/05-teamserver.md — server.exe (the local Team Server) AND the
tibiadb.com hosted teamserver. server.exe: imagebase 0x400000, entry 0x40c77f, WSOCK32
(19 imports), 447 recovered funcs, pt-BR locale. From recon/server.strings.txt the
protocol is password-gated: "Enter Server Password", "Enter Server Leader Password
(COMBO LEADER MUST USE THIS IN MAGEBOT)", "Team Server is running", "Waiting for
connections", "Accepted connection from", ">63 client connections ... Winsock stacks",
"disconnected for spam". Decompile main/WinMain and the accept/recv loop: identify the
listen socket setup (socket/bind/listen/accept via WSOCK32 ordinals — resolve them),
the password handshake, the per-client thread/select model, and what messages clients
exchange (this is combo-leader + shared position/follow coordination — the multi-box
"COMBO" feature). Then document the tibiadb.com side from magebotv55 strings: the HTTP
license/registration calls (key.php, resendkey.php, addcomputer.php, "GET %s%d&v=55&m=%d
HTTP/1.1 Host: tibiadb.com"), machine-id, the "teamserver ... private server ... 10
players" hosted variant. Use tools/disasm.py on samples/shared/server.exe.`,
  },
  {
    file: 'docs/06-v860-lineage.md',
    label: 'v860',
    task: `Write docs/06-v860-lineage.md — the non-Lua v860 lineage (samples/v860/
magebotv55.exe, 2022 build, no lua51 import, 275 recovered funcs). It exposes the SAME
engine as v10x but is driven by in-client CHAT COMMANDS + settings files instead of
Lua. From recon/v860_magebot.strings.txt document the command vocabulary: .follow,
.otfollow, .attack, .stopfollow (and their confirmations "*%s* Attack set on :%s:
id:%i", "OT style follow", etc.), the healer ("UH Heal set on", "exura sio Heal set
on", sheal/gheal/uheal, "HP is below your light healing %, Pausing"), the targeting
("targeting.txt", "Target lost.", "Dodge/Hotkey", "Cave_Run/Hotkey", "Open_Run/
Hotkey"), the waypoint recorder ("Action Recorded", "recording %i %i %i %i", "Near z
change waypoint"), the looter ("pile loot2", "chking looter open %x"). Locate and
lightly decompile the chat-command parser (find the string refs to ".attack"/".follow"
and the dispatcher that compares the typed line). Document the settings/data files
this lineage consumes: SETTINGS.txt, sorcererSETTINGS.txt, customhotkeys.txt,
targeting.txt, itenids.txt, pzzones.txt, and the .sav/.savd binary cavebot recordings
+ the *.bin tile maps (blktiles/mtiles/stoptiles/conttiles). Contrast with v10x: same
core, different control surface.`,
  },
]

phase('Author')
const results = await parallel(AGENTS.map(a => () =>
  agent(`${BACKBONE}\n\n=== YOUR ASSIGNMENT ===\n${a.task}\n\nWrite the file to ${REPO}/${a.file} using the Write tool. Then return a 2-line summary of what you documented and any open questions.`,
    { label: a.label, phase: 'Author', effort: 'high' })
))

log(`authored ${results.filter(Boolean).length}/${AGENTS.length} docs`)
return AGENTS.map((a, i) => ({ file: a.file, ok: !!results[i], summary: results[i] }))
