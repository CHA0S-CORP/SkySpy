"""
Tests for the TimeComparisonStats service.

Tests time-based comparisons, trend analysis,
week-over-week comparison, and seasonal patterns.
"""

from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from skyspy.models import AircraftSession, AircraftSighting
from skyspy.services import time_comparison_stats as tcs


class HelperFunctionTests(TestCase):
    """Tests for helper date functions."""

    def test_get_week_dates_current_week(self):
        """Test getting current week dates."""
        start, end = tcs._get_week_dates(0)

        # Start should be Monday
        self.assertEqual(start.weekday(), 0)
        # End should be 7 days after start
        self.assertEqual((end - start).days, 7)

    def test_get_week_dates_last_week(self):
        """Test getting last week dates."""
        start, end = tcs._get_week_dates(1)
        this_start, _ = tcs._get_week_dates(0)

        # Last week start should be 7 days before this week start
        self.assertEqual((this_start - start).days, 7)

    def test_get_month_dates_current_month(self):
        """Test getting current month dates."""
        start, end = tcs._get_month_dates(0)

        # Start should be first of month
        self.assertEqual(start.day, 1)
        # End should be first of next month
        self.assertEqual(end.day, 1)

    def test_get_month_dates_last_month(self):
        """Test getting last month dates."""
        start, end = tcs._get_month_dates(1)
        this_start, _ = tcs._get_month_dates(0)

        # Last month end should be this month start
        self.assertEqual(end.month, this_start.month)

    def test_get_month_dates_year_boundary(self):
        """Test month calculation across year boundary."""
        # Go back 12 months
        start, end = tcs._get_month_dates(12)

        # Should be same month, previous year
        self.assertEqual(start.day, 1)


