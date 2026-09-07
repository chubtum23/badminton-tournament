import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  // Next dev compiles each route on first visit; a cold compile under load can take longer
  // than the 5s Playwright default, so give expect() assertions more room.
  expect: { timeout: 15_000 },
  retries: 0,
  // Both specs share one Next dev server and one local Supabase instance; running them
  // concurrently causes dev-server HMR/runtime errors and DB contention, so serialize.
  workers: 1,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx next dev -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
