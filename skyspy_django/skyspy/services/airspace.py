"""
Airspace data service.

Fetches, stores, and caches airspace data including:
- Active advisories (G-AIRMETs) from Aviation Weather Center
- Static airspace boundaries (Class B/C/D, MOAs, Restricted)

Data is refreshed via Celery tasks and stored in the database.
Falls back to cached data if database is unavailable.
"""

import logging
from datetime import datetime
from math import cos, radians

from django.core.cache import cache
from django.utils import timezone

from skyspy.models import AirspaceAdvisory, AirspaceBoundary

logger = logging.getLogger(__name__)

# Cache keys
ADVISORY_CACHE_KEY = "airspace_advisories"
BOUNDARY_CACHE_KEY = "airspace_boundaries"
CACHE_TTL = 600  # 10 minutes


def _polygon_bounds(polygon) -> tuple[float, float, float, float] | None:
    """
    Extract a (min_lon, min_lat, max_lon, max_lat) bounding box from an
    advisory polygon (GeoJSON dict or nested coordinate lists).

    Returns None if no coordinates can be found.
    """
    coords: list[tuple[float, float]] = []

    def _collect(node):
        if isinstance(node, dict):
            _collect(node.get("coordinates"))
        elif isinstance(node, (list, tuple)):
            if len(node) >= 2 and all(isinstance(v, (int, float)) for v in node[:2]):
                coords.append((float(node[0]), float(node[1])))
            else:
                for item in node:
                    _collect(item)

    _collect(polygon)

    if not coords:
        return None

    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return min(lons), min(lats), max(lons), max(lats)


def _advisory_covers_point(advisory: dict, lat: float, lon: float) -> bool:
    """
    Check whether an advisory's polygon bounding box contains a point.

    Advisories without usable geometry are included (can't rule them out).
    """
    bounds = _polygon_bounds(advisory.get("polygon"))
    if bounds is None:
        return True
    min_lon, min_lat, max_lon, max_lat = bounds
    return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon


# Candidate prefilter margin (nm) for get_boundaries — half-span of a large
# ARTCC, so an airspace whose CENTER is far from the query point but whose
# extent still reaches it survives the cheap DB center-box prefilter and is then
# refined against its real polygon bbox.
_BOUNDARY_PREFILTER_MARGIN_NM = 300


def _boundary_matches_location(polygon, center_lat, center_lon, lat: float, lon: float, radius_nm: float) -> bool:
    """True if an airspace covers or lies within radius of the point.

    Tests the airspace's polygon bounding box (expanded by radius_nm) so a large
    airspace whose CENTER is far away but whose extent still reaches the point is
    kept — the previous center-only test dropped exactly those. Falls back to the
    stored center when there is no usable geometry (e.g. circular airspaces).
    """
    lat_margin = radius_nm / 60.0
    lon_margin = radius_nm / (60.0 * (abs(cos(radians(lat))) or 1.0))
    bounds = _polygon_bounds(polygon)
    if bounds is None:
        if center_lat is None or center_lon is None:
            return True
        return abs(center_lat - lat) <= lat_margin and abs(center_lon - lon) <= lon_margin
    min_lon, min_lat, max_lon, max_lat = bounds
    return (min_lat - lat_margin) <= lat <= (max_lat + lat_margin) and (min_lon - lon_margin) <= lon <= (
        max_lon + lon_margin
    )


def get_advisories(
    lat: float | None = None,
    lon: float | None = None,
    hazard: str | None = None,
    advisory_type: str | None = None,
) -> list[dict]:
    """
    Get active airspace advisories.

    Args:
        lat: Optional latitude for location filtering
        lon: Optional longitude for location filtering
        hazard: Optional hazard type filter (e.g., 'IFR', 'MTN_OBSCN', 'TURB')
        advisory_type: Optional advisory type filter (e.g., 'GAIRMET', 'SIGMET')

    Returns:
        List of advisory dictionaries
    """
    now = timezone.now()

    # Query active advisories
    queryset = AirspaceAdvisory.objects.filter(valid_from__lte=now, valid_to__gte=now)

    if hazard:
        queryset = queryset.filter(hazard=hazard)

    if advisory_type:
        queryset = queryset.filter(advisory_type=advisory_type)

    advisories = []
    for adv in queryset.order_by("-valid_from")[:100]:
        advisories.append(_serialize_advisory(adv))

    # If no results, try cache
    if not advisories:
        cached = cache.get(ADVISORY_CACHE_KEY)
        if cached:
            logger.debug("Using cached advisories")
            advisories = cached
            if hazard:
                advisories = [a for a in advisories if a.get("hazard") == hazard]
            if advisory_type:
                advisories = [a for a in advisories if a.get("advisory_type") == advisory_type]

    # Location filter: keep advisories whose polygon bounding box contains the
    # point (advisories without geometry are kept to avoid hiding hazards)
    if lat is not None and lon is not None:
        advisories = [a for a in advisories if _advisory_covers_point(a, lat, lon)]

    return advisories


