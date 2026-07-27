import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkDomain } from './domain-check.js';

const dir = mkdtempSync(join(tmpdir(), 'envy-domain-check-'));
const resolverDir = join(dir, 'resolver');
mkdirSync(resolverDir);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A hosts file with the given extra lines (plus the standard header noise). */
function hostsFile(name: string, lines: string[]): string {
  const path = join(dir, name);
  writeFileSync(path, ['127.0.0.1 localhost', '# comment', '', ...lines].join('\n'));
  return path;
}

const emptyHosts = hostsFile('hosts-empty', []);
const opts = { hostsPath: emptyHosts, resolverDir };

describe('checkDomain', () => {
  it('accepts a clean vanity domain', () => {
    expect(checkDomain('envy2', [], opts)).toEqual({ ok: true });
  });

  it('normalizes before validating (trim, case, stray dots)', () => {
    expect(checkDomain('  .MyDomain. ', [], opts)).toEqual({ ok: true });
  });

  it('rejects empty and malformed names', () => {
    expect(checkDomain('   ', [], opts).ok).toBe(false);
    expect(checkDomain('bad_domain!', [], opts).ok).toBe(false);
    expect(checkDomain('-leading.hyphen', [], opts).ok).toBe(false);
  });

  it('rejects a duplicate of an already-configured domain', () => {
    const out = checkDomain('Envy', ['envy'], opts);
    expect(out.ok).toBe(false);
    expect(out.error).toContain('already configured');
  });

  it('rejects a domain shadowed by /etc/hosts entries', () => {
    // The real incident: ~100 `127.0.0.1 *.mynhadev.com` lines from an old
    // nginx-proxy setup meant Envy could never own the name.
    const hosts = hostsFile('hosts-shadowed', [
      '127.0.0.1 crm-api.mynhadev.com',
      '127.0.0.1 sis-api.mynhadev.com # legacy proxy',
    ]);
    const out = checkDomain('mynhadev.com', [], { hostsPath: hosts, resolverDir });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('/etc/hosts');
    expect(out.error).toContain('crm-api.mynhadev.com');
  });

  it('ignores hosts entries that merely contain the name as a substring', () => {
    const hosts = hostsFile('hosts-substring', ['127.0.0.1 notmynhadev.com', '127.0.0.1 mynhadev.company.io']);
    expect(checkDomain('mynhadev.com', [], { hostsPath: hosts, resolverDir }).ok).toBe(true);
  });

  it("rejects a domain owned by another tool's resolver file", () => {
    writeFileSync(join(resolverDir, 'nhatest.com'), 'nameserver 127.0.0.1\nport 5353\n');
    const out = checkDomain('nhatest.com', [], opts);
    expect(out.ok).toBe(false);
    expect(out.error).toContain('another tool');
  });

  it('allows re-adding a domain whose resolver file is Envy-managed', () => {
    writeFileSync(join(resolverDir, 'mine.internal'), '# Managed by Envy.\nnameserver 127.0.0.1\n');
    expect(checkDomain('mine.internal', [], opts).ok).toBe(true);
  });

  it('warns on real public TLDs but allows the add', () => {
    const out = checkDomain('mynhadev.com', [], opts);
    expect(out.ok).toBe(true);
    expect(out.warning).toContain('.com');
  });

  it('warns about mDNS on .local domains', () => {
    const out = checkDomain('nha.local', [], opts);
    expect(out.ok).toBe(true);
    expect(out.warning).toContain('mDNS');
  });
});
