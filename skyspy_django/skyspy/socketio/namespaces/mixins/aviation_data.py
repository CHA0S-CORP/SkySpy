"""Aviation data handlers for MainNamespace (airports, navaids, airspace, weather, NOTAMs)."""

import logging
from datetime import timedelta

from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from skyspy.socketio.namespaces.mixins import parse_int_param

logger = logging.getLogger(__name__)

# Cap points per airspace ring. Raw boundaries can carry 400+ vertices each;
# at display scale that detail is invisible but the full payload (100+ polygons)
# exceeds Socket.IO's 1 MB frame limit and drops the connection.
_MAX_RING_POINTS = 48


def _decimate_ring(ring):
    """Evenly subsample a coordinate ring to at most _MAX_RING_POINTS, keeping
    the first and last vertex so the polygon stays closed."""
    if not isinstance(ring, list) or len(ring) <= _MAX_RING_POINTS:
        return ring
    step = len(ring) / (_MAX_RING_POINTS - 1)
    out = [ring[min(int(i * step), len(ring) - 1)] for i in range(_MAX_RING_POINTS - 1)]
    out.append(ring[-1])
    return out


def _decimate_polygon(polygon):
    """Reduce a GeoJSON Polygon/MultiPolygon's vertex count for wire transfer."""
    if not isinstance(polygon, dict):
        return polygon
    coords = polygon.get("coordinates")
    if not isinstance(coords, list):
        return polygon
    gtype = polygon.get("type")
    if gtype == "MultiPolygon":
        new_coords = [[_decimate_ring(ring) for ring in poly] for poly in coords]
    else:  # Polygon
        new_coords = [_decimate_ring(ring) for ring in coords]
    return {**polygon, "coordinates": new_coords}


