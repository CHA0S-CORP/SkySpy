"""
Photo caching service.

Downloads and caches aircraft photos to local filesystem or S3.

Storage backends:
- Local filesystem (default): /data/photos/
- S3/MinIO/Wasabi: s3://bucket/prefix/
"""
import logging
import re
import threading
import time
from pathlib import Path
from typing import Optional, Tuple

import httpx
from django.conf import settings

from skyspy.models import AircraftInfo
from skyspy.services.storage import (
    upload_to_s3,
    check_s3_exists,
    generate_signed_url,
    get_s3_key,
)

logger = logging.getLogger(__name__)

# Pending downloads to prevent duplicates
_pending_downloads: set[str] = set()
_pending_lock = threading.Lock()

# S3 existence cache (thread-safe)
_s3_exists_cache: dict[str, tuple[bool, float]] = {}
_s3_exists_cache_lock = threading.Lock()
_S3_EXISTS_CACHE_TTL = 300  # 5 minutes

# Regex to extract Planespotters Photo ID
PLANESPOTTERS_ID_REGEX = re.compile(r"plnspttrs\.net/\d+/(\d+)_")

# Retry settings
MAX_RETRIES = 3
RETRY_DELAY = 0.5


def get_cache_dir() -> Path:
    """Get and create cache directory."""
    cache_dir = Path(settings.PHOTO_CACHE_DIR)
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def get_photo_path(icao_hex: str, is_thumbnail: bool = False) -> Path:
    """Get local path for cached photo."""
    cache_dir = get_cache_dir()
    suffix = "_thumb" if is_thumbnail else ""
    return cache_dir / f"{icao_hex.upper()}{suffix}.jpg"


def _get_s3_photo_key(icao_hex: str, is_thumbnail: bool = False) -> str:
    """Get S3 key for photo."""
    suffix = "_thumb" if is_thumbnail else ""
    prefix = settings.S3_PREFIX.strip("/")
    return f"{prefix}/{icao_hex.upper()}{suffix}.jpg"


def _get_s3_photo_url(icao_hex: str, is_thumbnail: bool = False) -> str:
    """Get public URL for S3 photo."""
    key = _get_s3_photo_key(icao_hex, is_thumbnail)

    if settings.S3_PUBLIC_URL:
        base = settings.S3_PUBLIC_URL.rstrip("/")
        prefix_with_slash = settings.S3_PREFIX.strip("/") + "/"
        if key.startswith(prefix_with_slash):
            key = key[len(prefix_with_slash):]
        return f"{base}/{key}"

    if settings.S3_ENDPOINT_URL:
        endpoint = settings.S3_ENDPOINT_URL.rstrip("/")
        return f"{endpoint}/{settings.S3_BUCKET}/{key}"

    return f"https://{settings.S3_BUCKET}.s3.{settings.S3_REGION}.amazonaws.com/{key}"


def _check_s3_photo_exists(icao_hex: str, is_thumbnail: bool = False) -> bool:
    """Check if photo exists in S3 with caching."""
    cache_key = f"{icao_hex}:{'thumb' if is_thumbnail else 'full'}"
    now = time.time()

    with _s3_exists_cache_lock:
        if cache_key in _s3_exists_cache:
            exists, cached_at = _s3_exists_cache[cache_key]
            if now - cached_at < _S3_EXISTS_CACHE_TTL:
                return exists

    key = _get_s3_photo_key(icao_hex, is_thumbnail)

    # Use storage module's check
    from skyspy.services.storage import _get_s3_client
    client = _get_s3_client()
    if not client:
        return False

    try:
        from botocore.exceptions import ClientError
        client.head_object(Bucket=settings.S3_BUCKET, Key=key)
        with _s3_exists_cache_lock:
            _s3_exists_cache[cache_key] = (True, now)
        return True
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code in ('404', 'NoSuchKey'):
            with _s3_exists_cache_lock:
                _s3_exists_cache[cache_key] = (False, now)
        return False
    except Exception:
        return False


def _upload_photo_to_s3(data: bytes, icao_hex: str, is_thumbnail: bool = False) -> Optional[str]:
    """Upload photo to S3 with retry logic."""
    key = _get_s3_photo_key(icao_hex, is_thumbnail)

    from skyspy.services.storage import _get_s3_client
    client = _get_s3_client()
    if not client:
        return None

    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            client.put_object(
                Bucket=settings.S3_BUCKET,
                Key=key,
                Body=data,
                ContentType='image/jpeg',
                CacheControl='max-age=31536000',  # 1 year cache
            )

            url = _get_s3_photo_url(icao_hex, is_thumbnail)
            logger.info(f"Uploaded photo to S3: {key}")

            # Update existence cache (thread-safe)
            cache_key = f"{icao_hex}:{'thumb' if is_thumbnail else 'full'}"
            with _s3_exists_cache_lock:
                _s3_exists_cache[cache_key] = (True, time.time())
            return url

        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                logger.warning(f"S3 upload attempt {attempt + 1} failed: {e}, retrying...")
                time.sleep(RETRY_DELAY * (attempt + 1))
            else:
                logger.error(f"S3 upload failed after {MAX_RETRIES} attempts: {last_error}")

    return None


