#!/usr/bin/env python3
"""Recover the MageBot Lua binding table from magebotv55.exe (no IDA needed).

The bot registers each scripting API function with the classic Lua 5.1 pattern:

    lua_pushcclosure(L, cfunc, 0)
    lua_setfield(L, LUA_GLOBALSINDEX, "Name")

This walks .text, finds every `call [lua_setfield]`, and recovers the name
string pushed just before it and the C function pushed into the preceding
`call [lua_pushcclosure]`. Output: name -> cfunc VA, plus any constant slots
registered the same way. Prints a markdown table and a JSON sidecar.
"""
import pefile, capstone, json, sys, re

PATH = sys.argv[1] if len(sys.argv) > 1 else "samples/v10x/magebotv55.exe"
pe = pefile.PE(PATH)
IB = pe.OPTIONAL_HEADER.ImageBase

# IAT thunk address -> imported name (all DLLs, we care about lua51)
thunk = {}
for e in pe.DIRECTORY_ENTRY_IMPORT:
    for imp in e.imports:
        if imp.name:
            thunk[imp.address] = imp.name.decode()

want = {va: n for va, n in thunk.items() if n in ("lua_pushcclosure", "lua_setfield")}
SETFIELD = next((va for va, n in want.items() if n == "lua_setfield"), None)
PUSHCC   = next((va for va, n in want.items() if n == "lua_pushcclosure"), None)

# section helpers
secs = []
for s in pe.sections:
    secs.append((IB + s.VirtualAddress, IB + s.VirtualAddress + s.Misc_VirtualSize,
                 s.Name.rstrip(b"\x00").decode("latin1"), s.get_data(), IB + s.VirtualAddress))

def read_cstr(va, maxlen=128):
    for lo, hi, nm, data, base in secs:
        if lo <= va < hi:
            off = va - base
            end = data.find(b"\x00", off)
            if end < 0 or end - off > maxlen:
                return None
            try:
                return data[off:end].decode("latin1")
            except Exception:
                return None
    return None

def in_text(va):
    for lo, hi, nm, data, base in secs:
        if nm == ".text" and lo <= va < hi:
            return True
    return False

# disassemble .text linearly, track recent `push imm32` operands
text = next(s for s in secs if s[2] == ".text")
lo, hi, nm, data, base = text
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
md.detail = True

recent_push = []      # list of (imm) recently pushed
bindings = []         # (name, cfunc_va, addr_of_call)
last_cfunc = None     # cfunc captured at last pushcclosure

for insn in md.disasm(data, base):
    m = insn.mnemonic
    if m == "push" and insn.operands and insn.operands[0].type == capstone.x86.X86_OP_IMM:
        recent_push.append(insn.operands[0].imm & 0xffffffff)
        if len(recent_push) > 6:
            recent_push.pop(0)
    elif m == "call" and insn.operands:
        op = insn.operands[0]
        target = None
        if op.type == capstone.x86.X86_OP_MEM and op.mem.base == 0 and op.mem.index == 0:
            target = op.mem.disp & 0xffffffff
        if target == PUSHCC:
            # cfunc is the imm push that points into .text (the closure body)
            for imm in reversed(recent_push):
                if in_text(imm):
                    last_cfunc = imm
                    break
        elif target == SETFIELD:
            # name is the most recent push that resolves to a C string
            name = None
            for imm in reversed(recent_push):
                s = read_cstr(imm)
                if s and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", s):
                    name = s
                    break
            if name is not None:
                bindings.append((name, last_cfunc, insn.address))
            last_cfunc = None
        recent_push = []

# dedupe keep first
seen = set()
rows = []
for name, cf, at in bindings:
    if name in seen:
        continue
    seen.add(name)
    rows.append((name, cf, at))

rows.sort(key=lambda r: (r[1] is None, r[1] or 0))
print(f"# MageBot Lua binding table  ({PATH})")
print(f"# imagebase 0x{IB:x} — {len(rows)} registered globals\n")
print("| Lua name | C function VA | setfield site |")
print("|---|---|---|")
for name, cf, at in rows:
    cfs = f"0x{cf:08x}" if cf else "—(const/value)"
    print(f"| `{name}` | {cfs} | 0x{at:08x} |")

json.dump(
    [{"name": n, "cfunc": (f"0x{cf:08x}" if cf else None), "site": f"0x{at:08x}"} for n, cf, at in rows],
    open("recon/lua_bindings.json", "w"), indent=1)
sys.stderr.write(f"\n{len(rows)} bindings -> recon/lua_bindings.json\n")
