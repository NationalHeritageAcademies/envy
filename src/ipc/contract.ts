import type { ContainerSummary, ImageSummary } from '../engine/docker.js';
import type { Route } from '../engine/routes.js';
import type { EngineStatus } from '../engine/engine.js';

export type { ContainerSummary, ImageSummary, Route, EngineStatus };

/** A container plus the routes (URLs) currently pointing at it. */
export interface ServiceView extends ContainerSummary {
  routes: Route[];
  /** Effective domains this container is reachable on (label/assignment/primary). */
  domains: string[];
  /** True when fixed by the `envy.domains` label (UI assignment is read-only). */
  domainsLocked: boolean;
}

/** Options for running a new container (a friendly `docker run`). */
export interface RunOptions {
  image: string;
  name?: string;
  ports?: { host: number; container: number }[];
  env?: string[]; // "KEY=value" entries
  volumes?: { source: string; target: string }[];
  /** Extra labels — used to set envy.host / envy.domains at create time. */
  labels?: Record<string, string>;
}

/** Pull progress streamed to the renderer during `pullImage`. */
export interface PullEvent {
  image: string;
  status: string;
  done: boolean;
  error?: string;
}

/** Outcome of a successful addDomain (validation failures reject instead). */
export interface AddDomainResult {
  /** The full configured domain list after the add. */
  domains: string[];
  /** Set when the domain was added but carries a caveat (public TLD, .local). */
  warning?: string;
}

/** State of the privileged background daemon (DNS + proxy on 80/443). */
export interface DaemonStatus {
  /** LaunchDaemon plist is installed. */
  installed: boolean;
  /** Daemon process is currently loaded/running per launchctl. */
  running: boolean;
  /** A live TCP probe of the HTTPS proxy port — true when something actually
   *  accepts connections. `running` alone can be stale (process alive, proxy
   *  dead after a failed reconfigure). */
  proxyListening: boolean;
  /** Domains it's configured to serve. */
  domains: string[];
}

/** Full container detail for the Inspect drawer (from `docker inspect`). */
export interface ContainerDetail {
  id: string;
  name: string;
  image: string;
  running: boolean;
  ports: { host?: number; container: number; type: string }[];
  env: { key: string; value: string }[];
  mounts: { source: string; destination: string; mode: 'ro' | 'rw' }[];
}

/** A single log line streamed from `docker logs --follow`. */
export interface LogLine {
  id: string; // container id this belongs to
  text: string;
  stream: 'stdout' | 'stderr';
}

/** Per-container resource sample from the `docker stats` stream. */
export interface StatSample {
  id: string;
  name: string;
  running: boolean;
  cpu: number; // percent
  memBytes: number;
  netRate: number; // bytes/sec (rx+tx)
  diskRate: number; // bytes/sec (read+write)
}

/** A chunk of output from an interactive `docker exec` shell session. */
export interface ExecChunk {
  sessionId: string;
  data: string;
}

/** Emitted once electron-updater has staged a newer version on disk. */
export interface UpdateInfo {
  /** The version that's been downloaded and is ready to install on restart. */
  version: string;
}

/** Persisted app/UI preferences (settings.json in the data dir). Shared shape so
 *  the main process and the renderer's Settings view agree on keys + types. */
export interface AppSettings {
  /** Keep Envy alive in the menu bar/tray after the window is closed. */
  keepRunningInBackground: boolean;
  /** Launch Envy automatically when the user logs in. */
  startAtLogin: boolean;
}

/** Result of a manual "Check for Updates" poll. */
export interface UpdateCheckResult {
  /** 'available' once a newer version is downloading/staged, 'current' if up to
   *  date, 'dev' when running from source (no feed), 'error' on a failed check. */
  status: 'available' | 'current' | 'dev' | 'error';
  /** The newer version string when status is 'available'. */
  version?: string;
  /** Error message when status is 'error'. */
  error?: string;
}

