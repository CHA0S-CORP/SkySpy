"""
Time comparison statistics serializers.

Serializers for time-based comparison endpoints:
- Week-over-week comparison
- Seasonal trends
- Day/night ratios
- Weekend/weekday patterns
- Daily, weekly, monthly totals
"""
from rest_framework import serializers


# =============================================================================
# Week-over-Week Comparison
# =============================================================================

class WeekStatsSerializer(serializers.Serializer):
    """Statistics for a single week."""

    total_positions = serializers.IntegerField(help_text="Total position reports")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft seen")
    total_sessions = serializers.IntegerField(help_text="Total tracking sessions")
    military_aircraft = serializers.IntegerField(help_text="Unique military aircraft")
    military_positions = serializers.IntegerField(help_text="Military position reports")
    military_sessions = serializers.IntegerField(help_text="Military sessions")
    avg_altitude = serializers.IntegerField(allow_null=True, help_text="Average altitude (ft)")
    avg_distance_nm = serializers.FloatField(allow_null=True, help_text="Average distance (nm)")
    start = serializers.CharField(help_text="Week start timestamp")
    end = serializers.CharField(help_text="Week end timestamp")


class ChangeValueSerializer(serializers.Serializer):
    """Change value with absolute and percentage."""

    absolute = serializers.IntegerField(help_text="Absolute change")
    percentage = serializers.FloatField(help_text="Percentage change")


class WeekChangesSerializer(serializers.Serializer):
    """Changes between weeks."""

    total_positions = ChangeValueSerializer(help_text="Change in total positions")
    unique_aircraft = ChangeValueSerializer(help_text="Change in unique aircraft")
    total_sessions = ChangeValueSerializer(help_text="Change in sessions")
    military_aircraft = ChangeValueSerializer(help_text="Change in military aircraft")


class WeekComparisonSerializer(serializers.Serializer):
    """Week-over-week comparison response."""

    this_week = WeekStatsSerializer(help_text="Current week statistics")
    last_week = WeekStatsSerializer(help_text="Previous week statistics")
    changes = WeekChangesSerializer(help_text="Week-over-week changes")
    timestamp = serializers.CharField(help_text="Calculation timestamp")


# =============================================================================
# Seasonal Trends
# =============================================================================

class MonthlyDataEntrySerializer(serializers.Serializer):
    """Single month data entry."""

    year = serializers.IntegerField(help_text="Year")
    month = serializers.IntegerField(help_text="Month number (1-12)")
    month_name = serializers.CharField(help_text="Month name")
    total_positions = serializers.IntegerField(help_text="Total positions")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft")
    total_sessions = serializers.IntegerField(help_text="Total sessions")
    start = serializers.CharField(help_text="Month start timestamp")
    end = serializers.CharField(help_text="Month end timestamp")


class YearlyComparisonEntrySerializer(serializers.Serializer):
    """Year-over-year comparison entry for a month."""

    year = serializers.IntegerField(help_text="Year")
    total_positions = serializers.IntegerField(help_text="Total positions")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft")
    total_sessions = serializers.IntegerField(help_text="Total sessions")


class SeasonalTrendsSerializer(serializers.Serializer):
    """Seasonal trends response."""

    monthly_data = MonthlyDataEntrySerializer(many=True, help_text="Monthly data points")
    by_month_name = serializers.DictField(
        child=YearlyComparisonEntrySerializer(many=True),
        help_text="Data grouped by month name for year-over-year comparison"
    )
    months_included = serializers.IntegerField(help_text="Number of months included")
    timestamp = serializers.CharField(help_text="Calculation timestamp")


# =============================================================================
# Day/Night Ratio
# =============================================================================

class DayNightPeriodSerializer(serializers.Serializer):
    """Statistics for day or night period."""

    hours = serializers.CharField(help_text="Hour range description")
    start_hour = serializers.IntegerField(help_text="Period start hour")
    end_hour = serializers.IntegerField(help_text="Period end hour")
    total_positions = serializers.IntegerField(help_text="Total positions")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft")
    military_positions = serializers.IntegerField(help_text="Military positions")
    percentage = serializers.FloatField(help_text="Percentage of total traffic")


class DayNightRatioValueSerializer(serializers.Serializer):
    """Day-to-night ratio value."""

    day_to_night = serializers.FloatField(allow_null=True, help_text="Day-to-night ratio")
    description = serializers.CharField(help_text="Ratio description")


class HourlyBreakdownSerializer(serializers.Serializer):
    """Hourly breakdown entry."""

    hour = serializers.IntegerField(help_text="Hour of day (0-23)")
    period = serializers.CharField(help_text="Period (day/night)")
    position_count = serializers.IntegerField(help_text="Position count")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft")
    military_count = serializers.IntegerField(help_text="Military count")


