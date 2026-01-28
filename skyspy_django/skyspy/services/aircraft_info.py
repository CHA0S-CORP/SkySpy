"""
Aircraft info service with caching, rate limiting, and photo integration.

Provides a unified interface for aircraft lookups with:
- In-memory caching with TTL
- Rate limiting per aircraft
- Multi-source data fetching
- Photo URL management
- Background lookup queue
"""
import logging
import time
from datetime import datetime, timedelta
from threading import Lock
from typing import Optional, Dict, List, Set

import httpx
from django.conf import settings
from django.core.cache import cache
from channels.layers import get_channel_layer

from skyspy.models import AircraftInfo
from skyspy.services import external_db
from skyspy.utils import sync_group_send

logger = logging.getLogger(__name__)

# In-memory cache for fast lookups
_info_cache: Dict[str, dict] = {}
_cache_ttl: Dict[str, float] = {}
_cache_lock = Lock()

# Rate limiting - track last lookup time per ICAO
_last_lookup: Dict[str, float] = {}
_lookup_lock = Lock()

# Pending lookups queue
_pending_lookups: Set[str] = set()
_pending_lock = Lock()

# Seen aircraft tracking (session-based)
_seen_aircraft: Set[str] = set()
_seen_lock = Lock()

# Configuration
CACHE_TTL_SECONDS = 3600  # 1 hour
RATE_LIMIT_SECONDS = 60   # 1 minute between API calls for same aircraft
MAX_CACHE_SIZE = 10000
MAX_PENDING = 100
MAX_SEEN = 10000
MAX_RATE_LIMIT_ENTRIES = 10000  # Max entries in rate limit dict


def get_aircraft_info(icao_hex: str, include_photo: bool = True) -> Optional[dict]:
    """
    Get aircraft info with caching.

    Checks in order:
    1. In-memory cache
    2. Database cache
    3. In-memory databases
    4. External APIs (if rate limit allows)

    Returns dict with aircraft info or None if not found.
    """
    icao = icao_hex.upper().strip().lstrip('~')
    if not icao or len(icao) != 6:
        return None

    now = time.time()

    # 1. Check in-memory cache
    with _cache_lock:
        if icao in _info_cache and _cache_ttl.get(icao, 0) > now:
            return _info_cache[icao]

    # 2. Check database
    try:
        db_info = AircraftInfo.objects.filter(icao_hex=icao).first()
        if db_info and not db_info.fetch_failed:
            info = _serialize_db_info(db_info)
            _update_cache(icao, info)
            return info
    except Exception as e:
        logger.debug(f"Database lookup failed for {icao}: {e}")

    # 3. Check in-memory databases
    data = external_db.lookup_all(icao)
    if data:
        info = _normalize_external_data(icao, data)
        _update_cache(icao, info)
        _save_to_database(icao, info)
        return info

    # 4. Try external APIs (with rate limiting)
    if _can_fetch_from_api(icao):
        info = _fetch_from_external_apis(icao)
        if info:
            _update_cache(icao, info)
            _save_to_database(icao, info)
            return info

    return None


def get_bulk_aircraft_info(icao_list: List[str]) -> Dict[str, dict]:
    """
    Get info for multiple aircraft.

    Returns dict mapping ICAO hex to info dict.
    """
    result = {}
    missing_icaos = []
    now = time.time()

    for icao in icao_list:
        icao = icao.upper().strip().lstrip('~')
        if not icao or len(icao) != 6:
            continue

        # Check cache first
        with _cache_lock:
            if icao in _info_cache and _cache_ttl.get(icao, 0) > now:
                result[icao] = _info_cache[icao]
                continue

        missing_icaos.append(icao)

    # Bulk fetch from database
    if missing_icaos:
        try:
            db_infos = AircraftInfo.objects.filter(
                icao_hex__in=missing_icaos,
                fetch_failed=False
            )
            for db_info in db_infos:
                info = _serialize_db_info(db_info)
                result[db_info.icao_hex] = info
                _update_cache(db_info.icao_hex, info)
                # Use discard-like approach to avoid ValueError if not in list
                if db_info.icao_hex in missing_icaos:
                    missing_icaos.remove(db_info.icao_hex)
        except Exception as e:
            logger.debug(f"Bulk database lookup failed: {e}")

    # Remaining from in-memory databases
    for icao in missing_icaos[:]:
        data = external_db.lookup_all(icao)
        if data:
            info = _normalize_external_data(icao, data)
            result[icao] = info
            _update_cache(icao, info)
            # No need to remove since we're iterating a copy

    return result


