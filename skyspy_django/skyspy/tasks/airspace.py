"""
Airspace advisory and boundary refresh tasks.
"""

import contextlib
import logging
from datetime import UTC, datetime

import httpx
from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from skyspy.models import AirspaceAdvisory, AirspaceBoundary
from skyspy.socketio.utils import sync_emit
from skyspy.tasks.locks import singleton_task

logger = logging.getLogger(__name__)


@shared_task
@singleton_task(timeout=600)
def refresh_airspace_advisories():
    """
    Refresh airspace advisories from Aviation Weather Center.

    Fetches G-AIRMETs, SIGMETs, and other advisories.
    Runs every 5 minutes.
    """
    try:
        # Fetch G-AIRMETs
        url = "https://aviationweather.gov/api/data/gairmet"
        response = httpx.get(
            url,
            timeout=30.0,
            params={
                "format": "json",
                "type": "all",
            },
        )

        if response.status_code == 200:
            data = response.json()
            advisories = data if isinstance(data, list) else []

            with transaction.atomic():
                # Find and broadcast expired advisories before deleting
                old_cutoff = timezone.now()
                expired_advisories = AirspaceAdvisory.objects.filter(valid_to__lt=old_cutoff)
                expired_ids = list(expired_advisories.values_list("advisory_id", flat=True))
                expired_count = expired_advisories.count()
                expired_advisories.delete()

                # Broadcast advisory expirations via Socket.IO
                if expired_count > 0:
                    try:
                        sync_emit(
                            "airspace:advisory_expired",
                            {
                                "advisory_ids": expired_ids,
                                "count": expired_count,
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                            },
                            room="topic_aircraft",
                        )
                        logger.debug(f"Broadcast {expired_count} expired advisories")
                    except (
                        Exception
                    ) as e:  # broad: broadcast must never break the caller; sync_emit failure modes unknowable
                        logger.warning(f"Failed to broadcast advisory expiration: {e}")

                # Process new advisories
                for adv in advisories:
                    # Use 'tag' as identifier (new API format) or fall back to old format
                    advisory_id = adv.get("tag") or adv.get("airSigmetId") or adv.get("gairmetId")
                    if not advisory_id:
                        continue

                    # Parse times - handle both new and old API formats
                    valid_from = None
                    valid_to = None

                    # New format: validTime (ISO string), expireTime (unix timestamp)
                    if adv.get("validTime"):
                        try:
                            valid_from = datetime.fromisoformat(
                                adv["validTime"].replace("Z", "+00:00").replace(".000", "")
                            )
                        except (ValueError, TypeError) as e:
                            logger.debug(f"Invalid validTime format: {adv.get('validTime')} - {e}")

                    if adv.get("expireTime"):
                        try:
                            # expireTime is unix timestamp
                            valid_to = datetime.fromtimestamp(int(adv["expireTime"]), tz=UTC)
                        except (ValueError, TypeError) as e:
                            logger.debug(f"Invalid expireTime format: {adv.get('expireTime')} - {e}")

                    # Fall back to old format
                    if not valid_from and adv.get("validTimeFrom"):
                        with contextlib.suppress(ValueError, TypeError):
                            valid_from = datetime.fromisoformat(adv["validTimeFrom"].replace("Z", "+00:00"))

                    if not valid_to and adv.get("validTimeTo"):
                        with contextlib.suppress(ValueError, TypeError):
                            valid_to = datetime.fromisoformat(adv["validTimeTo"].replace("Z", "+00:00"))

                    # Parse geometry - handle new 'coords' format. G-AIRMETs carry
                    # a geometryType: AREA -> a closed/filled polygon; LINE -> an
                    # open line (e.g. freezing level, some LLWS). Preserve that so
                    # the map can stroke lines instead of drawing a bogus closed
                    # polygon.
                    polygon = None
                    geom_type = str(adv.get("geometryType") or adv.get("geom") or "AREA").upper()
                    is_line = geom_type == "LINE"
                    coords = adv.get("coords")
                    if coords and isinstance(coords, list):
                        # Convert coords array to GeoJSON geometry
                        try:
                            ring = [[float(c["lon"]), float(c["lat"])] for c in coords]
                            if is_line:
                                polygon = {"type": "LineString", "coordinates": ring}
                            else:
                                # Close the ring if not already closed
                                if ring and ring[0] != ring[-1]:
                                    ring.append(ring[0])
                                polygon = {"type": "Polygon", "coordinates": [ring]}
                        except (KeyError, ValueError, TypeError) as e:
                            logger.debug(f"Failed to parse coords: {e}")

                    # Fall back to old geometry format
                    if not polygon and adv.get("geometry") and adv["geometry"].get("coordinates"):
                        polygon = {
                            "type": adv["geometry"].get("type", "Polygon"),
                            "coordinates": adv["geometry"]["coordinates"],
                        }

                    # Parse altitude - handle new format (base/top as strings) and old format
                    lower_alt = None
                    upper_alt = None
                    if adv.get("base"):
                        with contextlib.suppress(ValueError, TypeError):
                            lower_alt = int(adv["base"]) if adv["base"] else None
                    if adv.get("top"):
                        with contextlib.suppress(ValueError, TypeError):
                            upper_alt = int(adv["top"]) if adv["top"] else None
                    # Fall back to old format
                    if lower_alt is None:
                        lower_alt = adv.get("altitudeLow1")
                    if upper_alt is None:
                        upper_alt = adv.get("altitudeHi1")

                    AirspaceAdvisory.objects.update_or_create(
                        advisory_id=advisory_id,
                        defaults={
                            "advisory_type": adv.get("hazard", "GAIRMET"),
                            "hazard": adv.get("hazard"),
                            "severity": adv.get("severity"),
                            "valid_from": valid_from,
                            "valid_to": valid_to,
                            "lower_alt_ft": lower_alt,
                            "upper_alt_ft": upper_alt,
                            "region": adv.get("region"),
                            "polygon": polygon,
                            "raw_text": adv.get("rawAirSigmet"),
                            "source_data": adv,
                        },
                    )

            logger.info(f"Refreshed {len(advisories)} airspace advisories")

            # Broadcast update to WebSocket clients via Socket.IO
            try:
                sync_emit(
                    "airspace:advisory",
                    {"count": len(advisories), "timestamp": datetime.utcnow().isoformat() + "Z"},
                    room="topic_aircraft",
                )
            except Exception as e:  # broad: broadcast must never break the caller; sync_emit failure modes unknowable
                logger.warning(f"Failed to broadcast advisory update: {e}")

        else:
            logger.warning(f"Failed to fetch advisories: HTTP {response.status_code}")

    except httpx.HTTPError as e:
        logger.error(f"HTTP error fetching advisories: {e}")
    except Exception as e:  # broad: Celery task top-level guard; must never crash the worker
        logger.exception(f"Error refreshing advisories: {e}")


