import { execFile, spawn } from 'node:child_process';
import { realpathSync, existsSync } from 'node:fs';
import { delimiter, join, win32 as winPath } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Where to send users who don't have a Docker provider installed yet. */
const INSTALL_URL =
  process.platform === 'linux'
    ? 'https://docs.docker.com/engine/install/'
    : 'https://www.docker.com/products/docker-desktop/';

export interface DockerProvider {
  /** Friendly name shown on the "Start …" button. */
  name: string;
  /** Whether Envy knows how to launch it on this platform. */
  startable: boolean;
  /** Whether a Docker provider is actually installed on this machine. */
  installed: boolean;
  /** Download page to point the user at when nothing is installed. */
  installUrl?: string;
}

type Kind = 'app' | 'cli' | 'service' | 'unknown';
interface Detected extends DockerProvider {
  kind: Kind;
  target: string; // app name / cli / service unit
}

/** The unix socket dockerode will use (honoring DOCKER_HOST). */
function socketPath(): string {
  const host = process.env['DOCKER_HOST'];
  if (host?.startsWith('unix://')) return host.slice('unix://'.length);
  return '/var/run/docker.sock';
}

/** True if `bin` is found in any PATH directory. */
function onPath(bin: string): boolean {
  const dirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  return dirs.some((d) => existsSync(join(d, bin)));
}

/** Provider returned when no Docker engine is installed on this platform. */
function notInstalled(): Detected {
  return { name: 'Docker Desktop', startable: false, installed: false, kind: 'unknown', target: '', installUrl: INSTALL_URL };
}

/** Everything {@link detectWindowsProvider} needs, injectable so the precedence
 *  logic is testable without touching the real registry / filesystem / env. */
export interface WinProbe {
  dockerHost?: string;
  programFiles?: string;
  programW6432?: string;
  programFilesX86?: string;
  localAppData?: string;
  exists: (p: string) => boolean;
  onPath: (bin: string) => boolean;
}

/** Candidate install roots a GUI app's exe might live under, in search order.
 *  Uses win32 path semantics so it's correct even when running off-Windows. */
function winRoots(p: WinProbe): string[] {
  return [
    p.programFiles,
    p.programW6432,
    p.programFilesX86,
    p.localAppData ? winPath.join(p.localAppData, 'Programs') : undefined,
    'C:\\Program Files',
  ].filter((r): r is string => Boolean(r));
}

/** First existing path of `<root>\<...segments>` across the known roots, or null.
 *  Launching the GUI exe directly is the reliable way to start it — `start
 *  "Docker Desktop"` resolves as a PATH command, not an installed app name. */
function findWinExe(p: WinProbe, ...segments: string[]): string | null {
  for (const root of winRoots(p)) {
    const exe = winPath.join(root, ...segments);
    if (p.exists(exe)) return exe;
  }
  return null;
}

/**
 * Identify the Windows Docker provider. The named pipe (//./pipe/docker_engine)
 * is shared by Docker Desktop and Rancher Desktop, so it can't disambiguate —
 * we go by what's installed. Precedence: an explicit DOCKER_HOST (a WSL bridge,
 * Podman tcp, or a remote daemon the user wired up themselves) wins, then the
 * GUI apps, then CLI-only engines. Exported for testing.
 */
export function detectWindowsProvider(p: WinProbe): Detected {
  // The user pointed Docker at a specific engine — respect it, don't second-guess.
  if (p.dockerHost) {
    return { name: 'Docker (DOCKER_HOST)', startable: false, installed: true, kind: 'unknown', target: p.dockerHost };
  }
  const docker = findWinExe(p, 'Docker', 'Docker', 'Docker Desktop.exe');
  if (docker) return { name: 'Docker Desktop', startable: true, installed: true, kind: 'app', target: docker };
  const rancher = findWinExe(p, 'Rancher Desktop', 'Rancher Desktop.exe');
  if (rancher) return { name: 'Rancher Desktop', startable: true, installed: true, kind: 'app', target: rancher };
  if (p.onPath('podman.exe')) return { name: 'Podman', startable: true, installed: true, kind: 'cli', target: 'podman' };
  // docker.exe with no GUI is likely a CLI/WSL engine we don't manage the lifecycle of.
  if (p.onPath('docker.exe')) return { name: 'Docker', startable: false, installed: true, kind: 'cli', target: 'docker' };
  return notInstalled();
}

