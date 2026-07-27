import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    plugins: [
      // Melodic components ship runtime assets (fonts/icons) that must sit
      // next to the bundled renderer, same as Coax does it.
      viteStaticCopy({
        targets: [
          {
            src: resolve(__dirname, 'node_modules/@melodicdev/components/assets/*'),
            dest: '.',
          },
        ],
      }),
    ],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/ui/index.html') } } },
  },
});
