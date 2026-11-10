from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from skyspy.services import time_comparison_stats as stats


class AnalyticsBudgetTests(SimpleTestCase):
    def test_cold_requests_never_query_database(self):
        with patch.object(stats.cache, "get", return_value=None):
            for getter in (
                stats.get_week_comparison,
                stats.get_seasonal_trends,
                stats.get_day_night_ratio,
                stats.get_weekend_weekday_patterns,
                stats.get_daily_totals,
                stats.get_weekly_totals,
                stats.get_monthly_totals,
                stats.get_all_time_comparison_stats,
            ):
                self.assertEqual(getter(), {})

    def test_busy_refresh_does_no_work(self):
        with (
            patch.object(stats, "connection") as connection,
            patch.object(stats, "calculate_week_over_week_comparison") as calculate,
        ):
            connection.vendor = "postgresql"
            cursor = connection.cursor.return_value.__enter__.return_value
            cursor.fetchone.return_value = (False,)
            self.assertEqual(stats.refresh_time_comparison_cache(), {})
            calculate.assert_not_called()

    def test_budget_restores_settings_and_unlocks_after_failure(self):
        with patch.object(stats, "connection") as connection:
            connection.vendor = "postgresql"
            cursor = connection.cursor.return_value.__enter__.return_value
            cursor.fetchone.side_effect = [(True,), ("0",)]
            with self.assertRaises(ValueError), stats._analytics_budget():
                raise ValueError("failed calculation")
            commands = [call.args[0] for call in cursor.execute.call_args_list]
            self.assertIn("SELECT set_config('statement_timeout', '30s', false)", commands)
            self.assertEqual(commands[-1], "SELECT pg_advisory_unlock(%s)")
            self.assertEqual(cursor.execute.call_args_list[-2].args[1], ["0"])

    def test_custom_request_queues_once_and_returns_immediately(self):
        with (
            patch.object(stats.cache, "get", return_value=None),
            patch.object(stats.cache, "add", side_effect=[True, False]),
            patch("skyspy.tasks.analytics.refresh_time_comparison_range.apply_async") as enqueue,
        ):
            self.assertEqual(stats.get_daily_totals(7), {})
            self.assertEqual(stats.get_daily_totals(7), {})
            enqueue.assert_called_once_with(args=["daily", 7], expires=300)
