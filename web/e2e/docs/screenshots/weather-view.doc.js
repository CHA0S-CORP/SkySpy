// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Weather View Documentation Screenshots
 *
 * The #weather screen (WX_TABS = Overview | Turbulence | METARs | PIREPs, each
 * deep-linked via `?wx=`) draws METARs, PIREPs and airspace advisories from the
 * LIVE Socket.IO feed (backend fetches AWC), plus per-aircraft turbulence risk
 * from REST /aviation/turbulence/*.
 *
 * METARs/PIREPs/Overview run against the live backend (real AWC data). The
 * turbulence tab needs a non-trivial risk picture — dev air is smooth (all
 * "none") — so we mock the two turbulence REST endpoints, keying the per-hex
 * risk to the ACTUAL live aircraft hexes so the "Aircraft At Risk" list and map
 * darts populate with real callsigns.
 */

// Anonymous /system/status strips the feeder location; the weather screen needs
// feederLat/Lon to fire its socket aviation-data requests (METARs/PIREPs) and to
// center the wx map. Inject the real coords into the live payload.
const FEEDER = { latitude: 32.801328, longitude: -117.255982 };
async function injectFeederLocation(page) {
  await page.route('**/api/v1/system/status*', async (route) => {
    let body = {};
    try {
      const res = await page.request.get('http://localhost:8000/api/v1/system/status');
      body = await res.json();
    } catch {
      /* empty */
    }
    body.location = FEEDER;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('Weather View Screenshots', () => {
  test.beforeEach(async ({ page, screenshotState }) => {
    await injectFeederLocation(page);
    await screenshotState.setupForScreenshot();
  });

  const shoot = async (page, screenshotHelper, name, description) => {
    await page.waitForLoadState('domcontentloaded');
    await screenshotHelper.waitForContentReady();
    await page.waitForTimeout(2500); // let the socket aviation-data round-trip land
    await screenshotHelper.prepare();
    await screenshotHelper.capture(name, { description });
  };

  test('weather-overview', async ({ page, screenshotHelper }) => {
    await page.goto('/#weather');
    await shoot(page, screenshotHelper, 'weather-overview',
      'Weather command deck — sector conditions, KPIs and the live wx map');
  });

  test('weather-metars', async ({ page, screenshotHelper }) => {
    await page.goto('/#weather?wx=METARs');
    await shoot(page, screenshotHelper, 'weather-metars',
      'Decoded station observations, worst-flight-category first');
  });

  test('weather-pireps', async ({ page, screenshotHelper }) => {
    await page.goto('/#weather?wx=PIREPs');
    await shoot(page, screenshotHelper, 'weather-pireps',
      'Decoded pilot reports — turbulence, icing and sky-cover hazards');
  });

  test('weather-turbulence', async ({ page, screenshotHelper }) => {
    // Key the mocked risk to real live hexes so the at-risk list is populated.
    const LEVELS = [
      { level: 'severe', score: 82 },
      { level: 'moderate', score: 61 },
      { level: 'moderate', score: 54 },
      { level: 'moderate', score: 48 },
      { level: 'light', score: 24 },
    ];
    await page.route('**/api/v1/aviation/turbulence/aircraft**', async (route) => {
      let hexes = [];
      try {
        const res = await page.request.get('http://localhost:8000/api/v1/aircraft/');
        const json = await res.json();
        hexes = (json.aircraft || []).map((a) => a.hex).filter(Boolean).slice(0, LEVELS.length);
      } catch {
        hexes = ['A0B1C2', 'D3E4F5', '112233', '445566', '778899'];
      }
      const aircraft = {};
      hexes.forEach((h, i) => (aircraft[h] = LEVELS[i]));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ aircraft }) });
    });
    await page.route('**/api/v1/aviation/turbulence?**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          score: 58,
          level: 'moderate',
          sources: {
            gairmet: [{ hazard: 'TURB-HI', severity: 'MOD', base_ft: 24000, top_ft: 39000 }],
            pireps: [{ aircraft_type: 'B738', turbulence_freq: 'OCNL', turbulence_type: 'CHOP' }],
            winds: { shear: 12, dir: 280, speed_kt: 74 },
          },
        }),
      });
    });
    await page.goto('/#weather?wx=Turbulence');
    await shoot(page, screenshotHelper, 'weather-turbulence',
      'Turbulence tab — sector risk, at-risk aircraft, advisories and the turbulence map');
  });
});
