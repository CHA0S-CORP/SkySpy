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
from datetime import datetime
from threading import Lock

import httpx
from django.conf import settings
from django.db import DatabaseError
from kombu.exceptions import OperationalError as KombuOperationalError

from skyspy.models import AircraftInfo
from skyspy.services import adsbdb, adsbx_live, external_db, http_client

logger = logging.getLogger(__name__)


# In-memory cache for fast lookups
_info_cache: dict[str, dict] = {}
_cache_ttl: dict[str, float] = {}
_cache_lock = Lock()

# Rate limiting - track last lookup time per ICAO
_last_lookup: dict[str, float] = {}
_lookup_lock = Lock()

# Pending lookups queue
_pending_lookups: set[str] = set()
_pending_lock = Lock()

# Seen aircraft tracking (session-based)
_seen_aircraft: set[str] = set()
_seen_lock = Lock()

# Configuration
CACHE_TTL_SECONDS = 3600  # 1 hour
RATE_LIMIT_SECONDS = 60  # 1 minute between API calls for same aircraft
MAX_CACHE_SIZE = 10000
MAX_PENDING = 100
MAX_SEEN = 10000
MAX_RATE_LIMIT_ENTRIES = 10000  # Max entries in rate limit dict


def get_aircraft_info(icao_hex: str, include_photo: bool = True) -> dict | None:
    """
    Get aircraft info with caching.

    Checks in order:
    1. In-memory cache
    2. Database cache
    3. In-memory databases
    4. External APIs (if rate limit allows)

    Returns dict with aircraft info or None if not found.
    """
    icao = icao_hex.upper().strip().lstrip("~")
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
            # Local (FAA) data supplies registration/owner but no manufacturer/
            # model. Gap-fill from the external-API path exactly once, then the
            # persisted record is returned as-is on every later read.
            if _needs_identity(info) and not _identity_enriched(db_info) and _can_fetch_from_api(icao):
                info, attempted = _gap_fill_identity(icao, info)
                _save_to_database(icao, info, identity_enriched=attempted)
            _update_cache(icao, info)
            return info
    except DatabaseError as e:
        logger.debug(f"Database lookup failed for {icao}: {type(e).__name__}: {e}")

    # 3. Check in-memory databases
    data = external_db.lookup_all(icao)
    if data:
        info = _normalize_external_data(icao, data)
        attempted = False
        if _needs_identity(info) and _can_fetch_from_api(icao):
            info, attempted = _gap_fill_identity(icao, info)
        _update_cache(icao, info)
        _save_to_database(icao, info, identity_enriched=attempted)
        return info

    # 4. Try external APIs (with rate limiting)
    if _can_fetch_from_api(icao):
        info = _fetch_from_external_apis(icao)
        if info:
            _update_cache(icao, info)
            _save_to_database(icao, info, identity_enriched=True)
            return info

    return None


def get_bulk_aircraft_info(icao_list: list[str]) -> dict[str, dict]:
    """
    Get info for multiple aircraft.

    Returns dict mapping ICAO hex to info dict.
    Thread-safe: acquires lock once for entire cache check phase.
    """
    result = {}
    missing_icaos = []
    now = time.time()

    # Normalize all ICAOs first
    normalized_icaos = []
    for icao in icao_list:
        icao = icao.upper().strip().lstrip("~")
        if icao and len(icao) == 6:
            normalized_icaos.append(icao)

    # Check cache for all ICAOs at once (single lock acquisition for thread safety)
    with _cache_lock:
        for icao in normalized_icaos:
            if icao in _info_cache and _cache_ttl.get(icao, 0) > now:
                result[icao] = _info_cache[icao]
            else:
                missing_icaos.append(icao)

    # Bulk fetch from database
    if missing_icaos:
        try:
            db_infos = AircraftInfo.objects.filter(icao_hex__in=missing_icaos, fetch_failed=False)
            found_icaos = set()
            for db_info in db_infos:
                info = _serialize_db_info(db_info)
                result[db_info.icao_hex] = info
                _update_cache(db_info.icao_hex, info)
                found_icaos.add(db_info.icao_hex)

            # Update missing_icaos to exclude found ones (safe - local variable)
            missing_icaos = [icao for icao in missing_icaos if icao not in found_icaos]
        except DatabaseError as e:
            logger.debug(f"Bulk database lookup failed: {type(e).__name__}: {e}")

    # Remaining from in-memory databases. Mirror the single get_aircraft_info
    # path: identity gap-fill (once, rate-limited) + persist, so bulk callers get
    # the same enriched/persisted data instead of a row recomputed every restart.
    for icao in missing_icaos:
        data = external_db.lookup_all(icao)
        if data:
            info = _normalize_external_data(icao, data)
            attempted = False
            if _needs_identity(info) and _can_fetch_from_api(icao):
                info, attempted = _gap_fill_identity(icao, info)
            result[icao] = info
            _update_cache(icao, info)
            _save_to_database(icao, info, identity_enriched=attempted)

    return result


