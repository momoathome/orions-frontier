import { defineConfig, devices } from '@playwright/test';

/** Smoke test against the running dev stack (`npm run dev`); E2E_BASE_URL points it elsewhere. */
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.e2e.ts',
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
