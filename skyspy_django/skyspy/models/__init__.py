"""
SkysPy Django ORM Models.

This package contains all database models for the SkysPy application,
organized by domain area.
"""

# Import all models for Django's model registry
from skyspy.models.aircraft import AircraftSighting, AircraftSession, AircraftInfo, AirframeSourceData
from skyspy.models.alerts import AlertRule, AlertHistory, AlertSubscription, AlertAggregate
from skyspy.models.notifications import (
    NotificationConfig, NotificationLog, NotificationChannel,
    NotificationTemplate, UserNotificationPreference,
)
from skyspy.models.safety import SafetyEvent
from skyspy.models.acars import AcarsMessage
from skyspy.models.airspace import AirspaceAdvisory, AirspaceBoundary
from skyspy.models.aviation import CachedAirport, CachedNavaid, CachedGeoJSON, CachedPirep
from skyspy.models.audio import AudioTransmission
from skyspy.models.antenna import AntennaAnalyticsSnapshot
from skyspy.models.auth import (
    SkyspyUser, Role, UserRole, APIKey, FeatureAccess, OIDCClaimMapping,
    FEATURE_PERMISSIONS, ALL_PERMISSIONS, DEFAULT_ROLES,
)
from skyspy.models.engagement import AircraftFavorite, SessionTrackingQuality
from skyspy.models.notams import CachedNotam, CachedAirline, CachedAircraftType
from skyspy.models.stats import (
    PersonalRecord, RareSighting, SpottedCount, SpottedAircraft,
    SightingStreak, DailyStats, NotableRegistration, NotableCallsign, RareAircraftType,
)
from skyspy.models.cannonball import (
    CannonballPattern, CannonballSession, CannonballAlert,
    CannonballKnownAircraft, CannonballStats,
)

__all__ = [
    # Aircraft
    'AircraftSighting',
    'AircraftSession',
    'AircraftInfo',
    'AirframeSourceData',
    # Alerts
    'AlertRule',
    'AlertHistory',
    'AlertSubscription',
    'AlertAggregate',
    # Notifications
    'NotificationConfig',
    'NotificationLog',
    'NotificationChannel',
    'NotificationTemplate',
    'UserNotificationPreference',
    # Safety
    'SafetyEvent',
    # ACARS
    'AcarsMessage',
    # Airspace
    'AirspaceAdvisory',
    'AirspaceBoundary',
    # Aviation
    'CachedAirport',
    'CachedNavaid',
    'CachedGeoJSON',
    'CachedPirep',
    # Audio
    'AudioTransmission',
    # Antenna
    'AntennaAnalyticsSnapshot',
    # Auth
    'SkyspyUser',
    'Role',
    'UserRole',
    'APIKey',
    'FeatureAccess',
    'OIDCClaimMapping',
    'FEATURE_PERMISSIONS',
    'ALL_PERMISSIONS',
    'DEFAULT_ROLES',
    # Engagement
    'AircraftFavorite',
    'SessionTrackingQuality',
    # NOTAMs and Static Data
    'CachedNotam',
    'CachedAirline',
    'CachedAircraftType',
    # Stats and Gamification
    'PersonalRecord',
    'RareSighting',
    'SpottedCount',
    'SpottedAircraft',
    'SightingStreak',
    'DailyStats',
    'NotableRegistration',
    'NotableCallsign',
    'RareAircraftType',
    # Cannonball
    'CannonballPattern',
    'CannonballSession',
    'CannonballAlert',
    'CannonballKnownAircraft',
    'CannonballStats',
]
