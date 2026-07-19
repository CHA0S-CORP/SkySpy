// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Access Control (RBAC) Documentation Screenshots
 *
 * The #access console (Roles | Users | Feature Access | API Keys | Global) is
 * the RBAC admin surface. Its admin endpoints require an authenticated admin, so
 * for docs we mock the four list endpoints with curated data; the permission
 * CATALOG (the feature × action matrix columns) is served live and unauthed from
 * /auth/permissions/.
 */

const ROLES = [
  {
    id: 1,
    display_name: 'Superadmin',
    is_system: true,
    user_count: 1,
    permissions: [
      'aircraft.view', 'aircraft.view_military', 'aircraft.view_details',
      'alerts.view', 'alerts.edit', 'assistant.view', 'access.view', 'access.edit',
      'safety.view', 'system.view', 'audio.view',
    ],
  },
  {
    id: 2,
    display_name: 'Analyst',
    is_system: true,
    user_count: 3,
    permissions: ['aircraft.view', 'aircraft.view_details', 'alerts.view', 'alerts.edit', 'assistant.view', 'safety.view'],
  },
  { id: 3, display_name: 'Viewer', is_system: true, user_count: 8, permissions: ['aircraft.view', 'safety.view'] },
  { id: 4, display_name: 'Watch Officer', is_system: false, user_count: 2, permissions: ['aircraft.view', 'aircraft.view_military', 'alerts.view', 'safety.view'] },
];

const USERS = [
  { id: 1, display_name: 'Max (Owner)', username: 'admin', email: 'admin@skyspy.local', is_active: true, is_superuser: true, roles: [{ name: 'superadmin', display_name: 'Superadmin' }] },
  { id: 2, display_name: 'J. Rivera', username: 'jrivera', email: 'jrivera@skyspy.local', is_active: true, roles: [{ name: 'analyst', display_name: 'Analyst' }] },
  { id: 3, display_name: 'K. Okafor', username: 'kokafor', email: 'kokafor@skyspy.local', is_active: true, roles: [{ name: 'analyst', display_name: 'Analyst' }, { name: 'watch_officer', display_name: 'Watch Officer' }] },
  { id: 4, display_name: 'Guest Kiosk', username: 'kiosk', email: '', is_active: false, roles: [{ name: 'viewer', display_name: 'Viewer' }] },
];

async function mockAdmin(page) {
  await page.route('**/api/v1/admin/roles/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ roles: ROLES }) }));
  await page.route('**/api/v1/admin/users/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ users: USERS }) }));
  await page.route('**/api/v1/admin/feature-access/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [] }) }));
  await page.route('**/api/v1/admin/api-keys/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ api_keys: [] }) }));
}

test.describe('Access Control Screenshots', () => {
  test.beforeEach(async ({ page, screenshotState }) => {
    await mockAdmin(page);
    await screenshotState.setupForScreenshot();
    await page.goto('/#access');
    await page.waitForLoadState('domcontentloaded');
  });

  test('access-roles', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await page.waitForTimeout(1200);
    await screenshotHelper.prepare();
    await screenshotHelper.capture('access-roles', {
      description: 'RBAC roles console — role list and the feature × action permission matrix',
    });
  });

  test('access-users', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await page.getByRole('button', { name: /Users/i }).first().click().catch(() => {});
    await page.waitForTimeout(900);
    await screenshotHelper.prepare();
    await screenshotHelper.capture('access-users', {
      description: 'User accounts with per-user role assignment',
    });
  });
});
