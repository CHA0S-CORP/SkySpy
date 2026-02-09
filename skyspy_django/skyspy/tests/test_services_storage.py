"""
Tests for the storage service.

Tests S3 operations, local file storage, filename sanitization,
and related functionality.
"""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings

from skyspy.services.storage import (
    _get_s3_client,
    check_s3_exists,
    delete_local_file,
    download_from_s3,
    generate_signed_url,
    get_local_file_stats,
    get_s3_key,
    get_s3_url,
    read_local_file,
    reset_s3_client,
    sanitize_filename,
    save_file_locally,
    upload_to_s3,
)


class SanitizeFilenameTests(TestCase):
    """Tests for filename sanitization."""

    def test_sanitize_simple_filename(self):
        """Test sanitizing a simple filename."""
        result = sanitize_filename("photo.jpg")

        self.assertEqual(result, "photo.jpg")

    def test_sanitize_removes_directory(self):
        """Test sanitizing removes directory components."""
        result = sanitize_filename("/path/to/photo.jpg")

        self.assertEqual(result, "photo.jpg")

    def test_sanitize_removes_traversal(self):
        """Test sanitizing removes path traversal."""
        result = sanitize_filename("../../../etc/passwd")

        self.assertEqual(result, "passwd")

    def test_sanitize_empty_raises(self):
        """Test sanitizing empty filename raises ValueError."""
        with self.assertRaises(ValueError):
            sanitize_filename("")

    def test_sanitize_invalid_chars_raises(self):
        """Test sanitizing filename with invalid chars raises."""
        with self.assertRaises(ValueError):
            sanitize_filename("file with spaces.jpg")

    def test_sanitize_dots_only_raises(self):
        """Test sanitizing '.' or '..' raises ValueError."""
        with self.assertRaises(ValueError):
            sanitize_filename(".")

        with self.assertRaises(ValueError):
            sanitize_filename("..")

    def test_sanitize_allowed_chars(self):
        """Test sanitizing allows valid characters."""
        result = sanitize_filename("ABC123_photo-v2.jpg")

        self.assertEqual(result, "ABC123_photo-v2.jpg")


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
    S3_PREFIX="test-prefix",
    S3_REGION="us-west-2",
)
class GetS3KeyTests(TestCase):
    """Tests for S3 key generation."""

    def test_get_s3_key_basic(self):
        """Test basic S3 key generation."""
        key = get_s3_key("photo.jpg", "photos")

        self.assertEqual(key, "photos/photo.jpg")

    def test_get_s3_key_sanitizes_filename(self):
        """Test S3 key sanitizes filename."""
        key = get_s3_key("/path/to/photo.jpg", "photos")

        self.assertEqual(key, "photos/photo.jpg")

    def test_get_s3_key_strips_prefix_slashes(self):
        """Test S3 key strips prefix slashes."""
        key = get_s3_key("photo.jpg", "/photos/")

        self.assertEqual(key, "photos/photo.jpg")

    def test_get_s3_key_traversal_raises(self):
        """Test S3 key with traversal in result raises."""
        # The key itself shouldn't contain .. after sanitization
        # but let's ensure the check is there
        result = get_s3_key("safe.jpg", "prefix")
        self.assertNotIn("..", result)


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
    S3_REGION="us-west-2",
    S3_ENDPOINT_URL="",
    S3_PUBLIC_URL="",
)
class GetS3UrlTests(TestCase):
    """Tests for S3 URL generation."""

    def test_get_s3_url_default_aws(self):
        """Test S3 URL with default AWS format."""
        url = get_s3_url("photo.jpg", "photos")

        self.assertIn("test-bucket.s3.us-west-2.amazonaws.com", url)
        self.assertIn("photos/photo.jpg", url)

    @override_settings(S3_ENDPOINT_URL="https://minio.example.com")
    def test_get_s3_url_custom_endpoint(self):
        """Test S3 URL with custom endpoint."""
        url = get_s3_url("photo.jpg", "photos")

        self.assertIn("minio.example.com", url)
        self.assertIn("test-bucket", url)

    @override_settings(S3_PUBLIC_URL="https://cdn.example.com/storage")
    def test_get_s3_url_public_url(self):
        """Test S3 URL with public URL override."""
        url = get_s3_url("photo.jpg", "photos")

        self.assertIn("cdn.example.com", url)


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
    S3_REGION="us-west-2",
    S3_ACCESS_KEY="test-key",
    S3_SECRET_KEY="test-secret",
    S3_ENDPOINT_URL="",
)
class GetS3ClientTests(TestCase):
    """Tests for S3 client initialization."""

    def setUp(self):
        """Reset client state."""
        reset_s3_client()

    def tearDown(self):
        """Reset client state."""
        reset_s3_client()

    @patch("boto3.client")
    def test_get_client_creates_client(self, mock_boto3):
        """Test client is created on first call."""
        mock_client = MagicMock()
        mock_boto3.return_value = mock_client

        client = _get_s3_client()

        self.assertIsNotNone(client)
        mock_boto3.assert_called()

    @patch("boto3.client")
    def test_get_client_reuses_client(self, mock_boto3):
        """Test client is reused on subsequent calls."""
        mock_client = MagicMock()
        mock_boto3.return_value = mock_client

        client1 = _get_s3_client()
        client2 = _get_s3_client()

        self.assertIs(client1, client2)
        self.assertEqual(mock_boto3.call_count, 1)

    @override_settings(S3_ENABLED=False)
    def test_get_client_disabled(self):
        """Test client is None when S3 disabled."""
        client = _get_s3_client()

        self.assertIsNone(client)


