"""
System status and health API endpoints.

Provides system health checks, status information, and API documentation.
"""
import os
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_settings, get_db, safe_request
from app.models import (
    AircraftSighting, AircraftSession, AlertRule, AlertHistory, SafetyEvent
)
from app.services.sse import get_sse_manager
from app.services.safety import safety_monitor
from app.services.notifications import notifier
from app.services.acars import acars_service
from app.services.photo_cache import get_cache_stats as get_photo_cache_stats
from app.services.aircraft_info import get_seen_aircraft_count
from app.services import opensky_db
from app.schemas import HealthResponse, StatusResponse, ApiInfoResponse

router = APIRouter(prefix="/api/v1", tags=["System"])
settings = get_settings()

# Module-level scheduler state (set by main.py)
_scheduler_state = {
    "running": False,
    "jobs": []
}

def set_scheduler_state(running: bool, jobs: list):
    """Update scheduler state (called from main.py)."""
    global _scheduler_state
    _scheduler_state = {"running": running, "jobs": jobs}

# Fake scheduler object for compatibility
class _SchedulerProxy:
    @property
    def running(self):
        return _scheduler_state["running"]
    
    def get_jobs(self):
        return []

scheduler = _SchedulerProxy()


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health Check",
    description="""
Check the health status of all system components.

Checks:
- **database**: PostgreSQL connection and latency
- **ultrafeeder**: ADS-B data source availability
- **redis**: Redis cache connection (if configured)
- **sse**: Server-Sent Events service status
- **acars**: ACARS receiver service (if enabled)

Returns overall status:
- `healthy`: All services operational
- `degraded`: Some services have issues
- `unhealthy`: Critical services unavailable
    """,
    responses={
        200: {
            "description": "Health check results",
            "content": {
                "application/json": {
                    "example": {
                        "status": "healthy",
                        "services": {
                            "database": {"status": "up", "latency_ms": 2.5},
                            "ultrafeeder": {"status": "up", "aircraft_count": 45},
                            "redis": {"status": "up"},
                            "sse": {"status": "up", "subscribers": 3},
                            "acars": {"status": "up", "messages_last_hour": 523}
                        },
                        "timestamp": "2024-12-21T12:00:00Z"
                    }
                }
            }
        }
    }
)
async def health_check(db: AsyncSession = Depends(get_db)):
    """Comprehensive health check of all services."""
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
        url = f"{settings.ultrafeeder_url}/tar1090/data/aircraft.json"
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
    if sse_manager._using_redis:
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
    try:
        subscriber_count = await sse_manager.get_subscriber_count()
        services["sse"] = {
            "status": "up",
            "subscribers": subscriber_count,
            "mode": "redis" if sse_manager._using_redis else "memory"
        }
    except Exception as e:
        services["sse"] = {"status": "error", "error": str(e)}
    
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


@router.get(
    "/status",
    response_model=StatusResponse,
    summary="System Status",
    description="""
Get comprehensive system status and statistics.

Returns detailed information about:
- API version and configuration
- Data source connectivity
- Database record counts
- Alert and safety monitoring status
- SSE streaming status
- ACARS service status
- Scheduler status
- Resource usage
    """,
    responses={
        200: {
            "description": "System status",
            "content": {
                "application/json": {
                    "example": {
                        "version": "2.6.0",
                        "adsb_online": True,
                        "aircraft_count": 45,
                        "total_sightings": 152340,
                        "total_sessions": 4567,
                        "active_rules": 5,
                        "alert_history_count": 234,
                        "safety_event_count": 12,
                        "safety_monitoring_enabled": True,
                        "acars_enabled": True,
                        "acars_running": True,
                        "notifications_configured": True,
                        "sse_subscribers": 3,
                        "worker_pid": 12345
                    }
                }
            }
        }
    }
)
async def get_status(db: AsyncSession = Depends(get_db)):
    """Get comprehensive system status."""
    # ADS-B source check
    url = f"{settings.ultrafeeder_url}/tar1090/data/aircraft.json"
    data = await safe_request(url, timeout=5)
    adsb_online = data is not None
    aircraft_count = len(data.get("aircraft", [])) if data else 0
    
    # Database counts
    sightings = (await db.execute(select(func.count(AircraftSighting.id)))).scalar()
    sessions = (await db.execute(select(func.count(AircraftSession.id)))).scalar()
    active_rules = (await db.execute(
        select(func.count(AlertRule.id)).where(AlertRule.enabled == True)
    )).scalar()
    alert_history = (await db.execute(select(func.count(AlertHistory.id)))).scalar()
    safety_events = (await db.execute(select(func.count(SafetyEvent.id)))).scalar()
    
    # SSE status
    sse_manager = get_sse_manager()
    sse_subscribers = await sse_manager.get_subscriber_count()
    
    # ACARS status
    acars_stats = acars_service.get_stats()
    
    # Scheduler status
    scheduler_running = _scheduler_state["running"]
    scheduler_jobs = _scheduler_state["jobs"]
    
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
        "redis_enabled": sse_manager._using_redis,
        "sse_subscribers": sse_subscribers,
        "sse_tracked_aircraft": len(sse_manager._last_aircraft_state),
        "sse_redis_enabled": sse_manager._using_redis,
        "acars_enabled": settings.acars_enabled,
        "acars_running": acars_stats["running"],
        "polling_interval_seconds": settings.polling_interval,
        "db_store_interval_seconds": settings.db_store_interval,
        "scheduler_running": scheduler_running,
        "scheduler_jobs": scheduler_jobs,
        "worker_pid": os.getpid(),
        "location": {
            "lat": settings.feeder_lat,
            "lon": settings.feeder_lon
        }
    }