def get_boundaries(
    lat: float | None = None,
    lon: float | None = None,
    radius_nm: float = 100,
    airspace_class: str | None = None,
) -> list[dict]:
    """
    Get airspace boundaries.

    Args:
        lat: Optional latitude for location filtering
        lon: Optional longitude for location filtering
        radius_nm: Radius in nautical miles for location filtering
        airspace_class: Optional class filter (e.g., 'B', 'C', 'D', 'MOA')

    Returns:
        List of boundary dictionaries
    """
    queryset = AirspaceBoundary.objects.all()

    if airspace_class:
        queryset = queryset.filter(airspace_class=airspace_class)

    # Filter by location if provided
    if lat is not None and lon is not None:
        # Approximate degrees per NM
        nm_per_deg_lat = 60
        nm_per_deg_lon = 60 * abs(cos(radians(lat))) if lat is not None else 60

        # Widen the cheap DB prefilter by the max-airspace-span margin so large
        # airspaces become candidates; the polygon-bbox refine below removes any
        # that don't actually reach the point.
        margin_deg = _BOUNDARY_PREFILTER_MARGIN_NM / 60.0
        lat_range = radius_nm / nm_per_deg_lat + margin_deg
        lon_range = radius_nm / nm_per_deg_lon + margin_deg

        queryset = queryset.filter(
            center_lat__gte=lat - lat_range,
            center_lat__lte=lat + lat_range,
            center_lon__gte=lon - lon_range,
            center_lon__lte=lon + lon_range,
        )

    boundaries = []
    for boundary in queryset.order_by("airspace_class", "name"):
        if (
            lat is not None
            and lon is not None
            and not _boundary_matches_location(
                boundary.polygon, boundary.center_lat, boundary.center_lon, lat, lon, radius_nm
            )
        ):
            continue
        boundaries.append(_serialize_boundary(boundary))
        if len(boundaries) >= 200:
            break

    # If no results, try cache
    if not boundaries:
        cached = cache.get(BOUNDARY_CACHE_KEY)
        if cached:
            logger.debug("Using cached boundaries")
            boundaries = cached

            if airspace_class:
                boundaries = [b for b in boundaries if b.get("airspace_class") == airspace_class]

            if lat is not None and lon is not None:
                boundaries = [
                    b
                    for b in boundaries
                    if _boundary_matches_location(
                        b.get("polygon"), b.get("center_lat"), b.get("center_lon"), lat, lon, radius_nm
                    )
                ]

    return boundaries


