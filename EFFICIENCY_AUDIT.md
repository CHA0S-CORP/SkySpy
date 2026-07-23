# SkySpy Efficiency & Throughput Audit

## 1. Executive Summary — Highest-Leverage Wins

Ranked by impact ÷ effort (biggest wins first):

1. **Delete the redundant `ac.copy()` on the DB write buffer** (`aircraft_stream.py:796`) — high impact, small effort. Aircraft dicts are frozen once buffered and never mutated; the copy is 250–500 pointless O(n) allocations/sec.
2. **Batch the 4 per-cycle Socket.IO broadcasts into 1 emit** (`aircraft_stream.py:749-773`) — high impact, medium effort. Cuts `json.dumps` + Redis `publish` from 4 to 1 per batch cycle (up to 75% fewer serialize/publish ops on dense feeds).
3. **Move `compute_aircraft_delta()` off the per-SSE-slice path** (`aircraft_stream.py:766`) — high impact, medium effort. Also fixes a correctness bug: partial batches falsely broadcast ~950 of 1000 active aircraft as "removed."
4. **Batch notification retry fan-out** (`tasks/notifications.py:176-232`) — high impact, small effort. Replace up to 50 individual `send_notification_task.delay()` calls per beat with one batched task (~95% fewer enqueues).
5. **Fix the Cannonball N+1 threat loop** (`tasks/cannonball.py:86-100`) — high impact, small effort. Replace per-threat `filter().first()` with a single `values_list` set-membership check; O(N)→O(1) queries every 5–10s.
6. **Parallelize the external-API waterfall** (`aircraft_info.py:433-546`) — high impact, medium effort. `asyncio.gather` + `single_flight` collapses a 52–60s worst-case sequential lookup into ~15s.
7. **Distributed lock + jitter on stats cache refresh** (`stats_cache.py`) — high impact, medium effort. Prevents concurrent WebSocket subscribers from each firing 9–27 parallel 24h-scan queries on cache expiry.
8. **Virtualize the v2 aircraft list** (`AircraftListScreen.jsx:169-299`) — high impact, medium effort. A tested `VirtualList` already exists; wiring it drops 9,000–12,000 DOM nodes to ~25 rows.

---

## 2. Per-Subsystem Findings

### Socket.IO Real-time Streaming Hot Path

**Double JSON serialization in snapshot retrieval** — `main.py:549-550` / `snapshot_cache.py:102`.
*Problem:* The snapshot cache stores pre-serialized JSON strings (for Redis), but `_emit_cached_snapshot` immediately `json.loads()` them (line 549), then hands the dict to `sio.emit()`, which internally `json.dumps()` them again via the packet encoder. A loads→dumps cycle per emission, defeating the point of the string cache. The proposed "pass pre-serialized JSON to the socket.io builder" is *not feasible* — `emit()` always re-serializes whatever it's given.
*Fix:* Dual-layer cache — keep both the serialized string (Redis) and a dict object (local process); emit the local dict directly and only deserialize from Redis on a local miss. **Impact: high. Effort: small.**

**Four independent broadcasts serialize separately per cycle** — `aircraft_stream.py:749-773`.
*Problem:* `update_state_and_broadcast()` makes 4 `sync_emit()` calls (removed/positions/delta/new), each running its own `_serialize_message` → `json.dumps` (`broadcast.py:140`) and Redis `publish`. At 100ms batches with 20+ updates/sec this is 160+ `json.dumps`/sec. (Verified: this finding overlaps with the ingest-pipeline "Redundant JSON encoding" item — same root cause.)
*Fix:* Coalesce into one compound-event emit `{removed, positions, delta, new}` clients unpack; 4→1 serialize/publish (up to 75% reduction). **Impact: high. Effort: medium.**

**Per-aircraft dict reconstruction in `broadcast_positions_fast`** — `aircraft_stream.py:555-567`.
*Problem:* A list comprehension allocates a fresh 7-field dict per aircraft per batch — 500+/sec minimum, up to 5,000/sec at peak. Field filtering happens redundantly here *and* at JSON encode time. Measurable GC pressure.
*Fix:* Filter at serialization time (custom `JSONEncoder` or a frozenset field filter) instead of allocating new dicts. **Impact: high. Effort: small.**

**Overlapping field extraction across `positions_fast` and `compute_delta`** — `aircraft_stream.py:762,766`.
*Problem:* 6 position fields (lat, lon, alt, track, gs, vr) are extracted twice per cycle — once in `broadcast_positions_fast`, again in `_compute_field_changes`. At 50–500 aircraft × 10+ updates/sec, 3,000–30,000 redundant `dict.get()`/sec. Honest caveat from verification: `dict.get()` is O(1) native code, so the actual win is modest.
*Fix:* Extract TRACKED_FIELDS + position fields once per aircraft, pass to both. **Impact: medium. Effort: medium.**

