#!/usr/bin/env python3
"""Merge server.exe function docs -> catalog-server.md + IDA rename batch."""
import json, glob, re, os

REPO = "/home/kizudev/Documents/Repos/magebot_re"
SC = f"{REPO}/.work"
FN = f"{REPO}/docs/functions"

def norm(a):
    a = str(a).lower().strip()
    return a if a.startswith("0x") else "0x" + a

size = {norm(r["addr"]): r["size"] for r in json.load(open(f"{SC}/srv_corpus.json"))}
docs = {}
for rf in glob.glob(f"{SC}/srv_results/chunk_*.json"):
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
    "# server.exe — MageBot Team Server function catalog",
    "",
    f"Per-function documentation of the {len(rows)} bot-region functions of "
    "`server.exe` (the local combo/position relay hub — imagebase `0x400000`, "
    "WSOCK32, single-threaded `select()` loop). Protocol overview in "
    "[../05-teamserver.md](../05-teamserver.md); this catalogs the implementation.",
    "",
    "| Address | Name | Size | Purpose |",
    "|---|---|---|---|",
]
for addr, nm, sz, purpose in rows:
    lines.append(f"| `{addr}` | `{nm}` | {sz} | {purpose} |")
open(f"{FN}/catalog-server.md", "w").write("\n".join(lines) + "\n")
json.dump({a: docs[a] for a in docs}, open(f"{REPO}/recon/srv_function_purposes.json", "w"), indent=0)
json.dump(renames, open(f"{SC}/srv_ida_rename.json", "w"), indent=0)
print(f"server catalog {len(rows)} funcs | {len(renames)} renames")
