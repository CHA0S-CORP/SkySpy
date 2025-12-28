"""
ADS-B Feeder Metrics API v2.6.0

A FastAPI application for tracking aircraft via ADS-B with PostgreSQL
historical data, alert rules, safety monitoring, and Apprise notifications.
"""
import asyncio
import logging
import os
import time
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Request, WebSocket, Query
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
from app.core.database import AsyncSessionLocal
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
from app.services import opensky_db
from app.services import airspace as airspace_service
from app.services import audio as audio_service
from app.routers import aircraft, map, history, alerts, safety, notifications, system, aviation, airframe, acars, audio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()

# Track DB store timing
_last_db_store_time = 0
_db_store_lock = threading.Lock()

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
    """Process aircraft data and store to database."""
    if not aircraft_list:
        return
    
    now = datetime.utcnow()
    sse_manager = get_sse_manager()
    
    for ac in aircraft_list:
        icao = ac.get("hex", "").upper()
        if not icao:
            continue
        
        # Queue new aircraft for info/photo lookup
        await check_and_queue_new_aircraft(icao)
        
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
        
        # Create sighting
        sighting = AircraftSighting(
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
            rssi=ac.get("rssi"),
            category=ac.get("category"),
            aircraft_type=ac.get("t"),
            is_military=is_military,
            is_emergency=is_emergency,
            source=source
        )
        db.add(sighting)
        
        # Update or create session
        session_key = f"{icao}:{source}"
        cached_session_id = _active_sessions.get(session_key)
        
        if cached_session_id:
            # Update existing session
            result = await db.execute(
                select(AircraftSession).where(AircraftSession.id == cached_session_id)
            )
            existing = result.scalar_one_or_none()
            if existing:
                existing.last_seen = now
                existing.total_positions += 1
                if callsign:
                    existing.callsign = callsign
                if alt_baro is not None:
                    if existing.min_altitude is None or alt_baro < existing.min_altitude:
                        existing.min_altitude = alt_baro
                    if existing.max_altitude is None or alt_baro > existing.max_altitude:
                        existing.max_altitude = alt_baro
                if vr is not None and (existing.max_vertical_rate is None or abs(vr) > existing.max_vertical_rate):
                    existing.max_vertical_rate = abs(vr)
                if distance_nm is not None:
                    if existing.min_distance_nm is None or distance_nm < existing.min_distance_nm:
                        existing.min_distance_nm = distance_nm
                    if existing.max_distance_nm is None or distance_nm > existing.max_distance_nm:
                        existing.max_distance_nm = distance_nm
                rssi = ac.get("rssi")
                if rssi is not None:
                    if existing.min_rssi is None or rssi < existing.min_rssi:
                        existing.min_rssi = rssi
                    if existing.max_rssi is None or rssi > existing.max_rssi:
                        existing.max_rssi = rssi
            else:
                _active_sessions.pop(session_key, None)
        
        if session_key not in _active_sessions:
            # Look for recent session or create new
            result = await db.execute(
                select(AircraftSession).where(
                    AircraftSession.icao_hex == icao,
                    AircraftSession.last_seen > now - timedelta(minutes=5)
                )
            )
            recent = result.scalar_one_or_none()
            
            if recent:
                _active_sessions[session_key] = recent.id
                recent.last_seen = now
                recent.total_positions += 1
            else:
                # New session
                rssi = ac.get("rssi")
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
                
                # Check alerts for new aircraft
                alerts_list = await check_alerts(db, ac, distance_nm)
                for alert in alerts_list:
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


