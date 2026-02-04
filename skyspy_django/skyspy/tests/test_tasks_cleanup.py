"""
End-to-end tests for database cleanup Celery tasks.

Tests cover:
- cleanup_old_sightings: Aircraft sighting retention cleanup
- cleanup_old_sessions: Session retention cleanup
- cleanup_old_alert_history: Alert history retention cleanup
- cleanup_old_safety_events: Safety event retention cleanup
- cleanup_old_notification_logs: Notification log retention cleanup
- cleanup_old_antenna_snapshots: Antenna snapshot retention cleanup
- cleanup_old_acars_messages: ACARS message retention cleanup
- run_all_cleanup_tasks: Orchestration of all cleanup tasks
- vacuum_analyze_tables: PostgreSQL maintenance
"""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.models import (
    AcarsMessage,
    AircraftSession,
    AircraftSighting,
    AlertHistory,
    AntennaAnalyticsSnapshot,
    NotificationLog,
    SafetyEvent,
)
from skyspy.tasks.cleanup import (
    _get_retention_days,
    cleanup_old_acars_messages,
    cleanup_old_alert_history,
    cleanup_old_antenna_snapshots,
    cleanup_old_notification_logs,
    cleanup_old_safety_events,
    cleanup_old_sessions,
    cleanup_old_sightings,
    run_all_cleanup_tasks,
    vacuum_analyze_tables,
)

# Test settings for Celery eager execution
CELERY_TEST_SETTINGS = {
    "CELERY_TASK_ALWAYS_EAGER": True,
    "CELERY_TASK_EAGER_PROPAGATES": True,
}