class DayNightRatioSerializer(serializers.Serializer):
    """Day/night ratio response."""

    day = DayNightPeriodSerializer(help_text="Day period statistics")
    night = DayNightPeriodSerializer(help_text="Night period statistics")
    ratio = DayNightRatioValueSerializer(help_text="Day-to-night ratio")
    hourly_breakdown = HourlyBreakdownSerializer(many=True, help_text="Hourly breakdown")
    days_analyzed = serializers.IntegerField(help_text="Number of days analyzed")
    timestamp = serializers.CharField(help_text="Calculation timestamp")


# =============================================================================
# Weekend/Weekday Patterns
# =============================================================================

class WeekendWeekdayStatsSerializer(serializers.Serializer):
    """Statistics for weekend or weekday periods."""

    avg_positions = serializers.IntegerField(help_text="Average daily positions")
    avg_unique_aircraft = serializers.IntegerField(help_text="Average unique aircraft per day")
    avg_military = serializers.IntegerField(help_text="Average military positions per day")
    day_count = serializers.IntegerField(help_text="Number of days in sample")
    total_positions = serializers.IntegerField(help_text="Total positions")
    total_unique_aircraft = serializers.IntegerField(help_text="Total unique aircraft")


class WeekendWeekdayRatioSerializer(serializers.Serializer):
    """Weekend-to-weekday ratio."""

    weekend_to_weekday = serializers.FloatField(allow_null=True, help_text="Weekend-to-weekday ratio")
    description = serializers.CharField(help_text="Ratio description")


class DayOfWeekBreakdownSerializer(serializers.Serializer):
    """Per-day-of-week breakdown."""

    day_of_week = serializers.IntegerField(help_text="Day of week (1=Sunday, 7=Saturday)")
    day_name = serializers.CharField(help_text="Day name")
    is_weekend = serializers.BooleanField(help_text="Is this a weekend day")
    avg_positions = serializers.IntegerField(help_text="Average positions")
    avg_unique_aircraft = serializers.IntegerField(help_text="Average unique aircraft")
    avg_military = serializers.IntegerField(help_text="Average military")
    sample_count = serializers.IntegerField(help_text="Number of days in sample")


class WeekendWeekdaySerializer(serializers.Serializer):
    """Weekend/weekday patterns response."""

    weekend = WeekendWeekdayStatsSerializer(help_text="Weekend statistics")
    weekday = WeekendWeekdayStatsSerializer(help_text="Weekday statistics")
    ratio = WeekendWeekdayRatioSerializer(help_text="Weekend-to-weekday ratio")
    by_day_of_week = DayOfWeekBreakdownSerializer(many=True, help_text="Per-day breakdown")
    weeks_analyzed = serializers.IntegerField(help_text="Number of weeks analyzed")
    timestamp = serializers.CharField(help_text="Calculation timestamp")


# =============================================================================
# Daily Totals
# =============================================================================

class DailyTotalEntrySerializer(serializers.Serializer):
    """Single day total entry."""

    date = serializers.CharField(allow_null=True, help_text="Date (ISO format)")
    total_positions = serializers.IntegerField(help_text="Total positions")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft")
    total_sessions = serializers.IntegerField(help_text="Total sessions")
    military_positions = serializers.IntegerField(help_text="Military positions")
    military_sessions = serializers.IntegerField(help_text="Military sessions")
    avg_altitude = serializers.IntegerField(allow_null=True, help_text="Average altitude")
    avg_distance_nm = serializers.FloatField(allow_null=True, help_text="Average distance")
    max_distance_nm = serializers.FloatField(allow_null=True, help_text="Max distance")


class DailySummarySerializer(serializers.Serializer):
    """Summary of daily totals."""

    days_included = serializers.IntegerField(help_text="Number of days included")
    total_positions = serializers.IntegerField(help_text="Total positions across all days")
    avg_daily_positions = serializers.IntegerField(help_text="Average daily positions")
    peak_day = serializers.CharField(allow_null=True, help_text="Day with peak traffic")
    peak_positions = serializers.IntegerField(help_text="Peak day positions")
    lowest_day = serializers.CharField(allow_null=True, help_text="Day with lowest traffic")
    lowest_positions = serializers.IntegerField(help_text="Lowest day positions")


class DailyTotalsSerializer(serializers.Serializer):
    """Daily totals response."""

    daily_data = DailyTotalEntrySerializer(many=True, help_text="Daily data points")
    summary = DailySummarySerializer(help_text="Summary statistics")
    days_requested = serializers.IntegerField(help_text="Number of days requested")
    timestamp = serializers.CharField(help_text="Calculation timestamp")


# =============================================================================
# Weekly Totals
# =============================================================================

