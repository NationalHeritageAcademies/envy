/**
 * Envy daemon — the long-running, root-owned process launchd keeps alive.
 *
 * Runs the full engine (Docker discovery + DNS + reverse proxy on 80/443) and
 * writes the per-domain /etc/resolver files (which only needs root, no UI). The
 * one privileged step it does NOT do is trusting the local CA: that writes
 * System-keychain trust settings, which require an interactive authorization a
 * launchd daemon can't present — so install-daemon.sh trusts it once during the
 * GUI elevation instead. The root CA is stable, so that single trust covers all
 * domains, present and future.
 *
 * Domains + per-container assignments come from config.json (NOT baked-in env),
 * and the daemon WATCHES that file — so adding/removing a domain or reassigning
 * a container in the app propagates live (new resolver file, regenerated leaf
 * cert signed by the already-trusted CA, updated routing) with no password prompt.
 */
import { appendFileSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync, watch } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Engine } from '../engine/engine.js';
import { loadConfig } from '../engine/config.js';
import type { EngineConfig } from '../engine/config.js';
import { CertStore } from '../engine/tls.js';

let config = loadConfig();
const dataDir = config.dataDir;
const logPath = join(dataDir, 'daemon.log');

function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  try { mkdirSync(dataDir, { recursive: true }); appendFileSync(logPath, line); } catch { /* ignore */ }
  process.stdout.write(line);
}

let engine = new Engine(config);

function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function writeResolvers(domains: string[], dnsPort: number): void {
  mkdirSync('/etc/resolver', { recursive: true });
  for (const domain of domains) {
    // Per-domain: one unwritable resolver must not stop the rest from landing.
    try {
      writeFileSync(
        `/etc/resolver/${domain}`,
        `# Managed by Envy. Routes *.${domain} to Envy's local DNS server.\nnameserver 127.0.0.1\nport ${dnsPort}\n`,
      );
    } catch (err) {
      log(`Resolver write failed for ${domain}: ${(err as Error).message}`);
    }
  }
}

/** Remove Envy-managed resolver files for domains we no longer serve. */
function removeStaleResolvers(domains: string[]): void {
  if (!existsSync('/etc/resolver')) return;
  for (const file of readdirSync('/etc/resolver')) {
    if (domains.includes(file)) continue;
    const path = `/etc/resolver/${file}`;
    try {
      if (readFileSync(path, 'utf8').includes('Managed by Envy')) {
        rmSync(path);
        log(`Removed stale resolver: ${file}`);
      }
    } catch { /* ignore */ }
  }
}

function flushDns(): void {
  try { execFileSync('dscacheutil', ['-flushcache']); execFileSync('killall', ['-HUP', 'mDNSResponder']); } catch { /* best-effort */ }
}

/** Do all privileged setup for the given config (idempotent). NEVER throws:
 *  a provisioning failure must degrade to "that domain doesn't resolve", not
 *  prevent the engine from starting — an unstarted engine is nothing listening
 *  on 443 for EVERY domain, which is how one bad domain once took down all the
 *  working ones. */
function provision(cfg: EngineConfig): void {
  if (!isRoot()) { log('Not root — skipping privileged provisioning.'); return; }
  try {
    const certs = new CertStore(cfg);
    certs.ensureCa(); // ensure the CA exists; leaf certs are minted per-host at request time
  } catch (err) {
    log(`CA setup failed: ${(err as Error).message}`);
  }
  // macOS resolves via /etc/resolver files (browsers honor them). Linux has no
  // such mechanism, so there browser resolution is handled by the engine's
  // hosts-file sync (Discovery) instead — nothing to provision here.
  if (process.platform === 'darwin') {
    try {
      writeResolvers(cfg.domains, cfg.dnsPort);
      removeStaleResolvers(cfg.domains);
    } catch (err) {
      log(`Resolver provisioning failed: ${(err as Error).message}`);
    }
    // CA trust is done once, interactively, by install-daemon.sh — a launchd
    // daemon can't write System-keychain trust settings non-interactively.
    flushDns();
  }
  log(`Provisioned domains: ${cfg.domains.join(', ')}`);
}

