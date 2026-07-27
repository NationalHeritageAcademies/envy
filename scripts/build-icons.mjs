// Rasterize the green-eye SVG to the master PNG electron-builder needs.
// electron-builder derives .icns (mac), .ico (Windows), and .png (Linux)
// from build/icon.png at package time, so one 1024² master covers all three.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(root, 'build/icon.svg'), 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
writeFileSync(resolve(root, 'build/icon.png'), png);
console.log('Wrote build/icon.png (1024×1024)');
