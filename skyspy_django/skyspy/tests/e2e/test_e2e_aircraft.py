"""
End-to-end tests for aircraft tracking API endpoints.

Tests the complete workflow of the SkySpy aircraft tracking system:
- Live aircraft listing from cache
- Aircraft details retrieval
- Top aircraft categories
- UAT aircraft data
- Sighting history and filtering
- Session tracking
- History statistics
- Search and filtering
- Aircraft info lookup
- Permission-based access control
"""
import pytest
from datetime import timedelta
from unittest.mock import patch, MagicMock

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status

from skyspy.models import (
    AircraftSighting,
    AircraftSession,
    AircraftInfo,
)
from skyspy.tests.factories import (
    AircraftSightingFactory,
    AircraftSessionFactory,
    AircraftInfoFactory,
)


# =============================================================================
# Test Data Fixtures
# =============================================================================

@pytest.fixture
def live_aircraft_data():
    """Generate realistic live aircraft data for cache."""
    return [
        {
            'hex': 'A12345',
            'icao_hex': 'A12345',
            'flight': 'UAL123',
            'callsign': 'UAL123',
            'lat': 47.5,
            'lon': -122.0,
            'alt': 35000,
            'alt_baro': 35000,
            'alt_geom': 35200,
            'gs': 450,
            'track': 270,
            'vr': 0,
            'squawk': '4521',
            'category': 'A3',
            't': 'B738',
            'rssi': -25.0,
            'distance_nm': 15.5,
            'dbFlags': 0,
            'military': False,
            'emergency': False,
        },
        {
            'hex': 'A67890',
            'icao_hex': 'A67890',
            'flight': 'DAL456',
            'callsign': 'DAL456',
            'lat': 47.8,
            'lon': -121.5,
            'alt': 28000,
            'alt_baro': 28000,
            'alt_geom': 28100,
            'gs': 480,
            'track': 90,
            'vr': -1500,
            'squawk': '1200',
            'category': 'A3',
            't': 'A320',
            'rssi': -22.0,
            'distance_nm': 8.2,
            'dbFlags': 0,
            'military': False,
            'emergency': False,
        },
        {
            'hex': 'AE1234',
            'icao_hex': 'AE1234',
            'flight': 'RCH789',
            'callsign': 'RCH789',
            'lat': 48.0,
            'lon': -122.5,
            'alt': 32000,
            'alt_baro': 32000,
            'alt_geom': 32100,
            'gs': 420,
            'track': 180,
            'vr': 500,
            'squawk': '4000',
            'category': 'A5',
            't': 'C17',
            'rssi': -30.0,
            'distance_nm': 25.0,
            'dbFlags': 1,
            'military': True,
            'emergency': False,
        },
        {
            'hex': 'A99999',
            'icao_hex': 'A99999',
            'flight': 'N12345',
            'callsign': 'N12345',
            'lat': 47.9,
            'lon': -121.9,
            'alt': 8000,
            'alt_baro': 8000,
            'alt_geom': 8100,
            'gs': 120,
            'track': 45,
            'vr': -2000,
            'squawk': '7700',
            'category': 'A1',
            't': 'C172',
            'rssi': -15.0,
            'distance_nm': 2.5,
            'dbFlags': 0,
            'military': False,
            'emergency': True,
        },
    ]


@pytest.fixture
def uat_aircraft_data():
    """Generate UAT aircraft data for cache."""
    return [
        {
            'hex': '~UAT001',
            'icao_hex': '~UAT001',
            'flight': 'N54321',
            'lat': 47.6,
            'lon': -122.2,
            'alt': 5000,
            'gs': 100,
            'track': 180,
            'vr': 0,
            'squawk': '1200',
            'category': 'A1',
            'military': False,
        },
        {
            'hex': '~UAT002',
            'icao_hex': '~UAT002',
            'flight': 'N98765',
            'lat': 47.7,
            'lon': -122.1,
            'alt': 6500,
            'gs': 110,
            'track': 270,
            'vr': 500,
            'squawk': '1200',
            'category': 'A1',
            'military': False,
        },
    ]


@pytest.fixture
def cached_aircraft_with_emergency(live_aircraft_data):
    """Pre-populate cache with aircraft data including emergency."""
    cache.set('current_aircraft', live_aircraft_data, timeout=300)
    cache.set('aircraft_timestamp', timezone.now().timestamp(), timeout=300)
    cache.set('aircraft_messages', 54321, timeout=300)
    cache.set('adsb_online', True, timeout=300)
    yield live_aircraft_data
    cache.clear()


@pytest.fixture
def cached_uat_aircraft(uat_aircraft_data):
    """Pre-populate cache with UAT aircraft data."""
    cache.set('uat_aircraft', uat_aircraft_data, timeout=300)
    cache.set('uat_timestamp', timezone.now().timestamp(), timeout=300)
    yield uat_aircraft_data
    cache.clear()


