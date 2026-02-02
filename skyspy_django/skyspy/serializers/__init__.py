"""
Django REST Framework serializers for SkysPy API.
"""

from skyspy.serializers.acars import (
    AcarsMessageSerializer,
    AcarsStatsSerializer,
    AcarsStatusSerializer,
)
from skyspy.serializers.aircraft import (
    AircraftInfoSerializer,
    AircraftListSerializer,
    AircraftPhotoSerializer,
    AircraftSerializer,
    AircraftStatsSerializer,
    BulkAircraftInfoSerializer,
    TopAircraftSerializer,
)
from skyspy.serializers.alerts import (
    AlertHistorySerializer,
    AlertRuleCreateSerializer,
    AlertRuleSerializer,
    AlertRuleUpdateSerializer,
)
from skyspy.serializers.audio import (
    AudioStatsSerializer,
    AudioTransmissionSerializer,
    AudioUploadSerializer,
)
from skyspy.serializers.aviation import (
    AirspaceAdvisorySerializer,
    AirspaceBoundarySerializer,
    CachedAirportSerializer,
    CachedNavaidSerializer,
    CachedPirepSerializer,
)
from skyspy.serializers.common import (
    DeleteResponseSerializer,
    ErrorResponseSerializer,
    GeoJSONFeatureCollectionSerializer,
    GeoJSONFeatureSerializer,
    SuccessResponseSerializer,
)
from skyspy.serializers.history import (
    HistoryStatsSerializer,
    SessionSerializer,
    SightingSerializer,
    TopPerformersSerializer,
    TrendsSerializer,
)
from skyspy.serializers.notams import (
    CachedAircraftTypeSerializer,
    CachedAirlineSerializer,
    CachedNotamSerializer,
    NotamListResponseSerializer,
    NotamResponseSerializer,
    NotamStatsSerializer,
    TfrListResponseSerializer,
    TfrResponseSerializer,
)
from skyspy.serializers.notifications import (
    NotificationConfigSerializer,
    NotificationLogSerializer,
)
from skyspy.serializers.safety import (
    AircraftSafetyStatsSerializer,
    SafetyEventSerializer,
    SafetyStatsSerializer,
)
from skyspy.serializers.system import (
    ApiInfoSerializer,
    HealthResponseSerializer,
    StatusResponseSerializer,
)

__all__ = [
    # Aircraft
    "AircraftSerializer",
    "AircraftListSerializer",
    "TopAircraftSerializer",
    "AircraftStatsSerializer",
    "AircraftInfoSerializer",
    "AircraftPhotoSerializer",
    "BulkAircraftInfoSerializer",
    # Alerts
    "AlertRuleSerializer",
    "AlertRuleCreateSerializer",
    "AlertRuleUpdateSerializer",
    "AlertHistorySerializer",
    # Safety
    "SafetyEventSerializer",
    "SafetyStatsSerializer",
    "AircraftSafetyStatsSerializer",
    # ACARS
    "AcarsMessageSerializer",
    "AcarsStatsSerializer",
    "AcarsStatusSerializer",
    # Audio
    "AudioTransmissionSerializer",
    "AudioUploadSerializer",
    "AudioStatsSerializer",
    # Aviation
    "AirspaceAdvisorySerializer",
    "AirspaceBoundarySerializer",
    "CachedAirportSerializer",
    "CachedNavaidSerializer",
    "CachedPirepSerializer",
    # Common
    "SuccessResponseSerializer",
    "DeleteResponseSerializer",
    "ErrorResponseSerializer",
    "GeoJSONFeatureSerializer",
    "GeoJSONFeatureCollectionSerializer",
    # History
    "SightingSerializer",
    "SessionSerializer",
    "HistoryStatsSerializer",
    "TrendsSerializer",
    "TopPerformersSerializer",
    # Notifications
    "NotificationConfigSerializer",
    "NotificationLogSerializer",
    # System
    "HealthResponseSerializer",
    "StatusResponseSerializer",
    "ApiInfoSerializer",
    # NOTAMs
    "CachedNotamSerializer",
    "NotamResponseSerializer",
    "NotamListResponseSerializer",
    "TfrResponseSerializer",
    "TfrListResponseSerializer",
    "NotamStatsSerializer",
    "CachedAirlineSerializer",
    "CachedAircraftTypeSerializer",
]
