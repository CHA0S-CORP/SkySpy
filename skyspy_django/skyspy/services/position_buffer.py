"""Cross-worker position handoff, with acknowledgement after the DB commit.

Redis stream entries remain pending on failures or worker death and can be
claimed by another flush after the visibility timeout. Delivery is at least
once: a crash between commit and acknowledgement may repeat a batch.
"""

import json
import time
from uuid import uuid4

from redis import Redis
from redis.exceptions import ResponseError

STREAM = "skyspy:positions:v1"
GROUP = "database"
RETRY_MS = 60_000
CAPACITY = 50_000


class PositionBuffer:
    def __init__(self, url):
        self.redis = Redis.from_url(url, socket_connect_timeout=2, socket_timeout=3)

    def append(self, positions):
        # One stream entry per report; no trimming of unacknowledged data.
        # Backpressure leaves the batch in the producer's bounded local buffer.
        observed_at = time.time()
        payloads = [json.dumps({"_observed_at": observed_at, **position}) for position in positions]
        result = self.redis.eval(
            """
            if redis.call('XLEN', KEYS[1]) + #ARGV - 1 > tonumber(ARGV[1]) then
                return 0
            end
            for i = 2, #ARGV do
                redis.call('XADD', KEYS[1], '*', 'position', ARGV[i])
            end
            return 1
            """,
            1,
            STREAM,
            CAPACITY,
            *payloads,
        )
        if not result:
            raise BufferError("Shared position buffer full; database flush is falling behind")

    def claim(self):
        try:
            self.redis.xgroup_create(STREAM, GROUP, id="0", mkstream=True)
        except ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise
        consumer = uuid4().hex
        # Recover failed/interrupted writes before accepting fresh reports.
        _, entries, *_ = self.redis.xautoclaim(STREAM, GROUP, consumer, RETRY_MS, "0-0", count=5000)
        if not entries:
            result = self.redis.xreadgroup(GROUP, consumer, {STREAM: ">"}, count=5000)
            entries = result[0][1] if result else []
        # A consumer per flush avoids concurrent readers claiming the same pending
        # entry. Remove its metadata on ack; failed consumers are cleaned up when
        # their last pending entry is recovered (without deleting pending data).
        reports = []
        for entry_id, fields in entries:
            position = json.loads(fields[b"position"])
            # Entries queued by the previous version have no observation time.
            # Their stream ID records enqueue time, never the reclaim time.
            position.setdefault("_observed_at", int(entry_id.split(b"-")[0]) / 1000)
            reports.append((entry_id, position))
        return consumer, reports

    def acknowledge(self, consumer, ids):
        with self.redis.pipeline(transaction=True) as pipe:
            if ids:
                pipe.xack(STREAM, GROUP, *ids)
                pipe.xdel(STREAM, *ids)
            pipe.xgroup_delconsumer(STREAM, GROUP, consumer)
            pipe.execute()
        for old in self.redis.xinfo_consumers(STREAM, GROUP):
            if old["pending"] == 0 and old["idle"] >= RETRY_MS:
                self.redis.xgroup_delconsumer(STREAM, GROUP, old["name"])

    def depth(self):
        return self.redis.xlen(STREAM)
