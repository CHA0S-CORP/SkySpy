"""
Pydantic schemas for request/response validation with full OpenAPI documentation.
"""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field, ConfigDict


# ============================================================================
# Aircraft Schemas
# ============================================================================

class AircraftBase(BaseModel):
    """Base aircraft data."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "hex": "A12345",
                "flight": "UAL123",
                "type": "B738",
                "alt": 35000,
                "gs": 450.5,
                "vr": 0,
                "distance_nm": 15.2,
                "squawk": "1200",
                "category": "A3",
                "rssi": -8.5,
                "lat": 47.6062,
                "lon": -122.3321,
                "track": 270.5,
                "military": False,
                "emergency": False
            }
        }
    )
    
    hex: Optional[str] = Field(None, description="ICAO 24-bit hex identifier", example="A12345")
    flight: Optional[str] = Field(None, description="Callsign/flight number", example="UAL123")
    type: Optional[str] = Field(None, description="Aircraft type code (ICAO)", example="B738")
    alt: Optional[int] = Field(None, description="Barometric altitude in feet", example=35000)
    gs: Optional[float] = Field(None, description="Ground speed in knots", example=450.5)
    vr: Optional[int] = Field(None, description="Vertical rate in feet/minute", example=0)
    distance_nm: Optional[float] = Field(None, description="Distance from feeder in nautical miles", example=15.2)
    squawk: Optional[str] = Field(None, description="Transponder squawk code", example="1200")
    category: Optional[str] = Field(None, description="Aircraft category (A0-D7)", example="A3")
    rssi: Optional[float] = Field(None, description="Signal strength in dBFS", example=-8.5)
    lat: Optional[float] = Field(None, description="Latitude in decimal degrees", example=47.6062)
    lon: Optional[float] = Field(None, description="Longitude in decimal degrees", example=-122.3321)
    track: Optional[float] = Field(None, description="Ground track in degrees", example=270.5)
    military: bool = Field(False, description="Military aircraft flag")
    emergency: bool = Field(False, description="Emergency squawk detected")


class AircraftListResponse(BaseModel):
    """Response containing list of aircraft with metadata."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "aircraft": [{"hex": "A12345", "flight": "UAL123", "alt": 35000}],
                "count": 1,
                "now": 1703123456.789,
                "messages": 15234,
                "timestamp": "2024-12-21T12:00:00Z"
            }
        }
    )
    
    aircraft: list[dict] = Field(default_factory=list, description="List of aircraft currently tracked")
    count: int = Field(0, description="Number of aircraft in response")
    now: Optional[float] = Field(None, description="Unix timestamp from data source")
    messages: int = Field(0, description="Total messages received by feeder")
    timestamp: str = Field(..., description="ISO 8601 timestamp of response")


class TopAircraftResponse(BaseModel):
    """Response for top aircraft endpoint with categorized lists."""
    closest: list[dict] = Field(default_factory=list, description="Aircraft closest to feeder")
    highest: list[dict] = Field(default_factory=list, description="Aircraft at highest altitude")
    fastest: list[dict] = Field(default_factory=list, description="Aircraft with highest ground speed")
    climbing: list[dict] = Field(default_factory=list, description="Aircraft with highest climb rate")
    military: list[dict] = Field(default_factory=list, description="Military aircraft detected")
    total: int = Field(0, description="Total aircraft currently tracked")
    timestamp: str = Field(..., description="ISO 8601 timestamp")


class AircraftStatsResponse(BaseModel):
    """Statistical summary of tracked aircraft."""
    total: int = Field(0, description="Total aircraft tracked")
    with_position: int = Field(0, description="Aircraft with valid position")
    military: int = Field(0, description="Military aircraft count")
    emergency: list[dict] = Field(default_factory=list, description="Aircraft squawking emergency")
    categories: dict = Field(default_factory=dict, description="Count by aircraft category")
    altitude: dict = Field(default_factory=dict, description="Count by altitude band")
    messages: int = Field(0, description="Total messages received")
    timestamp: str = Field(..., description="ISO 8601 timestamp")


