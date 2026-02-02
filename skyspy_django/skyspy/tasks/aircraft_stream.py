"""
Aircraft streaming task for real-time ADS-B updates.

Supports two streaming modes:
1. SSE (Server-Sent Events) - connects to /v2/sse endpoint (preferred)
2. TCP - connects to readsb's --net-json-port (legacy fallback)

SSE mode is preferred as it:
- Works through HTTP proxies and load balancers
- Has built-in reconnection support
- Is compatible with ADSBexchange format

Architecture for low latency:
- Hot path: normalize -> broadcast (no database, minimal cache)
- Cold path: periodic flush to database (async, non-blocking)
"""
import json
import logging
import socket
import time
from collections import deque
from datetime import datetime
from threading import Lock
from typing import Deque, Dict, List, Optional, Set

import requests
from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from skyspy.socketio.utils import sync_emit

logger = logging.getLogger(__name__)

# ============================================================================
# In-memory buffers (for low-latency operation)
# ============================================================================

# Current aircraft state (hot path - updated on every message)
_aircraft_state: Dict[str, dict] = {}  # icao -> aircraft data
_aircraft_state_lock = Lock()

# Buffer for database writes (cold path - flushed periodically)
_db_write_buffer: Deque[dict] = deque(maxlen=10000)
_db_buffer_lock = Lock()

# Track seen aircraft for info lookups (avoid redundant queries)
_seen_aircraft: Set[str] = set()
_seen_aircraft_lock = Lock()

# Track new aircraft for batch lookup (thread-safe with lock)
_new_aircraft_queue: Deque[str] = deque(maxlen=500)
_new_aircraft_queue_lock = Lock()

# Last state snapshot for change detection (thread-safe with lock)
_previous_icaos: Set[str] = set()
_previous_icaos_lock = Lock()

# Cache keys
CACHE_KEY_AIRCRAFT = 'current_aircraft'
CACHE_KEY_TIMESTAMP = 'aircraft_timestamp'
CACHE_KEY_ONLINE = 'adsb_online'
CACHE_KEY_STREAM_ACTIVE = 'aircraft_stream_active'
CACHE_KEY_LAST_BROADCAST = 'last_aircraft_broadcast'


# ============================================================================
# Hot Path Functions (optimized for latency)
# ============================================================================

def normalize_aircraft_fast(ac: dict, feeder_lat: float, feeder_lon: float) -> dict:
    """
    Fast aircraft normalization with minimal overhead.

    Pre-computed feeder coordinates passed in to avoid settings lookup.
    """
    lat = ac.get('lat')
    lon = ac.get('lon')

    # Distance calculation (inline for speed)
    if lat is not None and lon is not None:
        import math
        lat1_rad = math.radians(feeder_lat)
        lat2_rad = math.radians(lat)
        dlat = math.radians(lat - feeder_lat)
        dlon = math.radians(lon - feeder_lon)
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        ac['distance_nm'] = round(3440.065 * c, 1)

    # Normalize fields (minimal operations)
    hex_val = ac.get('hex', '')
    ac['hex'] = hex_val.upper() if hex_val else ''

    flight = ac.get('flight')
    ac['flight'] = flight.strip() if flight else None

    ac['alt'] = ac.get('alt_baro') or ac.get('alt_geom')
    ac['vr'] = ac.get('baro_rate') or ac.get('geom_rate')
    ac['military'] = (ac.get('dbFlags', 0) & 1) == 1
    ac['emergency'] = ac.get('squawk') in ('7500', '7600', '7700')

    return ac


def broadcast_positions_fast(batch: List[dict], removed: List[str], timestamp: str):
    """
    Fast position-only broadcast for map updates.

    Minimal payload for lowest latency.

    Args:
        batch: List of aircraft with position data
        removed: List of ICAO hex codes that should be removed from map
        timestamp: ISO timestamp string
    """
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
        for ac in batch
        if ac.get('lat') is not None and ac.get('lon') is not None
    ]

    if positions or removed:
        sync_emit(
            'positions:update',
            {
                'positions': positions,
                'removed': removed,
                'count': len(positions),
                'timestamp': timestamp
            },
            room='topic_aircraft'
        )


