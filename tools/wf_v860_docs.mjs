export const meta = {
  name: 'magebot-v860-docs',
  description: 'Deep-document the v860 (Tibia 8.60, non-Lua) magebotv55.exe bot functions',
  phases: [{ title: 'Document' }],
}

const CHUNKS = 20
const REPO = '/home/kizudev/Documents/Repos/magebot_re'
const CDIR = `${REPO}/.work/v860_chunks`
const RDIR = `${REPO}/.work/v860_results`

const GUIDE = `You are reverse-engineering the **v860 lineage** of MageBot v5.5 —
\`samples/v860/magebotv55.exe\` (Tibia 8.60 client, NON-Lua, 2022 build, imagebase
0x400000, MSVC + WSOCK32). This is the ONLY target — never reference other bots.
Read ${REPO}/docs/06-v860-lineage.md first: it is the SAME external RPM/named-pipe
engine as the v10x build but driven by in-client CHAT COMMANDS (.attack / .follow /
.otfollow / .stopfollow), settings files, and a .sav cavebot recorder instead of
Lua. Key v860 facts: creature array base [0x45ff0c] stride 0xA8; chat-command
dispatcher ~0x41df85 (strstr-chain, buffer 0x46d3d84); healer (UH / exura sio /
sheal/gheal/uheal); targeting (targeting.txt); waypoint recorder (.sav/.savd);
looter. It reads client memory via a ReadClientState-style RPM helper and injects
client->server frames the same way v10x does (addresses differ).

For each function in your chunk (annotated x86 disassembly with addr/size/apis/
strs/calls/asm), write a SPECIFIC mechanism-level purpose grounded in the code:
globals it reads/writes, helpers it calls, opcodes/packets it builds, the chat
command or setting it implements. NO generic filler; if MSVC CRT/STL, say which
primitive. Where a function mirrors a known v10x subsystem (targeting/cavebot/
healer/looter/packet-builder), say so. Mark guesses low.

NAMING: propose a camelCase C-identifier for each sub_* reflecting its role
(prefix v860 subsystem where useful, e.g. v860HealerTick, v860ParseAttackCmd,
buildAttackFrame). Never rename a non-sub_ function.`

const SCHEMA = {
  type: 'object', required: ['entries'],
  properties: { entries: { type: 'array', items: { type: 'object',
    required: ['addr', 'name', 'purpose', 'confidence'],
    properties: {
      addr: { type: 'string' }, name: { type: 'string' },
      purpose: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    } } } },
}

phase('Document')
const idx = Array.from({ length: CHUNKS }, (_, i) => i)
const results = await parallel(idx.map(i => () => {
  const cf = `${CDIR}/chunk_${String(i).padStart(3, '0')}.json`
  const rf = `${RDIR}/chunk_${String(i).padStart(3, '0')}.json`
  return agent(
    `${GUIDE}\n\nRead the chunk file ${cf} (JSON array; each {addr,size,apis,strs,calls,asm}). Document EVERY function. Write results as a JSON array to ${rf} — {addr,name,purpose,confidence} — AND return via schema. Copy addr verbatim. Skip none.`,
    { label: `v860_${i}`, phase: 'Document', effort: 'high', schema: SCHEMA }
  ).then(r => ({ i, n: r?.entries?.length || 0 }))
}))
log(`documented ${results.filter(Boolean).reduce((s, r) => s + r.n, 0)} v860 funcs`)
return results.filter(Boolean)