# ============================================================================
# Aircraft Info Schemas
# ============================================================================

class AircraftInfoResponse(BaseModel):
    """Detailed aircraft registration and airframe information."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "icao_hex": "A12345",
                "registration": "N12345",
                "type_code": "B738",
                "type_name": "Boeing 737-800",
                "manufacturer": "Boeing",
                "model": "737-8AS",
                "serial_number": "29934",
                "year_built": 2007,
                "age_years": 17,
                "operator": "United Airlines",
                "operator_icao": "UAL",
                "country": "United States",
                "is_military": False,
                "photo_url": "https://example.com/photo.jpg",
                "photo_thumbnail_url": "https://example.com/thumb.jpg",
                "photo_photographer": "John Doe",
                "photo_source": "planespotters.net",
                "cached_at": "2024-12-21T12:00:00Z"
            }
        }
    )
    
    icao_hex: str = Field(..., description="ICAO 24-bit hex identifier")
    registration: Optional[str] = Field(None, description="Aircraft registration number")
    type_code: Optional[str] = Field(None, description="ICAO type designator")
    type_name: Optional[str] = Field(None, description="Full aircraft type name")
    manufacturer: Optional[str] = Field(None, description="Aircraft manufacturer")
    model: Optional[str] = Field(None, description="Specific model variant")
    serial_number: Optional[str] = Field(None, description="Manufacturer serial number")
    year_built: Optional[int] = Field(None, description="Year of manufacture")
    age_years: Optional[int] = Field(None, description="Aircraft age in years")
    first_flight_date: Optional[str] = Field(None, description="Date of first flight")
    delivery_date: Optional[str] = Field(None, description="Delivery date to operator")
    airframe_hours: Optional[int] = Field(None, description="Total airframe hours")
    operator: Optional[str] = Field(None, description="Current operator name")
    operator_icao: Optional[str] = Field(None, description="Operator ICAO code")
    operator_callsign: Optional[str] = Field(None, description="Operator radio callsign")
    owner: Optional[str] = Field(None, description="Registered owner")
    country: Optional[str] = Field(None, description="Country of registration")
    country_code: Optional[str] = Field(None, description="ISO country code")
    category: Optional[str] = Field(None, description="Aircraft category")
    is_military: bool = Field(False, description="Military aircraft flag")
    photo_url: Optional[str] = Field(None, description="Full-size photo URL")
    photo_thumbnail_url: Optional[str] = Field(None, description="Thumbnail photo URL")
    photo_photographer: Optional[str] = Field(None, description="Photo credit")
    photo_source: Optional[str] = Field(None, description="Photo source website")
    extra_data: Optional[dict] = Field(None, description="Additional metadata")
    cached_at: Optional[str] = Field(None, description="When data was cached")
    fetch_failed: bool = Field(False, description="True if lookup failed")


class AircraftPhotoResponse(BaseModel):
    """Aircraft photo information."""
    icao_hex: str = Field(..., description="ICAO hex identifier")
    photo_url: Optional[str] = Field(None, description="Full-size photo URL")
    thumbnail_url: Optional[str] = Field(None, description="Thumbnail URL")
    photographer: Optional[str] = Field(None, description="Photographer credit")
    source: Optional[str] = Field(None, description="Photo source")


class BulkAircraftInfoResponse(BaseModel):
    """Response for bulk aircraft info lookup."""
    aircraft: dict = Field(default_factory=dict, description="Map of ICAO hex to aircraft info")
    found: int = Field(0, description="Number of aircraft found in cache")
    requested: int = Field(0, description="Number of valid ICAO codes requested")


class AircraftInfoCacheStats(BaseModel):
    """Statistics about aircraft info cache."""
    total_cached: int = Field(0, description="Total aircraft in cache")
    failed_lookups: int = Field(0, description="Failed lookup count")
    with_photos: int = Field(0, description="Aircraft with photos cached")
    cache_duration_hours: int = Field(168, description="Cache TTL in hours")
    retry_after_hours: int = Field(24, description="Retry failed lookups after hours")


# ============================================================================
# GeoJSON Schemas
# ============================================================================

class GeoJSONGeometry(BaseModel):
    """GeoJSON geometry object."""
    type: str = Field(..., description="Geometry type", example="Point")
    coordinates: list = Field(..., description="Coordinate array [lon, lat]")


class GeoJSONFeature(BaseModel):
    """GeoJSON Feature for a single aircraft."""
    type: str = Field("Feature", description="GeoJSON type")
    id: Optional[str] = Field(None, description="Feature ID (ICAO hex)")
    geometry: Optional[GeoJSONGeometry] = Field(None, description="Point geometry")
    properties: dict = Field(default_factory=dict, description="Aircraft properties")


class GeoJSONFeatureCollection(BaseModel):
    """GeoJSON FeatureCollection containing all aircraft."""
    type: str = Field("FeatureCollection", description="GeoJSON type")
    features: list[GeoJSONFeature] = Field(default_factory=list, description="Aircraft features")
    metadata: dict = Field(default_factory=dict, description="Collection metadata")


# ============================================================================
# History Schemas
# ============================================================================

class SightingResponse(BaseModel):
    """Single aircraft sighting record."""
    timestamp: str = Field(..., description="ISO 8601 timestamp of sighting")
    icao_hex: str = Field(..., description="ICAO hex identifier")
    callsign: Optional[str] = Field(None, description="Flight callsign")
    lat: Optional[float] = Field(None, description="Latitude")
    lon: Optional[float] = Field(None, description="Longitude")
    altitude: Optional[int] = Field(None, description="Altitude in feet")
    gs: Optional[float] = Field(None, description="Ground speed in knots")
    vr: Optional[int] = Field(None, description="Vertical rate ft/min")
    distance_nm: Optional[float] = Field(None, description="Distance from feeder")
    is_military: bool = Field(False, description="Military aircraft flag")
    squawk: Optional[str] = Field(None, description="Squawk code")


class SightingsListResponse(BaseModel):
    """Response containing list of sightings."""
    sightings: list[SightingResponse] = Field(default_factory=list, description="List of sightings")
    count: int = Field(0, description="Number of sightings returned")
    total: int = Field(0, description="Total sightings matching query")


class SessionResponse(BaseModel):
    """Aircraft tracking session record."""
    icao_hex: str = Field(..., description="ICAO hex identifier")
    callsign: Optional[str] = Field(None, description="Flight callsign")
    first_seen: str = Field(..., description="Session start time")
    last_seen: str = Field(..., description="Session end time")
    duration_min: float = Field(..., description="Session duration in minutes")
    positions: int = Field(0, description="Number of position reports")
    min_distance_nm: Optional[float] = Field(None, description="Closest approach distance")
    max_distance_nm: Optional[float] = Field(None, description="Furthest distance observed")
    min_alt: Optional[int] = Field(None, description="Minimum altitude observed")
    max_alt: Optional[int] = Field(None, description="Maximum altitude observed")
    max_vr: Optional[int] = Field(None, description="Maximum vertical rate")
    min_rssi: Optional[float] = Field(None, description="Minimum RSSI (best signal)")
    max_rssi: Optional[float] = Field(None, description="Maximum RSSI (weakest signal)")
    is_military: bool = Field(False, description="Military aircraft flag")
    type: Optional[str] = Field(None, description="Aircraft type code")
    safety_event_count: int = Field(0, description="Number of safety events during session")


class SessionsListResponse(BaseModel):
    """Response containing list of sessions."""
    sessions: list[SessionResponse] = Field(default_factory=list, description="List of sessions")
    count: int = Field(0, description="Number of sessions returned")


class HistoryStatsResponse(BaseModel):
    """Historical statistics."""
    total_sightings: int = Field(0, description="Total sighting records")
    total_sessions: int = Field(0, description="Total tracking sessions")
    unique_aircraft: int = Field(0, description="Unique aircraft seen")
    military_sessions: int = Field(0, description="Military aircraft sessions")
    time_range_hours: int = Field(24, description="Statistics time range")


# ============================================================================
# Alert Schemas
# ============================================================================

class ConditionCreate(BaseModel):
    """Single condition in an alert rule."""
    type: str = Field(..., description="Condition type (icao, callsign, squawk, altitude, distance, type, military)")
    operator: str = Field("eq", description="Comparison operator (eq, ne, lt, gt, le, ge, contains, startswith)")
    value: str = Field(..., description="Value to compare against")


class ConditionGroupCreate(BaseModel):
    """Group of conditions with AND/OR logic."""
    logic: str = Field("AND", description="Logic operator (AND, OR)")
    conditions: list[ConditionCreate] = Field(default_factory=list, description="List of conditions")


class ComplexConditionsCreate(BaseModel):
    """Complex conditions with multiple groups."""
    logic: str = Field("AND", description="Logic between groups (AND, OR)")
    groups: list[ConditionGroupCreate] = Field(default_factory=list, description="Condition groups")


class AlertRuleCreate(BaseModel):
    """Request body for creating an alert rule."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "Low Altitude Alert",
                "type": "altitude",
                "operator": "lt",
                "value": "3000",
                "description": "Alert when aircraft below 3000ft",
                "enabled": True,
                "priority": "warning"
            }
        }
    )
    
    name: str = Field(..., description="Alert rule name")
    type: Optional[str] = Field(None, description="Simple rule type")
    operator: str = Field("eq", description="Comparison operator")
    value: Optional[str] = Field(None, description="Comparison value")
    conditions: Optional[ComplexConditionsCreate] = Field(None, description="Complex conditions")
    description: str = Field("", description="Rule description")
    enabled: bool = Field(True, description="Rule enabled status")
    priority: str = Field("info", description="Alert priority (info, warning, critical)")
    starts_at: Optional[datetime] = Field(None, description="Rule activation time")
    expires_at: Optional[datetime] = Field(None, description="Rule expiration time")
    api_url: Optional[str] = Field(None, description="External API to fetch when triggered")


