"""
ADS-B Feeder Metrics API v2.6.0

A FastAPI application for tracking aircraft via ADS-B with PostgreSQL
historical data, alert rules, safety monitoring, and Apprise notifications.
"""
import asyncio
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST

from fastapi import FastAPI, Request, WebSocket, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import (
    get_settings, init_db, close_db, get_db,
    safe_request, calculate_distance_nm, is_valid_position,
    safe_int_altitude, clear_cache
)
from app.core.database import AsyncSessionLocal, db_execute_safe
from app.models import (
    AircraftSighting, AircraftSession, NotificationConfig, SafetyEvent
)
from app.services.sse import create_sse_manager, get_sse_manager
from app.services.websocket import create_ws_manager, get_ws_manager, handle_websocket
from app.services.socketio_manager import create_socketio_manager, get_socketio_manager, get_socketio_app
from app.services.safety import safety_monitor
from app.services.notifications import notifier
from app.services.alerts import check_alerts, store_alert_history
from app.services.acars import acars_service, store_acars_message
from app.services.aircraft_info import (
    init_lookup_queue, process_lookup_queue, check_and_queue_new_aircraft,
    get_seen_aircraft_count
)
from app.services import external_db
from app.services import airspace as airspace_service
from app.services import audio as audio_service
from app.services import geodata as geodata_service
from app.services import antenna_analytics
from app.services import stats_cache
from app.routers import aircraft, map, history, alerts, safety, notifications, system, aviation, airframe, acars, audio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()

# Initialize Sentry
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=settings.sentry_profiles_sample_rate,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            StarletteIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
            AsyncioIntegration(),
        ],
        send_default_pii=False,
    )
    logger.info(f"Sentry initialized (environment: {settings.sentry_environment})")

# Prometheus Metrics
REQUEST_COUNT = Counter(
    "skyspy_api_http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"]
)
REQUEST_LATENCY = Histogram(
    "skyspy_api_http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "endpoint"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)
AIRCRAFT_COUNT = Gauge(
    "skyspy_api_aircraft_count",
    "Current number of aircraft being tracked",
    ["source"]
)
AIRCRAFT_POLL_DURATION = Histogram(
    "skyspy_api_aircraft_poll_duration_seconds",
    "Time spent polling aircraft data",
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
)
DB_OPERATION_DURATION = Histogram(
    "skyspy_api_db_operation_duration_seconds",
    "Database operation duration in seconds",
    ["operation"],
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5]
)
SAFETY_EVENTS_TOTAL = Counter(
    "skyspy_api_safety_events_total",
    "Total safety events detected",
    ["event_type", "severity"]
)
ALERTS_TRIGGERED_TOTAL = Counter(
    "skyspy_api_alerts_triggered_total",
    "Total alerts triggered",
    ["priority"]
)
SSE_SUBSCRIBERS = Gauge(
    "skyspy_api_sse_subscribers",
    "Current number of SSE subscribers"
)
WEBSOCKET_CONNECTIONS = Gauge(
    "skyspy_api_websocket_connections",
    "Current number of WebSocket connections"
)
ACTIVE_SESSIONS = Gauge(
    "skyspy_api_active_sessions",
    "Number of active aircraft tracking sessions"
)

# Active session cache
_active_sessions: dict[str, int] = {}

# Background task handle
_background_task: Optional[asyncio.Task] = None


async def store_safety_event(db: AsyncSession, event: dict) -> Optional[int]:
    """Store a safety event in the database."""
    try:
        safety_event = SafetyEvent(
            event_type=event["event_type"],
            severity=event["severity"],
            icao_hex=event["icao"],
            icao_hex_2=event.get("icao_2"),
            callsign=event.get("callsign"),
            callsign_2=event.get("callsign_2"),
            message=event["message"],
            details=event.get("details", {}),
            aircraft_snapshot=event.get("aircraft_snapshot"),
            aircraft_snapshot_2=event.get("aircraft_snapshot_2"),
        )
        db.add(safety_event)
        await db.commit()
        await db.refresh(safety_event)
        return safety_event.id
    except Exception as e:
        logger.error(f"Failed to store safety event: {e}")
        await db.rollback()
        return None


