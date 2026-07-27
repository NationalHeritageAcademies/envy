# Scope: Windows (and Linux) support for the Envy URL daemon

## Problem
Envy's core feature — trusted `https://<name>.envy.local` URLs — is delivered by a
privileged background daemon. The **daemon engine is portable Node** (DNS server,
reverse proxy on 80/443, CA + leaf cert generation). But the **OS integration is
macOS-only**, so "Enable URLs" only works on macOS today. Windows and Linux install,
list/start/stop containers, and run the purchase flow, but cannot serve URLs.

## What already works everywhere
- `src/daemon/main.ts` — runs the engine, watches `config.json`, reacts to Docker events.
- `src/engine/dns.ts` — DNS server (binds a high, unprivileged port on macOS).
- `src/engine/proxy.ts` — reverse proxy on 80/443, routes by Host header.
- `src/engine/tls.ts` — local CA + per-domain leaf certs.
- `src/engine/docker.ts` — `new Docker()` auto-detects the Windows named pipe / unix socket.
- Elevation: `@vscode/sudo-prompt` already works on macOS, Windows (UAC), and Linux (pkexec).

## The four macOS-only integration points (what must be ported)
| # | Concern | macOS today | Windows | Linux |
|---|---------|-------------|---------|-------|
| 1 | Run daemon at boot, keep alive, elevated install | launchd plist + `launchctl` + `sudo-prompt` runs `install-daemon.sh` | **Windows Service** via `sc.exe`/wrapper, UAC elevation, PowerShell install script | **systemd** unit, pkexec, bash install script |
| 2 | Resolve `*.envy.local` → local DNS | `/etc/resolver/<domain>` with a **custom port** (DNS stays on a high port) | **NRPT** rule (`Add-DnsClientNrptRule`) — but NRPT has **no port option**, so the DNS server must bind **53** | dnsmasq drop-in (`server=/envy.local/127.0.0.1#<port>`) or systemd-resolved routing; **port 53 conflicts with systemd-resolved** |
| 3 | Trust the local CA | `security add-trusted-cert -k System.keychain` | `certutil -addstore -f Root` (Edge/Chrome). **Firefox uses its own NSS store** → separate | `update-ca-certificates`/`update-ca-trust` + **NSS for Chrome/Firefox** |
| 4 | Bind 80/443 (and 53 on Windows) | root daemon | LocalSystem service | root service |

## Windows plan (concrete)
1. **Service lifecycle** — `scripts/install-daemon.ps1` (run via `sudo-prompt`):
   - `sc.exe create EnvyDaemon binPath= "<electron> <envyd.cjs>" start= auto` (with `ELECTRON_RUN_AS_NODE=1` + `ENVY_*` env), or a tiny service shim (e.g. node-windows) for reliable lifecycle/logging.
   - `uninstall-daemon.ps1`: stop + delete service, remove NRPT rules, remove CA.
2. **DNS** — manage NRPT rules per domain (mirrors `writeResolvers`): `Add-DnsClientNrptRule -Namespace ".<domain>" -NameServers 127.0.0.1`. Requires the **DNS server to bind port 53** on Windows (config branch: high port on macOS, 53 on Windows). Verify 53 is free (conflicts: Windows DNS Server role, Internet Connection Sharing).
   - *Fallback if NRPT is unreliable:* daemon-managed **hosts file** entries per active container (`<name>.envy.local 127.0.0.1`). Loses wildcard; must add/remove per container (daemon already watches), but no port-53 dependency.
3. **CA trust** — `certutil -addstore -f Root <ca.crt>` in the elevated install (covers Edge/Chrome/system). Document Firefox as a known gap, or add NSS `certutil` handling later.
4. **Platform branch** in `daemon/main.ts` (`writeResolvers` → NRPT on win32) and `daemon-control.ts` (`paths()` + install command → `.ps1`, status via `sc query`/NRPT/cert presence instead of plist `existsSync`).

## Linux plan (sketch — messier, distro-dependent)
- systemd unit + pkexec; CA via `update-ca-trust`/`update-ca-certificates` **plus** NSS for browsers.
- DNS is the hard part: **port 53 collides with systemd-resolved**. Use dnsmasq (`server=/envy.local/127.0.0.1#<highport>`) or NetworkManager's dnsmasq plugin; detect and adapt to resolved vs NetworkManager vs raw resolv.conf. Test matrix across distros is the real cost.

## Effort estimate
- **Windows:** ~2–4 focused days + on-device testing. Main risks: NRPT behavior/port-53, Firefox trust, service lifecycle reliability.
- **Linux:** ~2–4 days, dominated by DNS-stack variance + browser NSS trust + multi-distro testing.

## Open decisions
- Windows DNS: **NRPT (wildcard, needs port 53)** vs **managed hosts entries (no wildcard, no port dep)**. Recommend NRPT, hosts as fallback.
- Firefox: accept "system-trusted browsers only" for v1, or do NSS trust too?
- Ship Windows first (defer Linux), or both together?

## Recommendation
Ship **macOS-first** now (mark Windows/Linux "coming soon" on the site), then land **Windows** as the first fast-follow using the plan above, **Linux** after. Avoid claiming cross-platform on the site until each platform's daemon actually serves URLs.
