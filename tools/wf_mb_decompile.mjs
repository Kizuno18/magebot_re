export const meta = {
  name: 'magebot-decompile-corpus',
  description: 'Decompile every bot-region magebotv55 function (Hex-Rays via IDA) into a corpus',
  phases: [{ title: 'Decompile', detail: 'one agent per address range: IDA func_query + decompile -> corpus jsonl' }],
}

const DB = 'mb_v10x'
const OUT = '/tmp/claude-1000/-home-kizudev-Documents-Repos-magebot-re/9b8c3669-5386-483d-bbab-ee0854da4916/scratchpad/mb_corpus_parts'
const RANGES = [
  ['0x401000', '0x407000'], ['0x407000', '0x40c000'], ['0x40c000', '0x412000'],
  ['0x412000', '0x418000'], ['0x418000', '0x41e000'], ['0x41e000', '0x424000'],
  ['0x424000', '0x42b000'], ['0x42b000', '0x431000'], ['0x431000', '0x437000'],
  ['0x437000', '0x440000'],
]

phase('Decompile')
const results = await parallel(RANGES.map(([lo, hi], i) => () => agent(
  `You have access to the IDA MCP server (re-ida) for session "${DB}" (magebotv55.exe, a Tibia bot, imagebase 0x400000). Load the IDA tools you need via ToolSearch first: "select:mcp__re-ida__func_query,mcp__re-ida__decompile".

TASK: decompile every real function in the address range [${lo}, ${hi}) and write a JSON-lines corpus.
1. Call func_query on database "${DB}" with queries [{"sort_by":"addr","count":0}] and keep only functions whose addr is >= ${lo} and < ${hi} (any name — sub_* and named). If the result is truncated, paginate with offset.
2. For EACH such function, call decompile(database="${DB}", addr=<addr>, include_addresses=false). It returns {code}. Some may error — record {"addr":..,"error":..} and continue.
3. Append one JSON object per line to the file ${OUT}/part_${String(i).padStart(2, '0')}.jsonl, each: {"addr":"0x..","name":"<current ida name>","size":<int>,"c":"<pseudocode>"}. Truncate very long c to ~6000 chars.
Use the Write tool to create the file (write the whole JSONL string at once at the end, accumulating in memory). Do not rename anything. Do not skip functions.

Return: how many functions you decompiled and any addresses that errored.`,
  { label: `dec_${lo}`, phase: 'Decompile', effort: 'low' }
)))
log(`decompile agents done: ${results.filter(Boolean).length}/${RANGES.length}`)
return results.filter(Boolean)
