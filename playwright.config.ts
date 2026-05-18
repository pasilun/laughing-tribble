import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  // iPhone is the primary platform, so the loop verifies mobile-first:
  // every interactive verification and generated _verified-* regression
  // test runs at an iPhone viewport. Chromium engine (keeps CI to a single
  // browser install; webkit/Safari fidelity is a separate concern) with
  // iPhone metrics + touch — this is what catches horizontal overflow /
  // clipped-on-mobile layout bugs the old desktop project missed.
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

  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
      },
})
