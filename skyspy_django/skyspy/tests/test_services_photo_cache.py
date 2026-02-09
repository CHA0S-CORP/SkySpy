"""
Tests for the photo caching service.

Tests photo downloading, caching, S3 integration, and related functionality.
"""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings

from skyspy.services.photo_cache import (
    _check_s3_photo_exists,
    _get_s3_photo_key,
    _get_s3_photo_url,
    _scrape_planespotters_full_size,
    _upload_photo_to_s3,
    cache_aircraft_photos,
    download_photo,
    get_cache_dir,
    get_cache_stats,
    get_cached_photo,
    get_photo_path,
    get_photo_url,
    get_signed_photo_url,
    update_photo_paths,
)


@override_settings(PHOTO_CACHE_DIR="/tmp/skyspy_test_photos", PHOTO_CACHE_ENABLED=True)
class GetCacheDirTests(TestCase):
    """Tests for get_cache_dir function."""

    def test_get_cache_dir_creates_directory(self):
        """Test that cache directory is created."""
        cache_dir = get_cache_dir()

        self.assertIsInstance(cache_dir, Path)
        self.assertTrue(cache_dir.exists())

    def test_get_cache_dir_returns_path(self):
        """Test that correct path is returned."""
        cache_dir = get_cache_dir()

        self.assertEqual(str(cache_dir), "/tmp/skyspy_test_photos")


