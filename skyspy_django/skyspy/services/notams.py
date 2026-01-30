"""
NOTAM (Notice to Air Missions) service.

Fetches, parses, and caches NOTAM data from FAA Aviation Weather API.
Includes support for TFR (Temporary Flight Restriction) boundaries.
"""
import logging
from datetime import datetime, timedelta
from math import radians, cos, sin, sqrt, atan2
from typing import Optional, List, Dict, Any

import httpx
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from skyspy.models.notams import CachedNotam
from skyspy.services.cache import cached_with_ttl

logger = logging.getLogger(__name__)

# FAA NOTAM API
# Note: The aviationweather.gov NOTAM endpoint was deprecated in late 2025.
# NOTAMs are now available via:
#   - FAA SWIM Cloud Distribution Service (requires registration)
#   - NASA DIP API at https://dip.amesaero.nasa.gov (requires registration)
#   - FAA NOTAM Search at https://notams.aim.faa.gov/notamSearch/
#
# For now, we use the FAA NOTAM Search API which may have rate limits
FAA_NOTAM_API_URL = "https://notams.aim.faa.gov/notamSearch/search"

# TFR data is still available from tfr.faa.gov
TFR_DATA_URL = "https://tfr.faa.gov/tfr2/list.json"

# Refresh interval (15 minutes)
REFRESH_INTERVAL_SECONDS = 900

# In-memory cache metadata
_last_refresh: Optional[datetime] = None


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in nautical miles between two points."""
    R = 3440.065  # Earth radius in NM
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def fetch_notams_from_api(
    icao: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 100,
    notam_type: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch NOTAMs from FAA NOTAM Search API.

    Args:
        icao: Airport ICAO code (e.g., 'KSEA')
        lat: Center latitude for area search
        lon: Center longitude for area search
        radius_nm: Search radius in nautical miles
        notam_type: Filter by NOTAM type (D, FDC, TFR, GPS)

    Returns:
        List of NOTAM dictionaries
    """
    # Build search parameters for FAA NOTAM Search
    search_params = {
        "searchType": 0,  # 0 = by location
        "notamsOnly": False,
        "designatorsForLocation": icao.upper() if icao else "",
    }

    # If searching by coordinates, use a different approach
    if lat is not None and lon is not None and not icao:
        # FAA NOTAM Search doesn't support direct coordinate search well
        # So we'll try TFR endpoint instead for area searches
        return fetch_tfrs_from_api(lat, lon, radius_nm)

    try:
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            response = client.post(
                FAA_NOTAM_API_URL,
                json=search_params,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Origin": "https://notams.aim.faa.gov",
                    "Referer": "https://notams.aim.faa.gov/notamSearch/",
                }
            )

            if response.status_code == 404:
                logger.warning("FAA NOTAM API returned 404 - endpoint may have changed")
                return []

            response.raise_for_status()

            # Check if response is JSON before parsing
            content_type = response.headers.get("content-type", "")
            if "json" not in content_type and "javascript" not in content_type:
                logger.warning(f"NOTAM API returned non-JSON content-type: {content_type}")
                return []

            data = response.json() if response.text else {}

            # Parse the FAA NOTAM Search response format
            notams = []
            if isinstance(data, dict):
                notam_list = data.get("notamList", [])
                for item in notam_list:
                    notams.append({
                        "id": item.get("notamNumber") or item.get("id"),
                        "notamId": item.get("notamNumber"),
                        "type": item.get("classification", "D"),
                        "icaoId": item.get("facilityDesignator") or icao,
                        "location": item.get("facilityDesignator") or icao,
                        "text": item.get("traditionalMessage") or item.get("text", ""),
                        "effectiveStart": item.get("effectiveStart") or item.get("startValidity"),
                        "effectiveEnd": item.get("effectiveEnd") or item.get("endValidity"),
                        "lat": item.get("coordinates", {}).get("latitude"),
                        "lon": item.get("coordinates", {}).get("longitude"),
                    })
                return notams
            elif isinstance(data, list):
                return data

            return []

    except httpx.HTTPStatusError as e:
        logger.error(f"NOTAM API HTTP error: {e.response.status_code}")
        return []
    except Exception as e:
        logger.error(f"NOTAM API request failed: {e}")
        return []


