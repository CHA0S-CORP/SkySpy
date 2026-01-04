"""
Utility functions for distance calculations, validation, and data processing.
"""
import asyncio
import logging
import math
import time
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# Rate limiting: track last request time per domain
_domain_last_request: dict[str, float] = {}
_domain_rate_limits: dict[str, float] = {
    "airport-data.com": 2.0,      # 1 request per 2 seconds
    "planespotters.net": 1.0,     # 1 request per second
    "api.planespotters.net": 1.0,
    "hexdb.io": 0.5,              # 2 requests per second
    "opensky-network.org": 1.0,   # 1 request per second
}
_domain_backoff_until: dict[str, float] = {}  # Backoff after 429


def calculate_distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in nautical miles using Haversine formula."""
    R = 3440.065  # Earth radius in nautical miles
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = (math.sin(delta_lat / 2) ** 2 + 
         math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2)
    
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_valid_position(lat: Optional[float], lon: Optional[float]) -> bool:
    """Check if coordinates are valid (not None and not null island)."""
    if lat is None or lon is None:
        return False
    # Check for null island (0,0) - usually erroneous data
    if abs(lat) < 0.01 and abs(lon) < 0.01:
        return False
    # Basic bounds check
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return False
    return True


def safe_int_altitude(alt_value: Any) -> Optional[int]:
    """Safely convert altitude to int, handling 'ground' and other strings."""
    if alt_value is None:
        return None
    if isinstance(alt_value, int):
        return alt_value
    if isinstance(alt_value, float):
        return int(alt_value)
    if isinstance(alt_value, str):
        if alt_value.lower() == "ground":
            return 0
        try:
            return int(float(alt_value))
        except (ValueError, TypeError):
            return None
    return None


def parse_iso_timestamp(ts_str: str) -> Optional[float]:
    """Parse ISO 8601 timestamp or unix timestamp string to epoch float."""
    if not ts_str:
        return None
    
    # Try unix timestamp first
    try:
        return float(ts_str)
    except ValueError:
        pass
    
    # Try ISO format
    try:
        ts_clean = ts_str.strip()
        if ts_clean.endswith("Z"):
            ts_clean = ts_clean[:-1] + "+00:00"
        if "+" not in ts_clean and "-" not in ts_clean[10:]:
            ts_clean = ts_clean + "+00:00"
        
        dt = datetime.fromisoformat(ts_clean)
        return dt.timestamp()
    except (ValueError, TypeError):
        return None


async def safe_request(
    url: str,
    timeout: float = 5.0,
    max_retries: int = 2,
    is_upstream: bool = True
) -> Optional[dict]:
    """
    Make a safe HTTP request with timeout, rate limiting, and 429 handling.

    Features:
    - Global upstream rate limiting (1 request per configured interval, default 60s)
    - Per-domain rate limiting to avoid hitting rate limits
    - Automatic retry with exponential backoff on 429 responses
    - Respects Retry-After header when provided

    Args:
        url: The URL to request
        timeout: Request timeout in seconds
        max_retries: Maximum retry attempts on 429
        is_upstream: If True, apply global upstream rate limiting (for external APIs)
    """
    from app.core.cache import check_upstream_rate_limit, mark_upstream_request

    # Extract domain for rate limiting (strip port if present)
    parsed = urlparse(url)
    domain = parsed.hostname.lower() if parsed.hostname else parsed.netloc.lower()

    # Check if this is a local request (skip upstream rate limiting for local services)
    # Include Docker service names (ultrafeeder, dump978) as local services
    local_services = {"localhost", "127.0.0.1", "ultrafeeder", "dump978"}
    is_local = domain in local_services or domain.startswith("192.168.") or domain.startswith("10.")

    # Apply global upstream rate limiting for external APIs
    if is_upstream and not is_local:
        if not await check_upstream_rate_limit():
            logger.debug(f"Upstream rate limited, skipping request to {domain}")
            return None

    # Check if we're in backoff period for this domain
    now = time.time()
    backoff_until = _domain_backoff_until.get(domain, 0)
    if now < backoff_until:
        wait_time = backoff_until - now
        logger.debug(f"Rate limited: {domain} in backoff for {wait_time:.1f}s more")
        return None

    # Apply per-domain rate limiting
    min_interval = _domain_rate_limits.get(domain, 0.2)  # Default 5 req/sec
    last_request = _domain_last_request.get(domain, 0)
    elapsed = now - last_request

    if elapsed < min_interval:
        wait_time = min_interval - elapsed
        await asyncio.sleep(wait_time)

    _domain_last_request[domain] = time.time()

    # Mark that we're making an upstream request
    if is_upstream and not is_local:
        await mark_upstream_request()

    # Make request with retry logic
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(
                    url,
                    headers={"User-Agent": "ADS-B-API/2.6 (aircraft-tracker)"}
                )

                # Handle rate limiting
                if response.status_code == 429:
                    # Get retry delay from header or use exponential backoff
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            delay = int(retry_after)
                        except ValueError:
                            delay = 60  # Default if header is invalid
                    else:
                        delay = min(60, 5 * (2 ** attempt))  # Exponential backoff, max 60s

                    logger.warning(f"Rate limited (429) from {domain}, backing off for {delay}s")
                    _domain_backoff_until[domain] = time.time() + delay

                    if attempt < max_retries:
                        await asyncio.sleep(delay)
                        continue
                    return None

                response.raise_for_status()
                return response.json()

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < max_retries:
                delay = min(60, 5 * (2 ** attempt))
                logger.warning(f"Rate limited (429) from {domain}, retrying in {delay}s")
                await asyncio.sleep(delay)
                continue
            logger.debug(f"HTTP error from {domain}: {e.response.status_code}")
            return None
        except Exception as e:
            logger.debug(f"Request failed for {url}: {e}")
            return None

    return None


def get_aircraft_icon(ac: dict) -> str:
    """Determine icon type based on aircraft category/type."""
    category = ac.get("category", "")
    ac_type = (ac.get("t") or "").upper()
    
    heli_prefixes = [
        "H60", "H47", "H53", "EC", "AS", "BK", "UH", "AH", 
        "CH", "MH", "S76", "S92", "B06", "B47", "R22", "R44", "R66"
    ]
    
    if category == "A7" or any(ac_type.startswith(h) for h in heli_prefixes):
        return "helicopter"
    if category == "B4":
        return "glider"
    if ac.get("dbFlags", 0) & 1:
        return "fighter" if category == "A1" else "military"
    if category in ["A1", "B1"]:
        return "light"
    if category == "A5":
        return "heavy"
    if category == "A4":
        return "jet"
    
    return "aircraft"


def simplify_aircraft(ac: dict, distance_nm: Optional[float] = None) -> dict:
    """Simplify aircraft data for API responses."""
    return {
        "hex": ac.get("hex"),
        "flight": (ac.get("flight") or "").strip(),
        "type": ac.get("t"),
        "alt": ac.get("alt_baro"),
        "gs": ac.get("gs"),
        "vr": ac.get("baro_rate"),
        "distance_nm": round(distance_nm, 1) if distance_nm else None,
        "squawk": ac.get("squawk"),
        "category": ac.get("category"),
        "rssi": ac.get("rssi"),
        "lat": ac.get("lat"),
        "lon": ac.get("lon"),
        "track": ac.get("track"),
        "military": bool(ac.get("dbFlags", 0) & 1),
        "emergency": ac.get("squawk") in ["7500", "7600", "7700"],
    }
