"""
WebSocket management for real-time data streaming.

Provides WebSocket connections for:
- Aircraft updates (positions, new/removed)
- Airspace advisories and boundaries
- Safety events
- ACARS messages
- Alerts
- Request/response for on-demand data (aviation data, PIREPs, etc.)

Supports optional Redis pub/sub for multi-worker deployments.

## Request/Response Pattern

Clients can request data on-demand by sending:
    {
        "action": "request",
        "type": "airspaces",
        "request_id": "unique-id",
        "params": {"lat": 47.5, "lon": -122.3}
    }

Server responds with:
    {
        "type": "response",
        "request_id": "unique-id",
        "request_type": "airspaces",
        "data": {...},
        "timestamp": "..."
    }

Supported request types:
- airspaces, airspace-boundaries, pireps, metars, sigmets, airports, navaids
"""
import asyncio
import json
import logging
import os
import time
from datetime import datetime
from typing import Optional, Set, Callable, Any

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Optional Redis support
try:
    import redis.asyncio as aioredis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    aioredis = None


class ConnectionManager:
    """Manages WebSocket connections with topic-based subscriptions."""

    def __init__(self):
        # Map of topic -> set of WebSocket connections
        self._connections: dict[str, Set[WebSocket]] = {
            "aircraft": set(),
            "airspace": set(),
            "safety": set(),
            "acars": set(),
            "alerts": set(),
            "all": set(),  # Receives all events
        }
        self._lock = asyncio.Lock()
        self._last_aircraft_state: dict = {}
        self._last_airspace_state: dict = {}
        self._using_redis = False
        self._last_publish_time: Optional[float] = None

    async def connect(self, websocket: WebSocket, topics: list[str] = None):
        """Accept a WebSocket connection and subscribe to topics."""
        await websocket.accept()

        if topics is None:
            topics = ["all"]

        async with self._lock:
            for topic in topics:
                if topic in self._connections:
                    self._connections[topic].add(websocket)

            total = sum(len(conns) for conns in self._connections.values())
            logger.info(f"WebSocket connected to topics {topics}. Total connections: {total}")

        # Send initial state
        await self._send_initial_state(websocket, topics)

    async def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket from all subscriptions."""
        async with self._lock:
            for topic, connections in self._connections.items():
                connections.discard(websocket)

            total = sum(len(conns) for conns in self._connections.values())
            logger.info(f"WebSocket disconnected. Total connections: {total}")

    async def _send_initial_state(self, websocket: WebSocket, topics: list[str]):
        """Send current state to newly connected client."""
        try:
            # Send current aircraft state if subscribed
            if "aircraft" in topics or "all" in topics:
                if self._last_aircraft_state:
                    await self._send_to_socket(websocket, {
                        "type": "aircraft_snapshot",
                        "data": {
                            "aircraft": list(self._last_aircraft_state.values()),
                            "count": len(self._last_aircraft_state),
                            "timestamp": datetime.utcnow().isoformat() + "Z"
                        }
                    })

            # Send current airspace state if subscribed
            if "airspace" in topics or "all" in topics:
                if self._last_airspace_state:
                    await self._send_to_socket(websocket, {
                        "type": "airspace_snapshot",
                        "data": self._last_airspace_state
                    })

        except Exception as e:
            logger.warning(f"Failed to send initial state: {e}")

    async def _send_to_socket(self, websocket: WebSocket, message: dict):
        """Send a message to a single WebSocket."""
        try:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.send_json(message)
        except Exception as e:
            logger.debug(f"Failed to send to WebSocket: {e}")

    async def broadcast(self, topic: str, event_type: str, data: dict):
        """Broadcast a message to all connections subscribed to a topic."""
        message = {
            "type": event_type,
            "data": data,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

        self._last_publish_time = time.time()
        dead_connections = []

        async with self._lock:
            # Get connections for specific topic + "all" subscribers
            target_connections = self._connections.get(topic, set()) | self._connections.get("all", set())

            for websocket in target_connections:
                try:
                    if websocket.client_state == WebSocketState.CONNECTED:
                        await websocket.send_json(message)
                    else:
                        dead_connections.append(websocket)
                except Exception as e:
                    logger.debug(f"Failed to send to WebSocket: {e}")
                    dead_connections.append(websocket)

            # Clean up dead connections
            for websocket in dead_connections:
                for conns in self._connections.values():
                    conns.discard(websocket)

    async def get_connection_count(self) -> dict:
        """Get connection counts by topic."""
        async with self._lock:
            return {
                topic: len(conns) for topic, conns in self._connections.items()
            }

    def get_connection_count_sync(self) -> int:
        """Synchronous total connection count."""
        return sum(len(conns) for conns in self._connections.values())

    def is_using_redis(self) -> bool:
        """Check if using Redis."""
        return self._using_redis

    def get_last_publish_time(self) -> Optional[str]:
        """Get ISO timestamp of last publish."""
        if self._last_publish_time:
            return datetime.utcfromtimestamp(self._last_publish_time).isoformat() + "Z"
        return None

    # =========================================================================
    # Aircraft Events
    # =========================================================================

    async def publish_aircraft_update(self, aircraft_list: list[dict]):
        """Publish aircraft updates, detecting changes."""
        current_state = {}
        new_aircraft = []
        updated_aircraft = []
        removed_icaos = []

        for ac in aircraft_list:
            icao = ac.get("hex", "").upper()
            if not icao:
                continue
            current_state[icao] = ac

            if icao not in self._last_aircraft_state:
                new_aircraft.append(ac)
            else:
                old = self._last_aircraft_state[icao]
                if self._has_significant_change(old, ac):
                    updated_aircraft.append(ac)

        for icao in self._last_aircraft_state:
            if icao not in current_state:
                removed_icaos.append(icao)

        self._last_aircraft_state = current_state
        timestamp = datetime.utcnow().isoformat() + "Z"

        if new_aircraft:
            await self.broadcast("aircraft", "aircraft_new", {
                "aircraft": [self._simplify_aircraft(ac) for ac in new_aircraft],
                "timestamp": timestamp
            })

        if updated_aircraft:
            await self.broadcast("aircraft", "aircraft_update", {
                "aircraft": [self._simplify_aircraft(ac) for ac in updated_aircraft],
                "timestamp": timestamp
            })

        if removed_icaos:
            await self.broadcast("aircraft", "aircraft_remove", {
                "icaos": removed_icaos,
                "timestamp": timestamp
            })

        # Heartbeat with count
        await self.broadcast("aircraft", "heartbeat", {
            "count": len(current_state),
            "timestamp": timestamp
        })

    def _has_significant_change(self, old: dict, new: dict) -> bool:
        """Check if aircraft has changed significantly."""
        if old.get("lat") and new.get("lat"):
            if abs(old.get("lat", 0) - new.get("lat", 0)) > 0.001:
                return True
            if abs(old.get("lon", 0) - new.get("lon", 0)) > 0.001:
                return True

        old_alt = old.get("alt_baro") if isinstance(old.get("alt_baro"), int) else 0
        new_alt = new.get("alt_baro") if isinstance(new.get("alt_baro"), int) else 0
        if abs(old_alt - new_alt) > 100:
            return True

        if old.get("track") is not None and new.get("track") is not None:
            track_diff = abs(old.get("track", 0) - new.get("track", 0))
            track_diff = min(track_diff, 360 - track_diff)
            if track_diff > 5:
                return True

        if old.get("squawk") != new.get("squawk"):
            return True

        return False

    def _simplify_aircraft(self, ac: dict) -> dict:
        """Simplify aircraft data for transmission."""
        return {
            "hex": ac.get("hex"),
            "flight": (ac.get("flight") or "").strip(),
            "lat": ac.get("lat"),
            "lon": ac.get("lon"),
            "alt": ac.get("alt_baro"),
            "gs": ac.get("gs"),
            "track": ac.get("track"),
            "vr": ac.get("baro_rate"),
            "squawk": ac.get("squawk"),
            "category": ac.get("category"),
            "type": ac.get("t"),
            "rssi": ac.get("rssi"),
            "military": bool(ac.get("dbFlags", 0) & 1),
            "emergency": ac.get("squawk") in ["7500", "7600", "7700"],
        }

    # =========================================================================
    # Airspace Events
    # =========================================================================

    async def publish_airspace_update(self, advisories: list[dict], boundaries: list[dict]):
        """Publish airspace data update."""
        self._last_airspace_state = {
            "advisories": advisories,
            "boundaries": boundaries,
            "advisory_count": len(advisories),
            "boundary_count": len(boundaries),
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

        await self.broadcast("airspace", "airspace_update", self._last_airspace_state)

    async def publish_advisory_update(self, advisories: list[dict]):
        """Publish advisory-only update."""
        timestamp = datetime.utcnow().isoformat() + "Z"

        if "advisories" in self._last_airspace_state:
            self._last_airspace_state["advisories"] = advisories
            self._last_airspace_state["advisory_count"] = len(advisories)
            self._last_airspace_state["timestamp"] = timestamp

        await self.broadcast("airspace", "advisory_update", {
            "advisories": advisories,
            "count": len(advisories),
            "timestamp": timestamp
        })

    async def publish_boundary_update(self, boundaries: list[dict]):
        """Publish boundary-only update."""
        timestamp = datetime.utcnow().isoformat() + "Z"

        if "boundaries" in self._last_airspace_state:
            self._last_airspace_state["boundaries"] = boundaries
            self._last_airspace_state["boundary_count"] = len(boundaries)
            self._last_airspace_state["timestamp"] = timestamp

        await self.broadcast("airspace", "boundary_update", {
            "boundaries": boundaries,
            "count": len(boundaries),
            "timestamp": timestamp
        })

    # =========================================================================
    # Safety Events
    # =========================================================================

    async def publish_safety_event(self, event: dict):
        """Publish safety event."""
        await self.broadcast("safety", "safety_event", {
            "event_type": event["event_type"],
            "severity": event["severity"],
            "icao": event["icao"],
            "icao_2": event.get("icao_2"),
            "callsign": event.get("callsign"),
            "callsign_2": event.get("callsign_2"),
            "message": event["message"],
            "details": event.get("details", {}),
            "aircraft_snapshot": event.get("aircraft_snapshot"),
            "aircraft_snapshot_2": event.get("aircraft_snapshot_2"),
        })

    # =========================================================================
    # Alert Events
    # =========================================================================

    async def publish_alert_triggered(
        self, rule_id: int, rule_name: str, icao: str,
        callsign: str, message: str, priority: str, aircraft_data: dict
    ):
        """Publish alert triggered event."""
        await self.broadcast("alerts", "alert_triggered", {
            "rule_id": rule_id,
            "rule_name": rule_name,
            "icao": icao,
            "callsign": callsign,
            "message": message,
            "priority": priority,
            "aircraft_data": aircraft_data
        })

    # =========================================================================
    # ACARS Events
    # =========================================================================

    async def publish_acars_message(self, msg: dict):
        """Publish ACARS message."""
        await self.broadcast("acars", "acars_message", {
            "source": msg.get("source", "acars"),
            "icao_hex": msg.get("icao_hex"),
            "registration": msg.get("registration"),
            "callsign": msg.get("callsign"),
            "label": msg.get("label"),
            "text": msg.get("text"),
            "frequency": msg.get("frequency"),
            "signal_level": msg.get("signal_level"),
        })


class RedisConnectionManager(ConnectionManager):
    """Redis-backed WebSocket manager for multi-worker deployments."""

    CHANNEL_PREFIX = "adsb:ws:"
    STATE_KEY = "adsb:ws:state"
    AIRSPACE_STATE_KEY = "adsb:ws:airspace_state"

    def __init__(self, redis_url: str):
        super().__init__()
        self._using_redis = True
        self._redis_url = redis_url
        self._redis: Optional[aioredis.Redis] = None
        self._pubsub = None
        self._listener_task: Optional[asyncio.Task] = None
        self._running = False

    async def connect_redis(self):
        """Connect to Redis."""
        try:
            self._redis = aioredis.from_url(self._redis_url, decode_responses=True)
            await self._redis.ping()
            logger.info(f"WebSocket manager connected to Redis at {self._redis_url}")

            # Load last states
            try:
                state_json = await self._redis.get(self.STATE_KEY)
                if state_json:
                    self._last_aircraft_state = json.loads(state_json)
                    logger.info(f"Loaded {len(self._last_aircraft_state)} aircraft from Redis")

                airspace_json = await self._redis.get(self.AIRSPACE_STATE_KEY)
                if airspace_json:
                    self._last_airspace_state = json.loads(airspace_json)
                    logger.info("Loaded airspace state from Redis")
            except Exception as e:
                logger.warning(f"Could not load state from Redis: {e}")

        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            self._redis = None
            self._using_redis = False

    async def start_listener(self):
        """Start the Redis pub/sub listener."""
        if not self._redis:
            return

        self._running = True
        self._pubsub = self._redis.pubsub()

        # Subscribe to all topic channels
        channels = [f"{self.CHANNEL_PREFIX}{topic}" for topic in self._connections.keys()]
        await self._pubsub.subscribe(*channels)

        self._listener_task = asyncio.create_task(self._listen_loop())
        logger.info("Redis WebSocket listener started")

    async def _listen_loop(self):
        """Listen for messages on Redis pub/sub channels."""
        try:
            async for message in self._pubsub.listen():
                if not self._running:
                    break

                if message["type"] == "message":
                    try:
                        data = json.loads(message["data"])
                        channel = message["channel"]
                        topic = channel.replace(self.CHANNEL_PREFIX, "")

                        # Deliver to local subscribers
                        await self._deliver_to_topic(topic, data)
                    except json.JSONDecodeError:
                        logger.warning("Invalid JSON in Redis message")
        except Exception as e:
            if self._running:
                logger.error(f"Redis listener error: {e}")

    async def _deliver_to_topic(self, topic: str, message: dict):
        """Deliver a message to local WebSocket subscribers."""
        dead_connections = []

        async with self._lock:
            target_connections = self._connections.get(topic, set()) | self._connections.get("all", set())

            for websocket in target_connections:
                try:
                    if websocket.client_state == WebSocketState.CONNECTED:
                        await websocket.send_json(message)
                    else:
                        dead_connections.append(websocket)
                except Exception:
                    dead_connections.append(websocket)

            for websocket in dead_connections:
                for conns in self._connections.values():
                    conns.discard(websocket)

    async def broadcast(self, topic: str, event_type: str, data: dict):
        """Broadcast via Redis pub/sub."""
        message = {
            "type": event_type,
            "data": data,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

        self._last_publish_time = time.time()

        if self._redis:
            try:
                channel = f"{self.CHANNEL_PREFIX}{topic}"
                await self._redis.publish(channel, json.dumps(message))

                # Update state in Redis for specific topics
                if topic == "aircraft" and event_type in ("aircraft_new", "aircraft_update"):
                    await self._redis.set(self.STATE_KEY, json.dumps(self._last_aircraft_state))
                elif topic == "airspace":
                    await self._redis.set(self.AIRSPACE_STATE_KEY, json.dumps(self._last_airspace_state))

            except Exception as e:
                logger.warning(f"Redis publish failed: {e}")
                # Fallback to local delivery
                await self._deliver_to_topic(topic, message)
        else:
            await self._deliver_to_topic(topic, message)

    async def stop(self):
        """Stop the Redis listener."""
        self._running = False
        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
        if self._pubsub:
            await self._pubsub.close()
        if self._redis:
            await self._redis.close()
        logger.info("Redis WebSocket manager stopped")


# Global WebSocket manager instance
_ws_manager: Optional[ConnectionManager] = None


async def create_ws_manager() -> ConnectionManager:
    """Factory function to create the appropriate WebSocket manager."""
    global _ws_manager

    if settings.redis_url and REDIS_AVAILABLE:
        try:
            manager = RedisConnectionManager(settings.redis_url)
            await manager.connect_redis()
            if manager.is_using_redis():
                await manager.start_listener()
                logger.info("Using Redis-backed WebSocket manager")
                _ws_manager = manager
                return manager
        except Exception as e:
            logger.warning(f"Failed to create Redis WebSocket manager: {e}")

    if settings.redis_url and not REDIS_AVAILABLE:
        logger.warning("REDIS_URL set but redis-py not installed")

    logger.info("Using in-memory WebSocket manager (single worker)")
    _ws_manager = ConnectionManager()
    return _ws_manager


def get_ws_manager() -> ConnectionManager:
    """Get the global WebSocket manager instance."""
    global _ws_manager
    if _ws_manager is None:
        _ws_manager = ConnectionManager()
    return _ws_manager


async def handle_websocket(websocket: WebSocket, topics: list[str] = None):
    """Handle a WebSocket connection lifecycle."""
    manager = get_ws_manager()

    try:
        await manager.connect(websocket, topics)

        while True:
            try:
                # Wait for messages from client (ping/pong, subscription changes, requests)
                data = await asyncio.wait_for(websocket.receive_json(), timeout=60.0)

                action = data.get("action")

                # Handle subscription changes
                if action == "subscribe":
                    new_topics = data.get("topics", [])
                    async with manager._lock:
                        for topic in new_topics:
                            if topic in manager._connections:
                                manager._connections[topic].add(websocket)
                    await manager._send_initial_state(websocket, new_topics)

                elif action == "unsubscribe":
                    remove_topics = data.get("topics", [])
                    async with manager._lock:
                        for topic in remove_topics:
                            if topic in manager._connections:
                                manager._connections[topic].discard(websocket)

                elif action == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": datetime.utcnow().isoformat() + "Z"})

                elif action == "request":
                    # Handle data request
                    await handle_data_request(websocket, data)

            except asyncio.TimeoutError:
                # Send keepalive ping
                try:
                    await websocket.send_json({"type": "ping", "timestamp": datetime.utcnow().isoformat() + "Z"})
                except Exception:
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"WebSocket error: {e}")
    finally:
        await manager.disconnect(websocket)


async def handle_data_request(websocket: WebSocket, request: dict):
    """
    Handle on-demand data requests from WebSocket clients.

    Supported request types:
    - airspaces: G-AIRMET advisories
    - airspace-boundaries: Static airspace boundaries
    - pireps: Pilot reports
    - metars: METAR weather observations
    - metar: Single station METAR
    - taf: Terminal aerodrome forecast
    - sigmets: SIGMETs
    - airports: Airport information
    - navaids: Navigation aids
    - safety-events: Recent safety events
    - aircraft-info: Aircraft info by ICAO hex
    - status: System status (aircraft count, connections, etc.)
    - health: Health check (service status)

    Request format:
        {
            "action": "request",
            "type": "airspaces",
            "request_id": "unique-id-123",
            "params": {"lat": 47.5, "lon": -122.3, "radius": 100}
        }

    Response format:
        {
            "type": "response",
            "request_id": "unique-id-123",
            "request_type": "airspaces",
            "data": {...},
            "timestamp": "2024-01-15T12:00:00Z"
        }
    """
    request_type = request.get("type")
    request_id = request.get("request_id", str(time.time()))
    params = request.get("params", {})

    timestamp = datetime.utcnow().isoformat() + "Z"

    try:
        # Import here to avoid circular imports
        from app.core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            data = await fetch_requested_data(request_type, params, db)

        response = {
            "type": "response",
            "request_id": request_id,
            "request_type": request_type,
            "data": data,
            "timestamp": timestamp
        }

    except Exception as e:
        logger.error(f"WebSocket request error ({request_type}): {e}")
        response = {
            "type": "error",
            "request_id": request_id,
            "request_type": request_type,
            "error": str(e),
            "timestamp": timestamp
        }

    try:
        await websocket.send_json(response)
    except Exception as e:
        logger.warning(f"Failed to send response: {e}")


async def fetch_requested_data(request_type: str, params: dict, db) -> dict:
    """Fetch data based on request type and parameters."""

    # Aviation data requests
    if request_type == "airspaces":
        from app.services import airspace as airspace_service
        lat = params.get("lat")
        lon = params.get("lon")
        hazard = params.get("hazard")

        if lat is None or lon is None:
            return {"error": "lat and lon parameters required", "data": []}

        advisories = await airspace_service.get_advisories(db, lat=lat, lon=lon, hazard=hazard)
        return {
            "advisories": advisories,
            "count": len(advisories),
            "center": {"lat": lat, "lon": lon},
            "source": "database"
        }

    elif request_type == "airspace-boundaries":
        from app.services import airspace as airspace_service
        lat = params.get("lat")
        lon = params.get("lon")
        radius = params.get("radius", 100)
        airspace_class = params.get("class")

        boundaries = await airspace_service.get_boundaries(
            db, lat=lat, lon=lon, radius_nm=radius, airspace_class=airspace_class
        )
        result = {
            "boundaries": boundaries,
            "count": len(boundaries),
            "source": "database"
        }
        if lat and lon:
            result["center"] = {"lat": lat, "lon": lon}
            result["radius_nm"] = radius
        return result

    elif request_type == "pireps":
        from app.routers.aviation import fetch_awc_data, haversine_nm
        from app.services import weather_cache
        lat = params.get("lat")
        lon = params.get("lon")
        radius = params.get("radius", 100)
        hours = params.get("hours", 2)

        if lat is None or lon is None:
            return {"error": "lat and lon parameters required", "data": []}

        deg_offset = radius / 60.0
        bbox = f"{lat - deg_offset},{lon - deg_offset},{lat + deg_offset},{lon + deg_offset}"

        # Try cache first
        cached = await weather_cache.get_cached_aviation_data("pireps", bbox)
        if cached is not None:
            pireps = cached
            source = "cache"
        else:
            data = await fetch_awc_data("pirep", {"format": "json", "age": hours, "bbox": bbox})

            if isinstance(data, dict) and "error" in data:
                return {"data": [], "count": 0, "error": data["error"]}

            pireps = data if isinstance(data, list) else []
            source = "aviationweather.gov"

            # Cache result for 3 minutes
            if pireps:
                await weather_cache.cache_aviation_data("pireps", bbox, pireps, ttl=180)

        # Calculate distances
        for p in pireps:
            p_lat, p_lon = p.get("lat", 0), p.get("lon", 0)
            if p_lat and p_lon:
                p["distance_nm"] = round(haversine_nm(lat, lon, p_lat, p_lon), 1)

        pireps = [p for p in pireps if p.get("distance_nm") is not None and p["distance_nm"] <= radius]
        pireps.sort(key=lambda x: x.get("distance_nm") or 9999)

        return {
            "data": pireps[:50],
            "count": min(len(pireps), 50),
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": source
        }

    elif request_type == "metars":
        from app.routers.aviation import fetch_awc_data, haversine_nm
        from app.services import weather_cache
        lat = params.get("lat")
        lon = params.get("lon")
        radius = params.get("radius", 100)
        hours = params.get("hours", 2)
        limit = params.get("limit", 20)

        if lat is None or lon is None:
            return {"error": "lat and lon parameters required", "data": []}

        deg_offset = radius / 60.0
        bbox = f"{lat - deg_offset},{lon - deg_offset},{lat + deg_offset},{lon + deg_offset}"

        # Try cache first
        cached = await weather_cache.get_cached_aviation_data("metars", bbox)
        if cached is not None:
            metars = cached
            source = "cache"
        else:
            data = await fetch_awc_data("metar", {"bbox": bbox, "format": "json", "hours": hours})

            if isinstance(data, dict) and "error" in data:
                return {"data": [], "count": 0, "error": data["error"]}

            metars = data if isinstance(data, list) else []
            source = "aviationweather.gov"

            # Cache result for 5 minutes
            if metars:
                await weather_cache.cache_aviation_data("metars", bbox, metars, ttl=300)

        for m in metars:
            m_lat, m_lon = m.get("lat", 0), m.get("lon", 0)
            m["distance_nm"] = round(haversine_nm(lat, lon, m_lat, m_lon), 1)

        metars = [m for m in metars if m.get("distance_nm", 9999) <= radius]
        metars.sort(key=lambda x: x.get("distance_nm", 9999))

        return {
            "data": metars[:limit],
            "count": min(len(metars), limit),
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": source
        }

    elif request_type == "sigmets":
        from app.routers.aviation import fetch_awc_data, haversine_nm
        hazard = params.get("hazard")
        lat = params.get("lat")
        lon = params.get("lon")
        radius = params.get("radius")

        awc_params = {"format": "json"}
        if hazard:
            awc_params["hazard"] = hazard

        data = await fetch_awc_data("airsigmet", awc_params)

        if isinstance(data, dict) and "error" in data:
            return {"data": [], "count": 0, "error": data["error"]}

        sigmets = data if isinstance(data, list) else []

        if lat is not None and lon is not None:
            for s in sigmets:
                s_lat, s_lon = s.get("lat"), s.get("lon")
                if s_lat and s_lon:
                    s["distance_nm"] = round(haversine_nm(lat, lon, s_lat, s_lon), 1)
            if radius:
                sigmets = [s for s in sigmets if s.get("distance_nm", 0) <= radius]
            sigmets.sort(key=lambda x: x.get("distance_nm", 9999))

        return {
            "data": sigmets,
            "count": len(sigmets),
            "source": "aviationweather.gov"
        }

    elif request_type == "airports":
        from app.routers.aviation import fetch_awc_data, haversine_nm
        from app.services import weather_cache
        lat = params.get("lat")
        lon = params.get("lon")
        radius = params.get("radius", 50)
        limit = params.get("limit", 20)

        if lat is None or lon is None:
            return {"error": "lat and lon parameters required", "data": []}

        deg_offset = radius / 60.0
        bbox = f"{lat - deg_offset},{lon - deg_offset},{lat + deg_offset},{lon + deg_offset}"

        # Try cache first
        cached = await weather_cache.get_cached_aviation_data("airports", bbox)
        if cached is not None:
            airports = cached
            source = "cache"
        else:
            data = await fetch_awc_data("airport", {"bbox": bbox, "zoom": 8, "density": 3, "format": "json"})

            if isinstance(data, dict) and "error" in data:
                return {"data": [], "count": 0, "error": data["error"]}

            airports = data if isinstance(data, list) else []
            source = "aviationweather.gov"

            # Cache airports for 30 minutes (they don't change often)
            if airports:
                await weather_cache.cache_aviation_data("airports", bbox, airports, ttl=1800)

        for apt in airports:
            apt_lat, apt_lon = apt.get("lat", 0), apt.get("lon", 0)
            apt["distance_nm"] = round(haversine_nm(lat, lon, apt_lat, apt_lon), 1)

        airports = [a for a in airports if a.get("distance_nm", 9999) <= radius]
        airports.sort(key=lambda x: x.get("distance_nm", 9999))

        return {
            "data": airports[:limit],
            "count": min(len(airports), limit),
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": source
        }

    elif request_type == "navaids":
        from app.routers.aviation import fetch_awc_data, haversine_nm
        from app.services import weather_cache
        lat = params.get("lat")
        lon = params.get("lon")
        radius = params.get("radius", 50)
        limit = params.get("limit", 20)
        navaid_type = params.get("type")

        if lat is None or lon is None:
            return {"error": "lat and lon parameters required", "data": []}

        deg_offset = radius / 60.0
        bbox = f"{lat - deg_offset},{lon - deg_offset},{lat + deg_offset},{lon + deg_offset}"

        # Try cache first
        cached = await weather_cache.get_cached_aviation_data("navaids", bbox)
        if cached is not None:
            navaids = cached
            source = "cache"
        else:
            data = await fetch_awc_data("navaid", {"bbox": bbox, "format": "json"})

            if isinstance(data, dict) and "error" in data:
                return {"data": [], "count": 0, "error": data["error"]}

            navaids = data if isinstance(data, list) else []
            source = "aviationweather.gov"

            # Cache navaids for 30 minutes (they don't change often)
            if navaids:
                await weather_cache.cache_aviation_data("navaids", bbox, navaids, ttl=1800)

        if navaid_type:
            navaids = [n for n in navaids if n.get("type", "").upper() == navaid_type.upper()]

        for nav in navaids:
            nav_lat, nav_lon = nav.get("lat", 0), nav.get("lon", 0)
            nav["distance_nm"] = round(haversine_nm(lat, lon, nav_lat, nav_lon), 1)

        navaids = [n for n in navaids if n.get("distance_nm", 9999) <= radius]
        navaids.sort(key=lambda x: x.get("distance_nm", 9999))

        return {
            "data": navaids[:limit],
            "count": min(len(navaids), limit),
            "center": {"lat": lat, "lon": lon},
            "radius_nm": radius,
            "source": source
        }

    elif request_type == "safety-events":
        # Return active events from safety monitor (real-time, with proper IDs for acknowledgment)
        from app.services.safety import safety_monitor

        include_acknowledged = params.get("include_acknowledged", True)
        active_events = safety_monitor.get_active_events(include_acknowledged=include_acknowledged)

        # Format events for frontend
        events = []
        for e in active_events:
            events.append({
                "id": e.get("id"),  # String ID like "proximity_conflict:AC01FD:AB19DF"
                "event_type": e.get("event_type"),
                "severity": e.get("severity"),
                "icao": e.get("icao"),
                "icao_2": e.get("icao_2"),
                "callsign": e.get("callsign"),
                "callsign_2": e.get("callsign_2"),
                "message": e.get("message"),
                "details": e.get("details", {}),
                "aircraft_snapshot": e.get("aircraft_snapshot"),
                "aircraft_snapshot_2": e.get("aircraft_snapshot_2"),
                "acknowledged": e.get("acknowledged", False),
                "created_at": e.get("created_at"),
                "last_seen": e.get("last_seen"),
                "timestamp": datetime.utcnow().isoformat() + "Z"
            })

        return {
            "events": events,
            "count": len(events)
        }

    elif request_type == "aircraft-info":
        from app.services.aircraft_info import get_aircraft_info
        from app.services.audio import get_matched_radio_calls

        icao = params.get("icao") or params.get("hex")
        callsign = params.get("callsign") or params.get("flight")
        include_radio_calls = params.get("include_radio_calls", True)
        radio_hours = params.get("radio_hours", 24)
        radio_limit = params.get("radio_limit", 10)

        if not icao:
            return {"error": "icao or hex parameter required"}

        icao = icao.upper()
        info = await get_aircraft_info(db, icao)

        if not info:
            return {"icao_hex": icao, "found": False}

        # Include matched radio calls if requested
        if include_radio_calls:
            # Use callsign from params, or from aircraft info (operator_icao + typical format)
            search_callsign = callsign.strip().upper() if callsign else None
            operator_icao = info.get("operator_icao")
            registration = info.get("registration")

            matched_calls = await get_matched_radio_calls(
                db,
                callsign=search_callsign,
                operator_icao=operator_icao if not search_callsign else None,
                registration=registration,
                hours=radio_hours,
                limit=radio_limit,
            )

            info["matched_radio_calls"] = matched_calls

        return info

    elif request_type == "sightings":
        # Historical aircraft sightings with filters
        from sqlalchemy import select, func, and_
        from app.models import AircraftSighting
        from datetime import timedelta

        icao_hex = params.get("icao") or params.get("icao_hex") or params.get("hex")
        callsign = params.get("callsign")
        hours = params.get("hours", 24)
        limit = params.get("limit", 100)
        offset = params.get("offset", 0)
        min_altitude = params.get("min_altitude")
        max_altitude = params.get("max_altitude")
        military_only = params.get("military_only", False)

        if not icao_hex and not callsign:
            return {"error": "icao_hex or callsign parameter required", "sightings": []}

        cutoff = datetime.utcnow() - timedelta(hours=hours)
        conditions = [AircraftSighting.timestamp > cutoff]

        if icao_hex:
            conditions.append(AircraftSighting.icao_hex == icao_hex.upper())
        if callsign:
            conditions.append(AircraftSighting.callsign.ilike(f"%{callsign}%"))
        if military_only:
            conditions.append(AircraftSighting.is_military == True)
        if min_altitude is not None:
            conditions.append(AircraftSighting.altitude_baro >= min_altitude)
        if max_altitude is not None:
            conditions.append(AircraftSighting.altitude_baro <= max_altitude)

        # Get total count
        count_query = select(func.count(AircraftSighting.id)).where(and_(*conditions))
        total = (await db.execute(count_query)).scalar() or 0

        # Get sightings
        query = (
            select(AircraftSighting)
            .where(and_(*conditions))
            .order_by(AircraftSighting.timestamp.desc())
            .limit(limit)
            .offset(offset)
        )

        result = await db.execute(query)
        sightings = []

        for s in result.scalars():
            sightings.append({
                "timestamp": s.timestamp.isoformat() + "Z",
                "icao_hex": s.icao_hex,
                "callsign": s.callsign,
                "lat": s.latitude,
                "lon": s.longitude,
                "altitude": s.altitude_baro,
                "gs": s.ground_speed,
                "vr": s.vertical_rate,
                "track": s.track,
                "distance_nm": s.distance_nm,
                "is_military": s.is_military,
                "squawk": s.squawk,
                "rssi": round(s.rssi, 1) if s.rssi else None,
            })

        return {
            "sightings": sightings,
            "count": len(sightings),
            "total": total,
            "icao_hex": icao_hex,
            "hours": hours
        }

    elif request_type == "metar":
        # Single station METAR
        from app.routers.aviation import fetch_awc_data
        station = params.get("station") or params.get("icao")
        hours = params.get("hours", 2)

        if not station:
            return {"error": "station parameter required"}

        data = await fetch_awc_data("metar", {"ids": station.upper(), "format": "json", "hours": hours})

        if isinstance(data, dict) and "error" in data:
            return {"data": [], "count": 0, "error": data["error"]}

        return {
            "data": data if isinstance(data, list) else [],
            "count": len(data) if isinstance(data, list) else 0,
            "source": "aviationweather.gov"
        }

    elif request_type == "taf":
        # Single station TAF
        from app.routers.aviation import fetch_awc_data
        station = params.get("station") or params.get("icao")

        if not station:
            return {"error": "station parameter required"}

        data = await fetch_awc_data("taf", {"ids": station.upper(), "format": "json"})

        if isinstance(data, dict) and "error" in data:
            return {"data": [], "count": 0, "error": data["error"]}

        return {
            "data": data if isinstance(data, list) else [],
            "count": len(data) if isinstance(data, list) else 0,
            "source": "aviationweather.gov"
        }

    elif request_type == "status":
        # System status
        import os
        from sqlalchemy import select, func
        from app.core import get_settings, safe_request
        from app.models import AircraftSighting, AircraftSession, AlertRule, AlertHistory, SafetyEvent
        from app.services.sse import get_sse_manager
        from app.services.socketio_manager import get_socketio_manager
        from app.services.safety import safety_monitor
        from app.services.notifications import notifier
        from app.services.acars import acars_service

        settings = get_settings()

        # ADS-B source check
        url = f"{settings.ultrafeeder_url}/data/aircraft.json"
        data = await safe_request(url, timeout=5)
        adsb_online = data is not None
        aircraft_count = len(data.get("aircraft", [])) if data else 0

        # Database counts
        sightings = (await db.execute(select(func.count(AircraftSighting.id)))).scalar() or 0
        sessions = (await db.execute(select(func.count(AircraftSession.id)))).scalar() or 0
        active_rules = (await db.execute(
            select(func.count(AlertRule.id)).where(AlertRule.enabled == True)
        )).scalar() or 0
        alert_history = (await db.execute(select(func.count(AlertHistory.id)))).scalar() or 0
        safety_events = (await db.execute(select(func.count(SafetyEvent.id)))).scalar() or 0

        # SSE status
        sse_manager = get_sse_manager()
        sse_subscribers = await sse_manager.get_subscriber_count() if sse_manager else 0

        # Socket.IO status
        sio_manager = get_socketio_manager()
        sio_connections = sio_manager.get_connection_count() if sio_manager else 0

        # ACARS status
        acars_stats = acars_service.get_stats()

        # Get scheduler state
        from app.routers.system import _scheduler_state

        return {
            "version": "2.6.0",
            "adsb_online": adsb_online,
            "aircraft_count": aircraft_count,
            "total_sightings": sightings,
            "total_sessions": sessions,
            "active_rules": active_rules,
            "alert_history_count": alert_history,
            "safety_event_count": safety_events,
            "safety_monitoring_enabled": safety_monitor.enabled,
            "safety_tracked_aircraft": len(safety_monitor._aircraft_state),
            "notifications_configured": notifier.server_count > 0,
            "redis_enabled": sse_manager._using_redis if sse_manager else False,
            "sse_subscribers": sse_subscribers,
            "sse_tracked_aircraft": len(sse_manager._last_aircraft_state) if sse_manager else 0,
            "sse_redis_enabled": sse_manager._using_redis if sse_manager else False,
            "socketio_connections": sio_connections,
            "acars_enabled": settings.acars_enabled,
            "acars_running": acars_stats["running"],
            "polling_interval_seconds": settings.polling_interval,
            "db_store_interval_seconds": settings.db_store_interval,
            "scheduler_running": _scheduler_state["running"],
            "scheduler_jobs": _scheduler_state["jobs"],
            "worker_pid": os.getpid(),
            "location": {
                "lat": settings.feeder_lat,
                "lon": settings.feeder_lon
            }
        }

    elif request_type == "health":
        # Health check
        from sqlalchemy import text
        from app.core import get_settings, safe_request
        from app.services.sse import get_sse_manager
        from app.services.socketio_manager import get_socketio_manager
        from app.services.acars import acars_service

        settings = get_settings()
        services = {}
        overall_status = "healthy"

        # Database check
        try:
            start = datetime.utcnow()
            await db.execute(text("SELECT 1"))
            latency = (datetime.utcnow() - start).total_seconds() * 1000
            services["database"] = {"status": "up", "latency_ms": round(latency, 2)}
        except Exception as e:
            services["database"] = {"status": "down", "error": str(e)}
            overall_status = "unhealthy"

        # Ultrafeeder check
        try:
            url = f"{settings.ultrafeeder_url}/data/aircraft.json"
            data = await safe_request(url, timeout=5)
            if data:
                count = len(data.get("aircraft", []))
                services["ultrafeeder"] = {"status": "up", "aircraft_count": count}
            else:
                services["ultrafeeder"] = {"status": "down", "error": "No data"}
                overall_status = "degraded"
        except Exception as e:
            services["ultrafeeder"] = {"status": "down", "error": str(e)}
            overall_status = "degraded"

        # Redis check
        sse_manager = get_sse_manager()
        if sse_manager and sse_manager._using_redis:
            try:
                if hasattr(sse_manager, "_redis") and sse_manager._redis:
                    await sse_manager._redis.ping()
                    services["redis"] = {"status": "up"}
                else:
                    services["redis"] = {"status": "not_connected"}
            except Exception as e:
                services["redis"] = {"status": "down", "error": str(e)}
        else:
            services["redis"] = {"status": "not_configured"}

        # SSE check
        if sse_manager:
            try:
                subscriber_count = await sse_manager.get_subscriber_count()
                services["sse"] = {
                    "status": "up",
                    "subscribers": subscriber_count,
                    "mode": "redis" if sse_manager._using_redis else "memory"
                }
            except Exception as e:
                services["sse"] = {"status": "error", "error": str(e)}
        else:
            services["sse"] = {"status": "not_initialized"}

        # Socket.IO check
        sio_manager = get_socketio_manager()
        if sio_manager:
            services["socketio"] = {
                "status": "up",
                "connections": sio_manager.get_connection_count(),
                "mode": "redis" if sio_manager.is_using_redis() else "memory"
            }
        else:
            services["socketio"] = {"status": "not_initialized"}

        # ACARS check
        if settings.acars_enabled:
            stats = acars_service.get_stats()
            services["acars"] = {
                "status": "up" if stats["running"] else "down",
                "messages_last_hour": stats["acars"]["last_hour"] + stats["vdlm2"]["last_hour"]
            }
        else:
            services["acars"] = {"status": "disabled"}

        return {
            "status": overall_status,
            "services": services,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

    elif request_type == "ws-status":
        # WebSocket/Socket.IO status
        from app.services.sse import get_sse_manager
        from app.services.socketio_manager import get_socketio_manager

        sse_manager = get_sse_manager()
        sio_manager = get_socketio_manager()

        sse_subscribers = 0
        sse_mode = "not_initialized"
        if sse_manager:
            try:
                sse_subscribers = await sse_manager.get_subscriber_count()
                sse_mode = "redis" if sse_manager._using_redis else "memory"
            except Exception:
                pass

        sio_connections = 0
        sio_mode = "not_initialized"
        redis_enabled = False
        tracked_aircraft = 0
        last_publish = None
        if sio_manager:
            sio_connections = sio_manager.get_connection_count()
            sio_mode = "redis" if sio_manager.is_using_redis() else "memory"
            redis_enabled = sio_manager.is_using_redis()
            tracked_aircraft = len(sio_manager._last_aircraft_state)
            last_publish = sio_manager.get_last_publish_time()

        return {
            "subscribers": sse_subscribers + sio_connections,
            "sse_subscribers": sse_subscribers,
            "socketio_connections": sio_connections,
            "mode": sio_mode if sio_manager else sse_mode,
            "redis_enabled": redis_enabled,
            "tracked_aircraft": tracked_aircraft,
            "last_publish": last_publish,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

    elif request_type == "safety-status":
        # Safety monitor status
        from app.services.safety import safety_monitor

        return {
            "enabled": safety_monitor.enabled,
            "tracked_aircraft": len(safety_monitor._aircraft_state),
            "thresholds": safety_monitor.get_thresholds(),
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

    elif request_type == "acars-status":
        # ACARS service status
        from app.services.acars import acars_service

        stats = acars_service.get_stats()
        return {
            "running": stats["running"],
            "acars": {
                "total_received": stats["acars"]["total"],
                "last_hour": stats["acars"]["last_hour"],
                "errors": stats["acars"]["errors"],
            },
            "vdlm2": {
                "total_received": stats["vdlm2"]["total"],
                "last_hour": stats["vdlm2"]["last_hour"],
                "errors": stats["vdlm2"]["errors"],
            },
            "buffer_size": stats["recent_buffer_size"],
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

    elif request_type == "photo":
        # Get aircraft photo URLs (existing cached or from DB)
        from app.core.config import get_settings
        from app.services.aircraft_info import get_aircraft_info
        from app.services.photo_cache import get_signed_s3_url, _check_s3_exists

        icao = params.get("icao") or params.get("icao_hex") or params.get("hex")
        if not icao:
            return {"error": "icao parameter required"}

        icao = icao.upper()
        settings = get_settings()

        photo_url = None
        thumbnail_url = None
        photographer = None
        source = None

        # Check S3 first if enabled
        if settings.s3_enabled:
            if await _check_s3_exists(icao, is_thumbnail=False):
                photo_url = await get_signed_s3_url(icao, is_thumbnail=False)
            if await _check_s3_exists(icao, is_thumbnail=True):
                thumbnail_url = await get_signed_s3_url(icao, is_thumbnail=True)

        # Get info from database for metadata and fallback URLs
        info = await get_aircraft_info(db, icao)
        if info:
            photographer = info.get("photo_photographer")
            source = info.get("photo_source")
            if not photo_url:
                photo_url = info.get("photo_url")
            if not thumbnail_url:
                thumbnail_url = info.get("photo_thumbnail_url")

        if not photo_url and not thumbnail_url:
            return {"error": f"No photo found for {icao}"}

        return {
            "icao_hex": icao,
            "photo_url": photo_url,
            "thumbnail_url": thumbnail_url or photo_url,
            "photographer": photographer,
            "source": source or ("s3" if settings.s3_enabled else None),
        }

    elif request_type == "photo-cache":
        # Prioritize caching - immediately fetch and cache photo to S3
        import logging
        photo_logger = logging.getLogger(__name__)

        from app.core.config import get_settings
        from app.services.aircraft_info import get_aircraft_info, refresh_aircraft_info
        from app.services.photo_cache import (
            cache_aircraft_photos, get_signed_s3_url, _check_s3_exists
        )

        icao = params.get("icao") or params.get("icao_hex") or params.get("hex")
        if not icao:
            return {"error": "icao parameter required"}

        icao = icao.upper()
        settings = get_settings()
        photo_logger.debug(f"photo-cache request for {icao}, s3_enabled={settings.s3_enabled}")

        # Check if already cached in S3
        if settings.s3_enabled:
            photo_exists = await _check_s3_exists(icao, is_thumbnail=False)
            thumb_exists = await _check_s3_exists(icao, is_thumbnail=True)
            photo_logger.debug(f"S3 check for {icao}: photo={photo_exists}, thumb={thumb_exists}")
            if photo_exists or thumb_exists:
                result = {
                    "icao_hex": icao,
                    "photo_url": await get_signed_s3_url(icao, False) if photo_exists else None,
                    "thumbnail_url": await get_signed_s3_url(icao, True) if thumb_exists else None,
                    "cached": True,
                    "source": "s3"
                }
                photo_logger.debug(f"Returning S3 cached result for {icao}: {result}")
                return result

        # Get aircraft info to find photo URLs
        info = await get_aircraft_info(db, icao)
        if not info:
            photo_logger.debug(f"No info in DB for {icao}, refreshing...")
            info = await refresh_aircraft_info(db, icao)

        if not info:
            photo_logger.debug(f"No info found for {icao}")
            return {"error": f"No info found for {icao}"}

        photo_url = info.get("photo_url")
        thumbnail_url = info.get("photo_thumbnail_url")
        photo_page_link = info.get("photo_page_link")
        photo_logger.debug(f"Info for {icao}: photo_url={photo_url}, thumb_url={thumbnail_url}")

        if not photo_url and not thumbnail_url:
            return {"error": f"No photo available for {icao}"}

        # Immediately cache to S3 (don't use background queue)
        cached_photo, cached_thumb = await cache_aircraft_photos(
            db, icao, photo_url, thumbnail_url, photo_page_link, force=True
        )
        photo_logger.debug(f"Cache result for {icao}: cached_photo={cached_photo}, cached_thumb={cached_thumb}")

        # Return signed URLs if cached to S3, otherwise return source URLs
        if settings.s3_enabled and (cached_photo or cached_thumb):
            result = {
                "icao_hex": icao,
                "photo_url": await get_signed_s3_url(icao, False) if cached_photo else photo_url,
                "thumbnail_url": await get_signed_s3_url(icao, True) if cached_thumb else thumbnail_url,
                "cached": True,
                "source": "s3"
            }
            photo_logger.debug(f"Returning newly cached result for {icao}: {result}")
            return result

        result = {
            "icao_hex": icao,
            "photo_url": cached_photo or photo_url,
            "thumbnail_url": cached_thumb or thumbnail_url,
            "cached": bool(cached_photo or cached_thumb),
            "source": info.get("photo_source")
        }
        photo_logger.debug(f"Returning source URL result for {icao}: {result}")
        return result

    # =========================================================================
    # History & Analytics Endpoints (for StatsView dashboard)
    # =========================================================================

    elif request_type == "history-stats":
        # Historical statistics for dashboard
        from app.routers.history import get_stats
        from sqlalchemy.ext.asyncio import AsyncSession

        hours = params.get("hours", 24)
        military_only = params.get("military_only", False)
        min_altitude = params.get("min_altitude")
        max_altitude = params.get("max_altitude")
        min_distance = params.get("min_distance")
        max_distance = params.get("max_distance")
        category = params.get("category")
        aircraft_type = params.get("aircraft_type")

        result = await get_stats(
            hours=hours,
            military_only=military_only,
            min_altitude=min_altitude,
            max_altitude=max_altitude,
            min_distance=min_distance,
            max_distance=max_distance,
            category=category,
            aircraft_type=aircraft_type,
            db=db
        )
        return result

    elif request_type == "history-trends":
        # Traffic trends over time
        from app.routers.history import get_trends

        hours = params.get("hours", 24)
        interval = params.get("interval", "hour")
        military_only = params.get("military_only", False)
        category = params.get("category")
        aircraft_type = params.get("aircraft_type")

        result = await get_trends(
            hours=hours,
            interval=interval,
            military_only=military_only,
            category=category,
            aircraft_type=aircraft_type,
            db=db
        )
        return result

    elif request_type == "history-top":
        # Top performers (longest tracked, furthest, etc.)
        from app.routers.history import get_top_performers

        hours = params.get("hours", 24)
        limit = params.get("limit", 10)
        military_only = params.get("military_only", False)
        category = params.get("category")
        aircraft_type = params.get("aircraft_type")

        result = await get_top_performers(
            hours=hours,
            limit=limit,
            military_only=military_only,
            category=category,
            aircraft_type=aircraft_type,
            db=db
        )
        return result

    elif request_type == "history-sessions":
        # Session list for fleet breakdown
        from app.routers.history import get_sessions

        hours = params.get("hours", 24)
        limit = params.get("limit", 500)
        military_only = params.get("military_only", False)

        result = await get_sessions(
            hours=hours,
            limit=limit,
            military_only=military_only,
            db=db
        )
        return result

    elif request_type == "history-analytics-distance":
        # Distance analytics for antenna performance
        from app.routers.history import get_distance_analytics

        hours = params.get("hours", 24)
        military_only = params.get("military_only", False)
        category = params.get("category")
        aircraft_type = params.get("aircraft_type")

        result = await get_distance_analytics(
            hours=hours,
            military_only=military_only,
            category=category,
            aircraft_type=aircraft_type,
            db=db
        )
        return result

    elif request_type == "history-analytics-speed":
        # Speed analytics
        from app.routers.history import get_speed_analytics

        hours = params.get("hours", 24)
        military_only = params.get("military_only", False)
        category = params.get("category")
        aircraft_type = params.get("aircraft_type")

        result = await get_speed_analytics(
            hours=hours,
            military_only=military_only,
            category=category,
            aircraft_type=aircraft_type,
            db=db
        )
        return result

    elif request_type == "history-analytics-correlation":
        # Correlation analytics
        from app.routers.history import get_correlation_analytics

        hours = params.get("hours", 24)
        military_only = params.get("military_only", False)
        category = params.get("category")
        aircraft_type = params.get("aircraft_type")

        result = await get_correlation_analytics(
            hours=hours,
            military_only=military_only,
            category=category,
            aircraft_type=aircraft_type,
            db=db
        )
        return result

    elif request_type == "acars-stats":
        # ACARS statistics
        from app.services.acars import acars_service
        from app.models import AcarsMessage
        from datetime import timedelta

        hours = params.get("hours", 24)
        cutoff = datetime.utcnow() - timedelta(hours=hours)

        # Get service stats
        service_stats = acars_service.get_stats()

        # Get message counts from database
        total_query = select(func.count(AcarsMessage.id))
        total = (await db.execute(total_query)).scalar() or 0

        last_24h_query = select(func.count(AcarsMessage.id)).where(
            AcarsMessage.timestamp > datetime.utcnow() - timedelta(hours=24)
        )
        last_24h = (await db.execute(last_24h_query)).scalar() or 0

        last_hour_query = select(func.count(AcarsMessage.id)).where(
            AcarsMessage.timestamp > datetime.utcnow() - timedelta(hours=1)
        )
        last_hour = (await db.execute(last_hour_query)).scalar() or 0

        # Top labels
        labels_query = (
            select(AcarsMessage.label, func.count(AcarsMessage.id).label("count"))
            .where(AcarsMessage.timestamp > cutoff)
            .group_by(AcarsMessage.label)
            .order_by(func.count(AcarsMessage.id).desc())
            .limit(10)
        )
        labels_result = await db.execute(labels_query)
        top_labels = [{"label": row.label, "count": row.count} for row in labels_result]

        return {
            "total_messages": total,
            "last_24h": last_24h,
            "last_hour": last_hour,
            "top_labels": top_labels,
            "service_stats": {
                "running": service_stats["running"],
                "acars_total": service_stats["acars"]["total"],
                "vdlm2_total": service_stats["vdlm2"]["total"],
            }
        }

    elif request_type == "safety-stats":
        # Safety statistics
        from app.services.safety import safety_monitor
        from app.models import SafetyEvent
        from datetime import timedelta

        hours = params.get("hours", 24)
        cutoff = datetime.utcnow() - timedelta(hours=hours)

        # Total events in period
        total_query = select(func.count(SafetyEvent.id)).where(SafetyEvent.created_at > cutoff)
        total_events = (await db.execute(total_query)).scalar() or 0

        # Events by type
        type_query = (
            select(SafetyEvent.event_type, func.count(SafetyEvent.id).label("count"))
            .where(SafetyEvent.created_at > cutoff)
            .group_by(SafetyEvent.event_type)
        )
        type_result = await db.execute(type_query)
        events_by_type = {row.event_type: row.count for row in type_result}

        # Events by severity
        severity_query = (
            select(SafetyEvent.severity, func.count(SafetyEvent.id).label("count"))
            .where(SafetyEvent.created_at > cutoff)
            .group_by(SafetyEvent.severity)
        )
        severity_result = await db.execute(severity_query)
        events_by_severity = {row.severity: row.count for row in severity_result}

        return {
            "total_events": total_events,
            "events_by_type": events_by_type,
            "events_by_severity": events_by_severity,
            "monitoring_enabled": safety_monitor.enabled,
            "monitor_state": {
                "tracked_aircraft": len(safety_monitor._aircraft_state),
            },
            "time_range_hours": hours
        }

    elif request_type == "system-status":
        # System status (CPU, memory, SDR)
        import psutil

        from app.core import get_settings
        settings = get_settings()

        # Get CPU and memory
        cpu_percent = psutil.cpu_percent(interval=0.1)
        memory = psutil.virtual_memory()

        # SDR temperature (if available via rtl_test or similar)
        # This is a placeholder - actual implementation depends on hardware
        sdr_temp = None  # Would need to query rtl_433 or similar

        # SDR gain from settings
        sdr_gain = getattr(settings, 'sdr_gain', None)

        return {
            "cpu_percent": cpu_percent,
            "memory_percent": memory.percent,
            "memory_used_gb": round(memory.used / (1024**3), 2),
            "memory_total_gb": round(memory.total / (1024**3), 2),
            "sdr_temp": sdr_temp,
            "sdr_gain": sdr_gain,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

    elif request_type == "aircraft-stats":
        # Live aircraft statistics
        from app.core import get_settings, safe_request

        settings = get_settings()

        # Fetch current aircraft data from ultrafeeder
        url = f"{settings.ultrafeeder_url}/data/aircraft.json"
        data = await safe_request(url, timeout=5)

        if not data:
            return {"error": "Unable to fetch aircraft data"}

        aircraft = data.get("aircraft", [])
        total = len(aircraft)
        with_position = sum(1 for ac in aircraft if ac.get("lat") and ac.get("lon"))
        military = sum(1 for ac in aircraft if ac.get("dbFlags", 0) & 1)

        # Altitude distribution
        alt_ground = sum(1 for ac in aircraft if ac.get("alt_baro") is not None and ac.get("alt_baro") <= 0)
        alt_low = sum(1 for ac in aircraft if ac.get("alt_baro") and 0 < ac.get("alt_baro") < 10000)
        alt_medium = sum(1 for ac in aircraft if ac.get("alt_baro") and 10000 <= ac.get("alt_baro") < 30000)
        alt_high = sum(1 for ac in aircraft if ac.get("alt_baro") and ac.get("alt_baro") >= 30000)

        # Emergency squawks
        emergency_squawks = [
            {"hex": ac.get("hex"), "squawk": ac.get("squawk"), "flight": (ac.get("flight") or "").strip()}
            for ac in aircraft
            if ac.get("squawk") in ["7500", "7600", "7700"]
        ]

        # Message count from ultrafeeder
        messages = data.get("messages", 0)

        return {
            "total": total,
            "with_position": with_position,
            "military": military,
            "altitude": {
                "ground": alt_ground,
                "low": alt_low,
                "medium": alt_medium,
                "high": alt_high
            },
            "emergency_squawks": emergency_squawks,
            "messages": messages,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

    elif request_type == "aircraft-top":
        # Top aircraft (closest, fastest, highest)
        from app.core import get_settings, safe_request, calculate_distance_nm, is_valid_position

        settings = get_settings()

        # Fetch current aircraft data
        url = f"{settings.ultrafeeder_url}/data/aircraft.json"
        data = await safe_request(url, timeout=5)

        if not data:
            return {"error": "Unable to fetch aircraft data"}

        aircraft = data.get("aircraft", [])

        # Calculate distances
        for ac in aircraft:
            lat, lon = ac.get("lat"), ac.get("lon")
            if is_valid_position(lat, lon):
                ac["distance_nm"] = round(
                    calculate_distance_nm(settings.feeder_lat, settings.feeder_lon, lat, lon), 1
                )

        # Sort and get top 5 for each category
        with_distance = [ac for ac in aircraft if ac.get("distance_nm") is not None]
        with_speed = [ac for ac in aircraft if ac.get("gs") is not None]
        with_alt = [ac for ac in aircraft if ac.get("alt_baro") is not None]

        def simplify(ac):
            return {
                "hex": ac.get("hex"),
                "flight": (ac.get("flight") or "").strip(),
                "distance_nm": ac.get("distance_nm"),
                "gs": ac.get("gs"),
                "alt": ac.get("alt_baro"),
                "type": ac.get("t"),
                "military": bool(ac.get("dbFlags", 0) & 1)
            }

        closest = [simplify(ac) for ac in sorted(with_distance, key=lambda x: x["distance_nm"])[:5]]
        fastest = [simplify(ac) for ac in sorted(with_speed, key=lambda x: -x["gs"])[:5]]
        highest = [simplify(ac) for ac in sorted(with_alt, key=lambda x: -x["alt_baro"])[:5]]

        return {
            "closest": closest,
            "fastest": fastest,
            "highest": highest,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }

    else:
        return {"error": f"Unknown request type: {request_type}"}