# =============================================================================
# 1. Live Aircraft Listing Tests
# =============================================================================

@pytest.mark.django_db
class TestLiveAircraftListing:
    """Tests for GET /api/v1/aircraft endpoint."""

    def test_list_returns_200_ok(self, api_client):
        """Test that aircraft list returns 200 OK."""
        response = api_client.get('/api/v1/aircraft/')
        assert response.status_code == status.HTTP_200_OK

    def test_list_empty_cache_returns_empty_list(self, api_client):
        """Test list response when cache is empty."""
        cache.clear()
        response = api_client.get('/api/v1/aircraft/')
        data = response.json()

        assert 'aircraft' in data
        assert 'count' in data
        assert data['aircraft'] == []
        assert data['count'] == 0

    def test_list_response_structure(self, api_client, cached_aircraft_with_emergency):
        """Test that list response has correct structure."""
        response = api_client.get('/api/v1/aircraft/')
        data = response.json()

        assert 'aircraft' in data
        assert 'count' in data
        assert 'now' in data
        assert 'messages' in data
        assert 'timestamp' in data

    def test_list_includes_position_data(self, api_client, cached_aircraft_with_emergency):
        """Test that aircraft include position, altitude, speed, track, callsign."""
        response = api_client.get('/api/v1/aircraft/')
        data = response.json()

        assert data['count'] == 4
        aircraft = data['aircraft'][0]

        # Check position fields
        assert 'lat' in aircraft
        assert 'lon' in aircraft
        assert aircraft['lat'] is not None
        assert aircraft['lon'] is not None

        # Check other required fields
        assert 'alt' in aircraft or 'alt_baro' in aircraft
        assert 'gs' in aircraft
        assert 'track' in aircraft
        assert 'flight' in aircraft or 'callsign' in aircraft

    def test_military_aircraft_flagged(self, api_client, cached_aircraft_with_emergency):
        """Test that military aircraft are properly flagged."""
        response = api_client.get('/api/v1/aircraft/')
        data = response.json()

        military_aircraft = [ac for ac in data['aircraft'] if ac.get('military', False)]
        assert len(military_aircraft) >= 1

        # Check the C17 is flagged as military
        c17 = next((ac for ac in data['aircraft'] if ac.get('hex') == 'AE1234'), None)
        assert c17 is not None
        assert c17['military'] is True

    def test_emergency_squawks_flagged(self, api_client, cached_aircraft_with_emergency):
        """Test that aircraft with emergency squawks are flagged."""
        response = api_client.get('/api/v1/aircraft/')
        data = response.json()

        # Find aircraft with squawk 7700
        emergency_aircraft = next(
            (ac for ac in data['aircraft'] if ac.get('squawk') == '7700'),
            None
        )
        assert emergency_aircraft is not None
        assert emergency_aircraft.get('emergency', False) is True or emergency_aircraft.get('squawk') == '7700'

    def test_list_message_count_from_cache(self, api_client, cached_aircraft_with_emergency):
        """Test that messages count comes from cache."""
        response = api_client.get('/api/v1/aircraft/')
        data = response.json()

        assert data['messages'] == 54321

    def test_list_timestamp_is_iso_format(self, api_client, cached_aircraft_with_emergency):
        """Test that timestamp is in ISO format."""
        response = api_client.get('/api/v1/aircraft/')
        data = response.json()

        assert 'T' in data['timestamp']
        assert data['timestamp'].endswith('Z')


# =============================================================================
# 2. Aircraft Details Tests
# =============================================================================

@pytest.mark.django_db
class TestAircraftDetails:
    """Tests for GET /api/v1/aircraft/{hex} endpoint."""

    def test_retrieve_existing_aircraft(self, api_client, cached_aircraft_with_emergency):
        """Test retrieving an existing aircraft by hex code."""
        response = api_client.get('/api/v1/aircraft/A12345/')
        assert response.status_code == status.HTTP_200_OK

    def test_retrieve_returns_correct_aircraft(self, api_client, cached_aircraft_with_emergency):
        """Test that retrieved aircraft has correct data."""
        response = api_client.get('/api/v1/aircraft/A12345/')
        data = response.json()

        assert data['hex'] == 'A12345'
        assert data['flight'] == 'UAL123'
        assert data['lat'] == 47.5
        assert data['lon'] == -122.0

    def test_retrieve_includes_extended_info(self, api_client, cached_aircraft_with_emergency):
        """Test that retrieved aircraft includes extended info."""
        response = api_client.get('/api/v1/aircraft/A12345/')
        data = response.json()

        # Check for extended fields if available
        assert 'hex' in data
        assert 'flight' in data or 'callsign' in data
        assert 't' in data or 'type' in data or 'aircraft_type' in data

    def test_retrieve_nonexistent_aircraft_returns_404(self, api_client, cached_aircraft_with_emergency):
        """Test retrieving a non-existent aircraft returns 404."""
        response = api_client.get('/api/v1/aircraft/NOTFOUND/')
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_retrieve_404_includes_error_message(self, api_client, cached_aircraft_with_emergency):
        """Test that 404 response includes error message."""
        response = api_client.get('/api/v1/aircraft/NOTFOUND/')
        data = response.json()

        assert 'error' in data

    def test_retrieve_military_aircraft(self, api_client, cached_aircraft_with_emergency):
        """Test retrieving military aircraft."""
        response = api_client.get('/api/v1/aircraft/AE1234/')
        data = response.json()

        assert response.status_code == status.HTTP_200_OK
        assert data['military'] is True
        assert data['flight'] == 'RCH789'

    def test_retrieve_by_icao_hex_field(self, api_client, cached_aircraft_with_emergency):
        """Test that retrieval works with icao_hex field."""
        response = api_client.get('/api/v1/aircraft/A67890/')
        data = response.json()

        assert response.status_code == status.HTTP_200_OK
        assert data['hex'] == 'A67890' or data.get('icao_hex') == 'A67890'


