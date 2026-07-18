"""
Main Socket.IO namespace for SkySpy.

Handles all main data streams including aircraft, safety, stats, alerts, etc.
This is the default namespace ('/') that clients connect to.

Handler methods are organised into mixin classes under ``mixins/``:
- AircraftHandlerMixin  — aircraft lookup, listing, stats, sightings, photos
- SafetyHandlerMixin    — safety events, acknowledgment, monitoring status
- AlertHandlerMixin     — alert rule CRUD and alert history snapshot
- AviationDataMixin     — airports, navaids, airspace, PIREPs, METARs, TAFs, NOTAMs
- StatsHandlerMixin     — history, analytics, antenna, ACARS, extended stats
- NotificationHandlerMixin — notification channel CRUD and test
- SystemHandlerMixin    — system status, health, database stats, permissions
"""

import asyncio
import json
import logging

import socketio
from asgiref.sync import sync_to_async
from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

from skyspy.socketio.middleware.auth import authenticate_socket
from skyspy.socketio.middleware.permissions import (
    check_topic_permission,
)
from skyspy.socketio.namespaces.mixins.aircraft import AircraftHandlerMixin
from skyspy.socketio.namespaces.mixins.alerts import AlertHandlerMixin
from skyspy.socketio.namespaces.mixins.aviation_data import AviationDataMixin
from skyspy.socketio.namespaces.mixins.notifications import NotificationHandlerMixin
from skyspy.socketio.namespaces.mixins.safety import SafetyHandlerMixin
from skyspy.socketio.namespaces.mixins.stats import StatsHandlerMixin
from skyspy.socketio.namespaces.mixins.system import SystemHandlerMixin
from skyspy.socketio.server import sio
from skyspy.socketio.utils.rate_limiter import DEFAULT_RATE_LIMITS, RateLimiter
from skyspy.socketio.utils.snapshot_cache import snapshot_cache

logger = logging.getLogger(__name__)


@sync_to_async
def _recycle_db_connections():
    """Recycle stale DB connections before ORM access in a socket handler.

    Socket.IO handlers run outside Django's request/response cycle, so the
    ``close_old_connections()`` that Django normally fires per request never
    runs here. The shared thread-sensitive executor keeps one persistent
    connection, and the DB server (or PgBouncer) reaps it while idle — the
    next query then raises ``OperationalError: the connection is closed``.
    This runs in the same thread-sensitive executor as the handlers, so it
    recycles the very connection they are about to use. Requires
    ``CONN_HEALTH_CHECKS`` to detect connections closed before CONN_MAX_AGE.
    """
    close_old_connections()


