"""
WebSocket consumer for NOTAM (Notices to Air Missions) updates.

Provides real-time NOTAM and TFR updates to connected clients.
"""
import logging
from datetime import datetime
from channels.db import database_sync_to_async
from django.core.cache import cache
from django.conf import settings
from django.utils import timezone

from .base import BaseConsumer

logger = logging.getLogger(__name__)


class NotamConsumer(BaseConsumer):
    """
    WebSocket consumer for NOTAM updates.

    Supports topics:
    - notams: All NOTAM types
    - tfrs: Only Temporary Flight Restrictions
    - all: All NOTAM updates

    Message types:
    - notams:snapshot - Full list of active NOTAMs
    - notams:new - New NOTAM added
    - notams:update - NOTAM updated
    - notams:expired - NOTAM expired/removed
    - notams:tfr_new - New TFR alert
    - notams:stats - NOTAM statistics update
    """

    group_name_prefix = 'notams'
    supported_topics = ['notams', 'tfrs', 'all']

    async def send_initial_state(self):
        """Send current active NOTAMs to newly connected client."""
        try:
            # Get active NOTAMs from cache or database
            notams = await self._get_active_notams()
            tfrs = await self._get_active_tfrs()
            stats = await self._get_notam_stats()

            await self.send_json({
                'type': 'notams:snapshot',
                'data': {
                    'notams': notams,
                    'tfrs': tfrs,
                    'stats': stats,
                    'timestamp': datetime.utcnow().isoformat() + 'Z'
                }
            })

            logger.debug(f"Sent initial NOTAM state: {len(notams)} NOTAMs, {len(tfrs)} TFRs")

        except Exception as e:
            logger.error(f"Error sending initial NOTAM state: {e}")
            await self.send_json({
                'type': 'error',
                'message': 'Failed to load initial NOTAM data'
            })

    async def handle_request(self, request_type: str, request_id: str, params: dict):
        """Handle NOTAM-specific requests."""
        if request_type == 'notams':
            # Get filtered NOTAMs
            notams = await self._get_active_notams(
                notam_type=params.get('type'),
                location=params.get('location')
            )
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'notams',
                'data': notams
            })

        elif request_type == 'tfrs':
            # Get active TFRs
            tfrs = await self._get_active_tfrs()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'tfrs',
                'data': tfrs
            })

        elif request_type == 'nearby':
            # Get NOTAMs near a location
            lat = params.get('lat')
            lon = params.get('lon')
            radius_nm = params.get('radius_nm', 50)

            if lat is None or lon is None:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing lat/lon parameters'
                })
                return

            notams = await self._get_nearby_notams(lat, lon, radius_nm)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'nearby',
                'data': notams
            })

        elif request_type == 'airport':
            # Get NOTAMs for specific airport
            icao = params.get('icao')
            if not icao:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing icao parameter'
                })
                return

            notams = await self._get_airport_notams(icao.upper())
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'airport',
                'data': notams
            })

        elif request_type == 'stats':
            # Get NOTAM statistics
            stats = await self._get_notam_stats()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'stats',
                'data': stats
            })

        elif request_type == 'refresh':
            # Trigger NOTAM refresh
            await self._trigger_refresh()
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'refresh',
                'data': {'status': 'refresh_triggered'}
            })

        else:
            # Fall back to base handler for system requests
            await super().handle_request(request_type, request_id, params)

    @database_sync_to_async
    def _get_active_notams(self, notam_type=None, location=None):
        """Get active NOTAMs from database."""
        from skyspy.models import CachedNotam

        now = timezone.now()
        queryset = CachedNotam.objects.filter(
            effective_start__lte=now
        ).filter(
            models_Q(effective_end__isnull=True) | models_Q(effective_end__gt=now)
        ).order_by('-effective_start')

        if notam_type:
            queryset = queryset.filter(notam_type=notam_type)

        if location:
            queryset = queryset.filter(location__iexact=location)

        # Limit results
        notams = queryset[:100]

        return [self._serialize_notam(n) for n in notams]

    @database_sync_to_async
    def _get_active_tfrs(self):
        """Get active TFRs."""
        from skyspy.models import CachedNotam

        now = timezone.now()
        tfrs = CachedNotam.objects.filter(
            notam_type='TFR',
            effective_start__lte=now
        ).filter(
            models_Q(effective_end__isnull=True) | models_Q(effective_end__gt=now)
        ).order_by('-effective_start')[:50]

        return [self._serialize_notam(t) for t in tfrs]

    @database_sync_to_async
    def _get_nearby_notams(self, lat, lon, radius_nm):
        """Get NOTAMs near a location."""
        from skyspy.models import CachedNotam
        from math import radians, cos, sin, asin, sqrt

        now = timezone.now()

        # Get all active NOTAMs with coordinates
        notams = CachedNotam.objects.filter(
            effective_start__lte=now,
            latitude__isnull=False,
            longitude__isnull=False
        ).filter(
            models_Q(effective_end__isnull=True) | models_Q(effective_end__gt=now)
        )

        # Filter by distance
        nearby = []
        for notam in notams:
            distance = self._haversine(lat, lon, notam.latitude, notam.longitude)
            if distance <= radius_nm:
                serialized = self._serialize_notam(notam)
                serialized['distance_nm'] = round(distance, 1)
                nearby.append(serialized)

        # Sort by distance
        nearby.sort(key=lambda x: x['distance_nm'])
        return nearby[:50]

    @database_sync_to_async
    def _get_airport_notams(self, icao):
        """Get NOTAMs for a specific airport."""
        from skyspy.models import CachedNotam

        now = timezone.now()
        notams = CachedNotam.objects.filter(
            location__iexact=icao,
            effective_start__lte=now
        ).filter(
            models_Q(effective_end__isnull=True) | models_Q(effective_end__gt=now)
        ).order_by('-effective_start')[:50]

        return [self._serialize_notam(n) for n in notams]

    @database_sync_to_async
    def _get_notam_stats(self):
        """Get NOTAM statistics."""
        from skyspy.models import CachedNotam
        from django.db.models import Count

        now = timezone.now()

        # Active NOTAMs
        active = CachedNotam.objects.filter(
            effective_start__lte=now
        ).filter(
            models_Q(effective_end__isnull=True) | models_Q(effective_end__gt=now)
        )

        # Count by type
        by_type = {}
        for row in active.values('notam_type').annotate(count=Count('id')):
            by_type[row['notam_type']] = row['count']

        # Total count
        total = active.count()

        # TFR count
        tfr_count = by_type.get('TFR', 0)

        # Last update
        last_fetch = CachedNotam.objects.order_by('-fetched_at').first()
        last_update = last_fetch.fetched_at.isoformat() + 'Z' if last_fetch else None

        return {
            'total_active': total,
            'tfr_count': tfr_count,
            'by_type': by_type,
            'last_update': last_update,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    async def _trigger_refresh(self):
        """Trigger NOTAM refresh task."""
        from skyspy.tasks.notams import refresh_notams
        refresh_notams.delay()

    def _serialize_notam(self, notam):
        """Serialize a NOTAM for JSON response."""
        return {
            'id': notam.id,
            'notam_id': notam.notam_id,
            'type': notam.notam_type,
            'classification': notam.classification,
            'location': notam.location,
            'latitude': notam.latitude,
            'longitude': notam.longitude,
            'radius_nm': notam.radius_nm,
            'floor_ft': notam.floor_ft,
            'ceiling_ft': notam.ceiling_ft,
            'effective_start': notam.effective_start.isoformat() + 'Z' if notam.effective_start else None,
            'effective_end': notam.effective_end.isoformat() + 'Z' if notam.effective_end else None,
            'is_permanent': notam.is_permanent,
            'text': notam.text,
            'reason': notam.reason,
            'geometry': notam.geometry,
            'keywords': notam.keywords,
            'fetched_at': notam.fetched_at.isoformat() + 'Z' if notam.fetched_at else None
        }

    def _haversine(self, lat1, lon1, lat2, lon2):
        """Calculate distance between two points in nautical miles."""
        from math import radians, cos, sin, asin, sqrt

        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * asin(sqrt(a))
        # Earth radius in nautical miles
        nm = 3440.065
        return c * nm

    # Group message handlers

    async def notam_update(self, event):
        """Handle NOTAM update broadcast."""
        await self.send_json({
            'type': 'notams:update',
            'data': event['data']
        })

    async def notam_new(self, event):
        """Handle new NOTAM broadcast."""
        await self.send_json({
            'type': 'notams:new',
            'data': event['data']
        })

    async def notam_expired(self, event):
        """Handle expired NOTAM broadcast."""
        await self.send_json({
            'type': 'notams:expired',
            'data': event['data']
        })

    async def tfr_new(self, event):
        """Handle new TFR alert broadcast."""
        await self.send_json({
            'type': 'notams:tfr_new',
            'data': event['data']
        })

    async def tfr_expired(self, event):
        """Handle TFR expiration broadcast."""
        await self.send_json({
            'type': 'notams:tfr_expired',
            'data': event['data']
        })

    async def stats_update(self, event):
        """Handle stats update broadcast."""
        await self.send_json({
            'type': 'notams:stats',
            'data': event['data']
        })


# Helper for Q objects in async context
def models_Q(*args, **kwargs):
    """Create a Django Q object."""
    from django.db.models import Q
    return Q(*args, **kwargs)
