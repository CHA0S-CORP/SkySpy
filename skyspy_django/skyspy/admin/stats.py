"""
Admin classes for gamification and stats models.
"""
from django.contrib import admin, messages
from django.utils import timezone

from skyspy.models import (
    PersonalRecord,
    RareSighting,
    SpottedCount,
    SpottedAircraft,
    SightingStreak,
    DailyStats,
    NotableRegistration,
    NotableCallsign,
    RareAircraftType,
)
from skyspy.admin.mixins import ExportCSVMixin
from skyspy.admin.filters import (
    DateRangeFilter,
    AchievedAtDateRangeFilter,
    SightedAtDateRangeFilter,
    ActiveFilter,
)
from skyspy.admin.actions import activate_selected, deactivate_selected


class DateDateRangeFilter(DateRangeFilter):
    """Date range filter using 'date' field."""
    title = 'date'
    parameter_name = 'date_range'
    date_field = 'date'


@admin.register(PersonalRecord)
class PersonalRecordAdmin(admin.ModelAdmin):
    """Admin for PersonalRecord model."""

    list_display = (
        'record_type',
        'icao_hex',
        'callsign',
        'value',
        'achieved_at',
        'improvement_display',
    )
    list_filter = ('record_type', AchievedAtDateRangeFilter)
    search_fields = ('icao_hex', 'callsign', 'registration')
    date_hierarchy = 'achieved_at'

    def get_readonly_fields(self, request, obj=None):
        """Make all fields readonly except for potential manual corrections."""
        if obj:
            return [f.name for f in self.model._meta.fields]
        return []

    @admin.display(description='Improvement')
    def improvement_display(self, obj):
        """Show improvement over previous value."""
        if obj.previous_value is not None:
            improvement = obj.value - obj.previous_value
            if improvement > 0:
                return f"+{improvement:.2f}"
            elif improvement < 0:
                return f"{improvement:.2f}"
            return "0"
        return "N/A (first record)"


@admin.register(RareSighting)
class RareSightingAdmin(admin.ModelAdmin):
    """Admin for RareSighting model."""

    list_display = (
        'rarity_type',
        'icao_hex',
        'callsign',
        'registration',
        'sighted_at',
        'rarity_score',
        'times_seen',
        'is_acknowledged',
    )
    list_filter = (
        'rarity_type',
        'rarity_score',
        'is_acknowledged',
        SightedAtDateRangeFilter,
    )
    search_fields = ('icao_hex', 'callsign', 'registration', 'description')
    date_hierarchy = 'sighted_at'

    actions = ['acknowledge_selected']

    @admin.action(description="Acknowledge selected sightings")
    def acknowledge_selected(self, request, queryset):
        """Mark selected sightings as acknowledged."""
        updated = queryset.filter(is_acknowledged=False).update(is_acknowledged=True)
        self.message_user(
            request,
            f"{updated} sighting(s) acknowledged.",
            messages.SUCCESS
        )


@admin.register(SpottedCount)
class SpottedCountAdmin(admin.ModelAdmin):
    """Admin for SpottedCount model."""

    list_display = (
        'count_type',
        'identifier',
        'display_name',
        'unique_aircraft',
        'total_sightings',
        'total_sessions',
        'last_seen',
    )
    list_filter = ('count_type',)
    search_fields = ('identifier', 'display_name')


@admin.register(SpottedAircraft)
class SpottedAircraftAdmin(admin.ModelAdmin):
    """Admin for SpottedAircraft model."""

    list_display = (
        'icao_hex',
        'registration',
        'aircraft_type',
        'operator',
        'times_seen',
        'first_seen',
        'last_seen',
        'is_military',
    )
    list_filter = ('is_military', 'aircraft_type', 'operator')
    search_fields = ('icao_hex', 'registration', 'operator')
    date_hierarchy = 'first_seen'


@admin.register(SightingStreak)
class SightingStreakAdmin(admin.ModelAdmin):
    """Admin for SightingStreak model."""

    list_display = (
        'streak_type',
        'current_streak_days',
        'last_qualifying_date',
        'best_streak_days',
    )
    list_filter = ('streak_type',)

    def get_readonly_fields(self, request, obj=None):
        """Make all fields readonly."""
        return [f.name for f in self.model._meta.fields]


@admin.register(DailyStats)
class DailyStatsAdmin(ExportCSVMixin, admin.ModelAdmin):
    """Admin for DailyStats model."""

    list_display = (
        'date',
        'unique_aircraft',
        'new_aircraft',
        'total_sessions',
        'military_count',
        'max_distance_nm',
    )
    list_filter = (DateDateRangeFilter,)
    date_hierarchy = 'date'

    actions = ['export_as_csv']

    def get_readonly_fields(self, request, obj=None):
        """Make all fields readonly."""
        return [f.name for f in self.model._meta.fields]


@admin.register(NotableRegistration)
class NotableRegistrationAdmin(admin.ModelAdmin):
    """Admin for NotableRegistration model."""

    list_display = (
        'name',
        'pattern_type',
        'pattern',
        'category',
        'rarity_score',
        'is_active',
    )
    list_filter = (ActiveFilter, 'pattern_type', 'category')
    search_fields = ('name', 'pattern', 'description')

    actions = [activate_selected, deactivate_selected]


@admin.register(NotableCallsign)
class NotableCallsignAdmin(admin.ModelAdmin):
    """Admin for NotableCallsign model."""

    list_display = (
        'name',
        'pattern_type',
        'pattern',
        'category',
        'rarity_score',
        'is_active',
    )
    list_filter = (ActiveFilter, 'pattern_type', 'category')
    search_fields = ('name', 'pattern', 'description')

    actions = [activate_selected, deactivate_selected]


@admin.register(RareAircraftType)
class RareAircraftTypeAdmin(admin.ModelAdmin):
    """Admin for RareAircraftType model."""

    list_display = (
        'type_code',
        'type_name',
        'manufacturer',
        'category',
        'rarity_score',
        'total_produced',
        'is_active',
    )
    list_filter = (ActiveFilter, 'category', 'manufacturer')
    search_fields = ('type_code', 'type_name', 'manufacturer', 'description')

    actions = [activate_selected, deactivate_selected]