class MainNamespace(
    AircraftHandlerMixin,
    SafetyHandlerMixin,
    AlertHandlerMixin,
    AviationDataMixin,
    StatsHandlerMixin,
    NotificationHandlerMixin,
    SystemHandlerMixin,
    socketio.AsyncNamespace,
):
    """
    Main Socket.IO namespace for SkySpy.

    Handles:
    - Connection/disconnection with authentication
    - Topic subscriptions (aircraft, safety, stats, alerts, acars, airspace, notams)
    - Request/response pattern for data queries
    - Room-based message broadcasting from Celery tasks

    Supported Topics:
    - aircraft: Real-time aircraft position updates
    - safety: Safety alerts and events
    - stats: Statistics updates
    - alerts: Custom alert notifications
    - acars: ACARS message updates
    - airspace: Airspace boundary updates
    - notams: NOTAM updates

    All data from Celery broadcasts is automatically routed to subscribers
    via Socket.IO rooms (topic_aircraft, topic_safety, etc.).
    """

    # Supported subscription topics
    SUPPORTED_TOPICS = ["aircraft", "safety", "stats", "alerts", "acars", "airspace", "notams"]

    # Request types mapped to the permission they require.
    # SECURITY: this map is authoritative — request types not listed here are
    # denied by _check_request_permission (default-deny) unless AUTH_MODE is
    # "public". Every type dispatched via _handle_generic_request (or reachable
    # through the ``_handle_{type}`` getattr path) must be listed.
    REQUEST_PERMISSIONS = {
        # Aircraft
        "aircraft": "aircraft.view",
        "aircraft_list": "aircraft.view",
        "aircraft-list": "aircraft.view",
        "aircraft-snapshot": "aircraft.view",
        "aircraft-info": "aircraft.view",
        "aircraft-info-bulk": "aircraft.view",
        "aircraft-stats": "aircraft.view",
        "aircraft-top": "aircraft.view",
        "sightings": "aircraft.view",
        "photo": "aircraft.view",
        "photo-cache": "aircraft.view",
        # History & analytics
        "history-stats": "history.view",
        "history-trends": "history.view",
        "history-top": "history.view",
        "history-sessions": "history.view",
        "history-analytics-distance": "history.view",
        "history-analytics-speed": "history.view",
        "history-analytics-correlation": "history.view",
        "antenna-polar": "stats.view",
        "antenna-rssi": "stats.view",
        "antenna-summary": "stats.view",
        "antenna-analytics": "stats.view",
        # Safety
        "safety-events": "safety.view",
        "safety-stats": "safety.view",
        "safety-status": "safety.view",
        "safety-event-detail": "safety.view",
        "safety-snapshot": "safety.view",
        "safety-acknowledge": "safety.manage",
        # Alerts
        "alert-rules": "alerts.view",
        "alert-snapshot": "alerts.view",
        "alert-rule-create": "alerts.manage",
        "alert-rule-update": "alerts.manage",
        "alert-rule-delete": "alerts.manage",
        "alert-rule-toggle": "alerts.manage",
        # ACARS
        "acars-stats": "acars.view",
        "acars-snapshot": "acars.view",
        # Aviation data
        "airports": "airspace.view",
        "navaids": "airspace.view",
        "airspaces": "airspace.view",
        "airspace-boundaries": "airspace.view",
        "boundaries": "airspace.view",
        "pireps": "airspace.view",
        "metars": "airspace.view",
        "tafs": "airspace.view",
        "metar": "airspace.view",
        "taf": "airspace.view",
        # NOTAMs
        "notam-snapshot": "notams.view",
        "airport": "notams.view",
        "refresh": "notams.view",
        # Notifications
        "notification-channels": "notifications.view",
        "notification-channel-types": "notifications.view",
        "notification-channel-create": "notifications.manage",
        "notification-channel-update": "notifications.manage",
        "notification-channel-delete": "notifications.manage",
        "notification-channel-test": "notifications.manage",
        # System
        "status": "system.view_status",
        "health": "system.view_status",
        "system-health": "system.view_status",
        "system-status": "system.view_status",
        "ws-status": "system.view_status",
        "system-info": "system.view_info",
        "system-databases": "system.view_databases",
        # Extended stats
        "stats-flight-patterns": "stats.view",
        "stats-geographic": "stats.view",
        "stats-tracking-quality": "stats.view",
        "stats-engagement": "stats.view",
        "stats-favorites": "stats.view",
        "stats-time-comparison": "stats.view",
    }

    def __init__(self, namespace: str = "/"):
        super().__init__(namespace)
        # Per-session state is stored via sio.save_session/get_session.
        # Event handlers run as concurrent tasks (async_handlers=True), so
        # get_session -> save_session read-modify-write sequences must be
        # serialized per sid or overlapping subscribes/unsubscribes lose updates.
        self._session_locks: dict[str, asyncio.Lock] = {}

    def _session_lock(self, sid: str) -> asyncio.Lock:
        """Get (or create) the per-sid lock guarding subscription session state."""
        return self._session_locks.setdefault(sid, asyncio.Lock())

    # =========================================================================
    # Socket.IO Event Handlers
    # =========================================================================

    async def on_connect(self, sid: str, environ: dict, auth: dict | None = None):
        """
        Handle client connection.

        Authenticates the connection, stores user in session, joins default rooms,
        and sends initial snapshot.
        """
        logger.info(f"Socket.IO connection attempt: {sid}")

        try:
            # Authenticate
            user, error = await authenticate_socket(auth)

            if error:
                auth_mode = getattr(settings, "AUTH_MODE", "hybrid")
                reject_invalid = getattr(settings, "WS_REJECT_INVALID_TOKENS", False)
                if auth_mode == "private" or (auth_mode == "hybrid" and reject_invalid):
                    logger.warning(f"Socket.IO connection rejected for {sid}: {error}")
                    return False

            # Store user in session
            # Note: subscribed_topics uses a list instead of set for JSON serialization compatibility
            await sio.save_session(
                sid,
                {
                    "user": user,
                    "subscribed_topics": [],
                    "client_filters": {},
                    "rate_limiter": RateLimiter({**DEFAULT_RATE_LIMITS, **getattr(settings, "WS_RATE_LIMITS", {})}),
                    "connected_at": timezone.now().isoformat(),
                },
            )

            logger.info(f"Socket.IO connected: {sid}, user={user.username if user.is_authenticated else 'anonymous'}")

            # Join default rooms based on permissions
            await self._join_default_rooms(sid, user)

            # Send initial aircraft snapshot
            await self._send_initial_state(sid)

            return True
        except asyncio.CancelledError:
            # Client disconnected during connection setup
            logger.debug(f"Connection setup cancelled for {sid} (client disconnected)")
            return False

    async def on_disconnect(self, sid: str):
        """Handle client disconnection."""
        self._session_locks.pop(sid, None)
        try:
            session = await sio.get_session(sid)
            # Convert to set since JSON serialization returns lists
            subscribed = set(session.get("subscribed_topics", []))

            # Leave all subscribed rooms
            for topic in subscribed:
                room = f"topic_{topic}"
                await sio.leave_room(sid, room)

            # Clean up rate limiter to prevent memory leaks
            rate_limiter = session.get("rate_limiter")
            if rate_limiter:
                rate_limiter.cleanup_old_entries()
                rate_limiter.reset()

            # Clear session data explicitly
            await sio.save_session(sid, {})

            logger.info(f"Socket.IO disconnected: {sid}")
        except asyncio.CancelledError:
            logger.debug(f"Disconnect cleanup cancelled for {sid}")
        except Exception as e:  # broad: disconnect cleanup boundary must never raise, whatever the session state
            logger.warning(f"Error during disconnect cleanup for {sid}: {e}")

    async def on_subscribe(self, sid: str, data: dict | None):
        """
        Handle topic subscription request.

        Joins rooms for requested topics after checking permissions.
        """
        # Handle case where data is None or not a dict
        if not isinstance(data, dict):
            logger.warning(f"Invalid subscribe data from {sid}: expected dict, got {type(data).__name__}")
            await sio.emit(
                "error",
                {"message": "Invalid subscription request: expected dict with 'topics' key"},
                to=sid,
                namespace=self.namespace,
            )
            return

        try:
            topics = data.get("topics", [])
            if isinstance(topics, str):
                topics = [topics]

            # Handle 'all' topic - expand to all supported topics
            logger.info(f"[on_subscribe] {sid} requested topics: {topics}")
            if "all" in topics:
                topics = list(self.SUPPORTED_TOPICS)
                logger.info(f"[on_subscribe] Expanded 'all' to: {topics}")

            async with self._session_lock(sid):
                session = await sio.get_session(sid)
                user = session.get("user")
                # Use list instead of set for JSON serialization compatibility
                subscribed = list(session.get("subscribed_topics", []))

                joined = []
                denied = []

                for topic in topics:
                    # Validate topic
                    if topic not in self.SUPPORTED_TOPICS:
                        logger.warning(f"Unknown topic requested by {sid}: {topic}")
                        continue

                    # Check permission
                    if not await check_topic_permission(user, topic):
                        logger.warning(f"Permission denied for {sid} to subscribe to {topic}")
                        denied.append(topic)
                        continue

                    # Join room
                    room = f"topic_{topic}"
                    await sio.enter_room(sid, room)
                    if topic not in subscribed:
                        subscribed.append(topic)
                    joined.append(topic)
                    logger.info(f"{sid} is entering room {room} [{self.namespace}]")

                # Update session (using list for JSON serialization)
                session["subscribed_topics"] = subscribed
                await sio.save_session(sid, session)

            # Send response
            await sio.emit(
                "subscribed",
                {
                    "topics": list(subscribed),
                    "joined": joined,
                    "denied": denied if denied else None,
                },
                to=sid,
                namespace=self.namespace,
            )

            # Send initial snapshots for newly joined topics
            await self._send_topic_snapshots(sid, joined)
        except asyncio.CancelledError:
            logger.debug(f"Subscription cancelled for {sid} (client disconnected)")

    async def on_unsubscribe(self, sid: str, data: dict):
        """Handle topic unsubscription request."""
        if not isinstance(data, dict):
            logger.warning(f"Invalid unsubscribe data from {sid}: expected dict, got {type(data).__name__}")
            await sio.emit(
                "error",
                {"message": "Invalid unsubscription request: expected dict with 'topics' key"},
                to=sid,
                namespace=self.namespace,
            )
            return

        topics = data.get("topics", [])
        if isinstance(topics, str):
            topics = [topics]

        async with self._session_lock(sid):
            session = await sio.get_session(sid)
            subscribed = set(session.get("subscribed_topics", []))

            left = []

            for topic in topics:
                if topic in subscribed:
                    room = f"topic_{topic}"
                    await sio.leave_room(sid, room)
                    subscribed.discard(topic)
                    left.append(topic)
                    logger.debug(f"{sid} unsubscribed from {topic}")

            session["subscribed_topics"] = list(subscribed)
            await sio.save_session(sid, session)

        await sio.emit(
            "unsubscribed",
            {
                "topics": left,
                "remaining": list(subscribed),
            },
            to=sid,
            namespace=self.namespace,
        )

    async def on_request(self, sid: str, data: dict):
        """
        Handle request/response pattern.

        Routes to ``_handle_{type}`` methods on the class (including mixins).
        """
        if not isinstance(data, dict):
            logger.warning(f"Invalid request data from {sid}: expected dict, got {type(data).__name__}")
            await self._emit_error(sid, None, "Invalid request: expected dict payload")
            return

        request_type = data.get("type")
        request_id = data.get("request_id")
        params = data.get("params", {})

        if not isinstance(params, dict):
            params = {}

        if not request_type or not isinstance(request_type, str):
            await self._emit_error(sid, request_id, "Missing request type")
            return

        try:
            # Pre-dispatch (session fetch, rate limit, permission) must run
            # inside the guard too - an escape here would leave the client
            # hanging with no response until its timeout.
            session = await sio.get_session(sid)
            rate_limiter = session.get("rate_limiter")
            if rate_limiter and not rate_limiter.can_send("request"):
                await self._emit_error(sid, request_id, "Rate limit exceeded, please slow down")
                return

            if not await self._check_request_permission(sid, request_type):
                await self._emit_error(sid, request_id, "Permission denied")
                return

            # Inject the authenticated session user so handlers can owner-scope
            # their queries/mutations. Set server-side AFTER reading client params
            # so a client cannot spoof "_user" to impersonate another account.
            params["_user"] = session.get("user")

            # Drop any DB connection reaped while the socket was idle, so the
            # handler's ORM query does not hit "the connection is closed".
            await _recycle_db_connections()

            handler = getattr(self, f"_handle_{request_type.replace('-', '_')}", None)
            if handler:
                result = await handler(params)
                await self._emit_response(sid, request_id, request_type, result)
            else:
                result = await self._handle_generic_request(request_type, params)
                if result is not None:
                    await self._emit_response(sid, request_id, request_type, result)
                else:
                    await self._emit_error(sid, request_id, f"Unknown request type: {request_type}")
        except asyncio.CancelledError:
            logger.debug(f"Request {request_type} cancelled for {sid} (client disconnected)")
        except (
            Exception
        ) as e:  # broad: top-level dispatch guard over all mixin handlers; must degrade to error response
            logger.exception(f"Error handling request {request_type} for {sid}: {e}")
            await self._emit_error(sid, request_id, "Internal server error")

    async def on_ping(self, sid: str, data: dict | None = None):
        """Handle ping request for connection keepalive."""
        await sio.emit("pong", {"timestamp": timezone.now().isoformat()}, to=sid, namespace=self.namespace)

    # =========================================================================
    # Connection Helpers
    # =========================================================================

    async def _join_default_rooms(self, sid: str, user):
        """Join default rooms based on user permissions."""
        async with self._session_lock(sid):
            session = await sio.get_session(sid)
            subscribed = set(session.get("subscribed_topics", []))

            if await check_topic_permission(user, "aircraft"):
                await sio.enter_room(sid, "topic_aircraft")
                subscribed.add("aircraft")

            if await check_topic_permission(user, "stats"):
                await sio.enter_room(sid, "topic_stats")
                subscribed.add("stats")

            session["subscribed_topics"] = list(subscribed)
            await sio.save_session(sid, session)

    async def _send_initial_state(self, sid: str):
        """Send initial snapshots on connect for all subscribed data types."""
        logger.info(f"[_send_initial_state] Starting for {sid}")

        session = await sio.get_session(sid)
        user = session.get("user")
        subscribed = set(session.get("subscribed_topics", []))

        # Send aircraft snapshot (default subscription) only if permitted,
        # mirroring the permission check in _join_default_rooms
        if await check_topic_permission(user, "aircraft"):
            try:
                await self._emit_cached_snapshot(sid, "aircraft")
            except Exception as e:  # broad: snapshot boundary must not abort connect; emit spans many mixins/cache
                logger.error(f"Failed to send aircraft snapshot to {sid}: {e}", exc_info=True)

        for topic in ("safety", "alerts", "acars", "notams"):
            if topic in subscribed or "all" in subscribed:
                try:
                    await self._emit_cached_snapshot(sid, topic)
                except (
                    Exception
                ) as e:  # broad: per-topic snapshot boundary must not abort connect; emit spans mixins/cache
                    logger.error(f"Failed to send {topic} snapshot to {sid}: {e}", exc_info=True)

    async def _send_topic_snapshots(self, sid: str, topics: list):
        """Send initial snapshots for the given topics using cached data when available."""
        for topic in topics:
            try:
                await self._emit_cached_snapshot(sid, topic)
            except (
                Exception
            ) as e:  # broad: per-topic snapshot boundary must not abort subscribe; emit spans mixins/cache
                logger.error(f"Failed to send {topic} snapshot to {sid}: {e}", exc_info=True)

    # Topics whose snapshot event name differs from "{topic}:snapshot"
    # (the frontend listens for the singular event names)
    SNAPSHOT_EVENT_NAMES = {
        "alerts": "alert:snapshot",
        "notams": "notam:snapshot",
    }

    # Subscribable topics that have no initial snapshot to send
    TOPICS_WITHOUT_SNAPSHOTS = ("stats", "airspace")

    async def _emit_cached_snapshot(self, sid: str, topic: str):
        """Emit a snapshot for a topic, using cached data when available."""
        if topic in self.TOPICS_WITHOUT_SNAPSHOTS:
            return

        event_name = self.SNAPSHOT_EVENT_NAMES.get(topic, f"{topic}:snapshot")

        cached_json = snapshot_cache.get_snapshot(topic)

        if cached_json:
            try:
                data = json.loads(cached_json)
                await sio.emit(event_name, data, to=sid, namespace=self.namespace)
                logger.debug(f"[_emit_cached_snapshot] Emitted cached {event_name} to {sid}")
                return
            except json.JSONDecodeError:
                logger.warning(f"Invalid cached JSON for topic {topic}, regenerating")
                snapshot_cache.invalidate(topic)

        data = await self._generate_topic_snapshot(topic)
        if data is not None:
            snapshot_cache.set_snapshot(topic, data)
            await sio.emit(event_name, data, to=sid, namespace=self.namespace)
            logger.debug(f"[_emit_cached_snapshot] Emitted fresh {event_name} to {sid}")

    async def _generate_topic_snapshot(self, topic: str) -> dict | None:
        """Generate a fresh snapshot for a topic."""
        timestamp = timezone.now().isoformat()

        # Connect/subscribe snapshots also run outside the request cycle; recycle
        # a possibly-dead connection before the ORM query behind each snapshot.
        await _recycle_db_connections()

        if topic == "notams":
            return await self._get_notam_snapshot({"active_only": True, "limit": 100})
        elif topic == "safety":
            safety_events = await self._get_safety_events({"hours": 24, "limit": 50})
            return {"events": safety_events, "count": len(safety_events), "timestamp": timestamp}
        elif topic == "alerts":
            alert_data = await self._get_alert_snapshot({"hours": 24, "limit": 50})
            return {
                "alerts": alert_data.get("alerts", []),
                "count": alert_data.get("count", 0),
                "timestamp": timestamp,
            }
        elif topic == "acars":
            acars_data = await self._get_acars_snapshot({"hours": 1, "limit": 50})
            return {
                "messages": acars_data.get("messages", []),
                "count": acars_data.get("count", 0),
                "timestamp": timestamp,
            }
        elif topic == "aircraft":
            aircraft_list = await self._get_current_aircraft()
            return {"aircraft": aircraft_list, "count": len(aircraft_list), "timestamp": timestamp}
        elif topic in self.TOPICS_WITHOUT_SNAPSHOTS:
            # Subscribable topics without an initial snapshot — nothing to send
            return None

        logger.warning(f"Unknown topic for snapshot generation: {topic}")
        return None

    # =========================================================================
    # Permission Helpers
    # =========================================================================

    async def _check_request_permission(self, sid: str, request_type: str) -> bool:
        """Check if the session user has permission for this request type."""
        auth_mode = getattr(settings, "AUTH_MODE", "hybrid")
        if auth_mode == "public":
            return True

        required_perm = self.REQUEST_PERMISSIONS.get(request_type)

        if not required_perm:
            # Default-deny: request types must be explicitly listed in
            # REQUEST_PERMISSIONS to be dispatched outside public mode.
            logger.warning(f"Denying unlisted request type: {request_type}")
            return False

        session = await sio.get_session(sid)
        user = session.get("user")

        if not user or not user.is_authenticated:
            return await self._is_feature_public(required_perm)

        if user.is_superuser:
            return True

        return await self._check_user_permission(user, required_perm)

    # =========================================================================
    # Response Helpers
    # =========================================================================

    async def _emit_response(self, sid: str, request_id: str, request_type: str, data):
        """Emit a response to a request."""
        await sio.emit(
            "response",
            {"type": "response", "request_id": request_id, "request_type": request_type, "data": data},
            to=sid,
            namespace=self.namespace,
        )

    async def _emit_error(self, sid: str, request_id: str | None, message: str):
        """Emit an error response."""
        await sio.emit(
            "error", {"type": "error", "request_id": request_id, "message": message}, to=sid, namespace=self.namespace
        )

    # =========================================================================
    # Request Routing
    # =========================================================================

    async def _handle_generic_request(self, request_type: str, params: dict):
        """Route request types to handler methods across all mixins."""
        handlers = {
            # Aircraft
            "aircraft": self._handle_aircraft,
            "aircraft_list": self._handle_aircraft_list,
            "aircraft-snapshot": self._handle_aircraft_snapshot,
            "aircraft-info": self._handle_aircraft_info,
            "aircraft-info-bulk": self._handle_aircraft_info_bulk,
            "aircraft-stats": self._handle_aircraft_stats,
            "aircraft-top": self._handle_aircraft_top,
            "sightings": self._handle_sightings,
            "photo": self._handle_photo,
            "photo-cache": self._handle_photo,
            # History & analytics
            "history-stats": self._handle_history_stats,
            "history-trends": self._handle_history_trends,
            "history-top": self._handle_history_top,
            "history-sessions": self._handle_history_sessions,
            "history-analytics-distance": self._handle_distance_analytics,
            "history-analytics-speed": self._handle_speed_analytics,
            "history-analytics-correlation": self._handle_correlation_analytics,
            "antenna-polar": self._handle_antenna_polar,
            "antenna-rssi": self._handle_antenna_rssi,
            "antenna-summary": self._handle_antenna_summary,
            "antenna-analytics": self._handle_antenna_analytics,
            # Safety
            "safety-stats": self._handle_safety_stats,
            "safety-events": self._handle_safety_events,
            "safety-status": self._handle_safety_monitor_status,
            "safety-event-detail": self._handle_safety_event_detail,
            "safety-acknowledge": self._handle_safety_acknowledge,
            "safety-snapshot": self._handle_safety_snapshot,
            # Alerts
            "alert-rules": self._handle_alert_rules,
            "alert-rule-create": self._handle_alert_rule_create,
            "alert-rule-update": self._handle_alert_rule_update,
            "alert-rule-delete": self._handle_alert_rule_delete,
            "alert-rule-toggle": self._handle_alert_rule_toggle,
            "alert-snapshot": self._handle_alert_snapshot,
            # ACARS
            "acars-stats": self._handle_acars_stats,
            "acars-snapshot": self._handle_acars_snapshot,
            # Aviation data
            "airports": self._handle_airports,
            "navaids": self._handle_navaids,
            "airspaces": self._handle_airspace_advisories,
            "airspace-boundaries": self._handle_airspace_boundaries,
            "boundaries": self._handle_airspace_boundaries,
            "pireps": self._handle_pireps,
            "metars": self._handle_metars,
            "tafs": self._handle_tafs,
            "metar": self._handle_metar_single,
            "taf": self._handle_taf_single,
            # NOTAMs
            "notam-snapshot": self._handle_notam_snapshot,
            "airport": self._handle_airport_notams,
            "refresh": self._handle_notam_refresh,
            # Notifications
            "notification-channels": self._handle_notification_channels,
            "notification-channel-types": self._handle_notification_channel_types,
            "notification-channel-create": self._handle_notification_channel_create,
            "notification-channel-update": self._handle_notification_channel_update,
            "notification-channel-delete": self._handle_notification_channel_delete,
            "notification-channel-test": self._handle_notification_channel_test,
            # System
            "status": self._handle_status,
            "health": self._handle_health,
            "system-health": self._handle_health,
            "system-info": self._handle_system_info,
            "system-status": self._handle_system_status,
            "system-databases": self._handle_database_stats,
            "ws-status": self._handle_ws_status,
            # Extended stats
            "stats-flight-patterns": self._handle_flight_patterns,
            "stats-geographic": self._handle_geographic_stats,
            "stats-tracking-quality": self._handle_tracking_quality,
            "stats-engagement": self._handle_engagement_stats,
            "stats-favorites": self._handle_favorites_stats,
            "stats-time-comparison": self._handle_time_comparison,
        }

        handler = handlers.get(request_type)
        if handler:
            return await handler(params)
        return None


# Register the namespace with the Socket.IO server
main_namespace = MainNamespace("/")
sio.register_namespace(main_namespace)

logger.info("MainNamespace registered for '/' namespace")
