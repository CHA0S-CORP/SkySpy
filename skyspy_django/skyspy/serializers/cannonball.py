"""
Serializers for Cannonball Mode API endpoints.
"""

from rest_framework import serializers

from skyspy.models import (
    CannonballAlert,
    CannonballKnownAircraft,
    CannonballPattern,
    CannonballSession,
    CannonballStats,
    CommunitySubmission,
    LEDataSource,
    PatternAnalytics,
    RegistrationAnalysis,
    SubmitterReputation,
)


class CannonballPatternSerializer(serializers.ModelSerializer):
    """Serializer for detected flight patterns."""

    is_active = serializers.ReadOnlyField()

    class Meta:
        model = CannonballPattern
        fields = [
            "id",
            "icao_hex",
            "callsign",
            "pattern_type",
            "confidence",
            "confidence_score",
            "center_lat",
            "center_lon",
            "radius_nm",
            "pattern_data",
            "started_at",
            "ended_at",
            "duration_seconds",
            "detected_at",
            "session",
            "is_active",
        ]
        read_only_fields = ["id", "detected_at", "is_active"]


class CannonballPatternSummarySerializer(serializers.ModelSerializer):
    """Lightweight pattern serializer for nested views."""

    class Meta:
        model = CannonballPattern
        fields = [
            "id",
            "pattern_type",
            "confidence",
            "confidence_score",
            "detected_at",
            "duration_seconds",
        ]


class CannonballSessionSerializer(serializers.ModelSerializer):
    """Serializer for LE aircraft tracking sessions."""

    patterns = CannonballPatternSummarySerializer(many=True, read_only=True)
    threat_level_display = serializers.CharField(source="get_threat_level_display", read_only=True)

    class Meta:
        model = CannonballSession
        fields = [
            "id",
            "icao_hex",
            "callsign",
            "registration",
            "identification_method",
            "identification_reason",
            "operator_name",
            "operator_icao",
            "aircraft_type",
            "is_active",
            "threat_level",
            "threat_level_display",
            "urgency_score",
            "last_lat",
            "last_lon",
            "last_altitude",
            "last_ground_speed",
            "last_track",
            "distance_nm",
            "bearing",
            "closing_speed_kts",
            "first_seen",
            "last_seen",
            "session_duration_seconds",
            "pattern_count",
            "alert_count",
            "position_count",
            "patterns",
            "metadata",
        ]
        read_only_fields = [
            "id",
            "first_seen",
            "last_seen",
            "session_duration_seconds",
            "pattern_count",
            "alert_count",
            "position_count",
            "patterns",
        ]


class CannonballSessionListSerializer(serializers.ModelSerializer):
    """Lightweight session serializer for list views."""

    class Meta:
        model = CannonballSession
        fields = [
            "id",
            "icao_hex",
            "callsign",
            "is_active",
            "threat_level",
            "urgency_score",
            "distance_nm",
            "bearing",
            "closing_speed_kts",
            "last_seen",
            "pattern_count",
            "alert_count",
        ]


class CannonballAlertSerializer(serializers.ModelSerializer):
    """Serializer for Cannonball alerts."""

    session_icao = serializers.CharField(source="session.icao_hex", read_only=True)
    session_callsign = serializers.CharField(source="session.callsign", read_only=True)

    class Meta:
        model = CannonballAlert
        fields = [
            "id",
            "session",
            "session_icao",
            "session_callsign",
            "alert_type",
            "priority",
            "title",
            "message",
            "aircraft_lat",
            "aircraft_lon",
            "aircraft_altitude",
            "user_lat",
            "user_lon",
            "distance_nm",
            "bearing",
            "pattern",
            "notified",
            "announced",
            "acknowledged",
            "acknowledged_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "session_icao",
            "session_callsign",
            "notified",
            "announced",
            "created_at",
        ]


class CannonballAlertListSerializer(serializers.ModelSerializer):
    """Lightweight alert serializer for list views."""

    session_icao = serializers.CharField(source="session.icao_hex", read_only=True)

    class Meta:
        model = CannonballAlert
        fields = [
            "id",
            "session_icao",
            "alert_type",
            "priority",
            "title",
            "distance_nm",
            "acknowledged",
            "created_at",
        ]


class CannonballKnownAircraftSerializer(serializers.ModelSerializer):
    """Serializer for known LE aircraft database."""

    class Meta:
        model = CannonballKnownAircraft
        fields = [
            "id",
            "icao_hex",
            "registration",
            "aircraft_type",
            "aircraft_model",
            "agency_name",
            "agency_type",
            "agency_state",
            "agency_city",
            "source",
            "source_url",
            "verified",
            "verified_at",
            "times_detected",
            "last_detected",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "verified_at",
            "times_detected",
            "last_detected",
            "created_at",
            "updated_at",
        ]


class CannonballKnownAircraftCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating known LE aircraft entries."""

    class Meta:
        model = CannonballKnownAircraft
        fields = [
            "icao_hex",
            "registration",
            "aircraft_type",
            "aircraft_model",
            "agency_name",
            "agency_type",
            "agency_state",
            "agency_city",
            "source",
            "source_url",
            "notes",
        ]


class CannonballStatsSerializer(serializers.ModelSerializer):
    """Serializer for Cannonball statistics."""

    class Meta:
        model = CannonballStats
        fields = [
            "id",
            "period_type",
            "period_start",
            "period_end",
            "total_detections",
            "unique_aircraft",
            "critical_alerts",
            "warning_alerts",
            "info_alerts",
            "circling_patterns",
            "loitering_patterns",
            "grid_search_patterns",
            "speed_trap_patterns",
            "top_aircraft",
            "top_agencies",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class CannonballThreatSerializer(serializers.Serializer):
    """Serializer for real-time threat data from cache."""

    icao_hex = serializers.CharField()
    callsign = serializers.CharField(allow_null=True)
    lat = serializers.FloatField(allow_null=True)
    lon = serializers.FloatField(allow_null=True)
    altitude = serializers.IntegerField(allow_null=True)
    ground_speed = serializers.IntegerField(allow_null=True)
    track = serializers.IntegerField(allow_null=True)
    distance_nm = serializers.FloatField(allow_null=True)
    bearing = serializers.FloatField(allow_null=True)
    closing_speed = serializers.FloatField(allow_null=True)
    threat_level = serializers.CharField()
    urgency_score = serializers.FloatField()
    is_known_le = serializers.BooleanField(default=False)
    identification_method = serializers.CharField(allow_null=True)
    identification_reason = serializers.CharField(allow_null=True)
    operator_name = serializers.CharField(allow_null=True)
    agency_name = serializers.CharField(allow_null=True)
    agency_type = serializers.CharField(allow_null=True)
    patterns = serializers.ListField(child=serializers.DictField(), default=list)


class CannonballLocationUpdateSerializer(serializers.Serializer):
    """Serializer for user location updates."""

    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
    heading = serializers.FloatField(min_value=0, max_value=360, required=False)
    speed = serializers.FloatField(min_value=0, required=False)


class CannonballSettingsSerializer(serializers.Serializer):
    """Serializer for Cannonball mode settings."""

    max_range_nm = serializers.FloatField(min_value=1, max_value=100, default=15)
    alert_distance_nm = serializers.FloatField(min_value=0.5, max_value=50, default=5)
    voice_enabled = serializers.BooleanField(default=True)
    show_all_aircraft = serializers.BooleanField(default=False)
    patterns_enabled = serializers.ListField(
        child=serializers.ChoiceField(
            choices=[
                "circling",
                "loitering",
                "grid_search",
                "speed_trap",
                "stakeout",
                "racetrack",
                "highway_tracking",
                "area_search",
            ]
        ),
        default=["circling", "loitering", "grid_search", "speed_trap", "stakeout", "racetrack", "highway_tracking"],
    )


# ========================================
# Phase 1: External Data Sources
# ========================================


class LEDataSourceSerializer(serializers.ModelSerializer):
    """Serializer for external LE data sources."""

    class Meta:
        model = LEDataSource
        fields = [
            "id",
            "name",
            "source_type",
            "url",
            "description",
            "record_count",
            "confidence_weight",
            "last_fetched",
            "last_successful_fetch",
            "update_frequency_hours",
            "fetch_enabled",
            "attribution_text",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "record_count",
            "last_fetched",
            "last_successful_fetch",
            "created_at",
            "updated_at",
        ]


class LEDataSourceListSerializer(serializers.ModelSerializer):
    """Lightweight data source serializer for lists."""

    class Meta:
        model = LEDataSource
        fields = [
            "id",
            "name",
            "source_type",
            "record_count",
            "last_successful_fetch",
            "fetch_enabled",
        ]


# ========================================
# Phase 2: Pattern Analytics
# ========================================


class PatternAnalyticsSerializer(serializers.ModelSerializer):
    """Serializer for pattern detection analytics."""

    class Meta:
        model = PatternAnalytics
        fields = [
            "id",
            "icao_hex",
            "pattern_type",
            "confidence_score",
            "was_confirmed_le",
            "false_positive_reported",
            "duration_seconds",
            "area_nm_sq",
            "orbit_count",
            "altitude_consistency",
            "center_lat",
            "center_lon",
            "pattern_metadata",
            "detected_at",
            "feedback_at",
        ]
        read_only_fields = ["id", "detected_at", "feedback_at"]


class PatternFeedbackSerializer(serializers.Serializer):
    """Serializer for pattern feedback submission."""

    was_confirmed_le = serializers.BooleanField(required=False, allow_null=True)
    is_false_positive = serializers.BooleanField(default=False)


# ========================================
# Phase 3: Registration Analysis
# ========================================


class RegistrationAnalysisSerializer(serializers.ModelSerializer):
    """Serializer for registration analysis results."""

    class Meta:
        model = RegistrationAnalysis
        fields = [
            "id",
            "icao_hex",
            "registration",
            "owner_name",
            "owner_address",
            "owner_city",
            "owner_state",
            "owner_zip",
            "llc_no_web_presence",
            "registered_agent_address",
            "po_box_address",
            "multiple_transfers",
            "trust_ownership",
            "generic_llc_name",
            "shell_company_score",
            "risk_level",
            "manually_reviewed",
            "is_confirmed_le",
            "review_notes",
            "aircraft_type",
            "aircraft_manufacturer",
            "aircraft_model",
            "aircraft_year",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "shell_company_score",
            "risk_level",
            "created_at",
            "updated_at",
        ]


class RegistrationAnalysisListSerializer(serializers.ModelSerializer):
    """Lightweight registration analysis serializer."""

    class Meta:
        model = RegistrationAnalysis
        fields = [
            "id",
            "icao_hex",
            "registration",
            "owner_name",
            "shell_company_score",
            "risk_level",
            "manually_reviewed",
            "is_confirmed_le",
        ]


class RegistrationReviewSerializer(serializers.Serializer):
    """Serializer for admin review of registration analysis."""

    is_confirmed_le = serializers.BooleanField(required=False, allow_null=True)
    review_notes = serializers.CharField(max_length=1000, required=False, allow_blank=True)


# ========================================
# Phase 4: Community Submissions
# ========================================


class CommunitySubmissionSerializer(serializers.ModelSerializer):
    """Serializer for community aircraft submissions."""

    submitted_by_username = serializers.CharField(source="submitted_by.username", read_only=True)
    reviewed_by_username = serializers.CharField(source="reviewed_by.username", read_only=True)

    class Meta:
        model = CommunitySubmission
        fields = [
            "id",
            "icao_hex",
            "registration",
            "callsign_observed",
            "agency_name",
            "agency_type",
            "agency_state",
            "agency_city",
            "evidence_type",
            "evidence_description",
            "evidence_url",
            "additional_evidence",
            "submitted_by",
            "submitted_by_username",
            "submitted_at",
            "status",
            "reviewed_by",
            "reviewed_by_username",
            "reviewed_at",
            "review_notes",
            "confidence_score",
            "created_aircraft",
        ]
        read_only_fields = [
            "id",
            "submitted_by",
            "submitted_by_username",
            "submitted_at",
            "status",
            "reviewed_by",
            "reviewed_by_username",
            "reviewed_at",
            "review_notes",
            "confidence_score",
            "created_aircraft",
        ]


class CommunitySubmissionCreateSerializer(serializers.Serializer):
    """Serializer for creating community submissions."""

    icao_hex = serializers.CharField(max_length=10)
    registration = serializers.CharField(max_length=20, required=False, allow_blank=True)
    callsign_observed = serializers.CharField(max_length=20, required=False, allow_blank=True)
    agency_name = serializers.CharField(max_length=200)
    agency_type = serializers.ChoiceField(
        choices=[
            ("federal", "Federal"),
            ("state", "State"),
            ("local", "Local"),
            ("military", "Military"),
            ("unknown", "Unknown"),
        ],
        default="unknown",
    )
    agency_state = serializers.CharField(max_length=2, required=False, allow_blank=True)
    agency_city = serializers.CharField(max_length=100, required=False, allow_blank=True)
    evidence_type = serializers.ChoiceField(
        choices=[
            ("flight_pattern", "Observed Flight Pattern"),
            ("callsign", "LE Callsign Observed"),
            ("news", "News Report"),
            ("foia", "FOIA Document"),
            ("registry", "Registry Research"),
            ("livery", "Aircraft Livery/Markings"),
            ("public_records", "Public Records"),
            ("other", "Other"),
        ]
    )
    evidence_description = serializers.CharField(max_length=5000)
    evidence_url = serializers.URLField(required=False, allow_blank=True)
    additional_evidence = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list,
    )


class CommunitySubmissionListSerializer(serializers.ModelSerializer):
    """Lightweight submission serializer for lists."""

    submitted_by_username = serializers.CharField(source="submitted_by.username", read_only=True)

    class Meta:
        model = CommunitySubmission
        fields = [
            "id",
            "icao_hex",
            "agency_name",
            "evidence_type",
            "submitted_by_username",
            "submitted_at",
            "status",
            "confidence_score",
        ]


class SubmissionReviewSerializer(serializers.Serializer):
    """Serializer for admin review actions."""

    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True)


class SubmissionRejectSerializer(serializers.Serializer):
    """Serializer for rejection with required reason."""

    reason = serializers.CharField(max_length=1000)


class SubmitterReputationSerializer(serializers.ModelSerializer):
    """Serializer for submitter reputation."""

    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = SubmitterReputation
        fields = [
            "id",
            "user",
            "username",
            "total_submissions",
            "approved_submissions",
            "rejected_submissions",
            "pending_submissions",
            "reputation_score",
            "is_trusted",
            "is_banned",
            "first_submission_at",
            "last_submission_at",
            "last_approved_at",
        ]
        read_only_fields = fields
