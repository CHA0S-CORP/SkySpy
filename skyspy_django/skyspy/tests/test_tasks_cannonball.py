"""
End-to-end tests for Cannonball Mode Celery tasks.

Tests cover:
- analyze_aircraft_patterns: Law enforcement pattern detection
- cleanup_cannonball_sessions: Stale session cleanup
- cleanup_old_patterns: Pattern retention cleanup
- aggregate_cannonball_stats: Hourly statistics aggregation
- update_user_location: User GPS location updates
- set_active_cannonball_user: Active user management
- clear_active_cannonball_user: User session clearing
"""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.models import (
    CannonballAlert,
    CannonballKnownAircraft,
    CannonballPattern,
    CannonballSession,
    CannonballStats,
)
from skyspy.tasks.cannonball import (
    aggregate_cannonball_stats,
    analyze_aircraft_patterns,
    cleanup_cannonball_sessions,
    cleanup_old_patterns,
    clear_active_cannonball_user,
    set_active_cannonball_user,
    update_user_location,
)

# Test settings for Celery eager execution
CELERY_TEST_SETTINGS = {
    "CELERY_TASK_ALWAYS_EAGER": True,
    "CELERY_TASK_EAGER_PROPAGATES": True,
}


@override_settings(**CELERY_TEST_SETTINGS)
class AnalyzeAircraftPatternsTaskTest(TestCase):
    """Tests for the analyze_aircraft_patterns task."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        CannonballSession.objects.all().delete()
        CannonballPattern.objects.all().delete()
        CannonballAlert.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_analyze_patterns_no_aircraft(self):
        """Test task completes when no aircraft in cache."""
        # No aircraft data in cache
        analyze_aircraft_patterns()
        # Task should complete without error

    def test_analyze_patterns_no_user_location(self):
        """Test task skips analysis when no user location set."""
        # Set aircraft but no user location
        cache.set(
            "current_aircraft",
            [{"hex": "A12345", "lat": 47.5, "lon": -122.0}],
        )

        analyze_aircraft_patterns()

        # No sessions should be created since no user location
        self.assertEqual(CannonballSession.objects.count(), 0)

    @patch("skyspy.tasks.cannonball.sync_emit")
    @patch("skyspy.tasks.cannonball.get_cannonball_service")
    def test_analyze_patterns_with_threats(self, mock_get_service, mock_sync_emit):
        """Test pattern analysis with detected threats."""
        # Set up user location
        cache.set("cannonball_user_lat", 47.5)
        cache.set("cannonball_user_lon", -122.0)

        # Set up aircraft data
        cache.set(
            "current_aircraft",
            [
                {"hex": "A12345", "lat": 47.51, "lon": -122.01, "alt_baro": 5000},
                {"hex": "AE1234", "lat": 47.52, "lon": -122.02, "alt_baro": 3000},
            ],
        )

        # Mock threat detection
        mock_threat = MagicMock()
        mock_threat.hex = "A12345"
        mock_threat.to_dict.return_value = {
            "icao_hex": "A12345",
            "callsign": "N12345",
            "lat": 47.51,
            "lon": -122.01,
            "altitude": 5000,
            "threat_level": "warning",
            "urgency_score": 50,
            "identification_method": "pattern",
            "identification_reason": "Circling pattern detected",
            "distance_nm": 1.5,
            "bearing": 45,
            "patterns": [],
        }

        mock_service = MagicMock()
        mock_service.analyze_aircraft.return_value = [mock_threat]
        mock_get_service.return_value = mock_service

        analyze_aircraft_patterns()

        # Verify threats were cached
        threats = cache.get("cannonball_threats")
        self.assertIsNotNone(threats)
        self.assertEqual(len(threats), 1)

        # Verify session was created
        self.assertEqual(CannonballSession.objects.count(), 1)
        session = CannonballSession.objects.first()
        self.assertEqual(session.icao_hex, "A12345")
        self.assertEqual(session.threat_level, "warning")

    @patch("skyspy.tasks.cannonball.sync_emit")
    @patch("skyspy.tasks.cannonball.get_cannonball_service")
    def test_analyze_patterns_known_aircraft(self, mock_get_service, mock_sync_emit):
        """Test detection of known LE aircraft."""
        # Create known aircraft entry
        CannonballKnownAircraft.objects.create(
            icao_hex="A12345",
            agency_name="State Police",
            agency_type="state",
            verified=True,
        )

        # Set up user location
        cache.set("cannonball_user_lat", 47.5)
        cache.set("cannonball_user_lon", -122.0)

        # Set up aircraft data
        cache.set(
            "current_aircraft",
            [{"hex": "A12345", "lat": 47.51, "lon": -122.01}],
        )

        # Mock threat detection
        mock_threat = MagicMock()
        mock_threat.hex = "A12345"
        mock_threat.to_dict.return_value = {
            "icao_hex": "A12345",
            "threat_level": "info",
            "urgency_score": 30,
            "identification_method": "database",
            "patterns": [],
        }

        mock_service = MagicMock()
        mock_service.analyze_aircraft.return_value = [mock_threat]
        mock_get_service.return_value = mock_service

        analyze_aircraft_patterns()

        # Verify known aircraft detection count was updated
        known = CannonballKnownAircraft.objects.get(icao_hex="A12345")
        self.assertEqual(known.times_detected, 1)
        self.assertIsNotNone(known.last_detected)

    @patch("skyspy.tasks.cannonball.sync_emit")
    @patch("skyspy.tasks.cannonball.get_cannonball_service")
    def test_analyze_patterns_creates_critical_alert(self, mock_get_service, mock_sync_emit):
        """Test that critical threats generate alerts."""
        # Set up user location
        cache.set("cannonball_user_lat", 47.5)
        cache.set("cannonball_user_lon", -122.0)

        cache.set(
            "current_aircraft",
            [{"hex": "A12345", "lat": 47.5, "lon": -122.0}],
        )

        mock_threat = MagicMock()
        mock_threat.hex = "A12345"
        mock_threat.to_dict.return_value = {
            "icao_hex": "A12345",
            "callsign": "N12345",
            "lat": 47.5,
            "lon": -122.0,
            "altitude": 3000,
            "threat_level": "critical",
            "urgency_score": 90,
            "distance_nm": 0.5,
            "bearing": 0,
            "patterns": [],
        }

        mock_service = MagicMock()
        mock_service.analyze_aircraft.return_value = [mock_threat]
        mock_get_service.return_value = mock_service

        analyze_aircraft_patterns()

        # Verify critical alert was created
        alerts = CannonballAlert.objects.filter(priority="critical")
        self.assertGreaterEqual(alerts.count(), 1)


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupCannonballSessionsTaskTest(TestCase):
    """Tests for the cleanup_cannonball_sessions task."""

    def setUp(self):
        """Set up test fixtures."""
        CannonballSession.objects.all().delete()

    @override_settings(CANNONBALL_SESSION_TIMEOUT_MINUTES=15)
    def test_cleanup_deactivates_stale_sessions(self):
        """Test that stale sessions are deactivated."""
        now = timezone.now()

        # Create fresh session
        fresh = CannonballSession.objects.create(
            icao_hex="FRESH01",
            is_active=True,
        )
        CannonballSession.objects.filter(pk=fresh.pk).update(last_seen=now - timedelta(minutes=5))

        # Create stale session
        stale = CannonballSession.objects.create(
            icao_hex="STALE01",
            is_active=True,
        )
        CannonballSession.objects.filter(pk=stale.pk).update(last_seen=now - timedelta(minutes=20))

        cleanup_cannonball_sessions()

        # Verify fresh session is still active
        fresh.refresh_from_db()
        self.assertTrue(fresh.is_active)

        # Verify stale session was deactivated
        stale.refresh_from_db()
        self.assertFalse(stale.is_active)

    def test_cleanup_no_stale_sessions(self):
        """Test cleanup with no stale sessions."""
        # Create only fresh session
        CannonballSession.objects.create(
            icao_hex="FRESH01",
            is_active=True,
        )

        # Task should complete without error
        cleanup_cannonball_sessions()

        self.assertEqual(CannonballSession.objects.filter(is_active=True).count(), 1)

    @override_settings(CANNONBALL_SESSION_TIMEOUT_MINUTES=15)
    def test_cleanup_ends_related_patterns(self):
        """Test that patterns are ended when session is deactivated."""
        now = timezone.now()

        # Create stale session with active pattern
        session = CannonballSession.objects.create(
            icao_hex="STALE01",
            is_active=True,
        )
        CannonballSession.objects.filter(pk=session.pk).update(last_seen=now - timedelta(minutes=20))

        # Create active pattern
        pattern = CannonballPattern.objects.create(
            icao_hex="STALE01",
            pattern_type="circling",
            center_lat=47.5,
            center_lon=-122.0,
            started_at=now - timedelta(minutes=30),
            session=session,
        )

        cleanup_cannonball_sessions()

        # Verify pattern was ended
        pattern.refresh_from_db()
        self.assertIsNotNone(pattern.ended_at)


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupOldPatternsTaskTest(TestCase):
    """Tests for the cleanup_old_patterns task."""

    def setUp(self):
        """Set up test fixtures."""
        CannonballPattern.objects.all().delete()

    @override_settings(CANNONBALL_PATTERN_RETENTION_DAYS=30)
    def test_cleanup_deletes_old_patterns(self):
        """Test that old patterns are deleted."""
        now = timezone.now()

        # Create recent pattern
        recent = CannonballPattern.objects.create(
            icao_hex="RECENT01",
            pattern_type="circling",
            center_lat=47.5,
            center_lon=-122.0,
            started_at=now - timedelta(days=5),
        )

        # Create old pattern
        old = CannonballPattern.objects.create(
            icao_hex="OLD01",
            pattern_type="loitering",
            center_lat=47.5,
            center_lon=-122.0,
            started_at=now - timedelta(days=40),
        )
        CannonballPattern.objects.filter(pk=old.pk).update(detected_at=now - timedelta(days=40))

        cleanup_old_patterns()

        # Verify recent pattern still exists
        self.assertTrue(CannonballPattern.objects.filter(pk=recent.pk).exists())

        # Verify old pattern was deleted
        self.assertFalse(CannonballPattern.objects.filter(pk=old.pk).exists())

    def test_cleanup_no_old_patterns(self):
        """Test cleanup with no old patterns."""
        # Create only recent pattern
        CannonballPattern.objects.create(
            icao_hex="RECENT01",
            pattern_type="circling",
            center_lat=47.5,
            center_lon=-122.0,
            started_at=timezone.now(),
        )

        # Task should complete without error
        cleanup_old_patterns()

        self.assertEqual(CannonballPattern.objects.count(), 1)


@override_settings(**CELERY_TEST_SETTINGS)
class AggregateCannonballStatsTaskTest(TestCase):
    """Tests for the aggregate_cannonball_stats task."""

    def setUp(self):
        """Set up test fixtures."""
        CannonballStats.objects.all().delete()
        CannonballSession.objects.all().delete()
        CannonballAlert.objects.all().delete()
        CannonballPattern.objects.all().delete()

    def test_aggregate_stats_creates_hourly_record(self):
        """Test that hourly stats record is created."""
        now = timezone.now()
        hour_start = now.replace(minute=0, second=0, microsecond=0)

        # Create session in current hour
        session = CannonballSession.objects.create(
            icao_hex="TEST01",
            is_active=True,
        )
        CannonballSession.objects.filter(pk=session.pk).update(
            first_seen=hour_start,
            last_seen=now,
        )

        aggregate_cannonball_stats()

        # Verify stats record was created
        stats = CannonballStats.objects.filter(
            period_type="hourly",
            period_start=hour_start,
            user__isnull=True,
        ).first()
        self.assertIsNotNone(stats)
        self.assertGreaterEqual(stats.total_detections, 1)

    def test_aggregate_stats_skips_duplicate(self):
        """Test that duplicate stats are not created."""
        now = timezone.now()
        hour_start = now.replace(minute=0, second=0, microsecond=0)

        # Create existing stats
        CannonballStats.objects.create(
            period_type="hourly",
            period_start=hour_start,
            period_end=hour_start + timedelta(hours=1),
            user=None,
        )

        # Run task again
        aggregate_cannonball_stats()

        # Should still have only one record
        count = CannonballStats.objects.filter(
            period_type="hourly",
            period_start=hour_start,
            user__isnull=True,
        ).count()
        self.assertEqual(count, 1)

    def test_aggregate_stats_counts_alerts(self):
        """Test that alerts are counted correctly."""
        now = timezone.now()
        hour_start = now.replace(minute=0, second=0, microsecond=0)

        # Create session
        session = CannonballSession.objects.create(
            icao_hex="TEST01",
            is_active=True,
        )
        CannonballSession.objects.filter(pk=session.pk).update(
            first_seen=hour_start,
            last_seen=now,
        )

        # Create alerts
        CannonballAlert.objects.create(
            session=session,
            alert_type="threat_escalated",
            priority="critical",
            title="Critical Alert",
            message="Test",
        )
        CannonballAlert.objects.create(
            session=session,
            alert_type="closing_fast",
            priority="warning",
            title="Warning Alert",
            message="Test",
        )

        aggregate_cannonball_stats()

        stats = CannonballStats.objects.filter(
            period_type="hourly",
            period_start=hour_start,
        ).first()
        self.assertIsNotNone(stats)
        self.assertEqual(stats.critical_alerts, 1)
        self.assertEqual(stats.warning_alerts, 1)


@override_settings(**CELERY_TEST_SETTINGS)
class UpdateUserLocationTaskTest(TestCase):
    """Tests for the update_user_location task."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        self.user = User.objects.create_user(username="testuser", password="testpass")

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_update_location_caches_user_location(self):
        """Test that user location is cached."""
        update_user_location(self.user.id, 47.5, -122.0)

        # Verify location was cached
        location = cache.get(f"cannonball_user_{self.user.id}_location")
        self.assertIsNotNone(location)
        self.assertEqual(location["lat"], 47.5)
        self.assertEqual(location["lon"], -122.0)

    def test_update_location_updates_global_when_active(self):
        """Test that global location is updated for active user."""
        # Set this user as active
        cache.set("cannonball_active_user", self.user.id)

        update_user_location(self.user.id, 47.5, -122.0)

        # Verify global location was updated
        self.assertEqual(cache.get("cannonball_user_lat"), 47.5)
        self.assertEqual(cache.get("cannonball_user_lon"), -122.0)

    def test_update_location_no_global_when_not_active(self):
        """Test that global location is not updated for non-active user."""
        # Different user is active
        cache.set("cannonball_active_user", 999)

        update_user_location(self.user.id, 47.5, -122.0)

        # Global location should not be updated
        self.assertIsNone(cache.get("cannonball_user_lat"))
        self.assertIsNone(cache.get("cannonball_user_lon"))