class GetRetentionDaysTest(TestCase):
    """Tests for the _get_retention_days utility function."""

    def test_returns_default_when_not_set(self):
        """Test default value is returned when setting is not set."""
        result = _get_retention_days("NONEXISTENT_SETTING", 42)
        self.assertEqual(result, 42)

    @override_settings(TEST_RETENTION_DAYS=15)
    def test_returns_settings_value(self):
        """Test settings value is returned when set."""
        result = _get_retention_days("TEST_RETENTION_DAYS", 30)
        self.assertEqual(result, 15)

    @patch.dict("os.environ", {"ENV_RETENTION_DAYS": "20"})
    def test_returns_env_value(self):
        """Test environment variable is used as fallback."""
        result = _get_retention_days("ENV_RETENTION_DAYS", 30)
        self.assertEqual(result, 20)

    @patch.dict("os.environ", {"INVALID_RETENTION": "not-a-number"})
    def test_returns_default_on_invalid_env(self):
        """Test default is returned when env var is invalid."""
        result = _get_retention_days("INVALID_RETENTION", 30)
        self.assertEqual(result, 30)


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupOldSightingsTaskTest(TestCase):
    """Tests for the cleanup_old_sightings task."""

    def setUp(self):
        """Set up test fixtures."""
        # Delete test sightings only - avoid interfering with mock feeder
        AircraftSighting.objects.filter(icao_hex__startswith="CLEANUP").delete()

    @override_settings(SIGHTING_RETENTION_DAYS=30)
    def test_cleanup_deletes_old_sightings(self):
        """Test that old sightings are deleted."""
        now = timezone.now()

        # Create recent sighting
        recent = AircraftSighting.objects.create(
            icao_hex="CLEANUP01",
            latitude=47.5,
            longitude=-122.0,
        )

        # Create old sighting
        old = AircraftSighting.objects.create(
            icao_hex="CLEANUP02",
            latitude=47.6,
            longitude=-122.1,
        )
        AircraftSighting.objects.filter(pk=old.pk).update(timestamp=now - timedelta(days=35))

        result = cleanup_old_sightings()

        # Verify result
        self.assertIn("deleted", result)
        self.assertGreaterEqual(result["deleted"], 1)

        # Verify recent sighting exists
        self.assertTrue(AircraftSighting.objects.filter(pk=recent.pk).exists())

        # Verify old sighting was deleted
        self.assertFalse(AircraftSighting.objects.filter(pk=old.pk).exists())

    @override_settings(SIGHTING_RETENTION_DAYS=30)
    def test_cleanup_no_old_sightings(self):
        """Test cleanup when no old sightings exist."""
        # Create only recent sighting
        AircraftSighting.objects.create(
            icao_hex="CLEANUP03",
            latitude=47.5,
            longitude=-122.0,
        )

        result = cleanup_old_sightings()

        # Should return 0 deleted (no old data)
        self.assertIn("deleted", result)
        self.assertIn("retention_days", result)

    @override_settings(SIGHTING_RETENTION_DAYS=30)
    def test_cleanup_batch_deletion(self):
        """Test that batch deletion works for large datasets."""
        now = timezone.now()
        old_timestamp = now - timedelta(days=35)

        # Create many old sightings
        sightings = []
        for i in range(50):
            sightings.append(
                AircraftSighting(
                    icao_hex=f"BATCH{i:03d}",
                    latitude=47.5 + (i * 0.01),
                    longitude=-122.0 + (i * 0.01),
                )
            )
        created = AircraftSighting.objects.bulk_create(sightings)

        # Update timestamps to be old
        pks = [s.pk for s in created]
        AircraftSighting.objects.filter(pk__in=pks).update(timestamp=old_timestamp)

        result = cleanup_old_sightings()

        # Verify all were deleted
        self.assertEqual(result["deleted"], 50)
        self.assertEqual(AircraftSighting.objects.filter(icao_hex__startswith="BATCH").count(), 0)


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupOldSessionsTaskTest(TestCase):
    """Tests for the cleanup_old_sessions task."""

    def setUp(self):
        """Set up test fixtures."""
        AircraftSession.objects.filter(icao_hex__startswith="CLEANUP").delete()

    @override_settings(SESSION_RETENTION_DAYS=90)
    def test_cleanup_deletes_old_sessions(self):
        """Test that old sessions are deleted."""
        now = timezone.now()

        # Create recent session
        recent = AircraftSession.objects.create(
            icao_hex="CLEANUP01",
            callsign="TEST1",
        )

        # Create old session
        old = AircraftSession.objects.create(
            icao_hex="CLEANUP02",
            callsign="TEST2",
        )
        AircraftSession.objects.filter(pk=old.pk).update(last_seen=now - timedelta(days=100))

        result = cleanup_old_sessions()

        # Verify result
        self.assertIn("deleted", result)
        self.assertGreaterEqual(result["deleted"], 1)

        # Verify recent session exists
        self.assertTrue(AircraftSession.objects.filter(pk=recent.pk).exists())

        # Verify old session was deleted
        self.assertFalse(AircraftSession.objects.filter(pk=old.pk).exists())

    def test_cleanup_returns_retention_info(self):
        """Test that result includes retention information."""
        result = cleanup_old_sessions()

        self.assertIn("retention_days", result)
        self.assertIn("cutoff", result)


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupOldAlertHistoryTaskTest(TestCase):
    """Tests for the cleanup_old_alert_history task."""

    def setUp(self):
        """Set up test fixtures."""
        AlertHistory.objects.filter(icao_hex__startswith="CLEANUP").delete()

    @override_settings(ALERT_HISTORY_DAYS=30)
    def test_cleanup_deletes_old_alerts(self):
        """Test that old alert history is deleted."""
        now = timezone.now()

        # Create recent alert
        recent = AlertHistory.objects.create(
            icao_hex="CLEANUP01",
            callsign="TEST1",
        )

        # Create old alert
        old = AlertHistory.objects.create(
            icao_hex="CLEANUP02",
            callsign="TEST2",
        )
        AlertHistory.objects.filter(pk=old.pk).update(triggered_at=now - timedelta(days=35))

        cleanup_old_alert_history()

        # Verify old alert was deleted
        self.assertFalse(AlertHistory.objects.filter(pk=old.pk).exists())

        # Verify recent alert exists
        self.assertTrue(AlertHistory.objects.filter(pk=recent.pk).exists())


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupOldSafetyEventsTaskTest(TestCase):
    """Tests for the cleanup_old_safety_events task."""

    def setUp(self):
        """Set up test fixtures."""
        SafetyEvent.objects.filter(icao_hex__startswith="CLEANUP").delete()

    @override_settings(SAFETY_EVENT_RETENTION_DAYS=90)
    def test_cleanup_deletes_old_events(self):
        """Test that old safety events are deleted."""
        now = timezone.now()

        # Create recent event
        recent = SafetyEvent.objects.create(
            icao_hex="CLEANUP01",
            event_type="tcas_ra",
            severity="warning",
        )

        # Create old event
        old = SafetyEvent.objects.create(
            icao_hex="CLEANUP02",
            event_type="7700",
            severity="critical",
        )
        SafetyEvent.objects.filter(pk=old.pk).update(timestamp=now - timedelta(days=100))

        cleanup_old_safety_events()

        # Verify old event was deleted
        self.assertFalse(SafetyEvent.objects.filter(pk=old.pk).exists())

        # Verify recent event exists
        self.assertTrue(SafetyEvent.objects.filter(pk=recent.pk).exists())


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupOldNotificationLogsTaskTest(TestCase):
    """Tests for the cleanup_old_notification_logs task."""

    def setUp(self):
        """Set up test fixtures."""
        NotificationLog.objects.filter(icao_hex__startswith="CLEANUP").delete()

    @override_settings(ALERT_HISTORY_DAYS=30)
    def test_cleanup_deletes_old_logs(self):
        """Test that old notification logs are deleted."""
        now = timezone.now()

        # Create recent log
        recent = NotificationLog.objects.create(
            icao_hex="CLEANUP01",
            notification_type="alert",
            status="sent",
        )

        # Create old log
        old = NotificationLog.objects.create(
            icao_hex="CLEANUP02",
            notification_type="alert",
            status="sent",
        )
        NotificationLog.objects.filter(pk=old.pk).update(timestamp=now - timedelta(days=35))

        cleanup_old_notification_logs()

        # Verify old log was deleted
        self.assertFalse(NotificationLog.objects.filter(pk=old.pk).exists())

        # Verify recent log exists
        self.assertTrue(NotificationLog.objects.filter(pk=recent.pk).exists())


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupOldAntennaSnapshotsTaskTest(TestCase):
    """Tests for the cleanup_old_antenna_snapshots task."""

    def setUp(self):
        """Set up test fixtures."""
        AntennaAnalyticsSnapshot.objects.all().delete()

    @override_settings(ANTENNA_SNAPSHOT_RETENTION_DAYS=7)
    def test_cleanup_scheduled_snapshots(self):
        """Test that old scheduled snapshots are deleted."""
        now = timezone.now()

        # Create recent scheduled snapshot
        recent = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=3),
            snapshot_type="scheduled",
        )

        # Create old scheduled snapshot
        old = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=10),
            snapshot_type="scheduled",
        )

        result = cleanup_old_antenna_snapshots()

        # Verify scheduled cleanup
        self.assertIn("scheduled_deleted", result)
        self.assertGreaterEqual(result["scheduled_deleted"], 1)

        # Verify recent exists, old deleted
        self.assertTrue(AntennaAnalyticsSnapshot.objects.filter(pk=recent.pk).exists())
        self.assertFalse(AntennaAnalyticsSnapshot.objects.filter(pk=old.pk).exists())

    def test_cleanup_hourly_snapshots(self):
        """Test that old hourly snapshots are deleted (30 day retention)."""
        now = timezone.now()

        # Create recent hourly snapshot (within 30 days)
        recent = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=20),
            snapshot_type="hourly",
        )

        # Create old hourly snapshot (over 30 days)
        old = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=35),
            snapshot_type="hourly",
        )

        result = cleanup_old_antenna_snapshots()

        self.assertIn("hourly_deleted", result)
        self.assertTrue(AntennaAnalyticsSnapshot.objects.filter(pk=recent.pk).exists())
        self.assertFalse(AntennaAnalyticsSnapshot.objects.filter(pk=old.pk).exists())

    def test_cleanup_daily_snapshots(self):
        """Test that old daily snapshots are deleted (365 day retention)."""
        now = timezone.now()

        # Create recent daily snapshot (within 365 days)
        recent = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=300),
            snapshot_type="daily",
        )

        # Create old daily snapshot (over 365 days)
        old = AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=400),
            snapshot_type="daily",
        )

        result = cleanup_old_antenna_snapshots()

        self.assertIn("daily_deleted", result)
        self.assertTrue(AntennaAnalyticsSnapshot.objects.filter(pk=recent.pk).exists())
        self.assertFalse(AntennaAnalyticsSnapshot.objects.filter(pk=old.pk).exists())

    def test_cleanup_returns_total_deleted(self):
        """Test that total_deleted is calculated correctly."""
        now = timezone.now()

        # Create various old snapshots
        AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=10),
            snapshot_type="scheduled",
        )
        AntennaAnalyticsSnapshot.objects.create(
            timestamp=now - timedelta(days=35),
            snapshot_type="hourly",
        )

        result = cleanup_old_antenna_snapshots()

        self.assertIn("total_deleted", result)
        self.assertEqual(
            result["total_deleted"],
            result["scheduled_deleted"] + result["hourly_deleted"] + result["daily_deleted"],
        )


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupOldAcarsMessagesTaskTest(TestCase):
    """Tests for the cleanup_old_acars_messages task."""

    def setUp(self):
        """Set up test fixtures."""
        AcarsMessage.objects.filter(icao_hex__startswith="CLEANUP").delete()

    def test_cleanup_deletes_old_messages(self):
        """Test that old ACARS messages are deleted (7 day retention)."""
        now = timezone.now()

        # Create recent message
        recent = AcarsMessage.objects.create(
            icao_hex="CLEANUP01",
            source="acars",
            label="H1",
            text="Test message",
        )

        # Create old message
        old = AcarsMessage.objects.create(
            icao_hex="CLEANUP02",
            source="acars",
            label="H1",
            text="Old message",
        )
        AcarsMessage.objects.filter(pk=old.pk).update(timestamp=now - timedelta(days=10))

        result = cleanup_old_acars_messages()

        # Verify old message was deleted
        self.assertFalse(AcarsMessage.objects.filter(pk=old.pk).exists())

        # Verify recent message exists
        self.assertTrue(AcarsMessage.objects.filter(pk=recent.pk).exists())

        # Verify retention days is 7
        self.assertEqual(result["retention_days"], 7)


