import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import angular from '@analogjs/vite-plugin-angular';

const __dirname = dirname(fileURLToPath(import.meta.url));

const alias = {
  '@engine': resolve(__dirname, 'src/engine'),
  '@ipc': resolve(__dirname, 'src/ipc'),
  '@app': resolve(__dirname, 'src/app'),
  '@ui': resolve(__dirname, 'src/ui'),
};

export default defineConfig({
  test: {
    projects: [
      // Engine / main-process tests — plain node, unchanged by the Angular port.
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      // Renderer component/service tests. Compiled by the same Analog Angular
      // plugin the app build uses (JIT mode so specs don't need AOT), run in
      // jsdom. The app is zoneless, so we skip Analog's zone-based
      // setup-vitest entirely — see src/ui/test-setup.ts.
      {
        plugins: [angular({ jit: true, tsconfig: resolve(__dirname, 'src/ui/tsconfig.spec.json') })],
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          // Globals so @testing-library/angular's auto-cleanup afterEach hook
          // registers itself between tests (it resets TestBed).
          globals: true,
          include: ['src/ui/**/*.spec.ts'],
          setupFiles: [resolve(__dirname, 'src/ui/test-setup.ts')],
        },
      },
    ],
  },
});