**Aircraft state dict copies on dense feeds** — `aircraft_stream.py:424,434,796`.
*Problem:* `_previous_aircraft_state = current_by_hex.copy()` runs every cycle, and line 796 shallow-copies every aircraft into the DB buffer. Verified allocation churn: ~0.44 MB/sec normal, ~12.75 MB/sec worst-case (500 aircraft all changing), enough to cause observable gevent/CPython GC pause on a 2-core box. The 50k-deep buffer alone is ~42.5 MB resident.
*Fix:* Use `dict.update()` in place instead of reassignment; buffer only changed aircraft; consider a reusable-object pool. **Impact: high. Effort: medium.** (Note: line 796 overlaps with the small-effort "remove `ac.copy()`" quick win below — do that first.)

**JSON (not msgpack) in the broadcast pipeline** — `broadcast.py:140`.
*Problem:* Uses `json.dumps().encode()` for Redis pub/sub. The docstring *claims* msgpack, but msgpack (installed, `requirements.txt:24`) is never used in the Socket.IO layer. 100-aircraft batch ≈ 26.7 KB JSON. Honest context: delta compression (TRACKED_FIELDS) already gives ~50% reduction — a stronger mitigation than binary encoding's ~35%.
*Fix:* Optional msgpack swap (needs client decoder + AsyncRedisManager negotiation + feature-flagged rollout). Retain delta compression regardless. **Impact: medium. Effort: medium.**

**Snapshot cache stampede (partially confirmed)** — `main.py:538-598`.
*Problem:* On 5s-TTL expiry, concurrent clients all regenerate the same topic snapshot. Verification tempers the claim: aircraft snapshots bypass the DB (`current_aircraft` cache); the 4 DB topics (safety/alert/acars/notam) *all have appropriate timestamp indexes* — so this is a thundering-herd (10+ peak QPS/topic), **not** a full table scan. Can still cause 100–500ms/query on large tables.
*Fix:* Redis/asyncio lock per topic to serialize regeneration; longer TTL on non-critical topics; write-through invalidation from data-write tasks. **Impact: medium. Effort: medium.**

*Already handled:* MessageBatcher (`batcher.py`) is fully implemented, exported, and tested but **never instantiated** in production. Wiring it is high-complexity (sync `sync_emit` vs async batcher); the simpler compound-emit fix above supersedes it, so it's checked and deprioritized rather than actioned.

---

### Aircraft Ingest & Streaming Pipeline

**Redundant `ac.copy()` on DB buffer append** — `aircraft_stream.py:792-796`.
*Problem:* Line 796 shallow-copies every aircraft every batch. Verified: all mutations (normalization, ghost flags) occur *before* buffering; the flush only reads via `.get()`; and the buffer holds an independent reference even if `_aircraft_state` is later replaced. The copy is purely defensive and unnecessary — ~250–500 O(n) copies/sec.
*Fix:* `_db_write_buffer.append(ac)` (drop `.copy()`). **Impact: high. Effort: small.**

**`compute_aircraft_delta` runs per partial SSE slice** — `aircraft_stream.py:766-767`.
*Problem:* Called on every 100ms partial batch but computes delta against the *full* persistent `_previous_aircraft_state`. **Correctness bug:** with 1000 aircraft in 50-aircraft slices, each slice sees ~950 aircraft as "removed" and broadcasts false removals → client-side map churn. Plus 9 redundant calls/sec. The function never receives `full_snapshot`, so it can't distinguish partial from full.
*Fix:* Move the delta call into `sync_cache_state()` (1/sec, full list); pass `full_snapshot` to skip delta on partial slices. **Impact: high. Effort: medium.**

**Redundant JSON encoding for 4 broadcast events** — `aircraft_stream.py:749-773`.
*Problem:* Same 4-emit pattern as the Socket.IO section — 4 independent `json.dumps().encode()` + Redis `publish` per cycle, no batching.
*Fix:* Single compound emit; eliminates 3 of 4 serialize + publish ops. **Impact: high. Effort: medium.**

**Synchronous external-DB lookups starve DB writes** — `tasks/external_db.py:231-284`, `aircraft_stream.py:951-977`, `services/external_db.py:1195-1243`.
*Problem:* `lookup_all()` calls FAA→ADSBX→tar1090→OpenSky sequentially; `fetch_aircraft_info_batch()` iterates 50 aircraft serially, then serial gap-fill HTTP (`aircraft_info.py:433-546`, up to 10s/API). Both `process_new_aircraft_lookups` and `flush_stream_to_database` share the `database` queue — a slow 50-aircraft lookup batch (5–20s) blocks `AircraftSighting` flushes while the buffer (maxlen 50k) fills. Verified *not* mitigated: no per-batch caching, no `celery.group()`, no async; the 60s rate limit gates only external API calls, not the in-memory lookups.
*Fix:* Split cache-hits from misses in one pass; `celery.group()` one subtask per source so lookups run concurrently and off the DB queue. **Impact: high. Effort: large.**

