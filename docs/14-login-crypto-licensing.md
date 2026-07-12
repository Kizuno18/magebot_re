# Login, RSA/XTEA crypto & tibiadb.com licensing

MageBot v5.5 (v10x, `samples/v10x/magebotv55.exe`, imagebase `0x400000`) carries
three cryptographic subsystems that are separate from the RPM-polling engine
documented in [engine-core.md](functions/engine-core.md):

1. **A mass account-login worker** ("log noobs") that speaks the *real Tibia
   login protocol* — it opens its own TCP socket to the login server, builds an
   RSA-encrypted login frame, and sends it. This is not the pipe-injection path;
   it is a standalone Tibia client login, built from `lognoobs.txt` account
   records.
2. **A machine-id / licensing layer** — a NIC-MAC-derived fingerprint plus HTTP
   requests to `tibiadb.com` (`key.php` / `resendkey.php` / `addcomputer.php` /
   `authorize.php`, `v=55`, `m=%d`) that gate whether the bot runs. Confirmed in
   **both v860 builds** (main + SAFEMODE) — the `tibiadb.com` licensing strings are
   identical. (A separate `GET /s.php?c=1+1` to `jnews.ueuo.com` seen on the wire at
   runtime is the **Tibia client's** own telemetry, not magebot's — those strings
   live in `Tibia.exe`, see [18](18-runtime-packet-verification.md).)
3. **Client patches** the bot writes into `client.exe` memory (an anti-idle /
   ping-pong spoof and a patch-table applier) plus an **XTEA** frame sender that
   is distinct from the plaintext pipe injector `0x40320a`.

All three are reached from the `MB_WinMain` region (`0x437aa5`–`0x43ba93`): the
UUID machine-id is derived in `WinMain 0x437ca4`/`0x437cc5`, the license check
fatals to `MessageBox` + exit `0x43ba8c` on failure, and the login-worker spawner
is a WinMain-driven thread farm. Addresses are file-absolute; string refs cite
`recon/v10x_magebot.strings.txt` and `02-static-analysis.md`.

---

## Data / control flow

```
  WinMain 0x437aa5
    │
    ├─ deriveMachineIdFromUuid 0x4314ce ──────────────► [0x4db39e0] = machine id (m=%d)
    │     LoadLibrary RPCRT4 → UuidCreateSequential          │  (UUID node/MAC dword XOR 0x5331)
    │     UUID[16]: bytes[2..7] copied, node dword [ebp-0x24]│
    │                                                        ▼
    ├─ licenseAuthorizeCheck 0x4317bc ───► GET tibiadb.com /authorize.php?id=<[0x4db3c94]><[0x4db3d98]>
    │     WSAStartup(2.2) gethostbyname socket connect        │   &v=55&m=%d   (port 80)
    │     ioctlsocket(FIONBIO) send recv-loop(≤7.5s)          │
    │     strstr "locked"/"unlocked"/"ckv5" ──► [0x4db3cf8] expiry, [0x4db3c90], success [0x4db3d9c]=1
    │        fail ► MessageBox "…account…disabled"/"Internet Error" ► exit 0x43ba8c
    │
    ├─ applyClientPatchTable 0x41cc90 ◄─ guard ─ isClientPatched 0x41ce04
    │     reads client patch table [0x4db37c4..0x468eec] (0x30 stride)          (client byte@0x468f3c == '1','0' ?)
    │     MB_WriteMem sub_4011BD into client; VirtualProtectEx flips page ► [0x4db3918]=1 patched
    │
    ├─ patchClientAntiIdlePong 0x430886 ─► WriteProcessMemory NOP-fill @client [0x468efc]/[0x4db37c8]
    │
    └─ spawnNoobLoginThreads 0x42db20  (once, guard [0x4db3d64])
          WSAStartup(0x101); fopen "lognoobs.txt"; split ';' into account records @0x4d0744c (stride 0xbb8)
          CreateThread(start=0x401523, &acct[i])  ×N
                              │
                              ▼   (per worker thread)
                    tcpConnect 0x42b442 ──────────────► login server socket
                              │
                    buildRsaLoginPacket 0x43124a
                        header 0a 02 00 20 03 00 | 16-byte key | acct/pass/char fields
                        RSA-encrypt block: exp 0x10001, modulus from "rsa.txt"
                          sub_453D0B ─► bigIntMultiply256 0x4310c2 + bigIntSubtract256 0x430daf  (modexp bignum)
                        send() 0x87-byte frame (0x85 payload)

  sendPipeXteaFrame 0x403574  (encrypted socket path, distinct from pipe injector 0x40320a)
      XTEA 32 rounds, delta 0x61c88647, key = 4-dword schedule; 2-byte LE len header; send()
```