async def process_aircraft_data(db: AsyncSession, aircraft_list: list[dict], source: str = "1090"):
    """Process aircraft data and store to database.

    Uses batch inserts for sightings and batched session updates to avoid deadlocks
    from concurrent transactions updating the same rows.
    """
    if not aircraft_list:
        return

    now = datetime.utcnow()
    sse_manager = get_sse_manager()

    # Collect all sightings for batch insert
    sightings_to_add = []
    # Track session updates: session_id -> update_data
    session_updates: dict[int, dict] = {}
    # Track new sessions to create
    new_sessions: list[tuple[str, dict, dict]] = []  # (session_key, session_data, ac)
    # Track ICAOs that need lookup
    icaos_to_lookup = []

    # First pass: prepare all data without any DB writes
    for ac in aircraft_list:
        icao = ac.get("hex", "").upper()
        if not icao:
            continue

        # Determine source (use embedded tag if available, else default)
        current_source = ac.get("_source", source)

        # Queue for lookup later
        icaos_to_lookup.append((icao, db))

        callsign = (ac.get("flight") or "").strip() or None
        lat, lon = ac.get("lat"), ac.get("lon")

        distance_nm = None
        if is_valid_position(lat, lon):
            distance_nm = calculate_distance_nm(
                settings.feeder_lat, settings.feeder_lon, lat, lon
            )
        else:
            lat, lon = None, None

        is_military = bool(ac.get("dbFlags", 0) & 1)
        squawk = ac.get("squawk", "")
        is_emergency = squawk in ["7500", "7600", "7700"]
        vr = ac.get("baro_rate", ac.get("geom_rate"))
        alt_baro = safe_int_altitude(ac.get("alt_baro"))
        alt_geom = safe_int_altitude(ac.get("alt_geom"))
        rssi = ac.get("rssi")

        # Prepare sighting for batch insert
        sightings_to_add.append(AircraftSighting(
            timestamp=now,
            icao_hex=icao,
            callsign=callsign,
            squawk=squawk,
            latitude=lat,
            longitude=lon,
            altitude_baro=alt_baro,
            altitude_geom=alt_geom,
            ground_speed=ac.get("gs"),
            track=ac.get("track"),
            vertical_rate=vr,
            distance_nm=distance_nm,
            rssi=rssi,
            category=ac.get("category"),
            aircraft_type=ac.get("t"),
            is_military=is_military,
            is_emergency=is_emergency,
            source=current_source
        ))

        # Prepare session update data
        session_key = f"{icao}:{current_source}"
        cached_session_id = _active_sessions.get(session_key)

        update_data = {
            "callsign": callsign,
            "alt_baro": alt_baro,
            "vr": vr,
            "distance_nm": distance_nm,
            "rssi": rssi,
            "now": now,
            "ac": ac,
            "is_military": is_military,
            "session_key": session_key,
            "icao": icao,
        }

        if cached_session_id:
            # Aggregate updates for the same session
            if cached_session_id not in session_updates:
                session_updates[cached_session_id] = update_data
            # If same session seen multiple times, just keep the latest update
        else:
            new_sessions.append((session_key, update_data, ac))

    # Queue all aircraft for info lookup (non-blocking)
    for icao, _ in icaos_to_lookup:
        await check_and_queue_new_aircraft(icao, db)

    # Batch add all sightings
    db.add_all(sightings_to_add)

    # Batch fetch all sessions that need updates (single query)
    if session_updates:
        session_ids = list(session_updates.keys())
        result = await db_execute_safe(
            db,
            select(AircraftSession).where(AircraftSession.id.in_(session_ids))
        )
        existing_sessions = {s.id: s for s in (result.scalars().all() if result else [])}

        # Apply updates to existing sessions
        for session_id, update_data in session_updates.items():
            existing = existing_sessions.get(session_id)
            if existing:
                existing.last_seen = update_data["now"]
                existing.total_positions += 1
                if update_data["callsign"]:
                    existing.callsign = update_data["callsign"]
                alt_baro = update_data["alt_baro"]
                if alt_baro is not None:
                    if existing.min_altitude is None or alt_baro < existing.min_altitude:
                        existing.min_altitude = alt_baro
                    if existing.max_altitude is None or alt_baro > existing.max_altitude:
                        existing.max_altitude = alt_baro
                vr = update_data["vr"]
                if vr is not None and (existing.max_vertical_rate is None or abs(vr) > existing.max_vertical_rate):
                    existing.max_vertical_rate = abs(vr)
                distance_nm = update_data["distance_nm"]
                if distance_nm is not None:
                    if existing.min_distance_nm is None or distance_nm < existing.min_distance_nm:
                        existing.min_distance_nm = distance_nm
                    if existing.max_distance_nm is None or distance_nm > existing.max_distance_nm:
                        existing.max_distance_nm = distance_nm
                rssi = update_data["rssi"]
                if rssi is not None:
                    if existing.min_rssi is None or rssi < existing.min_rssi:
                        existing.min_rssi = rssi
                    if existing.max_rssi is None or rssi > existing.max_rssi:
                        existing.max_rssi = rssi
            else:
                # Session was deleted, remove from cache
                _active_sessions.pop(update_data["session_key"], None)

    # Process new sessions - batch fetch recent sessions first
    if new_sessions:
        # Get unique ICAOs that need session lookup
        icaos_needing_sessions = list(set(data["icao"] for _, data, _ in new_sessions))

        # Single query to find all recent sessions for these ICAOs
        result = await db.execute(
            select(AircraftSession).where(
                AircraftSession.icao_hex.in_(icaos_needing_sessions),
                AircraftSession.last_seen > now - timedelta(minutes=5)
            ).order_by(AircraftSession.last_seen.desc())
        )
        recent_sessions_by_icao: dict[str, AircraftSession] = {}
        for session in result.scalars().all():
            # Keep only the most recent session per ICAO
            if session.icao_hex not in recent_sessions_by_icao:
                recent_sessions_by_icao[session.icao_hex] = session

        # Process each new session entry
        for session_key, update_data, ac in new_sessions:
            icao = update_data["icao"]

            # Skip if we already cached this session in a previous iteration
            if session_key in _active_sessions:
                continue

            recent = recent_sessions_by_icao.get(icao)

            if recent:
                _active_sessions[session_key] = recent.id
                recent.last_seen = update_data["now"]
                recent.total_positions += 1
            else:
                # Create new session
                rssi = update_data["rssi"]
                alt_baro = update_data["alt_baro"]
                vr = update_data["vr"]
                distance_nm = update_data["distance_nm"]
                callsign = update_data["callsign"]
                is_military = update_data["is_military"]

                session = AircraftSession(
                    icao_hex=icao,
                    callsign=callsign,
                    first_seen=now,
                    last_seen=now,
                    total_positions=1,
                    min_altitude=alt_baro,
                    max_altitude=alt_baro,
                    min_distance_nm=distance_nm,
                    max_distance_nm=distance_nm,
                    max_vertical_rate=abs(vr) if vr else None,
                    min_rssi=rssi,
                    max_rssi=rssi,
                    is_military=is_military,
                    category=ac.get("category"),
                    aircraft_type=ac.get("t")
                )
                db.add(session)
                await db.flush()
                _active_sessions[session_key] = session.id
                # Add to recent_sessions_by_icao to prevent duplicate creation
                recent_sessions_by_icao[icao] = session

                # Check alerts for new aircraft
                alerts_list = await check_alerts(db, ac, distance_nm)
                for alert in alerts_list:
                    # Track alerts in Prometheus
                    if settings.prometheus_enabled:
                        ALERTS_TRIGGERED_TOTAL.labels(priority=alert["priority"]).inc()

                    aircraft_data = {
                        "hex": icao,
                        "flight": callsign,
                        "alt": ac.get("alt_baro"),
                        "lat": ac.get("lat"),
                        "lon": ac.get("lon"),
                        "gs": ac.get("gs"),
                        "track": ac.get("track"),
                        "military": is_military,
                        "distance_nm": round(distance_nm, 2) if distance_nm else None
                    }

                    await store_alert_history(
                        db=db,
                        rule_id=alert.get("rule_id"),
                        rule_name=alert["rule_name"],
                        icao=icao,
                        callsign=callsign or "",
                        message=alert["message"],
                        priority=alert["priority"],
                        aircraft_data=aircraft_data
                    )

                    await sse_manager.publish_alert_triggered(
                        rule_id=alert.get("rule_id") or 0,
                        rule_name=alert["rule_name"],
                        icao=icao,
                        callsign=callsign or "",
                        message=alert["message"],
                        priority=alert["priority"],
                        aircraft_data=aircraft_data
                    )

                    # Also publish via Socket.IO
                    sio_mgr = get_socketio_manager()
                    if sio_mgr:
                        await sio_mgr.publish_alert_triggered(
                            rule_id=alert.get("rule_id") or 0,
                            rule_name=alert["rule_name"],
                            icao=icao,
                            callsign=callsign or "",
                            message=alert["message"],
                            priority=alert["priority"],
                            aircraft_data=aircraft_data
                        )

                    await notifier.send(
                        db=db,
                        title=alert["title"],
                        body=alert["message"],
                        notify_type=alert["priority"],
                        key=f"{alert['type']}:{icao}",
                        icao=icao,
                        callsign=callsign,
                        details={"distance_nm": distance_nm, "rule": alert.get("rule_name")},
                        api_url=alert.get("api_url")
                    )

    await db.commit()


