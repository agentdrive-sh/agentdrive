import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: { baseURL: 'http://localhost:3101', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node test/fixture-api.mjs', url: 'http://127.0.0.1:8791/health', reuseExistingServer: false },
    {
      command: 'pnpm exec next dev --port 3101',
      url: 'http://localhost:3101/login',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:8791' },
    },
  ],
});
