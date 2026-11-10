from datetime import timedelta
from unittest.mock import patch

from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from skyspy.models import AircraftSighting, TimeSummaryAircraft, TimeSummaryHour
from skyspy.services import time_comparison_stats as stats
from skyspy.services.time_summary import rebuild_hours


class TimeSummaryTests(TestCase):
    def setUp(self):
        self.now = timezone.now().replace(minute=0, second=0, microsecond=0)
        for hex_code, altitude, distance in [("ABC123", 1000, 10), ("ABC123", 3000, 30), ("DEF456", None, None)]:
            sighting = AircraftSighting.objects.create(
                icao_hex=hex_code, altitude_baro=altitude, distance_nm=distance, is_military=False
            )
            AircraftSighting.objects.filter(pk=sighting.pk).update(timestamp=self.now - timedelta(hours=2))

    def test_rollup_preserves_counts_distinct_and_weighted_averages(self):
        self.assertTrue(rebuild_hours())
        calculators = [
            stats.calculate_week_over_week_comparison,
            stats.calculate_seasonal_trends,
            stats.calculate_day_night_ratio,
            stats.calculate_weekend_weekday_patterns,
            stats.calculate_daily_totals,
            stats.calculate_weekly_totals,
            stats.calculate_monthly_totals,
        ]
        with patch.object(stats.timezone, "now", return_value=self.now):
            for calculate in calculators:
                expected = calculate()
                token = stats._use_summaries.set(True)
                try:
                    self.assertEqual(calculate(), expected, calculate.__name__)
                finally:
                    stats._use_summaries.reset(token)

    def test_rerun_does_not_double_count_and_late_insert_marks_hour(self):
        self.assertTrue(rebuild_hours())
        self.assertTrue(rebuild_hours())
        self.assertEqual(sum(TimeSummaryAircraft.objects.values_list("positions", flat=True)), 3)
        sighting = AircraftSighting.objects.create(icao_hex="ABC123")
        old_hour = self.now - timedelta(hours=2)
        AircraftSighting.objects.filter(pk=sighting.pk).update(timestamp=old_hour)
        self.assertTrue(TimeSummaryHour.objects.get(timestamp=old_hour).dirty)
        self.assertTrue(rebuild_hours())
        self.assertEqual(sum(TimeSummaryAircraft.objects.values_list("positions", flat=True)), 4)
        sighting.delete()
        self.assertTrue(rebuild_hours())
        self.assertEqual(sum(TimeSummaryAircraft.objects.values_list("positions", flat=True)), 3)

    def test_distinct_aircraft_and_averages_across_hours(self):
        sighting = AircraftSighting.objects.create(icao_hex="ABC123", altitude_baro=9000, distance_nm=90)
        AircraftSighting.objects.filter(pk=sighting.pk).update(timestamp=self.now - timedelta(hours=3))
        self.assertTrue(rebuild_hours())
        token = stats._use_summaries.set(True)
        try:
            data = stats.calculate_daily_totals()["daily_data"]
            self.assertEqual(sum(row["total_positions"] for row in data), 4)
            # All fixtures are within one UTC day unless near midnight; compare
            # the full range with the raw implementation for both cases.
        finally:
            stats._use_summaries.reset(token)
        with patch.object(stats.timezone, "now", return_value=self.now):
            expected = stats.calculate_daily_totals()
            token = stats._use_summaries.set(True)
            try:
                self.assertEqual(stats.calculate_daily_totals(), expected)
            finally:
                stats._use_summaries.reset(token)

    def test_backfill_is_bounded(self):
        self.assertFalse(rebuild_hours(max_hours=1))
        self.assertEqual(TimeSummaryHour.objects.filter(dirty=False).count(), 1)


class PostgreSQLBudgetTests(TransactionTestCase):
    def test_other_connection_cannot_acquire_lock_until_refresh_exits(self):
        other = connection.copy()
        try:
            with stats._analytics_budget() as acquired:
                self.assertTrue(acquired)
                with other.cursor() as cursor:
                    cursor.execute("SELECT pg_try_advisory_lock(%s)", [736592041])
                    self.assertFalse(cursor.fetchone()[0])
                with connection.cursor() as cursor:
                    cursor.execute("SHOW statement_timeout")
                    self.assertEqual(cursor.fetchone()[0], "30s")
            with other.cursor() as cursor:
                cursor.execute("SELECT pg_try_advisory_lock(%s)", [736592041])
                self.assertTrue(cursor.fetchone()[0])
                cursor.execute("SELECT pg_advisory_unlock(%s)", [736592041])
        finally:
            other.close()

    def test_postgresql_cancels_slow_statement_and_restores_timeout(self):
        from django.db import OperationalError

        with connection.cursor() as cursor:
            cursor.execute("SHOW statement_timeout")
            before = cursor.fetchone()[0]
        with self.assertRaises(OperationalError), stats._analytics_budget(statement_timeout="50ms"):
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_sleep(1)")
        with connection.cursor() as cursor:
            cursor.execute("SHOW statement_timeout")
            self.assertEqual(cursor.fetchone()[0], before)
