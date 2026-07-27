import { signal } from '@melodicdev/core';
import type { ServiceView, ImageSummary, EngineStatus, DaemonStatus, AppSettings } from '../../ipc/contract.js';

export type View = 'services' | 'images' | 'domains' | 'activity' | 'settings';
export type Theme = 'dark' | 'light';
export type DrawerTab = 'logs' | 'shell';

/** Shared reactive state. Components import these signals directly and read
 *  them in their templates; ComponentBase auto-subscribes and re-renders. */
export const services = signal<ServiceView[]>([]);
export const images = signal<ImageSummary[]>([]);
export const status = signal<EngineStatus | null>(null);
export const daemon = signal<DaemonStatus | null>(null);
export const domains = signal<string[]>([]);
export const view = signal<View>('services');
export const loading = signal<boolean>(true);

/** Host platform — drives OS-specific window chrome (mac traffic lights, etc.). */
export const platform = signal<string>('darwin');

/** Detected Docker provider (OrbStack/Docker Desktop/…) for the offline "Start"/"Install" button. */
export const dockerProvider = signal<{ name: string; startable: boolean; installed: boolean; installUrl?: string } | null>(null);
export const startingDocker = signal<boolean>(false);

/** Theme — persisted to localStorage, applied via data-theme on the root. */
const STORAGE_THEME = 'envy:theme';
export const theme = signal<Theme>(
  (globalThis.localStorage?.getItem(STORAGE_THEME) as Theme) ?? 'dark',
);

/** Transient "Starting daemon…" pill state during install. */
export const daemonBusy = signal<boolean>(false);

/** Version string of a downloaded-and-staged app update, or null when none is
 *  pending. Set by the electron-updater `update-downloaded` push event; drives
 *  the header "Restart to update" pill. */
export const updateReady = signal<string | null>(null);

/** Persisted app settings (keep-running, start-at-login) for the Settings view. */
export const appSettings = signal<AppSettings>({ keepRunningInBackground: true, startAtLogin: false });
/** Installed app version, shown in Settings. */
export const appVersion = signal<string>('');
/** Transient state for the Settings "Check for Updates" button. */
export const updateChecking = signal<boolean>(false);
export const updateCheckMsg = signal<string>('');

/** Whether the "Run a container" dialog is open, + an optional prefilled image. */
export const runOpen = signal<boolean>(false);
export const runPrefillImage = signal<string>('');

/** Per-container in-flight flag so a card can show a spinner on its action. */
export const busy = signal<Record<string, 'start' | 'stop' | 'restart' | 'remove'>>({});
export function setBusy(id: string, value: 'start' | 'stop' | 'restart' | 'remove' | null): void {
  const next = { ...busy() };
  if (value) next[id] = value;
  else delete next[id];
  busy.set(next);
}

/** Inline two-step remove confirm, keyed by container id (card + drawer separate). */
export const removeConfirm = signal<Record<string, boolean>>({});
export function setRemoveConfirm(id: string, value: boolean): void {
  const next = { ...removeConfirm() };
  if (value) next[id] = true;
  else delete next[id];
  removeConfirm.set(next);
}

/** Collapsed Compose-project groups (keyed by project name), persisted. */
const STORAGE_GROUPS = 'envy:collapsedGroups';
function loadCollapsed(): Record<string, boolean> {
  try { return JSON.parse(globalThis.localStorage?.getItem(STORAGE_GROUPS) ?? '{}') as Record<string, boolean>; } catch { return {}; }
}
export const collapsedGroups = signal<Record<string, boolean>>(loadCollapsed());
export function toggleGroup(project: string): void {
  const next = { ...collapsedGroups() };
  next[project] = !next[project];
  collapsedGroups.set(next);
  try { globalThis.localStorage?.setItem(STORAGE_GROUPS, JSON.stringify(next)); } catch { /* ignore */ }
}

/** Inspect drawer: the container id being inspected (or null), its tab, and
 *  its own remove-confirm flag (independent of the card's). */
export const inspect = signal<string | null>(null);
export const drawerTab = signal<DrawerTab>('logs');
export const inspectConfirm = signal<boolean>(false);

/** Inspect drawer width (px) — resizable via the left edge, persisted. */
const STORAGE_DRAWER_W = 'envy:drawerWidth';
export const DRAWER_MIN_WIDTH = 380;
export const drawerWidth = signal<number>(
  Number(globalThis.localStorage?.getItem(STORAGE_DRAWER_W)) || 436,
);
export function setDrawerWidth(px: number): void {
  drawerWidth.set(px);
  try { globalThis.localStorage?.setItem(STORAGE_DRAWER_W, String(Math.round(px))); } catch { /* ignore */ }
}