class AlertRuleUpdate(BaseModel):
    """Request body for updating an alert rule."""
    name: Optional[str] = Field(None, description="Rule name")
    operator: Optional[str] = Field(None, description="Comparison operator")
    value: Optional[str] = Field(None, description="Comparison value")
    conditions: Optional[dict] = Field(None, description="Complex conditions")
    description: Optional[str] = Field(None, description="Rule description")
    enabled: Optional[bool] = Field(None, description="Enabled status")
    priority: Optional[str] = Field(None, description="Priority level")
    starts_at: Optional[datetime] = Field(None, description="Activation time")
    expires_at: Optional[datetime] = Field(None, description="Expiration time")
    api_url: Optional[str] = Field(None, description="External API URL")


class AlertRuleResponse(BaseModel):
    """Response for alert rule."""
    id: int = Field(..., description="Rule ID")
    name: str = Field(..., description="Rule name")
    type: Optional[str] = Field(None, description="Rule type")
    operator: Optional[str] = Field(None, description="Comparison operator")
    value: Optional[str] = Field(None, description="Comparison value")
    conditions: Optional[dict] = Field(None, description="Complex conditions")
    description: Optional[str] = Field(None, description="Rule description")
    enabled: bool = Field(True, description="Enabled status")
    priority: str = Field("info", description="Priority level")
    starts_at: Optional[str] = Field(None, description="Activation time")
    expires_at: Optional[str] = Field(None, description="Expiration time")
    api_url: Optional[str] = Field(None, description="External API URL")
    created_at: Optional[str] = Field(None, description="Creation timestamp")
    updated_at: Optional[str] = Field(None, description="Last update timestamp")


