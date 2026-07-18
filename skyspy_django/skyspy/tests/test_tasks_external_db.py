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

AD_THUMB = "https://www.airport-data.com/images/aircraft/thumbnails/001/234/1234.jpg"


def _ad_resp(status=200, rows=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = {"status": status, "count": len(rows or []), "data": rows or []}
    return r


def _resp_json(payload, status=200):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = payload
    return r


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
    def test_falls_back_to_airport_data(self, mock_get, *_mocks):
        """When Planespotters misses entirely, airport-data.com resolves a photo."""
        AircraftInfo.objects.create(icao_hex="A1B2C3", registration="N12345")

        def _by_url(url, **_kwargs):
            if "planespotters" in url:
                return _resp(200, photos=[])  # miss on hex + reg
            if "airport-data.com" in url and "m=A1B2C3" in url:
                return _ad_resp(200, rows=[{"image": AD_THUMB, "link": "https://x", "photographer": "Sam"}])
            return _resp(404)

        mock_get.side_effect = _by_url

        external_db.fetch_aircraft_photos("A1B2C3")

        info = AircraftInfo.objects.get(icao_hex="A1B2C3")
        self.assertEqual(info.photo_source, "airport-data.com")
        # full-size derived by dropping the /thumbnails path segment
        self.assertNotIn("/thumbnails", info.photo_url)
        self.assertIn("/thumbnails", info.photo_thumbnail_url)

    @patch("skyspy.tasks.external_db.http_client.head_ok", return_value=False)
    @patch("skyspy.services.photo_cache.update_photo_paths")
    @patch("skyspy.services.photo_cache.download_photo", return_value="/tmp/A1B2C3.jpg")
    @patch("skyspy.services.photo_cache.get_photo_url", return_value=None)
    @patch("skyspy.tasks.external_db.httpx.get")
    def test_falls_back_to_flickr_for_ga(self, mock_get, *_mocks):
        """When every curated DB misses, the Flickr public feed resolves a GA photo."""
        AircraftInfo.objects.create(icao_hex="A1B2C3", registration="N12345")

        flickr_item = {
            "title": "N12345",
            "link": "https://www.flickr.com/photos/spotter/123/",
            "author": 'nobody@flickr.com ("Jane Spotter")',
            "media": {"m": "https://live.staticflickr.com/1/123_abc_m.jpg"},
        }

        def _by_url(url, **kwargs):
            if "flickr.com/services/feeds" in url:
                return _resp_json({"items": [flickr_item]})
            return _resp(200, photos=[])  # planespotters/airport-data all miss

        mock_get.side_effect = _by_url

        external_db.fetch_aircraft_photos("A1B2C3")

        info = AircraftInfo.objects.get(icao_hex="A1B2C3")
        self.assertEqual(info.photo_source, "flickr")
        self.assertEqual(info.photo_url, "https://live.staticflickr.com/1/123_abc_b.jpg")  # _m -> _b upgrade
        self.assertEqual(info.photo_thumbnail_url, "https://live.staticflickr.com/1/123_abc_m.jpg")
        self.assertEqual(info.photo_photographer, "Jane Spotter")

    @patch("skyspy.tasks.external_db.http_client.head_ok", return_value=False)
    @patch("skyspy.services.photo_cache.update_photo_paths")
    @patch("skyspy.services.photo_cache.download_photo", return_value="/tmp/A1B2C3.jpg")
    @patch("skyspy.services.photo_cache.get_photo_url", return_value=None)
    @patch("skyspy.tasks.external_db.httpx.get")
    def test_short_registration_skips_flickr(self, mock_get, *_mocks):
        """A too-short tail (e.g. N44) is too fuzzy for tag search, so Flickr is not queried."""
        AircraftInfo.objects.create(icao_hex="A1B2C3", registration="N44")

        mock_get.side_effect = lambda url, **_k: _resp(200, photos=[])

        external_db.fetch_aircraft_photos("A1B2C3")

        called = [c.args[0] for c in mock_get.call_args_list]
        self.assertFalse(any("flickr.com/services/feeds" in u for u in called))

    @patch("skyspy.tasks.external_db.http_client.head_ok", return_value=False)
    @patch("skyspy.services.photo_cache.update_photo_paths")
    @patch("skyspy.services.photo_cache.download_photo", return_value="/tmp/400001.jpg")
    @patch("skyspy.services.photo_cache.get_photo_url", return_value=None)
    @patch("skyspy.tasks.external_db.httpx.get")
    def test_no_registration_non_us_only_tries_hex(self, mock_get, *_mocks):
        """A non-US hex with no registration can't derive a tail, so only hex endpoints fire."""
        # 0x400001 is in the UK block, outside the US N-number range -> no derivation.
        AircraftInfo.objects.create(icao_hex="400001", registration="")

        mock_get.side_effect = lambda url, **_k: _resp(200, photos=[])

        external_db.fetch_aircraft_photos("400001")

        called = [c.args[0] for c in mock_get.call_args_list]
        self.assertTrue(any("/photos/hex/" in u for u in called))
        # no registration + non-US -> neither the Planespotters reg endpoint nor airport-data r=
        self.assertFalse(any("/photos/reg/" in u for u in called))
        self.assertFalse(any("r=" in u for u in called))

    @patch("skyspy.tasks.external_db.http_client.head_ok", return_value=False)
    @patch("skyspy.services.photo_cache.update_photo_paths")
    @patch("skyspy.services.photo_cache.download_photo", return_value="/tmp/A1B2C3.jpg")
    @patch("skyspy.services.photo_cache.get_photo_url", return_value=None)
    @patch("skyspy.tasks.external_db.httpx.get")
    def test_us_hex_derives_registration_when_db_empty(self, mock_get, *_mocks):
        """A US-block hex with no DB registration derives its N-number and tries the reg endpoints."""
        # 0xA1B2C3 is in the US block -> icao_to_n yields a valid tail even with no DB reg.
        from skyspy.services.nnumber import icao_to_n

        derived = icao_to_n("A1B2C3")
        self.assertIsNotNone(derived)
        AircraftInfo.objects.create(icao_hex="A1B2C3", registration="")

        def _by_url(url, **_kwargs):
            if "planespotters" in url:
                return _resp(200, photos=[])  # miss on hex + derived reg
            if "airport-data.com" in url and f"r={derived}" in url:
                return _ad_resp(200, rows=[{"image": AD_THUMB, "link": "https://x", "photographer": "Sam"}])
            return _resp(404)

        mock_get.side_effect = _by_url

        external_db.fetch_aircraft_photos("A1B2C3")

        called = [c.args[0] for c in mock_get.call_args_list]
        self.assertTrue(any(f"/photos/reg/{derived}" in u for u in called))
        self.assertEqual(AircraftInfo.objects.get(icao_hex="A1B2C3").photo_source, "airport-data.com")