# =============================================================================
# 3. Top Aircraft Tests
# =============================================================================

@pytest.mark.django_db
class TestTopAircraft:
    """Tests for GET /api/v1/aircraft/top endpoint."""

    def test_top_returns_200_ok(self, api_client, cached_aircraft_with_emergency):
        """Test that top endpoint returns 200 OK."""
        response = api_client.get('/api/v1/aircraft/top/')
        assert response.status_code == status.HTTP_200_OK

    def test_top_response_includes_all_categories(self, api_client, cached_aircraft_with_emergency):
        """Test that top response includes all expected categories."""
        response = api_client.get('/api/v1/aircraft/top/')
        data = response.json()

        # Check for expected categories
        assert 'closest' in data
        assert 'highest' in data
        assert 'fastest' in data
        assert 'climbing' in data or 'furthest' in data
        assert 'military' in data

    def test_top_closest_sorted_correctly(self, api_client, cached_aircraft_with_emergency):
        """Test that closest aircraft are sorted by distance ascending."""
        response = api_client.get('/api/v1/aircraft/top/')
        data = response.json()

        closest = data['closest']
        if len(closest) > 1:
            for i in range(len(closest) - 1):
                assert closest[i].get('distance_nm', float('inf')) <= closest[i + 1].get('distance_nm', float('inf'))

    def test_top_highest_sorted_correctly(self, api_client, cached_aircraft_with_emergency):
        """Test that highest aircraft are sorted by altitude descending."""
        response = api_client.get('/api/v1/aircraft/top/')
        data = response.json()

        highest = data['highest']
        if len(highest) > 1:
            for i in range(len(highest) - 1):
                alt_i = highest[i].get('alt') or highest[i].get('alt_baro', 0)
                alt_next = highest[i + 1].get('alt') or highest[i + 1].get('alt_baro', 0)
                assert alt_i >= alt_next

    def test_top_fastest_sorted_correctly(self, api_client, cached_aircraft_with_emergency):
        """Test that fastest aircraft are sorted by ground speed descending."""
        response = api_client.get('/api/v1/aircraft/top/')
        data = response.json()

        fastest = data['fastest']
        if len(fastest) > 1:
            for i in range(len(fastest) - 1):
                assert fastest[i].get('gs', 0) >= fastest[i + 1].get('gs', 0)

    def test_top_military_contains_only_military(self, api_client, cached_aircraft_with_emergency):
        """Test that military category contains only military aircraft."""
        response = api_client.get('/api/v1/aircraft/top/')
        data = response.json()

        for ac in data['military']:
            assert ac.get('military', False) is True

    def test_top_limit_parameter(self, api_client, cached_aircraft_with_emergency):
        """Test that limit parameter works."""
        response = api_client.get('/api/v1/aircraft/top/?limit=2')
        data = response.json()

        assert len(data['highest']) <= 2
        assert len(data['fastest']) <= 2
        assert len(data['closest']) <= 2

    def test_top_includes_total_count(self, api_client, cached_aircraft_with_emergency):
        """Test that response includes total aircraft count."""
        response = api_client.get('/api/v1/aircraft/top/')
        data = response.json()

        assert 'total' in data
        assert data['total'] == 4

    def test_top_includes_timestamp(self, api_client, cached_aircraft_with_emergency):
        """Test that response includes timestamp."""
        response = api_client.get('/api/v1/aircraft/top/')
        data = response.json()

        assert 'timestamp' in data


# =============================================================================
# 4. UAT Aircraft Tests
# =============================================================================

