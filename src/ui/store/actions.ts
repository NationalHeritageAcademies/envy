import { applyTheme } from '@melodicdev/components/theme';
import {
  services, images, status, daemon, domains, loading, theme, daemonBusy, platform,
  dockerProvider, startingDocker, updateReady,
  setBusy, setRemoveConfirm, inspect, inspectConfirm, drawerTab, runOpen, runPrefillImage,
  view, appSettings, appVersion, updateChecking, updateCheckMsg,
} from './state.js';
import type { Theme } from './state.js';
import type { AppSettings } from '../../ipc/contract.js';
import { showToast } from '../components/toast.js';

const api = (): Window['envy'] => window.envy;

export async function reloadServices(): Promise<void> { services.set(await api().listServices()); }
export async function reloadImages(): Promise<void> { images.set(await api().listImages()); }
export async function reloadStatus(): Promise<void> { status.set(await api().getStatus()); }
export async function reloadDomains(): Promise<void> { domains.set(await api().getDomains()); }
export async function reloadDaemon(): Promise<void> { daemon.set(await api().daemonStatus()); }

/** Apply + persist the theme (sets data-theme on the root via Melodic). */
export function setTheme(next: Theme): void {
  theme.set(next);
  applyTheme(next);
  try { globalThis.localStorage?.setItem('envy:theme', next); } catch { /* ignore */ }
  // Recolor the Windows title-bar overlay to match (no-op off Windows).
  try { api().setWindowTheme(next); } catch { /* ignore */ }
}
export function toggleTheme(): void {
  setTheme(theme() === 'dark' ? 'light' : 'dark');
}

/** Initial load + live-update wiring. */
export async function bootstrap(): Promise<void> {
  setTheme(theme());
  try { platform.set(await api().platform()); } catch { /* default darwin */ }
  try { dockerProvider.set(await api().dockerProvider()); } catch { /* ignore */ }
  loading.set(true);
  // allSettled, not all: when Docker is offline the container/image queries
  // reject, and we must still clear the loading state (otherwise the skeleton
  // shimmers forever instead of showing the offline message).
  await Promise.allSettled([reloadStatus(), reloadServices(), reloadImages(), reloadDomains(), reloadDaemon()]);
  loading.set(false);

  api().onServicesChanged(() => void reloadServices());
  api().onStatusChanged((s) => {
    // Docker just came (back) up — the bootstrap queries may have run against a
    // dead engine, so re-fetch the lists that only load on demand.
    const reconnected = s.dockerConnected && !status()?.dockerConnected;
    status.set(s);
    if (s.dockerConnected) startingDocker.set(false);
    if (reconnected) void Promise.allSettled([reloadServices(), reloadImages(), reloadDomains()]);
  });
  api().onPullProgress((e) => {
    if (e.done) showToast(e.error ? `Pull failed: ${e.error}` : `Pulled ${e.image}`, e.error ? 'error' : 'success');
  });
  // A newer Envy version has been downloaded in the background — surface the
  // "Restart to update" pill in the header.
  api().onUpdateDownloaded((info) => {
    updateReady.set(info.version);
    showToast(`Envy ${info.version} is ready — restart to update.`, 'info');
  });
  // The tray's "Settings…" item asks the renderer to open the Settings view.
  api().onOpenSettings(() => view.set('settings'));

  // App settings + version for the Settings view (non-blocking).
  void loadAppSettings();
  api().appVersion().then((v) => appVersion.set(v)).catch(() => { /* ignore */ });

  // Daemon health is a live probe (launchctl + a TCP connect to the proxy
  // port), not a pushed event — re-poll so the header pill catches a proxy
  // that died mid-session instead of showing "URLs live" forever.
  setInterval(() => void reloadDaemon(), 15_000);
}

/** Settings: load persisted prefs, and persist a single change. */
export async function loadAppSettings(): Promise<void> {
  try { appSettings.set(await api().getAppSettings()); } catch { /* keep defaults */ }
}
export async function setAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  try {
    appSettings.set(await api().setAppSetting(key, value));
  } catch (err) {
    showToast(`Couldn't save setting: ${(err as Error).message}`, 'error');
  }
}

/** Settings: manual "Check for Updates" with inline status feedback. */
export async function checkForUpdates(): Promise<void> {
  updateChecking.set(true);
  updateCheckMsg.set('');
  try {
    const r = await api().checkForUpdates();
    switch (r.status) {
      case 'available': updateCheckMsg.set(`Downloading v${r.version}…`); break;
      case 'current': updateCheckMsg.set("You're on the latest version."); break;
      case 'dev': updateCheckMsg.set('Updates are disabled in development.'); break;
      case 'error': updateCheckMsg.set(`Check failed: ${r.error ?? 'unknown error'}`); break;
    }
  } finally {
    updateChecking.set(false);
  }
}

/** Quit + relaunch into the staged update (electron-updater quitAndInstall). */
export function restartForUpdate(): void {
  api().quitAndInstall();
}

async function withBusy(id: string, kind: 'start' | 'stop' | 'restart' | 'remove', fn: () => Promise<void>): Promise<void> {
  setBusy(id, kind);
  try {
    await fn();
    await reloadServices();
  } catch (err) {
    showToast(`${kind} failed: ${(err as Error).message}`, 'error');
  } finally {
    setBusy(id, null);
  }
}

export const startService = (id: string): Promise<void> => withBusy(id, 'start', () => api().startContainer(id));
export const stopService = (id: string): Promise<void> => withBusy(id, 'stop', () => api().stopContainer(id));
export const restartService = (id: string): Promise<void> => withBusy(id, 'restart', () => api().restartContainer(id));