@router.get(
    "/",
    response_model=ApiInfoResponse,
    summary="API Information",
    description="""
Get API information and available endpoints.

Returns the API version, name, description, and a categorized
list of all available endpoints with their purposes.
    """,
    responses={
        200: {
            "description": "API information",
            "content": {
                "application/json": {
                    "example": {
                        "version": "2.6.0",
                        "name": "ADS-B FastAPI",
                        "description": "Real-time aircraft tracking API",
                        "endpoints": {
                            "aircraft": ["GET /api/v1/aircraft"],
                            "alerts": ["GET /api/v1/alerts/rules"]
                        }
                    }
                }
            }
        }
    }
)
async def api_info():
    """Get API information and endpoint overview."""
    return {
        "version": "2.6.0",
        "name": "ADS-B FastAPI",
        "description": "Real-time aircraft tracking API with alerting, safety monitoring, and ACARS support",
        "documentation": "/docs",
        "endpoints": {
            "aircraft": [
                "GET /api/v1/aircraft - List all tracked aircraft",
                "GET /api/v1/aircraft/top - Top aircraft by category",
                "GET /api/v1/aircraft/stats - Aircraft statistics",
                "GET /api/v1/aircraft/{hex} - Get specific aircraft",
            ],
            "aircraft_info": [
                "GET /api/v1/aircraft/{hex}/info - Aircraft registration/airframe info",
                "GET /api/v1/aircraft/{hex}/photo - Aircraft photos",
                "POST /api/v1/aircraft/info/bulk - Bulk info lookup",
            ],
            "map": [
                "GET /api/v1/map/geojson - GeoJSON aircraft data",
                "GET /api/v1/map/sse - SSE live stream",
            ],
            "alerts": [
                "GET /api/v1/alerts/rules - List alert rules",
                "POST /api/v1/alerts/rules - Create alert rule",
                "GET /api/v1/alerts/history - Alert history",
            ],
            "safety": [
                "GET /api/v1/safety/events - Safety events",
                "GET /api/v1/safety/stats - Safety statistics",
                "GET /api/v1/safety/monitor/status - Monitor status",
            ],
            "acars": [
                "GET /api/v1/acars/messages - ACARS messages",
                "GET /api/v1/acars/stats - ACARS statistics",
                "GET /api/v1/acars/status - Service status",
            ],
            "aviation": [
                "GET /api/v1/aviation/metar/{station} - METAR weather",
                "GET /api/v1/aviation/taf/{station} - TAF forecast",
                "GET /api/v1/aviation/airport/{icao} - Airport info",
            ],
            "history": [
                "GET /api/v1/history/sightings - Historical sightings",
                "GET /api/v1/history/sessions - Tracking sessions",
                "GET /api/v1/history/stats - Historical statistics",
            ],
            "notifications": [
                "GET /api/v1/notifications/config - Get config",
                "PUT /api/v1/notifications/config - Update config",
                "POST /api/v1/notifications/test - Test notifications",
            ],
            "system": [
                "GET /api/v1/health - Health check",
                "GET /api/v1/status - System status",
            ],
        }
    }