@override_settings(PHOTO_CACHE_DIR="/tmp/skyspy_test_photos")
class GetPhotoPathTests(TestCase):
    """Tests for get_photo_path function."""

    def test_get_photo_path_full(self):
        """Test path for full-size photo."""
        path = get_photo_path("abc123")

        self.assertEqual(path.name, "ABC123.jpg")

    def test_get_photo_path_thumbnail(self):
        """Test path for thumbnail photo."""
        path = get_photo_path("abc123", is_thumbnail=True)

        self.assertEqual(path.name, "ABC123_thumb.jpg")

    def test_get_photo_path_uppercase(self):
        """Test that ICAO hex is uppercased."""
        path = get_photo_path("ABC123")

        self.assertEqual(path.name, "ABC123.jpg")


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
    S3_PREFIX="photos",
    S3_REGION="us-west-2",
    S3_ENDPOINT_URL="",
    S3_PUBLIC_URL="",
)
class S3PhotoKeyTests(TestCase):
    """Tests for S3 key generation."""

    def test_get_s3_photo_key_full(self):
        """Test S3 key for full-size photo."""
        key = _get_s3_photo_key("abc123")

        self.assertEqual(key, "photos/ABC123.jpg")

    def test_get_s3_photo_key_thumbnail(self):
        """Test S3 key for thumbnail."""
        key = _get_s3_photo_key("abc123", is_thumbnail=True)

        self.assertEqual(key, "photos/ABC123_thumb.jpg")


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
    S3_PREFIX="photos",
    S3_REGION="us-west-2",
    S3_ENDPOINT_URL="",
    S3_PUBLIC_URL="",
)
class S3PhotoUrlTests(TestCase):
    """Tests for S3 URL generation."""

    def test_get_s3_photo_url_default(self):
        """Test S3 URL with default AWS format."""
        url = _get_s3_photo_url("abc123")

        self.assertIn("test-bucket.s3.us-west-2.amazonaws.com", url)
        self.assertIn("ABC123.jpg", url)

    @override_settings(S3_ENDPOINT_URL="https://minio.example.com")
    def test_get_s3_photo_url_custom_endpoint(self):
        """Test S3 URL with custom endpoint."""
        url = _get_s3_photo_url("abc123")

        self.assertIn("minio.example.com", url)

    @override_settings(S3_PUBLIC_URL="https://cdn.example.com/photos")
    def test_get_s3_photo_url_public_url(self):
        """Test S3 URL with public URL."""
        url = _get_s3_photo_url("abc123")

        self.assertIn("cdn.example.com", url)


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
    S3_PREFIX="photos",
)
class CheckS3PhotoExistsTests(TestCase):
    """Tests for S3 existence checking."""

    @patch("skyspy.services.storage._get_s3_client")
    def test_check_exists_true(self, mock_get_client):
        """Test checking existing photo."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        _check_s3_photo_exists("abc123")

        # Should call head_object
        mock_client.head_object.assert_called()

    @patch("skyspy.services.storage._get_s3_client")
    def test_check_exists_not_found(self, mock_get_client):
        """Test checking non-existent photo."""
        from botocore.exceptions import ClientError

        mock_client = MagicMock()
        mock_client.head_object.side_effect = ClientError(
            {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
        )
        mock_get_client.return_value = mock_client

        result = _check_s3_photo_exists("nonexistent")

        self.assertFalse(result)

    @patch("skyspy.services.storage._get_s3_client")
    def test_check_exists_no_client(self, mock_get_client):
        """Test checking when S3 client unavailable."""
        mock_get_client.return_value = None

        result = _check_s3_photo_exists("abc123")

        self.assertFalse(result)


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
    S3_PREFIX="photos",
)
class UploadPhotoToS3Tests(TestCase):
    """Tests for S3 upload functionality."""

    @patch("skyspy.services.storage._get_s3_client")
    def test_upload_success(self, mock_get_client):
        """Test successful upload."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        result = _upload_photo_to_s3(b"fake image data", "abc123")

        self.assertIsNotNone(result)
        mock_client.put_object.assert_called_once()

    @patch("skyspy.services.storage._get_s3_client")
    def test_upload_no_client(self, mock_get_client):
        """Test upload when S3 client unavailable."""
        mock_get_client.return_value = None

        result = _upload_photo_to_s3(b"fake image data", "abc123")

        self.assertIsNone(result)

    @patch("skyspy.services.storage._get_s3_client")
    @patch("time.sleep")
    def test_upload_retry_on_error(self, mock_sleep, mock_get_client):
        """Test upload retries on error."""
        mock_client = MagicMock()
        mock_client.put_object.side_effect = [Exception("Error"), Exception("Error"), None]
        mock_get_client.return_value = mock_client

        result = _upload_photo_to_s3(b"fake image data", "abc123")

        self.assertIsNotNone(result)
        self.assertEqual(mock_client.put_object.call_count, 3)


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
    S3_PREFIX="photos",
)
class GetSignedPhotoUrlTests(TestCase):
    """Tests for signed URL generation."""

    @patch("skyspy.services.storage._get_s3_client")
    def test_get_signed_url_success(self, mock_get_client):
        """Test successful signed URL generation."""
        mock_client = MagicMock()
        mock_client.generate_presigned_url.return_value = "https://signed-url.example.com/photo.jpg"
        mock_get_client.return_value = mock_client

        result = get_signed_photo_url("abc123")

        self.assertEqual(result, "https://signed-url.example.com/photo.jpg")

    @patch("skyspy.services.storage._get_s3_client")
    def test_get_signed_url_no_client(self, mock_get_client):
        """Test signed URL when S3 client unavailable."""
        mock_get_client.return_value = None

        result = get_signed_photo_url("abc123")

        self.assertIsNone(result)

    @patch("skyspy.services.storage._get_s3_client")
    def test_get_signed_url_error(self, mock_get_client):
        """Test signed URL generation error."""
        mock_client = MagicMock()
        mock_client.generate_presigned_url.side_effect = Exception("Error")
        mock_get_client.return_value = mock_client

        result = get_signed_photo_url("abc123")

        self.assertIsNone(result)


@override_settings(
    PHOTO_CACHE_ENABLED=True,
    PHOTO_CACHE_DIR="/tmp/skyspy_test_photos",
)
class GetPhotoUrlTests(TestCase):
    """Tests for get_photo_url function."""

    @override_settings(S3_ENABLED=False)
    def test_get_photo_url_local_not_exists(self):
        """Test local photo URL when file doesn't exist."""
        result = get_photo_url("nonexistent")

        self.assertIsNone(result)

    @override_settings(S3_ENABLED=False)
    def test_get_photo_url_local_exists(self):
        """Test local photo URL when file exists."""
        # Create a test file
        path = get_photo_path("testphoto")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fake image data")

        try:
            result = get_photo_url("testphoto")
            self.assertIsNotNone(result)
            self.assertIn("TESTPHOTO.jpg", result)
        finally:
            path.unlink(missing_ok=True)

    @override_settings(S3_ENABLED=True)
    @patch("skyspy.services.photo_cache.get_signed_photo_url")
    def test_get_photo_url_s3_signed(self, mock_signed):
        """Test S3 photo URL with signing."""
        mock_signed.return_value = "https://signed-url.example.com"

        result = get_photo_url("abc123", signed=True)

        self.assertEqual(result, "https://signed-url.example.com")

    @override_settings(S3_ENABLED=True)
    @patch("skyspy.services.photo_cache._get_s3_photo_url")
    def test_get_photo_url_s3_unsigned(self, mock_url):
        """Test S3 photo URL without signing."""
        mock_url.return_value = "https://public-url.example.com"

        result = get_photo_url("abc123", signed=False)

        self.assertEqual(result, "https://public-url.example.com")


