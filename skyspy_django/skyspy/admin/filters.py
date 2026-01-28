"""
Custom admin filters for SkySpy.
"""
from django.contrib import admin
from django.utils import timezone
from datetime import timedelta


class DateRangeFilter(admin.SimpleListFilter):
    """Filter by date range: today, 7 days, 30 days, custom."""
    title = 'date range'
    parameter_name = 'date_range'

    # Override this in subclass to specify the date field
    date_field = 'created_at'

    def lookups(self, request, model_admin):
        return (
            ('today', 'Today'),
            ('7days', 'Last 7 days'),
            ('30days', 'Last 30 days'),
            ('90days', 'Last 90 days'),
        )

    def queryset(self, request, queryset):
        now = timezone.now()
        if self.value() == 'today':
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            return queryset.filter(**{f'{self.date_field}__gte': start})
        elif self.value() == '7days':
            start = now - timedelta(days=7)
            return queryset.filter(**{f'{self.date_field}__gte': start})
        elif self.value() == '30days':
            start = now - timedelta(days=30)
            return queryset.filter(**{f'{self.date_field}__gte': start})
        elif self.value() == '90days':
            start = now - timedelta(days=90)
            return queryset.filter(**{f'{self.date_field}__gte': start})
        return queryset


class TimestampDateRangeFilter(DateRangeFilter):
    """Date range filter using 'timestamp' field."""
    date_field = 'timestamp'


class TriggeredAtDateRangeFilter(DateRangeFilter):
    """Date range filter using 'triggered_at' field."""
    date_field = 'triggered_at'


class AchievedAtDateRangeFilter(DateRangeFilter):
    """Date range filter using 'achieved_at' field."""
    date_field = 'achieved_at'


class SightedAtDateRangeFilter(DateRangeFilter):
    """Date range filter using 'sighted_at' field."""
    date_field = 'sighted_at'


class ObservationTimeDateRangeFilter(DateRangeFilter):
    """Date range filter using 'observation_time' field."""
    date_field = 'observation_time'


class BooleanStatusFilter(admin.SimpleListFilter):
    """Filter by boolean status (enabled/disabled, acknowledged/unacknowledged)."""
    title = 'status'
    parameter_name = 'status'

    # Override these in subclass
    field_name = 'enabled'
    true_label = 'Enabled'
    false_label = 'Disabled'

    def lookups(self, request, model_admin):
        return (
            ('yes', self.true_label),
            ('no', self.false_label),
        )

    def queryset(self, request, queryset):
        if self.value() == 'yes':
            return queryset.filter(**{self.field_name: True})
        elif self.value() == 'no':
            return queryset.filter(**{self.field_name: False})
        return queryset


class EnabledFilter(BooleanStatusFilter):
    """Filter by enabled status."""
    title = 'enabled'
    parameter_name = 'enabled'
    field_name = 'enabled'
    true_label = 'Enabled'
    false_label = 'Disabled'


class AcknowledgedFilter(BooleanStatusFilter):
    """Filter by acknowledged status."""
    title = 'acknowledged'
    parameter_name = 'acknowledged'
    field_name = 'acknowledged'
    true_label = 'Acknowledged'
    false_label = 'Unacknowledged'


class ActiveFilter(BooleanStatusFilter):
    """Filter by is_active status."""
    title = 'active'
    parameter_name = 'is_active'
    field_name = 'is_active'
    true_label = 'Active'
    false_label = 'Inactive'


class MilitaryFilter(BooleanStatusFilter):
    """Filter by is_military status."""
    title = 'military'
    parameter_name = 'is_military'
    field_name = 'is_military'
    true_label = 'Military'
    false_label = 'Civilian'


class VerifiedFilter(BooleanStatusFilter):
    """Filter by verified status."""
    title = 'verified'
    parameter_name = 'verified'
    field_name = 'verified'
    true_label = 'Verified'
    false_label = 'Unverified'


class ArchivedFilter(BooleanStatusFilter):
    """Filter by is_archived status."""
    title = 'archived'
    parameter_name = 'is_archived'
    field_name = 'is_archived'
    true_label = 'Archived'
    false_label = 'Active'


class PriorityFilter(admin.SimpleListFilter):
    """Filter by priority level."""
    title = 'priority'
    parameter_name = 'priority'

    def lookups(self, request, model_admin):
        return (
            ('info', 'Info'),
            ('warning', 'Warning'),
            ('critical', 'Critical'),
        )

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(priority=self.value())
        return queryset


class SeverityFilter(admin.SimpleListFilter):
    """Filter by severity level (for safety events)."""
    title = 'severity'
    parameter_name = 'severity'

    def lookups(self, request, model_admin):
        return (
            ('info', 'Info'),
            ('warning', 'Warning'),
            ('critical', 'Critical'),
        )

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(severity=self.value())
        return queryset


class TranscriptionStatusFilter(admin.SimpleListFilter):
    """Filter by transcription status for audio."""
    title = 'transcription status'
    parameter_name = 'transcription_status'

    def lookups(self, request, model_admin):
        return (
            ('pending', 'Pending'),
            ('queued', 'Queued'),
            ('processing', 'Processing'),
            ('completed', 'Completed'),
            ('failed', 'Failed'),
        )

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(transcription_status=self.value())
        return queryset


class NotificationStatusFilter(admin.SimpleListFilter):
    """Filter by notification status."""
    title = 'status'
    parameter_name = 'status'

    def lookups(self, request, model_admin):
        return (
            ('pending', 'Pending'),
            ('sent', 'Sent'),
            ('failed', 'Failed'),
            ('retrying', 'Retrying'),
        )

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(status=self.value())
        return queryset


class QualityGradeFilter(admin.SimpleListFilter):
    """Filter by quality grade."""
    title = 'quality grade'
    parameter_name = 'quality_grade'

    def lookups(self, request, model_admin):
        return (
            ('excellent', 'Excellent'),
            ('good', 'Good'),
            ('fair', 'Fair'),
            ('poor', 'Poor'),
        )

    def queryset(self, request, queryset):
        if self.value():
            return queryset.filter(quality_grade=self.value())
        return queryset
