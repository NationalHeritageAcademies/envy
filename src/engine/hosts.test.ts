import { describe, it, expect } from 'vitest';
import { applyEnvyBlock } from './hosts.js';

const USER = ['127.0.0.1 localhost', '::1 localhost', '10.0.0.5 nas.lan'].join('\n');

describe('applyEnvyBlock', () => {
  it('appends a managed block without touching user content', () => {
    const out = applyEnvyBlock(USER + '\n', ['web.envy', 'api.envy'], '127.0.0.1');
    expect(out).toContain('127.0.0.1 localhost');
    expect(out).toContain('10.0.0.5 nas.lan');
    expect(out).toContain('# BEGIN ENVY - managed block, do not edit');
    expect(out).toContain('127.0.0.1 api.envy');
    expect(out).toContain('127.0.0.1 web.envy');
    expect(out).toContain('# END ENVY');
  });

  it('is idempotent — feeding its own output back is a fixed point', () => {
    const once = applyEnvyBlock(USER + '\n', ['web.envy', 'api.envy'], '127.0.0.1');
    const twice = applyEnvyBlock(once, ['web.envy', 'api.envy'], '127.0.0.1');
    expect(twice).toBe(once);
  });

  it('replaces a stale block rather than stacking a second one', () => {
    const first = applyEnvyBlock(USER + '\n', ['old.envy'], '127.0.0.1');
    const second = applyEnvyBlock(first, ['new.envy'], '127.0.0.1');
    expect(second).toContain('127.0.0.1 new.envy');
    expect(second).not.toContain('old.envy');
    expect(second.match(/# BEGIN ENVY/g)).toHaveLength(1);
  });

  it('removes the block entirely when given no hostnames', () => {
    const withBlock = applyEnvyBlock(USER + '\n', ['web.envy'], '127.0.0.1');
    const cleared = applyEnvyBlock(withBlock, [], '');
    expect(cleared).not.toContain('# BEGIN ENVY');
    expect(cleared).toContain('127.0.0.1 localhost');
    expect(cleared).toContain('10.0.0.5 nas.lan');
  });

  it('de-duplicates and sorts hostnames for stable output', () => {
    const out = applyEnvyBlock('', ['b.envy', 'a.envy', 'B.envy'], '127.0.0.1');
    const names = out.split('\n').filter((l) => l.includes('.envy'));
    expect(names).toEqual(['127.0.0.1 a.envy', '127.0.0.1 b.envy']);
  });

  it('never eats the file when a BEGIN marker has no matching END', () => {
    // A truncated/half-written block (BEGIN, host line, but no END). The old
    // flag-based stripper would swallow everything after BEGIN to EOF; here the
    // user content above it MUST survive.
    const malformed = [USER, '# BEGIN ENVY - managed block, do not edit', '127.0.0.1 web.envy'].join('\n');
    const out = applyEnvyBlock(malformed, ['api.envy'], '127.0.0.1');
    expect(out).toContain('127.0.0.1 localhost');
    expect(out).toContain('10.0.0.5 nas.lan');
  });

  it('clearing keeps all user content even with a trailing managed block', () => {
    const withBlock = applyEnvyBlock(USER + '\n', ['web.envy', 'api.envy'], '127.0.0.1');
    const cleared = applyEnvyBlock(withBlock, [], '');
    // Every original user line is intact; nothing but our block was removed.
    for (const line of ['127.0.0.1 localhost', '::1 localhost', '10.0.0.5 nas.lan']) {
      expect(cleared).toContain(line);
    }
    expect(cleared).not.toContain('# BEGIN ENVY');
  });

  it('preserves CRLF line endings on Windows-style files', () => {
    const crlf = USER.replace(/\n/g, '\r\n') + '\r\n';
    const out = applyEnvyBlock(crlf, ['web.envy'], '127.0.0.1');
    expect(out).toContain('\r\n');
    expect(out).not.toMatch(/[^\r]\n/); // no bare LF
  });
});
