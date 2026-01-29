"""
Base WebSocket consumer with common functionality.

Includes RPi optimizations:
- Message batching: Collects messages and sends in batches
- Rate limiting: Per-topic rate limits to reduce bandwidth
- Delta updates: Only send changed fields (in subclasses)
"""
import asyncio
import json
import logging
import os
import time
from collections import deque
from datetime import datetime
from typing import Optional
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from asgiref.sync import sync_to_async
from django.core.cache import cache
from django.conf import settings

logger = logging.getLogger(__name__)


# =============================================================================
# Rate Limiting Configuration
# =============================================================================

def _get_rate_limits():
    """Get rate limits from settings or use defaults."""
    return getattr(settings, 'WS_RATE_LIMITS', {
        'aircraft:update': 10,  # Max 10 Hz
        'aircraft:position': 5,  # Max 5 Hz
        'aircraft:delta': 10,  # Max 10 Hz
        'stats:update': 0.5,  # Max 0.5 Hz (2 second minimum)
        'default': 5,  # Default rate limit
    })


def _get_batch_config():
    """Get batching configuration from settings or use defaults."""
    return {
        'window_ms': getattr(settings, 'WS_BATCH_WINDOW_MS', 200),
        'max_size': getattr(settings, 'WS_MAX_BATCH_SIZE', 50),
        'immediate_types': getattr(settings, 'WS_IMMEDIATE_TYPES', ['alert', 'safety', 'emergency']),
    }


class RateLimiter:
    """Per-topic rate limiter for WebSocket messages."""

    def __init__(self):
        self._last_send: dict[str, float] = {}
        self._rate_limits = _get_rate_limits()

    def can_send(self, topic: str) -> bool:
        """Check if a message for this topic can be sent."""
        now = time.time()
        rate_limit = self._rate_limits.get(topic, self._rate_limits.get('default', 5))

        if rate_limit <= 0:
            return True  # No limit

        min_interval = 1.0 / rate_limit
        last_send = self._last_send.get(topic, 0)

        if now - last_send >= min_interval:
            self._last_send[topic] = now
            return True
        return False

    def get_wait_time(self, topic: str) -> float:
        """Get time to wait before next send is allowed."""
        now = time.time()
        rate_limit = self._rate_limits.get(topic, self._rate_limits.get('default', 5))

        if rate_limit <= 0:
            return 0

        min_interval = 1.0 / rate_limit
        last_send = self._last_send.get(topic, 0)
        wait = min_interval - (now - last_send)
        return max(0, wait)


class MessageBatcher:
    """Batches messages for efficient sending."""

    def __init__(self, send_callback):
        self._batch: deque = deque()
        self._send_callback = send_callback
        self._batch_task: Optional[asyncio.Task] = None
        self._config = _get_batch_config()
        self._lock = asyncio.Lock()

    async def add(self, message: dict):
        """Add a message to the batch."""
        msg_type = message.get('type', '')

        # Check if this message type should be sent immediately
        for immediate_type in self._config['immediate_types']:
            if immediate_type in msg_type:
                await self._send_callback(message)
                return

        async with self._lock:
            self._batch.append(message)

            # Start batch timer if not running
            if self._batch_task is None or self._batch_task.done():
                self._batch_task = asyncio.create_task(self._flush_after_delay())

            # Flush immediately if batch is full
            if len(self._batch) >= self._config['max_size']:
                if self._batch_task and not self._batch_task.done():
                    self._batch_task.cancel()
                await self._flush()

    async def _flush_after_delay(self):
        """Wait for batch window then flush."""
        try:
            await asyncio.sleep(self._config['window_ms'] / 1000.0)
            await self._flush()
        except asyncio.CancelledError:
            pass

    async def _flush(self):
        """Send all batched messages."""
        async with self._lock:
            if not self._batch:
                return

            # Group messages by type for combined sending
            messages = list(self._batch)
            self._batch.clear()

        if len(messages) == 1:
            # Single message, send directly
            await self._send_callback(messages[0])
        else:
            # Multiple messages, send as batch
            await self._send_callback({
                'type': 'batch',
                'messages': messages,
                'count': len(messages),
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            })

    async def flush_now(self):
        """Force flush any pending messages."""
        if self._batch_task and not self._batch_task.done():
            self._batch_task.cancel()
        await self._flush()