**DB buffer silently drops oldest positions** — `aircraft_stream.py:56-60,790-796,882-899`.
*Problem:* `deque(maxlen=50000)` silently discards oldest on overflow. The pre-append count check (line 794) is racy under threads. Verified: safe at typical load (1–20% utilization), *at the edge* on dense bursts (500 ac × 10 upd/s = 50% per 5s flush), and overflows on delayed/slow flush. Loss is detected only at the next flush (5s+ later) — data already lost. No 80% threshold, no buffer-fill metric, no dynamic flush cadence, no backpressure.
*Fix:* (1) buffer-depth metric in `update_queue_metrics()` [lowest risk, do first]; (2) 80% (40k) warning threshold; (3) dynamic flush 5s→1s when aircraft > 100. **Impact: high. Effort: small.**

**Redundant per-aircraft distance calc** — `aircraft_stream.py:517-527`.
*Problem:* Haversine runs on every aircraft every frame (500/sec) regardless of position change; `distance_nm` isn't in TRACKED_FIELDS so delta optimization doesn't help. Verified ~11 trig ops/aircraft (claim said 6) ≈ 5,500 transcendental ops/sec. Honest caveat: negligible on servers, measurable on RPi.
*Fix:* Skip recalc when (lat, lon) unchanged vs previous state, or bounded LRU keyed on (lat, lon). **Impact: medium. Effort: small.**

---

### Celery Task Layer

**Per-aircraft fan-out in notification retry loop** — `tasks/notifications.py:176-232`.
*Problem:* `process_notification_queue()` (every 30s) fetches up to 50 retryable notifications and serially calls `send_notification_task.delay()` for each — up to 50 separate enqueues per beat. Verified: no `group()`/`chord()` anywhere in the codebase, `worker_prefetch_multiplier=1` so per-task overhead isn't amortized.
*Fix:* Single `group()`/`chord()` or a `process_batch_notifications(ids)` task; ~95% fewer enqueues. **Impact: high. Effort: small.**

**N+1 in Cannonball threat loop** — `tasks/cannonball.py:86-100`.
*Problem:* Iterates threat_objects (100+) calling `CannonballKnownAircraft.objects.filter(icao_hex=threat.hex).first()` per threat, plus a `record_detection()` UPDATE per match — up to 2N queries every 5–10s. `icao_hex` is indexed but each query still fires.
*Fix:* `known_set = set(...values_list('icao_hex', flat=True))` once, then O(1) membership; fetch full record only when recording. **Impact: high. Effort: small.**

**`celery.backend_cleanup` lacks SQL fallback** — `celery.py:666-668`, `tasks/cleanup.py`.
*Problem:* `TaskResult` pruning depends entirely on the periodic `backend_cleanup` routed to `low_priority`. Unlike sightings/sessions/audio, there's no SQL-based cleanup task; `CELERY_RESULT_EXPIRES=7d` isn't enforced by any scheduled prune; if `low_priority` backs up under peak load, `TaskResult` grows unbounded.
*Fix:* Add a daily `DELETE FROM django_celery_results_taskresult WHERE date_created < now() - 7d` task on the `database` queue. **Impact: high. Effort: small.**

**Photo fetch fan-out inside batch lookup** — `tasks/external_db.py:231-284,388-400`.
*Problem:* `fetch_aircraft_info_batch()` (50 ICAOs) calls `_trigger_photo_fetch_if_enabled()` per success, each dispatching a separate `fetch_aircraft_photos.delay()` — 1 batch task becomes 1 + up to 50 tasks, negating batching. `batch_fetch_aircraft_photos()` exists (line 843) but is never called. `PHOTO_AUTO_DOWNLOAD`/`PHOTO_CACHE_ENABLED` default True, so active in prod.
*Fix:* Collect photo-needing ICAOs, dispatch one `batch_fetch_aircraft_photos(icaos)` after the loop (has built-in 0.5s rate limiting). Apply same to `fetch_aircraft_info()`. **Impact: high. Effort: small.**

**Aircraft session update lock causes cascading skips** — `tasks/aircraft.py:414-417,425-489`.
*Problem:* A 60s `cache.add()` lock makes the task return early when the prior run is still executing. `_update_aircraft_sessions` runs one DB transaction *per aircraft* — ~2000 round trips at 1000 aircraft ≈ 5–6s, exceeding the 5s beat interval → ~50% of cycles skip; with slow DB (T=10–30s) → 10–12 consecutive skips/60s. The lock was added to prevent duplicate sessions (no unique constraint on `icao_hex`) but trades duplicates for silent skips.
*Fix:* Batch aircraft (100–200/transaction) to cut runtime to <1s (~2000→10–20 queries); keep 20s lock as safety net; verify runtime <5s at 1000+ aircraft. **Impact: high. Effort: medium.**

