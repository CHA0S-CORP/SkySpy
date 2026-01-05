"""
Photo caching service.
Downloads and caches aircraft photos to local filesystem or S3.

Storage backends:
- Local filesystem (default): /data/photos/
- S3/MinIO/Wasabi: s3://bucket/prefix/
"""
import asyncio
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple, List

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import AircraftInfo

logger = logging.getLogger(__name__)
settings = get_settings()

# Pending downloads to prevent duplicates
_pending_downloads: set[str] = set()

# Download queue for background processing
_download_queue: asyncio.Queue = None

# S3 client (lazy initialized) with lock for thread-safe initialization
_s3_client = None
_s3_client_lock = asyncio.Lock()
_s3_client_init_failed = False

# Regex to extract Planespotters Photo ID
# Matches: https://t.plnspttrs.net/16653/1531024_35907ab605_t.jpg -> 1531024
PLANESPOTTERS_ID_REGEX = re.compile(r"plnspttrs\.net/\d+/(\d+)_")

# S3 operation retry settings
S3_MAX_RETRIES = 3
S3_RETRY_DELAY = 0.5  # seconds


async def reset_s3_client():
    """
    Reset the S3 client state. Useful for recovery after configuration
    changes or transient failures.
    """
    global _s3_client, _s3_client_init_failed

    async with _s3_client_lock:
        _s3_client = None
        _s3_client_init_failed = False
        logger.info("S3 client state reset")

def _get_s3_client_sync():
    """
    Synchronous S3 client initialization (called within lock).
    Returns the client or None if initialization fails.
    """
    global _s3_client, _s3_client_init_failed

    if _s3_client is not None:
        return _s3_client

    if _s3_client_init_failed:
        return None

    if not settings.s3_enabled:
        return None

    try:
        import boto3
        from botocore.config import Config

        config = Config(
            signature_version='s3v4',
            retries={'max_attempts': 3, 'mode': 'standard'},
            connect_timeout=10,
            read_timeout=30,
        )

        client_kwargs = {
            'service_name': 's3',
            'region_name': settings.s3_region,
            'config': config,
        }

        # Use explicit credentials if provided
        if settings.s3_access_key and settings.s3_secret_key:
            client_kwargs['aws_access_key_id'] = settings.s3_access_key
            client_kwargs['aws_secret_access_key'] = settings.s3_secret_key

        # Custom endpoint for MinIO, Wasabi, etc.
        if settings.s3_endpoint_url:
            client_kwargs['endpoint_url'] = settings.s3_endpoint_url

        _s3_client = boto3.client(**client_kwargs)
        logger.info(f"S3 client initialized: bucket={settings.s3_bucket}, prefix={settings.s3_prefix}")
        return _s3_client

    except ImportError:
        logger.error("boto3 not installed - S3 storage unavailable. Install with: pip install boto3")
        _s3_client_init_failed = True
        return None
    except Exception as e:
        logger.error(f"Failed to initialize S3 client: {e}")
        _s3_client_init_failed = True
        return None


async def _get_s3_client():
    """Get or create S3 client with thread-safe lazy initialization."""
    global _s3_client

    # Fast path: client already initialized
    if _s3_client is not None:
        return _s3_client

    # Slow path: acquire lock and initialize
    async with _s3_client_lock:
        # Double-check after acquiring lock
        if _s3_client is not None:
            return _s3_client
        return _get_s3_client_sync()


def _get_s3_key(icao_hex: str, is_thumbnail: bool = False) -> str:
    """Get S3 key for photo."""
    suffix = "_thumb" if is_thumbnail else ""
    prefix = settings.s3_prefix.strip("/")
    return f"{prefix}/{icao_hex.upper()}{suffix}.jpg"


