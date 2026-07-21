# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SkySpy is a real-time ADS-B aircraft tracking platform that captures position data from 1090MHz Mode S and 978MHz UAT receivers, displays aircraft on an interactive map, and provides safety monitoring, custom alerts, and push notifications.

## Repository Structure

Monorepo with four components:

- **skyspy_django/** - Django backend API with Socket.IO real-time streaming
- **web/** - React frontend dashboard (Vite, JSX, Tailwind CSS 4.1)
- **skyspy-go/** - Go CLI TUI radar client (Bubble Tea + Cobra, Go 1.23+). Has its own `Makefile` with full build/test/lint targets. Provides the `skyspy` binary with `radio`, `radio-pro` (airband), and radar TUI commands under `skyspy-go/cmd/skyspy/`.
- **skyspy_common/** - Shared Python package: libacars CFFI bindings for ACARS message decoding

(The former `skyspy-cli/` Python CLI package was removed; its `skyspy-radio`/`skyspy-radio-pro`/`skyspy-radar` commands were replaced by the Go client.)

Additional resources: `docs/` (guides 00-19), `web/src/STRUCTURE.md` (frontend architecture)

## Development Commands

### Start Development Environment (Docker)

```bash
make dev              # All open: AUTH_MODE=public, DEV_MODE=True — auth gates bypassed (fast local dev)
make dev-public       # PUBLIC map/dashboard, sign-in for AI (AUTH_MODE=public, DEV_MODE=False) + seed users — mirrors public deploy
make dev-public-down  # Stop the public-auth stack
make dev-auth         # Everything requires login (AUTH_MODE=hybrid, DEV_MODE=False) + seed admin/admin + user/user
make dev-auth-down    # Stop the auth-enforced stack
make dev-auth-seed    # Re-seed the local admin + test user (manage.py seed_dev_users)
make dev-down         # Stop services
make dev-logs         # View logs
make clean            # Stop containers, remove volumes, clear caches
make lint             # Run all linters (Python + Go + Frontend)
```

`make dev-auth` uses the `docker-compose.dev-auth.yaml` overlay to run the dev stack
with authentication enforced (so you can test login / roles / the AI + sensitive
gates). It seeds two users via `manage.py seed_dev_users`: `admin`/`admin` (superuser,
passes every gate) and `user`/`user` (viewer role — AI/LLM shows the sign-in gate).
Override with `DEV_ADMIN_PASSWORD` / `DEV_USER_PASSWORD` / `DEV_USER_ROLE`.

Services: Dashboard :3000, Django API :8000, Django Admin :8000/admin/ (admin/admin), Mock Ultrafeeder :18080, Mock Dump978 :18081, PgBouncer :5432, Redis :6379, Celery worker + beat also start.

The mock ultrafeeder serves synthetic traffic by default. Set `MOCK_DATA_SOURCE=live` in `.env.test` to feed **real aircraft** from an open ADS-B API (`MOCK_LIVE_SOURCE`: `adsb_lol` (default) / `adsb_fi` / `airplanes_live` / `adsbexchange`), centered on `FEEDER_LAT/LON` — all endpoints and streams (aircraft.json, SSE, TCP JSON) serve the live data. Poll cadence `MOCK_LIVE_POLL_INTERVAL` (min 2s for the keyless community APIs which ask ≤1 req/s; min 1s for `adsbexchange`), radius `MOCK_LIVE_RADIUS_NM` (max 250). `adsbexchange` (RapidAPI, `adsbexchange-com1.p.rapidapi.com`) refreshes faster/denser but requires `MOCK_LIVE_API_KEY` (keep in gitignored `.env.test`). UAT/978 stays simulated. Check `curl :18080/health` for live-poll status.

API docs (dev): Swagger UI at `/api/docs/`, ReDoc at `/api/redoc/`, OpenAPI schema at `/api/schema/`

### Running Tests

```bash
# All tests in Docker (recommended)
make test

# Python package tests
make test-common      # skyspy_common tests
make test-python      # All Python package tests (currently just skyspy_common)

# Frontend tests (from web/)
npm run test:unit           # Unit tests
npm run test:unit:watch     # Watch mode
npm run test:unit:coverage  # With v8 coverage
npm run test:e2e            # Playwright E2E tests (Chromium)
npm run test:e2e:all-browsers

# Go CLI tests (from skyspy-go/)
make test             # All tests
make test-unit        # Unit tests only
make test-race        # With race detector
make test-coverage    # With HTML coverage report
make ci               # Full CI: fmt-check + vet + lint + test-race + test-coverage
```

**Note**: Django pytest uses `--reuse-db` by default (see `skyspy_django/pytest.ini`), so the test database persists between runs for faster iteration.

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
# Python (from repo root — CI uses `uv tool run ruff`)
ruff check .                # Lint
ruff check --fix .          # Auto-fix
ruff format .               # Format (CI checks with `ruff format --check .`)
black .                     # Alternative formatter

# Frontend (from web/)
npm run lint                # ESLint
npm run lint:fix
npm run format              # Prettier
npm run format:check        # Check without modifying
npm run type-check          # TypeScript checking (JSDoc types, not strict)

# Go (from skyspy-go/)
make lint                   # golangci-lint
make fmt-check              # Check formatting
make vet                    # go vet
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
- **Routing / deep-links**: hash routing (`#<tab>?<params>`) via `lib/hashRoute.js`. Screen view state (search/filter/sort/sub-tab/selection/range) is deep-linked with the `useHashParamState` hook — URL is the source of truth, params omitted at default, replaceState for in-screen changes. Full param reference: `docs/21-deep-linking.md`. The assistant prompt (`services/assistant/agent.py`) lists these so the LLM can link filtered views.
- **Testing**: Vitest with jsdom, react-leaflet mocked. Coverage target 80% (currently relaxed to 40% in CI — TODO to restore). Go CLI target is 70%.
- **Storybook**: Available via `npm run storybook` on port 6006.

### Authentication

- `AUTH_MODE` env var: `public` | `private` | `hybrid` (per-feature access)
- JWT (access/refresh), API Keys, OIDC/SSO (Google, Auth0, Okta, Azure AD, Keycloak, Authentik, Authelia). OIDC endpoints are auto-discovered from `OIDC_PROVIDER_URL/.well-known/openid-configuration` (`auth/oidc.py`); ID tokens verified via JWKS, userinfo fallback. Custom backend in `auth/backends.py`.
- Permissions: `IsAuthenticatedOrPublic`, `FeatureBasedPermission`, `RequireAuthenticated` (ignores public bypass — used for sensitive/system endpoints), `CanUseAssistant` (auth + `assistant.view`, gates AI/chat even in public mode). See `auth/permissions.py`.
- Public-deploy hardening + what stays auth-gated in public mode: `docs/20-public-deploy-checklist.md`.

### Docker Profiles

- `dev` profile: Full dev environment with mock feeders, PgBouncer, Celery worker/beat, dashboard
- `test` profile: Pytest runner with test database
- Production compose: `docker-compose.yml` (no profile needed). Use `--profile acars` to include the ACARS UDP listener.

## Key Configuration

Environment variables in `.env.test` (dev) or `.env` (prod):

```bash
# Required
DATABASE_URL, REDIS_URL, DJANGO_SECRET_KEY
ULTRAFEEDER_HOST/PORT          # ADS-B receiver
FEEDER_LAT/LON                 # Antenna location for distance calc

# Aviation reference-data fetch radius (nm) around FEEDER_LAT/LON. Airspace
# boundaries (OpenAIP) + airports/navaids (AWC) are fetched within this radius
# so the map layers populate near the antenna (was a fixed CONUS grid that
# rate-limited OpenAIP to empty). AIRSPACE_EXTRA_REGIONS = JSON list of
# [lat, lon, radius_nm] for multi-site coverage.
AIRSPACE_FETCH_RADIUS_NM=250
GEODATA_FETCH_RADIUS_NM=250
AIRSPACE_EXTRA_REGIONS=[]

# FAA enroute structure = US airways + named waypoints/fixes. geodata.py::
# refresh_faa_enroute() fetches the FAA Aeronautical Information Services ArcGIS
# FeatureServers (ATS_Route lines, DesignatedPoints points; keyless, authoritative,
# 28-day cycle) as GeoJSON within GEODATA_FETCH_RADIUS_NM of the feeder (+
# AIRSPACE_EXTRA_REGIONS), paginating with resultOffset (ArcGIS caps 1000-2000/req).
# Rows land in CachedGeoJSON as data_type us_airways / us_fixes and are served by
# the generic GET /aviation/geojson/<type>/ endpoint + drawn as the Airways/Fixes
# map layers. Refreshed by the daily refresh_all_geodata beat task (also a
# standalone tasks/geodata.py::refresh_faa_enroute). US-only: a non-US feeder
# fetches nothing (existing cache left intact). Separately, per-flight route lookup
# (external_db.fetch_route via adsb.im -> adsbdb -> hexdb) now returns an ordered
# `waypoints` list (origin -> [midpoints] -> destination) so the UI can draw the
# leg polyline for a selected aircraft.
FAA_ENROUTE_ENABLED=True
FAA_AIRWAYS_URL=https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0/query
FAA_FIXES_URL=https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DesignatedPoints/FeatureServer/0/query
FAA_ENROUTE_MAX_FEATURES=8000

# Per-aircraft turbulence risk. services/turbulence.py::assess_turbulence(lat,lon,alt)
# synthesizes a 0-100 score + level (none/light/moderate/severe) from NWS G-AIRMET
# turbulence forecast polygons (AirspaceAdvisory, hand-rolled ray-cast point-in-polygon
# — no shapely), nearby turbulence PIREPs (CachedPirep, distance/recency/altitude
# weighted), and winds-aloft vertical shear (best-effort; AWC usually serves raw FB
# text so shear contributes 0 rather than penalizing). tasks/turbulence.py::
# score_aircraft_turbulence scores the current_aircraft cache OFF the hot path every
# TURB_SCORE_INTERVAL s (low_priority queue) and caches turb:by_hex for TURB_SCORE_TTL.
# Surfaced via GET /api/v1/aviation/turbulence{,/advisories,/aircraft}, a map TURB
# badge + turbulence/winds-aloft overlays, the #weather screen, and turbulence_score /
# turbulence_level AlertRule rule_types (level compared by rank, overlaid in
# alerts.check_alerts via _overlay_turbulence). TURB_LEVEL_* set the band thresholds.
TURB_ENABLED=True
TURB_SCORE_INTERVAL=60
TURB_SCORE_TTL=180
# Per-point grid-cache TTL (s). Nearby aircraft share one assessment; also caps
# how long an expired G-AIRMET keeps scoring, so keep it short.
TURB_GRID_TTL=120
TURB_PIREP_RADIUS_NM=150
TURB_PIREP_HOURS=3
TURB_LEVEL_LIGHT=20
TURB_LEVEL_MODERATE=45
TURB_LEVEL_SEVERE=70

# Feature toggles
AUTH_MODE=public|private|hybrid
AIRCRAFT_STREAM_MODE=sse|tcp|adsbx|adsblol|auto   # adsblol = keyless community feed, round-robins AIRCRAFT_STREAM_FREE_SOURCES (adsb.lol,adsb.fi,airplanes.live) — radius max 250nm around FEEDER_LAT/LON
SAFETY_MONITORING_ENABLED, ACARS_ENABLED

# Airframes.io live ACARS (open, no-hardware source). When AIRFRAMES_ACARS_ENABLED,
# run_acars polls api.airframes.io's firehose and keeps only the ground stations
# whose nearest airport is in AIRFRAMES_ACARS_AIRPORTS (default = LAX metro) OR
# within AIRFRAMES_ACARS_RADIUS_NM of the center (default LAX), then feeds them
# through the same normalize/dedupe/store/broadcast path as the UDP listener — so
# the History → ACARS tab shows real LAX-area traffic. Free/keyless today; set the
# API key for a feeder rate limit. The newest-100 firehose window is ~5s, so keep
# POLL_INTERVAL low (default 4s); the 30s dedupe cache absorbs the overlap.
AIRFRAMES_ACARS_ENABLED=False
AIRFRAMES_ACARS_URL=https://api.airframes.io/v1/messages
AIRFRAMES_ACARS_API_KEY=
AIRFRAMES_ACARS_POLL_INTERVAL=4
AIRFRAMES_ACARS_AIRPORTS=KLAX,KVNY,KBUR,...      # comma ICAOs; empty = radius only
AIRFRAMES_ACARS_CENTER_LAT=33.9416
AIRFRAMES_ACARS_CENTER_LON=-118.4085
AIRFRAMES_ACARS_RADIUS_NM=100

# OpenSanctions owner screening (feeds ownership/shell-risk analysis). Screens
# owner names against sanctions/PEP/watchlists. Needs an API key (free for
# non-commercial); off by default = no-op without a key. Ownership analysis also
# now uses the FAA MASTER TYPE-REGISTRANT code (authoritative entity type),
# STREET address (registered-agent/PO-box heuristics) and FRACT-OWNER flag.
OPENSANCTIONS_ENABLED=False
OPENSANCTIONS_API_URL=https://api.opensanctions.org
OPENSANCTIONS_API_KEY=
OPENSANCTIONS_DATASET=default

# Watch Duty wildfire overlay (services/wildfires.py, via the libwatchduty PyPI
# client). When WILDFIRES_ENABLED, a 5-min Celery beat task polls the public
# api.watchduty.org geo_events feed, keeps active wildfires within
# WILDFIRES_RADIUS_NM of FEEDER_LAT/LON (haversine — no server-side bbox),
# threat-scores each with libwatchduty.compute_threat, and caches them in
# CachedWildfire. Rendered on the Live Map as a toggleable "Wildfires" layer of
# threat-colored markers (Socket.IO `wildfires` request + REST
# /api/v1/aviation/wildfires/); clicking a marker opens a detail panel fed by the
# per-fire /wildfires/<id>/bundle endpoint (reports feed, PTZ camera stills,
# Broadcastify scanner feeds — get_fire_bundle, fetched on demand, cached ~120s).
# Also exposed to the assistant as the get_nearby_wildfires tool. Watch Duty is
# US/CA-centric, so a non-US feeder caches nothing. Read endpoints are public;
# WATCHDUTY_API_TOKEN is optional (raises the feeder rate limit only). Off by default.
WILDFIRES_ENABLED=False
WILDFIRES_REFRESH_INTERVAL=300
WILDFIRES_RADIUS_NM=250        # defaults to GEODATA_FETCH_RADIUS_NM
# Max fire→camera distance (nm) for the per-fire detail bundle. Watch Duty's
# /cameras/ is the whole network (not fire-scoped), so _best_cameras drops any
# camera farther than this from the fire (else a lookout hundreds of km away
# shows unrelated terrain — reads as "wrong location"). Each returned camera
# carries distance_km for the panel caption.
WILDFIRES_CAMERA_RADIUS_NM=50
WATCHDUTY_BASE_URL=https://api.watchduty.org/api/v1
# Auth (optional). Read endpoints (fires/reports/cameras) are public; the global
# aircraft catalog (services.wildfires.list_aircraft) needs a token. Provide a
# WATCHDUTY_API_TOKEN directly, or WATCHDUTY_USERNAME + WATCHDUTY_PASSWORD to log
# in — the service authenticates once and caches the DRF token (6h).
WATCHDUTY_API_TOKEN=
WATCHDUTY_USERNAME=
WATCHDUTY_PASSWORD=

# REST throttling (public dashboards are anonymous - keep anon above one
# dashboard's polling volume). The scoped rates below throttle expensive /
# external-fan-out endpoints per user-or-IP (see api/throttles.py); a scope with
# no rate configured (as in test_settings) disables that throttle.
API_THROTTLE_ANON=600/minute
API_THROTTLE_USER=2000/minute
API_THROTTLE_AUTH=5/minute              # login/auth endpoints
API_THROTTLE_UPLOAD=10/minute           # audio upload
API_THROTTLE_EXTERNAL_LOOKUP=10/minute  # external DB / route lookups (OpenSky/ADSBX/FAA)
API_THROTTLE_WEATHER=30/minute          # METAR/TAF/PIREP/SIGMET/NEXRAD
API_THROTTLE_GEODATA=60/minute          # geojson / terrain
API_THROTTLE_ALERT_WRITE=60/minute      # alert-rule writes (create/update/toggle/bulk/import) — own bucket, NOT the login `auth` scope, so alert CRUD never shares the brute-force login budget (reads fall through to user/anon)

# Public-deploy hardening (production, DEBUG=False). See docs/20-public-deploy-checklist.md.
# CSRF_TRUSTED_ORIGINS defaults to CORS_ALLOWED_ORIGINS. HTTPS/HSTS auto-enable when
# DEBUG=False (behind a TLS-terminating proxy via SECURE_PROXY_SSL_HEADER); /health is
# exempt from SSL redirect. Override SECURE_SSL_REDIRECT / SECURE_HSTS_SECONDS as needed.
CSRF_TRUSTED_ORIGINS=
SECURE_SSL_REDIRECT=True
SECURE_HSTS_SECONDS=31536000

# AI/assistant + chat are auth-gated in production: they require an authenticated user with
# the assistant.view permission (roles analyst/admin/superadmin by default) EVEN in
# AUTH_MODE=public — anonymous visitors can't use the LLM. Enforced by CanUseAssistant.
# All other LLM-backed endpoints (aviation explain/pirep-summary, acars ai-summary/ai-analysis,
# airframe flight-history + type-cards/generate) are gated by CanUseLLM (same auth, no
# ASSISTANT_ENABLED requirement) + rate-limited. Socket.IO auth: middleware/auth.py on connect.
# Other endpoints hardened for public deploy: /system/info + /metrics require auth;
# /system/status strips feeder location/PID/tasks for anon; /lookup/aircraft + /lookup/opensky
# require auth + throttle; audio upload/transcribe require auth. Alert/notification/chat
# querysets are owner-scoped. PhotoServeView (/api/v1/photos/<hex>) is ALWAYS public
# (AllowAny) — cached images, and <img> can't send a JWT, so gating would break photos.
# DEV BYPASS: all of the above enforcement + owner-scoping is RELAXED when DEBUG=True
# (local dev works without login); it enforces only when DEBUG=False (required for public
# deploy). Gated via _dev_bypass() in auth/permissions.py + `if settings.DEBUG` in the
# owner-scoped get_queryset()s; the frontend mirrors this via auth/config `dev_mode`.

# Webhook SSRF allowlist. Alert/notification webhook URLs are blocked when they
# target a private/internal IP (SSRF prevention in services/notifications.py).
# This comma-separated list of IPs/CIDRs is exempt, so webhooks can reach a
# trusted internal receiver (e.g. self-hosted n8n at 10.42.252.10). Empty
# (default) = block all private targets. Checked in _is_blocked_ip().
NOTIFICATION_WEBHOOK_ALLOWED_PRIVATE_CIDRS=

# Statistics screen KPI tick (stats:tick broadcast) interval in seconds
# (RPi celery profile overrides to 30)
STATS_TICK_INTERVAL=10

# Map server-side conditional clustering. The Live Map sends its viewport bbox +
# zoom via the Socket.IO `aircraft-clusters` request (mixins/aircraft.py::
# _get_aircraft_clusters). At/above MAP_CLUSTER_ZOOM_THRESHOLD the server returns
# raw points within the bbox; below it, PostGIS ST_ClusterDBSCAN groups (centroid
# + count + bbox) over the live_aircraft_positions table. That table
# (LiveAircraftPosition, geometry(Point,4326) — PLANAR, since ST_ClusterDBSCAN
# needs geometry and eps is in the SRID's degrees) is upserted off the cold path
# in tasks/aircraft_stream.flush_stream_to_database and pruned to rows updated
# within LIVE_POSITION_TTL. MAP_CLUSTER_EPS_BASE is the DBSCAN eps in degrees,
# scaled down as zoom rises; MAP_CLUSTER_MAX_POINTS caps the raw-points branch.
# The frontend (web/src/components/livemap) mirrors the threshold to flip between
# cluster-bubble and dart rendering on the canvas. See docs/23-postgis-clustering-design.md.
MAP_CLUSTER_ZOOM_THRESHOLD=8
MAP_CLUSTER_EPS_BASE=0.4
MAP_CLUSTER_MAX_POINTS=2000
LIVE_POSITION_TTL=90

# Airframe RAG embeddings (each falls back to the matching LLM_* value).
# Requires the Postgres image to carry pgvector — the AirframeDocument embedding
# column + similarity search depend on the pgvector extension. The compose files
# build the combined PostGIS + pgvector image (docker/postgres/Dockerfile, tag
# skyspy-postgres:pg16-postgis; CI/release pull it from
# ghcr.io/cha0s-corp/skyspy-postgres:pg16-postgis) so BOTH pgvector (RAG) and
# postgis (spatial geom queries) load on one DB. EMBEDDING_DIM must match the model.
EMBEDDING_API_URL=       # defaults to LLM_API_URL
EMBEDDING_API_KEY=       # defaults to LLM_API_KEY
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536

# LLM assistant (LangChain tool-calling agent over analytics/search services,
# served by an OpenAI-compatible endpoint — vLLM in prod behind the compose
# `gpu` profile, OpenAI/Ollama in dev). Requires LLM_ENABLED + a tool-calling
# model. Endpoint at POST /api/v1/assistant/ask/ and SSE /api/v1/assistant/stream/.
ASSISTANT_ENABLED=False
ASSISTANT_MODEL=         # defaults to LLM_MODEL
# Tool-call budget per query (recursion limit = MAX_STEPS*2+2). Higher = deeper
# tool chains into one synthesized answer. Safe to raise on large-context models
# (128k) — the binding constraint is ASSISTANT_TIMEOUT, not context, since each
# step is a sequential model+tool round-trip. Raise the timeout alongside it.
ASSISTANT_MAX_STEPS=15
# Budget cap applied in COMPACT MODE (small context window, see
# ASSISTANT_CONTEXT_WINDOW): deep tool chains would overflow an 8k window, so the
# effective budget is min(MAX_STEPS, MAX_STEPS_COMPACT) there.
ASSISTANT_MAX_STEPS_COMPACT=8
ASSISTANT_TIMEOUT=120
# Auto-inject a compact live-traffic snapshot into each query so answers are
# grounded in the current picture without spending a tool call. Disable on
# tiny/RPi models if the extra context hurts.
ASSISTANT_BRIEFING_ENABLED=True
# Context-window budget knobs (raise for large-context models, keep low on RPi).
ASSISTANT_MAX_RESULT_CHARS=6000   # per-tool result cap
ASSISTANT_MAX_HISTORY_MSGS=16     # prior turns carried
ASSISTANT_MAX_HISTORY_CHARS=3000  # per-message cap
# Model's max context window (tokens). Set for small local models (e.g. 8192 vLLM/
# Ollama). When <=16000 the assistant auto-switches to COMPACT MODE: a short system
# prompt (COMPACT_SYSTEM_PROMPT), first-sentence-only tool descriptions, and tighter
# result/history/briefing/page-context caps — the fixed SYSTEM_PROMPT (~3k tokens) +
# the tool schemas would otherwise overflow an 8k window on the first model call
# ("prompt contains at least 8193 input tokens"). 0 (default) = assume large, no
# compaction.
ASSISTANT_CONTEXT_WINDOW=0
# When ASSISTANT_CONTEXT_WINDOW=0, probe the OpenAI-compatible endpoint (GET
# /models) for the model's real window — vLLM reports max_model_len — so compact
# mode engages automatically for small local models (agent.py::
# _detect_context_window, cached ~10 min). Explicit ASSISTANT_CONTEXT_WINDOW wins;
# endpoints that don't report a window (OpenAI/Ollama) fall back to assume-large.
ASSISTANT_CONTEXT_WINDOW_AUTO=True
# Give the chat model a live web_search tool (services/web_search.py — news,
# operator background, unfamiliar terms; results carry source URLs). ANDed with
# WEB_SEARCH_ENABLED — deliberately separate, so enabling card-gen grounding does
# NOT silently give the assistant internet access. Off by default.
ASSISTANT_WEB_SEARCH_ENABLED=False
# Assistant toolset (services/assistant/tools.py, ~53 read-only tools) is grouped
# by category in TOOL_GROUPS; get_tools() prefixes each description with its
# [category] tag as a selection hint for small models and converts bad tool args
# into corrective observations (handle_validation_error) so the agent self-corrects
# instead of crashing the loop. Aviation-reference tools added for context the
# platform had but the LLM couldn't reach: decode_squawk (+ services/
# squawk_codes.py static table), airspace_near (OpenAIP class/SUA + point-in-
# polygon), nearby_navaids (CachedNavaid), identify_military + military_reference
# (military_db patterns), decode_aviation_text (raw METAR/NOTAM/PIREP/ACARS →
# deterministic decode + aviation_llm explanation), elevation_at (terrain/AGL),
# web_search (gated above). ask()/astream() now report per-request token usage
# ("usage" key / final SSE event) when the endpoint returns usage_metadata.
#
# ASSISTANT EVALS (real LLM, never CI): golden question suite in
# skyspy_django/skyspy/tests/evals/ (16 cases: tool selection, groundedness vs
# the seeded_world fixture, hallucination canaries, chart/photo format). Run
# `make eval-assistant ASSISTANT_EVAL_URL=http://<spark>:8000/v1` (optional
# ASSISTANT_EVAL_MODEL/_API_KEY/_TIMEOUT); pytest -m eval, auto-skips when the
# env var is unset. Per-run JSON reports land in test-results/assistant-evals/
# for drift diffs. Mocked agent-loop E2E tests (scripted fake LLM, run in CI):
# tests/assistant_fakes.py + test_services_assistant_agent_loop.py +
# test_services_assistant_tools_seeded.py (seeded_world fixture in conftest).
# Airframe photos in assistant answers are rendered from the fetch_airframe_photo
# tool call with a server-templated <img> src (NOT LLM markdown — the model was
# hallucinating photo URLs). Empty (default) auto-infers: a signed S3 URL when
# S3_ENABLED, else same-origin /api/v1/photos/<hex>. Set a public asset base to
# force <base>/<HEX>.jpg (e.g. https://sky-spy-assets.s3.amazonaws.com/photos).
ASSISTANT_PHOTO_BASE_URL=

# Auto-generated airframe type cards. The v2 Airframes screen ships a hand-curated
# static reference library (web/.../airframesData.js). The daily
# generate_airframe_type_cards Celery task (low_priority queue, 07:30 UTC) finds
# ICAO type designators this station has actually tracked but that are missing
# from that library. For each it runs a LIVE WEB SEARCH (services/web_search.py)
# to ground the facts, has the LLM write a factual card from those sources, and
# FETCHES a public type photo (Wikipedia/Wikimedia lead image) — downloaded into
# the photo cache under key TYPE-<code> and served same-origin at
# /api/v1/photos/TYPE-<code>. Results go in the AirframeTypeCard model. The model
# NEVER draws: it picks a diagram *archetype* from services/airframe_archetypes.py
# (a fixed <Planform> shape vocabulary — kind/engines/mount/tail/sweep/wing/blades)
# and the front-end renders the same to-scale blueprint as a static card. Cards
# surface via GET /api/v1/airframes/type-cards/ and the screen merges them BEHIND
# the static library (a static entry always wins a type collision); generated
# cards show an "AUTO" chip, confidence caveat + source/credit. Requires
# LLM_ENABLED (and WEB_SEARCH_ENABLED for grounding/photos). BATCH bounds LLM
# calls per run; MIN_TAILS skips one-off mis-decodes (only types with >= N tails).
# CURATED_TYPE_CODES in services/airframe_card_gen.py mirrors the static library
# ids to avoid regenerating a card the merge would hide — keep roughly in sync.
AIRFRAME_CARD_GEN_ENABLED=False
AIRFRAME_CARD_GEN_BATCH=8
AIRFRAME_CARD_GEN_MIN_TAILS=1

# Runtime web search (services/web_search.py) — reusable, grounds LLM output in
# live web sources + supplies public type photos. Provider: wikipedia (keyless
# default) | tavily | brave (WEB_SEARCH_API_KEY) | searxng (WEB_SEARCH_URL) |
# duckduckgo (keyless scrape). All calls go through http_client (circuit breaker
# + retry). Wikipedia always supplies the airframe type photo. UA must carry
# contact info or Wikimedia 403s.
#
# A SearXNG meta-search container is bundled for general web search: it runs by
# default in the dev stack (make dev; reachable at http://searxng:8080, debug UI
# on :18090) and in prod under `--profile search`. Config: ./searxng/settings.yml
# (enables the JSON API web_search.py consumes; disables the bot limiter for
# internal calls). .env.test points the dev stack at it (WEB_SEARCH_PROVIDER=
# searxng); prod defaults to keyless wikipedia so it works without the profile.
WEB_SEARCH_ENABLED=True
WEB_SEARCH_PROVIDER=wikipedia
WEB_SEARCH_API_KEY=
WEB_SEARCH_URL=http://searxng:8080
WEB_SEARCH_MAX_RESULTS=5
WEB_SEARCH_USER_AGENT=skyspy/3 (+https://github.com/skyspy/skyspy)

# Aircraft photo enrichment. The photo chain is planespotters (hex then reg) →
# airport-data.com (hex/reg) → hexdb.io → flickr (GA tail fallback). Planespotters'
# free photo API 403s any request whose User-Agent lacks a contact URL or email —
# so ALL planespotters photo calls send this UA. Set your own contact so they can
# reach the operator. Registration fallback matters: many US GA airframes and
# helicopters (e.g. N882SD) are indexed by tail only, not by Mode-S hex.
PHOTO_PLANESPOTTERS_USER_AGENT=skyspy/2.6 (+https://github.com/skyspy/skyspy)
```

### Redis Layout

- DB 0: Celery broker
- DB 1: Django cache (keys prefixed `skyspy:`)

## Code Style

- Python: Ruff + Black, 120 char lines, Python 3.12+. Config in `pyproject.toml`.
- Frontend: ESLint + Prettier, React 18, Tailwind CSS 4.1, JSX (not TSX — TypeScript via JSDoc, strict mode off)
- Python: `uv` for dependency management in CI and local venvs.
- Python tests: pytest with factory_boy fixtures. Test conftest at `skyspy_django/skyspy/tests/conftest.py`. Skip list in `tests/skip_failing.txt`. Django tests have multiple layers: `tests/` (unit/API), `tests/e2e/` (Django-level E2E), `tests/integration/`, `tests/performance/`. CI ignores e2e, integration, and performance directories.
- Frontend tests: Vitest (unit) + Playwright (E2E). Vitest uses forks pool (1-3 workers).

## Known Issues and Tech Debt

### API Tests (Re-enabled)
The 4 API test files (`test_api_aircraft.py`, `test_api_alerts.py`, `test_api_history.py`, `test_api_safety.py`) were previously excluded from CI due to PgBouncer deadlocks. They have been converted from `APITestCase` to pytest-style and are now included in CI. Coverage target set to 55% (`--cov-fail-under=55`). Target: restore to 80%.

### Broad Exception Handlers
A codebase-wide pass narrowed ~185 `except Exception` handlers to specific
types (matching the established idiom: `DatabaseError`, `httpx.HTTPError`,
`(ConnectionError, OSError)`, `(ValueError, KeyError, TypeError)`, etc.). The
remaining ~215 are **intentionally broad resilience boundaries** and are
annotated in-source with a trailing `# broad: <reason>` comment. Do not narrow
those — they include:
- Celery task top-level guards and periodic-beat loops that must never crash the worker
- Sentry / error-reporting blocks (the reporting itself must never raise)
- ASGI-startup guards (a narrow catch could crash the app at boot)
- Third-party fan-out calls (e.g. Apprise `notify()`) with unknowable failure modes

When adding a new handler: narrow it if it guards a specific operation (DB/HTTP/
parse); leave it broad **with a `# broad:` comment** only if it is a genuine
resilience boundary of the kinds above.

### Frontend Tech Debt
- `MapView.jsx` — ~3,070 lines (decomposed from ~12,240), still no direct test coverage (keyboard shortcuts extracted to `useProKeyboardShortcuts` hook; see `web/src/components/map/CLAUDE.md`)
- `react-hooks/exhaustive-deps` ESLint rule is `'off'` ("too many false positives with complex hooks")
- ESLint `no-console` now set to `['warn', { allow: ['warn', 'error'] }]`, max-warnings lowered from 250 to 150

## Danger Zones

**Do not modify these without running their full test suites:**

### `services/safety.py` (1,253 lines)
Safety-critical emergency detection: squawks 7500/7600/7700, TCAS RA, vertical rate monitoring. Errors here mean missed emergency alerts. Run both `test_services_safety.py` AND `test_api_safety.py`.

### `socketio/namespaces/main.py` (577 lines) + `mixins/` (7 files)
MainNamespace composes 7 handler mixins via multiple inheritance. `main.py` is the thin router (connection, subscription, request dispatch). Handler logic lives in `mixins/aircraft.py`, `safety.py`, `alerts.py`, `aviation_data.py`, `stats.py`, `notifications.py`, `system.py`. When modifying a handler, edit the mixin — only touch main.py for connection/routing changes. Adding a new request type requires adding it to `_handle_generic_request()` in main.py.

### Cache-Dependent Code
Many services depend on Redis cache state. The `clear_cache` fixture in conftest.py is `autouse=True` — it clears cache before AND after every test. If you add a test that depends on cache state from setUp, be aware the autouse fixture runs first.

### FeatureAccess Migration Gotcha
The `django_db_setup` fixture (session-scoped) deletes all `FeatureAccess` records after migration because the migration creates records with `read_access='authenticated'` which overrides `AUTH_MODE='public'` in test settings. If you add a test that needs FeatureAccess records, create them in the test itself.

### PgBouncer + APITestCase
Never use `APITestCase` for new tests. PgBouncer transaction pooling + Django's test transaction wrapping = deadlocks. Always use pytest functions/classes with the `api_client` fixture from conftest.py.

## Service Dependency Map

```
CORE DATA FLOW:
  cache.py (in-memory TTL cache, RPi optimized)
    ← aircraft_info.py (unified aircraft lookup, photo integration)
      ← external_db.py (ADS-B Exchange, tar1090, FAA, OpenSky)
        ← military_db.py (hex ranges, callsigns)
        ← law_enforcement_db.py (LE detection, surveillance types)

ALERT PIPELINE:
  alerts.py (rule evaluation, cooldowns)
    → alert_rule_cache.py (compiled rule caching)
    → alert_cooldowns.py (Redis distributed cooldowns)
    → alert_metrics.py (evaluation timing, trigger rates)
    → notification_router.py (channel routing, quiet hours)
      → notification_dispatcher.py (templating, delivery)
        → notifications.py (Apprise multi-platform, SSRF prevention)
        → rich_formatters.py (Discord/Slack embeds)
        → template_engine.py (variable substitution)

SAFETY PIPELINE:
  safety.py (TCAS/emergency monitoring)
    → SafetyEvent model (DB)
    → Socket.IO emission (via broadcast.py)

EXTERNAL APIs (network-dependent, may timeout/fail):
  avwx.py (METAR/TAF)          checkwx.py (weather + flight categories)
  aviationstack.py (schedules)   opensky_live.py (live state vectors)
  adsbx_live.py (RapidAPI)      swim_fns.py (FAA SWIM NOTAM XML)
  openaip.py (airspace/navaids)  openflights.py (airport DB)
  weather_cache.py (caching layer for weather APIs)

STATELESS UTILITIES (safe to modify independently):
  template_engine.py    pirep_decoder.py    notam_decoder.py
  acars_decoder.py      rich_formatters.py  registration_analysis.py
  geodata.py            terrain_elevation.py
```

## Common Mistakes

1. **Forgetting cache invalidation** — When changing model fields that are cached (aircraft info, alert rules, stats), you must also invalidate the relevant cache keys. Check `cache.py` and `stats_cache.py` for key patterns.

2. **Using `APITestCase` for new tests** — Causes PgBouncer deadlocks. Use pytest functions with `api_client` fixture instead. See `conftest.py` for available fixtures.

3. **Adding env vars without documenting** — New environment variables must be added to: `test_settings.py`, `.env.test`, `.env.example`, and this CLAUDE.md file.

4. **Breaking safety without full test coverage** — Always run BOTH `test_services_safety.py` (unit) and `test_api_safety.py` (API) after any change to the safety pipeline.

5. **Adding `console.log` to frontend** — Currently 108 instances across the codebase. Don't add more. Use conditional debug logging or remove after debugging.

6. **Circular imports in services** — Socket.IO namespaces use lazy imports (`from skyspy.services.X import Y` inside methods) to avoid circular deps. Follow this pattern if adding new service dependencies in socketio/.

7. **Direct model queries in views** — Views should delegate to services. Don't add ORM queries directly in ViewSet methods.

## What Tests to Run After Changes

| Changed files/dirs | Test command |
|---|---|
| `services/safety.py` | `pytest skyspy/tests/test_services_safety.py skyspy/tests/test_api_safety.py -v` |
| `services/alerts.py`, `alert_*.py` | `pytest skyspy/tests/test_services_alerts.py skyspy/tests/test_api_alerts.py -v` |
| `services/acars*.py` | `pytest skyspy/tests/test_services_acars.py -v` |
| `services/audio.py` | `pytest skyspy/tests/test_services_audio.py skyspy/tests/test_tasks_transcription.py -v` |
| `services/aircraft_info.py`, `external_db.py` | `pytest skyspy/tests/test_services_aircraft_info.py -v` |
| `services/notifications.py`, `notification_*.py` | `pytest skyspy/tests/test_services_notifications.py -v` |
| `api/*.py` (any ViewSet) | `pytest skyspy/tests/test_api_*.py -v` |
| `models/*.py` | `pytest skyspy/tests/ -v` (run all — model changes can break anything) |
| `socketio/` | `pytest skyspy/tests/test_socketio_*.py -v` |
| `tasks/*.py` | `pytest skyspy/tests/test_tasks_*.py -v` |
| `web/src/hooks/` | `cd web && npm run test:unit -- src/hooks/` |
| `web/src/components/map/` | `cd web && npm run test:unit -- src/components/map/` |
| `web/src/components/views/` | `cd web && npm run test:unit -- src/components/views/` |
| Any Python file | `ruff check . && ruff format --check .` |
| Any frontend file | `cd web && npm run lint && npm run format:check` |
| Go files | `cd skyspy-go && make ci` |
