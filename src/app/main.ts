import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// electron-updater is CommonJS — import the default export and destructure.
import updaterPkg from 'electron-updater';
const { autoUpdater } = updaterPkg;
import { Engine } from '../engine/engine.js';
import { loadConfig, saveDomains, saveAssignment } from '../engine/config.js';
import { resolveContainerDomains } from '../engine/discovery.js';
import { checkDomain } from '../engine/domain-check.js';
import type { ServiceView, AppSettings, UpdateCheckResult, RunOptions } from '../ipc/contract.js';
import { CHANNELS } from '../ipc/contract.js';
import { daemonStatus, daemonInstall, daemonUninstall } from './daemon-control.js';
import { dockerProvider, startDocker } from './docker-launch.js';
import { initSettings, getSettings, setSetting } from './settings.js';
import { TRAY_MONO_16, TRAY_MONO_32, TRAY_COLOR_16, TRAY_COLOR_32 } from './tray-icons.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Windows title-bar overlay (caption strip + min/max/close button) colors per
// theme, so the native controls blend into the app instead of a light bar. The
// `color` matches the app background (--ev-bg) and `symbolColor` the text
// (--ev-text) from tokens.css. macOS/Linux ignore this.
const TITLEBAR_OVERLAY = {
  dark: { color: '#0a0c0b', symbolColor: '#e9ede9', height: 40 },
  light: { color: '#eef1ef', symbolColor: '#15201a', height: 40 },
} as const;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
// Set when the user picks "Quit Envy" (or the app is genuinely quitting) so the
// window's close handler knows to actually close rather than hide to the tray.
let isQuitting = false;
let engine = new Engine();

// Live-stream session bookkeeping.
const logStops = new Map<string, () => void>();
const execSessions = new Map<string, { write: (d: string) => void; resize: (s: { cols: number; rows: number }) => void; stop: () => void }>();
let execSeq = 0;
let statsTimer: NodeJS.Timeout | undefined;
const statsPrev = new Map<string, { net: number; disk: number; t: number }>();

/** Group containers with the routes (URLs) that point at each. */
async function buildServices(): Promise<ServiceView[]> {
  const containers = await engine.docker.listContainers(true);
  const routes = engine.listRoutes();
  const { domains, assignments } = engine.config;
  return containers.map((c) => ({
    ...c,
    routes: routes.filter((r) => r.containerId === c.id),
    // Effective domains computed the same way discovery does — so the UI is
    // correct even when the container is stopped (no live routes yet).
    domains: resolveContainerDomains(c.labels, c.name, domains, assignments),
    domainsLocked: Boolean(c.labels['envy.domains']),
  }));
}

function pushServices(): void {
  win?.webContents.send(CHANNELS.evServicesChanged);
}

async function pushStatus(): Promise<void> {
  win?.webContents.send(CHANNELS.evStatusChanged, await engine.status());
}

let eventsWired = false;
let reconnectTimer: NodeJS.Timeout | undefined;

/** Wire engine/docker change streams to renderer push events (once). */
function wireEngineEvents(): void {
  if (eventsWired) return;
  eventsWired = true;
  engine.onRoutesChanged(() => {
    pushServices();
    void pushStatus();
    void refreshTray();
  });
  // Container state changes that don't move routes (e.g. an unpublished
  // container starting) still need to refresh the list (and the tray menu).
  engine.docker.on('event', () => {
    pushServices();
    void refreshTray();
  });
  // The Docker daemon went away mid-session (e.g. OrbStack/Docker Desktop quit,
  // which also stops every container). The event stream is dead and our route
  // table is now stale — clear it so the UI immediately reflects "Docker is
  // gone" instead of showing dead containers as running, then poll for Docker
  // to return and re-arm the stream.
  engine.docker.on('stream-error', () => {
    engine.markDataLost();
    pushServices();
    void pushStatus();
    void refreshTray();
    scheduleReconnect();
  });
}

