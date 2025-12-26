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
    safety_vs_change_threshold: int = 3000
    safety_vs_extreme_threshold: int = 4500
    safety_proximity_nm: float = 1.0
    safety_altitude_diff_ft: int = 1000
    safety_closure_rate_kt: float = 200
    safety_tcas_vs_threshold: int = 1500
    
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
    
    # OpenSky Database
    opensky_db_path: str = "/data/opensky/aircraft-database.csv"
    opensky_db_enabled: bool = True
    
    # Server
    port: int = 5000
    
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
