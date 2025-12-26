"""
Photo caching service.
Downloads and caches aircraft photos locally for offline access.
"""
import asyncio
import hashlib
import logging
import os
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
    Get path to cached photo if it exists.
    
    Returns:
        Path to cached photo or None if not cached
    """
    path = get_photo_path(icao_hex, thumbnail)
    if path.exists() and path.stat().st_size > 0:
        return path
    return None


async def download_photo(
    url: str,
    icao_hex: str,
    is_thumbnail: bool = False,
    timeout: float = 30.0
) -> Optional[Path]:
    """
    Download a photo and save to cache.
    
    Returns:
        Path to downloaded file or None on failure
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
        path = get_photo_path(icao_hex, is_thumbnail)
        
        # Skip if already cached
        if path.exists() and path.stat().st_size > 0:
            return path
        
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
            
            # Save to file
            path.write_bytes(response.content)
            logger.info(f"Cached photo for {icao_hex}: {path}")
            
            return path
    
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
    Updates database with local cache paths.
    
    Returns:
        Tuple of (photo_local_path, thumbnail_local_path)
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
            photo_path = str(result)
    
    # Download thumbnail
    if thumbnail_url:
        result = await download_photo(thumbnail_url, icao_hex, is_thumbnail=True)
        if result:
            thumb_path = str(result)
    
    # Update database with local paths
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
    Get photo from cache or download if not cached.
    
    Returns:
        Photo bytes or None
    """
    icao_hex = icao_hex.upper()
    
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
    path = await download_photo(url, icao_hex, is_thumbnail=thumbnail)
    if path:
        return path.read_bytes()
    
    return None


def get_cache_stats() -> dict:
    """Get statistics about the photo cache."""
    cache_dir = get_cache_dir()
    
    if not cache_dir.exists():
        return {
            "enabled": settings.photo_cache_enabled,
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
        "cache_dir": str(cache_dir),
        "total_photos": len(photos),
        "total_thumbnails": len(thumbnails),
        "total_size_mb": round(total_size / (1024 * 1024), 2),
    }


# Background queue processing
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
