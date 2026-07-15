"""
Aircraft polling and session management tasks.

Includes RPi optimizations:
- Configurable seen aircraft cache size
- Proactive cleanup when approaching limits
"""

import logging
import time
from datetime import datetime, timedelta

import httpx
from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError, transaction
from django.utils import timezone

from skyspy.models import AircraftSession, AircraftSighting
from skyspy.socketio.utils import sync_emit

logger = logging.getLogger(__name__)

# Track seen aircraft for queuing new lookups
# RPi optimization: Reduced from 10000 via settings.MAX_SEEN_AIRCRAFT
_seen_aircraft: set = set()
_seen_aircraft_max = getattr(settings, "MAX_SEEN_AIRCRAFT", 10000)

# Track previous aircraft for change detection
_previous_aircraft: dict = {}  # icao -> aircraft data
_previous_count: int = 0


def queue_new_aircraft_for_lookup(aircraft_list: list):
    """
    Check for new aircraft and queue them for background info lookup.

    Maintains a set of seen aircraft to avoid redundant lookups.
    RPi optimization: Proactively clears at 80% capacity to avoid sudden memory spikes.
    """
    global _seen_aircraft

    # Proactive cleanup at 80% capacity (RPi optimization)
    if len(_seen_aircraft) > _seen_aircraft_max * 0.8:
        # Remove random 50% to maintain some history
        items_to_keep = list(_seen_aircraft)[: len(_seen_aircraft) // 2]
        _seen_aircraft.clear()
        _seen_aircraft.update(items_to_keep)
        logger.info(f"Proactively trimmed seen aircraft cache to {len(_seen_aircraft)} entries")

    # Hard clear if still too large
    if len(_seen_aircraft) > _seen_aircraft_max:
        _seen_aircraft.clear()
        logger.info("Cleared seen aircraft cache")

    new_aircraft = []
    batch_icaos: set = set()
    for ac in aircraft_list:
        icao = ac.get("hex", "").upper()
        if not icao or icao.startswith("~"):  # Skip TIS-B
            continue

        if icao not in _seen_aircraft and icao not in batch_icaos:
            batch_icaos.add(icao)
            new_aircraft.append(icao)

    # Queue lookups for new aircraft (batch to reduce task overhead)
    if new_aircraft:
        from skyspy.tasks.external_db import fetch_aircraft_info

        dispatched = new_aircraft[:20]  # Limit batch size
        for icao in dispatched:
            fetch_aircraft_info.delay(icao)
        # Only mark dispatched aircraft as seen - the remainder will be
        # picked up and dispatched on subsequent cycles
        _seen_aircraft.update(dispatched)
        logger.debug(f"Queued {len(dispatched)} of {len(new_aircraft)} new aircraft for lookup")


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


def run_safety_and_alert_checks(aircraft_list: list):
    """
    Run safety monitoring and alert rule evaluation against the current aircraft list.

    Called once per cycle from the poll path (poll_aircraft) and the stream path
    (sync_cache_state in aircraft_stream.py) with the full aircraft list, so
    emergency squawks, TCAS/proximity conflicts, and custom alert rules are
    evaluated against live data.

    Uses lazy imports to avoid circular dependencies. All failures are logged
    and swallowed so a safety/alert error can never break the data pipeline.
    """
    if not aircraft_list:
        return

    try:
        from skyspy.services.safety import safety_monitor

        safety_monitor.update_aircraft(aircraft_list)
    except (DatabaseError, ConnectionError, OSError, RuntimeError) as e:
        logger.error(f"Safety monitoring failed: {e}")
    except Exception:  # Never let safety failures kill the polling/streaming loop
        logger.exception("Unexpected error in safety monitoring")

    try:
        from skyspy.services.alerts import alert_service

        alert_service.check_alerts(aircraft_list)
    except (DatabaseError, ConnectionError, OSError, RuntimeError) as e:
        logger.error(f"Alert evaluation failed: {e}")
    except Exception:  # Never let alert failures kill the polling/streaming loop
        logger.exception("Unexpected error in alert evaluation")


@shared_task(bind=True, max_retries=0)
def poll_aircraft(self):
    """
    Poll aircraft from ultrafeeder and update cache.

    This task runs every 1-2 seconds to fetch aircraft positions
    from the ADS-B receiver and broadcast updates.

    When streaming is enabled and active, this task skips polling
    to avoid duplicate updates.
    """
    # Skip polling if streaming is enabled and active
    if settings.AIRCRAFT_STREAM_ENABLED and cache.get("aircraft_stream_active"):
        logger.debug("Skipping poll - aircraft stream is active")
        return

    start_time = time.time()

    try:
        # Fetch from ultrafeeder
        url = f"{settings.ULTRAFEEDER_URL}/data/aircraft.json"
        response = httpx.get(url, timeout=5.0)
        response.raise_for_status()
        data = response.json()

        aircraft_list = data.get("aircraft", [])
        now_timestamp = data.get("now")
        messages = data.get("messages", 0)

        # Calculate distance for each aircraft
        feeder_lat = settings.FEEDER_LAT
        feeder_lon = settings.FEEDER_LON

        for ac in aircraft_list:
            lat = ac.get("lat")
            lon = ac.get("lon")

            if lat is not None and lon is not None:
                distance = calculate_distance_nm(feeder_lat, feeder_lon, lat, lon)
                ac["distance_nm"] = round(distance, 1)

            # Normalize field names
            ac["hex"] = ac.get("hex", "").upper()
            ac["flight"] = ac.get("flight", "").strip() if ac.get("flight") else None
            ac["alt"] = ac.get("alt_baro") or ac.get("alt_geom")
            ac["gs"] = ac.get("gs")
            ac["vr"] = ac.get("baro_rate") or ac.get("geom_rate")
            ac["military"] = ac.get("dbFlags", 0) & 1 == 1
            ac["emergency"] = ac.get("squawk") in ("7500", "7600", "7700")

        # Update cache
        cache.set("current_aircraft", aircraft_list, timeout=30)
        cache.set("aircraft_timestamp", now_timestamp, timeout=30)
        cache.set("aircraft_messages", messages, timeout=30)
        cache.set("adsb_online", True, timeout=30)
        cache.set("last_aircraft_broadcast", timezone.now().isoformat().replace("+00:00", "Z"), timeout=60)

        # Queue new aircraft for background info lookup
        try:
            queue_new_aircraft_for_lookup(aircraft_list)
        except Exception as e:  # broad: Celery dispatch/broker + malformed data must not break the poll
            logger.debug(f"Failed to queue aircraft lookups: {e}")

        # Run safety monitoring and alert rule evaluation against live data
        # (internally guarded - failures are logged, never raised)
        run_safety_and_alert_checks(aircraft_list)

        # Detect aircraft changes (new/removed)
        global _previous_aircraft, _previous_count
        current_icaos = {ac.get("hex") for ac in aircraft_list if ac.get("hex")}
        previous_icaos = set(_previous_aircraft.keys())

        new_icaos = current_icaos - previous_icaos
        removed_icaos = previous_icaos - current_icaos

        # Build current aircraft lookup
        current_aircraft_map = {ac.get("hex"): ac for ac in aircraft_list if ac.get("hex")}

        # Broadcast to WebSocket clients via Socket.IO
        try:
            timestamp = timezone.now().isoformat().replace("+00:00", "Z")

            # 1. Broadcast new aircraft events
            if new_icaos:
                new_aircraft = [current_aircraft_map[icao] for icao in new_icaos if icao in current_aircraft_map]
                sync_emit(
                    "aircraft:new",
                    {"aircraft": new_aircraft, "count": len(new_aircraft), "timestamp": timestamp},
                    room="topic_aircraft",
                )
                logger.debug(f"Broadcast {len(new_aircraft)} new aircraft")

            # 2. Broadcast removed aircraft events
            if removed_icaos:
                removed_aircraft = [
                    {"hex": icao, "flight": _previous_aircraft.get(icao, {}).get("flight")} for icao in removed_icaos
                ]
                sync_emit(
                    "aircraft:remove",
                    {
                        "aircraft": removed_aircraft,
                        "icaos": list(removed_icaos),
                        "count": len(removed_aircraft),
                        "timestamp": timestamp,
                    },
                    room="topic_aircraft",
                )
                logger.debug(f"Broadcast {len(removed_aircraft)} removed aircraft")

            # 3. Broadcast position-only lightweight updates (for map efficiency)
            positions = [
                {
                    "hex": ac.get("hex"),
                    "lat": ac.get("lat"),
                    "lon": ac.get("lon"),
                    "alt": ac.get("alt"),
                    "track": ac.get("track"),
                    "gs": ac.get("gs"),
                    "vr": ac.get("vr"),
                }
                for ac in aircraft_list
                if ac.get("lat") is not None and ac.get("lon") is not None
            ]
            sync_emit(
                "positions:update",
                {"positions": positions, "count": len(positions), "timestamp": timestamp},
                room="topic_aircraft",
            )

            # 4. Full aircraft update (existing behavior)
            sync_emit(
                "aircraft:update",
                {"aircraft": aircraft_list, "count": len(aircraft_list), "timestamp": timestamp},
                room="topic_aircraft",
            )
        except Exception as e:  # broad: Socket.IO/Redis emit must never break the poll cycle
            logger.warning(f"Failed to broadcast aircraft update: {e}")

        # Update previous aircraft state for next poll
        _previous_aircraft = current_aircraft_map
        _previous_count = len(aircraft_list)

        elapsed = time.time() - start_time
        logger.debug(f"Polled {len(aircraft_list)} aircraft in {elapsed:.2f}s")

    except httpx.HTTPError as e:
        logger.error(f"Failed to poll aircraft: {e}")
        cache.set("adsb_online", False, timeout=30)
        # Capture to Sentry for HTTP errors (connection issues)
        try:
            from skyspy.utils.sentry import capture_task_error

            capture_task_error(e, "poll_aircraft", extra={"url": f"{settings.ULTRAFEEDER_URL}/data/aircraft.json"})
        except Exception as sentry_err:  # broad: error reporting must never raise
            logger.debug(f"Could not report to Sentry: {sentry_err}")
    except Exception as e:  # broad: Celery task top-level guard - never crash the worker
        logger.exception(f"Error in poll_aircraft: {e}")
        # Capture unexpected errors to Sentry
        try:
            from skyspy.utils.sentry import capture_task_error

            capture_task_error(e, "poll_aircraft")
        except Exception as sentry_err:  # broad: error reporting must never raise
            logger.debug(f"Could not report to Sentry: {sentry_err}")


@shared_task
def cleanup_sessions():
    """
    Report-only helper: count and log stale aircraft sessions.

    This task intentionally does NOT delete anything - stale sessions simply
    stop being updated once their last_seen falls outside the session window.
    Actual data retention (deleting old sessions) is handled by
    skyspy.tasks.cleanup.cleanup_old_sessions, run daily via
    run_all_cleanup_tasks.
    """
    timeout_minutes = settings.SESSION_TIMEOUT_MINUTES
    cutoff = timezone.now() - timedelta(minutes=timeout_minutes)

    # Find stale sessions (last_seen older than cutoff)
    stale_count = AircraftSession.objects.filter(last_seen__lt=cutoff).count()

    logger.info(f"Found {stale_count} stale sessions (older than {timeout_minutes}min) - report only, no deletion")


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
            if ac.get("lat") is None or ac.get("lon") is None:
                continue

            sighting = AircraftSighting(
                icao_hex=ac.get("hex", "").upper(),
                callsign=ac.get("flight"),
                squawk=ac.get("squawk"),
                latitude=ac.get("lat"),
                longitude=ac.get("lon"),
                altitude_baro=ac.get("alt_baro"),
                altitude_geom=ac.get("alt_geom"),
                ground_speed=ac.get("gs"),
                track=ac.get("track"),
                vertical_rate=ac.get("baro_rate") or ac.get("geom_rate"),
                distance_nm=ac.get("distance_nm"),
                rssi=ac.get("rssi"),
                category=ac.get("category"),
                aircraft_type=ac.get("t"),
                is_military=ac.get("military", False),
                is_emergency=ac.get("emergency", False),
                source="1090",
            )
            sightings.append(sighting)

        if sightings:
            AircraftSighting.objects.bulk_create(sightings)
            logger.debug(f"Stored {len(sightings)} sightings")


@shared_task
def update_aircraft_sessions_from_cache():
    """
    Periodic task to update aircraft sessions from cached aircraft data.

    Reads current aircraft from cache and updates/creates session records.
    """
    aircraft_data = cache.get("current_aircraft", [])
    if aircraft_data:
        update_aircraft_sessions(aircraft_data)


def _safe_altitude(value):
    """Convert altitude value to number, handling 'ground' string."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        if value.lower() == "ground":
            return 0
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return None
    return None


# Cache lock to prevent overlapping session update runs (which would create
# duplicate sessions - there is no unique constraint on icao_hex+window)
_SESSION_UPDATE_LOCK_KEY = "update_aircraft_sessions_lock"
_SESSION_UPDATE_LOCK_TIMEOUT = 60  # seconds - safety net if a run dies mid-way


@shared_task
def update_aircraft_sessions(aircraft_data: list):
    """
    Update or create aircraft tracking sessions.

    Guarded by a cache-based lock so overlapping runs (beat schedules this
    every 5s and a slow run can exceed that) don't race the SELECT-then-save
    logic and create duplicate sessions. Each aircraft is committed in its own
    short transaction instead of one long transaction over the whole list.
    """
    if not aircraft_data:
        return

    # cache.add is atomic: returns False if the lock is already held
    if not cache.add(_SESSION_UPDATE_LOCK_KEY, True, timeout=_SESSION_UPDATE_LOCK_TIMEOUT):
        logger.debug("update_aircraft_sessions already running, skipping overlapping run")
        return

    try:
        _update_aircraft_sessions(aircraft_data)
    finally:
        cache.delete(_SESSION_UPDATE_LOCK_KEY)


def _update_aircraft_sessions(aircraft_data: list):
    """Inner implementation of session updates (called with the lock held)."""
    now = timezone.now()
    session_cutoff = now - timedelta(minutes=5)  # 5 min session gap

    for ac in aircraft_data:
        icao = ac.get("hex", "").upper()
        if not icao:
            continue

        # Short per-aircraft transaction instead of one long transaction
        with transaction.atomic():
            # Find or create session (most recent matching session wins)
            session = (
                AircraftSession.objects.filter(icao_hex=icao, last_seen__gte=session_cutoff)
                .order_by("-last_seen")
                .first()
            )

            alt = _safe_altitude(ac.get("alt_baro") or ac.get("alt_geom"))
            distance = ac.get("distance_nm")
            vr = ac.get("baro_rate") or ac.get("geom_rate")
            rssi = ac.get("rssi")

            if session:
                # Update existing session
                session.callsign = ac.get("flight") or session.callsign
                session.last_seen = now
                session.total_positions += 1

                if alt is not None:
                    session.min_altitude = min(session.min_altitude or alt, alt)
                    session.max_altitude = max(session.max_altitude or alt, alt)

                if distance is not None:
                    session.min_distance_nm = min(session.min_distance_nm or distance, distance)
                    session.max_distance_nm = max(session.max_distance_nm or distance, distance)

                if vr is not None:
                    session.max_vertical_rate = max(abs(session.max_vertical_rate or 0), abs(vr))

                if rssi is not None:
                    session.min_rssi = min(session.min_rssi or rssi, rssi)
                    session.max_rssi = max(session.max_rssi or rssi, rssi)

                session.save()
            else:
                # Create new session
                AircraftSession.objects.create(
                    icao_hex=icao,
                    callsign=ac.get("flight"),
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
                    is_military=ac.get("military", False),
                    category=ac.get("category"),
                    aircraft_type=ac.get("t"),
                )


@shared_task
def update_stats_cache():
    """
    Update cached statistics for quick retrieval.
    """

    # Get current aircraft from cache
    aircraft_list = cache.get("current_aircraft", [])

    # Calculate stats
    stats = {
        "total": len(aircraft_list),
        "with_position": sum(1 for ac in aircraft_list if ac.get("lat") is not None),
        "military": sum(1 for ac in aircraft_list if ac.get("military")),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    cache.set("aircraft_stats", stats, timeout=120)
    cache.set("celery_heartbeat", True, timeout=120)

    logger.debug(f"Updated stats cache: {stats['total']} aircraft")


@shared_task
def update_safety_stats():
    """
    Update cached safety statistics.
    """
    from django.db.models import Count

    from skyspy.models import SafetyEvent

    cutoff = timezone.now() - timedelta(hours=24)

    events = SafetyEvent.objects.filter(timestamp__gte=cutoff)

    by_type = dict(events.values_list("event_type").annotate(count=Count("id")))
    by_severity = dict(events.values_list("severity").annotate(count=Count("id")))

    stats = {
        "total_24h": events.count(),
        "by_type": by_type,
        "by_severity": by_severity,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    cache.set("safety_stats", stats, timeout=60)
    logger.debug(f"Updated safety stats: {stats['total_24h']} events in 24h")
