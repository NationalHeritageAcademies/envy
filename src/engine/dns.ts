import dns2 from 'dns2';
import type { EngineConfig } from './config.js';

const { Packet } = dns2;

/** The server object returned by dns2 (its types live in an `export =` namespace). */
type Dns2Server = ReturnType<typeof dns2.createServer>;

/**
 * A tiny authoritative DNS server for `*.<tld>` only. macOS routes just
 * `envy.local` queries here (via /etc/resolver/envy.local), so anything we
 * receive is ours to answer — every name resolves to the proxy's address.
 *
 * It binds a high, unprivileged port; the resolver file carries the matching
 * `port` line, so resolving names never requires root.
 */
export class DnsServer {
  private server?: Dns2Server;

  constructor(private readonly config: EngineConfig) {}

  async start(): Promise<void> {
    // Match any configured domain: its apex (e.g. `envy.local`) or any subdomain.
    const domains = this.config.domains.map((d) => d.toLowerCase());
    const owns = (name: string): boolean =>
      domains.some((d) => name === d || name.endsWith(`.${d}`));

    const server = dns2.createServer({
      udp: true,
      tcp: true,
      handle: (request, send) => {
        const response = Packet.createResponseFromRequest(request);
        const question = request.questions[0];
        if (question) {
          const name = question.name.toLowerCase();
          if (owns(name)) {
            // dns2 serializes plain answer objects at runtime; its type wants a
            // Resource class instance, so cast to the array's element type.
            response.answers.push({
              name: question.name,
              type: Packet.TYPE.A,
              class: Packet.CLASS.IN,
              ttl: 300,
              address: this.config.resolveTo,
            } as (typeof response.answers)[number]);
          }
        }
        void send(response);
      },
    });

    this.server = server;

    // dns2 binds udp + tcp sockets internally; their bind errors (e.g.
    // EADDRINUSE) surface as asynchronous 'error' events, NOT through the
    // listen() promise. Without a handler they become an uncaught exception
    // that crashes the process. Race listen() against the first 'error' so a
    // bind failure rejects cleanly (the caller records it as proxyError), then
    // keep a persistent handler so any late socket error degrades to a log.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
      server.on('error', (err: unknown) =>
        settle(err instanceof Error ? err : new Error(String(err))),
      );
      server
        .listen({
          udp: { port: this.config.dnsPort, address: this.config.bindAddress },
          tcp: { port: this.config.dnsPort, address: this.config.bindAddress },
        })
        .then(() => settle())
        .catch((err: unknown) => settle(err instanceof Error ? err : new Error(String(err))));
    });

    server.on('error', (err: unknown) => {
      console.error('Envy DNS error:', err instanceof Error ? err.message : err);
    });
  }

  async stop(): Promise<void> {
    await this.server?.close();
  }
}