def _get_s3_url(icao_hex: str, is_thumbnail: bool = False) -> str:
    """Get public URL for S3 photo (unsigned - for public buckets only)."""
    key = _get_s3_key(icao_hex, is_thumbnail)

    # Use custom public URL if configured (e.g., CDN)
    if settings.s3_public_url:
        base = settings.s3_public_url.rstrip("/")
        # Remove prefix from key if public URL already includes it
        prefix_with_slash = settings.s3_prefix.strip("/") + "/"
        if settings.s3_prefix and key.startswith(prefix_with_slash):
            key = key[len(prefix_with_slash):]
        return f"{base}/{key}"

    # Default S3 URL format
    if settings.s3_endpoint_url:
        # Custom endpoint (MinIO, etc.)
        endpoint = settings.s3_endpoint_url.rstrip("/")
        return f"{endpoint}/{settings.s3_bucket}/{key}"
    else:
        # Standard AWS S3
        return f"https://{settings.s3_bucket}.s3.{settings.s3_region}.amazonaws.com/{key}"


async def get_signed_s3_url(icao_hex: str, is_thumbnail: bool = False, expires_in: int = 3600) -> Optional[str]:
    """
    Generate a signed URL for S3 photo access.

    Args:
        icao_hex: Aircraft ICAO hex code
        is_thumbnail: Whether this is a thumbnail
        expires_in: URL expiration time in seconds (default 1 hour)

    Returns:
        Signed URL or None if S3 is not available
    """
    client = await _get_s3_client()
    if not client:
        return None

    key = _get_s3_key(icao_hex, is_thumbnail)

    try:
        loop = asyncio.get_running_loop()
        url = await loop.run_in_executor(
            None,
            lambda: client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': settings.s3_bucket,
                    'Key': key,
                },
                ExpiresIn=expires_in,
            )
        )
        return url
    except Exception as e:
        logger.error(f"Failed to generate signed URL for {icao_hex}: {e}")
        return None


async def get_photo_url(
    icao_hex: str,
    is_thumbnail: bool = False,
    signed: bool = True,
    verify_exists: bool = False
) -> Optional[str]:
    """
    Get accessible URL for a cached photo (S3 signed URL or local path).

    Args:
        icao_hex: Aircraft ICAO hex code
        is_thumbnail: Whether to get thumbnail URL
        signed: Whether to generate a signed URL for S3 (default True)
        verify_exists: Whether to verify the S3 object exists before returning URL

    Returns:
        Accessible URL for the photo, or None if not cached
    """
    icao_hex = icao_hex.upper()

    if settings.s3_enabled:
        # Optionally verify the object exists in S3
        if verify_exists:
            exists = await _check_s3_exists(icao_hex, is_thumbnail)
            if not exists:
                return None

        if signed:
            return await get_signed_s3_url(icao_hex, is_thumbnail)
        else:
            return _get_s3_url(icao_hex, is_thumbnail)
    else:
        # Local storage - return the file path
        path = get_photo_path(icao_hex, is_thumbnail)
        if path.exists() and path.stat().st_size > 0:
            return str(path)
        return None


async def _upload_to_s3(data: bytes, icao_hex: str, is_thumbnail: bool = False) -> Optional[str]:
    """Upload photo to S3 with retry logic. Returns URL or None on failure."""
    client = await _get_s3_client()
    if not client:
        return None

    key = _get_s3_key(icao_hex, is_thumbnail)
    loop = asyncio.get_running_loop()

    last_error = None
    for attempt in range(S3_MAX_RETRIES):
        try:
            await loop.run_in_executor(
                None,
                lambda: client.put_object(
                    Bucket=settings.s3_bucket,
                    Key=key,
                    Body=data,
                    ContentType='image/jpeg',
                    CacheControl='max-age=31536000',  # 1 year cache
                )
            )

            url = _get_s3_url(icao_hex, is_thumbnail)
            logger.info(f"Uploaded to S3: {key}")
            return url

        except Exception as e:
            last_error = e
            if attempt < S3_MAX_RETRIES - 1:
                logger.warning(f"S3 upload attempt {attempt + 1} failed for {icao_hex}: {e}, retrying...")
                await asyncio.sleep(S3_RETRY_DELAY * (attempt + 1))  # Exponential backoff
            else:
                logger.error(f"S3 upload failed for {icao_hex} after {S3_MAX_RETRIES} attempts: {last_error}")

    return None