def get_signed_photo_url(icao_hex: str, is_thumbnail: bool = False, expires_in: int = 3600) -> Optional[str]:
    """Generate a signed URL for S3 photo access."""
    from skyspy.services.storage import _get_s3_client
    client = _get_s3_client()
    if not client:
        return None

    key = _get_s3_photo_key(icao_hex, is_thumbnail)

    try:
        url = client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': settings.S3_BUCKET,
                'Key': key,
            },
            ExpiresIn=expires_in,
        )
        return url
    except Exception as e:
        logger.error(f"Failed to generate signed URL for {icao_hex}: {e}")
        return None


def get_photo_url(
    icao_hex: str,
    is_thumbnail: bool = False,
    signed: bool = True,
    verify_exists: bool = False
) -> Optional[str]:
    """
    Get accessible URL for a cached photo.

    Args:
        icao_hex: Aircraft ICAO hex code
        is_thumbnail: Whether to get thumbnail URL
        signed: Whether to generate a signed URL for S3
        verify_exists: Whether to verify the S3 object exists

    Returns:
        Accessible URL for the photo, or None if not cached
    """
    icao_hex = icao_hex.upper()

    if settings.S3_ENABLED:
        if verify_exists:
            if not _check_s3_photo_exists(icao_hex, is_thumbnail):
                return None

        if signed:
            return get_signed_photo_url(icao_hex, is_thumbnail)
        else:
            return _get_s3_photo_url(icao_hex, is_thumbnail)
    else:
        path = get_photo_path(icao_hex, is_thumbnail)
        if path.exists() and path.stat().st_size > 0:
            return str(path)
        return None


def _scrape_planespotters_full_size(page_url: str) -> Optional[str]:
    """
    Scrape a Planespotters photo page to find the full-size image URL.

    Args:
        page_url: The photo page URL

    Returns:
        Full-size image URL if found, None otherwise
    """
    if not page_url or "planespotters.net/photo" not in page_url:
        return None

    try:
        logger.info(f"Scraping Planespotters page: {page_url}")

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
            "Accept-Language": "en-US,en;q=0.9",
        }

        with httpx.Client(timeout=30.0) as client:
            resp = client.get(page_url, headers=headers, follow_redirects=True)
            resp.raise_for_status()
            html = resp.text

        # Try to find original size URL (_o.jpg)
        original_match = re.search(r'https://cdn\.plnspttrs\.net/[^"\'<>\s]+_o\.jpg', html)
        if original_match:
            return original_match.group(0)

        # Fallback: large size (_l.jpg)
        large_match = re.search(r'https://cdn\.plnspttrs\.net/[^"\'<>\s]+_l\.jpg', html)
        if large_match:
            return large_match.group(0)

        logger.warning(f"No full-size URL found in page: {page_url}")

    except httpx.HTTPStatusError as e:
        logger.warning(f"HTTP {e.response.status_code} scraping {page_url}")
    except Exception as e:
        logger.warning(f"Failed to scrape {page_url}: {e}")

    return None


def download_photo(
    url: str,
    icao_hex: str,
    is_thumbnail: bool = False,
    timeout: float = 30.0,
    photo_page_link: Optional[str] = None,
    force: bool = False
) -> Optional[str]:
    """
    Download a photo and save to cache (local or S3).

    Args:
        url: Fallback URL if scraping fails
        icao_hex: Aircraft ICAO hex code
        is_thumbnail: Whether this is a thumbnail download
        timeout: Request timeout in seconds
        photo_page_link: Planespotters page URL to scrape for full-size
        force: If True, skip cache check and re-download

    Returns:
        Path/URL to cached file or None on failure
    """
    if not settings.PHOTO_CACHE_ENABLED:
        return None

    if not url:
        return None

    icao_hex = icao_hex.upper()
    cache_key = f"{icao_hex}:{'thumb' if is_thumbnail else 'full'}"

    # Prevent duplicate downloads
    with _pending_lock:
        if cache_key in _pending_downloads:
            return None
        _pending_downloads.add(cache_key)

    try:
        # Check if already cached
        if not force:
            if settings.S3_ENABLED:
                if _check_s3_photo_exists(icao_hex, is_thumbnail):
                    return _get_s3_photo_url(icao_hex, is_thumbnail)
            else:
                path = get_photo_path(icao_hex, is_thumbnail)
                if path.exists() and path.stat().st_size > 0:
                    return str(path)

        target_url = url

        # For full-size Planespotters photos, try to scrape the page
        if not is_thumbnail and photo_page_link:
            scraped_url = _scrape_planespotters_full_size(photo_page_link)
            if scraped_url:
                target_url = scraped_url

        logger.info(f"Downloading photo for {icao_hex}: {target_url}")

        # Build headers
        if "plnspttrs.net" in target_url or "planespotters.net" in target_url:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": "https://www.planespotters.net/",
            }
        else:
            headers = {
                "User-Agent": "Mozilla/5.0 (compatible; ADS-B API/2.6)",
                "Accept": "image/*",
            }

        with httpx.Client(timeout=timeout) as client:
            response = client.get(target_url, headers=headers, follow_redirects=True)
            response.raise_for_status()

        # Verify it's an image
        content_type = response.headers.get("content-type", "")
        if not content_type.startswith("image/"):
            logger.warning(f"Not an image ({content_type}): {target_url}")
            return None

        data = response.content

        # Save to S3 or local filesystem
        if settings.S3_ENABLED:
            result = _upload_photo_to_s3(data, icao_hex, is_thumbnail)
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
        with _pending_lock:
            _pending_downloads.discard(cache_key)