def broadcast_aircraft_update(batch: List[dict], timestamp: str):
    """
    Broadcast full aircraft update for clients needing complete data.
    """
    sync_emit(
        'aircraft:update',
        {'aircraft': batch, 'count': len(batch), 'timestamp': timestamp, 'stream': True},
        room='topic_aircraft'
    )


def broadcast_new_aircraft(new_aircraft: List[dict], timestamp: str):
    """
    Broadcast new aircraft events.
    """
    if new_aircraft:
        sync_emit(
            'aircraft:new',
            {'aircraft': new_aircraft, 'count': len(new_aircraft), 'timestamp': timestamp},
            room='topic_aircraft'
        )


def broadcast_removed_aircraft(removed_icaos: List[str], timestamp: str):
    """
    Broadcast aircraft removal events.

    Args:
        removed_icaos: List of ICAO hex codes that are no longer tracked
        timestamp: ISO timestamp string
    """
    if removed_icaos:
        sync_emit(
            'aircraft:remove',
            {'icaos': removed_icaos, 'count': len(removed_icaos), 'timestamp': timestamp},
            room='topic_aircraft'
        )


def update_state_and_broadcast(batch: List[dict]):
    """
    Hot path: Update in-memory state and broadcast to clients.

    This is the critical path - no database operations here.
    Thread-safe: Uses locks for all shared state access.
    """
    global _previous_icaos

    if not batch:
        return

    timestamp = timezone.now().isoformat().replace('+00:00', 'Z')

    # Build batch lookup
    batch_by_icao = {ac['hex']: ac for ac in batch if ac.get('hex')}
    current_icaos = set(batch_by_icao.keys())

    # Detect new and removed aircraft (thread-safe read of previous state)
    with _previous_icaos_lock:
        new_icaos = current_icaos - _previous_icaos
        removed_icaos = list(_previous_icaos - current_icaos)

    # Update in-memory aircraft state and detect stale aircraft
    stale_icaos = []
    with _aircraft_state_lock:
        _aircraft_state.update(batch_by_icao)

        # Prune stale aircraft (not seen in 60s)
        # Check all aircraft in state, not just when > 500
        stale_icaos = [
            icao for icao, ac in _aircraft_state.items()
            if ac.get('seen', 0) > 60
        ]
        for icao in stale_icaos:
            _aircraft_state.pop(icao, None)

    # Combine removed aircraft: those not in current batch + stale ones
    all_removed = list(set(removed_icaos + stale_icaos))

    # Queue new aircraft for background lookup (non-blocking, thread-safe)
    if new_icaos:
        with _seen_aircraft_lock:
            truly_new = [icao for icao in new_icaos if icao not in _seen_aircraft]
            _seen_aircraft.update(truly_new)
            # Limit seen set size (atomic clear and update within lock)
            if len(_seen_aircraft) > 10000:
                # Keep the truly_new ones we just added
                _seen_aircraft.clear()
                _seen_aircraft.update(truly_new)

        # Thread-safe queue access
        with _new_aircraft_queue_lock:
            _new_aircraft_queue.extend(truly_new)

    # Broadcast to clients (this is the latency-critical part)
    try:
        # 1. Position updates with removed list (lightest payload, lowest latency)
        broadcast_positions_fast(batch, all_removed, timestamp)

        # 2. Full aircraft update
        broadcast_aircraft_update(batch, timestamp)

        # 3. New aircraft events
        if new_icaos:
            new_aircraft = [batch_by_icao[icao] for icao in new_icaos if icao in batch_by_icao]
            broadcast_new_aircraft(new_aircraft, timestamp)

        # 4. Removed aircraft events (for data hooks)
        if all_removed:
            broadcast_removed_aircraft(all_removed, timestamp)

    except Exception as e:
        logger.warning(f"Broadcast error: {e}")

    # Update previous state for change detection (thread-safe)
    with _previous_icaos_lock:
        _previous_icaos = current_icaos

    # Buffer for database write (non-blocking append)
    with _db_buffer_lock:
        for ac in batch:
            if ac.get('lat') is not None and ac.get('lon') is not None:
                _db_write_buffer.append(ac.copy())


