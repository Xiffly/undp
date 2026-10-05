import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'dist-stale/**', 'dist-stale-*/**', 'node_modules/**'],
  },
});