/** Identify the Docker provider from the socket target + installed apps. */
export function detectProvider(): Detected {
  let target = socketPath();
  try { target = realpathSync(target); } catch { /* keep raw */ }
  const r = target.toLowerCase();

  if (process.platform === 'darwin') {
    if (r.includes('orbstack')) return { name: 'OrbStack', startable: true, installed: true, kind: 'app', target: 'OrbStack' };
    if (r.includes('colima')) return { name: 'Colima', startable: true, installed: true, kind: 'cli', target: 'colima' };
    if (r.includes('rancher')) return { name: 'Rancher Desktop', startable: true, installed: true, kind: 'app', target: 'Rancher Desktop' };
    if (r.includes('.docker') || r.includes('docker.app')) return { name: 'Docker Desktop', startable: true, installed: true, kind: 'app', target: 'Docker' };
    // Socket gone/unresolvable — fall back to whatever app is installed.
    for (const [app, label] of [['OrbStack', 'OrbStack'], ['Docker', 'Docker Desktop'], ['Rancher Desktop', 'Rancher Desktop']] as const) {
      if (existsSync(`/Applications/${app}.app`)) return { name: label, startable: true, installed: true, kind: 'app', target: app };
    }
    return notInstalled();
  }
  if (process.platform === 'win32') {
    return detectWindowsProvider({
      dockerHost: process.env['DOCKER_HOST'],
      programFiles: process.env['ProgramFiles'],
      programW6432: process.env['ProgramW6432'],
      programFilesX86: process.env['ProgramFiles(x86)'],
      localAppData: process.env['LOCALAPPDATA'],
      exists: existsSync,
      onPath,
    });
  }
  // Linux
  if (onPath('docker')) {
    return { name: 'Docker', startable: true, installed: true, kind: 'service', target: 'docker' };
  }
  return { name: 'Docker', startable: false, installed: false, kind: 'unknown', target: '', installUrl: INSTALL_URL };
}

export function dockerProvider(): DockerProvider {
  const { name, startable, installed, installUrl } = detectProvider();
  return { name, startable, installed, installUrl };
}

/** Launch the detected provider. App launches return immediately; the engine
 *  comes up in the background and Envy's reconnect poll picks it up. */
export async function startDocker(): Promise<void> {
  const p = detectProvider();
  if (process.platform === 'darwin') {
    if (p.kind === 'app') { await execFileAsync('open', ['-a', p.target]); return; }
    if (p.kind === 'cli') { spawn('colima', ['start'], { detached: true, stdio: 'ignore' }).unref(); return; }
    throw new Error('No known Docker provider to start.');
  }
  if (process.platform === 'win32') {
    // GUI apps (Docker Desktop / Rancher Desktop): launch the exe directly,
    // detached. `start "<app name>"` fails — Windows resolves that as a PATH
    // command, not an installed app.
    if (p.kind === 'app' && p.target && existsSync(p.target)) {
      spawn(p.target, [], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    if (p.name === 'Podman') {
      spawn('podman', ['machine', 'start'], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    throw new Error('No Docker engine Envy can start automatically. Start Docker Desktop, Rancher Desktop, or your engine manually.');
  }
  // Linux: try the Docker Desktop user service, then the system docker service.
  await execFileAsync('systemctl', ['--user', 'start', 'docker-desktop']).catch(() =>
    execFileAsync('systemctl', ['start', 'docker']),
  );
}
