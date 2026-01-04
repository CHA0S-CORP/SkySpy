"""
Aircraft information API endpoints.

Provides airframe data, registration info, and photos from open sources:
- hexdb.io - Aircraft registration database
- OpenSky Network - Aircraft metadata
- Planespotters.net - Aircraft photos

Data is cached in the database to reduce external API calls.
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException, Path, Body
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.services.aircraft_info import (
    get_aircraft_info, get_bulk_aircraft_info, 
    refresh_aircraft_info, get_info_cache_stats
)
from app.schemas import (
    AircraftInfoResponse, AircraftPhotoResponse, BulkAircraftInfoResponse,
    AircraftInfoCacheStats, ErrorResponse
)

router = APIRouter(prefix="/api/v1/aircraft", tags=["Aircraft Info"])


def validate_icao_hex(icao_hex: str) -> bool:
    """Validate ICAO hex code (6 chars, or 7 with ~ prefix for TIS-B)."""
    if not icao_hex:
        return False
    clean = icao_hex.lstrip("~")
    return 6 <= len(clean) <= 6 and len(icao_hex) <= 10


@router.get(
    "/{icao_hex}/info",
    response_model=AircraftInfoResponse,
    summary="Get Aircraft Information",
    description="""
Get detailed information about an aircraft by its ICAO hex address.

Returns comprehensive airframe data including:
- **Registration**: Aircraft registration number (e.g., N12345)
- **Type**: Aircraft type code and full name (e.g., B738, Boeing 737-800)
- **Manufacturer**: Aircraft manufacturer (e.g., Boeing, Airbus)
- **Age**: Year built and calculated age in years
- **Operator**: Current operator/airline
- **Owner**: Registered owner
- **Country**: Country of registration
- **Photo**: Aircraft photo URL if available

Data sources:
- hexdb.io for registration data
- OpenSky Network for additional metadata
- Planespotters.net for aircraft photos

**Caching**: Data is cached for 7 days. Failed lookups retry after 24 hours.
Use `refresh=true` to force a fresh lookup from external sources.
    """,
    responses={
        200: {
            "description": "Aircraft information",
            "content": {
                "application/json": {
                    "example": {
                        "icao_hex": "A12345",
                        "registration": "N12345",
                        "type_code": "B738",
                        "type_name": "Boeing 737-800",
                        "manufacturer": "Boeing",
                        "model": "737-8AS",
                        "serial_number": "29934",
                        "year_built": 2007,
                        "age_years": 17,
                        "operator": "United Airlines",
                        "operator_icao": "UAL",
                        "country": "United States",
                        "is_military": False,
                        "photo_url": "https://cdn.planespotters.net/12345.jpg",
                        "photo_thumbnail_url": "https://cdn.planespotters.net/12345_thumb.jpg",
                        "photo_photographer": "John Doe",
                        "photo_source": "planespotters.net",
                        "cached_at": "2024-12-21T12:00:00Z",
                        "fetch_failed": False
                    }
                }
            }
        },
        400: {"model": ErrorResponse, "description": "Invalid ICAO hex code"},
        404: {"model": ErrorResponse, "description": "No information found"}
    }
)
async def get_airframe_info(
    icao_hex: str = Path(
        ...,
        description="ICAO 24-bit hex address (6 characters, or 7 with ~ prefix for TIS-B)",
        example="A12345"
    ),
    refresh: bool = Query(
        False,
        description="Force refresh from external sources (ignores cache)"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Get detailed aircraft information including airframe data and photos."""
    if not validate_icao_hex(icao_hex):
        raise HTTPException(status_code=400, detail="Invalid ICAO hex code")
    
    if refresh:
        info = await refresh_aircraft_info(db, icao_hex)
    else:
        info = await get_aircraft_info(db, icao_hex)
    
    if not info:
        raise HTTPException(status_code=404, detail=f"No information found for {icao_hex.upper()}")
    
    return info


