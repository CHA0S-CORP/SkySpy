// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for SkysPy web e2e tests
 * @see https://playwright.dev/docs/test-configuration
 *
 * Browser Projects:
 * - chromium: Default desktop Chrome testing (default for regular runs)
 * - firefox: Desktop Firefox testing
 * - webkit: Desktop Safari testing
 * - mobile-chrome: Android mobile viewport (Pixel 5)
 * - mobile-safari: iOS mobile viewport (iPhone 12)
 * - full: Runs all browsers (use with --project=full)
 *
 * Usage:
 * - npm run test:e2e                    # Runs chromium only (default)
 * - npx playwright test --project=firefox
 * - npx playwright test --project=webkit
 * - npx playwright test --project=mobile-chrome
 * - npx playwright test --project=mobile-safari
 * - npx playwright test --project=chromium --project=firefox --project=webkit  # All desktop
 *
 * To install all browsers: npx playwright install
 */
export default defineConfig({
  // Directory containing test files
  testDir: './e2e/tests',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests to handle flaky behavior
  retries: process.env.CI ? 2 : 1,

  // Limit parallel workers for test stability
  workers: process.env.CI ? 1 : 2,

  // Reporter configuration
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results/junit.xml' }],
        ['list'],
      ]
    : [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

  // Shared settings for all projects
  use: {
    // Base URL for navigation
    baseURL: 'http://localhost:3000',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshots on failure
    screenshot: 'only-on-failure',

    // Video recording on failure
    video: 'retain-on-failure',

    // Action timeout - 30 seconds
    actionTimeout: 30000,

    // Navigation timeout
    navigationTimeout: 30000,
  },

  // Global test timeout - 60 seconds
  timeout: 60000,

  // Expect timeout for assertions
  expect: {
    timeout: 10000,
  },

  // Output directory for test artifacts
  outputDir: 'test-results',

  // Configure projects for major browsers and viewports
  projects: [
    // Desktop Browsers
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
      },
    },

    // Mobile Viewports
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
      },
    },
    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 12'],
      },
    },

    // Additional mobile viewports for comprehensive testing
    {
      name: 'mobile-android-landscape',
      use: {
        ...devices['Pixel 5 landscape'],
      },
    },
    {
      name: 'mobile-ios-landscape',
      use: {
        ...devices['iPhone 12 landscape'],
      },
    },

    // Tablet viewports
    {
      name: 'tablet-ipad',
      use: {
        ...devices['iPad (gen 7)'],
      },
    },
    {
      name: 'tablet-ipad-landscape',
      use: {
        ...devices['iPad (gen 7) landscape'],
      },
    },
  ],

  // Run your local dev server before starting the tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    // In CI the docker test stack already serves the app on :3000
    // (skyspy-dashboard-dev); reuse it instead of starting a second Vite that
    // collides on the port. Locally this reuses a running dev server or starts
    // one if the port is free.
    reuseExistingServer: true,
    timeout: 120000,
  },
});
