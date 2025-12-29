"""
Application configuration using Pydantic settings.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # ADS-B Sources
    ultrafeeder_host: str = "ultrafeeder"
    ultrafeeder_port: str = "80"
    dump978_host: str = "dump978"
    dump978_port: str = "80"
    
    # Prometheus (optional)
    prometheus_host: str = "prometheus"
    prometheus_port: str = "9090"
    
    # Database
    database_url: str = "postgresql://adsb:adsb@postgres:5432/adsb"
    
    # Feeder Location
    feeder_lat: float = 47.9377
    feeder_lon: float = -121.9687
    
    # Cache
    cache_ttl: int = 5
    
    # Notifications
    apprise_urls: str = ""
    notification_cooldown: int = 300
    
    # Polling
    polling_interval: int = 2
    db_store_interval: int = 10
    
    # Redis (optional)
    redis_url: str = ""
    redis_enabled: bool = False
    
    # Safety Monitoring
    safety_monitoring_enabled: bool = True
    safety_vs_change_threshold: int = 2000  # Min VS change for reversal alerts
    safety_vs_extreme_threshold: int = 6000  # Extreme VS (6000+ fpm is unusual)
    safety_proximity_nm: float = 0.5  # Tighter proximity threshold (was 1.0)
    safety_altitude_diff_ft: int = 500  # Tighter altitude threshold (was 1000)
    safety_closure_rate_kt: float = 200
    safety_tcas_vs_threshold: int = 1500  # Min VS for TCAS RA detection
    
    # Default Alerts
    proximity_alert_nm: float = 5.0
    watch_icao_list: str = ""
    watch_flight_list: str = ""
    alert_military: bool = True
    alert_emergency: bool = True
    
    # ACARS Settings
    acars_port: int = 5555
    vdlm2_port: int = 5556
    acars_enabled: bool = True
    
    # Photo Cache
    photo_cache_enabled: bool = True
    photo_cache_dir: str = "/data/photos"
    photo_auto_download: bool = True
    
    # S3 Storage (optional - for photo cache)
    s3_enabled: bool = False
    s3_bucket: str = ""
    s3_region: str = "us-east-1"
    s3_access_key: Optional[str] = None
    s3_secret_key: Optional[str] = None
    s3_endpoint_url: Optional[str] = None  # For MinIO, Wasabi, etc.
    s3_prefix: str = "aircraft-photos"  # Key prefix in bucket
    s3_public_url: Optional[str] = None  # Public URL base for serving (e.g., CDN)
    
    # OpenSky Database
    opensky_db_path: str = "/data/opensky/aircraft-database.csv"
    opensky_db_enabled: bool = True
    
    # Server
    port: int = 5000

    # RTL-Airband Radio
    radio_enabled: bool = True
    radio_audio_dir: str = "/data/radio"  # Directory for storing audio files
    radio_max_file_size_mb: int = 50  # Max upload size in MB
    radio_retention_days: int = 7  # Days to keep audio files
    radio_s3_prefix: str = "radio-transmissions"  # S3 prefix for audio files

    # Transcription
    transcription_enabled: bool = False
    transcription_service_url: Optional[str] = None  # External transcription API endpoint

    # Whisper (local speech-to-text)
    whisper_enabled: bool = False
    whisper_url: str = "http://whisper:9000"

    @property
    def ultrafeeder_url(self) -> str:
        return f"http://{self.ultrafeeder_host}:{self.ultrafeeder_port}"
    
    @property
    def dump978_url(self) -> str:
        return f"http://{self.dump978_host}:{self.dump978_port}"
    
    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
