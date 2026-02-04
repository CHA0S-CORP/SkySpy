// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Airframe Detail View Documentation Screenshots
 *
 * Captures:
 * - Aircraft detail overview
 * - Photo hero section
 * - Tabs: Info, Track, Communications
 * - External links
 */

test.describe('Airframe Detail Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    // Mock aircraft detail endpoint
    const aircraft = docMockData.generateCuratedAircraft()[0];
    await docMockApi.mock(`/aircraft/${aircraft.hex}`, {
      ...aircraft,
      photo_url: 'https://example.com/aircraft-photo.jpg',
      airline_logo_url: 'https://example.com/airline-logo.png',
      registration_history: [
        { registration: 'N12345', date: '2020-01-15' },
        { registration: 'N98765', date: '2015-06-22' },
      ],
    });

    // Mock aircraft track/history
    await docMockApi.mock(`/aircraft/${aircraft.hex}/track`, {
      hex: aircraft.hex,
      trace: Array.from({ length: 30 }, (_, i) => ({
        lat: 37.7749 + i * 0.01,
        lon: -122.4194 + i * 0.01,
        alt: 10000 + i * 500,
        gs: 300 + i * 5,
        track: 45,
        timestamp: Date.now() / 1000 - (30 - i) * 60,
      })),
    });

    // Navigate to aircraft detail
    await page.goto(`/#aircraft/${aircraft.hex}`);
    await page.waitForLoadState('domcontentloaded');
  });

  test('airframe-overview', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('airframe-overview', {
      description: 'Aircraft detail page overview with photo and key information',
    });
  });

  test('airframe-photo-hero', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Capture photo hero section
    const photoHero = page.locator('.photo-hero, [data-testid="aircraft-photo"], .aircraft-hero');
    if (await photoHero.isVisible()) {
      await screenshotHelper.captureElement('.photo-hero, [data-testid="aircraft-photo"], .aircraft-hero', 'airframe-photo-hero', {
        description: 'Aircraft photo hero with identification details',
      });
    }
  });

  test('airframe-info-tab', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click info tab
    const infoTab = page.locator('[data-tab="info"], button:has-text("Info"), [role="tab"]:has-text("Info")');
    if (await infoTab.isVisible()) {
      await infoTab.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('airframe-info-tab', {
      description: 'Aircraft information tab with registration and specifications',
    });
  });

  test('airframe-track-tab', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click track tab
    const trackTab = page.locator('[data-tab="track"], button:has-text("Track"), [role="tab"]:has-text("Track")');
    if (await trackTab.isVisible()) {
      await trackTab.click();
      await page.waitForTimeout(500);
    }

    await screenshotHelper.waitForMapReady();

    await screenshotHelper.capture('airframe-track-tab', {
      description: 'Aircraft track history with flight path visualization',
    });
  });

  test('airframe-communications-tab', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click communications tab
    const commsTab = page.locator('[data-tab="communications"], button:has-text("Comm"), [role="tab"]:has-text("ACARS")');
    if (await commsTab.isVisible()) {
      await commsTab.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('airframe-communications-tab', {
      description: 'Aircraft ACARS messages and communications history',
    });
  });

  test('airframe-safety-tab', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click safety tab
    const safetyTab = page.locator('[data-tab="safety"], button:has-text("Safety"), [role="tab"]:has-text("Safety")');
    if (await safetyTab.isVisible()) {
      await safetyTab.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('airframe-safety-tab', {
      description: 'Aircraft safety record and incidents',
    });
  });

  test('airframe-external-links', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for external links section
    const externalLinks = page.locator('.external-links, [data-testid="external-links"]');
    if (await externalLinks.isVisible()) {
      await screenshotHelper.captureElement('.external-links, [data-testid="external-links"]', 'airframe-external-links', {
        description: 'External links to FlightAware, FlightRadar24, etc.',
      });
    }
  });

  test('airframe-live-telemetry', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for live telemetry section
    const telemetry = page.locator('.telemetry-bar, [data-testid="live-telemetry"], .sticky-telemetry');
    if (await telemetry.isVisible()) {
      await screenshotHelper.captureElement('.telemetry-bar, [data-testid="live-telemetry"]', 'airframe-live-telemetry', {
        description: 'Real-time telemetry bar with altitude, speed, and heading',
      });
    }
  });
});