@override_settings(**CELERY_TEST_SETTINGS)
class SetActiveCannonballUserTaskTest(TestCase):
    """Tests for the set_active_cannonball_user task."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        self.user = User.objects.create_user(username="testuser", password="testpass")

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_set_active_user(self):
        """Test setting active Cannonball user."""
        set_active_cannonball_user(self.user.id)

        self.assertEqual(cache.get("cannonball_active_user"), self.user.id)


@override_settings(**CELERY_TEST_SETTINGS)
class ClearActiveCannonballUserTaskTest(TestCase):
    """Tests for the clear_active_cannonball_user task."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        self.user = User.objects.create_user(username="testuser", password="testpass")

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_clear_active_user(self):
        """Test clearing active Cannonball user."""
        # Set user as active with location
        cache.set("cannonball_active_user", self.user.id)
        cache.set("cannonball_user_lat", 47.5)
        cache.set("cannonball_user_lon", -122.0)

        clear_active_cannonball_user(self.user.id)

        # Verify all caches cleared
        self.assertIsNone(cache.get("cannonball_active_user"))
        self.assertIsNone(cache.get("cannonball_user_lat"))
        self.assertIsNone(cache.get("cannonball_user_lon"))

    def test_clear_only_matching_user(self):
        """Test that only matching user is cleared."""
        # Different user is active
        cache.set("cannonball_active_user", 999)
        cache.set("cannonball_user_lat", 47.5)
        cache.set("cannonball_user_lon", -122.0)

        clear_active_cannonball_user(self.user.id)

        # Should not clear since user doesn't match
        self.assertEqual(cache.get("cannonball_active_user"), 999)
        self.assertEqual(cache.get("cannonball_user_lat"), 47.5)