let reconnectTimer: NodeJS.Timeout | undefined;

/** The Docker daemon went away (e.g. OrbStack/Docker Desktop restarted). The
 *  event stream is dead, so the route table would silently freeze at whatever
 *  was running — clear it and poll for Docker to return, then re-arm discovery.
 *  Mirrors the GUI's recovery in app/main.ts; without this the proxy keeps
 *  serving a stale route table until the daemon itself is restarted. */
function wireDockerRecovery(eng: Engine): void {
  eng.docker.on('stream-error', (err: Error) => {
    if (eng !== engine) return; // stale engine discarded by a config re-apply
    log(`Docker event stream lost (${err.message}) — clearing routes, polling for Docker.`);
    engine.markDataLost();
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    void (async () => {
      if (!(await engine.docker.ping())) return;
      try {
        await engine.resumeData();
        await engine.startProxy(); // no-op when already bound; recovers a failed re-apply
        if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = undefined; }
        log(`Docker is back · routes=${engine.listRoutes().length}`);
      } catch (err) {
        log(`Docker reconnect attempt failed: ${(err as Error).message}`);
      }
    })();
  }, 3000);
}

/** Re-apply when config.json changes (domains or assignments). */
async function applyConfigChange(): Promise<void> {
  const next = loadConfig();
  const domainsChanged = JSON.stringify(next.domains) !== JSON.stringify(config.domains);
  const assignmentsChanged = JSON.stringify(next.assignments) !== JSON.stringify(config.assignments);
  if (!domainsChanged && !assignmentsChanged) return;
  log(`config.json changed (domains=${domainsChanged}, assignments=${assignmentsChanged}) — re-applying`);
  if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = undefined; }
  const prev = config;
  await engine.stop();
  config = next;
  engine = new Engine(config);
  if (domainsChanged) provision(config); // resolver files + cert only change with domains
  try {
    await engine.start();
    wireDockerRecovery(engine);
    log('Re-applied config.');
  } catch (err) {
    // Never regress domains that were serving before this change: fall back to
    // the last-known-good config and keep it running. `config` stays = next,
    // so a corrected config.json write still diffs and re-applies.
    log(`Re-apply start failed: ${(err as Error).message} — rolling back to previous domains.`);
    engine = new Engine(prev);
    try {
      await engine.start();
      wireDockerRecovery(engine);
      log(`Rolled back — still serving: ${prev.domains.join(', ')}`);
    } catch (rollbackErr) {
      log(`Rollback failed too: ${(rollbackErr as Error).message}`);
      scheduleReconnect();
    }
  }
}

function watchConfig(): void {
  try {
    let timer: NodeJS.Timeout | undefined;
    watch(dataDir, (_event, filename) => {
      if (filename !== 'config.json') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void applyConfigChange().catch((e: unknown) => log(`apply error: ${(e as Error).message}`)), 400);
    });
    log('Watching config.json for live domain/assignment changes.');
  } catch (err) {
    log(`config watch failed: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  log(`Envy daemon starting · domains=${config.domains.join(',')} · ports ${config.httpPort}/${config.httpsPort} · dns ${config.dnsPort}`);
  provision(config);
  try {
    await engine.start();
    wireDockerRecovery(engine);
    const s = await engine.status();
    log(`Engine up · dockerConnected=${s.dockerConnected} · proxyRunning=${s.proxyRunning} · routes=${s.routes.length}`);
  } catch (err) {
    log(`FATAL: ${(err as Error).message}`);
    process.exit(1);
  }
  watchConfig();
}

async function shutdown(signal: string): Promise<void> {
  log(`Received ${signal}, stopping…`);
  await engine.stop();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (err) => log(`uncaughtException: ${err.message}`));

void main();
