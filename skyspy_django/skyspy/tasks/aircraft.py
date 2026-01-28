"""
Aircraft polling and session management tasks.
"""
import logging
import time
from datetime import datetime, timedelta

import httpx
from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from channels.layers import get_channel_layer

from skyspy.models import AircraftSighting, AircraftSession, AircraftInfo
from skyspy.utils import sync_group_send

logger = logging.getLogger(__name__)

# Track seen aircraft for queuing new lookups
_seen_aircraft: set = set()
_seen_aircraft_max = 10000  # Max size to prevent memory issues

# Track previous aircraft for change detection
_previous_aircraft: dict = {}  # icao -> aircraft data
_previous_count: int = 0


def queue_new_aircraft_for_lookup(aircraft_list: list):
    """
    Check for new aircraft and queue them for background info lookup.

    Maintains a set of seen aircraft to avoid redundant lookups.
    """
    global _seen_aircraft

    # Clear if too large
    if len(_seen_aircraft) > _seen_aircraft_max:
        _seen_aircraft.clear()
        logger.info("Cleared seen aircraft cache")

    new_aircraft = []
    for ac in aircraft_list:
        icao = ac.get('hex', '').upper()
        if not icao or icao.startswith('~'):  # Skip TIS-B
            continue

        if icao not in _seen_aircraft:
            _seen_aircraft.add(icao)
            new_aircraft.append(icao)

    # Queue lookups for new aircraft (batch to reduce task overhead)
    if new_aircraft:
        from skyspy.tasks.external_db import fetch_aircraft_info
        for icao in new_aircraft[:20]:  # Limit batch size
            fetch_aircraft_info.delay(icao)
        logger.debug(f"Queued {len(new_aircraft)} new aircraft for lookup")


