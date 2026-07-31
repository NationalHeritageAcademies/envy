import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Plugin } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Strip `crossorigin` from the emitted <script>/<link> tags in index.html.
// The attribute is only meaningful for HTTP CORS; under file:// (the packaged
// app) it flags the bundled stylesheet as not origin-clean, so anything that
// reads `link.sheet.cssRules` gets a SecurityError instead of the actual rules.
// It serves no purpose for assets that ship inside the .app bundle.
const stripCrossOriginPlugin: Plugin = {
  name: 'strip-crossorigin',
  enforce: 'post',
  transformIndexHtml(html) {
    return html.replace(/\s+crossorigin(?=[\s>])/g, '');
  },
};

const alias = {
  '@engine': resolve(__dirname, 'src/engine'),
  '@ipc': resolve(__dirname, 'src/ipc'),
  '@app': resolve(__dirname, 'src/app'),
  '@ui': resolve(__dirname, 'src/ui'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/app/main.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/app/preload.ts') } } },
  },
  renderer: {
    resolve: { alias },
    root: resolve(__dirname, 'src/ui'),
    // The Angular renderer is compiled by Analog's Vite plugin — the same
    // plugin NHA.Frontend uses — so JIT/AOT behavior matches what we run
    // elsewhere. tokens.css ships verbatim via src/ui/public (Vite's default
    // publicDir for this root) and is linked at runtime by bootstrap-styles.
    plugins: [angular(), stripCrossOriginPlugin],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/ui/index.html') } } },
  },
});