**Antenna analytics re-scans 1h window every 10min** — `tasks/analytics.py:43-252`, `celery.py:164-166,559`.
*Problem:* Runs every 10 min (not 5 — override at `celery.py:559`), full-scanning AircraftSighting from 1h ago (up to ~10^6 rows), recomputing bearing-grouped stats and percentiles from scratch despite 83% data overlap with the prior run. Result cached 10min but intermediate buckets aren't. Corrected claim: **6** redundant scans/hour, not 12.
*Fix:* Redis per-10-min bearing buckets; aggregate 6 buckets in memory; full scan only on cache miss/hourly refresh. ~80–85% query reduction. **Impact: medium. Effort: medium.**

**Redundant external fetches — no cross-path dedup (partially confirmed)** — `tasks/aircraft.py:73-78`, `aircraft_stream.py:715-730`, `external_db.py:261,329,358`.
*Problem:* Polling and streaming paths keep *separate* in-memory `_seen_aircraft` sets, so dedup doesn't cross paths. On cold start, both can query `lookup_all()`/`_fetch_from_external_apis()` in parallel for the same ICAOs (~50 wasted API calls / ~5–7.5s I/O per cycle for 100 new ICAOs). `update_or_create` prevents duplicate rows but not redundant lookups.
*Fix:* `cache.add('aircraft_lookup_inflight:'+icao, True, 30)` gate before lookups, or a shared Redis set across both paths. **Impact: medium. Effort: small.**

**Beat schedule throughput (partially confirmed — largely already mitigated)** — `celery.py:104-680`.
*Problem:* Verification substantially deflates the original claim: **not** "50 tasks at 2-5s / 300+ enqueues/min" — actually only **6** short-interval tasks producing **~90 enqueues/min** (1.5/sec). The real residual issue is a mild thundering-herd: intervals align at LCM=60s (13 tasks fire together). Already applied: poll_aircraft 1s→2s, `aggregate_all_stats` unifying 3 stats tasks, `@singleton_task` locks on 54 tasks, expiry timestamps, RPi crontab staggering.
*Fix:* Extend the RPi-style crontab-offset staggering to the non-RPi 5-min tasks to smooth the t=30s/t=60s bursts. **Impact: medium. Effort: small.**

**Cleanup batch size 10k (partially confirmed)** — `tasks/cleanup.py:87-100`.
*Problem:* 10k-row DELETE batches at 3 AM UTC. Verification tempers this: PostgreSQL MVCC means concurrent new-row inserts aren't blocked by old-row DELETEs (disjoint row sets), and it runs off-peak — the "slows aircraft updates" claim is overstated. Real cost is minor: metadata lock waits, WAL bloat, DELETE-scan CPU.
*Fix:* Reduce batch to 1,000–2,000 + `time.sleep(0.1–0.2)` between batches. **Impact: medium. Effort: small.**

**Multiple `.count()` calls without aggregation (confirmed, currently zero impact)** — `tasks/external_db.py:1118-1122`.
*Problem:* `get_aircraft_info_stats()` does 5 sequential `COUNT(*)`; 4 hit unindexed columns (photo_url, photo_local_path, fetch_failed, is_military) → full scans. **But the task is not scheduled**, so current impact is nil (verification also flagged the original monitoring.py citation as incorrect — that code uses Redis `llen`, not DB counts).
*Fix:* Consolidate into one `.aggregate()` with conditional counts *if/when* the task is scheduled. **Impact: low (currently). Effort: small.**

---

### Django Database Layer

**Per-row `.save()` in loop in `le_data_import`** — `services/le_data_import.py:253-309` (lines 278, 286).
*Problem:* `_import_records` calls `existing.save()` inside the loop; typical 100–500-record imports fire 50–100+ individual UPDATEs where 1–2 `bulk_update` calls suffice. `transaction.atomic()` gives consistency, not batching.
*Fix:* Accumulate two lists (high-confidence updates, evidence-only), then two `bulk_update()` calls. N→2 queries. **Impact: high. Effort: small.**

*Already handled:*
- **AirspaceBoundary composite index** — the `idx_airspace_boundary_loc` composite index on `(center_lat, center_lon)` already exists (Meta.indexes, created in initial migration) and serves the 4-condition range queries in all three call sites. No action.
- **PostGIS 0047 spatial_index (partially confirmed, low)** — omitting `spatial_index=True` is *intentional and correct*: `BaseSpatialField` defaults it to True and Django's `deconstruct()` omits default values; the index is created on migration. Optional: add it explicitly for clarity/future-proofing.

*Refuted (dropped from action list, noted for the record):*
- **Cannonball ListViewSet `select_related`** — refuted. Serializers never access the `user` FK, and the `session` field renders as a `PrimaryKeyRelatedField` (id already on the instance) → no N+1. `CannonballAlertViewSet` already has `select_related("session")` where needed.
- **JSONField missing indexes** — refuted. Zero DB queries use `__contains`/`__has_key` on these 4 JSONFields; all filtering is on indexed scalar fields, JSON parsed in Python. Adding GIN indexes would waste storage with no benefit.

