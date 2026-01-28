"""
System health, status, and info API views.
"""
import os
import time
import logging
from datetime import datetime

from django.conf import settings
from django.utils import timezone
from django.core.cache import cache
from django.db import connection
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema

from skyspy.models import (
    AircraftSighting, AircraftSession, AlertRule, AlertHistory,
    SafetyEvent, NotificationConfig
)
from skyspy.serializers.system import (
    HealthResponseSerializer,
    StatusResponseSerializer,
    ApiInfoSerializer,
)

logger = logging.getLogger(__name__)


class HealthCheckView(APIView):
    """Simple health check endpoint."""

    authentication_classes = []
    permission_classes = []

    @extend_schema(
        summary="Health check",
        description="Simple health check endpoint for load balancers and monitoring",
        responses={200: HealthResponseSerializer}
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
            services["database"] = {
                "status": "up",
                "latency_ms": round(db_latency, 2)
            }
        except Exception as e:
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
        except Exception as e:
            services["cache"] = {"status": "down", "message": str(e)}
            overall_status = "unhealthy"

        # Check Celery (via cache key set by beat)
        try:
            celery_heartbeat = cache.get("celery_heartbeat")
            if celery_heartbeat:
                services["celery"] = {"status": "up"}
            else:
                services["celery"] = {"status": "unknown", "message": "No heartbeat"}
        except Exception as e:
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
        except Exception as e:
            services["libacars"] = {"status": "error", "message": str(e)}

        return Response({
            "status": overall_status,
            "services": services,
            "timestamp": timezone.now().isoformat().replace("+00:00", "Z")
        })


class StatusView(APIView):
    """Comprehensive system status endpoint."""

    authentication_classes = []
    permission_classes = []

    @extend_schema(
        summary="System status",
        description="Comprehensive status of all system components",
        responses={200: StatusResponseSerializer}
    )
    def get(self, request):
        """Return comprehensive system status."""
        from skyspy import __version__

        # Get counts from database
        try:
            total_sightings = AircraftSighting.objects.count()
        except Exception:
            total_sightings = 0

        try:
            total_sessions = AircraftSession.objects.count()
        except Exception:
            total_sessions = 0

        try:
            active_rules = AlertRule.objects.filter(enabled=True).count()
        except Exception:
            active_rules = 0

        try:
            alert_history_count = AlertHistory.objects.count()
        except Exception:
            alert_history_count = 0

        try:
            safety_event_count = SafetyEvent.objects.count()
        except Exception:
            safety_event_count = 0

        # Check notification config
        try:
            notif_config = NotificationConfig.get_config()
            notifications_configured = bool(notif_config.apprise_urls)
        except Exception:
            notifications_configured = False

        # Get current aircraft count from cache
        current_aircraft = cache.get("current_aircraft", [])
        aircraft_count = len(current_aircraft) if current_aircraft else 0

        # Check if ADS-B source is online (via cache)
        adsb_online = cache.get("adsb_online", False)

        # Get Celery task info
        celery_running = bool(cache.get("celery_heartbeat"))

        # Get safety monitor stats
        safety_tracked_aircraft = 0
        try:
            from skyspy.services.safety import safety_monitor
            safety_stats = safety_monitor.get_stats()
            safety_tracked_aircraft = safety_stats.get("tracked_aircraft", 0)
        except Exception:
            pass

        # Get WebSocket connection count from cache (set by channels consumer)
        websocket_connections = cache.get("websocket_connection_count", 0)

        # Get SSE subscriber count from cache (set by SSE views)
        sse_subscribers = cache.get("sse_subscriber_count", 0)

        # Get scheduled Celery tasks
        celery_tasks = []
        try:
            from django_celery_beat.models import PeriodicTask
            active_tasks = PeriodicTask.objects.filter(enabled=True).values_list('name', flat=True)
            celery_tasks = list(active_tasks)
        except Exception:
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
        except Exception:
            libacars_status = {"available": False, "error": "Could not load libacars"}

        return Response({
            "version": __version__,
            "adsb_online": adsb_online,
            "aircraft_count": aircraft_count,
            "total_sightings": total_sightings,
            "total_sessions": total_sessions,
            "active_rules": active_rules,
            "alert_history_count": alert_history_count,
            "safety_event_count": safety_event_count,
            "safety_monitoring_enabled": settings.SAFETY_MONITORING_ENABLED,
            "safety_tracked_aircraft": safety_tracked_aircraft,
            "notifications_configured": notifications_configured,
            "redis_enabled": bool(settings.REDIS_URL),
            "websocket_connections": websocket_connections,
            "sse_subscribers": sse_subscribers,
            "acars_enabled": settings.ACARS_ENABLED,
            "acars_running": bool(cache.get("acars_running")),
            "polling_interval_seconds": settings.POLLING_INTERVAL,
            "db_store_interval_seconds": settings.DB_STORE_INTERVAL,
            "celery_running": celery_running,
            "celery_tasks": celery_tasks,
            "worker_pid": os.getpid(),
            "location": {
                "latitude": settings.FEEDER_LAT,
                "longitude": settings.FEEDER_LON
            },
            "antenna": antenna_summary,
            "libacars": libacars_status,
        })


class SystemInfoView(APIView):
    """API information endpoint."""

    authentication_classes = []
    permission_classes = []

    @extend_schema(
        summary="API information",
        description="Information about the API and available endpoints",
        responses={200: ApiInfoSerializer}
    )
    def get(self, request):
        """Return API information."""
        from skyspy import __version__

        return Response({
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
                }
            }
        })


