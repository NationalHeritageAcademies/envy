// Rasterize the DMG installer background SVG to background.png (+@2x retina).
// electron-builder picks up build/background.png automatically and uses the
// @2x variant on Retina displays.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(root, 'build/dmg-background.svg'), 'utf8');

for (const [name, width] of [['background.png', 660], ['background@2x.png', 1320]]) {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true },
  }).render().asPng();
  writeFileSync(resolve(root, 'build', name), png);
  console.log(`Wrote build/${name} (${width}px wide)`);
}