def get_advisory_history(
    start_time: datetime,
    end_time: datetime | None = None,
    hazard: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """
    Get historical airspace advisories for a time range.

    Args:
        start_time: Start of time range
        end_time: Optional end of time range (defaults to now)
        hazard: Optional hazard type filter
        limit: Maximum number of results

    Returns:
        List of advisory dictionaries
    """
    if end_time is None:
        end_time = timezone.now()

    queryset = AirspaceAdvisory.objects.filter(
        valid_from__gte=start_time,
        valid_from__lte=end_time,
    )

    if hazard:
        queryset = queryset.filter(hazard=hazard)

    advisories = []
    for adv in queryset.order_by("-valid_from")[:limit]:
        advisories.append(_serialize_advisory(adv))

    return advisories


def get_airspace_snapshot(
    lat: float | None = None,
    lon: float | None = None,
    radius_nm: float = 100,
) -> dict:
    """
    Get complete airspace snapshot for a location.

    Returns both advisories and boundaries.
    """
    advisories = get_advisories(lat=lat, lon=lon)
    boundaries = get_boundaries(lat=lat, lon=lon, radius_nm=radius_nm)

    return {
        "advisories": advisories,
        "boundaries": boundaries,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


def update_advisory_cache(advisories: list[dict]):
    """Update the advisory cache."""
    cache.set(ADVISORY_CACHE_KEY, advisories, timeout=CACHE_TTL)


def update_boundary_cache(boundaries: list[dict]):
    """Update the boundary cache."""
    cache.set(BOUNDARY_CACHE_KEY, boundaries, timeout=CACHE_TTL)


# =============================================================================
# Broadcasting
# =============================================================================


def broadcast_advisory_update(advisories: list[dict]):
    """Broadcast advisory update to WebSocket clients."""
    from skyspy.socketio.utils import sync_emit

    try:
        sync_emit(
            "airspace:update",
            {
                "update_type": "advisory",
                "advisories": advisories,
                "count": len(advisories),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            room="topic_airspace",
        )
    except Exception as e:  # broad: broadcast must never break the caller; sync_emit failure modes unknowable
        logger.warning(f"Failed to broadcast advisory update: {e}")


def broadcast_boundary_update(boundaries: list[dict]):
    """Broadcast boundary update to WebSocket clients."""
    from skyspy.socketio.utils import sync_emit

    try:
        sync_emit(
            "airspace:update",
            {
                "update_type": "boundary",
                "boundaries": boundaries,
                "count": len(boundaries),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            room="topic_airspace",
        )
    except Exception as e:  # broad: broadcast must never break the caller; sync_emit failure modes unknowable
        logger.warning(f"Failed to broadcast boundary update: {e}")


def broadcast_advisory_expired(advisory_ids: list[str]):
    """Broadcast advisory expiration to WebSocket clients."""
    from skyspy.socketio.utils import sync_emit

    try:
        sync_emit(
            "airspace:update",
            {
                "update_type": "advisory_expired",
                "advisory_ids": advisory_ids,
                "count": len(advisory_ids),
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            room="topic_airspace",
        )
    except Exception as e:  # broad: broadcast must never break the caller; sync_emit failure modes unknowable
        logger.warning(f"Failed to broadcast advisory expiration: {e}")


# =============================================================================
# Serialization
# =============================================================================


def _serialize_advisory(adv: AirspaceAdvisory) -> dict:
    """Serialize advisory model to dict."""
    return {
        "id": adv.id,
        "advisory_id": adv.advisory_id,
        "advisory_type": adv.advisory_type,
        "hazard": adv.hazard,
        "severity": adv.severity,
        "valid_from": adv.valid_from.isoformat() if adv.valid_from else None,
        "valid_to": adv.valid_to.isoformat() if adv.valid_to else None,
        "lower_alt_ft": adv.lower_alt_ft,
        "upper_alt_ft": adv.upper_alt_ft,
        "region": adv.region,
        "polygon": adv.polygon,
        "raw_text": adv.raw_text,
    }


def _serialize_boundary(boundary: AirspaceBoundary) -> dict:
    """Serialize boundary model to dict."""
    polygon = None
    if boundary.polygon:
        if isinstance(boundary.polygon, dict):
            polygon = boundary.polygon.get("coordinates", [[]])[0] if boundary.polygon.get("coordinates") else None
        elif isinstance(boundary.polygon, list):
            polygon = boundary.polygon

    return {
        "id": boundary.id,
        "name": boundary.name,
        "icao": boundary.icao,
        "airspace_class": boundary.airspace_class,
        "floor_ft": boundary.floor_ft,
        "ceiling_ft": boundary.ceiling_ft,
        "center_lat": boundary.center_lat,
        "center_lon": boundary.center_lon,
        "radius_nm": boundary.radius_nm,
        "polygon": polygon,
        "controlling_agency": boundary.controlling_agency,
        "schedule": boundary.schedule,
    }


# =============================================================================
# Statistics
# =============================================================================


def get_airspace_stats() -> dict:
    """Get airspace data statistics."""
    now = timezone.now()

    active_advisories = AirspaceAdvisory.objects.filter(valid_from__lte=now, valid_to__gte=now).count()

    total_advisories = AirspaceAdvisory.objects.count()
    total_boundaries = AirspaceBoundary.objects.count()

    # Count by hazard type
    from django.db.models import Count

    by_hazard = dict(
        AirspaceAdvisory.objects.filter(valid_from__lte=now, valid_to__gte=now)
        .values("hazard")
        .annotate(count=Count("id"))
        .values_list("hazard", "count")
    )

    # Count boundaries by class
    by_class = dict(
        AirspaceBoundary.objects.values("airspace_class")
        .annotate(count=Count("id"))
        .values_list("airspace_class", "count")
    )

    return {
        "active_advisories": active_advisories,
        "total_advisories": total_advisories,
        "total_boundaries": total_boundaries,
        "advisories_by_hazard": by_hazard,
        "boundaries_by_class": by_class,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
