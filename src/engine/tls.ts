import forge from 'node-forge';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { EngineConfig } from './config.js';

const { pki } = forge;

export interface ServerCredentials {
  /** PEM private key for the leaf cert. */
  key: string;
  /** PEM leaf cert followed by the CA cert (full chain). */
  cert: string;
}

/** A source of per-hostname leaf certificates — what the proxy's SNI callback
 *  needs, without depending on the whole {@link CertStore}. */
export interface CertProvider {
  leafFor(host: string): ServerCredentials;
}

const CA_SUBJECT = [{ name: 'commonName', value: 'Envy Local CA' }, { name: 'organizationName', value: 'Envy' }];

function tenYears(): { notBefore: Date; notAfter: Date } {
  const notBefore = new Date();
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 10);
  return { notBefore, notAfter };
}

/** A stable, positive serial for a hostname. Two certs from the same CA must
 *  never share a serial, so derive it deterministically from the host (a given
 *  name always gets the same serial). The leading `00` keeps the high bit clear
 *  so it's encoded as a positive integer. */
function serialFor(host: string): string {
  return '00' + createHash('sha256').update(host).digest('hex').slice(0, 30);
}

/**
 * Manages a per-machine local Certificate Authority and mints a leaf
 * certificate per *exact* hostname on demand (cached in memory). The CA is
 * generated once and cached; the setup script / daemon trusts it in the system
 * keychain so browsers show a green lock for every Envy URL.
 *
 * Per-host certs (rather than one `*.<domain>` wildcard) are what lets Envy
 * serve ANY hostname a user invents — single-label domains like `web.envy`
 * (which browsers reject as a wildcard) and fully custom names like
 * `dash.acme.test` alike. Exact SANs always validate; wildcards don't.
 */
export class CertStore implements CertProvider {
  private readonly caDir: string;
  private readonly caCertPath: string;
  private readonly caKeyPath: string;
  private caCertPem?: string;
  private caCert?: forge.pki.Certificate;
  private caKey?: forge.pki.rsa.PrivateKey;
  private readonly leafCache = new Map<string, ServerCredentials>();

  constructor(private readonly config: EngineConfig) {
    this.caDir = join(config.dataDir, 'ca');
    this.caCertPath = join(this.caDir, 'envy-ca.crt');
    this.caKeyPath = join(this.caDir, 'envy-ca.key');
  }

  /** Absolute path to the CA cert — handed to the setup script for trust. */
  get caCertificatePath(): string {
    return this.caCertPath;
  }

  /** Ensure the CA exists on disk and is loaded into memory. Idempotent. */
  ensureCa(): void {
    mkdirSync(this.caDir, { recursive: true });
    if (!existsSync(this.caCertPath) || !existsSync(this.caKeyPath)) {
      this.generateCa();
    }
    if (!this.caCert) {
      this.caCertPem = readFileSync(this.caCertPath, 'utf8');
      this.caCert = pki.certificateFromPem(this.caCertPem);
      this.caKey = pki.privateKeyFromPem(readFileSync(this.caKeyPath, 'utf8'));
    }
  }

  /** Leaf cert for an exact hostname, signed by the CA, cached so repeat TLS
   *  handshakes are cheap. Works for any hostname shape — no wildcard rules. */
  leafFor(host: string): ServerCredentials {
    const key = host.toLowerCase();
    const cached = this.leafCache.get(key);
    if (cached) return cached;
    this.ensureCa();
    const creds = this.mintLeaf(key);
    this.leafCache.set(key, creds);
    return creds;
  }

  private generateCa(): void {
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    const { notBefore, notAfter } = tenYears();
    cert.validity.notBefore = notBefore;
    cert.validity.notAfter = notAfter;
    cert.setSubject(CA_SUBJECT);
    cert.setIssuer(CA_SUBJECT);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    writeFileSync(this.caCertPath, pki.certificateToPem(cert));
    writeFileSync(this.caKeyPath, pki.privateKeyToPem(keys.privateKey), { mode: 0o600 });
  }

  private mintLeaf(host: string): ServerCredentials {
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = serialFor(host);
    const { notBefore, notAfter } = tenYears();
    cert.validity.notBefore = notBefore;
    cert.validity.notAfter = notAfter;
    cert.setSubject([{ name: 'commonName', value: host }]);
    cert.setIssuer(this.caCert!.subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      // The exact host as a DNS SAN (type 2) — what modern browsers match on.
      { name: 'subjectAltName', altNames: [{ type: 2, value: host }] },
    ]);
    cert.sign(this.caKey!, forge.md.sha256.create());
    return {
      key: pki.privateKeyToPem(keys.privateKey),
      cert: pki.certificateToPem(cert) + '\n' + this.caCertPem!,
    };
  }
}
