"""
Aviation weather and data API views.
"""

import logging
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from skyspy.api.throttles import ExternalLookupRateThrottle, GeodataRateThrottle, WeatherRateThrottle
from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import CanUseLLM, FeatureBasedPermission
from skyspy.models import (
    AirspaceAdvisory,
    AirspaceBoundary,
    CachedAirport,
    CachedNavaid,
    CachedPirep,
)
from skyspy.serializers.aviation import (
    AirspaceAdvisorySerializer,
    AirspaceBoundarySerializer,
    AviationDataSerializer,
    CachedAirportSerializer,
    CachedNavaidSerializer,
    CachedPirepSerializer,
)

logger = logging.getLogger(__name__)


class AviationViewSet(viewsets.ViewSet):
    """ViewSet for aviation weather and data."""

    # Public endpoint - no authentication required for the map/weather data.
    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [AllowAny]

    # Actions that fetch from external weather/aviation APIs vs. those that hit
    # the terrain/geojson filesystem+compute path. Cheap cached-DB reads
    # (airports, navaids, airspace boundaries) are left unthrottled.
    _WEATHER_ACTIONS = {
        "metars",
        "tafs",
        "pireps",
        "sigmets",
        "sigmets_proxy",
        "nexrad",
        "winds_aloft",
        "turbulence",
        "turbulence_advisories",
        "turbulence_aircraft",
    }
    _GEODATA_ACTIONS = {"geojson", "terrain_elevation", "terrain_grid"}
    # LLM-backed explainers (cost money) — require AI access + rate-limit.
    _LLM_ACTIONS = {"explain"}

    # RBAC-gated feature actions. These are gated on the `wildfires` / `weather`
    # FeatureAccess feature (via FeatureBasedPermission) so they honor role
    # permissions in hybrid/private mode; public mode still bypasses. The
    # airspace/airport/navaid/terrain/geojson actions stay AllowAny (out of scope).
    _WILDFIRE_ACTIONS = {"wildfires", "wildfire_bundle"}
    _WEATHER_RBAC_ACTIONS = {
        "metars",
        "tafs",
        "pireps",
        "pirep_summary",
        "sigmets",
        "sigmets_proxy",
        "nexrad",
        "winds_aloft",
        "turbulence",
        "turbulence_advisories",
        "turbulence_aircraft",
    }

    def get_permissions(self):
        action = getattr(self, "action", None)
        if action in self._LLM_ACTIONS:
            return [CanUseLLM()]
        if action in self._WILDFIRE_ACTIONS:
            return [FeatureBasedPermission("wildfires")]
        if action in self._WEATHER_RBAC_ACTIONS:
            return [FeatureBasedPermission("weather")]
        return super().get_permissions()

    def get_throttles(self):
        if self.action in self._WEATHER_ACTIONS:
            return [WeatherRateThrottle()]
        if self.action in self._GEODATA_ACTIONS:
            return [GeodataRateThrottle()]
        if self.action in self._LLM_ACTIONS:
            return [ExternalLookupRateThrottle()]
        # Per-fire bundle hits Watch Duty live (cached ~120s) — throttle like other
        # external fan-out. The wildfires marker list is a cheap cached-DB read.
        if self.action == "wildfire_bundle":
            return [ExternalLookupRateThrottle()]
        return super().get_throttles()

    @extend_schema(
        summary="Get GeoJSON overlay data",
        description="Get GeoJSON data for map overlays (ARTCC, refueling areas, etc.)",
        parameters=[
            OpenApiParameter(name="data_type", type=str, location="path", description="Data type"),
            OpenApiParameter(name="lat", type=float, description="Center latitude"),
            OpenApiParameter(name="lon", type=float, description="Center longitude"),
            OpenApiParameter(name="radius_nm", type=float, description="Search radius in nm"),
        ],
        responses={200: AviationDataSerializer},
    )
    @action(detail=False, methods=["get"], url_path="geojson/(?P<data_type>[^/]+)")
    def geojson(self, request, data_type=None):
        """Get GeoJSON overlay data by type."""
        from skyspy.services import geodata

        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")
        try:
            radius_nm = float(request.query_params.get("radius_nm", 500))
            radius_nm = min(radius_nm, 1000)  # Cap at 1000nm
        except (ValueError, TypeError):
            radius_nm = 500

        if lat and lon:
            try:
                lat = float(lat)
                lon = float(lon)
            except (ValueError, TypeError):
                lat = None
                lon = None
        else:
            lat = None
            lon = None

        features = geodata.get_cached_geojson(data_type=data_type, lat=lat, lon=lon, radius_nm=radius_nm)

        return Response(
            {
                "type": "FeatureCollection",
                "features": features,
                "metadata": {
                    "data_type": data_type,
                    "count": len(features),
                    "source": "skyspy",
                },
            }
        )

    @extend_schema(
        summary="Get METAR data",
        description="Get current METAR weather reports for airports",
        parameters=[
            OpenApiParameter(name="lat", type=float, description="Center latitude"),
            OpenApiParameter(name="lon", type=float, description="Center longitude"),
            OpenApiParameter(name="radius_nm", type=float, description="Search radius in nm"),
            OpenApiParameter(name="icao", type=str, description="Airport ICAO code"),
            OpenApiParameter(name="hours", type=int, description="Hours of history"),
        ],
        responses={200: AviationDataSerializer},
    )
    @action(detail=False, methods=["get"])
    def metars(self, request):
        """Get METAR data."""
        from skyspy.services import weather_cache

        icao = request.query_params.get("icao")
        try:
            hours = int(request.query_params.get("hours", 2))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 2

        if icao:
            # Fetch METARs for specific station
            metars = weather_cache.fetch_metar_by_station(icao, hours=hours)
        else:
            # Fetch METARs for bounding box (default CONUS)
            lat = request.query_params.get("lat")
            lon = request.query_params.get("lon")
            try:
                # Accept both 'radius' and 'radius_nm' for frontend compatibility
                radius_nm = float(request.query_params.get("radius", request.query_params.get("radius_nm", 200)))
                radius_nm = min(radius_nm, 1000)  # Cap at 1000nm
            except (ValueError, TypeError):
                radius_nm = 200

            if lat and lon:
                try:
                    lat = float(lat)
                    lon = float(lon)
                except (ValueError, TypeError):
                    lat = None
                    lon = None

            if lat is not None and lon is not None:
                lat_delta = radius_nm / 60
                lon_delta = radius_nm / 60
                bbox = f"{lat - lat_delta},{lon - lon_delta},{lat + lat_delta},{lon + lon_delta}"
            else:
                bbox = "24,-130,50,-60"  # CONUS

            metars = weather_cache.fetch_and_cache_metars(bbox=bbox, hours=hours)

        return Response(
            {
                "data": metars,
                "count": len(metars),
                "source": "aviationweather.gov",
                "cached": True,
            }
        )

    @extend_schema(
        summary="Get TAF data",
        description="Get TAF forecasts for airports",
        parameters=[
            OpenApiParameter(name="lat", type=float, description="Center latitude"),
            OpenApiParameter(name="lon", type=float, description="Center longitude"),
            OpenApiParameter(name="radius_nm", type=float, description="Search radius in nm"),
        ],
        responses={200: AviationDataSerializer},
    )
    @action(detail=False, methods=["get"])
    def tafs(self, request):
        """Get TAF forecast data."""
        from skyspy.services import weather_cache

        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")
        try:
            # Accept both 'radius' and 'radius_nm' for frontend compatibility
            radius_nm = float(request.query_params.get("radius", request.query_params.get("radius_nm", 200)))
            radius_nm = min(radius_nm, 1000)  # Cap at 1000nm
        except (ValueError, TypeError):
            radius_nm = 200

        if lat and lon:
            try:
                lat = float(lat)
                lon = float(lon)
            except (ValueError, TypeError):
                lat = None
                lon = None

        if lat is not None and lon is not None:
            lat_delta = radius_nm / 60
            lon_delta = radius_nm / 60
            bbox = f"{lat - lat_delta},{lon - lon_delta},{lat + lat_delta},{lon + lon_delta}"
        else:
            bbox = "24,-130,50,-60"  # CONUS

        tafs = weather_cache.fetch_and_cache_tafs(bbox=bbox)

        return Response(
            {
                "data": tafs,
                "count": len(tafs),
                "source": "aviationweather.gov",
                "cached": True,
            }
        )

    @extend_schema(
        summary="Get PIREP data",
        description="Get pilot reports (PIREPs)",
        parameters=[
            OpenApiParameter(name="lat", type=float, description="Center latitude"),
            OpenApiParameter(name="lon", type=float, description="Center longitude"),
            OpenApiParameter(name="radius_nm", type=float, description="Search radius in nm"),
            OpenApiParameter(name="hours", type=int, description="Time range in hours"),
        ],
        responses={200: CachedPirepSerializer(many=True)},
    )
    @action(detail=False, methods=["get"])
    def pireps(self, request):
        """Get PIREP data with optional spatial filtering."""
        from math import cos, pi

        try:
            hours = int(request.query_params.get("hours", 6))
            hours = min(hours, 720)  # Cap at 30 days
        except (ValueError, TypeError):
            hours = 6
        lat_str = request.query_params.get("lat")
        lon_str = request.query_params.get("lon")
        radius_str = request.query_params.get("radius", request.query_params.get("radius_nm", "500"))

        # Build cache key from query params
        cache_key = f"pireps:{hours}:{lat_str}:{lon_str}:{radius_str}"
        cached_data = cache.get(cache_key)
        if cached_data is not None:
            return Response(cached_data)

        cutoff = timezone.now() - timedelta(hours=hours)

        query = CachedPirep.objects.filter(observation_time__gte=cutoff)

        # Add spatial filtering if lat/lon/radius provided
        if lat_str and lon_str:
            try:
                lat = float(lat_str)
                lon = float(lon_str)
                radius = float(radius_str) if radius_str else 500

                # Convert nautical miles to degrees (1 nm ≈ 1/60 degree)
                lat_delta = radius / 60.0
                # Adjust longitude delta for latitude (longitude degrees get smaller toward poles)
                lon_delta = radius / (60.0 * max(cos(lat * pi / 180), 0.1))

                query = query.filter(
                    latitude__gte=lat - lat_delta,
                    latitude__lte=lat + lat_delta,
                    longitude__gte=lon - lon_delta,
                    longitude__lte=lon + lon_delta,
                )
            except (ValueError, TypeError):
                # Invalid coordinates - skip spatial filtering
                pass

        pireps = query.order_by("-observation_time")[:100]

        response_data = {
            "data": CachedPirepSerializer(pireps, many=True).data,
            "count": pireps.count(),
            "source": "aviationweather.gov",
            "cached": True,
        }

        # Cache for 2 minutes (PIREPs refresh every 10 minutes)
        cache.set(cache_key, response_data, timeout=120)

        return Response(response_data)

    @extend_schema(
        summary="Get the decoded block for a PIREP",
        description=(
            "Deterministic, rule-based decode of a stored PIREP (station, hazards, "
            "severity, plain-English summary). This is a fixed block formatter like the "
            "ACARS decode — the LLM is NEVER run over pilot-report text, so the output "
            "is stable, fast, and available without AI access."
        ),
    )
    @action(detail=False, methods=["get"], url_path=r"pireps/(?P<pirep_id>[^/]+)/summary")
    def pirep_summary(self, request, pirep_id=None):
        """Deterministic decoded block for one PIREP (rule-based decoder, never LLM)."""
        from skyspy.services import pirep_decoder

        pirep = CachedPirep.objects.filter(pirep_id=pirep_id).first()
        if not pirep:
            return Response({"error": "PIREP not found"}, status=status.HTTP_404_NOT_FOUND)

        decoded = pirep_decoder.decode_pirep(pirep)

        # Cross-reference the single report against the synthesized area picture
        # (G-AIRMET advisories + other nearby reports + winds-aloft shear). Guarded
        # so a turbulence failure never breaks the deterministic decode.
        area_turbulence = None
        if pirep.latitude is not None and pirep.longitude is not None:
            try:
                from skyspy.services.turbulence import assess_turbulence

                alt = pirep.altitude_ft or (pirep.flight_level * 100 if pirep.flight_level else None)
                assessment = assess_turbulence(pirep.latitude, pirep.longitude, alt)
                if assessment and assessment.get("level") != "none":
                    area_turbulence = {"score": assessment.get("score"), "level": assessment.get("level")}
            except (ValueError, TypeError, ImportError):
                area_turbulence = None

        return Response(
            {
                "pirep_id": pirep_id,
                "summary": decoded.get("human_summary"),
                "source": "rule",
                "severity": decoded.get("severity"),
                "hazards": decoded.get("hazards"),
                "area_turbulence": area_turbulence,
            }
        )

    @extend_schema(
        summary="Plain-English explanation of raw aviation text",
        description=(
            "Uses the configured LLM to explain arbitrary raw aviation text (METAR, TAF, "
            "SIGMET, NOTAM, PIREP, ACARS) in plain English. POST {kind, text, context?}. "
            "Returns available=false if the LLM is disabled/unconfigured."
        ),
    )
    @action(detail=False, methods=["post"])
    def explain(self, request):
        """Generic LLM explainer for any supported aviation text kind."""
        from skyspy.services import aviation_llm

        kind = (request.data.get("kind") or "").strip()
        text = request.data.get("text") or ""
        context = request.data.get("context") if isinstance(request.data.get("context"), dict) else None

        if not text.strip():
            return Response({"error": "text is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not aviation_llm.available():
            return Response({"available": False, "summary": None})

        summary = aviation_llm.explain(kind, text, context)
        return Response(
            {
                "available": True,
                "kind": kind or None,
                "summary": summary,
                "supported_kinds": list(aviation_llm.SUPPORTED_KINDS),
            }
        )

    @extend_schema(
        summary="Get SIGMET data",
        description="Get active SIGMETs and AIRMETs",
        responses={200: AirspaceAdvisorySerializer(many=True)},
    )
    @action(detail=False, methods=["get"])
    def sigmets(self, request):
        """Get SIGMET/AIRMET data."""
        now = timezone.now()
        advisories = AirspaceAdvisory.objects.filter(valid_from__lte=now, valid_to__gte=now).order_by("-fetched_at")

        return Response(
            {
                "data": AirspaceAdvisorySerializer(advisories, many=True).data,
                "count": advisories.count(),
                "source": "aviationweather.gov",
                "cached": True,
            }
        )

    @extend_schema(
        summary="LLM breakdown of a G-AIRMET advisory",
        description=(
            "Structured plain-language briefing for one AIRMET, keyed by advisory_id. "
            "Returns {available, brief:{headline, summary, hazard_detail, altitude_note, "
            "operational_impact[], safety_tips[]}}. available=false if the LLM is disabled."
        ),
    )
    @action(detail=False, methods=["get"], url_path="airmet/brief")
    def airmet_brief(self, request):
        """Structured LLM breakdown for a single AIRMET advisory."""
        from skyspy.services import aviation_llm

        advisory_id = (request.query_params.get("advisory_id") or "").strip()
        if not advisory_id:
            return Response({"error": "advisory_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not aviation_llm.available():
            return Response({"available": False, "brief": None})

        advisory = AirspaceAdvisory.objects.filter(advisory_id=advisory_id).order_by("-fetched_at").first()
        if advisory is None:
            return Response({"error": "advisory not found"}, status=status.HTTP_404_NOT_FOUND)

        brief = aviation_llm.brief_airmet(
            advisory.raw_text,
            hazard=advisory.hazard,
            severity=advisory.severity,
            lower_alt_ft=advisory.lower_alt_ft,
            upper_alt_ft=advisory.upper_alt_ft,
            region=advisory.region,
            valid_to=advisory.valid_to,
        )
        return Response({"available": True, "brief": brief})

    @extend_schema(summary="Get active airspace advisories", responses={200: AirspaceAdvisorySerializer(many=True)})
    @action(detail=False, methods=["get"], url_path="airspace/advisories")
    def airspace_advisories(self, request):
        """Get active airspace advisories."""
        now = timezone.now()
        advisories = AirspaceAdvisory.objects.filter(valid_from__lte=now, valid_to__gte=now)

        hazard = request.query_params.get("hazard")
        if hazard:
            advisories = advisories.filter(hazard=hazard)

        return Response(
            {
                "advisories": AirspaceAdvisorySerializer(advisories, many=True).data,
                "count": advisories.count(),
            }
        )

    @extend_schema(
        summary="Assess turbulence risk at a point",
        parameters=[
            OpenApiParameter(name="lat", type=float, description="Latitude"),
            OpenApiParameter(name="lon", type=float, description="Longitude"),
            OpenApiParameter(name="alt", type=float, description="Altitude in feet (optional)"),
        ],
    )
    @action(detail=False, methods=["get"])
    def turbulence(self, request):
        """Turbulence risk for a single lat/lon/alt point (G-AIRMET + PIREP + shear)."""
        from skyspy.services.turbulence import assess_turbulence

        try:
            lat = float(request.query_params["lat"])
            lon = float(request.query_params["lon"])
        except (KeyError, ValueError, TypeError):
            return Response({"error": "lat and lon are required"}, status=status.HTTP_400_BAD_REQUEST)

        alt = request.query_params.get("alt")
        try:
            alt = float(alt) if alt not in (None, "") else None
        except (ValueError, TypeError):
            alt = None

        return Response(assess_turbulence(lat, lon, alt))

    @extend_schema(summary="Active G-AIRMET turbulence advisories (for map overlay)")
    @action(detail=False, methods=["get"], url_path="turbulence/advisories")
    def turbulence_advisories(self, request):
        """Active turbulence (TURB*) advisories with polygons for the map overlay."""
        now = timezone.now()
        advisories = AirspaceAdvisory.objects.filter(valid_from__lte=now, valid_to__gte=now, hazard__startswith="TURB")
        return Response(
            {
                "advisories": AirspaceAdvisorySerializer(advisories, many=True).data,
                "count": advisories.count(),
            }
        )

    @extend_schema(summary="Per-aircraft turbulence risk map (hex -> score/level)")
    @action(detail=False, methods=["get"], url_path="turbulence/aircraft")
    def turbulence_aircraft(self, request):
        """Cached turbulence risk per tracked aircraft, written by the scorer task."""
        from skyspy.tasks.turbulence import CACHE_KEY_BY_HEX

        by_hex = cache.get(CACHE_KEY_BY_HEX) or {}
        return Response({"aircraft": by_hex, "count": len(by_hex)})

    @extend_schema(
        summary="Get airspace boundaries",
        parameters=[
            OpenApiParameter(name="lat", type=float, description="Center latitude"),
            OpenApiParameter(name="lon", type=float, description="Center longitude"),
            OpenApiParameter(name="radius_nm", type=float, description="Search radius"),
            OpenApiParameter(name="airspace_class", type=str, description="Filter by class"),
        ],
        responses={200: AirspaceBoundarySerializer(many=True)},
    )
    @action(detail=False, methods=["get"], url_path="airspace/boundaries")
    def airspace_boundaries(self, request):
        """Get airspace boundaries."""
        queryset = AirspaceBoundary.objects.all()

        airspace_class = request.query_params.get("airspace_class")
        if airspace_class:
            queryset = queryset.filter(airspace_class=airspace_class)

        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")
        try:
            # Accept both 'radius' and 'radius_nm' for frontend compatibility
            radius_nm = float(request.query_params.get("radius", request.query_params.get("radius_nm", 100)))
            radius_nm = min(radius_nm, 1000)  # Cap at 1000nm
        except (ValueError, TypeError):
            radius_nm = 100

        if lat and lon:
            try:
                lat = float(lat)
                lon = float(lon)
                lat_delta = radius_nm / 60
                lon_delta = radius_nm / 60

                queryset = queryset.filter(
                    center_lat__gte=lat - lat_delta,
                    center_lat__lte=lat + lat_delta,
                    center_lon__gte=lon - lon_delta,
                    center_lon__lte=lon + lon_delta,
                )
            except (ValueError, TypeError):
                pass  # Skip spatial filtering if coordinates invalid

        boundaries = queryset[:200]

        return Response(
            {
                "boundaries": AirspaceBoundarySerializer(boundaries, many=True).data,
                "count": boundaries.count(),
            }
        )

    @extend_schema(
        summary="Get active wildfires near a point (Watch Duty)",
        parameters=[
            OpenApiParameter(name="lat", type=float, description="Center latitude"),
            OpenApiParameter(name="lon", type=float, description="Center longitude"),
            OpenApiParameter(name="radius_nm", type=float, description="Search radius (nm)"),
        ],
    )
    @action(detail=False, methods=["get"])
    def wildfires(self, request):
        """Active wildfire markers from the cached Watch Duty feed."""
        from django.conf import settings

        from skyspy.services import wildfires as wildfire_service

        try:
            lat = float(request.query_params.get("lat", getattr(settings, "FEEDER_LAT", 0)))
        except (ValueError, TypeError):
            lat = float(getattr(settings, "FEEDER_LAT", 0))
        try:
            lon = float(request.query_params.get("lon", getattr(settings, "FEEDER_LON", 0)))
        except (ValueError, TypeError):
            lon = float(getattr(settings, "FEEDER_LON", 0))
        try:
            radius_nm = float(request.query_params.get("radius", request.query_params.get("radius_nm", 250)))
            radius_nm = min(radius_nm, 1000)
        except (ValueError, TypeError):
            radius_nm = 250.0

        fires = wildfire_service.get_cached_wildfires(lat, lon, radius_nm)
        return Response({"wildfires": fires, "count": len(fires)})

    @extend_schema(summary="Per-fire detail bundle (reports, cameras, scanner feeds)")
    @action(detail=False, methods=["get"], url_path=r"wildfires/(?P<event_id>\d+)/bundle")
    def wildfire_bundle(self, request, event_id=None):
        """Detail-panel bundle for one wildfire (Watch Duty get_fire_bundle)."""
        from skyspy.services import wildfires as wildfire_service

        try:
            fire_id = int(event_id)
        except (ValueError, TypeError):
            return Response({"error": "invalid event_id"}, status=status.HTTP_400_BAD_REQUEST)

        bundle = wildfire_service.get_fire_bundle(fire_id)
        if bundle is None:
            return Response({"error": "wildfires disabled or unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(bundle)

    @extend_schema(
        summary="Get airports",
        parameters=[
            OpenApiParameter(name="lat", type=float, description="Center latitude"),
            OpenApiParameter(name="lon", type=float, description="Center longitude"),
            OpenApiParameter(name="radius_nm", type=float, description="Search radius"),
            OpenApiParameter(name="type", type=str, description="Airport type filter"),
        ],
        responses={200: CachedAirportSerializer(many=True)},
    )
    @action(detail=False, methods=["get"])
    def airports(self, request):
        """Get airport data."""
        airport_type = request.query_params.get("type")
        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")
        try:
            # Accept both 'radius' and 'radius_nm' for frontend compatibility
            radius_nm = float(request.query_params.get("radius", request.query_params.get("radius_nm", 100)))
            radius_nm = min(radius_nm, 1000)  # Cap at 1000nm
        except (ValueError, TypeError):
            radius_nm = 100
        try:
            limit = int(request.query_params.get("limit", 500))
            limit = min(limit, 1000)  # Cap at 1000
        except (ValueError, TypeError):
            limit = 500

        # Build cache key from query params (round lat/lon for better cache hits)
        try:
            lat_rounded = round(float(lat), 2) if lat else None
            lon_rounded = round(float(lon), 2) if lon else None
        except (ValueError, TypeError):
            lat_rounded = None
            lon_rounded = None
        radius_rounded = round(radius_nm, 0)
        cache_key = f"airports:{lat_rounded}:{lon_rounded}:{radius_rounded}:{airport_type}:{limit}"

        cached_data = cache.get(cache_key)
        if cached_data is not None:
            return Response(cached_data)

        queryset = CachedAirport.objects.all()

        if airport_type:
            queryset = queryset.filter(airport_type=airport_type)

        if lat and lon:
            try:
                lat = float(lat)
                lon = float(lon)
                lat_delta = radius_nm / 60
                lon_delta = radius_nm / 60

                queryset = queryset.filter(
                    latitude__gte=lat - lat_delta,
                    latitude__lte=lat + lat_delta,
                    longitude__gte=lon - lon_delta,
                    longitude__lte=lon + lon_delta,
                )
            except (ValueError, TypeError):
                pass  # Skip spatial filtering if coordinates invalid

        airports = queryset[:limit]

        response_data = {
            "airports": CachedAirportSerializer(airports, many=True).data,
            "count": airports.count(),
        }

        # Cache for 5 minutes (airport data rarely changes)
        cache.set(cache_key, response_data, timeout=300)

        return Response(response_data)

    @extend_schema(
        summary="Get navaids",
        parameters=[
            OpenApiParameter(name="lat", type=float, description="Center latitude"),
            OpenApiParameter(name="lon", type=float, description="Center longitude"),
            OpenApiParameter(name="radius_nm", type=float, description="Search radius"),
            OpenApiParameter(name="type", type=str, description="Navaid type filter"),
        ],
        responses={200: CachedNavaidSerializer(many=True)},
    )
    @action(detail=False, methods=["get"])
    def navaids(self, request):
        """Get navaid data."""
        queryset = CachedNavaid.objects.all()

        navaid_type = request.query_params.get("type")
        if navaid_type:
            queryset = queryset.filter(navaid_type=navaid_type)

        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")
        try:
            # Accept both 'radius' and 'radius_nm' for frontend compatibility
            radius_nm = float(request.query_params.get("radius", request.query_params.get("radius_nm", 100)))
            radius_nm = min(radius_nm, 1000)  # Cap at 1000nm
        except (ValueError, TypeError):
            radius_nm = 100

        if lat and lon:
            try:
                lat = float(lat)
                lon = float(lon)
                lat_delta = radius_nm / 60
                lon_delta = radius_nm / 60

                queryset = queryset.filter(
                    latitude__gte=lat - lat_delta,
                    latitude__lte=lat + lat_delta,
                    longitude__gte=lon - lon_delta,
                    longitude__lte=lon + lon_delta,
                )
            except (ValueError, TypeError):
                pass  # Skip spatial filtering if coordinates invalid

        navaids = queryset[:500]

        return Response(
            {
                "navaids": CachedNavaidSerializer(navaids, many=True).data,
                "count": navaids.count(),
            }
        )

    @extend_schema(
        summary="Get terrain elevation",
        description="Get terrain elevation for a single point using SRTM data",
        parameters=[
            OpenApiParameter(name="lat", type=float, required=True, description="Latitude"),
            OpenApiParameter(name="lon", type=float, required=True, description="Longitude"),
        ],
    )
    @action(detail=False, methods=["get"], url_path="terrain-elevation")
    def terrain_elevation(self, request):
        """Get terrain elevation for a single lat/lon point."""
        from skyspy.services.terrain_elevation import get_elevation_ft

        lat = request.query_params.get("lat")
        lon = request.query_params.get("lon")

        if not lat or not lon:
            return Response({"error": "lat and lon parameters required"}, status=400)

        try:
            lat = float(lat)
            lon = float(lon)
        except (ValueError, TypeError):
            return Response({"error": "Invalid lat/lon values"}, status=400)

        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return Response({"error": "lat/lon out of range"}, status=400)

        elevation_ft = get_elevation_ft(lat, lon)

        return Response(
            {
                "lat": lat,
                "lon": lon,
                "elevation_ft": elevation_ft,
                "source": "srtm",
            }
        )

    @extend_schema(
        summary="Get terrain elevation grid",
        description="Get a grid of terrain elevations for a bounding box",
        parameters=[
            OpenApiParameter(name="north", type=float, required=True, description="North latitude"),
            OpenApiParameter(name="south", type=float, required=True, description="South latitude"),
            OpenApiParameter(name="east", type=float, required=True, description="East longitude"),
            OpenApiParameter(name="west", type=float, required=True, description="West longitude"),
            OpenApiParameter(name="resolution", type=int, description="Grid resolution (5-50, default 20)"),
        ],
    )
    @action(detail=False, methods=["get"], url_path="terrain-grid")
    def terrain_grid(self, request):
        """Get a grid of terrain elevations for a bounding box."""
        from skyspy.services.terrain_elevation import get_elevation_grid

        try:
            north = float(request.query_params.get("north"))
            south = float(request.query_params.get("south"))
            east = float(request.query_params.get("east"))
            west = float(request.query_params.get("west"))
        except (ValueError, TypeError):
            return Response({"error": "north, south, east, west parameters required"}, status=400)

        try:
            resolution = int(request.query_params.get("resolution", 20))
        except (ValueError, TypeError):
            resolution = 20

        # Validate bounds
        if north <= south or east <= west:
            return Response({"error": "Invalid bounds"}, status=400)

        # Limit grid area to prevent abuse
        lat_range = north - south
        lon_range = east - west
        if lat_range > 10 or lon_range > 10:
            return Response({"error": "Bounds too large (max 10 degrees)"}, status=400)

        grid = get_elevation_grid(north, south, east, west, resolution)

        return Response(grid)

    @extend_schema(
        summary="Get NEXRAD weather radar image",
        description="Proxied NEXRAD composite reflectivity radar image",
        parameters=[
            OpenApiParameter(name="north", type=float, required=True, description="North latitude"),
            OpenApiParameter(name="south", type=float, required=True, description="South latitude"),
            OpenApiParameter(name="east", type=float, required=True, description="East longitude"),
            OpenApiParameter(name="west", type=float, required=True, description="West longitude"),
            OpenApiParameter(name="width", type=int, description="Image width (default 1024)"),
            OpenApiParameter(name="height", type=int, description="Image height (default 1024)"),
        ],
    )
    @action(detail=False, methods=["get"])
    def nexrad(self, request):
        """Get proxied NEXRAD weather radar image."""
        from django.http import HttpResponse

        from skyspy.services import weather_cache

        try:
            north = float(request.query_params.get("north"))
            south = float(request.query_params.get("south"))
            east = float(request.query_params.get("east"))
            west = float(request.query_params.get("west"))
        except (ValueError, TypeError):
            return Response({"error": "north, south, east, west parameters required"}, status=400)

        try:
            width = int(request.query_params.get("width", 1024))
            height = int(request.query_params.get("height", 1024))
        except (ValueError, TypeError):
            width, height = 1024, 1024

        # Cap dimensions
        width = min(width, 2048)
        height = min(height, 2048)

        bbox = f"{west},{south},{east},{north}"
        image_data = weather_cache.fetch_nexrad_radar(bbox, width, height)

        if image_data:
            response = HttpResponse(image_data, content_type="image/png")
            response["Cache-Control"] = "public, max-age=300"
            return response

        return Response({"error": "Failed to fetch radar image"}, status=502)

    @extend_schema(
        summary="Get winds aloft data",
        description="Proxied winds aloft forecast data from AWC",
        parameters=[
            OpenApiParameter(name="lat", type=float, required=True, description="Latitude"),
            OpenApiParameter(name="lon", type=float, required=True, description="Longitude"),
        ],
    )
    @action(detail=False, methods=["get"], url_path="winds-aloft")
    def winds_aloft(self, request):
        """Get winds aloft forecast data."""
        from skyspy.services import weather_cache

        try:
            lat = float(request.query_params.get("lat"))
            lon = float(request.query_params.get("lon"))
        except (ValueError, TypeError):
            return Response({"error": "lat and lon parameters required"}, status=400)

        data = weather_cache.fetch_winds_aloft(lat, lon)

        if data is None:
            return Response({"error": "Failed to fetch winds aloft data"}, status=502)

        return Response(
            {
                "data": data,
                "source": "aviationweather.gov",
                "cached": True,
            }
        )

    @extend_schema(
        summary="Get active SIGMETs/AIRMETs (proxied)",
        description="Proxied active SIGMETs and AIRMETs from AWC, cached server-side",
    )
    @action(detail=False, methods=["get"], url_path="sigmets-proxy")
    def sigmets_proxy(self, request):
        """Get proxied SIGMETs/AIRMETs from AWC."""
        from skyspy.services import weather_cache

        data = weather_cache.fetch_sigmets()

        return Response(
            {
                "data": data,
                "count": len(data),
                "source": "aviationweather.gov",
                "cached": True,
            }
        )
