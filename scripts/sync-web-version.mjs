// Point the marketing site's download links at the current app version.
//
// Run as part of `npm run release` (right after the version bump) so the
// website in web/ never falls behind the binaries published to GitHub
// Releases. Reads the version from package.json and rebuilds the download
// URLs in web/config/config.json as
//   https://github.com/<repo>/releases/download/v<version>/<filename>
// from a per-platform filename template.
//
// We rebuild rather than regex-swap the version because the Windows filename is
// URL-encoded ("Envy%20Setup%20x.y.z.exe") and the %20 digits collide with a
// naive \d+\.\d+\.\d+ match. Idempotent: a no-op when already current.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Artifact filenames as they appear on GitHub Releases. Note: electron-builder
// emits "Envy Setup x.y.z.exe" locally, but GitHub rewrites spaces to dashes
// on upload — the released asset is "Envy-Setup-x.y.z.exe".
const FILENAME_FOR = {
  macos: (v) => `Envy-${v}-universal.dmg`,
  windows: (v) => `Envy-Setup-${v}.exe`,
};

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`sync-web-version: package.json version "${version}" is not a plain x.y.z semver. Skipping.`);
  process.exit(0);
}

const configPath = join(root, 'web', 'config', 'config.json');
const raw = await readFile(configPath, 'utf8');
const config = JSON.parse(raw);

const downloads = config?.links?.downloads;
if (!downloads || typeof downloads !== 'object') {
  console.error('sync-web-version: web/config/config.json has no links.downloads object. Skipping.');
  process.exit(0);
}

const RELEASE_BASE = 'https://github.com/MelodicDevelopment/envy/releases/download';

let changed = false;
for (const [platform, url] of Object.entries(downloads)) {
  const filename = FILENAME_FOR[platform];
  if (!filename) {
    console.warn(`sync-web-version: no filename template for platform "${platform}" — left unchanged.`);
    continue;
  }
  const next = `${RELEASE_BASE}/v${version}/${filename(version)}`;
  if (next !== url) {
    downloads[platform] = next;
    changed = true;
    console.log(`  ${platform}: → ${next}`);
  }
}

if (!changed) {
  console.log(`sync-web-version: download links already at ${version}. No change.`);
  process.exit(0);
}

// Preserve the file's 4-space indent + trailing newline.
const trailing = raw.endsWith('\n') ? '\n' : '';
await writeFile(configPath, `${JSON.stringify(config, null, 4)}${trailing}`, 'utf8');
console.log(`sync-web-version: marketing-site downloads pinned to ${version}.`);