def calculate_distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in nautical miles."""
    import math

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    # Earth radius in nautical miles
    r = 3440.065
    return r * c


@shared_task(bind=True, max_retries=0)
def poll_aircraft(self):
    """
    Poll aircraft from ultrafeeder and update cache.

    This task runs every 2 seconds to fetch aircraft positions
    from the ADS-B receiver and broadcast updates.
    """
    start_time = time.time()

    try:
        # Fetch from ultrafeeder
        url = f"{settings.ULTRAFEEDER_URL}/data/aircraft.json"
        response = httpx.get(url, timeout=5.0)
        response.raise_for_status()
        data = response.json()

        aircraft_list = data.get('aircraft', [])
        now_timestamp = data.get('now')
        messages = data.get('messages', 0)

        # Calculate distance for each aircraft
        feeder_lat = settings.FEEDER_LAT
        feeder_lon = settings.FEEDER_LON

        for ac in aircraft_list:
            lat = ac.get('lat')
            lon = ac.get('lon')

            if lat is not None and lon is not None:
                distance = calculate_distance_nm(feeder_lat, feeder_lon, lat, lon)
                ac['distance_nm'] = round(distance, 1)

            # Normalize field names
            ac['hex'] = ac.get('hex', '').upper()
            ac['flight'] = ac.get('flight', '').strip() if ac.get('flight') else None
            ac['alt'] = ac.get('alt_baro') or ac.get('alt_geom')
            ac['gs'] = ac.get('gs')
            ac['vr'] = ac.get('baro_rate') or ac.get('geom_rate')
            ac['military'] = ac.get('dbFlags', 0) & 1 == 1
            ac['emergency'] = ac.get('squawk') in ('7500', '7600', '7700')

        # Update cache
        cache.set('current_aircraft', aircraft_list, timeout=30)
        cache.set('aircraft_timestamp', now_timestamp, timeout=30)
        cache.set('aircraft_messages', messages, timeout=30)
        cache.set('adsb_online', True, timeout=30)
        cache.set('last_aircraft_broadcast', timezone.now().isoformat().replace('+00:00', 'Z'), timeout=60)

        # Queue new aircraft for background info lookup
        try:
            queue_new_aircraft_for_lookup(aircraft_list)
        except Exception as e:
            logger.debug(f"Failed to queue aircraft lookups: {e}")

        # Detect aircraft changes (new/removed)
        global _previous_aircraft, _previous_count
        current_icaos = {ac.get('hex') for ac in aircraft_list if ac.get('hex')}
        previous_icaos = set(_previous_aircraft.keys())

        new_icaos = current_icaos - previous_icaos
        removed_icaos = previous_icaos - current_icaos

        # Build current aircraft lookup
        current_aircraft_map = {ac.get('hex'): ac for ac in aircraft_list if ac.get('hex')}

        # Broadcast to WebSocket clients
        try:
            channel_layer = get_channel_layer()
            timestamp = timezone.now().isoformat().replace('+00:00', 'Z')

            # 1. Broadcast new aircraft events
            if new_icaos:
                new_aircraft = [current_aircraft_map[icao] for icao in new_icaos if icao in current_aircraft_map]
                sync_group_send(
                    channel_layer,
                    'aircraft_aircraft',
                    {
                        'type': 'aircraft_new',
                        'data': {
                            'aircraft': new_aircraft,
                            'count': len(new_aircraft),
                            'timestamp': timestamp
                        }
                    }
                )
                logger.debug(f"Broadcast {len(new_aircraft)} new aircraft")

            # 2. Broadcast removed aircraft events
            if removed_icaos:
                removed_aircraft = [
                    {'hex': icao, 'flight': _previous_aircraft.get(icao, {}).get('flight')}
                    for icao in removed_icaos
                ]
                sync_group_send(
                    channel_layer,
                    'aircraft_aircraft',
                    {
                        'type': 'aircraft_remove',
                        'data': {
                            'aircraft': removed_aircraft,
                            'icaos': list(removed_icaos),
                            'count': len(removed_aircraft),
                            'timestamp': timestamp
                        }
                    }
                )
                logger.debug(f"Broadcast {len(removed_aircraft)} removed aircraft")

            # 3. Broadcast position-only lightweight updates (for map efficiency)
            positions = [
                {
                    'hex': ac.get('hex'),
                    'lat': ac.get('lat'),
                    'lon': ac.get('lon'),
                    'alt': ac.get('alt'),
                    'track': ac.get('track'),
                    'gs': ac.get('gs'),
                    'vr': ac.get('vr'),
                }
                for ac in aircraft_list
                if ac.get('lat') is not None and ac.get('lon') is not None
            ]
            sync_group_send(
                channel_layer,
                'aircraft_aircraft',
                {
                    'type': 'positions_update',
                    'data': {
                        'positions': positions,
                        'count': len(positions),
                        'timestamp': timestamp
                    }
                }
            )

            # 4. Full aircraft update (existing behavior)
            sync_group_send(
                channel_layer,
                'aircraft_aircraft',
                {
                    'type': 'aircraft_update',
                    'data': {
                        'aircraft': aircraft_list,
                        'count': len(aircraft_list),
                        'timestamp': timestamp
                    }
                }
            )
        except Exception as e:
            logger.warning(f"Failed to broadcast aircraft update: {e}")

        # Update previous aircraft state for next poll
        _previous_aircraft = current_aircraft_map
        _previous_count = len(aircraft_list)

        elapsed = time.time() - start_time
        logger.debug(f"Polled {len(aircraft_list)} aircraft in {elapsed:.2f}s")

    except httpx.HTTPError as e:
        logger.error(f"Failed to poll aircraft: {e}")
        cache.set('adsb_online', False, timeout=30)
        # Capture to Sentry for HTTP errors (connection issues)
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'poll_aircraft', extra={'url': f"{settings.ULTRAFEEDER_URL}/data/aircraft.json"})
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")
    except Exception as e:
        logger.exception(f"Error in poll_aircraft: {e}")
        # Capture unexpected errors to Sentry
        try:
            from skyspy.utils.sentry import capture_task_error
            capture_task_error(e, 'poll_aircraft')
        except Exception as sentry_err:
            logger.debug(f"Could not report to Sentry: {sentry_err}")


@shared_task
def cleanup_sessions():
    """
    Clean up stale aircraft sessions.

    Marks sessions as complete when aircraft haven't been seen
    for the session timeout period.
    """
    timeout_minutes = settings.SESSION_TIMEOUT_MINUTES
    cutoff = timezone.now() - timedelta(minutes=timeout_minutes)

    # Find stale sessions (last_seen older than cutoff)
    stale_count = AircraftSession.objects.filter(
        last_seen__lt=cutoff
    ).count()

    logger.info(f"Found {stale_count} stale sessions (older than {timeout_minutes}min)")

    # Note: In the original system, sessions are kept but not updated
    # We could delete very old sessions if needed


@shared_task
def store_aircraft_sightings(aircraft_data: list):
    """
    Store aircraft sightings to database.

    This task is called periodically to batch-insert sightings.
    """
    if not aircraft_data:
        return

    with transaction.atomic():
        sightings = []
        for ac in aircraft_data:
            # Only store aircraft with valid position
            if ac.get('lat') is None or ac.get('lon') is None:
                continue

            sighting = AircraftSighting(
                icao_hex=ac.get('hex', '').upper(),
                callsign=ac.get('flight'),
                squawk=ac.get('squawk'),
                latitude=ac.get('lat'),
                longitude=ac.get('lon'),
                altitude_baro=ac.get('alt_baro'),
                altitude_geom=ac.get('alt_geom'),
                ground_speed=ac.get('gs'),
                track=ac.get('track'),
                vertical_rate=ac.get('baro_rate') or ac.get('geom_rate'),
                distance_nm=ac.get('distance_nm'),
                rssi=ac.get('rssi'),
                category=ac.get('category'),
                aircraft_type=ac.get('t'),
                is_military=ac.get('military', False),
                is_emergency=ac.get('emergency', False),
                source='1090',
            )
            sightings.append(sighting)

        if sightings:
            AircraftSighting.objects.bulk_create(sightings)
            logger.debug(f"Stored {len(sightings)} sightings")


@shared_task
def update_aircraft_sessions(aircraft_data: list):
    """
    Update or create aircraft tracking sessions.
    """
    if not aircraft_data:
        return

    now = timezone.now()
    session_cutoff = now - timedelta(minutes=5)  # 5 min session gap

    with transaction.atomic():
        for ac in aircraft_data:
            icao = ac.get('hex', '').upper()
            if not icao:
                continue

            # Find or create session
            session = AircraftSession.objects.filter(
                icao_hex=icao,
                last_seen__gte=session_cutoff
            ).first()

            alt = ac.get('alt_baro') or ac.get('alt_geom')
            distance = ac.get('distance_nm')
            vr = ac.get('baro_rate') or ac.get('geom_rate')
            rssi = ac.get('rssi')

            if session:
                # Update existing session
                session.callsign = ac.get('flight') or session.callsign
                session.last_seen = now
                session.total_positions += 1

                if alt is not None:
                    session.min_altitude = min(session.min_altitude or alt, alt)
                    session.max_altitude = max(session.max_altitude or alt, alt)

                if distance is not None:
                    session.min_distance_nm = min(session.min_distance_nm or distance, distance)
                    session.max_distance_nm = max(session.max_distance_nm or distance, distance)

                if vr is not None:
                    session.max_vertical_rate = max(
                        abs(session.max_vertical_rate or 0),
                        abs(vr)
                    )

                if rssi is not None:
                    session.min_rssi = min(session.min_rssi or rssi, rssi)
                    session.max_rssi = max(session.max_rssi or rssi, rssi)

                session.save()
            else:
                # Create new session
                AircraftSession.objects.create(
                    icao_hex=icao,
                    callsign=ac.get('flight'),
                    first_seen=now,
                    last_seen=now,
                    total_positions=1,
                    min_altitude=alt,
                    max_altitude=alt,
                    min_distance_nm=distance,
                    max_distance_nm=distance,
                    max_vertical_rate=abs(vr) if vr else None,
                    min_rssi=rssi,
                    max_rssi=rssi,
                    is_military=ac.get('military', False),
                    category=ac.get('category'),
                    aircraft_type=ac.get('t'),
                )


@shared_task
def update_stats_cache():
    """
    Update cached statistics for quick retrieval.
    """
    from django.db.models import Count, Avg, Max

    # Get current aircraft from cache
    aircraft_list = cache.get('current_aircraft', [])

    # Calculate stats
    stats = {
        'total': len(aircraft_list),
        'with_position': sum(
            1 for ac in aircraft_list
            if ac.get('lat') is not None
        ),
        'military': sum(1 for ac in aircraft_list if ac.get('military')),
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    }

    cache.set('aircraft_stats', stats, timeout=120)
    cache.set('celery_heartbeat', True, timeout=120)

    logger.debug(f"Updated stats cache: {stats['total']} aircraft")


@shared_task
def update_safety_stats():
    """
    Update cached safety statistics.
    """
    from skyspy.models import SafetyEvent
    from django.db.models import Count

    cutoff = timezone.now() - timedelta(hours=24)

    events = SafetyEvent.objects.filter(timestamp__gte=cutoff)

    by_type = dict(events.values_list('event_type').annotate(count=Count('id')))
    by_severity = dict(events.values_list('severity').annotate(count=Count('id')))

    stats = {
        'total_24h': events.count(),
        'by_type': by_type,
        'by_severity': by_severity,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    }

    cache.set('safety_stats', stats, timeout=60)
    logger.debug(f"Updated safety stats: {stats['total_24h']} events in 24h")
