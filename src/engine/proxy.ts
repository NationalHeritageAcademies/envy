import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import type { Socket } from 'node:net';
import httpProxy from 'http-proxy';
import type { EngineConfig } from './config.js';
import type { RouteTable } from './routes.js';
import type { CertProvider } from './tls.js';

function hostFromHeader(header: string | undefined): string {
  return (header ?? '').split(':')[0]?.toLowerCase() ?? '';
}

function noRoutePage(host: string, known: string[]): string {
  const list = known.length
    ? known.map((h) => `<li><a href="https://${h}/">${h}</a></li>`).join('')
    : '<li><em>No running containers with published ports yet.</em></li>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Envy</title>
<style>body{font:15px -apple-system,system-ui,sans-serif;max-width:40rem;margin:4rem auto;color:#222}
h1{font-size:1.4rem}code{background:#f3f3f3;padding:.1rem .3rem;border-radius:4px}ul{line-height:1.8}</style></head>
<body><h1>Envy</h1><p>No container is mapped to <code>${host}</code>.</p>
<p>Known services:</p><ul>${list}</ul></body></html>`;
}

/**
 * Host-header reverse proxy. Plaintext on httpPort, TLS on httpsPort. The TLS
 * cert is chosen per-connection from the SNI hostname — the proxy mints (and
 * caches) a leaf for that exact name, signed by the trusted CA — so any
 * hostname validates without wildcards. Routes each request to the container
 * the {@link RouteTable} maps its hostname to; unknown hosts get a friendly
 * index instead of a crash.
 *
 * On a port conflict it rejects with a clear message rather than fighting
 * whatever already holds the port — part of staying a good citizen alongside
 * other tools on the machine.
 */
export class ProxyServer {
  private readonly proxy = httpProxy.createProxyServer({ xfwd: true, ws: true });
  private httpServer?: http.Server;
  private httpsServer?: https.Server;

  constructor(
    private readonly config: EngineConfig,
    private readonly routes: RouteTable,
    private readonly certs: CertProvider,
  ) {
    this.proxy.on('error', (_err, _req, res) => {
      // `res` is a ServerResponse for normal requests; for ws upgrades it's a
      // socket, which has no writeHead — guard before using it.
      if (res && 'writeHead' in res && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('Envy: upstream container is not responding.');
      } else if (res && 'destroy' in res) {
        (res as Socket).destroy();
      }
    });
  }

  private handle = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const host = hostFromHeader(req.headers.host);
    const route = this.routes.find(host);
    if (!route) {
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
      res.end(noRoutePage(host, this.routes.list().map((r) => r.host)));
      return;
    }
    this.proxy.web(req, res, { target: `${route.upstream}://${route.target.host}:${route.target.port}` });
  };

  private handleUpgrade = (req: http.IncomingMessage, socket: Socket, head: Buffer): void => {
    const route = this.routes.find(hostFromHeader(req.headers.host));
    if (!route) {
      socket.destroy();
      return;
    }
    this.proxy.ws(req, socket, head, {
      target: `${route.upstream}://${route.target.host}:${route.target.port}`,
    });
  };

  async start(): Promise<void> {
    this.httpServer = http.createServer(this.handle);
    this.httpServer.on('upgrade', this.handleUpgrade);

    // Default cert (used only when a client sends no SNI); real browser
    // requests carry SNI and are answered per-host by the callback below.
    const fallback = this.certs.leafFor(this.config.domains[0] ?? 'localhost');
    this.httpsServer = https.createServer(
      {
        key: fallback.key,
        cert: fallback.cert,
        SNICallback: (servername, cb) => {
          try {
            const creds = this.certs.leafFor(servername || (this.config.domains[0] ?? 'localhost'));
            cb(null, tls.createSecureContext({ key: creds.key, cert: creds.cert }));
          } catch (err) {
            cb(err as Error);
          }
        },
      },
      this.handle,
    );
    this.httpsServer.on('upgrade', this.handleUpgrade);

    await this.listen(this.httpServer, this.config.httpPort);
    await this.listen(this.httpsServer, this.config.httpsPort);
  }

  private listen(server: http.Server | https.Server, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use. Stop whatever holds it, or set ENVY_HTTP_PORT / ENVY_HTTPS_PORT to free ports.`));
        } else if (err.code === 'EACCES') {
          reject(new Error(`Permission denied binding port ${port}. Ports below 1024 need elevated privileges — run the engine with sudo, or use high ports via ENVY_HTTP_PORT / ENVY_HTTPS_PORT.`));
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(port, this.config.bindAddress, () => {
        server.off('error', onError);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await Promise.all([
      this.httpServer && new Promise<void>((r) => this.httpServer!.close(() => r())),
      this.httpsServer && new Promise<void>((r) => this.httpsServer!.close(() => r())),
    ]);
    this.proxy.close();
  }
}
