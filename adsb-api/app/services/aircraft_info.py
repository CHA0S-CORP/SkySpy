"""
Aircraft information service.
Fetches and caches airframe data and photos from open sources.

Data sources:
- hexdb.io - Free aircraft database
- OpenSky Network - Aircraft metadata
- Planespotters.net - Aircraft photos (via their API)
- FlightAware - Aircraft info (if API key provided)
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_settings, safe_request
from app.models import AircraftInfo

logger = logging.getLogger(__name__)
settings = get_settings()

# Cache settings
CACHE_DURATION_HOURS = 168  # 7 days
FAILED_CACHE_HOURS = 24  # Retry failed lookups after 24 hours

# In-memory pending lookups to prevent duplicate requests
_pending_lookups: set[str] = set()

# Set of aircraft we've already seen (to trigger lookups only once)
_seen_aircraft: set[str] = set()

# Queue for background aircraft lookups
_lookup_queue: asyncio.Queue = None


async def get_aircraft_info(db: AsyncSession, icao_hex: str, force_refresh: bool = False) -> Optional[dict]:
    """
    Get aircraft information, from cache or fetch from external sources.
    
    Args:
        db: Database session
        icao_hex: ICAO hex code (e.g., "A12345")
        force_refresh: Force refresh from external sources
    
    Returns:
        Aircraft info dict or None if not found
    """
    icao_hex = icao_hex.upper().strip()
    
    if not icao_hex or len(icao_hex) < 6 or len(icao_hex) > 10:
        return None
    
    # Check database cache
    result = await db.execute(
        select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex)
    )
    cached = result.scalar_one_or_none()
    
    if cached and not force_refresh:
        # Check if cache is still valid
        cache_age = datetime.utcnow() - cached.updated_at
        max_age = timedelta(hours=FAILED_CACHE_HOURS if cached.fetch_failed else CACHE_DURATION_HOURS)
        
        if cache_age < max_age:
            return _model_to_dict(cached)
    
    # Prevent duplicate lookups
    if icao_hex in _pending_lookups:
        return _model_to_dict(cached) if cached else None
    
    _pending_lookups.add(icao_hex)
    
    try:
        # Fetch from external sources
        info = await _fetch_aircraft_info(icao_hex)
        
        if info:
            # Update or create cache entry
            if cached:
                for key, value in info.items():
                    if hasattr(cached, key) and value is not None:
                        setattr(cached, key, value)
                cached.updated_at = datetime.utcnow()
                cached.fetch_failed = False
            else:
                cached = AircraftInfo(icao_hex=icao_hex, **info)
                db.add(cached)
            
            await db.commit()
            return _model_to_dict(cached)
        else:
            # Mark as failed lookup
            if cached:
                cached.fetch_failed = True
                cached.updated_at = datetime.utcnow()
            else:
                cached = AircraftInfo(icao_hex=icao_hex, fetch_failed=True)
                db.add(cached)
            
            await db.commit()
            return None
    
    except Exception as e:
        logger.error(f"Error fetching aircraft info for {icao_hex}: {e}")
        await db.rollback()
        return _model_to_dict(cached) if cached else None
    
    finally:
        _pending_lookups.discard(icao_hex)


async def _fetch_aircraft_info(icao_hex: str) -> Optional[dict]:
    """Fetch aircraft info from local database first, then external sources."""
    from app.services import opensky_db
    
    info = {}
    
    # Try local OpenSky database first (fastest, no network)
    if settings.opensky_db_enabled and opensky_db.is_loaded():
        local_info = opensky_db.lookup(icao_hex)
        if local_info:
            info.update(local_info)
            logger.debug(f"Found {icao_hex} in local OpenSky database")
    
    # If we got basic info locally, only fetch photo
    if info.get("registration"):
        # Just need photo from planespotters
        photo_info = await _fetch_photo_from_planespotters(icao_hex)
        if photo_info:
            info.update(photo_info)
        return info
    
    # Fall back to external APIs if not in local DB
    # Try hexdb.io first (free, no API key required)
    hexdb_info = await _fetch_from_hexdb(icao_hex)
    if hexdb_info:
        info.update(hexdb_info)
    
    # Try to get photo from planespotters
    photo_info = await _fetch_photo_from_planespotters(icao_hex)
    if photo_info:
        info.update(photo_info)
    
    # Try OpenSky Network API for additional data
    opensky_info = await _fetch_from_opensky(icao_hex)
    if opensky_info:
        # Only update fields that aren't already set
        for key, value in opensky_info.items():
            if key not in info or info[key] is None:
                info[key] = value
    
    return info if info else None


async def _fetch_from_hexdb(icao_hex: str) -> Optional[dict]:
    """Fetch from hexdb.io - free aircraft database."""
    try:
        url = f"https://hexdb.io/api/v1/aircraft/{icao_hex}"
        data = await safe_request(url)
        
        if not data:
            return None
        
        return {
            "registration": data.get("Registration"),
            "type_code": data.get("ICAOTypeCode"),
            "type_name": data.get("Type"),
            "manufacturer": data.get("Manufacturer"),
            "model": data.get("Type"),
            "serial_number": data.get("SerialNumber"),
            "year_built": _parse_int(data.get("YearBuilt")),
            "operator": data.get("RegisteredOwners"),
            "operator_icao": data.get("OperatorFlagCode"),
            "country": data.get("Country"),
            "is_military": data.get("IsMilitary", False),
            "category": data.get("Category"),
        }
    except Exception as e:
        logger.debug(f"hexdb.io lookup failed for {icao_hex}: {e}")
        return None


async def _fetch_from_opensky(icao_hex: str) -> Optional[dict]:
    """Fetch from OpenSky Network aircraft database."""
    try:
        url = f"https://opensky-network.org/api/metadata/aircraft/icao/{icao_hex}"
        data = await safe_request(url)
        
        if not data:
            return None
        
        return {
            "registration": data.get("registration"),
            "type_code": data.get("typecode"),
            "manufacturer": data.get("manufacturerName"),
            "model": data.get("model"),
            "serial_number": data.get("serialNumber"),
            "operator": data.get("owner"),
            "operator_icao": data.get("operatorIcao"),
            "country": data.get("country"),
            "is_military": "military" in data.get("categoryDescription", "").lower(),
        }
    except Exception as e:
        logger.debug(f"OpenSky lookup failed for {icao_hex}: {e}")
        return None


async def _fetch_photo_from_planespotters(icao_hex: str) -> Optional[dict]:
    """Fetch photo from planespotters.net API."""
    try:
        url = f"https://api.planespotters.net/pub/photos/hex/{icao_hex}"
        data = await safe_request(url)
        
        if not data or "photos" not in data or not data["photos"]:
            return None
        
        photo = data["photos"][0]
        
        # Debug: log what keys are available
        logger.debug(f"Planespotters response keys for {icao_hex}: {list(photo.keys())}")
        
        # Get thumbnail URLs (these usually work reliably)
        thumbnail_url = (
            photo.get("thumbnail_large", {}).get("src") or 
            photo.get("thumbnail", {}).get("src")
        )
        
        # For full-size image, planespotters API typically only provides thumbnails
        # The "link" field is a webpage URL, not a direct image
        # Use thumbnail_large as the "full" image since it's highest quality available via API
        photo_url = photo.get("thumbnail_large", {}).get("src")
        if not photo_url:
            photo_url = thumbnail_url
        
        logger.debug(f"Planespotters for {icao_hex}: photo_url={photo_url}, thumbnail={thumbnail_url}")
        
        return {
            "photo_url": photo_url,
            "photo_thumbnail_url": thumbnail_url,
            "photo_photographer": photo.get("photographer"),
            "photo_source": "planespotters.net",
        }
    except Exception as e:
        logger.debug(f"Planespotters lookup failed for {icao_hex}: {e}")
        return None


def _model_to_dict(model: AircraftInfo) -> dict:
    """Convert AircraftInfo model to dict."""
    if not model:
        return None
    
    # Calculate age if year_built is available
    age = None
    if model.year_built:
        age = datetime.utcnow().year - model.year_built
    
    return {
        "icao_hex": model.icao_hex,
        "registration": model.registration,
        "type_code": model.type_code,
        "type_name": model.type_name,
        "manufacturer": model.manufacturer,
        "model": model.model,
        "serial_number": model.serial_number,
        "year_built": model.year_built,
        "age_years": age,
        "first_flight_date": model.first_flight_date,
        "delivery_date": model.delivery_date,
        "airframe_hours": model.airframe_hours,
        "operator": model.operator,
        "operator_icao": model.operator_icao,
        "operator_callsign": model.operator_callsign,
        "owner": model.owner,
        "country": model.country,
        "country_code": model.country_code,
        "category": model.category,
        "is_military": model.is_military,
        "photo_url": model.photo_url,
        "photo_thumbnail_url": model.photo_thumbnail_url,
        "photo_photographer": model.photo_photographer,
        "photo_source": model.photo_source,
        "photo_local_path": model.photo_local_path,
        "photo_thumbnail_local_path": model.photo_thumbnail_local_path,
        "extra_data": model.extra_data,
        "cached_at": model.updated_at.isoformat() + "Z" if model.updated_at else None,
        "fetch_failed": model.fetch_failed,
    }


def _parse_int(value) -> Optional[int]:
    """Safely parse an integer."""
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


async def get_bulk_aircraft_info(db: AsyncSession, icao_hexes: list[str]) -> dict[str, dict]:
    """
    Get aircraft info for multiple aircraft.
    Returns dict mapping icao_hex to info.
    """
    result = {}
    
    # Get all cached entries
    cached_result = await db.execute(
        select(AircraftInfo).where(AircraftInfo.icao_hex.in_([h.upper() for h in icao_hexes]))
    )
    
    for cached in cached_result.scalars():
        result[cached.icao_hex] = _model_to_dict(cached)
    
    return result


async def refresh_aircraft_info(db: AsyncSession, icao_hex: str) -> Optional[dict]:
    """Force refresh aircraft info from external sources."""
    return await get_aircraft_info(db, icao_hex, force_refresh=True)


async def get_info_cache_stats(db: AsyncSession) -> dict:
    """Get statistics about the aircraft info cache."""
    from sqlalchemy import func
    from app.services.photo_cache import get_cache_stats as get_photo_cache_stats
    
    total = (await db.execute(select(func.count(AircraftInfo.id)))).scalar()
    failed = (await db.execute(
        select(func.count(AircraftInfo.id)).where(AircraftInfo.fetch_failed == True)
    )).scalar()
    with_photos = (await db.execute(
        select(func.count(AircraftInfo.id)).where(AircraftInfo.photo_url.isnot(None))
    )).scalar()
    with_local_photos = (await db.execute(
        select(func.count(AircraftInfo.id)).where(AircraftInfo.photo_local_path.isnot(None))
    )).scalar()
    
    photo_cache = get_photo_cache_stats()
    
    return {
        "total_cached": total,
        "failed_lookups": failed,
        "with_photos": with_photos,
        "with_local_photos": with_local_photos,
        "cache_duration_hours": CACHE_DURATION_HOURS,
        "retry_after_hours": FAILED_CACHE_HOURS,
        "photo_cache": photo_cache,
    }


# ========== New Aircraft Auto-Lookup System ==========

async def init_lookup_queue():
    """Initialize the background lookup queue."""
    global _lookup_queue
    _lookup_queue = asyncio.Queue()
    logger.info("Aircraft lookup queue initialized")


def is_new_aircraft(icao_hex: str) -> bool:
    """Check if this aircraft has been seen before in this session."""
    icao_hex = icao_hex.upper()
    if icao_hex in _seen_aircraft:
        return False
    _seen_aircraft.add(icao_hex)
    return True


def get_seen_aircraft_count() -> int:
    """Get count of unique aircraft seen this session."""
    return len(_seen_aircraft)


def clear_seen_aircraft():
    """Clear the seen aircraft set (for testing or reset)."""
    _seen_aircraft.clear()


async def queue_aircraft_lookup(icao_hex: str):
    """Add an aircraft to the background lookup queue."""
    global _lookup_queue
    if _lookup_queue is not None:
        icao_hex = icao_hex.upper()
        # Skip TIS-B aircraft (prefixed with ~)
        if icao_hex.startswith("~"):
            return
        await _lookup_queue.put(icao_hex)
        logger.debug(f"Queued lookup for {icao_hex}")


async def process_lookup_queue(db_session_factory):
    """
    Background task to process aircraft lookups.
    Fetches info and downloads photos for new aircraft.
    """
    global _lookup_queue
    
    if _lookup_queue is None:
        await init_lookup_queue()
    
    logger.info("Aircraft lookup queue processor started")
    
    # Import here to avoid circular imports
    from app.services.photo_cache import download_photo
    
    while True:
        try:
            # Get next aircraft (wait up to 5 seconds)
            try:
                icao_hex = await asyncio.wait_for(_lookup_queue.get(), timeout=5.0)
            except asyncio.TimeoutError:
                continue
            
            logger.info(f"Processing lookup for {icao_hex}")
            
            async with db_session_factory() as db:
                # Fetch aircraft info (this also caches it)
                info = await get_aircraft_info(db, icao_hex)
                
                if info and settings.photo_cache_enabled:
                    # Download photos in background
                    photo_url = info.get("photo_url")
                    thumb_url = info.get("photo_thumbnail_url")
                    
                    if photo_url:
                        photo_path = await download_photo(photo_url, icao_hex, is_thumbnail=False)
                        if photo_path:
                            # Update database with local path
                            result = await db.execute(
                                select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex)
                            )
                            cached = result.scalar_one_or_none()
                            if cached:
                                cached.photo_local_path = str(photo_path)
                                await db.commit()
                                logger.info(f"Cached photo for {icao_hex}: {photo_path}")
                    
                    if thumb_url:
                        thumb_path = await download_photo(thumb_url, icao_hex, is_thumbnail=True)
                        if thumb_path:
                            result = await db.execute(
                                select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex)
                            )
                            cached = result.scalar_one_or_none()
                            if cached:
                                cached.photo_thumbnail_local_path = str(thumb_path)
                                await db.commit()
            
            _lookup_queue.task_done()
            
            # Rate limit: wait between lookups to avoid hammering external APIs
            await asyncio.sleep(1.0)
        
        except asyncio.CancelledError:
            logger.info("Aircraft lookup queue processor stopping")
            break
        except Exception as e:
            logger.error(f"Error in lookup queue processor: {e}")
            await asyncio.sleep(2)


async def check_and_queue_new_aircraft(icao_hex: str):
    """
    Check if aircraft is new and queue for lookup if so.
    Call this from the main aircraft processing loop.
    """
    if is_new_aircraft(icao_hex):
        await queue_aircraft_lookup(icao_hex)

