import type { EngineConfig } from './config.js';
import { loadConfig } from './config.js';
import { DockerClient } from './docker.js';
import { Discovery } from './discovery.js';
import { DnsServer } from './dns.js';
import { ProxyServer } from './proxy.js';
import { CertStore } from './tls.js';
import { clearHosts } from './hosts.js';
import type { Route } from './routes.js';

export interface EngineStatus {
  /** Discovery is running — the UI can list containers + routes. */
  dataReady: boolean;
  /** DNS + reverse proxy are bound and serving. */
  proxyRunning: boolean;
  /** Docker daemon reachable. */
  dockerConnected: boolean;
  /** Last error from attempting to start the proxy (e.g. port/permission). */
  proxyError?: string;
  /** Whether exposed-but-unpublished containers can be routed — native Linux,
   *  or any engine whose container IPs answered Discovery's reachability probe
   *  (OrbStack, Colima with routable networking). */
  containerIpsRoutable: boolean;
  config: EngineConfig;
  routes: Route[];
}

/**
 * The whole local stack, split into two layers so the GUI stays useful even
 * when the privileged proxy can't bind (e.g. ports 80/443 without elevation):
 *
 *   - data layer  : Docker + discovery — powers the container/route listing.
 *   - proxy layer : DNS + reverse proxy — actually serves the URLs.
 *
 * The CLI's `engine` command starts both; the desktop app starts the data
 * layer unconditionally and the proxy layer best-effort.
 */
export class Engine {
  readonly config: EngineConfig;
  readonly docker = new DockerClient();
  private readonly certs: CertStore;
  private discovery?: Discovery;
  private dns?: DnsServer;
  private proxy?: ProxyServer;
  private dataStarted = false;
  private proxyStarted = false;
  private proxyError?: string;

  constructor(config: EngineConfig = loadConfig()) {
    this.config = config;
    this.certs = new CertStore(config);
  }

  get caCertificatePath(): string {
    return this.certs.caCertificatePath;
  }

  /** Start Docker discovery (no ports bound). Throws only if Docker is unreachable. */
  async startData(): Promise<void> {
    if (this.dataStarted) return;
    if (!(await this.docker.ping())) {
      throw new Error('Cannot reach the Docker daemon. Is Docker (or OrbStack/Podman) running?');
    }
    this.discovery = new Discovery(this.docker, this.config);
    await this.discovery.start();
    this.dataStarted = true;
  }

  /** The Docker event stream died (typically the daemon stopped — e.g. OrbStack
   *  or Docker Desktop quit, which also kills every container). Empty the route
   *  table so the UI stops showing now-dead containers as running. Recovery
   *  comes via resumeData() once Docker is reachable again. */
  markDataLost(): void {
    this.discovery?.routes.replaceAll([]);
  }

  /** Re-establish the data layer after a Docker outage. Reuses the existing
   *  Discovery (and its RouteTable) when present so renderer route subscriptions
   *  stay valid; otherwise does a fresh start. Throws if Docker is still down. */
  async resumeData(): Promise<void> {
    if (!(await this.docker.ping())) {
      throw new Error('Cannot reach the Docker daemon.');
    }
    if (this.discovery) {
      await this.discovery.resume();
    } else {
      this.discovery = new Discovery(this.docker, this.config);
      await this.discovery.start();
    }
    this.dataStarted = true;
  }

  /** Start DNS + reverse proxy. Records (not throws) bind errors into status.
   *  DNS and proxy start independently: if the proxy can't bind privileged
   *  ports, a successfully-started DNS server stays up (and vice-versa), so
   *  the failure degrades to "proxy off" rather than losing resolution too. */
  async startProxy(): Promise<boolean> {
    if (this.proxyStarted) return true;
    if (!this.discovery) await this.startData();

    // DNS (unprivileged high port) — independent of the proxy.
    if (!this.dns) {
      try {
        const dns = new DnsServer(this.config);
        await dns.start();
        this.dns = dns;
      } catch (err) {
        this.proxyError = `DNS: ${(err as Error).message}`;
        return false;
      }
    }

    // Reverse proxy (80/443 — may need elevation).
    try {
      this.certs.ensureCa();
      const proxy = new ProxyServer(this.config, this.discovery!.routes, this.certs);
      await proxy.start();
      this.proxy = proxy;
      this.proxyStarted = true;
      this.proxyError = undefined;
      return true;
    } catch (err) {
      this.proxyError = (err as Error).message;
      return false;
    }
  }

  /** Start both layers (used by the CLI). */
  async start(): Promise<void> {
    await this.startData();
    if (!(await this.startProxy())) {
      throw new Error(this.proxyError ?? 'Failed to start proxy');
    }
  }

  async stopProxy(): Promise<void> {
    await this.proxy?.stop();
    await this.dns?.stop();
    this.proxy = undefined;
    this.dns = undefined;
    this.proxyStarted = false;
  }

  async stop(): Promise<void> {
    await this.stopProxy();
    // Drop our hosts-file entries so stale names don't point at a dead proxy.
    clearHosts();
  }

  /** Subscribe to live route-table changes; returns an unsubscribe fn. */
  onRoutesChanged(listener: (routes: Route[]) => void): () => void {
    const table = this.discovery?.routes;
    if (!table) return () => {};
    table.on('change', listener);
    return () => table.off('change', listener);
  }

  listRoutes(): Route[] {
    return this.discovery?.routes.list() ?? [];
  }

  async status(): Promise<EngineStatus> {
    return {
      dataReady: this.dataStarted,
      proxyRunning: this.proxyStarted,
      dockerConnected: await this.docker.ping(),
      proxyError: this.proxyError,
      containerIpsRoutable: this.discovery?.containerIpsRoutable ?? false,
      config: this.config,
      routes: this.listRoutes(),
    };
  }
}
