#!/usr/bin/env python3
"""Linear disassembler for a function at a VA. Follows `jmp rel32` thunks,
annotates call targets with imported names and referenced C-strings.

Usage: python3 tools/disasm.py <sample.exe|dll> <hexVA> [max_insn=80]
"""
import pefile, capstone, struct, sys

path, va = sys.argv[1], int(sys.argv[2], 16)
maxn = int(sys.argv[3]) if len(sys.argv) > 3 else 80
pe = pefile.PE(path)
IB = pe.OPTIONAL_HEADER.ImageBase
secs = [(IB + s.VirtualAddress, IB + s.VirtualAddress + s.Misc_VirtualSize,
         s.Name.rstrip(b"\x00").decode("latin1"), s.get_data()) for s in pe.sections]

def sec(v):
    for lo, hi, nm, d in secs:
        if lo <= v < hi:
            return lo, nm, d
    return None, None, None

# import stubs: map stub VA / IAT -> name
names = {}
for e in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
    for imp in e.imports:
        if imp.name:
            names[imp.address] = imp.name.decode()
txt = next(s for s in secs if s[2] == ".text")
tbase, tdata = txt[0], txt[3]
stub = {}
for iat, n in names.items():
    i = tdata.find(struct.pack("<I", iat))
    if i >= 2 and tdata[i - 2:i] == b"\xff\x25":
        stub[tbase + i - 2] = n

def cstr(v):
    lo, nm, d = sec(v)
    if d is None or nm not in (".rdata", ".data"):
        return None
    o = v - lo
    e = d.find(b"\x00", o)
    if 0 <= e - o <= 120:
        try:
            s = d[o:e].decode("latin1")
            return s if s.isprintable() and len(s) >= 3 else None
        except Exception:
            return None
    return None

def thunk(v):
    lo, nm, d = sec(v)
    if d is not None and nm == ".text" and d[v - lo] == 0xE9:
        return (v + 5 + struct.unpack("<i", d[v - lo + 1:v - lo + 5])[0]) & 0xffffffff
    return v

va = thunk(va)
lo, nm, d = sec(va)
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
md.detail = True
print(f"; {path}  0x{va:08x}  ({nm})")
n = 0
for insn in md.disasm(d[va - lo:va - lo + maxn * 8], va):
    ann = ""
    if insn.operands:
        op = insn.operands[-1]
        if op.type == capstone.x86.X86_OP_IMM:
            t = op.imm & 0xffffffff
            if insn.mnemonic == "call" and t in stub:
                ann = f"  ; {stub[t]}"
            else:
                s = cstr(t)
                if s:
                    ann = f'  ; "{s}"'
        elif op.type == capstone.x86.X86_OP_MEM and op.mem.base == 0 and op.mem.index == 0:
            t = op.mem.disp & 0xffffffff
            if t in names:
                ann = f"  ; {names[t]}"
            else:
                s = cstr(t)
                if s:
                    ann = f'  ; "{s}"'
    print(f"  0x{insn.address:08x}  {insn.mnemonic:7s} {insn.op_str}{ann}")
    n += 1
    if n >= maxn or insn.mnemonic == "ret":
        break
