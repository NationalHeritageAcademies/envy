import Docker from 'dockerode';
import type { ContainerInfo } from 'dockerode';
import { EventEmitter } from 'node:events';
import type { ContainerDetail, RunOptions } from '../ipc/contract.js';

/** A published port mapping (container port exposed on the host). */
export interface PortMapping {
  privatePort: number;
  publicPort?: number;
  type: string;
  hostIp?: string;
}

/** Normalized, UI-friendly view of a container. */
export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  running: boolean;
  ports: PortMapping[];
  labels: Record<string, string>;
  /** The container's network IP (first network) — used to route to exposed-but
   *  -unpublished ports when container IPs are host-routable (OrbStack/Linux). */
  ip?: string;
}

export interface ImageSummary {
  id: string;
  tags: string[];
  size: number;
  created: number;
}

export interface PullProgress {
  status: string;
  progress?: string;
  id?: string;
}

function shortId(id: string): string {
  return id.replace(/^sha256:/, '').slice(0, 12);
}

function cleanName(names: string[] | undefined): string {
  const first = names?.[0] ?? '';
  return first.replace(/^\//, '');
}

function firstIp(networks?: Record<string, { IPAddress?: string }>): string | undefined {
  for (const net of Object.values(networks ?? {})) {
    if (net?.IPAddress) return net.IPAddress;
  }
  return undefined;
}

function mapContainer(info: ContainerInfo): ContainerSummary {
  return {
    id: shortId(info.Id),
    name: cleanName(info.Names),
    image: info.Image,
    state: info.State,
    status: info.Status,
    running: info.State === 'running',
    ports: (info.Ports ?? []).map((p) => ({
      privatePort: p.PrivatePort,
      publicPort: p.PublicPort,
      type: p.Type,
      hostIp: p.IP,
    })),
    labels: info.Labels ?? {},
    ip: firstIp(info.NetworkSettings?.Networks),
  };
}

/**
 * Thin wrapper over dockerode. Talks to whatever Docker endpoint the host is
 * configured for (the local socket by default, or $DOCKER_HOST) — which, on
 * this machine, happens to be OrbStack. We only ever read, or act on the
 * specific container the caller names; we never reconfigure the daemon.
 */
export class DockerClient extends EventEmitter {
  private docker: Docker;

  constructor() {
    super();
    // dockerode auto-detects the socket / DOCKER_HOST, so this works against
    // Docker Desktop, OrbStack, Podman, or a remote daemon unchanged.
    this.docker = new Docker();
  }

  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async listContainers(all = true): Promise<ContainerSummary[]> {
    const infos = await this.docker.listContainers({ all });
    return infos.map(mapContainer);
  }

  async listImages(): Promise<ImageSummary[]> {
    const images = await this.docker.listImages();
    return images.map((img) => ({
      id: shortId(img.Id),
      tags: (img.RepoTags ?? []).filter((t) => t && t !== '<none>:<none>'),
      size: img.Size,
      created: img.Created,
    }));
  }

  /** Create + start a container (a friendly `docker run`), pulling if needed. */
  async run(opts: RunOptions, onProgress?: (p: PullProgress) => void): Promise<void> {
    const images = await this.listImages();
    if (!images.some((i) => i.tags.includes(opts.image))) {
      await this.pull(opts.image, onProgress);
    }
    const exposedPorts: Record<string, Record<string, never>> = {};
    const portBindings: Record<string, { HostPort: string }[]> = {};
    for (const p of opts.ports ?? []) {
      const key = `${p.container}/tcp`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: String(p.host) }];
    }
    const container = await this.docker.createContainer({
      Image: opts.image,
      name: opts.name || undefined,
      Env: opts.env,
      Labels: opts.labels,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        Binds: (opts.volumes ?? []).map((v) => `${v.source}:${v.target}`),
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });
    await container.start();
  }

  /** Pull the latest build of a container's image tag, then recreate the
   *  container with the same config on the new image (keep-current workflow). */
  async recreateLatest(id: string, onProgress?: (p: PullProgress) => void): Promise<void> {
    const container = this.docker.getContainer(id);
    const info = await container.inspect();
    const image = info.Config?.Image;
    if (!image) throw new Error('Container has no image reference.');

    await this.pull(image, onProgress); // fetch the newest build of this tag

    const wasRunning = info.State?.Running;
    if (wasRunning) await container.stop().catch(() => {});
    await container.remove({ force: true });

    const created = await this.docker.createContainer({
      name: (info.Name ?? '').replace(/^\//, '') || undefined,
      Image: image,
      Env: info.Config?.Env,
      Labels: info.Config?.Labels,
      Cmd: info.Config?.Cmd,
      Entrypoint: info.Config?.Entrypoint,
      WorkingDir: info.Config?.WorkingDir,
      ExposedPorts: info.Config?.ExposedPorts,
      HostConfig: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- dockerode types PortBindings as any
        PortBindings: info.HostConfig?.PortBindings,
        Binds: info.HostConfig?.Binds,
        RestartPolicy: info.HostConfig?.RestartPolicy,
        NetworkMode: info.HostConfig?.NetworkMode,
      },
    });
    if (wasRunning) await created.start();
  }

  async start(id: string): Promise<void> {
    await this.docker.getContainer(id).start();
  }

  async stop(id: string): Promise<void> {
    await this.docker.getContainer(id).stop();
  }

  async restart(id: string): Promise<void> {
    await this.docker.getContainer(id).restart();
  }

  async remove(id: string, force = false): Promise<void> {
    await this.docker.getContainer(id).remove({ force });
  }

  /** Pull an image, reporting layer progress as it streams. */
  async pull(image: string, onProgress?: (p: PullProgress) => void): Promise<void> {
    const stream = await this.docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err) => (err ? reject(err) : resolve()),
        (event: PullProgress) => onProgress?.(event),
      );
    });
  }

  /** Subscribe to the Docker event stream; emits 'event' on every container change. */
  async watchEvents(): Promise<void> {
    const stream = await this.docker.getEvents();
    stream.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as unknown;
          this.emit('event', event);
        } catch {
          // partial JSON across chunks — Docker rarely splits, ignore safely
        }
      }
    });
    stream.on('error', (err: Error) => this.emit('stream-error', err));
  }

  async removeImage(id: string, force = true): Promise<void> {
    await this.docker.getImage(id).remove({ force });
  }

  /** Full detail for the Inspect drawer. */
  async inspectDetail(id: string): Promise<ContainerDetail> {
    const info = await this.docker.getContainer(id).inspect();
    const ports: ContainerDetail['ports'] = [];
    for (const [key, binds] of Object.entries(info.NetworkSettings?.Ports ?? {})) {
      const [containerPort, type] = key.split('/');
      ports.push({
        container: Number.parseInt(containerPort ?? '0', 10),
        type: type ?? 'tcp',
        host: binds?.[0]?.HostPort ? Number.parseInt(binds[0].HostPort, 10) : undefined,
      });
    }
    return {
      id: shortId(info.Id),
      name: cleanName([info.Name]),
      image: info.Config?.Image ?? '',
      running: info.State?.Running,
      ports,
      env: (info.Config?.Env ?? []).map((e) => {
        const eq = e.indexOf('=');
        return { key: eq >= 0 ? e.slice(0, eq) : e, value: eq >= 0 ? e.slice(eq + 1) : '' };
      }),
      mounts: (info.Mounts ?? []).map((m) => ({
        source: m.Source,
        destination: m.Destination,
        mode: m.RW ? 'rw' : 'ro',
      })),
    };
  }

  /** Follow a container's logs; returns a stop function. */
  async followLogs(
    id: string,
    onLine: (text: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<() => void> {
    const container = this.docker.getContainer(id);
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 200,
      timestamps: false,
    });

    // Docker multiplexes stdout/stderr on one stream; demux into the two.
    const stdout = { write: (b: Buffer) => splitLines(b, 'stdout') };
    const stderr = { write: (b: Buffer) => splitLines(b, 'stderr') };
    const buf = { stdout: '', stderr: '' };
    function splitLines(b: Buffer, which: 'stdout' | 'stderr'): void {
      buf[which] += b.toString('utf8');
      const parts = buf[which].split('\n');
      buf[which] = parts.pop() ?? '';
      for (const line of parts) onLine(line, which);
    }
    this.docker.modem.demuxStream(stream, stdout as never, stderr as never);
    return () => {
      try { (stream as unknown as { destroy?: () => void }).destroy?.(); } catch { /* ignore */ }
    };
  }

  /** Start an interactive shell in a container. Returns write/resize/stop. */
  async startExec(
    id: string,
    size: { cols: number; rows: number },
    onData: (data: string) => void,
    onExit: () => void,
  ): Promise<{ write: (d: string) => void; resize: (s: { cols: number; rows: number }) => void; stop: () => void }> {
    const container = this.docker.getContainer(id);
    // Prefer bash, fall back to sh. With Tty:true the stream is raw (no
    // 8-byte multiplex headers); we forward the bytes verbatim as base64 so
    // ANSI escape sequences survive the IPC hop intact.
    const exec = await container.exec({
      Cmd: ['/bin/sh', '-c', "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Env: ['TERM=xterm-256color'],
    });
    const stream = await exec.start({ hijack: true, stdin: true });
    stream.on('data', (chunk: Buffer) => onData(chunk.toString('base64')));
    stream.on('end', onExit);
    stream.on('error', onExit);
    void exec.resize({ h: size.rows, w: size.cols }).catch(() => {});
    return {
      write: (d) => stream.write(d),
      resize: (s) => void exec.resize({ h: s.rows, w: s.cols }).catch(() => {}),
      stop: () => { try { stream.end(); } catch { /* ignore */ } },
    };
  }

  /** One-shot stats read for a single container (CPU%, mem, net, disk totals). */
  async statsOnce(id: string): Promise<{ cpu: number; memBytes: number; netTotal: number; diskTotal: number }> {
    // dockerode resolves stats() to a Readable even with {stream:false}; read
    // the single JSON frame off it (handle the object form too, just in case).
    const res = (await this.docker.getContainer(id).stats({ stream: false })) as unknown;
    const s = await readStatsObject(res);
    const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
    const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
    const cpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    const cpu = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;
    const memBytes = (s.memory_stats.usage ?? 0) - (s.memory_stats.stats?.cache ?? 0);
    let netTotal = 0;
    for (const n of Object.values(s.networks ?? {})) netTotal += (n.rx_bytes ?? 0) + (n.tx_bytes ?? 0);
    let diskTotal = 0;
    for (const e of s.blkio_stats?.io_service_bytes_recursive ?? []) diskTotal += e.value ?? 0;
    return { cpu, memBytes, netTotal, diskTotal };
  }
}

/** Coerce dockerode's stats result (a Readable, or occasionally an object)
 *  into a parsed stats object. */
async function readStatsObject(res: unknown): Promise<DockerStats> {
  const maybeStream = res as { on?: unknown };
  if (maybeStream && typeof maybeStream.on === 'function') {
    const stream = res as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as DockerStats;
  }
  return res as DockerStats;
}

/** Minimal shape of the Docker stats payload we read. */
interface DockerStats {
  cpu_stats: { cpu_usage: { total_usage: number; percpu_usage?: number[] }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; stats?: { cache?: number } };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
  blkio_stats?: { io_service_bytes_recursive?: { value?: number }[] };
}