async def _store_aircraft_to_db(aircraft_list: list[dict]):
    """Store aircraft data to database with timeout protection.

    Uses a lock to prevent concurrent executions which can cause deadlocks
    when multiple transactions try to update the same aircraft_sessions rows.
    """
    # Use lock to serialize DB writes and prevent deadlocks
    async with _processing_lock:
        db_start = time.time()
        # Timeout based on aircraft count: base 30s + 0.1s per aircraft, max 120s
        timeout_seconds = min(30 + len(aircraft_list) * 0.1, 120)

        async with AsyncSessionLocal() as db:
            try:
                await asyncio.wait_for(
                    process_aircraft_data(db, aircraft_list, "1090"),
                    timeout=timeout_seconds
                )
                if settings.prometheus_enabled:
                    DB_OPERATION_DURATION.labels(operation="store_aircraft").observe(time.time() - db_start)
                logger.debug("Stored %d aircraft to database", len(aircraft_list))
            except asyncio.TimeoutError:
                logger.warning(f"process_aircraft_data timed out after {timeout_seconds:.1f}s for {len(aircraft_list)} aircraft")
                await db.rollback()
            except Exception as e:
                logger.error(f"Error in process_aircraft_data: {e}")
                sentry_sdk.capture_exception(e)
                await db.rollback()


