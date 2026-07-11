# Runtime testing — live client connection

Log of the dynamic/runtime pass: driving the real Tibia 8.60 client against live
8.60 OT servers to reach an in-game state the v860 bot can read. Static RE of all
four binaries is complete ([00-status.md](00-status.md)); this doc records what was
actually observed on the RE-lab VM, the working pieces, and the wall that blocks a
full in-game test.

## Goal and target

`magebotv55.exe` (v860) is an external RPM bot whose client-address resolver bank
is anchored at `[0x45ff0c]` stride `0xA8` — offsets derived from the **Cipsoft
8.60 client** (`Tibia.exe`, 2 433 024 bytes). For the bot to have a populated
memory mirror (self, creatures, map), that exact client must be logged into a
game world. So the runtime target is: get *this* Cip 8.60 client in-game.

## Lab setup (VM re03)

- `C:\Tibia860\`: `Tibia.exe` (stock Cip 8.60), `Tibia.dat/.spr/.pic`,
  `magebotv55.exe` (v860, 614 500 B), `packet.dll`, and `Tibia_ot.exe` (the
  RSA-patched copy, below).
- GUI automation via the winctl agent in the **interactive** session (session 1):
  scheduled task `WinCtlS1` runs the agent, task `LaunchTibiaOT` launches the
  client. Both are ONCE-trigger, so re-run them after any VM reboot. Session-0
  instances of winctl cannot grab the console (`screen grab failed`).
- Shell: `engine/lib/re-ssh.sh re03 '<cmd>'` (CF tunnel). When the local resolver
  can't resolve `re03-ssh.kizubot.com`, connect directly to the VM public IP
  (`ssh kizudev@167.233.127.1`, operator key). PowerShell over SSH is run as
  `powershell -EncodedCommand <base64 UTF-16LE>` to avoid cmd.exe quote mangling.

## Client patch — point the Cip client at an OT server

The stock 8.60 client has no host/IP field in its login dialog; it targets
Cipsoft's login servers with Cipsoft's RSA. Two edits redirect it to an OT
server, applied to a copy (`Tibia_ot.exe`) so the original stays clean:

1. **RSA modulus** — replace both occurrences of the Cipsoft 1024-bit modulus
   (309-digit decimal string starting `124710459426827943…`, at file offsets
   `1801378` and `1804672`) with the standard OpenTibia modulus (starts
   `109120132967399429…`). Both are exactly 309 chars, so the edit is a
   byte-for-byte in-place replacement — file size unchanged (2 433 024 B).
2. **Login host** — the client holds five entries `login01…login05.tibia.com`
   (from offset `1804568`, 20-byte stride = 17-char host + NUL + 2 pad bytes; the
   pad bytes read as `0`, so the login **port** is not stored here — it is the
   code-hardcoded `7171`, which matches OT). Rather than patch the host strings,
   redirect them via `C:\Windows\System32\drivers\etc\hosts`
   (`login0{1..5}.tibia.com → <server IP>`) + `ipconfig /flushdns`. **The client
   resolves the login host once at launch**, so restart it after changing hosts.

This works: on every server tried, the client connected and the OT RSA handshake
succeeded (the login server accepted it).

## Servers tried (brazil.otservlist.org, protocol 8.6)

All had port 7171 open. Resolved IPs and results:

| Server | IP | Login-server result | Game-world result |
|---|---|---|---|
| `sv.baiak-ilusion.com.br` | 155.2.189.35 | **account 1/1 → `Account Manager (Baiak Ilusion)` char** | ❌ "Unable to login with this client / download new client at www.baiak-ilusion.com.br" |
| `sv.alphaot.com.br` | 80.94.90.7 | 1/1 invalid; **web-registered account works → MOTD + char list** | ❌ "Unable to login with this client / download the official client at www.alphaot.com.br" |
| `sv.kaldrox.com` | 124.198.145.214 | 1/1 invalid (stock client accepted to credential check) | (not reached — same class as alphaot) |
| `sv.demolidores.com.br` | 155.2.189.25 | reachable | (custom-client class, not pursued) |

## Two ways into an account (both verified)

- **In-game account manager (baiak-ilusion).** Account `1` / password `1`
  authenticated and the character list showed `Account Manager (Baiak Ilusion)`.
  Proves the login-server half of the patched client end-to-end.
- **Web registration (alphaot, MyAAC).** The create-account form
  (`POST ?account/create`, name `CreateAccountAndCharacter`) creates account +
  character in one step. Fields: `account`, `email`, `password`, `password2`,
  `name`, `generatedname` (hidden, empty), `sex` (radio 1/0), `vocation`
  (radio 1–4), `country` (select, `br`), `playsessionagreement`, `accept_rules`,
  and hidden `step=docreate` / `save=1`. Crucially the reCAPTCHA
  (`data-sitekey 6LeXGNoZ…`) sits **outside** the form (form opens at HTML index
  ~140005, submit button ~181672, `</form>` ~181753; captcha div ~255949), so a
  scripted `curl` POST carries no captcha token and still creates the account.
  Registered `magebotre01` / `Magebot2026` (Knight, char `Magebetre`); logging in
  produced the MOTD "Welcome to the AlphaOT!" then the character list.

## The wall: custom client at game-world login

The blocker is universal across the popular BR 8.60 servers. The **login server**
authenticates the stock client (MOTD and character list appear), but selecting a
character to enter the world returns *"Unable to login with this client — download
the official client."* Confirmed on baiak-ilusion **and** alphaot; kaldrox belongs
to the same class. These servers enforce a modified client at the game-protocol
handshake (custom version/signature beyond the plain `860` the Cip client sends).

Downloading their "official" client does not help: it is almost always
OTClientV8, whose memory layout is unrelated to the Cip 8.60 client — the v860
bot's `[0x45ff0c]`/`0xA8` offsets would not match it.

## Bot injection & licensing runtime pass

Independent of the in-game blocker, the bot itself was run against the live
client on the VM (winctl agent in session 1, frida 17.15.3 attached to
`magebotv55.exe` / `Tibia_ot.exe` from `C:\Python312\python.exe` driver scripts).
Three things were observed at runtime, each confirming a static-analysis doc.

### 1. Licensing — validates [14](14-login-crypto-licensing.md)

Launching `magebotv55.exe` (v860) triggers the tibiadb.com machine check and a
**"Magebot New Computer"** dialog: *"We do not have this computer on file with
your account … continue with the demo version or purchase a key … demo will
automatically close after some time."* Choosing **Continue with Demo Version**
brings up the full v860 GUI with `Magebot Status = Demo Version`. The demo build
**self-terminates after a short license timeout** if left idle (observed
repeatedly — the process exits on its own within tens of seconds), which is why
the injection window is narrow.

### 2. Injection thread runs at the documented address — validates [04](04-packet-dll.md) / [09](09-packet-build-inject-pipeline.md)

With the bot active in demo mode and the patched client (`Tibia_ot.exe`) running,
the **client** faults with an Application Error, reproduced on multiple launches:

```
Tibia_ot.exe — Application Error
The instruction at 0x0000000010004C0B referenced memory at 0x0000000010004C0B.
The memory could not be read.
```

`0x10004C0B` = `packet.dll` imagebase `0x10000000` + `0x4C0B` = **`pkt_pipeServerThread`**
(the named-pipe server thread, [04](04-packet-dll.md)). The fault EIP equals the
referenced address, i.e. control was transferred **to** packet.dll's pipe-server
entry. Post-crash the client's loaded-module list contains **no `packet.dll`** and
there is **no `\\.\pipe\SamplePipe`**. Reading: the bot creates a remote thread at
packet.dll's pipe-thread offset, but with the client sitting at the login screen
there is no in-game game socket for the XTEA-send shim, so the shim faults
immediately and the DLL never reaches a resident/registered state. This is direct
runtime proof that the injected thread executes at exactly the statically-derived
`0x10004C0B`.

### 3. Injector write-path is live — validates [08](08-address-resolution-and-mirror.md)

frida attached to `magebotv55.exe` captured its runtime API activity:

- The five `WinMain` worker threads start at `0x40122b` / `0x401221` / `0x40127b`
  / `0x4012fd` (matches the thread inventory in [07](07-master-loop-and-threads.md)).
- Steady state: a continuous stream of `WriteProcessMemory` calls into the client,
  **1 byte each, to near-null targets (`0x0`, `0x1`)** — the RPM/WPM mirror/control
  path resolving `base + offset` where the client base pointer is null because the
  client is pre-game (the resolver bank of [08](08-address-resolution-and-mirror.md)).
  ~298 such writes per few-second sample window.
- `packet.dll` is not mapped in the bot's own address space at attach time.

Not captured: the one-shot DLL-injection call sequence itself (`VirtualAllocEx` +
`WriteProcessMemory` of the packet.dll image + `CreateRemoteThread`). It fires in a
~1–2 s window at bot startup that a live `frida.attach` consistently missed, and the
demo build self-closes on its license timeout before a client-swap could force a
re-injection; a `frida.spawn` launches the bot in session 0 (no interactive
desktop) so its GUI/inject path never runs. The reproduced `0x10004C0B` fault is
the direct evidence that the thread executes at that address regardless.

## Completion path (open)

The only way to get the **Cip 8.60 client** fully in a game world is a server that
accepts it at game-login — i.e. a **local TFS 0.4 / OTHire 8.60** with default
config (no custom-client check, standard OT RSA that the patched client already
matches, port 7171, built-in account manager). Then: `hosts login01.tibia.com →
127.0.0.1`, launch `Tibia_ot.exe`, log in, enter game, inject `magebotv55.exe`.

Progress: the Fir3element/3777 TFS 0.4 8.60 datapack is downloaded and extracted
on the VM (`C:\ots\dp\3777-main`), but it is **source-only** (`config.lua.dist`,
`src/`, CMake, a Dockerfile — no compiled `theforgottenserver.exe`). The VM has no
Docker, and reliable pre-compiled 0.4 Windows binaries are behind OTLand forum
logins or unresolved Git-LFS blobs. Finishing therefore needs either a supplied
pre-compiled TFS 0.4 8.60 Windows binary (+ `sqlite3.dll`) or an MSVC/vcpkg build
from the downloaded source.

## Summary

The patched-client transport is proven end-to-end up to the game handshake:
connect, RSA-decrypt, account authentication, account-manager and web-registered
logins, MOTD, and character list. The bot itself was run against the live client:
its tibiadb.com demo-licensing flow ([14](14-login-crypto-licensing.md)), its
injection thread executing at the documented `pkt_pipeServerThread` address
`0x10004C0B` ([04](04-packet-dll.md)/[09](09-packet-build-inject-pipeline.md)), and
its live RPM/WPM mirror write-path resolving null-base client addresses pre-game
([08](08-address-resolution-and-mirror.md)) were all observed at runtime. In-game
memory reading by the bot is blocked only by the servers' custom-client
enforcement, which a local 8.60 server removes.
