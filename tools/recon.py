#!/usr/bin/env python3
"""MageBot offline recon: PE structure, imports/exports, strings, Lua binding
table (thunk-resolved), and a capstone function inventory. Writes JSON + md
artifacts under recon/ for the analysis docs. No IDA required.

Usage: python3 tools/recon.py samples/v10x/magebotv55.exe [tag]
"""
import pefile, capstone, struct, json, re, sys, os, datetime

PATH = sys.argv[1] if len(sys.argv) > 1 else "samples/v10x/magebotv55.exe"
TAG = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(PATH).replace(".", "_")
os.makedirs("recon", exist_ok=True)

pe = pefile.PE(PATH)
IB = pe.OPTIONAL_HEADER.ImageBase
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
md.detail = True

secs = [(IB + s.VirtualAddress, IB + s.VirtualAddress + s.Misc_VirtualSize,
         s.Name.rstrip(b"\x00").decode("latin1"), s.get_data()) for s in pe.sections]

def sec_of(va):
    for lo, hi, nm, d in secs:
        if lo <= va < hi:
            return nm, lo, d
    return None, None, None

def in_text(va):
    nm, _, _ = sec_of(va)
    return nm == ".text"

def rd(va, mx=200):
    nm, lo, d = sec_of(va)
    if d is None:
        return None
    o = va - lo
    e = d.find(b"\x00", o)
    if e < 0 or e - o > mx:
        return None
    try:
        return d[o:e].decode("latin1")
    except Exception:
        return None

txt = next(s for s in secs if s[2] == ".text")
tbase, tdata = txt[0], txt[3]

def thunk_target(va):
    """If va is a lone `jmp rel32` thunk, return its target, else va."""
    o = va - tbase
    if 0 <= o < len(tdata) and tdata[o] == 0xE9:
        rel = struct.unpack("<i", tdata[o + 1:o + 5])[0]
        return (va + 5 + rel) & 0xffffffff
    return va

# ---- imports / exports ----
imports = {}
if hasattr(pe, "DIRECTORY_ENTRY_IMPORT"):
    for e in pe.DIRECTORY_ENTRY_IMPORT:
        imports[e.dll.decode("latin1")] = sorted(
            imp.name.decode("latin1") if imp.name else f"ord{imp.ordinal}" for imp in e.imports)
exports = []
if hasattr(pe, "DIRECTORY_ENTRY_EXPORT"):
    exports = [(e.name.decode("latin1") if e.name else f"ord{e.ordinal}",
                IB + e.address) for e in pe.DIRECTORY_ENTRY_EXPORT.symbols]

# ---- lua bindings (only for the lua-linked exe) ----
lua = {}
for dll, names in imports.items():
    if dll.lower().startswith("lua"):
        for e in pe.DIRECTORY_ENTRY_IMPORT:
            if e.dll.decode("latin1") == dll:
                for imp in e.imports:
                    if imp.name:
                        lua[imp.name.decode()] = imp.address

bindings = []
if "lua_pushcclosure" in lua and "lua_setfield" in lua:
    def stub(name):
        i = tdata.find(struct.pack("<I", lua[name]))
        return tbase + i - 2 if i >= 2 and tdata[i - 2:i] == b"\xff\x25" else None
    PUSHCC, SETF = stub("lua_pushcclosure"), stub("lua_setfield")
    pushes = []
    last_cf = None
    for insn in md.disasm(tdata, tbase):
        if insn.mnemonic == "push" and insn.operands and insn.operands[0].type == capstone.x86.X86_OP_IMM:
            pushes.append(insn.operands[0].imm & 0xffffffff)
            pushes = pushes[-6:]
        elif insn.mnemonic == "call" and insn.operands and insn.operands[0].type == capstone.x86.X86_OP_IMM:
            dst = insn.operands[0].imm & 0xffffffff
            if dst == PUSHCC:
                for im in reversed(pushes):
                    if in_text(im):
                        last_cf = im
                        break
            elif dst == SETF:
                for im in reversed(pushes):
                    s = rd(im)
                    if s and re.fullmatch(r"[A-Za-z_]\w*", s):
                        bindings.append((s, last_cf))
                        break
                last_cf = None
            pushes = []
    seen = set()
    uniq = []
    for n, cf in bindings:
        if n in seen:
            continue
        seen.add(n)
        real = thunk_target(cf) if cf else None
        uniq.append({"name": n, "stub": (f"0x{cf:08x}" if cf else None),
                     "impl": (f"0x{real:08x}" if real else None)})
    bindings = uniq

# ---- function inventory (call-target recovery) ----
seeds = set()
if exports:
    for _, va in exports:
        seeds.add(va)
seeds.add(IB + pe.OPTIONAL_HEADER.AddressOfEntryPoint)
for insn in md.disasm(tdata, tbase):
    if insn.mnemonic == "call" and insn.operands and insn.operands[0].type == capstone.x86.X86_OP_IMM:
        t = insn.operands[0].imm & 0xffffffff
        if in_text(t):
            seeds.add(t)
    elif insn.mnemonic == "push" and insn.operands and insn.operands[0].type == capstone.x86.X86_OP_IMM:
        t = insn.operands[0].imm & 0xffffffff
        if in_text(t):  # function pointer taken (callbacks, lua closures)
            seeds.add(t)
funcs = sorted(f for f in seeds if in_text(f))

# ---- strings ----
strings = []
for lo, hi, nm, d in secs:
    if nm in (".rdata", ".data"):
        for m in re.finditer(rb"[\x20-\x7e]{5,}", d):
            strings.append(m.group().decode("latin1"))

summary = {
    "path": PATH, "imagebase": f"0x{IB:x}",
    "entry": f"0x{IB + pe.OPTIONAL_HEADER.AddressOfEntryPoint:x}",
    "timestamp": datetime.datetime.fromtimestamp(pe.FILE_HEADER.TimeDateStamp, datetime.timezone.utc).isoformat(),
    "sections": [{"name": s.Name.rstrip(b"\x00").decode("latin1"),
                  "va": f"0x{IB + s.VirtualAddress:x}", "vsize": f"0x{s.Misc_VirtualSize:x}",
                  "rsize": f"0x{s.SizeOfRawData:x}"} for s in pe.sections],
    "imports": imports, "exports": [(n, f"0x{v:x}") for n, v in exports],
    "n_functions": len(funcs), "n_bindings": len(bindings), "n_strings": len(strings),
}
json.dump(summary, open(f"recon/{TAG}.summary.json", "w"), indent=1)
json.dump(bindings, open(f"recon/{TAG}.bindings.json", "w"), indent=1)
json.dump([f"0x{f:08x}" for f in funcs], open(f"recon/{TAG}.funcs.json", "w"), indent=1)
open(f"recon/{TAG}.strings.txt", "w").write("\n".join(strings))

print(f"[{TAG}] entry {summary['entry']} ts {summary['timestamp'][:10]} "
      f"| {len(funcs)} funcs | {len(bindings)} lua bindings | {len(strings)} strings")
if bindings:
    print(f"  bindings -> recon/{TAG}.bindings.json (impl addresses thunk-resolved)")
