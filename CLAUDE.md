# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkySpy is a real-time ADS-B aircraft tracking platform that captures position data from 1090MHz Mode S and 978MHz UAT receivers, displays aircraft on an interactive map, and provides safety monitoring, custom alerts, and push notifications.

## Repository Structure

This is a monorepo with four main components:

- **skyspy_django/** - Django backend API with Socket.IO real-time streaming
- **web/** - React frontend dashboard
- **skyspy-go/** - Go CLI TUI radar client
- **skyspy_common/** - Shared Python utilities and libacars bindings

## Development Commands

### Start Development Environment (Docker)

```bash
make dev              # Start all services with mock data
make dev-down         # Stop services
make dev-logs         # View logs
```

Services available at:
- Dashboard: http://localhost:3000
- Django API: http://localhost:8000
- Mock Ultrafeeder: http://localhost:18080

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
npm run test:e2e            # Playwright E2E tests
```

### Linting and Formatting

```bash
# Python (from repo root)
ruff check .                # Lint
ruff check --fix .          # Auto-fix
black .                     # Format

# Frontend (from web/)
npm run lint
npm run lint:fix
npm run format
```

### Building

```bash
make build            # Build Docker images
cd web && npm run build   # Build frontend only
```

## Architecture

```
Data Sources (1090/978MHz receivers, ACARS)
    ↓
Django ASGI (Daphne) + Socket.IO
    ├── REST API (/api/v1/)
    ├── WebSocket real-time streaming
    └── Celery background tasks
         ↓
PostgreSQL + Redis
         ↓
React Frontend (Vite)
```

### Backend Structure (skyspy_django/skyspy/)

- `api/` - DRF routers (aircraft, alerts, acars, history, stats, etc.)
- `models/` - Django models organized by domain
- `services/` - Business logic layer (~45 modules)
- `tasks/` - Celery background tasks (polling, enrichment, notifications)
- `socketio/` - Socket.IO namespaces and handlers for real-time
- `celery.py` - Celery configuration with periodic beat tasks

### Frontend Structure (web/src/)

- `components/` - React components (aircraft/, map/, alerts/, common/)
- `hooks/` - Custom hooks (~44), including useSocketIO, useApi, useAlertRules
- `views/` - Page-level components

### Real-time Communication

Socket.IO namespaces for feature isolation:
- `/aircraft` - Position updates
- `/safety` - Safety events
- `/alerts` - Custom alert triggers
- `/acars` - Message decoding

## Key Configuration

Environment variables in `.env.test` (dev) or `.env` (prod):
- `ULTRAFEEDER_HOST/PORT` - ADS-B receiver connection
- `FEEDER_LAT/LON` - Location for distance calculations
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis for cache and pub/sub

## Code Style

- Python: Ruff linter, Black formatter, 120 char lines, Python 3.12+
- Frontend: ESLint, Prettier, React 18, Tailwind CSS 4.1
- Tests: pytest (backend), Vitest + Playwright (frontend)