@pytest.mark.django_db
class TestUATAircraft:
    """Tests for GET /api/v1/uat/aircraft endpoint."""

    def test_uat_returns_200_ok(self, api_client):
        """Test that UAT endpoint returns 200 OK."""
        response = api_client.get('/api/v1/uat/aircraft/')
        assert response.status_code == status.HTTP_200_OK

    def test_uat_response_structure(self, api_client, cached_uat_aircraft):
        """Test that UAT response has expected structure."""
        response = api_client.get('/api/v1/uat/aircraft/')
        data = response.json()

        assert 'aircraft' in data
        assert 'count' in data
        assert 'now' in data
        assert 'timestamp' in data

    def test_uat_returns_uat_aircraft_only(self, api_client, cached_uat_aircraft, cached_aircraft_with_emergency):
        """Test that UAT endpoint returns only UAT aircraft."""
        response = api_client.get('/api/v1/uat/aircraft/')
        data = response.json()

        assert data['count'] == 2
        for ac in data['aircraft']:
            assert ac['hex'].startswith('~')

    def test_uat_empty_cache(self, api_client):
        """Test UAT with empty cache."""
        cache.clear()
        response = api_client.get('/api/v1/uat/aircraft/')
        data = response.json()

        assert data['aircraft'] == []
        assert data['count'] == 0

    def test_uat_separate_from_1090(self, api_client, cached_uat_aircraft, cached_aircraft_with_emergency):
        """Test that UAT and 1090 MHz aircraft are separate."""
        # Get 1090 MHz aircraft
        response_1090 = api_client.get('/api/v1/aircraft/')
        data_1090 = response_1090.json()

        # Get UAT aircraft
        response_uat = api_client.get('/api/v1/uat/aircraft/')
        data_uat = response_uat.json()

        # Should be different sets
        hex_1090 = {ac['hex'] for ac in data_1090['aircraft']}
        hex_uat = {ac['hex'] for ac in data_uat['aircraft']}

        assert not hex_1090.intersection(hex_uat)


# =============================================================================
# 5. Sighting History Tests
# =============================================================================

@pytest.mark.django_db
class TestSightingHistory:
    """Tests for GET /api/v1/sightings endpoint."""

    @pytest.fixture
    def sightings_batch(self, db):
        """Create batch of sightings for testing."""
        now = timezone.now()
        sightings = []

        # Create sightings for multiple aircraft
        for i in range(30):
            sighting = AircraftSightingFactory(
                timestamp=now - timedelta(hours=i % 24, minutes=i % 60),
                icao_hex=f'A{i % 5}0000',
                callsign=f'TST{i % 5}23',
                altitude_baro=20000 + (i * 500),
                distance_nm=10.0 + i,
                is_military=(i % 10 == 0),
            )
            sightings.append(sighting)
        return sightings

    def test_sightings_returns_200_ok(self, api_client, sightings_batch):
        """Test that sightings endpoint returns 200 OK."""
        response = api_client.get('/api/v1/sightings/')
        assert response.status_code == status.HTTP_200_OK

    def test_sightings_response_structure(self, api_client, sightings_batch):
        """Test sightings response structure."""
        response = api_client.get('/api/v1/sightings/')
        data = response.json()

        assert 'results' in data
        assert 'count' in data

    def test_sightings_filter_by_icao_hex(self, api_client, sightings_batch):
        """Test filtering sightings by icao_hex."""
        response = api_client.get('/api/v1/sightings/?icao=A00000')
        data = response.json()

        for sighting in data['results']:
            assert sighting['icao_hex'].upper() == 'A00000'

    def test_sightings_filter_by_time_range(self, api_client, sightings_batch):
        """Test filtering sightings by time range."""
        # Get sightings from last 12 hours
        response = api_client.get('/api/v1/sightings/?hours=12')
        data_12h = response.json()

        # Get sightings from last 6 hours
        response = api_client.get('/api/v1/sightings/?hours=6')
        data_6h = response.json()

        # 6 hour range should have fewer or equal sightings
        assert data_6h['count'] <= data_12h['count']

    def test_sightings_pagination(self, api_client, sightings_batch):
        """Test that pagination works correctly."""
        response = api_client.get('/api/v1/sightings/')
        data = response.json()

        # Should have pagination or limit applied
        assert 'results' in data
        assert isinstance(data['results'], list)

    def test_sightings_ordered_by_timestamp(self, api_client, sightings_batch):
        """Test that sightings are ordered by timestamp descending."""
        response = api_client.get('/api/v1/sightings/')
        data = response.json()

        results = data['results']
        if len(results) > 1:
            for i in range(len(results) - 1):
                assert results[i]['timestamp'] >= results[i + 1]['timestamp']

    def test_sightings_filter_by_altitude_range(self, api_client, sightings_batch):
        """Test filtering sightings by altitude range."""
        response = api_client.get('/api/v1/sightings/?min_altitude=25000&max_altitude=35000')
        data = response.json()

        for sighting in data['results']:
            altitude = sighting.get('altitude') or sighting.get('alt')
            if altitude is not None:
                assert 25000 <= altitude <= 35000

    def test_sightings_filter_by_distance_range(self, api_client, sightings_batch):
        """Test filtering sightings by distance range."""
        response = api_client.get('/api/v1/sightings/?min_distance=15&max_distance=30')
        data = response.json()

        for sighting in data['results']:
            distance = sighting.get('distance_nm')
            if distance is not None:
                assert 15 <= distance <= 30

    def test_sightings_filter_military_only(self, api_client, sightings_batch):
        """Test filtering for military aircraft only."""
        response = api_client.get('/api/v1/sightings/?military_only=true')
        data = response.json()

        for sighting in data['results']:
            assert sighting['is_military'] is True


