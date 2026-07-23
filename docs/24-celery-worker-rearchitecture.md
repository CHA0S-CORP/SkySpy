# 24 — Celery Worker Re-architecture (polling backlog fix)

## Symptom

The `polling` broker queue accumulated **83,000+ tasks** over ~25h of uptime.
`celery inspect ping` timed out; the worker showed `unhealthy`. Live-feed latency
degraded and enrichment (photos/routes/owner) lagged intermittently.

## Root cause

A **single Celery worker** consumed all six queues
(`polling,default,database,transcription,notifications,low_priority`) with
`--pool=gevent --concurrency=100`, and Celery boots with
`monkey.patch_all(ssl=False)` (SSL left unpatched to avoid Django-ORM issues).

Three compounding problems:

1. **Blocking HTTPS freezes the gevent hub.** Every I/O task that makes an HTTPS
   request — `external_db.fetch_aircraft_photos`, `fetch_route_for_icao`,
   geodata/notams/openaip/incidents/rag/LLM — blocks the *entire* hub (all 100
   greenlets) for the duration of the socket read, because `ssl` is not
   cooperatively patched. A burst of photo/route fetches stalls every queue.
2. **The hot `polling` queue is polluted with heavy work.** `poll_aircraft`
   (1 s cadence) shared the queue with compute-heavy `aggregate_all_stats`,
   `update_stats_cache`, `refresh_acars_stats`, `update_antenna_analytics`,
   `cannonball.analyze_aircraft_patterns`. A slow aggregation blocks realtime
   consumption.
3. **`poll_aircraft` is pure churn when streaming.** With
   `AIRCRAFT_STREAM_ENABLED` + an active stream, `poll_aircraft` returns
   immediately (no-op) — yet it was queued every 1 s (86k/day) with
   `expire_seconds=1.0`. When the worker is briefly starved (problem 1) it can't
   even receive-and-discard them fast enough, so they pile up unbounded.

## New architecture

Isolate the realtime hot path from blocking I/O, and keep only cheap
time-sensitive tasks on `polling`.

### Two workers

| Worker | Pool | Concurrency | Queues | Rationale |
|--------|------|-------------|--------|-----------|
| `celery-worker-realtime` | gevent | 20 | `polling` | Tiny, latency-sensitive tasks (poll/stream/stats-tick). Its hub is never touched by external HTTP, so the live feed can't be starved. |
| `celery-worker` | **threads** | 24 | `default,database,transcription,notifications,low_priority` | All blocking HTTP/DB fan-out (photos, routes, enrichment, geodata, acars, notifications). Real OS threads = true blocking-I/O concurrency and no hub to freeze; Django opens a connection per thread. |

The io worker uses `--pool=threads` (not gevent), so `CELERY_POOL` is **not**
`gevent` for it → `monkey.patch_all` is skipped → blocking HTTPS runs in normal
threads instead of freezing a shared hub. The realtime worker stays gevent
(cheap, cooperative, good for the long-lived stream greenlet + many tiny tasks).

### `polling` queue = realtime only

Kept on `polling`: `poll_aircraft`, `stream_aircraft`, `start_aircraft_stream`,
`emit_stats_tick` (cheap cache-only KPI tick).

Moved OFF `polling`:
- `update_stats_cache`, `update_safety_stats`, `aggregate_all_stats`,
  `cannonball.analyze_aircraft_patterns` → `default`
- `update_antenna_analytics`, `refresh_acars_stats` → `low_priority`

### Cut poll_aircraft churn

`poll-aircraft-every-2s` beat cadence `1.0 → 2.0 s`, `expire_seconds 1.0 → 2.0`.
`poll_aircraft` is only a fallback for when the stream is down; the stream's own
30 s health-check (`start_aircraft_stream`) restarts it, so 2 s fallback polling
is ample and halves the churn (and the entry name now matches its cadence).

## Files

- `skyspy_django/skyspy/celery.py` — `task_routes` reclassification + beat cadence.
- `docker-compose.yml` — split `celery-worker` into `celery-worker` (threads, io)
  + `celery-worker-realtime` (gevent, polling); shared env via a YAML anchor.
- `deploy/proxmox/docker-compose.prod.yml` — mirror if it overrides the worker.

## Verification

- After deploy: `redis-cli -n 0 LLEN polling` stays low/flat (single digits),
  not monotonically growing.
- `celery -A skyspy inspect ping` replies promptly (worker healthy).
- `inspect active` on the realtime worker shows only poll/stream/tick tasks;
  photos/routes appear only on the io worker.
- Live map latency steady during a photo/route enrichment burst.

## One-time cleanup

The historical backlog is drained by restarting the worker (already done). If a
large stale backlog exists again, `redis-cli -n 0 LTRIM polling -1 0` (or
`DEL polling`) is safe — `poll_aircraft` is idempotent and re-queued every 2 s.
