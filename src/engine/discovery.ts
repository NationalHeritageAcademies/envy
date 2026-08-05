import { request } from 'node:http';
import { connect } from 'node:net';
import type { EngineConfig } from './config.js';
import type { ContainerSummary, DockerClient } from './docker.js';
import type { Route } from './routes.js';
import { RouteTable } from './routes.js';
import { syncHosts } from './hosts.js';

/** Fast-path answer to "is a container's own IP reachable from the host?" —
 *  i.e. whether we can route to exposed-but-unpublished ports. True on native
 *  Linux; the ENVY_CONTAINER_IPS_ROUTABLE env var overrides either way.
 *  `undefined` means the platform can't decide it: the answer depends on the
 *  engine (OrbStack and Colima-with-routable-network route container IPs,
 *  Docker Desktop doesn't), so Discovery settles it by probing a live
 *  container IP instead of guessing from the provider — a socket-path sniff
 *  would misreport any engine it hasn't heard of. */
export function assumeContainerIpsRoutable(): boolean | undefined {
  const override = process.env['ENVY_CONTAINER_IPS_ROUTABLE'];
  if (override === 'true' || override === '1') return true;
  if (override === 'false' || override === '0') return false;
  return process.platform === 'linux' ? true : undefined;
}

/** Whether `ip` answers from the host at the TCP level. A completed connect
 *  proves routability; so does ECONNREFUSED — the RST had to come back from
 *  the container's network stack. A timeout or no-route error means packets
 *  die on the way, the Docker Desktop shape. */
export function probeContainerIp(ip: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: ip, port, timeout: timeoutMs });
    const done = (ok: boolean): void => { socket.destroy(); resolve(ok); };
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', (err) => done((err as NodeJS.ErrnoException).code === 'ECONNREFUSED'));
  });
}

/** Settle routability against live containers: probe a few container IPs and
 *  call them routable if any answers. Returns undefined — try again on the
 *  next rebuild — while no running container offers an IP + TCP port to test. */
async function detectRoutability(containers: ContainerSummary[]): Promise<boolean | undefined> {
  const candidates = containers
    .filter((c) => c.running && c.ip && c.ports.some((p) => p.type === 'tcp'))
    .slice(0, 3);
  if (candidates.length === 0) return undefined;
  const results = await Promise.all(
    candidates.map((c) => probeContainerIp(c.ip!, c.ports.find((p) => p.type === 'tcp')!.privatePort)),
  );
  return results.some(Boolean);
}

/** Container ports we treat as "probably the web server", best first. */
const WEB_PORT_PREFERENCE = [80, 8080, 3000, 8000, 5000, 4200, 5173, 8000, 443];

/** Opt-in labels a container can set to control its Envy hostname/port. */
const LABEL_HOST = 'envy.host';
const LABEL_PORT = 'envy.port';
const LABEL_ENABLE = 'envy.enable'; // set to "false" to opt a container out
const LABEL_DOMAINS = 'envy.domains'; // restrict to a subset of configured domains
const LABEL_COMPOSE_PROJECT = 'com.docker.compose.project';
const LABEL_COMPOSE_SERVICE = 'com.docker.compose.service';
const LABEL_COMPOSE_NUMBER = 'com.docker.compose.container-number';

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Which domains a container is reachable on, by precedence:
 *  1. `envy.domains` label, 2. the user's per-container assignment,
 *  3. default → the PRIMARY domain only (not every domain). Exported so the
 *  main process can compute the same effective set for the UI. */
export function resolveContainerDomains(
  labels: Record<string, string>,
  name: string,
  all: string[],
  assignments: Record<string, string[]>,
): string[] {
  const fallback = all.slice(0, 1); // primary only (or [] if none configured)
  const label = labels[LABEL_DOMAINS];
  let chosen: string[] | undefined;
  if (label) chosen = label.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  else if (assignments[name]?.length) chosen = assignments[name];
  if (!chosen) return fallback;
  const restricted = chosen.filter((d) => all.includes(d));
  return restricted.length ? restricted : fallback; // never strand a container
}

/** Whether the container still wears the name Compose generated for it —
 *  `<project>-<service>-<replica>` (underscore-separated under Compose v1).
 *  Any other name means the user pinned it with `container_name:`. */
function hasComposeAutoName(c: ContainerSummary): boolean {
  const project = c.labels[LABEL_COMPOSE_PROJECT];
  const service = c.labels[LABEL_COMPOSE_SERVICE];
  if (!project || !service) return false;
  const replica = c.labels[LABEL_COMPOSE_NUMBER] ?? '1';
  return c.name === `${project}-${service}-${replica}` || c.name === `${project}_${service}_${replica}`;
}