class WeeklyTotalEntrySerializer(serializers.Serializer):
    """Single week total entry."""

    week_start = serializers.CharField(allow_null=True, help_text="Week start date")
    week_end = serializers.CharField(allow_null=True, help_text="Week end date")
    total_positions = serializers.IntegerField(help_text="Total positions")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft")
    total_sessions = serializers.IntegerField(help_text="Total sessions")
    military_positions = serializers.IntegerField(help_text="Military positions")
    military_sessions = serializers.IntegerField(help_text="Military sessions")
    avg_altitude = serializers.IntegerField(allow_null=True, help_text="Average altitude")
    avg_distance_nm = serializers.FloatField(allow_null=True, help_text="Average distance")
    max_distance_nm = serializers.FloatField(allow_null=True, help_text="Max distance")


class WeeklySummarySerializer(serializers.Serializer):
    """Summary of weekly totals."""

    weeks_included = serializers.IntegerField(help_text="Number of weeks included")
    total_positions = serializers.IntegerField(help_text="Total positions across all weeks")
    avg_weekly_positions = serializers.IntegerField(help_text="Average weekly positions")
    peak_week = serializers.CharField(allow_null=True, help_text="Week with peak traffic")
    peak_positions = serializers.IntegerField(help_text="Peak week positions")
    lowest_week = serializers.CharField(allow_null=True, help_text="Week with lowest traffic")
    lowest_positions = serializers.IntegerField(help_text="Lowest week positions")


class WeeklyTotalsSerializer(serializers.Serializer):
    """Weekly totals response."""

    weekly_data = WeeklyTotalEntrySerializer(many=True, help_text="Weekly data points")
    summary = WeeklySummarySerializer(help_text="Summary statistics")
    weeks_requested = serializers.IntegerField(help_text="Number of weeks requested")
    timestamp = serializers.CharField(help_text="Calculation timestamp")


# =============================================================================
# Monthly Totals
# =============================================================================

class MonthlyTotalEntrySerializer(serializers.Serializer):
    """Single month total entry."""

    month = serializers.CharField(allow_null=True, help_text="Month (YYYY-MM format)")
    month_name = serializers.CharField(allow_null=True, help_text="Month name")
    month_start = serializers.CharField(allow_null=True, help_text="Month start date")
    month_end = serializers.CharField(allow_null=True, help_text="Month end date")
    total_positions = serializers.IntegerField(help_text="Total positions")
    unique_aircraft = serializers.IntegerField(help_text="Unique aircraft")
    total_sessions = serializers.IntegerField(help_text="Total sessions")
    military_positions = serializers.IntegerField(help_text="Military positions")
    military_sessions = serializers.IntegerField(help_text="Military sessions")
    avg_altitude = serializers.IntegerField(allow_null=True, help_text="Average altitude")
    avg_distance_nm = serializers.FloatField(allow_null=True, help_text="Average distance")
    max_distance_nm = serializers.FloatField(allow_null=True, help_text="Max distance")


class MonthlySummarySerializer(serializers.Serializer):
    """Summary of monthly totals."""

    months_included = serializers.IntegerField(help_text="Number of months included")
    total_positions = serializers.IntegerField(help_text="Total positions across all months")
    avg_monthly_positions = serializers.IntegerField(help_text="Average monthly positions")
    peak_month = serializers.CharField(allow_null=True, help_text="Month with peak traffic")
    peak_positions = serializers.IntegerField(help_text="Peak month positions")
    lowest_month = serializers.CharField(allow_null=True, help_text="Month with lowest traffic")
    lowest_positions = serializers.IntegerField(help_text="Lowest month positions")


class MonthlyTotalsSerializer(serializers.Serializer):
    """Monthly totals response."""

    monthly_data = MonthlyTotalEntrySerializer(many=True, help_text="Monthly data points")
    summary = MonthlySummarySerializer(help_text="Summary statistics")
    months_requested = serializers.IntegerField(help_text="Number of months requested")
    timestamp = serializers.CharField(help_text="Calculation timestamp")


# =============================================================================
# Combined Time Comparison Stats
# =============================================================================

class TimeComparisonStatsSerializer(serializers.Serializer):
    """Combined time comparison statistics response."""

    week_comparison = WeekComparisonSerializer(help_text="Week-over-week comparison")
    seasonal_trends = SeasonalTrendsSerializer(help_text="Seasonal trends")
    day_night = DayNightRatioSerializer(help_text="Day/night ratio")
    weekend_weekday = WeekendWeekdaySerializer(help_text="Weekend/weekday patterns")
    daily_totals = DailyTotalsSerializer(help_text="Daily totals (30 days)")
    weekly_totals = WeeklyTotalsSerializer(help_text="Weekly totals (12 weeks)")
    monthly_totals = MonthlyTotalsSerializer(help_text="Monthly totals (12 months)")
    timestamp = serializers.CharField(help_text="Calculation timestamp")