class AlertRulesListResponse(BaseModel):
    """Response containing list of alert rules."""
    rules: list[AlertRuleResponse] = Field(default_factory=list, description="List of alert rules")
    count: int = Field(0, description="Number of rules")


class AlertHistoryEntry(BaseModel):
    """Single alert history entry."""
    id: int = Field(..., description="History entry ID")
    rule_id: Optional[int] = Field(None, description="Triggering rule ID")
    rule_name: Optional[str] = Field(None, description="Rule name")
    icao: Optional[str] = Field(None, description="Aircraft ICAO hex")
    callsign: Optional[str] = Field(None, description="Aircraft callsign")
    message: Optional[str] = Field(None, description="Alert message")
    priority: Optional[str] = Field(None, description="Alert priority")
    aircraft_data: Optional[dict] = Field(None, description="Aircraft data snapshot")
    timestamp: str = Field(..., description="Alert timestamp")


class AlertHistoryResponse(BaseModel):
    """Response containing alert history."""
    history: list[AlertHistoryEntry] = Field(default_factory=list, description="Alert history entries")
    count: int = Field(0, description="Number of entries returned")


# ============================================================================
# Safety Schemas
# ============================================================================

class SafetyEventResponse(BaseModel):
    """Single safety event record."""
    id: int = Field(..., description="Event ID")
    event_type: str = Field(..., description="Event type (tcas_ra, tcas_ta, extreme_vs, proximity)")
    severity: str = Field(..., description="Severity level (info, warning, critical)")
    icao: str = Field(..., description="Primary aircraft ICAO hex")
    icao_2: Optional[str] = Field(None, description="Secondary aircraft ICAO hex")
    callsign: Optional[str] = Field(None, description="Primary aircraft callsign")
    callsign_2: Optional[str] = Field(None, description="Secondary aircraft callsign")
    message: Optional[str] = Field(None, description="Event description")
    details: Optional[dict] = Field(None, description="Additional event details")
    aircraft_snapshot: Optional[dict] = Field(None, description="Primary aircraft telemetry at event time")
    aircraft_snapshot_2: Optional[dict] = Field(None, description="Secondary aircraft telemetry (proximity events)")
    timestamp: str = Field(..., description="Event timestamp")


