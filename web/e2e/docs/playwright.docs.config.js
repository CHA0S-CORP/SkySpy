// @ts-check
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Playwright configuration for documentation screenshot generation
 *
 * This config extends the base Playwright setup with:
 * - Sequential execution for consistent timing
 * - Video recording always on for animation capture
 * - Three viewport projects: desktop, tablet, mobile
 * - Custom output directory for documentation assets
 *
 * Usage:
 * - npm run docs:screenshots        # Desktop only
 * - npm run docs:screenshots:all    # All viewports
 * - npm run docs:animations         # Record animations
 * - npm run docs:generate           # Full pipeline
 */
export default defineConfig({
  // Directory containing doc screenshot tests (relative to this config file)
  testDir: '.',

  // Test files pattern - screenshots use .doc.js, animations use .anim.js
  testMatch: ['**/*.doc.js', '**/*.anim.js'],

  // Sequential execution for consistent timing and state
  fullyParallel: false,
  workers: 1,

  // No retries for documentation - we want consistent results
  retries: 0,

  // Don't fail on test.only - useful during development
  forbidOnly: false,

  // Reporter - minimal output, focus on artifacts
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(__dirname, 'report'), open: 'never' }],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for navigation
    baseURL: 'http://localhost:3000',

    // Always record video for animation capture
    video: 'on',

    // Always capture screenshots
    screenshot: 'on',

    // Trace off: doc runs only need video/screenshots, and trace-artifact
    // finalization was racing the temp dir (ENOENT) and aborting video save.
    trace: 'off',

    // Longer timeouts for complex animations
    actionTimeout: 45000,
    navigationTimeout: 45000,

    // Disable animations for consistent screenshots (overridden for animation tests)
    // reducedMotion: 'reduce',
  },

  // Global test timeout - allow time for complex scenarios
  timeout: 120000,

  // Expect timeout for assertions
  expect: {
    timeout: 15000,
  },

  // Output directory for test artifacts (absolute path)
  outputDir: path.join(__dirname, 'output'),

  // Configure projects for different viewports
  projects: [
    // Desktop - 1920x1080 at 2x device pixel ratio for crisp screenshots
    {
      name: 'desktop',
      use: {
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 2,
        isMobile: false,
        hasTouch: false,
      },
    },

    // Tablet - iPad viewport
    {
      name: 'tablet',
      use: {
        ...devices['iPad (gen 7)'],
        deviceScaleFactor: 2,
      },
    },

    // Mobile - iPhone 12 viewport
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 12'],
        deviceScaleFactor: 2,
      },
    },
  ],

  // Run local dev server before starting tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
