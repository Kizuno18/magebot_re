#!/usr/bin/env python3
"""Build an offline documentation corpus for magebotv55.exe (v10x).

Recovers function extents, disassembles each (capstone), annotates call targets
with import/known names and referenced C-strings, and emits chunk files for the
documentation workflow. Skips functions already named MB_* and pure jmp thunks.

Output: scratchpad/mb_chunks/chunk_NNN.json + scratchpad/mb_corpus.json
"""
import pefile, capstone, struct, json, re, sys, os

PATH = "samples/v10x/magebotv55.exe"
OUT = sys.argv[1] if len(sys.argv) > 1 else \
    "/tmp/claude-1000/-home-kizudev-Documents-Repos-magebot-re/9b8c3669-5386-483d-bbab-ee0854da4916/scratchpad"
os.makedirs(f"{OUT}/mb_chunks", exist_ok=True)

pe = pefile.PE(PATH)
IB = pe.OPTIONAL_HEADER.ImageBase
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
md.detail = True
secs = [(IB + s.VirtualAddress, IB + s.VirtualAddress + s.Misc_VirtualSize,
         s.Name.rstrip(b"\x00").decode("latin1"), s.get_data()) for s in pe.sections]
txt = next(s for s in secs if s[2] == ".text")
tbase, tdata, thi = txt[0], txt[3], txt[1]

def sec(v):
    for lo, hi, nm, d in secs:
        if lo <= v < hi:
            return lo, nm, d
    return None, None, None

names = {}
for e in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
    for imp in e.imports:
        if imp.name:
            names[imp.address] = imp.name.decode()
stub = {}
for iat, n in names.items():
    i = tdata.find(struct.pack("<I", iat))
    if i >= 2 and tdata[i - 2:i] == b"\xff\x25":
        stub[tbase + i - 2] = n

# known named functions (my MB_* set) — load from recon bindings + backbone
KNOWN = {}
try:
    for b in json.load(open("recon/v10x_magebot.bindings.json")):
        if b.get("impl"):
            KNOWN[int(b["impl"], 16)] = "MB_" + b["name"]
except Exception:
    pass
KNOWN.update({0x405f1d: "MB_SendAction", 0x4024a2: "MB_ReadClientState",
              0x40320a: "MB_InjectFrame", 0x437aa5: "MB_WinMain", 0x404a9b: "MB_SendWalk"})

def cstr(v):
    lo, nm, d = sec(v)
    if d is None or nm not in (".rdata", ".data"):
        return None
    o = v - lo
    e = d.find(b"\x00", o)
    if 0 <= e - o <= 100:
        try:
            s = d[o:e].decode("latin1")
            return s if s.isprintable() and len(s) >= 4 else None
        except Exception:
            return None
    return None

# recover function starts: distinct CALL targets in .text (call-only avoids the
# jump-table / intra-function jmp-target noise that over-segments the recovery)
def resolve_thunk(va):
    o = va - tbase
    if 0 <= o < len(tdata) and tdata[o] == 0xE9:
        return (va + 5 + struct.unpack("<i", tdata[o + 1:o + 5])[0]) & 0xffffffff
    return va
seeds = set(KNOWN)
seeds.add(IB + pe.OPTIONAL_HEADER.AddressOfEntryPoint)
for insn in md.disasm(tdata, tbase):
    if insn.mnemonic == "call" and insn.operands and insn.operands[0].type == capstone.x86.X86_OP_IMM:
        t = insn.operands[0].imm & 0xffffffff
        if tbase <= t < thi:
            seeds.add(resolve_thunk(t))  # follow incremental-link jmp thunks to the real body
starts = sorted(seeds)

def is_jmp_thunk(va):
    o = va - tbase
    return 0 <= o < len(tdata) and tdata[o] == 0xE9  # lone jmp rel32

MAXADDR = 0x440000  # bot-logic region; 0x44xxxx+ is MSVC CRT / Lua / STL
corpus = []
for i, va in enumerate(starts):
    end = starts[i + 1] if i + 1 < len(starts) else thi
    if va in KNOWN or is_jmp_thunk(va) or va >= MAXADDR:
        continue
    size = min(end - va, 0x1400)
    o = va - tbase
    lines, apis, strs, calls = [], set(), set(), set()
    n = 0
    for insn in md.disasm(tdata[o:o + size], va):
        ann = ""
        if insn.operands:
            op = insn.operands[-1]
            if op.type == capstone.x86.X86_OP_IMM:
                t = op.imm & 0xffffffff
                if insn.mnemonic == "call":
                    if t in stub:
                        ann = f"  ; {stub[t]}"; apis.add(stub[t])
                    elif t in KNOWN:
                        ann = f"  ; {KNOWN[t]}"; calls.add(KNOWN[t])
                    elif tbase <= t < thi:
                        ann = f"  ; sub_{t:X}"; calls.add(f"sub_{t:X}")
                else:
                    s = cstr(t)
                    if s:
                        ann = f'  ; "{s}"'; strs.add(s)
            elif op.type == capstone.x86.X86_OP_MEM and op.mem.base == 0 and op.mem.index == 0:
                t = op.mem.disp & 0xffffffff
                if t in names:
                    ann = f"  ; {names[t]}"; apis.add(names[t])
                else:
                    s = cstr(t)
                    if s:
                        ann = f'  ; "{s}"'; strs.add(s)
        lines.append(f"{insn.mnemonic} {insn.op_str}{ann}")
        n += 1
        if insn.mnemonic == "ret" or n >= 400:
            break
    if n < 3:
        continue
    corpus.append({"addr": f"0x{va:x}", "size": end - va, "n_insn": n,
                   "apis": sorted(apis), "strs": sorted(strs)[:12],
                   "calls": sorted(calls)[:20], "asm": "\n".join(lines)})

json.dump(corpus, open(f"{OUT}/mb_corpus.json", "w"))
# chunk ~16 funcs, cap ~38k chars asm
chunks, cur, curlen = [], [], 0
for r in corpus:
    al = len(r["asm"])
    if cur and (len(cur) >= 16 or curlen + al > 38000):
        chunks.append(cur); cur, curlen = [], 0
    cur.append(r); curlen += al
if cur:
    chunks.append(cur)
for i, ch in enumerate(chunks):
    json.dump(ch, open(f"{OUT}/mb_chunks/chunk_{i:03d}.json", "w"))
print(f"corpus {len(corpus)} funcs | {len(chunks)} chunks | known-skipped {len(KNOWN)}")
