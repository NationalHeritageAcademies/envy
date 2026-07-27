import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Central configuration for the Envy engine.
 *
 * The list of domains Envy owns is configurable and supports more than one at
 * a time — e.g. a personal `envy.local` and a company-wide `melodic.local`.
 * Every running container is reachable on `<name>.<domain>` for *each*
 * configured domain. Settings persist in `config.json` in the data dir;
 * environment variables override the file (useful for dev / CI).
 *
 * OrbStack-safety note: Envy only ever owns its configured domains. It never
 * touches `orb.local` or OrbStack's resolver.
 */
export interface EngineConfig {
  /** Suffixes Envy owns. First entry is the "primary" (used for display). */
  readonly domains: string[];
  /** Per-container domain restriction, keyed by container name. Absent =
   *  reachable on all domains. Lets users scope a container to a subset. */
  readonly assignments: Record<string, string[]>;
  /** Reverse-proxy plaintext port. 80 in prod (browsers assume it). */
  readonly httpPort: number;
  /** Reverse-proxy TLS port. 443 in prod. */
  readonly httpsPort: number;
  /** Local DNS server port. The resolver files point here, so it can stay high. */
  readonly dnsPort: number;
  /** Address the proxy + DNS bind to. Loopback only — never exposed off-box. */
  readonly bindAddress: string;
  /** The IP that `*.<domain>` resolves to (where the proxy listens). */
  readonly resolveTo: string;
  /** Where we persist the local CA, generated certs, and config.json. */
  readonly dataDir: string;
}

/** Shape of the persisted config.json (only user-tunable settings live here). */
interface PersistedConfig {
  domains?: string[];
  assignments?: Record<string, string[]>;
}

// A short vanity TLD (e.g. `web.envy`) rather than a reserved suffix like
// `.test`. It is not RFC-reserved, but Envy runs its own trusted CA so HTTPS is
// unaffected, and on macOS it avoids the `.local`/mDNS collision entirely.
const DEFAULT_DOMAIN = 'envy';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalize, lower-case, and de-duplicate a list of domain suffixes. */
export function normalizeDomains(domains: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of domains) {
    const clean = d.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out.length ? out : [DEFAULT_DOMAIN];
}

/** Home dir of the *real* user, even when launched via `sudo` — so the CA and
 *  config land in the user's dir (where the setup script + GUI look), not
 *  root's. Falls back to the current user's home when not running under sudo. */
function realHome(): string {
  const sudoUser = process.env['SUDO_USER'];
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot && sudoUser && sudoUser !== 'root') {
    return platform() === 'darwin' ? `/Users/${sudoUser}` : `/home/${sudoUser}`;
  }
  return homedir();
}

/** Per-OS application data directory. */
export function defaultDataDir(): string {
  const home = realHome();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Envy');
    case 'win32':
      return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'Envy');
    default:
      return join(process.env['XDG_DATA_HOME'] ?? join(home, '.local', 'share'), 'envy');
  }
}

function configPath(dataDir: string): string {
  return join(dataDir, 'config.json');
}

function readPersisted(dataDir: string): PersistedConfig {
  const path = configPath(dataDir);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PersistedConfig;
  } catch {
    return {};
  }
}

export function loadConfig(): EngineConfig {
  const dataDir = process.env['ENVY_DATA_DIR'] ?? defaultDataDir();
  const persisted = readPersisted(dataDir);

  // Precedence for domains: ENVY_DOMAINS (comma) > legacy ENVY_TLD > file > default.
  let domains: string[];
  if (process.env['ENVY_DOMAINS']) {
    domains = process.env['ENVY_DOMAINS'].split(',');
  } else if (process.env['ENVY_TLD']) {
    domains = [process.env['ENVY_TLD']];
  } else if (persisted.domains?.length) {
    domains = persisted.domains;
  } else {
    domains = [DEFAULT_DOMAIN];
  }

  return {
    domains: normalizeDomains(domains),
    assignments: persisted.assignments ?? {},
    httpPort: envInt('ENVY_HTTP_PORT', 80),
    httpsPort: envInt('ENVY_HTTPS_PORT', 443),
    dnsPort: envInt('ENVY_DNS_PORT', 15353),
    bindAddress: process.env['ENVY_BIND'] ?? '127.0.0.1',
    resolveTo: process.env['ENVY_RESOLVE_TO'] ?? '127.0.0.1',
    dataDir,
  };
}

/** Persist the configured domains to config.json (creating the data dir). */
export function saveDomains(dataDir: string, domains: string[]): string[] {
  const normalized = normalizeDomains(domains);
  mkdirSync(dataDir, { recursive: true });
  const existing = readPersisted(dataDir);
  writeFileSync(configPath(dataDir), JSON.stringify({ ...existing, domains: normalized }, null, 2));
  return normalized;
}

/** Set (or clear) a container's domain restriction. Passing null/all → cleared
 *  (container reverts to being reachable on every domain). */
export function saveAssignment(dataDir: string, name: string, domains: string[] | null): void {
  mkdirSync(dataDir, { recursive: true });
  const existing = readPersisted(dataDir);
  const assignments = { ...(existing.assignments ?? {}) };
  const primary = normalizeDomains(existing.domains ?? [])[0];
  const next = domains ? normalizeDomains(domains) : [];
  // Default (no assignment) means "primary only", so clear the entry when the
  // selection is empty or exactly the primary; otherwise persist the explicit set.
  if (next.length === 0 || (next.length === 1 && next[0] === primary)) {
    delete assignments[name];
  } else {
    assignments[name] = next;
  }
  writeFileSync(configPath(dataDir), JSON.stringify({ ...existing, assignments }, null, 2));
}
