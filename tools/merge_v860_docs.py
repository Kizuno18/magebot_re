#!/usr/bin/env python3
"""Merge v860 magebotv55.exe function docs -> catalog-v860.md."""
import json, glob, re

REPO = "/home/kizudev/Documents/Repos/magebot_re"
SC = f"{REPO}/.work"
FN = f"{REPO}/docs/functions"

def norm(a):
    a = str(a).lower().strip()
    return a if a.startswith("0x") else "0x" + a

size = {norm(r["addr"]): r["size"] for r in json.load(open(f"{SC}/v860_corpus.json"))}
docs = {}
for rf in glob.glob(f"{SC}/v860_results/chunk_*.json"):
    try:
        for e in json.load(open(rf)):
            docs[norm(e["addr"])] = {"name": e.get("name", "").strip(),
                                     "purpose": e.get("purpose", "").strip(),
                                     "conf": e.get("confidence", "")}
    except Exception as ex:
        print("skip", rf, ex)

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

lines = [
    "# magebotv55.exe (v860) — bot function catalog",
    "",
    f"Per-function documentation of {len(rows)} bot functions of the v860 lineage "
    "(Tibia 8.60, NON-Lua, imagebase `0x400000`). Same external RPM/named-pipe "
    "engine as v10x, driven by in-client chat commands + settings files + a `.sav` "
    "cavebot recorder instead of Lua. Lineage overview in "
    "[../06-v860-lineage.md](../06-v860-lineage.md); v10x equivalents in "
    "[catalog-bot.md](catalog-bot.md).",
    "",
    "| Address | Name | Size | Purpose |",
    "|---|---|---|---|",
]
for addr, nm, sz, purpose in rows:
    lines.append(f"| `{addr}` | `{nm}` | {sz} | {purpose} |")
open(f"{FN}/catalog-v860.md", "w").write("\n".join(lines) + "\n")
json.dump({a: docs[a] for a in docs}, open(f"{REPO}/recon/v860_function_purposes.json", "w"), indent=0)
json.dump(renames, open(f"{SC}/v860_ida_rename.json", "w"), indent=0)
print(f"v860 catalog {len(rows)} funcs | {len(renames)} renames")
