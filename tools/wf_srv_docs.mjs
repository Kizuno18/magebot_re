export const meta = {
  name: 'magebot-server-docs',
  description: 'Deep-document server.exe (the MageBot Team Server) bot-region functions',
  phases: [{ title: 'Document' }],
}

const CHUNKS = 13
const REPO = '/home/kizudev/Documents/Repos/magebot_re'
const CDIR = `${REPO}/.work/srv_chunks`
const RDIR = `${REPO}/.work/srv_results`

const GUIDE = `You are reverse-engineering **server.exe**, the local **Team Server** of the
MageBot v5.5 distribution (a Tibia bot) — imagebase 0x400000, MSVC, WSOCK32. This
is the ONLY target — never reference other bots. Read ${REPO}/docs/05-teamserver.md
first for the known protocol (it is a single-threaded select() COMBO relay hub:
main@0x401000, listener@0x40545a, accept/select loop@0x406097, recvClient@0x40563c
password handshake + 2-char command framing, flushClient@0x405fb5, port 7575,
loopback, 63-client cap, pt-BR). This server coordinates multi-boxing: it relays
enemy-list / chat / combo / potion / single-shot commands between the MageBot
clients connected to it, with leader-gated operations.

For each function in your chunk (annotated x86 disassembly with addr/size/apis/
strs/calls/asm), write a SPECIFIC mechanism-level purpose: what it does, the WSOCK
calls (socket/bind/listen/accept/select/recv/send via resolved ordinals), the
per-client 0x5084-byte struct fields it touches, the 2-char command opcodes it
frames/dispatches, the password/spam checks. Ground every claim in the asm. NO
generic filler; if a function is MSVC CRT/STL, say which primitive. Mark guesses low.

NAMING: propose a camelCase C-identifier name for each sub_* reflecting its role
(e.g. srvAcceptClient, srvRelayComboCommand, srvCheckPassword). Never rename a
non-sub_ function.`

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
    { label: `srv_${i}`, phase: 'Document', effort: 'high', schema: SCHEMA }
  ).then(r => ({ i, n: r?.entries?.length || 0 }))
}))
log(`documented ${results.filter(Boolean).reduce((s, r) => s + r.n, 0)} server funcs`)
return results.filter(Boolean)