/**
 * The API surface exposed to the renderer on `window.envy` (via preload).
 * Request/response calls are ipcRenderer.invoke under the hood; the `on*`
 * methods subscribe to pushed main-process events and return an unsubscribe.
 */
export interface EnvyApi {
  // ── Queries ────────────────────────────────────────────────────────────
  listServices(): Promise<ServiceView[]>;
  listImages(): Promise<ImageSummary[]>;
  getStatus(): Promise<EngineStatus>;
  getDomains(): Promise<string[]>;

  // ── Container actions ──────────────────────────────────────────────────
  /** Create + start a new container (pulls the image first if missing). */
  runContainer(opts: RunOptions): Promise<void>;
  startContainer(id: string): Promise<void>;
  stopContainer(id: string): Promise<void>;
  restartContainer(id: string): Promise<void>;
  removeContainer(id: string): Promise<void>;
  /** Pull the latest of the container's image tag, recreate with same config. */
  recreateContainer(id: string): Promise<void>;

  // ── Image actions ──────────────────────────────────────────────────────
  pullImage(image: string): Promise<void>;
  removeImage(id: string): Promise<void>;

  // ── Inspect (drawer) ───────────────────────────────────────────────────
  inspectContainer(id: string): Promise<ContainerDetail>;
  /** Begin streaming `docker logs --follow`; returns unsubscribe. */
  subscribeLogs(id: string, cb: (line: LogLine) => void): () => void;
  /** Begin an interactive `docker exec` shell; returns a session handle. */
  execStart(id: string, opts: { cols: number; rows: number }): Promise<{ sessionId: string }>;
  execWrite(sessionId: string, data: string): void;
  execResize(sessionId: string, size: { cols: number; rows: number }): void;
  execStop(sessionId: string): void;
  onExecData(cb: (chunk: ExecChunk) => void): () => void;
  onExecExit(cb: (sessionId: string) => void): () => void;

  // ── Activity (resource monitor) ────────────────────────────────────────
  /** Start the `docker stats` stream; samples arrive via cb. Returns stop fn. */
  subscribeStats(cb: (samples: StatSample[]) => void): () => void;
  /** Platform string for OS-specific UI (window chrome, etc.). */
  platform(): Promise<NodeJS.Platform>;
  /** Keep the Windows title-bar overlay (caption + min/max/close) in sync with
   *  the app theme. Fire-and-forget; a no-op off Windows. */
  setWindowTheme(theme: 'dark' | 'light'): void;

  // ── Domain actions ─────────────────────────────────────────────────────
  /** Validates first (hosts-file shadowing, foreign resolver, syntax) and
   *  rejects with a clear message; a `warning` is a risky-but-allowed add
   *  (public TLD, mDNS `.local`) the UI should surface. */
  addDomain(domain: string): Promise<AddDomainResult>;
  removeDomain(domain: string): Promise<string[]>;
  /** Make `domain` the primary (first) — new/unassigned containers use it. */
  setPrimaryDomain(domain: string): Promise<string[]>;
  /** Restrict a container to a subset of domains (empty/all → reachable on all). */
  setContainerDomains(name: string, domains: string[]): Promise<void>;

  // ── Privileged daemon (DNS + proxy on 80/443) ──────────────────────────
  daemonStatus(): Promise<DaemonStatus>;
  /** Installs + starts the daemon via ONE native macOS auth prompt. */
  daemonInstall(): Promise<DaemonStatus>;
  /** Removes the daemon (one native auth prompt). */
  daemonUninstall(): Promise<DaemonStatus>;

  // ── Docker engine ──────────────────────────────────────────────────────
  /** Which Docker provider backs the socket, whether Envy can start it, and whether it's installed at all. */
  dockerProvider(): Promise<{ name: string; startable: boolean; installed: boolean; installUrl?: string }>;
  /** Launch the detected provider (OrbStack/Docker Desktop/colima/…). */
  startDocker(): Promise<void>;

