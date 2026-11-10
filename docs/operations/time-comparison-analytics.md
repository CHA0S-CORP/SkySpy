# Time-comparison analytics rollout

This change bounds time-comparison analytics and replaces repeated raw-history
scans with hourly per-aircraft summaries. It does not repair SSD/SATA faults or
change other analytics services.

## Behavior

- All HTTP and Socket.IO time-comparison getters are cache-only. Empty caches
  return `{"status":"preparing"}`. The Analytics page polls every 30 seconds.
- Default refreshes still run every five minutes. Custom date ranges are queued
  with a five-minute expiry and request deduplication.
- A PostgreSQL session advisory lock serializes default and custom refreshes.
  It does not expire during a slow query and releases when the connection dies.
- Each statement is limited to 30 seconds. Parallel query workers are disabled
  for this refresh connection; both settings are restored when work finishes.
- Successful results remain cached for 24 hours, retaining their original
  timestamp during failed refreshes.
- Each refresh rebuilds at most 24 dirty hours and checks a 10-second elapsed
  budget between hours. A single hour can exceed that budget, but each SQL
  statement remains subject to the 30-second limit.
- PostgreSQL statement triggers mark affected hours on bulk insert, update and
  delete. Generation checks prevent concurrent writes from being marked clean.
  Rebuilding replaces each hour atomically rather than adding counts twice.
- Per-aircraft buckets preserve distinct counts across hours. Averages use
  observation sums and non-null counts. Rolling day/week windows align their
  lower boundary to the hour; calendar month/week boundaries remain unchanged.
- Summaries retain a 397-day window. Requests accept at most 365 days, 52 weeks,
  or 12 months. Raw sightings remain canonical and are not deleted by this job.

## Deployment order

1. Back up the database before deploying schema changes. Investigate the recorded
   system-SSD read/write errors separately; these safeguards cannot fix hardware.
2. Stop the old application worker processes through the normal Portainer rollout
   before starting the new versions. Existing queries are not retroactively
   governed by the new timeouts. Inspect `pg_stat_activity`; cancel only verified
   obsolete time-comparison SELECTs if they survive the old workers' shutdown.
3. Run migrations 0049 and 0050, then start the updated API/workers/Beat. Do not
   run mixed old/new analytics workers during rollout.
4. The first refresh seeds missing hourly markers and backfills in bounded
   batches. It does not scan the whole history in the migration. At 24 hours per
   five-minute tick, a large initial history can take hours or days to prepare;
   the UI reports preparation rather than displaying incomplete totals as final.
5. Check the counts of `built_at IS NULL` and `dirty` in
   `skyspy_timesummaryhour`, worker logs, and `pg_stat_activity`. The unbuilt count
   should decrease; late arrivals can leave already-built hours dirty until the
   next pass. Once initial coverage exists, refreshes publish complete snapshots.
6. Verify `/api/v1/history/time-comparison/` promptly returns either a preparation
   response or a cached snapshot, and the Analytics panel updates accordingly.

If one hour repeatedly exceeds the SQL budget, leave the timeout in place and
investigate the disk/query plan instead of raising it. To roll back, stop the new
workers before reversing migrations 0050 and 0049; they contain only rebuildable
summaries/triggers, not raw history. Reverting application code also reintroduces
the former unbounded scans, so keep analytics disabled during that rollback.