@override_settings(**CELERY_TEST_SETTINGS)
class CannonballTaskSchedulingTest(TestCase):
    """Tests for Cannonball task scheduling configuration."""

    def test_analyze_aircraft_patterns_is_shared_task(self):
        """Verify analyze_aircraft_patterns is a shared task."""
        self.assertTrue(hasattr(analyze_aircraft_patterns, "delay"))
        self.assertTrue(hasattr(analyze_aircraft_patterns, "apply_async"))

    def test_cleanup_cannonball_sessions_is_shared_task(self):
        """Verify cleanup_cannonball_sessions is a shared task."""
        self.assertTrue(hasattr(cleanup_cannonball_sessions, "delay"))
        self.assertTrue(hasattr(cleanup_cannonball_sessions, "apply_async"))

    def test_cleanup_old_patterns_is_shared_task(self):
        """Verify cleanup_old_patterns is a shared task."""
        self.assertTrue(hasattr(cleanup_old_patterns, "delay"))

    def test_aggregate_cannonball_stats_is_shared_task(self):
        """Verify aggregate_cannonball_stats is a shared task."""
        self.assertTrue(hasattr(aggregate_cannonball_stats, "delay"))


@override_settings(**CELERY_TEST_SETTINGS)
class CannonballPatternRecordingTest(TestCase):
    """Tests for pattern recording in Cannonball tasks."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        CannonballSession.objects.all().delete()
        CannonballPattern.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.tasks.cannonball.sync_emit")
    @patch("skyspy.tasks.cannonball.get_cannonball_service")
    def test_pattern_detection_creates_pattern_record(self, mock_get_service, mock_sync_emit):
        """Test that detected patterns are recorded."""
        cache.set("cannonball_user_lat", 47.5)
        cache.set("cannonball_user_lon", -122.0)
        cache.set("current_aircraft", [{"hex": "A12345", "lat": 47.51, "lon": -122.01}])

        mock_threat = MagicMock()
        mock_threat.hex = "A12345"
        mock_threat.to_dict.return_value = {
            "icao_hex": "A12345",
            "lat": 47.51,
            "lon": -122.01,
            "threat_level": "warning",
            "urgency_score": 50,
            "identification_method": "pattern",
            "patterns": [
                {
                    "type": "circling",
                    "confidence": 0.85,
                    "center_lat": 47.51,
                    "center_lon": -122.01,
                    "radius_nm": 2.0,
                    "data": {"orbit_count": 3},
                }
            ],
        }

        mock_service = MagicMock()
        mock_service.analyze_aircraft.return_value = [mock_threat]
        mock_get_service.return_value = mock_service

        analyze_aircraft_patterns()

        # Verify pattern was recorded
        patterns = CannonballPattern.objects.filter(
            icao_hex="A12345",
            pattern_type="circling",
        )
        self.assertEqual(patterns.count(), 1)
        pattern = patterns.first()
        self.assertEqual(pattern.confidence, "high")  # 0.85 >= 0.8
        self.assertAlmostEqual(pattern.confidence_score, 0.85, places=2)


@override_settings(**CELERY_TEST_SETTINGS)
class CannonballAlertCooldownTest(TestCase):
    """Tests for alert cooldown behavior."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        CannonballSession.objects.all().delete()
        CannonballAlert.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    @patch("skyspy.tasks.cannonball.sync_emit")
    @patch("skyspy.tasks.cannonball.get_cannonball_service")
    def test_alert_respects_cooldown(self, mock_get_service, mock_sync_emit):
        """Test that alerts respect cooldown period."""
        cache.set("cannonball_user_lat", 47.5)
        cache.set("cannonball_user_lon", -122.0)
        cache.set("current_aircraft", [{"hex": "A12345", "lat": 47.5, "lon": -122.0}])

        # Create existing session with recent alert
        session = CannonballSession.objects.create(
            icao_hex="A12345",
            is_active=True,
            threat_level="critical",
        )
        CannonballAlert.objects.create(
            session=session,
            alert_type="threat_escalated",
            priority="critical",
            title="Test",
            message="Test",
        )

        mock_threat = MagicMock()
        mock_threat.hex = "A12345"
        mock_threat.to_dict.return_value = {
            "icao_hex": "A12345",
            "lat": 47.5,
            "lon": -122.0,
            "threat_level": "critical",
            "urgency_score": 95,
            "identification_method": "pattern",
            "patterns": [],
        }

        mock_service = MagicMock()
        mock_service.analyze_aircraft.return_value = [mock_threat]
        mock_get_service.return_value = mock_service

        analyze_aircraft_patterns()

        # Should not create duplicate alert due to cooldown
        alert_count = CannonballAlert.objects.filter(
            session=session,
            alert_type="threat_escalated",
        ).count()
        self.assertEqual(alert_count, 1)  # Still just the original