def queue_aircraft_lookup(icao_hex: str) -> bool:
    """
    Queue an aircraft for background lookup.

    Returns True if queued, False if already pending or limit reached.
    """
    icao = icao_hex.upper().strip().lstrip("~")
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
    except (ConnectionError, OSError, RuntimeError, KombuOperationalError) as e:
        # KombuOperationalError: broker unavailable - must release the pending
        # slot or repeated failures permanently exhaust MAX_PENDING
        logger.debug(f"Failed to queue lookup for {icao}: {type(e).__name__}: {e}")
        with _pending_lock:
            _pending_lookups.discard(icao)
        return False


def check_and_queue_new_aircraft(aircraft_list: list[dict]) -> int:
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
            icao = (ac.get("hex") or ac.get("icao_hex") or "").upper()
            if not icao or icao.startswith("~"):
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


def refresh_aircraft_info(icao_hex: str) -> dict | None:
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
        "cache_count": cache_count,
        "pending_lookups": pending_count,
        "seen_aircraft": seen_count,
        "databases_loaded": external_db.is_any_loaded(),
        "database_stats": external_db.get_database_stats(),
    }


# =============================================================================
# Photo Management
# =============================================================================


def get_aircraft_photo(icao_hex: str, prefer_thumbnail: bool = False) -> str | None:
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
    except DatabaseError:
        pass

    return None