/** Default hostname base. For Compose containers still wearing their
 *  auto-generated name, the service name — so a service gets `gradebook.envy`
 *  out of the box, not the project-prefixed, replica-suffixed
 *  `nha-frontend-gradebook-1.envy` — with the replica index appended only
 *  beyond the first. An explicit `container_name:` was chosen deliberately
 *  (often because the compose file can't carry envy.* labels) and beats the
 *  service name; non-Compose containers likewise keep their name. */
function defaultBase(container: ContainerSummary): string {
  if (hasComposeAutoName(container)) {
    const base = sanitize(container.labels[LABEL_COMPOSE_SERVICE]!);
    const replica = container.labels[LABEL_COMPOSE_NUMBER];
    return replica && replica !== '1' ? `${base}-${replica}` : base;
  }
  return sanitize(container.name);
}

/** Resolve the host(s) a container should answer on, across its domains.
 *  `usedBases` (when given) de-conflicts default names across containers: two
 *  Compose projects can both have an "api" service, and the later one falls
 *  back to its globally-unique container name. */
export function hostsFor(container: ContainerSummary, domains: string[], usedBases?: Set<string>): string[] {
  const label = container.labels[LABEL_HOST];
  if (label) {
    return label
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
      // A bare token like "api" becomes "api.<domain>" for each of the
      // container's domains; a dotted value is taken verbatim.
      .flatMap((h) => (h.includes('.') ? [h] : domains.map((d) => `${h}.${d}`)));
  }
  let base = defaultBase(container);
  if (usedBases) {
    if (usedBases.has(base)) base = sanitize(container.name);
    usedBases.add(base);
  }
  return domains.map((d) => `${base}.${d}`);
}

/** A port a container could be reached on: the container-side port number
 *  plus the concrete address the proxy would dial for it. */
export interface TargetCandidate {
  privatePort: number;
  host: string;
  port: number;
}

/** Where a container's traffic COULD go, keeping every option open:
 *  1. PUBLISHED ports → the host loopback (works on every Docker provider).
 *  2. else EXPOSED ports → the container's own IP (works where container IPs
 *     are host-routable — OrbStack, native Linux, any engine that passes the
 *     reachability probe). This is how Envy matches OrbStack for Compose
 *     services that never publish a port. */
function targetCandidates(c: ContainerSummary, resolveTo: string, routable: boolean): TargetCandidate[] {
  const tcp = c.ports.filter((p) => p.type === 'tcp');
  const published = tcp.filter((p) => p.publicPort);
  if (published.length > 0) {
    return published.map((p) => ({ privatePort: p.privatePort, host: resolveTo, port: p.publicPort! }));
  }
  // Only fall back to the container IP where it's actually reachable.
  if (routable && c.ip) {
    const ip = c.ip;
    return tcp.map((p) => ({ privatePort: p.privatePort, host: ip, port: p.privatePort }));
  }
  return [];
}

/** How long a probed port gets to answer. Targets are loopback or a local VM,
 *  so a real web server responds in single-digit milliseconds. */
const PROBE_TIMEOUT_MS = 500;

/** Whether an HTTP server answers at host:port — any status code counts, only
 *  the wire format matters. Non-HTTP listeners (SMTP banners, Postgres, Redis)
 *  fail the response parse; closed/filtered ports error or time out. */
export function probeHttp(host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host, port, method: 'GET', path: '/', timeout: timeoutMs }, (res) => {
      res.destroy();
      resolve(true);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(false));
    req.end();
  });
}

/** Ports whose conventional protocol is not HTTP (mail, databases, queues).
 *  Probed LAST, so a sibling port that answers HTTP spares them the garbage
 *  request entirely — an HTTP probe against, say, an SMTP listener isn't
 *  harmful, but it shows up as a "syntax error" in that service's logs. */
const LIKELY_NON_HTTP_PORTS = new Set([
  21, 22, 23, 25, 110, 143, 465, 587, 993, 995, 1025, 2525, // ssh/ftp/mail
  1433, 1521, 3306, 5432, 6379, 9042, 11211, 27017, // databases/caches
  4222, 5671, 5672, 9092, 61616, // message queues
]);

/** Pick which candidate to route to (label → single → web-port → probe →
 *  lowest). `certain: false` means we fell through to the lowest-port guess
 *  because no candidate answered HTTP — the caller should try again shortly,
 *  since the app inside the container may simply not be listening yet. */