---

### Caching Strategy (Redis DB1 + in-process TTL)

**Cache stampede on stats refresh (no jitter/locking)** — `stats_cache.py:1142-1665,1055-1127,271-559`.
*Problem:* Every `get_*` stat follows a non-atomic `cache.get → if None: refresh → cache.get` pattern with no lock. WebSocket stats handlers (`@sync_to_async`, `stats.py:644-669`) let many clients hit the same miss in one ms window, each running the full recalc — 2–5+ 24h-scan queries per stat type. Verified: Celery refresh tasks *don't* protect this — they run in a different process and won't block an inline request-path refresh.
*Fix:* Atomic `cache.add()` soft-lock per key; serve stale on lock-fail; early-refresh at <15% TTL; inline-refresh-under-lock only on first (None) load; TTL jitter on write. **Impact: high. Effort: medium.**

**Concurrent cache misses → redundant parallel DB queries** — `stats_cache.py:1142-1193,1055-1077,271-435`.
*Problem:* Same non-atomic check-then-act. `refresh_history_cache()` alone is 9 queries (2+2+5); 2–3 concurrent misses → 18–27 parallel queries. `cache_get_or_set()` in `cache.py` shares the same flaw; Redis backend offers no client-side atomic get-or-set.
*Fix:* `cache.get_or_set` / Redis SET NX / per-key `RLock` to serialize first-miss; combine related stats into one cache entry; add concurrency tests. **Impact: high. Effort: medium.**

**Cache keys too granular — 13 keys instead of composite** — `stats_cache.py:78-96,1196-1218`.
*Problem:* 13 Redis keys (10 stats + 3 ACARS); related stats sharing a source (aircraft+top; history+trends+top; quality+engagement) are split, and reads issue separate `cache.get()` calls with no `get_many()`/pipelining.
*Fix:* Group into ~4 composite keys (`stats:aircraft:all`, `stats:history:all`, `stats:acars:all`, `stats:quality:all`); 13→4 (~69% fewer round-trips). **Impact: high. Effort: medium.**

**Duplicate queries in calculation functions (partially confirmed)** — `stats_cache.py:271-435,700-875,878-1041`.
*Problem:* Verification is selective — several sub-claims refuted:
- `calculate_history_trends` (312-376): **confirmed** — a second `.values("icao_hex").distinct().count()` (line 363) duplicates a scan computable from the first result set.
- `calculate_history_top` (379-435): **confirmed** — `base_qs` reused 5× with chained methods → 5 separate SQL queries.
- `calculate_geographic_stats`: **partly** — `recent_icaos` fetched *once* (not 3×, claim refuted), but 3 separate `AircraftInfo.filter(icao_hex__in=...)` queries (898, 929, 951) could be batched into one.
- `calculate_history_stats` and `flight_patterns` inter-table claims: **refuted** (different tables/groupings, not duplicates).
*Fix:* Compute `total_unique` in Python; fetch history-top sessions once and sort in Python; batch the 3 geographic `AircraftInfo` lookups into one. **Impact: medium. Effort: small.**

*Already handled / low priority:*
- **`get_all_cached_stats` 13 sequential gets** — confirmed mechanism but the function is **dead code** (only tests import it). Low impact; if revived, use `cache.get_many()`.
- **In-process BoundedCache vs Redis "duplication"** — the duplication/staleness framing is **refuted**. `_memory_cache` is cleanly owned by `@cached_with_ttl`/`@cached_upstream_api`; Redis owns cross-process state. Real (minor) finding: 3 global BoundedCache instances (`aircraft_info_cache`, `route_cache`, `photo_cache`) are **orphaned dead code** wasting ~8000 maxsize slots on RPi. Remove them + document ownership.

---

### External API Integration & HTTP Fan-Out

**Sequential external-API waterfall** — `aircraft_info.py:433-546`.
*Problem:* `_fetch_from_external_apis` runs HexDB→adsb.lol→ADSBX→ADSBdb→Planespotters strictly serially behind `if not info:` guards. Worst case (all miss) = 52–60s per aircraft; called in a serial loop for bulk lookups (10 missing ICAOs → 10× that). `single_flight()` exists (`http_client.py:408`) but is never called here; no `asyncio.gather`/`ThreadPoolExecutor`. Triggered from new-aircraft detection, alert gap-fill, 3 assistant tool callsites, and the airframe REST API.
*Fix:* `asyncio.gather` the sources (take first success), wrap the block in `single_flight(f"aircraft_info_{icao}")` to coalesce concurrent same-ICAO lookups. 60s→~15s. **Impact: high. Effort: medium.**

