import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { chooseTarget, hostsFor, probeContainerIp, probeHttp, type TargetCandidate } from './discovery.js';
import type { ContainerSummary } from './docker.js';

function cand(privatePort: number, port = privatePort): TargetCandidate {
  return { privatePort, host: '127.0.0.1', port };
}

/** Probe stub that reports which ports speak HTTP and records what got probed. */
function fakeProbe(httpPorts: number[], probed: number[] = []) {
  return async (c: TargetCandidate): Promise<boolean> => {
    probed.push(c.privatePort);
    return httpPorts.includes(c.privatePort);
  };
}

describe('chooseTarget', () => {
  it('returns undefined with no candidates', async () => {
    expect(await chooseTarget([], undefined, fakeProbe([]))).toBeUndefined();
  });

  it('trusts the envy.port label without probing', async () => {
    const probed: number[] = [];
    const out = await chooseTarget([cand(1025), cand(8025)], '8025', fakeProbe([], probed));
    expect(out).toEqual({ target: cand(8025), certain: true });
    expect(probed).toEqual([]);
  });

  it('ignores a label that matches no candidate and keeps choosing', async () => {
    const out = await chooseTarget([cand(1025), cand(8025)], '9999', fakeProbe([8025]));
    expect(out?.target.privatePort).toBe(8025);
  });

  it('takes a single candidate without probing', async () => {
    const probed: number[] = [];
    const out = await chooseTarget([cand(1025)], undefined, fakeProbe([], probed));
    expect(out).toEqual({ target: cand(1025), certain: true });
    expect(probed).toEqual([]);
  });

  it('takes a well-known web port without probing', async () => {
    const probed: number[] = [];
    const out = await chooseTarget([cand(5432), cand(80)], undefined, fakeProbe([], probed));
    expect(out).toEqual({ target: cand(80), certain: true });
    expect(probed).toEqual([]);
  });

  it('probes ambiguous ports and picks the one that speaks HTTP', async () => {
    // The Mailpit shape: SMTP on 1025, web UI on 8025 — lowest-port would lose.
    const out = await chooseTarget([cand(1025), cand(8025)], undefined, fakeProbe([8025]));
    expect(out).toEqual({ target: cand(8025), certain: true });
  });

  it('never probes a known-protocol port when a sibling answers HTTP', async () => {
    // Probing an SMTP/DB port isn't harmful, but it pollutes that service's
    // logs — so 1025 must not be touched once 8025 answers.
    const probed: number[] = [];
    await chooseTarget([cand(1025), cand(8025)], undefined, fakeProbe([8025], probed));
    expect(probed).toEqual([8025]);
  });

  it('prefers the lowest port among several that speak HTTP', async () => {
    const probed: number[] = [];
    const out = await chooseTarget([cand(9000), cand(8500)], undefined, fakeProbe([8500, 9000], probed));
    expect(out?.target.privatePort).toBe(8500);
    expect(probed).toEqual([8500]); // stops at the first hit
  });

  it('still probes known-protocol ports, last, as a fallback', async () => {
    const probed: number[] = [];
    const out = await chooseTarget([cand(1025), cand(9999)], undefined, fakeProbe([1025], probed));
    expect(out).toEqual({ target: cand(1025), certain: true });
    expect(probed).toEqual([9999, 1025]);
  });

  it('falls back to the lowest port, uncertain, when nothing answers', async () => {
    const out = await chooseTarget([cand(1025), cand(8025)], undefined, fakeProbe([]));
    expect(out).toEqual({ target: cand(1025), certain: false });
  });
});

function container(name: string, labels: Record<string, string> = {}): ContainerSummary {
  return { id: `id-${name}`, name, image: 'img', state: 'running', status: 'Up', running: true, ports: [], labels };
}

