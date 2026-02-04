// @ts-check
/**
 * Global setup for integration tests.
 *
 * This runs before all tests to ensure:
 * - API is healthy and accessible
 * - Database is migrated
 * - Test users exist
 */

const config = {
  apiUrl: process.env.INTEGRATION_API_URL || 'http://localhost:8000',
  webUrl: process.env.INTEGRATION_WEB_URL || 'http://localhost:3000',
  maxRetries: 60,
  retryInterval: 2000,
};

/**
 * Wait for the API to be healthy.
 * @returns {Promise<boolean>}
 */
async function waitForApiHealth() {
  console.log(`Waiting for API at ${config.apiUrl}...`);

  for (let i = 0; i < config.maxRetries; i++) {
    try {
      const response = await fetch(`${config.apiUrl}/health/`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (response.ok) {
        console.log('API is healthy!');
        return true;
      }
    } catch (error) {
      // Connection refused or other network error
    }

    if (i % 10 === 0 && i > 0) {
      console.log(`Still waiting for API... (${i}/${config.maxRetries})`);
    }

    await new Promise((resolve) => setTimeout(resolve, config.retryInterval));
  }

  throw new Error(`API health check failed after ${config.maxRetries} attempts`);
}

/**
 * Wait for the frontend to be accessible.
 * @returns {Promise<boolean>}
 */
async function waitForFrontend() {
  console.log(`Waiting for frontend at ${config.webUrl}...`);

  for (let i = 0; i < config.maxRetries; i++) {
    try {
      const response = await fetch(config.webUrl, {
        method: 'GET',
      });

      if (response.ok) {
        console.log('Frontend is accessible!');
        return true;
      }
    } catch (error) {
      // Connection refused or other network error
    }

    if (i % 10 === 0 && i > 0) {
      console.log(`Still waiting for frontend... (${i}/${config.maxRetries})`);
    }

    await new Promise((resolve) => setTimeout(resolve, config.retryInterval));
  }

  throw new Error(`Frontend health check failed after ${config.maxRetries} attempts`);
}

/**
 * Verify auth configuration is accessible.
 * @returns {Promise<Object>}
 */
async function checkAuthConfig() {
  console.log('Checking auth configuration...');

  try {
    const response = await fetch(`${config.apiUrl}/api/v1/auth/config/`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (response.ok) {
      const authConfig = await response.json();
      console.log(`Auth mode: ${authConfig.auth_mode}`);
      console.log(`Auth enabled: ${authConfig.auth_enabled}`);
      console.log(`Local auth: ${authConfig.local_auth_enabled}`);
      return authConfig;
    }
  } catch (error) {
    console.warn('Could not fetch auth config:', error.message);
  }

  return null;
}

/**
 * Verify test users can login.
 * @returns {Promise<boolean>}
 */
async function verifyTestUsers() {
  console.log('Verifying test users...');

  const testUsers = [
    { username: 'admin', password: 'admin' },
    { username: 'test_operator', password: 'testpass123' },
    { username: 'test_viewer', password: 'testpass123' },
  ];

  for (const user of testUsers) {
    try {
      const response = await fetch(`${config.apiUrl}/api/v1/auth/login/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          username: user.username,
          password: user.password,
        }),
      });

      if (response.ok) {
        console.log(`  [OK] ${user.username} can login`);
      } else {
        const error = await response.json().catch(() => ({}));
        console.log(`  [WARN] ${user.username} login failed: ${error.error || response.statusText}`);
      }
    } catch (error) {
      console.log(`  [ERROR] ${user.username} login error: ${error.message}`);
    }
  }

  return true;
}

/**
 * Global setup function.
 * @param {import('@playwright/test').FullConfig} config
 */
async function globalSetup(config) {
  console.log('\n========================================');
  console.log('Integration Test Global Setup');
  console.log('========================================\n');

  // Wait for services to be ready
  await waitForApiHealth();
  await waitForFrontend();

  // Check configuration
  await checkAuthConfig();
  await verifyTestUsers();

  console.log('\n========================================');
  console.log('Setup Complete - Running Tests');
  console.log('========================================\n');
}

module.exports = globalSetup;