---

## Function walk

### `deriveMachineIdFromUuid` — `0x4314ce` (568 B)

Produces the licensing fingerprint `m=%d`. Confirmed body:

```
push "RPCRT4"        ; [0x46dda0]
call [0x5c5d544]     ; LoadLibraryA   → 0 ⇒ return 0
push "UuidCreateSequential"  ; [0x46dda8]
push hRpcrt4 ; call [0x5c5d540]        ; GetProcAddress
lea ecx,[ebp-0x18] ; call [ebp-8]      ; UuidCreateSequential(&uuid16)
; copy uuid bytes [2..7] → [ebp-0x26..]
mov eax,[ebp-0x24]   ; node/MAC dword (last 6 bytes of the sequential UUID = NIC MAC)
xor eax,0x5331
mov [0x4db39e0], eax ; derived machine id
```

- **Reads:** the 16-byte sequential UUID from `RPCRT4!UuidCreateSequential`
  (dynamically resolved via `LoadLibraryA`/`GetProcAddress`, ptrs cached at
  `[0x5c5d544]`/`[0x5c5d540]`). `UuidCreateSequential`'s trailing 6 bytes are the
  primary NIC MAC, so this is a MAC-based hardware id.
- **Writes:** the dword at UUID offset `+0x24` (relative to the local frame; the
  node dword) **XOR `0x5331`** → global `[0x4db39e0]`. That global is the machine
  id that the tibiadb.com request line (`GET %s%d&v=55&m=%d`) formats into `m=%d`.
- **Calls:** none beyond the two dynamic imports. Returns 0 on RPCRT4 load
  failure, else the derived id path.
- **Emits:** no packet — feeds the HTTP licensing layer. WinMain resolves this at
  `0x437cc5` (per `engine-core.md §4`).

### `licenseAuthorizeCheck` — `0x4317bc` (1322 B)

The tibiadb.com license/authorization gate over raw WinSock. Confirmed:

```
; build "tibiadb.com" from rodata fragments [0x46de48]+ into [ebp-0x42c]
; build "/authorize.php?id=" from [0x46de54]+ into [ebp-0x3ec]
WSAStartup(0x0101 → wVersion 2.2 requested)   ; [ebp-0x448]=0x101
gethostbyname([ebp-0x42c])   ; NULL ⇒ "lphostentry error", return 9
socket(AF_INET=2, SOCK_STREAM=1, IPPROTO_TCP=6)  ; -1 ⇒ "socket()", return 0
sockaddr_in: family 2, addr = h_addr_list[0][0], port = htons([ebp-0x444]=0x50)  ; :80
connect(...)  ; -1 ⇒ "could not connect socket to server", closesocket, return 9
ioctlsocket(FIONBIO 0x8004667e, 1)             ; non-blocking
sprintf into 0x22b buffer: "/authorize.php?id=" + [0x4db3c94] + [0x4db3d98]      ; + v=55 & m=%d
send(...); recv-loop: Sleep(10ms), ~0x1d4c (≈7500ms) timeout
strstr for "locked" / "unlocked" / "ckv5"; atoi expiry
  unlocked ⇒ [0x4db3cf8]=expiry, [0x4db3c90]=flags, success [0x4db3d9c]=1
  oversized reply ⇒ fatal [0x4db3d90]
adjust license byte-checksum base [0x468f24] by a 0x43c-sum
return 0/7/9/0xa/0xb
```

- **Reads:** id fields `[0x4db3c94]` and `[0x4db3d98]` (formatted into the query),
  host fragments at `[0x46de48]+`, and the machine id `[0x4db39e0]` indirectly via
  the request line. Sums the first 11 bytes of the host string into `[ebp-0x440]`
  (an obfuscation/checksum of the hostname).
- **Writes:** parsed expiry/flags to `[0x4db3cf8]`/`[0x4db3c90]`, success flag
  `[0x4db3d9c]=1`, fatal flag `[0x4db3d90]`, and the license checksum base
  `[0x468f24]`.