class S3CheckResult:
    """Result of an S3 existence check."""
    EXISTS = "exists"
    NOT_FOUND = "not_found"
    ERROR = "error"


async def _check_s3_exists(
    icao_hex: str,
    is_thumbnail: bool = False,
    return_detailed: bool = False
) -> bool | S3CheckResult:
    """
    Check if photo exists in S3.

    Args:
        icao_hex: Aircraft ICAO hex code
        is_thumbnail: Whether this is a thumbnail
        return_detailed: If True, returns S3CheckResult instead of bool

    Returns:
        bool (default) or S3CheckResult if return_detailed=True
    """
    client = await _get_s3_client()
    if not client:
        return S3CheckResult.ERROR if return_detailed else False

    key = _get_s3_key(icao_hex, is_thumbnail)

    try:
        from botocore.exceptions import ClientError

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: client.head_object(Bucket=settings.s3_bucket, Key=key)
        )
        return S3CheckResult.EXISTS if return_detailed else True

    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == '404' or error_code == 'NoSuchKey':
            return S3CheckResult.NOT_FOUND if return_detailed else False
        # Other errors (permissions, network, etc.) - log and treat as error
        logger.warning(f"S3 head_object error for {icao_hex}: {error_code} - {e}")
        return S3CheckResult.ERROR if return_detailed else False

    except ImportError:
        logger.error("botocore not available for error handling")
        return S3CheckResult.ERROR if return_detailed else False

    except Exception as e:
        # Network errors, timeouts, etc.
        logger.warning(f"S3 existence check failed for {icao_hex}: {e}")
        return S3CheckResult.ERROR if return_detailed else False


async def _scrape_planespotters_full_size(page_url: str, client: httpx.AsyncClient) -> Optional[str]:
    """
    Scrape a Planespotters photo page to find the full-size image URL.

    The Planespotters API provides a 'link' field with the photo page URL.
    We scrape this page to find the CDN URL for the original/large image.

    Args:
        page_url: The photo page URL (e.g., https://www.planespotters.net/photo/1234567)
        client: httpx AsyncClient to use

    Returns:
        Full-size image URL if found, None otherwise
    """
    if not page_url or "planespotters.net/photo" not in page_url:
        return None

    try:
        logger.info(f"Scraping Planespotters page for full-size: {page_url}")

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        }

        resp = await client.get(page_url, headers=headers, follow_redirects=True)
        resp.raise_for_status()
        html = resp.text

        # Try to find original size URL (_o.jpg) in the HTML
        # Pattern matches: https://cdn.plnspttrs.net/xxxxx/photo_hash_o.jpg
        original_match = re.search(r'https://cdn\.plnspttrs\.net/[^"\'<>\s]+_o\.jpg', html)
        if original_match:
            original_url = original_match.group(0)
            logger.info(f"Found original size: {original_url}")
            return original_url

        # Fallback: try large size (_l.jpg)
        large_match = re.search(r'https://cdn\.plnspttrs\.net/[^"\'<>\s]+_l\.jpg', html)
        if large_match:
            large_url = large_match.group(0)
            logger.info(f"Found large size (fallback): {large_url}")
            return large_url

        logger.warning(f"No full-size URL found in page: {page_url}")

    except httpx.HTTPStatusError as e:
        logger.warning(f"HTTP {e.response.status_code} scraping {page_url}")
    except Exception as e:
        logger.warning(f"Failed to scrape {page_url}: {e}")

    return None


# ============================================================================
# Local filesystem functions
# ============================================================================