/** Two-step remove: first click arms the confirm; confirm runs it. */
export const armRemove = (id: string): void => setRemoveConfirm(id, true);
export const cancelRemove = (id: string): void => setRemoveConfirm(id, false);
export async function confirmRemove(id: string): Promise<void> {
  setRemoveConfirm(id, false);
  if (inspect() === id) closeInspect();
  await withBusy(id, 'remove', () => api().removeContainer(id));
  showToast('Container removed', 'success');
}

export async function runContainer(opts: import('../../ipc/contract.js').RunOptions): Promise<void> {
  showToast(`Starting ${opts.image}…`, 'info');
  try {
    await api().runContainer(opts);
    await reloadServices();
    showToast(`Running ${opts.name || opts.image}`, 'success');
  } catch (err) {
    showToast(`Run failed: ${(err as Error).message}`, 'error');
    throw err;
  }
}

/** Launch the detected Docker provider; the reconnect poll connects when it's up. */
export async function startDocker(): Promise<void> {
  startingDocker.set(true);
  showToast(`Starting ${dockerProvider()?.name ?? 'Docker'}…`, 'info');
  try {
    await api().startDocker();
  } catch (err) {
    showToast(`Couldn't start: ${(err as Error).message}`, 'error');
    startingDocker.set(false);
  }
  // Leave the spinner until the next status update flips dockerConnected true.
}

/** Open the Run dialog, optionally prefilled with an image reference. */
export function openRun(image = ''): void {
  runPrefillImage.set(image);
  runOpen.set(true);
}

export async function pullImage(image: string): Promise<void> {
  showToast(`Pulling ${image}…`, 'info');
  try { await api().pullImage(image); await reloadImages(); } catch { /* surfaced via onPullProgress */ }
}
/** Re-pull an image's tag to fetch the latest build. */
export async function updateImage(tag: string): Promise<void> {
  showToast(`Updating ${tag}…`, 'info');
  try { await api().pullImage(tag); await reloadImages(); showToast(`${tag} is up to date`, 'success'); }
  catch (err) { showToast(`Update failed: ${(err as Error).message}`, 'error'); }
}

/** Pull the latest of a container's image + recreate it on the new image. */
export async function recreateContainer(id: string): Promise<void> {
  setBusy(id, 'restart');
  showToast('Updating to latest image…', 'info');
  try {
    await api().recreateContainer(id);
    await reloadServices();
    showToast('Updated to latest image', 'success');
  } catch (err) {
    showToast(`Update failed: ${(err as Error).message}`, 'error');
  } finally {
    setBusy(id, null);
  }
}

export async function removeImage(id: string): Promise<void> {
  try { await api().removeImage(id); await reloadImages(); showToast('Image removed', 'success'); }
  catch (err) { showToast(`Remove failed: ${(err as Error).message}`, 'error'); }
}

/** Strip Electron's "Error invoking remote method 'x':" wrapper so validation
 *  messages from the main process read cleanly in a toast. */
function ipcErrorMessage(err: unknown): string {
  return (err as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

export async function addDomain(domain: string): Promise<void> {
  try {
    const result = await api().addDomain(domain);
    domains.set(result.domains);
    await Promise.all([reloadServices(), reloadStatus()]);
    showToast(`Added *.${domain}`, 'success');
    if (result.warning) showToast(result.warning, 'info');
  } catch (err) { showToast(ipcErrorMessage(err), 'error'); }
}
export async function removeDomain(domain: string): Promise<void> {
  domains.set(await api().removeDomain(domain));
  await Promise.all([reloadServices(), reloadStatus()]);
  showToast(`Removed *.${domain}`, 'info');
}
export async function setPrimaryDomain(domain: string): Promise<void> {
  domains.set(await api().setPrimaryDomain(domain));
  await Promise.all([reloadServices(), reloadStatus()]);
  showToast(`*.${domain} is now primary`, 'success');
}

export async function setContainerDomains(name: string, domains: string[]): Promise<void> {
  await api().setContainerDomains(name, domains);
  await reloadServices();
}

export const openUrl = (url: string): Promise<void> => api().openExternal(url);
export async function copy(text: string): Promise<void> { await api().copyText(text); showToast('Copied', 'success'); }

/** Enable the daemon — shows the transient "Starting daemon…" pill state. */
export async function enableDaemon(): Promise<void> {
  daemonBusy.set(true);
  try {
    daemon.set(await api().daemonInstall());
    await Promise.all([reloadServices(), reloadStatus()]);
    if (daemon()?.running) showToast('Envy is live — your URLs are now served.', 'success');
    // The proxy can lag the install by a beat — re-probe soon so the pill
    // flips to "URLs live" without waiting for the 15s poll.
    setTimeout(() => void reloadDaemon(), 3000);
  } catch (err) {
    showToast(`Could not enable: ${(err as Error).message}`, 'error');
  } finally {
    daemonBusy.set(false);
  }
}
export async function disableDaemon(): Promise<void> {
  try { daemon.set(await api().daemonUninstall()); showToast('Envy daemon removed.', 'info'); }
  catch (err) { showToast(`Could not disable: ${(err as Error).message}`, 'error'); }
}

/** Inspect drawer controls. */
export function openInspect(id: string): void { inspect.set(id); drawerTab.set('logs'); inspectConfirm.set(false); }
export function closeInspect(): void { inspect.set(null); inspectConfirm.set(false); }
