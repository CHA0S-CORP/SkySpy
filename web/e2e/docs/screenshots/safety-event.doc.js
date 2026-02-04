// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Safety Event View Documentation Screenshots
 *
 * Captures:
 * - Safety event map
 * - Telemetry graphs
 * - Event timeline
 * - Conflict analysis
 */

test.describe('Safety Event Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    // Mock specific safety event
    const events = docMockData.generateCuratedSafetyEvents();
    const tcasEvent = events.find((e) => e.event_type === 'tcas_ra');

    await docMockApi.mock(`/safety/events/${tcasEvent.id}`, {
      ...tcasEvent,
      aircraft_1_track: Array.from({ length: 20 }, (_, i) => ({
        lat: 37.78 - i * 0.002,
        lon: -122.40 + i * 0.003,
        alt: 25000,
        timestamp: Date.now() / 1000 - (20 - i) * 10,
      })),
      aircraft_2_track: Array.from({ length: 20 }, (_, i) => ({
        lat: 37.75 + i * 0.002,
        lon: -122.35 - i * 0.003,
        alt: 25000 + (i > 15 ? (i - 15) * 400 : 0), // Climb after RA
        timestamp: Date.now() / 1000 - (20 - i) * 10,
      })),
    });

    // Navigate to safety event detail
    await page.goto(`/#safety/events/${tcasEvent.id}`);
    await page.waitForLoadState('domcontentloaded');
  });

  test('safety-event-map', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.waitForMapReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('safety-event-map', {
      description: 'Safety event map showing aircraft tracks and conflict point',
    });
  });

  test('safety-event-telemetry', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for telemetry graphs
    const telemetry = page.locator('.telemetry-graphs, [data-testid="telemetry-charts"], .altitude-graph');
    if (await telemetry.isVisible()) {
      await telemetry.scrollIntoViewIfNeeded();
      await screenshotHelper.captureElement('.telemetry-graphs, [data-testid="telemetry-charts"]', 'safety-event-telemetry', {
        description: 'Altitude and speed graphs during safety event',
      });
    }
  });

  test('safety-event-timeline', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for event timeline
    const timeline = page.locator('.event-timeline, [data-testid="safety-timeline"], .conflict-timeline');
    if (await timeline.isVisible()) {
      await timeline.scrollIntoViewIfNeeded();
      await screenshotHelper.captureElement('.event-timeline, [data-testid="safety-timeline"]', 'safety-event-timeline', {
        description: 'Timeline of safety event with key moments',
      });
    }
  });

  test('safety-event-analysis', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for analysis panel
    const analysis = page.locator('.analysis-panel, [data-testid="conflict-analysis"], .event-analysis');
    if (await analysis.isVisible()) {
      await analysis.scrollIntoViewIfNeeded();
      await screenshotHelper.captureElement('.analysis-panel, [data-testid="conflict-analysis"]', 'safety-event-analysis', {
        description: 'Conflict analysis with separation metrics',
      });
    }
  });

  test('safety-event-details', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for event details panel
    const details = page.locator('.event-details, [data-testid="event-details"]');
    if (await details.isVisible()) {
      await screenshotHelper.captureElement('.event-details, [data-testid="event-details"]', 'safety-event-details', {
        description: 'Safety event details with resolution advisory',
      });
    }
  });

  test('safety-event-aircraft-cards', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for aircraft cards
    const aircraftCards = page.locator('.aircraft-cards, [data-testid="involved-aircraft"]');
    if (await aircraftCards.isVisible()) {
      await screenshotHelper.captureElement('.aircraft-cards, [data-testid="involved-aircraft"]', 'safety-event-aircraft', {
        description: 'Aircraft involved in safety event',
      });
    }
  });

  test('safety-event-replay', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for replay controls
    const replay = page.locator('[data-testid="event-replay"], .event-replay-controls');
    if (await replay.isVisible()) {
      await screenshotHelper.captureElement('[data-testid="event-replay"], .event-replay-controls', 'safety-event-replay', {
        description: 'Safety event replay controls',
      });
    }

    await screenshotHelper.capture('safety-event-full', {
      description: 'Complete safety event view with all panels',
    });
  });
});
