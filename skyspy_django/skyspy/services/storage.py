"""
Storage service for S3 and local file operations.

Provides a unified interface for:
- S3 uploads/downloads with signed URLs
- Local filesystem storage
- File validation and sanitization
"""
import logging
import os
import re
import threading
from pathlib import Path
from typing import Optional

from django.conf import settings

logger = logging.getLogger(__name__)

# S3 client (lazy initialized)
_s3_client = None
_s3_client_lock = threading.Lock()
_s3_client_init_failed = False

# S3 existence cache to avoid repeated head_object calls
# Key: "prefix:filename" or "prefix:icao:thumb/full", Value: (exists: bool, timestamp: float)
_s3_exists_cache: dict[str, tuple[bool, float]] = {}
_S3_EXISTS_CACHE_TTL = 300  # 5 minutes


def _get_s3_client():
    """Get or create S3 client with thread-safe lazy initialization."""
    global _s3_client, _s3_client_init_failed

    if _s3_client is not None:
        return _s3_client

    if _s3_client_init_failed:
        return None

    with _s3_client_lock:
        # Double-check after acquiring lock
        if _s3_client is not None:
            return _s3_client

        if not settings.S3_ENABLED:
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
                'region_name': settings.S3_REGION,
                'config': config,
            }

            if settings.S3_ACCESS_KEY and settings.S3_SECRET_KEY:
                client_kwargs['aws_access_key_id'] = settings.S3_ACCESS_KEY
                client_kwargs['aws_secret_access_key'] = settings.S3_SECRET_KEY

            if settings.S3_ENDPOINT_URL:
                client_kwargs['endpoint_url'] = settings.S3_ENDPOINT_URL

            _s3_client = boto3.client(**client_kwargs)
            logger.info(f"S3 client initialized: bucket={settings.S3_BUCKET}")
            return _s3_client

        except ImportError:
            logger.error("boto3 not installed - S3 storage unavailable")
            _s3_client_init_failed = True
            return None
        except Exception as e:
            logger.error(f"Failed to initialize S3 client: {e}")
            _s3_client_init_failed = True
            return None


def reset_s3_client():
    """Reset the S3 client state for recovery after configuration changes."""
    global _s3_client, _s3_client_init_failed, _s3_exists_cache

    with _s3_client_lock:
        _s3_client = None
        _s3_client_init_failed = False
        _s3_exists_cache.clear()
        logger.info("S3 client state reset")


def sanitize_filename(filename: str) -> str:
    """
    Sanitize a filename to prevent path traversal attacks.

    Args:
        filename: The filename to sanitize

    Returns:
        Sanitized filename (basename only)

    Raises:
        ValueError: If filename is invalid or contains disallowed characters
    """
    if not filename:
        raise ValueError("Filename cannot be empty")

    # Strip directory components to prevent path traversal
    sanitized = os.path.basename(filename)

    if not sanitized:
        raise ValueError("Filename cannot be empty after sanitization")

    # Validate filename contains only allowed characters
    if not re.match(r'^[\w\-\.]+$', sanitized):
        raise ValueError(f"Filename contains invalid characters: {sanitized}")

    # Reject filenames that are just dots
    if sanitized in ('.', '..'):
        raise ValueError("Invalid filename")

    return sanitized


def get_s3_key(filename: str, prefix: str) -> str:
    """Get S3 key for a file."""
    safe_filename = sanitize_filename(filename)
    prefix = prefix.strip("/")
    key = f"{prefix}/{safe_filename}"

    if '..' in key:
        raise ValueError("S3 key contains path traversal sequence")

    return key


def get_s3_url(filename: str, prefix: str) -> str:
    """Get public URL for S3 file (non-signed, for public buckets)."""
    key = get_s3_key(filename, prefix)

    if settings.S3_PUBLIC_URL:
        base = settings.S3_PUBLIC_URL.rstrip("/")
        prefix_with_slash = prefix.strip("/") + "/"
        if key.startswith(prefix_with_slash):
            key = key[len(prefix_with_slash):]
        return f"{base}/{key}"

    if settings.S3_ENDPOINT_URL:
        endpoint = settings.S3_ENDPOINT_URL.rstrip("/")
        return f"{endpoint}/{settings.S3_BUCKET}/{key}"

    return f"https://{settings.S3_BUCKET}.s3.{settings.S3_REGION}.amazonaws.com/{key}"


def generate_signed_url(filename: str, prefix: str, expires_in: int = 3600) -> Optional[str]:
    """
    Generate a signed URL for S3 file access.

    Args:
        filename: The filename in S3
        prefix: S3 key prefix
        expires_in: URL expiration time in seconds (default 1 hour)

    Returns:
        Signed URL or None if S3 is not available
    """
    client = _get_s3_client()
    if not client:
        return None

    key = get_s3_key(filename, prefix)

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
        logger.error(f"Failed to generate signed URL for {filename}: {e}")
        return None


