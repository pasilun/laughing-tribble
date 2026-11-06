import { defineConfig, devices } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

// The app under test keeps its data in a folder of its own, emptied when a run starts (e2e/global-setup.ts), never in the
// developer's .data and never in Blob or Turso: a test run leaves nothing behind and cannot touch real plans.
export const E2E_DATA = process.env.PLAN_E2E_DATA ?? path.join(os.tmpdir(), 'planstudio-e2e-data')

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  // Two kinds of test are left out of a plain `npm test`/CI run:
  //  @slow     scan readers, golden score, contrast sweeps (about two thirds of the run time): skipped by `npm test`,
  //            run by CI and `npm run test:all`.
  //  @browser  the tests that open a page: skipped by CI (it installs no browser), run by `npm test` and `test:all`.
  grepInvert: process.env.PW_ALL ? undefined : process.env.CI ? /@browser/ : /@slow/,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    // Use a preinstalled browser when the bundled one isn't available.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },

  // iPhone is the primary platform, so tests run at an iPhone viewport.
  // Chromium engine (keeps CI to a single browser install; webkit/Safari
  // fidelity is a separate concern) with iPhone metrics + touch.
  projects: [
    {
      name: 'iphone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  // In CI the built app is started (what is deployed); locally the dev server. A cold start can take a minute or two.
  webServer: {
    command: process.env.CI ? 'npm run build && npm run start -- --keepAliveTimeout 120000' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { PLAN_DATA_DIR: E2E_DATA, PLAN_STORE: 'fs', PLAN_USERS: '', PLAN_ADMINS: '' },
  },
})