class SafetyEventsListResponse(BaseModel):
    """Response containing safety events."""
    events: list[SafetyEventResponse] = Field(default_factory=list, description="Safety events")
    count: int = Field(0, description="Number of events")


class SafetyStatsResponse(BaseModel):
    """Safety monitoring statistics."""
    monitoring_enabled: bool = Field(..., description="Whether safety monitoring is active")
    thresholds: dict = Field(..., description="Current safety thresholds")
    time_range_hours: int = Field(24, description="Statistics time range")
    events_by_type: dict = Field(default_factory=dict, description="Event count by type")
    events_by_severity: dict = Field(default_factory=dict, description="Event count by severity")
    total_events: int = Field(0, description="Total events in time range")
    recent_events: list[dict] = Field(default_factory=list, description="Most recent events")
    monitor_state: dict = Field(default_factory=dict, description="Monitor internal state")
    timestamp: str = Field(..., description="Response timestamp")


# ============================================================================
# ACARS Schemas
# ============================================================================

class AcarsMessageResponse(BaseModel):
    """Single ACARS/VDL2 message."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": 1,
                "timestamp": "2024-12-21T12:00:00Z",
                "source": "acars",
                "channel": "1",
                "frequency": 130.025,
                "icao_hex": "A12345",
                "registration": "N12345",
                "callsign": "UAL123",
                "label": "H1",
                "text": "DEPARTURE CLEARANCE...",
                "signal_level": -5.2
            }
        }
    )
    
    id: Optional[int] = Field(None, description="Database ID")
    timestamp: str = Field(..., description="Message timestamp")
    source: str = Field(..., description="Message source (acars, vdlm2)")
    channel: Optional[str] = Field(None, description="Receiver channel")
    frequency: Optional[float] = Field(None, description="Frequency in MHz")
    icao_hex: Optional[str] = Field(None, description="Aircraft ICAO hex")
    registration: Optional[str] = Field(None, description="Aircraft registration")
    callsign: Optional[str] = Field(None, description="Flight callsign")
    label: Optional[str] = Field(None, description="ACARS message label")
    block_id: Optional[str] = Field(None, description="Block identifier")
    msg_num: Optional[str] = Field(None, description="Message number")
    ack: Optional[str] = Field(None, description="Acknowledgment status")
    mode: Optional[str] = Field(None, description="ACARS mode")
    text: Optional[str] = Field(None, description="Message text content")
    decoded: Optional[dict] = Field(None, description="Decoded message content")
    signal_level: Optional[float] = Field(None, description="Signal level in dB")
    error_count: Optional[int] = Field(None, description="Bit error count")
    station_id: Optional[str] = Field(None, description="Receiving station ID")


class AcarsMessagesListResponse(BaseModel):
    """Response containing ACARS messages."""
    messages: list[AcarsMessageResponse] = Field(default_factory=list, description="ACARS messages")
    count: int = Field(0, description="Number of messages")
    filters: dict = Field(default_factory=dict, description="Applied filters")


class AcarsStatsResponse(BaseModel):
    """ACARS service statistics."""
    total_messages: int = Field(0, description="Total messages in database")
    last_hour: int = Field(0, description="Messages in last hour")
    last_24h: int = Field(0, description="Messages in last 24 hours")
    by_source: dict = Field(default_factory=dict, description="Count by source")
    top_labels: list[dict] = Field(default_factory=list, description="Most common labels")
    service_stats: dict = Field(default_factory=dict, description="Receiver service stats")


class AcarsStatusResponse(BaseModel):
    """ACARS receiver service status."""
    running: bool = Field(..., description="Service running status")
    acars: dict = Field(default_factory=dict, description="ACARS receiver stats")
    vdlm2: dict = Field(default_factory=dict, description="VDL2 receiver stats")
    buffer_size: int = Field(0, description="Messages in memory buffer")


class AcarsLabelsReference(BaseModel):
    """Reference for ACARS message labels."""
    labels: dict = Field(..., description="Label code to description mapping")
    sources: dict = Field(..., description="Source type descriptions")


# ============================================================================
# Aviation Weather Schemas
# ============================================================================

class AviationDataResponse(BaseModel):
    """Generic aviation data response."""
    data: list[dict] = Field(default_factory=list, description="Aviation data items")
    count: int = Field(0, description="Number of items")
    source: str = Field("aviationweather.gov", description="Data source")
    cached: bool = Field(False, description="Whether data is from cache")
    cache_age_seconds: Optional[int] = Field(None, description="Cache age if cached")


# ============================================================================
# Notification Schemas
# ============================================================================

class NotificationConfigUpdate(BaseModel):
    """Request body for updating notification config."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "apprise_urls": "pover://user@token",
                "cooldown_seconds": 300,
                "enabled": True
            }
        }
    )
    
    apprise_urls: Optional[str] = Field(None, description="Apprise notification URLs (semicolon-separated)")
    cooldown_seconds: Optional[int] = Field(None, description="Cooldown between notifications", ge=0)
    enabled: Optional[bool] = Field(None, description="Enable/disable notifications")


