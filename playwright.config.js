import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

if (!process.env.BASE_URL || !process.env.STUDIO_PASSWORD) {
  throw new Error('Missing BASE_URL or STUDIO_PASSWORD — check .env.local');
}

export default defineConfig({
  testDir:     './tests',
  fullyParallel: false,          // tests share one test week, run sequentially
  workers:     1,
  retries:     0,
  reporter:    [['list']],
  use: {
    baseURL:             process.env.BASE_URL,
    trace:               'retain-on-failure',
    screenshot:          'only-on-failure',
    actionTimeout:       10_000,
    navigationTimeout:   15_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
