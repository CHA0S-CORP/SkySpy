// @ts-check
/**
 * Integration Test Setup and Utilities
 *
 * This file provides helpers and configuration for running frontend E2E tests
 * against the real Django backend API instead of mocked responses.
 *
 * Prerequisites:
 * 1. Start the integration test environment:
 *    docker-compose -f web/e2e/integration/docker-compose.test.yml up -d
 *
 * 2. Wait for services to be healthy:
 *    docker-compose -f web/e2e/integration/docker-compose.test.yml ps
 *
 * 3. Run integration tests:
 *    cd web && npm run test:e2e:integration
 *
 * Environment Variables:
 *   - INTEGRATION_API_URL: Base URL for Django API (default: http://localhost:8000)
 *   - INTEGRATION_WEB_URL: Base URL for frontend (default: http://localhost:3000)
 *   - TEST_ADMIN_USERNAME: Admin user for seeding (default: admin)
 *   - TEST_ADMIN_PASSWORD: Admin password (default: admin)
 */

import { test as base, expect } from '@playwright/test';

// ============================================================================
// Configuration
// ============================================================================

export const config = {
  apiUrl: process.env.INTEGRATION_API_URL || 'http://localhost:8000',
  webUrl: process.env.INTEGRATION_WEB_URL || 'http://localhost:3000',
  adminUsername: process.env.TEST_ADMIN_USERNAME || 'admin',
  adminPassword: process.env.TEST_ADMIN_PASSWORD || 'admin',
  testUserPrefix: 'test_integration_',
  defaultTimeout: 30000,
};

// ============================================================================
// Test Credentials
// ============================================================================

/**
 * Test user credentials for integration tests.
 * These users should be created in the test database setup.
 */
export const testUsers = {
  admin: {
    username: 'admin',
    password: 'admin',
    email: 'admin@example.com',
  },
  operator: {
    username: 'test_operator',
    password: 'testpass123',
    email: 'operator@test.example.com',
  },
  viewer: {
    username: 'test_viewer',
    password: 'testpass123',
    email: 'viewer@test.example.com',
  },
};

// ============================================================================
// API Client for Test Setup
// ============================================================================

/**
 * API client for making direct calls to the Django backend.
 * Used for test setup/teardown operations.
 */
class ApiClient {
  constructor(baseUrl = config.apiUrl) {
    this.baseUrl = baseUrl;
    this.accessToken = null;
    this.refreshToken = null;
  }

  /**
   * Make an authenticated API request.
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {Object} options - Request options
   * @returns {Promise<Response>}
   */
  async request(method, path, options = {}) {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
      ...options.headers,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    return response;
  }

