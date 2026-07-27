# Contributing to Envy

Thanks for your interest in improving Envy! Bug reports, feature requests, and
pull requests are all welcome.

## Development setup

Prerequisites:

- **Node.js 20+** and npm
- A local **Docker engine** (Docker Desktop, OrbStack, or colima) — Envy talks
  to the standard local Docker socket

```bash
git clone https://github.com/MelodicDevelopment/envy.git
cd envy
npm install
npm run dev          # hot-reloading dev app
```

The dev app runs the full UI against your real Docker engine. Serving actual
`https://<name>.envy` URLs additionally requires the privileged background
daemon (DNS + proxy on ports 53/80/443) — the app walks you through installing
it with one native auth prompt when you click **Enable URLs**. You can develop
most features without it.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the app with hot reload |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint (don't run `--fix` blindly — one fixer can break the type check; always re-run typecheck after auto-fixing) |
| `npm test` | Run the vitest suite |
| `npm run build` | Build main/preload/renderer + the daemon bundle |
| `npm run package` | Package with electron-builder (current platform) |

See [docs/development.md](docs/development.md) for the full project layout,
packaging, and signing details.

## Running tests

```bash
npm test             # single run
npm run test:watch   # watch mode
```

Tests live next to the code they cover (`src/**/*.test.ts`). Engine logic
(discovery, hosts handling, TLS, domain validation) is the best-covered area —
please add tests there when you change behavior.

## Product boundary

Envy is deliberately a *focused* tool: containers in, trusted local HTTPS URLs
out, with a calm UI. PRs that turn it into a general Docker administration
suite (image builders, registry browsers, Kubernetes, remote hosts, swarm)
will be declined — open an issue first if you're unsure whether something
fits. Depth over breadth: better discovery, better routing, better platform
parity always fit.

## Pull requests

- Open an issue first for anything non-trivial, so we can agree on the
  approach before you invest time.
- Keep PRs focused — one change per PR.
- Make sure `npm run typecheck`, `npm run lint`, and `npm test` pass.
- Match the existing code style (the codebase favors small modules, explicit
  types at boundaries, and comments that explain *why*, not *what*).
- Describe what the change does and how you verified it, including the
  platform(s) you tested on — Envy ships on macOS, Windows, and Linux, and the
  daemon layer is platform-specific.

## Reporting bugs

Use the [bug report template](https://github.com/MelodicDevelopment/envy/issues/new/choose).
Please include your OS, Docker provider (Docker Desktop / OrbStack / colima),
Envy version, and steps to reproduce.

## Security issues

Please don't open public issues for vulnerabilities — follow
[SECURITY.md](SECURITY.md) (private reporting or support@melodic.dev).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
