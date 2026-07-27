// Interactive version bump, run as the first step of `npm run release`.
//
// Shows the current version, asks for patch / minor / major (or skip), and
// writes the new value into package.json. It does NOT commit or create a git
// tag — it only edits package.json (equivalent to `npm version <type>
// --no-git-tag-version`). Commit when you're ready.
//
// Non-interactive environments (no TTY, or CI) skip the bump and release the
// current version unchanged, so this never blocks an automated run.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pkgPath = join(root, 'package.json');

const raw = await readFile(pkgPath, 'utf8');
const pkg = JSON.parse(raw);
const current = pkg.version;

const parsed = parseSemver(current);
if (!parsed) {
  console.error(`bump-version: package.json version "${current}" is not a plain x.y.z semver.`);
  console.error('  Bump it by hand, or release as-is. Skipping.');
  process.exit(0);
}

if (!stdin.isTTY) {
  console.log(`bump-version: no interactive terminal — releasing current version ${current} unchanged.`);
  process.exit(0);
}

const next = {
  patch: `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`,
  minor: `${parsed.major}.${parsed.minor + 1}.0`,
  major: `${parsed.major + 1}.0.0`,
};

console.log(`Current version: ${current}\n`);
console.log(`  patch  →  ${next.patch}`);
console.log(`  minor  →  ${next.minor}`);
console.log(`  major  →  ${next.major}`);
console.log(`  skip   →  keep ${current}\n`);

const rl = createInterface({ input: stdin, output: stdout });
let choice;
while (true) {
  const answer = (await rl.question('Bump which? [patch/minor/major/skip] ')).trim().toLowerCase();
  if (answer === '' || answer === 'skip' || answer === 's') {
    choice = 'skip';
    break;
  }
  const norm = { p: 'patch', patch: 'patch', mi: 'minor', minor: 'minor', ma: 'major', major: 'major' }[answer];
  if (norm) {
    choice = norm;
    break;
  }
  console.log('  Please answer patch, minor, major, or skip.');
}
rl.close();

if (choice === 'skip') {
  console.log(`Keeping version ${current}.`);
  process.exit(0);
}

const newVersion = next[choice];
pkg.version = newVersion;
// Preserve trailing newline if the original had one.
const trailing = raw.endsWith('\n') ? '\n' : '';
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}${trailing}`, 'utf8');
console.log(`Bumped ${current} → ${newVersion} (package.json only; no commit/tag).`);

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}
