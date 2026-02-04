// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Conflict Analysis Animation Captures
 *
 * Records:
 * - Aircraft convergence
 * - TCAS alert escalation
 * - Resolution advisory execution
 */

test.describe('Conflict Analysis Animations', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForAnimation();

    // Set up safety event with tracks
    const events = docMockData.generateCuratedSafetyEvents();
    const tcasEvent = events.find((e) => e.event_type === 'tcas_ra');

    await docMockApi.mock(`/safety/events/${tcasEvent.id}`, {
      ...tcasEvent,
      aircraft_1_track: [],
      aircraft_2_track: [],
    });

    await page.goto(`/#safety/events/${tcasEvent.id}`);
    await page.waitForLoadState('domcontentloaded');
  });

  test('conflict-escalation', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.waitForMapReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Animate conflict escalation
    await animationHelpers.animateConflictAnalysis(10000);

    await page.waitForTimeout(2000);
    await animationHelpers.stopRecording();
  });

  test('separation-graph', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Simulate separation data updates
    const steps = 40;
    for (let i = 0; i < steps; i++) {
      const progress = i / steps;

      // Separation decreases then increases (resolution)
      let separation;
      if (progress < 0.6) {
        separation = 5 - progress * 7; // Converging
      } else {
        separation = 0.8 + (progress - 0.6) * 8; // Diverging after RA
      }

      const alertLevel = separation < 1 ? 'critical' : separation < 2 ? 'warning' : 'info';

      await page.evaluate(
        ({ separation, alertLevel, progress }) => {
          window.dispatchEvent(
            new CustomEvent('test-separation-update', {
              detail: { separation, alertLevel, progress },
            })
          );
        },
        { separation: Math.max(0.5, separation), alertLevel, progress }
      );

      await page.waitForTimeout(150);
    }

    await page.waitForTimeout(2000);
    await animationHelpers.stopRecording();
  });

  test('tcas-alert-sequence', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Simulate TCAS alert sequence
    const alerts = [
      { type: 'traffic', level: 'info', message: 'Traffic, 12 o\'clock, 2 miles, same altitude' },
      { type: 'ta', level: 'warning', message: 'Traffic Advisory - Climb' },
      { type: 'ra', level: 'critical', message: 'Resolution Advisory - CLIMB, CLIMB NOW' },
      { type: 'clear', level: 'info', message: 'Clear of Conflict' },
    ];

    for (const alert of alerts) {
      await page.evaluate(
        (alert) => {
          window.dispatchEvent(
            new CustomEvent('test-tcas-alert', { detail: alert })
          );
        },
        alert
      );

      await page.waitForTimeout(2500);
    }

    await page.waitForTimeout(1500);
    await animationHelpers.stopRecording();
  });

  test('altitude-divergence', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Simulate altitude changes during RA
    const steps = 30;
    for (let i = 0; i < steps; i++) {
      const progress = i / steps;

      let alt1, alt2;
      if (progress < 0.5) {
        // Both at same altitude initially
        alt1 = 25000;
        alt2 = 25000;
      } else {
        // RA executed - diverging
        const raProgress = (progress - 0.5) * 2;
        alt1 = 25000 + raProgress * 2000; // Climbing
        alt2 = 25000 - raProgress * 1500; // Descending
      }

      await page.evaluate(
        ({ alt1, alt2, progress }) => {
          window.dispatchEvent(
            new CustomEvent('test-altitude-update', {
              detail: {
                aircraft1: { altitude: alt1 },
                aircraft2: { altitude: alt2 },
                progress,
              },
            })
          );
        },
        { alt1, alt2, progress }
      );

      await page.waitForTimeout(200);
    }

    await page.waitForTimeout(2000);
    await animationHelpers.stopRecording();
  });

  test('track-convergence', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Simulate two aircraft tracks converging
    const steps = 40;
    const aircraft1Start = { lat: 37.82, lon: -122.50 };
    const aircraft2Start = { lat: 37.72, lon: -122.30 };
    const conflictPoint = { lat: 37.77, lon: -122.40 };

    for (let i = 0; i < steps; i++) {
      const progress = i / steps;

      let lat1, lon1, lat2, lon2;

      if (progress < 0.7) {
        // Converging
        const p = progress / 0.7;
        lat1 = aircraft1Start.lat + (conflictPoint.lat - aircraft1Start.lat) * p;
        lon1 = aircraft1Start.lon + (conflictPoint.lon - aircraft1Start.lon) * p;
        lat2 = aircraft2Start.lat + (conflictPoint.lat - aircraft2Start.lat) * p;
        lon2 = aircraft2Start.lon + (conflictPoint.lon - aircraft2Start.lon) * p;
      } else {
        // Diverging after resolution
        const p = (progress - 0.7) / 0.3;
        lat1 = conflictPoint.lat + p * 0.03;
        lon1 = conflictPoint.lon + p * 0.02;
        lat2 = conflictPoint.lat - p * 0.02;
        lon2 = conflictPoint.lon - p * 0.03;
      }

      await page.evaluate(
        ({ ac1, ac2 }) => {
          window.dispatchEvent(
            new CustomEvent('test-conflict-tracks', {
              detail: { aircraft1: ac1, aircraft2: ac2 },
            })
          );
        },
        {
          ac1: { lat: lat1, lon: lon1 },
          ac2: { lat: lat2, lon: lon2 },
        }
      );

      await page.waitForTimeout(150);
    }

    await page.waitForTimeout(2000);
    await animationHelpers.stopRecording();
  });
});
