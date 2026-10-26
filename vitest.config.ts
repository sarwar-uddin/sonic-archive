import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts'],
        },
      },
      // The web app's tests run in jsdom; see apps/web/vite.config.ts.
      './apps/web',
    ],
  },
});