@shared_task(bind=True, max_retries=3)
@singleton_task(timeout=1800)
def refresh_airspace_boundaries(self):
    """
    Refresh static airspace boundaries from OpenAIP.

    Fetches Class B/C/D airspace boundaries from OpenAIP.
    Runs daily at 3 AM.
    """
    from skyspy.services import openaip

    logger.info("Starting airspace boundary refresh from OpenAIP")

    # Check if OpenAIP is enabled
    if not openaip._is_enabled():
        logger.info("OpenAIP is not enabled, skipping boundary refresh")
        boundary_count = AirspaceBoundary.objects.count()
        return {"status": "disabled", "count": boundary_count}

    try:
        # Single-site feeders only need airspace around their own antenna. The
        # old fixed 11-region CONUS grid fired 11 back-to-back OpenAIP requests
        # per run, which tripped the API's rate limit (429) and stored *nothing*
        # — the boundary table stayed empty. Fetch one region centered on the
        # feeder instead (configurable radius), so the layer actually populates
        # where the map is looking. Extra regions can be added via
        # AIRSPACE_EXTRA_REGIONS (list of [lat, lon, radius_nm]).
        feeder_lat = float(getattr(settings, "FEEDER_LAT", 0) or 0)
        feeder_lon = float(getattr(settings, "FEEDER_LON", 0) or 0)
        radius_nm = float(getattr(settings, "AIRSPACE_FETCH_RADIUS_NM", 250) or 250)
        regions = [(feeder_lat, feeder_lon, radius_nm)]
        regions.extend(
            (float(r[0]), float(r[1]), float(r[2]))
            for r in getattr(settings, "AIRSPACE_EXTRA_REGIONS", []) or []
            if len(r) == 3
        )

        total_stored = 0

        # Fetch all regions first, keeping the slow HTTP calls out of any
        # database transaction (holding a transaction open for minutes
        # would pin a PgBouncer backend connection for the whole fetch)
        fetched_regions = []
        for lat, lon, radius_nm in regions:
            logger.debug(f"Fetching airspaces for region ({lat}, {lon})")
            fetched_regions.append(openaip.get_airspaces(lat, lon, radius_nm))

        # Then write per-region in short transactions
        for airspaces in fetched_regions:
            with transaction.atomic():
                for airspace in airspaces:
                    # Skip if no geometry
                    geometry = airspace.get("geometry")
                    if not geometry:
                        continue

                    airspace_id = airspace.get("id", "")
                    if not airspace_id:
                        continue

                    # Prefer the authoritative ICAO class (A–G) when OpenAIP
                    # supplies it; fall back to the type-based mapping for
                    # unclassified / special-use airspace (restricted, MOA, …).
                    airspace_type = airspace.get("type", "OTHER")
                    airspace_class = airspace.get("icao_class") or _map_openaip_type_to_class(airspace_type)

                    # Calculate center from geometry
                    center_lat, center_lon = _calculate_geometry_center(geometry)

                    # Create or update boundary
                    AirspaceBoundary.objects.update_or_create(
                        source="openaip",
                        source_id=airspace_id,
                        defaults={
                            "name": airspace.get("name", "Unknown"),
                            "airspace_class": airspace_class,
                            "floor_ft": airspace.get("floor_ft") or 0,
                            "ceiling_ft": airspace.get("ceiling_ft") or 0,
                            "center_lat": center_lat,
                            "center_lon": center_lon,
                            "polygon": geometry,
                        },
                    )
                    total_stored += 1

        boundary_count = AirspaceBoundary.objects.count()
        logger.info(
            f"Airspace boundary refresh complete. Processed {total_stored} airspaces, {boundary_count} total in database."
        )

        # Broadcast update via Socket.IO
        try:
            sync_emit(
                "airspace:boundary",
                {"count": boundary_count, "new": total_stored, "timestamp": datetime.utcnow().isoformat() + "Z"},
                room="topic_aircraft",
            )
        except Exception as e:  # broad: broadcast must never break the caller; sync_emit failure modes unknowable
            logger.warning(f"Failed to broadcast boundary update: {e}")

        return {"status": "complete", "processed": total_stored, "total": boundary_count}

    except Exception as e:  # broad: Celery task top-level guard; captures any failure to trigger retry
        logger.error(f"Failed to refresh airspace boundaries: {e}")
        raise self.retry(exc=e, countdown=300)


