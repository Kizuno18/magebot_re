export const meta = {
  name: 'magebot-flow-docs',
  description: 'Author subsystem flow deep-dive docs for magebotv55 from the named function catalog',
  phases: [{ title: 'Author' }],
}

const REPO = '/home/kizudev/Documents/Repos/magebot_re'
const CORPUS = '/tmp/claude-1000/-home-kizudev-Documents-Repos-magebot-re/9b8c3669-5386-483d-bbab-ee0854da4916/scratchpad/mb_corpus.json'

const BASE = `You are documenting the internal FLOW of **MageBot v5.5** (magebotv55.exe
v10x, Tibia 10.x external RPM/named-pipe bot, imagebase 0x400000). This is the
ONLY target — never mention or import other bots. Sources to read first:
- ${REPO}/docs/01-overview.md and ${REPO}/docs/functions/engine-core.md (architecture)
- ${REPO}/docs/functions/catalog-bot.md (222 named bot functions + purposes)
- ${CORPUS} (JSON array: each {addr,name?,size,apis,strs,calls,asm} = annotated
  x86 disassembly for a bot-region function; grep it for your subsystem's addrs)

Verified backbone (reuse): MB_ReadClientState 0x4024a2 = RPM-polling cache reader;
MB_SendAction 0x405f1d builds client->server frames; MB_InjectFrame 0x40320a
fwrites them to \\.\pipe\SamplePipe%i (packet.dll shim re-emits). Client-address
resolvers (0x401axx-0x402xxx) fill the 0x4db3xxx band that ReadClientState reads.
The engine ticks (healerAndReloader, attackComboEngineTick, waypointWalker,
dispatchTimerCallbacks) are driven from within the MB_WinMain region
(0x437aa5-0x43ba93). Walk opcodes 0x65-0x6C; attack 0xA1.

Write a DEEP flow doc: prose + a compact ASCII data/control-flow + a
function-by-function walk of your subsystem (each key function: address, what it
reads/writes, what it calls, what packet/opcode it emits). Ground every claim in
the catalog/corpus. Terse technical voice like the sibling docs. Mark anything
you cannot confirm from the asm "(unconfirmed)". English. Do NOT rename anything.`

