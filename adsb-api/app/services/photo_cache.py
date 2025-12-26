"""
Photo caching service.
Downloads and caches aircraft photos to local filesystem or S3.

Storage backends:
- Local filesystem (default): /data/photos/
- S3/MinIO/Wasabi: s3://bucket/prefix/

Configuration:
- PHOTO_CACHE_ENABLED=true
- PHOTO_CACHE_DIR=/data/photos (for local)
- S3_ENABLED=true (for S3)
- S3_BUCKET=my-bucket
- S3_REGION=us-east-1
- S3_ACCESS_KEY=xxx
- S3_SECRET_KEY=xxx
- S3_ENDPOINT_URL=https://minio.local:9000 (for S3-compatible)
- S3_PREFIX=aircraft-photos
- S3_PUBLIC_URL=https://cdn.example.com/aircraft-photos (optional)
"""
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple

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

# S3 client (lazy initialized)
_s3_client = None


def _get_s3_client():
    """Get or create S3 client (lazy initialization)."""
    global _s3_client
    
    if _s3_client is not None:
        return _s3_client
    
    if not settings.s3_enabled:
        return None
    
    try:
        import boto3
        from botocore.config import Config
        
        config = Config(
            signature_version='s3v4',
            retries={'max_attempts': 3, 'mode': 'standard'}
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
        return None
    except Exception as e:
        logger.error(f"Failed to initialize S3 client: {e}")
        return None


def _get_s3_key(icao_hex: str, is_thumbnail: bool = False) -> str:
    """Get S3 key for photo."""
    suffix = "_thumb" if is_thumbnail else ""
    prefix = settings.s3_prefix.strip("/")
    return f"{prefix}/{icao_hex.upper()}{suffix}.jpg"


def _get_s3_url(icao_hex: str, is_thumbnail: bool = False) -> str:
    """Get public URL for S3 photo."""
    key = _get_s3_key(icao_hex, is_thumbnail)
    
    # Use custom public URL if configured (e.g., CDN)
    if settings.s3_public_url:
        base = settings.s3_public_url.rstrip("/")
        # Remove prefix from key if public URL already includes it
        if settings.s3_prefix and key.startswith(settings.s3_prefix):
            key = key[len(settings.s3_prefix):].lstrip("/")
        return f"{base}/{key}"
    
    # Default S3 URL format
    if settings.s3_endpoint_url:
        # Custom endpoint (MinIO, etc.)
        endpoint = settings.s3_endpoint_url.rstrip("/")
        return f"{endpoint}/{settings.s3_bucket}/{key}"
    else:
        # Standard AWS S3
        return f"https://{settings.s3_bucket}.s3.{settings.s3_region}.amazonaws.com/{key}"


async def _upload_to_s3(data: bytes, icao_hex: str, is_thumbnail: bool = False) -> Optional[str]:
    """Upload photo to S3. Returns URL or None on failure."""
    client = _get_s3_client()
    if not client:
        return None
    
    key = _get_s3_key(icao_hex, is_thumbnail)
    
    try:
        # Run in thread pool since boto3 is synchronous
        loop = asyncio.get_event_loop()
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
        logger.error(f"S3 upload failed for {icao_hex}: {e}")
        return None


async def _check_s3_exists(icao_hex: str, is_thumbnail: bool = False) -> bool:
    """Check if photo exists in S3."""
    client = _get_s3_client()
    if not client:
        return False
    
    key = _get_s3_key(icao_hex, is_thumbnail)
    
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: client.head_object(Bucket=settings.s3_bucket, Key=key)
        )
        return True
    except Exception:
        return False


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
    timeout: float = 30.0
) -> Optional[str]:
    """
    Download a photo and save to cache (local or S3).
    
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
        # Check if already cached
        if settings.s3_enabled:
            if await _check_s3_exists(icao_hex, is_thumbnail):
                return _get_s3_url(icao_hex, is_thumbnail)
        else:
            path = get_photo_path(icao_hex, is_thumbnail)
            if path.exists() and path.stat().st_size > 0:
                return str(path)
        
        logger.info(f"Downloading photo for {icao_hex}: {url}")
        
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; ADS-B API/2.6)",
                    "Accept": "image/*",
                },
                follow_redirects=True
            )
            response.raise_for_status()
            
            # Verify it's an image
            content_type = response.headers.get("content-type", "")
            if not content_type.startswith("image/"):
                logger.warning(f"Not an image ({content_type}): {url}")
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
    thumbnail_url: Optional[str] = None
) -> Tuple[Optional[str], Optional[str]]:
    """
    Download and cache both full-size and thumbnail photos.
    Updates database with local cache paths or S3 URLs.
    
    Returns:
        Tuple of (photo_path_or_url, thumbnail_path_or_url)
    """
    if not settings.photo_cache_enabled:
        return None, None
    
    icao_hex = icao_hex.upper()
    photo_path = None
    thumb_path = None
    
    # Download full-size photo
    if photo_url:
        result = await download_photo(photo_url, icao_hex, is_thumbnail=False)
        if result:
            photo_path = result
    
    # Download thumbnail
    if thumbnail_url:
        result = await download_photo(thumbnail_url, icao_hex, is_thumbnail=True)
        if result:
            thumb_path = result
    
    # Update database with local paths / S3 URLs
    if photo_path or thumb_path:
        try:
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
            await db.rollback()
    
    return photo_path, thumb_path


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


async def queue_photo_download(icao_hex: str, photo_url: str, thumbnail_url: str = None):
    """Add photo download to background queue."""
    if _download_queue is not None:
        await _download_queue.put({
            "icao_hex": icao_hex,
            "photo_url": photo_url,
            "thumbnail_url": thumbnail_url,
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
                continue
            
            icao_hex = item["icao_hex"]
            photo_url = item.get("photo_url")
            thumbnail_url = item.get("thumbnail_url")
            
            if photo_url or thumbnail_url:
                async with db_session_factory() as db:
                    await cache_aircraft_photos(
                        db, icao_hex, photo_url, thumbnail_url
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