def get_cache_dir() -> Path:
    """Get and create cache directory."""
    cache_dir = Path(settings.photo_cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def get_photo_path(icao_hex: str, is_thumbnail: bool = False) -> Path:
    """Get local path for cached photo."""
    cache_dir = get_cache_dir()
    suffix = "_thumb" if is_thumbnail else ""
    return cache_dir / f"{icao_hex.upper()}{suffix}.jpg"


def get_cached_photo(icao_hex: str, thumbnail: bool = False) -> Optional[Path]:
    """
    Get path to cached photo if it exists locally.
    
    Returns:
        Path to cached photo or None if not cached
    """
    if settings.s3_enabled:
        return None  # Use S3 URLs instead
    
    path = get_photo_path(icao_hex, thumbnail)
    if path.exists() and path.stat().st_size > 0:
        return path
    return None


# ============================================================================
# Main download/cache functions
# ============================================================================

async def download_photo(
    url: str,
    icao_hex: str,
    is_thumbnail: bool = False,
    timeout: float = 30.0,
    photo_page_link: Optional[str] = None,
    force: bool = False
) -> Optional[str]:
    """
    Download a photo and save to cache (local or S3).

    If photo_page_link is provided (Planespotters), it will scrape the page
    to get the full-size image URL instead of using the thumbnail URL.

    Args:
        url: Fallback URL if scraping fails
        icao_hex: Aircraft ICAO hex code
        is_thumbnail: Whether this is a thumbnail download
        timeout: Request timeout in seconds
        photo_page_link: Planespotters page URL to scrape for full-size
        force: If True, skip cache check and re-download (for upgrades)

    Returns:
        Path/URL to cached file or None on failure
    """
    if not settings.photo_cache_enabled:
        return None

    if not url:
        return None

    icao_hex = icao_hex.upper()
    cache_key = f"{icao_hex}:{'thumb' if is_thumbnail else 'full'}"

    # Prevent duplicate downloads
    if cache_key in _pending_downloads:
        return None

    _pending_downloads.add(cache_key)

    try:
        # Check if already cached (skip if force=True for upgrades)
        if not force:
            if settings.s3_enabled:
                # Use detailed result to distinguish "not found" from "error"
                check_result = await _check_s3_exists(icao_hex, is_thumbnail, return_detailed=True)
                if check_result == S3CheckResult.EXISTS:
                    return _get_s3_url(icao_hex, is_thumbnail)
                # If ERROR, proceed to download (don't trust the result)
                # If NOT_FOUND, proceed to download
            else:
                path = get_photo_path(icao_hex, is_thumbnail)
                if path.exists() and path.stat().st_size > 0:
                    return str(path)

        async with httpx.AsyncClient(timeout=timeout) as client:
            target_url = url

            # For full-size Planespotters photos, try to scrape the page for high-res URL
            if not is_thumbnail and photo_page_link:
                logger.info(f"Will scrape page link for {icao_hex}: {photo_page_link}")
                scraped_url = await _scrape_planespotters_full_size(photo_page_link, client)
                if scraped_url:
                    target_url = scraped_url

            logger.info(f"Downloading photo for {icao_hex}: {target_url}")

            # Build headers - use browser-like headers for Planespotters
            if "plnspttrs.net" in target_url or "planespotters.net" in target_url:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Referer": "https://www.planespotters.net/",
                    "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                    "Sec-Ch-Ua-Mobile": "?0",
                    "Sec-Ch-Ua-Platform": '"Windows"',
                    "Sec-Fetch-Dest": "image",
                    "Sec-Fetch-Mode": "no-cors",
                    "Sec-Fetch-Site": "cross-site",
                }
            else:
                headers = {
                    "User-Agent": "Mozilla/5.0 (compatible; ADS-B API/2.6)",
                    "Accept": "image/*",
                }

            try:
                response = await client.get(
                    target_url,
                    headers=headers,
                    follow_redirects=True
                )
                response.raise_for_status()
            except Exception as e:
                raise e

            # Verify it's an image
            content_type = response.headers.get("content-type", "")
            if not content_type.startswith("image/"):
                logger.warning(f"Not an image ({content_type}): {target_url}")
                return None
            
            data = response.content
            
            # Save to S3 or local filesystem
            if settings.s3_enabled:
                result = await _upload_to_s3(data, icao_hex, is_thumbnail)
                if result:
                    logger.info(f"Cached photo to S3 for {icao_hex}")
                return result
            else:
                path = get_photo_path(icao_hex, is_thumbnail)
                path.write_bytes(data)
                logger.info(f"Cached photo locally for {icao_hex}: {path}")
                return str(path)
    
    except httpx.TimeoutException:
        logger.warning(f"Timeout downloading photo for {icao_hex}")
        return None
    except httpx.HTTPStatusError as e:
        logger.warning(f"HTTP error downloading photo for {icao_hex}: {e.response.status_code}")
        return None
    except Exception as e:
        logger.error(f"Error downloading photo for {icao_hex}: {e}")
        return None
    finally:
        _pending_downloads.discard(cache_key)


