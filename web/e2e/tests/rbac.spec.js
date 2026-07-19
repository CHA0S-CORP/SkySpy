/**
 * RBAC end-to-end validation against the REAL auth-enforced backend
 * (`make dev-auth`: AUTH_MODE=hybrid, DEV_MODE=False, seeded admin/admin +
 * user/user[viewer]). Verifies the Access Control console renders for an admin,
 * that permission-gated nav is hidden from a viewer, and that the role matrix
 * loads its catalog. Skips itself if the stack isn't running.
 *
 * Logins are done ONCE per role in beforeAll and the tokens reused — the auth
 * endpoint is throttled (API_THROTTLE_AUTH=5/min), so per-test logins flake.
 * Run serially (single worker) for the same reason.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let adminTokens = null;
let viewerTokens = null;

async function login(request, username, password) {
  const r = await request.post('/api/v1/auth/login', {
    data: { username, password },
    failOnStatusCode: false,
  });
  return { ok: r.ok(), status: r.status(), body: await r.json().catch(() => null) };
}

/** Inject the real login result (tokens + user) BEFORE first load so AuthContext
 *  paints an authenticated user on first render — avoiding the null-user guard
 *  race — while still reconciling against the server. Must run before page.goto;
 *  a later hash-only nav won't re-init auth. */
async function seedSession(page, tokens) {
  await page.addInitScript((t) => {
    localStorage.setItem('skyspy_access_token', t.access);
    localStorage.setItem('skyspy_refresh_token', t.refresh);
    localStorage.setItem('skyspy_user', JSON.stringify(t.user));
  }, tokens);
}

test.beforeAll(async ({ request }) => {
  const admin = await login(request, 'admin', 'admin');
  if (admin.ok) adminTokens = admin.body;
  const viewer = await login(request, 'user', 'user');
  if (viewer.ok) viewerTokens = viewer.body;

  // Deterministic posture for the gating tests: aircraft is Public (anonymous),
  // alerts stays Signed-in only, and the viewer role is reset to its shipped
  // defaults (no assistant.view / cannonball.view; has services.view) so the
  // per-role assertions don't drift with hand edits made in the UI.
  if (adminTokens) {
    const headers = { Authorization: `Bearer ${adminTokens.access}` };
    await request.patch('/api/v1/admin/feature-access/aircraft/', {
      headers,
      data: { read_access: 'public' },
    });
    await request.patch('/api/v1/admin/feature-access/alerts/', {
      headers,
      data: { read_access: 'authenticated' },
    });
    const rolesRes = await request.get('/api/v1/admin/roles/', { headers });
    const viewerRole = (await rolesRes.json().catch(() => ({}))).roles?.find(
      (r) => r.name === 'viewer'
    );
    if (viewerRole) {
      await request.post(`/api/v1/admin/roles/${viewerRole.id}/reset_defaults/`, { headers });
      // Re-login the viewer so the seeded token/profile reflects the reset perms.
      const v = await login(request, 'user', 'user');
      if (v.ok) viewerTokens = v.body;
    }
  }
});

