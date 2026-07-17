"""
Cannonball Mode Socket.IO namespace for SkysPy.

Provides real-time threat detection for mobile devices with:
- Position updates from device GPS
- Filtered threat list with distance calculations
- Trend detection (approaching/departing)
- Threat level classification

Events:
- session_started - Emitted on connect with session ID
- threats - Threat list update
- radius_updated - Confirmation of radius change
- error - Error messages

Client events handled:
- position_update - Update device position
- set_radius - Set threat detection radius
- get_threats - Request current threats
- request - Request/response pattern
"""

import logging
import uuid
from datetime import datetime
from typing import Any

import socketio
from asgiref.sync import sync_to_async
from django.core.cache import cache

from skyspy.services.law_enforcement_db import (
    calculate_bearing,
    get_direction_name,
    get_threat_level,
    haversine_distance,
    identify_law_enforcement,
)
from skyspy.socketio.middleware import authenticate_socket, check_topic_permission
from skyspy.socketio.server import sio
from skyspy.socketio.utils.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

# Cache settings
POSITION_CACHE_PREFIX = "cannonball_pos:"
POSITION_CACHE_TTL = 60  # seconds


class CannonballNamespace(socketio.AsyncNamespace):
    """
    Socket.IO namespace optimized for mobile threat detection.

    Supports:
    - Position updates from mobile device
    - Filtered threat broadcasts
    - Request/response for on-demand threat queries

    Session data stored:
    - user: Authenticated user
    - session_id: Unique session identifier
    - position: Current user position {lat, lon}
    - previous_position: Previous position for trend calculation
    - heading: User's heading in degrees
    - threat_radius_nm: Threat detection radius in nautical miles
    """

    # Request types that require specific permissions
    REQUEST_PERMISSIONS = {
        "threats": "aircraft.view",
        "session-info": "aircraft.view",
        "sessions": "cannonball.view_sessions",
        "patterns": "cannonball.view_patterns",
        "alerts": "cannonball.view_alerts",
        "alert-acknowledge": "cannonball.manage_alerts",
        "alert-acknowledge-all": "cannonball.manage_alerts",
        "stats-summary": "cannonball.view_stats",
        "known-aircraft-check": "aircraft.view",
    }

    def __init__(self):
        super().__init__("/cannonball")
        self.supported_topics = ["threats", "all"]

    async def on_connect(self, sid, environ, auth=None):
        """
        Handle client connection.

        Authenticates the user, generates session ID, and sends session info.
        """
        # Authenticate the connection
        user, error = await authenticate_socket(auth)

        if error:
            from django.conf import settings as django_settings

            auth_mode = getattr(django_settings, "AUTH_MODE", "hybrid")
            reject_invalid = getattr(django_settings, "WS_REJECT_INVALID_TOKENS", False)
            if auth_mode == "private" or (auth_mode == "hybrid" and reject_invalid):
                logger.warning(f"Cannonball namespace auth rejected for {sid}: {error}")
                return False
            logger.warning(f"Cannonball namespace auth error for {sid}: {error}")

        # Check permission (cannonball uses 'aircraft' permission as base)
        # In a real system, you might have a specific 'cannonball' permission
        if not await check_topic_permission(user, "aircraft"):
            logger.warning(f"Cannonball namespace permission denied for {sid}")
            return False

        # Generate session ID
        session_id = str(uuid.uuid4())

        # Initialize session data
        await sio.save_session(
            sid,
            {
                "user": user,
                "auth_error": error,
                "session_id": session_id,
                "position": None,
                "previous_position": None,
                "heading": None,
                "threat_radius_nm": 25.0,
                "rate_limiter": RateLimiter(),
            },
            namespace="/cannonball",
        )

        # Join broadcast rooms so server-pushed threat/alert updates from
        # Celery tasks (tasks/cannonball.py) reach this client
        await self.enter_room(sid, "cannonball_threats")
        await self.enter_room(sid, "cannonball_alerts")

        logger.info(f"Client connected to /cannonball: {sid} (session: {session_id})")

        # Send session started event
        await self.emit(
            "session_started",
            {
                "session_id": session_id,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            room=sid,
        )

        return True

    async def on_disconnect(self, sid):
        """Handle client disconnection and clean up cached position and resources."""
        try:
            session = await sio.get_session(sid, namespace="/cannonball")
            session_id = session.get("session_id")

            if session_id:
                # Clean up cached position
                cache_key = f"{POSITION_CACHE_PREFIX}{session_id}"
                await sync_to_async(cache.delete)(cache_key)
                logger.debug(f"Cleaned up position cache for session {session_id}")

            # Clean up rate limiter if present (for future-proofing)
            rate_limiter = session.get("rate_limiter")
            if rate_limiter:
                rate_limiter.cleanup_old_entries()
                rate_limiter.reset()

            # Clear session data
            await sio.save_session(sid, {}, namespace="/cannonball")

        except Exception as e:  # broad: disconnect cleanup must never raise
            logger.debug(f"Error during disconnect cleanup: {e}")

        logger.info(f"Client disconnected from /cannonball: {sid}")

    async def on_position_update(self, sid, data):
        """
        Handle position update from mobile device.

        Expected data:
        {
            "lat": 34.05,
            "lon": -118.25,
            "heading": 180,  // optional
            "accuracy": 10   // optional, in meters
        }
        """
        if not isinstance(data, dict):
            await self.emit(
                "error",
                {
                    "message": "Invalid position update: expected dict payload",
                },
                room=sid,
            )
            return

        lat = data.get("lat")
        lon = data.get("lon")
        heading = data.get("heading")

        if lat is None or lon is None:
            await self.emit(
                "error",
                {
                    "message": "lat and lon are required",
                },
                room=sid,
            )
            return

        try:
            lat = float(lat)
            lon = float(lon)
        except (ValueError, TypeError):
            await self.emit(
                "error",
                {
                    "message": "Invalid coordinate values",
                },
                room=sid,
            )
            return

        # Validate coordinate bounds
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            await self.emit(
                "error",
                {
                    "message": "Coordinates out of bounds (lat: -90 to 90, lon: -180 to 180)",
                },
                room=sid,
            )
            return

        # Validate heading before touching the session - a bad value must not
        # leave the position half-updated with no threats recomputation
        if heading is not None:
            try:
                heading = float(heading) % 360
            except (ValueError, TypeError):
                heading = None

        # Get current session
        session = await sio.get_session(sid, namespace="/cannonball")

        # Rate limit: position updates trigger a full aircraft-cache LE scan
        rate_limiter = session.get("rate_limiter")
        if rate_limiter and not rate_limiter.can_send("aircraft:position"):
            return

        # Store previous position for trend calculation
        previous_position = session.get("position")

        # Update current position
        current_position = {"lat": lat, "lon": lon}
        session["previous_position"] = previous_position
        session["position"] = current_position

        if heading is not None:
            session["heading"] = heading

        # Save updated session
        await sio.save_session(sid, session, namespace="/cannonball")

        # Cache position
        session_id = session.get("session_id")
        if session_id:
            cache_key = f"{POSITION_CACHE_PREFIX}{session_id}"
            await sync_to_async(cache.set)(
                cache_key,
                {
                    "lat": lat,
                    "lon": lon,
                    "heading": heading,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                },
                POSITION_CACHE_TTL,
            )

        # Get and send threats
        threats = await self._get_threats(session)

        await self.emit(
            "threats",
            {
                "data": threats,
                "count": len(threats),
                "position": {"lat": lat, "lon": lon},
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            room=sid,
        )

    async def on_set_radius(self, sid, data):
        """
        Handle radius setting.

        Expected data:
        {"radius_nm": 25.0}
        """
        if not isinstance(data, dict):
            await self.emit(
                "error",
                {
                    "message": "Invalid radius request: expected dict payload",
                },
                room=sid,
            )
            return

        radius_nm = data.get("radius_nm", 25.0)

        try:
            radius_nm = float(radius_nm)
        except (ValueError, TypeError):
            await self.emit(
                "error",
                {
                    "message": "Invalid radius value",
                },
                room=sid,
            )
            return

        # Clamp radius to reasonable bounds
        radius_nm = max(1.0, min(100.0, radius_nm))

        # Update session
        session = await sio.get_session(sid, namespace="/cannonball")
        session["threat_radius_nm"] = radius_nm
        await sio.save_session(sid, session, namespace="/cannonball")

        await self.emit(
            "radius_updated",
            {
                "radius_nm": radius_nm,
            },
            room=sid,
        )

    async def on_get_threats(self, sid):
        """Handle request for current threats without position update."""
        session = await sio.get_session(sid, namespace="/cannonball")

        # Rate limit: threats recomputation scans the full aircraft cache
        rate_limiter = session.get("rate_limiter")
        if rate_limiter and not rate_limiter.can_send("request"):
            await self.emit("error", {"message": "Rate limit exceeded, please slow down"}, room=sid)
            return

        position = session.get("position")

        if not position:
            await self.emit(
                "error",
                {
                    "message": "No position set. Send position_update first.",
                },
                room=sid,
            )
            return

        threats = await self._get_threats(session)

        await self.emit(
            "threats",
            {
                "data": threats,
                "count": len(threats),
                "position": position,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
            room=sid,
        )

    async def on_request(self, sid, data):
        """
        Handle request/response pattern messages.

        Expected data:
        {
            "type": "threats" | "session-info",
            "request_id": "unique-id",
            "params": {...}
        }
        """
        if not isinstance(data, dict):
            await self.emit(
                "error",
                {
                    "request_id": None,
                    "message": "Invalid request: expected dict payload",
                },
                room=sid,
            )
            return

        request_type = data.get("type")
        request_id = data.get("request_id")
        params = data.get("params", {})

        # Validate params is actually a dict
        if not isinstance(params, dict):
            params = {}

        if not request_type:
            await self.emit(
                "error",
                {
                    "request_id": request_id,
                    "message": "Missing request type",
                },
                room=sid,
            )
            return

        # Check permission for this request type
        if not await self._check_request_permission(sid, request_type):
            await self.emit(
                "error",
                {
                    "request_id": request_id,
                    "message": "Permission denied",
                },
                room=sid,
            )
            return

        session = await sio.get_session(sid, namespace="/cannonball")

        try:
            if request_type == "threats":
                position = session.get("position")
                if position:
                    threats = await self._get_threats(session)
                else:
                    threats = []

                await self.emit(
                    "response",
                    {
                        "request_id": request_id,
                        "request_type": "threats",
                        "data": {
                            "threats": threats,
                            "count": len(threats),
                            "position": position,
                        },
                    },
                    room=sid,
                )

            elif request_type == "session-info":
                await self.emit(
                    "response",
                    {
                        "request_id": request_id,
                        "request_type": "session-info",
                        "data": {
                            "session_id": session.get("session_id"),
                            "position": session.get("position"),
                            "heading": session.get("heading"),
                            "radius_nm": session.get("threat_radius_nm", 25.0),
                        },
                    },
                    room=sid,
                )

            elif request_type == "sessions":
                result = await self._get_sessions(params)
                await self.emit(
                    "response",
                    {
                        "request_id": request_id,
                        "request_type": "sessions",
                        "data": result,
                    },
                    room=sid,
                )

            elif request_type == "patterns":
                result = await self._get_patterns(params)
                await self.emit(
                    "response",
                    {
                        "request_id": request_id,
                        "request_type": "patterns",
                        "data": result,
                    },
                    room=sid,
                )

            elif request_type == "alerts":
                result = await self._get_alerts(params)
                await self.emit(
                    "response",
                    {
                        "request_id": request_id,
                        "request_type": "alerts",
                        "data": result,
                    },
                    room=sid,
                )

            elif request_type == "alert-acknowledge":
                result = await self._acknowledge_alert(params)
                await self.emit(
                    "response",
                    {
                        "request_id": request_id,
                        "request_type": "alert-acknowledge",
                        "data": result,
                    },
                    room=sid,
                )

            elif request_type == "alert-acknowledge-all":
                result = await self._acknowledge_all_alerts(params)
                await self.emit(
                    "response",
                    {
                        "request_id": request_id,
                        "request_type": "alert-acknowledge-all",
                        "data": result,
                    },
                    room=sid,
                )

            elif request_type == "stats-summary":
                result = await self._get_stats_summary(params)
                await self.emit(
                    "response",
                    {
                        "request_id": request_id,
                        "request_type": "stats-summary",
                        "data": result,
                    },
                    room=sid,
                )

            elif request_type == "known-aircraft-check":
                result = await self._check_known_aircraft(params)
                await self.emit(
                    "response",
                    {
                        "request_id": request_id,
                        "request_type": "known-aircraft-check",
                        "data": result,
                    },
                    room=sid,
                )

            else:
                await self.emit(
                    "error",
                    {
                        "request_id": request_id,
                        "message": f"Unknown request type: {request_type}",
                    },
                    room=sid,
                )

        except ValueError as e:
            await self.emit(
                "error",
                {
                    "request_id": request_id,
                    "message": str(e),
                },
                room=sid,
            )
        except Exception as e:  # broad: request-dispatch catch-all must not crash the socket handler
            logger.exception(f"Error handling request {request_type} for {sid}: {e}")
            await self.emit(
                "error",
                {
                    "request_id": request_id,
                    "message": "Internal server error",
                },
                room=sid,
            )

    async def _check_request_permission(self, sid: str, request_type: str) -> bool:
        """Check if the user has permission for this request type."""
        from django.conf import settings as django_settings

        auth_mode = getattr(django_settings, "AUTH_MODE", "hybrid")

        # Public mode - all permissions granted
        if auth_mode == "public":
            return True

        # Get permission required for this request type
        permission = self.REQUEST_PERMISSIONS.get(request_type)
        if not permission:
            # Unknown request type - deny by default
            logger.warning(f"Denying unlisted cannonball request type: {request_type}")
            return False

        session = await sio.get_session(sid, namespace="/cannonball")
        user = session.get("user")

        # Use the permission checking infrastructure
        from skyspy.socketio.middleware.permissions import _check_permission

        return await _check_permission(user, permission)

    @sync_to_async
    def _get_threats(self, session: dict) -> list[dict[str, Any]]:
        """
        Get nearby threats based on user position (cache-only, no DB).

        Args:
            session: Session dictionary containing position, heading, radius

        Returns:
            List of threat dictionaries sorted by distance
        """
        position = session.get("position")
        if not position:
            return []

        user_lat = position["lat"]
        user_lon = position["lon"]
        user_heading = session.get("heading")
        previous_position = session.get("previous_position")
        threat_radius_nm = session.get("threat_radius_nm", 25.0)

        # Get current aircraft from cache
        aircraft_list = cache.get("current_aircraft", [])
        threats = []

        for aircraft in aircraft_list:
            ac_lat = aircraft.get("lat")
            ac_lon = aircraft.get("lon")

            if ac_lat is None or ac_lon is None:
                continue

            # Calculate distance
            distance_nm = haversine_distance(user_lat, user_lon, ac_lat, ac_lon)

            # Skip if outside radius
            if distance_nm > threat_radius_nm:
                continue

            # Identify law enforcement / helicopter
            le_info = identify_law_enforcement(
                hex_code=aircraft.get("hex"),
                callsign=aircraft.get("flight") or aircraft.get("callsign"),
                operator=aircraft.get("ownOp") or aircraft.get("operator"),
                category=aircraft.get("category"),
                type_code=aircraft.get("t") or aircraft.get("type"),
            )

            # Only include if it's a threat (law enforcement, helicopter, or surveillance type)
            if not le_info["is_interest"]:
                continue

            # Calculate bearing
            bearing = calculate_bearing(user_lat, user_lon, ac_lat, ac_lon)

            # Calculate relative bearing if user heading is known
            relative_bearing = None
            if user_heading is not None:
                relative_bearing = (bearing - user_heading + 360) % 360

            # Calculate trend (approaching/departing)
            trend = self._calculate_trend(distance_nm, ac_lat, ac_lon, previous_position)

            # Get threat level
            threat_level = get_threat_level(aircraft, distance_nm, le_info)

            # Build threat object
            threat = {
                "hex": aircraft.get("hex"),
                "callsign": (aircraft.get("flight") or "").strip() or None,
                "category": le_info.get("category") or ("Helicopter" if le_info["is_helicopter"] else "Aircraft"),
                "description": le_info.get("description"),
                "distance_nm": round(distance_nm, 2),
                "bearing": round(bearing, 1),
                "relative_bearing": round(relative_bearing, 1) if relative_bearing is not None else None,
                "direction": get_direction_name(bearing),
                "altitude": aircraft.get("alt_baro") or aircraft.get("alt_geom") or aircraft.get("alt"),
                "ground_speed": aircraft.get("gs"),
                "vertical_rate": aircraft.get("baro_rate") or aircraft.get("geom_rate"),
                "trend": trend,
                "threat_level": threat_level,
                "is_law_enforcement": le_info["is_law_enforcement"],
                "is_helicopter": le_info["is_helicopter"],
                "confidence": le_info.get("confidence", "unknown"),
                "aircraft_type": aircraft.get("t") or aircraft.get("type"),
                "registration": aircraft.get("r"),
                "lat": ac_lat,
                "lon": ac_lon,
            }

            threats.append(threat)

        # Sort by distance (closest first), then by threat level
        threat_order = {"critical": 0, "warning": 1, "info": 2}
        threats.sort(key=lambda x: (threat_order.get(x["threat_level"], 3), x["distance_nm"]))

        return threats

    def _calculate_trend(
        self,
        current_distance: float,
        ac_lat: float,
        ac_lon: float,
        previous_position: dict[str, float] | None,
    ) -> str:
        """Calculate if aircraft is approaching or departing."""
        if not previous_position:
            return "unknown"

        prev_distance = haversine_distance(previous_position["lat"], previous_position["lon"], ac_lat, ac_lon)

        diff = current_distance - prev_distance
        if diff < -0.05:  # Getting closer by more than 0.05nm
            return "approaching"
        elif diff > 0.05:  # Getting farther by more than 0.05nm
            return "departing"
        else:
            return "holding"

    # =========================================================================
    # Request Handler Methods
    # =========================================================================

    @sync_to_async
    def _get_sessions(self, params: dict) -> dict[str, Any]:
        """Get cannonball sessions."""
        from datetime import timedelta

        from django.utils import timezone

        from skyspy.models import CannonballSession

        active_only = params.get("active_only", True)
        hours = params.get("hours", 24)
        limit = params.get("limit", 50)

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = CannonballSession.objects.filter(created_at__gte=cutoff)

        if active_only:
            queryset = queryset.filter(is_active=True)

        sessions = queryset.order_by("-created_at")[:limit]

        return {
            "sessions": [
                {
                    "id": str(s.id),
                    "session_id": str(s.session_id),
                    "is_active": s.is_active,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                    "last_position_at": s.last_position_at.isoformat() if s.last_position_at else None,
                    "threat_count": s.threat_count,
                    "alert_count": s.alert_count,
                }
                for s in sessions
            ],
            "count": len(sessions),
        }

    @sync_to_async
    def _get_patterns(self, params: dict) -> dict[str, Any]:
        """Get threat detection patterns."""
        from datetime import timedelta

        from django.utils import timezone

        from skyspy.models import CannonballPattern

        hours = params.get("hours", 24)
        limit = params.get("limit", 100)

        cutoff = timezone.now() - timedelta(hours=hours)
        patterns = CannonballPattern.objects.filter(detected_at__gte=cutoff).order_by("-detected_at")[:limit]

        return {
            "patterns": [
                {
                    "id": str(p.id),
                    "pattern_type": p.pattern_type,
                    "icao_hex": p.icao_hex,
                    "description": p.description,
                    "confidence": p.confidence,
                    "detected_at": p.detected_at.isoformat() if p.detected_at else None,
                    "metadata": p.metadata or {},
                }
                for p in patterns
            ],
            "count": len(patterns),
        }

    @sync_to_async
    def _get_alerts(self, params: dict) -> dict[str, Any]:
        """Get cannonball alerts."""
        from datetime import timedelta

        from django.utils import timezone

        from skyspy.models import CannonballAlert

        hours = params.get("hours", 24)
        unacknowledged = params.get("unacknowledged", False)
        limit = params.get("limit", 100)

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = CannonballAlert.objects.filter(created_at__gte=cutoff)

        if unacknowledged:
            queryset = queryset.filter(acknowledged=False)

        alerts = queryset.order_by("-created_at")[:limit]

        return {
            "alerts": [
                {
                    "id": str(a.id),
                    "alert_type": a.alert_type,
                    "icao_hex": a.icao_hex,
                    "description": a.description,
                    "severity": a.severity,
                    "acknowledged": a.acknowledged,
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                    "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
                }
                for a in alerts
            ],
            "count": len(alerts),
        }

    @sync_to_async
    def _acknowledge_alert(self, params: dict) -> dict[str, Any]:
        """Acknowledge a single alert."""
        from django.utils import timezone

        from skyspy.models import CannonballAlert

        alert_id = params.get("id")
        if not alert_id:
            raise ValueError("Missing alert id")

        try:
            alert = CannonballAlert.objects.get(id=alert_id)
            alert.acknowledged = True
            alert.acknowledged_at = timezone.now()
            alert.save(update_fields=["acknowledged", "acknowledged_at"])
            return {
                "success": True,
                "id": str(alert.id),
                "acknowledged": True,
            }
        except CannonballAlert.DoesNotExist:
            raise ValueError("Alert not found")

    @sync_to_async
    def _acknowledge_all_alerts(self, params: dict) -> dict[str, Any]:
        """Acknowledge all unacknowledged alerts."""
        from django.utils import timezone

        from skyspy.models import CannonballAlert

        updated = CannonballAlert.objects.filter(acknowledged=False).update(
            acknowledged=True, acknowledged_at=timezone.now()
        )

        return {
            "success": True,
            "acknowledged_count": updated,
        }

    @sync_to_async
    def _get_stats_summary(self, params: dict) -> dict[str, Any]:
        """Get cannonball statistics summary."""
        from datetime import timedelta

        from django.utils import timezone

        from skyspy.models import CannonballAlert, CannonballPattern, CannonballSession

        hours = params.get("hours", 24)
        cutoff = timezone.now() - timedelta(hours=hours)

        # Session stats
        session_count = CannonballSession.objects.filter(created_at__gte=cutoff).count()
        active_sessions = CannonballSession.objects.filter(is_active=True).count()

        # Alert stats
        alert_count = CannonballAlert.objects.filter(created_at__gte=cutoff).count()
        unacknowledged_alerts = CannonballAlert.objects.filter(created_at__gte=cutoff, acknowledged=False).count()

        # Pattern stats
        pattern_count = CannonballPattern.objects.filter(detected_at__gte=cutoff).count()

        return {
            "hours": hours,
            "sessions": {
                "total": session_count,
                "active": active_sessions,
            },
            "alerts": {
                "total": alert_count,
                "unacknowledged": unacknowledged_alerts,
            },
            "patterns": {
                "total": pattern_count,
            },
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    @sync_to_async
    def _check_known_aircraft(self, params: dict) -> dict[str, Any]:
        """Check if an aircraft ICAO is in the known LE database."""
        icao_hex = params.get("icao_hex") or params.get("icao")
        if not icao_hex:
            raise ValueError("Missing icao_hex parameter")

        le_info = identify_law_enforcement(
            hex_code=icao_hex.upper(),
            callsign=params.get("callsign"),
            operator=params.get("operator"),
            category=params.get("category"),
            type_code=params.get("type_code"),
        )

        return {
            "icao_hex": icao_hex.upper(),
            "is_known": le_info["is_law_enforcement"] or le_info["is_interest"],
            "is_law_enforcement": le_info["is_law_enforcement"],
            "is_helicopter": le_info["is_helicopter"],
            "category": le_info.get("category"),
            "description": le_info.get("description"),
            "confidence": le_info.get("confidence", "unknown"),
        }


# Create and register the namespace
cannonball_namespace = CannonballNamespace()


def register_cannonball_namespace():
    """Register the cannonball namespace with the Socket.IO server."""
    sio.register_namespace(cannonball_namespace)
    logger.info("Registered CannonballNamespace at /cannonball")


# Broadcast helper function for use by other parts of the application


async def broadcast_threat_update():
    """
    Broadcast threat update to all connected cannonball clients.

    This triggers each client to refresh their threat list based on
    their current position.
    """
    # Get all connected sessions in this namespace
    # Note: This is a simplified broadcast - in production you might
    # want to iterate through sessions and send personalized updates
    await sio.emit(
        "threat_refresh",
        {
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
        namespace="/cannonball",
    )
