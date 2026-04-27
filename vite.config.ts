import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  root: '.',
  // Production builds are deployed to GitHub Pages at
  // https://<owner>.github.io/mlb-screen-saver/, so all asset URLs need the
  // repo-name prefix. The dev server stays at root so `npm run dev` is
  // unaffected.
  base: command === 'build' ? '/mlb-screen-saver/' : '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        audition: resolve(__dirname, 'audition.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
}));
