// Uploads electron-builder release artifacts to a GitHub release.
//
// Uses the `gh` CLI (https://cli.github.com) with whatever auth `gh auth login`
// has established — no tokens in this repo. Creates a DRAFT release tagged
// v<version> if one doesn't exist yet, then uploads the artifacts and the
// electron-updater manifests (latest*.yml). Publish the draft on GitHub when
// you're ready; electron-updater only sees published releases.
//
// Usage:
//   npm run release          — package (mac/win/linux) + upload
//   npm run release:upload   — upload whatever already exists in dist/
//
// Files matched: .dmg, .exe, .AppImage, the -mac.zip auto-update
// artifact, their .blockmap counterparts, and the electron-builder
// auto-update manifests (latest*.yml). Anything else in dist/ (unpacked
// dirs, builder-debug.yml, .DS_Store) is skipped.

import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const REPO = 'NationalHeritageAcademies/envy';

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;

const RELEASE_PATTERNS = [
  /\.dmg$/,
  /\.dmg\.blockmap$/,
  /-mac\.zip$/,
  /-mac\.zip\.blockmap$/,
  /\.exe$/,
  /\.exe\.blockmap$/,
  /\.AppImage$/,
  /^latest.*\.yml$/,
];

const distDir = join(root, 'dist');
const entries = await readdir(distDir);
const files = [];
for (const name of entries) {
  if (!RELEASE_PATTERNS.some((rx) => rx.test(name))) continue;
  const full = join(distDir, name);
  const s = await stat(full);
  if (!s.isFile()) continue;
  files.push({ name, path: full, size: s.size });
}

if (files.length === 0) {
  console.error(`envy-release: no release artifacts in ${distDir}.`);
  console.error('  Did you run `npm run package:all` first?');
  process.exit(1);
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { cwd: root, encoding: 'utf8', ...opts });
}

// Create the draft release if the tag doesn't have one yet.
let exists = true;
try {
  gh(['release', 'view', tag, '--repo', REPO], { stdio: 'pipe' });
} catch {
  exists = false;
}
if (!exists) {
  console.log(`Creating draft release ${tag} on ${REPO}…`);
  gh(['release', 'create', tag, '--repo', REPO, '--draft', '--title', `Envy ${pkg.version}`, '--generate-notes']);
}

console.log(`Uploading ${files.length} file${files.length === 1 ? '' : 's'} to release ${tag}:`);
for (const f of files) {
  const mb = (f.size / (1024 * 1024)).toFixed(1);
  gh(['release', 'upload', tag, f.path, '--repo', REPO, '--clobber']);
  console.log(`  ✓ ${f.name.padEnd(36)} ${mb.padStart(8)} MB`);
}

console.log(`\nDone. ${files.length} file${files.length === 1 ? '' : 's'} uploaded to ${tag}.`);
if (!exists) {
  console.log(`The release is a DRAFT — publish it at https://github.com/${REPO}/releases when ready.`);
  console.log('Auto-update clients only see the release once it is published.');
}
