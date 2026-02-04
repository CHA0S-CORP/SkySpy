# Integration Tests

Frontend-backend integration tests that run against the real Django API.

## Overview

These tests verify complete user workflows by running Playwright E2E tests against actual backend services, rather than mocked API responses. This ensures that:

- API contracts match frontend expectations
- Authentication flows work end-to-end
- Database persistence is correct
- Real-time WebSocket updates function properly

## Prerequisites

- Docker and Docker Compose installed
- Node.js 18+ installed
- Playwright browsers installed (`npx playwright install`)

## Quick Start

1. **Start the integration test environment:**

   ```bash
   docker-compose -f web/e2e/integration/docker-compose.test.yml up -d
   ```

2. **Wait for services to be healthy:**

   ```bash
   # Check service status
   docker-compose -f web/e2e/integration/docker-compose.test.yml ps

   # Or check API health directly
   curl http://localhost:8000/health/
   ```

3. **Run integration tests:**

   ```bash
   cd web
   npm run test:e2e:integration
   ```

4. **Stop the environment when done:**

   ```bash
   docker-compose -f web/e2e/integration/docker-compose.test.yml down -v
   ```

## Test Suites

### Authentication Workflow (`auth-workflow.spec.js`)

Tests authentication-related functionality:

- Login with valid/invalid credentials
- JWT token handling
- Session persistence across page reloads
- Logout and token invalidation
- Token refresh mechanism
- Multi-tab session handling
- Auth configuration endpoint

### Alert Workflow (`alert-workflow.spec.js`)

Tests alert rule management:

- Create alert rules (proximity, callsign, squawk, altitude)
- Edit rule properties and conditions
- Delete rules (single and bulk)
- Alert subscriptions
- Alert history and acknowledgment
- Rule testing against sample data
- Import/export functionality

### Aircraft Workflow (`aircraft-workflow.spec.js`)

Tests aircraft tracking features:

- Aircraft list and filtering
- Search by callsign, registration, ICAO
- Aircraft detail view with tabs
- Photo fetching and caching
- Track history and replay
- ACARS message viewing
- Safety event tracking
- Map visualization

## Test Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INTEGRATION_API_URL` | `http://localhost:8000` | Django API URL |
| `INTEGRATION_WEB_URL` | `http://localhost:3000` | Frontend URL |
| `TEST_ADMIN_USERNAME` | `admin` | Admin test user |
| `TEST_ADMIN_PASSWORD` | `admin` | Admin password |

### Test Users

The integration environment creates these test users:

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin` | Superuser/Admin |
| `test_operator` | `testpass123` | Operator |
| `test_viewer` | `testpass123` | Viewer |

## Running Specific Tests

```bash
# Run a single test file
npm run test:e2e:integration -- auth-workflow.spec.js

# Run tests matching a pattern
npm run test:e2e:integration -- --grep "login"

# Run in headed mode (visible browser)
npm run test:e2e:integration:headed

# Run in debug mode
npm run test:e2e:integration:debug
```

## Test Reports

After running tests, reports are available at:

- HTML Report: `web/playwright-report-integration/index.html`
- JUnit XML: `web/test-results-integration/junit.xml`
- Screenshots/Videos: `web/test-results-integration/`

To view the HTML report:

```bash
npx playwright show-report playwright-report-integration
```

## Writing New Tests

### Test Structure

```javascript
import { test, expect, config, testUsers } from './conftest.js';

test.describe('Feature Name @integration', () => {
  test('test description', async ({ page, authHelper, adminApiClient }) => {
    // Login if needed
    await authHelper.loginViaToken(testUsers.admin.username, testUsers.admin.password);

    // Navigate
    await page.goto(`${config.webUrl}/#view`);

    // Interact and assert
    await expect(page.locator('.element')).toBeVisible();
  });
});
```

### Available Fixtures

- `apiClient` - Unauthenticated API client for direct API calls
- `adminApiClient` - Pre-authenticated API client (admin user)
- `seeder` - Database seeding utilities with automatic cleanup
- `authHelper` - Browser-based authentication helpers
- `waitHelper` - Utilities for waiting on API responses

### Best Practices

1. **Use API calls for setup/teardown** - Use `adminApiClient` to create test data rather than UI interactions
2. **Clean up after tests** - Track created resources and delete them in `afterEach`
3. **Be resilient to UI variations** - Use multiple selectors and `.catch(() => false)` patterns
4. **Wait appropriately** - Use explicit waits for API responses rather than arbitrary timeouts
5. **Test isolation** - Each test should be independent and not rely on other tests

## Troubleshooting

### API Not Accessible

```bash
# Check if API container is running
docker-compose -f web/e2e/integration/docker-compose.test.yml ps

# Check API logs
docker-compose -f web/e2e/integration/docker-compose.test.yml logs api

# Verify health endpoint
curl -v http://localhost:8000/health/
```

### Database Issues

```bash
# Reset the database
docker-compose -f web/e2e/integration/docker-compose.test.yml down -v
docker-compose -f web/e2e/integration/docker-compose.test.yml up -d
```

### Test Timeouts

Integration tests have longer timeouts by default (120s test timeout, 60s action timeout). If tests still timeout:

1. Check service health
2. Increase timeouts in `playwright.integration.config.js`
3. Consider if the test is doing too much

### Flaky Tests

1. Add explicit waits for API responses
2. Use `test.retry(2)` for inherently flaky tests
3. Check for race conditions in test setup

## CI/CD Integration

For CI pipelines, use Docker Compose to run the integration environment:

```yaml
steps:
  - name: Start integration environment
    run: |
      docker-compose -f web/e2e/integration/docker-compose.test.yml up -d

  - name: Wait for services
    run: |
      timeout 120 bash -c 'until curl -s http://localhost:8000/health/ > /dev/null; do sleep 2; done'

  - name: Run integration tests
    run: |
      cd web
      npm run test:e2e:integration

  - name: Stop environment
    if: always()
    run: |
      docker-compose -f web/e2e/integration/docker-compose.test.yml down -v
```

## Related Files

- `conftest.js` - Test fixtures and utilities
- `global-setup.js` - Pre-test environment validation
- `playwright.integration.config.js` - Playwright configuration
- `docker-compose.test.yml` - Docker Compose services
