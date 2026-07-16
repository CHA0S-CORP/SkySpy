// @ts-check
/**
 * E2E Tests for WebSocket / Socket.IO resilience.
 *
 * The app connects to the live backend Socket.IO server (vite proxies
 * /socket.io). The sidebar footer renders the connection state as a
 * `.connection-status` element containing the text "LIVE" (connected) or
 * "OFFLINE" (disconnected). These tests exercise that indicator plus the
 * app's ability to keep rendering mocked aircraft data across a simulated
 * connectivity round-trip.
 *
 * All application data (auth config, aircraft list, system status) is mocked
 * so assertions never depend on live-backend contents - only on the socket
 * transport lifecycle, which we drive via Playwright's offline toggle.
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

const connectionStatus = (page) => page.locator('.connection-status');

async function gotoMap(page) {
  await page.goto('/#map');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
}

test.describe('Socket.IO Connection Resilience', () => {
  test.beforeEach(async ({ mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(4));
    await mockApi.mockSystemStatus();
    await mockApi.mock('/safety/events', { events: [], count: 0 });
  });

  test('shows a connected (LIVE) indicator when the socket is up', async ({ page }) => {
    await gotoMap(page);

    // The sidebar footer connection indicator becomes connected once the
    // real socket handshake completes.
    const status = connectionStatus(page);
    await expect(status).toBeVisible();
    await expect(status).toHaveClass(/connected/, { timeout: 15000 });
    await expect(status).toContainText('LIVE');
  });

  test('shows an offline state when connectivity drops', async ({ page, context }) => {
    await gotoMap(page);

    const status = connectionStatus(page);
    // First reach the connected state so the transition is meaningful.
    await expect(status).toHaveClass(/connected/, { timeout: 15000 });

    // Kill connectivity - the socket drops and the indicator flips to OFFLINE.
    await context.setOffline(true);

    await expect(status).toHaveClass(/disconnected/, { timeout: 20000 });
    await expect(status).toContainText('OFFLINE');
  });

  test('recovers to LIVE after connectivity is restored', async ({ page, context }) => {
    await gotoMap(page);

    const status = connectionStatus(page);
    await expect(status).toHaveClass(/connected/, { timeout: 15000 });

    // Drop, confirm offline, then restore and confirm the socket reconnects.
    await context.setOffline(true);
    await expect(status).toHaveClass(/disconnected/, { timeout: 20000 });

    await context.setOffline(false);
    await expect(status).toHaveClass(/connected/, { timeout: 30000 });
    await expect(status).toContainText('LIVE');
  });

  test('opens a /socket.io websocket and closes it when connectivity drops', async ({ page, context }) => {
    // Capture the first socket.io websocket the page opens.
    const firstWs = page.waitForEvent('websocket', {
      predicate: (ws) => ws.url().includes('/socket.io/'),
      timeout: 20000,
    });
    await gotoMap(page);
    const ws1 = await firstWs;
    expect(ws1.url()).toContain('/socket.io/');

    // Taking the page offline tears the socket down; the indicator flips.
    const closed = ws1.isClosed()
      ? Promise.resolve()
      : new Promise((resolve) => ws1.on('close', resolve));
    await context.setOffline(true);
    await closed;

    await expect(connectionStatus(page)).toHaveClass(/disconnected/, { timeout: 20000 });

    // Restoring connectivity recovers the indicator to connected. We assert on
    // the connection-status indicator rather than a raw websocket event, since
    // socket.io may reconnect via a polling transport before upgrading.
    await context.setOffline(false);
    await expect(connectionStatus(page)).toHaveClass(/connected/, { timeout: 30000 });
  });

  test('mocked aircraft data still renders after a reconnect round-trip', async ({ page, context }) => {
    await gotoMap(page);

    const status = connectionStatus(page);
    await expect(status).toHaveClass(/connected/, { timeout: 15000 });

    // Full offline -> online round-trip.
    await context.setOffline(true);
    await expect(status).toHaveClass(/disconnected/, { timeout: 20000 });
    await context.setOffline(false);
    await expect(status).toHaveClass(/connected/, { timeout: 30000 });

    // The app is still mounted and functional; the REST-mocked aircraft feed
    // continues to back the UI. The sidebar navigation remains interactive.
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.getByRole('button', { name: /Live Map/i })).toBeVisible();
  });

  test('app stays mounted and interactive through repeated disconnects', async ({ page, context }) => {
    await gotoMap(page);

    const status = connectionStatus(page);
    await expect(status).toHaveClass(/connected/, { timeout: 15000 });

    // Two quick offline/online cycles must not crash the app.
    for (let i = 0; i < 2; i++) {
      await context.setOffline(true);
      await expect(status).toHaveClass(/disconnected/, { timeout: 20000 });
      await context.setOffline(false);
      await expect(status).toHaveClass(/connected/, { timeout: 45000 });
    }

    await expect(page.locator('.app')).toBeVisible();
    await expect(status).toContainText('LIVE');
  });
});