  /**
   * Authenticate with username/password and store tokens.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<Object>} Token response
   */
  async login(username, password) {
    const response = await this.request('POST', '/auth/login/', {
      body: { username, password },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Login failed: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.access;
    this.refreshToken = data.refresh;
    return data;
  }

  /**
   * Refresh the access token.
   * @returns {Promise<Object>} New token response
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(`${this.baseUrl}/api/v1/auth/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: this.refreshToken }),
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const data = await response.json();
    this.accessToken = data.access;
    return data;
  }

  /**
   * Logout and clear tokens.
   */
  async logout() {
    if (this.refreshToken) {
      await this.request('POST', '/auth/logout/', {
        body: { refresh: this.refreshToken },
      }).catch(() => {});
    }
    this.accessToken = null;
    this.refreshToken = null;
  }

  /**
   * Get current user profile.
   * @returns {Promise<Object>}
   */
  async getProfile() {
    const response = await this.request('GET', '/auth/profile/');
    if (!response.ok) {
      throw new Error('Failed to get profile');
    }
    return response.json();
  }

  /**
   * Check API health.
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/health/`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Database Seeding Helpers
// ============================================================================

/**
 * Database seeding utilities for test setup.
 */
class DatabaseSeeder {
  constructor(apiClient) {
    this.api = apiClient;
  }

  /**
   * Create a test user with specified role.
   * @param {Object} userData - User data
   * @returns {Promise<Object>} Created user
   */
  async createTestUser(userData) {
    const response = await this.api.request('POST', '/admin/users/', {
      body: {
        username: userData.username,
        password: userData.password,
        email: userData.email,
        display_name: userData.displayName || userData.username,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      // User might already exist
      if (response.status === 400 && error.username) {
        console.log(`User ${userData.username} already exists`);
        return null;
      }
      throw new Error(`Failed to create user: ${JSON.stringify(error)}`);
    }

    const user = await response.json();

    // Assign role if specified
    if (userData.role) {
      await this.assignRole(user.user_id, userData.role);
    }

    return user;
  }

  /**
   * Assign a role to a user.
   * @param {number} userId - User ID
   * @param {string} roleName - Role name
   */
  async assignRole(userId, roleName) {
    const response = await this.api.request('POST', `/admin/users/${userId}/assign_role/`, {
      body: { role: roleName },
    });

    if (!response.ok) {
      console.warn(`Failed to assign role ${roleName} to user ${userId}`);
    }
  }

  /**
   * Create an alert rule for testing.
   * @param {Object} ruleData - Alert rule data
   * @returns {Promise<Object>} Created rule
   */
  async createAlertRule(ruleData) {
    const response = await this.api.request('POST', '/alerts/rules/', {
      body: {
        name: ruleData.name || `Test Rule ${Date.now()}`,
        enabled: ruleData.enabled ?? true,
        rule_type: ruleData.type || 'proximity',
        operator: ruleData.operator || 'less_than',
        value: ruleData.value || 10,
        conditions: ruleData.conditions || [],
        priority: ruleData.priority || 'medium',
        visibility: ruleData.visibility || 'private',
        cooldown_minutes: ruleData.cooldown || 5,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Failed to create alert rule: ${JSON.stringify(error)}`);
    }

    return response.json();
  }

  /**
   * Delete an alert rule.
   * @param {number} ruleId - Rule ID
   */
  async deleteAlertRule(ruleId) {
    const response = await this.api.request('DELETE', `/alerts/rules/${ruleId}/`);
    if (!response.ok && response.status !== 404) {
      console.warn(`Failed to delete alert rule ${ruleId}`);
    }
  }

  /**
   * Seed test aircraft info for testing.
   * @param {Object} aircraftData - Aircraft data
   */
  async seedAircraftInfo(aircraftData) {
    // Aircraft info is typically populated by background tasks
    // This is a placeholder for direct database seeding if needed
    console.log('Aircraft seeding requires direct database access');
  }

  /**
   * Clean up test data created during tests.
   * @param {Object} options - Cleanup options
   */
  async cleanup(options = {}) {
    // Delete test alert rules
    if (options.alertRuleIds?.length) {
      for (const ruleId of options.alertRuleIds) {
        await this.deleteAlertRule(ruleId);
      }
    }

    // Delete test users (if admin)
    if (options.userIds?.length) {
      for (const userId of options.userIds) {
        await this.api.request('DELETE', `/admin/users/${userId}/`).catch(() => {});
      }
    }
  }
}

// ============================================================================
// Playwright Test Fixtures
// ============================================================================

/**
 * Extended Playwright test with integration helpers.
 */
export const test = base.extend({
  /**
   * API client fixture for direct API calls.
   */
  apiClient: async ({}, use) => {
    const client = new ApiClient(config.apiUrl);
    await use(client);
    // Cleanup: logout if still logged in
    await client.logout();
  },

  /**
   * Authenticated API client (logged in as admin).
   */
  adminApiClient: async ({}, use) => {
    const client = new ApiClient(config.apiUrl);
    await client.login(testUsers.admin.username, testUsers.admin.password);
    await use(client);
    await client.logout();
  },

  /**
   * Database seeder fixture.
   */
  seeder: async ({ adminApiClient }, use) => {
    const seeder = new DatabaseSeeder(adminApiClient);
    const createdResources = { alertRuleIds: [], userIds: [] };

    // Track created resources for cleanup
    const trackedSeeder = {
      ...seeder,
      createAlertRule: async (data) => {
        const rule = await seeder.createAlertRule(data);
        createdResources.alertRuleIds.push(rule.id);
        return rule;
      },
      createTestUser: async (data) => {
        const user = await seeder.createTestUser(data);
        if (user) {
          createdResources.userIds.push(user.user_id);
        }
        return user;
      },
    };

    await use(trackedSeeder);

    // Cleanup created resources
    await seeder.cleanup(createdResources);
  },

  /**
   * Authentication helper for browser-based login.
   */
  authHelper: async ({ page }, use) => {
    const helper = {
      /**
       * Login via the UI.
       * @param {string} username
       * @param {string} password
       */
      async loginViaUI(username, password) {
        await page.goto(`${config.webUrl}/#login`);
        await page.waitForLoadState('domcontentloaded');

        // Fill login form
        const usernameInput = page.locator('input[type="text"], input[name="username"], input#username').first();
        const passwordInput = page.locator('input[type="password"], input[name="password"], input#password').first();

        if (await usernameInput.isVisible({ timeout: 5000 })) {
          await usernameInput.fill(username);
          await passwordInput.fill(password);

          // Submit
          const submitBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")').first();
          await submitBtn.click();

          // Wait for navigation away from login
          await page.waitForTimeout(1000);
        }
      },

      /**
       * Login by injecting tokens directly (faster for tests).
       * @param {string} username
       * @param {string} password
       */
      async loginViaToken(username, password) {
        const client = new ApiClient(config.apiUrl);
        const tokens = await client.login(username, password);

        // Navigate to app and inject tokens
        await page.goto(config.webUrl);
        await page.evaluate((tokenData) => {
          localStorage.setItem('access_token', tokenData.access);
          localStorage.setItem('refresh_token', tokenData.refresh);
          localStorage.setItem('user', JSON.stringify(tokenData.user));
        }, tokens);

        // Reload to apply tokens
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
      },

      /**
       * Logout via UI.
       */
      async logoutViaUI() {
        // Click user menu and logout
        const userMenu = page.locator('.user-menu, [aria-label="User menu"]').first();
        if (await userMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
          await userMenu.click();
          const logoutBtn = page.locator('button:has-text("Logout"), a:has-text("Logout")').first();
          if (await logoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await logoutBtn.click();
          }
        }
      },

      /**
       * Clear authentication state.
       */
      async clearAuth() {
        await page.evaluate(() => {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user');
        });
      },

      /**
       * Check if currently authenticated.
       * @returns {Promise<boolean>}
       */
      async isAuthenticated() {
        return page.evaluate(() => {
          return !!localStorage.getItem('access_token');
        });
      },

      /**
       * Get stored tokens.
       * @returns {Promise<Object>}
       */
      async getStoredTokens() {
        return page.evaluate(() => ({
          accessToken: localStorage.getItem('access_token'),
          refreshToken: localStorage.getItem('refresh_token'),
          user: JSON.parse(localStorage.getItem('user') || 'null'),
        }));
      },
    };

    await use(helper);

    // Cleanup: clear auth state
    await helper.clearAuth().catch(() => {});
  },

  /**
   * Wait helper for API-dependent operations.
   */
  waitHelper: async ({ page }, use) => {
    const helper = {
      /**
       * Wait for an API response.
       * @param {string} urlPattern - URL pattern to match
       * @param {Object} options - Wait options
       * @returns {Promise<Response>}
       */
      async forApiResponse(urlPattern, options = {}) {
        return page.waitForResponse(
          (response) => response.url().includes(urlPattern),
          { timeout: options.timeout || config.defaultTimeout }
        );
      },

      /**
       * Wait for API to be healthy.
       * @param {number} maxRetries - Maximum retry attempts
       * @returns {Promise<boolean>}
       */
      async forApiHealth(maxRetries = 30) {
        const client = new ApiClient(config.apiUrl);
        for (let i = 0; i < maxRetries; i++) {
          if (await client.healthCheck()) {
            return true;
          }
          await page.waitForTimeout(1000);
        }
        throw new Error('API health check failed after max retries');
      },

      /**
       * Wait for element with retry.
       * @param {string} selector - Element selector
       * @param {Object} options - Wait options
       */
      async forElement(selector, options = {}) {
        const element = page.locator(selector);
        await element.waitFor({
          state: 'visible',
          timeout: options.timeout || config.defaultTimeout,
        });
        return element;
      },
    };

    await use(helper);
  },
});

// Re-export expect and ApiClient
export { expect, ApiClient };

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique test identifier.
 * @returns {string}
 */
export function uniqueTestId() {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Wait for a condition with timeout.
 * @param {Function} condition - Async function returning boolean
 * @param {number} timeout - Timeout in ms
 * @param {number} interval - Check interval in ms
 * @returns {Promise<boolean>}
 */
export async function waitForCondition(condition, timeout = 10000, interval = 500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

/**
 * Retry an async operation.
 * @param {Function} operation - Async function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} delay - Delay between retries in ms
 * @returns {Promise<any>}
 */
export async function retry(operation, maxRetries = 3, delay = 1000) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