async function startEngine(): Promise<void> {
  // The GUI runs the DATA layer only (Docker discovery, for the listing). The
  // DNS + reverse proxy on 80/443 are owned by the privileged background daemon.
  try {
    await engine.startData();
    wireEngineEvents();
    if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = undefined; }
  } catch (err) {
    // Docker unreachable — show the offline state and poll for it to come up,
    // so starting Docker/OrbStack later recovers the app without a restart.
    console.error('Envy: data layer failed to start:', (err as Error).message);
    scheduleReconnect();
  }
  await pushStatus();
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    void (async () => {
      if (!(await engine.docker.ping())) return;
      try {
        // resumeData() reuses an existing Discovery (daemon-died-mid-session) or
        // does a fresh start (initial-boot failure); wireEngineEvents() is guarded
        // so it only binds the renderer push listeners on that first success.
        await engine.resumeData();
        wireEngineEvents();
        if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = undefined; }
        pushServices();
        void pushStatus();
        void refreshTray();
      } catch (err) {
        console.error('Envy: reconnect attempt failed:', (err as Error).message);
      }
    })();
  }, 3000);
}

/** Rebuild the engine after a domain change so new certs/routes take effect. */
async function rebuildEngine(): Promise<void> {
  await engine.stop();
  if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = undefined; }
  engine = new Engine(loadConfig());
  eventsWired = false; // new engine instance needs its events re-wired
  await startEngine();
  await pushStatus();
  pushServices();
}

/** Poll `docker stats` for every container @1.5s; derive net/disk rates from
 *  cumulative totals between ticks. Stopped containers report zeros. */
function startStats(): void {
  if (statsTimer) return;
  const tick = async (): Promise<void> => {
    let containers;
    try {
      containers = await engine.docker.listContainers(true);
    } catch {
      return;
    }
    const now = Date.now();
    const samples = await Promise.all(
      containers.map(async (c) => {
        if (!c.running) {
          return { id: c.id, name: c.name, running: false, cpu: 0, memBytes: 0, netRate: 0, diskRate: 0 };
        }
        try {
          const s = await engine.docker.statsOnce(c.id);
          const prev = statsPrev.get(c.id);
          const dt = prev ? (now - prev.t) / 1000 : 0;
          const netRate = prev && dt > 0 ? Math.max(0, (s.netTotal - prev.net) / dt) : 0;
          const diskRate = prev && dt > 0 ? Math.max(0, (s.diskTotal - prev.disk) / dt) : 0;
          statsPrev.set(c.id, { net: s.netTotal, disk: s.diskTotal, t: now });
          return { id: c.id, name: c.name, running: true, cpu: s.cpu, memBytes: s.memBytes, netRate, diskRate };
        } catch {
          return { id: c.id, name: c.name, running: true, cpu: 0, memBytes: 0, netRate: 0, diskRate: 0 };
        }
      }),
    );
    win?.webContents.send(CHANNELS.evStats, samples);
  };
  void tick();
  statsTimer = setInterval(() => void tick(), 1500);
}

