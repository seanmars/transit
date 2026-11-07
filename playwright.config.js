import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testIgnore: ['**/jest-unit/**'],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
});