@override_settings(**CELERY_TEST_SETTINGS)
class RunAllCleanupTasksTest(TestCase):
    """Tests for the run_all_cleanup_tasks orchestration task."""

    def setUp(self):
        """Set up test fixtures."""
        # Clean up test data
        AircraftSighting.objects.filter(icao_hex__startswith="ALLT").delete()
        AircraftSession.objects.filter(icao_hex__startswith="ALLT").delete()

    def test_run_all_cleanup_returns_results(self):
        """Test that run_all_cleanup_tasks returns results for all tasks."""
        result = run_all_cleanup_tasks()

        # Verify all cleanup types are in results
        self.assertIn("sightings", result)
        self.assertIn("sessions", result)
        self.assertIn("alert_history", result)
        self.assertIn("safety_events", result)
        self.assertIn("notification_logs", result)
        self.assertIn("antenna_snapshots", result)
        self.assertIn("acars_messages", result)

        # Verify total is calculated
        self.assertIn("total_deleted", result)
        self.assertIn("timestamp", result)

    def test_run_all_cleanup_handles_individual_errors(self):
        """Test that errors in one task don't prevent others from running."""
        with patch("skyspy.tasks.cleanup.cleanup_old_sightings") as mock_sightings:
            mock_sightings.side_effect = Exception("Test error")

            result = run_all_cleanup_tasks()

            # Sightings should have error
            self.assertIn("error", result["sightings"])

            # Other tasks should still run
            self.assertIn("sessions", result)

    def test_run_all_cleanup_calculates_total(self):
        """Test that total_deleted is calculated correctly."""
        now = timezone.now()

        # Create old data in multiple tables
        sighting = AircraftSighting.objects.create(
            icao_hex="ALLTST01",
            latitude=47.5,
            longitude=-122.0,
        )
        AircraftSighting.objects.filter(pk=sighting.pk).update(timestamp=now - timedelta(days=100))

        session = AircraftSession.objects.create(
            icao_hex="ALLTST02",
        )
        AircraftSession.objects.filter(pk=session.pk).update(last_seen=now - timedelta(days=200))

        result = run_all_cleanup_tasks()

        # Total should include deletions from both tables
        self.assertGreaterEqual(result["total_deleted"], 2)