export async function chooseTarget(
  candidates: TargetCandidate[],
  portLabel: string | undefined,
  probe: (c: TargetCandidate) => Promise<boolean>,
): Promise<{ target: TargetCandidate; certain: boolean } | undefined> {
  if (candidates.length === 0) return undefined;
  if (portLabel) {
    const wanted = Number.parseInt(portLabel, 10);
    const match = candidates.find((c) => c.privatePort === wanted);
    if (match) return { target: match, certain: true };
  }
  if (candidates.length === 1) return { target: candidates[0]!, certain: true };
  for (const pref of WEB_PORT_PREFERENCE) {
    const match = candidates.find((c) => c.privatePort === pref);
    if (match) return { target: match, certain: true };
  }
  // Ambiguous (e.g. Mailpit publishing SMTP 1025 + web UI 8025): ask each port
  // whether it actually speaks HTTP and take the first that does. Probed one
  // at a time — plausible web ports first, lowest first — and stopping at the
  // first hit, so known-protocol ports (SMTP, Postgres…) are usually never
  // probed at all.
  const sorted = [...candidates].sort(
    (a, b) =>
      Number(LIKELY_NON_HTTP_PORTS.has(a.privatePort)) - Number(LIKELY_NON_HTTP_PORTS.has(b.privatePort)) ||
      a.privatePort - b.privatePort,
  );
  for (const c of sorted) {
    if (await probe(c)) return { target: c, certain: true };
  }
  const lowest = [...candidates].sort((a, b) => a.privatePort - b.privatePort)[0]!;
  return { target: lowest, certain: false };
}

/**
 * Watches Docker and keeps the {@link RouteTable} in sync: every running
 * container with a published port becomes one or more `*.envy.local` routes.
 * Rebuilds wholesale on each relevant Docker event — cheap and race-free.
 */
/** How soon to re-probe after an ambiguous container answered HTTP on none of
 *  its ports (usually: it just started and isn't listening yet), and how many
 *  times to keep trying before accepting the lowest-port guess as final. */
const REPROBE_DELAY_MS = 3000;
const MAX_REPROBES = 5;

/** How often the reconciliation poll re-lists containers. It exists for the
 *  one failure no stream signal can catch — a half-open events socket that
 *  emits neither 'data' nor 'end' nor 'error' (typically after host sleep) —
 *  so it only needs to be frequent enough that a frozen listing self-heals
 *  within a tolerable window. Exported for tests. */
export const RECONCILE_INTERVAL_MS = 45_000;

/** What the reconciliation poll compares between ticks: which containers
 *  exist and whether each runs. Status text is excluded — it embeds uptime
 *  ("Up 3 minutes"), which would differ on every tick. */
function containerSnapshot(containers: ContainerSummary[]): string {
  return containers
    .map((c) => `${c.id}:${c.state}:${c.ip ?? ''}`)
    .sort()
    .join('|');
}

export class Discovery {
  readonly routes = new RouteTable();
  /** Whether container IPs are host-routable. Settled lazily on rebuild by
   *  probing a live container when the platform alone can't decide it. */
  private routable = assumeContainerIpsRoutable();
  /** `containerId:privatePort` pairs confirmed to speak HTTP. Ports don't
   *  change roles across restarts, so a positive sticks for the container's
   *  lifetime; negatives are never cached so a slow-starting app gets
   *  re-probed on the next rebuild. */
  private readonly httpConfirmed = new Set<string>();
  private readonly reprobeCounts = new Map<string, number>();
  private reprobeTimer?: NodeJS.Timeout;
  private reconcileTimer?: NodeJS.Timeout;
  /** Container-list fingerprint as of the last rebuild, for the reconcile poll. */
  private lastSnapshot = '';

  constructor(
    private readonly docker: DockerClient,
    private readonly config: EngineConfig,
  ) {}

  /** The probed/assumed routability verdict, for engine status (and the UI's
   *  "publish a port" hint). False while still undetermined. */
  get containerIpsRoutable(): boolean {
    return this.routable ?? false;
  }

  async start(): Promise<void> {
    await this.rebuild();
    // Registered once for the life of this Discovery; resume() reuses it.
    this.docker.on('event', this.onDockerEvent);
    await this.docker.watchEvents();
    this.startReconcile();
  }

  /** Cancel this Discovery's timers. The route table and listeners are left
   *  intact — stop() is for engine shutdown, not an outage. */
  stop(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = undefined;
    if (this.reprobeTimer) clearTimeout(this.reprobeTimer);
    this.reprobeTimer = undefined;
  }