class WeekOverWeekComparisonTests(TestCase):
    """Tests for week-over-week comparison."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftSighting.objects.all().delete()

    def test_calculate_week_over_week_comparison_empty(self):
        """Test week comparison with no data."""
        result = tcs.calculate_week_over_week_comparison()

        self.assertIn("this_week", result)
        self.assertIn("last_week", result)
        self.assertIn("changes", result)
        self.assertEqual(result["this_week"]["total_positions"], 0)
        self.assertEqual(result["last_week"]["total_positions"], 0)

    def test_calculate_week_over_week_comparison_with_data(self):
        """Test week comparison with sighting data."""
        # Create sightings for this week
        # (auto_now_add ignores timestamp kwarg, so use update() after create)
        this_week_start, _ = tcs._get_week_dates(0)
        for i in range(10):
            s = AircraftSighting.objects.create(
                icao_hex=f"ABC{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )
            AircraftSighting.objects.filter(pk=s.pk).update(timestamp=this_week_start + timedelta(hours=i))

        # Create sightings for last week
        last_week_start, _ = tcs._get_week_dates(1)
        for i in range(5):
            s = AircraftSighting.objects.create(
                icao_hex=f"DEF{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )
            AircraftSighting.objects.filter(pk=s.pk).update(timestamp=last_week_start + timedelta(hours=i))

        result = tcs.calculate_week_over_week_comparison()

        self.assertGreater(result["this_week"]["total_positions"], 0)
        self.assertGreater(result["last_week"]["total_positions"], 0)

    def test_calculate_week_over_week_change_calculation(self):
        """Test change percentage calculation."""
        # Create sightings for this week (100)
        # (auto_now_add ignores timestamp kwarg, so use update() after create)
        this_week_start, _ = tcs._get_week_dates(0)
        for i in range(100):
            s = AircraftSighting.objects.create(
                icao_hex=f"ABC{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )
            AircraftSighting.objects.filter(pk=s.pk).update(timestamp=this_week_start + timedelta(minutes=i))

        # Create sightings for last week (50)
        last_week_start, _ = tcs._get_week_dates(1)
        for i in range(50):
            s = AircraftSighting.objects.create(
                icao_hex=f"DEF{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )
            AircraftSighting.objects.filter(pk=s.pk).update(timestamp=last_week_start + timedelta(minutes=i))

        result = tcs.calculate_week_over_week_comparison()

        # Should show positive change
        self.assertGreater(result["changes"]["total_positions"]["absolute"], 0)
        self.assertGreater(result["changes"]["total_positions"]["percentage"], 0)

    def test_calculate_week_over_week_military_tracking(self):
        """Test military aircraft tracking in week comparison."""
        this_week_start, _ = tcs._get_week_dates(0)

        # Create military session (first_seen/last_seen also have auto_now_add/auto_now)
        session = AircraftSession.objects.create(
            icao_hex="MIL001",
            is_military=True,
        )
        AircraftSession.objects.filter(pk=session.pk).update(
            first_seen=this_week_start + timedelta(hours=1),
            last_seen=this_week_start + timedelta(hours=2),
        )

        # Create military sighting (auto_now_add ignores timestamp kwarg)
        sighting = AircraftSighting.objects.create(
            icao_hex="MIL001",
            latitude=40.0,
            longitude=-74.0,
            is_military=True,
        )
        AircraftSighting.objects.filter(pk=sighting.pk).update(timestamp=this_week_start + timedelta(hours=1))

        result = tcs.calculate_week_over_week_comparison()

        self.assertGreaterEqual(result["this_week"]["military_aircraft"], 1)


class SeasonalTrendsTests(TestCase):
    """Tests for seasonal trends calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftSighting.objects.all().delete()

    def test_calculate_seasonal_trends_empty(self):
        """Test seasonal trends with no data."""
        result = tcs.calculate_seasonal_trends(months=12)

        self.assertIn("monthly_data", result)
        self.assertIn("by_month_name", result)
        self.assertEqual(result["months_included"], 12)

    def test_calculate_seasonal_trends_structure(self):
        """Test seasonal trends return structure."""
        result = tcs.calculate_seasonal_trends(months=6)

        self.assertIn("monthly_data", result)
        self.assertIn("by_month_name", result)
        self.assertIn("months_included", result)
        self.assertIn("timestamp", result)

    def test_calculate_seasonal_trends_with_data(self):
        """Test seasonal trends with sighting data."""
        # Create sightings for current month
        # (auto_now_add ignores timestamp kwarg, so use update() after create)
        current_month_start, _ = tcs._get_month_dates(0)
        for i in range(10):
            s = AircraftSighting.objects.create(
                icao_hex=f"ABC{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )
            AircraftSighting.objects.filter(pk=s.pk).update(timestamp=current_month_start + timedelta(hours=i))

        result = tcs.calculate_seasonal_trends(months=3)

        # Should have data for at least current month
        monthly_with_data = [m for m in result["monthly_data"] if m["total_positions"] > 0]
        self.assertGreater(len(monthly_with_data), 0)

    def test_calculate_seasonal_trends_by_month_name(self):
        """Test year-over-year grouping by month name."""
        result = tcs.calculate_seasonal_trends(months=12)

        # Should have month name grouping
        self.assertIn("by_month_name", result)
        self.assertIsInstance(result["by_month_name"], dict)


class DayNightRatioTests(TestCase):
    """Tests for day vs night ratio calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()

    def test_calculate_day_night_ratio_empty(self):
        """Test day/night ratio with no data."""
        result = tcs.calculate_day_night_ratio(days=30)

        self.assertIn("day", result)
        self.assertIn("night", result)
        self.assertIn("ratio", result)
        self.assertEqual(result["day"]["total_positions"], 0)
        self.assertEqual(result["night"]["total_positions"], 0)

    def test_calculate_day_night_ratio_structure(self):
        """Test day/night ratio return structure."""
        result = tcs.calculate_day_night_ratio(days=7)

        self.assertIn("day", result)
        self.assertIn("night", result)
        self.assertIn("ratio", result)
        self.assertIn("hourly_breakdown", result)
        self.assertIn("days_analyzed", result)
        self.assertEqual(result["days_analyzed"], 7)

    def test_calculate_day_night_ratio_with_day_data(self):
        """Test day/night ratio with daytime data."""
        # Create daytime sightings then set timestamp to hour 12
        # (auto_now_add ignores the timestamp kwarg on create)
        base_time = self.now.replace(hour=12, minute=0, second=0, microsecond=0)
        for i in range(10):
            AircraftSighting.objects.create(
                icao_hex=f"DAY{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )
        AircraftSighting.objects.filter(icao_hex__startswith="DAY").update(timestamp=base_time)

        result = tcs.calculate_day_night_ratio(days=30)

        self.assertGreater(result["day"]["total_positions"], 0)
        self.assertEqual(result["night"]["total_positions"], 0)

    def test_calculate_day_night_ratio_with_night_data(self):
        """Test day/night ratio with nighttime data."""
        # Create nighttime sightings then set timestamp to hour 22
        # (auto_now_add ignores the timestamp kwarg on create)
        base_time = self.now.replace(hour=22, minute=0, second=0, microsecond=0)
        for i in range(10):
            AircraftSighting.objects.create(
                icao_hex=f"NGT{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )
        AircraftSighting.objects.filter(icao_hex__startswith="NGT").update(timestamp=base_time)

        result = tcs.calculate_day_night_ratio(days=30)

        self.assertGreater(result["night"]["total_positions"], 0)
        self.assertEqual(result["day"]["total_positions"], 0)

    def test_calculate_day_night_ratio_calculation(self):
        """Test day/night ratio calculation."""
        # Create 20 daytime and 10 nighttime sightings
        # (auto_now_add ignores the timestamp kwarg on create)
        day_time = self.now.replace(hour=12, minute=0, second=0, microsecond=0)
        for i in range(20):
            AircraftSighting.objects.create(
                icao_hex=f"DAY{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )
        AircraftSighting.objects.filter(icao_hex__startswith="DAY").update(timestamp=day_time)

        night_time = self.now.replace(hour=22, minute=0, second=0, microsecond=0)
        for i in range(10):
            AircraftSighting.objects.create(
                icao_hex=f"NGT{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )
        AircraftSighting.objects.filter(icao_hex__startswith="NGT").update(timestamp=night_time)

        result = tcs.calculate_day_night_ratio(days=30)

        # Day to night ratio should be 2.0
        self.assertEqual(result["ratio"]["day_to_night"], 2.0)

    def test_calculate_day_night_ratio_hours_config(self):
        """Test day/night hour configuration."""
        result = tcs.calculate_day_night_ratio(days=7)

        # Default day hours: 6-18
        self.assertEqual(result["day"]["start_hour"], 6)
        self.assertEqual(result["day"]["end_hour"], 18)
        self.assertEqual(result["night"]["start_hour"], 18)
        self.assertEqual(result["night"]["end_hour"], 6)


class WeekendWeekdayPatternsTests(TestCase):
    """Tests for weekend vs weekday pattern calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSighting.objects.all().delete()

    def test_calculate_weekend_weekday_patterns_empty(self):
        """Test weekend/weekday patterns with no data."""
        result = tcs.calculate_weekend_weekday_patterns(weeks=4)

        self.assertIn("weekend", result)
        self.assertIn("weekday", result)
        self.assertIn("ratio", result)
        self.assertEqual(result["weekend"]["day_count"], 0)
        self.assertEqual(result["weekday"]["day_count"], 0)

    def test_calculate_weekend_weekday_patterns_structure(self):
        """Test weekend/weekday patterns return structure."""
        result = tcs.calculate_weekend_weekday_patterns(weeks=2)

        self.assertIn("weekend", result)
        self.assertIn("weekday", result)
        self.assertIn("ratio", result)
        self.assertIn("by_day_of_week", result)
        self.assertIn("weeks_analyzed", result)
        self.assertEqual(result["weeks_analyzed"], 2)

    def test_calculate_weekend_weekday_patterns_with_data(self):
        """Test weekend/weekday patterns with sighting data."""
        # Create sightings on different days
        # (auto_now_add ignores timestamp kwarg, so use update() after create)
        for days_back in range(7):
            day = self.now - timedelta(days=days_back)
            for i in range(10):
                s = AircraftSighting.objects.create(
                    icao_hex=f"A{days_back}{i:02d}",
                    latitude=40.0,
                    longitude=-74.0,
                )
                AircraftSighting.objects.filter(pk=s.pk).update(timestamp=day)

        result = tcs.calculate_weekend_weekday_patterns(weeks=1)

        # Should have data for both weekend and weekday
        total_days = result["weekend"]["day_count"] + result["weekday"]["day_count"]
        self.assertGreater(total_days, 0)

    def test_calculate_weekend_weekday_day_breakdown(self):
        """Test daily breakdown in weekend/weekday patterns."""
        # Create sightings (auto_now_add ignores timestamp kwarg)
        for days_back in range(7):
            day = self.now - timedelta(days=days_back)
            s = AircraftSighting.objects.create(
                icao_hex=f"A{days_back:02d}",
                latitude=40.0,
                longitude=-74.0,
            )
            AircraftSighting.objects.filter(pk=s.pk).update(timestamp=day)

        result = tcs.calculate_weekend_weekday_patterns(weeks=1)

        # Should have daily breakdown
        self.assertIn("by_day_of_week", result)


class DailyTotalsTests(TestCase):
    """Tests for daily totals calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftSighting.objects.all().delete()

    def test_calculate_daily_totals_empty(self):
        """Test daily totals with no data."""
        result = tcs.calculate_daily_totals(days=30)

        self.assertIn("daily_data", result)
        self.assertIn("summary", result)
        self.assertEqual(len(result["daily_data"]), 0)

    def test_calculate_daily_totals_structure(self):
        """Test daily totals return structure."""
        # Create some data (auto_now_add ignores timestamp kwarg)
        for i in range(5):
            s = AircraftSighting.objects.create(
                icao_hex=f"ABC{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )
            AircraftSighting.objects.filter(pk=s.pk).update(timestamp=self.now - timedelta(days=i))

        result = tcs.calculate_daily_totals(days=30)

        self.assertIn("daily_data", result)
        self.assertIn("summary", result)
        self.assertIn("days_requested", result)
        self.assertEqual(result["days_requested"], 30)

    def test_calculate_daily_totals_with_data(self):
        """Test daily totals with sighting data."""
        # Create sightings for past 5 days
        # (auto_now_add ignores timestamp kwarg, so use update() after create)
        for days_back in range(5):
            day = self.now - timedelta(days=days_back)
            for i in range(10):
                s = AircraftSighting.objects.create(
                    icao_hex=f"D{days_back}{i:02d}",
                    latitude=40.0,
                    longitude=-74.0,
                )
                AircraftSighting.objects.filter(pk=s.pk).update(timestamp=day)

        result = tcs.calculate_daily_totals(days=7)

        # Should have daily data
        self.assertGreater(len(result["daily_data"]), 0)
        # Summary should have peak day
        self.assertIn("peak_day", result["summary"])

    def test_calculate_daily_totals_summary_stats(self):
        """Test daily totals summary statistics."""
        # Create uneven data (auto_now_add ignores timestamp kwarg)
        for days_back in range(5):
            day = self.now - timedelta(days=days_back)
            count = 10 * (days_back + 1)  # More sightings further back
            for i in range(count):
                s = AircraftSighting.objects.create(
                    icao_hex=f"D{days_back}{i:03d}",
                    latitude=40.0,
                    longitude=-74.0,
                )
                AircraftSighting.objects.filter(pk=s.pk).update(timestamp=day)

        result = tcs.calculate_daily_totals(days=7)

        # Should have summary stats
        self.assertIn("peak_positions", result["summary"])
        self.assertIn("lowest_positions", result["summary"])
        self.assertIn("avg_daily_positions", result["summary"])


class WeeklyTotalsTests(TestCase):
    """Tests for weekly totals calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftSighting.objects.all().delete()

    def test_calculate_weekly_totals_empty(self):
        """Test weekly totals with no data."""
        result = tcs.calculate_weekly_totals(weeks=12)

        self.assertIn("weekly_data", result)
        self.assertIn("summary", result)
        self.assertEqual(len(result["weekly_data"]), 0)

    def test_calculate_weekly_totals_structure(self):
        """Test weekly totals return structure."""
        result = tcs.calculate_weekly_totals(weeks=4)

        self.assertIn("weekly_data", result)
        self.assertIn("summary", result)
        self.assertIn("weeks_requested", result)
        self.assertEqual(result["weeks_requested"], 4)

    def test_calculate_weekly_totals_with_data(self):
        """Test weekly totals with sighting data."""
        # Create sightings for past few weeks
        # (auto_now_add ignores timestamp kwarg, so use update() after create)
        for weeks_back in range(3):
            day = self.now - timedelta(weeks=weeks_back)
            for i in range(10):
                s = AircraftSighting.objects.create(
                    icao_hex=f"W{weeks_back}{i:02d}",
                    latitude=40.0,
                    longitude=-74.0,
                )
                AircraftSighting.objects.filter(pk=s.pk).update(timestamp=day)

        result = tcs.calculate_weekly_totals(weeks=4)

        # Should have weekly data
        self.assertGreater(len(result["weekly_data"]), 0)


class MonthlyTotalsTests(TestCase):
    """Tests for monthly totals calculation."""

    def setUp(self):
        """Set up test fixtures."""
        self.now = timezone.now()

    def tearDown(self):
        """Clean up after tests."""
        AircraftSession.objects.all().delete()
        AircraftSighting.objects.all().delete()

    def test_calculate_monthly_totals_empty(self):
        """Test monthly totals with no data."""
        result = tcs.calculate_monthly_totals(months=12)

        self.assertIn("monthly_data", result)
        self.assertIn("summary", result)
        self.assertEqual(len(result["monthly_data"]), 0)

    def test_calculate_monthly_totals_structure(self):
        """Test monthly totals return structure."""
        result = tcs.calculate_monthly_totals(months=6)

        self.assertIn("monthly_data", result)
        self.assertIn("summary", result)
        self.assertIn("months_requested", result)
        self.assertEqual(result["months_requested"], 6)

    def test_calculate_monthly_totals_with_data(self):
        """Test monthly totals with sighting data."""
        # Create sightings for current month (auto_now_add sets timestamp to now)
        for i in range(10):
            AircraftSighting.objects.create(
                icao_hex=f"MON{i:03d}",
                latitude=40.0,
                longitude=-74.0,
            )

        result = tcs.calculate_monthly_totals(months=3)

        # Should have monthly data
        monthly_with_data = [m for m in result["monthly_data"] if m["total_positions"] > 0]
        self.assertGreater(len(monthly_with_data), 0)


class CacheManagementTests(TestCase):
    """Tests for cache management functions."""

    @patch("skyspy.services.time_comparison_stats.cache")
    @patch("skyspy.services.time_comparison_stats.broadcast_time_comparison_update")
    def test_refresh_time_comparison_cache(self, mock_broadcast, mock_cache):
        """Test refreshing time comparison cache."""
        result = tcs.refresh_time_comparison_cache(broadcast=True)

        mock_cache.set.assert_called()
        mock_broadcast.assert_called()
        self.assertIn("week_comparison", result)
        self.assertIn("seasonal_trends", result)

    @patch("skyspy.services.time_comparison_stats.cache")
    @patch("skyspy.services.time_comparison_stats.broadcast_time_comparison_update")
    def test_refresh_time_comparison_cache_no_broadcast(self, mock_broadcast, mock_cache):
        """Test refreshing cache without broadcast."""
        tcs.refresh_time_comparison_cache(broadcast=False)

        mock_cache.set.assert_called()
        mock_broadcast.assert_not_called()

    @patch("skyspy.services.time_comparison_stats.cache")
    def test_get_week_comparison_from_cache(self, mock_cache):
        """Test getting week comparison from cache."""
        mock_cache.get.return_value = {"cached": True}

        result = tcs.get_week_comparison()

        self.assertEqual(result, {"cached": True})

    @patch("skyspy.services.time_comparison_stats.cache")
    def test_get_week_comparison_cache_miss(self, mock_cache):
        """Test getting week comparison when cache is empty."""
        mock_cache.get.return_value = None

        result = tcs.get_week_comparison()

        # Should calculate and return data
        self.assertIn("this_week", result)
        self.assertIn("last_week", result)

    @patch("skyspy.services.time_comparison_stats.cache")
    def test_get_seasonal_trends_from_cache(self, mock_cache):
        """Test getting seasonal trends from cache."""
        mock_cache.get.return_value = {"monthly_data": []}

        result = tcs.get_seasonal_trends()

        self.assertEqual(result, {"monthly_data": []})

    @patch("skyspy.services.time_comparison_stats.cache")
    def test_get_day_night_ratio_from_cache(self, mock_cache):
        """Test getting day/night ratio from cache."""
        mock_cache.get.return_value = {"ratio": 1.5}

        result = tcs.get_day_night_ratio()

        self.assertEqual(result, {"ratio": 1.5})

    @patch("skyspy.services.time_comparison_stats.cache")
    def test_get_weekend_weekday_patterns_from_cache(self, mock_cache):
        """Test getting weekend/weekday patterns from cache."""
        mock_cache.get.return_value = {"weekend": {}, "weekday": {}}

        result = tcs.get_weekend_weekday_patterns()

        self.assertIn("weekend", result)


class PublicAPITests(TestCase):
    """Tests for public API functions."""

    @patch("skyspy.services.time_comparison_stats.cache")
    def test_get_daily_totals_custom_days(self, mock_cache):
        """Test getting daily totals with custom days parameter."""
        mock_cache.get.return_value = None

        # Non-default value should bypass cache
        result = tcs.get_daily_totals(days=7)

        self.assertIn("daily_data", result)
        self.assertEqual(result["days_requested"], 7)

    @patch("skyspy.services.time_comparison_stats.cache")
    def test_get_weekly_totals_custom_weeks(self, mock_cache):
        """Test getting weekly totals with custom weeks parameter."""
        mock_cache.get.return_value = None

        # Non-default value should bypass cache
        result = tcs.get_weekly_totals(weeks=4)

        self.assertIn("weekly_data", result)
        self.assertEqual(result["weeks_requested"], 4)

    @patch("skyspy.services.time_comparison_stats.cache")
    def test_get_monthly_totals_custom_months(self, mock_cache):
        """Test getting monthly totals with custom months parameter."""
        mock_cache.get.return_value = None

        # Non-default value should bypass cache
        result = tcs.get_monthly_totals(months=6)

        self.assertIn("monthly_data", result)
        self.assertEqual(result["months_requested"], 6)

    @patch("skyspy.services.time_comparison_stats.cache")
    def test_get_all_time_comparison_stats(self, mock_cache):
        """Test getting all time comparison stats."""
        mock_cache.get.return_value = {
            "week_comparison": {},
            "seasonal_trends": {},
            "day_night": {},
            "weekend_weekday": {},
            "daily_totals": {},
            "weekly_totals": {},
            "monthly_totals": {},
        }

        result = tcs.get_all_time_comparison_stats()

        self.assertIn("week_comparison", result)
        self.assertIn("seasonal_trends", result)


class EdgeCaseTests(TestCase):
    """Edge case tests for time comparison stats."""

    def test_week_comparison_zero_division(self):
        """Test week comparison handles zero last week data."""
        # No data for last week, some data for this week
        # (auto_now_add ignores timestamp kwarg, so use update() after create)
        this_week_start, _ = tcs._get_week_dates(0)
        sighting = AircraftSighting.objects.create(
            icao_hex="ABC001",
            latitude=40.0,
            longitude=-74.0,
        )
        AircraftSighting.objects.filter(pk=sighting.pk).update(timestamp=this_week_start + timedelta(hours=1))

        result = tcs.calculate_week_over_week_comparison()

        # Should handle gracefully (100% change when previous is 0)
        self.assertEqual(result["changes"]["total_positions"]["percentage"], 100.0)

    def test_day_night_ratio_zero_division(self):
        """Test day/night ratio handles zero night data."""
        # Only daytime data (auto_now_add ignores timestamp kwarg)
        day_time = timezone.now().replace(hour=12, minute=0, second=0, microsecond=0)
        sighting = AircraftSighting.objects.create(
            icao_hex="DAY001",
            latitude=40.0,
            longitude=-74.0,
        )
        AircraftSighting.objects.filter(pk=sighting.pk).update(timestamp=day_time)

        result = tcs.calculate_day_night_ratio(days=30)

        # Ratio should be None when night is 0
        self.assertIsNone(result["ratio"]["day_to_night"])

    def test_weekend_weekday_ratio_zero_division(self):
        """Test weekend/weekday ratio handles zero weekday data."""
        result = tcs.calculate_weekend_weekday_patterns(weeks=1)

        # With no data, ratio should be None
        self.assertIsNone(result["ratio"]["weekend_to_weekday"])

    def test_refresh_cache_handles_exception(self):
        """Test that refresh_time_comparison_cache handles exceptions."""
        with patch("skyspy.services.time_comparison_stats.calculate_week_over_week_comparison") as mock_calc:
            mock_calc.side_effect = Exception("Database error")

            result = tcs.refresh_time_comparison_cache(broadcast=False)

            # Should return empty dict on error
            self.assertEqual(result, {})

    def test_broadcast_handles_exception(self):
        """Test that broadcast handles exceptions gracefully."""
        with patch("skyspy.socketio.utils.sync_emit") as mock_emit:
            mock_emit.side_effect = Exception("Socket error")

            # Should not raise
            tcs.broadcast_time_comparison_update({})


class TimestampTests(TestCase):
    """Tests for timestamp handling."""

    def test_week_comparison_includes_timestamp(self):
        """Test that week comparison includes ISO timestamp."""
        result = tcs.calculate_week_over_week_comparison()

        self.assertIn("timestamp", result)
        self.assertIn("Z", result["timestamp"])

    def test_seasonal_trends_includes_timestamp(self):
        """Test that seasonal trends includes ISO timestamp."""
        result = tcs.calculate_seasonal_trends(months=3)

        self.assertIn("timestamp", result)
        self.assertIn("Z", result["timestamp"])

    def test_day_night_ratio_includes_timestamp(self):
        """Test that day/night ratio includes ISO timestamp."""
        result = tcs.calculate_day_night_ratio(days=7)

        self.assertIn("timestamp", result)
        self.assertIn("Z", result["timestamp"])

    def test_daily_totals_includes_timestamp(self):
        """Test that daily totals includes ISO timestamp."""
        result = tcs.calculate_daily_totals(days=7)

        self.assertIn("timestamp", result)
        self.assertIn("Z", result["timestamp"])
