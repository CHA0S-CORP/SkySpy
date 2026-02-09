"""
Tests for the OpenFlights service.

Tests OpenFlights static data loading including:
- Airline data fetching and caching
- Aircraft type data fetching and caching
- Lookup by ICAO code
- Lookup by callsign
- Search functionality
- Cache statistics
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from django.test import TestCase

from skyspy.models.notams import CachedAircraftType, CachedAirline
from skyspy.services import openflights


class FetchCsvDataTests(TestCase):
    """Tests for CSV data fetching."""

    @patch("httpx.Client")
    def test_fetch_csv_data_success(self, mock_client_class):
        """Test successful CSV data fetch."""
        mock_response = MagicMock()
        mock_response.text = '"AAL","American Airlines","AA","AMERICAN","United States","Y"\n'
        mock_response.raise_for_status = MagicMock()
        mock_client = MagicMock()
        mock_client.get.return_value = mock_response
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = openflights._fetch_csv_data("https://example.com/data.csv")

        self.assertIsNotNone(result)
        self.assertEqual(len(result), 1)

    @patch("httpx.Client")
    def test_fetch_csv_data_failure_returns_none(self, mock_client_class):
        """Test that fetch failure returns None."""
        mock_client = MagicMock()
        mock_client.get.side_effect = Exception("Network error")
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_class.return_value = mock_client

        result = openflights._fetch_csv_data("https://example.com/data.csv")

        self.assertIsNone(result)


class RefreshAirlinesTests(TestCase):
    """Tests for airline data refresh."""

    def setUp(self):
        """Clean up airlines before each test."""
        CachedAirline.objects.all().delete()

    def tearDown(self):
        """Clean up airlines after each test."""
        CachedAirline.objects.all().delete()

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_airlines_success(self, mock_fetch):
        """Test successful airline refresh."""
        # OpenFlights format: ID, Name, Alias, IATA, ICAO, Callsign, Country, Active
        mock_fetch.return_value = [
            ["1", "American Airlines", "\\N", "AA", "AAL", "AMERICAN", "United States", "Y"],
            ["2", "United Airlines", "\\N", "UA", "UAL", "UNITED", "United States", "Y"],
        ]

        count = openflights.refresh_airlines()

        self.assertEqual(count, 2)
        self.assertEqual(CachedAirline.objects.count(), 2)

        aal = CachedAirline.objects.get(icao_code="AAL")
        self.assertEqual(aal.name, "American Airlines")
        self.assertEqual(aal.iata_code, "AA")
        self.assertEqual(aal.callsign, "AMERICAN")
        self.assertTrue(aal.active)

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_airlines_skips_no_icao(self, mock_fetch):
        """Test that airlines without ICAO are skipped."""
        mock_fetch.return_value = [
            ["1", "American Airlines", "\\N", "AA", "AAL", "AMERICAN", "United States", "Y"],
            ["2", "No ICAO Airline", "\\N", "XX", "\\N", "NOICAO", "United States", "Y"],  # No ICAO
            ["3", "Empty ICAO", "\\N", "YY", "", "EMPTY", "United States", "Y"],  # Empty ICAO
        ]

        count = openflights.refresh_airlines()

        self.assertEqual(count, 1)

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_airlines_skips_dash_icao(self, mock_fetch):
        """Test that airlines with dash ICAO are skipped."""
        mock_fetch.return_value = [
            ["1", "American Airlines", "\\N", "AA", "AAL", "AMERICAN", "United States", "Y"],
            ["2", "Dash ICAO", "\\N", "XX", "-", "DASH", "United States", "Y"],
        ]

        count = openflights.refresh_airlines()

        self.assertEqual(count, 1)

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_airlines_deduplicates(self, mock_fetch):
        """Test that duplicate ICAOs are deduplicated."""
        mock_fetch.return_value = [
            ["1", "American Airlines v1", "\\N", "AA", "AAL", "AMERICAN", "United States", "Y"],
            ["2", "American Airlines v2", "\\N", "AA", "AAL", "AMERICAN", "United States", "Y"],
        ]

        count = openflights.refresh_airlines()

        self.assertEqual(count, 1)

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_airlines_handles_inactive(self, mock_fetch):
        """Test that inactive airlines are marked correctly."""
        mock_fetch.return_value = [
            ["1", "Active Airline", "\\N", "AA", "AAL", "ACTIVE", "United States", "Y"],
            ["2", "Inactive Airline", "\\N", "BB", "BBL", "INACTIVE", "United States", "N"],
        ]

        count = openflights.refresh_airlines()

        self.assertEqual(count, 2)
        active = CachedAirline.objects.get(icao_code="AAL")
        inactive = CachedAirline.objects.get(icao_code="BBL")
        self.assertTrue(active.active)
        self.assertFalse(inactive.active)

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_airlines_returns_zero_on_failure(self, mock_fetch):
        """Test that fetch failure returns zero."""
        mock_fetch.return_value = None

        count = openflights.refresh_airlines()

        self.assertEqual(count, 0)

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_airlines_handles_short_rows(self, mock_fetch):
        """Test that short rows are skipped."""
        mock_fetch.return_value = [
            ["1", "American Airlines", "\\N", "AA", "AAL", "AMERICAN", "United States", "Y"],
            ["2", "Short Row"],  # Too short
        ]

        count = openflights.refresh_airlines()

        self.assertEqual(count, 1)


class RefreshAircraftTypesTests(TestCase):
    """Tests for aircraft type data refresh."""

    def setUp(self):
        """Clean up aircraft types before each test."""
        CachedAircraftType.objects.all().delete()

    def tearDown(self):
        """Clean up aircraft types after each test."""
        CachedAircraftType.objects.all().delete()

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_aircraft_types_success(self, mock_fetch):
        """Test successful aircraft type refresh."""
        # OpenFlights format: Name, IATA, ICAO
        mock_fetch.return_value = [
            ["Boeing 737-800", "738", "B738"],
            ["Airbus A320", "320", "A320"],
        ]

        count = openflights.refresh_aircraft_types()

        self.assertEqual(count, 2)
        self.assertEqual(CachedAircraftType.objects.count(), 2)

        b738 = CachedAircraftType.objects.get(icao_code="B738")
        self.assertEqual(b738.name, "Boeing 737-800")
        self.assertEqual(b738.iata_code, "738")
        self.assertEqual(b738.manufacturer, "Boeing")

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_aircraft_types_extracts_manufacturer(self, mock_fetch):
        """Test that manufacturer is extracted from name."""
        mock_fetch.return_value = [
            ["Boeing 737-800", "738", "B738"],
            ["Airbus A320", "320", "A320"],
            ["Embraer E175", "E75", "E175"],
            ["Unknown Aircraft", "UNK", "UNKN"],
        ]

        count = openflights.refresh_aircraft_types()

        self.assertEqual(count, 4)

        b738 = CachedAircraftType.objects.get(icao_code="B738")
        self.assertEqual(b738.manufacturer, "Boeing")

        a320 = CachedAircraftType.objects.get(icao_code="A320")
        self.assertEqual(a320.manufacturer, "Airbus")

        e175 = CachedAircraftType.objects.get(icao_code="E175")
        self.assertEqual(e175.manufacturer, "Embraer")

        unkn = CachedAircraftType.objects.get(icao_code="UNKN")
        self.assertIsNone(unkn.manufacturer)

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_aircraft_types_skips_no_icao(self, mock_fetch):
        """Test that types without ICAO are skipped."""
        mock_fetch.return_value = [
            ["Boeing 737-800", "738", "B738"],
            ["No ICAO", "XXX", "\\N"],
            ["Empty ICAO", "YYY", ""],
        ]

        count = openflights.refresh_aircraft_types()

        self.assertEqual(count, 1)

    @patch("skyspy.services.openflights._fetch_csv_data")
    def test_refresh_aircraft_types_deduplicates(self, mock_fetch):
        """Test that duplicate ICAOs are deduplicated."""
        mock_fetch.return_value = [
            ["Boeing 737-800 v1", "738", "B738"],
            ["Boeing 737-800 v2", "738", "B738"],
        ]

        count = openflights.refresh_aircraft_types()

        self.assertEqual(count, 1)


class RefreshAllOpenflightsDataTests(TestCase):
    """Tests for refreshing all OpenFlights data."""

    def setUp(self):
        """Clean up data before each test."""
        CachedAirline.objects.all().delete()
        CachedAircraftType.objects.all().delete()

    def tearDown(self):
        """Clean up data after each test."""
        CachedAirline.objects.all().delete()
        CachedAircraftType.objects.all().delete()

    @patch("skyspy.services.openflights.refresh_aircraft_types")
    @patch("skyspy.services.openflights.refresh_airlines")
    def test_refresh_all_calls_both_functions(self, mock_airlines, mock_types):
        """Test that refresh_all calls both refresh functions."""
        mock_airlines.return_value = 100
        mock_types.return_value = 50

        result = openflights.refresh_all_openflights_data()

        mock_airlines.assert_called_once()
        mock_types.assert_called_once()
        self.assertEqual(result["airlines"], 100)
        self.assertEqual(result["aircraft_types"], 50)


class GetAirlineByIcaoTests(TestCase):
    """Tests for airline lookup by ICAO code."""

    def setUp(self):
        """Set up test airlines."""
        CachedAirline.objects.all().delete()
        CachedAirline.objects.create(
            icao_code="AAL",
            iata_code="AA",
            name="American Airlines",
            callsign="AMERICAN",
            country="United States",
            active=True,
        )

    def tearDown(self):
        """Clean up test airlines."""
        CachedAirline.objects.all().delete()

    def test_returns_airline_by_icao(self):
        """Test getting airline by ICAO code."""
        result = openflights.get_airline_by_icao("AAL")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_code"], "AAL")
        self.assertEqual(result["name"], "American Airlines")
        self.assertEqual(result["callsign"], "AMERICAN")

    def test_case_insensitive_lookup(self):
        """Test that lookup is case insensitive."""
        result = openflights.get_airline_by_icao("aal")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_code"], "AAL")

    def test_returns_none_for_nonexistent(self):
        """Test that None is returned for nonexistent airline."""
        result = openflights.get_airline_by_icao("XXX")

        self.assertIsNone(result)


class GetAirlineByCallsignTests(TestCase):
    """Tests for airline lookup by callsign."""

    def setUp(self):
        """Set up test airlines."""
        CachedAirline.objects.all().delete()
        CachedAirline.objects.create(
            icao_code="AAL",
            iata_code="AA",
            name="American Airlines",
            callsign="AMERICAN",
            country="United States",
            active=True,
        )

    def tearDown(self):
        """Clean up test airlines."""
        CachedAirline.objects.all().delete()

    def test_returns_airline_by_callsign(self):
        """Test getting airline by callsign."""
        result = openflights.get_airline_by_callsign("AMERICAN")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_code"], "AAL")
        self.assertEqual(result["callsign"], "AMERICAN")

    def test_case_insensitive_lookup(self):
        """Test that lookup is case insensitive."""
        result = openflights.get_airline_by_callsign("american")

        self.assertIsNotNone(result)

    def test_returns_none_for_nonexistent(self):
        """Test that None is returned for nonexistent callsign."""
        result = openflights.get_airline_by_callsign("UNKNOWN")

        self.assertIsNone(result)


class GetAirlineFromFlightCallsignTests(TestCase):
    """Tests for extracting airline from flight callsign."""

    def setUp(self):
        """Set up test airlines."""
        CachedAirline.objects.all().delete()
        CachedAirline.objects.create(
            icao_code="AAL",
            iata_code="AA",
            name="American Airlines",
            callsign="AMERICAN",
            country="United States",
            active=True,
        )
        CachedAirline.objects.create(
            icao_code="UAL",
            iata_code="UA",
            name="United Airlines",
            callsign="UNITED",
            country="United States",
            active=True,
        )

    def tearDown(self):
        """Clean up test airlines."""
        CachedAirline.objects.all().delete()

    def test_extracts_airline_from_icao_prefix(self):
        """Test extracting airline from ICAO prefix."""
        result = openflights.get_airline_from_flight_callsign("AAL123")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_code"], "AAL")

    def test_extracts_airline_from_iata_prefix(self):
        """Test extracting airline from IATA prefix."""
        result = openflights.get_airline_from_flight_callsign("AA123")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_code"], "AAL")

    def test_returns_none_for_short_callsign(self):
        """Test that short callsign returns None."""
        result = openflights.get_airline_from_flight_callsign("AB")
        self.assertIsNone(result)

        result = openflights.get_airline_from_flight_callsign("")
        self.assertIsNone(result)

    def test_returns_none_for_unknown_prefix(self):
        """Test that unknown prefix returns None."""
        result = openflights.get_airline_from_flight_callsign("XXX123")

        self.assertIsNone(result)


class GetAircraftTypeByIcaoTests(TestCase):
    """Tests for aircraft type lookup by ICAO code."""

    def setUp(self):
        """Set up test aircraft types."""
        CachedAircraftType.objects.all().delete()
        CachedAircraftType.objects.create(
            icao_code="B738",
            iata_code="738",
            name="Boeing 737-800",
            manufacturer="Boeing",
        )

    def tearDown(self):
        """Clean up test aircraft types."""
        CachedAircraftType.objects.all().delete()

    def test_returns_type_by_icao(self):
        """Test getting aircraft type by ICAO code."""
        result = openflights.get_aircraft_type_by_icao("B738")

        self.assertIsNotNone(result)
        self.assertEqual(result["icao_code"], "B738")
        self.assertEqual(result["name"], "Boeing 737-800")
        self.assertEqual(result["manufacturer"], "Boeing")

    def test_case_insensitive_lookup(self):
        """Test that lookup is case insensitive."""
        result = openflights.get_aircraft_type_by_icao("b738")

        self.assertIsNotNone(result)

    def test_returns_none_for_nonexistent(self):
        """Test that None is returned for nonexistent type."""
        result = openflights.get_aircraft_type_by_icao("XXXX")

        self.assertIsNone(result)


class SearchAirlinesTests(TestCase):
    """Tests for airline search functionality."""

    def setUp(self):
        """Set up test airlines."""
        CachedAirline.objects.all().delete()
        CachedAirline.objects.create(
            icao_code="AAL",
            iata_code="AA",
            name="American Airlines",
            callsign="AMERICAN",
            country="United States",
            active=True,
        )
        CachedAirline.objects.create(
            icao_code="UAL",
            iata_code="UA",
            name="United Airlines",
            callsign="UNITED",
            country="United States",
            active=True,
        )
        CachedAirline.objects.create(
            icao_code="DAL",
            iata_code="DL",
            name="Delta Air Lines",
            callsign="DELTA",
            country="United States",
            active=True,
        )

    def tearDown(self):
        """Clean up test airlines."""
        CachedAirline.objects.all().delete()

    def test_search_by_name(self):
        """Test searching airlines by name."""
        result = openflights.search_airlines("American")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "American Airlines")

    def test_search_by_icao(self):
        """Test searching airlines by ICAO code."""
        result = openflights.search_airlines("AAL")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["icao_code"], "AAL")

    def test_search_by_iata(self):
        """Test searching airlines by IATA code."""
        result = openflights.search_airlines("AA")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["iata_code"], "AA")

    def test_search_by_callsign(self):
        """Test searching airlines by callsign."""
        result = openflights.search_airlines("AMERICAN")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["callsign"], "AMERICAN")

    def test_search_partial_match(self):
        """Test that partial matches work."""
        result = openflights.search_airlines("Air")

        # Should match "American Airlines", "United Airlines", and "Delta Air Lines"
        self.assertEqual(len(result), 3)

    def test_search_respects_limit(self):
        """Test that limit is respected."""
        result = openflights.search_airlines("United", limit=1)

        self.assertEqual(len(result), 1)


class SearchAircraftTypesTests(TestCase):
    """Tests for aircraft type search functionality."""

    def setUp(self):
        """Set up test aircraft types."""
        CachedAircraftType.objects.all().delete()
        CachedAircraftType.objects.create(
            icao_code="B738",
            iata_code="738",
            name="Boeing 737-800",
            manufacturer="Boeing",
        )
        CachedAircraftType.objects.create(
            icao_code="A320",
            iata_code="320",
            name="Airbus A320",
            manufacturer="Airbus",
        )
        CachedAircraftType.objects.create(
            icao_code="B77W",
            iata_code="77W",
            name="Boeing 777-300ER",
            manufacturer="Boeing",
        )

    def tearDown(self):
        """Clean up test aircraft types."""
        CachedAircraftType.objects.all().delete()

    def test_search_by_name(self):
        """Test searching types by name."""
        result = openflights.search_aircraft_types("737-800")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["icao_code"], "B738")

    def test_search_by_icao(self):
        """Test searching types by ICAO code."""
        result = openflights.search_aircraft_types("B738")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["icao_code"], "B738")

    def test_search_by_iata(self):
        """Test searching types by IATA code."""
        result = openflights.search_aircraft_types("738")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["iata_code"], "738")

    def test_search_by_manufacturer(self):
        """Test searching types by manufacturer."""
        result = openflights.search_aircraft_types("Boeing")

        self.assertEqual(len(result), 2)

    def test_search_respects_limit(self):
        """Test that limit is respected."""
        result = openflights.search_aircraft_types("Boeing", limit=1)

        self.assertEqual(len(result), 1)


class GetCacheStatsTests(TestCase):
    """Tests for cache statistics."""

    def setUp(self):
        """Clean up data before each test."""
        CachedAirline.objects.all().delete()
        CachedAircraftType.objects.all().delete()

    def tearDown(self):
        """Clean up data after each test."""
        CachedAirline.objects.all().delete()
        CachedAircraftType.objects.all().delete()

    def test_returns_stats_with_empty_cache(self):
        """Test stats with empty cache."""
        stats = openflights.get_cache_stats()

        self.assertEqual(stats["airlines"]["count"], 0)
        self.assertEqual(stats["aircraft_types"]["count"], 0)
        self.assertIsNone(stats["airlines"]["last_refresh"])
        self.assertIsNone(stats["aircraft_types"]["last_refresh"])

    def test_returns_stats_with_data(self):
        """Test stats with data present."""
        CachedAirline.objects.create(
            icao_code="AAL",
            name="American Airlines",
        )
        CachedAircraftType.objects.create(
            icao_code="B738",
            name="Boeing 737-800",
        )

        stats = openflights.get_cache_stats()

        self.assertEqual(stats["airlines"]["count"], 1)
        self.assertEqual(stats["aircraft_types"]["count"], 1)
        self.assertIsNotNone(stats["airlines"]["last_refresh"])
        self.assertIsNotNone(stats["aircraft_types"]["last_refresh"])


class ShouldRefreshTests(TestCase):
    """Tests for refresh decision logic."""

    def setUp(self):
        """Clean up data before each test."""
        CachedAirline.objects.all().delete()
        CachedAircraftType.objects.all().delete()

    def tearDown(self):
        """Clean up data after each test."""
        CachedAirline.objects.all().delete()
        CachedAircraftType.objects.all().delete()

    def test_should_refresh_when_empty(self):
        """Test that refresh is needed when cache is empty."""
        result = openflights.should_refresh()

        self.assertTrue(result)

    def test_should_refresh_with_recent_data(self):
        """Test that refresh is not needed with recent data."""
        CachedAirline.objects.create(icao_code="AAL", name="American Airlines")
        CachedAircraftType.objects.create(icao_code="B738", name="Boeing 737-800")

        result = openflights.should_refresh()

        self.assertFalse(result)

    def test_should_refresh_when_only_airlines_exist(self):
        """Test that refresh is needed when only airlines exist."""
        CachedAirline.objects.create(icao_code="AAL", name="American Airlines")

        result = openflights.should_refresh()

        self.assertTrue(result)

    def test_should_refresh_when_only_types_exist(self):
        """Test that refresh is needed when only types exist."""
        CachedAircraftType.objects.create(icao_code="B738", name="Boeing 737-800")

        result = openflights.should_refresh()

        self.assertTrue(result)
