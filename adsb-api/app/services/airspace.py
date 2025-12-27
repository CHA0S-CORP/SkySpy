"""
Airspace data service.

Fetches, stores, and caches airspace data including:
- Active advisories (G-AIRMETs) from Aviation Weather Center
- Static airspace boundaries (Class B/C/D, MOAs, Restricted)

Data is refreshed on a timer and stored in the database for historical lookup.
Falls back to cached data if fetch fails.

Updates are broadcast via WebSocket to connected clients.
"""
import asyncio
import logging
from datetime import datetime, timedelta
from math import radians, cos
from typing import Optional

import httpx
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import get_settings
from app.models import AirspaceAdvisory, AirspaceBoundary

logger = logging.getLogger(__name__)
settings = get_settings()

# WebSocket manager references (set during startup)
_ws_manager = None
_sio_manager = None

# API endpoints
AWC_BASE = "https://aviationweather.gov/api/data"

# Refresh intervals (seconds)
ADVISORY_REFRESH_INTERVAL = 300  # 5 minutes for active advisories
BOUNDARY_REFRESH_INTERVAL = 86400  # 24 hours for static boundaries

# In-memory cache for fast access (fallback if DB unavailable)
_advisory_cache: list[dict] = []
_advisory_cache_time: Optional[datetime] = None
_boundary_cache: list[dict] = []
_boundary_cache_time: Optional[datetime] = None

# Background task reference
_refresh_task: Optional[asyncio.Task] = None


async def fetch_awc_data(endpoint: str, params: dict) -> dict | list:
    """Fetch data from Aviation Weather Center API."""
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            response = await client.get(
                f"{AWC_BASE}/{endpoint}",
                params=params,
                headers={
                    "User-Agent": "SkySpyAPI/2.6 (aircraft-tracker)",
                    "Accept": "application/json",
                }
            )
            response.raise_for_status()
            return response.json() if response.text else []
        except httpx.HTTPStatusError as e:
            logger.error(f"AWC API error for {endpoint}: {e.response.status_code}")
            return {"error": str(e), "status": e.response.status_code}
        except Exception as e:
            logger.error(f"AWC API request failed for {endpoint}: {e}")
            return {"error": str(e)}


async def fetch_and_store_advisories(db: AsyncSession) -> int:
    """Fetch G-AIRMET advisories from AWC and store in database."""
    global _advisory_cache, _advisory_cache_time

    logger.debug("Fetching airspace advisories from AWC...")
    data = await fetch_awc_data("gairmet", {"format": "json"})

    if isinstance(data, dict) and "error" in data:
        logger.warning(f"Failed to fetch advisories: {data.get('error')}")
        return 0

    if not isinstance(data, list):
        logger.warning(f"Unexpected advisory data format: {type(data)}")
        return 0

    now = datetime.utcnow()
    new_advisories = []

    for g in data:
        advisory_id = g.get("tag") or f"GAIRMET-{g.get('hazard', 'UNK')}-{g.get('validTimeFrom', '')}"

        # Parse validity times
        valid_from = None
        valid_to = None
        if g.get("validTimeFrom"):
            try:
                valid_from = datetime.fromisoformat(g["validTimeFrom"].replace("Z", "+00:00")).replace(tzinfo=None)
            except (ValueError, TypeError):
                pass
        if g.get("validTimeTo"):
            try:
                valid_to = datetime.fromisoformat(g["validTimeTo"].replace("Z", "+00:00")).replace(tzinfo=None)
            except (ValueError, TypeError):
                pass

        # Extract polygon if available
        polygon = None
        if g.get("coords"):
            polygon = {"type": "Polygon", "coordinates": [g["coords"]]}

        # Parse altitude values (API may return strings)
        lower_alt = g.get("base") or g.get("altLow") or 0
        upper_alt = g.get("top") or g.get("altHi") or 0
        try:
            lower_alt = int(lower_alt) if lower_alt else 0
        except (ValueError, TypeError):
            lower_alt = 0
        try:
            upper_alt = int(upper_alt) if upper_alt else 0
        except (ValueError, TypeError):
            upper_alt = 0

        advisory = AirspaceAdvisory(
            fetched_at=now,
            advisory_id=advisory_id,
            advisory_type="GAIRMET",
            hazard=g.get("hazard"),
            severity=g.get("severity"),
            valid_from=valid_from,
            valid_to=valid_to,
            lower_alt_ft=lower_alt,
            upper_alt_ft=upper_alt,
            region=g.get("region"),
            polygon=polygon,
            raw_text=g.get("rawAirSigmet"),
            source_data=g,
        )
        new_advisories.append(advisory)

    if new_advisories:
        # Delete old advisories (older than 24 hours)
        cutoff = now - timedelta(hours=24)
        await db.execute(
            delete(AirspaceAdvisory).where(AirspaceAdvisory.fetched_at < cutoff)
        )

        # Add new advisories
        db.add_all(new_advisories)
        await db.commit()

        # Update in-memory cache
        _advisory_cache = [
            {
                "name": a.advisory_id,
                "type": a.advisory_type,
                "hazard": a.hazard,
                "severity": a.severity,
                "lower_alt": a.lower_alt_ft,
                "upper_alt": a.upper_alt_ft,
                "valid_from": a.valid_from.isoformat() if a.valid_from else None,
                "valid_to": a.valid_to.isoformat() if a.valid_to else None,
                "forecast_region": a.region,
                "raw_text": a.raw_text,
            }
            for a in new_advisories
        ]
        _advisory_cache_time = now

        logger.info(f"Stored {len(new_advisories)} airspace advisories")

        # Broadcast update via WebSocket and Socket.IO
        if _ws_manager:
            await _ws_manager.publish_advisory_update(_advisory_cache)
        if _sio_manager:
            await _sio_manager.publish_advisory_update(_advisory_cache)

    return len(new_advisories)


