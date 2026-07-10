# server.exe — MageBot Team Server (COMBO hub) + tibiadb.com hosted variant

MageBot's multi-box "COMBO" feature runs over a small standalone TCP hub,
`server.exe`, shipped as `samples/shared/server.exe`. Bots connect to it,
authenticate with a password, and the hub relays every client's message to
every other client. There are two ways to reach a hub: self-host this binary,
or connect to the **hosted** hub at `tibiadb.com` (documented at the bottom).

- Arch: x86, console subsystem, imagebase `0x400000`, entry `0x40c77f` (MSVC CRT
  → `main` at `0x401000`). Timestamp 2011-05-12.
- `WSOCK32.dll` (19 imports), `KERNEL32.dll`. No exports, 447 recovered funcs.
- Heavy MSVC iostream/locale CRT (pt-BR / Latin-America locale table in
  `.rdata`); the network core is a handful of small hand-written functions.
- Concurrency model: **single-threaded `select()` multiplexer**, not one thread
  per client. One background watchdog thread. No CRITICAL_SECTION anywhere.

## Startup — `main` at `0x401000`

`main` prompts for two passwords on the console and stores them into two fixed
`.data` slots, then starts Winsock and hands control to the server driver.

| Step | Address | What |
|---|---|---|
| host default | `0x401013` | seeds host string `0x41c688` with `"127.0.0.1"` |
| server pass | `0x40102a` | prints `"Enter Server Password:"`, reads line into `0x41a0d0` slot via `0x401b00` |
| leader pass | `0x401049` | prints `"Enter Server Leader Password(COMBO LEADER MUST USE THIS IN MAGEBOT):"`, reads into `0x41a104` slot |
| Winsock | `0x40106f` | `WSAStartup(0x101)`; on error prints `"WSAStartup() returned error code "` and returns 0xff |
| run | `0x4050da` | `call runServer(host=0x41c688, port=0x1d97, serverPass, leaderPass)` |
| shutdown | `0x4010e8` | `WSACleanup` |

Port is the immediate `0x1d97` = **7575/tcp** (`[ebp-0x19c]=0x1d97` at `0x401009`,
passed as arg2). Two passwords: the **server password** admits a regular member,
the **leader password** admits a COMBO leader — the "COMBO LEADER MUST USE THIS
IN MAGEBOT" prompt is literal (the leader box in the bot must send this one).

## runServer — `0x405141`

1. `0x40514e` spawn watchdog thread `0x4050e6` (see below), record start tick in
   `[0x421184]`.
2. `mode` arg (`[ebp+0x10]`) selects **relay mode** vs **"list" utility mode**
   (compared against `"list"` at `0x4052ca`). Relay mode is the normal COMBO hub.
3. In list mode only: optionally preload `enemies.txt` (prompt `"Send Enemy List
   Y/N ?"`, `Y`=0x59) and read `passlist.txt` into a 0x32-stride table at
   `0x41c70c` — this is a **generated password list**, one leader password per
   line, up to `[0x421188]` entries. In relay mode the single leader pass copied
   from `main` is entry 0.
4. `0x40545a` create the listener; `"Team Server is running..."`.
5. `0x406097` accept/select loop; on return `"Acceptor restarting..."` and retry
   unless the watchdog set the shutdown flag `[0x421180]`.

### Watchdog `0x4050e6`

700 ms (`0x2bc`) sleep loop. Only armed in list mode (`[0x421178]==1`): 27 s
(`0x6978`) after start it `DeleteFileA`s the passlist file (`0x41c6d8`) and
`ExitProcess(0)`. A self-destruct for the ephemeral list-generator run; inert in
normal relay operation.

## Listener — `0x40545a`

Textbook blocking TCP setup, WSOCK32 ordinals resolved by the disassembler:

```
inet_addr(host)                     ; 0x407ffa
socket(AF_INET=2, SOCK_STREAM=1, 0) ; 0x407ff4
sockaddr_in{ family=2, port=htons(arg), addr=inet_addr(host) }
bind(fd, &sa, 0x10)                 ; 0x407fee   -> "bind() failed" on -1
listen(fd, 5)                       ; 0x407fe8
return fd
```