async def _run_safety_monitoring(aircraft_list: list[dict]):
    """Run safety monitoring and handle events."""
    if not safety_monitor.enabled:
        return

    sse_manager = get_sse_manager()
    sio_manager = get_socketio_manager()

    try:
        safety_events = safety_monitor.update_aircraft(aircraft_list)

        if safety_events:
            async with AsyncSessionLocal() as db:
                for event in safety_events:
                    if settings.prometheus_enabled:
                        SAFETY_EVENTS_TOTAL.labels(
                            event_type=event["event_type"],
                            severity=event["severity"]
                        ).inc()

                    db_id = await store_safety_event(db, event)
                    if db_id:
                        event["db_id"] = db_id

                    await sse_manager.publish_safety_event(event)
                    if sio_manager:
                        await sio_manager.publish_safety_event(event)

                    if event["severity"] == "critical":
                        emoji = "⚠️" if event["event_type"] == "proximity_conflict" else "🔴"
                        await notifier.send(
                            db=db,
                            title=f"{emoji} {event['event_type'].replace('_', ' ').title()}",
                            body=event["message"],
                            notify_type="emergency",
                            key=f"safety:{event['event_type']}:{event['icao']}",
                            icao=event["icao"],
                            callsign=event.get("callsign"),
                            details=event.get("details", {})
                        )

                    logger.warning(f"Safety event: {event['event_type']} - {event['message']}")
    except Exception as e:
        logger.error(f"Error in safety monitoring: {e}")
        sentry_sdk.capture_exception(e)


async def _process_aircraft_background(aircraft_list: list[dict]):
    """Background task to store aircraft data and run safety monitoring in parallel."""
    if not aircraft_list:
        return

    # Run DB storage and safety monitoring concurrently
    await asyncio.gather(
        _store_aircraft_to_db(aircraft_list),
        _run_safety_monitoring(aircraft_list),
        return_exceptions=True  # Don't let one failure stop the other
    )


def _create_background_task(coro, name: str = None):
    """Create a background task with proper exception logging."""
    async def wrapped():
        try:
            await coro
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"Background task{f' {name}' if name else ''} failed: {e}")
            sentry_sdk.capture_exception(e)

    task = asyncio.create_task(wrapped())
    if name:
        task.set_name(name)
    return task


# Track pending background processing task
_pending_processing_task: Optional[asyncio.Task] = None
# Lock to prevent concurrent DB processing (prevents deadlocks)
_processing_lock = asyncio.Lock()


