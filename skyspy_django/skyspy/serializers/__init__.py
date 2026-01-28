"""
Django REST Framework serializers for SkysPy API.
"""
from skyspy.serializers.aircraft import (
    AircraftSerializer,
    AircraftListSerializer,
    TopAircraftSerializer,
    AircraftStatsSerializer,
    AircraftInfoSerializer,
    AircraftPhotoSerializer,
    BulkAircraftInfoSerializer,
)
from skyspy.serializers.alerts import (
    AlertRuleSerializer,
    AlertRuleCreateSerializer,
    AlertRuleUpdateSerializer,
    AlertHistorySerializer,
)
from skyspy.serializers.safety import (
    SafetyEventSerializer,
    SafetyStatsSerializer,
    AircraftSafetyStatsSerializer,
)
from skyspy.serializers.acars import (
    AcarsMessageSerializer,
    AcarsStatsSerializer,
    AcarsStatusSerializer,
)
from skyspy.serializers.audio import (
    AudioTransmissionSerializer,
    AudioUploadSerializer,
    AudioStatsSerializer,
)
from skyspy.serializers.aviation import (
    AirspaceAdvisorySerializer,
    AirspaceBoundarySerializer,
    CachedAirportSerializer,
    CachedNavaidSerializer,
    CachedPirepSerializer,
)
from skyspy.serializers.common import (
    SuccessResponseSerializer,
    DeleteResponseSerializer,
    ErrorResponseSerializer,
    GeoJSONFeatureSerializer,
    GeoJSONFeatureCollectionSerializer,
)
from skyspy.serializers.history import (
    SightingSerializer,
    SessionSerializer,
    HistoryStatsSerializer,
    TrendsSerializer,
    TopPerformersSerializer,
)
from skyspy.serializers.notifications import (
    NotificationConfigSerializer,
    NotificationLogSerializer,
)
from skyspy.serializers.system import (
    HealthResponseSerializer,
    StatusResponseSerializer,
    ApiInfoSerializer,
)
from skyspy.serializers.notams import (
    CachedNotamSerializer,
    NotamResponseSerializer,
    NotamListResponseSerializer,
    TfrResponseSerializer,
    TfrListResponseSerializer,
    NotamStatsSerializer,
    CachedAirlineSerializer,
    CachedAircraftTypeSerializer,
)

__all__ = [
    # Aircraft
    'AircraftSerializer',
    'AircraftListSerializer',
    'TopAircraftSerializer',
    'AircraftStatsSerializer',
    'AircraftInfoSerializer',
    'AircraftPhotoSerializer',
    'BulkAircraftInfoSerializer',
    # Alerts
    'AlertRuleSerializer',
    'AlertRuleCreateSerializer',
    'AlertRuleUpdateSerializer',
    'AlertHistorySerializer',
    # Safety
    'SafetyEventSerializer',
    'SafetyStatsSerializer',
    'AircraftSafetyStatsSerializer',
    # ACARS
    'AcarsMessageSerializer',
    'AcarsStatsSerializer',
    'AcarsStatusSerializer',
    # Audio
    'AudioTransmissionSerializer',
    'AudioUploadSerializer',
    'AudioStatsSerializer',
    # Aviation
    'AirspaceAdvisorySerializer',
    'AirspaceBoundarySerializer',
    'CachedAirportSerializer',
    'CachedNavaidSerializer',
    'CachedPirepSerializer',
    # Common
    'SuccessResponseSerializer',
    'DeleteResponseSerializer',
    'ErrorResponseSerializer',
    'GeoJSONFeatureSerializer',
    'GeoJSONFeatureCollectionSerializer',
    # History
    'SightingSerializer',
    'SessionSerializer',
    'HistoryStatsSerializer',
    'TrendsSerializer',
    'TopPerformersSerializer',
    # Notifications
    'NotificationConfigSerializer',
    'NotificationLogSerializer',
    # System
    'HealthResponseSerializer',
    'StatusResponseSerializer',
    'ApiInfoSerializer',
    # NOTAMs
    'CachedNotamSerializer',
    'NotamResponseSerializer',
    'NotamListResponseSerializer',
    'TfrResponseSerializer',
    'TfrListResponseSerializer',
    'NotamStatsSerializer',
    'CachedAirlineSerializer',
    'CachedAircraftTypeSerializer',
]