async def cache_aircraft_photos(
    db: AsyncSession,
    icao_hex: str,
    photo_url: Optional[str] = None,
    thumbnail_url: Optional[str] = None,
    photo_page_link: Optional[str] = None,
    force: bool = False
) -> Tuple[Optional[str], Optional[str]]:
    """
    Download and cache both full-size and thumbnail photos.
    Updates database with local cache paths or S3 URLs.

    Args:
        db: Database session
        icao_hex: Aircraft ICAO hex code
        photo_url: URL to full-size photo (or thumbnail if full-size unavailable)
        thumbnail_url: URL to thumbnail photo
        photo_page_link: Optional Planespotters page URL to scrape for full-size
        force: If True, skip cache check and re-download (for upgrades)

    Returns:
        Tuple of (photo_path_or_url, thumbnail_path_or_url)
    """
    if not settings.photo_cache_enabled:
        return None, None

    icao_hex = icao_hex.upper()
    photo_path = None
    thumb_path = None

    # Download full-size photo (pass photo_page_link to try scraping for high-res)
    if photo_url:
        result = await download_photo(
            photo_url, icao_hex, is_thumbnail=False,
            photo_page_link=photo_page_link, force=force
        )
        if result:
            photo_path = result

    # Download thumbnail (no scraping needed)
    if thumbnail_url:
        result = await download_photo(thumbnail_url, icao_hex, is_thumbnail=True)
        if result:
            thumb_path = result

    # Update database with local paths / S3 URLs
    if photo_path or thumb_path:
        await update_photo_paths(icao_hex, photo_path, thumb_path)

    return photo_path, thumb_path


async def update_photo_paths(
    icao_hex: str,
    photo_path: Optional[str] = None,
    thumb_path: Optional[str] = None
):
    """
    Update database with cached photo paths.
    Uses a fresh short-lived session to avoid connection pool exhaustion.
    """
    from app.core.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(AircraftInfo)
                .where(AircraftInfo.icao_hex == icao_hex)
                .values(
                    photo_local_path=photo_path,
                    photo_thumbnail_local_path=thumb_path
                )
            )
            await db.commit()
    except Exception as e:
        logger.error(f"Error updating photo cache paths for {icao_hex}: {e}")


