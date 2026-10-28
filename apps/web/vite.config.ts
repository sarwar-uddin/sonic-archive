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
    // Host is forwarded unchanged (127.0.0.1:5173): the API's Host allowlist
    // checks only the hostname, and the write guard needs Host to match the
    // page's Origin. changeOrigin would break every settings action.
    proxy: { '/api': { target: API } },
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
