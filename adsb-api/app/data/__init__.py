"""Static data for aviation API."""

from .airspace_boundaries import (
    get_all_airspace_boundaries,
    get_airspaces_near_point,
    CLASS_B_AIRSPACE,
    CLASS_C_AIRSPACE,
    CLASS_D_AIRSPACE,
    MOA_AIRSPACE,
)

__all__ = [
    "get_all_airspace_boundaries",
    "get_airspaces_near_point",
    "CLASS_B_AIRSPACE",
    "CLASS_C_AIRSPACE",
    "CLASS_D_AIRSPACE",
    "MOA_AIRSPACE",
]
