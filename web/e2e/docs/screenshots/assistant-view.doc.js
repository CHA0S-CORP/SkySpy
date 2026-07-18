// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Assistant View Documentation Screenshots
 *
 * Captures the LLM assistant chat surface. The SSE streaming response is
 * intentionally not mocked — we document the entry UI (empty state) and the
 * composer with a real question typed in (prompt state).
 */

const SAMPLE_QUESTION = 'What military aircraft are near LAX right now?';

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

  test('assistant-prompt', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    // Type a question into the composer so the docs show the assistant being
    // asked something (not just the empty entry state). Not submitted — the SSE
    // response is unmocked, so we capture the ready-to-send prompt.
    const input = page.locator('.v2-asst__input, input[aria-label="Assistant query"]').first();
    await input.fill(SAMPLE_QUESTION);
    await page.waitForTimeout(200);

    await screenshotHelper.prepare();

    await screenshotHelper.capture('assistant-prompt', {
      description: 'AI assistant with a natural-language question typed into the composer',
    });
  });
});
