"""
System health, status, and info API views.
"""

import contextlib
import logging
import os
import time

from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError, connection
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from skyspy.api.throttles import ExternalLookupRateThrottle
from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import FeatureBasedPermission, RequireAuthenticated
from skyspy.models import AircraftSession, AircraftSighting, AlertHistory, AlertRule, NotificationConfig, SafetyEvent
from skyspy.serializers.system import (
    ApiInfoSerializer,
    HealthResponseSerializer,
    StatusResponseSerializer,
)

logger = logging.getLogger(__name__)


def _host_cpu_mem():
    """Best-effort host CPU% and memory% via stdlib /proc (no psutil dependency).

    Returns (cpu_percent, memory_percent, load_average); any value may be None
    on platforms without /proc (e.g. macOS) — callers must handle None.
    """
    cpu_percent = None
    try:

        def _cpu_times():
            with open("/proc/stat") as f:
                parts = f.readline().split()[1:]
            vals = [float(v) for v in parts]
            idle = vals[3] + (vals[4] if len(vals) > 4 else 0.0)
            return sum(vals), idle

        total1, idle1 = _cpu_times()
        time.sleep(0.1)
        total2, idle2 = _cpu_times()
        dt = total2 - total1
        if dt > 0:
            cpu_percent = round((1 - (idle2 - idle1) / dt) * 100, 1)
    except (OSError, IndexError, ValueError):
        pass

    mem_percent = None
    try:
        with open("/proc/meminfo") as f:
            meminfo = dict(line.split(":", 1) for line in f if ":" in line)
        total = float(meminfo["MemTotal"].strip().split()[0])
        available = float(meminfo["MemAvailable"].strip().split()[0])
        if total > 0:
            mem_percent = round((1 - available / total) * 100, 1)
    except (OSError, KeyError, ValueError, IndexError):
        pass

    load = None
    with contextlib.suppress(OSError, AttributeError):
        load = round(os.getloadavg()[0], 2)

    return cpu_percent, mem_percent, load