async def fetch_and_process_aircraft():
    """Fetch aircraft data and broadcast immediately, then process in background."""
    global _pending_processing_task

    poll_start = time.time()
    all_aircraft = []
    aircraft_1090_count = 0
    aircraft_978_count = 0

    # Fetch from 1090MHz and 978MHz in parallel for faster data collection
    async def fetch_1090():
        nonlocal aircraft_1090_count
        try:
            url = f"{settings.ultrafeeder_url}/data/aircraft.json"
            data = await safe_request(url, is_upstream=False)
            if data:
                aircraft_1090 = data.get("aircraft", [])
                for a in aircraft_1090:
                    a["_source"] = "1090"
                aircraft_1090_count = len(aircraft_1090)
                return aircraft_1090
        except Exception as e:
            logger.warning(f"Failed to fetch 1090 data: {e}")
            sentry_sdk.capture_exception(e)
        return []

    async def fetch_978():
        nonlocal aircraft_978_count
        try:
            url = f"{settings.dump978_url}/skyaware978/data/aircraft.json"
            data = await safe_request(url, is_upstream=False)
            if data:
                aircraft_978 = data.get("aircraft", [])
                for a in aircraft_978:
                    a["_source"] = "978"
                aircraft_978_count = len(aircraft_978)
                return aircraft_978
        except Exception as e:
            logger.debug(f"Failed to fetch 978 data: {e}")
        return []

    # Fetch both sources in parallel
    t0 = time.time()
    results = await asyncio.gather(fetch_1090(), fetch_978())
    for result in results:
        all_aircraft.extend(result)
    fetch_time = time.time() - t0

    logger.debug("Fetched %d aircraft from 1090MHz", aircraft_1090_count)

    # Update Prometheus gauges for aircraft counts (if enabled)
    if settings.prometheus_enabled:
        AIRCRAFT_COUNT.labels(source="1090").set(aircraft_1090_count)
        AIRCRAFT_COUNT.labels(source="978").set(aircraft_978_count)
        AIRCRAFT_COUNT.labels(source="total").set(len(all_aircraft))
        ACTIVE_SESSIONS.set(len(_active_sessions))
        AIRCRAFT_POLL_DURATION.observe(time.time() - poll_start)

    # PRIORITY: Broadcast immediately to clients before any DB/safety processing
    sse_manager = get_sse_manager()
    sio_manager = get_socketio_manager()

    t1 = time.time()
    await sse_manager.publish_aircraft_update(all_aircraft)
    sse_time = time.time() - t1

    t2 = time.time()
    if sio_manager:
        await sio_manager.publish_aircraft_update(all_aircraft)
    sio_time = time.time() - t2

    # Update aircraft stats cache (synchronous, fast - no DB queries)
    stats_cache.update_aircraft_stats_cache(all_aircraft)

    # Log timing breakdown periodically
    total_time = time.time() - poll_start
    if total_time > 0.1:  # Log if poll cycle takes >100ms
        logger.warning(f"Slow poll: total={total_time*1000:.0f}ms fetch={fetch_time*1000:.0f}ms sse={sse_time*1000:.0f}ms sio={sio_time*1000:.0f}ms aircraft={len(all_aircraft)}")

    # Schedule background processing (DB storage + safety monitoring)
    # Skip if previous task is still running to prevent task accumulation
    if all_aircraft:
        if _pending_processing_task is not None and not _pending_processing_task.done():
            logger.debug("Skipping background processing - previous task still running")
        else:
            # Pass list directly - background processing only reads, doesn't mutate
            # The list reference is captured at task creation time
            _pending_processing_task = _create_background_task(
                _process_aircraft_background(all_aircraft),
                name="aircraft_processing"
            )


async def background_polling_task():
    """Background task for polling aircraft data."""
    logger.info(f"Background polling started (interval: {settings.polling_interval}s)")

    poll_count = 0
    while True:
        try:
            loop_start = time.time()
            await fetch_and_process_aircraft()
            poll_duration = time.time() - loop_start
            poll_count += 1
            # Log every 60 iterations (once per minute at 1s interval)
            if poll_count % 60 == 0:
                logger.info(f"Poll cycle took {poll_duration*1000:.1f}ms")
        except Exception as e:
            logger.error(f"Error in background polling: {e}")

        await asyncio.sleep(settings.polling_interval)