function stopStats(): void {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = undefined;
  statsPrev.clear();
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.listServices, () => buildServices());
  ipcMain.handle(CHANNELS.listImages, () => engine.docker.listImages());
  ipcMain.handle(CHANNELS.getStatus, () => engine.status());
  ipcMain.handle(CHANNELS.getDomains, () => engine.config.domains);

  ipcMain.handle(CHANNELS.runContainer, async (_e, opts: RunOptions) => {
    await engine.docker.run(opts, (p) =>
      win?.webContents.send(CHANNELS.evPullProgress, { image: opts.image, status: p.status, done: false }),
    );
    pushServices();
  });
  ipcMain.handle(CHANNELS.startContainer, (_e, id: string) => engine.docker.start(id));
  ipcMain.handle(CHANNELS.stopContainer, (_e, id: string) => engine.docker.stop(id));
  ipcMain.handle(CHANNELS.restartContainer, (_e, id: string) => engine.docker.restart(id));
  ipcMain.handle(CHANNELS.removeContainer, (_e, id: string) => engine.docker.remove(id, true));
  ipcMain.handle(CHANNELS.recreateContainer, async (_e, id: string) => {
    await engine.docker.recreateLatest(id, (p) =>
      win?.webContents.send(CHANNELS.evPullProgress, { image: 'image', status: p.status, done: false }),
    );
    pushServices();
  });

  ipcMain.handle(CHANNELS.pullImage, async (_e, image: string) => {
    try {
      await engine.docker.pull(image, (p) => {
        win?.webContents.send(CHANNELS.evPullProgress, {
          image,
          status: p.status,
          done: false,
        });
      });
      win?.webContents.send(CHANNELS.evPullProgress, { image, status: 'Complete', done: true });
      pushServices();
    } catch (err) {
      win?.webContents.send(CHANNELS.evPullProgress, {
        image,
        status: 'Failed',
        done: true,
        error: (err as Error).message,
      });
      throw err;
    }
  });

  ipcMain.handle(CHANNELS.addDomain, async (_e, domain: string) => {
    // Validate BEFORE committing to config.json: a domain Envy can't own
    // (hosts-file shadowing, foreign resolver) must never reach the daemon,
    // where a failed provisioning used to take the working domains down too.
    const check = checkDomain(domain, engine.config.domains);
    if (!check.ok) throw new Error(check.error);
    const next = saveDomains(engine.config.dataDir, [...engine.config.domains, domain]);
    await rebuildEngine();
    return { domains: next, warning: check.warning };
  });
  ipcMain.handle(CHANNELS.removeDomain, async (_e, domain: string) => {
    const target = domain.toLowerCase().replace(/^\.+|\.+$/g, '');
    const next = saveDomains(
      engine.config.dataDir,
      engine.config.domains.filter((d) => d !== target),
    );
    await rebuildEngine();
    return next;
  });

  ipcMain.handle(CHANNELS.daemonStatus, () => daemonStatus(engine.config));
  ipcMain.handle(CHANNELS.daemonInstall, async () => {
    const status = await daemonInstall(engine.config);
    pushServices();
    return status;
  });
  ipcMain.handle(CHANNELS.daemonUninstall, () => daemonUninstall(engine.config));

  ipcMain.handle(CHANNELS.setPrimaryDomain, async (_e, domain: string) => {
    const d = domain.toLowerCase().replace(/^\.+|\.+$/g, '');
    const reordered = [d, ...engine.config.domains.filter((x) => x !== d)];
    const saved = saveDomains(engine.config.dataDir, reordered);
    await rebuildEngine();
    return saved;
  });
  ipcMain.handle(CHANNELS.setContainerDomains, async (_e, name: string, domains: string[]) => {
    saveAssignment(engine.config.dataDir, name, domains);
    await rebuildEngine();
  });

  ipcMain.handle(CHANNELS.removeImage, (_e, id: string) => engine.docker.removeImage(id));
  ipcMain.handle(CHANNELS.inspectContainer, (_e, id: string) => engine.docker.inspectDetail(id));
  ipcMain.handle(CHANNELS.platform, () => process.platform);
  // Windows only: recolor the native title-bar overlay to match the app theme.
  // No-op elsewhere (macOS uses hidden-inset traffic lights, unaffected).
  ipcMain.on(CHANNELS.setWindowTheme, (_e, theme: 'dark' | 'light') => {
    if (process.platform !== 'win32' || !win) return;
    win.setTitleBarOverlay(TITLEBAR_OVERLAY[theme] ?? TITLEBAR_OVERLAY.dark);
  });
  ipcMain.handle(CHANNELS.dockerProvider, () => dockerProvider());
  ipcMain.handle(CHANNELS.startDocker, () => startDocker());

  // ── Logs (docker logs --follow) ──────────────────────────────────────────
  ipcMain.handle(CHANNELS.subscribeLogs, async (_e, id: string) => {
    logStops.get(id)?.();
    const stop = await engine.docker.followLogs(id, (text, stream) =>
      win?.webContents.send(CHANNELS.evLog, { id, text, stream }),
    );
    logStops.set(id, stop);
  });
  ipcMain.on(CHANNELS.unsubscribeLogs, (_e, id: string) => {
    logStops.get(id)?.();
    logStops.delete(id);
  });

  // ── Interactive shell (docker exec) ──────────────────────────────────────
  ipcMain.handle(CHANNELS.execStart, async (_e, id: string, opts: { cols: number; rows: number }) => {
    const sessionId = `exec-${++execSeq}`;
    const session = await engine.docker.startExec(
      id,
      opts,
      (data) => win?.webContents.send(CHANNELS.evExecData, { sessionId, data }),
      () => {
        win?.webContents.send(CHANNELS.evExecExit, sessionId);
        execSessions.delete(sessionId);
      },
    );
    execSessions.set(sessionId, session);
    return { sessionId };
  });
  ipcMain.on(CHANNELS.execWrite, (_e, sessionId: string, data: string) => execSessions.get(sessionId)?.write(data));
  ipcMain.on(CHANNELS.execResize, (_e, sessionId: string, size: { cols: number; rows: number }) => execSessions.get(sessionId)?.resize(size));
  ipcMain.on(CHANNELS.execStop, (_e, sessionId: string) => {
    execSessions.get(sessionId)?.stop();
    execSessions.delete(sessionId);
  });

  // ── Activity (docker stats poll @ 1.5s) ──────────────────────────────────
  ipcMain.handle(CHANNELS.subscribeStats, () => startStats());
  ipcMain.on(CHANNELS.unsubscribeStats, () => stopStats());

  ipcMain.handle(CHANNELS.openExternal, (_e, url: string) => shell.openExternal(url));
  ipcMain.handle(CHANNELS.copyText, (_e, text: string) => {
    clipboard.writeText(text);
  });

  // ── App settings + updates ───────────────────────────────────────────────
  ipcMain.handle(CHANNELS.getAppSettings, () => getSettings());
  ipcMain.handle(CHANNELS.setAppSetting, (_e, key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => {
    const next = setSetting(key, value as never);
    if (key === 'startAtLogin') applyLoginItem(next.startAtLogin);
    void refreshTray();
    return next;
  });
  ipcMain.handle(CHANNELS.appVersion, () => app.getVersion());
  ipcMain.handle(CHANNELS.checkForUpdates, (): Promise<UpdateCheckResult> => checkForUpdates());

  // Triggered from the renderer's "Restart to update" pill — quits the app,
  // swaps the on-disk binary via electron-updater's staged installer, and
  // relaunches. Must use the SAME autoUpdater instance that downloaded the
  // update; a fresh instance has no staged update and would no-op.
  //
  // Set isQuitting first: on macOS the native Squirrel updater closes all
  // windows BEFORE calling app.quit(), so without this flag the win.on('close')
  // guard would preventDefault() and hide the window to the tray (when "Keep
  // Running in Background" is on), leaving the staged update never installed.
  ipcMain.on(CHANNELS.quitAndInstall, () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });
}