**No connection pooling — per-request `httpx.Client()`** — `weather_cache.py:440-450`, `adsbx_live.py:54-65`, `checkwx.py:63-73`, `openaip.py:174-184`, `notams.py:60-75`, `avwx.py:61-68`, `http_client.py:189,382`.
*Problem:* Every module creates `httpx.Client()` *inside* the request function (several inside `@retry`, so a fresh pool per retry attempt) and discards the 100-conn/20-keepalive pool on context exit — zero pooling benefit. Even the "preferred" `http_client.py` wrapper has the identical bug at 189 and 382. Under concurrency (Celery + ASGI) this causes new TCP+TLS per request, TIME_WAIT accumulation, and ephemeral-port pressure.
*Fix:* Module/process-scoped `httpx.Client(limits=...)` singletons; preferably route all four services through `http_client.get_json/post_json` *and* fix `http_client` to hold a shared pooled client (gains circuit breaker + rate limiting too). **Impact: high. Effort: medium.**

**Silent radius truncation in OpenAIP** — `openaip.py:221-279,339-393,536-594`; `geodata.py:272-304,381-408`.
*Problem:* Requests are silently clamped to `OPENAIP_MAX_DIST_M=50km≈27nm` (lines 254, 368, 461) while default `GEODATA_FETCH_RADIUS_NM=250`, so a 250nm request returns only 27nm of data with no log/error. The cache key uses the *clamped* radius, so 100nm and 250nm requests collide on the same 27nm entry. `get_reporting_points()` (line 564) doesn't even clamp — it sends 463km unclamped. No automatic tiling; wider coverage needs manual `AIRSPACE_EXTRA_REGIONS` (default `[]`). Callers get no indication.
*Fix:* Log a warning on clamp; apply clamping to `get_reporting_points`; automatic adaptive multi-tile fan-out for radius > 27nm (dedup by ID); settings-level warning if `GEODATA_FETCH_RADIUS_NM > 27` with empty `AIRSPACE_EXTRA_REGIONS`. **Impact: high. Effort: medium.**

**No request coalescing for METAR/TAF/PIREP** — `weather_cache.py:498-543,589-628,463-495`.
*Problem:* Concurrent Socket.IO viewport changes (`thread_sensitive=False`, `aviation_data.py:368,398`) hit the same bbox in the ~100ms window between cache check and write; all threads see the miss and each fires `_fetch_awc_data()` (3 retries w/ backoff ≈ 15s wall clock each) to aviationweather.gov. `single_flight()` exists and is fully tested but unused. (Two verified findings describe the same race — METAR/TAF and the PIREP variant.)
*Fix:* Wrap `_fetch_awc_data()` in `single_flight(cache_key, producer)` in all three functions; ~66% fewer calls during storms (3→1), ~15s→~50ms for waiters. **Impact: high (METAR/TAF) / medium (PIREP). Effort: small.**

**METARs and TAFs run sequentially (confirmed, low current impact)** — `aviation_data.py:78-84`, `main.py:399-461`.
*Problem:* `_get_metars()` and `_get_tafs()` are separate sequential `sync_to_async` handlers. **But** the frontend never requests both together (`useAviationDataFetch` fetches metars only; `useTafData` requests tafs separately), and 5min/30min caches hide the cost — so the parallel-fetch win is currently zero.
*Fix:* Combine into `_handle_weather()` with `asyncio.gather` — *conditional* on a frontend refactor to a single "weather" message. Backlog. **Impact: medium (latent). Effort: small.**

*Refuted / idle (dropped from action list):*
- **`get_bulk_aircraft_info` sequential loop** — the loop is real but the function is **never called in production** (tests only), and HTTP fires only on partial gap-fill, not for unknown aircraft. Zero ROI without callers.

---

### Frontend Performance (React/Web UI)

**Aircraft list not virtualized** — `AircraftListScreen.jsx:169-299`.
*Problem:* `rows.map()` renders every matching aircraft as a full button with 9 grid cells (30–40+ DOM elements each). At 500 tracked / 300+ shown = 9,000–12,000+ DOM nodes, no virtualization, no `React.memo` on the row. A tested `VirtualList` (`common/VirtualList.jsx`, 48px rows) exists but is only wired into v1. `rows` is memoized (32-35) but that only skips recalc, not DOM rendering.
*Fix:* Wrap the row container in `VirtualList` (`itemHeight={48}`, renders ~25 rows instead of 300); extract inline styles to CSS; `React.memo` the row. **Impact: high. Effort: medium.**

**Canvas aircraft sort every frame** — `drawAircraft.js:112-118`.
*Problem:* `[...sortedAircraft].sort(...)` runs every rAF frame to layer safety-event aircraft on top. At 500 aircraft × 60fps ≈ 270,000 ops/sec plus array copy + `Set.has` per comparison. `activeConflicts` is memoized upstream but the *sort result* is not — it re-runs even when `conflictAircraft` is unchanged.
*Fix:* Memoize the sorted array on `[sortedAircraft, conflictAircraft]` (skip when unchanged), or partition into `[safe, conflicted]` via reduce and concat to eliminate the sort entirely. **Impact: high. Effort: small.**