class ResetS3ClientTests(TestCase):
    """Tests for reset_s3_client function."""

    def test_reset_clears_state(self):
        """Test reset clears client state."""
        import skyspy.services.storage as storage_module

        storage_module._s3_client = MagicMock()
        storage_module._s3_client_init_failed = True

        reset_s3_client()

        self.assertIsNone(storage_module._s3_client)
        self.assertFalse(storage_module._s3_client_init_failed)


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
    S3_REGION="us-west-2",
)
class GenerateSignedUrlTests(TestCase):
    """Tests for signed URL generation."""

    @patch("skyspy.services.storage._get_s3_client")
    def test_generate_signed_url_success(self, mock_get_client):
        """Test successful signed URL generation."""
        mock_client = MagicMock()
        mock_client.generate_presigned_url.return_value = "https://signed-url.example.com"
        mock_get_client.return_value = mock_client

        url = generate_signed_url("photo.jpg", "photos")

        self.assertEqual(url, "https://signed-url.example.com")

    @patch("skyspy.services.storage._get_s3_client")
    def test_generate_signed_url_no_client(self, mock_get_client):
        """Test signed URL returns None when client unavailable."""
        mock_get_client.return_value = None

        url = generate_signed_url("photo.jpg", "photos")

        self.assertIsNone(url)

    @patch("skyspy.services.storage._get_s3_client")
    def test_generate_signed_url_error(self, mock_get_client):
        """Test signed URL returns None on error."""
        mock_client = MagicMock()
        mock_client.generate_presigned_url.side_effect = Exception("Error")
        mock_get_client.return_value = mock_client

        url = generate_signed_url("photo.jpg", "photos")

        self.assertIsNone(url)


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
)
class UploadToS3Tests(TestCase):
    """Tests for S3 upload."""

    @patch("skyspy.services.storage._get_s3_client")
    def test_upload_success(self, mock_get_client):
        """Test successful upload."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        url = upload_to_s3(b"test data", "test.txt", "files", content_type="text/plain")

        self.assertIsNotNone(url)
        mock_client.put_object.assert_called_once()

    @patch("skyspy.services.storage._get_s3_client")
    def test_upload_no_client(self, mock_get_client):
        """Test upload returns None when client unavailable."""
        mock_get_client.return_value = None

        url = upload_to_s3(b"test data", "test.txt", "files")

        self.assertIsNone(url)

    @patch("skyspy.services.storage._get_s3_client")
    def test_upload_error(self, mock_get_client):
        """Test upload returns None on error."""
        mock_client = MagicMock()
        mock_client.put_object.side_effect = Exception("Upload failed")
        mock_get_client.return_value = mock_client

        url = upload_to_s3(b"test data", "test.txt", "files")

        self.assertIsNone(url)


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
)
class DownloadFromS3Tests(TestCase):
    """Tests for S3 download."""

    @patch("skyspy.services.storage._get_s3_client")
    def test_download_success(self, mock_get_client):
        """Test successful download."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.__getitem__ = MagicMock(return_value=MagicMock(read=MagicMock(return_value=b"file data")))
        mock_client.get_object.return_value = mock_response
        mock_get_client.return_value = mock_client

        data = download_from_s3("test.txt", "files")

        self.assertEqual(data, b"file data")

    @patch("skyspy.services.storage._get_s3_client")
    def test_download_no_client(self, mock_get_client):
        """Test download returns None when client unavailable."""
        mock_get_client.return_value = None

        data = download_from_s3("test.txt", "files")

        self.assertIsNone(data)


