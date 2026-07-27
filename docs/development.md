# Envy — Development

How to build, run, package, and extend Envy.

## Prerequisites

- **Node** (project developed on Node 24; Node 18+ should work).
- A **Docker engine** running locally (OrbStack, Docker Desktop, colima, …) for
  anything that touches containers.
- macOS for the full experience (the daemon is macOS‑wired today).

```bash
npm install
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | electron‑vite dev server + Electron (hot reload). |
| `npm run build` | Build main/preload/renderer **and** the daemon bundle. |
| `npm run build:daemon` | Bundle the daemon to `out/daemon/envyd.cjs` (esbuild). |
| `npm start` / `npm run preview` | Run the built app (electron‑vite preview). |
| `npm run icons` | Rasterize `build/icon.svg` → `build/icon.png` (resvg). |
| `npm run package` | electron‑builder for the current OS (runs `prepackage`). |
| `npm run package:all` | Build mac + win + linux targets. |
| `npm run cli -- <cmd>` | Run the CLI (`ls`, `up/down`, `pull`, `domains …`, `status`). |
| `npm run engine` | Run the DNS + proxy engine headless (foreground). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Vitest. |

### Two dev gotchas
- **MelodicComponent edits need a full restart.** Hot reload can’t re‑`define`
  a custom element, so changes to any `*.component`/view under `src/ui/components`
  require quitting and re‑running (`npm run dev`) — *not* just Cmd‑R. Plain CSS
  (`src/ui/public/tokens.css`) **does** hot‑reload.
- **Don’t bind privileged ports in dev.** The GUI is data‑only; serving on
  80/443 is the daemon’s job. To test the engine headless on unprivileged ports:
  ```bash
  ENVY_HTTP_PORT=8080 ENVY_HTTPS_PORT=8443 ENVY_DNS_PORT=15354 npm run engine
  ```
  (Use a DNS port other than 15353 if the installed daemon is running.)

## Project layout

```
src/
  engine/      Headless core (Docker + discovery + DNS + TLS + proxy). See architecture.md.
  daemon/      Long-running root daemon entry (main.ts → bundled to out/daemon/envyd.cjs).
  app/         Electron main process:
    main.ts          window, IPC handlers, stats/log/exec session plumbing, reconnect
    preload.ts       contextBridge → window.envy
    daemon-control.ts  install/uninstall/status via sudo-prompt
    docker-launch.ts   detect + launch the Docker provider
  ipc/         contract.ts — typed EnvyApi + CHANNELS (single source of truth)
  ui/          Renderer (web components + signal store)
    components/  envy-app, services-view, images-view, domains-view, activity-view,
                 inspect-drawer, shell-term, run-dialog, brand, toast
    store/       state.ts (signals), actions.ts
    public/      tokens.css (the --ev-* → --ml-* theme mapping)
    main.ts, index.html
  cli/         envy.ts — commander CLI
scripts/       install-daemon.sh, uninstall-daemon.sh, setup-macos.sh,
               build-daemon.mjs, build-icons.mjs, notarize.cjs
build/         icon.svg, icon.png, entitlements.mac.plist
```

Path aliases (tsconfig + electron.vite): `@engine`, `@ipc`, `@app`, `@ui`.

## How a feature flows end‑to‑end

Use this as the template when adding capabilities:

1. **Engine/Docker** — add the capability in `src/engine/docker.ts` (or another
   engine module).
2. **Contract** — add the method + a channel name to `src/ipc/contract.ts`.
3. **Main** — register an `ipcMain.handle`/`.on` in `src/app/main.ts`.
4. **Preload** — expose it on `window.envy` in `src/app/preload.ts`.
5. **Store** — add an action in `src/ui/store/actions.ts` (+ signals in
   `state.ts` if it has UI state).
6. **UI** — call it from a component, leaning on `@melodicdev/components`.

Run `npm run typecheck` after — the typed contract catches mismatches across all
layers.

## Theming

The palette lives once in `src/ui/public/tokens.css` as `--ev-*` (dark + light),
then maps onto Melodic’s `--ml-*` semantic tokens. Change a color there and it
propagates to every `ml-*` component automatically. Only bespoke surfaces use a
thin `--ev-*` layer directly. See [MELODIC-NOTES.md](../MELODIC-NOTES.md).

## Packaging & signing

`electron-builder.yml` (mirrors the Coax setup):
- **appId** `dev.melodic.envy`; mac dmg+zip (universal), win nsis, linux
  AppImage+deb.
- **Code signing** uses a Developer ID from the keychain (electron‑builder
  auto‑detects); hardened runtime + `build/entitlements.mac.plist` (which
  includes `allow-dyld-environment-variables` so the daemon can run the Electron
  binary as Node).
- **Notarization** via `scripts/notarize.cjs` — a no‑op unless `ENVY_NOTARIZE=1`
  is set. Set up the profile once:
  ```bash
  xcrun notarytool store-credentials envy-notarize
  ENVY_NOTARIZE=1 npm run package
  ```
- **extraResources** ship `scripts/*.sh` and `out/daemon/` into the app bundle,
  so `daemon-control` finds them at `process.resourcesPath` in production.

The daemon’s LaunchDaemon runs the **app’s own Electron binary** with
`ELECTRON_RUN_AS_NODE=1` against the bundled `envyd.cjs` — no separate Node
required. (It references an absolute path, so a packaged app should live in a
stable location like `/Applications`.)

## Extending to Windows / Linux

The UI already runs everywhere. To bring the privileged layer to other OSes,
implement these behind the existing seams:

**`src/app/docker-launch.ts`** — already has win/linux branches (launch Docker
Desktop / `systemctl start docker`); refine as needed.

**`src/app/daemon-control.ts` + a per‑OS service installer** (the macOS analog of
`scripts/install-daemon.sh`):
- **Windows:** install a Windows Service (or scheduled task) that runs
  `envyd.cjs`; wire DNS via the **NRPT** (`Add-DnsClientNrptRule`) instead of
  `/etc/resolver`; trust the CA in the machine root store
  (`certutil -addstore Root`). Elevation via a UAC prompt.
- **Linux:** a `systemd` unit running `envyd.cjs` as root; DNS via
  `systemd-resolved` drop‑ins or `dnsmasq`; trust the CA in
  `/usr/local/share/ca-certificates` + `update-ca-certificates`.

The daemon itself (`src/daemon/main.ts`) is mostly portable; factor the macOS‑
specific provisioning (`/etc/resolver`, `security add-trusted-cert`,
`dscacheutil`/`killall mDNSResponder`) behind a platform switch.

`engine/discovery.ts:containerIpsRoutable()` already returns `true` on Linux
(bridge IPs are host‑routable), so exposed‑only routing works there for free.

## Backlog / good next tasks

- Private‑registry auth (read `docker login` creds or a login flow).
- “Update available” badge (registry digest comparison).
- Live offline detection (flip the pill when Docker quits mid‑session).
- Convert custom components (sidebar/card/drawer/tabs/table) to `ml-*` and file
  the gaps in [MELODIC-NOTES.md](../MELODIC-NOTES.md).
- Volumes (and maybe Networks) management views.
- Windows/Linux daemon (above).