@router.get(
    "/config",
    summary="Get Configuration",
    description="""
Get the current API configuration (non-sensitive values).

Returns:
- Feeder location
- Polling intervals
- Feature flags
- Service endpoints (masked)
    """,
    responses={
        200: {
            "description": "Configuration values",
            "content": {
                "application/json": {
                    "example": {
                        "feeder_lat": 47.6062,
                        "feeder_lon": -122.3321,
                        "poll_interval": 2,
                        "db_store_interval": 10,
                        "acars_enabled": True,
                        "safety_enabled": True
                    }
                }
            }
        }
    }
)
async def get_config():
    """Get current configuration (non-sensitive)."""
    return {
        "feeder_lat": settings.feeder_lat,
        "feeder_lon": settings.feeder_lon,
        "poll_interval": settings.polling_interval,
        "db_store_interval": settings.db_store_interval,
        "session_timeout_minutes": settings.session_timeout_minutes,
        "acars_enabled": settings.acars_enabled,
        "acars_port": settings.acars_port if settings.acars_enabled else None,
        "vdlm2_port": settings.vdlm2_port if settings.acars_enabled else None,
        "ultrafeeder_url": settings.ultrafeeder_url.split("//")[0] + "//****" if "//" in settings.ultrafeeder_url else "****",
        "photo_cache_enabled": settings.photo_cache_enabled,
        "photo_cache_dir": settings.photo_cache_dir,
    }


@router.get(
    "/photos/cache",
    summary="Get Photo Cache Statistics",
    description="""
Get statistics about the local aircraft photo cache.

Returns:
- **enabled**: Whether photo caching is enabled
- **cache_dir**: Directory where photos are stored
- **total_photos**: Number of full-size photos cached
- **total_thumbnails**: Number of thumbnail images cached
- **total_size_mb**: Total disk space used by cached photos
- **unique_aircraft_seen**: Number of unique aircraft seen this session
    """,
    responses={
        200: {
            "description": "Photo cache statistics",
            "content": {
                "application/json": {
                    "example": {
                        "enabled": True,
                        "cache_dir": "/data/photos",
                        "total_photos": 1234,
                        "total_thumbnails": 1200,
                        "total_size_mb": 456.78,
                        "unique_aircraft_seen": 5678
                    }
                }
            }
        }
    }
)
async def get_photo_cache_status():
    """Get photo cache statistics."""
    stats = get_photo_cache_stats()
    stats["unique_aircraft_seen"] = get_seen_aircraft_count()
    return stats


@router.get(
    "/opensky/stats",
    summary="Get OpenSky Database Statistics",
    description="""
Get statistics about the local OpenSky aircraft database.

The OpenSky database provides offline aircraft information lookups,
reducing external API calls and improving response times.

**To populate the database:**
1. Download from: https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2025-08.csv
2. Place in `/data/opensky/aircraft-database.csv`
3. Restart the API

Returns:
- **loaded**: Whether the database is loaded
- **total_aircraft**: Number of aircraft in the database
- **db_path**: Path to the database file
    """,
    responses={
        200: {
            "description": "OpenSky database statistics",
            "content": {
                "application/json": {
                    "example": {
                        "loaded": True,
                        "total_aircraft": 600000,
                        "db_path": "/data/opensky/aircraft-database.csv"
                    }
                }
            }
        }
    }
)
async def get_opensky_db_status():
    """Get OpenSky database statistics."""
    return opensky_db.get_stats()


@router.get(
    "/opensky/lookup/{icao_hex}",
    summary="Lookup Aircraft in OpenSky Database",
    description="""
Look up an aircraft directly in the local OpenSky database.

This is a fast, offline lookup that doesn't hit external APIs.
Returns None if the aircraft is not in the local database.
    """,
    responses={
        200: {
            "description": "Aircraft information from local database",
        },
        404: {
            "description": "Aircraft not found in local database"
        }
    }
)
async def opensky_lookup(icao_hex: str):
    """Look up aircraft in local OpenSky database."""
    from fastapi import HTTPException
    
    if not opensky_db.is_loaded():
        raise HTTPException(status_code=503, detail="OpenSky database not loaded")
    
    info = opensky_db.lookup(icao_hex)
    if not info:
        raise HTTPException(status_code=404, detail=f"Aircraft {icao_hex.upper()} not found in local database")
    
    return {
        "icao_hex": icao_hex.upper(),
        "source": "opensky_local",
        **info
    }