async def fetch_and_process_aircraft():
    """Fetch and process aircraft data."""
    global _last_db_store_time
    
    all_aircraft = []
    
    # Fetch from 1090MHz
    try:
        url = f"{settings.ultrafeeder_url}/tar1090/data/aircraft.json"
        data = await safe_request(url)
        if data:
            aircraft_1090 = data.get("aircraft", [])
            all_aircraft.extend(aircraft_1090)
            logger.debug(f"Fetched {len(aircraft_1090)} aircraft from 1090MHz")
    except Exception as e:
        logger.warning(f"Failed to fetch 1090 data: {e}")
    
    # Fetch from 978MHz
    try:
        url = f"{settings.dump978_url}/data/aircraft.json"
        data = await safe_request(url)
        if data:
            aircraft_978 = data.get("aircraft", [])
            all_aircraft.extend(aircraft_978)
    except Exception as e:
        logger.debug(f"Failed to fetch 978 data: {e}")
    
    # Store to database periodically
    now = time.time()
    should_store_db = False
    
    with _db_store_lock:
        if (now - _last_db_store_time) >= settings.db_store_interval:
            _last_db_store_time = now
            should_store_db = True
    
    if all_aircraft and should_store_db:
        async with AsyncSessionLocal() as db:
            try:
                await process_aircraft_data(db, all_aircraft, "1090")
                logger.debug(f"Stored {len(all_aircraft)} aircraft to database")
            except Exception as e:
                logger.error(f"Error in process_aircraft_data: {e}")
                await db.rollback()
    
    # Safety monitoring
    sse_manager = get_sse_manager()
    sio_manager = get_socketio_manager()
    if all_aircraft and safety_monitor.enabled:
        try:
            safety_events = safety_monitor.update_aircraft(all_aircraft)

            if safety_events:
                async with AsyncSessionLocal() as db:
                    for event in safety_events:
                        db_id = await store_safety_event(db, event)
                        if db_id:
                            event["db_id"] = db_id  # Store as db_id, not id (id is the string event ID)

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
    
    # Always publish SSE and Socket.IO updates
    await sse_manager.publish_aircraft_update(all_aircraft)
    if sio_manager:
        await sio_manager.publish_aircraft_update(all_aircraft)


async def background_polling_task():
    """Background task for polling aircraft data."""
    logger.info(f"Background polling started (interval: {settings.polling_interval}s)")
    
    while True:
        try:
            await fetch_and_process_aircraft()
        except Exception as e:
            logger.error(f"Error in background polling: {e}")
        
        await asyncio.sleep(settings.polling_interval)


async def cleanup_old_sessions():
    """Clean up stale session references."""
    now = datetime.utcnow()
    stale_keys = []
    
    async with AsyncSessionLocal() as db:
        for k, sid in list(_active_sessions.items()):
            result = await db.execute(
                select(AircraftSession).where(AircraftSession.id == sid)
            )
            session = result.scalar_one_or_none()
            if session and session.last_seen < now - timedelta(minutes=10):
                stale_keys.append(k)
            elif not session:
                stale_keys.append(k)
    
    for k in stale_keys:
        _active_sessions.pop(k, None)
    
    if stale_keys:
        logger.debug(f"Cleaned up {len(stale_keys)} stale sessions")


async def session_cleanup_task():
    """Background task for cleaning up sessions."""
    while True:
        await asyncio.sleep(300)  # Every 5 minutes
        try:
            await cleanup_old_sessions()
        except Exception as e:
            logger.error(f"Error cleaning sessions: {e}")


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
    
    # Load OpenSky aircraft database
    if settings.opensky_db_enabled:
        db_loaded = await opensky_db.load_database()
        if db_loaded:
            stats = opensky_db.get_stats()
            logger.info(f"OpenSky database loaded: {stats['total_aircraft']:,} aircraft")
        else:
            logger.warning("OpenSky database not found - will use external APIs only")
    
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

    # Start audio transcription queue if enabled
    transcription_task = None
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

    # Stop transcription queue
    if transcription_task:
        transcription_task.cancel()
        try:
            await transcription_task
        except asyncio.CancelledError:
            pass

    # Stop airspace refresh service
    await airspace_service.stop_refresh_task()

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

# Mount static files if directory exists
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=True
    )
