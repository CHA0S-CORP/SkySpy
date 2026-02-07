"""
SkysPy Django ORM Models.

This package contains all database models for the SkysPy application,
organized by domain area.
"""

# Import all models for Django's model registry
from skyspy.models.acars import AcarsMessage
from skyspy.models.aircraft import AircraftInfo, AircraftSession, AircraftSighting, AirframeSourceData
from skyspy.models.airspace import AirspaceAdvisory, AirspaceBoundary
from skyspy.models.alerts import AlertAggregate, AlertHistory, AlertRule, AlertSubscription
from skyspy.models.antenna import AntennaAnalyticsSnapshot
from skyspy.models.audio import AudioTransmission
from skyspy.models.auth import (
    ALL_PERMISSIONS,
    DEFAULT_ROLES,
    FEATURE_PERMISSIONS,
    APIKey,
    FeatureAccess,
    OIDCClaimMapping,
    Role,
    SkyspyUser,
    UserRole,
)
from skyspy.models.aviation import CachedAirport, CachedGeoJSON, CachedNavaid, CachedPirep
from skyspy.models.cannonball import (
    CannonballAlert,
    CannonballKnownAircraft,
    CannonballPattern,
    CannonballSession,
    CannonballStats,
    CommunitySubmission,
    LEDataSource,
    PatternAnalytics,
    RegistrationAnalysis,
    RegistrationTransfer,
    SubmitterReputation,
)
from skyspy.models.config import ConfigAuditLog, SystemConfig
from skyspy.models.engagement import AircraftFavorite, SessionTrackingQuality
from skyspy.models.notams import CachedAircraftType, CachedAirline, CachedNotam
from skyspy.models.notifications import (
    NotificationChannel,
    NotificationConfig,
    NotificationLog,
    NotificationTemplate,
    UserNotificationPreference,
)
from skyspy.models.safety import SafetyEvent
from skyspy.models.stats import (
    DailyStats,
    NotableCallsign,
    NotableRegistration,
    PersonalRecord,
    RareAircraftType,
    RareSighting,
    SightingStreak,
    SpottedAircraft,
    SpottedCount,
)
from skyspy.models.watch_list import WatchedAircraft

__all__ = [
    # Aircraft
    "AircraftSighting",
    "AircraftSession",
    "AircraftInfo",
    "AirframeSourceData",
    # Alerts
    "AlertRule",
    "AlertHistory",
    "AlertSubscription",
    "AlertAggregate",
    # Notifications
    "NotificationConfig",
    "NotificationLog",
    "NotificationChannel",
    "NotificationTemplate",
    "UserNotificationPreference",
    # Safety
    "SafetyEvent",
    # ACARS
    "AcarsMessage",
    # Airspace
    "AirspaceAdvisory",
    "AirspaceBoundary",
    # Aviation
    "CachedAirport",
    "CachedNavaid",
    "CachedGeoJSON",
    "CachedPirep",
    # Audio
    "AudioTransmission",
    # Antenna
    "AntennaAnalyticsSnapshot",
    # Auth
    "SkyspyUser",
    "Role",
    "UserRole",
    "APIKey",
    "FeatureAccess",
    "OIDCClaimMapping",
    "FEATURE_PERMISSIONS",
    "ALL_PERMISSIONS",
    "DEFAULT_ROLES",
    # Engagement
    "AircraftFavorite",
    "SessionTrackingQuality",
    # NOTAMs and Static Data
    "CachedNotam",
    "CachedAirline",
    "CachedAircraftType",
    # Stats and Gamification
    "PersonalRecord",
    "RareSighting",
    "SpottedCount",
    "SpottedAircraft",
    "SightingStreak",
    "DailyStats",
    "NotableRegistration",
    "NotableCallsign",
    "RareAircraftType",
    # Cannonball
    "CannonballPattern",
    "CannonballSession",
    "CannonballAlert",
    "CannonballKnownAircraft",
    "CannonballStats",
    "LEDataSource",
    "PatternAnalytics",
    "RegistrationAnalysis",
    "RegistrationTransfer",
    "CommunitySubmission",
    "SubmitterReputation",
    # System Configuration
    "SystemConfig",
    "ConfigAuditLog",
    # Watch List
    "WatchedAircraft",
]

# Connect cache invalidation signals after models are loaded
try:
    from skyspy.signals import connect_cache_signals

    connect_cache_signals()
except ImportError:
    pass  # Signals module may not exist in some configurations
