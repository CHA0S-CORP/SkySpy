"""
SkysPy Django Admin Configuration.

This package contains admin classes for all SkysPy models,
organized by domain area with a custom admin site.
"""
from django.contrib import admin

# Import all admin classes to register them with Django admin
from skyspy.admin.aircraft import (
    AircraftSightingAdmin, AircraftSessionAdmin, AircraftInfoAdmin
)
from skyspy.admin.alerts import (
    AlertRuleAdmin, AlertHistoryAdmin, AlertSubscriptionAdmin, AlertAggregateAdmin
)
from skyspy.admin.notifications import (
    NotificationConfigAdmin, NotificationChannelAdmin, NotificationTemplateAdmin,
    NotificationLogAdmin, UserNotificationPreferenceAdmin
)
from skyspy.admin.auth_admin import (
    SkyspyUserAdmin, RoleAdmin, UserRoleAdmin, APIKeyAdmin,
    FeatureAccessAdmin, OIDCClaimMappingAdmin
)
from skyspy.admin.engagement import AircraftFavoriteAdmin, SessionTrackingQualityAdmin
from skyspy.admin.safety import SafetyEventAdmin
from skyspy.admin.audio import AudioTransmissionAdmin
from skyspy.admin.acars import AcarsMessageAdmin
from skyspy.admin.antenna import AntennaAnalyticsSnapshotAdmin
from skyspy.admin.airspace import AirspaceAdvisoryAdmin, AirspaceBoundaryAdmin
from skyspy.admin.aviation import (
    CachedAirportAdmin, CachedNavaidAdmin, CachedGeoJSONAdmin, CachedPirepAdmin
)
from skyspy.admin.notams import (
    CachedNotamAdmin, CachedAirlineAdmin, CachedAircraftTypeAdmin
)
from skyspy.admin.stats import (
    PersonalRecordAdmin, RareSightingAdmin, SpottedCountAdmin,
    SpottedAircraftAdmin, SightingStreakAdmin, DailyStatsAdmin,
    NotableRegistrationAdmin, NotableCallsignAdmin, RareAircraftTypeAdmin,
)

# Import shared components
from skyspy.admin.mixins import ExportCSVMixin, ExportJSONMixin, ReadOnlyComputedMixin
from skyspy.admin.filters import (
    DateRangeFilter, TimestampDateRangeFilter, TriggeredAtDateRangeFilter,
    AchievedAtDateRangeFilter, SightedAtDateRangeFilter, ObservationTimeDateRangeFilter,
    BooleanStatusFilter, EnabledFilter, AcknowledgedFilter, ActiveFilter,
    MilitaryFilter, VerifiedFilter, ArchivedFilter, PriorityFilter, SeverityFilter,
    TranscriptionStatusFilter, NotificationStatusFilter, QualityGradeFilter,
)
from skyspy.admin.actions import (
    acknowledge_selected, enable_selected, disable_selected,
    activate_selected, deactivate_selected, archive_selected, unarchive_selected,
    mark_verified, revoke_api_keys, extend_expiration_30_days,
)


class SkyspyAdminSite(admin.AdminSite):
    """Custom admin site for SkySpy with enhanced branding and dashboard."""

    site_header = 'SkySpy Administration'
    site_title = 'SkySpy Admin'
    index_title = 'Dashboard'

    def index(self, request, extra_context=None):
        """Customize the admin index page with dashboard stats."""
        from django.utils import timezone
        from datetime import timedelta

        extra_context = extra_context or {}

        try:
            from skyspy.models import (
                AircraftSession, AlertHistory, SafetyEvent,
                NotificationLog, AudioTransmission
            )

            now = timezone.now()
            today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            last_24h = now - timedelta(hours=24)

            extra_context['dashboard_stats'] = {
                'active_sessions': AircraftSession.objects.filter(
                    last_seen__gte=now - timedelta(minutes=5)
                ).count(),
                'sessions_today': AircraftSession.objects.filter(
                    first_seen__gte=today_start
                ).count(),
                'alerts_24h': AlertHistory.objects.filter(
                    triggered_at__gte=last_24h
                ).count(),
                'unacknowledged_alerts': AlertHistory.objects.filter(
                    acknowledged=False
                ).count(),
                'safety_events_24h': SafetyEvent.objects.filter(
                    timestamp__gte=last_24h
                ).count(),
                'unacknowledged_safety': SafetyEvent.objects.filter(
                    acknowledged=False
                ).count(),
                'pending_transcriptions': AudioTransmission.objects.filter(
                    transcription_status__in=['pending', 'queued']
                ).count(),
                'failed_notifications': NotificationLog.objects.filter(
                    status='failed'
                ).count(),
            }
        except Exception:
            extra_context['dashboard_stats'] = None

        return super().index(request, extra_context=extra_context)