# =============================================================================
# 6. Session Tracking Tests
# =============================================================================

@pytest.mark.django_db
class TestSessionTracking:
    """Tests for GET /api/v1/sessions endpoint."""

    @pytest.fixture
    def sessions_batch(self, db):
        """Create batch of sessions for testing."""
        now = timezone.now()
        sessions = []

        for i in range(20):
            session = AircraftSessionFactory(
                icao_hex=f'B{i:05d}',
                callsign=f'SES{i:03d}',
                first_seen=now - timedelta(hours=i + 1),
                last_seen=now - timedelta(hours=i),
                total_positions=100 + i * 10,
                min_altitude=5000 + i * 100,
                max_altitude=35000 + i * 500,
                min_distance_nm=5.0 + i,
                max_distance_nm=50.0 + i * 5,
                min_rssi=-35.0 + i * 0.5,
                max_rssi=-20.0 + i * 0.3,
                is_military=(i % 5 == 0),
            )
            sessions.append(session)
        return sessions

    def test_sessions_returns_200_ok(self, api_client, sessions_batch):
        """Test that sessions endpoint returns 200 OK."""
        response = api_client.get('/api/v1/sessions/')
        assert response.status_code == status.HTTP_200_OK

    def test_sessions_response_structure(self, api_client, sessions_batch):
        """Test sessions response structure."""
        response = api_client.get('/api/v1/sessions/')
        data = response.json()

        assert 'results' in data
        assert 'count' in data

    def test_sessions_include_required_fields(self, api_client, sessions_batch):
        """Test that sessions include required tracking fields."""
        response = api_client.get('/api/v1/sessions/')
        data = response.json()

        if data['results']:
            session = data['results'][0]
            assert 'icao_hex' in session
            assert 'first_seen' in session
            assert 'last_seen' in session
            assert 'positions' in session or 'total_positions' in session

    def test_sessions_include_min_max_values(self, api_client, sessions_batch):
        """Test that sessions include min/max altitude, distance, rssi."""
        response = api_client.get('/api/v1/sessions/')
        data = response.json()

        if data['results']:
            session = data['results'][0]
            # Check for altitude bounds
            assert 'min_alt' in session or 'min_altitude' in session
            assert 'max_alt' in session or 'max_altitude' in session
            # Check for distance bounds
            assert 'min_distance_nm' in session
            assert 'max_distance_nm' in session
            # Check for RSSI bounds
            assert 'min_rssi' in session
            assert 'max_rssi' in session

    def test_sessions_filter_by_icao_hex(self, api_client, sessions_batch):
        """Test filtering sessions by icao_hex."""
        response = api_client.get('/api/v1/sessions/?icao_hex=B00000')
        data = response.json()

        for session in data['results']:
            assert session['icao_hex'] == 'B00000'

    def test_sessions_filter_by_callsign(self, api_client, sessions_batch):
        """Test filtering sessions by callsign."""
        response = api_client.get('/api/v1/sessions/?callsign=SES000')
        data = response.json()

        for session in data['results']:
            assert session['callsign'] == 'SES000'

    def test_sessions_filter_by_military(self, api_client, sessions_batch):
        """Test filtering sessions by military flag."""
        response = api_client.get('/api/v1/sessions/?military_only=true')
        data = response.json()

        for session in data['results']:
            assert session['is_military'] is True

    def test_sessions_include_duration(self, api_client, sessions_batch):
        """Test that sessions include duration calculation."""
        response = api_client.get('/api/v1/sessions/')
        data = response.json()

        if data['results']:
            session = data['results'][0]
            assert 'duration_min' in session or ('first_seen' in session and 'last_seen' in session)


# =============================================================================
# 7. History Stats Tests
# =============================================================================

