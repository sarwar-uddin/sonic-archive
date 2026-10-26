import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The dev server, like the API, listens on loopback only (docs/safety.md, #6).
const API = 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // changeOrigin rewrites Host to the API's own address, which its Host
    // allowlist accepts.
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