def _map_openaip_type_to_class(airspace_type: str) -> str:
    """Map OpenAIP airspace type to standard class."""
    type_mapping = {
        "CTR": "D",
        "TMA": "C",
        "CTA": "C",
        "ATZ": "D",
        "MATZ": "D",
        "RESTRICTED": "RESTRICTED",
        "PROHIBITED": "PROHIBITED",
        "DANGER": "WARNING",
        "WARNING": "WARNING",
        "ALERT": "ALERT",
        "MOA": "MOA",
        "TFR": "TFR",
        "FIR": "E",
        "UIR": "E",
        "ADIZ": "E",
        "GLIDING": "E",
        "PARACHUTE": "E",
        "MTR": "E",
        "AIRWAY": "E",
    }
    return type_mapping.get(airspace_type, "E")


def _calculate_geometry_center(geometry: dict) -> tuple:
    """Calculate the center point of a GeoJSON geometry."""
    coords = []

    def extract_coords(geom):
        geom_type = geom.get("type", "")
        coordinates = geom.get("coordinates", [])

        if geom_type == "Point":
            coords.append(coordinates)
        elif geom_type in ("LineString", "MultiPoint"):
            coords.extend(coordinates)
        elif geom_type in ("Polygon", "MultiLineString"):
            for ring in coordinates:
                if isinstance(ring, list):
                    coords.extend(ring)
        elif geom_type == "MultiPolygon":
            for polygon in coordinates:
                if isinstance(polygon, list):
                    for ring in polygon:
                        if isinstance(ring, list):
                            coords.extend(ring)
        elif geom_type == "GeometryCollection":
            for g in geom.get("geometries", []):
                extract_coords(g)

    extract_coords(geometry)

    if not coords:
        return (0.0, 0.0)

    # Calculate average (centroid approximation)
    lons = [c[0] for c in coords if isinstance(c, (list, tuple)) and len(c) >= 2]
    lats = [c[1] for c in coords if isinstance(c, (list, tuple)) and len(c) >= 2]

    if not lons or not lats:
        return (0.0, 0.0)

    return (sum(lats) / len(lats), sum(lons) / len(lons))