class NotificationConfigResponse(BaseModel):
    """Notification configuration response."""
    enabled: bool = Field(..., description="Notifications enabled")
    apprise_urls: str = Field(..., description="Configured Apprise URLs")
    cooldown_seconds: int = Field(..., description="Cooldown in seconds")
    server_count: int = Field(..., description="Number of notification servers")


class NotificationTestResponse(BaseModel):
    """Response from test notification."""
    success: bool = Field(..., description="Whether notification was sent")
    message: str = Field(..., description="Result message")
    servers_notified: int = Field(0, description="Number of servers notified")


# ============================================================================
# System Schemas
# ============================================================================

class HealthResponse(BaseModel):
    """Health check response."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "healthy",
                "services": {
                    "database": {"status": "up", "latency_ms": 2.5},
                    "ultrafeeder": {"status": "up", "aircraft_count": 45},
                    "redis": {"status": "up"},
                    "sse": {"status": "up", "subscribers": 3}
                },
                "timestamp": "2024-12-21T12:00:00Z"
            }
        }
    )
    
    status: str = Field(..., description="Overall health status (healthy, degraded, unhealthy)")
    services: dict = Field(..., description="Individual service health status")
    timestamp: str = Field(..., description="Health check timestamp")


class StatusResponse(BaseModel):
    """Comprehensive system status."""
    version: str = Field(..., description="API version")
    adsb_online: bool = Field(..., description="ADS-B data source online")
    aircraft_count: int = Field(..., description="Currently tracked aircraft")
    total_sightings: int = Field(..., description="Total sightings in database")
    total_sessions: int = Field(..., description="Total sessions in database")
    active_rules: int = Field(..., description="Active alert rules")
    alert_history_count: int = Field(..., description="Total alert history entries")
    safety_event_count: int = Field(..., description="Total safety events")
    safety_monitoring_enabled: bool = Field(..., description="Safety monitoring active")
    safety_tracked_aircraft: int = Field(..., description="Aircraft tracked for safety")
    notifications_configured: bool = Field(..., description="Notifications configured")
    redis_enabled: bool = Field(..., description="Redis available")
    sse_subscribers: int = Field(..., description="SSE subscriber count")
    sse_tracked_aircraft: int = Field(..., description="Aircraft in SSE state")
    sse_redis_enabled: bool = Field(..., description="SSE using Redis")
    acars_enabled: bool = Field(False, description="ACARS service enabled")
    acars_running: bool = Field(False, description="ACARS service running")
    polling_interval_seconds: int = Field(..., description="Aircraft polling interval")
    db_store_interval_seconds: int = Field(..., description="Database write interval")
    scheduler_running: bool = Field(..., description="Background scheduler running")
    scheduler_jobs: list[dict] = Field(..., description="Scheduled jobs")
    worker_pid: int = Field(..., description="Worker process ID")
    location: dict = Field(..., description="Feeder location")


class SSEStatusResponse(BaseModel):
    """SSE service status."""
    mode: str = Field(..., description="SSE mode (memory, redis)")
    redis_enabled: bool = Field(..., description="Redis backing enabled")
    subscribers: int = Field(..., description="Total subscribers")
    subscribers_local: int = Field(..., description="Local worker subscribers")
    tracked_aircraft: int = Field(..., description="Aircraft in state cache")
    last_publish: Optional[str] = Field(None, description="Last publish time")
    history: dict = Field(default_factory=dict, description="History buffer info")
    timestamp: str = Field(..., description="Status timestamp")


class ApiInfoResponse(BaseModel):
    """API information and available endpoints."""
    version: str = Field(..., description="API version")
    name: str = Field(..., description="API name")
    description: str = Field(..., description="API description")
    endpoints: dict = Field(..., description="Available endpoint groups")


# ============================================================================
# Generic Responses
# ============================================================================

class SuccessResponse(BaseModel):
    """Generic success response."""
    success: bool = Field(True, description="Operation success status")
    message: Optional[str] = Field(None, description="Optional message")


class DeleteResponse(BaseModel):
    """Response for delete operations."""
    deleted: int = Field(..., description="Number of items deleted")
    message: Optional[str] = Field(None, description="Additional information")


class ErrorResponse(BaseModel):
    """Error response."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "error": "Not Found",
                "detail": "Resource not found"
            }
        }
    )

    error: str = Field(..., description="Error type")
    detail: Optional[str] = Field(None, description="Error details")


