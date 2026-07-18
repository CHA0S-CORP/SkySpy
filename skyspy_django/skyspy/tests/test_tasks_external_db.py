"""
Tests for external_db background tasks — focused on aircraft photo fetching.

Covers the registration fallback that lets general-aviation airframes (absent
from Planespotters' hex index but present by tail number) resolve a photo.
"""

from unittest.mock import MagicMock, patch

from django.test import TestCase

from skyspy.models import AircraftInfo
from skyspy.tasks import external_db


def _resp(status=200, photos=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = {"photos": photos or []}
    return r


PS_PHOTO = {
    "thumbnail_large": {"src": "https://t.plnspttrs.net/large.jpg"},
    "thumbnail": {"src": "https://t.plnspttrs.net/small.jpg"},
    "link": "https://www.planespotters.net/photo/123",
    "photographer": "Jane Doe",
}


class FetchAircraftPhotosTests(TestCase):
    """fetch_aircraft_photos hex/registration source selection."""

    def setUp(self):
        AircraftInfo.objects.all().delete()

    @patch("skyspy.services.photo_cache.update_photo_paths")
    @patch("skyspy.services.photo_cache.download_photo", return_value="/tmp/A1B2C3.jpg")
    @patch("skyspy.services.photo_cache.get_photo_url", return_value=None)
    @patch("skyspy.tasks.external_db.httpx.get")
    def test_falls_back_to_registration_for_ga(self, mock_get, *_mocks):
        """GA airframe missing from the hex index resolves via the reg endpoint."""
        AircraftInfo.objects.create(icao_hex="A1B2C3", registration="N12345")

        def _by_url(url, **_kwargs):
            if "/photos/hex/" in url:
                return _resp(200, photos=[])  # not in the hex index
            if "/photos/reg/N12345" in url:
                return _resp(200, photos=[PS_PHOTO])  # present by registration
            return _resp(404)

        mock_get.side_effect = _by_url

        external_db.fetch_aircraft_photos("A1B2C3")

        info = AircraftInfo.objects.get(icao_hex="A1B2C3")
        self.assertEqual(info.photo_url, "https://t.plnspttrs.net/large.jpg")
        self.assertEqual(info.photo_thumbnail_url, "https://t.plnspttrs.net/small.jpg")
        self.assertEqual(info.photo_source, "planespotters.net")
        called = [c.args[0] for c in mock_get.call_args_list]
        self.assertTrue(any("/photos/reg/N12345" in u for u in called))

    @patch("skyspy.services.photo_cache.update_photo_paths")
    @patch("skyspy.services.photo_cache.download_photo", return_value="/tmp/A1B2C3.jpg")
    @patch("skyspy.services.photo_cache.get_photo_url", return_value=None)
    @patch("skyspy.tasks.external_db.httpx.get")
    def test_hex_hit_skips_registration(self, mock_get, *_mocks):
        """A hex-index hit short-circuits before the registration lookup."""
        AircraftInfo.objects.create(icao_hex="A1B2C3", registration="N12345")

        def _by_url(url, **_kwargs):
            if "/photos/hex/" in url:
                return _resp(200, photos=[PS_PHOTO])
            return _resp(404)

        mock_get.side_effect = _by_url

        external_db.fetch_aircraft_photos("A1B2C3")

        called = [c.args[0] for c in mock_get.call_args_list]
        self.assertFalse(any("/photos/reg/" in u for u in called))
        self.assertEqual(AircraftInfo.objects.get(icao_hex="A1B2C3").photo_source, "planespotters.net")

    @patch("skyspy.services.photo_cache.update_photo_paths")
    @patch("skyspy.services.photo_cache.download_photo", return_value="/tmp/A1B2C3.jpg")
    @patch("skyspy.services.photo_cache.get_photo_url", return_value=None)
    @patch("skyspy.tasks.external_db.httpx.get")
    def test_no_registration_only_tries_hex(self, mock_get, *_mocks):
        """Without a registration the reg endpoint is never attempted."""
        AircraftInfo.objects.create(icao_hex="A1B2C3", registration="")

        mock_get.side_effect = lambda url, **_k: _resp(200, photos=[])

        external_db.fetch_aircraft_photos("A1B2C3")

        called = [c.args[0] for c in mock_get.call_args_list]
        self.assertTrue(any("/photos/hex/" in u for u in called))
        self.assertFalse(any("/photos/reg/" in u for u in called))