class AviationDataMixin:
    """Airports, navaids, airspace boundaries, PIREPs, METARs, TAFs, and NOTAMs."""

    async def _handle_airports(self, params: dict):
        """Get nearby airports."""
        return await self._get_airports(params)

    async def _handle_navaids(self, params: dict):
        """Get nearby navaids."""
        return await self._get_navaids(params)

    async def _handle_airspace_boundaries(self, params: dict):
        """Get airspace boundaries."""
        return await self._get_airspace_boundaries(params)

    async def _handle_airspace_advisories(self, params: dict):
        """Get airspace advisories (G-AIRMETs, SIGMETs)."""
        return await self._get_airspace_advisories(params)

    async def _handle_pireps(self, params: dict):
        """Handle PIREPs request."""
        return await self._get_pireps(params)

    async def _handle_wildfires(self, params: dict):
        """Get nearby active wildfires (Watch Duty)."""
        return await self._get_wildfires(params)

    async def _handle_metars(self, params: dict):
        """Handle METARs request."""
        return await self._get_metars(params)

    async def _handle_tafs(self, params: dict):
        """Handle TAFs request."""
        return await self._get_tafs(params)

    async def _handle_metar_single(self, params: dict):
        """Handle single METAR request by station."""
        station = params.get("station") or params.get("icao")
        if not station:
            raise ValueError("Missing station parameter")
        return await self._get_metar_by_station(station)

    async def _handle_taf_single(self, params: dict):
        """Handle single TAF request by station."""
        station = params.get("station") or params.get("icao")
        if not station:
            raise ValueError("Missing station parameter")
        return await self._get_taf_by_station(station)

    async def _handle_notam_snapshot(self, params: dict):
        """Get full NOTAM snapshot with NOTAMs, TFRs, and stats."""
        return await self._get_notam_snapshot(params)

    async def _handle_airport_notams(self, params: dict):
        """Get NOTAMs for a specific airport."""
        icao = params.get("icao")
        if not icao:
            raise ValueError("Missing icao parameter")
        return await self._get_airport_notams(icao.upper())

    async def _handle_notam_refresh(self, params: dict):
        """Trigger a NOTAM refresh."""
        return await self._trigger_notam_refresh()

    # -----------------------------------------------------------------
    # Data access — airports, navaids, airspace
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_airports(self, params: dict):
        """Get nearby airports."""
        from skyspy.models import CachedAirport

        try:
            lat = float(params.get("lat", getattr(settings, "FEEDER_LAT", 0)))
        except (ValueError, TypeError):
            lat = float(getattr(settings, "FEEDER_LAT", 0))
        try:
            lon = float(params.get("lon", getattr(settings, "FEEDER_LON", 0)))
        except (ValueError, TypeError):
            lon = float(getattr(settings, "FEEDER_LON", 0))
        try:
            radius_nm = float(params.get("radius", params.get("radius_nm", 50)))
        except (ValueError, TypeError):
            radius_nm = 50.0
        limit = parse_int_param(params.get("limit"), 20, min_val=1, max_val=100)

        lat_delta = radius_nm / 60
        lon_delta = radius_nm / 60

        queryset = CachedAirport.objects.filter(
            latitude__gte=lat - lat_delta,
            latitude__lte=lat + lat_delta,
            longitude__gte=lon - lon_delta,
            longitude__lte=lon + lon_delta,
        )

        airports = []
        for apt in queryset[:limit]:
            airports.append(
                {
                    "icao": apt.icao_id,
                    "name": apt.name,
                    "lat": apt.latitude,
                    "lon": apt.longitude,
                    "elev": apt.elevation_ft,
                    "type": apt.airport_type,
                }
            )
        return airports

    @sync_to_async
    def _get_wildfires(self, params: dict):
        """Get nearby active wildfires from the cached Watch Duty feed."""
        from skyspy.services import wildfires

        try:
            lat = float(params.get("lat", getattr(settings, "FEEDER_LAT", 0)))
        except (ValueError, TypeError):
            lat = float(getattr(settings, "FEEDER_LAT", 0))
        try:
            lon = float(params.get("lon", getattr(settings, "FEEDER_LON", 0)))
        except (ValueError, TypeError):
            lon = float(getattr(settings, "FEEDER_LON", 0))
        try:
            radius_nm = float(params.get("radius", params.get("radius_nm", 250)))
        except (ValueError, TypeError):
            radius_nm = 250.0

        return wildfires.get_cached_wildfires(lat, lon, radius_nm)

    @sync_to_async
    def _get_navaids(self, params: dict):
        """Get nearby navigation aids."""
        from skyspy.models import CachedNavaid

        try:
            lat = float(params.get("lat", getattr(settings, "FEEDER_LAT", 0)))
        except (ValueError, TypeError):
            lat = float(getattr(settings, "FEEDER_LAT", 0))
        try:
            lon = float(params.get("lon", getattr(settings, "FEEDER_LON", 0)))
        except (ValueError, TypeError):
            lon = float(getattr(settings, "FEEDER_LON", 0))
        try:
            radius_nm = float(params.get("radius", params.get("radius_nm", 100)))
        except (ValueError, TypeError):
            radius_nm = 100.0
        limit = parse_int_param(params.get("limit"), 50, min_val=1, max_val=200)

        lat_delta = radius_nm / 60
        lon_delta = radius_nm / 60

        queryset = CachedNavaid.objects.filter(
            latitude__gte=lat - lat_delta,
            latitude__lte=lat + lat_delta,
            longitude__gte=lon - lon_delta,
            longitude__lte=lon + lon_delta,
        )

        navaids = []
        for nav in queryset[:limit]:
            navaids.append(
                {
                    "id": nav.ident,
                    "name": nav.name,
                    "type": nav.navaid_type,
                    "lat": nav.latitude,
                    "lon": nav.longitude,
                    "freq": nav.frequency,
                }
            )
        return navaids

    @sync_to_async
    def _get_airspace_boundaries(self, params: dict):
        """Get airspace boundaries."""
        from skyspy.models import AirspaceBoundary

        try:
            lat = float(params.get("lat", getattr(settings, "FEEDER_LAT", 0)))
        except (ValueError, TypeError):
            lat = float(getattr(settings, "FEEDER_LAT", 0))
        try:
            lon = float(params.get("lon", getattr(settings, "FEEDER_LON", 0)))
        except (ValueError, TypeError):
            lon = float(getattr(settings, "FEEDER_LON", 0))
        try:
            radius_nm = float(params.get("radius", params.get("radius_nm", 100)))
        except (ValueError, TypeError):
            radius_nm = 100.0

        lat_delta = radius_nm / 60
        lon_delta = radius_nm / 60

        queryset = AirspaceBoundary.objects.filter(
            center_lat__gte=lat - lat_delta,
            center_lat__lte=lat + lat_delta,
            center_lon__gte=lon - lon_delta,
            center_lon__lte=lon + lon_delta,
        )

        boundaries = []
        for b in queryset[:120]:
            boundaries.append(
                {
                    "id": b.id,
                    "name": b.name,
                    "icao": b.icao,
                    "class": b.airspace_class,
                    "floor": b.floor_ft,
                    "ceiling": b.ceiling_ft,
                    "lat": b.center_lat,
                    "lon": b.center_lon,
                    "radius": b.radius_nm,
                    "controlling_agency": b.controlling_agency,
                    "schedule": b.schedule,
                    "polygon": _decimate_polygon(b.polygon),
                }
            )
        return boundaries

    @sync_to_async
    def _get_airspace_advisories(self, params: dict):
        """Get active airspace advisories (G-AIRMETs, SIGMETs)."""
        from skyspy.models import AirspaceAdvisory

        now = timezone.now()
        advisories = AirspaceAdvisory.objects.filter(valid_from__lte=now, valid_to__gte=now).order_by("-fetched_at")

        hazard = params.get("hazard")
        if hazard:
            advisories = advisories.filter(hazard=hazard)

        result = []
        for adv in advisories[:100]:
            result.append(
                {
                    "id": adv.id,
                    "advisory_type": adv.advisory_type,
                    "hazard": adv.hazard,
                    "severity": adv.severity,
                    "valid_from": adv.valid_from.isoformat() if adv.valid_from else None,
                    "valid_to": adv.valid_to.isoformat() if adv.valid_to else None,
                    "upper_alt_ft": adv.upper_alt_ft,
                    "lower_alt_ft": adv.lower_alt_ft,
                    "polygon": adv.polygon,
                }
            )

        return {
            "advisories": result,
            "count": len(result),
        }

    # -----------------------------------------------------------------
    # Data access — PIREPs, METARs, TAFs
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_pireps(self, params: dict):
        """Get PIREP data with spatial filtering."""
        from math import cos, pi

        from skyspy.models import CachedPirep

        hours = parse_int_param(params.get("hours"), 6, min_val=1, max_val=24)

        try:
            lat = float(params.get("lat", getattr(settings, "FEEDER_LAT", 0)))
        except (ValueError, TypeError):
            lat = float(getattr(settings, "FEEDER_LAT", 0))
        try:
            lon = float(params.get("lon", getattr(settings, "FEEDER_LON", 0)))
        except (ValueError, TypeError):
            lon = float(getattr(settings, "FEEDER_LON", 0))
        try:
            radius = float(params.get("radius", params.get("radius_nm", 500)))
        except (ValueError, TypeError):
            radius = 500.0

        cache_key = f"pireps_ws:{hours}:{round(lat, 2)}:{round(lon, 2)}:{round(radius)}"
        cached_data = cache.get(cache_key)
        if cached_data is not None:
            return cached_data

        cutoff = timezone.now() - timedelta(hours=hours)
        query = CachedPirep.objects.filter(observation_time__gte=cutoff)

        lat_delta = radius / 60.0
        lon_delta = radius / (60.0 * max(cos(lat * pi / 180), 0.1))

        query = query.filter(
            latitude__gte=lat - lat_delta,
            latitude__lte=lat + lat_delta,
            longitude__gte=lon - lon_delta,
            longitude__lte=lon + lon_delta,
        )

        pireps = query.order_by("-observation_time")[:100]

        result = []
        for p in pireps:
            result.append(
                {
                    "id": p.id,
                    "raw": p.raw_text,
                    "lat": p.latitude,
                    "lon": p.longitude,
                    "altitude": p.altitude_ft,
                    "observation_time": p.observation_time.isoformat() if p.observation_time else None,
                    "aircraft_type": p.aircraft_type,
                    "report_type": p.report_type,
                    "turbulence": p.turbulence_type,
                    "icing": p.icing_intensity,
                    "sky_cover": p.sky_cover,
                    "weather": p.weather,
                    "visibility": p.visibility_sm,
                    "temp": p.temperature_c,
                }
            )

        response = {
            "data": result,
            "count": len(result),
            "source": "aviationweather.gov",
        }

        cache.set(cache_key, response, timeout=120)
        return response

    # thread_sensitive=False: weather fetches hit aviationweather.gov (15s
    # timeout + retries) and must not block Django's single shared sync
    # thread. weather_cache uses only httpx + the Django cache — no ORM.
    @sync_to_async(thread_sensitive=False)
    def _get_metars(self, params: dict):
        """Get METAR data for area."""
        from skyspy.services import weather_cache

        lat = params.get("lat", getattr(settings, "FEEDER_LAT", 0))
        lon = params.get("lon", getattr(settings, "FEEDER_LON", 0))
        radius_nm = params.get("radius", params.get("radius_nm", 200))
        hours = parse_int_param(params.get("hours"), 2, min_val=1, max_val=24)

        try:
            lat = float(lat)
            lon = float(lon)
            radius_nm = float(radius_nm)
            lat_delta = radius_nm / 60
            lon_delta = radius_nm / 60
            bbox = f"{lat - lat_delta},{lon - lon_delta},{lat + lat_delta},{lon + lon_delta}"
        except (ValueError, TypeError):
            bbox = "24,-130,50,-60"

        metars = weather_cache.fetch_and_cache_metars(bbox=bbox, hours=hours)

        return {
            "data": metars,
            "count": len(metars),
            "source": "aviationweather.gov",
        }

    @sync_to_async(thread_sensitive=False)
    def _get_tafs(self, params: dict):
        """Get TAF data for area."""
        from skyspy.services import weather_cache

        lat = params.get("lat", getattr(settings, "FEEDER_LAT", 0))
        lon = params.get("lon", getattr(settings, "FEEDER_LON", 0))
        radius_nm = params.get("radius", params.get("radius_nm", 200))

        try:
            lat = float(lat)
            lon = float(lon)
            radius_nm = float(radius_nm)
            lat_delta = radius_nm / 60
            lon_delta = radius_nm / 60
            bbox = f"{lat - lat_delta},{lon - lon_delta},{lat + lat_delta},{lon + lon_delta}"
        except (ValueError, TypeError):
            bbox = "24,-130,50,-60"

        tafs = weather_cache.fetch_and_cache_tafs(bbox=bbox)

        return {
            "data": tafs,
            "count": len(tafs),
            "source": "aviationweather.gov",
        }

    @sync_to_async(thread_sensitive=False)
    def _get_metar_by_station(self, station: str):
        """Get METAR for a single station."""
        from skyspy.services import weather_cache

        metar = weather_cache.fetch_metar_by_station(station.upper(), hours=2)
        if metar:
            return {
                "station": station.upper(),
                "data": metar[0] if isinstance(metar, list) and metar else metar,
                "source": "aviationweather.gov",
            }
        return {"station": station.upper(), "data": None, "error": "No METAR found"}

    @sync_to_async(thread_sensitive=False)
    def _get_taf_by_station(self, station: str):
        """Get TAF for a single station."""
        from skyspy.services import weather_cache

        taf = weather_cache.fetch_taf_by_station(station.upper())
        if taf:
            return {
                "station": station.upper(),
                "data": taf[0] if isinstance(taf, list) and taf else taf,
                "source": "aviationweather.gov",
            }
        return {"station": station.upper(), "data": None, "error": "No TAF found"}

    # -----------------------------------------------------------------
    # Data access — NOTAMs
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_notam_snapshot(self, params: dict):
        """Get current NOTAMs, TFRs, and stats."""
        from skyspy.models import CachedNotam

        limit = parse_int_param(params.get("limit"), 100, min_val=1, max_val=500)
        active_only = params.get("active_only", True)

        now = timezone.now()
        queryset = CachedNotam.objects.all()

        if active_only:
            queryset = queryset.filter(Q(effective_end__isnull=True) | Q(effective_end__gte=now)).filter(
                effective_start__lte=now
            )

        notams = []
        tfrs = []

        for n in queryset.order_by("-effective_start")[:limit]:
            notam_data = {
                "notam_id": n.notam_id,
                "location": n.location,
                "text": n.text,
                "type": n.notam_type,
                "effective_start": n.effective_start.isoformat() if n.effective_start else None,
                "effective_end": n.effective_end.isoformat() if n.effective_end else None,
                "fetched_at": n.fetched_at.isoformat() if n.fetched_at else None,
                "classification": n.classification,
                "reason": n.reason,
                # Geometry - the Live Map overlay draws from these
                "latitude": n.latitude,
                "longitude": n.longitude,
                "radius_nm": n.radius_nm,
            }
            notams.append(notam_data)
            if n.notam_type == "TFR":
                tfrs.append(notam_data)

        stats = {
            "total_active": len(notams),
            "tfr_count": len(tfrs),
            "by_type": {},
            "last_update": now.isoformat(),
        }

        for n in notams:
            t = n.get("type", "OTHER")
            stats["by_type"][t] = stats["by_type"].get(t, 0) + 1

        return {
            "notams": notams,
            "tfrs": tfrs,
            "stats": stats,
            "timestamp": now.isoformat(),
        }

    @sync_to_async
    def _get_airport_notams(self, icao: str):
        """Get NOTAMs for a specific airport."""
        from skyspy.models import CachedNotam

        now = timezone.now()
        queryset = (
            CachedNotam.objects.filter(location__icontains=icao)
            .filter(Q(effective_end__isnull=True) | Q(effective_end__gte=now))
            .order_by("-effective_start")[:50]
        )

        notams = []
        for n in queryset:
            notams.append(
                {
                    "notam_id": n.notam_id,
                    "location": n.location,
                    "text": n.text,
                    "type": n.notam_type,
                    "effective_start": n.effective_start.isoformat() if n.effective_start else None,
                    "effective_end": n.effective_end.isoformat() if n.effective_end else None,
                    "fetched_at": n.fetched_at.isoformat() if n.fetched_at else None,
                    "classification": n.classification,
                    "reason": n.reason,
                    "latitude": n.latitude,
                    "longitude": n.longitude,
                    "radius_nm": n.radius_nm,
                }
            )

        return notams

    @sync_to_async
    def _trigger_notam_refresh(self):
        """Trigger a NOTAM refresh task."""
        from skyspy.tasks.notams import refresh_notams

        try:
            refresh_notams.delay()
            return {"success": True, "message": "NOTAM refresh queued"}
        except Exception as e:  # broad: Celery broker enqueue can fail many ways; return graceful error to client
            logger.error(f"Failed to queue NOTAM refresh: {e}")
            return {"success": False, "message": str(e)}
