"""System status and health handlers for MainNamespace."""

import logging
from datetime import datetime, timedelta

from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from skyspy.socketio.server import sio

logger = logging.getLogger(__name__)


class SystemHandlerMixin:
    """System status, health checks, database stats, and permission helpers."""

    async def _handle_status(self, params: dict):
        """Get basic system status."""
        return await self._get_system_status()

    async def _handle_health(self, params: dict):
        """Get service health checks."""
        return await self._get_health_status()

    async def _handle_system_info(self, params: dict):
        """Get system information."""
        return await self._get_system_info()

    async def _handle_system_status(self, params: dict):
        """Get detailed system status."""
        return await self._get_detailed_system_status()

    async def _handle_database_stats(self, params: dict):
        """Get database statistics."""
        return await self._get_database_stats()

    async def _handle_ws_status(self, params: dict):
        """Get WebSocket service status."""
        try:
            socketio_connections = len(sio.eio.sockets) if hasattr(sio, "eio") and hasattr(sio.eio, "sockets") else 0
        except (AttributeError, TypeError):
            socketio_connections = 0

        return {
            "namespace": self.namespace,
            "supported_topics": self.SUPPORTED_TOPICS,
            "socketio_connections": socketio_connections,
            "subscribers": socketio_connections,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    # -----------------------------------------------------------------
    # Data access
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_system_status(self):
        """Get basic system status."""
        aircraft_list = cache.get("current_aircraft", [])
        adsb_online = cache.get("adsb_online", False)
        celery_ok = cache.get("celery_heartbeat", False)

        return {
            "online": adsb_online,
            "aircraft_count": len(aircraft_list),
            "celery_running": celery_ok,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    @sync_to_async
    def _get_health_status(self):
        """Get service health checks."""
        from django.db import DatabaseError, connection

        health = {"status": "healthy", "services": {}}

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            health["services"]["database"] = {"status": "up"}
        except (DatabaseError, OSError) as e:
            health["services"]["database"] = {"status": "down", "error": str(e)}
            health["status"] = "unhealthy"

        adsb_online = cache.get("adsb_online", False)
        health["services"]["adsb"] = {"status": "up" if adsb_online else "down"}

        celery_ok = cache.get("celery_heartbeat", False)
        health["services"]["celery"] = {"status": "up" if celery_ok else "unknown"}

        try:
            cache.set("_health_check", True, timeout=5)
            cache.get("_health_check")
            health["services"]["cache"] = {"status": "up"}
        except (ConnectionError, OSError, RuntimeError) as e:
            health["services"]["cache"] = {"status": "down", "error": str(e)}
            health["status"] = "degraded"

        health["timestamp"] = datetime.utcnow().isoformat() + "Z"
        return health

    async def _get_system_info(self):
        """Get system information."""
        import platform
        import sys

        return {
            "version": getattr(settings, "VERSION", "1.0.0"),
            "python_version": sys.version,
            "platform": platform.platform(),
            "django_version": __import__("django").get_version(),
            "debug": settings.DEBUG,
            "feeder": {
                "latitude": getattr(settings, "FEEDER_LAT", None),
                "longitude": getattr(settings, "FEEDER_LON", None),
            },
            "features": {
                "acars_enabled": getattr(settings, "ACARS_ENABLED", False),
                "safety_monitoring": getattr(settings, "SAFETY_MONITORING_ENABLED", True),
                "photo_cache": getattr(settings, "PHOTO_CACHE_ENABLED", False),
                "s3_storage": getattr(settings, "S3_ENABLED", False),
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    @sync_to_async
    def _get_detailed_system_status(self):
        """Get detailed system status."""
        from skyspy.models import AcarsMessage, AircraftSighting, SafetyEvent

        aircraft_list = cache.get("current_aircraft", [])

        cutoff_24h = timezone.now() - timedelta(hours=24)

        sighting_count = AircraftSighting.objects.filter(timestamp__gte=cutoff_24h).count()
        safety_count = SafetyEvent.objects.filter(timestamp__gte=cutoff_24h).count()
        acars_count = AcarsMessage.objects.filter(timestamp__gte=cutoff_24h).count()

        return {
            "aircraft": {
                "current": len(aircraft_list),
                "military": sum(1 for ac in aircraft_list if ac.get("military")),
                "emergency": sum(1 for ac in aircraft_list if ac.get("emergency")),
            },
            "last_24h": {
                "sightings": sighting_count,
                "safety_events": safety_count,
                "acars_messages": acars_count,
            },
            "receiver": {
                "online": cache.get("adsb_online", False),
                "messages": cache.get("aircraft_messages", 0),
            },
            "feeder": {
                "latitude": getattr(settings, "FEEDER_LAT", None),
                "longitude": getattr(settings, "FEEDER_LON", None),
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    @sync_to_async
    def _get_database_stats(self):
        """Get external database statistics."""
        from skyspy.models import AircraftInfo

        total = AircraftInfo.objects.count()
        with_photos = AircraftInfo.objects.exclude(photo_url__isnull=True).exclude(photo_url="").count()
        military = AircraftInfo.objects.filter(is_military=True).count()
        failed = AircraftInfo.objects.filter(fetch_failed=True).count()

        return {
            "aircraft_info": {
                "total": total,
                "with_photos": with_photos,
                "military": military,
                "failed_lookups": failed,
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    @sync_to_async
    def _is_feature_public(self, permission: str) -> bool:
        """Check if the feature for this permission is publicly accessible.

        Mutating permissions (e.g. 'alerts.manage') are gated on
        FeatureAccess.write_access; read permissions use read_access.
        """
        from skyspy.models.auth import FeatureAccess
        from skyspy.socketio.middleware.permissions import WRITE_ACTIONS

        feature, _, action = permission.partition(".")

        try:
            config = FeatureAccess.objects.get(feature=feature)
        except FeatureAccess.DoesNotExist:
            return False

        access = config.write_access if action in WRITE_ACTIONS else config.read_access
        return access == "public"

    @sync_to_async
    def _check_user_permission(self, user, permission: str) -> bool:
        """Check if an authenticated user has a specific permission."""
        from django.db import DatabaseError

        try:
            profile = user.skyspy_profile
            return profile.has_permission(permission)
        except (AttributeError, TypeError, DatabaseError) as e:
            logger.debug(f"Error checking user permission: {e}")
            return False
