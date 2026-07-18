// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Login View Documentation Screenshots
 *
 * Captures the login form. Auth is disabled (public mode) by default in the
 * shared mocks, so we override /auth/config to private mode here to force the
 * login screen to render.
 */

test.describe('Login View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();

    // Override the public-mode auth config so the login form is shown.
    await docMockApi.mock('/auth/config', {
      auth_enabled: true,
      auth_mode: 'private',
      oidc_enabled: false,
    });

    await screenshotState.setupForScreenshot();

    await page.goto('/#login');
    await page.waitForLoadState('domcontentloaded');
  });

  test('login-form', async ({ screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('login-form', {
      description: 'Login screen with credential form',
    });
  });
});