def queue_aircraft_lookup(icao_hex: str) -> bool:
    """
    Queue an aircraft for background lookup.

    Returns True if queued, False if already pending or limit reached.
    """
    icao = icao_hex.upper().strip().lstrip('~')
    if not icao or len(icao) != 6:
        return False

    with _pending_lock:
        if len(_pending_lookups) >= MAX_PENDING:
            return False
        if icao in _pending_lookups:
            return False
        _pending_lookups.add(icao)

    # Queue the actual lookup task
    try:
        from skyspy.tasks.external_db import fetch_aircraft_info
        fetch_aircraft_info.delay(icao)
        return True
    except Exception as e:
        logger.debug(f"Failed to queue lookup for {icao}: {e}")
        with _pending_lock:
            _pending_lookups.discard(icao)
        return False


def check_and_queue_new_aircraft(aircraft_list: List[dict]) -> int:
    """
    Check aircraft list for new ones and queue for lookup.

    Returns count of newly queued aircraft.
    """
    global _seen_aircraft

    with _seen_lock:
        # Clear if too large
        if len(_seen_aircraft) > MAX_SEEN:
            _seen_aircraft.clear()
            logger.info("Cleared seen aircraft set")

        queued = 0
        for ac in aircraft_list:
            icao = (ac.get('hex') or ac.get('icao_hex') or '').upper()
            if not icao or icao.startswith('~'):
                continue

            if icao not in _seen_aircraft:
                _seen_aircraft.add(icao)
                if queue_aircraft_lookup(icao):
                    queued += 1
                    if queued >= 20:  # Limit batch size
                        break

        return queued


def clear_pending(icao_hex: str):
    """Mark an aircraft lookup as complete."""
    with _pending_lock:
        _pending_lookups.discard(icao_hex.upper())


def invalidate_cache(icao_hex: str):
    """Remove an aircraft from cache."""
    icao = icao_hex.upper()
    with _cache_lock:
        _info_cache.pop(icao, None)
        _cache_ttl.pop(icao, None)


def refresh_aircraft_info(icao_hex: str) -> Optional[dict]:
    """Force refresh aircraft info from external sources."""
    icao = icao_hex.upper().strip()

    # Clear cache
    invalidate_cache(icao)

    # Clear rate limit
    with _lookup_lock:
        _last_lookup.pop(icao, None)

    # Fetch fresh
    return get_aircraft_info(icao)


def get_cache_stats() -> dict:
    """Get cache statistics."""
    with _cache_lock:
        cache_count = len(_info_cache)

    with _pending_lock:
        pending_count = len(_pending_lookups)

    with _seen_lock:
        seen_count = len(_seen_aircraft)

    return {
        'cache_count': cache_count,
        'pending_lookups': pending_count,
        'seen_aircraft': seen_count,
        'databases_loaded': external_db.is_any_loaded(),
        'database_stats': external_db.get_database_stats(),
    }


# =============================================================================
# Photo Management
# =============================================================================

def get_aircraft_photo(icao_hex: str, prefer_thumbnail: bool = False) -> Optional[str]:
    """
    Get photo URL for aircraft.

    Checks database first, then queues background fetch if needed.
    """
    icao = icao_hex.upper().strip()

    try:
        info = AircraftInfo.objects.filter(icao_hex=icao).first()
        if info:
            if prefer_thumbnail and info.photo_thumbnail_url:
                return info.photo_thumbnail_url
            if info.photo_url:
                return info.photo_url

            # Queue photo fetch if we have info but no photo
            if not info.fetch_failed:
                _queue_photo_fetch(icao)
    except Exception:
        pass

    return None


def _queue_photo_fetch(icao_hex: str):
    """Queue background photo fetch."""
    try:
        from skyspy.tasks.external_db import fetch_aircraft_photos
        fetch_aircraft_photos.delay(icao_hex)
    except Exception as e:
        logger.debug(f"Failed to queue photo fetch for {icao_hex}: {e}")


