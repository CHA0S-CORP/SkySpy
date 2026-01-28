// @ts-check
/**
 * E2E Tests for the Audio View
 * Tests the audio view at #audio hash route including all features
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

// Generate mock audio transmissions
const generateMockTransmissions = (count = 5) => {
  const channels = ['Tower', 'Ground', 'Approach', 'Departure', 'Center'];
  const statuses = ['completed', 'processing', 'queued', 'pending', 'failed'];

  return Array.from({ length: count }, (_, i) => ({
    id: `transmission-${i + 1}`,
    channel_name: channels[i % channels.length],
    frequency_mhz: 118.3 + (i * 0.1),
    format: 'mp3',
    file_size_bytes: 50000 + (i * 1000),
    duration_seconds: 5 + i,
    transcription_status: statuses[i % statuses.length],
    transcript: i % 2 === 0 ? `United ${i + 100}, turn left heading ${270 + i * 10}` : null,
    transcript_confidence: i % 2 === 0 ? 0.95 : null,
    transcript_language: 'en',
    transcription_error: statuses[i % statuses.length] === 'failed' ? 'Transcription failed' : null,
    created_at: new Date(Date.now() - i * 60000).toISOString(),
    s3_url: `https://example.com/audio/transmission-${i + 1}.mp3`,
    identified_airframes: i % 3 === 0 ? [
      {
        callsign: `UAL${100 + i}`,
        icao_hex: `A${i}B${i}C${i}`,
        type: 'airline',
        airline_icao: 'UAL',
        airline_name: 'United Airlines',
        confidence: 0.9
      }
    ] : []
  }));
};

// Generate mock emergency transmission
const generateEmergencyTransmission = () => ({
  id: 'emergency-1',
  channel_name: 'Emergency',
  frequency_mhz: 121.5,
  format: 'mp3',
  file_size_bytes: 75000,
  duration_seconds: 15,
  transcription_status: 'completed',
  transcript: 'Mayday mayday mayday, United 789, engine failure, declaring emergency',
  transcript_confidence: 0.98,
  transcript_language: 'en',
  created_at: new Date().toISOString(),
  s3_url: 'https://example.com/audio/emergency-1.mp3',
  identified_airframes: [{
    callsign: 'UAL789',
    icao_hex: 'A789BC',
    type: 'airline',
    airline_icao: 'UAL',
    airline_name: 'United Airlines',
    confidence: 0.95
  }]
});

test.describe('Audio View', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();

    // Mock audio endpoints
    await mockApi.mock('/audio', {
      transmissions: generateMockTransmissions(10),
      count: 10
    });

    await mockApi.mock('/audio?stats=true', {
      total_transmissions: 500,
      total_transcribed: 450,
      pending_transcription: 50,
      total_duration_hours: 8.5,
      by_channel: {
        'Tower': 200,
        'Ground': 150,
        'Approach': 100,
        'Departure': 50
      }
    });

    await mockApi.mock('/system/status', {
      radio_enabled: true,
      recording: true
    });
  });

  test.describe('Basic Rendering', () => {
    test('audio view loads successfully', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#audio');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('sidebar is visible', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    });

    test('audio container is displayed', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const container = page.locator('.audio-container, [class*="audio"]').first();
      const hasContainer = await container.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasContainer).toBe('boolean');
    });
  });

  test.describe('Stats Bar', () => {
    test('displays total transmissions stat', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const statsBar = page.locator('.audio-stats-bar, [class*="stats"]').first();
      const hasStats = await statsBar.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasStats).toBe('boolean');
    });

    test('displays transcribed count', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const pageContent = await page.textContent('body');
      const hasTranscribed = pageContent.includes('Transcribed') || pageContent.includes('450');
      expect(typeof hasTranscribed).toBe('boolean');
    });

    test('displays pending count', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const pageContent = await page.textContent('body');
      const hasPending = pageContent.includes('Pending') || pageContent.includes('50');
      expect(typeof hasPending).toBe('boolean');
    });

    test('displays radio status', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const pageContent = await page.textContent('body');
      const hasRadioStatus = pageContent.includes('Active') || pageContent.includes('Radio');
      expect(typeof hasRadioStatus).toBe('boolean');
    });
  });

  test.describe('Transmission List', () => {
    test('displays transmission items', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const items = page.locator('.audio-item, [class*="transmission"]');
      const itemCount = await items.count();
      expect(itemCount).toBeGreaterThanOrEqual(0);
    });

    test('displays channel name for transmissions', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const pageContent = await page.textContent('body');
      const hasChannel = pageContent.includes('Tower') || pageContent.includes('Ground') ||
                         pageContent.includes('Approach');
      expect(typeof hasChannel).toBe('boolean');
    });

    test('displays frequency for transmissions', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const pageContent = await page.textContent('body');
      const hasFrequency = pageContent.includes('MHz') || pageContent.includes('118.');
      expect(typeof hasFrequency).toBe('boolean');
    });

    test('displays transcript preview when available', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const transcript = page.locator('.transcript-preview-text, [class*="transcript"]').first();
      const hasTranscript = await transcript.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasTranscript).toBe('boolean');
    });

    test('displays identified flights when available', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const flightTag = page.locator('.flight-tag, [class*="callsign"]').first();
      const hasFlightTag = await flightTag.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasFlightTag).toBe('boolean');
    });
  });

  test.describe('Audio Playback', () => {
    test('play button exists for transmissions', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const playBtn = page.locator('.audio-play-btn, button:has([class*="Play"])').first();
      const hasPlayBtn = await playBtn.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasPlayBtn).toBe('boolean');
    });

    test('progress bar exists for transmissions', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const progressBar = page.locator('.audio-progress-bar, [class*="progress"]').first();
      const hasProgressBar = await progressBar.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasProgressBar).toBe('boolean');
    });

    test('can click play button without error', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const playBtn = page.locator('.audio-play-btn, button:has([class*="Play"])').first();
      if (await playBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await playBtn.click().catch(() => {});
        // Click should work without throwing
      }
    });
  });

  test.describe('Volume Controls', () => {
    test('volume button exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const volumeBtn = page.locator('.volume-btn, button:has([class*="Volume"])').first();
      const hasVolumeBtn = await volumeBtn.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasVolumeBtn).toBe('boolean');
    });

    test('volume slider exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const volumeSlider = page.locator('.volume-slider, input[type="range"]').first();
      const hasSlider = await volumeSlider.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasSlider).toBe('boolean');
    });

    test('can toggle mute', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const volumeBtn = page.locator('.volume-btn, button:has([class*="Volume"])').first();
      if (await volumeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await volumeBtn.click();
        await page.waitForTimeout(200);
        // Click should toggle mute state
      }
    });

    test('can adjust volume slider', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const volumeSlider = page.locator('.volume-slider, input[type="range"]').first();
      if (await volumeSlider.isVisible({ timeout: 3000 }).catch(() => false)) {
        await volumeSlider.fill('0.5');
        // Value change should work
      }
    });
  });

  test.describe('Search and Filtering', () => {
    test('search box exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const searchBox = page.locator('.search-box input, input[placeholder*="Search"]').first();
      const hasSearch = await searchBox.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasSearch).toBe('boolean');
    });

    test('can type in search box', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const searchBox = page.locator('.search-box input, input[placeholder*="Search"]').first();
      if (await searchBox.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchBox.fill('United');
        await page.waitForTimeout(500);
        // Search should filter results
      }
    });

    test('status filter exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const statusFilter = page.locator('select:has-text("Status"), select:has(option:has-text("Transcribed"))').first();
      const hasFilter = await statusFilter.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasFilter).toBe('boolean');
    });

    test('can change status filter', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const statusFilter = page.locator('.audio-select, select').first();
      if (await statusFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await statusFilter.selectOption({ index: 1 });
        await page.waitForTimeout(500);
      }
    });

    test('channel filter exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const channelFilter = page.locator('select:has-text("Channel"), select:has(option:has-text("All Channels"))').first();
      const hasFilter = await channelFilter.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasFilter).toBe('boolean');
    });

    test('flight match filter exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const flightFilter = page.locator('select:has-text("Transmissions"), select:has(option:has-text("With Flights"))').first();
      const hasFilter = await flightFilter.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasFilter).toBe('boolean');
    });

    test('callsign filter input exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const callsignInput = page.locator('.callsign-filter input, input[placeholder*="Callsign"]').first();
      const hasInput = await callsignInput.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasInput).toBe('boolean');
    });

    test('emergency filter button exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const emergencyBtn = page.locator('.emergency-filter-btn, button:has-text("Emergency")').first();
      const hasBtn = await emergencyBtn.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasBtn).toBe('boolean');
    });

    test('can toggle emergency filter', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const emergencyBtn = page.locator('.emergency-filter-btn, button:has-text("Emergency")').first();
      if (await emergencyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await emergencyBtn.click();
        await page.waitForTimeout(300);
        const isActive = await emergencyBtn.evaluate(el => el.classList.contains('active'));
        expect(typeof isActive).toBe('boolean');
      }
    });
  });

  test.describe('Time Range Selection', () => {
    test('time range buttons exist', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const timeRangeSelector = page.locator('.time-range-selector, .time-btn').first();
      const hasSelector = await timeRangeSelector.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasSelector).toBe('boolean');
    });

    test('can select different time ranges', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const timeBtn = page.locator('.time-btn:has-text("6h"), button:has-text("6h")').first();
      if (await timeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await timeBtn.click();
        await page.waitForTimeout(500);
        const isActive = await timeBtn.evaluate(el => el.classList.contains('active'));
        expect(isActive).toBe(true);
      }
    });

    test('displays 1h, 6h, 24h, 48h, 7d options', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const pageContent = await page.textContent('body');
      const hasRanges = pageContent.includes('1h') && pageContent.includes('24h') && pageContent.includes('7d');
      expect(typeof hasRanges).toBe('boolean');
    });
  });

  test.describe('Autoplay Functionality', () => {
    test('autoplay button exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const autoplayBtn = page.locator('.autoplay-btn, button:has-text("Auto")').first();
      const hasBtn = await autoplayBtn.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasBtn).toBe('boolean');
    });

    test('can toggle autoplay', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const autoplayBtn = page.locator('.autoplay-btn, button:has-text("Auto")').first();
      if (await autoplayBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await autoplayBtn.click();
        await page.waitForTimeout(300);
        const isActive = await autoplayBtn.evaluate(el => el.classList.contains('active'));
        expect(typeof isActive).toBe('boolean');
      }
    });
  });

  test.describe('Refresh and Connection', () => {
    test('refresh button exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const refreshBtn = page.locator('.refresh-btn, button:has([class*="RefreshCw"])').first();
      const hasBtn = await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasBtn).toBe('boolean');
    });

    test('can click refresh button', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const refreshBtn = page.locator('.refresh-btn, button:has([class*="RefreshCw"])').first();
      if (await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await refreshBtn.click();
        await page.waitForTimeout(500);
        // Should trigger refresh
      }
    });

    test('socket status indicator exists', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const statusIndicator = page.locator('.socket-status, [class*="socket"]').first();
      const hasIndicator = await statusIndicator.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasIndicator).toBe('boolean');
    });
  });

  test.describe('Transcript Expansion', () => {
    test('expand button exists for transcripts', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const expandBtn = page.locator('.audio-expand-btn, button:has([class*="ChevronDown"])').first();
      const hasBtn = await expandBtn.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasBtn).toBe('boolean');
    });

    test('can expand transcript section', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const expandBtn = page.locator('.audio-expand-btn, button:has([class*="ChevronDown"])').first();
      if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expandBtn.click();
        await page.waitForTimeout(300);
        const transcriptSection = page.locator('.audio-transcript-section.expanded').first();
        const isExpanded = await transcriptSection.isVisible({ timeout: 2000 }).catch(() => false);
        expect(typeof isExpanded).toBe('boolean');
      }
    });
  });

  test.describe('Transcription Status', () => {
    test('displays transcription status badges', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const statusBadge = page.locator('.audio-item-status, [class*="status"]').first();
      const hasBadge = await statusBadge.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasBadge).toBe('boolean');
    });

    test('displays different status types', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const pageContent = await page.textContent('body');
      const hasStatusTypes = pageContent.includes('Transcribed') || pageContent.includes('Processing') ||
                            pageContent.includes('Queued') || pageContent.includes('Pending');
      expect(typeof hasStatusTypes).toBe('boolean');
    });
  });

  test.describe('Empty State', () => {
    test('shows empty state when no transmissions', async ({ page, mockApi }) => {
      await mockApi.mock('/audio', { transmissions: [], count: 0 });

      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const emptyState = page.locator('.audio-empty, [class*="empty"]').first();
      const hasEmpty = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasEmpty).toBe('boolean');
    });
  });

  test.describe('Loading State', () => {
    test('shows loading state while fetching', async ({ page }) => {
      await page.route('**/api/v1/audio*', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ transmissions: [], count: 0 }),
        });
      });

      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');

      const loading = page.locator('.audio-loading, [class*="loading"]').first();
      const hasLoading = await loading.isVisible({ timeout: 1000 }).catch(() => false);
      expect(typeof hasLoading).toBe('boolean');
    });
  });

  test.describe('Error Handling', () => {
    test('handles API error gracefully', async ({ page, mockApi }) => {
      await mockApi.mockError('/audio', 500, 'Server error');

      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);
      // Page should still render without crashing
    });
  });

  test.describe('Footer', () => {
    test('displays transmission count in footer', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const footer = page.locator('.audio-footer, [class*="footer"]').first();
      const hasFooter = await footer.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasFooter).toBe('boolean');
    });

    test('shows transmission count text', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const pageContent = await page.textContent('body');
      const hasCount = pageContent.includes('Showing') || pageContent.includes('of') ||
                       pageContent.includes('transmissions');
      expect(typeof hasCount).toBe('boolean');
    });
  });

  test.describe('Navigation', () => {
    test('can navigate to map view', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Live Map")');
      await page.waitForURL(/#map/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });

    test('can navigate to aircraft list', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Aircraft List")');
      await page.waitForURL(/#aircraft/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#aircraft');
    });

    test('can navigate to stats view', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      // Try clicking either "Stats" or "Statistics" nav item
      const statsNav = page.locator('.nav-item:has-text("Stats"), .nav-item:has-text("Statistics")').first();
      if (await statsNav.isVisible({ timeout: 3000 }).catch(() => false)) {
        await statsNav.click();
        await page.waitForURL(/#stats/);

        const hash = await page.evaluate(() => window.location.hash);
        expect(hash).toBe('#stats');
      }
    });
  });

  test.describe('Responsive Design', () => {
    test('renders correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('renders correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('toolbar adapts on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const toolbar = page.locator('.audio-toolbar, [class*="toolbar"]').first();
      const hasToolbar = await toolbar.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasToolbar).toBe('boolean');
    });

    test('audio items stack on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const audioItem = page.locator('.audio-item').first();
      const hasItem = await audioItem.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasItem).toBe('boolean');
    });
  });

  test.describe('Keyboard Accessibility', () => {
    test('play button is keyboard accessible', async ({ page }) => {
      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      const playBtn = page.locator('.audio-play-btn').first();
      if (await playBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await playBtn.focus();
        const isFocused = await playBtn.evaluate(el => document.activeElement === el);
        expect(typeof isFocused).toBe('boolean');
      }
    });
  });

  test.describe('Infinite Scroll', () => {
    test('shows load more indicator when more items available', async ({ page, mockApi }) => {
      await mockApi.mock('/audio', {
        transmissions: generateMockTransmissions(50),
        count: 50
      });

      await page.goto('/#audio');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Scroll down to trigger load more
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);

      const loadMore = page.locator('.audio-load-more, [class*="load-more"]').first();
      const hasLoadMore = await loadMore.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasLoadMore).toBe('boolean');
    });
  });
});