@router.get(
    "/{icao_hex}/photo",
    response_model=AircraftPhotoResponse,
    summary="Get Aircraft Photo URLs",
    description="""
Get photo URLs for an aircraft.

Returns:
- **photo_url**: Full-size photo URL
- **thumbnail_url**: Thumbnail image URL
- **photographer**: Photo credit
- **source**: Photo source (typically planespotters.net)

Photos are sourced from Planespotters.net API.

**Note**: Use `/{icao_hex}/photo/download` to proxy/download the actual image.
    """,
    responses={
        200: {
            "description": "Aircraft photo URLs",
            "content": {
                "application/json": {
                    "example": {
                        "icao_hex": "A12345",
                        "photo_url": "https://cdn.planespotters.net/12345.jpg",
                        "thumbnail_url": "https://cdn.planespotters.net/12345_thumb.jpg",
                        "photographer": "John Doe",
                        "source": "planespotters.net"
                    }
                }
            }
        },
        400: {"model": ErrorResponse, "description": "Invalid ICAO hex code"},
        404: {"model": ErrorResponse, "description": "No photo found"}
    }
)
async def get_aircraft_photo(
    icao_hex: str = Path(
        ...,
        description="ICAO 24-bit hex address",
        example="A12345"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Get aircraft photo URLs."""
    from app.core.config import get_settings
    from app.services.photo_cache import get_signed_s3_url, _check_s3_exists

    if not validate_icao_hex(icao_hex):
        raise HTTPException(status_code=400, detail="Invalid ICAO hex code")

    settings = get_settings()
    icao_hex = icao_hex.upper()

    photo_url = None
    thumbnail_url = None
    photographer = None
    source = None

    # Check S3 first if enabled - photos might be cached even without DB record
    if settings.s3_enabled:
        if await _check_s3_exists(icao_hex, is_thumbnail=False):
            photo_url = await get_signed_s3_url(icao_hex, is_thumbnail=False)
        if await _check_s3_exists(icao_hex, is_thumbnail=True):
            thumbnail_url = await get_signed_s3_url(icao_hex, is_thumbnail=True)

    # Get info from database for metadata and fallback URLs
    info = await get_aircraft_info(db, icao_hex)
    if info:
        photographer = info.get("photo_photographer")
        source = info.get("photo_source")
        # Use DB URLs as fallback if not in S3
        if not photo_url:
            photo_url = info.get("photo_url")
        if not thumbnail_url:
            thumbnail_url = info.get("photo_thumbnail_url")

    if not photo_url and not thumbnail_url:
        raise HTTPException(status_code=404, detail=f"No photo found for {icao_hex}")

    return {
        "icao_hex": icao_hex,
        "photo_url": photo_url,
        "thumbnail_url": thumbnail_url or photo_url,
        "photographer": photographer,
        "source": source or "s3" if settings.s3_enabled else None,
    }


@router.post(
    "/{icao_hex}/photo/cache",
    summary="Prioritize Photo Caching",
    description="""
Immediately fetch and cache an aircraft photo to S3.

Use this when a user clicks on an aircraft to ensure the photo is
cached quickly rather than waiting for background processing.

Returns the signed S3 URLs once cached, or falls back to source URLs.
    """,
    responses={
        200: {
            "description": "Photo cached successfully",
            "content": {
                "application/json": {
                    "example": {
                        "icao_hex": "A12345",
                        "photo_url": "https://s3.../photo.jpg?signature=...",
                        "thumbnail_url": "https://s3.../thumb.jpg?signature=...",
                        "cached": True
                    }
                }
            }
        },
        404: {"model": ErrorResponse, "description": "No photo available"}
    }
)
async def prioritize_photo_cache(
    icao_hex: str = Path(
        ...,
        description="ICAO 24-bit hex address",
        example="A12345"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Immediately fetch and cache photo to S3 for quick access."""
    from app.core.config import get_settings
    from app.services.photo_cache import (
        cache_aircraft_photos, get_signed_s3_url, _check_s3_exists
    )

    if not validate_icao_hex(icao_hex):
        raise HTTPException(status_code=400, detail="Invalid ICAO hex code")

    settings = get_settings()
    icao_hex = icao_hex.upper()

    # Check if already cached in S3
    if settings.s3_enabled:
        photo_exists = await _check_s3_exists(icao_hex, is_thumbnail=False)
        thumb_exists = await _check_s3_exists(icao_hex, is_thumbnail=True)
        if photo_exists or thumb_exists:
            return {
                "icao_hex": icao_hex,
                "photo_url": await get_signed_s3_url(icao_hex, False) if photo_exists else None,
                "thumbnail_url": await get_signed_s3_url(icao_hex, True) if thumb_exists else None,
                "cached": True,
                "source": "s3"
            }

    # Get aircraft info to find photo URLs
    info = await get_aircraft_info(db, icao_hex)
    if not info:
        # Try to fetch fresh info
        info = await refresh_aircraft_info(db, icao_hex)

    if not info:
        raise HTTPException(status_code=404, detail=f"No info found for {icao_hex}")

    photo_url = info.get("photo_url")
    thumbnail_url = info.get("photo_thumbnail_url")
    photo_page_link = info.get("photo_page_link")

    if not photo_url and not thumbnail_url:
        raise HTTPException(status_code=404, detail=f"No photo available for {icao_hex}")

    # Immediately cache to S3 (don't use background queue)
    cached_photo, cached_thumb = await cache_aircraft_photos(
        db, icao_hex, photo_url, thumbnail_url, photo_page_link, force=True
    )

    # Return signed URLs if cached to S3, otherwise return source URLs
    if settings.s3_enabled and (cached_photo or cached_thumb):
        return {
            "icao_hex": icao_hex,
            "photo_url": await get_signed_s3_url(icao_hex, False) if cached_photo else photo_url,
            "thumbnail_url": await get_signed_s3_url(icao_hex, True) if cached_thumb else thumbnail_url,
            "cached": True,
            "source": "s3"
        }

    return {
        "icao_hex": icao_hex,
        "photo_url": cached_photo or photo_url,
        "thumbnail_url": cached_thumb or thumbnail_url,
        "cached": bool(cached_photo or cached_thumb),
        "source": info.get("photo_source")
    }


@router.get(
    "/{icao_hex}/photo/download",
    summary="Download Aircraft Photo",
    description="""
Download/proxy the aircraft photo.

This endpoint returns the photo directly, first checking the local cache,
then falling back to fetching from the remote source.

**Query Parameters:**
- `thumbnail`: If true, returns the smaller thumbnail image (default: false)

**Response**: The actual image data (JPEG/PNG) with appropriate Content-Type header.

**Headers included:**
- `X-Photo-Source`: Where the photo was served from (local or remote URL)
- `X-Photo-Photographer`: Photo credit (if available)
- `X-Photo-Cached`: "true" if served from local cache
    """,
    responses={
        200: {
            "description": "Aircraft photo image",
            "content": {
                "image/jpeg": {},
                "image/png": {},
            }
        },
        400: {"model": ErrorResponse, "description": "Invalid ICAO hex code"},
        404: {"model": ErrorResponse, "description": "No photo found"},
        502: {"model": ErrorResponse, "description": "Failed to fetch photo from source"}
    }
)
async def download_aircraft_photo(
    icao_hex: str = Path(
        ...,
        description="ICAO 24-bit hex address",
        example="A12345"
    ),
    thumbnail: bool = Query(
        False,
        description="Return thumbnail instead of full-size image"
    ),
    refresh: bool = Query(
        False,
        description="Force refresh photo URL from source (use if getting wrong content)"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Download/proxy aircraft photo from local cache or source."""
    import logging
    import httpx
    from fastapi.responses import Response
    from app.core.config import get_settings
    from app.services.photo_cache import get_cached_photo, _check_s3_exists, get_signed_s3_url

    logger = logging.getLogger(__name__)
    settings = get_settings()

    if not validate_icao_hex(icao_hex):
        raise HTTPException(status_code=400, detail="Invalid ICAO hex code")

    icao_hex = icao_hex.upper().lstrip("~")

    # Helper to sanitize header values (ASCII only)
    def safe_header(value: str) -> str:
        if not value:
            return ""
        # Replace non-ASCII with ?
        return value.encode("ascii", errors="replace").decode("ascii")

    # Check cache first (skip if refresh requested)
    if not refresh:
        # Check S3 cache
        if settings.s3_enabled:
            if await _check_s3_exists(icao_hex, thumbnail):
                # Fetch from S3 using signed URL
                signed_url = await get_signed_s3_url(icao_hex, thumbnail)
                if signed_url:
                    try:
                        async with httpx.AsyncClient(timeout=15.0) as client:
                            response = await client.get(signed_url, follow_redirects=True)
                            response.raise_for_status()
                            content = response.content
                            headers = {
                                "X-Photo-Source": "s3",
                                "X-Photo-Cached": "true",
                                "Cache-Control": "public, max-age=604800",  # 7 days
                            }
                            return Response(
                                content=content,
                                media_type="image/jpeg",
                                headers=headers
                            )
                    except Exception as e:
                        logger.warning(f"Failed to fetch S3 cached photo for {icao_hex}: {e}")
        else:
            # Check local cache
            cached_path = get_cached_photo(icao_hex, thumbnail)
            if cached_path and cached_path.exists():
                try:
                    content = cached_path.read_bytes()
                    headers = {
                        "X-Photo-Source": "local",
                        "X-Photo-Cached": "true",
                        "Cache-Control": "public, max-age=604800",  # 7 days
                    }
                    return Response(
                        content=content,
                        media_type="image/jpeg",
                        headers=headers
                    )
                except Exception as e:
                    logger.warning(f"Failed to read cached photo for {icao_hex}: {e}")
                    pass
    
    # Get info from database (force refresh if requested)
    if refresh:
        from app.services.aircraft_info import refresh_aircraft_info
        info = await refresh_aircraft_info(db, icao_hex)
    else:
        info = await get_aircraft_info(db, icao_hex)
    
    if not info:
        raise HTTPException(status_code=404, detail=f"No info found for {icao_hex}")
    
    # Log available URLs for debugging
    logger.debug(f"Photo info for {icao_hex}: photo_url={info.get('photo_url')}, thumbnail_url={info.get('photo_thumbnail_url')}")
    
    # Choose URL based on thumbnail flag
    photo_url = info.get("photo_thumbnail_url") if thumbnail else info.get("photo_url")
    if not photo_url:
        photo_url = info.get("photo_url")  # Fallback to full size
    if not photo_url:
        photo_url = info.get("photo_thumbnail_url")  # Fallback to thumbnail
    
    if not photo_url:
        raise HTTPException(status_code=404, detail=f"No photo URL for {icao_hex}")
    
    # Detect if photo_url looks like a webpage instead of direct image
    # planespotters.net/photo URLs are webpages, not images
    if "planespotters.net/photo/" in photo_url and not photo_url.endswith(('.jpg', '.jpeg', '.png', '.webp')):
        logger.warning(f"Photo URL for {icao_hex} appears to be webpage, not image: {photo_url}")
        # Try to use thumbnail instead
        fallback_url = info.get("photo_thumbnail_url")
        if fallback_url and fallback_url != photo_url:
            logger.info(f"Using thumbnail URL as fallback for {icao_hex}")
            photo_url = fallback_url
    
    logger.info(f"Fetching photo for {icao_hex} (thumbnail={thumbnail}): {photo_url}")

    # Fetch from remote
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                photo_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; ADS-B API/2.6)",
                    "Accept": "image/*",
                },
                follow_redirects=True
            )

            # If 404 and we modified the URL for higher res, try fallback
            if response.status_code == 404 and "_1000.jpg" in photo_url:
                fallback_url = photo_url.replace("_1000.jpg", "_280.jpg")
                logger.info(f"1000px not available for {icao_hex}, trying 280px: {fallback_url}")
                response = await client.get(
                    fallback_url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (compatible; ADS-B API/2.6)",
                        "Accept": "image/*",
                    },
                    follow_redirects=True
                )
                if response.status_code == 200:
                    photo_url = fallback_url

            response.raise_for_status()

            # Get content while still in context
            content = response.content
            content_type = response.headers.get("content-type", "image/jpeg")
            if ";" in content_type:
                content_type = content_type.split(";")[0].strip()

            # Validate it's actually an image
            if not content_type.startswith("image/"):
                logger.error(f"Photo URL for {icao_hex} returned non-image content-type: {content_type}, URL: {photo_url}")
                raise HTTPException(
                    status_code=502,
                    detail=f"Source returned non-image content ({content_type}). URL may be a webpage, not an image."
                )
            
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout fetching photo from source")
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            retry_after = e.response.headers.get("Retry-After", "60")
            logger.warning(f"Rate limited (429) fetching photo for {icao_hex} from {photo_url}")
            raise HTTPException(
                status_code=429,
                detail="Photo source rate limit exceeded. Please try again later.",
                headers={"Retry-After": retry_after}
            )
        logger.error(f"HTTP error fetching photo for {icao_hex}: {e.response.status_code}, URL: {photo_url}")
        raise HTTPException(status_code=502, detail=f"Source returned error: {e.response.status_code}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch photo for {icao_hex}: {e}, URL: {photo_url}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch photo: {str(e)}")
    
    # Try to cache for next time (fire and forget, don't block on errors)
    try:
        from app.services.photo_cache import get_photo_path
        cache_path = get_photo_path(icao_hex, thumbnail)
        cache_path.write_bytes(content)
    except Exception:
        pass  # Caching failure shouldn't break the response
    
    # Build response headers (ASCII-safe)
    headers = {
        "X-Photo-Source": photo_url[:200],  # Truncate long URLs
        "X-Photo-Cached": "false",
        "Cache-Control": "public, max-age=86400",  # 24 hours
    }
    
    photographer = info.get("photo_photographer")
    if photographer:
        headers["X-Photo-Photographer"] = safe_header(photographer)[:100]
    
    source = info.get("photo_source")
    if source:
        headers["X-Photo-Credit"] = safe_header(source)[:100]
    
    return Response(
        content=content,
        media_type=content_type,
        headers=headers
    )


@router.post(
    "/info/bulk",
    response_model=BulkAircraftInfoResponse,
    summary="Bulk Aircraft Info Lookup",
    description="""
Get aircraft information for multiple aircraft at once.

**Important**: This endpoint only returns **cached** data. It does not
fetch from external sources to avoid rate limiting.

Use the single aircraft endpoint first to populate the cache for
aircraft you're interested in.

Request body: Array of ICAO hex codes (maximum 100)
    """,
    responses={
        200: {
            "description": "Bulk lookup results",
            "content": {
                "application/json": {
                    "example": {
                        "aircraft": {
                            "A12345": {"registration": "N12345", "type_code": "B738"},
                            "B67890": {"registration": "N67890", "type_code": "A320"}
                        },
                        "found": 2,
                        "requested": 3
                    }
                }
            }
        },
        400: {"model": ErrorResponse, "description": "Too many aircraft requested"}
    }
)
async def get_bulk_info(
    icao_hexes: List[str] = Body(
        ...,
        description="List of ICAO hex codes to lookup",
        example=["A12345", "B67890", "C11111"]
    ),
    db: AsyncSession = Depends(get_db)
):
    """Get aircraft info for multiple aircraft (cached data only)."""
    if len(icao_hexes) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 aircraft per request")
    
    # Filter valid hex codes
    valid_hexes = [h for h in icao_hexes if validate_icao_hex(h)]
    
    result = await get_bulk_aircraft_info(db, valid_hexes)
    
    return {
        "aircraft": result,
        "found": len(result),
        "requested": len(valid_hexes),
    }


@router.get(
    "/info/cache/stats",
    response_model=AircraftInfoCacheStats,
    summary="Get Cache Statistics",
    description="""
Get statistics about the aircraft information cache.

Returns:
- **total_cached**: Total aircraft in the cache
- **failed_lookups**: Number of aircraft where lookup failed
- **with_photos**: Aircraft with cached photos
- **cache_duration_hours**: How long successful lookups are cached
- **retry_after_hours**: When failed lookups are retried
    """,
    responses={
        200: {
            "description": "Cache statistics",
            "content": {
                "application/json": {
                    "example": {
                        "total_cached": 1234,
                        "failed_lookups": 56,
                        "with_photos": 890,
                        "cache_duration_hours": 168,
                        "retry_after_hours": 24
                    }
                }
            }
        }
    }
)
async def get_cache_stats(db: AsyncSession = Depends(get_db)):
    """Get statistics about the aircraft info cache."""
    return await get_info_cache_stats(db)