def fetch_tfrs_from_api(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 500,
) -> List[Dict[str, Any]]:
    """
    Fetch TFRs from FAA TFR data feed.

    Args:
        lat: Center latitude for filtering
        lon: Center longitude for filtering
        radius_nm: Search radius in nautical miles

    Returns:
        List of TFR dictionaries
    """
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            response = client.get(
                TFR_DATA_URL,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "application/json",
                }
            )

            if response.status_code == 404:
                logger.warning("FAA TFR API returned 404 - endpoint may have changed")
                return []

            response.raise_for_status()

            # Check if response is JSON before parsing
            content_type = response.headers.get("content-type", "")
            if "json" not in content_type and "javascript" not in content_type:
                logger.warning(f"TFR API returned non-JSON content-type: {content_type}")
                return []

            data = response.json() if response.text else []

            tfrs = []
            tfr_list = data if isinstance(data, list) else data.get("tfrs", [])

            for item in tfr_list:
                tfr = {
                    "id": item.get("notam") or item.get("id"),
                    "notamId": item.get("notam"),
                    "type": "TFR",
                    "text": item.get("txtDescrUSNS") or item.get("description", ""),
                    "effectiveStart": item.get("dateEffective"),
                    "effectiveEnd": item.get("dateExpire"),
                    "reason": item.get("txtDescrModern") or item.get("type"),
                    "geometry": item.get("geometry"),
                }

                # Extract coordinates if available
                if item.get("lat"):
                    tfr["lat"] = float(item.get("lat"))
                if item.get("lng") or item.get("lon"):
                    tfr["lon"] = float(item.get("lng") or item.get("lon"))

                # Filter by distance if coordinates provided
                if lat is not None and lon is not None and tfr.get("lat") and tfr.get("lon"):
                    distance = haversine_nm(lat, lon, tfr["lat"], tfr["lon"])
                    if distance > radius_nm:
                        continue
                    tfr["distance_nm"] = round(distance, 1)

                tfrs.append(tfr)

            return tfrs

    except httpx.HTTPStatusError as e:
        logger.error(f"TFR API HTTP error: {e.response.status_code}")
        return []
    except Exception as e:
        logger.error(f"TFR API request failed: {e}")
        return []


