"""
Aircraft information service.
Fetches and caches airframe data and photos from open sources.

Data Sources (in priority order):

1. hexdb.io (PRIMARY)
   - Aircraft info: registration, type, manufacturer, operator, etc.
   - Full-size photos via direct URLs
   - API: https://hexdb.io/api/v1/aircraft/{hex}
   - Photos: https://hexdb.io/hex-image?hex={hex}
   - Thumbnails: https://hexdb.io/hex-image-thumb?hex={hex}

2. Local OpenSky Database (SUPPLEMENTARY)
   - ~600k aircraft from OpenSky Network CSV
   - Fast offline lookup, no network required
   - Downloaded via scripts/download-opensky-db.sh

3. OpenSky Network API (FALLBACK)
   - Online API for aircraft not in local DB
   - API: https://opensky-network.org/api/metadata/aircraft/icao/{hex}

4. Planespotters.net (PHOTO FALLBACK)
   - Larger thumbnails (~640px) via public API
   - API: https://api.planespotters.net/pub/photos/hex/{hex}

5. airport-data.com (PHOTO FALLBACK)
   - Small thumbnails (200px)
   - API: https://airport-data.com/api/ac_thumb.json?m={hex}

Network Requirements:
   If using egress filtering, allow: hexdb.io, api.planespotters.net,
   airport-data.com, opensky-network.org
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

import httpx
import sentry_sdk
from prometheus_client import Counter, Histogram, Gauge
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_settings, safe_request
from app.models import AircraftInfo

logger = logging.getLogger(__name__)
settings = get_settings()

# =============================================================================
# Prometheus Metrics
# =============================================================================

AIRFRAME_LOOKUP_TOTAL = Counter(
    "skyspy_airframe_lookup_total",
    "Total airframe lookups",
    ["source", "status"]
)

AIRFRAME_LOOKUP_DURATION = Histogram(
    "skyspy_airframe_lookup_duration_seconds",
    "Airframe lookup duration in seconds",
    ["source"],
    buckets=[0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0]
)

AIRFRAME_CACHE_HITS = Counter(
    "skyspy_airframe_cache_hits_total",
    "Total airframe cache hits"
)

AIRFRAME_CACHE_MISSES = Counter(
    "skyspy_airframe_cache_misses_total",
    "Total airframe cache misses"
)

AIRFRAME_QUEUE_SIZE = Gauge(
    "skyspy_airframe_queue_size",
    "Current size of airframe lookup queue"
)

AIRFRAME_LOOKUP_ERRORS = Counter(
    "skyspy_airframe_lookup_errors_total",
    "Total airframe lookup errors",
    ["source", "error_type"]
)

# Cache settings
CACHE_DURATION_HOURS = 168  # 7 days
FAILED_CACHE_HOURS = 24  # Retry failed lookups after 24 hours
API_LOOKUP_COOLDOWN_SECONDS = 3600  # Only call external APIs once per hour per aircraft
SEEN_AIRCRAFT_MAX_AGE_HOURS = 6  # Clear seen aircraft older than this
PENDING_LOOKUP_TIMEOUT_SECONDS = 300  # Clear stuck pending lookups after 5 minutes

# In-memory pending lookups to prevent duplicate requests
# Now stores (icao, timestamp) to detect stuck lookups
_pending_lookups: dict[str, float] = {}

# Track last API lookup time per aircraft (rate limiting)
_last_api_lookup: dict[str, float] = {}

# Track when aircraft were first seen (for TTL cleanup)
_seen_aircraft_times: dict[str, float] = {}


def _can_lookup_api(icao_hex: str) -> bool:
    """Check if we can call external APIs for this aircraft (rate limited to once per hour)."""
    import time
    icao_hex = icao_hex.upper()
    now = time.time()
    last_lookup = _last_api_lookup.get(icao_hex, 0)
    return (now - last_lookup) >= API_LOOKUP_COOLDOWN_SECONDS


def _mark_api_lookup(icao_hex: str):
    """Mark that we just performed an API lookup for this aircraft."""
    import time
    _last_api_lookup[icao_hex.upper()] = time.time()


def _cleanup_old_rate_limits():
    """Clean up old rate limit entries to prevent memory growth."""
    import time
    now = time.time()
    cutoff = now - (API_LOOKUP_COOLDOWN_SECONDS * 2)  # Keep for 2x cooldown period
    stale_keys = [k for k, v in _last_api_lookup.items() if v < cutoff]
    for k in stale_keys:
        _last_api_lookup.pop(k, None)


def _add_pending_lookup(icao_hex: str):
    """Add aircraft to pending lookups with timestamp."""
    import time
    _pending_lookups[icao_hex.upper()] = time.time()


def _remove_pending_lookup(icao_hex: str):
    """Remove aircraft from pending lookups."""
    _pending_lookups.pop(icao_hex.upper(), None)


def _is_pending_lookup(icao_hex: str) -> bool:
    """Check if aircraft is in pending lookups (not stuck)."""
    import time
    icao_hex = icao_hex.upper()
    if icao_hex not in _pending_lookups:
        return False
    # Check if it's been stuck too long
    added_time = _pending_lookups[icao_hex]
    if time.time() - added_time > PENDING_LOOKUP_TIMEOUT_SECONDS:
        # Stuck lookup - remove it and allow retry
        _pending_lookups.pop(icao_hex, None)
        logger.warning(f"Cleared stuck pending lookup for {icao_hex}")
        return False
    return True


def _cleanup_stuck_pending_lookups():
    """Clean up stuck pending lookups that never completed."""
    import time
    now = time.time()
    cutoff = now - PENDING_LOOKUP_TIMEOUT_SECONDS
    stuck_keys = [k for k, v in _pending_lookups.items() if v < cutoff]
    for k in stuck_keys:
        _pending_lookups.pop(k, None)
    if stuck_keys:
        logger.info(f"Cleaned up {len(stuck_keys)} stuck pending lookups")


def _cleanup_old_seen_aircraft():
    """Clean up old seen aircraft entries to prevent unbounded memory growth."""
    import time
    now = time.time()
    cutoff = now - (SEEN_AIRCRAFT_MAX_AGE_HOURS * 3600)
    old_keys = [k for k, v in _seen_aircraft_times.items() if v < cutoff]
    for k in old_keys:
        _seen_aircraft_times.pop(k, None)
    if old_keys:
        logger.info(f"Cleaned up {len(old_keys)} old seen aircraft entries")


async def _emit_airframe_error(
    icao_hex: str,
    error_type: str,
    error_message: str,
    source: str,
    details: Optional[dict] = None
):
    """
    Emit airframe lookup error via Socket.IO.
    Silently fails if Socket.IO manager is not available.
    """
    try:
        from app.services.socketio_manager import get_socketio_manager
        sio_manager = get_socketio_manager()
        if sio_manager:
            await sio_manager.publish_airframe_error(
                icao_hex=icao_hex,
                error_type=error_type,
                error_message=error_message,
                source=source,
                details=details
            )
    except Exception as e:
        logger.debug(f"Failed to emit airframe error for {icao_hex}: {e}")

# Queue for background aircraft lookups
_lookup_queue: asyncio.Queue = None


async def get_aircraft_info(db: AsyncSession, icao_hex: str, force_refresh: bool = False) -> Optional[dict]:
    """
    Get aircraft information from database cache, with rate-limited external API fallback.

    The database is populated daily by the external_db sync (ADSBX, tar1090, FAA).
    External APIs (hexdb.io, adsb.lol) are only called:
    - When data is missing from the database
    - At most once per hour per aircraft (rate limited)

    Args:
        db: Database session
        icao_hex: ICAO hex code (e.g., "A12345")
        force_refresh: Force refresh from external sources (bypasses rate limit)

    Returns:
        Aircraft info dict or None if not found
    """
    icao_hex = icao_hex.upper().strip()

    if not icao_hex or len(icao_hex) < 6 or len(icao_hex) > 10:
        return None

    # Check database cache first (populated by daily external_db sync)
    result = await db.execute(
        select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex)
    )
    cached = result.scalar_one_or_none()

    # If we have cached data, return it immediately
    if cached:
        AIRFRAME_CACHE_HITS.inc()

        # Check if we should trigger a background API lookup for missing data
        # Only if rate limit allows (once per hour) and data is incomplete
        needs_api_lookup = (
            (not cached.registration or not cached.type_code or not cached.photo_url)
            and not cached.fetch_failed
            and _can_lookup_api(icao_hex)
            and icao_hex not in _pending_lookups
        )

        if needs_api_lookup or force_refresh:
            # Trigger background refresh (non-blocking)
            asyncio.create_task(_background_refresh_info(icao_hex))

        # If we have photo URLs but no local paths, trigger background caching
        elif cached.photo_url and not cached.photo_local_path:
            asyncio.create_task(_background_cache_photos(
                icao_hex, cached.photo_url, cached.photo_thumbnail_url,
                cached.photo_page_link
            ))

        return _model_to_dict(cached)

    # No cached data - check rate limit before calling external APIs
    AIRFRAME_CACHE_MISSES.inc()

    if not _can_lookup_api(icao_hex) and not force_refresh:
        # Rate limited - don't call external APIs yet
        logger.debug(f"Rate limited API lookup for {icao_hex}, skipping")
        return None

    # Prevent duplicate lookups (with stuck lookup detection)
    if _is_pending_lookup(icao_hex):
        return None

    _add_pending_lookup(icao_hex)
    _mark_api_lookup(icao_hex)  # Mark that we're doing an API lookup

    try:
        # Fetch from external APIs (hexdb.io, opensky, etc.)
        info = await _fetch_aircraft_info(icao_hex)

        if info:
            # Create new cache entry
            cached = AircraftInfo(icao_hex=icao_hex, **info)
            db.add(cached)
            await db.commit()

            # Trigger background photo caching
            photo_url = info.get("photo_url")
            thumb_url = info.get("photo_thumbnail_url")
            photo_page_link = info.get("photo_page_link")
            if photo_url:
                asyncio.create_task(_background_cache_photos(
                    icao_hex, photo_url, thumb_url, photo_page_link
                ))

            return _model_to_dict(cached)
        else:
            # Mark as failed lookup (won't retry for FAILED_CACHE_HOURS)
            cached = AircraftInfo(icao_hex=icao_hex, fetch_failed=True)
            db.add(cached)
            await db.commit()
            return None

    except Exception as e:
        logger.error(f"Error fetching aircraft info for {icao_hex}: {e}")
        AIRFRAME_LOOKUP_ERRORS.labels(source="database", error_type=type(e).__name__).inc()
        sentry_sdk.capture_exception(e)
        await _emit_airframe_error(icao_hex, type(e).__name__, str(e), "database")
        await db.rollback()
        return None

    finally:
        _remove_pending_lookup(icao_hex)


async def _background_cache_photos(
    icao_hex: str,
    photo_url: Optional[str] = None,
    thumbnail_url: Optional[str] = None,
    photo_page_link: Optional[str] = None
):
    """
    Background task to fetch photos from hexdb.io and cache to filesystem/S3.
    If no URLs provided, attempts to fetch from hexdb.io first.
    Updates database with local paths when complete.

    Args:
        icao_hex: Aircraft ICAO hex code
        photo_url: Direct URL to photo
        thumbnail_url: Direct URL to thumbnail
        photo_page_link: Planespotters page URL to scrape for full-size image
    """
    from app.core.database import AsyncSessionLocal
    from app.services.photo_cache import download_photo, update_photo_paths

    try:
        # If no photo URL provided, try to fetch from hexdb.io
        if not photo_url:
            hexdb_photo = await _fetch_photo_from_hexdb(icao_hex)
            if hexdb_photo:
                photo_url = hexdb_photo.get("photo_url")
                thumbnail_url = hexdb_photo.get("photo_thumbnail_url")

                # Quick DB update for URLs (short-lived session)
                async with AsyncSessionLocal() as db:
                    result = await db.execute(
                        select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex.upper())
                    )
                    cached = result.scalar_one_or_none()
                    if cached and not cached.photo_url:
                        cached.photo_url = photo_url
                        cached.photo_thumbnail_url = thumbnail_url
                        cached.photo_source = "hexdb.io"
                        await db.commit()

        if photo_url:
            # Download photos (no DB session held open)
            photo_path = await download_photo(
                photo_url, icao_hex, is_thumbnail=False,
                photo_page_link=photo_page_link
            )
            thumb_path = None
            if thumbnail_url:
                thumb_path = await download_photo(thumbnail_url, icao_hex, is_thumbnail=True)

            # Quick DB update for paths (short-lived session)
            if photo_path or thumb_path:
                await update_photo_paths(icao_hex, photo_path, thumb_path)
                if photo_path:
                    logger.info(f"Cached photo for {icao_hex}: {photo_path}")
    except Exception as e:
        logger.error(f"Background photo caching failed for {icao_hex}: {e}")


async def _background_refresh_info(icao_hex: str):
    """
    Background task to refresh incomplete aircraft info.
    Fetches from external APIs and updates the cache.
    Rate limited to once per hour per aircraft.
    """
    from app.core.database import AsyncSessionLocal

    icao_hex = icao_hex.upper()

    # Prevent duplicate lookups (with stuck lookup detection)
    if _is_pending_lookup(icao_hex):
        return

    # Check rate limit (once per hour)
    if not _can_lookup_api(icao_hex):
        logger.debug(f"Background refresh rate limited for {icao_hex}")
        return

    _add_pending_lookup(icao_hex)
    _mark_api_lookup(icao_hex)

    try:
        async with AsyncSessionLocal() as db:
            # Fetch fresh info from external APIs
            info = await _fetch_aircraft_info(icao_hex)

            if info:
                # Update existing cache entry
                result = await db.execute(
                    select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex)
                )
                cached = result.scalar_one_or_none()

                if cached:
                    # Only update fields that were missing or are now available
                    for key, value in info.items():
                        if hasattr(cached, key) and value is not None:
                            current_value = getattr(cached, key)
                            if current_value is None:
                                setattr(cached, key, value)
                    cached.updated_at = datetime.utcnow()
                    if cached.fetch_failed:
                        cached.fetch_failed = False
                else:
                    cached = AircraftInfo(icao_hex=icao_hex, **info)
                    db.add(cached)

                await db.commit()
                logger.info(f"Background refresh completed for {icao_hex}")

                # Trigger photo caching if we now have photo URLs
                photo_url = info.get("photo_url")
                if photo_url:
                    asyncio.create_task(_background_cache_photos(
                        icao_hex, photo_url,
                        info.get("photo_thumbnail_url"),
                        info.get("photo_page_link")
                    ))

    except Exception as e:
        logger.error(f"Background refresh failed for {icao_hex}: {e}")
    finally:
        _remove_pending_lookup(icao_hex)


# Set of aircraft currently being upgraded (prevent duplicate upgrades)
_pending_upgrades: set[str] = set()


async def _background_upgrade_photo(icao_hex: str):
    """
    Background task to upgrade a low-res photo to higher resolution.
    Fetches fresh photo URLs and re-caches if a better version is available.

    For Planespotters photos without a stored page link, fetches the API
    to get the link and then scrapes for the full-size image.
    """
    from app.core.database import AsyncSessionLocal
    from app.services.photo_cache import download_photo, update_photo_paths

    icao_hex = icao_hex.upper()

    # Prevent duplicate upgrade attempts
    if icao_hex in _pending_upgrades:
        return
    _pending_upgrades.add(icao_hex)

    try:
        # Get current cached info (short-lived session)
        old_photo_url = None
        old_thumb_url = None
        photo_page_link = None
        photo_source = None

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex)
            )
            cached = result.scalar_one_or_none()
            if not cached:
                return

            old_photo_url = cached.photo_url
            old_thumb_url = cached.photo_thumbnail_url
            photo_page_link = cached.photo_page_link
            photo_source = cached.photo_source

        new_photo_url = None
        new_thumb_url = None

        # First try hexdb.io for full-size images
        hexdb_photo = await _fetch_photo_from_hexdb(icao_hex)
        if hexdb_photo and hexdb_photo.get("photo_url"):
            new_photo_url = hexdb_photo["photo_url"]
            new_thumb_url = hexdb_photo.get("photo_thumbnail_url")
            photo_page_link = None  # hexdb provides direct URLs
            logger.info(f"Found hexdb.io photo for {icao_hex}, upgrading from planespotters")

        # If no hexdb photo and no page link but we have a planespotters URL,
        # fetch the API to get the page link for scraping
        if not new_photo_url and not photo_page_link and old_photo_url:
            if "plnspttrs.net" in old_photo_url or photo_source == "planespotters.net":
                logger.info(f"Fetching Planespotters API to get page link for {icao_hex}")
                ps_photo = await _fetch_photo_from_planespotters(icao_hex)
                if ps_photo and ps_photo.get("photo_page_link"):
                    photo_page_link = ps_photo["photo_page_link"]
                    # Store the page link for future use (short-lived session)
                    async with AsyncSessionLocal() as db:
                        result = await db.execute(
                            select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex)
                        )
                        cached = result.scalar_one_or_none()
                        if cached:
                            cached.photo_page_link = photo_page_link
                            await db.commit()
                    logger.info(f"Got page link for {icao_hex}: {photo_page_link}")

        # Update database and re-cache if we found a better URL or have a page link to scrape
        if new_photo_url and new_photo_url != old_photo_url:
            # Update URLs in DB (short-lived session)
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex)
                )
                cached = result.scalar_one_or_none()
                if cached:
                    cached.photo_url = new_photo_url
                    if new_thumb_url:
                        cached.photo_thumbnail_url = new_thumb_url
                    cached.photo_local_path = None
                    cached.photo_thumbnail_local_path = None
                    await db.commit()

            # Download photos (no DB session held open)
            photo_path = await download_photo(
                new_photo_url, icao_hex, is_thumbnail=False,
                photo_page_link=photo_page_link, force=True
            )
            thumb_path = None
            if new_thumb_url:
                thumb_path = await download_photo(new_thumb_url, icao_hex, is_thumbnail=True, force=True)

            if photo_path or thumb_path:
                await update_photo_paths(icao_hex, photo_path, thumb_path)
                if photo_path:
                    logger.info(f"Upgraded and cached photo for {icao_hex}: {photo_path}")

        elif photo_page_link and old_photo_url:
            # Clear old cached path (short-lived session)
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex)
                )
                cached = result.scalar_one_or_none()
                if cached:
                    cached.photo_local_path = None
                    await db.commit()

            # Force re-download to trigger scraping for full-size image
            photo_path = await download_photo(
                old_photo_url, icao_hex, is_thumbnail=False,
                photo_page_link=photo_page_link, force=True
            )
            thumb_path = None
            if old_thumb_url:
                thumb_path = await download_photo(old_thumb_url, icao_hex, is_thumbnail=True)

            if photo_path or thumb_path:
                await update_photo_paths(icao_hex, photo_path, thumb_path)
                if photo_path:
                    logger.info(f"Upgraded photo via scraping for {icao_hex}: {photo_path}")

    except Exception as e:
        logger.error(f"Background photo upgrade failed for {icao_hex}: {e}")
    finally:
        _pending_upgrades.discard(icao_hex)


async def _fetch_aircraft_info(icao_hex: str) -> Optional[dict]:
    """
    Fetch aircraft info from multiple sources.

    Priority order:
    1. Local databases (fast, no network): external_db (FAA, ADSBX, tar1090, OpenSky)
    2. hexdb.io API - Primary online source (data + full-size photos)
    3. OpenSky Network API - Additional online metadata
    4. Photo sources as fallback
    """
    from app.services import external_db

    with sentry_sdk.start_span(op="airframe.fetch", description=f"Fetch aircraft info for {icao_hex}") as span:
        span.set_data("icao_hex", icao_hex)
        info = {}
        has_photo = False
        sources_tried = []

        # 1. Check all local databases first (fastest - no network)
        # lookup_all merges FAA, ADSBX, tar1090, and OpenSky into a single record
        if external_db.is_any_loaded():
            with sentry_sdk.start_span(op="airframe.local_db", description="Local DB lookup"):
                local_info = external_db.lookup_all(icao_hex)
                if local_info:
                    info.update({k: v for k, v in local_info.items() if v is not None and k != "sources"})
                    sources_tried.extend(local_info.get("sources", []))
                    AIRFRAME_LOOKUP_TOTAL.labels(source="local_db", status="success").inc()
                    logger.debug(f"Got data from local DBs for {icao_hex}: {local_info.get('sources', [])}")

        # 2. Try hexdb.io API - provides both data AND full-size photos
        if not info.get("registration") or not info.get("type_code"):
            with AIRFRAME_LOOKUP_DURATION.labels(source="hexdb").time():
                hexdb_info = await _fetch_from_hexdb(icao_hex)
            if hexdb_info:
                for key, value in hexdb_info.items():
                    if value is not None and (key not in info or info[key] is None):
                        info[key] = value
                has_photo = info.get("photo_url") is not None
                sources_tried.append("hexdb.io")
                AIRFRAME_LOOKUP_TOTAL.labels(source="hexdb", status="success").inc()
                logger.debug(f"Got data from hexdb.io for {icao_hex} (has_photo={has_photo})")
            else:
                AIRFRAME_LOOKUP_TOTAL.labels(source="hexdb", status="not_found").inc()

        # 3. If we still don't have a photo, try other sources
        if not has_photo and not info.get("photo_url"):
            photo_info = await _fetch_best_photo(icao_hex)
            if photo_info:
                info.update(photo_info)
                sources_tried.append(photo_info.get("photo_source", "photo_fallback"))

        # 4. Try OpenSky Network API for any remaining missing data
        if not info.get("registration"):
            with AIRFRAME_LOOKUP_DURATION.labels(source="opensky_api").time():
                opensky_info = await _fetch_from_opensky(icao_hex)
            if opensky_info:
                for key, value in opensky_info.items():
                    if key not in info or info[key] is None:
                        info[key] = value
                sources_tried.append("opensky_api")
                AIRFRAME_LOOKUP_TOTAL.labels(source="opensky_api", status="success").inc()
            else:
                AIRFRAME_LOOKUP_TOTAL.labels(source="opensky_api", status="not_found").inc()

        span.set_data("sources", sources_tried)
        span.set_data("found_data", bool(info))
        return info if info else None


async def _fetch_best_photo(icao_hex: str) -> Optional[dict]:
    """
    Try multiple photo sources and return the best quality available.
    
    Priority:
    1. hexdb.io - provides full-size images via direct URLs
    2. planespotters.net - provides larger thumbnails (~640px)
    3. airport-data.com - provides small thumbnails (200px)
    
    Note: hexdb.io is already tried in _fetch_from_hexdb, so this is
    called only as a fallback when hexdb.io photo lookup failed.
    """
    # Try hexdb.io first (full-size images) - in case it wasn't already tried
    photo_info = await _fetch_photo_from_hexdb(icao_hex)
    if photo_info:
        logger.debug(f"Got photo from hexdb.io for {icao_hex}")
        return photo_info
    
    # Try planespotters.net (larger thumbnails)
    photo_info = await _fetch_photo_from_planespotters(icao_hex)
    if photo_info:
        logger.debug(f"Got photo from planespotters.net for {icao_hex}")
        return photo_info
    
    # Try airport-data.com as last resort (small thumbnails)
    photo_info = await _fetch_photo_from_airport_data(icao_hex)
    if photo_info:
        logger.debug(f"Got photo from airport-data.com for {icao_hex}")
        return photo_info
    
    return None


async def _fetch_from_hexdb(icao_hex: str) -> Optional[dict]:
    """
    Fetch from hexdb.io - free aircraft database.
    This is the primary source for aircraft data and photos.

    hexdb.io provides:
    - Aircraft info: registration, type, manufacturer, operator
    - Direct image URLs (full-size and thumbnail)
    - Route information (via callsign)
    - Airport information
    """
    with sentry_sdk.start_span(op="http.client", description=f"hexdb.io API {icao_hex}") as span:
        span.set_data("icao_hex", icao_hex)
        try:
            # Fetch aircraft data
            url = f"https://hexdb.io/api/v1/aircraft/{icao_hex.lower()}"
            data = await safe_request(url)

            if not data:
                span.set_data("result", "not_found")
                return None

            result = {
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
                # Store ModeS for reference
                "extra_data": {
                    "modes": data.get("ModeS"),
                    "source": "hexdb.io"
                }
            }

            # Also fetch photo from hexdb.io (integrated)
            photo_info = await _fetch_photo_from_hexdb(icao_hex)
            if photo_info:
                result.update(photo_info)

            span.set_data("result", "success")
            return result
        except Exception as e:
            AIRFRAME_LOOKUP_ERRORS.labels(source="hexdb", error_type=type(e).__name__).inc()
            sentry_sdk.capture_exception(e)
            logger.debug(f"hexdb.io lookup failed for {icao_hex}: {e}")
            span.set_data("result", "error")
            span.set_data("error", str(e))
            # Emit error via Socket.IO
            await _emit_airframe_error(icao_hex, type(e).__name__, str(e), "hexdb")
            return None


async def _fetch_photo_from_hexdb(icao_hex: str) -> Optional[dict]:
    """
    Fetch photo from hexdb.io - provides direct image URLs.

    Full image: https://hexdb.io/hex-image?hex=<HEX>
    Thumbnail: https://hexdb.io/hex-image-thumb?hex=<HEX>

    These are direct image URLs that can be downloaded/cached.
    """
    with sentry_sdk.start_span(op="http.client", description=f"hexdb.io photo {icao_hex}") as span:
        span.set_data("icao_hex", icao_hex)
        try:
            photo_url = f"https://hexdb.io/hex-image?hex={icao_hex.lower()}"
            thumbnail_url = f"https://hexdb.io/hex-image-thumb?hex={icao_hex.lower()}"

            # Verify the image exists with a HEAD request
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.head(
                    photo_url,
                    follow_redirects=True,
                    headers={"User-Agent": "ADS-B-API/2.6 (aircraft-tracker)"}
                )
                if response.status_code != 200:
                    logger.debug(f"hexdb.io photo not found for {icao_hex}: {response.status_code}")
                    span.set_data("result", "not_found")
                    return None

                content_type = response.headers.get("content-type", "")
                if not content_type.startswith("image/"):
                    logger.debug(f"hexdb.io non-image response for {icao_hex}: {content_type}")
                    span.set_data("result", "invalid_content_type")
                    return None

            span.set_data("result", "success")
            return {
                "photo_url": photo_url,
                "photo_thumbnail_url": thumbnail_url,
                "photo_photographer": None,  # hexdb.io doesn't provide photographer info
                "photo_source": "hexdb.io",
            }
        except Exception as e:
            AIRFRAME_LOOKUP_ERRORS.labels(source="hexdb_photo", error_type=type(e).__name__).inc()
            logger.debug(f"hexdb.io photo lookup failed for {icao_hex}: {e}")
            span.set_data("result", "error")
            return None


async def _fetch_photo_from_airport_data(icao_hex: str) -> Optional[dict]:
    """Fetch photo from airport-data.com API."""
    with sentry_sdk.start_span(op="http.client", description=f"airport-data.com {icao_hex}") as span:
        span.set_data("icao_hex", icao_hex)
        try:
            url = f"https://airport-data.com/api/ac_thumb.json?m={icao_hex.upper()}&n=1"
            data = await safe_request(url)

            if not data or data.get("status") != 200 or not data.get("data"):
                span.set_data("result", "not_found")
                return None

            photo_data = data["data"][0]
            thumbnail_url = photo_data.get("image")  # 200px thumbnail

            if not thumbnail_url:
                span.set_data("result", "no_image")
                return None

            # airport-data.com only provides thumbnails via API
            # The 'link' field is an HTML page, not a direct image
            span.set_data("result", "success")
            return {
                "photo_url": thumbnail_url,  # Only thumbnail available
                "photo_thumbnail_url": thumbnail_url,
                "photo_photographer": photo_data.get("photographer"),
                "photo_source": "airport-data.com",
            }
        except Exception as e:
            AIRFRAME_LOOKUP_ERRORS.labels(source="airport_data", error_type=type(e).__name__).inc()
            logger.debug(f"airport-data.com lookup failed for {icao_hex}: {e}")
            span.set_data("result", "error")
            return None


async def _fetch_from_opensky(icao_hex: str) -> Optional[dict]:
    """Fetch from OpenSky Network aircraft database."""
    with sentry_sdk.start_span(op="http.client", description=f"OpenSky API {icao_hex}") as span:
        span.set_data("icao_hex", icao_hex)
        try:
            url = f"https://opensky-network.org/api/metadata/aircraft/icao/{icao_hex}"
            data = await safe_request(url)

            if not data:
                span.set_data("result", "not_found")
                return None

            span.set_data("result", "success")
            return {
                "registration": data.get("registration"),
                "type_code": data.get("typecode"),
                "manufacturer": data.get("manufacturerName"),
                "model": data.get("model"),
                "serial_number": data.get("serialNumber"),
                "operator": data.get("owner"),
                "operator_icao": data.get("operatorIcao"),
                "country": data.get("country"),
                "is_military": "military" in (data.get("categoryDescription") or "").lower(),
            }
        except Exception as e:
            AIRFRAME_LOOKUP_ERRORS.labels(source="opensky_api", error_type=type(e).__name__).inc()
            sentry_sdk.capture_exception(e)
            logger.debug(f"OpenSky lookup failed for {icao_hex}: {e}")
            span.set_data("result", "error")
            return None


async def _fetch_photo_from_planespotters(icao_hex: str) -> Optional[dict]:
    """Fetch photo from planespotters.net API."""
    with sentry_sdk.start_span(op="http.client", description=f"planespotters.net {icao_hex}") as span:
        span.set_data("icao_hex", icao_hex)
        try:
            url = f"https://api.planespotters.net/pub/photos/hex/{icao_hex}"
            data = await safe_request(url)

            if not data or "photos" not in data or not data["photos"]:
                span.set_data("result", "not_found")
                return None

            photo = data["photos"][0]

            # Debug: log what keys are available
            logger.debug(f"Planespotters response keys for {icao_hex}: {list(photo.keys())}")

            # Planespotters API provides:
            # - thumbnail_large: larger thumbnail (usually ~280px wide, suffix _280.jpg)
            # - thumbnail: smaller thumbnail (~232px wide, suffix _t.jpg)
            # - link: webpage URL (NOT a direct image)
            # The public API does NOT provide direct URLs to full-resolution images
            # BUT we can modify the URL suffix to get larger versions:
            # _t.jpg = tiny, _280.jpg = 280px, _1000.jpg = 1000px, _o.jpg = original

            # Get the photo page link - this is used by photo_cache to scrape full-size URL
            photo_page_link = photo.get("link")

            # Get the larger thumbnail URL (use as-is, don't try to upgrade suffix)
            large_thumb = photo.get("thumbnail_large", {})
            photo_url = large_thumb.get("src") if isinstance(large_thumb, dict) else None

            # Get the smaller thumbnail for thumbnail_url
            small_thumb = photo.get("thumbnail", {})
            thumbnail_url = small_thumb.get("src") if isinstance(small_thumb, dict) else None

            # Fallback: if no large, use small for both
            if not photo_url:
                photo_url = thumbnail_url
            if not thumbnail_url:
                thumbnail_url = photo_url

            logger.debug(f"Planespotters for {icao_hex}: photo_url={photo_url}, thumbnail={thumbnail_url}, link={photo_page_link}")

            span.set_data("result", "success")
            return {
                "photo_url": photo_url,
                "photo_thumbnail_url": thumbnail_url,
                "photo_photographer": photo.get("photographer"),
                "photo_source": "planespotters.net",
                "photo_page_link": photo_page_link,
            }
        except Exception as e:
            AIRFRAME_LOOKUP_ERRORS.labels(source="planespotters", error_type=type(e).__name__).inc()
            logger.debug(f"Planespotters lookup failed for {icao_hex}: {e}")
            span.set_data("result", "error")
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
    """Check if this aircraft has been seen before in this session (in-memory only).

    Uses TTL-based tracking to prevent unbounded memory growth.
    """
    import time
    icao_hex = icao_hex.upper()
    if icao_hex in _seen_aircraft_times:
        return False
    _seen_aircraft_times[icao_hex] = time.time()
    return True


async def was_looked_up_recently(db: AsyncSession, icao_hex: str, hours: int = 1) -> bool:
    """Check if aircraft was looked up in the database within the specified hours."""
    icao_hex = icao_hex.upper()
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    result = await db.execute(
        select(AircraftInfo.updated_at)
        .where(AircraftInfo.icao_hex == icao_hex)
        .where(AircraftInfo.updated_at >= cutoff)
    )
    return result.scalar_one_or_none() is not None


async def was_looked_up_recently_with_photo(db: AsyncSession, icao_hex: str, hours: int = 1) -> bool:
    """Check if aircraft was looked up recently AND has a photo URL or local path.

    Only skip re-queueing if we already have photo data for this aircraft.
    """
    icao_hex = icao_hex.upper()
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    result = await db.execute(
        select(AircraftInfo.updated_at)
        .where(AircraftInfo.icao_hex == icao_hex)
        .where(AircraftInfo.updated_at >= cutoff)
        .where(
            (AircraftInfo.photo_url.isnot(None)) |
            (AircraftInfo.photo_local_path.isnot(None)) |
            (AircraftInfo.fetch_failed == True)
        )
    )
    return result.scalar_one_or_none() is not None


def get_seen_aircraft_count() -> int:
    """Get count of unique aircraft seen this session."""
    return len(_seen_aircraft_times)


def clear_seen_aircraft():
    """Clear the seen aircraft set (for testing or reset)."""
    _seen_aircraft_times.clear()


def cleanup_memory_caches():
    """Clean up all memory caches to prevent unbounded growth.

    Should be called periodically (e.g., every 5 minutes) from a background task.
    """
    _cleanup_old_rate_limits()
    _cleanup_stuck_pending_lookups()
    _cleanup_old_seen_aircraft()
    logger.debug(
        f"Memory cache cleanup: {len(_last_api_lookup)} rate limits, "
        f"{len(_pending_lookups)} pending lookups, "
        f"{len(_seen_aircraft_times)} seen aircraft"
    )


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
                # Sleep briefly on timeout to prevent CPU spinning during low activity
                await asyncio.sleep(0.5)
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


async def check_and_queue_new_aircraft(icao_hex: str, db: Optional[AsyncSession] = None):
    """
    Check if aircraft is new and queue for lookup if so.
    Call this from the main aircraft processing loop.

    If db is provided, also checks if aircraft was looked up in the last hour
    to avoid redundant lookups after restarts.
    """
    if not is_new_aircraft(icao_hex):
        return

    # If we have a db session, check if already looked up recently AND has a photo
    if db is not None:
        if await was_looked_up_recently_with_photo(db, icao_hex, hours=1):
            logger.debug(f"Skipping lookup for {icao_hex} - looked up within last hour with photo")
            return

    await queue_aircraft_lookup(icao_hex)