async def fetch_and_store_boundaries(db: AsyncSession) -> int:
    """
    Fetch static airspace boundaries and store in database.
    Uses embedded data as primary source (FAA data requires special access).
    """
    global _boundary_cache, _boundary_cache_time

    logger.debug("Refreshing airspace boundaries...")
    now = datetime.utcnow()

    # Import embedded data
    from app.data.airspace_boundaries import (
        CLASS_B_AIRSPACE, CLASS_C_AIRSPACE, CLASS_D_AIRSPACE, MOA_AIRSPACE
    )

    all_boundaries = [
        *CLASS_B_AIRSPACE,
        *CLASS_C_AIRSPACE,
        *CLASS_D_AIRSPACE,
        *MOA_AIRSPACE,
    ]

    new_boundaries = []
    for b in all_boundaries:
        center = b.get("center", {})

        # Convert polygon to GeoJSON format
        polygon = None
        if b.get("polygon"):
            polygon = {"type": "Polygon", "coordinates": [b["polygon"]]}

        boundary = AirspaceBoundary(
            fetched_at=now,
            name=b.get("name", "Unknown"),
            icao=b.get("icao"),
            airspace_class=b.get("class", "UNK"),
            floor_ft=b.get("floor_ft", 0),
            ceiling_ft=b.get("ceiling_ft", 0),
            center_lat=center.get("lat", 0),
            center_lon=center.get("lon", 0),
            radius_nm=b.get("radius_nm"),
            polygon=polygon,
            controlling_agency=b.get("controlling_agency"),
            schedule=b.get("schedule"),
            source="embedded",
            source_id=b.get("icao") or b.get("name"),
        )
        new_boundaries.append(boundary)

    if new_boundaries:
        # Clear old boundaries and insert new
        await db.execute(delete(AirspaceBoundary))
        db.add_all(new_boundaries)
        await db.commit()

        # Update in-memory cache
        _boundary_cache = [
            {
                "name": b.name,
                "icao": b.icao,
                "class": b.airspace_class,
                "floor_ft": b.floor_ft,
                "ceiling_ft": b.ceiling_ft,
                "center": {"lat": b.center_lat, "lon": b.center_lon},
                "radius_nm": b.radius_nm,
                "polygon": b.polygon.get("coordinates", [[]])[0] if b.polygon else None,
                "controlling_agency": b.controlling_agency,
                "schedule": b.schedule,
            }
            for b in new_boundaries
        ]
        _boundary_cache_time = now

        logger.info(f"Stored {len(new_boundaries)} airspace boundaries")

        # Broadcast update via WebSocket and Socket.IO
        if _ws_manager:
            await _ws_manager.publish_boundary_update(_boundary_cache)
        if _sio_manager:
            await _sio_manager.publish_boundary_update(_boundary_cache)

    return len(new_boundaries)


