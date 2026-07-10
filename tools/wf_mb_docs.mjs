export const meta = {
  name: 'magebot-deep-docs',
  description: 'Deep-document every bot-region magebotv55 function from its Hex-Rays pseudocode',
  phases: [{ title: 'Document', detail: 'one agent per chunk: pseudocode -> name + mechanism-level purpose' }],
}

const CHUNKS = Number(args?.chunks || 18)
const CDIR = '/tmp/claude-1000/-home-kizudev-Documents-Repos-magebot-re/9b8c3669-5386-483d-bbab-ee0854da4916/scratchpad/mb_chunks'
const RDIR = '/tmp/claude-1000/-home-kizudev-Documents-Repos-magebot-re/9b8c3669-5386-483d-bbab-ee0854da4916/scratchpad/mb_doc_results'
const REPO = '/home/kizudev/Documents/Repos/magebot_re'

const GUIDE = `You are reverse-engineering **MageBot v5.5** (aka TibiaMB), an EXTERNAL
memory-injection bot for the Tibia 10.x client (magebotv55.exe, imagebase
0x400000, MSVC + Lua 5.1). This is the ONLY target — do not reference or import
anything from other bots. Repo: ${REPO} (read docs/00-status.md, docs/01-overview.md,
docs/functions/engine-core.md for the architecture before you start).

VERIFIED ARCHITECTURE (reuse, don't re-derive): MageBot is external — it
OpenProcess'es the Tibia client and reads state via ReadProcessMemory on a
throttled RPM-polling cache (creatures unk_4C1D3D8, containers byte_4C1AB74, map
byte_4B29044; self scalars read live + XOR-deobfuscated). MB_ReadClientState
(0x4024a2) is the read helper; MB_SendAction (0x405f1d) builds client->server
Tibia frames; MB_InjectFrame (0x40320a) fwrites them into \\.\pipe\SamplePipe%i,
re-emitted by an injected packet.dll shim. Lua API = 63 registered globals
(MB_* names). Attack opcode 0xA1, walk opcodes 0x65-0x6C, enable gate [0x469098].

For each function in your chunk (given as Hex-Rays pseudo-C with addr/name/size),
write a SPECIFIC, mechanism-level purpose: what it computes/does, which globals it
reads/writes (name the addresses, e.g. the 0x4db3xxx client-address band or the
0x468fxx bases), which helpers it calls, what opcode/packet it builds, what client
field it touches. Ground every claim in the code. NO generic filler. If it is
clearly MSVC CRT / STL / Lua-runtime glue, say which primitive. Mark guesses low.

NAMING: if the function is already named MB_* or otherwise non-sub_, KEEP that name
(copy it). For sub_* functions, propose a camelCase descriptive name reflecting the
purpose (e.g. computeCreatureScreenPos, healerCheckHp, parseHotkeyLine). Valid C
identifiers only. Never rename an already-named function.`

const SCHEMA = {
  type: 'object', required: ['entries'],
  properties: { entries: { type: 'array', items: { type: 'object',
    required: ['addr', 'name', 'purpose', 'confidence'],
    properties: {
      addr: { type: 'string', description: 'copy verbatim from input' },
      name: { type: 'string', description: 'existing MB_/name kept, or new camelCase for sub_' },
      purpose: { type: 'string', description: 'mechanism-level purpose grounded in the code' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    } } } },
}

phase('Document')
const idx = Array.from({ length: CHUNKS }, (_, i) => i)
const results = await parallel(idx.map(i => () => {
  const cf = `${CDIR}/chunk_${String(i).padStart(3, '0')}.json`
  const rf = `${RDIR}/chunk_${String(i).padStart(3, '0')}.json`
  return agent(
    `${GUIDE}\n\nRead the chunk file ${cf} (JSON array of functions, each with addr/size/n_insn/apis/strs/calls and \`asm\` = annotated x86 disassembly; call targets are annotated with import names, MB_* names, or sub_XXXX). These are all currently-unnamed sub_* functions — propose a camelCase name for each. Document EVERY function. Write results as a JSON array to ${rf} — {addr,name,purpose,confidence} per element — AND return via schema. Copy addr verbatim. Skip none.`,
    { label: `mbdoc_${i}`, phase: 'Document', effort: 'high', schema: SCHEMA }
  ).then(r => ({ i, n: r?.entries?.length || 0 }))
}))
log(`documented ${results.filter(Boolean).reduce((s, r) => s + r.n, 0)} across ${results.filter(Boolean).length}/${CHUNKS}`)
return results.filter(Boolean)
