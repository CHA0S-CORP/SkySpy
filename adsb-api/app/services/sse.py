"""
Server-Sent Events (SSE) management with optional Redis pub/sub support.
"""
import asyncio
import json
import logging
import os
import threading
import time
from datetime import datetime
from typing import Optional

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


class SSEManager:
    """Base SSE Manager - in-memory only (single worker)."""
    
    def __init__(self):
        self._subscribers: list[asyncio.Queue] = []
        self._lock = asyncio.Lock()
        self._last_aircraft_state: dict = {}
        self._using_redis = False
        self._last_publish_time: Optional[float] = None
    
    async def subscribe(self) -> asyncio.Queue:
        """Add a new subscriber and return their queue."""
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subscribers.append(q)
            logger.info(f"SSE subscriber added. Total: {len(self._subscribers)}")
        return q
    
    async def unsubscribe(self, q: asyncio.Queue):
        """Remove a subscriber."""
        async with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)
                logger.info(f"SSE subscriber removed. Total: {len(self._subscribers)}")
    
    async def broadcast(self, event_type: str, data: dict):
        """Send event to all subscribers."""
        message = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        self._last_publish_time = time.time()
        await self._deliver_to_subscribers(message)
    
    async def _deliver_to_subscribers(self, message: str):
        """Deliver message to local subscribers."""
        dead_queues = []
        
        async with self._lock:
            for q in self._subscribers:
                try:
                    q.put_nowait(message)
                except asyncio.QueueFull:
                    # Try to drop oldest message
                    try:
                        q.get_nowait()
                        q.put_nowait(message)
                    except (asyncio.QueueEmpty, asyncio.QueueFull):
                        dead_queues.append(q)
            
            for q in dead_queues:
                self._subscribers.remove(q)
                logger.warning(f"Removed dead SSE subscriber. Total: {len(self._subscribers)}")
    
    async def get_subscriber_count(self) -> int:
        """Get number of subscribers."""
        async with self._lock:
            return len(self._subscribers)
    
    def get_subscriber_count_sync(self) -> int:
        """Synchronous version for non-async contexts."""
        return len(self._subscribers)
    
    def is_using_redis(self) -> bool:
        """Check if using Redis."""
        return self._using_redis
    
    def get_last_publish_time(self) -> Optional[str]:
        """Get ISO timestamp of last publish."""
        if self._last_publish_time:
            return datetime.utcfromtimestamp(self._last_publish_time).isoformat() + "Z"
        return None
    
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
            await self.broadcast("aircraft_new", {
                "aircraft": [self._simplify_for_sse(ac) for ac in new_aircraft],
                "timestamp": timestamp
            })
        
        if updated_aircraft:
            await self.broadcast("aircraft_update", {
                "aircraft": [self._simplify_for_sse(ac) for ac in updated_aircraft],
                "timestamp": timestamp
            })
        
        if removed_icaos:
            await self.broadcast("aircraft_remove", {
                "icaos": removed_icaos,
                "timestamp": timestamp
            })
        
        await self.broadcast("heartbeat", {
            "count": len(current_state),
            "timestamp": timestamp
        })
    
    async def publish_alert_triggered(
        self, rule_id: int, rule_name: str, icao: str,
        callsign: str, message: str, priority: str, aircraft_data: dict
    ):
        """Publish alert_triggered SSE event."""
        await self.broadcast("alert_triggered", {
            "rule_id": rule_id,
            "rule_name": rule_name,
            "icao": icao,
            "callsign": callsign,
            "message": message,
            "priority": priority,
            "aircraft_data": aircraft_data
        })
    
    async def publish_safety_event(self, event: dict):
        """Publish safety_event SSE event."""
        await self.broadcast("safety_event", {
            "event_type": event["event_type"],
            "severity": event["severity"],
            "icao": event["icao"],
            "icao_2": event.get("icao_2"),
            "callsign": event.get("callsign"),
            "callsign_2": event.get("callsign_2"),
            "message": event["message"],
            "details": event.get("details", {}),
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })
    
    async def publish_acars_message(self, msg: dict):
        """Publish acars_message SSE event."""
        await self.broadcast("acars_message", {
            "source": msg.get("source", "acars"),
            "icao_hex": msg.get("icao_hex"),
            "registration": msg.get("registration"),
            "callsign": msg.get("callsign"),
            "label": msg.get("label"),
            "text": msg.get("text"),
            "frequency": msg.get("frequency"),
            "signal_level": msg.get("signal_level"),
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })
    
    def _has_significant_change(self, old: dict, new: dict) -> bool:
        """Check if aircraft has changed significantly."""
        # Position change > 0.001 degrees (~100m)
        if old.get("lat") and new.get("lat"):
            if abs(old.get("lat", 0) - new.get("lat", 0)) > 0.001:
                return True
            if abs(old.get("lon", 0) - new.get("lon", 0)) > 0.001:
                return True
        
        # Altitude change > 100ft
        old_alt = old.get("alt_baro") if isinstance(old.get("alt_baro"), int) else 0
        new_alt = new.get("alt_baro") if isinstance(new.get("alt_baro"), int) else 0
        if abs(old_alt - new_alt) > 100:
            return True
        
        # Track change > 5 degrees (with wraparound)
        if old.get("track") is not None and new.get("track") is not None:
            track_diff = abs(old.get("track", 0) - new.get("track", 0))
            track_diff = min(track_diff, 360 - track_diff)
            if track_diff > 5:
                return True
        
        # Squawk change
        if old.get("squawk") != new.get("squawk"):
            return True
        
        return False
    
    def _simplify_for_sse(self, ac: dict) -> dict:
        """Simplify aircraft data for SSE transmission."""
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
    
    def get_history_stats(self) -> dict:
        """Get history stats (only meaningful with Redis)."""
        return {"available": False}


