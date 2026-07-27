// Lightweight persisted app preferences, stored as settings.json alongside the
// engine's config.json in the data dir. Kept separate from engine config so
// UI/app prefs don't tangle with DNS/proxy/domain state. This is the seed the
// future Settings window grows from; for now the tray toggles the values.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSettings } from '../ipc/contract.js';

export type { AppSettings };

const DEFAULTS: AppSettings = {
  keepRunningInBackground: true,
  startAtLogin: false,
};

let dir = '';
let current: AppSettings = { ...DEFAULTS };

function settingsPath(): string {
  return join(dir, 'settings.json');
}

/** Load settings from disk (merging over defaults). Call once at startup with
 *  the engine's data dir. Missing/corrupt file falls back to defaults. */
export function initSettings(dataDir: string): AppSettings {
  dir = dataDir;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings>;
    current = { ...DEFAULTS, ...parsed };
  } catch {
    current = { ...DEFAULTS };
  }
  return current;
}

export function getSettings(): AppSettings {
  return current;
}

/** Persist a single setting and return the updated set. Best-effort write. */
export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): AppSettings {
  current = { ...current, [key]: value };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify(current, null, 2));
  } catch {
    /* non-fatal — settings just won't persist across restarts */
  }
  return current;
}