- **Emits:** an HTTP `GET` to `tibiadb.com:80` — the confirmed request line for
  the family is `GET %s%d&v=55&m=%d HTTP/1.1` / `Host: tibiadb.com`
  (`02-static-analysis.md:77`). The corpus for this function only shows the
  `/authorize.php?id=` variant literally; the `key.php` / `resendkey.php` /
  `addcomputer.php?computer=%d&id=%s&m=%d` endpoints are present as strings
  (`02:75-77`) and are the sibling requests in this same licensing layer
  **(their exact call sites are not in this function's asm — the key/addcomputer
  request builder is a separate function, unconfirmed which).**
- The `ckv5` token and the `v=55` product-version tag are what tie this to
  MageBot **v5.5**.

### `httpGetCharacterPage` — `0x431ce6` (650 B)

Generic HTTP GET fetcher, same WinSock skeleton as the license check but for
`tibia.com/community` character pages (used by the enemy-guild scraper, not the
licensing path — included because it shares the crypto-free HTTP plumbing).

```
strip leading "http:" and "//" from arg[+0xc] via strstr sub_44AF30
gethostbyname(arg[+8]); socket; port htons(0x50); connect; ioctlsocket(FIONBIO)
sprintf: "/community/?subtopic=characters&name=" + host + path
send(...); recv-loop Sleep(0x46ms), up to 0x1000 bytes → caller buf arg[+0x10]
```

- **Reads:** host `arg[+8]`, path `arg[+0xc]`. **Writes:** response into caller
  buffer `arg[+0x10]`, advancing a running length. **Emits:** plaintext HTTP GET
  to port 80. No crypto.

### `urlEncodeSpacesToPlus` — `0x431f70` (3526 B)

In-place minimal URL encoder feeding the GET helpers. Walks the NUL-terminated
string at `arg[+8]`, replacing every `0x20` (space) with `0x2b` (`+`), returns the
original pointer. No other percent-encoding. Prepares character-name query values
(names with spaces) before `httpGetCharacterPage`. (The large size is decoder
padding; the logic is the single space→plus pass.)

### `tcpConnect` — `0x42b442` (120 B)

Blocking TCP client connect, the generic dialer for both the tibiadb.com/tibia.com
HTTP paths and the login workers.

```
socket(AF_INET=2, SOCK_STREAM=1, 0)   ; -1 ⇒ WSAGetLastError, return -1
sockaddr_in: family 2, addr=arg[+8], port=arg[+0xc] (raw — caller supplies net order)
connect(fd, &sa, 0x10)                ; -1 ⇒ WSAGetLastError, return -1
return fd
```

- **Reads:** IP `arg[+8]`, port `arg[+0xc]` (already network-order). **Emits:**
  nothing itself — returns a connected socket fd the caller writes on.

### `spawnNoobLoginThreads` — `0x42db20` (568 B)

Mass account-login spawner ("log noobs"). Runs once (guard `[0x4db3d64]`).

```
WSAStartup(0x0101)   ; fail ⇒ "WSAStartup() returned error code %i", return 0xff
fopen "lognoobs.txt" (sub_44A9A0); fgets lines (sub_44B39C) into 0x578 buffer
per line: strchr ';' (sub_44B2E0) split into 0x3c-byte fields of account record
          array @0x4d0744c (record stride 0xbb8); strcpy sub_44A590; store idx→0xdce148
          CreateThread(start=0x401523, param=&0xdce148[i]); Sleep(0x32) between
print "Logging on noobs, threads %i", count [0x4db3dcc]; return 0
```

- **Reads:** `lognoobs.txt` (semicolon-delimited `account;password;character;…`
  records) into the account-record array based at `0x4d0744c` (stride `0xbb8` —
  the same stride the login builder indexes at `0x4d07488`/`0x4d074c4`/`0x4d07500`).
