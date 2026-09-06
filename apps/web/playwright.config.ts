import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  retries: 0,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx next dev -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