class ScrapePlanespottersTests(TestCase):
    """Tests for Planespotters page scraping."""

    def test_scrape_invalid_url(self):
        """Test scraping with invalid URL returns None."""
        result = _scrape_planespotters_full_size("https://other-site.com/photo")

        self.assertIsNone(result)

    def test_scrape_none_url(self):
        """Test scraping with None URL returns None."""
        result = _scrape_planespotters_full_size(None)

        self.assertIsNone(result)

    @patch("skyspy.services.photo_cache._http_get_with_retry")
    def test_scrape_finds_original(self, mock_get):
        """Test scraping finds original size URL."""
        mock_response = MagicMock()
        mock_response.text = """
        <html>
            <img src="https://cdn.plnspttrs.net/12345/photo_o.jpg" />
        </html>
        """
        mock_get.return_value = mock_response

        result = _scrape_planespotters_full_size("https://www.planespotters.net/photo/12345")

        self.assertIsNotNone(result)
        self.assertIn("_o.jpg", result)

    @patch("skyspy.services.photo_cache._http_get_with_retry")
    def test_scrape_finds_large(self, mock_get):
        """Test scraping falls back to large size URL."""
        mock_response = MagicMock()
        mock_response.text = """
        <html>
            <img src="https://cdn.plnspttrs.net/12345/photo_l.jpg" />
        </html>
        """
        mock_get.return_value = mock_response

        result = _scrape_planespotters_full_size("https://www.planespotters.net/photo/12345")

        self.assertIsNotNone(result)
        self.assertIn("_l.jpg", result)


@override_settings(
    PHOTO_CACHE_ENABLED=True,
    PHOTO_CACHE_DIR="/tmp/skyspy_test_photos",
    S3_ENABLED=False,
)
class DownloadPhotoTests(TestCase):
    """Tests for photo downloading."""

    def tearDown(self):
        """Clean up test files."""
        import shutil

        shutil.rmtree("/tmp/skyspy_test_photos", ignore_errors=True)

    @override_settings(PHOTO_CACHE_ENABLED=False)
    def test_download_disabled(self):
        """Test download when caching disabled."""
        result = download_photo("https://example.com/photo.jpg", "abc123")

        self.assertIsNone(result)

    def test_download_no_url(self):
        """Test download with no URL."""
        result = download_photo("", "abc123")

        self.assertIsNone(result)

    @patch("skyspy.services.photo_cache._http_get_with_retry")
    def test_download_success(self, mock_get):
        """Test successful download."""
        mock_response = MagicMock()
        mock_response.headers = {"content-type": "image/jpeg"}
        mock_response.content = b"fake jpeg data"
        mock_get.return_value = mock_response

        result = download_photo("https://example.com/photo.jpg", "testdownload")

        self.assertIsNotNone(result)

    @patch("skyspy.services.photo_cache._http_get_with_retry")
    def test_download_not_image(self, mock_get):
        """Test download of non-image content returns None."""
        mock_response = MagicMock()
        mock_response.headers = {"content-type": "text/html"}
        mock_response.content = b"<html>Not an image</html>"
        mock_get.return_value = mock_response

        result = download_photo("https://example.com/page.html", "notimage")

        self.assertIsNone(result)

    @patch("skyspy.services.photo_cache._http_get_with_retry")
    def test_download_already_cached(self, mock_get):
        """Test download skips when already cached."""
        # Create existing file
        path = get_photo_path("cached")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"existing data")

        try:
            result = download_photo("https://example.com/photo.jpg", "cached")

            # Should return existing path without downloading
            self.assertIsNotNone(result)
            mock_get.assert_not_called()
        finally:
            path.unlink(missing_ok=True)


