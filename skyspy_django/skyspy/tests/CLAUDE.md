# Test Architecture

## Test Configuration

- **Settings**: `skyspy.tests.test_settings` (set via `DJANGO_SETTINGS_MODULE`)
- **Config**: `skyspy_django/pytest.ini` (`--reuse-db` enabled for faster iteration)
- **Conftest**: `skyspy_django/skyspy/tests/conftest.py` — all shared fixtures
- **Skip list**: `skyspy_django/skyspy/tests/skip_failing.txt` (currently empty)

## Test Organization

```
tests/
├── conftest.py              # Shared fixtures (api_client, factories, mocks)
├── factories.py             # factory_boy factories (10 models covered)
├── test_settings.py         # Django test settings
├── skip_failing.txt         # Dynamic skip list (empty)
│
├── test_api_*.py            # API/ViewSet tests (DRF endpoints)
├── test_services_*.py       # Service layer unit tests
├── test_tasks_*.py          # Celery task tests
├── test_socketio_*.py       # Socket.IO namespace tests
├── test_models_*.py         # Model tests
│
├── e2e/                     # Django-level E2E tests (ignored in CI)
├── integration/             # Integration tests (ignored in CI unit job)
└── performance/             # Performance tests (ignored in CI)
```

## Key Fixtures (conftest.py)

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `django_db_setup` | session | Runs migrations, deletes FeatureAccess records |
| `clear_cache` | function, **autouse** | Clears Django cache before AND after every test |
| `api_client` | function | DRF `APIClient` instance — use this instead of `APITestCase` |
| `django_client` | function | Django `Client` instance |
| `aircraft_sighting` | function | Single `AircraftSighting` via factory |
| `aircraft_sightings` | function | 10 `AircraftSighting` instances |
| `alert_rule` / `complex_alert_rule` | function | `AlertRule` instances |
| `safety_event` / `tcas_event` / `proximity_event` | function | `SafetyEvent` variants |
| `acars_message` / `position_acars` | function | `AcarsMessage` instances |
| `mock_aircraft_data` | function | Raw aircraft dict as from ultrafeeder |
| `mock_emergency_aircraft` | function | Aircraft with squawk 7700 |
| `mock_proximity_aircraft` | function | Two aircraft in close proximity |
| `cached_aircraft` | function | Pre-populates Redis cache with aircraft data |
| `alert_service` / `safety_monitor` / `acars_service` | function | Fresh service instances |

## Excluded Test Files (CI)

These 4 files are excluded via `--ignore` in `.github/workflows/ci.yml`:

| File | Tests | Reason |
|------|------:|--------|
| `test_api_aircraft.py` | 45 | Uses `APITestCase` → PgBouncer deadlocks |
| `test_api_alerts.py` | 47 | Uses `APITestCase` → PgBouncer deadlocks |
| `test_api_history.py` | 56 | Uses `APITestCase` → PgBouncer deadlocks |
| `test_api_safety.py` | 51 | Uses `APITestCase` → PgBouncer deadlocks |

**All use `class ...Tests(APITestCase):` pattern.** To re-enable: convert to pytest functions using `api_client` fixture, replace `self.assertEqual` with `assert`, replace `setUp/tearDown` with fixtures.

## PgBouncer Deadlock History

Django's `APITestCase` wraps each test in a database transaction. CI uses PgBouncer with transaction pooling. When multiple tests run concurrently, PgBouncer assigns different backend connections to queries within the same Django transaction, causing deadlocks.

**Prevention**: Always use pytest-style tests with the `api_client` fixture. Never subclass `APITestCase` or `TransactionTestCase` for new tests.

## Skipped Tests

| Location | Reason | Action |
|----------|--------|--------|
| `test_tasks_transcription.py` (2 classes) | `_transcribe_with_whisper` and `_transcribe_with_service` helpers removed | Delete or rewrite |
| `test_services_alerts.py:690` | `_trigger_alert` expects `CompiledRule` not `AlertRule` | Fix test to use `CompiledRule` |
| `test_integration.py:675` | "Django Channels replaced with Socket.IO" | Delete test class |

## Available Factories (factories.py)

20 of 50+ models have factories:

**Core Data:**
- `AircraftSightingFactory` (with `on_ground`, `military`, `emergency`, `nearby` traits)
- `AircraftSessionFactory` (with `recent`, `extended` traits)
- `AircraftInfoFactory` (with `military`, `interesting` traits)

**Alert Pipeline:**
- `AlertRuleFactory` (with `disabled`, `complex`, `scheduled`, `with_webhook` traits)
- `AlertHistoryFactory`

**Safety:**
- `SafetyEventFactory` (with `tcas`, `proximity`, `emergency`, `acknowledged_event` traits)

**ACARS & Audio:**
- `AcarsMessageFactory` (with `position`, `oooi`, `weather` traits)
- `AudioTransmissionFactory` (with `queued`, `processing`, `completed`, `failed` traits)

**Notifications:**
- `NotificationConfigFactory` (singleton)
- `NotificationLogFactory`
- `NotificationChannelFactory` (with `private`, `verified_channel`, `disabled` traits)
- `NotificationTemplateFactory` (with `default`, `alert`, `critical` traits)
- `UserNotificationPreferenceFactory` (with `warnings_only`, `with_quiet_hours` traits)

**Gamification & Stats:**
- `DailyStatsFactory`
- `PersonalRecordFactory`
- `RareSightingFactory`
- `SightingStreakFactory`

**Auth:**
- `APIKeyFactory` (with `expired`, `inactive` traits)
- `FeatureAccessFactory`
- `WatchedAircraftFactory`

## Running Tests

```bash
# All tests (Docker, recommended)
make test

# Single file
pytest skyspy/tests/test_services_safety.py -v

# Single test function
pytest skyspy/tests/test_services_safety.py::test_emergency_detection -v

# Single class method
pytest skyspy/tests/test_services_alerts.py::AlertServiceOperatorTests::test_equals -v

# With coverage
pytest skyspy/tests/ --cov=skyspy --cov-report=html -v
```
