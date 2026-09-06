import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

// Load apps/web/.env.local into process.env for integration tests (no dotenv dependency).
const envPath = path.resolve(__dirname, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
