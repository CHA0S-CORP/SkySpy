// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for SkysPy integration tests.
 *
 * These tests run against the real Django API instead of mocked responses.
 *
 * Prerequisites:
 *   docker-compose -f web/e2e/integration/docker-compose.test.yml up -d
 *
 * Run:
 *   npm run test:e2e:integration
 *
 * Or manually:
 *   npx playwright test --config=e2e/integration/playwright.integration.config.js
 */
export default defineConfig({
  // Directory containing integration test files
  testDir: './',

  // Test file pattern
  testMatch: '**/*.spec.js',

  // Run tests in files sequentially (integration tests may have dependencies)
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests to handle potential flakiness
  retries: process.env.CI ? 2 : 1,

  // Limit workers for integration tests (shared database state)
  workers: 1,

  // Reporter configuration
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: '../../playwright-report-integration' }],
        ['junit', { outputFile: '../../test-results-integration/junit.xml' }],
        ['list']
      ]
    : [
        ['html', { outputFolder: '../../playwright-report-integration', open: 'never' }],
        ['list']
      ],

  // Shared settings for all projects
  use: {
    // Base URL for navigation (frontend)
    baseURL: process.env.INTEGRATION_WEB_URL || 'http://localhost:3000',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshots on failure
    screenshot: 'only-on-failure',

    // Video recording on failure
    video: 'retain-on-failure',

    // Longer timeouts for integration tests (real API calls)
    actionTimeout: 60000,
    navigationTimeout: 60000,

    // Extra HTTP headers for API calls
    extraHTTPHeaders: {
      'Accept': 'application/json',
    },
  },

  // Global test timeout - longer for integration tests
  timeout: 120000,

  // Expect timeout for assertions
  expect: {
    timeout: 30000,
  },

  // Output directory for test artifacts
  outputDir: '../../test-results-integration',

  // Configure projects - Desktop Chrome only for integration tests
  projects: [
    {
      name: 'integration-chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  // Global setup - wait for services to be healthy
  globalSetup: require.resolve('./global-setup.js'),

  // No web server - using docker-compose services
  // webServer: undefined,
});
