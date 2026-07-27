import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { CertStore } from './tls.js';
import type { EngineConfig } from './config.js';

const { pki } = forge;

function configIn(dir: string): EngineConfig {
  return {
    domains: ['envy'],
    assignments: {},
    httpPort: 80,
    httpsPort: 443,
    dnsPort: 15353,
    bindAddress: '127.0.0.1',
    resolveTo: '127.0.0.1',
    dataDir: dir,
  };
}

/** Pull the DNS SAN values out of a leaf PEM. */
function sanOf(certPem: string): string[] {
  const cert = pki.certificateFromPem(certPem);
  // node-forge types getExtension() as {} — the SAN shape is documented but untyped.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- removing this breaks tsc (property access on {})
  const ext = cert.getExtension('subjectAltName') as { altNames?: { type: number; value: string }[] } | undefined;
  return (ext?.altNames ?? []).filter((a) => a.type === 2).map((a) => a.value);
}

describe('CertStore.leafFor', () => {
  let dir: string;
  let store: CertStore;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'envy-tls-'));
    store = new CertStore(configIn(dir));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('mints a cert whose SAN is the exact requested host (single-label parent)', () => {
    const { cert } = store.leafFor('web.envy');
    // First PEM block in the chain is the leaf.
    expect(sanOf(cert)).toEqual(['web.envy']);
  });

  it('handles arbitrary custom hostnames, not just one domain', () => {
    expect(sanOf(store.leafFor('dash.acme.test').cert)).toEqual(['dash.acme.test']);
    expect(sanOf(store.leafFor('api.envy').cert)).toEqual(['api.envy']);
  });

  it('signs every leaf with the same CA so one trusted root covers all', () => {
    const ca = pki.certificateFromPem(store.leafFor('web.envy').cert.split('-----END CERTIFICATE-----')[1]! + '-----END CERTIFICATE-----');
    const leaf = pki.certificateFromPem(store.leafFor('other.envy').cert);
    expect(ca.verify(leaf)).toBe(true); // CA's public key validates the leaf signature
  });

  it('returns a cached, identical cert for the same host', () => {
    expect(store.leafFor('web.envy').cert).toBe(store.leafFor('WEB.envy').cert);
  });

  it('gives distinct hosts distinct serial numbers', () => {
    const a = pki.certificateFromPem(store.leafFor('a.envy').cert).serialNumber;
    const b = pki.certificateFromPem(store.leafFor('b.envy').cert).serialNumber;
    expect(a).not.toBe(b);
  });
});