async def cleanup_old_sessions():
    """Clean up stale session references using batch query."""
    if not _active_sessions:
        return

    now = datetime.utcnow()
    stale_cutoff = now - timedelta(minutes=10)
    stale_keys = []

    # Get all session IDs in one batch query instead of N queries
    session_ids = list(_active_sessions.values())
    key_by_id = {v: k for k, v in _active_sessions.items()}

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(AircraftSession.id, AircraftSession.last_seen)
            .where(AircraftSession.id.in_(session_ids))
        )
        existing_sessions = {row.id: row.last_seen for row in result.fetchall()}

    # Find stale or deleted sessions
    for sid, key in key_by_id.items():
        last_seen = existing_sessions.get(sid)
        if last_seen is None or last_seen < stale_cutoff:
            stale_keys.append(key)

    for k in stale_keys:
        _active_sessions.pop(k, None)

    if stale_keys:
        logger.debug("Cleaned up %d stale sessions", len(stale_keys))


async def session_cleanup_task():
    """Background task for cleaning up sessions and rate limit entries."""
    from app.services.aircraft_info import cleanup_memory_caches

    while True:
        await asyncio.sleep(300)  # Every 5 minutes
        try:
            await cleanup_old_sessions()
            # Clean up all memory caches to prevent unbounded growth
            cleanup_memory_caches()
        except Exception as e:
            logger.error("Error cleaning sessions: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global _background_task
    
    logger.info("Starting ADS-B API v2.6.0")
    
    # Initialize database
    await init_db()
    logger.info("Database initialized")
    
    # Initialize notification config
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(NotificationConfig).limit(1))
        if not result.scalar_one_or_none():
            config = NotificationConfig(
                apprise_urls=settings.apprise_urls,
                cooldown_seconds=settings.notification_cooldown
            )
            db.add(config)
            await db.commit()
    
    # Initialize SSE manager (legacy, still supported)
    await create_sse_manager()
    logger.info("SSE manager initialized")

    # Initialize WebSocket manager (legacy native WebSocket)
    ws_manager = await create_ws_manager()
    logger.info("WebSocket manager initialized")

    # Initialize Socket.IO manager (primary real-time connection)
    sio_manager = create_socketio_manager()
    logger.info(f"Socket.IO manager initialized (Redis: {sio_manager.is_using_redis()})")
    
    # Initialize all external aircraft databases (ADSBX, tar1090, FAA, OpenSky)
    # Downloads and loads into memory - sync to PostgreSQL happens in background
    logger.info("Initializing external aircraft databases...")
    await external_db.init_databases(auto_download=True)

    # Start background sync to PostgreSQL (don't block startup)
    # This can take several minutes for 600k+ aircraft
    async def background_db_sync():
        try:
            await external_db.sync_databases_to_postgres()
            logger.info("Background database sync completed")
        except Exception as e:
            logger.error(f"Background database sync failed: {e}")

    db_sync_task = asyncio.create_task(background_db_sync())
    logger.info("Database sync started in background")

    # Start periodic database updater (daily refresh)
    external_db_task = asyncio.create_task(external_db.periodic_database_updater())
    logger.info("External database updater started (24h refresh)")

    # Clear caches
    _active_sessions.clear()
    clear_cache()
    
    # Start background tasks
    _background_task = asyncio.create_task(background_polling_task())
    cleanup_task = asyncio.create_task(session_cleanup_task())
    
    # Start aircraft info lookup queue
    await init_lookup_queue()
    lookup_task = asyncio.create_task(process_lookup_queue(AsyncSessionLocal))
    logger.info("Aircraft lookup queue started")
    
    # Start ACARS service
    sse_manager = get_sse_manager()

    async def acars_callback(msg: dict):
        """Publish ACARS messages to SSE and Socket.IO."""
        await sse_manager.publish_acars_message(msg)
        if sio_manager:
            await sio_manager.publish_acars_message(msg)
        # Also store in database
        async with AsyncSessionLocal() as db:
            await store_acars_message(db, msg)

    acars_service.set_sse_callback(acars_callback)
    if settings.acars_enabled:
        await acars_service.start(
            acars_port=settings.acars_port,
            vdlm2_port=settings.vdlm2_port
        )
        logger.info(f"ACARS service started (ACARS:{settings.acars_port}, VDL2:{settings.vdlm2_port})")
    else:
        logger.info("ACARS service disabled")

    # Start airspace data refresh service (with WebSocket and Socket.IO managers for broadcasts)
    airspace_task = await airspace_service.start_refresh_task(AsyncSessionLocal, ws_manager, sio_manager)
    logger.info("Airspace refresh service started (advisories: 5min, boundaries: 24h)")

    # Start geographic data refresh service (airports, navaids, geojson - daily refresh)
    geodata_task = await geodata_service.start_refresh_task(AsyncSessionLocal)
    logger.info("Geographic data refresh service started (daily refresh)")

    # Start antenna analytics refresh service (calculates and caches antenna metrics)
    antenna_task = await antenna_analytics.start_refresh_task(AsyncSessionLocal)
    logger.info("Antenna analytics service started (5min refresh)")

    # Start stats cache refresh service (history and safety stats)
    stats_cache_tasks = await stats_cache.start_refresh_tasks(AsyncSessionLocal)
    logger.info("Stats cache service started (history: 60s, safety: 30s)")

    # Start audio transcription queue if enabled
    transcription_task = None
    logger.info(f"Transcription config: enabled={settings.transcription_enabled}, whisper={settings.whisper_enabled}, url={settings.transcription_service_url}")
    if settings.transcription_enabled:
        await audio_service.init_transcription_queue()
        transcription_task = asyncio.create_task(
            audio_service.process_transcription_queue(AsyncSessionLocal)
        )
        logger.info("Audio transcription queue started")
    else:
        logger.info("Audio transcription disabled")

    # Update scheduler state for status endpoint
    system.set_scheduler_state(
        running=True,
        jobs=[
            {"id": "aircraft_fetch", "interval": settings.polling_interval},
            {"id": "airspace_refresh", "interval": 300},
        ]
    )
    
    logger.info(f"Ultrafeeder: {settings.ultrafeeder_url}")
    logger.info(f"Feeder location: {settings.feeder_lat}, {settings.feeder_lon}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down...")
    
    if _background_task:
        _background_task.cancel()
        try:
            await _background_task
        except asyncio.CancelledError:
            pass
    
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    
    lookup_task.cancel()
    try:
        await lookup_task
    except asyncio.CancelledError:
        pass

    # Stop external database updater
    external_db_task.cancel()
    try:
        await external_db_task
    except asyncio.CancelledError:
        pass

    # Stop transcription queue
    if transcription_task:
        transcription_task.cancel()
        try:
            await transcription_task
        except asyncio.CancelledError:
            pass

    # Stop airspace refresh service
    await airspace_service.stop_refresh_task()

    # Stop geographic data refresh service
    await geodata_service.stop_refresh_task()

    # Stop antenna analytics refresh service
    await antenna_analytics.stop_refresh_task()

    # Stop stats cache refresh service
    await stats_cache.stop_refresh_tasks()

    # Stop ACARS service
    await acars_service.stop()

    # Stop SSE manager (legacy)
    sse_manager = get_sse_manager()
    if hasattr(sse_manager, "stop"):
        await sse_manager.stop()

    # Stop WebSocket manager
    ws_mgr = get_ws_manager()
    if hasattr(ws_mgr, "stop"):
        await ws_mgr.stop()

    # Close shared HTTP client
    from app.core import close_http_client
    await close_http_client()

    await close_db()
    logger.info("Shutdown complete")