/** Wire electron-updater: check on launch, auto-download, and tell the
 *  renderer when a new version is staged so it can offer "Restart to update".
 *  No-op in dev (no publish manifest is available there). */
function initAutoUpdate(): void {
  // Dev builds run from source with no update feed — skip entirely.
  if (process.env['ELECTRON_RENDERER_URL']) return;

  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', (info) => {
    win?.webContents.send(CHANNELS.evUpdateDownloaded, { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    console.warn('Envy autoUpdater error:', err.message);
  });
  // Delay the first check so it doesn't compete with first-frame work.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((err: unknown) => {
      console.warn('Envy autoUpdater check failed:', (err as Error).message);
    });
  }, 5000);
}

/** Build the tray's nativeImage from the embedded base64 glyphs. macOS gets the
 *  mono *template* image (the OS recolors it for light/dark menu bars); other
 *  platforms get the brand-green glyph. The @2x rep keeps it crisp on retina. */
function trayImage(): Electron.NativeImage {
  const mac = process.platform === 'darwin';
  const png = (b64: string) => `data:image/png;base64,${b64}`;
  const img = nativeImage.createFromDataURL(png(mac ? TRAY_MONO_16 : TRAY_COLOR_16));
  img.addRepresentation({ scaleFactor: 2, dataURL: png(mac ? TRAY_MONO_32 : TRAY_COLOR_32) });
  if (mac) img.setTemplateImage(true);
  return img;
}

/** Drop the macOS dock icon so the app looks fully closed while the menu-bar
 *  tray keeps it alive (OrbStack-style). No-op off macOS. Must run *after* the
 *  window is hidden, or it would yank the dock icon out from under a live window. */
function hideDock(): void {
  if (process.platform === 'darwin') app.dock?.hide();
}

/** Restore the dock icon before revealing the window again. On macOS the dock
 *  must be shown *before* win.show() for the window to come forward properly. */
function showDock(): void {
  if (process.platform === 'darwin') void app.dock?.show();
}

