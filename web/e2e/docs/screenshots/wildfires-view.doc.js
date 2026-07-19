// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Wildfires View Documentation Screenshots
 *
 * The #wildfires screen renders active Watch Duty fires near the feeder as
 * threat-colored cards (REST GET /api/v1/aviation/wildfires/) and opens a
 * per-fire detail panel (GET /aviation/wildfires/<id>/bundle) on selection.
 *
 * These captures run against the LIVE dev backend — the cache is populated with
 * real active fires — so NO API mocking is used here. Only deterministic
 * screenshot state (frozen clock, disabled animations) is applied.
 */

// Anonymous /system/status strips the feeder location; the wildfires screen
// needs it as its center point. Inject the real feeder coords into the live
// payload (page.request bypasses page.route, so no loop).
const FEEDER = { latitude: 32.801328, longitude: -117.255982 };
async function injectFeederLocation(page) {
  await page.route('**/api/v1/system/status*', async (route) => {
    let body = {};
    try {
      const res = await page.request.get('http://localhost:8000/api/v1/system/status');
      body = await res.json();
    } catch {
      /* fall through with empty body */
    }
    body.location = FEEDER;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function firstFireId(page) {
  try {
    const res = await page.request.get(
      `http://localhost:8000/api/v1/aviation/wildfires/?lat=${FEEDER.latitude}&lon=${FEEDER.longitude}&radius_nm=250`
    );
    const json = await res.json();
    const fires = json.wildfires || json.data || [];
    return fires[0]?.id ?? null;
  } catch {
    return null;
  }
}

test.describe('Wildfires View Screenshots', () => {
  test.beforeEach(async ({ page, screenshotState }) => {
    await injectFeederLocation(page);
    await screenshotState.setupForScreenshot();
  });

  test('wildfires-overview', async ({ page, screenshotHelper }) => {
    await page.goto('/#wildfires');
    await page.waitForLoadState('domcontentloaded');
    await screenshotHelper.waitForContentReady();
    await page.waitForTimeout(1500);
    await screenshotHelper.prepare();
    await screenshotHelper.capture('wildfires-overview', {
      description: 'Active wildfires near the receiver — threat-scored Watch Duty markers',
    });
  });

  test('wildfires-detail', async ({ page, screenshotHelper }) => {
    // Deep-link the first live fire so the detail panel (reports/cameras/scanners) opens.
    const id = await firstFireId(page);
    await page.goto(`/#wildfires${id != null ? `?sel=${id}` : ''}`);
    await page.waitForLoadState('domcontentloaded');
    await screenshotHelper.waitForContentReady();
    await page.waitForTimeout(2000); // let the per-fire bundle (cameras/reports) load
    await screenshotHelper.prepare();
    await screenshotHelper.capture('wildfires-detail', {
      description: 'Per-fire detail: threat readout, reports feed, PTZ cameras and scanner feeds',
    });
  });
});