class RedisSSEManager(SSEManager):
    """Redis-backed SSE Manager for multi-worker deployments."""
    
    CHANNEL = "adsb:sse:events"
    STATE_KEY = "adsb:sse:aircraft_state"
    HISTORY_KEY = "adsb:sse:history"
    SUBSCRIBERS_KEY = "adsb:sse:subscribers"
    LAST_PUBLISH_KEY = "adsb:sse:last_publish"
    HISTORY_TTL = 12 * 60 * 60  # 12 hours
    
    def __init__(self, redis_url: str):
        super().__init__()
        self._using_redis = True
        self._redis_url = redis_url
        self._redis: Optional[aioredis.Redis] = None
        self._pubsub = None
        self._listener_task: Optional[asyncio.Task] = None
        self._running = False
        self._worker_id = f"{os.getpid()}:{id(self)}"
    
    async def connect(self):
        """Connect to Redis."""
        try:
            self._redis = aioredis.from_url(self._redis_url, decode_responses=True)
            await self._redis.ping()
            logger.info(f"Connected to Redis at {self._redis_url}")
            
            # Load last aircraft state
            try:
                state_json = await self._redis.get(self.STATE_KEY)
                if state_json:
                    self._last_aircraft_state = json.loads(state_json)
                    logger.info(f"Loaded {len(self._last_aircraft_state)} aircraft from Redis")
            except Exception as e:
                logger.warning(f"Could not load aircraft state from Redis: {e}")
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
        await self._pubsub.subscribe(self.CHANNEL)
        self._listener_task = asyncio.create_task(self._listen_loop())
        logger.info(f"Redis SSE listener started (pid={os.getpid()})")
    
    async def _listen_loop(self):
        """Listen for messages on Redis pub/sub channel."""
        try:
            async for message in self._pubsub.listen():
                if not self._running:
                    break
                
                if message["type"] == "message":
                    await self._deliver_to_subscribers(message["data"])
        except Exception as e:
            if self._running:
                logger.error(f"Redis listener error: {e}")
    
    async def broadcast(self, event_type: str, data: dict):
        """Publish event via Redis pub/sub."""
        message = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        timestamp = time.time()
        self._last_publish_time = timestamp
        
        if self._redis:
            try:
                history_entry = json.dumps({
                    "event": event_type,
                    "data": data,
                    "timestamp": timestamp
                })
                
                pipe = self._redis.pipeline()
                pipe.zadd(self.HISTORY_KEY, {history_entry: timestamp})
                pipe.zremrangebyscore(self.HISTORY_KEY, "-inf", timestamp - self.HISTORY_TTL)
                pipe.set(self.LAST_PUBLISH_KEY, timestamp)
                pipe.publish(self.CHANNEL, message)
                await pipe.execute()
            except Exception as e:
                logger.warning(f"Redis publish failed: {e}")
                await self._deliver_to_subscribers(message)
        else:
            await self._deliver_to_subscribers(message)
    
    async def get_history_since(self, start_timestamp: float) -> list[dict]:
        """Get all events since the given timestamp."""
        if not self._redis:
            return []
        
        try:
            entries = await self._redis.zrangebyscore(
                self.HISTORY_KEY, start_timestamp, "+inf"
            )
            events = []
            for entry in entries:
                try:
                    events.append(json.loads(entry))
                except json.JSONDecodeError:
                    continue
            return events
        except Exception as e:
            logger.error(f"Failed to get history from Redis: {e}")
            return []
    
    def get_history_stats(self) -> dict:
        """Get statistics about event history."""
        # This needs to be async in practice
        return {"available": True, "note": "Use async version"}
    
    async def get_history_stats_async(self) -> dict:
        """Get statistics about event history (async version)."""
        if not self._redis:
            return {"available": False}
        
        try:
            count = await self._redis.zcard(self.HISTORY_KEY)
            oldest = await self._redis.zrange(self.HISTORY_KEY, 0, 0, withscores=True)
            newest = await self._redis.zrange(self.HISTORY_KEY, -1, -1, withscores=True)
            
            oldest_ts = oldest[0][1] if oldest else None
            newest_ts = newest[0][1] if newest else None
            
            return {
                "available": True,
                "event_count": count,
                "oldest_timestamp": (
                    datetime.utcfromtimestamp(oldest_ts).isoformat() + "Z" 
                    if oldest_ts else None
                ),
                "newest_timestamp": (
                    datetime.utcfromtimestamp(newest_ts).isoformat() + "Z" 
                    if newest_ts else None
                ),
                "retention_hours": self.HISTORY_TTL / 3600
            }
        except Exception as e:
            logger.error(f"Failed to get history stats: {e}")
            return {"available": False, "error": str(e)}
    
    async def stop(self):
        """Stop the listener."""
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


# Global SSE manager instance
_sse_manager: Optional[SSEManager] = None


async def create_sse_manager() -> SSEManager:
    """Factory function to create the appropriate SSE manager."""
    global _sse_manager
    
    if settings.redis_url and REDIS_AVAILABLE:
        try:
            manager = RedisSSEManager(settings.redis_url)
            await manager.connect()
            if manager.is_using_redis():
                await manager.start_listener()
                logger.info("Using Redis-backed SSE manager")
                _sse_manager = manager
                return manager
        except Exception as e:
            logger.warning(f"Failed to create Redis SSE manager: {e}")
    
    if settings.redis_url and not REDIS_AVAILABLE:
        logger.warning("REDIS_URL set but redis-py not installed")
    
    logger.info("Using in-memory SSE manager (single worker)")
    _sse_manager = SSEManager()
    return _sse_manager


def get_sse_manager() -> SSEManager:
    """Get the global SSE manager instance."""
    global _sse_manager
    if _sse_manager is None:
        _sse_manager = SSEManager()
    return _sse_manager


async def check_redis_health() -> bool:
    """Check if Redis is healthy."""
    if not settings.redis_url or not REDIS_AVAILABLE:
        return False
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        await r.ping()
        await r.close()
        return True
    except Exception:
        return False
