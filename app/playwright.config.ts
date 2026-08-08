import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BKEMO_UI_BASE_URL || 'http://localhost:1111';
const reuseServer = !process.env.CI;

/**
 * Browser UI smoke lane for the web client (also covers the React surface
 * shared with the macOS Tauri shell). Requires a running local server unless
 * BKEMO_UI_SKIP_WEBSERVER=1 and BKEMO_UI_BASE_URL point at an existing origin.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: process.env.BKEMO_UI_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'bash ../scripts/run-dev.sh',
        url: baseURL,
        reuseExistingServer: reuseServer,
        timeout: 180_000,
      },
  projects: [
    { name: 'web-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