def sync_cache_state():
    """
    Sync in-memory state to Django cache.

    Called periodically, not on every update, to reduce cache overhead.
    """
    with _aircraft_state_lock:
        aircraft_list = list(_aircraft_state.values())

    cache.set_many({
        CACHE_KEY_AIRCRAFT: aircraft_list,
        CACHE_KEY_TIMESTAMP: time.time(),
        CACHE_KEY_ONLINE: True,
        CACHE_KEY_LAST_BROADCAST: timezone.now().isoformat().replace('+00:00', 'Z'),
    }, timeout=30)


# ============================================================================
# Cold Path Functions (async database operations)
# ============================================================================

def _safe_altitude(value):
    """Convert altitude value to number, handling 'ground' string."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        if value.lower() == 'ground':
            return 0
        try:
            return float(value)
        except (ValueError, TypeError):
            return None
    return None


@shared_task(bind=True, max_retries=1, ignore_result=True)
def flush_stream_to_database(self):
    """
    Cold path: Flush buffered aircraft data to database.

    This runs on a separate schedule, not blocking the streaming hot path.
    """
    from django.db import transaction
    from skyspy.models import AircraftSighting

    # Grab all buffered data
    with _db_buffer_lock:
        if not _db_write_buffer:
            return
        # Take a snapshot and clear buffer
        to_write = list(_db_write_buffer)
        _db_write_buffer.clear()

    if not to_write:
        return

    # Batch insert to database
    try:
        with transaction.atomic():
            sightings = []
            for ac in to_write:
                sighting = AircraftSighting(
                    icao_hex=ac.get('hex', '').upper(),
                    callsign=ac.get('flight'),
                    squawk=ac.get('squawk'),
                    latitude=ac.get('lat'),
                    longitude=ac.get('lon'),
                    altitude_baro=_safe_altitude(ac.get('alt_baro')),
                    altitude_geom=_safe_altitude(ac.get('alt_geom')),
                    ground_speed=ac.get('gs'),
                    track=ac.get('track'),
                    vertical_rate=ac.get('baro_rate') or ac.get('geom_rate'),
                    distance_nm=ac.get('distance_nm'),
                    rssi=ac.get('rssi'),
                    category=ac.get('category'),
                    aircraft_type=ac.get('t'),
                    is_military=ac.get('military', False),
                    is_emergency=ac.get('emergency', False),
                    source='stream',
                )
                sightings.append(sighting)

            if sightings:
                AircraftSighting.objects.bulk_create(sightings, ignore_conflicts=True)
                logger.debug(f"Flushed {len(sightings)} stream sightings to database")

    except Exception as e:
        logger.error(f"Failed to flush stream data to database: {e}")
        # Re-queue failed data (up to a limit)
        with _db_buffer_lock:
            for ac in to_write[:1000]:
                _db_write_buffer.append(ac)


@shared_task(bind=True, max_retries=1, ignore_result=True)
def process_new_aircraft_lookups(self):
    """
    Cold path: Process queued new aircraft for info lookups.

    Runs separately from streaming to avoid blocking.
    Thread-safe: Uses lock when accessing the queue.
    """
    from skyspy.tasks.external_db import fetch_aircraft_info

    # Grab queued aircraft (thread-safe)
    to_lookup = []
    with _new_aircraft_queue_lock:
        while _new_aircraft_queue and len(to_lookup) < 20:
            try:
                icao = _new_aircraft_queue.popleft()
                to_lookup.append(icao)
            except IndexError:
                break

    # Queue lookups (these run async)
    for icao in to_lookup:
        try:
            fetch_aircraft_info.delay(icao)
        except Exception as e:
            logger.debug(f"Failed to queue lookup for {icao}: {e}")

    if to_lookup:
        logger.debug(f"Queued {len(to_lookup)} aircraft for info lookup")


# ============================================================================
# SSE Streaming Functions
# ============================================================================

def parse_sse_event(lines: List[str]) -> Optional[dict]:
    """
    Parse an SSE event from accumulated lines.

    SSE format:
        event: aircraft
        data: {"aircraft": [...]}

    Returns the parsed JSON data or None if invalid.
    """
    event_type = None
    data_lines = []

    for line in lines:
        if line.startswith('event:'):
            event_type = line[6:].strip()
        elif line.startswith('data:'):
            data_lines.append(line[5:].strip())
        elif line.startswith('id:'):
            pass  # Ignore event ID for now
        elif line.startswith('retry:'):
            pass  # Ignore retry hints

    if data_lines:
        try:
            data_str = '\n'.join(data_lines)
            return json.loads(data_str)
        except json.JSONDecodeError:
            return None
    return None


def stream_sse(url: str, feeder_lat: float, feeder_lon: float, batch_ms: int):
    """
    Stream aircraft data via SSE (Server-Sent Events).

    Connects to an SSE endpoint and processes aircraft updates.
    This is the preferred streaming method as it works through
    HTTP proxies and has built-in reconnection semantics.
    """
    batch_interval = batch_ms / 1000.0

    logger.info(f"Connecting to SSE stream: {url}")

    try:
        # Use requests with stream=True for SSE
        response = requests.get(
            url,
            stream=True,
            headers={
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache',
            },
            timeout=(10, None),  # 10s connect timeout, no read timeout
        )
        response.raise_for_status()

        logger.info(f"SSE connection established: {url}")
        cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

        batch = []
        last_broadcast = time.time()
        last_cache_sync = time.time()
        last_heartbeat = time.time()
        last_stats_log = time.time()
        cache_sync_interval = 1.0
        stats_log_interval = 30.0

        messages_received = 0
        batches_sent = 0
        sse_lines = []

        # Iterate over SSE stream line by line
        for line in response.iter_lines(decode_unicode=True):
            if line is None:
                continue

            line = line.strip() if line else ''

            # Empty line marks end of SSE event
            if not line:
                if sse_lines:
                    event_data = parse_sse_event(sse_lines)
                    if event_data:
                        # Handle aircraft array in SSE data
                        aircraft_list = event_data.get('aircraft', [])
                        if isinstance(event_data, list):
                            aircraft_list = event_data

                        for ac in aircraft_list:
                            if isinstance(ac, dict) and ac.get('hex'):
                                normalized = normalize_aircraft_fast(ac, feeder_lat, feeder_lon)
                                batch.append(normalized)
                                messages_received += 1

                    sse_lines = []
            else:
                sse_lines.append(line)

            now = time.time()

            # Broadcast when batch interval reached or batch is large enough
            if (now - last_broadcast) >= batch_interval or len(batch) >= 50:
                if batch:
                    update_state_and_broadcast(batch)
                    batches_sent += 1
                    batch = []
                last_broadcast = now

            # Periodic cache sync
            if now - last_cache_sync >= cache_sync_interval:
                sync_cache_state()
                last_cache_sync = now

            # Heartbeat for stream active flag
            if now - last_heartbeat >= 10:
                cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)
                last_heartbeat = now

            # Periodic stats logging
            if now - last_stats_log >= stats_log_interval:
                with _aircraft_state_lock:
                    active_aircraft = len(_aircraft_state)
                logger.info(
                    f"SSE stream stats: {messages_received} messages, {batches_sent} batches, "
                    f"{active_aircraft} active aircraft"
                )
                last_stats_log = now

        logger.info(f"SSE stream ended after {messages_received} messages, {batches_sent} batches")

    except requests.exceptions.Timeout:
        logger.warning(f"SSE connection timed out: {url}")
        raise
    except requests.exceptions.ConnectionError as e:
        logger.warning(f"SSE connection error: {e}")
        raise
    except Exception as e:
        logger.exception(f"SSE stream error: {e}")
        raise


def stream_tcp(host: str, port: int, feeder_lat: float, feeder_lon: float, batch_ms: int):
    """
    Stream aircraft data via raw TCP (NDJSON format).

    This is the legacy method that connects to readsb's --net-json-port.
    Used as fallback when SSE is not available.
    """
    batch_interval = batch_ms / 1000.0

    logger.info(f"Connecting to TCP stream: {host}:{port}")

    # Create TCP socket with optimizations
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 65536)
    sock.settimeout(30.0)
    sock.connect((host, port))

    logger.info(f"TCP connection established: {host}:{port}")
    cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

    sock_file = sock.makefile('r', encoding='utf-8', errors='replace', buffering=8192)

    batch = []
    last_broadcast = time.time()
    last_cache_sync = time.time()
    last_heartbeat = time.time()
    last_stats_log = time.time()
    cache_sync_interval = 1.0
    stats_log_interval = 30.0

    messages_received = 0
    batches_sent = 0

    try:
        for line in sock_file:
            line = line.strip()
            if not line:
                continue

            try:
                aircraft = json.loads(line)
                aircraft = normalize_aircraft_fast(aircraft, feeder_lat, feeder_lon)
                batch.append(aircraft)
                messages_received += 1
            except json.JSONDecodeError:
                continue

            now = time.time()

            # Broadcast when batch interval reached or batch is large enough
            if (now - last_broadcast) >= batch_interval or len(batch) >= 50:
                update_state_and_broadcast(batch)
                batches_sent += 1
                batch = []
                last_broadcast = now

            # Periodic cache sync
            if now - last_cache_sync >= cache_sync_interval:
                sync_cache_state()
                last_cache_sync = now

            # Heartbeat
            if now - last_heartbeat >= 10:
                cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)
                last_heartbeat = now

            # Stats logging
            if now - last_stats_log >= stats_log_interval:
                with _aircraft_state_lock:
                    active_aircraft = len(_aircraft_state)
                logger.info(
                    f"TCP stream stats: {messages_received} messages, {batches_sent} batches, "
                    f"{active_aircraft} active aircraft"
                )
                last_stats_log = now

    finally:
        logger.info(f"TCP stream ended after {messages_received} messages, {batches_sent} batches")
        sock_file.close()
        sock.close()


# ============================================================================
# ADSBexchange API Streaming (Polling)
# ============================================================================

def stream_adsbx(feeder_lat: float, feeder_lon: float, poll_interval: float, radius_nm: int):
    """
    Stream aircraft data from ADSBexchange API via polling.

    ADSBexchange provides unfiltered global aircraft data including
    LADD (privacy) and military aircraft that other services block.

    Args:
        feeder_lat: Center latitude for area search
        feeder_lon: Center longitude for area search
        poll_interval: Seconds between API polls
        radius_nm: Search radius in nautical miles
    """
    from skyspy.services.adsbx_live import (
        _is_enabled,
        _get_api_key,
        _make_request,
        _parse_aircraft,
    )

    if not _is_enabled():
        logger.error("ADSBexchange API not enabled or API key not configured")
        raise ValueError("ADSBexchange API not enabled")

    logger.info(
        f"Starting ADSBexchange stream (lat={feeder_lat}, lon={feeder_lon}, "
        f"radius={radius_nm}nm, interval={poll_interval}s)"
    )

    cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

    last_cache_sync = time.time()
    last_stats_log = time.time()
    cache_sync_interval = 1.0
    stats_log_interval = 30.0

    polls_completed = 0
    total_aircraft = 0

    while True:
        try:
            poll_start = time.time()

            # Fetch aircraft from ADSBexchange API
            endpoint = f'v2/lat/{feeder_lat}/lon/{feeder_lon}/dist/{radius_nm}/'
            result = _make_request(endpoint)

            if result:
                aircraft_list = result.get('ac', [])
                batch = []

                for ac in aircraft_list:
                    parsed = _parse_aircraft(ac)
                    if parsed and parsed.get('latitude') is not None:
                        # Convert ADSBX format to standard stream format
                        normalized = {
                            'hex': parsed.get('icao_hex', '').upper(),
                            'flight': parsed.get('callsign'),
                            'r': parsed.get('registration'),
                            't': parsed.get('aircraft_type'),
                            'lat': parsed.get('latitude'),
                            'lon': parsed.get('longitude'),
                            'alt_baro': parsed.get('altitude_baro_ft'),
                            'alt_geom': parsed.get('altitude_geo_ft'),
                            'gs': parsed.get('ground_speed_kt'),
                            'track': parsed.get('track'),
                            'baro_rate': parsed.get('vertical_rate_fpm'),
                            'squawk': parsed.get('squawk'),
                            'emergency': parsed.get('emergency'),
                            'category': parsed.get('category'),
                            'seen': parsed.get('seen', 0),
                            'rssi': parsed.get('rssi'),
                            'source': 'adsbexchange',
                        }
                        # Normalize with distance calculation
                        normalized = normalize_aircraft_fast(normalized, feeder_lat, feeder_lon)
                        # Add ADSBX-specific flags
                        normalized['military'] = parsed.get('is_military', False)
                        normalized['is_ladd'] = parsed.get('is_ladd', False)
                        normalized['is_pia'] = parsed.get('is_pia', False)
                        batch.append(normalized)

                if batch:
                    update_state_and_broadcast(batch)
                    total_aircraft += len(batch)

                polls_completed += 1

            now = time.time()

            # Periodic cache sync
            if now - last_cache_sync >= cache_sync_interval:
                sync_cache_state()
                last_cache_sync = now

            # Heartbeat
            cache.set(CACHE_KEY_STREAM_ACTIVE, True, timeout=30)

            # Stats logging
            if now - last_stats_log >= stats_log_interval:
                with _aircraft_state_lock:
                    active_aircraft = len(_aircraft_state)
                logger.info(
                    f"ADSBX stream stats: {polls_completed} polls, {total_aircraft} aircraft processed, "
                    f"{active_aircraft} active aircraft"
                )
                last_stats_log = now

            # Sleep for remaining interval
            elapsed = time.time() - poll_start
            sleep_time = max(0.1, poll_interval - elapsed)
            time.sleep(sleep_time)

        except Exception as e:
            logger.error(f"ADSBexchange poll error: {e}")
            raise


# ============================================================================
# Main Streaming Task
# ============================================================================

@shared_task(bind=True, max_retries=0, ignore_result=True)
def stream_aircraft(self):
    """
    Main aircraft streaming task.

    Supports multiple modes:
    1. SSE mode (preferred) - connects to HTTP SSE endpoint (local Ultrafeeder)
    2. TCP mode (legacy) - connects to raw TCP NDJSON port
    3. ADSBX mode - polls ADSBexchange API for global unfiltered data

    Mode is determined by AIRCRAFT_STREAM_MODE setting:
    - 'sse': Use SSE endpoint (e.g., http://ultrafeeder/v2/sse)
    - 'tcp': Use raw TCP (e.g., ultrafeeder:30047)
    - 'adsbx': Use ADSBexchange API (requires ADSBX_RAPIDAPI_KEY)
    - 'auto': Try SSE first, fall back to TCP
    """
    if not settings.AIRCRAFT_STREAM_ENABLED:
        logger.info("Aircraft streaming disabled, task exiting")
        return

    host = settings.AIRCRAFT_STREAM_HOST
    port = settings.AIRCRAFT_STREAM_PORT
    reconnect_delay = settings.AIRCRAFT_STREAM_RECONNECT_DELAY
    batch_ms = settings.AIRCRAFT_STREAM_BATCH_MS
    stream_mode = getattr(settings, 'AIRCRAFT_STREAM_MODE', 'sse')

    # SSE URL configuration
    sse_port = getattr(settings, 'AIRCRAFT_STREAM_SSE_PORT', 80)
    sse_path = getattr(settings, 'AIRCRAFT_STREAM_SSE_PATH', '/v2/sse')
    sse_url = f"http://{host}:{sse_port}{sse_path}"

    # ADSBX configuration
    adsbx_interval = getattr(settings, 'AIRCRAFT_STREAM_ADSBX_INTERVAL', 2.0)
    adsbx_radius = getattr(settings, 'AIRCRAFT_STREAM_ADSBX_RADIUS', 250)

    # Pre-fetch settings to avoid repeated lookups
    feeder_lat = settings.FEEDER_LAT
    feeder_lon = settings.FEEDER_LON

    logger.info(f"Starting aircraft stream (mode={stream_mode}, feeder={feeder_lat},{feeder_lon})")

    consecutive_errors = 0
    max_consecutive_errors = 10
    use_sse = stream_mode in ('sse', 'auto')
    use_adsbx = stream_mode == 'adsbx'

    while True:
        try:
            if use_adsbx:
                logger.info(f"Starting ADSBexchange API stream (radius={adsbx_radius}nm, interval={adsbx_interval}s)...")
                stream_adsbx(feeder_lat, feeder_lon, adsbx_interval, adsbx_radius)
            elif use_sse:
                logger.info(f"Attempting SSE connection to {sse_url}...")
                stream_sse(sse_url, feeder_lat, feeder_lon, batch_ms)
            else:
                logger.info(f"Attempting TCP connection to {host}:{port}...")
                stream_tcp(host, port, feeder_lat, feeder_lon, batch_ms)

            consecutive_errors = 0

        except requests.exceptions.ConnectionError:
            logger.warning(f"SSE connection failed: {sse_url}")
            cache.set(CACHE_KEY_STREAM_ACTIVE, False, timeout=60)

            # In auto mode, try TCP fallback
            if stream_mode == 'auto' and use_sse:
                logger.info("Falling back to TCP mode")
                use_sse = False
                continue

        except socket.timeout:
            logger.warning("Aircraft stream connection timed out")
            cache.set(CACHE_KEY_STREAM_ACTIVE, False, timeout=60)

        except ConnectionRefusedError:
            logger.warning(f"Aircraft stream connection refused")
            cache.set(CACHE_KEY_STREAM_ACTIVE, False, timeout=60)

            # In auto mode, try other mode
            if stream_mode == 'auto':
                use_sse = not use_sse
                logger.info(f"Switching to {'SSE' if use_sse else 'TCP'} mode")
                continue

        except OSError as e:
            logger.warning(f"Aircraft stream connection error: {e}")
            cache.set(CACHE_KEY_STREAM_ACTIVE, False, timeout=60)

        except ValueError as e:
            # ADSBX not enabled or API key missing
            logger.error(f"Stream configuration error: {e}")
            cache.set(CACHE_KEY_STREAM_ACTIVE, False, timeout=60)
            if use_adsbx:
                logger.error("ADSBexchange mode requires ADSBX_LIVE_ENABLED=True and ADSBX_RAPIDAPI_KEY")
                break

        except Exception as e:
            logger.exception(f"Unexpected error in aircraft stream: {e}")
            cache.set(CACHE_KEY_STREAM_ACTIVE, False, timeout=60)
            consecutive_errors += 1

            if consecutive_errors >= max_consecutive_errors:
                logger.error(f"Too many consecutive errors ({consecutive_errors}), stopping stream")
                break

        # Exponential backoff on reconnect
        backoff = min(reconnect_delay * (2 ** min(consecutive_errors, 5)), 60)
        logger.info(f"Reconnecting to aircraft stream in {backoff}s...")
        time.sleep(backoff)

    cache.set(CACHE_KEY_STREAM_ACTIVE, False, timeout=300)
    logger.info("Aircraft stream task exited")


@shared_task(bind=True, max_retries=3)
def start_aircraft_stream(self):
    """
    Starter task that launches the streaming task if enabled.

    Called by Celery beat to ensure the stream is running.
    """
    logger.info(
        f"start_aircraft_stream called - enabled={settings.AIRCRAFT_STREAM_ENABLED}, "
        f"host={settings.AIRCRAFT_STREAM_HOST}:{settings.AIRCRAFT_STREAM_PORT}"
    )

    if not settings.AIRCRAFT_STREAM_ENABLED:
        logger.info("Aircraft streaming disabled in settings")
        return

    if cache.get(CACHE_KEY_STREAM_ACTIVE):
        logger.debug("Aircraft stream already active")
        return

    logger.info("Starting aircraft stream task")
    stream_aircraft.delay()


# ============================================================================
# Legacy compatibility
# ============================================================================

def normalize_aircraft(ac: dict) -> dict:
    """
    Legacy normalize function for compatibility.

    Use normalize_aircraft_fast() in hot path.
    """
    return normalize_aircraft_fast(ac, settings.FEEDER_LAT, settings.FEEDER_LON)


def update_cache_and_broadcast(batch: list):
    """
    Legacy function for compatibility.

    Use update_state_and_broadcast() in hot path.
    """
    update_state_and_broadcast(batch)


def queue_new_aircraft_for_lookup(aircraft_list: list):
    """
    Legacy function - now uses async queue (thread-safe).
    """
    icaos_to_add = [
        ac.get('hex', '').upper()
        for ac in aircraft_list
        if ac.get('hex', '').upper() and not ac.get('hex', '').upper().startswith('~')
    ]
    if icaos_to_add:
        with _new_aircraft_queue_lock:
            _new_aircraft_queue.extend(icaos_to_add)
