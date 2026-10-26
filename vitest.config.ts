import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node-only for now; the web app gets its own jsdom project in M4.
    include: ['{packages,apps}/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