# =============================================================================
# Internal Helpers
# =============================================================================

def _update_cache(icao: str, info: dict):
    """Update in-memory cache."""
    with _cache_lock:
        # Evict old entries if too large
        if len(_info_cache) >= MAX_CACHE_SIZE:
            _evict_old_cache_entries()

        _info_cache[icao] = info
        _cache_ttl[icao] = time.time() + CACHE_TTL_SECONDS


def _evict_old_cache_entries():
    """Remove oldest cache entries."""
    now = time.time()

    # Remove expired entries
    expired = [k for k, v in _cache_ttl.items() if v < now]
    for k in expired:
        _info_cache.pop(k, None)
        _cache_ttl.pop(k, None)

    # If still too large, remove oldest 10%
    if len(_info_cache) >= MAX_CACHE_SIZE:
        sorted_keys = sorted(_cache_ttl.items(), key=lambda x: x[1])
        to_remove = sorted_keys[:len(sorted_keys) // 10]
        for k, _ in to_remove:
            _info_cache.pop(k, None)
            _cache_ttl.pop(k, None)


def _can_fetch_from_api(icao: str) -> bool:
    """Check if we can make an API call for this aircraft."""
    now = time.time()

    with _lookup_lock:
        # Cleanup old entries if too large
        if len(_last_lookup) > MAX_RATE_LIMIT_ENTRIES:
            _cleanup_rate_limit_entries(now)

        last = _last_lookup.get(icao, 0)
        if now - last < RATE_LIMIT_SECONDS:
            return False
        _last_lookup[icao] = now

    return True


def _cleanup_rate_limit_entries(now: float):
    """Remove old rate limit entries. Must be called with _lookup_lock held."""
    cutoff = now - RATE_LIMIT_SECONDS * 2  # Keep entries for 2x the rate limit period
    stale_keys = [k for k, v in _last_lookup.items() if v < cutoff]
    for k in stale_keys:
        del _last_lookup[k]


def _fetch_from_external_apis(icao: str) -> Optional[dict]:
    """Fetch from external APIs (HexDB, adsb.lol, planespotters)."""
    info = {}
    sources = []

    # Try HexDB
    try:
        url = f"https://hexdb.io/api/v1/aircraft/{icao}"
        response = httpx.get(url, timeout=10.0)

        if response.status_code == 200:
            data = response.json()
            info = {
                'icao_hex': icao,
                'registration': data.get('Registration'),
                'type_code': data.get('ICAOTypeCode'),
                'manufacturer': data.get('Manufacturer'),
                'model': data.get('Type'),
                'operator': data.get('RegisteredOwners'),
            }
            sources.append('hexdb')

            # Try to get photo from HexDB
            photo_url = f"https://hexdb.io/hex-image?hex={icao.lower()}"
            try:
                photo_resp = httpx.head(photo_url, timeout=5.0)
                if photo_resp.status_code == 200:
                    content_type = photo_resp.headers.get('content-type', '')
                    if content_type.startswith('image/'):
                        info['photo_url'] = photo_url
                        info['photo_thumbnail_url'] = f"https://hexdb.io/hex-image-thumb?hex={icao.lower()}"
                        info['photo_source'] = 'hexdb.io'
            except Exception:
                pass

    except Exception as e:
        logger.debug(f"HexDB lookup failed for {icao}: {e}")

    # Try adsb.lol if no info yet
    if not info:
        try:
            lol_data = external_db.fetch_aircraft_from_adsb_lol(icao)
            if lol_data:
                info = {
                    'icao_hex': icao,
                    'registration': lol_data.get('r'),
                    'type_code': lol_data.get('t'),
                }
                sources.append('adsb.lol')
        except Exception as e:
            logger.debug(f"adsb.lol lookup failed for {icao}: {e}")

    # Try planespotters for photo if we don't have one
    if info and not info.get('photo_url'):
        try:
            ps_url = f"https://api.planespotters.net/pub/photos/hex/{icao}"
            response = httpx.get(ps_url, timeout=10.0)
            if response.status_code == 200:
                data = response.json()
                if data.get('photos'):
                    photo = data['photos'][0]
                    large_thumb = photo.get('thumbnail_large', {})
                    if isinstance(large_thumb, dict):
                        info['photo_url'] = large_thumb.get('src')
                    small_thumb = photo.get('thumbnail', {})
                    if isinstance(small_thumb, dict):
                        info['photo_thumbnail_url'] = small_thumb.get('src')
                    info['photo_page_link'] = photo.get('link')
                    info['photo_photographer'] = photo.get('photographer')
                    info['photo_source'] = 'planespotters.net'
        except Exception as e:
            logger.debug(f"Planespotters lookup failed for {icao}: {e}")

    if info:
        info['sources'] = sources
        return info

    return None


def _normalize_external_data(icao: str, data: dict) -> dict:
    """Normalize data from external_db.lookup_all()."""
    return {
        'icao_hex': icao,
        'registration': data.get('registration'),
        'type_code': data.get('type_code'),
        'type_name': data.get('type_name'),
        'manufacturer': data.get('manufacturer'),
        'model': data.get('model'),
        'operator': data.get('operator') or data.get('owner'),
        'operator_icao': data.get('operator_icao'),
        'owner': data.get('owner'),
        'year_built': data.get('year_built'),
        'serial_number': data.get('serial_number'),
        'country': data.get('country'),
        'category': data.get('category'),
        'is_military': data.get('is_military', False),
        'is_interesting': data.get('is_interesting', False),
        'is_pia': data.get('is_pia', False),
        'is_ladd': data.get('is_ladd', False),
        'sources': data.get('sources', []),
    }


def _serialize_db_info(info: AircraftInfo) -> dict:
    """Serialize AircraftInfo model to dict."""
    return {
        'icao_hex': info.icao_hex,
        'registration': info.registration,
        'type_code': info.type_code,
        'type_name': info.type_name,
        'manufacturer': info.manufacturer,
        'model': info.model,
        'operator': info.operator,
        'operator_icao': info.operator_icao,
        'owner': info.owner,
        'year_built': info.year_built,
        'serial_number': info.serial_number,
        'country': info.country,
        'category': info.category,
        'is_military': info.is_military,
        'is_interesting': info.is_interesting,
        'is_pia': info.is_pia,
        'is_ladd': info.is_ladd,
        'photo_url': info.photo_url,
        'photo_thumbnail_url': info.photo_thumbnail_url,
        'photo_page_link': info.photo_page_link,
        'photo_photographer': info.photo_photographer,
        'photo_source': info.photo_source,
        'source': info.source,
    }


def _save_to_database(icao: str, info: dict):
    """Save aircraft info to database."""
    try:
        AircraftInfo.objects.update_or_create(
            icao_hex=icao,
            defaults={
                'registration': info.get('registration'),
                'type_code': info.get('type_code'),
                'manufacturer': info.get('manufacturer'),
                'model': info.get('model'),
                'operator': info.get('operator'),
                'operator_icao': info.get('operator_icao'),
                'owner': info.get('owner'),
                'year_built': info.get('year_built'),
                'serial_number': info.get('serial_number'),
                'country': info.get('country'),
                'category': info.get('category'),
                'is_military': info.get('is_military', False),
                'is_interesting': info.get('is_interesting', False),
                'is_pia': info.get('is_pia', False),
                'is_ladd': info.get('is_ladd', False),
                'photo_url': info.get('photo_url'),
                'photo_thumbnail_url': info.get('photo_thumbnail_url'),
                'photo_page_link': info.get('photo_page_link'),
                'photo_photographer': info.get('photo_photographer'),
                'photo_source': info.get('photo_source'),
                'source': ','.join(info.get('sources', [])) if info.get('sources') else None,
                'fetch_failed': False,
            }
        )
    except Exception as e:
        logger.debug(f"Failed to save aircraft info for {icao}: {e}")


# =============================================================================
# Broadcasting
# =============================================================================

def broadcast_aircraft_info(icao_hex: str, info: dict):
    """Broadcast aircraft info update to WebSocket clients."""
    try:
        channel_layer = get_channel_layer()
        sync_group_send(
            channel_layer,
            'aircraft_aircraft',
            {
                'type': 'aircraft_info_update',
                'data': {
                    'icao': icao_hex,
                    'info': info,
                    'timestamp': datetime.utcnow().isoformat() + 'Z'
                }
            }
        )
    except Exception as e:
        logger.warning(f"Failed to broadcast aircraft info: {e}")