# ============================================================================
# Audio Transmission Schemas
# ============================================================================

class AudioTransmissionCreate(BaseModel):
    """Request body for creating an audio transmission record."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "frequency_mhz": 121.5,
                "channel_name": "Guard",
                "duration_seconds": 5.2,
                "metadata": {"squelch_level": -85.0}
            }
        }
    )

    frequency_mhz: Optional[float] = Field(None, description="Frequency in MHz")
    channel_name: Optional[str] = Field(None, description="Channel name")
    duration_seconds: Optional[float] = Field(None, description="Audio duration in seconds")
    metadata: Optional[dict] = Field(None, description="Additional metadata")


class AudioTransmissionResponse(BaseModel):
    """Single audio transmission record."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": 1,
                "created_at": "2024-12-28T12:00:00Z",
                "filename": "transmission_1735387200.mp3",
                "s3_url": "https://bucket.s3.amazonaws.com/audio/transmission_1735387200.mp3",
                "file_size_bytes": 45678,
                "duration_seconds": 5.2,
                "frequency_mhz": 121.5,
                "channel_name": "Guard",
                "transcription_status": "completed",
                "transcript": "United 123, cleared for takeoff runway 28L"
            }
        }
    )

    id: int = Field(..., description="Transmission ID")
    created_at: str = Field(..., description="Creation timestamp")
    filename: str = Field(..., description="Audio filename")
    s3_key: Optional[str] = Field(None, description="S3 object key")
    s3_url: Optional[str] = Field(None, description="S3 public URL")
    file_size_bytes: Optional[int] = Field(None, description="File size in bytes")
    duration_seconds: Optional[float] = Field(None, description="Audio duration")
    format: str = Field("mp3", description="Audio format")
    frequency_mhz: Optional[float] = Field(None, description="Frequency in MHz")
    channel_name: Optional[str] = Field(None, description="Channel name")
    transcription_status: str = Field("pending", description="Transcription status")
    transcription_queued_at: Optional[str] = Field(None, description="When queued")
    transcription_completed_at: Optional[str] = Field(None, description="When completed")
    transcription_error: Optional[str] = Field(None, description="Error message if failed")
    transcript: Optional[str] = Field(None, description="Transcription text")
    transcript_confidence: Optional[float] = Field(None, description="Confidence score 0-1")
    transcript_language: Optional[str] = Field(None, description="Detected language")
    metadata: Optional[dict] = Field(None, description="Additional metadata")


