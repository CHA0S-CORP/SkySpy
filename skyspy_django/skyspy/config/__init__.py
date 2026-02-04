"""
SkySpy configuration modules.

This package provides centralized configuration for different deployment
environments and optimization profiles.

Available modules:
- rpi: Raspberry Pi-specific configuration and optimizations
"""

from skyspy.config.rpi import (
    RPiConfig,
    get_cache_size,
    get_rpi_config,
    get_task_interval,
    rpi_config,
)

__all__ = [
    "RPiConfig",
    "get_rpi_config",
    "rpi_config",
    "get_cache_size",
    "get_task_interval",
]