const DOCS = [
  { file: 'docs/07-master-loop-and-threads.md', label: 'master-loop',
    task: `The master loop + threading. Cover: entry 0x44bf9f -> MB_WinMain 0x437aa5 boot (clear gate [0x469098], safemode1st.txt notepad gate, RPCRT4 UuidCreateSequential machine-id, OpenProcess client -> [0x4d22464]); the address-resolver init bank called at boot (initAddrClientBase*/resolveClientAddr* fill the 0x4db3xxx band); the 5 spawned threads (from engine-core §6); and CRUCIALLY the engine tick driver inside the WinMain/dialog region (0x437aa5-0x43ba93) that calls attackComboEngineTick, healerAndReloader, waypointWalker, dispatchTimerCallbacks, advanceAllTimerCounters — establish the per-tick order and gating. Note DialogBoxParamA + whether a message pump exists.` },
  { file: 'docs/08-address-resolution-and-mirror.md', label: 'mirror',
    task: `The client-address resolution bank + the RPM-polling mirror. Document how the ~120 resolveClientAddr_*/initAddrClientBase* functions (0x401axx-0x402xxx) compute client.exe field addresses from base pointers [0x468exx]/[0x468fxx] + offsets and store them into the 0x4db3xxx band; then how MB_ReadClientState 0x4024a2 dispatches by band into the throttled batch-RPM caches (creatures unk_4C1D3D8 / containers byte_4C1AB74 / map byte_4B29044) vs live XOR-deobfuscated self scalars. Build the resolver->band->cache table. This is the read half of the whole bot.` },
  { file: 'docs/09-packet-build-inject-pipeline.md', label: 'packets',
    task: `The full client->server packet pipeline. Enumerate EVERY packet builder (build*Frame* in the catalog) into an opcode table: attack 0xA1, follow 0xA2, walk 0x65-0x6C, move/throw 0x78, use 0x82/0x83/0x84, look 0x05, ping 0x14 (buildPingFrame14), talk 0x64/0x96, npc buy 0x7A/sell 0x7B, login (buildRsaLoginPacket 0x43124a). Then MB_SendAction 0x405f1d gating -> MB_InjectFrame 0x40320a -> the XTEA path (sendPipeXteaFrame 0x403574) -> named pipe -> packet.dll shim -> ws2_32 send. Note recordAndReplayActionPacket 0x4037ed and the client-input drivers (driveClient*/clientPress*) as the alternative act path (window messages/mouse vs pipe).` },
  { file: 'docs/10-targeting-and-attack.md', label: 'targeting',
    task: `The targeting + attack engine. Walk runTargetSelectionEngine 0x411cae, attackComboEngineTick 0x40fbd9, autoAttackNearestTick 0x40a3b5, targetNearestCreatureAndAttack 0x41e6fe, attackScanAndFire 0x42176e, runRuneAttackTargeting 0x40cee4, recolorTargetCreatures 0x40f018, and the creature scan/scoring helpers (countWeightedMonstersNearPoint, sumMonsterDistanceNearPoint, isMonsterOnScreenSelf, isMonsterWithinRangeSelf, isCreatureInThrowRange, computeTargetScreenX/Y). Explain target selection scoring, the combo/rune casting, and how it feeds the packet builders. targeting.txt config via loadConfigLists.` },
  { file: 'docs/11-cavebot-navigation.md', label: 'cavebot',
    task: `The cavebot / navigation engine. Walk waypointWalker 0x419c8c, runWaypointNavigator 0x4333e1, exploreStepPlanner 0x41899b, cavebotWalkToWaypointTarget(Guarded) 0x416b26/0x41701b, the flood-fill pathfinder buildPathToTileFloodFill 0x417c33 + floodFillReachabilityStep 0x41814e + gridTileCostLookup 0x41865a + gridMarkPathAndRecurse 0x418786, walkStepToTargetThrottled 0x4331bc, checkDirectionBlocked 0x433294, checkTileWalkableAtDelta 0x40a6fb, scanBlockingTilesOctantA/B, computeLureWalkStep 0x40b0a3, rotateMoveDirectionGrid 0x42b4ba, and the waypoint recorder (appendWaypointRecord, recordStartRecording, recordSaveLoadDialog). Explain the cost-grid pathing, waypoint types, warp/stair handling, and how it emits walk opcodes via MB_SendWalk. Contrast with the Lua Set*Waypoint API.` },
  { file: 'docs/12-healer-looter-hotkeys.md', label: 'healer',
    task: `The healer, looter, food and hotkey/rune subsystems. Walk healerAndReloader 0x41c274, cavebotHealSafetyTick 0x40850c, potionOnFriendTick 0x40a10d, containerFoodUseLoop 0x41bc76, scanBattleListForUse 0x41bafa, pileLootStackableItems 0x4169e0, scanTilesForItemIdsThrottled 0x4166ab, castRuneOnCreaturesInContainer 0x41ce49, castHotkeyOnMatchingCreatures 0x41d0e5, walkAndCastAlongCreaturePath 0x41d519. Explain HP/mana thresholds, potion/rune id config (SetManaPotIDS/SetRuneIDS from the Lua API), the auto-eat-food loop, and the loot pile/scan flow. Cross-ref SETTINGS.txt / itenids.txt / targeting.txt.` },
  { file: 'docs/13-chat-commands-and-lua.md', label: 'chat-lua',
    task: `The chat-command control surface + Lua integration. Walk chatCommandDispatcher 0x42dd58, parseChatCommandAndSpells 0x41ebd0, initLuaStateAndRegisterApi 0x4369e2 (registers the 63 globals — cross-ref 03-lua-api.md), dispatchTimerCallbacks 0x4377b4, loadScriptFileIntoSlot 0x43430d, findScriptSlotByName 0x433af7, resetScriptAndWaypointState 0x4341f7, openLuaScriptDialog 0x4241ad. Explain how chat commands and Lua scripts drive the same engines, the script slot model, the timer-callback tick that runs Lua Run() functions, and the script_loader.lua/utils.lua relationship.` },
  { file: 'docs/14-login-crypto-licensing.md', label: 'login',
    task: `The login/RSA, crypto, and tibiadb.com licensing flow. Walk buildRsaLoginPacket 0x43124a, bigIntMultiply256 0x4310c2 + bigIntSubtract256 0x430daf (the RSA modexp bignum), deriveMachineIdFromUuid 0x4314ce (RPCRT4 UuidCreateSequential -> machine id), licenseAuthorizeCheck 0x4317bc, httpGetCharacterPage 0x431ce6 + urlEncodeSpacesToPlus 0x431f70, tcpConnect 0x42b442, spawnNoobLoginThreads 0x42db20, patchClientAntiIdlePong 0x430886, applyClientPatchTable 0x41cc90 + isClientPatched 0x41ce04, sendPipeXteaFrame 0x403574 (XTEA). Document the RSA public key handling, the machine-id licensing HTTP to tibiadb.com (key.php/addcomputer.php, v=55, m=%d from 02-static-analysis), and the client patches the bot applies.` },
]

phase('Author')
const results = await parallel(DOCS.map(d => () => agent(
  `${BASE}\n\n=== YOUR DOC ===\n${d.task}\n\nWrite the file to ${REPO}/${d.file} using Write. Return a 2-line summary + any open questions.`,
  { label: d.label, phase: 'Author', effort: 'high' }
)))
log(`authored ${results.filter(Boolean).length}/${DOCS.length} flow docs`)
return DOCS.map((d, i) => ({ file: d.file, ok: !!results[i] }))
