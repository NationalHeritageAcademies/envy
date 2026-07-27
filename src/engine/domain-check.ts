import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pre-flight validation for a domain the user wants Envy to own — run BEFORE
 * the domain is committed to config.json, so a name Envy can never actually
 * serve is rejected with one clear message instead of being provisioned into a
 * broken half-state (resolver missing, /etc/hosts overriding it, etc.).
 *
 * Born from a real incident: adding `mynhadev.com` on a machine whose
 * /etc/hosts carried ~100 `127.0.0.1 *.mynhadev.com` entries from an older
 * nginx-proxy setup. /etc/hosts outranks /etc/resolver, so Envy could never
 * own the name — but nothing said so, and the failed provisioning took every
 * working domain down with it.
 */
export interface DomainCheck {
  ok: boolean;
  /** Hard failure — the domain must not be added. */
  error?: string;
  /** Heads-up worth showing even when the add succeeds. */
  warning?: string;
}

/** Common real public TLDs. Deliberately short — it only needs to catch the
 *  suffixes a dev would plausibly shadow locally, not the full IANA list. */
const PUBLIC_TLDS = new Set([
  'com', 'net', 'org', 'io', 'dev', 'app', 'co', 'ai', 'me', 'info', 'biz',
  'us', 'uk', 'ca', 'de', 'eu', 'sh', 'gg', 'tv', 'cloud', 'online', 'site',
  'tech', 'xyz', 'edu', 'gov',
]);

const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Same normalization saveDomains applies, so we validate what will be stored. */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

function defaultHostsPath(): string {
  return process.platform === 'win32'
    ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
    : '/etc/hosts';
}

/** Hostnames in a hosts file that are `domain` or `*.domain` (non-comment lines). */
function hostsShadowing(domain: string, hostsPath: string): string[] {
  let text: string;
  try {
    text = readFileSync(hostsPath, 'utf8');
  } catch {
    return [];
  }
  const suffix = `.${domain}`;
  const hits: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    // "<address> <name> [<name>…]" — every field after the address is a hostname.
    for (const name of line.split(/\s+/).slice(1)) {
      const host = name.toLowerCase();
      if (host === domain || host.endsWith(suffix)) hits.push(host);
    }
  }
  return hits;
}

export interface DomainCheckOptions {
  /** Overridable for tests. */
  hostsPath?: string;
  resolverDir?: string;
}

/**
 * Validate a prospective domain against this machine's state. Hard errors are
 * things Envy cannot work around (shadowed by /etc/hosts, owned by another
 * tool); warnings are risky-but-workable (public TLD, mDNS `.local`).
 */
export function checkDomain(raw: string, existing: string[], opts: DomainCheckOptions = {}): DomainCheck {
  const domain = normalizeDomain(raw);
  if (!domain) return { ok: false, error: 'Enter a domain, e.g. "envy" or "dev.internal".' };
  if (!domain.split('.').every((label) => LABEL_RE.test(label))) {
    return { ok: false, error: `"${domain}" isn't a valid domain name (letters, digits, and hyphens only).` };
  }
  if (existing.includes(domain)) {
    return { ok: false, error: `*.${domain} is already configured.` };
  }

  // /etc/hosts outranks /etc/resolver, so Envy can never own a shadowed name.
  const shadows = hostsShadowing(domain, opts.hostsPath ?? defaultHostsPath());
  if (shadows.length > 0) {
    const example = shadows[0]!;
    return {
      ok: false,
      error:
        `Can't add ${domain}: ${shadows.length} /etc/hosts entr${shadows.length === 1 ? 'y' : 'ies'} ` +
        `(e.g. "${example}") shadow it and would override Envy. Remove them or pick another domain.`,
    };
  }

  // A resolver file we didn't write means another tool already routes this domain.
  if (process.platform === 'darwin' || opts.resolverDir) {
    const resolverPath = join(opts.resolverDir ?? '/etc/resolver', domain);
    try {
      if (existsSync(resolverPath) && !readFileSync(resolverPath, 'utf8').includes('Managed by Envy')) {
        return {
          ok: false,
          error: `Can't add ${domain}: another tool owns /etc/resolver/${domain}. Remove that file or pick another domain.`,
        };
      }
    } catch { /* unreadable resolver file — let provisioning overwrite it */ }
  }

  const tld = domain.split('.').pop()!;
  if (domain === 'local' || tld === 'local') {
    return {
      ok: true,
      warning: `.local is used by macOS Bonjour/mDNS — *.${domain} may resolve slowly or conflict. Consider .envy instead.`,
    };
  }
  if (PUBLIC_TLDS.has(tld)) {
    return {
      ok: true,
      warning: `${domain} ends in the real public TLD .${tld} — Envy will shadow those internet names on this machine.`,
    };
  }
  return { ok: true };
}
