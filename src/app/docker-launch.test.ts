import { describe, it, expect } from 'vitest';
import { detectWindowsProvider, type WinProbe } from './docker-launch.js';

const PF = 'C:\\Program Files';
const LAD = 'C:\\Users\\me\\AppData\\Local';
const DOCKER_EXE = `${PF}\\Docker\\Docker\\Docker Desktop.exe`;
const RANCHER_EXE = `${LAD}\\Programs\\Rancher Desktop\\Rancher Desktop.exe`;

/** Build a probe where only the named exes exist and the named bins are on PATH. */
function probe(opts: { exes?: string[]; path?: string[]; dockerHost?: string } = {}): WinProbe {
  const exes = new Set(opts.exes ?? []);
  const bins = new Set(opts.path ?? []);
  return {
    dockerHost: opts.dockerHost,
    programFiles: PF,
    localAppData: LAD,
    exists: (p) => exes.has(p),
    onPath: (b) => bins.has(b),
  };
}

describe('detectWindowsProvider', () => {
  it('respects an explicit DOCKER_HOST over any installed app (WSL/remote/Podman tcp)', () => {
    const r = detectWindowsProvider(probe({ exes: [DOCKER_EXE], dockerHost: 'tcp://localhost:2375' }));
    expect(r).toMatchObject({ name: 'Docker (DOCKER_HOST)', installed: true, startable: false });
  });

  it('detects Docker Desktop by its GUI exe and marks it startable', () => {
    const r = detectWindowsProvider(probe({ exes: [DOCKER_EXE] }));
    expect(r).toMatchObject({ name: 'Docker Desktop', startable: true, kind: 'app', target: DOCKER_EXE });
  });

  it('detects Rancher Desktop and now drives its lifecycle (startable)', () => {
    const r = detectWindowsProvider(probe({ exes: [RANCHER_EXE] }));
    expect(r).toMatchObject({ name: 'Rancher Desktop', startable: true, kind: 'app', target: RANCHER_EXE });
  });

  it('prefers Docker Desktop when both GUI apps are installed', () => {
    const r = detectWindowsProvider(probe({ exes: [DOCKER_EXE, RANCHER_EXE] }));
    expect(r.name).toBe('Docker Desktop');
  });

  it('detects Podman from PATH and starts it via the machine', () => {
    const r = detectWindowsProvider(probe({ path: ['podman.exe'] }));
    expect(r).toMatchObject({ name: 'Podman', startable: true, kind: 'cli' });
  });

  it('treats a bare docker.exe (CLI/WSL, no GUI) as installed but not startable', () => {
    const r = detectWindowsProvider(probe({ path: ['docker.exe'] }));
    expect(r).toMatchObject({ name: 'Docker', installed: true, startable: false, kind: 'cli' });
  });

  it('reports not-installed when nothing is found', () => {
    const r = detectWindowsProvider(probe());
    expect(r).toMatchObject({ installed: false, startable: false });
    expect(r.installUrl).toBeTruthy();
  });
});