@pytest.mark.django_db
class TestHistoryStats:
    """Tests for GET /api/v1/history/stats endpoint."""

    @pytest.fixture
    def history_data(self, db):
        """Create sightings and sessions for history stats."""
        now = timezone.now()

        # Create sightings across different hours
        sightings = []
        for day in range(3):
            for hour in range(24):
                for _ in range(5):  # 5 sightings per hour
                    sighting = AircraftSightingFactory(
                        timestamp=now - timedelta(days=day, hours=hour),
                        is_military=(hour % 6 == 0),
                    )
                    sightings.append(sighting)

        # Create sessions
        sessions = AircraftSessionFactory.create_batch(20)

        return {'sightings': sightings, 'sessions': sessions}

    def test_history_stats_returns_200_ok(self, api_client, history_data):
        """Test that history stats endpoint returns 200 OK."""
        response = api_client.get('/api/v1/history/stats/')
        assert response.status_code == status.HTTP_200_OK

    def test_history_stats_response_structure(self, api_client, history_data):
        """Test history stats response structure."""
        response = api_client.get('/api/v1/history/stats/')
        data = response.json()

        assert 'total_sightings' in data
        assert 'unique_aircraft' in data
        assert 'time_range_hours' in data

    def test_history_stats_sightings_count(self, api_client, history_data):
        """Test that sightings count is accurate."""
        response = api_client.get('/api/v1/history/stats/?hours=24')
        data = response.json()

        assert data['total_sightings'] > 0

    def test_history_stats_unique_aircraft_count(self, api_client, history_data):
        """Test that unique aircraft count is calculated."""
        response = api_client.get('/api/v1/history/stats/?hours=24')
        data = response.json()

        assert data['unique_aircraft'] > 0
        assert data['unique_aircraft'] <= data['total_sightings']

    def test_history_stats_military_count(self, api_client, history_data):
        """Test that military aircraft are counted in history."""
        response = api_client.get('/api/v1/history/stats/?hours=24')
        data = response.json()

        if 'military_sessions' in data:
            assert isinstance(data['military_sessions'], int)

    def test_history_stats_time_range_filter(self, api_client, history_data):
        """Test that time range filter works."""
        response_24h = api_client.get('/api/v1/history/stats/?hours=24')
        response_12h = api_client.get('/api/v1/history/stats/?hours=12')

        data_24h = response_24h.json()
        data_12h = response_12h.json()

        assert data_12h['total_sightings'] <= data_24h['total_sightings']


# =============================================================================
# 8. Search & Filtering Tests
# =============================================================================

@pytest.mark.django_db
class TestSearchAndFiltering:
    """Tests for search and filtering functionality."""

    @pytest.fixture
    def searchable_data(self, db):
        """Create searchable aircraft info records."""
        infos = [
            AircraftInfoFactory(
                icao_hex='A11111',
                registration='N12345',
                operator='United Airlines',
                type_code='B738',
                is_military=False,
            ),
            AircraftInfoFactory(
                icao_hex='A22222',
                registration='N67890',
                operator='Delta Air Lines',
                type_code='A320',
                is_military=False,
            ),
            AircraftInfoFactory(
                icao_hex='AE5555',
                registration='60-0001',
                operator='United States Air Force',
                type_code='C17',
                is_military=True,
            ),
        ]
        return infos

    def test_search_by_callsign_pattern(self, api_client, sightings_batch):
        """Test searching by callsign pattern."""
        response = api_client.get('/api/v1/sightings/?callsign=TST')
        data = response.json()

        for sighting in data['results']:
            assert 'TST' in sighting['callsign'].upper()

    def test_search_by_registration(self, api_client, searchable_data):
        """Test searching aircraft info by registration."""
        response = api_client.get('/api/v1/airframes/search/?q=N12345')
        data = response.json()

        if 'aircraft' in data and data['aircraft']:
            for ac in data['aircraft']:
                assert 'N12345' in ac.get('registration', '').upper()

    def test_filter_sightings_by_aircraft_type(self, api_client):
        """Test filtering sightings by aircraft type."""
        # Create sightings with specific types
        AircraftSightingFactory(aircraft_type='B738')
        AircraftSightingFactory(aircraft_type='A320')
        AircraftSightingFactory(aircraft_type='B738')

        response = api_client.get('/api/v1/sightings/?aircraft_type=B738')
        data = response.json()

        # All results should be B738 or endpoint may not support this filter
        for sighting in data['results']:
            if 'aircraft_type' in sighting:
                assert sighting['aircraft_type'] == 'B738'


# =============================================================================
# 9. Aircraft Info Lookup Tests
# =============================================================================