  // Container lifecycle transitions are the only events that move routes.
  private readonly onDockerEvent = (event: { Type?: string; status?: string }): void => {
    if (event.Type === 'container') void this.rebuild();
  };

  /** Re-arm the event stream and rebuild routes after the Docker daemon
   *  returned from an outage. The 'event' listener from start() is still
   *  attached, so we only need a fresh watch stream — re-subscribing here would
   *  leak a listener on every reconnect. */
  async resume(): Promise<void> {
    // The engine may have changed across the outage (e.g. OrbStack quit,
    // Colima started), so a probed routability verdict is stale — re-detect.
    this.routable = assumeContainerIpsRoutable();
    await this.rebuild();
    await this.docker.watchEvents();
    this.startReconcile(); // no-op when the interval survived the outage
  }

  /** Low-frequency backstop for the event stream: if the container list has
   *  drifted from the last rebuild without any Docker event arriving (the
   *  half-open-socket case where the stream dies silently), rebuild. One
   *  interval per Discovery — start()/resume() re-arming never stacks a
   *  second one — and errors are swallowed: Docker being down mid-tick is the
   *  stream-error/reconnect path's problem, not the poll's. */
  private startReconcile(): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setInterval(() => {
      void (async () => {
        const containers = await this.docker.listContainers(true);
        if (containerSnapshot(containers) !== this.lastSnapshot) await this.rebuild();
      })().catch(() => {});
    }, RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
  }

  async rebuild(): Promise<void> {
    const containers = await this.docker.listContainers(true);
    this.lastSnapshot = containerSnapshot(containers);
    if (this.routable === undefined) this.routable = await detectRoutability(containers);
    const routes: Route[] = [];
    const uncertain: string[] = [];

    const live = new Set(containers.map((c) => c.id));
    for (const key of this.httpConfirmed) {
      if (!live.has(key.slice(0, key.indexOf(':')))) this.httpConfirmed.delete(key);
    }
    for (const id of this.reprobeCounts.keys()) {
      if (!live.has(id)) this.reprobeCounts.delete(id);
    }

    // Probes run concurrently across containers and ports; conclusive
    // containers (label / single port / known web port / cached probe)
    // resolve without any network round-trip.
    const picked = await Promise.all(
      containers.map(async (c) => {
        if (!c.running || c.labels[LABEL_ENABLE] === 'false') return undefined;
        const candidates = targetCandidates(c, this.config.resolveTo, this.routable ?? false);
        const choice = await chooseTarget(candidates, c.labels[LABEL_PORT], async (cand) => {
          const key = `${c.id}:${cand.privatePort}`;
          if (this.httpConfirmed.has(key)) return true;
          const ok = await probeHttp(cand.host, cand.port);
          if (ok) this.httpConfirmed.add(key);
          return ok;
        });
        return choice ? { c, ...choice } : undefined;
      }),
    );

    const usedBases = new Set<string>();
    for (const p of picked) {
      if (!p) continue;
      if (p.certain) this.reprobeCounts.delete(p.c.id);
      else uncertain.push(p.c.id);

      const domains = resolveContainerDomains(p.c.labels, p.c.name, this.config.domains, this.config.assignments);
      for (const host of hostsFor(p.c, domains, usedBases)) {
        routes.push({
          host,
          containerId: p.c.id,
          containerName: p.c.name,
          target: { host: p.target.host, port: p.target.port },
          upstream: 'http',
        });
      }
    }

    this.routes.replaceAll(routes);
    // Windows: keep the hosts file in sync so browsers (whose built-in DNS
    // resolver bypasses NRPT) can resolve each active hostname. No-op elsewhere.
    syncHosts(routes.map((r) => r.host), this.config.resolveTo);
    this.scheduleReprobe(uncertain);
  }

  /** One shared retry for containers whose ports all failed the HTTP probe —
   *  typically apps still booting. Bounded per container so a genuinely
   *  non-HTTP container (say, SMTP + Redis) doesn't keep us probing forever. */
  private scheduleReprobe(containerIds: string[]): void {
    const due = containerIds.filter((id) => (this.reprobeCounts.get(id) ?? 0) < MAX_REPROBES);
    if (due.length === 0 || this.reprobeTimer) return;
    for (const id of due) this.reprobeCounts.set(id, (this.reprobeCounts.get(id) ?? 0) + 1);
    this.reprobeTimer = setTimeout(() => {
      this.reprobeTimer = undefined;
      this.rebuild().catch(() => {
        // Docker went away mid-retry; the engine's outage handling owns recovery.
      });
    }, REPROBE_DELAY_MS);
    this.reprobeTimer.unref?.();
  }
}
