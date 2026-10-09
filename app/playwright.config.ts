import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { authToken, baseURL, databaseUrl } from './e2e/constants.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(process.cwd(), '.playwright-browsers');
const localLibraries = resolve(process.cwd(), '.playwright-deps/unpacked/usr/lib/x86_64-linux-gnu');
process.env.LD_LIBRARY_PATH = [localLibraries, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, screenshot: 'only-on-failure', trace: 'on-first-retry' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'small-chromium', testMatch: '**/picker.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 900, height: 700 } } },
  ],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      AUTH_URL: baseURL,
      AUTH_SECRET: 'saleshub-e2e-auth-secret-local-only',
      AUTH_GOOGLE_ID: 'unused-e2e-google-id',
      AUTH_GOOGLE_SECRET: 'unused-e2e-google-secret',
      E2E_AUTH_ENABLED: 'true',
      E2E_STORAGE_ENABLED: 'true',
      E2E_AUTH_TOKEN: authToken,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
