// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for SkysPy web e2e tests
 * @see https://playwright.dev/docs/test-configuration
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
        ['list']
      ]
    : [
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['list']
      ],

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

  // Configure projects for major browsers
  // Note: Only Chromium is enabled by default. To test other browsers,
  // install them with: npx playwright install firefox webkit
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    // Uncomment to enable Firefox/WebKit testing (requires: npx playwright install)
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //   },
    // },
    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //   },
    // },
    // {
    //   name: 'mobile-chrome',
    //   use: {
    //     ...devices['Pixel 5'],
    //   },
    // },
    // {
    //   name: 'mobile-safari',
    //   use: {
    //     ...devices['iPhone 12'],
    //   },
    // },
  ],

  // Run your local dev server before starting the tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
