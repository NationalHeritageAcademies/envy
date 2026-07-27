import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { CHANNELS } from '../ipc/contract.js';
import type { EnvyApi, EngineStatus, PullEvent, LogLine, StatSample, ExecChunk, UpdateInfo } from '../ipc/contract.js';

/** Subscribe to a main→renderer channel; returns an unsubscribe function. */
function subscribe(channel: string, handler: (...args: unknown[]) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => handler(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const api: EnvyApi = {
  listServices: () => ipcRenderer.invoke(CHANNELS.listServices),
  listImages: () => ipcRenderer.invoke(CHANNELS.listImages),
  getStatus: () => ipcRenderer.invoke(CHANNELS.getStatus),
  getDomains: () => ipcRenderer.invoke(CHANNELS.getDomains),

  runContainer: (opts) => ipcRenderer.invoke(CHANNELS.runContainer, opts),
  startContainer: (id) => ipcRenderer.invoke(CHANNELS.startContainer, id),
  stopContainer: (id) => ipcRenderer.invoke(CHANNELS.stopContainer, id),
  restartContainer: (id) => ipcRenderer.invoke(CHANNELS.restartContainer, id),
  removeContainer: (id) => ipcRenderer.invoke(CHANNELS.removeContainer, id),
  recreateContainer: (id) => ipcRenderer.invoke(CHANNELS.recreateContainer, id),

  pullImage: (image) => ipcRenderer.invoke(CHANNELS.pullImage, image),
  removeImage: (id) => ipcRenderer.invoke(CHANNELS.removeImage, id),

  inspectContainer: (id) => ipcRenderer.invoke(CHANNELS.inspectContainer, id),
  subscribeLogs: (id, cb) => {
    const listener = (_e: IpcRendererEvent, line: LogLine): void => {
      if (line.id === id) cb(line);
    };
    ipcRenderer.on(CHANNELS.evLog, listener);
    void ipcRenderer.invoke(CHANNELS.subscribeLogs, id);
    return () => {
      ipcRenderer.off(CHANNELS.evLog, listener);
      ipcRenderer.send(CHANNELS.unsubscribeLogs, id);
    };
  },
  execStart: (id, opts) => ipcRenderer.invoke(CHANNELS.execStart, id, opts),
  execWrite: (sessionId, data) => ipcRenderer.send(CHANNELS.execWrite, sessionId, data),
  execResize: (sessionId, size) => ipcRenderer.send(CHANNELS.execResize, sessionId, size),
  execStop: (sessionId) => ipcRenderer.send(CHANNELS.execStop, sessionId),
  onExecData: (cb) => subscribe(CHANNELS.evExecData, (chunk) => cb(chunk as ExecChunk)),
  onExecExit: (cb) => subscribe(CHANNELS.evExecExit, (sessionId) => cb(sessionId as string)),

  subscribeStats: (cb) => {
    const listener = (_e: IpcRendererEvent, samples: StatSample[]): void => cb(samples);
    ipcRenderer.on(CHANNELS.evStats, listener);
    void ipcRenderer.invoke(CHANNELS.subscribeStats);
    return () => {
      ipcRenderer.off(CHANNELS.evStats, listener);
      ipcRenderer.send(CHANNELS.unsubscribeStats);
    };
  },
  platform: () => ipcRenderer.invoke(CHANNELS.platform),
  setWindowTheme: (theme) => ipcRenderer.send(CHANNELS.setWindowTheme, theme),
  dockerProvider: () => ipcRenderer.invoke(CHANNELS.dockerProvider),
  startDocker: () => ipcRenderer.invoke(CHANNELS.startDocker),

  addDomain: (domain) => ipcRenderer.invoke(CHANNELS.addDomain, domain),
  removeDomain: (domain) => ipcRenderer.invoke(CHANNELS.removeDomain, domain),
  setPrimaryDomain: (domain) => ipcRenderer.invoke(CHANNELS.setPrimaryDomain, domain),
  setContainerDomains: (name, domains) => ipcRenderer.invoke(CHANNELS.setContainerDomains, name, domains),

  daemonStatus: () => ipcRenderer.invoke(CHANNELS.daemonStatus),
  daemonInstall: () => ipcRenderer.invoke(CHANNELS.daemonInstall),
  daemonUninstall: () => ipcRenderer.invoke(CHANNELS.daemonUninstall),

  openExternal: (url) => ipcRenderer.invoke(CHANNELS.openExternal, url),
  copyText: (text) => ipcRenderer.invoke(CHANNELS.copyText, text),

  getAppSettings: () => ipcRenderer.invoke(CHANNELS.getAppSettings),
  setAppSetting: (key, value) => ipcRenderer.invoke(CHANNELS.setAppSetting, key, value),
  appVersion: () => ipcRenderer.invoke(CHANNELS.appVersion),

  checkForUpdates: () => ipcRenderer.invoke(CHANNELS.checkForUpdates),
  quitAndInstall: () => ipcRenderer.send(CHANNELS.quitAndInstall),

  onServicesChanged: (cb) => subscribe(CHANNELS.evServicesChanged, () => cb()),
  onStatusChanged: (cb) =>
    subscribe(CHANNELS.evStatusChanged, (status) => cb(status as EngineStatus)),
  onPullProgress: (cb) => subscribe(CHANNELS.evPullProgress, (e) => cb(e as PullEvent)),
  onUpdateDownloaded: (cb) =>
    subscribe(CHANNELS.evUpdateDownloaded, (info) => cb(info as UpdateInfo)),
  onOpenSettings: (cb) => subscribe(CHANNELS.evOpenSettings, () => cb()),
};

contextBridge.exposeInMainWorld('envy', api);
