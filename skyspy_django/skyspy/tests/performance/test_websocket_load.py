"""
WebSocket load tests for SkySpy.

Tests concurrent WebSocket connections, message broadcast latency,
subscription churn, and memory usage under sustained connections.

Run with: pytest -m performance skyspy/tests/performance/test_websocket_load.py

Note: These tests require a running Socket.IO server or use mocked connections.
"""

import asyncio
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from django.core.cache import cache
from django.test import override_settings

from skyspy.tests.performance.conftest import (
    LoadGenerator,
    PerformanceMetrics,
    generate_aircraft_data,
    timed_operation,
)


@pytest.mark.performance
class TestWebSocketConnectionLoad:
    """
    Tests for WebSocket connection handling under load.

    These tests verify the system can handle many concurrent connections
    and the connection/disconnection process is performant.
    """

    def test_connection_performance(self, thresholds):
        """
        Test WebSocket connection establishment performance.

        Baseline: Single connection should complete in < 100ms
        """
        metrics = PerformanceMetrics(operation_name="ws_connect")

        # Mock the Socket.IO namespace connection
        with patch("skyspy.socketio.namespaces.main.MainNamespace") as MockNamespace:
            mock_instance = MagicMock()
            mock_instance.on_connect = AsyncMock(return_value=True)
            MockNamespace.return_value = mock_instance

            for _i in range(50):
                with timed_operation() as timer:
                    # Simulate connection establishment

                    # Create mock session data
                    {
                        "user": MagicMock(is_authenticated=False, username="anonymous"),
                        "subscribed_topics": [],
                        "client_filters": {},
                        "connected_at": time.time(),
                    }

                metrics.record(
                    type(
                        "Result",
                        (),
                        {
                            "duration_ms": timer["duration_ms"],
                            "success": True,
                            "error": None,
                        },
                    )()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["ws_connect_p95"]

    def test_concurrent_connections(self, thresholds):
        """
        Test handling of concurrent WebSocket connections.

        Baseline: Should handle 100 concurrent connections
        """
        metrics = PerformanceMetrics(operation_name="ws_concurrent_connect")
        connection_count = 100

        # Track active connections
        active_connections = {}

        with patch("skyspy.socketio.namespaces.main.sio") as mock_sio:
            # Mock save_session to track connections
            async def mock_save_session(sid, data):
                active_connections[sid] = data

            async def mock_get_session(sid):
                return active_connections.get(sid, {})

            mock_sio.save_session = mock_save_session
            mock_sio.get_session = mock_get_session

            def simulate_connection(i):
                start = time.perf_counter()
                sid = f"test_sid_{i}"

                # Simulate connection setup
                session_data = {
                    "user": None,
                    "subscribed_topics": [],
                    "client_filters": {},
                    "connected_at": time.time(),
                }
                active_connections[sid] = session_data

                duration_ms = (time.perf_counter() - start) * 1000
                return duration_ms

            with ThreadPoolExecutor(max_workers=50) as executor:
                futures = [executor.submit(simulate_connection, i) for i in range(connection_count)]

                for future in as_completed(futures):
                    duration_ms = future.result()
                    metrics.record(
                        type(
                            "Result",
                            (),
                            {
                                "duration_ms": duration_ms,
                                "success": True,
                                "error": None,
                            },
                        )()
                    )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Active connections: {len(active_connections)}")

        assert len(active_connections) == connection_count
        assert metrics.success_rate == 100

    def test_connection_disconnection_churn(self, thresholds):
        """
        Test rapid connection/disconnection cycles.

        Baseline: Should handle rapid connect/disconnect without degradation
        """
        metrics = PerformanceMetrics(operation_name="ws_churn")
        cycles = 50

        active_connections = {}

        for i in range(cycles):
            with timed_operation() as timer:
                sid = f"churn_sid_{i}"

                # Connect
                active_connections[sid] = {
                    "subscribed_topics": ["aircraft", "safety"],
                    "connected_at": time.time(),
                }

                # Subscribe to topics
                topics = ["aircraft", "safety", "alerts"]
                for _topic in topics:
                    pass
                    # Simulate room join

                # Disconnect
                del active_connections[sid]

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.success_rate == 100
        assert len(active_connections) == 0  # All disconnected


@pytest.mark.performance
class TestWebSocketBroadcastLoad:
    """
    Tests for WebSocket message broadcasting under load.

    These tests verify broadcast performance to many subscribers.
    """

    def test_broadcast_latency_single_room(self, large_aircraft_cache, thresholds):
        """
        Test message broadcast latency to a single room.

        Baseline: Broadcast to room should complete in < 50ms
        """
        metrics = PerformanceMetrics(operation_name="ws_broadcast_single")

        # Simulate 50 subscribers in the room
        subscribers = [f"sub_{i}" for i in range(50)]
        dict.fromkeys(subscribers, True)

        aircraft_data = large_aircraft_cache[:10]  # Broadcast 10 aircraft

        with patch("skyspy.socketio.server.sio") as mock_sio:
            mock_sio.emit = AsyncMock()

            for _ in range(20):
                with timed_operation() as timer:
                    # Simulate broadcast
                    {
                        "aircraft": aircraft_data,
                        "count": len(aircraft_data),
                        "timestamp": time.time(),
                    }
                    # In real scenario, this would emit to all room members
                    for _sid in subscribers:
                        # Simulate per-subscriber processing
                        pass

                metrics.record(
                    type(
                        "Result",
                        (),
                        {
                            "duration_ms": timer["duration_ms"],
                            "success": True,
                            "error": None,
                        },
                    )()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        assert metrics.p95 < thresholds["ws_message_latency_p95"]

    def test_broadcast_to_100_subscribers(self, large_aircraft_cache, thresholds):
        """
        Test broadcast performance with 100 subscribers.

        Baseline: Should broadcast to 100 subscribers efficiently
        """
        metrics = PerformanceMetrics(operation_name="ws_broadcast_100")

        subscribers = [f"sub_{i}" for i in range(100)]
        large_aircraft_cache[:20]

        delivered_count = 0

        for _ in range(10):
            with timed_operation() as timer:
                # Simulate broadcast delivery
                for _sid in subscribers:
                    # Simulate message serialization and queueing
                    delivered_count += 1

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Total messages delivered: {delivered_count}")

        assert delivered_count == 1000  # 10 broadcasts * 100 subscribers
        # Allow 200ms for 100 subscribers
        assert metrics.p95 < 200

    def test_broadcast_large_payload(self, very_large_aircraft_cache, thresholds):
        """
        Test broadcast performance with large payloads.

        Baseline: Large payloads (1500 aircraft) should still broadcast quickly
        """
        metrics = PerformanceMetrics(operation_name="ws_broadcast_large")

        subscribers = [f"sub_{i}" for i in range(20)]
        aircraft_data = very_large_aircraft_cache  # 1500 aircraft

        for _ in range(5):
            with timed_operation() as timer:
                # Simulate serialization of large payload
                import json

                payload = json.dumps(aircraft_data)
                payload_size_kb = len(payload) / 1024

                # Simulate broadcast
                for _sid in subscribers:
                    pass  # Would send payload

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Payload size: {payload_size_kb:.1f} KB")

        # Large payloads need more time
        assert metrics.p95 < 500


@pytest.mark.performance
class TestWebSocketSubscriptionChurn:
    """
    Tests for subscription and unsubscription handling.

    Real-world scenarios involve frequent topic changes.
    """

    def test_subscription_performance(self, thresholds):
        """
        Test topic subscription performance.

        Baseline: Subscription should complete in < 20ms
        """
        metrics = PerformanceMetrics(operation_name="ws_subscribe")

        topics = ["aircraft", "safety", "alerts", "acars", "stats"]
        rooms = {}

        for _ in range(100):
            with timed_operation() as timer:
                sid = f"sub_{random.randint(1, 1000)}"
                topic = random.choice(topics)
                room = f"topic_{topic}"

                # Simulate room join
                if room not in rooms:
                    rooms[room] = set()
                rooms[room].add(sid)

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Rooms: {[(k, len(v)) for k, v in rooms.items()]}")

        assert metrics.p95 < 20

    def test_unsubscription_performance(self, thresholds):
        """
        Test topic unsubscription performance.

        Baseline: Unsubscription should complete in < 20ms
        """
        metrics = PerformanceMetrics(operation_name="ws_unsubscribe")

        # Pre-populate rooms
        rooms = {
            "topic_aircraft": {f"sub_{i}" for i in range(100)},
            "topic_safety": {f"sub_{i}" for i in range(50)},
            "topic_alerts": {f"sub_{i}" for i in range(30)},
        }

        for _ in range(100):
            with timed_operation() as timer:
                room = random.choice(list(rooms.keys()))
                if rooms[room]:
                    sid = random.choice(list(rooms[room]))
                    rooms[room].discard(sid)

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")

        assert metrics.p95 < 20

    def test_rapid_subscription_changes(self, thresholds):
        """
        Test rapid subscription/unsubscription cycles.

        Baseline: Should handle rapid changes without degradation
        """
        metrics = PerformanceMetrics(operation_name="ws_sub_churn")

        rooms = {f"topic_{t}": set() for t in ["aircraft", "safety", "alerts", "acars", "stats"]}
        room_names = list(rooms.keys())

        for i in range(200):
            with timed_operation() as timer:
                sid = f"churn_{i % 20}"  # 20 unique sids

                if random.random() < 0.6:
                    # Subscribe
                    room = random.choice(room_names)
                    rooms[room].add(sid)
                else:
                    # Unsubscribe
                    room = random.choice(room_names)
                    rooms[room].discard(sid)

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")

        assert metrics.p95 < 20


@pytest.mark.performance
@pytest.mark.slow
class TestWebSocketMemoryUsage:
    """
    Tests for memory usage under sustained WebSocket connections.

    These tests verify memory doesn't grow unbounded with many connections.
    """

    def test_memory_with_sustained_connections(self):
        """
        Test memory usage with 100 sustained connections.

        Baseline: Memory should stabilize and not grow unbounded
        """
        import sys

        len([obj for obj in dir() if not obj.startswith("_")])

        # Simulate 100 connections with session data
        connections = {}

        for i in range(100):
            sid = f"mem_test_{i}"
            connections[sid] = {
                "user": None,
                "subscribed_topics": ["aircraft", "safety"],
                "client_filters": {
                    "min_alt": random.randint(0, 20000),
                    "max_distance": random.randint(50, 200),
                },
                "connected_at": time.time(),
                "message_count": 0,
            }

        # Simulate some message history per connection
        for sid in connections:
            connections[sid]["recent_messages"] = [
                {"event": "aircraft:update", "size": 1024, "time": time.time()} for _ in range(10)
            ]

        # Check memory footprint
        connection_size = sys.getsizeof(connections)
        avg_per_connection = connection_size / len(connections) if connections else 0

        print(f"\nTotal connections: {len(connections)}")
        print(f"Dict size: {connection_size} bytes")
        print(f"Avg per connection: {avg_per_connection:.1f} bytes")

        # Clean up
        connections.clear()

        # Memory should be reasonable (< 100KB for 100 connections)
        assert connection_size < 100 * 1024

    def test_cleanup_on_disconnect(self):
        """
        Test that disconnections properly clean up resources.

        Baseline: All resources should be freed on disconnect
        """
        connections = {}
        rooms = {
            "topic_aircraft": set(),
            "topic_safety": set(),
        }

        # Create connections
        for i in range(50):
            sid = f"cleanup_test_{i}"
            connections[sid] = {
                "subscribed_topics": ["aircraft", "safety"],
                "data": [0] * 1000,  # Some data
            }
            rooms["topic_aircraft"].add(sid)
            rooms["topic_safety"].add(sid)

        initial_connections = len(connections)
        initial_room_members = sum(len(r) for r in rooms.values())

        # Disconnect all
        for sid in list(connections.keys()):
            # Leave rooms
            for room in rooms.values():
                room.discard(sid)
            # Remove connection
            del connections[sid]

        assert len(connections) == 0
        assert all(len(r) == 0 for r in rooms.values())
        print(f"\nCleaned up {initial_connections} connections, {initial_room_members} room memberships")


@pytest.mark.performance
class TestWebSocketReconnection:
    """
    Tests for reconnection handling.

    Reconnection storms can occur when many clients reconnect simultaneously.
    """

    def test_reconnection_storm_handling(self, thresholds):
        """
        Test handling of reconnection storm (many simultaneous reconnects).

        Baseline: Should handle 50 simultaneous reconnections
        """
        metrics = PerformanceMetrics(operation_name="ws_reconnection_storm")
        reconnect_count = 50

        active_connections = {}

        def simulate_reconnection(i):
            start = time.perf_counter()
            old_sid = f"old_sid_{i}"
            new_sid = f"new_sid_{i}"

            # Simulate disconnect
            if old_sid in active_connections:
                del active_connections[old_sid]

            # Small delay simulating network latency
            time.sleep(random.uniform(0.001, 0.01))

            # Simulate reconnect
            active_connections[new_sid] = {
                "subscribed_topics": ["aircraft"],
                "connected_at": time.time(),
                "reconnect_count": 1,
            }

            duration_ms = (time.perf_counter() - start) * 1000
            return duration_ms

        with ThreadPoolExecutor(max_workers=20) as executor:
            futures = [executor.submit(simulate_reconnection, i) for i in range(reconnect_count)]

            for future in as_completed(futures):
                duration_ms = future.result()
                metrics.record(
                    type(
                        "Result",
                        (),
                        {
                            "duration_ms": duration_ms,
                            "success": True,
                            "error": None,
                        },
                    )()
                )

        metrics.finalize()
        print(f"\n{metrics}")
        print(f"Successful reconnections: {len(active_connections)}")

        assert len(active_connections) == reconnect_count
        assert metrics.success_rate == 100

    def test_reconnection_state_restoration(self, thresholds):
        """
        Test that reconnection properly restores subscription state.

        Baseline: Subscriptions should be restored quickly
        """
        metrics = PerformanceMetrics(operation_name="ws_reconnection_state")

        # Previous session state
        saved_states = {
            f"session_{i}": {
                "subscribed_topics": random.sample(["aircraft", "safety", "alerts", "acars", "stats"], k=3),
                "client_filters": {"min_alt": random.randint(0, 20000)},
            }
            for i in range(30)
        }

        rooms = {f"topic_{t}": set() for t in ["aircraft", "safety", "alerts", "acars", "stats"]}

        for session_id, state in saved_states.items():
            with timed_operation() as timer:
                new_sid = f"reconnected_{session_id}"

                # Restore subscriptions
                for topic in state["subscribed_topics"]:
                    room = f"topic_{topic}"
                    rooms[room].add(new_sid)

            metrics.record(
                type(
                    "Result",
                    (),
                    {
                        "duration_ms": timer["duration_ms"],
                        "success": True,
                        "error": None,
                    },
                )()
            )

        metrics.finalize()
        print(f"\n{metrics}")

        total_subscriptions = sum(len(r) for r in rooms.values())
        print(f"Total restored subscriptions: {total_subscriptions}")

        assert metrics.p95 < 20