async def get_advisories(
    db: AsyncSession,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    hazard: Optional[str] = None,
) -> list[dict]:
    """Get active airspace advisories from database, falling back to cache."""
    now = datetime.utcnow()

    # Query active advisories (valid now or in near future)
    query = select(AirspaceAdvisory).where(
        (AirspaceAdvisory.valid_to >= now) | (AirspaceAdvisory.valid_to.is_(None))
    )

    if hazard:
        query = query.where(AirspaceAdvisory.hazard == hazard)

    result = await db.execute(query.order_by(AirspaceAdvisory.valid_from))
    advisories = result.scalars().all()

    if advisories:
        return [
            {
                "name": a.advisory_id,
                "type": a.advisory_type,
                "hazard": a.hazard,
                "severity": a.severity,
                "lower_alt": a.lower_alt_ft,
                "upper_alt": a.upper_alt_ft,
                "valid_from": a.valid_from.isoformat() if a.valid_from else None,
                "valid_to": a.valid_to.isoformat() if a.valid_to else None,
                "forecast_region": a.region,
                "raw_text": a.raw_text,
            }
            for a in advisories
        ]

    # Fallback to in-memory cache
    if _advisory_cache:
        logger.debug("Using cached advisories (database empty or unavailable)")
        filtered = _advisory_cache
        if hazard:
            filtered = [a for a in filtered if a.get("hazard") == hazard]
        return filtered

    return []


async def get_boundaries(
    db: AsyncSession,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_nm: float = 100,
    airspace_class: Optional[str] = None,
) -> list[dict]:
    """Get airspace boundaries from database, falling back to cache."""
    query = select(AirspaceBoundary)

    if airspace_class:
        query = query.where(AirspaceBoundary.airspace_class == airspace_class)

    # Filter by location if provided
    if lat is not None and lon is not None:
        # Approximate degrees per NM at given latitude
        nm_per_deg_lat = 60
        nm_per_deg_lon = 60 * abs(cos(radians(lat))) if lat else 60

        lat_range = radius_nm / nm_per_deg_lat
        lon_range = radius_nm / nm_per_deg_lon

        query = query.where(
            AirspaceBoundary.center_lat.between(lat - lat_range, lat + lat_range),
            AirspaceBoundary.center_lon.between(lon - lon_range, lon + lon_range),
        )

    result = await db.execute(query.order_by(AirspaceBoundary.airspace_class, AirspaceBoundary.name))
    boundaries = result.scalars().all()

    if boundaries:
        return [
            {
                "name": b.name,
                "icao": b.icao,
                "class": b.airspace_class,
                "floor_ft": b.floor_ft,
                "ceiling_ft": b.ceiling_ft,
                "center": {"lat": b.center_lat, "lon": b.center_lon},
                "radius_nm": b.radius_nm,
                "polygon": b.polygon.get("coordinates", [[]])[0] if b.polygon else None,
                "controlling_agency": b.controlling_agency,
                "schedule": b.schedule,
            }
            for b in boundaries
        ]

    # Fallback to in-memory cache
    if _boundary_cache:
        logger.debug("Using cached boundaries (database empty or unavailable)")
        filtered = _boundary_cache

        if airspace_class:
            filtered = [b for b in filtered if b.get("class") == airspace_class]

        if lat is not None and lon is not None:
            nm_per_deg_lat = 60
            nm_per_deg_lon = 60 * abs(cos(radians(lat))) if lat else 60
            lat_range = radius_nm / nm_per_deg_lat
            lon_range = radius_nm / nm_per_deg_lon

            filtered = [
                b for b in filtered
                if abs(b["center"]["lat"] - lat) <= lat_range
                and abs(b["center"]["lon"] - lon) <= lon_range
            ]

        return filtered

    return []


