// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Cannonball Threat Detection Animation Captures
 *
 * Records:
 * - Threat escalation from info to critical
 * - Radar sweep animation
 * - Alert notifications
 */

test.describe('Cannonball Threat Animations', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForAnimation();

    await page.goto('/#cannonball');
    await page.waitForLoadState('domcontentloaded');
  });

  test('threat-detection', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Animate threat escalation
    await animationHelpers.animateThreatEscalation(8000);

    await page.waitForTimeout(2000);
    await animationHelpers.stopRecording();
  });

  test('radar-sweep', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(500);

    // Animate radar sweep
    await animationHelpers.animateRadarSweep(2, 3000);

    await page.waitForTimeout(1000);
    await animationHelpers.stopRecording();
  });

  test('threat-approach', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    const threats = docMockData.generateCuratedCannonballThreats();
    const criticalThreat = threats[0];

    // Simulate threat approaching
    for (let i = 0; i < 20; i++) {
      const distance = 8 - i * 0.3;
      const urgency = 40 + i * 3;

      await page.evaluate(
        ({ threat, distance, urgency }) => {
          window.dispatchEvent(
            new CustomEvent('test-cannonball-threats', {
              detail: {
                threats: [
                  {
                    ...threat,
                    distance_nm: distance,
                    urgency_score: urgency,
                    threat_level: distance < 3 ? 'critical' : distance < 5 ? 'warning' : 'info',
                    trend: 'approaching',
                    closing_speed: 55,
                  },
                ],
              },
            })
          );
        },
        { threat: criticalThreat, distance, urgency }
      );

      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(2000);
    await animationHelpers.stopRecording();
  });

  test('pattern-detection', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    const threat = docMockData.generateCuratedCannonballThreats()[0];
    const centerLat = threat.lat;
    const centerLon = threat.lon;

    // Simulate circling pattern
    for (let angle = 0; angle < 720; angle += 30) {
      const radians = (angle * Math.PI) / 180;
      const radius = 0.01; // Small circle

      await page.evaluate(
        ({ threat, lat, lon, angle }) => {
          window.dispatchEvent(
            new CustomEvent('test-cannonball-threats', {
              detail: {
                threats: [
                  {
                    ...threat,
                    lat,
                    lon,
                    track: angle % 360,
                    patterns: [
                      {
                        type: 'circling',
                        confidence_score: Math.min(0.4 + angle / 1000, 0.95),
                      },
                    ],
                  },
                ],
              },
            })
          );
        },
        {
          threat,
          lat: centerLat + Math.sin(radians) * radius,
          lon: centerLon + Math.cos(radians) * radius,
          angle,
        }
      );

      await page.waitForTimeout(100);
    }

    await page.waitForTimeout(2000);
    await animationHelpers.stopRecording();
  });
});
