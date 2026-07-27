#!/usr/bin/env node
import { Command } from 'commander';
import { Engine } from '../engine/engine.js';
import { loadConfig, saveDomains } from '../engine/config.js';
import { DockerClient } from '../engine/docker.js';

const program = new Command();

program
  .name('envy')
  .description('A clean container manager with automatic *.envy.local URLs.')
  .version('0.1.0');

program
  .command('ls')
  .alias('ps')
  .description('List containers and the Envy URL each maps to')
  .action(async () => {
    const config = loadConfig();
    const docker = new DockerClient();
    if (!(await docker.ping())) {
      console.error('Cannot reach Docker. Is Docker / OrbStack / Podman running?');
      process.exitCode = 1;
      return;
    }
    const containers = await docker.listContainers(true);
    if (containers.length === 0) {
      console.log('No containers.');
      return;
    }
    const primary = config.domains[0];
    const extra = config.domains.length - 1;
    for (const c of containers) {
      const dot = c.running ? '●' : '○';
      let url = '';
      if (c.running) {
        url = `  https://${c.name}.${primary}`;
        if (extra > 0) url += ` (+${extra} domain${extra > 1 ? 's' : ''})`;
      }
      console.log(`${dot} ${c.name.padEnd(24)} ${c.state.padEnd(9)} ${c.image}${url}`);
    }
  });

program
  .command('images')
  .description('List local images')
  .action(async () => {
    const docker = new DockerClient();
    for (const img of await docker.listImages()) {
      console.log(`${(img.tags[0] ?? '<none>').padEnd(40)} ${(img.size / 1e6).toFixed(1)} MB`);
    }
  });

program
  .command('up <id>')
  .description('Start a container')
  .action(async (id: string) => {
    await new DockerClient().start(id);
    console.log(`Started ${id}`);
  });

program
  .command('down <id>')
  .description('Stop a container')
  .action(async (id: string) => {
    await new DockerClient().stop(id);
    console.log(`Stopped ${id}`);
  });

program
  .command('pull <image>')
  .description('Pull an image')
  .action(async (image: string) => {
    process.stdout.write(`Pulling ${image} `);
    await new DockerClient().pull(image, (p) => {
      if (p.status === 'Downloading' || p.status === 'Extracting') process.stdout.write('.');
    });
    console.log(' done');
  });

program
  .command('engine')
  .description('Run the DNS + reverse-proxy engine in the foreground')
  .action(async () => {
    const engine = new Engine();
    const c = engine.config;

    try {
      await engine.start();
    } catch (err) {
      console.error(`\nFailed to start engine: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }

    console.log('Envy engine running.');
    console.log(`  Domains        ${c.domains.map((d) => `*.${d}`).join('  ')}`);
    console.log(`  DNS            ${c.bindAddress}:${c.dnsPort} (udp/tcp) → ${c.resolveTo}`);
    console.log(`  HTTP proxy     ${c.bindAddress}:${c.httpPort}`);
    console.log(`  HTTPS proxy    ${c.bindAddress}:${c.httpsPort}`);
    console.log(`  Local CA       ${engine.caCertificatePath}`);
    console.log('');

    const render = (routes: { host: string; containerName: string; target: { host: string; port: number } }[]) => {
      if (routes.length === 0) {
        console.log('  (no running containers with published ports)');
        return;
      }
      console.log('  Routes:');
      for (const r of routes) {
        console.log(`    https://${r.host}  →  ${r.target.host}:${r.target.port}  (${r.containerName})`);
      }
    };

    const status = await engine.status();
    render(status.routes);
    engine.onRoutesChanged((routes) => {
      console.log('\n[routes changed]');
      render(routes);
    });

    const shutdown = async () => {
      console.log('\nStopping engine…');
      await engine.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('status')
  .description('Show engine configuration and discovered routes')
  .action(async () => {
    const engine = new Engine();
    await engine.startData().catch(() => {});
    console.log(JSON.stringify(await engine.status(), null, 2));
  });

const domains = program.command('domains').description('Manage the domains Envy serves (e.g. envy.local, melodic.local)');

domains
  .command('ls', { isDefault: true })
  .description('List configured domains')
  .action(() => {
    const config = loadConfig();
    config.domains.forEach((d, i) => console.log(`${i === 0 ? '*' : ' '} *.${d}`));
  });

domains
  .command('add <domain...>')
  .description('Add one or more domains')
  .action((toAdd: string[]) => {
    const config = loadConfig();
    const next = saveDomains(config.dataDir, [...config.domains, ...toAdd]);
    console.log(`Domains: ${next.map((d) => `*.${d}`).join(', ')}`);
    console.log('Restart the engine and re-run scripts/setup-macos.sh to apply (new resolver files + cert).');
  });

domains
  .command('rm <domain>')
  .description('Remove a domain')
  .action((domain: string) => {
    const config = loadConfig();
    const next = saveDomains(
      config.dataDir,
      config.domains.filter((d) => d !== domain.toLowerCase().replace(/^\.+|\.+$/g, '')),
    );
    console.log(`Domains: ${next.map((d) => `*.${d}`).join(', ')}`);
    console.log('Restart the engine and re-run scripts/setup-macos.sh --uninstall for the removed domain.');
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
