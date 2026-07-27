import { EventEmitter } from 'node:events';

/** A single hostname → container target mapping used by the reverse proxy. */
export interface Route {
  /** Fully-qualified host, e.g. `myapp.envy.local`. */
  readonly host: string;
  /** Short Docker container id (12 chars). */
  readonly containerId: string;
  /** Human container name (without the leading slash). */
  readonly containerName: string;
  /** Where to forward to — almost always loopback + a published host port. */
  readonly target: { host: string; port: number };
  /** Upstream scheme. We terminate TLS at the proxy and talk http to the container. */
  readonly upstream: 'http' | 'https';
}

/**
 * The live mapping of `*.envy.local` hostnames to running containers.
 * Discovery writes to it; the proxy reads from it; the UI subscribes to it.
 */
export class RouteTable extends EventEmitter {
  private routes = new Map<string, Route>();

  /** Replace the entire table (discovery rebuilds wholesale on each Docker event). */
  replaceAll(routes: Route[]): void {
    this.routes = new Map(routes.map((r) => [r.host.toLowerCase(), r]));
    this.emit('change', this.list());
  }

  /** Case-insensitive lookup by hostname (Host header is normalized first). */
  find(host: string): Route | undefined {
    return this.routes.get(host.toLowerCase());
  }

  list(): Route[] {
    return [...this.routes.values()].sort((a, b) => a.host.localeCompare(b.host));
  }
}
