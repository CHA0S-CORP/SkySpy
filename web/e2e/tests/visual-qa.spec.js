// @ts-check
/**
 * Full-app visual QA sweep.
 *
 * Unlike the mocked suites, this runs against the REAL backend (vite dev
 * proxy -> Django at :8000) so it catches integration bugs the mocks hide.
 * Every navigable view is loaded, allowed to settle, and must:
 *   - render its root content (not the ErrorBoundary fallback, not blank)
 *   - produce zero unexpected console errors and zero page errors
 *   - produce zero unexpected failed backend requests (>=500 always fails,
 *     4xx fails unless allowlisted as an expected not-found probe)
 * A full-page screenshot of each view is saved under e2e/screenshots/qa/.
 *
 * Requires the dev stack: `make dev` (Django API on :8000 with data flowing).
 */

import { test, expect } from '@playwright/test';

const SCREENSHOT_DIR = 'e2e/screenshots/qa';
const SETTLE_MS = 6000;

// Console noise that is expected in a headless, permission-less browser or
// is an explicit expected-not-found fallback path.
const BENIGN_CONSOLE = [
  /AudioContext was not allowed to start/,
  /Notification permission/,
  /ResizeObserver loop/,
  /Download the React DevTools/,
  // @axe-core/react dev logger reports a11y findings via console.error;
  // accessibility has its own dedicated spec (accessibility.spec.js)
  /Fix any of the following/,
  /Fix all of the following/,
  /axe-core/,
  // Aircraft info fallback chain probes these and handles 404s
  /Failed to load resource.*(airframes|lookup\/aircraft)/,
  /the server responded with a status of 404/,
  // Anonymous probes of authenticated endpoints (admin view without login);
  // the browser logs these natively, the UI handles 401 as "login required"
  /the server responded with a status of 401/,
  // socket.io transport teardown race during reconnect - client recovers
  /WebSocket is already in CLOSING or CLOSED state/,
];

// Backend 4xx paths that are legitimate "not found / not configured" probes.
const BENIGN_4XX = [
  /\/api\/v1\/airframes\//,
  /\/api\/v1\/lookup\/aircraft\//,
  /\/api\/v1\/audio\/frequencies/,
];

// External hosts (tiles, weather) can be flaky/offline - never fail the QA
// sweep on them, the app must degrade gracefully instead (console clean).
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

function isLocalUrl(url) {
  try {
    return LOCAL_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Attach console/pageerror/response collectors to a page. */
function collectErrors(page) {
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (BENIGN_CONSOLE.some((re) => re.test(text))) return;
    problems.push(`console: ${text.split('\n')[0]}`);
  });
  page.on('pageerror', (err) => {
    problems.push(`pageerror: ${String(err).split('\n')[0]}`);
  });
  page.on('response', (resp) => {
    const url = resp.url();
    if (!isLocalUrl(url)) return;
    const status = resp.status();
    if (status >= 500) {
      problems.push(`http ${status}: ${url.slice(0, 120)}`);
    } else if (status >= 400 && status !== 401 && !BENIGN_4XX.some((re) => re.test(url))) {
      problems.push(`http ${status}: ${url.slice(0, 120)}`);
    }
  });
  return problems;
}

async function assertNotErrorBoundary(page) {
  const boundaryText = page.locator('text=Something went wrong');
  await expect(boundaryText, 'ErrorBoundary fallback should not be shown').toHaveCount(0);
}