class MetricsView(APIView):
    """Prometheus metrics endpoint."""

    authentication_classes = []
    permission_classes = []

    def get(self, request):
        """Return Prometheus metrics including libacars metrics."""
        if not settings.PROMETHEUS_ENABLED:
            return Response(
                {"error": "Metrics disabled"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        try:
            from prometheus_client import (
                generate_latest, CONTENT_TYPE_LATEST,
                Counter, Gauge, Histogram
            )
            from django.http import HttpResponse

            # Get standard prometheus metrics
            metrics_output = generate_latest().decode('utf-8')

            # Add libacars metrics
            try:
                from skyspy.services.libacars_binding import export_prometheus_metrics
                libacars_metrics = export_prometheus_metrics()
                if libacars_metrics:
                    metrics_output += "\n# libacars metrics\n" + libacars_metrics
            except Exception as e:
                logger.debug(f"Could not get libacars metrics: {e}")

            return HttpResponse(
                metrics_output,
                content_type=CONTENT_TYPE_LATEST
            )
        except ImportError:
            return Response(
                {"error": "prometheus_client not installed"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )


class ExternalDatabaseStatsView(APIView):
    """External aircraft database statistics."""

    def get_permissions(self):
        """Require authentication based on AUTH_MODE."""
        from skyspy.auth.permissions import IsAuthenticatedOrPublic
        return [IsAuthenticatedOrPublic()]

    @extend_schema(
        summary="External database stats",
        description="Statistics about loaded external aircraft databases (ADSBX, tar1090, FAA, OpenSky)"
    )
    def get(self, request):
        """Return external database statistics."""
        try:
            from skyspy.services import external_db

            stats = external_db.get_database_stats()

            return Response({
                "databases": stats,
                "any_loaded": external_db.is_any_loaded(),
            })
        except Exception as e:
            logger.error(f"Error getting database stats: {e}")
            return Response({
                "databases": {},
                "any_loaded": False,
                "error": str(e)
            })


class OpenSkyLookupView(APIView):
    """Lookup aircraft by ICAO hex code in OpenSky database."""

    authentication_classes = []
    permission_classes = []

    @extend_schema(
        summary="OpenSky aircraft lookup",
        description="Look up aircraft information by ICAO hex code in the OpenSky Network database"
    )
    def get(self, request, icao_hex):
        """Look up aircraft by ICAO hex code."""
        try:
            from skyspy.services import external_db

            # Try OpenSky first
            data = external_db.lookup_opensky(icao_hex)
            if data:
                return Response({
                    "icao_hex": icao_hex.upper(),
                    "source": "opensky",
                    "data": data
                })

            # Fall back to aggregated lookup
            data = external_db.lookup_all(icao_hex)
            if data:
                return Response({
                    "icao_hex": icao_hex.upper(),
                    "source": data.get("sources", ["unknown"])[0] if data.get("sources") else "unknown",
                    "data": data
                })

            return Response({
                "icao_hex": icao_hex.upper(),
                "source": None,
                "data": None,
                "message": "Aircraft not found in any database"
            }, status=status.HTTP_404_NOT_FOUND)

        except Exception as e:
            logger.error(f"Error looking up {icao_hex}: {e}")
            return Response({
                "error": str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class AircraftLookupView(APIView):
    """Aggregated aircraft lookup across all databases."""

    authentication_classes = []
    permission_classes = []

    @extend_schema(
        summary="Aggregated aircraft lookup",
        description="Look up aircraft information across all external databases (ADSBX, tar1090, FAA, OpenSky)"
    )
    def get(self, request, icao_hex):
        """Look up aircraft in all databases and merge results."""
        try:
            from skyspy.services import external_db

            data = external_db.lookup_all(icao_hex)
            if data:
                return Response({
                    "icao_hex": icao_hex.upper(),
                    "sources": data.pop("sources", []),
                    "data": data
                })

            return Response({
                "icao_hex": icao_hex.upper(),
                "sources": [],
                "data": None,
                "message": "Aircraft not found in any database"
            }, status=status.HTTP_404_NOT_FOUND)

        except Exception as e:
            logger.error(f"Error looking up {icao_hex}: {e}")
            return Response({
                "error": str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class RouteLookupView(APIView):
    """Look up flight route by callsign."""

    @extend_schema(
        summary="Route lookup",
        description="Look up flight route information by callsign from adsb.im"
    )
    def get(self, request, callsign):
        """Look up flight route by callsign."""
        try:
            from skyspy.services import external_db

            route = external_db.fetch_route(callsign)
            if route:
                return Response({
                    "callsign": callsign.upper(),
                    "route": route
                })

            return Response({
                "callsign": callsign.upper(),
                "route": None,
                "message": "Route not found"
            }, status=status.HTTP_404_NOT_FOUND)

        except Exception as e:
            logger.error(f"Error looking up route for {callsign}: {e}")
            return Response({
                "error": str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class GeodataStatsView(APIView):
    """Geographic data cache statistics."""

    @extend_schema(
        summary="Geodata cache stats",
        description="Statistics about cached geographic data (airports, navaids, GeoJSON)"
    )
    def get(self, request):
        """Return geodata cache statistics."""
        try:
            from skyspy.services import geodata

            stats = geodata.get_cache_stats()

            return Response(stats)
        except Exception as e:
            logger.error(f"Error getting geodata stats: {e}")
            return Response({
                "error": str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class WeatherCacheStatsView(APIView):
    """Weather cache statistics."""

    @extend_schema(
        summary="Weather cache stats",
        description="Statistics about cached weather data (METAR, PIREP)"
    )
    def get(self, request):
        """Return weather cache statistics."""
        try:
            from skyspy.services import weather_cache

            metar_stats = weather_cache.get_metar_stats()
            pirep_stats = weather_cache.get_pirep_stats()

            return Response({
                "metar": metar_stats,
                "pirep": pirep_stats,
                # Add legacy keys for test compatibility
                "metar_count": metar_stats.get("cache_hits", 0) + metar_stats.get("cache_misses", 0),
                "taf_count": 0,  # TAF stats not separately tracked
            })
        except Exception as e:
            logger.error(f"Error getting weather stats: {e}")
            return Response({
                "error": str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
