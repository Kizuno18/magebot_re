# Runtime packet verification

Live, on-the-wire verification that the documented send path actually behaves as
the static analysis claims. The Cip 8.60 client was logged into the local TFS 0.4
world (a real playable Knight, `Kizu Bot`), magebot was injected (v860
`packet.dll`), and every layer of the outgoing pipeline was captured and — for
the crypto layer — reproduced independently. Complements the static write-ups in
[04](04-packet-dll.md) (packet.dll), [09](09-packet-build-inject-pipeline.md)
(build/inject) and [14](14-login-crypto-licensing.md) (login/licensing).

## Harness

- **frida.spawn** of `Tibia_ot.exe` **with `cwd=C:\Tibia860`** (without the cwd the
  client dies with `Cannot find file 'C:\Windows\system32\Tibia.dat'` — frida
  inherits the launcher's working directory, not the exe's). Hooks installed from
  `t=0` so the login handshake is caught.
- Hooks: `ws2_32!send` / `WSOCK32!send` (the wire), `connect`/`WSAConnect` (server
  dests), and **`packet.dll+0x4436`** = the v860 XTEA/Adler/send function (the
  plaintext frame going in). The XTEA key is read at hook time from the pointer at
  `packet.dll+0xC138`.
- To exercise the bot builders on demand, crafted frames are written straight into
  the named pipe `\\.\pipe\SamplePipe<pid>` in the documented format
  `[outerlen:2][ [innerlen:2][message][zero-pad to a multiple of 8] ]`. This drives
  `pkt_pipeServerThread` → `sub_10004436` exactly as magebot's own `InjectFrame`
  does. A real character must be in a game world first — the send is gated on a
  live socket (`if (*(_DWORD *)dword_10054B3C)` in the pipe thread).

## v860 offsets (correction to the v10x-derived docs)

The offsets in [04](04-packet-dll.md) come from the **v10x (9.2)** `packet.dll`.
The **v860** build (`samples/v860/packet.dll`, the one that matches the 8.60
client) is a different compile with different addresses:

| Item | v10x (docs) | **v860 (runtime)** |
|---|---|---|
| XTEA/Adler/send fn | `0x10004726` | **`0x10004436`** |
| XTEA key pointer | `0x1000C128` | **`0x1000C138`** |
| socket-holder global | `dword_1000C13C` | **`dword_10054B3C`** |
| resolved `send` ptr | `0x101C4B10` | **`dword_10054A8C`** |
| client-base global | `dword_1000C12C` | **`dword_1000C148`** |

`0x1000C138` holds a **pointer** to the live 16-byte XTEA **session key** (set at
runtime once the game handshake completes), not the key inline.

## What fired on the wire

| Documented claim | Doc | Runtime evidence | Verdict |
|---|---|---|---|
| Client enters game world | 17 | `connect 127.0.0.1:7171` (login) then `:7172` (game); char `Kizu Bot` rendered in-world | ✅ |
| RSA login packet | 14 | first game send `95 00 A7 41 … ` = `[len 0x0095]` + 128-byte RSA block; auth succeeds (OT-modulus patch works) | ✅ |
| Client-side HTTP telemetry on the wire | — | `GET /s.php?c=1+1 Host: jnews.ueuo.com` to `107.150.63.76:80` seen on the client's socket | ⚠️ this is the **Tibia client's own** phone-home — the `jnews.ueuo.com`/`s.php` strings live in `Tibia.exe`/`Tibia_ot.exe`, **not** in any magebot/packet.dll binary. Magebot's licensing (tibiadb.com, doc 14) runs in the `magebotv55.exe` process, which the client-side `send` hook does not see |
| Injection clean (v860) | 04 | `Tibia_ot` alive, no `WerFault`, `\\.\pipe\SamplePipe<pid>` live, client window subclassed → `*Magebot*` | ✅ |
| Wire framing `[len][adler32][xtea]` | 04 | every game packet is `[len:2][adler:4][8·n xtea bytes]` | ✅ |
| Attack opcode `0xA1` | 10 | `sub_10004436` received `05 00 A1 34 12 00 00` (opcode `0xA1`, cid `0x1234`) | ✅ |
| Walk opcodes `0x65`–`0x6C` | 07 | `0x65`/`0x66`/`0x67`/`0x68` (N/E/S/W) and turn `0x6F` all received | ✅ |
| Look `0x8C`, talk `0x96` | 10/13 | `8C …` and `96 01 00 02 00 68 69` ("hi") received | ✅ |
| XTEA (standard, 32 rounds) + Adler-32 + `ws2_32!send` | 04 | see crypto proof below | ✅ cryptographically |

## Cryptographic proof (end-to-end)

For each injected frame the plaintext was captured entering `sub_10004436` and the
ciphertext leaving on `ws2_32!send`, with the session key
`B6 DA 15 FA 9F 02 CA DE 85 F2 D7 64 9C 32 EB AA`. Decrypting the wire block with a
**stock XTEA** implementation (delta `0x9E3779B9`, 32 rounds, key as 4 LE dwords)
recovers the exact message, and an independent **Adler-32** of the ciphertext
matches the 4 checksum bytes on the wire — for all frames:

| Frame | wire ciphertext (XTEA block) | XTEA-decrypt → message | Adler-32 wire = calc |
|---|---|---|---|
| walk N `0x65` | `06 E5 B9 3A B3 44 EB 5D` | `01 00 65` | `0x11BE041E` ✅ |
| walk E `0x66` | `B6 9A A4 8A C8 9B 87 CF` | `01 00 66` | `0x17460538` ✅ |
| attack `0xA1` | `DC 59 D6 43 F3 96 2D 6B` | `05 00 A1 34 12` | `0x15FD0470` ✅ |
| talk `0x96` | `EA 20 77 67 76 24 F8 4D D7 7F 5F 6B 4A 7E` | `07 00 96 01 00 02 00 68 69` | `0x45C6081B` ✅ |

The trailing bytes after each message are **random padding**, matching the LCG in
the decompile (`dword_1000D328 = 7177237·x + 4673943`, `dword_1000D32C =
7934931·x + 5783497`, summed) that fills `v10 % 9` bytes before encryption — so the
ciphertext is non-deterministic even for the same opcode, but decrypts to the same
message. The Adler-32 is computed **over the ciphertext** (post-XTEA), then framed
as `[a2+4 : 2][adler32 : 4][ciphertext]` and sent via
`dword_10054A8C(socket, buf, len, 0)`.

## Summary

The full outgoing pipeline is confirmed at runtime, opcode-for-opcode and
byte-for-byte: magebot builds a frame → writes it to `\\.\pipe\SamplePipe%i` →
`pkt_pipeServerThread` → `sub_10004436` pads (LCG) + **XTEA-encrypts** (stock,
key at `0x1000C138`) + **Adler-32** + **`ws2_32!send`** on the client's game
socket. Decrypting the captured wire traffic with the captured session key
reproduces the injected `0xA1`/walk/`0x96` opcodes exactly. The RSA login packet
fires as documented. The one doc correction is the **v860 packet.dll offsets**
(§ above). **Note:** the `jnews.ueuo.com`/`s.php` HTTP telemetry seen on the wire
is the **Tibia client's own** phone-home (those strings are in `Tibia.exe`, not in
magebot) — it is *not* magebot's licensing, which uses `tibiadb.com` from the
`magebotv55.exe` process (doc 14) and is not visible to a client-side `send` hook.