class HealthCheckView(APIView):
    """Simple health check endpoint.

    Public liveness probe for load balancers. Anonymous callers get only the
    overall status + timestamp; the per-service breakdown (which reveals backend
    topology and libacars internals) is returned only to authenticated users.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = []

    @extend_schema(
        summary="Health check",
        description="Simple health check endpoint for load balancers and monitoring",
        responses={200: HealthResponseSerializer},
    )
    def get(self, request):
        """Return health status of all services."""
        services = {}
        overall_status = "healthy"

        # Check database
        try:
            start = time.time()
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            db_latency = (time.time() - start) * 1000
            services["database"] = {"status": "up", "latency_ms": round(db_latency, 2)}
        except Exception as e:  # broad: health probe must report any failure as "down"
            services["database"] = {"status": "down", "message": str(e)}
            overall_status = "unhealthy"

        # Check Redis/cache
        try:
            cache.set("health_check", "ok", 10)
            if cache.get("health_check") == "ok":
                services["cache"] = {"status": "up"}
            else:
                services["cache"] = {"status": "degraded"}
                if overall_status == "healthy":
                    overall_status = "degraded"
        except Exception as e:  # broad: health probe must report any cache failure as "down"
            services["cache"] = {"status": "down", "message": str(e)}
            overall_status = "unhealthy"

        # Check Celery (via cache key set by beat)
        try:
            celery_heartbeat = cache.get("celery_heartbeat")
            if celery_heartbeat:
                services["celery"] = {"status": "up"}
            else:
                services["celery"] = {"status": "unknown", "message": "No heartbeat"}
        except Exception as e:  # broad: health probe reports celery status, never raises
            services["celery"] = {"status": "unknown", "message": f"Cache unavailable: {str(e)}"}

        # Check libacars
        try:
            from skyspy.services.libacars_binding import get_health

            libacars_health = get_health()
            services["libacars"] = {
                "status": "up" if libacars_health.get("available") else "unavailable",
                "circuit_state": libacars_health.get("circuit_state", "unknown"),
                "healthy": libacars_health.get("healthy", False),
            }
            if libacars_health.get("issues"):
                services["libacars"]["issues"] = libacars_health["issues"]
        except Exception as e:  # broad: CFFI binding health probe, unknowable failure modes
            services["libacars"] = {"status": "error", "message": str(e)}

        timestamp = timezone.now().isoformat().replace("+00:00", "Z")

        # Anonymous callers (public dashboards / load balancers) get liveness only.
        # The per-service breakdown is infrastructure detail — authenticated only.
        if not (request.user and request.user.is_authenticated):
            return Response({"status": overall_status, "timestamp": timestamp})

        return Response(
            {
                "status": overall_status,
                "services": services,
                "timestamp": timestamp,
            }
        )


def _get_cached_table_counts():
    """
    Get table counts with caching to reduce database load.

    Caches counts for 60 seconds (RPi optimization).
    """
    cache_key = "system_table_counts"
    cached = cache.get(cache_key)
    if cached:
        return cached

    counts = {
        "total_sightings": 0,
        "total_sessions": 0,
        "active_rules": 0,
        "alert_history_count": 0,
        "safety_event_count": 0,
    }

    # broad: each count is a best-effort probe — StatusView must always return
    # valid JSON, so any failure (not only DatabaseError) leaves the default 0.
    with contextlib.suppress(Exception):
        counts["total_sightings"] = AircraftSighting.objects.count()

    with contextlib.suppress(Exception):
        counts["total_sessions"] = AircraftSession.objects.count()

    with contextlib.suppress(Exception):
        counts["active_rules"] = AlertRule.objects.filter(enabled=True).count()

    with contextlib.suppress(Exception):
        counts["alert_history_count"] = AlertHistory.objects.count()

    with contextlib.suppress(Exception):
        counts["safety_event_count"] = SafetyEvent.objects.count()

    # Cache for 60 seconds
    cache.set(cache_key, counts, timeout=60)
    return counts


class StatusView(APIView):
    """Comprehensive system status endpoint.

    Reachable anonymously (it also backs the public Statistics card), but the
    sensitive infrastructure fields — feeder location, worker PID, scheduled
    Celery tasks, connection counts, antenna RSSI — are included only for
    authenticated users. The full-detail System page is separately hidden from
    anonymous visitors in the nav.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = []

    @extend_schema(
        summary="System status",
        description="Comprehensive status of all system components",
        responses={200: StatusResponseSerializer},
    )
    def get(self, request):
        """Return comprehensive system status."""
        from skyspy import __version__

        # Get cached counts (RPi optimization)
        counts = _get_cached_table_counts()
        total_sightings = counts["total_sightings"]
        total_sessions = counts["total_sessions"]
        active_rules = counts["active_rules"]
        alert_history_count = counts["alert_history_count"]
        safety_event_count = counts["safety_event_count"]

        # Check notification config
        try:
            notif_config = NotificationConfig.get_config()
            notifications_configured = bool(notif_config.apprise_urls)
        except Exception:  # broad: StatusView must always return valid JSON (tested)
            notifications_configured = False

        # Get current aircraft count from cache
        current_aircraft = cache.get("current_aircraft", [])
        aircraft_count = len(current_aircraft) if current_aircraft else 0

        # Check if ADS-B source is online (via cache)
        adsb_online = cache.get("adsb_online", False)

        # Get Celery task info
        celery_running = bool(cache.get("celery_heartbeat"))

        # Get safety monitor stats (detection runs in the celery worker, which
        # publishes stats to the shared cache; this process tracks nothing)
        safety_tracked_aircraft = 0
        try:
            from skyspy.services.safety import safety_monitor

            safety_stats = cache.get("safety:monitor_stats") or safety_monitor.get_stats()
            safety_tracked_aircraft = safety_stats.get("tracked_aircraft", 0)
        except (AttributeError, KeyError, TypeError):
            pass

        # Get WebSocket connection count from cache (set by channels consumer)
        websocket_connections = cache.get("websocket_connection_count", 0)

        # Get SSE subscriber count from cache (set by SSE views)
        sse_subscribers = cache.get("sse_subscriber_count", 0)

        # Get scheduled Celery tasks (cached to reduce DB load)
        celery_tasks = cache.get("celery_periodic_tasks")
        if celery_tasks is None:
            celery_tasks = []
            try:
                from django_celery_beat.models import PeriodicTask

                active_tasks = PeriodicTask.objects.filter(enabled=True).values_list("name", flat=True)
                celery_tasks = list(active_tasks)
                cache.set("celery_periodic_tasks", celery_tasks, timeout=300)  # Cache for 5 minutes
            except DatabaseError:
                pass

        # Get antenna analytics from cache
        antenna_analytics = cache.get("antenna_analytics")
        antenna_summary = None
        if antenna_analytics:
            antenna_summary = {
                "max_range_nm": antenna_analytics.get("overall_max_range"),
                "avg_range_nm": antenna_analytics.get("avg_range"),
                "coverage_percentage": antenna_analytics.get("coverage_percentage"),
                "sectors_with_data": antenna_analytics.get("sectors_with_data"),
                "total_positions": antenna_analytics.get("total_positions"),
                "unique_aircraft": antenna_analytics.get("unique_aircraft"),
                "best_rssi": antenna_analytics.get("best_rssi"),
                "avg_rssi": antenna_analytics.get("avg_rssi"),
                "last_updated": antenna_analytics.get("timestamp"),
            }

        # Get libacars stats
        libacars_status = None
        try:
            from skyspy.services.libacars_binding import get_stats, is_available

            libacars_status = {
                "available": is_available(),
                "stats": get_stats(),
            }
        except Exception:  # broad: CFFI binding load may fail in unknowable ways
            libacars_status = {"available": False, "error": "Could not load libacars"}

        cpu_percent, memory_percent, load_average = _host_cpu_mem()

        payload = {
            "version": __version__,
            "adsb_online": adsb_online,
            "aircraft_count": aircraft_count,
            "cpu_percent": cpu_percent,
            "memory_percent": memory_percent,
            "load_average": load_average,
            "total_sightings": total_sightings,
            "total_sessions": total_sessions,
            "active_rules": active_rules,
            "alert_history_count": alert_history_count,
            "safety_event_count": safety_event_count,
            "safety_monitoring_enabled": settings.SAFETY_MONITORING_ENABLED,
            "safety_tracked_aircraft": safety_tracked_aircraft,
            "notifications_configured": notifications_configured,
            "redis_enabled": bool(settings.REDIS_URL),
            "acars_enabled": settings.ACARS_ENABLED,
            "acars_running": bool(cache.get("acars_running")),
            "polling_interval_seconds": settings.POLLING_INTERVAL,
            "db_store_interval_seconds": settings.DB_STORE_INTERVAL,
            "celery_running": celery_running,
        }

        # Sensitive infrastructure detail: authenticated users only. Anonymous
        # callers (public Statistics card) never see feeder location, PID,
        # scheduled tasks, connection counts, or antenna RSSI.
        if request.user and request.user.is_authenticated:
            payload.update(
                {
                    "websocket_connections": websocket_connections,
                    "sse_subscribers": sse_subscribers,
                    "celery_tasks": celery_tasks,
                    "worker_pid": os.getpid(),
                    "location": {"latitude": settings.FEEDER_LAT, "longitude": settings.FEEDER_LON},
                    "antenna": antenna_summary,
                    "libacars": libacars_status,
                }
            )

        return Response(payload)