async function settleAndVerify(page, problems, name, rootSelector) {
  await expect(page.locator('.app')).toBeVisible({ timeout: 15000 });
  if (rootSelector) {
    await expect(
      page.locator(rootSelector).first(),
      `${name}: root element ${rootSelector}`
    ).toBeVisible({
      timeout: 20000,
    });
  }
  await page.waitForTimeout(SETTLE_MS);
  await assertNotErrorBoundary(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
  expect(problems, `${name}: unexpected errors`).toEqual([]);
}

// ============================================================================
// Primary views (hash tabs)
// ============================================================================

const VIEWS = [
  { tab: 'map', name: 'map-default', root: '.map-container' },
  {
    tab: 'aircraft',
    name: 'aircraft-list',
    root: '.aircraft-list-view, .al-card-grid, .al-virtual-table-body',
  },
  { tab: 'stats', name: 'stats', root: '.stats-bento-container' },
  { tab: 'history', name: 'history', root: '.history-container' },
  { tab: 'audio', name: 'audio', root: '.audio-container' },
  { tab: 'notams', name: 'notams', root: '.history-container, .notams-view, .notams-container' },
  { tab: 'pireps', name: 'pireps', root: '.history-container, .pireps-view, .pireps-container' },
  {
    tab: 'archive',
    name: 'archive',
    root: '.history-container, .archive-view, .archive-container',
  },
  { tab: 'alerts', name: 'alerts', root: '.alerts-container' },
  { tab: 'system', name: 'system', root: '.system-view, .status-grid, .service-name' },
  { tab: 'admin', name: 'admin-config', root: '.view-admin-config' },
  {
    tab: 'cannonball',
    name: 'cannonball',
    root: '.cannonball-mode, .cannonball-view, .cannonball-container',
  },
  { tab: 'login', name: 'login', root: '.login-view, .login-container, form' },
];

test.describe('Visual QA - all views', () => {
  for (const view of VIEWS) {
    test(`${view.tab} view renders clean`, async ({ page }) => {
      const problems = collectErrors(page);
      await page.goto(`/#${view.tab}`);
      await settleAndVerify(page, problems, view.name, view.root);
    });
  }
});

// ============================================================================
// Map display modes
// ============================================================================

const MAP_MODES = ['pro', 'crt', 'radar', 'map'];

test.describe('Visual QA - map modes', () => {
  for (const mode of MAP_MODES) {
    test(`map mode "${mode}" renders clean`, async ({ page }) => {
      const problems = collectErrors(page);
      await page.addInitScript((m) => {
        localStorage.setItem('adsb-dashboard-config', JSON.stringify({ mapMode: m }));
      }, mode);
      await page.goto('/#map');
      await expect(page.locator('.app')).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(SETTLE_MS + 4000);
      await assertNotErrorBoundary(page);

      if (mode === 'pro' || mode === 'crt') {
        // Canvas must have real dimensions and painted pixels
        const canvasInfo = await page.evaluate(() => {
          const c = document.querySelector('.crt-radar-container canvas');
          if (!c) return { present: false };
          if (!c.width || !c.height) return { present: true, w: c.width, h: c.height, painted: 0 };
          const ctx = c.getContext('2d');
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let painted = 0;
          for (let i = 0; i < d.length; i += 40) if (d[i] | d[i + 1] | d[i + 2]) painted++;
          return { present: true, w: c.width, h: c.height, painted };
        });
        expect(canvasInfo.present, `${mode}: radar canvas present`).toBe(true);
        expect(canvasInfo.w, `${mode}: canvas width`).toBeGreaterThan(100);
        expect(canvasInfo.h, `${mode}: canvas height`).toBeGreaterThan(100);
        expect(canvasInfo.painted, `${mode}: canvas painted pixels`).toBeGreaterThan(100);
      }
      if (mode === 'map') {
        // Leaflet map with tiles
        await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15000 });
        const tiles = await page.locator('img.leaflet-tile').count();
        expect(tiles, 'map: leaflet tiles loaded').toBeGreaterThan(0);
      }

      await page.screenshot({ path: `${SCREENSHOT_DIR}/map-mode-${mode}.png`, fullPage: true });
      expect(problems, `map mode ${mode}: unexpected errors`).toEqual([]);
    });
  }
});

// ============================================================================
// Live data smoke: the map should actually show traffic from the backend
// ============================================================================

test.describe('Visual QA - live data', () => {
  test('aircraft data reaches the UI', async ({ page }) => {
    const problems = collectErrors(page);
    await page.addInitScript(() => {
      localStorage.setItem('adsb-dashboard-config', JSON.stringify({ mapMode: 'map' }));
    });
    await page.goto('/#map');
    await expect(page.locator('.app')).toBeVisible({ timeout: 15000 });

    // Wait for the header aircraft counter to go above zero (live stream)
    await expect
      .poll(
        async () => {
          const text = await page.evaluate(() => document.body.innerText);
          const m = text.match(/(\d+)\s*AIRCRAFT/i);
          return m ? parseInt(m[1], 10) : 0;
        },
        { timeout: 60000, message: 'header aircraft count should be > 0' }
      )
      .toBeGreaterThan(0);

    // And markers should appear on the leaflet map (feeder marker + aircraft)
    await expect
      .poll(async () => page.locator('.leaflet-marker-icon').count(), {
        timeout: 30000,
        message: 'aircraft markers should render',
      })
      .toBeGreaterThan(1);

    // The feeder location must reach the UI (header shows real LAT/LON, not
    // "--"): regression guard for the location.{latitude,longitude} vs
    // {lat,lon} key mismatch that silently recentered the map on the default
    const headerLat = await page.locator('.header .stat-value').first().innerText();
    expect(headerLat, 'header LAT should show the feeder latitude').not.toContain('--');

    await page.screenshot({ path: `${SCREENSHOT_DIR}/live-data.png`, fullPage: true });
    expect(problems, 'live data: unexpected errors').toEqual([]);
  });
});

// ============================================================================
// Settings modal + sidebar interactions
// ============================================================================

test.describe('Visual QA - chrome', () => {
  test('settings modal opens clean', async ({ page }) => {
    const problems = collectErrors(page);
    await page.goto('/#map');
    await expect(page.locator('.app')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Open settings via the header gear button
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForTimeout(1500);
    await assertNotErrorBoundary(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/settings-modal.png`, fullPage: true });
    expect(problems, 'settings modal: unexpected errors').toEqual([]);
  });

  test('sidebar navigation cycles all views without errors', async ({ page }) => {
    const problems = collectErrors(page);
    await page.goto('/#map');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15000 });

    for (const tab of ['aircraft', 'stats', 'history', 'audio', 'alerts', 'system', 'map']) {
      await page.evaluate((t) => {
        window.location.hash = `#${t}`;
      }, tab);
      await page.waitForTimeout(2500);
      await assertNotErrorBoundary(page);
    }
    expect(problems, 'view cycling: unexpected errors').toEqual([]);
  });
});
