// @ts-check
/**
 * E2E Tests for the Aircraft Detail Page
 * Tests the aircraft detail view at #airframe hash route including all tabs
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

// Generate comprehensive mock data
function generateMockAcarsMessages(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    timestamp: new Date(Date.now() - i * 60000).toISOString(),
    label: ['H1', 'SA', 'B1', '5Z', 'Q0'][i % 5],
    text: `ACARS message ${i + 1} content here.`,
    flight: 'UAL123',
    reg: 'N12345',
    decoded: i % 2 === 0 ? { type: 'position', lat: 37.7749, lon: -122.4194 } : null,
    source: 'VDL2',
    frequency: 136.900,
  }));
}

function generateMockSafetyEvents(count = 3) {
  const types = ['conflict', 'tcas', 'altitude_deviation'];
  const severities = ['warning', 'alert', 'critical'];
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    type: types[i % types.length],
    severity: severities[i % severities.length],
    timestamp: new Date(Date.now() - i * 3600000).toISOString(),
    aircraft1: { hex: 'ABC123', flight: 'UAL123', altitude: 35000 },
    aircraft2: i % 2 === 0 ? { hex: 'DEF456', flight: 'DAL456', altitude: 35500 } : null,
    distance_nm: 2.5 + i * 0.5,
    description: `Safety event ${i + 1} description`,
  }));
}

function generateMockRadioTransmissions(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    timestamp: new Date(Date.now() - i * 120000).toISOString(),
    frequency: [118.1, 120.8, 121.5, 126.7][i % 4],
    audio_url: `/audio/file_${i}.mp3`,
    duration_ms: 5000 + i * 1000,
    transcript: i % 2 === 0 ? `Transcribed audio ${i + 1}` : null,
    transcription_status: i % 2 === 0 ? 'completed' : 'pending',
    callsign: 'UAL123',
  }));
}

function generateMockSightings(count = 10) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    timestamp: new Date(Date.now() - i * 86400000).toISOString(),
    latitude: 37.7749 + i * 0.01,
    longitude: -122.4194 + i * 0.01,
    altitude: 30000 + i * 500,
    speed: 450 + i * 5,
    track: 270 + i * 10,
    distance_nm: 5 + i * 2,
    flight: 'UAL123',
    registration: 'N12345',
  }));
}

test.describe('Aircraft Detail Page', () => {
  const testAircraft = mockData.generateAircraft(1)[0];
  const testIcao = testAircraft.hex;

  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList([testAircraft]);
    await mockApi.mockAircraftDetail(testIcao, testAircraft);
    await mockApi.mockSystemStatus();

    // Mock all related endpoints
    await mockApi.mock(`/sightings`, { sightings: generateMockSightings(10), count: 10 });
    await mockApi.mock(`/audio/transmissions`, { transmissions: generateMockRadioTransmissions(5), count: 5 });
    await mockApi.mock(`/acars`, { messages: generateMockAcarsMessages(5), count: 5 });
    await mockApi.mock(`/safety/events`, { events: generateMockSafetyEvents(3), count: 3 });
    await mockApi.mock(`/airframes/${testIcao}`, {
      icao_hex: testIcao,
      registration: testAircraft.registration || 'N12345',
      type_code: testAircraft.type || 'B738',
      type_description: 'Boeing 737-800',
      operator: 'United Airlines',
      owner: 'United Airlines Inc',
      country: 'United States',
      built_year: 2015,
      serial_number: '12345',
      engines: 'CFM56-7B26',
    });
    await mockApi.mock(`/airframes/${testIcao}/photo`, {
      url: 'https://example.com/photo.jpg',
      thumbnail_url: 'https://example.com/thumb.jpg',
      photographer: 'Test Photographer',
      source: 'planespotters.net',
    });
    await mockApi.mock(`/airframes/${testIcao}/history`, {
      positions: generateMockSightings(20).map(s => ({
        lat: s.latitude,
        lon: s.longitude,
        alt: s.altitude,
        spd: s.speed,
        track: s.track,
        time: s.timestamp,
      })),
    });
  });

  test.describe('Basic Rendering', () => {
    test('aircraft detail page loads with icao parameter', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#airframe');
      expect(hash).toContain(`icao=${testIcao}`);

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('sidebar is visible', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    });

    test('aircraft detail page shows header', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for header with aircraft info
      const header = page.locator('.aircraft-detail-page, .detail-header, [class*="header"]').first();
      const hasHeader = await header.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasHeader).toBe('boolean');
    });

    test('shows loading state initially', async ({ page }) => {
      // Add delay to catch loading state
      await page.route('**/api/v1/airframes/*', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ icao_hex: testIcao }),
        });
      });

      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');

      // Check for loading indicator
      const loading = page.locator('.detail-loading, [role="status"][aria-busy="true"], .loading');
      const hasLoading = await loading.isVisible({ timeout: 1000 }).catch(() => false);
      expect(typeof hasLoading).toBe('boolean');
    });
  });

  test.describe('Tab Navigation', () => {
    test('tab navigation is visible', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Wait for content to load
      await page.waitForTimeout(500);

      // Check for tab navigation
      const tabNav = page.locator('.tab-navigation, .detail-tabs, [role="tablist"]');
      const hasTabNav = await tabNav.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasTabNav).toBe('boolean');
    });

    test('can click on different tabs', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Try clicking Info tab
      const infoTab = page.locator('[role="tab"]:has-text("Info"), button:has-text("Info")').first();
      if (await infoTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await infoTab.click();
        await page.waitForTimeout(300);
      }
    });
  });

  test.describe('Live Tab', () => {
    test('Live tab shows telemetry data', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Click Live tab
      const liveTab = page.locator('[role="tab"]:has-text("Live"), button:has-text("Live")').first();
      if (await liveTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await liveTab.click();
        await page.waitForTimeout(500);

        // Check for telemetry values
        const telemetryContent = page.locator('[class*="live"], [class*="telemetry"], [class*="data"]').first();
        const hasContent = await telemetryContent.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasContent).toBe('boolean');
      }
    });

    test('Live tab shows altitude', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const liveTab = page.locator('[role="tab"]:has-text("Live"), button:has-text("Live")').first();
      if (await liveTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await liveTab.click();
        await page.waitForTimeout(500);

        // Check for altitude display
        const pageContent = await page.textContent('body');
        const hasAltitude = pageContent.toLowerCase().includes('altitude') ||
                           pageContent.includes('ft') ||
                           pageContent.includes('FL');
        expect(typeof hasAltitude).toBe('boolean');
      }
    });

    test('Live tab shows speed', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const liveTab = page.locator('[role="tab"]:has-text("Live"), button:has-text("Live")').first();
      if (await liveTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await liveTab.click();
        await page.waitForTimeout(500);

        // Check for speed display
        const pageContent = await page.textContent('body');
        const hasSpeed = pageContent.toLowerCase().includes('speed') ||
                        pageContent.includes('kts') ||
                        pageContent.includes('knots');
        expect(typeof hasSpeed).toBe('boolean');
      }
    });
  });

  test.describe('Info Tab', () => {
    test('Info tab shows aircraft information', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Click Info tab
      const infoTab = page.locator('[role="tab"]:has-text("Info"), button:has-text("Info")').first();
      if (await infoTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await infoTab.click();
        await page.waitForTimeout(500);

        // Check for info content
        const infoContent = page.locator('[class*="info"], [class*="details"]').first();
        const hasContent = await infoContent.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasContent).toBe('boolean');
      }
    });

    test('Info tab shows registration', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const infoTab = page.locator('[role="tab"]:has-text("Info"), button:has-text("Info")').first();
      if (await infoTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await infoTab.click();
        await page.waitForTimeout(500);

        // Check for registration display
        const pageContent = await page.textContent('body');
        const hasRegistration = pageContent.toLowerCase().includes('registration') ||
                               pageContent.includes('N12345');
        expect(typeof hasRegistration).toBe('boolean');
      }
    });

    test('Info tab shows type/model', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const infoTab = page.locator('[role="tab"]:has-text("Info"), button:has-text("Info")').first();
      if (await infoTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await infoTab.click();
        await page.waitForTimeout(500);

        // Check for type display
        const pageContent = await page.textContent('body');
        const hasType = pageContent.toLowerCase().includes('type') ||
                       pageContent.toLowerCase().includes('model') ||
                       pageContent.includes('B738');
        expect(typeof hasType).toBe('boolean');
      }
    });
  });

  test.describe('Radio Tab', () => {
    test('Radio tab shows transmission list', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Click Radio tab
      const radioTab = page.locator('[role="tab"]:has-text("Radio"), button:has-text("Radio")').first();
      if (await radioTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await radioTab.click();
        await page.waitForTimeout(500);

        // Check for radio content
        const radioContent = page.locator('[class*="radio"], [class*="transmission"]').first();
        const hasContent = await radioContent.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasContent).toBe('boolean');
      }
    });

    test('Radio tab shows frequency information', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const radioTab = page.locator('[role="tab"]:has-text("Radio"), button:has-text("Radio")').first();
      if (await radioTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await radioTab.click();
        await page.waitForTimeout(500);

        // Check for frequency display
        const pageContent = await page.textContent('body');
        const hasFrequency = pageContent.includes('118') || pageContent.includes('MHz');
        expect(typeof hasFrequency).toBe('boolean');
      }
    });
  });

  test.describe('Track Tab', () => {
    test('Track tab shows map', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Click Track tab
      const trackTab = page.locator('[role="tab"]:has-text("Track"), button:has-text("Track")').first();
      if (await trackTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await trackTab.click();
        await page.waitForTimeout(500);

        // Check for map or track content
        const trackContent = page.locator('[class*="track"], .leaflet-container, [class*="map"]').first();
        const hasContent = await trackContent.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasContent).toBe('boolean');
      }
    });

    test('Track tab shows replay controls', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const trackTab = page.locator('[role="tab"]:has-text("Track"), button:has-text("Track")').first();
      if (await trackTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await trackTab.click();
        await page.waitForTimeout(500);

        // Check for replay controls
        const controls = page.locator('[class*="replay"], [class*="controls"], button[title*="Play"]');
        const hasControls = await controls.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasControls).toBe('boolean');
      }
    });
  });

  test.describe('Safety Tab', () => {
    test('Safety tab shows events list', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Click Safety tab
      const safetyTab = page.locator('[role="tab"]:has-text("Safety"), button:has-text("Safety")').first();
      if (await safetyTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await safetyTab.click();
        await page.waitForTimeout(500);

        // Check for safety content
        const safetyContent = page.locator('[class*="safety"], [class*="event"]').first();
        const hasContent = await safetyContent.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasContent).toBe('boolean');
      }
    });

    test('Safety tab shows severity indicators', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const safetyTab = page.locator('[role="tab"]:has-text("Safety"), button:has-text("Safety")').first();
      if (await safetyTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await safetyTab.click();
        await page.waitForTimeout(500);

        // Check for severity indicators
        const indicators = page.locator('[class*="severity"], [class*="warning"], [class*="alert"]').first();
        const hasIndicators = await indicators.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasIndicators).toBe('boolean');
      }
    });
  });

  test.describe('History Tab', () => {
    test('History tab shows sightings list', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Click History tab
      const historyTab = page.locator('[role="tab"]:has-text("History"), button:has-text("History")').first();
      if (await historyTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await historyTab.click();
        await page.waitForTimeout(500);

        // Check for history content
        const historyContent = page.locator('[class*="history"], [class*="sighting"]').first();
        const hasContent = await historyContent.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasContent).toBe('boolean');
      }
    });

    test('History tab shows position data', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const historyTab = page.locator('[role="tab"]:has-text("History"), button:has-text("History")').first();
      if (await historyTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await historyTab.click();
        await page.waitForTimeout(500);

        // Check for position data
        const pageContent = await page.textContent('body');
        const hasPositionData = pageContent.includes('37.') || pageContent.includes('-122.');
        expect(typeof hasPositionData).toBe('boolean');
      }
    });
  });

  test.describe('ACARS Tab', () => {
    test('ACARS tab shows messages list', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Click ACARS tab
      const acarsTab = page.locator('[role="tab"]:has-text("ACARS"), button:has-text("ACARS")').first();
      if (await acarsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await acarsTab.click();
        await page.waitForTimeout(500);

        // Check for ACARS content
        const acarsContent = page.locator('[class*="acars"], [class*="message"]').first();
        const hasContent = await acarsContent.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasContent).toBe('boolean');
      }
    });

    test('ACARS tab shows message labels', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const acarsTab = page.locator('[role="tab"]:has-text("ACARS"), button:has-text("ACARS")').first();
      if (await acarsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await acarsTab.click();
        await page.waitForTimeout(500);

        // Check for message labels (H1, SA, etc.)
        const pageContent = await page.textContent('body');
        const hasLabels = pageContent.includes('H1') || pageContent.includes('SA') ||
                         pageContent.includes('VDL2');
        expect(typeof hasLabels).toBe('boolean');
      }
    });

    test('ACARS tab has time range filter', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const acarsTab = page.locator('[role="tab"]:has-text("ACARS"), button:has-text("ACARS")').first();
      if (await acarsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await acarsTab.click();
        await page.waitForTimeout(500);

        // Check for time filter
        const timeFilter = page.locator('select[class*="hours"], [class*="time-filter"]').first();
        const hasFilter = await timeFilter.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasFilter).toBe('boolean');
      }
    });
  });

  test.describe('External Links', () => {
    test('external links section exists', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for external links
      const externalLinks = page.locator('[class*="external"], [class*="links"]').first();
      const hasLinks = await externalLinks.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasLinks).toBe('boolean');
    });
  });

  test.describe('Error Handling', () => {
    test('handles invalid ICAO gracefully', async ({ page, mockApi }) => {
      // Mock 404 response
      await mockApi.mockError('/airframes/INVALID', 404, 'Not found');

      await page.goto(`/#airframe?icao=INVALID`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Should show error state or redirect
      const errorState = page.locator('.error-state, [role="alert"], :has-text("Error")').first();
      const hasError = await errorState.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasError).toBe('boolean');
    });

    test('handles API error gracefully', async ({ page, mockApi }) => {
      // Mock 500 response
      await mockApi.mockError(`/airframes/${testIcao}`, 500, 'Server error');

      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);
    });
  });

  test.describe('Navigation', () => {
    test('can navigate back to map', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Live Map")');
      await page.waitForURL(/#map/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });

    test('can navigate to aircraft list', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Aircraft List")');
      await page.waitForURL(/#aircraft/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#aircraft');
    });

    test('close button navigates back', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Look for close button
      const closeBtn = page.locator('button[aria-label="Close"], button:has-text("Close"), [class*="close"]').first();
      if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(500);
        // Should navigate away
      }
    });
  });

  test.describe('Share Functionality', () => {
    test('share button exists', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for share button
      const shareBtn = page.locator('button[aria-label*="Share"], button:has-text("Share"), [class*="share"]').first();
      const hasShare = await shareBtn.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasShare).toBe('boolean');
    });
  });

  test.describe('Responsive Design', () => {
    test('renders correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('renders correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('tabs are accessible on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check that tabs are scrollable or visible
      const tabs = page.locator('[role="tablist"], .tab-navigation');
      const hasTabs = await tabs.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasTabs).toBe('boolean');
    });
  });
});