def parse_notam(raw_notam: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Parse a raw NOTAM from the API into a normalized format.

    Args:
        raw_notam: Raw NOTAM data from API

    Returns:
        Parsed NOTAM dictionary or None if invalid
    """
    try:
        notam_id = raw_notam.get("id") or raw_notam.get("notamId")
        if not notam_id:
            return None

        # Parse NOTAM type
        notam_type = raw_notam.get("type", "D").upper()
        if notam_type not in ["D", "FDC", "TFR", "GPS", "MIL", "POINTER"]:
            notam_type = "D"

        # Parse location
        location = raw_notam.get("icaoId") or raw_notam.get("location", "")
        if not location:
            # Try to extract from the NOTAM text
            text = raw_notam.get("text", "")
            if text.startswith("!"):
                parts = text.split()
                if len(parts) > 1:
                    location = parts[1][:4]

        # Parse coordinates
        lat = raw_notam.get("lat")
        lon = raw_notam.get("lon")

        # Parse times
        effective_start = None
        effective_end = None
        is_permanent = False

        start_str = raw_notam.get("effectiveStart") or raw_notam.get("startValidity")
        end_str = raw_notam.get("effectiveEnd") or raw_notam.get("endValidity")

        if start_str:
            try:
                effective_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                effective_start = timezone.now()
        else:
            effective_start = timezone.now()

        if end_str:
            if end_str.upper() in ("PERM", "PERMANENT"):
                is_permanent = True
            else:
                try:
                    effective_end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    pass

        # Parse altitude restrictions
        floor_ft = raw_notam.get("floorFt") or raw_notam.get("floor")
        ceiling_ft = raw_notam.get("ceilingFt") or raw_notam.get("ceiling")

        # Parse TFR specific fields
        radius_nm = raw_notam.get("radiusNm") or raw_notam.get("radius")
        geometry = raw_notam.get("geometry")
        reason = raw_notam.get("reason") or raw_notam.get("purpose")

        # Detect TFR from content
        text = raw_notam.get("text", "")
        if "TFR" in text.upper() or geometry:
            notam_type = "TFR"

        return {
            "notam_id": notam_id,
            "notam_type": notam_type,
            "classification": raw_notam.get("classification"),
            "location": location[:10] if location else "",
            "latitude": lat,
            "longitude": lon,
            "radius_nm": radius_nm,
            "floor_ft": floor_ft,
            "ceiling_ft": ceiling_ft,
            "effective_start": effective_start,
            "effective_end": effective_end,
            "is_permanent": is_permanent,
            "text": text,
            "raw_text": raw_notam.get("rawText", text),
            "keywords": raw_notam.get("keywords"),
            "geometry": geometry,
            "reason": reason,
            "source_data": raw_notam,
        }

    except Exception as e:
        logger.warning(f"Failed to parse NOTAM: {e}")
        return None


@transaction.atomic
def refresh_notams(
    bbox: Optional[str] = None,
    icao_list: Optional[List[str]] = None,
) -> int:
    """
    Refresh cached NOTAMs from the API.

    Args:
        bbox: Bounding box string "min_lat,min_lon,max_lat,max_lon"
        icao_list: List of ICAO codes to fetch NOTAMs for

    Returns:
        Number of NOTAMs cached
    """
    global _last_refresh

    logger.info("Refreshing NOTAM cache...")

    all_notams = []

    # Fetch by area if bbox provided
    if bbox:
        try:
            coords = [float(x) for x in bbox.split(",")]
            if len(coords) == 4:
                center_lat = (coords[0] + coords[2]) / 2
                center_lon = (coords[1] + coords[3]) / 2
                radius = max(abs(coords[2] - coords[0]), abs(coords[3] - coords[1])) * 60 / 2
                notams = fetch_notams_from_api(lat=center_lat, lon=center_lon, radius_nm=radius)
                all_notams.extend(notams)
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid bbox format: {e}")

    # Fetch by ICAO codes
    if icao_list:
        for icao in icao_list[:20]:  # Limit to 20 airports
            notams = fetch_notams_from_api(icao=icao)
            all_notams.extend(notams)

    # If no specific search, fetch TFRs (NOTAMs require airport-specific queries)
    if not bbox and not icao_list:
        # Fetch TFRs from dedicated TFR feed
        tfrs = fetch_tfrs_from_api(lat=39.0, lon=-98.0, radius_nm=2000)
        all_notams.extend(tfrs)

        # Fetch NOTAMs for major airports
        major_airports = ['KJFK', 'KLAX', 'KORD', 'KDFW', 'KDEN', 'KSFO', 'KSEA', 'KATL', 'KMIA', 'KBOS']
        for airport in major_airports:
            try:
                notams = fetch_notams_from_api(icao=airport)
                all_notams.extend(notams)
            except Exception as e:
                logger.warning(f"Failed to fetch NOTAMs for {airport}: {e}")

    if not all_notams:
        logger.warning("No NOTAMs fetched from API")
        return 0

    # Parse and deduplicate
    parsed_notams = {}
    for raw in all_notams:
        parsed = parse_notam(raw)
        if parsed and parsed["notam_id"]:
            parsed_notams[parsed["notam_id"]] = parsed

    logger.info(f"Parsed {len(parsed_notams)} unique NOTAMs")

    # Upsert NOTAMs
    now = timezone.now()
    updated_count = 0

    for notam_data in parsed_notams.values():
        notam_id = notam_data.pop("notam_id")

        obj, created = CachedNotam.objects.update_or_create(
            notam_id=notam_id,
            defaults={
                **notam_data,
                "fetched_at": now,
            }
        )
        updated_count += 1

    # Soft archive expired NOTAMs (7+ days past expiration, not yet archived)
    archive_cutoff = now - timedelta(days=7)
    archived_count = CachedNotam.objects.filter(
        effective_end__lt=archive_cutoff,
        is_permanent=False,
        is_archived=False,
    ).update(
        is_archived=True,
        archived_at=now,
        archive_reason='expired',
    )

    if archived_count:
        logger.info(f"Archived {archived_count} expired NOTAMs")

    # Hard delete NOTAMs that have been archived for 90+ days
    hard_delete_cutoff = now - timedelta(days=90)
    deleted, _ = CachedNotam.objects.filter(
        is_archived=True,
        archived_at__lt=hard_delete_cutoff,
    ).delete()

    if deleted:
        logger.info(f"Hard deleted {deleted} old archived NOTAMs")

    _last_refresh = now
    logger.info(f"NOTAM cache refreshed: {updated_count} NOTAMs")

    return updated_count


@cached_with_ttl(ttl=60)
def get_notams(
    icao: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 100,
    notam_type: Optional[str] = None,
    active_only: bool = True,
    limit: int = 100,
    include_archived: bool = False,
) -> List[Dict[str, Any]]:
    """
    Get cached NOTAMs with optional filters.

    Args:
        icao: Filter by airport ICAO code
        lat: Center latitude for area search
        lon: Center longitude for area search
        radius_nm: Search radius in nautical miles
        notam_type: Filter by NOTAM type
        active_only: Only return currently active NOTAMs
        limit: Maximum number of results
        include_archived: Include archived NOTAMs (default False)

    Returns:
        List of NOTAM dictionaries
    """
    now = timezone.now()
    queryset = CachedNotam.objects.all()

    # Exclude archived by default
    if not include_archived:
        queryset = queryset.filter(is_archived=False)

    if icao:
        queryset = queryset.filter(location__iexact=icao)

    if notam_type:
        queryset = queryset.filter(notam_type__iexact=notam_type)

    if active_only:
        queryset = queryset.filter(
            effective_start__lte=now,
        ).filter(
            Q(effective_end__gte=now) | Q(effective_end__isnull=True) | Q(is_permanent=True)
        )

    # Filter by location if coordinates provided
    if lat is not None and lon is not None:
        # Approximate degrees per NM
        lat_delta = radius_nm / 60
        lon_delta = radius_nm / (60 * abs(cos(radians(lat))))

        queryset = queryset.filter(
            latitude__isnull=False,
            longitude__isnull=False,
            latitude__range=(lat - lat_delta, lat + lat_delta),
            longitude__range=(lon - lon_delta, lon + lon_delta),
        )

    notams = list(queryset.order_by('-effective_start')[:limit * 2])

    # Calculate distances and filter
    results = []
    for notam in notams:
        data = {
            "notam_id": notam.notam_id,
            "notam_type": notam.notam_type,
            "classification": notam.classification,
            "location": notam.location,
            "latitude": notam.latitude,
            "longitude": notam.longitude,
            "radius_nm": notam.radius_nm,
            "floor_ft": notam.floor_ft,
            "ceiling_ft": notam.ceiling_ft,
            "effective_start": notam.effective_start.isoformat() if notam.effective_start else None,
            "effective_end": notam.effective_end.isoformat() if notam.effective_end else None,
            "is_permanent": notam.is_permanent,
            "text": notam.text,
            "geometry": notam.geometry,
            "reason": notam.reason,
            "is_active": notam.is_active,
            "is_tfr": notam.is_tfr,
        }

        if lat is not None and lon is not None and notam.latitude and notam.longitude:
            distance = haversine_nm(lat, lon, notam.latitude, notam.longitude)
            data["distance_nm"] = round(distance, 1)
            if distance <= radius_nm:
                results.append(data)
        else:
            results.append(data)

    # Sort by distance or effective date
    if lat is not None and lon is not None:
        results.sort(key=lambda x: x.get("distance_nm", 9999))
    else:
        results.sort(key=lambda x: x.get("effective_start", ""), reverse=True)

    return results[:limit]


@cached_with_ttl(ttl=60)
def get_tfrs(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 500,
    active_only: bool = True,
    include_archived: bool = False,
) -> List[Dict[str, Any]]:
    """
    Get active TFRs (Temporary Flight Restrictions).

    Args:
        lat: Center latitude for area search
        lon: Center longitude for area search
        radius_nm: Search radius in nautical miles
        active_only: Only return currently active TFRs
        include_archived: Include archived TFRs (default False)

    Returns:
        List of TFR dictionaries with GeoJSON geometry
    """
    now = timezone.now()
    queryset = CachedNotam.objects.filter(
        Q(notam_type='TFR') | Q(geometry__isnull=False)
    )

    # Exclude archived by default
    if not include_archived:
        queryset = queryset.filter(is_archived=False)

    if active_only:
        queryset = queryset.filter(
            effective_start__lte=now,
        ).filter(
            Q(effective_end__gte=now) | Q(effective_end__isnull=True) | Q(is_permanent=True)
        )

    # Filter by location if coordinates provided
    if lat is not None and lon is not None:
        lat_delta = radius_nm / 60
        lon_delta = radius_nm / (60 * abs(cos(radians(lat))))

        queryset = queryset.filter(
            Q(latitude__isnull=True) |  # Include TFRs without coords
            Q(
                latitude__range=(lat - lat_delta, lat + lat_delta),
                longitude__range=(lon - lon_delta, lon + lon_delta),
            )
        )

    tfrs = list(queryset.order_by('-effective_start')[:100])

    results = []
    for tfr in tfrs:
        data = {
            "notam_id": tfr.notam_id,
            "location": tfr.location,
            "latitude": tfr.latitude,
            "longitude": tfr.longitude,
            "radius_nm": tfr.radius_nm,
            "floor_ft": tfr.floor_ft,
            "ceiling_ft": tfr.ceiling_ft,
            "effective_start": tfr.effective_start.isoformat() if tfr.effective_start else None,
            "effective_end": tfr.effective_end.isoformat() if tfr.effective_end else None,
            "reason": tfr.reason,
            "text": tfr.text,
            "geometry": tfr.geometry,
            "is_active": tfr.is_active,
        }

        if lat is not None and lon is not None and tfr.latitude and tfr.longitude:
            data["distance_nm"] = round(
                haversine_nm(lat, lon, tfr.latitude, tfr.longitude), 1
            )

        results.append(data)

    return results


def get_notams_for_airport(icao: str, active_only: bool = True) -> List[Dict[str, Any]]:
    """
    Get all NOTAMs for a specific airport.

    Args:
        icao: Airport ICAO code
        active_only: Only return currently active NOTAMs

    Returns:
        List of NOTAM dictionaries
    """
    return get_notams(icao=icao, active_only=active_only)


@cached_with_ttl(ttl=60)
def get_notam_stats() -> Dict[str, Any]:
    """
    Get statistics about cached NOTAMs.

    Returns:
        Statistics dictionary
    """
    from django.db.models import Count, Max

    total_count = CachedNotam.objects.count()
    now = timezone.now()

    active_count = CachedNotam.objects.filter(
        effective_start__lte=now,
    ).filter(
        Q(effective_end__gte=now) | Q(effective_end__isnull=True) | Q(is_permanent=True)
    ).count()

    tfr_count = CachedNotam.objects.filter(
        Q(notam_type='TFR') | Q(geometry__isnull=False)
    ).filter(
        effective_start__lte=now,
    ).filter(
        Q(effective_end__gte=now) | Q(effective_end__isnull=True)
    ).count()

    by_type = dict(
        CachedNotam.objects.values('notam_type')
        .annotate(count=Count('id'))
        .values_list('notam_type', 'count')
    )

    last_refresh = CachedNotam.objects.aggregate(Max('fetched_at'))['fetched_at__max']

    return {
        "total_notams": total_count,
        "active_notams": active_count,
        "active_tfrs": tfr_count,
        "by_type": by_type,
        "last_refresh": last_refresh.isoformat() if last_refresh else None,
        "refresh_interval_minutes": REFRESH_INTERVAL_SECONDS // 60,
    }


def should_refresh() -> bool:
    """Check if NOTAM cache should be refreshed."""
    global _last_refresh

    if _last_refresh is None:
        # Check database
        from django.db.models import Max
        last_fetch = CachedNotam.objects.aggregate(Max('fetched_at'))['fetched_at__max']
        if last_fetch:
            _last_refresh = last_fetch
        else:
            return True

    if _last_refresh:
        age = (timezone.now() - _last_refresh).total_seconds()
        return age >= REFRESH_INTERVAL_SECONDS

    return True


def get_archived_notams(
    icao: Optional[str] = None,
    notam_type: Optional[str] = None,
    days: int = 30,
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> Dict[str, Any]:
    """
    Get archived NOTAMs with filters.

    Args:
        icao: Filter by airport ICAO code
        notam_type: Filter by NOTAM type (D, FDC, TFR, GPS)
        days: Number of days to look back
        search: Text search in NOTAM text
        limit: Maximum number of results
        offset: Offset for pagination

    Returns:
        Dictionary with archived NOTAMs and count
    """
    from django.db.models import Count

    now = timezone.now()
    cutoff = now - timedelta(days=days)

    queryset = CachedNotam.objects.filter(
        is_archived=True,
        archived_at__gte=cutoff,
    )

    if icao:
        queryset = queryset.filter(location__iexact=icao)

    if notam_type:
        queryset = queryset.filter(notam_type__iexact=notam_type)

    if search:
        queryset = queryset.filter(
            Q(text__icontains=search) |
            Q(notam_id__icontains=search) |
            Q(location__icontains=search)
        )

    total_count = queryset.count()
    notams = list(queryset.order_by('-archived_at')[offset:offset + limit])

    results = []
    for notam in notams:
        results.append({
            "notam_id": notam.notam_id,
            "notam_type": notam.notam_type,
            "classification": notam.classification,
            "location": notam.location,
            "latitude": notam.latitude,
            "longitude": notam.longitude,
            "radius_nm": notam.radius_nm,
            "floor_ft": notam.floor_ft,
            "ceiling_ft": notam.ceiling_ft,
            "effective_start": notam.effective_start.isoformat() if notam.effective_start else None,
            "effective_end": notam.effective_end.isoformat() if notam.effective_end else None,
            "is_permanent": notam.is_permanent,
            "text": notam.text,
            "geometry": notam.geometry,
            "reason": notam.reason,
            "archived_at": notam.archived_at.isoformat() if notam.archived_at else None,
            "archive_reason": notam.archive_reason,
        })

    return {
        "notams": results,
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
    }


def get_archive_stats() -> Dict[str, Any]:
    """
    Get archive statistics.

    Returns:
        Dictionary with archive statistics
    """
    from django.db.models import Count, Min, Max

    now = timezone.now()

    # Total archived NOTAMs
    archived_count = CachedNotam.objects.filter(is_archived=True).count()

    # Archived by type
    by_type = dict(
        CachedNotam.objects.filter(is_archived=True)
        .values('notam_type')
        .annotate(count=Count('id'))
        .values_list('notam_type', 'count')
    )

    # Archived by reason
    by_reason = dict(
        CachedNotam.objects.filter(is_archived=True)
        .values('archive_reason')
        .annotate(count=Count('id'))
        .values_list('archive_reason', 'count')
    )

    # Date range of archived items
    date_range = CachedNotam.objects.filter(is_archived=True).aggregate(
        oldest=Min('archived_at'),
        newest=Max('archived_at'),
    )

    # Archive counts by time period
    days_7 = now - timedelta(days=7)
    days_30 = now - timedelta(days=30)
    days_90 = now - timedelta(days=90)

    archived_last_7_days = CachedNotam.objects.filter(
        is_archived=True, archived_at__gte=days_7
    ).count()

    archived_last_30_days = CachedNotam.objects.filter(
        is_archived=True, archived_at__gte=days_30
    ).count()

    archived_last_90_days = CachedNotam.objects.filter(
        is_archived=True, archived_at__gte=days_90
    ).count()

    return {
        "total_archived": archived_count,
        "by_type": by_type,
        "by_reason": by_reason,
        "oldest_archive": date_range['oldest'].isoformat() if date_range['oldest'] else None,
        "newest_archive": date_range['newest'].isoformat() if date_range['newest'] else None,
        "archived_last_7_days": archived_last_7_days,
        "archived_last_30_days": archived_last_30_days,
        "archived_last_90_days": archived_last_90_days,
    }