/** Reveal the main window, recreating it if it was fully closed. */
function showWindow(): void {
  showDock();
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** True when the main window exists and is actually on-screen (not hidden to the
 *  tray or minimized) — used to grey out "Show Envy" when it would be a no-op. */
function windowIsShowing(): boolean {
  return Boolean(win && win.isVisible() && !win.isMinimized());
}

/** Manually poll the update feed (tray "Check for Updates…" / Settings button).
 *  A newer version auto-downloads and then surfaces via the same "Restart to
 *  update" pill as background auto-update. No-op in dev (no publish manifest). */
async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (process.env['ELECTRON_RENDERER_URL']) return { status: 'dev' };
  try {
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version;
    if (latest && latest !== app.getVersion()) return { status: 'available', version: latest };
    return { status: 'current' };
  } catch (err) {
    console.warn('Envy manual update check failed:', (err as Error).message);
    return { status: 'error', error: (err as Error).message };
  }
}

/** Apply the OS "open at login" registration. Packaged-app only — in dev the
 *  binary path is Electron itself, so registering it would be meaningless. */
function applyLoginItem(open: boolean): void {
  if (process.env['ELECTRON_RENDERER_URL']) return;
  app.setLoginItemSettings({ openAtLogin: open });
}

/** Show the window and ask the renderer to switch to the Settings view. If the
 *  window had to be created, wait for its first load before sending. */
function openSettings(): void {
  const existed = Boolean(win);
  showWindow();
  if (existed) {
    win?.webContents.send(CHANNELS.evOpenSettings);
  } else {
    win?.webContents.once('did-finish-load', () => win?.webContents.send(CHANNELS.evOpenSettings));
  }
}

// Help links. Documentation points at the marketing site's /docs page.
const HELP_LINKS = {
  docs: 'https://github.com/NationalHeritageAcademies/envy/tree/main/docs',
  reportIssue: 'https://github.com/NationalHeritageAcademies/envy/issues/new',
};

function helpSubmenu(): Electron.MenuItemConstructorOptions {
  return {
    label: 'Help',
    submenu: [
      { label: 'Documentation', click: () => void shell.openExternal(HELP_LINKS.docs) },
      { label: 'Report an Issue', click: () => void shell.openExternal(HELP_LINKS.reportIssue) },
      { type: 'separator' },
      { label: `Envy v${app.getVersion()}`, enabled: false },
    ],
  };
}

// Compose labels — mirror the renderer's services-view grouping so the tray
// matches the app (containers grouped by Compose project; the rest "Standalone").
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';

interface TrayGroup { project: string; standalone: boolean; services: ServiceView[]; }

function groupServicesForTray(list: ServiceView[]): TrayGroup[] {
  const byProject = new Map<string, ServiceView[]>();
  const standalone: ServiceView[] = [];
  for (const s of list) {
    const project = s.labels[COMPOSE_PROJECT_LABEL];
    if (project) byProject.set(project, [...(byProject.get(project) ?? []), s]);
    else standalone.push(s);
  }
  const groups = [...byProject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, svcs]) => ({ project, standalone: false, services: svcs }));
  if (standalone.length) groups.push({ project: 'Standalone', standalone: true, services: standalone });
  return groups;
}

/** Start every stopped (or stop every running) container in a group at once. */
function groupToggleAll(g: TrayGroup, anyRunning: boolean): void {
  for (const s of g.services) {
    if (anyRunning && s.running) void engine.docker.stop(s.id);
    else if (!anyRunning && !s.running) void engine.docker.start(s.id);
  }
  void refreshTray();
}

/** A single container as a submenu of start/stop/restart, wired straight to the
 *  engine (same calls the renderer's IPC handlers make). The ●/○ prefix shows
 *  run state at a glance (menu text can't be colored like the app's dots). */
function serviceItem(s: ServiceView, label: string): Electron.MenuItemConstructorOptions {
  return {
    label: `${s.running ? '● ' : '○ '}${label}`,
    submenu: [
      s.running
        ? { label: 'Stop', click: () => void engine.docker.stop(s.id).then(refreshTray) }
        : { label: 'Start', click: () => void engine.docker.start(s.id).then(refreshTray) },
      { label: 'Restart', enabled: s.running, click: () => void engine.docker.restart(s.id).then(refreshTray) },
    ],
  };
}

/** The "Containers" portion of the tray menu, grouped by Compose project to
 *  match the app. Each project is a submenu (count + Start/Stop all + its
 *  services); standalone containers are listed under a "Standalone" submenu. */