def upload_to_s3(
    data: bytes,
    filename: str,
    prefix: str,
    content_type: str = "application/octet-stream",
    cache_control: str = "max-age=86400"
) -> Optional[str]:
    """
    Upload file to S3.

    Args:
        data: File bytes
        filename: Filename to use in S3
        prefix: S3 key prefix
        content_type: MIME type of the file
        cache_control: Cache-Control header value

    Returns:
        S3 URL or None on failure
    """
    client = _get_s3_client()
    if not client:
        logger.warning("S3 client not available, skipping upload")
        return None

    key = get_s3_key(filename, prefix)

    try:
        client.put_object(
            Bucket=settings.S3_BUCKET,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl=cache_control,
        )

        url = get_s3_url(filename, prefix)
        logger.info(f"Uploaded to S3: {key}")
        return url

    except Exception as e:
        logger.error(f"S3 upload failed for {filename}: {e}")
        return None


def download_from_s3(filename: str, prefix: str) -> Optional[bytes]:
    """
    Download file from S3.

    Args:
        filename: Filename in S3
        prefix: S3 key prefix

    Returns:
        File bytes or None on failure
    """
    client = _get_s3_client()
    if not client:
        return None

    key = get_s3_key(filename, prefix)

    try:
        response = client.get_object(Bucket=settings.S3_BUCKET, Key=key)
        return response['Body'].read()
    except Exception as e:
        logger.error(f"S3 download failed for {filename}: {e}")
        return None


def check_s3_exists(filename: str, prefix: str, use_cache: bool = True) -> bool:
    """
    Check if file exists in S3, with optional caching.

    Args:
        filename: Filename in S3
        prefix: S3 key prefix
        use_cache: Whether to use existence cache

    Returns:
        True if file exists, False otherwise
    """
    import time

    cache_key = f"{prefix}:{filename}"

    if use_cache and cache_key in _s3_exists_cache:
        exists, cached_at = _s3_exists_cache[cache_key]
        if time.time() - cached_at < _S3_EXISTS_CACHE_TTL:
            return exists

    client = _get_s3_client()
    if not client:
        return False

    key = get_s3_key(filename, prefix)

    try:
        from botocore.exceptions import ClientError

        client.head_object(Bucket=settings.S3_BUCKET, Key=key)
        _s3_exists_cache[cache_key] = (True, time.time())
        return True

    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code in ('404', 'NoSuchKey'):
            _s3_exists_cache[cache_key] = (False, time.time())
            return False
        logger.warning(f"S3 head_object error for {filename}: {error_code}")
        return False

    except Exception as e:
        logger.warning(f"S3 existence check failed for {filename}: {e}")
        return False


def save_file_locally(data: bytes, filename: str, directory: str) -> Optional[Path]:
    """
    Save file to local storage.

    Args:
        data: Raw file bytes
        filename: Filename to save as
        directory: Target directory

    Returns:
        Path to saved file or None on failure
    """
    try:
        safe_filename = sanitize_filename(filename)
        file_dir = Path(directory)
        file_dir.mkdir(parents=True, exist_ok=True)

        file_path = file_dir / safe_filename
        file_path.write_bytes(data)

        logger.info(f"Saved file locally: {file_path}")
        return file_path

    except Exception as e:
        logger.error(f"Failed to save file locally: {e}")
        return None


def read_local_file(filename: str, directory: str) -> Optional[bytes]:
    """
    Read file from local storage.

    Args:
        filename: Filename to read
        directory: Directory containing the file

    Returns:
        File bytes or None if not found
    """
    try:
        safe_filename = sanitize_filename(filename)
        file_path = Path(directory) / safe_filename

        if not file_path.exists():
            return None

        return file_path.read_bytes()

    except Exception as e:
        logger.error(f"Failed to read local file: {e}")
        return None


def delete_local_file(filename: str, directory: str) -> bool:
    """
    Delete file from local storage.

    Args:
        filename: Filename to delete
        directory: Directory containing the file

    Returns:
        True if deleted successfully
    """
    try:
        safe_filename = sanitize_filename(filename)
        file_path = Path(directory) / safe_filename

        if file_path.exists():
            file_path.unlink()
            logger.info(f"Deleted local file: {file_path}")
            return True
        return False

    except Exception as e:
        logger.error(f"Failed to delete local file: {e}")
        return False


def get_local_file_stats(directory: str) -> dict:
    """
    Get statistics about local file storage.

    Args:
        directory: Directory to analyze

    Returns:
        Dict with file count and total size
    """
    try:
        dir_path = Path(directory)
        if not dir_path.exists():
            return {"file_count": 0, "total_size_mb": 0}

        files = list(dir_path.glob("*"))
        total_size = sum(f.stat().st_size for f in files if f.is_file())

        return {
            "file_count": len([f for f in files if f.is_file()]),
            "total_size_mb": round(total_size / (1024 * 1024), 2),
        }

    except Exception as e:
        logger.error(f"Failed to get local file stats: {e}")
        return {"file_count": 0, "total_size_mb": 0}