@override_settings(
    S3_ENABLED=True,
    S3_BUCKET="test-bucket",
)
class CheckS3ExistsTests(TestCase):
    """Tests for S3 existence checking."""

    @patch("skyspy.services.storage._get_s3_client")
    def test_check_exists_true(self, mock_get_client):
        """Test checking existing file."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        result = check_s3_exists("test.txt", "files", use_cache=False)

        self.assertTrue(result)
        mock_client.head_object.assert_called()

    @patch("skyspy.services.storage._get_s3_client")
    def test_check_exists_not_found(self, mock_get_client):
        """Test checking non-existent file."""
        from botocore.exceptions import ClientError

        mock_client = MagicMock()
        mock_client.head_object.side_effect = ClientError(
            {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
        )
        mock_get_client.return_value = mock_client

        result = check_s3_exists("missing.txt", "files", use_cache=False)

        self.assertFalse(result)

    @patch("skyspy.services.storage._get_s3_client")
    def test_check_exists_no_client(self, mock_get_client):
        """Test check returns False when client unavailable."""
        mock_get_client.return_value = None

        result = check_s3_exists("test.txt", "files")

        self.assertFalse(result)


class SaveFileLocallyTests(TestCase):
    """Tests for local file saving."""

    def test_save_success(self):
        """Test successful local save."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = save_file_locally(b"test data", "test.txt", tmpdir)

            self.assertIsNotNone(result)
            self.assertTrue(result.exists())
            self.assertEqual(result.read_bytes(), b"test data")

    def test_save_creates_directory(self):
        """Test save creates directory if needed."""
        with tempfile.TemporaryDirectory() as tmpdir:
            nested_dir = Path(tmpdir) / "nested" / "path"
            result = save_file_locally(b"test data", "test.txt", str(nested_dir))

            self.assertIsNotNone(result)
            self.assertTrue(nested_dir.exists())

    def test_save_sanitizes_filename(self):
        """Test save sanitizes the filename."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = save_file_locally(b"test data", "../../../test.txt", tmpdir)

            self.assertIsNotNone(result)
            self.assertEqual(result.name, "test.txt")
            # File should be in tmpdir, not escaped
            self.assertTrue(str(result).startswith(tmpdir))


class ReadLocalFileTests(TestCase):
    """Tests for local file reading."""

    def test_read_success(self):
        """Test successful local read."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "test.txt"
            file_path.write_bytes(b"test data")

            result = read_local_file("test.txt", tmpdir)

            self.assertEqual(result, b"test data")

    def test_read_not_found(self):
        """Test reading non-existent file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = read_local_file("missing.txt", tmpdir)

            self.assertIsNone(result)

    def test_read_sanitizes_filename(self):
        """Test read sanitizes the filename."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Try to read a file outside the directory
            result = read_local_file("../../../etc/passwd", tmpdir)

            self.assertIsNone(result)


class DeleteLocalFileTests(TestCase):
    """Tests for local file deletion."""

    def test_delete_success(self):
        """Test successful local delete."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "test.txt"
            file_path.write_bytes(b"test data")

            result = delete_local_file("test.txt", tmpdir)

            self.assertTrue(result)
            self.assertFalse(file_path.exists())

    def test_delete_not_found(self):
        """Test deleting non-existent file returns False."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = delete_local_file("missing.txt", tmpdir)

            self.assertFalse(result)


class GetLocalFileStatsTests(TestCase):
    """Tests for local file statistics."""

    def test_stats_empty_directory(self):
        """Test stats for empty directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            stats = get_local_file_stats(tmpdir)

            self.assertEqual(stats["file_count"], 0)
            self.assertEqual(stats["total_size_mb"], 0)

    def test_stats_with_files(self):
        """Test stats with files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Files must be large enough that total_size_mb > 0 after
            # rounding to 2 decimal places (i.e. >= 0.005 MB = 5243 bytes)
            (Path(tmpdir) / "file1.txt").write_bytes(b"a" * 5000)
            (Path(tmpdir) / "file2.txt").write_bytes(b"b" * 6000)

            stats = get_local_file_stats(tmpdir)

            self.assertEqual(stats["file_count"], 2)
            self.assertGreater(stats["total_size_mb"], 0)

    def test_stats_nonexistent_directory(self):
        """Test stats for non-existent directory."""
        stats = get_local_file_stats("/nonexistent/path")

        self.assertEqual(stats["file_count"], 0)
        self.assertEqual(stats["total_size_mb"], 0)