# Create FastAPI application
app = FastAPI(
    title="ADS-B Feeder Metrics API",
    version="2.6.0",
    description="""
## Overview
REST API for ADS-B aircraft tracking with historical data storage,
customizable alert rules, safety event monitoring, and push notifications.

## Features
- **Live Aircraft Data**: Real-time aircraft positions from 1090MHz and 978MHz UAT
- **Aircraft Info**: Registration, airframe data, and photos from open sources
- **GeoJSON Map Data**: Map-optimized endpoint with GeoJSON format
- **Server-Sent Events**: Real-time streaming updates via SSE
- **ACARS/VDL2**: Receive and store ACARS and VDL2 messages
- **Historical Tracking**: PostgreSQL-backed sighting history and session tracking
- **Alert Rules**: Configurable alerts with complex AND/OR conditions
- **Safety Events**: TCAS conflict detection and dangerous flight parameter monitoring
- **Aviation Weather**: METAR, TAF, PIREPs, and SIGMETs from aviationweather.gov
- **Notifications**: Push notifications via Apprise (Pushover, Telegram, Discord, etc.)

## Quick Start
1. Connect to your Ultrafeeder/readsb instance
2. Configure PostgreSQL database
3. Start receiving real-time aircraft data

## Authentication
This API does not require authentication by default.

## Rate Limiting
Aircraft endpoints are cached for 2 seconds. Aviation weather data is cached for 5 minutes.
    """,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=[
        {
            "name": "Aircraft",
            "description": "Real-time aircraft tracking from ADS-B receivers"
        },
        {
            "name": "Aircraft Info",
            "description": "Aircraft registration, airframe data, and photos"
        },
        {
            "name": "Map",
            "description": "GeoJSON data and SSE streaming for map displays"
        },
        {
            "name": "Alerts",
            "description": "Custom alert rules and notification triggers"
        },
        {
            "name": "Safety",
            "description": "Aviation safety event monitoring (TCAS, proximity, etc.)"
        },
        {
            "name": "ACARS",
            "description": "ACARS and VDL2 message reception and storage"
        },
        {
            "name": "Aviation",
            "description": "Weather (METAR/TAF), airports, and navigation data"
        },
        {
            "name": "History",
            "description": "Historical sightings and tracking sessions"
        },
        {
            "name": "Notifications",
            "description": "Push notification configuration via Apprise"
        },
        {
            "name": "System",
            "description": "Health checks, status, and configuration"
        },
        {
            "name": "Audio",
            "description": "Radio audio transmissions and transcription"
        },
    ]
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Prometheus metrics middleware
@app.middleware("http")
async def prometheus_metrics_middleware(request: Request, call_next):
    """Middleware to collect Prometheus metrics for HTTP requests."""
    # Skip metrics endpoint to avoid recursion
    if request.url.path == "/metrics":
        return await call_next(request)

    method = request.method
    # Normalize path to avoid high cardinality (e.g., /api/v1/aircraft/ABC123 -> /api/v1/aircraft/{icao})
    path = request.url.path
    for pattern, replacement in [
        (r"/aircraft/[A-Fa-f0-9]{6}", "/aircraft/{icao}"),
        (r"/sessions/\d+", "/sessions/{id}"),
        (r"/alerts/\d+", "/alerts/{id}"),
        (r"/history/\d+", "/history/{id}"),
    ]:
        path = re.sub(pattern, replacement, path)

    start_time = time.time()
    response = await call_next(request)

    if settings.prometheus_enabled:
        duration = time.time() - start_time
        REQUEST_COUNT.labels(method=method, endpoint=path, status=response.status_code).inc()
        REQUEST_LATENCY.labels(method=method, endpoint=path).observe(duration)

    return response


# Include routers
app.include_router(aircraft.router)
app.include_router(map.router)
app.include_router(history.router)
app.include_router(alerts.router)
app.include_router(safety.router)
app.include_router(notifications.router)
app.include_router(system.router)
app.include_router(aviation.router)
app.include_router(airframe.router)
app.include_router(acars.router)
app.include_router(audio.router)


# WebSocket endpoint for real-time data
@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    topics: str = Query(default="all", description="Comma-separated topics: aircraft,airspace,safety,acars,alerts,all")
):
    """
    WebSocket endpoint for real-time data streaming.

    Topics:
    - aircraft: Aircraft position updates, new/removed aircraft
    - airspace: Airspace advisories and boundary updates
    - safety: Safety events (TCAS, proximity alerts)
    - acars: ACARS/VDL2 messages
    - alerts: Triggered alert notifications
    - all: Receive all event types

    Message format:
    {
        "type": "event_type",
        "data": {...},
        "timestamp": "2024-01-15T12:00:00Z"
    }

    Client can send messages to subscribe/unsubscribe:
    {"action": "subscribe", "topics": ["aircraft", "airspace"]}
    {"action": "unsubscribe", "topics": ["acars"]}
    {"action": "ping"} -> receives {"type": "pong", ...}
    """
    topic_list = [t.strip() for t in topics.split(",") if t.strip()]
    await handle_websocket(websocket, topic_list)


# Root-level health endpoint for reverse proxies/load balancers
@app.get("/health")
async def root_health_check():
    """Simple health check endpoint at root level for load balancers."""
    return {"status": "ok"}


# Prometheus metrics endpoint
@app.get("/metrics", include_in_schema=False)
async def prometheus_metrics():
    """Expose Prometheus metrics."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


# Static files and frontend
@app.get("/")
async def serve_frontend():
    """Serve the React frontend."""
    static_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if os.path.exists(static_path):
        return FileResponse(static_path)
    return JSONResponse({"message": "ADS-B API v2.6.0", "docs": "/docs"})


# Mount Socket.IO ASGI app for real-time communication
# Socket.IO handles its own /socket.io path internally
app.mount("/socket.io", get_socketio_app())

# Mount static files if directories exist
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    assets_dir = os.path.join(static_dir, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=True
    )