**MapView inline objects/functions break child memoization** — `MapView.jsx:1725-1740,2220-2236,3010-3061,3072-3085`.
*Problem:* `getBearing` and multiple handlers recreated per render; inline `config={{mode,fields}}` and callbacks passed to large unmemoized children (DataBlockConfigPanel 336 lines, AircraftContextMenu 336, OverlayMenuPanel 636, FilterMenuPanel). DataBlockConfigPanel's `useMemo([config])` recomputes every render on the new object ref. (`themeColors` already correctly `useMemo`'d at 873-875.)
*Fix:* `useCallback` the handlers and `getBearing([feederLat,feederLon])`; `useMemo` the config object; `React.memo` the four large panels. **Impact: medium. Effort: medium.**

**Safety events full `map()` on every delta** — `messageProcessor.js:318-347`.
*Problem:* `processSafetyEventUpdated`/`Resolved` call `prev.map()` over the whole array (capped 100) per message — full iteration + new array + spread merge, no batching (aircraft updates batch at 50ms), no Map index. Processed immediately from `useSocketIOData.js:133-135`, causing needless downstream re-renders (e.g. StatsScreen).
*Fix:* `findIndex` + copy-and-replace (return `prev` on no match), or store as a `Map<eventId,event>`. **Impact: medium. Effort: small.**

**AircraftListScreen enrichment re-effect on every socket update** — `AircraftListScreen.jsx:32-42`, `useBulkAircraftInfo.js:72-112`.
*Problem:* Fresh `aircraft` array ref each update → new `shownHexes` ref → unmemoized `normalized.join(',')` produces a new `key` string → the `[key, apiBase]` effect re-runs (timer setup/cancel) ~8×/sec even when visible rows are unchanged. Already mitigated: the 400ms debounce prevents actual duplicate HTTP fetches; the churn is just effect setup/teardown.
*Fix:* `useMemo` the key on `[normalized]`; debounce `shownHexes`; better, memoize the rows dependency on the actual visible hex set rather than the full aircraft ref. **Impact: medium. Effort: small.**

**Missing debounce on list search input (partially confirmed)** — `AircraftListScreen.jsx:104-109`.
*Problem:* `setQuery(e.target.value)` fires per keystroke → URL hash write + `rows`/`counts` useMemo (full filter+sort) every keystroke (~10/sec at fast typing). `useHashParamState` already supports `debounceMs` (line 46, 81-86) but line 20 passes none (defaults to 0). Enrichment fetch is separately debounced.
*Fix:* `useHashParamState('q', '', { debounceMs: 300 })` — cuts filter+sort passes from ~10/sec to ~3/sec. **Impact: medium. Effort: small.**

*Partially confirmed, low priority:*
- **Canvas marker icon SVG per aircraft** (`mapMarkerIcon.js:21-38`) — real (no caching) but scoped to *secondary* views (WeatherMap atRisk <50, DetailTrackMap single, Assistant/Pirep/Acars maps). The main LiveMap uses `CanvasAircraftLayer` (single canvas, no Leaflet markers), so no hot-path impact. Optional small `iconCache` keyed on `color|size|pulse`.
- **Per-frame bearing calc** (`useCanvasDraw.js:180-194`, `drawAircraft.js:131,241,246`) — half-mitigated: `distance_nm` *is* server-cached and normalized; `getBearing()` is *not* pre-computed and runs per aircraft per frame (30k trig ops/sec @ 500 ac), but bearing is only used for CRT-mode sweep brightness. Optionally have the server emit `bearing` alongside `distance_nm`.

*Already handled:*
- **Aggressive React Query stats polling** (`useStatsQueries.js:16-17`) — the 10s `refetchInterval` exists but the file is **dead code**, never imported. Production uses `useStats.js` (fetch-on-mount, WebSocket-first, no polling). No action.

---

## 3. Quick-Wins Table (small effort, high/medium impact)

