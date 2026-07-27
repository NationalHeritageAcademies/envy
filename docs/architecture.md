# Envy — Architecture

How Envy is put together and *why*. Audience: contributors and future‑you.

## Big picture

Envy has three cooperating processes:

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  Electron app (unprivileged) │  IPC    │  Renderer (web components)    │
│  src/app/main.ts            │ ◀─────▶ │  src/ui/*  (@melodicdev/*)    │
│   • DATA engine (read/act)  │ preload │   • Services/Images/Domains   │
│   • daemon control          │         │   • Activity / Inspect drawer  │
│   • docker launch           │         └──────────────────────────────┘
└──────────────┬──────────────┘
               │ dockerode (Docker socket)
               ▼
        ┌──────────────┐        ┌──────────────────────────────────────┐
        │ Docker daemon │        │  Envy daemon (root, launchd)          │
        │ (OrbStack/…)  │ ◀───── │  src/daemon/main.ts → out/daemon/...  │
        └──────────────┘        │   • DNS (*.domain → 127.0.0.1)        │
                                │   • reverse proxy on 80/443 (+TLS)    │
                                │   • writes /etc/resolver + trusts CA  │
                                │   • watches config.json               │
                                └──────────────────────────────────────┘
```

- The **GUI** runs the *data layer* only (Docker discovery for the listing,
  plus container/image actions). It never binds privileged ports.
- The **daemon** runs the *serving layer* (DNS + reverse proxy on 80/443) as
  root, and does the one‑time privileged provisioning. It survives reboots.
- Both share the same **engine** code and the same `config.json`.

## The engine (`src/engine/`)

A self‑contained, headless core. No Electron dependency — it’s driven by both
the GUI (`startData()` only) and the daemon (`start()` = data + proxy), and is
also exercised by the CLI.

| File | Responsibility |
| --- | --- |
| `config.ts` | Load/persist settings (`domains`, per‑container `assignments`); env overrides; per‑OS data dir. Honors `SUDO_USER` so the daemon (root) uses *your* data dir. |
| `docker.ts` | `dockerode` wrapper — list/start/stop/restart/remove, pull, **run** (create+start), **recreateLatest** (update), inspect, **logs follow**, **stats**, **exec** (shell), images. Normalizes containers (incl. their network **IP**). |
| `discovery.ts` | Watches Docker events, rebuilds the route table. Resolves each container’s **domains** (`resolveContainerDomains`) and **target** (`pickTarget`). Detects container‑IP routability (`assumeContainerIpsRoutable()` + `probeContainerIp()`). |
| `routes.ts` | `RouteTable` — the live `host → {target, container}` map; emits `change`. |
| `dns.ts` | `dns2` server answering `A` records for any configured domain → `resolveTo` (127.0.0.1). Robust bind‑error handling. |
| `tls.ts` | `CertStore` — generates/caches a local CA + a wildcard leaf covering all domains (regenerated when the domain set changes). |
| `proxy.ts` | `http-proxy` reverse proxy on 80/443; routes by `Host` header; terminates TLS with the wildcard cert; friendly “no route” page; conflict/permission detection. |
| `engine.ts` | Orchestrator. `startData()` (discovery), `startProxy()` (DNS+proxy, independent so a privileged‑port failure doesn’t kill DNS), `status()`. |

### The routing model (the OrbStack‑parity core)

For each running container, `pickTarget` chooses where to forward:

1. **Published port → host loopback** (`127.0.0.1:<hostPort>`). Works on *every*
   Docker provider.
2. **Exposed‑only port → the container’s own IP** (`<containerIP>:<port>`).
   Works only where container IPs are routable from the host — **OrbStack**,
   **native Linux**, or any engine that passes the reachability probe (e.g.
   Colima with a routable network). This is how Envy matches OrbStack for
   Compose services that never publish a port.

Whether tier 2 is allowed is decided empirically, not by provider sniffing.
`assumeContainerIpsRoutable()` answers `true` on native Linux (and honors an
`ENVY_CONTAINER_IPS_ROUTABLE` env override); everywhere else `Discovery`
settles it on rebuild by TCP‑probing a live container IP (`probeContainerIp` —
a completed connect **or** ECONNREFUSED proves routability, since the RST must
come back from the container’s network; a timeout or no‑route error denies it).
The verdict is cached until the Docker connection is re‑established, then
re‑detected in case the engine changed (say, OrbStack → Colima). On Docker
Desktop (mac/Windows) the probe fails and the UI shows a “publish a port” hint
instead of a dead URL. (The old implementation sniffed the Docker socket path
for “orbstack”, which misreported any other engine with routable container
IPs.)

### Domain resolution

`resolveContainerDomains(labels, name, allDomains, assignments)` precedence:
1. `envy.domains` label (comma list, intersected with configured domains),
2. the user’s per‑container assignment (`config.assignments[name]`),
3. **the primary domain only** (the default — *not* every domain).

Hostname comes from `envy.host` (or an explicit `container_name:` — any name
that isn’t Compose’s `<project>-<service>-<n>` auto‑name wins over the service
name — or the Compose service name, falling back to the container name for
standalone containers / collisions); port from `envy.port`
(or a web‑port heuristic). A container can produce multiple routes (one per
domain, plus any dotted `envy.host` value used verbatim).

## The daemon (`src/daemon/`, `scripts/`)

A long‑running root process launchd keeps alive. Built as a **single
self‑contained bundle** (`out/daemon/envyd.cjs`, via esbuild) so it runs under
the Electron binary in Node mode (`ELECTRON_RUN_AS_NODE=1`) with no
`node_modules` alongside it.

On start (as root) it **self‑provisions** — the privileged work that an
`osascript` prompt can’t do non‑interactively:
- writes `/etc/resolver/<domain>` for each domain (scoped to that domain only),
- removes stale Envy‑managed resolver files for removed domains,
- trusts the local CA in the **System keychain** (a clean root process *can*
  set trust settings non‑interactively, unlike the install prompt),
- flushes DNS,
- runs the engine (DNS + proxy).

It then **watches `config.json`** and re‑applies on change: rebuilds the engine,
regenerates/re‑trusts the cert and rewrites resolver files when the domain set
changes — all with **no extra prompt**. This is why adding a domain or
reassigning a container in the app “just works” live.

### Install / one‑prompt flow

`src/app/daemon-control.ts` drives it via `@vscode/sudo-prompt` (one native
auth dialog):
1. The GUI materializes `config.json` and generates the CA (in your data dir).
2. `scripts/install-daemon.sh` (root) writes the LaunchDaemon plist
   (`/Library/LaunchDaemons/com.melodicdev.envy.plist`), `launchctl bootstrap`s
   it, and exits. **Resolver files + CA trust are NOT done here** — the daemon
   does them as a real root process (which is what makes it a single prompt).

`scripts/uninstall-daemon.sh` fully reverses it (bootout, remove plist + resolver
files + the “Envy Local CA” from the System keychain).

> The plist deliberately does **not** bake in the domain list — the daemon reads
> it from `config.json` and watches that file, which is what enables live
> propagation without a reinstall.

## OrbStack‑safety (by construction)

- Envy only ever creates `/etc/resolver/<its-own-domain>` files and a CA named
  **“Envy Local CA.”** It never reads/writes `orb.local` or OrbStack’s config.
- It only starts/stops the containers the user acts on.
- The proxy detects `EADDRINUSE`/`EACCES` and refuses to start rather than
  stomping a port.

## App ↔ renderer (IPC)

`src/ipc/contract.ts` is the single source of truth: a typed `EnvyApi`
interface + `CHANNELS` map. `src/app/preload.ts` exposes `window.envy` via
`contextBridge`; `src/app/main.ts` registers the `ipcMain` handlers and pushes
events (services changed, status, pull/stats/log/exec streams).

The renderer (`src/ui/`) is **`@melodicdev/core`** web components with a small
signal store (`src/ui/store/{state,actions}.ts`). The green design is applied by
**mapping the `--ev-*` palette onto Melodic’s `--ml-*` tokens**
(`src/ui/public/tokens.css`), so `@melodicdev/components` render on‑theme with no
per‑component CSS. See [MELODIC-NOTES.md](../MELODIC-NOTES.md) for what’s custom
vs. library and the gaps worth filing.

### Resilience details worth knowing
- **Offline → online recovery:** if Docker is down at launch, main polls every
  3s and connects automatically; the UI shows an offline state + “Start Docker.”
- **Engine split:** DNS and proxy start independently so a privileged‑port
  failure doesn’t take DNS down with it.
- **Log auto‑resume:** the drawer re‑attaches the `docker logs --follow` stream
  when a container comes back after a restart.

## Configuration & data

Per‑OS data dir (macOS: `~/Library/Application Support/Envy`):
- `config.json` — `{ domains: string[], assignments: Record<name, string[]> }`
- `ca/` — `envy-ca.{crt,key}`, `wildcard.{crt,key}`, `wildcard.domains.json`
- `daemon.log`, `launchd.{out,err}.log`

Env overrides (used by dev/CLI/daemon): `ENVY_DOMAINS` (comma), `ENVY_HTTP_PORT`,
`ENVY_HTTPS_PORT`, `ENVY_DNS_PORT` (default 15353), `ENVY_BIND`,
`ENVY_RESOLVE_TO`, `ENVY_DATA_DIR`, legacy `ENVY_TLD`.

## Cross‑platform status

The **UI is fully cross‑platform** (web tech). OS‑specific pieces:
- **Window chrome** — the macOS hidden‑inset titlebar / traffic‑light clearance
  is guarded behind `process.platform`; Windows/Linux get a standard frame.
- **Icons** — `build/icon.png` (1024²) → electron‑builder derives `.icns` /
  `.ico` / `.png`.
- **The privileged daemon + DNS/CA wiring + “Start Docker”** — implemented for
  **macOS**. Windows (a Service + NRPT DNS) and Linux (systemd +
  systemd‑resolved/dnsmasq) are planned; `daemon-control` / `docker-launch` are
  structured so those slot in. See [Development](development.md).

## Known limitations

- **Docker Desktop (mac/Win)** can’t route container IPs from the host, so
  exposed‑only containers need a published port (Envy shows a hint).
- **Private registries** aren’t authenticated yet (public pulls only).
- **Update/recreate** detaches a container from Compose’s own tracking.
- **Going offline while running** doesn’t flip the pill live yet (offline‑at‑
  launch recovery does work).
- **Windows/Linux daemon** not yet implemented.