async def get_or_download_photo(
    db: AsyncSession,
    icao_hex: str,
    thumbnail: bool = False
) -> Optional[bytes]:
    """
    Get photo bytes from cache or download if not cached.
    
    Returns:
        Photo bytes or None
    """
    icao_hex = icao_hex.upper()
    
    # For S3, we return URLs not bytes (use photo_url from DB)
    if settings.s3_enabled:
        # Check if already in S3
        if await _check_s3_exists(icao_hex, thumbnail):
            # Return None - caller should use the URL from DB
            return None
    else:
        # Check local cache first
        cached = get_cached_photo(icao_hex, thumbnail)
        if cached:
            return cached.read_bytes()
    
    # Get URLs from database
    result = await db.execute(
        select(AircraftInfo).where(AircraftInfo.icao_hex == icao_hex)
    )
    info = result.scalar_one_or_none()
    
    if not info:
        return None
    
    url = info.photo_thumbnail_url if thumbnail else info.photo_url
    if not url:
        url = info.photo_url  # Fallback
    
    if not url:
        return None
    
    # Download and cache
    result_path = await download_photo(url, icao_hex, is_thumbnail=thumbnail)
    
    if result_path and not settings.s3_enabled:
        # Local storage - return bytes
        return Path(result_path).read_bytes()
    
    return None


def get_cache_stats() -> dict:
    """Get statistics about the photo cache."""
    
    if settings.s3_enabled:
        return {
            "enabled": settings.photo_cache_enabled,
            "storage": "s3",
            "bucket": settings.s3_bucket,
            "prefix": settings.s3_prefix,
            "region": settings.s3_region,
            "endpoint": settings.s3_endpoint_url,
            "public_url": settings.s3_public_url,
        }
    
    cache_dir = get_cache_dir()
    
    if not cache_dir.exists():
        return {
            "enabled": settings.photo_cache_enabled,
            "storage": "local",
            "cache_dir": str(cache_dir),
            "total_photos": 0,
            "total_thumbnails": 0,
            "total_size_mb": 0,
        }
    
    photos = list(cache_dir.glob("*[!_thumb].jpg"))
    thumbnails = list(cache_dir.glob("*_thumb.jpg"))
    
    total_size = sum(f.stat().st_size for f in cache_dir.glob("*.jpg"))
    
    return {
        "enabled": settings.photo_cache_enabled,
        "storage": "local",
        "cache_dir": str(cache_dir),
        "total_photos": len(photos),
        "total_thumbnails": len(thumbnails),
        "total_size_mb": round(total_size / (1024 * 1024), 2),
    }


# ============================================================================
# Background queue processing
# ============================================================================

async def init_download_queue():
    """Initialize the background download queue."""
    global _download_queue
    _download_queue = asyncio.Queue()


async def queue_photo_download(
    icao_hex: str,
    photo_url: str,
    thumbnail_url: str = None,
    photo_page_link: str = None
):
    """Add photo download to background queue."""
    if _download_queue is not None:
        await _download_queue.put({
            "icao_hex": icao_hex,
            "photo_url": photo_url,
            "thumbnail_url": thumbnail_url,
            "photo_page_link": photo_page_link,
        })


async def process_download_queue(db_session_factory):
    """Background task to process photo download queue."""
    global _download_queue
    
    if _download_queue is None:
        await init_download_queue()
    
    logger.info("Photo download queue processor started")
    
    while True:
        try:
            # Get next item (wait up to 5 seconds)
            try:
                item = await asyncio.wait_for(_download_queue.get(), timeout=5.0)
            except asyncio.TimeoutError:
                # Sleep briefly on timeout to prevent CPU spinning during low activity
                await asyncio.sleep(0.5)
                continue
            
            icao_hex = item["icao_hex"]
            photo_url = item.get("photo_url")
            thumbnail_url = item.get("thumbnail_url")
            photo_page_link = item.get("photo_page_link")

            if photo_url or thumbnail_url:
                async with db_session_factory() as db:
                    await cache_aircraft_photos(
                        db, icao_hex, photo_url, thumbnail_url, photo_page_link
                    )
            
            _download_queue.task_done()
            
            # Small delay between downloads
            await asyncio.sleep(0.5)
        
        except asyncio.CancelledError:
            logger.info("Photo download queue processor stopping")
            break
        except Exception as e:
            logger.error(f"Error in download queue processor: {e}")
            await asyncio.sleep(1)