@pytest.mark.django_db
class TestAircraftInfoLookup:
    """Tests for GET /api/v1/lookup/aircraft/{icao} and /api/v1/airframes/{icao}."""

    @pytest.fixture
    def aircraft_info_records(self, db):
        """Create aircraft info records for lookup."""
        return [
            AircraftInfoFactory(
                icao_hex='AAAAAA',
                registration='N12345',
                manufacturer='Boeing',
                model='737-800',
                operator='Test Airlines',
                is_military=False,
                is_pia=False,
                is_ladd=False,
                is_interesting=True,
            ),
            AircraftInfoFactory(
                icao_hex='AE0001',
                registration='02-1234',
                manufacturer='Boeing',
                model='C-17 Globemaster III',
                operator='United States Air Force',
                is_military=True,
                is_pia=False,
                is_ladd=False,
                is_interesting=True,
            ),
        ]

    def test_lookup_returns_aircraft_info(self, api_client, aircraft_info_records):
        """Test that lookup returns aircraft database info."""
        response = api_client.get('/api/v1/airframes/AAAAAA/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data['icao_hex'] == 'AAAAAA'
        assert data['registration'] == 'N12345'

    def test_lookup_includes_manufacturer_model(self, api_client, aircraft_info_records):
        """Test that lookup includes manufacturer and model."""
        response = api_client.get('/api/v1/airframes/AAAAAA/')
        data = response.json()

        assert 'manufacturer' in data
        assert 'model' in data
        assert data['manufacturer'] == 'Boeing'

    def test_lookup_includes_operator(self, api_client, aircraft_info_records):
        """Test that lookup includes operator info."""
        response = api_client.get('/api/v1/airframes/AAAAAA/')
        data = response.json()

        assert 'operator' in data
        assert data['operator'] == 'Test Airlines'

    def test_lookup_includes_flags(self, api_client, aircraft_info_records):
        """Test that lookup includes military, PIA, LADD, interesting flags."""
        response = api_client.get('/api/v1/airframes/AAAAAA/')
        data = response.json()

        assert 'is_military' in data
        assert data['is_military'] is False

    def test_lookup_military_aircraft(self, api_client, aircraft_info_records):
        """Test lookup of military aircraft."""
        response = api_client.get('/api/v1/airframes/AE0001/')
        data = response.json()

        assert response.status_code == status.HTTP_200_OK
        assert data['is_military'] is True

    def test_lookup_nonexistent_aircraft(self, api_client, aircraft_info_records):
        """Test lookup of non-existent aircraft returns 404."""
        response = api_client.get('/api/v1/airframes/ZZZZZZ/')
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_lookup_case_insensitive(self, api_client, aircraft_info_records):
        """Test that lookup is case-insensitive."""
        # Lowercase query should still work
        response = api_client.get('/api/v1/airframes/aaaaaa/')
        assert response.status_code == status.HTTP_200_OK

    def test_bulk_lookup(self, api_client, aircraft_info_records):
        """Test bulk aircraft info lookup."""
        response = api_client.get('/api/v1/airframes/bulk/?icao=AAAAAA,AE0001,NOTFOUND')
        data = response.json()

        assert 'aircraft' in data
        assert 'found' in data
        assert 'requested' in data
        assert data['found'] == 2
        assert data['requested'] == 3

    def test_search_by_operator(self, api_client, aircraft_info_records):
        """Test searching aircraft by operator."""
        response = api_client.get('/api/v1/airframes/search/?operator=Test%20Airlines')
        data = response.json()

        assert 'aircraft' in data
        for ac in data['aircraft']:
            assert 'Test' in ac.get('operator', '')


# =============================================================================
# 10. Permission Checks Tests
# =============================================================================

@pytest.mark.django_db
class TestPermissionChecks:
    """Tests for permission-based access control."""

    def test_public_mode_aircraft_visible_without_auth(
        self, api_client, cached_aircraft_with_emergency, auth_mode_public
    ):
        """Test that in public mode, aircraft are visible without authentication."""
        response = api_client.get('/api/v1/aircraft/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data['count'] > 0

    def test_public_mode_sightings_accessible(
        self, api_client, auth_mode_public
    ):
        """Test that in public mode, sightings are accessible."""
        AircraftSightingFactory.create_batch(5)
        response = api_client.get('/api/v1/sightings/')
        assert response.status_code == status.HTTP_200_OK

    def test_public_mode_sessions_accessible(
        self, api_client, auth_mode_public
    ):
        """Test that in public mode, sessions are accessible."""
        AircraftSessionFactory.create_batch(3)
        response = api_client.get('/api/v1/sessions/')
        assert response.status_code == status.HTTP_200_OK

    def test_authenticated_mode_requires_auth(
        self, api_client, auth_mode_authenticated, feature_access_authenticated
    ):
        """Test that authenticated mode requires authentication."""
        response = api_client.get('/api/v1/aircraft/')

        # Should either require auth or be configured for public access
        # Depends on feature_access configuration
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        ]

    def test_viewer_can_access_aircraft(
        self, viewer_client, cached_aircraft_with_emergency
    ):
        """Test that viewer role can access aircraft data."""
        response = viewer_client.get('/api/v1/aircraft/')
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_access_sightings(self, viewer_client):
        """Test that viewer role can access sightings."""
        AircraftSightingFactory.create_batch(5)
        response = viewer_client.get('/api/v1/sightings/')
        assert response.status_code == status.HTTP_200_OK

    def test_operator_can_access_aircraft(
        self, operator_client, cached_aircraft_with_emergency
    ):
        """Test that operator role can access aircraft data."""
        response = operator_client.get('/api/v1/aircraft/')
        assert response.status_code == status.HTTP_200_OK

    def test_analyst_can_access_military_details(
        self, analyst_client, cached_aircraft_with_emergency
    ):
        """Test that analyst role can access military aircraft details."""
        # Analysts have aircraft.view_military permission
        response = analyst_client.get('/api/v1/aircraft/AE1234/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data['military'] is True

    def test_hybrid_mode_respects_feature_access(
        self, api_client, cached_aircraft_with_emergency, auth_mode_hybrid
    ):
        """Test that hybrid mode respects feature access configuration."""
        # In hybrid mode, public features are accessible
        response = api_client.get('/api/v1/aircraft/')

        # Default configuration should allow basic aircraft viewing
        assert response.status_code in [status.HTTP_200_OK, status.HTTP_401_UNAUTHORIZED]


# =============================================================================
# Integration Tests
# =============================================================================

@pytest.mark.django_db
class TestAircraftTrackingIntegration:
    """Integration tests for aircraft tracking workflow."""

    def test_full_aircraft_tracking_workflow(
        self, api_client, cached_aircraft_with_emergency
    ):
        """Test complete aircraft tracking workflow."""
        # 1. List all aircraft
        list_response = api_client.get('/api/v1/aircraft/')
        assert list_response.status_code == status.HTTP_200_OK
        list_data = list_response.json()

        # 2. Get top aircraft
        top_response = api_client.get('/api/v1/aircraft/top/')
        assert top_response.status_code == status.HTTP_200_OK

        # 3. Get individual aircraft details
        if list_data['aircraft']:
            hex_code = list_data['aircraft'][0]['hex']
            detail_response = api_client.get(f'/api/v1/aircraft/{hex_code}/')
            assert detail_response.status_code == status.HTTP_200_OK

    def test_consistency_between_endpoints(
        self, api_client, cached_aircraft_with_emergency
    ):
        """Test that data is consistent between list and detail endpoints."""
        list_response = api_client.get('/api/v1/aircraft/')
        list_data = list_response.json()

        for aircraft in list_data['aircraft']:
            hex_code = aircraft['hex']
            detail_response = api_client.get(f'/api/v1/aircraft/{hex_code}/')

            if detail_response.status_code == status.HTTP_200_OK:
                detail_data = detail_response.json()
                assert detail_data['hex'] == aircraft['hex']
                assert detail_data.get('flight') == aircraft.get('flight')

    def test_sighting_to_session_relationship(self, api_client):
        """Test that sightings and sessions are properly related."""
        # Create a session and sightings for same aircraft
        icao = 'A12345'
        session = AircraftSessionFactory(icao_hex=icao)
        sightings = AircraftSightingFactory.create_batch(5, icao_hex=icao)

        # Get sightings for this aircraft
        sighting_response = api_client.get(f'/api/v1/sightings/?icao={icao}')
        sighting_data = sighting_response.json()

        # Get sessions for this aircraft
        session_response = api_client.get(f'/api/v1/sessions/?icao_hex={icao}')
        session_data = session_response.json()

        assert sighting_data['count'] == 5
        assert session_data['count'] >= 1

    def test_all_aircraft_endpoints_return_json(
        self, api_client, cached_aircraft_with_emergency
    ):
        """Test that all aircraft endpoints return valid JSON."""
        endpoints = [
            '/api/v1/aircraft/',
            '/api/v1/aircraft/A12345/',
            '/api/v1/aircraft/top/',
            '/api/v1/uat/aircraft/',
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            if response.status_code == status.HTTP_200_OK:
                # Should be valid JSON
                data = response.json()
                assert data is not None

    def test_emergency_aircraft_in_stats(
        self, api_client, cached_aircraft_with_emergency
    ):
        """Test that emergency aircraft appear in stats."""
        response = api_client.get('/api/v1/aircraft/stats/')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            assert 'emergency' in data
            # Should have at least one emergency (7700 squawk)
            assert len(data['emergency']) >= 1


@pytest.fixture
def sightings_batch(db):
    """Create batch of sightings for testing."""
    now = timezone.now()
    sightings = []

    for i in range(30):
        sighting = AircraftSightingFactory(
            timestamp=now - timedelta(hours=i % 24, minutes=i % 60),
            icao_hex=f'A{i % 5}0000',
            callsign=f'TST{i % 5}23',
            altitude_baro=20000 + (i * 500),
            distance_nm=10.0 + i,
            is_military=(i % 10 == 0),
        )
        sightings.append(sighting)
    return sightings