Backlog is 5. Bind address is whatever `main` seeded — `127.0.0.1` by default,
so a stock self-hosted hub is loopback-only unless the host string is changed.

## Accept/select loop — `0x406097`

One flat function, no per-client threads. It keeps a client registry object at
`0x421160` (a small vector: `+4`=array ptr, `+8`=count, iterator begin at
`0x401760`, count at `0x406ca0`). Each iteration:

1. Build three `fd_set`s (read/write/except) over the listen socket + every
   client socket.
2. `select()` (`0x408030`), infinite timeout (NULL).
3. If the listen socket is read-ready: `accept()` (`0x408024`), log `"Accepted
   connection from <ip>, socket <fd> ..."` (`inet_ntoa`/`ntohs`), construct a
   per-client object on a **0x5404-byte** buffer via `0x406850`, push it into the
   registry (`0x406ce0`), set the socket non-blocking (`ioctlsocket
   FIONBIO=0x8004667e`). If registry count+1 > 0x40 (**64**), print `"WARNING:
   More than 63 client connections accepted. This will not work reliably on some
   Winsock stacks!"` — the hard cap is 63 concurrent bots, a `select()`/
   `FD_SETSIZE` limit, matching the Team Server's advertised member ceiling.
4. Except-ready client → `getsockopt(SO_ERROR)` → `"General socket error"`,
   evict from the fd list.
5. Read-ready client → `recvClient` (`0x40563c`); falsey return evicts and
   removes it (`"Read error"`).
6. Write-ready client → `flushClient` (`0x405fb5`), drains its outbound queue.

## Per-client object (stride 0x5084)

Registry records are 0x5084 (20612) bytes, iterated by that stride. Field
offsets recovered from `recvClient`/`flushClient`:

| Offset | Field | Meaning |
|---|---|---|
| +0 | dword | client socket fd |
| +4 | byte[0x272c] | inbound scratch — `recv` lands here (see framing) |
| +0x272c | byte[…] | **outbound queue** buffer |
| +0x4e58 | dword | outbound queue length (cap `0x2728` = 10000) |
| +0x4e5c | dword | authenticated flag (0 until password accepted) |
| +0x4e60 | dword | leader flag (1 = COMBO leader) |
| +0x4e64 | char[] | client name / label (used in log lines) |
| +0x4e78 | dword | "single shot" id (from the `/`-`0x19` command) |
| +0x4e7c | dword | spam byte counter (window-scoped) |
| +0x4e80 | dword | spam window start tick |
| +0x4f84 | char[] | secondary label |

## recvClient — `0x40563c` (handshake + framing + relay)

`recv(fd, buf+4, 0x3bc=956, 0)` into the client's inbound scratch (`0x4056b8`).
`recv`==0 → `"Socket <fd> was closed by the client. Shutting down."`, evict.
`recv`==-1 → `getsockopt(SO_ERROR)`; error `0x2733` (WSAEWOULDBLOCK) is tolerated
(returns true, stays connected), anything else evicts.

### Handshake (while `+0x4e5c == 0`)

The **first payload is the password** (raw string, not framed). It is compared,
via `strcmp` (`0x40c2e0`) / substring (`0x40bdd0`):

| Match | Result |
|---|---|
| any `passlist` entry `0x41c70c[i]` | authed, **member** (`+0x4e60=0`), log `"Connected to Team Server"` |
| the server-leader pass `0x41c6d8` | authed, **LEADER** (`+0x4e60=1`), log `"LEADER" / "Connected to Team Server"` |
| neither | `"Password failed."`, `recvClient` returns false → evicted |

On success it records the join tick into `+0x4e58` (queue base) and copies the
matched credential string into `+0x4f84`.

### Spam guard

Bytes received are accumulated into `+0x4e7c` over the window opened at `+0x4e80`
(reset every `0x2328` = 9000 ms, tick source `0x40c12f`). Exceeding `0x7d0`
(2000) bytes inside the window → `"disconnected for spam"`, evict. The loop-level
`recvClient` byte accounting also feeds a global `[0x42118c]` printed as
`"TBytes:"` roughly once per 9 s.

### Message framing (post-auth)

Messages are **ASCII 2-character command codes** carried at scratch offsets `+4`
(char0) and `+5` (char1), with a binary length/argument pair at `+6`/`+7`. The
dispatcher is a ladder of `byte[+4]/byte[+5]` compares. Recovered commands:

| char0 (+4) | char1 (+5) | Meaning | Gate |
|---|---|---|---|
| `'1'` 0x31 | `'4'` 0x34 | relay length clamp to 0x30 | — |
| `'1'` 0x31 | `'M'` 0x4d | **enemy-list request** — `"Enemy list request recieved"` → `"Sending new list length"`, appends the stored enemy list to this client's outbound queue | requires list feature `[0x421170]>=1` |
| `'1'` 0x31 | `'O'` 0x4f | **chat** — `"Chat recieved"`; body length = `+6 | (+7<<8)`; short read → `"Bad Chat length"` | — |
| any | `0x1d` / `0x33` | leader-only op | `+0x4e60==1` else `"bad leader attempt"`, evict |
| any | `0x1a` | **combo command** — `"combo command recved"` | leader-only, else `"bad leader attempt"`, evict |
| any | `0x3d` | copies 4 bytes `+6..+9` into `+0x4e78` (sets this client's single-shot id) | — |
| any | `0x1b` | **potion command** — `"potion command recved "` | — |
| `'/'` 0x2f | `0x19` | **Mwall single shot** — `"single shot found"`, does an extra `recv(fd, +0xc, 8)` for the shot payload, parses a 4-byte id at `+0xe` into `+0x4e78` | — |

Command bytes `0x1a` (combo) and `0x33`/`0x1d` are leader-gated; a member that
sends one is dropped with `"bad leader attempt"`. This is the multi-box control
surface: the leader's bot broadcasts combo/attack/mwall commands, members obey.

### Relay

After parsing, the message body (`scratch+4`, capped `0x2728`) is appended into
the outbound queue (`+0x272c`, len `+0x4e58`) of **every other** client in the
registry — iterated by stride 0x5084, skipping the sender (`0x405ea4` loop). The
single-shot path additionally filters recipients by matching single-shot id
(`+0x4e78`). The server keeps no game state of its own; it is a pure fan-out
relay plus the static enemy list.

## flushClient — `0x405fb5` (write path)

`send(fd, +0x272c, queueLen=+0x4e58, 0)`. `-1` → `getsockopt(SO_ERROR)`, tolerate
`0x2733` (WSAEWOULDBLOCK). Full send → zero the queue length. Partial send →
`"error only part sent to "`, `memmove` the unsent tail to the front and keep the
remainder for the next writable event. Standard non-blocking drain.

## Console / files

- All console I/O is a colored `cout` (`SetConsoleTextAttribute` band); unlike the
  ElfBot NavNet server there is **no** CriticalSection serialization — safe only
  because everything runs on the single select thread.
- `enemies.txt` (`r+b`) — optional preloaded enemy list, relayed on `1M`.
- `passlist.txt` (`r+t`) — leader/member password list, 0x32-stride table at
  `0x41c70c`. Deleted by the watchdog in list mode.
- `0x41c6d8` — leader password (also the file name buffer reused in list mode).

---

# tibiadb.com — hosted Team Server + licensing

Every `magebotv55.exe` (both v860 and v10x lineages, strings identical) can skip
self-hosting and connect to the vendor's hub. From the client strings:

> Welcome to the Tibiadb.com teamserver. If this is your first time, you can
> create a private server by connecting with a different password. **The limit
> is 10 players per private server**

So the hosted variant is the same relay protocol, keyed by password: an unknown
password *creates* a fresh private hub, and everyone using that password shares
it — capped at **10 players** (vs the 63 of a self-hosted `server.exe`). The
client-side UI strings confirm the feature set riding this channel: `"Auto Heal
Team Server Members"`, `"Bot will only heal knights/paladins (Team Server
only)"`, `"If you wish to be a combo leader in your team server, check the box"`,
`"Mwall Team Server Single Shot"` (the `/`-`0x19` command above). Connect/
disconnect banners: `"Connected to Team Server, hihi"` / `"Team Server
Disconnect, bye bye"`.

## Licensing / registration HTTP (tibiadb.com)

Separate from the relay, the bot phones home over plain HTTP on load for key
validation and machine registration. Endpoints and request templates:

| String | Purpose |
|---|---|
| `http://www.tibiadb.com/key.php` | validate license key |
| `http://www.tibiadb.com/resendkey.php` | re-issue key |
| `http://www.tibiadb.com/addcomputer.php?computer=%d&id=%s&m=%d` | bind a machine to an account (`computer` slot, `id` key, `m` machine-id) |
| `GET %s%d&v=55&m=%d HTTP/1.1` / `Host: tibiadb.com` | the actual request line — `v=55` is the MageBot version tag, `m=%d` the machine-id |
| `GET %s HTTP/1.1` / `Host: %s` | generic fetch template |

Failure surfaces as `"Could not connect to tibiadb.com. ... allow Magebot to
access the internet during loadup ..."` and `"Corrupt Packet Stream, ... your
firewall is blocking our program ..."`. The `m=%d` machine-id is the same value
threaded through `addcomputer.php`, i.e. registration and license checks are
bound to a per-machine id; `v=55` pins the protocol/version on every call.

## Relationship to the bot

`server.exe` is the optional self-hosted COMBO hub (63-client cap, loopback bind
by default, two-tier password). The bot half — the WSOCK32 `connect`/`send`/
`recv` client that speaks the 2-char command framing above and drives the combo/
potion/mwall/heal features — lives in `magebotv55.exe`. A party either points
that client at a self-hosted `server.exe` or at the hosted `tibiadb.com`
teamserver (10-player private hubs). See the injection/feature docs for where the
combo commands originate inside the bot.

## Per-client struct + command dispatch (confirmed, `srvRecvClient` 0x40563c)

Each connected client is a **`0x5084`-byte (20612) record** (the vector stride).
`recv` reads up to 956 bytes into `+4`; the first two bytes are the command frame.

| Offset | Field |
|---|---|
| `+0` | client socket handle |
| `+4` | recv buffer — `[+4]`=cmd byte, `[+5]`=sub-cmd, `[+6]`/`[+7]`=length lo/hi |
| `+10028` (`0x272C`) | outgoing relay buffer (broadcast to the other clients) |
| `+20056` (`0x4E58`) | relay write offset / length (cap `0x2728`) |
| `+20060` (`0x4E5C`) | **authenticated** flag (1 after password match) |
| `+20064` (`0x4E60`) | **combo-leader** flag (1 = leader) |
| `+20068` (`0x4E64`) | client name/id string (logs) |
| `+20088` (`0x4E78`) | dword stored by cmd `0x3D` |
| `+20092`/`+20096` | spam byte-counter + window clock (>2000 B / <3 s ⇒ "disconnected for spam") |
| `+20356` (`0x4F84`) | leader-gated command's originator name |

Handshake: an unauthenticated client's first packet is `strcmp`'d against the
password list (`byte_41C70C`, 50-byte stride) → sets auth flag + copies
"Connected to Team Server"; matching the leader password (`Str2`, "LEADER") also
sets the leader flag. Wrong password ⇒ "Password failed." + drop.

Command dispatch on `[+5]`(sub) / `[+4]`(cmd):

| `[+4][+5]` | Command | Notes |
|---|---|---|
| `'1' 'M'` (49,77) | **enemy-list request** | replies with `dword_421170`-byte list `unk_41EE20` when it changed (`byte_421174`) |
| `'1' 'O'` (49,79) | **chat** | body length `[+6] + ([+7]<<8) + 4`; "Bad Chat length" guard |
| `_ 0x1D` / `_ 0x33` | leader-gated op | rejected ("bad leader attempt") unless `[+20064]==1` |
| `_ 0x19` / `_ 0x1A` | **combo command** | leader-gated relay |
| `_ 0x3D` | store dword → `[+20088]` | |
| `_ 0x1B` | **potion command** | |
| `'/' 0x19` (47,25) | **single-shot** | `recv`s 8 more bytes, reads dword at `[+14]` |
| default | **relay** | appends the `v64`-byte payload into every *other* client's `+10028` buffer (the fan-out that makes one bot's action drive the box) |

So the server is a dumb authenticated relay: it validates the password + leader
flag, rate-limits spam, and fans each client's command out to the others'
`flushClient` buffers — the command *semantics* live in `magebotv55.exe`.
