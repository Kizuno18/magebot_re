#!/usr/bin/env python3
"""Merge the magebot function-doc workflow output into a catalog + IDA rename
batch. All documented functions were sub_* in the corpus (MB_* were skipped), so
naming them is safe (no clobber). Writes:
  - docs/functions/catalog-bot.md        (addr | name | size | purpose)
  - recon/mb_function_purposes.json       (addr -> {name, purpose, conf})
  - scratchpad/mb_ida_rename.json          (rename batch [{addr,name}])
"""
import json, glob, re, os

REPO = "/home/kizudev/Documents/Repos/magebot_re"
SC = "/tmp/claude-1000/-home-kizudev-Documents-Repos-magebot-re/9b8c3669-5386-483d-bbab-ee0854da4916/scratchpad"
FN = f"{REPO}/docs/functions"

def norm(a):
    a = str(a).lower().strip()
    return a if a.startswith("0x") else "0x" + a

size = {norm(r["addr"]): r["size"] for r in json.load(open(f"{SC}/mb_corpus.json"))}

docs = {}
for rf in glob.glob(f"{SC}/mb_doc_results/chunk_*.json"):
    try:
        for e in json.load(open(rf)):
            docs[norm(e["addr"])] = {"name": e.get("name", "").strip(),
                                     "purpose": e.get("purpose", "").strip(),
                                     "conf": e.get("confidence", "")}
    except Exception as ex:
        print("skip", rf, ex)

# de-duplicate proposed names
used = set()
def uniq(n, addr):
    n = re.sub(r"[^A-Za-z0-9_]", "_", n or "")
    if not n or not re.match(r"[A-Za-z_]", n):
        n = "sub_" + addr[2:]
    base, i = n, 2
    while n in used:
        n = f"{base}_{i}"; i += 1
    used.add(n)
    return n

rows, renames = [], []
for addr in sorted(docs, key=lambda a: int(a, 16)):
    d = docs[addr]
    nm = uniq(d["name"], addr)
    purpose = (d["purpose"] or "").replace("|", "\\|").replace("\n", " ")
    rows.append((addr, nm, size.get(addr, ""), purpose))
    if not nm.startswith("sub_"):
        renames.append({"addr": addr, "name": nm})
    d["name"] = nm

lines = [
    "# magebotv55.exe (v10x) — bot-region function catalog",
    "",
    f"Deep per-function documentation of the {len(rows)} bot-logic functions recovered "
    "in the `0x401000`–`0x440000` region (the `0x44xxxx`+ band is MSVC CRT / Lua / "
    "STL). The 63 Lua API implementations and the engine backbone are named `MB_*` "
    "and documented in [03-lua-api.md](../03-lua-api.md) and "
    "[engine-core.md](engine-core.md); this catalog covers the remaining bot code. "
    "Names/purposes recovered from annotated disassembly.",
    "",
    "| Address | Name | Size | Purpose |",
    "|---|---|---|---|",
]
for addr, nm, sz, purpose in rows:
    lines.append(f"| `{addr}` | `{nm}` | {sz} | {purpose} |")
open(f"{FN}/catalog-bot.md", "w").write("\n".join(lines) + "\n")

os.makedirs(f"{REPO}/recon", exist_ok=True)
json.dump({a: docs[a] for a in docs}, open(f"{REPO}/recon/mb_function_purposes.json", "w"), indent=0)
json.dump(renames, open(f"{SC}/mb_ida_rename.json", "w"), indent=0)
print(f"catalog {len(rows)} funcs | {len(renames)} renames -> {SC}/mb_ida_rename.json")
