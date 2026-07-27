import { app } from 'electron';
import sudoPrompt from '@vscode/sudo-prompt';
import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { EngineConfig } from '../engine/config.js';
import { saveDomains } from '../engine/config.js';
import { CertStore } from '../engine/tls.js';
import type { DaemonStatus } from '../ipc/contract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

const isWin = process.platform === 'win32';

// macOS: a root LaunchDaemon. Windows: an elevated Scheduled Task (see
// install-daemon.ps1 for why a task and not a Service). The two persistence
// mechanisms differ, but both run the *same* engine (proxy + DNS + Discovery +
// hosts-file sync) — only how they're installed/queried diverges below.
const LABEL = 'com.melodicdev.envy';
const PLIST = `/Library/LaunchDaemons/${LABEL}.plist`;
const TASK_NAME = 'EnvyDaemon';

/** Resolve where the scripts + bundled daemon live (dev vs packaged). */
function resourceBase(): string {
  // Packaged: shipped under Resources via electron-builder extraResources.
  // Dev: the project root (main runs from out/main/index.js → up two).
  return app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..');
}

function paths(): { install: string; uninstall: string; daemon: string } {
  const base = resourceBase();
  const ext = isWin ? 'ps1' : 'sh';
  return {
    install: join(base, 'scripts', `install-daemon.${ext}`),
    uninstall: join(base, 'scripts', `uninstall-daemon.${ext}`),
    daemon: join(base, 'out', 'daemon', 'envyd.cjs'),
  };
}

/** Shell-quote a single argument for the POSIX command sudo-prompt runs (macOS). */
function q(arg: string | number): string {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

/** Double-quote a single argument for the Windows (PowerShell) command line. */
function winQ(arg: string | number): string {
  return `"${String(arg).replace(/"/g, '""')}"`;
}

/** Run a command elevated through the OS authorization dialog (macOS auth
 *  prompt / Windows UAC). sudo-prompt handles both platforms. */
function runElevated(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sudoPrompt.exec(command, { name: 'Envy' }, (err) => (err ? reject(err) : resolve()));
  });
}

/** Whether the Windows EnvyDaemon scheduled task is registered. */
async function winTaskExists(): Promise<boolean> {
  try {
    await execFileAsync('schtasks', ['/query', '/tn', TASK_NAME]);
    return true;
  } catch {
    return false;
  }
}

/** Whether the daemon is currently loaded/running (launchd on macOS, the
 *  scheduled task's run state on Windows). */
async function isRunning(): Promise<boolean> {
  if (isWin) {
    try {
      const { stdout } = await execFileAsync('schtasks', ['/query', '/tn', TASK_NAME, '/fo', 'list', '/v']);
      return /\bStatus:\s*Running\b/i.test(stdout);
    } catch {
      return false;
    }
  }
  try {
    await execFileAsync('launchctl', ['print', `system/${LABEL}`]);
    return true;
  } catch {
    return false;
  }
}

/** Whether anything accepts TCP connections at host:port. */
function probeTcp(host: string, port: number, timeoutMs = 750): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean): void => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}

export async function daemonStatus(config: EngineConfig): Promise<DaemonStatus> {
  const installed = isWin ? await winTaskExists() : existsSync(PLIST);
  const running = installed ? await isRunning() : false;
  return {
    installed,
    running,
    // launchctl says the process exists; this says the proxy actually serves.
    // A daemon that broke mid-reconfigure keeps `running` true while nothing
    // listens on 443 — the UI must not call that "URLs live".
    proxyListening: running ? await probeTcp('127.0.0.1', config.httpsPort) : false,
    domains: config.domains,
  };
}

export async function daemonInstall(config: EngineConfig): Promise<DaemonStatus> {
  // Materialize config.json so the daemon (which reads domains from it, and
  // watches it) starts with the current domain set.
  saveDomains(config.dataDir, config.domains);
  // Generate the CA *before* elevation so the privileged step only has to
  // trust it (the CA lives in the user's data dir, owned by the user).
  const certs = new CertStore(config);
  certs.ensureCa();
  const caPath = certs.caCertificatePath;
  const { install, daemon } = paths();

  // Single elevation only. macOS: bash runs install-daemon.sh, which loads the
  // LaunchDaemon and trusts the CA. Windows: PowerShell runs install-daemon.ps1,
  // which registers/starts the scheduled task and trusts the CA. Same arg set,
  // platform-appropriate quoting. The Electron binary (process.execPath) is the
  // node-compatible runtime the daemon runs under (ELECTRON_RUN_AS_NODE).
  const command = isWin
    ? [
        'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', winQ(install),
        '-Runtime', winQ(process.execPath),
        '-Daemon', winQ(daemon),
        '-DataDir', winQ(config.dataDir),
        '-Domains', winQ(config.domains.join(',')),
        '-DnsPort', String(config.dnsPort),
        '-CaCert', winQ(caPath),
        '-HttpPort', String(config.httpPort),
        '-HttpsPort', String(config.httpsPort),
      ].join(' ')
    : [
        'bash',
        q(install),
        q(process.execPath),
        q(daemon),
        q(config.dataDir),
        q(config.domains.join(',')),
        q(config.dnsPort),
        q(caPath),
        q(config.httpPort),
        q(config.httpsPort),
      ].join(' ');

  await runElevated(command);

  return daemonStatus(config);
}

export async function daemonUninstall(config: EngineConfig): Promise<DaemonStatus> {
  const { uninstall } = paths();
  const command = isWin
    ? [
        'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', winQ(uninstall),
        '-Domains', winQ(config.domains.join(',')),
      ].join(' ')
    : ['bash', q(uninstall), q(config.domains.join(','))].join(' ');
  await runElevated(command);
  return daemonStatus(config);
}