# Create the custom admin site instance
skyspy_admin_site = SkyspyAdminSite(name='skyspy_admin')


__all__ = [
    # Custom admin site
    'SkyspyAdminSite',
    'skyspy_admin_site',
    # Aircraft
    'AircraftSightingAdmin',
    'AircraftSessionAdmin',
    'AircraftInfoAdmin',
    # Alerts
    'AlertRuleAdmin',
    'AlertHistoryAdmin',
    'AlertSubscriptionAdmin',
    'AlertAggregateAdmin',
    # Notifications
    'NotificationConfigAdmin',
    'NotificationChannelAdmin',
    'NotificationTemplateAdmin',
    'NotificationLogAdmin',
    'UserNotificationPreferenceAdmin',
    # Auth/RBAC
    'SkyspyUserAdmin',
    'RoleAdmin',
    'UserRoleAdmin',
    'APIKeyAdmin',
    'FeatureAccessAdmin',
    'OIDCClaimMappingAdmin',
    # Engagement
    'AircraftFavoriteAdmin',
    'SessionTrackingQualityAdmin',
    # Safety
    'SafetyEventAdmin',
    # Audio
    'AudioTransmissionAdmin',
    # ACARS
    'AcarsMessageAdmin',
    # Antenna
    'AntennaAnalyticsSnapshotAdmin',
    # Airspace
    'AirspaceAdvisoryAdmin',
    'AirspaceBoundaryAdmin',
    # Aviation
    'CachedAirportAdmin',
    'CachedNavaidAdmin',
    'CachedGeoJSONAdmin',
    'CachedPirepAdmin',
    # NOTAMs
    'CachedNotamAdmin',
    'CachedAirlineAdmin',
    'CachedAircraftTypeAdmin',
    # Stats
    'PersonalRecordAdmin',
    'RareSightingAdmin',
    'SpottedCountAdmin',
    'SpottedAircraftAdmin',
    'SightingStreakAdmin',
    'DailyStatsAdmin',
    'NotableRegistrationAdmin',
    'NotableCallsignAdmin',
    'RareAircraftTypeAdmin',
    # Mixins
    'ExportCSVMixin',
    'ExportJSONMixin',
    'ReadOnlyComputedMixin',
    # Filters
    'DateRangeFilter',
    'TimestampDateRangeFilter',
    'TriggeredAtDateRangeFilter',
    'AchievedAtDateRangeFilter',
    'SightedAtDateRangeFilter',
    'ObservationTimeDateRangeFilter',
    'BooleanStatusFilter',
    'EnabledFilter',
    'AcknowledgedFilter',
    'ActiveFilter',
    'MilitaryFilter',
    'VerifiedFilter',
    'ArchivedFilter',
    'PriorityFilter',
    'SeverityFilter',
    'TranscriptionStatusFilter',
    'NotificationStatusFilter',
    'QualityGradeFilter',
    # Actions
    'acknowledge_selected',
    'enable_selected',
    'disable_selected',
    'activate_selected',
    'deactivate_selected',
    'archive_selected',
    'unarchive_selected',
    'mark_verified',
    'revoke_api_keys',
    'extend_expiration_30_days',
]