async def get_advisory_history(
    db: AsyncSession,
    start_time: datetime,
    end_time: Optional[datetime] = None,
    hazard: Optional[str] = None,
) -> list[dict]:
    """Get historical airspace advisories for a time range."""
    query = select(AirspaceAdvisory).where(AirspaceAdvisory.fetched_at >= start_time)

    if end_time:
        query = query.where(AirspaceAdvisory.fetched_at <= end_time)

    if hazard:
        query = query.where(AirspaceAdvisory.hazard == hazard)

    result = await db.execute(query.order_by(AirspaceAdvisory.fetched_at.desc()))
    advisories = result.scalars().all()

    return [
        {
            "name": a.advisory_id,
            "type": a.advisory_type,
            "hazard": a.hazard,
            "severity": a.severity,
            "lower_alt": a.lower_alt_ft,
            "upper_alt": a.upper_alt_ft,
            "valid_from": a.valid_from.isoformat() if a.valid_from else None,
            "valid_to": a.valid_to.isoformat() if a.valid_to else None,
            "forecast_region": a.region,
            "raw_text": a.raw_text,
            "fetched_at": a.fetched_at.isoformat(),
        }
        for a in advisories
    ]


async def refresh_airspace_data(session_factory: async_sessionmaker) -> None:
    """Refresh all airspace data."""
    async with session_factory() as db:
        await fetch_and_store_advisories(db)
        await fetch_and_store_boundaries(db)


async def airspace_refresh_task(session_factory: async_sessionmaker) -> None:
    """Background task to refresh airspace data on timers."""
    logger.info("Airspace refresh task started")

    last_advisory_refresh = datetime.min
    last_boundary_refresh = datetime.min

    while True:
        try:
            now = datetime.utcnow()

            # Check if advisory refresh is needed
            if (now - last_advisory_refresh).total_seconds() >= ADVISORY_REFRESH_INTERVAL:
                async with session_factory() as db:
                    await fetch_and_store_advisories(db)
                last_advisory_refresh = now

            # Check if boundary refresh is needed
            if (now - last_boundary_refresh).total_seconds() >= BOUNDARY_REFRESH_INTERVAL:
                async with session_factory() as db:
                    await fetch_and_store_boundaries(db)
                last_boundary_refresh = now

        except Exception as e:
            logger.error(f"Error in airspace refresh task: {e}")

        # Sleep for a short interval, then check timers again
        await asyncio.sleep(60)


def set_ws_manager(manager) -> None:
    """Set the WebSocket manager for broadcasting updates."""
    global _ws_manager
    _ws_manager = manager
    logger.info("Airspace service WebSocket manager configured")


def set_sio_manager(manager) -> None:
    """Set the Socket.IO manager for broadcasting updates."""
    global _sio_manager
    _sio_manager = manager
    logger.info("Airspace service Socket.IO manager configured")


async def start_refresh_task(session_factory: async_sessionmaker, ws_manager=None, sio_manager=None) -> asyncio.Task:
    """Start the background refresh task."""
    global _refresh_task, _ws_manager, _sio_manager

    # Set WebSocket manager if provided
    if ws_manager:
        _ws_manager = ws_manager

    # Set Socket.IO manager if provided
    if sio_manager:
        _sio_manager = sio_manager

    # Initial data load
    logger.info("Loading initial airspace data...")
    await refresh_airspace_data(session_factory)

    # Start background task
    _refresh_task = asyncio.create_task(airspace_refresh_task(session_factory))
    return _refresh_task


async def stop_refresh_task() -> None:
    """Stop the background refresh task."""
    global _refresh_task
    if _refresh_task:
        _refresh_task.cancel()
        try:
            await _refresh_task
        except asyncio.CancelledError:
            pass
        _refresh_task = None
        logger.info("Airspace refresh task stopped")
