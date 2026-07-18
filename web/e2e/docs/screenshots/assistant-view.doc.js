// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Assistant View Documentation Screenshots
 *
 * Captures the LLM assistant chat surface in its empty / prompt state. The SSE
 * streaming response is intentionally not mocked — we document the entry UI.
 */

test.describe('Assistant View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    await page.goto('/#assistant');
    await page.waitForLoadState('domcontentloaded');
  });

  test('assistant-overview', async ({ screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('assistant-overview', {
      description: 'AI assistant chat interface with suggested prompts',
    });
  });
});