class BaseConsumer(AsyncJsonWebsocketConsumer):
    """
    Base WebSocket consumer providing common functionality.

    Supports:
    - Room-based subscriptions via channel groups
    - JSON message format
    - Ping/pong heartbeat
    - Error handling
    - Rate limiting (RPi optimization)
    - Message batching (RPi optimization)
    """

    # Override in subclasses
    group_name_prefix = 'base'
    supported_topics = ['all']

    # Rate limiting and batching (set to True to enable)
    enable_rate_limiting = True
    enable_batching = False  # Disabled by default, enable in high-traffic consumers

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Initialize rate limiter and batcher to None (set up in connect)
        self._rate_limiter = None
        self._message_batcher = None
        self.subscribed_topics = set()

    async def connect(self):
        """Handle WebSocket connection."""
        # Accept the connection
        await self.accept()

        # Initialize rate limiter and batcher (RPi optimizations)
        if self.enable_rate_limiting:
            self._rate_limiter = RateLimiter()
        else:
            self._rate_limiter = None

        if self.enable_batching:
            self._message_batcher = MessageBatcher(self._send_json_direct)
        else:
            self._message_batcher = None

        # Parse query parameters for initial topics
        query_string = self.scope.get('query_string', b'').decode()
        topics = self._parse_topics(query_string)

        if not topics:
            topics = ['all']

        # Join topic groups
        await self._join_topics(topics)

        # Store subscribed topics
        self.subscribed_topics = set(topics)

        logger.info(f"WebSocket connected: {self.channel_name}, topics: {topics}")

        # Send initial state
        await self.send_initial_state()

    async def disconnect(self, close_code):
        """Handle WebSocket disconnection."""
        # Flush any pending batched messages
        if hasattr(self, '_message_batcher') and self._message_batcher:
            try:
                await self._message_batcher.flush_now()
            except Exception as e:
                logger.debug(f"Error flushing message batch: {e}")

        # Leave all groups - copy the set to avoid modification during iteration
        for topic in list(getattr(self, 'subscribed_topics', [])):
            group_name = f"{self.group_name_prefix}_{topic}"
            try:
                await self.channel_layer.group_discard(group_name, self.channel_name)
            except Exception as e:
                logger.warning(f"Error leaving group {group_name}: {e}")

        logger.info(f"WebSocket disconnected: {self.channel_name}, code: {close_code}")

    async def receive(self, text_data=None, bytes_data=None):
        """Handle incoming WebSocket messages with JSON error handling."""
        if text_data:
            try:
                content = json.loads(text_data)
                await self.receive_json(content)
            except json.JSONDecodeError as e:
                logger.warning(f"Invalid JSON received: {e}")
                try:
                    await self.send_json({
                        'type': 'error',
                        'message': f'Invalid JSON: {str(e)}'
                    })
                except Exception:
                    pass  # Connection may be closed
            except Exception as e:
                # Catch any other exceptions to prevent consumer crash
                logger.exception(f"Error processing message: {e}")
                try:
                    await self.send_json({
                        'type': 'error',
                        'message': f'Internal error: {str(e)}'
                    })
                except Exception:
                    pass  # Connection may be closed
        elif bytes_data:
            # Binary data not supported
            try:
                await self.send_json({
                    'type': 'error',
                    'message': 'Binary data not supported'
                })
            except Exception:
                pass  # Connection may be closed

    async def receive_json(self, content):
        """Handle incoming JSON messages."""
        action = content.get('action')

        if action == 'subscribe':
            topics = content.get('topics', [])
            if isinstance(topics, str):
                topics = [topics]
            await self._join_topics(topics)
            await self.send_json({
                'type': 'subscribed',
                'topics': list(self.subscribed_topics)
            })

        elif action == 'unsubscribe':
            topics = content.get('topics', [])
            if isinstance(topics, str):
                topics = [topics]
            await self._leave_topics(topics)
            await self.send_json({
                'type': 'unsubscribed',
                'topics': topics
            })

        elif action == 'ping':
            await self.send_json({'type': 'pong'})

        elif action == 'request':
            # Handle request/response pattern
            request_type = content.get('type')
            request_id = content.get('request_id')
            params = content.get('params', {})
            await self.handle_request(request_type, request_id, params)

        else:
            await self.send_json({
                'type': 'error',
                'message': f'Unknown action: {action}'
            })

    async def handle_request(self, request_type: str, request_id: str, params: dict):
        """
        Handle a request/response message.
        Override in subclasses for specific request types.
        """
        # System-wide request handlers available from any consumer
        if request_type == 'status':
            status = await self.get_system_status()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'status',
                'data': status
            })

        elif request_type == 'health' or request_type == 'system-health':
            health = await self.get_health_status()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': request_type,
                'data': health
            })

        elif request_type == 'system-info':
            info = await self.get_system_info()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'system-info',
                'data': info
            })

        elif request_type == 'system-databases':
            db_stats = await self.get_database_stats()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'system-databases',
                'data': db_stats
            })

        elif request_type == 'system-status':
            status = await self.get_detailed_system_status()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'system-status',
                'data': status
            })

        elif request_type == 'ws-status':
            ws_status = await self.get_ws_status()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'ws-status',
                'data': ws_status
            })

        elif request_type == 'safety-status':
            safety_status = await self.get_safety_status()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'safety-status',
                'data': safety_status
            })

        elif request_type == 'acars-status':
            acars_status = await self.get_acars_status()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'acars-status',
                'data': acars_status
            })

        elif request_type == 'metars':
            metars_data = await self.get_metars(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'metars',
                'data': metars_data
            })

        elif request_type == 'pireps':
            pireps_data = await self.get_pireps(params)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'pireps',
                'data': pireps_data
            })

        else:
            await self.send_json({
                'type': 'error',
                'request_id': request_id,
                'message': f'Unknown request type: {request_type}'
            })

    @sync_to_async
    def get_system_status(self):
        """Get basic system status (cache-only, no DB)."""
        aircraft_list = cache.get('current_aircraft', [])
        adsb_online = cache.get('adsb_online', False)
        celery_ok = cache.get('celery_heartbeat', False)

        return {
            'online': adsb_online,
            'aircraft_count': len(aircraft_list),
            'celery_running': celery_ok,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @database_sync_to_async
    def get_health_status(self):
        """Get service health checks."""
        from django.db import connection

        health = {
            'status': 'healthy',
            'services': {}
        }

        # Database
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            health['services']['database'] = {'status': 'up'}
        except Exception as e:
            health['services']['database'] = {'status': 'down', 'error': str(e)}
            health['status'] = 'unhealthy'

        # ADS-B receiver
        adsb_online = cache.get('adsb_online', False)
        health['services']['adsb'] = {
            'status': 'up' if adsb_online else 'down'
        }

        # Celery
        celery_ok = cache.get('celery_heartbeat', False)
        health['services']['celery'] = {
            'status': 'up' if celery_ok else 'unknown'
        }

        # Redis/Cache
        try:
            cache.set('_health_check', True, timeout=5)
            cache.get('_health_check')
            health['services']['cache'] = {'status': 'up'}
        except Exception as e:
            health['services']['cache'] = {'status': 'down', 'error': str(e)}
            health['status'] = 'degraded'

        health['timestamp'] = datetime.utcnow().isoformat() + 'Z'
        return health

    @database_sync_to_async
    def get_detailed_system_status(self):
        """Get detailed system status."""
        from skyspy.models import AircraftSighting, SafetyEvent, AcarsMessage

        aircraft_list = cache.get('current_aircraft', [])

        # Get counts
        from django.utils import timezone
        from datetime import timedelta
        cutoff_24h = timezone.now() - timedelta(hours=24)

        sighting_count = AircraftSighting.objects.filter(timestamp__gte=cutoff_24h).count()
        safety_count = SafetyEvent.objects.filter(timestamp__gte=cutoff_24h).count()
        acars_count = AcarsMessage.objects.filter(timestamp__gte=cutoff_24h).count()

        return {
            'aircraft': {
                'current': len(aircraft_list),
                'military': sum(1 for ac in aircraft_list if ac.get('military')),
                'emergency': sum(1 for ac in aircraft_list if ac.get('emergency')),
            },
            'last_24h': {
                'sightings': sighting_count,
                'safety_events': safety_count,
                'acars_messages': acars_count,
            },
            'receiver': {
                'online': cache.get('adsb_online', False),
                'messages': cache.get('aircraft_messages', 0),
            },
            'feeder': {
                'latitude': settings.FEEDER_LAT,
                'longitude': settings.FEEDER_LON,
            },
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    async def get_ws_status(self):
        """Get WebSocket service status (no I/O needed)."""
        return {
            'consumer': self.group_name_prefix,
            'channel_name': self.channel_name,
            'subscribed_topics': list(getattr(self, 'subscribed_topics', [])),
            'supported_topics': self.supported_topics,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @database_sync_to_async
    def get_safety_status(self):
        """Get safety monitoring status."""
        from skyspy.models import SafetyEvent
        from django.utils import timezone
        from datetime import timedelta

        cutoff = timezone.now() - timedelta(hours=24)
        recent = SafetyEvent.objects.filter(timestamp__gte=cutoff)

        # Use single aggregation query instead of N+1 queries
        from django.db.models import Count
        by_type = dict(
            recent.values('event_type')
            .annotate(count=Count('id'))
            .values_list('event_type', 'count')
        )

        active = SafetyEvent.objects.filter(
            timestamp__gte=timezone.now() - timedelta(minutes=5),
            acknowledged=False
        ).count()

        return {
            'enabled': getattr(settings, 'SAFETY_MONITORING_ENABLED', True),
            'active_events': active,
            'last_24h': recent.count(),
            'by_type': by_type,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @database_sync_to_async
    def get_acars_status(self):
        """Get ACARS service status."""
        from skyspy.models import AcarsMessage
        from django.utils import timezone
        from datetime import timedelta
        from django.db.models import Count

        cutoff = timezone.now() - timedelta(hours=1)
        recent = AcarsMessage.objects.filter(timestamp__gte=cutoff)

        by_source = {}
        for row in recent.values('source').annotate(count=Count('id')):
            by_source[row['source']] = row['count']

        return {
            'enabled': getattr(settings, 'ACARS_ENABLED', True),
            'last_hour_count': recent.count(),
            'by_source': by_source,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @database_sync_to_async
    def get_system_info(self):
        """Get system information."""
        import sys
        import platform

        return {
            'version': getattr(settings, 'VERSION', '1.0.0'),
            'python_version': sys.version,
            'platform': platform.platform(),
            'django_version': __import__('django').get_version(),
            'debug': settings.DEBUG,
            'feeder': {
                'latitude': settings.FEEDER_LAT,
                'longitude': settings.FEEDER_LON,
            },
            'features': {
                'acars_enabled': getattr(settings, 'ACARS_ENABLED', False),
                'safety_monitoring': getattr(settings, 'SAFETY_MONITORING_ENABLED', True),
                'photo_cache': getattr(settings, 'PHOTO_CACHE_ENABLED', False),
                's3_storage': getattr(settings, 'S3_ENABLED', False),
            },
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @database_sync_to_async
    def get_database_stats(self):
        """Get external database statistics."""
        from skyspy.models import AircraftInfo

        # Get counts
        total = AircraftInfo.objects.count()
        with_photos = AircraftInfo.objects.exclude(photo_url__isnull=True).exclude(photo_url='').count()
        military = AircraftInfo.objects.filter(is_military=True).count()
        failed = AircraftInfo.objects.filter(fetch_failed=True).count()

        return {
            'aircraft_info': {
                'total': total,
                'with_photos': with_photos,
                'military': military,
                'failed_lookups': failed,
            },
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    async def get_metars(self, params: dict):
        """Get METAR weather data (no I/O needed - stub)."""
        # METARs would typically come from an external service
        # Return empty data for now - feature not fully implemented
        return {
            'data': [],
            'count': 0,
            'source': 'aviationweather.gov',
            'cached': False,
        }

    @database_sync_to_async
    def get_pireps(self, params: dict):
        """Get PIREP data."""
        from skyspy.models import CachedPirep
        from skyspy.serializers.aviation import CachedPirepSerializer
        from django.utils import timezone
        from datetime import timedelta

        hours = int(params.get('hours', 6))
        cutoff = timezone.now() - timedelta(hours=hours)

        pireps = CachedPirep.objects.filter(
            observation_time__gte=cutoff
        ).order_by('-observation_time')[:100]

        return {
            'data': CachedPirepSerializer(pireps, many=True).data,
            'count': pireps.count(),
            'source': 'aviationweather.gov',
            'cached': True,
        }

    async def send_initial_state(self):
        """
        Send initial state to client on connect.
        Override in subclasses.
        """
        pass

    def _parse_topics(self, query_string: str) -> list:
        """Parse topics from query string."""
        if not query_string:
            return []

        topics = []
        for param in query_string.split('&'):
            if '=' in param:
                key, value = param.split('=', 1)
                if key == 'topics':
                    topics.extend(value.split(','))
        return topics

    async def _join_topics(self, topics: list):
        """Join channel groups for topics."""
        if not hasattr(self, 'subscribed_topics'):
            self.subscribed_topics = set()

        # Handle 'all' topic
        if 'all' in topics:
            topics = self.supported_topics

        for topic in topics:
            if topic in self.supported_topics:
                group_name = f"{self.group_name_prefix}_{topic}"
                await self.channel_layer.group_add(group_name, self.channel_name)
                self.subscribed_topics.add(topic)
                logger.debug(f"Joined group: {group_name}")

    async def _leave_topics(self, topics: list):
        """Leave channel groups for topics."""
        for topic in topics:
            group_name = f"{self.group_name_prefix}_{topic}"
            await self.channel_layer.group_discard(group_name, self.channel_name)
            self.subscribed_topics.discard(topic)
            logger.debug(f"Left group: {group_name}")

    # ==========================================================================
    # Rate-Limited and Batched Send Methods
    # ==========================================================================

    async def _send_json_direct(self, content: dict):
        """Send JSON directly without rate limiting or batching."""
        await super().send_json(content)

    async def send_json(self, content: dict, close: bool = False):
        """
        Send JSON with optional rate limiting and batching.

        Rate limiting: Drops messages that exceed the rate limit for their topic.
        Batching: Collects messages and sends them in batches for efficiency.
        """
        # Extract message type for rate limiting
        msg_type = content.get('type', 'default')

        # Check rate limit if enabled
        if self._rate_limiter and not self._rate_limiter.can_send(msg_type):
            # Message rate limited, skip
            logger.debug(f"Rate limited message: {msg_type}")
            return

        # Use batcher if enabled
        if self._message_batcher:
            await self._message_batcher.add(content)
        else:
            await self._send_json_direct(content)

        if close:
            await self.close()

    async def send_json_immediate(self, content: dict):
        """Send JSON immediately, bypassing rate limiting and batching."""
        await self._send_json_direct(content)

    # Group message handlers - called when messages are sent to groups

    async def broadcast_message(self, event):
        """Handle broadcast message from channel layer."""
        await self.send_json(event['data'])

    async def snapshot(self, event):
        """Handle snapshot message."""
        await self.send_json({
            'type': f'{self.group_name_prefix}:snapshot',
            'data': event['data']
        })

    async def update(self, event):
        """Handle update message."""
        await self.send_json({
            'type': f'{self.group_name_prefix}:update',
            'data': event['data']
        })

    async def new_item(self, event):
        """Handle new item message."""
        await self.send_json({
            'type': f'{self.group_name_prefix}:new',
            'data': event['data']
        })

    async def remove_item(self, event):
        """Handle remove item message."""
        await self.send_json({
            'type': f'{self.group_name_prefix}:remove',
            'data': event['data']
        })