describe('hostsFor', () => {
  it('defaults to the Compose service name, not the container name', () => {
    const c = container('nha-frontend-gradebook-1', {
      'com.docker.compose.project': 'nha-frontend',
      'com.docker.compose.service': 'gradebook',
      'com.docker.compose.container-number': '1',
    });
    expect(hostsFor(c, ['envy'])).toEqual(['gradebook.envy']);
  });

  it('suffixes replicas beyond the first when auto-named', () => {
    const c = container('nha-frontend-gradebook-2', {
      'com.docker.compose.project': 'nha-frontend',
      'com.docker.compose.service': 'gradebook',
      'com.docker.compose.container-number': '2',
    });
    expect(hostsFor(c, ['envy'])).toEqual(['gradebook-2.envy']);
  });

  it('uses the sanitized container name for non-Compose containers', () => {
    expect(hostsFor(container('My_Redis'), ['envy'])).toEqual(['my-redis.envy']);
  });

  it('prefers an explicit container_name over the Compose service name', () => {
    // The name doesn't match Compose's <project>-<service>-<n> auto-naming,
    // so the user pinned it deliberately with container_name:.
    const c = container('gradebook-api', {
      'com.docker.compose.project': 'nha-backend',
      'com.docker.compose.service': 'gradebook',
      'com.docker.compose.container-number': '1',
    });
    expect(hostsFor(c, ['envy'])).toEqual(['gradebook-api.envy']);
  });

  it('treats legacy underscore-separated Compose names as auto-generated', () => {
    const c = container('proj_api_1', {
      'com.docker.compose.project': 'proj',
      'com.docker.compose.service': 'api',
      'com.docker.compose.container-number': '1',
    });
    expect(hostsFor(c, ['envy'])).toEqual(['api.envy']);
  });

  it('falls back to the container name when two projects share a service name', () => {
    const used = new Set<string>();
    const a = container('proj-a-api-1', {
      'com.docker.compose.project': 'proj-a',
      'com.docker.compose.service': 'api',
    });
    const b = container('proj-b-api-1', {
      'com.docker.compose.project': 'proj-b',
      'com.docker.compose.service': 'api',
    });
    expect(hostsFor(a, ['envy'], used)).toEqual(['api.envy']);
    expect(hostsFor(b, ['envy'], used)).toEqual(['proj-b-api-1.envy']);
  });

  it('avoids the dedup fallback when one colliding service pins a container_name', () => {
    // NHA.Frontend's auto-named gradebook service and NHA.Backend's pinned
    // container_name: gradebook-api must not fight over the same base.
    const used = new Set<string>();
    const frontend = container('nha-frontend-gradebook-1', {
      'com.docker.compose.project': 'nha-frontend',
      'com.docker.compose.service': 'gradebook',
      'com.docker.compose.container-number': '1',
    });
    const backend = container('gradebook-api', {
      'com.docker.compose.project': 'nha-backend',
      'com.docker.compose.service': 'gradebook',
      'com.docker.compose.container-number': '1',
    });
    expect(hostsFor(frontend, ['envy'], used)).toEqual(['gradebook.envy']);
    expect(hostsFor(backend, ['envy'], used)).toEqual(['gradebook-api.envy']);
  });

  it('honors the envy.host label over the service name', () => {
    const c = container('proj-api-1', { 'com.docker.compose.service': 'api', 'envy.host': 'backend' });
    expect(hostsFor(c, ['envy'])).toEqual(['backend.envy']);
  });

  it('fans a bare label host out across domains, dotted verbatim', () => {
    const c = container('web', { 'envy.host': 'app, app.custom.dev' });
    expect(hostsFor(c, ['envy', 'test'])).toEqual(['app.envy', 'app.test', 'app.custom.dev']);
  });
});

describe('probeHttp', () => {
  const servers: (Server | TcpServer)[] = [];
  afterAll(() => { for (const s of servers) s.close(); });

  function listen(server: Server | TcpServer): Promise<number> {
    servers.push(server);
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve((server.address() as { port: number }).port);
      });
    });
  }

  it('accepts any HTTP response, even an error status', async () => {
    const port = await listen(createServer((_req, res) => { res.statusCode = 503; res.end(); }));
    expect(await probeHttp('127.0.0.1', port)).toBe(true);
  });

  it('rejects an SMTP-style listener that talks first', async () => {
    const port = await listen(createTcpServer((socket) => { socket.write('220 mail ESMTP ready\r\n'); }));
    expect(await probeHttp('127.0.0.1', port)).toBe(false);
  });

  it('rejects a silent listener via timeout', async () => {
    const port = await listen(createTcpServer(() => { /* accept and say nothing */ }));
    expect(await probeHttp('127.0.0.1', port, 200)).toBe(false);
  });

  it('rejects a closed port', async () => {
    const server = createTcpServer();
    const port = await listen(server);
    await new Promise((resolve) => server.close(resolve));
    expect(await probeHttp('127.0.0.1', port)).toBe(false);
  });
});

describe('probeContainerIp', () => {
  it('treats a completed connect as routable', async () => {
    const server = createTcpServer(() => { /* accept */ });
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    });
    expect(await probeContainerIp('127.0.0.1', port)).toBe(true);
    await new Promise((resolve) => server.close(resolve));
  });

  it('treats a connection-refused as routable — the RST proves reachability', async () => {
    const server = createTcpServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    });
    await new Promise((resolve) => server.close(resolve));
    expect(await probeContainerIp('127.0.0.1', port)).toBe(true);
  });

  it('treats a black-holed address as not routable', async () => {
    // TEST-NET-3 is never routed; SYNs die quietly — the Docker Desktop shape.
    expect(await probeContainerIp('203.0.113.1', 80, 250)).toBe(false);
  });
});
