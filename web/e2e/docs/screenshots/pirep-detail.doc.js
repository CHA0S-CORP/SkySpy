// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * PIREP Detail Documentation Screenshot
 *
 * The #pirep?id=<pirep_id> screen decodes a single pilot report (hazard grid +
 * raw text) with a mini-map of the report against live traffic. Data comes from
 * the LIVE backend: /aviation/pireps/?limit=200 (record lookup), the optional
 * /summary, and /aircraft/. We fetch a real pirep_id first, then deep-link to it.
 */

test.describe('PIREP Detail Screenshot', () => {
  test('pirep-detail', async ({ page, screenshotState, screenshotHelper }) => {
    await screenshotState.setupForScreenshot();

    // Grab a real PIREP id from the live cache to deep-link into.
    let pirepId = null;
    try {
      const res = await page.request.get(
        'http://localhost:8000/api/v1/aviation/pireps/?limit=50'
      );
      const json = await res.json();
      const list = json.data || json.pireps || [];
      // Prefer a report carrying a decoded hazard (turbulence/icing) for a richer card.
      const withHazard = list.find((p) => p.turbulence_type || p.icing_type);
      pirepId = (withHazard || list[0])?.pirep_id;
    } catch {
      /* fall through — screen renders its not-found state */
    }

    await page.goto(`/#pirep?id=${pirepId ?? 'unknown'}`);
    await page.waitForLoadState('domcontentloaded');
    await screenshotHelper.waitForContentReady();
    // Wait for the detail body (decoded report) to replace the loading/not-found
    // placeholder — the list query must resolve and match the record first.
    await page
      .locator('.v2-pird__loading')
      .waitFor({ state: 'detached', timeout: 12000 })
      .catch(() => {});
    await page.waitForTimeout(2000);
    await screenshotHelper.prepare();
    await screenshotHelper.capture('pirep-detail', {
      description: 'Decoded pilot report — hazard grid, raw text and a live position mini-map',
    });
  });
});