class AudioTransmissionListResponse(BaseModel):
    """Response containing list of audio transmissions."""
    transmissions: list[AudioTransmissionResponse] = Field(
        default_factory=list, description="Audio transmissions"
    )
    count: int = Field(0, description="Number of transmissions returned")
    total: int = Field(0, description="Total transmissions matching query")


class AudioUploadResponse(BaseModel):
    """Response from audio upload endpoint."""
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": 1,
                "filename": "transmission_1735387200.mp3",
                "s3_url": "https://bucket.s3.amazonaws.com/audio/transmission_1735387200.mp3",
                "transcription_queued": True,
                "message": "Audio uploaded and queued for transcription"
            }
        }
    )

    id: int = Field(..., description="Transmission ID")
    filename: str = Field(..., description="Stored filename")
    s3_url: Optional[str] = Field(None, description="S3 URL if uploaded")
    transcription_queued: bool = Field(False, description="Whether transcription was queued")
    message: str = Field(..., description="Status message")


class AudioStatsResponse(BaseModel):
    """Audio transmission statistics."""
    total_transmissions: int = Field(0, description="Total transmission records")
    total_transcribed: int = Field(0, description="Successfully transcribed")
    pending_transcription: int = Field(0, description="Awaiting transcription")
    failed_transcription: int = Field(0, description="Failed transcriptions")
    total_duration_hours: float = Field(0.0, description="Total audio hours")
    total_size_mb: float = Field(0.0, description="Total storage size in MB")
    by_channel: dict = Field(default_factory=dict, description="Count by channel")
    by_status: dict = Field(default_factory=dict, description="Count by status")
