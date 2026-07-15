# Socket.IO Real-time Layer

~5,600 lines total. Wraps Django ASGI with python-socketio for real-time streaming.

## Architecture

```
server.py (85 lines)
  └── sio = socketio.AsyncServer(async_mode='asgi')

namespaces/
  ├── main.py (577 lines) — MainNamespace on "/"
  │     Thin router: connection, subscription, request dispatch
  │     Composes 7 handler mixins via multiple inheritance
  │
  ├── mixins/              — Handler groups extracted from MainNamespace
  │   ├── __init__.py      — Shared parse_int_param utility
  │   ├── aircraft.py      (346 lines) — Aircraft lookup, stats, sightings, photos
  │   ├── safety.py        (166 lines) — Safety events, acknowledgment, monitoring
  │   ├── alerts.py        (204 lines) — Alert rule CRUD, alert history snapshot
  │   ├── aviation_data.py (502 lines) — Airports, navaids, airspace, PIREPs, METARs, TAFs, NOTAMs
  │   ├── stats.py         (647 lines) — History, analytics, antenna, ACARS, extended stats
  │   ├── notifications.py (158 lines) — Notification channel CRUD and test
  │   └── system.py        (205 lines) — System status, health, DB stats, permissions
  │
  ├── audio.py (394 lines) — AudioNamespace on "/audio"
  │     Transcription updates, transmission streaming
  └── cannonball.py (911 lines) — CannonballNamespace on "/cannonball"
        Mobile threat detection with GPS tracking

middleware/
  ├── auth.py (157 lines) — JWT/API key/anonymous auth
  └── permissions.py (201 lines) — Topic and request permission checking

utils/
  ├── broadcast.py (375 lines) — Celery → Socket.IO Redis pub/sub
  ├── batcher.py (156 lines) — 50ms message batching, max 50/batch
  ├── rate_limiter.py (127 lines) — Per-topic rate limiting
  └── snapshot_cache.py (199 lines) — 2-tier snapshot caching (local + Redis)
```

## MainNamespace Mixin Composition

`MainNamespace` inherits from 7 handler mixins + `socketio.AsyncNamespace`. Python's MRO resolves `self._handle_*()` calls to the correct mixin at runtime.

**main.py** (thin router) handles:
- `on_connect()` — Auth, join rooms, send initial snapshot
- `on_disconnect()` — Cleanup session, leave rooms
- `on_subscribe(topics)` — Permission check, join rooms, send snapshots
- `on_request(type, data)` — Routes to `_handle_{type}()` methods across mixins
- `_handle_generic_request()` — Dispatch table mapping request types to handler methods
- `_generate_topic_snapshot()` — Generates snapshots calling methods from various mixins

**Subscription topics**: `aircraft`, `safety`, `stats`, `alerts`, `acars`, `airspace`, `notams`

**When modifying a handler**: Edit the corresponding mixin file, not main.py. Only touch main.py if you need to change connection/subscription/routing logic or add a new request type to the dispatch table.

**Service dependencies** (lazy-imported inside mixin methods to avoid circular imports):
- `services.photo_cache` — Aircraft photos (aircraft.py)
- `services.safety` — SafetyMonitor status (safety.py)
- `services.weather_cache` — METAR/TAF data (aviation_data.py)
- `services.notifications` — Test notification sends (notifications.py)
- `services.stats_cache` — Flight patterns, engagement, tracking quality (stats.py)
- `services.time_comparison_stats` — Time-based comparisons (stats.py)

## Key Patterns

- **Lazy imports**: All service/model imports happen inside handler methods, never at module level. This prevents circular dependency chains.
- **Room-based broadcasting**: Clients join rooms by topic. `broadcast.py` publishes from Celery tasks via Redis pub/sub.
- **Snapshot caching**: `snapshot_cache.py` maintains 2-tier cache (in-process dict + Redis) for initial state sent on subscribe.
- **Permission checking**: `middleware/permissions.py` maps topics and request types to Django permissions. Checked on subscribe and on each request.
- **Mixin isolation**: Each mixin file can be read and modified independently. All mixin methods follow the pattern: thin `_handle_*` dispatcher → `@sync_to_async` data access method.
