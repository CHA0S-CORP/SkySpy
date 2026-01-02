"""Static data for aviation API."""

from .airspace_boundaries import (
    get_all_airspace_boundaries,
    get_airspaces_near_point,
    CLASS_B_AIRSPACE,
    CLASS_C_AIRSPACE,
    CLASS_D_AIRSPACE,
    MOA_AIRSPACE,
)

from .airlines import (
    AIRLINES,
    find_airline_by_iata,
    find_airline_by_icao,
)

from .message_labels import (
    MESSAGE_LABELS,
    lookup_label,
    get_label_name,
)

__all__ = [
    "get_all_airspace_boundaries",
    "get_airspaces_near_point",
    "CLASS_B_AIRSPACE",
    "CLASS_C_AIRSPACE",
    "CLASS_D_AIRSPACE",
    "MOA_AIRSPACE",
    "AIRLINES",
    "find_airline_by_iata",
    "find_airline_by_icao",
    "MESSAGE_LABELS",
    "lookup_label",
    "get_label_name",
]