function containerMenuItems(services: ServiceView[]): Electron.MenuItemConstructorOptions[] {
  if (!services.length) return [{ label: 'No containers', enabled: false }];
  return groupServicesForTray(services).map((g) => {
    if (g.standalone) {
      return { label: g.project, submenu: g.services.map((s) => serviceItem(s, s.name)) };
    }
    const running = g.services.filter((s) => s.running).length;
    const anyRunning = running > 0;
    const submenu: Electron.MenuItemConstructorOptions[] = [
      { label: `${running}/${g.services.length} running`, enabled: false },
      { type: 'separator' },
      { label: anyRunning ? 'Stop all' : 'Start all', click: () => groupToggleAll(g, anyRunning) },
      { type: 'separator' },
      ...g.services.map((s) => serviceItem(s, s.labels[COMPOSE_SERVICE_LABEL] ?? s.name)),
    ];
    return { label: g.project, submenu };
  });
}

function buildTrayMenu(services: ServiceView[]): Menu {
  return Menu.buildFromTemplate([
    { label: 'Show Envy', enabled: !windowIsShowing(), click: () => showWindow() },
    { type: 'separator' },
    { label: 'Containers', enabled: false },
    ...containerMenuItems(services),
    { type: 'separator' },
    {
      label: 'Keep Running in Background',
      type: 'checkbox',
      checked: getSettings().keepRunningInBackground,
      click: (item) => {
        setSetting('keepRunningInBackground', item.checked);
        void refreshTray();
      },
    },
    helpSubmenu(),
    { label: 'Check for Updates…', click: () => void checkForUpdates() },
    { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
    { type: 'separator' },
    {
      label: 'Quit Envy',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

/** Rebuild and reattach the tray's context menu from the current container list.
 *  Called on startup, on Docker/route changes, and on window visibility changes. */
async function refreshTray(): Promise<void> {
  if (!tray) return;
  let services: ServiceView[] = [];
  try {
    services = await buildServices();
  } catch {
    /* Docker offline — fall back to an empty container list. */
  }
  tray.setContextMenu(buildTrayMenu(services));
}

/** Create the menu-bar/system-tray icon (once). Left-clicking the icon opens the
 *  app on Windows/Linux; on macOS the context menu is the primary affordance. */
function createTray(): void {
  if (tray) return;
  tray = new Tray(trayImage());
  tray.setToolTip('Envy');
  void refreshTray();
  // On Windows/Linux a left-click is the expected way to open the app; on macOS
  // clicking the menu-bar icon should just reveal the menu, not open the window.
  if (process.platform !== 'darwin') tray.on('click', () => showWindow());
}

// Reload-loop guard for the renderer-recovery handlers below: a deterministic
// renderer crash must not become an infinite reload storm. Timestamps of recent
// auto-reloads; entries older than the window are dropped before each check.
const rendererReloads: number[] = [];
const RELOAD_WINDOW_MS = 10_000;
const RELOAD_MAX = 3;

/** Reload the window unless we've already auto-reloaded too often recently —
 *  in that case leave the renderer's visible error fallback on screen. */
function guardedReload(why: string): void {
  if (!win || win.isDestroyed()) return;
  const now = Date.now();
  while (rendererReloads.length && now - rendererReloads[0]! > RELOAD_WINDOW_MS) rendererReloads.shift();
  if (rendererReloads.length >= RELOAD_MAX) {
    console.error(`Envy: not auto-reloading (${why}) — ${RELOAD_MAX} reloads in ${RELOAD_WINDOW_MS / 1000}s, giving up.`);
    return;
  }
  rendererReloads.push(now);
  console.warn(`Envy: reloading renderer (${why}).`);
  win.reload();
}

/** A blank window is the renderer failing silently — log why and self-heal.
 *  Without these handlers a renderer/GPU crash or failed load leaves the window
 *  painting its backgroundColor forever (see docs/plans/blank-screen-recovery.md). */
function wireRendererRecovery(wc: Electron.WebContents): void {
  wc.on('render-process-gone', (_e, details) => {
    console.error('Envy renderer gone:', details.reason, details.exitCode);
    if (details.reason !== 'clean-exit') guardedReload(`renderer ${details.reason}`);
  });
  wc.on('unresponsive', () => guardedReload('renderer unresponsive'));
  wc.on('did-fail-load', (_e, code, desc, url) => {
    console.error('Envy load failed:', code, desc, url);
    // -3 is ERR_ABORTED (benign — e.g. a superseded navigation).
    if (code !== -3) setTimeout(() => guardedReload(`load failed ${code}`), 500);
  });
  // Surface renderer console errors into the main log so packaged crashes aren't silent.
  wc.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error('[renderer]', message);
  });
}

function createWindow(): void {
  const mac = process.platform === 'darwin';
  const win32 = process.platform === 'win32';
  const options: Electron.BrowserWindowConstructorOptions = {
    width: 1100,
    height: 760,
    minWidth: 840,
    minHeight: 560,
    // macOS: hidden-inset shows traffic lights over our sidebar (unchanged).
    // Windows: a frameless caption with a themed Window Controls Overlay so the
    // title bar matches the app's dark/light theme (recolored live via
    // CHANNELS.setWindowTheme) instead of a stock light bar. Linux keeps the
    // standard frame (the Controls Overlay isn't supported there).
    titleBarStyle: mac ? 'hiddenInset' : win32 ? 'hidden' : 'default',
    backgroundColor: '#0a0c0b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  };
  if (win32) {
    // Themed caption + window controls, and auto-hide the stock light menu bar
    // (File/Edit/…). Alt still reveals it, so the standard accelerators remain.
    options.titleBarOverlay = TITLEBAR_OVERLAY.dark;
    options.autoHideMenuBar = true;
  }
  win = new BrowserWindow(options);
  wireRendererRecovery(win.webContents);

  const loaded = process.env['ELECTRON_RENDERER_URL']
    ? win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    : win.loadFile(join(__dirname, '../renderer/index.html'));
  // did-fail-load handles recovery; this just keeps the rejection out of the void.
  loaded.catch((err: unknown) => console.error('Envy initial load rejected:', (err as Error).message));

  // OrbStack-style: closing the window (red traffic-light) keeps Envy resident —
  // it hides to the tray and drops the dock dot (via win.on('hide') → hideDock())
  // rather than quitting. Re-shown via the tray's "Show Envy"; a real quit comes
  // from ⌘Q (before-quit) or the tray's "Quit Envy", both of which set isQuitting.
  //
  // hidingToTray marks the next 'hide' event as ours: macOS also hides windows on
  // its own (⌘H, Stage Manager, Space switches when another app activates — e.g.
  // shell.openExternal launching the browser), and those must NOT retire the dock
  // icon or Envy loses its dock dot while the window is still alive.
  let hidingToTray = false;
  win.on('close', (e) => {
    if (!isQuitting && getSettings().keepRunningInBackground) {
      e.preventDefault();
      hidingToTray = true;
      win?.hide();
    }
  });

  win.on('closed', () => {
    win = null;
    void refreshTray();
  });

  // Keep "Show Envy" enabled-state accurate as the window hides/shows/minimizes.
  // Hiding to the tray also drops the dock icon so Envy looks truly closed; it
  // comes back via showWindow() → showDock(). Only the close-to-tray path (which
  // sets hidingToTray) retires the dock icon — OS-initiated hides leave it alone.
  const onVisibilityChange = () => void refreshTray();
  win.on('show', onVisibilityChange);
  win.on('hide', () => {
    if (hidingToTray) {
      hidingToTray = false;
      hideDock();
    }
    onVisibilityChange();
  });
  win.on('minimize', onVisibilityChange);
  win.on('restore', onVisibilityChange);
}

// Single-instance lock: a second launch should focus the existing window, not
// start another tray + data-layer + daemon connection. On Windows especially,
// re-clicking the exe/taskbar would otherwise open a brand-new instance each time.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();
app.on('second-instance', () => showWindow());

void app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;
  registerIpc();
  await startEngine();
  const settings = initSettings(engine.config.dataDir);
  applyLoginItem(settings.startAtLogin);
  createTray();
  createWindow();
  initAutoUpdate();

  app.on('activate', () => showWindow());
});

app.on('window-all-closed', () => {
  // The tray keeps Envy alive when "keep running in background" is on; otherwise
  // closing the last window quits on Windows/Linux (macOS apps stay resident).
  if (getSettings().keepRunningInBackground) return;
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // OrbStack-style: ⌘Q is a genuine, full quit — it tears down the menu-bar tray,
  // stops the engine (proxy + DNS + hosts cleanup) and exits. Closing the window
  // (red traffic-light) is the path that keeps Envy resident in the tray; that's
  // handled in win.on('close'). isQuitting tells the close handler to let the
  // window actually close here rather than hide to the tray.
  isQuitting = true;
  void engine.stop();
});