- **Emits:** no packet directly — spawns one worker thread per account
  (start `0x401523`). Each worker dials via `tcpConnect` and then calls
  `buildRsaLoginPacket`. **(The worker body `0x401523` is a thunk target not in
  the bot-region corpus; the connect→build→send chain is inferred from the shared
  account-record base and stride — unconfirmed at the worker's own asm.)**

### `buildRsaLoginPacket` — `0x43124a` (644 B)

Assembles and sends the RSA-encrypted Tibia login frame for a worker.
`buildRsaLoginPacket(int socket /*[ebp+8]*/, void *key16 /*[ebp+0xc]*/, int acctIdx /*[ebp+0x10]*/)`.
Confirmed:

```
; fixed 6-byte header at [ebp-0xa8]:
0a 02 00 20 03 00
memcpy(&[ebp-0xa2], key16, 0x10)            ; 16-byte session key/nonce (XTEA key for the client stream)
; per-account fields, record base + acctIdx*0xbb8:
atoi([0x4d07488 + idx*0xbb8])               ; sub_44AE5F  → numeric field (account number)
fread-int([0x4d074c4 + idx*0xbb8])          ; sub_44A680  → len-prefixed account name
strcpy([0x4d074c4 + idx*0xbb8])             ; sub_44A590  → account name bytes
fread-int + strcpy([0x4d07500 + idx*0xbb8]) ;               → password (len-prefixed)
; RSA:
sub_401370([0x468f3c])  → modulus text into [ebp-0x2bc] (0x2bc buffer)
fopen "rsa.txt" (sub_44A9A0) → [ebp-0x10]
[ebp-0xac] = 0x10001                         ; public exponent e = 65537
call 0x453D0B(&out=[ebp-0xa3], &in=[ebp-0xa3], &e, modulus=[ebp-0x2bc], FILE=[ebp-0x10])  ; RSA encrypt
fclose (sub_44A820)
; framing:
[ebp-0x354] = 0x85 00                        ; 0x85 = payload length word
memcpy(&[ebp-0x352], &[ebp-0xa8], 0x85)      ; header+key+encrypted block
send(socket, &[ebp-0x354], 0x87, 0)          ; 0x87 = 0x85 payload + 2-byte length prefix
return 1
```

- **RSA public-key handling:** the modulus is loaded as **text from `rsa.txt`**
  (path string at `[0x46dd70]`) and also pointed at via a client-address global
  `[0x468f3c]` through `sub_401370`; the exponent is the hardcoded immediate
  `0x10001` (65537). This is the stock OTServ/Tibia login RSA public key format
  (1024-bit modulus, e=65537). `sub_453D0B` is the modexp driver; it consumes the
  modulus + exponent and runs `bigIntMultiply256` / `bigIntSubtract256` as the
  bignum core (below).
- **Reads:** the caller's 16-byte key (`[ebp+0xc]`), account/password/char fields
  from the record array, modulus from `rsa.txt` / `[0x468f3c]`.
- **Emits:** a `0x87`-byte frame on the worker's socket — `<len:2 LE=0x0085>` +
  header `0a 02 00 20 03 00` + 16-byte key + RSA-encrypted account block. This is
  the real Tibia **client→login-server** RSA login packet (the `0a 02` opcode +
  `0x20 0x03` protocol/version words), **not** a pipe/injector frame.

### `bigIntMultiply256` — `0x4310c2` (392 B) and `bigIntSubtract256` — `0x430daf` (787 B)

The RSA modexp bignum primitives (little-endian, byte-wise multi-precision), both
operating on a `0x200`-byte scratch and using `memset` `sub_44A750` / `memcpy`
`sub_44A9C0`.

`bigIntMultiply256(A, B, lenA, lenB, out)`:
```
memset(0x200 acc, 0)
for i in 0..lenA:  for j in 0..lenB:
    acc += A[i]*B[j] shifted into place; carry = acc>>8; acc[digit] &= 0xff
add final carry; memcpy(out, acc, lenA+lenB); return 1
```
Schoolbook O(n·m) multiply. Args `[ebp+8]=A` (advanced per outer iteration),
`[ebp+0xc]=B`, `[ebp+0x10]=lenA`, `[ebp+0x14]=lenB`, `[ebp+0x18]=out`.

`bigIntSubtract256(min, sub, len, out)`:
```
memset(0x200 result, 0); borrow=0
for each byte: if underflow → result = 0x100 - sub - borrow + min, set borrow
final borrow (negative) ⇒ return 0 (min < sub)
else memcpy(out, result, len); return 1
```
Args `[ebp+8]=minuend`, `[ebp+0xc]=subtrahend`, `[ebp+0x10]=len`, `[ebp+0x18]=out`.
The subtract's return-0-on-underflow is exactly the compare-and-conditional-subtract
step of a modular-reduction loop; together the two implement the multiply +
reduce inside `sub_453D0B`'s modular exponentiation (square-and-multiply mod N).

- **Reads/writes:** only their operand/scratch buffers — no globals, no packets.
  Pure arithmetic beneath `buildRsaLoginPacket`.

### `applyClientPatchTable` — `0x41cc90` (372 B)

Installs the in-client memory patches (self-modifies the Tibia process so the
injected frames are accepted / the client stream can be tapped). Confirmed shape:

```
save+clear enable gate [0x469098]
MB_ReadClientState(start=[0x4db37c4], end=[0x468eec]); count = (end-start)/0x30
for each 0x30-stride entry:
    len = +0x18; bytes = inline@record (len<0x10) else *(+4)
    sub_401370(bytes) → scratch 0xdd9a50 (sub_4013BB copy)
    MB_WriteMem sub_4011BD → client @ +0x14         ; first block
    second block @ +0x28 using scratch 0xdd9a1c
VirtualProtectEx([0x5c5d570], handle [0x4d22464], addr 0x468f3c)  ; flip page prot around final patch
[0x4db3918] = 1   ; patched flag
restore [0x469098]; return 1
```

- **Reads:** the client-resident patch table between client addresses `[0x4db37c4]`
  (start) and `[0x468eec]` (end), `0x30` bytes per entry (len `+0x18`, target addr
  `+0x14`, inline/ptr bytes, secondary block `+0x28`).
- **Writes:** patch bytes into `client.exe` via `MB_WriteMem` (`sub_4011BD`,
  WriteProcessMemory helper), and toggles page protection with `VirtualProtectEx`
  (ptr `[0x5c5d570]`) on the client handle `[0x4d22464]` around client address
  `0x468f3c`. Sets patched flag `[0x4db3918]=1`.
- **Emits:** no network frame — this is a memory patch. The patched region at
  `0x468f3c` is the signature `isClientPatched` later reads back (`'1' '0'`).

### `isClientPatched` — `0x41ce04` (69 B)

The guard before re-patching. Confirmed:

```
if [0x4db3918] == 1: return 1                 ; already-patched flag short-circuits
b0 = MB_ReadClientState(0x468f3c, 1)
b1 = MB_ReadClientState(0x468f3c+1, 1)
return (b0 == 0x31 && b1 == 0x30) ? 1 : 0     ; signature "10"
```

- **Reads:** the flag `[0x4db3918]`, and two client bytes at `0x468f3c`/`+1` via
  `MB_ReadClientState`. **Emits:** nothing. Returns whether the `"10"` signature
  the patch table writes is present, i.e. whether `applyClientPatchTable` already
  ran.

### `patchClientAntiIdlePong` — `0x430886` (892 B)

Patches a client instruction/field to spoof a ping/pong (anti-idle) response.

```
d = MB_ReadClientState([0x468efc], 4)   ; checked vs sentinel 0x1d5850f
w = MB_ReadClientState([0x4db37c8], 2)  ; checked vs 0x3475
if arg[+8]==1:
    WriteProcessMemory (sub_401285) 0x90-fill (NOP) 2-byte patches
      @ [0x468efc], +2, +4  and  @ [0x4db37c8]    ; disable the client's idle/ping check
else (arg==0):
    restore original bytes from local tables 0x466020 / 0x466024 / 0x466028
return 1
```

- **Reads:** client dword `[0x468efc]` (sentinel `0x1d5850f`) and word
  `[0x4db37c8]` (`0x3475`) to locate the patch site. **Writes:** `0x90` NOP fill
  into the client (enable) or the saved originals (disable) via
  `sub_401285` (WPM helper). **Emits:** no packet — it NOPs the client-side
  idle/ping-pong check so the automated session is not disconnected for idling.

### `sendPipeXteaFrame` — `0x403574` (618 B)

XTEA-encrypts a frame and `send()`s it over a socket — the **encrypted** socket
path, distinct from the plaintext pipe injector `0x40320a`. Confirmed body:

```
if [0x4b27b9c] == 0x63: Sleep(1); abort   ; busy re-entrancy guard
[0x4b27b9c] = 0x63                          ; take the lock
log "Sending pipeSP:"; per byte log " %X "
; XTEA encrypt, 8-byte blocks over payload [ebp+8], length [ebp+0xc]:
for block:
   v0=blk[0]; v1=blk[1]; delta=0x61c88647; sum=0
   for 32 rounds:
      v0 += (((v1<<4) ^ (v1>>5)) + v1) ^ (sum + key[sum & 3])
      sum -= delta                          ; delta 0x61c88647 (= -0x9e3779b9)
      v1 += (((v0<<4) ^ (v0>>5)) + v0) ^ (sum + key[(sum>>11) & 3])
   blk[0]=v0; blk[1]=v1
; 2-byte LE length header (sub_44A9C0), then:
send(buf, len+2, socket=[ebp+0x14])
[0x4b27b9c] = 0; return 1
```

- **Crypto:** textbook XTEA, 32 iterations, `key = [ebp+0x10]` (a 4-dword key
  schedule), delta constant `0x61c88647` used as the `sum -= delta` step (the
  two's-complement of the canonical `0x9e3779b9`). This matches the standard Tibia
  10.x client XTEA stream cipher; the 16-byte key handed to `buildRsaLoginPacket`
  and RSA-wrapped in the login frame is the same class of key the server later
  uses to XTEA the game stream, so this sender emits *game-stream-encrypted*
  frames.
- **Reads:** payload `[ebp+8]` (len `[ebp+0xc]`), key `[ebp+0x10]`, socket
  `[ebp+0x14]`; guard `[0x4b27b9c]`.
- **Emits:** `<len:2 LE>` + XTEA-ciphertext via `send()` on the caller's socket.
  Companion decrypt path is `recordAndReplayActionPacket 0x4037ed`, which
  XTEA-**decrypts** captured client packets with the same delta and the key at
  `[0x468f08]` (sum seed `0xc6ef3720` = 32·delta), confirming the encrypt/decrypt
  pair.

---

## RSA public-key & key material summary

- **Modulus:** loaded as text from `rsa.txt` (path `[0x46dd70]`) and referenced via
  client global `[0x468f3c]`. Not embedded as an immediate — it lives in the file,
  the standard Tibia/OTServ 1024-bit login modulus **(exact digits unconfirmed —
  file-dependent, not in `.text`)**.
- **Exponent:** hardcoded `0x10001` (65537) in `buildRsaLoginPacket`.
- **Modexp:** `sub_453D0B` over `bigIntMultiply256` (`0x4310c2`) +
  `bigIntSubtract256` (`0x430daf`), little-endian byte bignums, `0x200`-byte
  scratch — square-and-multiply mod N.
- **Session key:** a 16-byte key/nonce (`buildRsaLoginPacket` arg `[ebp+0xc]`)
  placed after the `0a 02 00 20 03 00` header, RSA-wrapped, then used as the XTEA
  key schedule for the game stream (`sendPipeXteaFrame 0x403574`,
  `recordAndReplayActionPacket 0x4037ed`).

## Licensing summary (tibiadb.com)

- **Machine id `m=%d`:** `deriveMachineIdFromUuid 0x4314ce` — NIC-MAC node dword
  from `UuidCreateSequential`, XOR `0x5331`, stored `[0x4db39e0]`.
- **Endpoints:** `key.php`, `resendkey.php`,
  `addcomputer.php?computer=%d&id=%s&m=%d`, `authorize.php?id=` (`02:75-77`).
  Request line `GET %s%d&v=55&m=%d HTTP/1.1`, `Host: tibiadb.com`. `v=55` = product
  version (MageBot v5.5), `m=%d` = the machine id.
- **Confirmed call site:** `licenseAuthorizeCheck 0x4317bc` builds and sends the
  `/authorize.php?id=` request (id from `[0x4db3c94]`/`[0x4db3d98]`), scans for
  `locked`/`unlocked`/`ckv5`, and gates the bot (fatal `[0x4db3d90]`, success
  `[0x4db3d9c]`). The `key.php`/`addcomputer.php` builders are a sibling function
  in the same layer **(their asm not identified in this pass — unconfirmed)**.
- **Failure UX:** `WinMain` `MessageBox`es "The account that authorized this
  computer has been disabled" / "Internet Error" and jumps to exit `0x43ba8c`
  (`engine-core.md §6.4`); string bank also carries "Could not connect to
  tibiadb.com…", "Fully Registered %s", "YOU SHOULD BUY A MAGEBOT KEY OMG :(".

## Open questions

- The `key.php` / `resendkey.php` / `addcomputer.php` request builder — the
  `authorize.php` path is confirmed at `0x4317bc`, but the function that emits the
  `GET %s%d&v=55&m=%d` line to `key.php`/`addcomputer.php` is not yet pinned to an
  address.
- `sub_453D0B` (RSA modexp driver) and the login-worker start `0x401523` are
  outside the bot-region corpus; the modexp uses the two confirmed bignum
  primitives but its own control flow (square-and-multiply loop, PKCS padding) is
  not disassembled here.
- Exact `rsa.txt` modulus digits (file-resident, not in `.text`).
- Whether the 16-byte login key is randomly generated per session or read from a
  fixed source before `buildRsaLoginPacket` is called (caller `0x401523` not
  traced).
