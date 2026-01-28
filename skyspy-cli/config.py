"""
SkySpy CLI Configuration Management
Handles settings file loading, saving, and defaults
"""

import json
import os
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any

# Config file locations
CONFIG_DIR = Path.home() / ".config" / "skyspy"
CONFIG_FILE = CONFIG_DIR / "settings.json"
OVERLAYS_DIR = CONFIG_DIR / "overlays"


@dataclass
class DisplaySettings:
    """Display and UI settings"""
    theme: str = "classic"
    show_labels: bool = True
    show_trails: bool = False
    refresh_rate: int = 10  # FPS
    compact_mode: bool = False
    show_acars: bool = True
    show_target_list: bool = True
    # Pro features
    show_vu_meters: bool = True
    show_spectrum: bool = True
    show_frequencies: bool = True
    show_stats_panel: bool = True


@dataclass
class RadarSettings:
    """Radar scope settings"""
    default_range: int = 100
    range_rings: int = 4
    sweep_speed: int = 6  # degrees per tick
    show_compass: bool = True
    show_grid: bool = False
    show_overlays: bool = True
    overlay_color: str = "cyan"


@dataclass
class FilterSettings:
    """Aircraft filter settings"""
    military_only: bool = False
    min_altitude: Optional[int] = None
    max_altitude: Optional[int] = None
    min_distance: Optional[float] = None
    max_distance: Optional[float] = None
    hide_ground: bool = False


@dataclass
class ConnectionSettings:
    """Server connection settings"""
    host: str = "localhost"
    port: int = 80
    receiver_lat: float = 0.0
    receiver_lon: float = 0.0
    auto_reconnect: bool = True
    reconnect_delay: int = 2


@dataclass
class AudioSettings:
    """Audio feedback settings"""
    enabled: bool = False
    new_aircraft_sound: bool = True
    emergency_sound: bool = True
    military_sound: bool = False


@dataclass
class OverlayConfig:
    """Single overlay configuration"""
    path: str
    enabled: bool = True
    color: Optional[str] = None
    name: Optional[str] = None


@dataclass
class OverlaySettings:
    """Overlay management settings"""
    overlays: List[Dict[str, Any]] = field(default_factory=list)
    custom_range_rings: List[int] = field(default_factory=list)  # Additional range ring distances


@dataclass
class Config:
    """Main configuration container"""
    display: DisplaySettings = field(default_factory=DisplaySettings)
    radar: RadarSettings = field(default_factory=RadarSettings)
    filters: FilterSettings = field(default_factory=FilterSettings)
    connection: ConnectionSettings = field(default_factory=ConnectionSettings)
    audio: AudioSettings = field(default_factory=AudioSettings)
    overlays: OverlaySettings = field(default_factory=OverlaySettings)

    # Recent connections
    recent_hosts: list = field(default_factory=list)

    def to_dict(self) -> dict:
        """Convert config to dictionary"""
        return {
            "display": asdict(self.display),
            "radar": asdict(self.radar),
            "filters": asdict(self.filters),
            "connection": asdict(self.connection),
            "audio": asdict(self.audio),
            "overlays": asdict(self.overlays),
            "recent_hosts": self.recent_hosts,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Config":
        """Create config from dictionary"""
        config = cls()

        if "display" in data:
            # Handle missing new fields gracefully
            display_data = data["display"]
            known_fields = {f.name for f in DisplaySettings.__dataclass_fields__.values()}
            filtered = {k: v for k, v in display_data.items() if k in known_fields}
            config.display = DisplaySettings(**filtered)

        if "radar" in data:
            radar_data = data["radar"]
            known_fields = {f.name for f in RadarSettings.__dataclass_fields__.values()}
            filtered = {k: v for k, v in radar_data.items() if k in known_fields}
            config.radar = RadarSettings(**filtered)

        if "filters" in data:
            filters_data = data["filters"]
            known_fields = {f.name for f in FilterSettings.__dataclass_fields__.values()}
            filtered = {k: v for k, v in filters_data.items() if k in known_fields}
            config.filters = FilterSettings(**filtered)

        if "connection" in data:
            conn_data = data["connection"]
            known_fields = {f.name for f in ConnectionSettings.__dataclass_fields__.values()}
            filtered = {k: v for k, v in conn_data.items() if k in known_fields}
            config.connection = ConnectionSettings(**filtered)

        if "audio" in data:
            audio_data = data["audio"]
            known_fields = {f.name for f in AudioSettings.__dataclass_fields__.values()}
            filtered = {k: v for k, v in audio_data.items() if k in known_fields}
            config.audio = AudioSettings(**filtered)

        if "overlays" in data:
            overlay_data = data["overlays"]
            known_fields = {f.name for f in OverlaySettings.__dataclass_fields__.values()}
            filtered = {k: v for k, v in overlay_data.items() if k in known_fields}
            config.overlays = OverlaySettings(**filtered)

        if "recent_hosts" in data:
            config.recent_hosts = data["recent_hosts"]

        return config


def ensure_config_dir():
    """Ensure config directory exists"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    OVERLAYS_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> Config:
    """Load configuration from file or return defaults"""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r") as f:
                data = json.load(f)
            return Config.from_dict(data)
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            # Invalid config, return defaults
            pass
    return Config()


def save_config(config: Config):
    """Save configuration to file"""
    ensure_config_dir()
    with open(CONFIG_FILE, "w") as f:
        json.dump(config.to_dict(), f, indent=2)


def get_config_path() -> Path:
    """Get the config file path"""
    return CONFIG_FILE


def get_overlays_dir() -> Path:
    """Get the overlays directory path"""
    ensure_config_dir()
    return OVERLAYS_DIR
