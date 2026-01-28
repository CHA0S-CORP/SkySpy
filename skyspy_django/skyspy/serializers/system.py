"""
System health and status serializers.
"""
from rest_framework import serializers


class ServiceHealthSerializer(serializers.Serializer):
    """Individual service health status."""

    status = serializers.CharField(help_text="Service status (up, down, degraded)")
    latency_ms = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text="Latency in milliseconds"
    )
    message = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Additional status message"
    )


class HealthResponseSerializer(serializers.Serializer):
    """Health check response."""

    status = serializers.CharField(help_text="Overall health status")
    services = serializers.DictField(
        child=ServiceHealthSerializer(),
        help_text="Individual service health status"
    )
    timestamp = serializers.CharField(help_text="Health check timestamp")


class StatusResponseSerializer(serializers.Serializer):
    """Comprehensive system status."""

    version = serializers.CharField(help_text="API version")
    adsb_online = serializers.BooleanField(help_text="ADS-B data source online")
    aircraft_count = serializers.IntegerField(help_text="Currently tracked aircraft")
    total_sightings = serializers.IntegerField(help_text="Total sightings in database")
    total_sessions = serializers.IntegerField(help_text="Total sessions in database")
    active_rules = serializers.IntegerField(help_text="Active alert rules")
    alert_history_count = serializers.IntegerField(help_text="Total alert history entries")
    safety_event_count = serializers.IntegerField(help_text="Total safety events")
    safety_monitoring_enabled = serializers.BooleanField(
        help_text="Safety monitoring active"
    )
    safety_tracked_aircraft = serializers.IntegerField(
        help_text="Aircraft tracked for safety"
    )
    notifications_configured = serializers.BooleanField(
        help_text="Notifications configured"
    )
    redis_enabled = serializers.BooleanField(help_text="Redis available")
    websocket_connections = serializers.IntegerField(
        help_text="WebSocket connection count"
    )
    sse_subscribers = serializers.IntegerField(help_text="SSE subscriber count")
    acars_enabled = serializers.BooleanField(help_text="ACARS service enabled")
    acars_running = serializers.BooleanField(help_text="ACARS service running")
    polling_interval_seconds = serializers.IntegerField(
        help_text="Aircraft polling interval"
    )
    db_store_interval_seconds = serializers.IntegerField(
        help_text="Database write interval"
    )
    celery_running = serializers.BooleanField(help_text="Celery workers running")
    celery_tasks = serializers.ListField(
        child=serializers.DictField(),
        help_text="Scheduled Celery tasks"
    )
    worker_pid = serializers.IntegerField(help_text="Worker process ID")
    location = serializers.DictField(help_text="Feeder location")


class SSEStatusSerializer(serializers.Serializer):
    """SSE service status."""

    mode = serializers.CharField(help_text="SSE mode (memory, redis)")
    redis_enabled = serializers.BooleanField(help_text="Redis backing enabled")
    subscribers = serializers.IntegerField(help_text="Total subscribers")
    subscribers_local = serializers.IntegerField(help_text="Local worker subscribers")
    tracked_aircraft = serializers.IntegerField(help_text="Aircraft in state cache")
    last_publish = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Last publish time"
    )
    history = serializers.DictField(help_text="History buffer info")
    timestamp = serializers.CharField(help_text="Status timestamp")


class ApiInfoSerializer(serializers.Serializer):
    """API information and available endpoints."""

    version = serializers.CharField(help_text="API version")
    name = serializers.CharField(help_text="API name")
    description = serializers.CharField(help_text="API description")
    endpoints = serializers.DictField(help_text="Available endpoint groups")


class ConfigSerializer(serializers.Serializer):
    """Non-sensitive configuration values."""

    feeder_location = serializers.DictField(help_text="Feeder latitude/longitude")
    polling_interval = serializers.IntegerField(help_text="Polling interval in seconds")
    safety_thresholds = serializers.DictField(help_text="Safety monitoring thresholds")
    acars_enabled = serializers.BooleanField(help_text="ACARS receiver enabled")
    transcription_enabled = serializers.BooleanField(help_text="Transcription enabled")
