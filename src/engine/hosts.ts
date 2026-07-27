import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';

/**
 * Hosts-file management for the platforms whose native DNS path browsers don't
 * (reliably) honor — **Windows and Linux**. macOS uses `/etc/resolver` instead
 * (browsers honor it), so this is a no-op there.
 *
 * - Windows: NRPT routes `*.<domain>` to our DNS server, but Chrome/Edge's
 *   built-in resolver bypasses NRPT (it queries the configured upstream servers
 *   directly). The hosts file is honored by both `getaddrinfo` and Chromium's
 *   resolver, so it's the browser-reliable shim (NRPT stays for the wildcard).
 * - Linux: there is no `/etc/resolver` mechanism, and the systemd-resolved /
 *   dnsmasq landscape is fragmented; `/etc/hosts` works on every distro.
 *
 * The catch is the same both places: hosts has no wildcards, so we materialize
 * the concrete names from the live route table. We only ever touch our own
 * delimited block; everything else in the file is preserved byte-for-byte.
 */
const BEGIN = '# BEGIN ENVY - managed block, do not edit';
const END = '# END ENVY';

function hostsPath(): string {
  if (platform() === 'win32') {
    const root = process.env['SystemRoot'] ?? process.env['windir'] ?? 'C:\\Windows';
    return join(root, 'System32', 'drivers', 'etc', 'hosts');
  }
  return '/etc/hosts';
}

/** Join lines, dropping trailing blanks so rewrites don't accumulate them. */
function trimJoin(lines: string[], eol: string): string {
  const out = lines.slice();
  while (out.length && out[out.length - 1]!.trim() === '') out.pop();
  return out.join(eol);
}

/** Return the file's user content with a *well-formed* Envy block removed.
 *  CRITICAL SAFETY RULE: if a BEGIN marker has no matching END (a malformed or
 *  half-written block), we do NOT drop the rest of the file — we leave every
 *  line intact. The old "set a flag at BEGIN and skip until END" approach would,
 *  on a missing END, swallow everything after BEGIN to end-of-file; since our
 *  block is always appended last, a truncated write could thereby erase the
 *  whole file on the next sync. Index-based removal can't do that. */
function stripBlock(text: string, eol: string): string {
  const lines = text.split(/\r?\n/);
  const begin = lines.findIndex((l) => l.trim() === BEGIN);
  if (begin === -1) return trimJoin(lines, eol); // no block — keep everything
  let end = -1;
  for (let i = begin + 1; i < lines.length; i++) {
    if (lines[i]!.trim() === END) { end = i; break; }
  }
  if (end === -1) return trimJoin(lines, eol); // malformed — DON'T eat the rest
  return trimJoin([...lines.slice(0, begin), ...lines.slice(end + 1)], eol);
}

/** Non-empty lines that live OUTSIDE a well-formed Envy block — i.e. content we
 *  must never destroy. Used as a write-time invariant check. */
function foreignLines(text: string): string[] {
  return stripBlock(text, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Pure core: compute the new hosts-file text given the existing text and the
 * desired managed hostnames. Idempotent — feeding its own output back in is a
 * fixed point — so callers can write only when the result actually changes.
 * Exported for testing.
 */
export function applyEnvyBlock(original: string, hostnames: string[], resolveTo: string): string {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const base = stripBlock(original, eol);
  const names = [...new Set(hostnames.map((h) => h.trim().toLowerCase()).filter(Boolean))].sort();
  if (names.length === 0) return base.length ? base + eol : '';
  const block = [BEGIN, ...names.map((h) => `${resolveTo} ${h}`), END].join(eol);
  return (base.length ? base + eol + eol : '') + block + eol;
}

/** One-time snapshot of the user's hosts file before Envy ever modifies it, so a
 *  bad write is always recoverable from `<hosts>.envy-backup`. Best-effort. */
function backupOnce(path: string, original: string): void {
  const backup = `${path}.envy-backup`;
  try { if (!existsSync(backup)) writeFileSync(backup, original); } catch { /* ignore */ }
}

/** Write atomically: fill a temp file, then rename it over the target. A reader
 *  (or a second writer) therefore never observes a half-written/truncated hosts
 *  file — it sees either the old contents or the new, never empty. */
function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.envy-tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/** Sync the Envy block to exactly `hostnames` (Windows + Linux, best-effort).
 *  Needs admin/root — the engine that calls this runs elevated to bind 53/80/443. */
export function syncHosts(hostnames: string[], resolveTo: string): void {
  // macOS resolves natively via /etc/resolver; only Windows + Linux need this.
  if (platform() !== 'win32' && platform() !== 'linux') return;
  try {
    const path = hostsPath();
    if (!existsSync(path)) return; // never fabricate a hosts file from nothing
    const original = readFileSync(path, 'utf8');
    const next = applyEnvyBlock(original, hostnames, resolveTo);
    if (next === original) return; // nothing changed — don't churn the file

    // Refuse any write that would destroy user content. These guards make a
    // full wipe structurally impossible regardless of races or odd input:
    //  1. never blank a file that wasn't already blank;
    //  2. never drop a line that lives outside our managed block.
    if (original.trim() !== '' && next.trim() === '') return;
    const survivors = new Set(foreignLines(next));
    if (!foreignLines(original).every((l) => survivors.has(l))) return;

    backupOnce(path, original);
    writeAtomic(path, next);
  } catch {
    /* not elevated / file locked — never let hosts I/O break discovery */
  }
}

/** Remove the Envy block entirely (engine shutdown / teardown). */
export function clearHosts(): void {
  syncHosts([], '');
}
