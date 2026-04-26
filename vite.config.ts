import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});