  // ── Misc ───────────────────────────────────────────────────────────────
  openExternal(url: string): Promise<void>;
  copyText(text: string): Promise<void>;

  // ── App settings (settings.json) ───────────────────────────────────────
  getAppSettings(): Promise<AppSettings>;
  /** Persist one setting (applying side effects like login-item) → updated set. */
  setAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<AppSettings>;
  /** Installed app version (package.json version). */
  appVersion(): Promise<string>;

  // ── App updates (electron-updater) ─────────────────────────────────────
  /** Manually poll the update feed; staged downloads still surface via onUpdateDownloaded. */
  checkForUpdates(): Promise<UpdateCheckResult>;
  /** Quit, swap the staged binary, and relaunch into the new version. */
  quitAndInstall(): void;

  // ── Push events ────────────────────────────────────────────────────────
  onServicesChanged(cb: () => void): () => void;
  onStatusChanged(cb: (status: EngineStatus) => void): () => void;
  onPullProgress(cb: (event: PullEvent) => void): () => void;
  /** Fired once a newer version has downloaded and is ready to install. */
  onUpdateDownloaded(cb: (info: UpdateInfo) => void): () => void;
  /** Fired when the tray's "Settings…" item asks the renderer to open Settings. */
  onOpenSettings(cb: () => void): () => void;
}

/** IPC channel names — single source of truth for main + preload. */
export const CHANNELS = {
  listServices: 'envy:listServices',
  listImages: 'envy:listImages',
  getStatus: 'envy:getStatus',
  getDomains: 'envy:getDomains',
  runContainer: 'envy:runContainer',
  startContainer: 'envy:startContainer',
  stopContainer: 'envy:stopContainer',
  restartContainer: 'envy:restartContainer',
  removeContainer: 'envy:removeContainer',
  recreateContainer: 'envy:recreateContainer',
  pullImage: 'envy:pullImage',
  removeImage: 'envy:removeImage',
  inspectContainer: 'envy:inspectContainer',
  subscribeLogs: 'envy:subscribeLogs',
  unsubscribeLogs: 'envy:unsubscribeLogs',
  execStart: 'envy:execStart',
  execWrite: 'envy:execWrite',
  execResize: 'envy:execResize',
  execStop: 'envy:execStop',
  subscribeStats: 'envy:subscribeStats',
  unsubscribeStats: 'envy:unsubscribeStats',
  platform: 'envy:platform',
  setWindowTheme: 'envy:setWindowTheme',
  dockerProvider: 'envy:dockerProvider',
  startDocker: 'envy:startDocker',
  addDomain: 'envy:addDomain',
  removeDomain: 'envy:removeDomain',
  setPrimaryDomain: 'envy:setPrimaryDomain',
  setContainerDomains: 'envy:setContainerDomains',
  daemonStatus: 'envy:daemonStatus',
  daemonInstall: 'envy:daemonInstall',
  daemonUninstall: 'envy:daemonUninstall',
  openExternal: 'envy:openExternal',
  copyText: 'envy:copyText',
  getAppSettings: 'envy:getAppSettings',
  setAppSetting: 'envy:setAppSetting',
  appVersion: 'envy:appVersion',
  checkForUpdates: 'envy:checkForUpdates',
  quitAndInstall: 'envy:quitAndInstall',
  // Push events (main → renderer)
  evServicesChanged: 'envy:ev:servicesChanged',
  evStatusChanged: 'envy:ev:statusChanged',
  evPullProgress: 'envy:ev:pullProgress',
  evLog: 'envy:ev:log',
  evStats: 'envy:ev:stats',
  evExecData: 'envy:ev:execData',
  evExecExit: 'envy:ev:execExit',
  evUpdateDownloaded: 'envy:ev:updateDownloaded',
  evOpenSettings: 'envy:ev:openSettings',
} as const;