| Fix | Location | Impact | Effort |
|---|---|---|---|
| Drop redundant `ac.copy()` on DB buffer append | `aircraft_stream.py:796` | High | Small |
| Batch notification retry fan-out (group/chord) | `tasks/notifications.py:176-232` | High | Small |
| Fix Cannonball N+1 → set-membership | `tasks/cannonball.py:86-100` | High | Small |
| Add SQL-based `TaskResult` cleanup task | `tasks/cleanup.py` / `celery.py:666-668` | High | Small |
| Collapse photo fetch fan-out into one batch task | `tasks/external_db.py:231-284,388-400` | High | Small |
| `bulk_update` instead of per-row `.save()` | `services/le_data_import.py:278,286` | High | Small |
| Dual-layer snapshot cache (kill double serialize) | `main.py:549-550` | High | Small |
| Filter position fields at serialize time (no new dicts) | `aircraft_stream.py:555-567` | High | Small |
| DB buffer depth metric + 80% backpressure | `aircraft_stream.py`, `tasks/monitoring.py` | High | Small |
| Memoize canvas per-frame sort on `conflictAircraft` | `drawAircraft.js:112-118` | High | Small |
| `single_flight()` coalescing on METAR/TAF/PIREP | `weather_cache.py:498-543,589-628,463-495` | High/Med | Small |
| Combine duplicate history/geo stat queries | `stats_cache.py:363,405-424,898-951` | Med | Small |
| In-flight dedup gate on external lookups | `tasks/aircraft.py`, `aircraft_stream.py` | Med | Small |
| Position-change guard on Haversine (RPi win) | `aircraft_stream.py:517-527` | Med | Small |
| `findIndex`/Map for safety event deltas | `messageProcessor.js:318-347` | Med | Small |
| `debounceMs: 300` on list search | `AircraftListScreen.jsx:20` | Med | Small |
| Memoize enrichment key / debounce shownHexes | `useBulkAircraftInfo.js:72-112` | Med | Small |
| Stagger non-RPi 5-min beat tasks (crontab offsets) | `celery.py` | Med | Small |
| Reduce cleanup batch 10k→1-2k + sleep | `tasks/cleanup.py:87-100` | Med | Small |
| Remove 3 orphaned BoundedCache instances | `cache.py:151-153` | Low | Small |

---

## 4. Larger Structural Bets

1. **Coalesce the hot-path broadcast into a single serialize/publish per cycle** — `aircraft_stream.py:749-773`. Replace the 4 independent `sync_emit()` calls with one compound-event emit (`{removed, positions, delta, new}`) that clients unpack. Cuts `json.dumps` + Redis `publish` by up to 75% on dense feeds and is the practical alternative to wiring the unused MessageBatcher (which is blocked by the sync/async mismatch). *Medium effort, high impact.*

2. **Fix and relocate delta computation** — `aircraft_stream.py:766`. Move `compute_aircraft_delta()` from the per-100ms partial-SSE-slice path into `sync_cache_state()` (1/sec, full list) and thread `full_snapshot` through so partial slices skip delta. This eliminates 9 redundant calls/sec **and fixes the false-removal correctness bug** that churns the client map. *Medium effort, high impact.*

3. **Parallelize the external-DB lookup pipeline off the `database` queue** — `tasks/external_db.py:231-284` + `services/external_db.py:1195-1243`. Split cache-hits from misses in one pass and fan out per-source lookups via `celery.group()` so slow external calls stop blocking `AircraftSighting` flushes and the 50k buffer stops backing up. The largest single throughput risk in the ingest path. *Large effort, high impact.*

4. **Centralized pooled HTTP client with resilience** — fix `http_client.py:189,382` to hold a process-scoped `httpx.Client(limits=...)` singleton, then migrate `avwx`, `checkwx`, `openaip`, `adsbx_live`, `weather_cache`, `notams` onto it. Eliminates per-request (and per-retry) TCP+TLS setup across all external integrations and unifies circuit-breaker + rate-limiting + `single_flight` coalescing in one layer. *Medium effort, high impact, broad blast radius.*

5. **Atomic stats-cache layer** — `stats_cache.py`. Introduce Redis SET-NX soft-locks with serve-stale-on-contention, early-refresh at <15% TTL, TTL jitter, and composite keys (13→4). Kills both the stampede (each concurrent WebSocket subscriber firing 9–27 parallel 24h-scan queries) and the granular multi-round-trip reads in one design. *Medium effort, high impact.*

6. **Adaptive multi-tile OpenAIP fetching** — `openaip.py` + `geodata.py`. Replace silent 27nm clamping with automatic overlapping-tile fan-out for radii > 27nm (dedup by feature ID), fix the clamped-radius cache-key collision, and add clamp logging + settings validation. Turns a silently-degraded map layer into one that actually honors `GEODATA_FETCH_RADIUS_NM`. *Medium effort, high impact on data completeness.*

7. **Session-update batching** — `tasks/aircraft.py:425-489`. Batch 100–200 aircraft per transaction to bring runtime from ~5–6s (2000 round trips) to <1s, ending the ~50% lock-induced cycle skips; keep the lock as a safety net rather than the primary mechanism. *Medium effort, high impact on session-data completeness.*

---

**Verification honesty note:** This report drops 3 refuted findings (Cannonball `select_related`, JSONField indexes, `get_bulk_aircraft_info` loop) and flags 2 as already-mitigated (AirspaceBoundary composite index, React Query stats polling dead code). Several "high"-sounding claims were downgraded per verification — the beat schedule is ~90 enqueues/min (not 300+), the snapshot stampede hits indexed queries (not table scans), cleanup DELETEs don't block inserts under MVCC, and the BoundedCache "duplication" is actually just orphaned dead code. Where the original impact was *raised* on verification (DB buffer copies, external-DB queue starvation), that reflects measured allocation/latency evidence in the notes.