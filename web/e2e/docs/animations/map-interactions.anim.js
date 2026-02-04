// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Map Interactions Animation Captures
 *
 * Records:
 * - Map pan and zoom
 * - Aircraft movement
 * - Marker interactions
 */

test.describe('Map Interactions Animations', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForAnimation();

    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
  });

  test('map-pan-zoom', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();

    // Start recording (handled by config, but ensure ready)
    await animationHelpers.startRecording();

    // Wait a moment for initial state
    await page.waitForTimeout(1000);

    // Animate pan and zoom
    await animationHelpers.animateMapPan({
      startLat: 37.7749,
      startLon: -122.4194,
      endLat: 37.8549,
      endLon: -122.3594,
      startZoom: 10,
      endZoom: 12,
      duration: 4000,
    });

    // Hold on final view
    await page.waitForTimeout(1500);

    await animationHelpers.stopRecording();
  });

  test('aircraft-movement', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Get first aircraft and animate its movement
    const aircraft = docMockData.generateCuratedAircraft()[0];

    await animationHelpers.animateAircraftMovement({
      hex: aircraft.hex,
      startLat: aircraft.lat,
      startLon: aircraft.lon,
      endLat: aircraft.lat + 0.05,
      endLon: aircraft.lon + 0.05,
      duration: 5000,
      steps: 25,
    });

    await page.waitForTimeout(1000);
    await animationHelpers.stopRecording();
  });

  test('aircraft-appearance', async ({ page, animationHelpers, screenshotHelper }) => {
    // Clear existing aircraft for this animation
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('test-clear-aircraft', { detail: {} })
      );
    });

    await screenshotHelper.waitForMapReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(500);

    // Gradually add aircraft
    await animationHelpers.animateAircraftAppearance(8, 600);

    await page.waitForTimeout(1500);
    await animationHelpers.stopRecording();
  });

  test('popup-interaction', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Find and click on aircraft markers
    const markers = page.locator('.leaflet-marker-icon, .aircraft-marker');
    const count = await markers.count();

    if (count > 0) {
      // Click first marker
      await markers.first().click({ force: true });
      await page.waitForTimeout(2000);

      // Close popup
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Click second marker if available
      if (count > 1) {
        await markers.nth(1).click({ force: true });
        await page.waitForTimeout(2000);
      }
    }

    await animationHelpers.stopRecording();
  });
});