def cache_aircraft_photos(
    icao_hex: str,
    photo_url: Optional[str] = None,
    thumbnail_url: Optional[str] = None,
    photo_page_link: Optional[str] = None,
    force: bool = False
) -> Tuple[Optional[str], Optional[str]]:
    """
    Download and cache both full-size and thumbnail photos.

    Args:
        icao_hex: Aircraft ICAO hex code
        photo_url: URL to full-size photo
        thumbnail_url: URL to thumbnail photo
        photo_page_link: Optional Planespotters page URL to scrape
        force: If True, skip cache check and re-download

    Returns:
        Tuple of (photo_path_or_url, thumbnail_path_or_url)
    """
    if not settings.PHOTO_CACHE_ENABLED:
        return None, None

    icao_hex = icao_hex.upper()
    photo_path = None
    thumb_path = None

    # Download full-size photo
    if photo_url:
        result = download_photo(
            photo_url, icao_hex, is_thumbnail=False,
            photo_page_link=photo_page_link, force=force
        )
        if result:
            photo_path = result

    # Download thumbnail
    if thumbnail_url:
        result = download_photo(thumbnail_url, icao_hex, is_thumbnail=True)
        if result:
            thumb_path = result

    # Update database with local paths / S3 URLs
    if photo_path or thumb_path:
        update_photo_paths(icao_hex, photo_path, thumb_path)

    return photo_path, thumb_path


def update_photo_paths(
    icao_hex: str,
    photo_path: Optional[str] = None,
    thumb_path: Optional[str] = None
):
    """Update database with cached photo paths."""
    try:
        AircraftInfo.objects.filter(icao_hex=icao_hex).update(
            photo_local_path=photo_path,
            photo_thumbnail_local_path=thumb_path
        )
    except Exception as e:
        logger.error(f"Error updating photo cache paths for {icao_hex}: {e}")


def get_cached_photo(icao_hex: str, thumbnail: bool = False) -> Optional[Path]:
    """Get path to cached photo if it exists locally."""
    if settings.S3_ENABLED:
        return None

    path = get_photo_path(icao_hex, thumbnail)
    if path.exists() and path.stat().st_size > 0:
        return path
    return None


def get_cache_stats() -> dict:
    """Get statistics about the photo cache."""
    if settings.S3_ENABLED:
        return {
            "enabled": settings.PHOTO_CACHE_ENABLED,
            "storage": "s3",
            "bucket": settings.S3_BUCKET,
            "prefix": settings.S3_PREFIX,
            "region": settings.S3_REGION,
            "endpoint": settings.S3_ENDPOINT_URL,
            "public_url": settings.S3_PUBLIC_URL,
        }

    cache_dir = get_cache_dir()

    if not cache_dir.exists():
        return {
            "enabled": settings.PHOTO_CACHE_ENABLED,
            "storage": "local",
            "cache_dir": str(cache_dir),
            "total_photos": 0,
            "total_thumbnails": 0,
            "total_size_mb": 0,
        }

    all_jpgs = list(cache_dir.glob("*.jpg"))
    thumbnails = [f for f in all_jpgs if f.name.endswith("_thumb.jpg")]
    photos = [f for f in all_jpgs if not f.name.endswith("_thumb.jpg")]
    total_size = sum(f.stat().st_size for f in all_jpgs)

    return {
        "enabled": settings.PHOTO_CACHE_ENABLED,
        "storage": "local",
        "cache_dir": str(cache_dir),
        "total_photos": len(photos),
        "total_thumbnails": len(thumbnails),
        "total_size_mb": round(total_size / (1024 * 1024), 2),
    }