class SystemInfoView(APIView):
    """API information endpoint.

    Enumerates the API surface (including admin/task/websocket routes), so it is
    restricted to authenticated users to avoid handing anonymous visitors an
    attack-surface map.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [RequireAuthenticated]

    @extend_schema(
        summary="API information",
        description="Information about the API and available endpoints",
        responses={200: ApiInfoSerializer},
    )
    def get(self, request):
        """Return API information."""
        from skyspy import __version__

        return Response(
            {
                "version": __version__,
                "name": "SkysPy ADS-B Tracking API",
                "description": "Real-time ADS-B aircraft tracking, ACARS messaging, and aviation data",
                "endpoints": {
                    "aircraft": {
                        "list": "/api/v1/aircraft/",
                        "detail": "/api/v1/aircraft/{hex}/",
                        "top": "/api/v1/aircraft/top/",
                        "stats": "/api/v1/aircraft/stats/",
                    },
                    "history": {
                        "sightings": "/api/v1/sightings/",
                        "sessions": "/api/v1/sessions/",
                        "stats": "/api/v1/history/stats/",
                        "trends": "/api/v1/history/trends/",
                        "time_comparison": "/api/v1/history/time-comparison/",
                        "time_comparison_week": "/api/v1/history/time-comparison/week/",
                        "time_comparison_seasonal": "/api/v1/history/time-comparison/seasonal/",
                        "time_comparison_day_night": "/api/v1/history/time-comparison/day-night/",
                        "time_comparison_weekend_weekday": "/api/v1/history/time-comparison/weekend-weekday/",
                        "time_comparison_daily": "/api/v1/history/time-comparison/daily/",
                        "time_comparison_weekly": "/api/v1/history/time-comparison/weekly/",
                        "time_comparison_monthly": "/api/v1/history/time-comparison/monthly/",
                    },
                    "alerts": {
                        "rules": "/api/v1/alerts/rules/",
                        "history": "/api/v1/alerts/history/",
                    },
                    "safety": {
                        "events": "/api/v1/safety/events/",
                        "stats": "/api/v1/safety/events/stats/",
                    },
                    "acars": {
                        "messages": "/api/v1/acars/",
                        "stats": "/api/v1/acars/stats/",
                    },
                    "audio": {
                        "transmissions": "/api/v1/audio/",
                        "upload": "/api/v1/audio/upload/",
                        "stats": "/api/v1/audio/stats/",
                    },
                    "aviation": {
                        "metars": "/api/v1/aviation/metars/",
                        "tafs": "/api/v1/aviation/tafs/",
                        "pireps": "/api/v1/aviation/pireps/",
                        "airports": "/api/v1/aviation/airports/",
                    },
                    "map": {
                        "geojson": "/api/v1/map/geojson/",
                    },
                    "system": {
                        "health": "/health",
                        "status": "/api/v1/system/status",
                        "info": "/api/v1/system/info",
                        "databases": "/api/v1/system/databases",
                        "geodata": "/api/v1/system/geodata",
                        "weather": "/api/v1/system/weather",
                    },
                    "tasks": {
                        "list": "/api/v1/tasks/",
                        "detail": "/api/v1/tasks/{task_id}/",
                        "status": "/api/v1/tasks/{task_id}/status/",
                        "revoke": "/api/v1/tasks/{task_id}/revoke/",
                        "stats": "/api/v1/tasks/stats/",
                        "active": "/api/v1/tasks/active/",
                        "registered": "/api/v1/tasks/registered/",
                    },
                    "lookup": {
                        "aircraft": "/api/v1/lookup/aircraft/{icao_hex}",
                        "opensky": "/api/v1/lookup/opensky/{icao_hex}",
                        "route": "/api/v1/lookup/route/{callsign}",
                    },
                    "websocket": {
                        "aircraft": "ws://host/ws/aircraft/",
                        "airspace": "ws://host/ws/airspace/",
                        "safety": "ws://host/ws/safety/",
                        "acars": "ws://host/ws/acars/",
                        "audio": "ws://host/ws/audio/",
                    },
                    "docs": {
                        "openapi": "/api/schema/",
                        "swagger": "/api/docs/",
                        "redoc": "/api/redoc/",
                    },
                },
            }
        )


class MetricsView(APIView):
    """Prometheus metrics endpoint.

    Metrics leak internal performance/state, so scraping requires authentication
    (use an API key with the scraper) even on a public deployment. If Prometheus
    is isolated at the network layer instead, front it there rather than opening
    this up.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [RequireAuthenticated]

    def get(self, request):
        """Return Prometheus metrics including libacars metrics."""
        if not settings.PROMETHEUS_ENABLED:
            return Response({"error": "Metrics disabled"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        try:
            from django.http import HttpResponse
            from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

            # Get standard prometheus metrics
            metrics_output = generate_latest().decode("utf-8")

            # Add libacars metrics
            try:
                from skyspy.services.libacars_binding import export_prometheus_metrics

                libacars_metrics = export_prometheus_metrics()
                if libacars_metrics:
                    metrics_output += "\n# libacars metrics\n" + libacars_metrics
            except Exception as e:  # broad: metrics export must never break the metrics endpoint
                logger.debug(f"Could not get libacars metrics: {e}")

            return HttpResponse(metrics_output, content_type=CONTENT_TYPE_LATEST)
        except ImportError:
            return Response({"error": "prometheus_client not installed"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


class ExternalDatabaseStatsView(APIView):
    """External aircraft database statistics."""

    def get_permissions(self):
        """Require authentication based on AUTH_MODE."""
        from skyspy.auth.permissions import IsAuthenticatedOrPublic

        return [IsAuthenticatedOrPublic()]

    @extend_schema(
        summary="External database stats",
        description="Statistics about loaded external aircraft databases (ADSBX, tar1090, FAA, OpenSky)",
    )
    def get(self, request):
        """Return external database statistics."""
        try:
            from skyspy.services import external_db

            stats = external_db.get_database_stats()

            return Response(
                {
                    "databases": stats,
                    "any_loaded": external_db.is_any_loaded(),
                }
            )
        except Exception as e:  # broad: view guard over external_db (net/DB/file/parse mix)
            logger.error(f"Error getting database stats: {e}")
            return Response({"databases": {}, "any_loaded": False, "error": str(e)})


class OpenSkyLookupView(APIView):
    """Lookup aircraft by ICAO hex code in OpenSky database.

    Fans out to external databases (OpenSky, then an aggregated lookup), so it
    requires authentication and is strictly rate-limited to prevent scripted
    hex-scans from burning external-API quota / getting the feeder banned.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [RequireAuthenticated]
    throttle_classes = [ExternalLookupRateThrottle]

    @extend_schema(
        summary="OpenSky aircraft lookup",
        description="Look up aircraft information by ICAO hex code in the OpenSky Network database",
    )
    def get(self, request, icao_hex):
        """Look up aircraft by ICAO hex code."""
        try:
            from skyspy.services import external_db

            # Try OpenSky first
            data = external_db.lookup_opensky(icao_hex)
            if data:
                return Response({"icao_hex": icao_hex.upper(), "source": "opensky", "data": data})

            # Fall back to aggregated lookup
            data = external_db.lookup_all(icao_hex)
            if data:
                return Response(
                    {
                        "icao_hex": icao_hex.upper(),
                        "source": data.get("sources", ["unknown"])[0] if data.get("sources") else "unknown",
                        "data": data,
                    }
                )

            return Response(
                {
                    "icao_hex": icao_hex.upper(),
                    "source": None,
                    "data": None,
                    "message": "Aircraft not found in any database",
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        except Exception as e:  # broad: view guard over external_db lookup (net/DB/parse mix)
            logger.error(f"Error looking up {icao_hex}: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class AircraftLookupView(APIView):
    """Aggregated aircraft lookup across all databases.

    Merges ADSBX / tar1090 / FAA / OpenSky — several outbound requests per call —
    so it requires authentication and is strictly rate-limited (a single scripted
    hex list would otherwise trigger thousands of external calls).
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [RequireAuthenticated]
    throttle_classes = [ExternalLookupRateThrottle]

    @extend_schema(
        summary="Aggregated aircraft lookup",
        description="Look up aircraft information across all external databases (ADSBX, tar1090, FAA, OpenSky)",
    )
    def get(self, request, icao_hex):
        """Look up aircraft in all databases and merge results."""
        try:
            from skyspy.services import external_db

            data = external_db.lookup_all(icao_hex)
            if data:
                return Response({"icao_hex": icao_hex.upper(), "sources": data.pop("sources", []), "data": data})

            return Response(
                {
                    "icao_hex": icao_hex.upper(),
                    "sources": [],
                    "data": None,
                    "message": "Aircraft not found in any database",
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        except Exception as e:  # broad: view guard over external_db lookup (net/DB/parse mix)
            logger.error(f"Error looking up {icao_hex}: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class RouteLookupView(APIView):
    """Look up flight route by callsign."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    # Route lookup hits adsb.im per call — keep it usable on public dashboards
    # (per AUTH_MODE) but rate-limit to blunt scripted abuse.
    throttle_classes = [ExternalLookupRateThrottle]

    @extend_schema(summary="Route lookup", description="Look up flight route information by callsign from adsb.im")
    def get(self, request, callsign):
        """Look up flight route by callsign."""
        try:
            from skyspy.services import external_db

            route = external_db.fetch_route(callsign)
            if route:
                return Response({"callsign": callsign.upper(), "route": route})

            return Response(
                {"callsign": callsign.upper(), "route": None, "message": "Route not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        except Exception as e:  # broad: view guard over external_db route fetch (net/parse mix)
            logger.error(f"Error looking up route for {callsign}: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class GeodataStatsView(APIView):
    """Geographic data cache statistics."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="Geodata cache stats",
        description="Statistics about cached geographic data (airports, navaids, GeoJSON)",
    )
    def get(self, request):
        """Return geodata cache statistics."""
        try:
            from skyspy.services import geodata

            stats = geodata.get_cache_stats()

            return Response(stats)
        except Exception as e:  # broad: view guard over geodata service (cache/file/parse mix)
            logger.error(f"Error getting geodata stats: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class WeatherCacheStatsView(APIView):
    """Weather cache statistics."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(summary="Weather cache stats", description="Statistics about cached weather data (METAR, PIREP)")
    def get(self, request):
        """Return weather cache statistics."""
        try:
            from skyspy.services import weather_cache

            metar_stats = weather_cache.get_metar_stats()
            pirep_stats = weather_cache.get_pirep_stats()

            return Response(
                {
                    "metar": metar_stats,
                    "pirep": pirep_stats,
                    # Add legacy keys for test compatibility
                    "metar_count": metar_stats.get("cache_hits", 0) + metar_stats.get("cache_misses", 0),
                    "taf_count": 0,  # TAF stats not separately tracked
                }
            )
        except Exception as e:  # broad: view guard over weather_cache service (net/cache/parse mix)
            logger.error(f"Error getting weather stats: {e}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