@override_settings(
    PHOTO_CACHE_ENABLED=True,
    PHOTO_CACHE_DIR="/tmp/skyspy_test_photos",
    S3_ENABLED=False,
)
class CacheAircraftPhotosTests(TestCase):
    """Tests for caching both photo and thumbnail."""

    def tearDown(self):
        """Clean up test files."""
        import shutil

        shutil.rmtree("/tmp/skyspy_test_photos", ignore_errors=True)

    @override_settings(PHOTO_CACHE_ENABLED=False)
    def test_cache_disabled(self):
        """Test caching when disabled."""
        result = cache_aircraft_photos("abc123", "https://example.com/photo.jpg")

        self.assertEqual(result, (None, None))

    @patch("skyspy.services.photo_cache.download_photo")
    @patch("skyspy.services.photo_cache.update_photo_paths")
    def test_cache_both_photos(self, mock_update, mock_download):
        """Test caching both full and thumbnail."""
        mock_download.side_effect = ["/path/to/photo.jpg", "/path/to/thumb.jpg"]

        result = cache_aircraft_photos(
            "abc123",
            photo_url="https://example.com/photo.jpg",
            thumbnail_url="https://example.com/thumb.jpg",
        )

        self.assertEqual(result[0], "/path/to/photo.jpg")
        self.assertEqual(result[1], "/path/to/thumb.jpg")
        mock_update.assert_called_once()


class GetCachedPhotoTests(TestCase):
    """Tests for get_cached_photo function."""

    @override_settings(S3_ENABLED=True)
    def test_get_cached_s3_enabled(self):
        """Test get_cached_photo returns None when S3 enabled."""
        result = get_cached_photo("abc123")

        self.assertIsNone(result)

    @override_settings(S3_ENABLED=False, PHOTO_CACHE_DIR="/tmp/skyspy_test_photos")
    def test_get_cached_not_exists(self):
        """Test get_cached_photo when file doesn't exist."""
        result = get_cached_photo("nonexistent")

        self.assertIsNone(result)


@override_settings(
    PHOTO_CACHE_ENABLED=True,
    PHOTO_CACHE_DIR="/tmp/skyspy_test_photos",
)
class GetCacheStatsTests(TestCase):
    """Tests for cache statistics."""

    def tearDown(self):
        """Clean up test files."""
        import shutil

        shutil.rmtree("/tmp/skyspy_test_photos", ignore_errors=True)

    @override_settings(S3_ENABLED=True, S3_BUCKET="test", S3_PREFIX="photos", S3_REGION="us-west-2")
    def test_get_stats_s3(self):
        """Test stats for S3 storage."""
        stats = get_cache_stats()

        self.assertEqual(stats["storage"], "s3")
        self.assertEqual(stats["bucket"], "test")

    @override_settings(S3_ENABLED=False)
    def test_get_stats_local(self):
        """Test stats for local storage."""
        stats = get_cache_stats()

        self.assertEqual(stats["storage"], "local")
        self.assertIn("total_photos", stats)
        self.assertIn("total_thumbnails", stats)
        self.assertIn("total_size_mb", stats)

    @override_settings(S3_ENABLED=False)
    def test_get_stats_local_with_files(self):
        """Test stats with actual cached files."""
        # Create test files large enough that total_size_mb > 0 after
        # rounding to 2 decimal places (i.e. >= 0.005 MB = 5243 bytes)
        cache_dir = get_cache_dir()
        (cache_dir / "ABC123.jpg").write_bytes(b"x" * 4000)
        (cache_dir / "ABC123_thumb.jpg").write_bytes(b"x" * 3000)
        (cache_dir / "DEF456.jpg").write_bytes(b"x" * 4000)

        try:
            stats = get_cache_stats()

            self.assertEqual(stats["total_photos"], 2)
            self.assertEqual(stats["total_thumbnails"], 1)
            self.assertGreater(stats["total_size_mb"], 0)
        finally:
            (cache_dir / "ABC123.jpg").unlink(missing_ok=True)
            (cache_dir / "ABC123_thumb.jpg").unlink(missing_ok=True)
            (cache_dir / "DEF456.jpg").unlink(missing_ok=True)


class UpdatePhotoPathsTests(TestCase):
    """Tests for update_photo_paths function."""

    def test_update_paths_no_crash(self):
        """Test update_photo_paths doesn't crash on missing aircraft."""
        # Should not raise even if aircraft doesn't exist
        update_photo_paths("NONEXISTENT", "/path/to/photo.jpg")
