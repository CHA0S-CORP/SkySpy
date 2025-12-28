"""
SQLAlchemy database models.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Float, ForeignKey, Index, 
    Integer, String, Text, JSON
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AircraftSighting(Base):
    """Individual aircraft position reports."""
    __tablename__ = "aircraft_sightings"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    icao_hex: Mapped[str] = mapped_column(String(10), index=True, nullable=False)  # TIS-B can have ~ prefix
    callsign: Mapped[Optional[str]] = mapped_column(String(10), index=True)
    squawk: Mapped[Optional[str]] = mapped_column(String(4))
    latitude: Mapped[Optional[float]] = mapped_column(Float)
    longitude: Mapped[Optional[float]] = mapped_column(Float)
    altitude_baro: Mapped[Optional[int]] = mapped_column(Integer)
    altitude_geom: Mapped[Optional[int]] = mapped_column(Integer)
    ground_speed: Mapped[Optional[float]] = mapped_column(Float)
    track: Mapped[Optional[float]] = mapped_column(Float)
    vertical_rate: Mapped[Optional[int]] = mapped_column(Integer)
    distance_nm: Mapped[Optional[float]] = mapped_column(Float)
    rssi: Mapped[Optional[float]] = mapped_column(Float)
    category: Mapped[Optional[str]] = mapped_column(String(4))
    aircraft_type: Mapped[Optional[str]] = mapped_column(String(10))
    is_military: Mapped[bool] = mapped_column(Boolean, default=False)
    is_emergency: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(10), default="1090")


class AircraftSession(Base):
    """Continuous tracking session for an aircraft."""
    __tablename__ = "aircraft_sessions"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    icao_hex: Mapped[str] = mapped_column(String(10), index=True, nullable=False)  # TIS-B can have ~ prefix
    callsign: Mapped[Optional[str]] = mapped_column(String(10), index=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    total_positions: Mapped[int] = mapped_column(Integer, default=0)
    min_altitude: Mapped[Optional[int]] = mapped_column(Integer)
    max_altitude: Mapped[Optional[int]] = mapped_column(Integer)
    min_distance_nm: Mapped[Optional[float]] = mapped_column(Float)
    max_distance_nm: Mapped[Optional[float]] = mapped_column(Float)
    max_vertical_rate: Mapped[Optional[int]] = mapped_column(Integer)
    min_rssi: Mapped[Optional[float]] = mapped_column(Float)
    max_rssi: Mapped[Optional[float]] = mapped_column(Float)
    is_military: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped[Optional[str]] = mapped_column(String(4))
    aircraft_type: Mapped[Optional[str]] = mapped_column(String(10))


class NotificationLog(Base):
    """Log of sent notifications."""
    __tablename__ = "notification_logs"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    notification_type: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    icao_hex: Mapped[Optional[str]] = mapped_column(String(10))
    callsign: Mapped[Optional[str]] = mapped_column(String(10))
    message: Mapped[Optional[str]] = mapped_column(Text)
    details: Mapped[Optional[dict]] = mapped_column(JSON)


class AlertRule(Base):
    """User-defined alert rules with complex conditions and scheduling."""
    __tablename__ = "alert_rules"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    rule_type: Mapped[Optional[str]] = mapped_column(String(30))
    operator: Mapped[str] = mapped_column(String(10), default="eq")
    value: Mapped[Optional[str]] = mapped_column(String(100))
    conditions: Mapped[Optional[dict]] = mapped_column(JSON)
    description: Mapped[Optional[str]] = mapped_column(String(200))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[str] = mapped_column(String(20), default="info")
    starts_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    api_url: Mapped[Optional[str]] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index("idx_alert_rules_type", "rule_type", "enabled"),
    )


class AlertHistory(Base):
    """History of triggered alerts."""
    __tablename__ = "alert_history"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("alert_rules.id", ondelete="SET NULL")
    )
    rule_name: Mapped[Optional[str]] = mapped_column(String(100))
    icao_hex: Mapped[Optional[str]] = mapped_column(String(10), index=True)
    callsign: Mapped[Optional[str]] = mapped_column(String(10))
    message: Mapped[Optional[str]] = mapped_column(Text)
    priority: Mapped[Optional[str]] = mapped_column(String(20))
    aircraft_data: Mapped[Optional[dict]] = mapped_column(JSON)
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class NotificationConfig(Base):
    """Notification configuration."""
    __tablename__ = "notification_config"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    apprise_urls: Mapped[str] = mapped_column(Text, default="")
    cooldown_seconds: Mapped[int] = mapped_column(Integer, default=300)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SafetyEvent(Base):
    """Safety events including TCAS conflicts and dangerous flight parameters."""
    __tablename__ = "safety_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    event_type: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="warning")
    icao_hex: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    icao_hex_2: Mapped[Optional[str]] = mapped_column(String(10), index=True)
    callsign: Mapped[Optional[str]] = mapped_column(String(10))
    callsign_2: Mapped[Optional[str]] = mapped_column(String(10))
    message: Mapped[Optional[str]] = mapped_column(Text)
    details: Mapped[Optional[dict]] = mapped_column(JSON)
    aircraft_snapshot: Mapped[Optional[dict]] = mapped_column(JSON)  # Telemetry at event time
    aircraft_snapshot_2: Mapped[Optional[dict]] = mapped_column(JSON)  # Second aircraft (proximity events)

    __table_args__ = (
        Index("idx_safety_events_type_time", "event_type", "timestamp"),
    )


class AircraftInfo(Base):
    """Cached aircraft information including photos and airframe data."""
    __tablename__ = "aircraft_info"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    icao_hex: Mapped[str] = mapped_column(String(10), unique=True, index=True, nullable=False)
    registration: Mapped[Optional[str]] = mapped_column(String(20), index=True)
    
    # Airframe info
    type_code: Mapped[Optional[str]] = mapped_column(String(10))
    type_name: Mapped[Optional[str]] = mapped_column(String(100))
    manufacturer: Mapped[Optional[str]] = mapped_column(String(100))
    model: Mapped[Optional[str]] = mapped_column(String(100))
    serial_number: Mapped[Optional[str]] = mapped_column(String(50))
    
    # Age and history
    year_built: Mapped[Optional[int]] = mapped_column(Integer)
    first_flight_date: Mapped[Optional[str]] = mapped_column(String(20))
    delivery_date: Mapped[Optional[str]] = mapped_column(String(20))
    airframe_hours: Mapped[Optional[int]] = mapped_column(Integer)
    
    # Operator info
    operator: Mapped[Optional[str]] = mapped_column(String(100))
    operator_icao: Mapped[Optional[str]] = mapped_column(String(4))
    operator_callsign: Mapped[Optional[str]] = mapped_column(String(20))
    owner: Mapped[Optional[str]] = mapped_column(String(200))
    
    # Country and registration
    country: Mapped[Optional[str]] = mapped_column(String(100))
    country_code: Mapped[Optional[str]] = mapped_column(String(3))
    
    # Category
    category: Mapped[Optional[str]] = mapped_column(String(20))
    is_military: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Images
    photo_url: Mapped[Optional[str]] = mapped_column(String(500))
    photo_thumbnail_url: Mapped[Optional[str]] = mapped_column(String(500))
    photo_photographer: Mapped[Optional[str]] = mapped_column(String(100))
    photo_source: Mapped[Optional[str]] = mapped_column(String(50))
    photo_page_link: Mapped[Optional[str]] = mapped_column(String(500))
    
    # Local cached photos
    photo_local_path: Mapped[Optional[str]] = mapped_column(String(500))
    photo_thumbnail_local_path: Mapped[Optional[str]] = mapped_column(String(500))
    
    # Additional data as JSON
    extra_data: Mapped[Optional[dict]] = mapped_column(JSON)
    
    # Cache management
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    fetch_failed: Mapped[bool] = mapped_column(Boolean, default=False)
    
    __table_args__ = (
        Index("idx_aircraft_info_reg", "registration"),
        Index("idx_aircraft_info_operator", "operator_icao"),
    )


class AcarsMessage(Base):
    """ACARS and VDL2 messages received from aircraft."""
    __tablename__ = "acars_messages"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    
    # Message source
    source: Mapped[str] = mapped_column(String(10), default="acars")  # acars, vdlm2
    channel: Mapped[Optional[str]] = mapped_column(String(10))
    frequency: Mapped[Optional[float]] = mapped_column(Float)
    
    # Aircraft identification
    icao_hex: Mapped[Optional[str]] = mapped_column(String(10), index=True)
    registration: Mapped[Optional[str]] = mapped_column(String(20), index=True)
    callsign: Mapped[Optional[str]] = mapped_column(String(10), index=True)
    
    # Message content
    label: Mapped[Optional[str]] = mapped_column(String(10), index=True)
    block_id: Mapped[Optional[str]] = mapped_column(String(5))
    msg_num: Mapped[Optional[str]] = mapped_column(String(10))
    ack: Mapped[Optional[str]] = mapped_column(String(5))
    mode: Mapped[Optional[str]] = mapped_column(String(5))
    text: Mapped[Optional[str]] = mapped_column(Text)
    
    # Decoded content (for known message types)
    decoded: Mapped[Optional[dict]] = mapped_column(JSON)
    
    # Signal info
    signal_level: Mapped[Optional[float]] = mapped_column(Float)
    error_count: Mapped[Optional[int]] = mapped_column(Integer)
    
    # Station info
    station_id: Mapped[Optional[str]] = mapped_column(String(50))
    
    __table_args__ = (
        Index("idx_acars_icao_time", "icao_hex", "timestamp"),
        Index("idx_acars_label", "label", "timestamp"),
    )


class AirspaceAdvisory(Base):
    """Active airspace advisories (G-AIRMETs, SIGMETs) from Aviation Weather Center."""
    __tablename__ = "airspace_advisories"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    # Advisory identification
    advisory_id: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    advisory_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)  # GAIRMET, SIGMET, etc.
    hazard: Mapped[Optional[str]] = mapped_column(String(20), index=True)  # IFR, TURB, ICE, etc.
    severity: Mapped[Optional[str]] = mapped_column(String(20))

    # Time validity
    valid_from: Mapped[Optional[datetime]] = mapped_column(DateTime, index=True)
    valid_to: Mapped[Optional[datetime]] = mapped_column(DateTime, index=True)

    # Altitude range
    lower_alt_ft: Mapped[Optional[int]] = mapped_column(Integer)
    upper_alt_ft: Mapped[Optional[int]] = mapped_column(Integer)

    # Geographic info
    region: Mapped[Optional[str]] = mapped_column(String(20))
    polygon: Mapped[Optional[dict]] = mapped_column(JSON)  # GeoJSON polygon coordinates

    # Raw data
    raw_text: Mapped[Optional[str]] = mapped_column(Text)
    source_data: Mapped[Optional[dict]] = mapped_column(JSON)

    __table_args__ = (
        Index("idx_airspace_advisory_valid", "valid_from", "valid_to"),
        Index("idx_airspace_advisory_type_hazard", "advisory_type", "hazard"),
    )


class AirspaceBoundary(Base):
    """Static airspace boundary data (Class B/C/D, MOAs, Restricted)."""
    __tablename__ = "airspace_boundaries"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    # Airspace identification
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    icao: Mapped[Optional[str]] = mapped_column(String(4), index=True)
    airspace_class: Mapped[str] = mapped_column(String(20), index=True, nullable=False)  # B, C, D, MOA, Restricted

    # Altitude range
    floor_ft: Mapped[int] = mapped_column(Integer, default=0)
    ceiling_ft: Mapped[int] = mapped_column(Integer, default=0)

    # Geographic info
    center_lat: Mapped[float] = mapped_column(Float, index=True)
    center_lon: Mapped[float] = mapped_column(Float, index=True)
    radius_nm: Mapped[Optional[float]] = mapped_column(Float)  # For circular airspaces (Class D)
    polygon: Mapped[Optional[dict]] = mapped_column(JSON)  # GeoJSON polygon coordinates

    # Additional info
    controlling_agency: Mapped[Optional[str]] = mapped_column(String(100))
    schedule: Mapped[Optional[str]] = mapped_column(String(200))

    # Source tracking
    source: Mapped[str] = mapped_column(String(50), default="faa")  # faa, openaip, embedded
    source_id: Mapped[Optional[str]] = mapped_column(String(100))  # External ID for updates

    # Cache management
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_airspace_boundary_class", "airspace_class"),
        Index("idx_airspace_boundary_location", "center_lat", "center_lon"),
    )


class AudioTransmission(Base):
    """Audio transmissions captured from rtl-airband for transcription."""
    __tablename__ = "audio_transmissions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    # Audio file info
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    s3_key: Mapped[Optional[str]] = mapped_column(String(500))
    s3_url: Mapped[Optional[str]] = mapped_column(String(500))
    file_size_bytes: Mapped[Optional[int]] = mapped_column(Integer)
    duration_seconds: Mapped[Optional[float]] = mapped_column(Float)
    format: Mapped[str] = mapped_column(String(10), default="mp3")  # mp3, wav, ogg

    # Source info
    frequency_mhz: Mapped[Optional[float]] = mapped_column(Float, index=True)
    channel_name: Mapped[Optional[str]] = mapped_column(String(100))
    squelch_level: Mapped[Optional[float]] = mapped_column(Float)

    # Transcription status
    transcription_status: Mapped[str] = mapped_column(
        String(20), default="pending", index=True
    )  # pending, queued, processing, completed, failed
    transcription_queued_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    transcription_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    transcription_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    transcription_error: Mapped[Optional[str]] = mapped_column(Text)

    # Transcription result
    transcript: Mapped[Optional[str]] = mapped_column(Text)
    transcript_confidence: Mapped[Optional[float]] = mapped_column(Float)
    transcript_language: Mapped[Optional[str]] = mapped_column(String(10))
    transcript_segments: Mapped[Optional[dict]] = mapped_column(JSON)  # Word-level timestamps

    # Metadata
    metadata: Mapped[Optional[dict]] = mapped_column(JSON)

    __table_args__ = (
        Index("idx_audio_transmission_status", "transcription_status", "created_at"),
        Index("idx_audio_transmission_frequency", "frequency_mhz"),
    )