test.describe('RBAC — Access Control console', () => {
  test('admin sees permission-gated nav (Access Control, Assistant, System, Admin)', async ({
    page,
  }) => {
    test.skip(!adminTokens, 'dev-auth stack not running (make dev-auth)');
    expect(adminTokens.user.is_superuser).toBe(true);

    await seedSession(page, adminTokens);
    await page.goto('/#map');

    await expect(page.getByTestId('v2-nav-access')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('v2-nav-assistant')).toBeVisible();
    await expect(page.getByTestId('v2-nav-system')).toBeVisible();
    await expect(page.getByTestId('v2-nav-admin')).toBeVisible();
    // Cannonball + Services are RBAC features the admin holds.
    await expect(page.getByTestId('v2-nav-cannonball')).toBeVisible();
    await expect(page.getByTestId('v2-nav-services')).toBeVisible();
  });

  test('admin can open Access Control and the role matrix loads', async ({ page }) => {
    test.skip(!adminTokens, 'dev-auth stack not running');
    await seedSession(page, adminTokens);

    await page.goto('/#access');

    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible({
      timeout: 15000,
    });
    for (const label of ['Roles', 'Users', 'Feature Access', 'API Keys', 'Global']) {
      await expect(page.getByRole('tab', { name: label })).toBeVisible();
    }

    // Wait for the async loads (catalog + roles) to settle before counting.
    await expect(page.locator('.v2-access__loading')).toHaveCount(0, { timeout: 20000 });

    // Roles list has the 5 built-ins (proves adminApi authed + loaded real data).
    await expect(page.locator('.v2-access-roles__item')).toHaveCount(5, { timeout: 15000 });
    await expect(
      page.locator('.v2-access-roles__name').filter({ hasText: 'Super Admin' })
    ).toBeVisible();
    await expect(
      page.locator('.v2-access-roles__name').filter({ hasText: 'Viewer' })
    ).toBeVisible();
    // Matrix renders a row per feature (12: incl. cannonball + services) + cells.
    await expect(page.locator('.v2-access-matrix__row')).toHaveCount(12, { timeout: 15000 });
    await expect(page.locator('.v2-access-cell').first()).toBeVisible();
  });

  test('Feature Access lists Cannonball + Services as RBAC features', async ({ page }) => {
    test.skip(!adminTokens, 'dev-auth stack not running');
    await seedSession(page, adminTokens);
    await page.goto('/#access');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('.v2-access__loading')).toHaveCount(0, { timeout: 20000 });

    await page.getByRole('tab', { name: 'Feature Access' }).click();
    await expect(page.getByText('Cannonball Mode')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('External Services')).toBeVisible();
  });

  test('admin can open the New User dialog from the Users tab', async ({ page }) => {
    test.skip(!adminTokens, 'dev-auth stack not running');
    await seedSession(page, adminTokens);
    await page.goto('/#access');
    await expect(page.getByRole('heading', { name: 'Access Control' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('.v2-access__loading')).toHaveCount(0, { timeout: 20000 });

    await page.getByRole('tab', { name: 'Users' }).click();
    await page.getByRole('button', { name: /new user/i }).click();

    // The create dialog exposes username/password + an initial-role picker.
    const dialog = page.getByRole('dialog', { name: 'New local user' });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText('Initial role (optional)')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create user' })).toBeVisible();
  });

  test('viewer does NOT see Access Control or Admin nav', async ({ page }) => {
    test.skip(!viewerTokens, 'dev-auth stack not running');
    expect(viewerTokens.user.is_superuser).toBe(false);

    await seedSession(page, viewerTokens);
    await page.goto('/#map');

    // A core feature nav proves we're authenticated and rendered.
    await expect(page.getByTestId('v2-nav-map')).toBeVisible({ timeout: 15000 });
    // Permission-gated entries stay hidden for a viewer (no roles.view / system.manage).
    await expect(page.getByTestId('v2-nav-access')).toHaveCount(0);
    await expect(page.getByTestId('v2-nav-admin')).toHaveCount(0);
  });

  test('viewer hitting #access directly is refused (no console)', async ({ page }) => {
    test.skip(!viewerTokens, 'dev-auth stack not running');
    await seedSession(page, viewerTokens);

    await page.goto('/#access');

    // The guard renders a permission message, not the tabbed console.
    await expect(page.getByText(/permission to manage access control/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('tab', { name: 'Roles' })).toHaveCount(0);
  });
});

test.describe('RBAC — gates & login prompts', () => {
  // In hybrid mode an anonymous visitor reaches the app shell and sees the
  // features marked Public (anonymous) — NOT a blanket login wall.
  test('anonymous sees public features (no login wall in hybrid)', async ({ page }) => {
    test.skip(!adminTokens, 'dev-auth stack not running');
    await page.goto('/#map');

    // The app chrome renders (not the LoginPage) and the public feature is shown.
    await expect(page.getByTestId('v2-nav')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('v2-nav-aircraft')).toBeVisible();
    await expect(page.locator('.login-form')).toHaveCount(0);
  });

  test('anonymous does NOT see signed-in-only or management nav', async ({ page }) => {
    test.skip(!adminTokens, 'dev-auth stack not running');
    await page.goto('/#map');
    await expect(page.getByTestId('v2-nav')).toBeVisible({ timeout: 15000 });

    // alerts is Signed-in only; access/admin are permission-gated → all hidden.
    await expect(page.getByTestId('v2-nav-alerts')).toHaveCount(0);
    await expect(page.getByTestId('v2-nav-access')).toHaveCount(0);
    await expect(page.getByTestId('v2-nav-admin')).toHaveCount(0);
  });

  test('anonymous can still reach the login page', async ({ page }) => {
    test.skip(!adminTokens, 'dev-auth stack not running');
    await page.goto('/#login');
    // The #login route renders LoginPage regardless of mode; assert a password
    // field (robust across the page's local/OIDC form variants).
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('anonymous opening the Assistant gets the sign-in-to-unlock prompt', async ({ page }) => {
    test.skip(!adminTokens, 'dev-auth stack not running');
    await page.goto('/#assistant');
    await expect(page.getByText('Sign in to unlock the assistant')).toBeVisible({ timeout: 15000 });
  });

  test('viewer nav shows core features but hides Access Control & Admin', async ({ page }) => {
    test.skip(!viewerTokens, 'dev-auth stack not running');
    await seedSession(page, viewerTokens);
    await page.goto('/#map');

    // Feature-level items (authenticated) + system (viewer has system.view_status).
    for (const id of ['map', 'aircraft', 'history', 'audio', 'alerts', 'system', 'assistant']) {
      await expect(page.getByTestId(`v2-nav-${id}`)).toBeVisible({ timeout: 15000 });
    }
    // Services is granted to viewer by default; Cannonball is not.
    await expect(page.getByTestId('v2-nav-services')).toBeVisible();
    await expect(page.getByTestId('v2-nav-cannonball')).toHaveCount(0);
    // Permission-gated management entries stay hidden.
    await expect(page.getByTestId('v2-nav-access')).toHaveCount(0);
    await expect(page.getByTestId('v2-nav-admin')).toHaveCount(0);
  });

  test('viewer opening the Assistant gets the sign-in-to-unlock prompt', async ({ page }) => {
    test.skip(!viewerTokens, 'dev-auth stack not running');
    await seedSession(page, viewerTokens);
    await page.goto('/#assistant');

    // CanUseAssistant returns 401/403 for a viewer (no assistant.view) → LockedFeature.
    await expect(page.getByText('Sign in to unlock the assistant')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /sign in to unlock/i })).toBeVisible();
    // The chat composer must NOT be usable.
    await expect(page.locator('.v2-asst__composer')).toHaveCount(0);
  });

  test('admin opening the Assistant is NOT locked (has assistant.view)', async ({ page }) => {
    test.skip(!adminTokens, 'dev-auth stack not running');
    await seedSession(page, adminTokens);
    await page.goto('/#assistant');

    // Composer renders; the lock prompt is absent.
    await expect(page.locator('.v2-asst__composer')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Sign in to unlock the assistant')).toHaveCount(0);
  });
});
