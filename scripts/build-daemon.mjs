// Bundle the Envy daemon into a single self-contained CJS file so it can run
// under any Node-compatible runtime (system node, or Electron with
// ELECTRON_RUN_AS_NODE=1) from a root-owned location with no node_modules
// alongside it. All pure-JS deps (dockerode, dns2, node-forge, http-proxy)
// are bundled in; Node built-ins stay external.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ssh2 is an optional dockerode transport we never use (we talk over the local
// socket), but docker-modem require()s it unconditionally at import time. The
// daemon runs from a root-owned location with no node_modules, so a bare
// external require throws MODULE_NOT_FOUND and kills the daemon. Stub these
// modules to an empty object instead — the require resolves, the unused SSH
// transport stays out, and no native bits get bundled.
const stubOptionalDeps = {
  name: 'stub-optional-deps',
  setup(b) {
    b.onResolve({ filter: /^(ssh2|cpu-features)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub-optional',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub-optional' }, () => ({
      contents: 'module.exports = {};',
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [resolve(root, 'src/daemon/main.ts')],
  outfile: resolve(root, 'out/daemon/envyd.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  plugins: [stubOptionalDeps],
  banner: { js: '/* Envy daemon — generated bundle, do not edit. */' },
  logLevel: 'info',
});

console.log('Built out/daemon/envyd.cjs');
