"""Cross-worker delivery and recovery without a running Redis service."""

import fakeredis
import pytest

from skyspy.services import position_buffer as module
from skyspy.services.position_buffer import GROUP, STREAM, PositionBuffer


@pytest.fixture
def workers(monkeypatch):
    server = fakeredis.FakeServer()
    monkeypatch.setattr(module.Redis, "from_url", lambda *a, **kw: fakeredis.FakeRedis(server=server))
    return PositionBuffer("redis://producer"), PositionBuffer("redis://consumer")


def test_separate_workers_share_positions_and_acknowledge(workers):
    producer, consumer = workers
    positions = [{"hex": "ABC123", "lat": 30.2, "lon": -97.7}, {"hex": "DEF456", "lat": 31, "lon": -98}]
    producer.append(positions)
    name, entries = consumer.claim()
    assert [position for _, position in entries] == positions
    assert producer.depth() == 2  # Claiming is not destructive.
    consumer.acknowledge(name, [key for key, _ in entries])
    assert producer.depth() == 0
    assert consumer.redis.xpending(STREAM, GROUP)["pending"] == 0


def test_worker_death_or_db_failure_preserves_batch_for_another_worker(workers, monkeypatch):
    producer, worker = workers
    producer.append([{"hex": "ABC123", "lat": 30, "lon": -97}])
    _, original = worker.claim()  # Worker dies before acknowledging.
    _, concurrent = producer.claim()
    assert concurrent == []  # Active writes are not claimed again immediately.
    monkeypatch.setattr(module, "RETRY_MS", 0)
    name, recovered = producer.claim()
    assert recovered == original
    producer.acknowledge(name, [key for key, _ in recovered])
    assert worker.depth() == 0


def test_capacity_rejection_keeps_existing_reports(workers, monkeypatch):
    producer, worker = workers
    monkeypatch.setattr(module, "CAPACITY", 2)
    producer.append([{"hex": "FIRST"}])
    with pytest.raises(BufferError):
        producer.append([{"hex": "SECOND"}, {"hex": "THIRD"}])
    _, entries = worker.claim()
    assert [p["hex"] for _, p in entries] == ["FIRST"]


def test_flush_can_keep_up_with_more_than_500_positions(workers):
    producer, worker = workers
    producer.append([{"hex": f"{i:06X}"} for i in range(1500)])
    _, entries = worker.claim()
    assert len(entries) == 1500