def _queue_photo_fetch(icao_hex: str):
    """Queue background photo fetch."""
    try:
        from skyspy.tasks.external_db import fetch_aircraft_photos

        fetch_aircraft_photos.delay(icao_hex)
    except (ConnectionError, OSError, RuntimeError) as e:
        logger.debug(f"Failed to queue photo fetch for {icao_hex}: {type(e).__name__}: {e}")


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
        to_remove = sorted_keys[: len(sorted_keys) // 10]
        for k, _ in to_remove:
            _info_cache.pop(k, None)
            _cache_ttl.pop(k, None)


# Fields that local FAA MASTER data cannot supply (it only has registration/
# serial/year/owner). When a local hit leaves these blank we consult the
# external-API path once to fill them.
_IDENTITY_FILL_FIELDS = ("manufacturer", "model", "type_code", "type_name")


def _needs_identity(info: dict) -> bool:
    """True when the record is missing manufacturer or model."""
    return not info.get("manufacturer") or not info.get("model")


def _identity_enriched(db_info: AircraftInfo) -> bool:
    """True once we've already run an external-API identity gap-fill for a row."""
    return bool((db_info.extra_data or {}).get("identity_enriched"))


def _gap_fill_identity(icao: str, info: dict) -> tuple[dict, bool]:
    """Fill missing manufacturer/model/type from the external-API sources.

    Local FAA data has registration/owner but no manufacturer/model. When those
    are blank, consult HexDB/adsb.lol/adsbdb once and merge whatever they
    supply. Returns ``(merged_info, attempted)`` where ``attempted`` is True only
    if a source was actually reachable — so a transient open circuit is not
    cached as a permanent miss and can be retried later.
    """
    external = _fetch_from_external_apis(icao)
    if not external:
        return info, False

    # Only the aircraft-type identity fields — never operator/owner/country.
    # FAA is authoritative for ownership (e.g. "CITY OF SAN DIEGO"); HexDB's
    # RegisteredOwners ("Airbus Helicopters Inc") must not clobber or shadow it.
    for field in _IDENTITY_FILL_FIELDS:
        if not info.get(field) and external.get(field):
            info[field] = external[field]
    if not info.get("photo_url") and external.get("photo_url"):
        for field in ("photo_url", "photo_thumbnail_url", "photo_page_link", "photo_photographer", "photo_source"):
            if external.get(field):
                info[field] = external[field]

    merged_sources = list(info.get("sources") or [])
    for source in external.get("sources", []):
        if source not in merged_sources:
            merged_sources.append(source)
    info["sources"] = merged_sources
    return info, True


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


def _fetch_from_external_apis(icao: str) -> dict | None:
    """Fetch from external APIs (HexDB, adsb.lol, planespotters).

    Wrapped in single_flight so concurrent lookups for the SAME hex (new-aircraft
    detection, alert gap-fill, the assistant tools and the airframe REST endpoint
    can all fire at once) collapse to a single upstream waterfall instead of each
    running the full sequential chain. Coalescing only affects concurrent callers;
    sequential callers still run fresh (the lock is released immediately).
    """
    return http_client.single_flight(f"aircraft_info_ext:{icao}", lambda: _fetch_from_external_apis_impl(icao))


def _fetch_from_external_apis_impl(icao: str) -> dict | None:
    info = {}
    sources = []

    # Try HexDB. Shared client returns None on any failure and only retries
    # transient errors (a 404 for an unknown hex no longer raises RetryError).
    data = http_client.get_json(f"https://hexdb.io/api/v1/aircraft/{icao}", source="hexdb", timeout=10.0)
    if isinstance(data, dict):
        info = {
            "icao_hex": icao,
            "registration": data.get("Registration"),
            "type_code": data.get("ICAOTypeCode"),
            "manufacturer": data.get("Manufacturer"),
            "model": data.get("Type"),
            "operator": data.get("RegisteredOwners"),
        }
        sources.append("hexdb")

        # HexDB photo via HEAD (image/* only)
        photo_url = f"https://hexdb.io/hex-image?hex={icao.lower()}"
        if http_client.head_ok(photo_url, source="hexdb", timeout=5.0, expected_content_type="image/"):
            info["photo_url"] = photo_url
            info["photo_thumbnail_url"] = f"https://hexdb.io/hex-image-thumb?hex={icao.lower()}"
            info["photo_source"] = "hexdb.io"

    # Try adsb.lol if no info yet
    if not info:
        try:
            lol_data = external_db.fetch_aircraft_from_adsb_lol(icao)
            if lol_data:
                info = {
                    "icao_hex": icao,
                    "registration": lol_data.get("r"),
                    "type_code": lol_data.get("t"),
                }
                sources.append("adsb.lol")
        except (httpx.HTTPError, ConnectionError, OSError, ValueError) as e:
            logger.debug(f"adsb.lol lookup failed for {icao}: {type(e).__name__}: {e}")

    # Try ADS-B Exchange (RapidAPI) if still no info. Keyed premium source,
    # self-gated by ADSBX_LIVE_ENABLED + API key (returns None when off), so it
    # costs no quota unless explicitly enabled and the keyless sources missed.
    if not info:
        try:
            adsbx_data = adsbx_live.get_aircraft_by_icao(icao)
            if adsbx_data:
                info = {
                    "icao_hex": icao,
                    "registration": adsbx_data.get("registration"),
                    "type_code": adsbx_data.get("aircraft_type"),
                }
                sources.append("adsbexchange")
        except (httpx.HTTPError, ConnectionError, OSError, ValueError) as e:
            logger.debug(f"ADS-B Exchange lookup failed for {icao}: {type(e).__name__}: {e}")

    # Try ADSBdb (free, keyless) if still no info. Adds owner/manufacturer and
    # frequently a photo the other keyless sources lack.
    if not info:
        try:
            adsbdb_data = adsbdb.get_aircraft_by_icao(icao)
            if adsbdb_data:
                info = {
                    "icao_hex": icao,
                    "registration": adsbdb_data.get("registration"),
                    "type_code": adsbdb_data.get("type_code"),
                    "model": adsbdb_data.get("model"),
                    "manufacturer": adsbdb_data.get("manufacturer"),
                    "operator": adsbdb_data.get("owner"),
                    "country": adsbdb_data.get("country"),
                }
                if adsbdb_data.get("photo_url"):
                    info["photo_url"] = adsbdb_data["photo_url"]
                    info["photo_thumbnail_url"] = adsbdb_data.get("photo_thumbnail_url")
                    info["photo_source"] = "adsbdb"
                # Strip empty keys so downstream fill-if-empty merges cleanly.
                info = {k: v for k, v in info.items() if v not in (None, "")}
                sources.append("adsbdb")
        except (ConnectionError, OSError, ValueError) as e:
            logger.debug(f"ADSBdb lookup failed for {icao}: {type(e).__name__}: {e}")

    # Try planespotters for photo if we don't have one. Shared client returns
    # None on any failure (incl. 403/exhausted retries) instead of raising, and
    # only retries transient errors — a 4xx no longer burns the retry budget.
    # Planespotters 403s any request whose UA lacks a contact URL/email, so send
    # the configured contact UA. Many airframes (esp. US GA / helicopters like
    # N882SD) are indexed only by registration, not hex — so try /reg after /hex.
    if info and not info.get("photo_url"):
        ua = getattr(settings, "PHOTO_PLANESPOTTERS_USER_AGENT", "skyspy/2.6 (+https://github.com/skyspy/skyspy)")
        ps_headers = {"User-Agent": ua}
        ps_urls = [f"https://api.planespotters.net/pub/photos/hex/{icao}"]
        reg = info.get("registration")
        if reg:
            ps_urls.append(f"https://api.planespotters.net/pub/photos/reg/{reg}")
        for ps_url in ps_urls:
            data = http_client.get_json(ps_url, source="planespotters", timeout=10.0, headers=ps_headers)
            if isinstance(data, dict) and data.get("photos"):
                photo = data["photos"][0]
                large_thumb = photo.get("thumbnail_large", {})
                if isinstance(large_thumb, dict):
                    info["photo_url"] = large_thumb.get("src")
                small_thumb = photo.get("thumbnail", {})
                if isinstance(small_thumb, dict):
                    info["photo_thumbnail_url"] = small_thumb.get("src")
                info["photo_page_link"] = photo.get("link")
                info["photo_photographer"] = photo.get("photographer")
                info["photo_source"] = "planespotters.net"
                break

    if info:
        info["sources"] = sources
        return info

    return None


def _normalize_external_data(icao: str, data: dict) -> dict:
    """Normalize data from external_db.lookup_all()."""
    return {
        "icao_hex": icao,
        "registration": data.get("registration"),
        "type_code": data.get("type_code"),
        "type_name": data.get("type_name"),
        "manufacturer": data.get("manufacturer"),
        "model": data.get("model"),
        "operator": data.get("operator") or data.get("owner"),
        "operator_icao": data.get("operator_icao"),
        "owner": data.get("owner"),
        "year_built": data.get("year_built"),
        "serial_number": data.get("serial_number"),
        "country": data.get("country"),
        "category": data.get("category"),
        "is_military": data.get("is_military", False),
        "is_interesting": data.get("is_interesting", False),
        "is_pia": data.get("is_pia", False),
        "is_ladd": data.get("is_ladd", False),
        "sources": data.get("sources", []),
    }


def _serialize_db_info(info: AircraftInfo) -> dict:
    """Serialize AircraftInfo model to dict."""
    return {
        "icao_hex": info.icao_hex,
        "registration": info.registration,
        "type_code": info.type_code,
        "type_name": info.type_name,
        "manufacturer": info.manufacturer,
        "model": info.model,
        "operator": info.operator,
        "operator_icao": info.operator_icao,
        "owner": info.owner,
        "year_built": info.year_built,
        "serial_number": info.serial_number,
        "country": info.country,
        "category": info.category,
        "is_military": info.is_military,
        "is_interesting": info.is_interesting,
        "is_pia": info.is_pia,
        "is_ladd": info.is_ladd,
        "photo_url": info.photo_url,
        "photo_thumbnail_url": info.photo_thumbnail_url,
        "photo_page_link": info.photo_page_link,
        "photo_photographer": info.photo_photographer,
        "photo_source": info.photo_source,
        "source": info.source,
    }


def _save_to_database(icao: str, info: dict, identity_enriched: bool = False):
    """Save aircraft info to database.

    ``identity_enriched=True`` records that the external-API identity gap-fill
    has run for this row, so the lookup is never repeated on later reads.
    """
    try:
        obj, _ = AircraftInfo.objects.update_or_create(
            icao_hex=icao,
            defaults={
                "registration": info.get("registration"),
                "type_code": info.get("type_code"),
                "manufacturer": info.get("manufacturer"),
                "model": info.get("model"),
                "operator": info.get("operator"),
                "operator_icao": info.get("operator_icao"),
                "owner": info.get("owner"),
                "year_built": info.get("year_built"),
                "serial_number": info.get("serial_number"),
                "country": info.get("country"),
                "category": info.get("category"),
                "is_military": info.get("is_military", False),
                "is_interesting": info.get("is_interesting", False),
                "is_pia": info.get("is_pia", False),
                "is_ladd": info.get("is_ladd", False),
                "photo_url": info.get("photo_url"),
                "photo_thumbnail_url": info.get("photo_thumbnail_url"),
                "photo_page_link": info.get("photo_page_link"),
                "photo_photographer": info.get("photo_photographer"),
                "photo_source": info.get("photo_source"),
                "source": ",".join(info.get("sources", [])) if info.get("sources") else None,
                "fetch_failed": False,
            },
        )
        if identity_enriched and not (obj.extra_data or {}).get("identity_enriched"):
            extra = dict(obj.extra_data or {})
            extra["identity_enriched"] = True
            obj.extra_data = extra
            obj.save(update_fields=["extra_data", "updated_at"])
    except DatabaseError as e:
        logger.debug(f"Failed to save aircraft info for {icao}: {type(e).__name__}: {e}")


# =============================================================================
# Broadcasting
# =============================================================================


def broadcast_aircraft_info(icao_hex: str, info: dict):
    """Broadcast aircraft info update to WebSocket clients."""
    from skyspy.socketio.utils import sync_emit

    try:
        sync_emit(
            "aircraft:update",
            {"icao": icao_hex, "info": info, "timestamp": datetime.utcnow().isoformat() + "Z"},
            room="topic_aircraft",
        )
    except (ConnectionError, OSError, RuntimeError) as e:
        logger.warning(f"Failed to broadcast aircraft info: {type(e).__name__}: {e}")