@override_settings(**CELERY_TEST_SETTINGS)
class VacuumAnalyzeTablesTaskTest(TestCase):
    """Tests for the vacuum_analyze_tables task."""

    @patch("skyspy.tasks.cleanup.connection")
    def test_vacuum_runs_on_expected_tables(self, mock_connection):
        """Test that VACUUM ANALYZE runs on expected tables."""
        mock_cursor = MagicMock()
        mock_connection.cursor.return_value.__enter__.return_value = mock_cursor

        result = vacuum_analyze_tables()

        # Verify expected tables were processed
        expected_tables = [
            "skyspy_aircraftsighting",
            "skyspy_aircraftsession",
            "skyspy_alerthistory",
            "skyspy_safetyevent",
            "skyspy_antennaanalyticssnapshot",
        ]

        for table in expected_tables:
            self.assertIn(table, result)

    @patch("skyspy.tasks.cleanup.connection")
    def test_vacuum_handles_errors(self, mock_connection):
        """Test that VACUUM handles errors gracefully."""
        mock_cursor = MagicMock()
        mock_cursor.execute.side_effect = Exception("VACUUM failed")
        mock_connection.cursor.return_value.__enter__.return_value = mock_cursor

        result = vacuum_analyze_tables()

        # All tables should have error results
        for _table, status in result.items():
            self.assertIn("error:", status)

    @patch("skyspy.tasks.cleanup.connection")
    def test_vacuum_returns_success_status(self, mock_connection):
        """Test that successful VACUUM returns success status."""
        mock_cursor = MagicMock()
        mock_connection.cursor.return_value.__enter__.return_value = mock_cursor

        result = vacuum_analyze_tables()

        # Check at least one table succeeded
        success_count = sum(1 for status in result.values() if status == "success")
        self.assertGreater(success_count, 0)


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupTaskSchedulingTest(TestCase):
    """Tests for cleanup task scheduling configuration."""

    def test_cleanup_old_sightings_is_shared_task(self):
        """Verify cleanup_old_sightings is a shared task."""
        self.assertTrue(hasattr(cleanup_old_sightings, "delay"))
        self.assertTrue(hasattr(cleanup_old_sightings, "apply_async"))

    def test_cleanup_old_sessions_is_shared_task(self):
        """Verify cleanup_old_sessions is a shared task."""
        self.assertTrue(hasattr(cleanup_old_sessions, "delay"))

    def test_cleanup_old_alert_history_is_shared_task(self):
        """Verify cleanup_old_alert_history is a shared task."""
        self.assertTrue(hasattr(cleanup_old_alert_history, "delay"))

    def test_cleanup_old_safety_events_is_shared_task(self):
        """Verify cleanup_old_safety_events is a shared task."""
        self.assertTrue(hasattr(cleanup_old_safety_events, "delay"))

    def test_run_all_cleanup_tasks_is_shared_task(self):
        """Verify run_all_cleanup_tasks is a shared task."""
        self.assertTrue(hasattr(run_all_cleanup_tasks, "delay"))

    def test_vacuum_analyze_tables_is_shared_task(self):
        """Verify vacuum_analyze_tables is a shared task."""
        self.assertTrue(hasattr(vacuum_analyze_tables, "delay"))


@override_settings(**CELERY_TEST_SETTINGS)
class CleanupErrorHandlingTest(TestCase):
    """Tests for cleanup task error handling."""

    @patch("skyspy.models.AircraftSighting.objects")
    def test_cleanup_sightings_returns_error_on_exception(self, mock_objects):
        """Test that cleanup returns error dict on exception."""
        mock_objects.filter.side_effect = Exception("Database error")

        result = cleanup_old_sightings()

        self.assertIn("error", result)
        self.assertIn("Database error", result["error"])

    @patch("skyspy.models.AircraftSession.objects")
    def test_cleanup_sessions_returns_error_on_exception(self, mock_objects):
        """Test that cleanup returns error dict on exception."""
        mock_objects.filter.side_effect = Exception("Database error")

        result = cleanup_old_sessions()

        self.assertIn("error", result)

    @patch("skyspy.models.SafetyEvent.objects")
    def test_cleanup_safety_events_returns_error_on_exception(self, mock_objects):
        """Test that cleanup returns error dict on exception."""
        mock_objects.filter.side_effect = Exception("Database error")

        result = cleanup_old_safety_events()

        self.assertIn("error", result)
