# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkySpy is a real-time ADS-B aircraft tracking platform that captures position data from 1090MHz Mode S and 978MHz UAT receivers, displays aircraft on an interactive map, and provides safety monitoring, custom alerts, and push notifications.

## Repository Structure

Monorepo with four components:

- **skyspy_django/** - Django backend API with Socket.IO real-time streaming
- **web/** - React frontend dashboard (Vite, JSX, Tailwind CSS 4.1)
- **skyspy-go/** - Go CLI TUI radar client (Bubble Tea + Cobra)
- **skyspy_common/** - Shared Python package: libacars CFFI bindings for ACARS message decoding

## Development Commands

### Start Development Environment (Docker)

```bash
make dev              # Start all services with mock data
make dev-down         # Stop services
make dev-logs         # View logs
```

Services: Dashboard :3000, Django API :8000, Django Admin :8000/admin/ (admin/admin), Mock Ultrafeeder :18080, Mock Dump978 :18081

### Running Tests

```bash
# All tests in Docker (recommended)
make test

# Python package tests
make test-common      # skyspy_common tests
make test-cli         # CLI tests
make test-python      # All Python tests

# Frontend tests (from web/)
npm run test:unit           # Unit tests
npm run test:unit:watch     # Watch mode
npm run test:e2e            # Playwright E2E tests (Chromium)
npm run test:e2e:all-browsers
```

### Running a Single Test

```bash
# Python - single file, function, or class method
pytest skyspy_django/skyspy/tests/test_api_aircraft.py -v
pytest skyspy_django/skyspy/tests/test_api_aircraft.py::test_aircraft_list -v
pytest skyspy_django/skyspy/tests/test_api_aircraft.py::TestClass::test_method -v

# Frontend - single file or pattern (from web/)
npm run test:unit -- src/hooks/useApi.test.js
npm run test:unit -- --grep "useApi"

# E2E - single file or by name (from web/)
npm run test:e2e -- e2e/aircraft.spec.js
npm run test:e2e -- --grep "should display aircraft list"
```

### Linting and Formatting

```bash
# Python (from repo root)
ruff check .                # Lint
ruff check --fix .          # Auto-fix
black .                     # Format

# Frontend (from web/)
npm run lint                # ESLint
npm run lint:fix
npm run format              # Prettier
npm run type-check          # TypeScript checking (JSDoc types, not strict)
```

### Building

```bash
make build                  # Build Docker images
cd web && npm run build     # Build frontend only
```

## Architecture

```
Data Sources (1090/978MHz receivers, ACARS)
    ↓
Django ASGI (Daphne) + Socket.IO
    ├── REST API (/api/v1/)
    ├── Socket.IO real-time streaming (namespaces below)
    └── Celery background tasks (6 queues)
         ↓
PostgreSQL (via PgBouncer) + Redis
         ↓
React Frontend (Vite) / Go TUI Client
```

### Backend (skyspy_django/skyspy/)

- **Settings**: `skyspy.settings` (main), `skyspy.tests.test_settings` (tests), `skyspy.settings_rpi` (Raspberry Pi)
- **URL routing**: All API endpoints under `/api/v1/` using DRF `DefaultRouter`
- **api/** - DRF ViewSets (aircraft, alerts, acars, safety, aviation, audio, admin, cannonball, lookup)
- **models/** - Django models organized by domain (aircraft, alerts, acars, airspace, audio, auth, safety, stats, etc.)
- **services/** - Stateless business logic layer (~45 modules). Services coordinate between models and external APIs. Views delegate to services.
- **tasks/** - Celery background tasks. 50+ periodic beat tasks. 6 queues: `polling`, `default`, `database`, `transcription`, `notifications`, `low_priority`
- **socketio/** - Socket.IO server wrapping Django ASGI. Namespaces in `socketio/namespaces/`
- **management/commands/** - `populate_data.py`, `run_acars.py`, `run_task.py`, `sync_celery_tasks.py`

### Socket.IO Namespaces

- `/aircraft` - Position updates (10 Hz rate limit)
- `/safety` - Safety events
- `/alerts` - Custom alert triggers
- `/acars` - ACARS message decoding
- Messages batched in 50ms windows, max 50 per batch

### Real-time Data Flow

- **Hot path**: Socket.IO → Redis pub/sub → Browser (immediate, sub-second)
- **Cold path**: Celery tasks → Database writes (batched every 5s)
- Streaming from Ultrafeeder via SSE preferred over polling

### Frontend (web/src/)

- **State management**: React Query (@tanstack/react-query) for server state, Context API for auth, custom hooks for feature state. No Redux/Zustand.
- **Path aliases**: `@/*` maps to `src/*`
- **Build**: Vite with manual chunking (vendor, Radix UI, TanStack, Leaflet, Framer Motion). Production base path `/static/`.
- **Dev proxy**: Vite proxies `/api`, `/socket.io`, `/ws`, `/health` to backend at :8000
- **Testing**: Vitest with jsdom, react-leaflet mocked. Coverage threshold 80%.

### Authentication

- `AUTH_MODE` env var: `public` | `private` | `hybrid` (per-feature access)
- JWT (access/refresh), API Keys, OIDC/SSO (Keycloak, Authentik, Azure AD, Okta, Auth0, Authelia)
- Custom permission: `IsAuthenticatedOrPublic`

### Docker Profiles

- `dev` profile: Full dev environment with mock feeders, PgBouncer, dashboard
- `test` profile: Pytest runner with test database
- Production compose: `docker-compose.yml` (no profile needed)

## Key Configuration

Environment variables in `.env.test` (dev) or `.env` (prod):

```bash
# Required
DATABASE_URL, REDIS_URL, DJANGO_SECRET_KEY
ULTRAFEEDER_HOST/PORT          # ADS-B receiver
FEEDER_LAT/LON                 # Antenna location for distance calc

# Feature toggles
AUTH_MODE=public|private|hybrid
AIRCRAFT_STREAM_MODE=sse|tcp|adsbx
SAFETY_MONITORING_ENABLED, ACARS_ENABLED
```

### Redis Layout

- DB 0: Celery broker
- DB 1: Django cache (keys prefixed `skyspy:`)

## Code Style

- Python: Ruff + Black, 120 char lines, Python 3.12+. Config in `pyproject.toml`.
- Frontend: ESLint + Prettier, React 18, Tailwind CSS 4.1, JSX (not TSX — TypeScript via JSDoc, strict mode off)
- Python tests: pytest with factory_boy fixtures. Test conftest at `skyspy_django/skyspy/tests/conftest.py`. Skip list in `tests/skip_failing.txt`.
- Frontend tests: Vitest (unit) + Playwright (E2E). Vitest uses forks pool (1-3 workers).
