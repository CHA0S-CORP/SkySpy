"""
End-to-end tests for aircraft API endpoints.

Tests for:
- AircraftViewSet.list (GET /api/v1/aircraft/)
- AircraftViewSet.retrieve (GET /api/v1/aircraft/{hex}/)
- AircraftViewSet.top (GET /api/v1/aircraft/top/)
- AircraftViewSet.stats (GET /api/v1/aircraft/stats/)
- AircraftViewSet.uat_list (GET /api/v1/uat/aircraft/)
"""
from django.test import TestCase
from django.core.cache import cache
from rest_framework.test import APITestCase, APIClient
from rest_framework import status


class AircraftListViewTests(APITestCase):
    """Tests for the aircraft list endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_list_returns_200(self):
        """Test that aircraft list returns 200 OK."""
        response = self.client.get('/api/v1/aircraft/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_list_empty_cache(self):
        """Test list response when cache is empty."""
        response = self.client.get('/api/v1/aircraft/')
        data = response.json()

        self.assertIn('aircraft', data)
        self.assertIn('count', data)
        self.assertEqual(data['aircraft'], [])
        self.assertEqual(data['count'], 0)

    def test_list_response_structure(self):
        """Test that list response has correct structure."""
        response = self.client.get('/api/v1/aircraft/')
        data = response.json()

        self.assertIn('aircraft', data)
        self.assertIn('count', data)
        self.assertIn('now', data)
        self.assertIn('messages', data)
        self.assertIn('timestamp', data)

    def test_list_with_cached_aircraft(self):
        """Test list with aircraft data in cache."""
        aircraft_list = [
            {
                'hex': 'ABC123',
                'flight': 'UAL123',
                'lat': 47.5,
                'lon': -122.3,
                'alt': 35000,
                'gs': 450,
                'track': 180,
                'vr': 0,
                'squawk': '1234',
                'category': 'A3',
                'military': False,
            },
            {
                'hex': 'DEF456',
                'flight': 'DAL456',
                'lat': 47.6,
                'lon': -122.4,
                'alt': 30000,
                'gs': 420,
                'track': 90,
                'vr': -500,
                'squawk': '5678',
                'category': 'A5',
                'military': False,
            }
        ]
        cache.set('current_aircraft', aircraft_list)
        cache.set('aircraft_messages', 12345)

        response = self.client.get('/api/v1/aircraft/')
        data = response.json()

        self.assertEqual(data['count'], 2)
        self.assertEqual(len(data['aircraft']), 2)
        self.assertEqual(data['messages'], 12345)

    def test_list_aircraft_data_preserved(self):
        """Test that aircraft data is returned correctly."""
        aircraft = {
            'hex': 'ABC123',
            'flight': 'UAL123',
            'lat': 47.5,
            'lon': -122.3,
            'alt': 35000,
            'gs': 450,
            'military': True,
        }
        cache.set('current_aircraft', [aircraft])

        response = self.client.get('/api/v1/aircraft/')
        data = response.json()

        returned_aircraft = data['aircraft'][0]
        self.assertEqual(returned_aircraft['hex'], 'ABC123')
        self.assertEqual(returned_aircraft['flight'], 'UAL123')
        self.assertEqual(returned_aircraft['lat'], 47.5)
        self.assertEqual(returned_aircraft['alt'], 35000)

    def test_list_timestamp_format(self):
        """Test that timestamp is in ISO format."""
        response = self.client.get('/api/v1/aircraft/')
        data = response.json()

        self.assertTrue(data['timestamp'].endswith('Z'))
        self.assertIn('T', data['timestamp'])


class AircraftRetrieveViewTests(APITestCase):
    """Tests for the aircraft retrieve (detail) endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_retrieve_existing_aircraft(self):
        """Test retrieving an existing aircraft by hex code."""
        aircraft = {
            'hex': 'ABC123',
            'icao_hex': 'ABC123',
            'flight': 'UAL123',
            'lat': 47.5,
            'lon': -122.3,
            'alt': 35000,
        }
        cache.set('current_aircraft', [aircraft])

        response = self.client.get('/api/v1/aircraft/ABC123/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_retrieve_aircraft_data(self):
        """Test that retrieved aircraft has correct data."""
        aircraft = {
            'hex': 'ABC123',
            'icao_hex': 'ABC123',
            'flight': 'UAL123',
            'lat': 47.5,
            'lon': -122.3,
            'alt': 35000,
            'gs': 450,
        }
        cache.set('current_aircraft', [aircraft])

        response = self.client.get('/api/v1/aircraft/ABC123/')
        data = response.json()

        self.assertEqual(data['hex'], 'ABC123')
        self.assertEqual(data['flight'], 'UAL123')
        self.assertEqual(data['alt'], 35000)

    def test_retrieve_by_icao_hex(self):
        """Test retrieving aircraft by icao_hex field."""
        aircraft = {
            'hex': 'ABC123',
            'icao_hex': 'ABC123',
            'flight': 'UAL123',
        }
        cache.set('current_aircraft', [aircraft])

        response = self.client.get('/api/v1/aircraft/ABC123/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_retrieve_nonexistent_aircraft(self):
        """Test retrieving a non-existent aircraft returns 404."""
        cache.set('current_aircraft', [])

        response = self.client.get('/api/v1/aircraft/NOTFOUND/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_retrieve_404_error_message(self):
        """Test that 404 includes error message."""
        cache.set('current_aircraft', [])

        response = self.client.get('/api/v1/aircraft/NOTFOUND/')
        data = response.json()

        self.assertIn('error', data)
        self.assertIn('not found', data['error'].lower())

    def test_retrieve_case_sensitive(self):
        """Test that hex code lookup is case-sensitive."""
        aircraft = {'hex': 'ABC123', 'icao_hex': 'ABC123'}
        cache.set('current_aircraft', [aircraft])

        # Lowercase should not match
        response = self.client.get('/api/v1/aircraft/abc123/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_retrieve_from_multiple_aircraft(self):
        """Test retrieving one aircraft from multiple in cache."""
        aircraft_list = [
            {'hex': 'ABC123', 'icao_hex': 'ABC123', 'flight': 'UAL123'},
            {'hex': 'DEF456', 'icao_hex': 'DEF456', 'flight': 'DAL456'},
            {'hex': 'GHI789', 'icao_hex': 'GHI789', 'flight': 'AAL789'},
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/DEF456/')
        data = response.json()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(data['flight'], 'DAL456')


class AircraftTopViewTests(APITestCase):
    """Tests for the aircraft top endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_top_returns_200(self):
        """Test that top endpoint returns 200 OK."""
        response = self.client.get('/api/v1/aircraft/top/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_top_response_structure(self):
        """Test that top response has all categories."""
        response = self.client.get('/api/v1/aircraft/top/')
        data = response.json()

        expected_categories = ['closest', 'highest', 'fastest', 'climbing', 'military']
        for category in expected_categories:
            self.assertIn(category, data)

        self.assertIn('total', data)
        self.assertIn('timestamp', data)

    def test_top_empty_cache(self):
        """Test top with empty cache."""
        response = self.client.get('/api/v1/aircraft/top/')
        data = response.json()

        self.assertEqual(data['closest'], [])
        self.assertEqual(data['highest'], [])
        self.assertEqual(data['total'], 0)

    def test_top_closest_sorted(self):
        """Test that closest are sorted by distance."""
        aircraft_list = [
            {'hex': 'A', 'lat': 47.0, 'lon': -122.0, 'distance_nm': 10.0},
            {'hex': 'B', 'lat': 47.0, 'lon': -122.0, 'distance_nm': 5.0},
            {'hex': 'C', 'lat': 47.0, 'lon': -122.0, 'distance_nm': 15.0},
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/top/')
        data = response.json()

        closest = data['closest']
        self.assertEqual(closest[0]['hex'], 'B')  # 5nm
        self.assertEqual(closest[1]['hex'], 'A')  # 10nm
        self.assertEqual(closest[2]['hex'], 'C')  # 15nm

    def test_top_highest_sorted(self):
        """Test that highest are sorted by altitude descending."""
        aircraft_list = [
            {'hex': 'A', 'lat': 47.0, 'lon': -122.0, 'alt': 30000},
            {'hex': 'B', 'lat': 47.0, 'lon': -122.0, 'alt': 45000},
            {'hex': 'C', 'lat': 47.0, 'lon': -122.0, 'alt': 35000},
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/top/')
        data = response.json()

        highest = data['highest']
        self.assertEqual(highest[0]['hex'], 'B')  # 45000
        self.assertEqual(highest[1]['hex'], 'C')  # 35000
        self.assertEqual(highest[2]['hex'], 'A')  # 30000

    def test_top_fastest_sorted(self):
        """Test that fastest are sorted by ground speed descending."""
        aircraft_list = [
            {'hex': 'A', 'lat': 47.0, 'lon': -122.0, 'gs': 400},
            {'hex': 'B', 'lat': 47.0, 'lon': -122.0, 'gs': 550},
            {'hex': 'C', 'lat': 47.0, 'lon': -122.0, 'gs': 450},
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/top/')
        data = response.json()

        fastest = data['fastest']
        self.assertEqual(fastest[0]['hex'], 'B')  # 550
        self.assertEqual(fastest[1]['hex'], 'C')  # 450
        self.assertEqual(fastest[2]['hex'], 'A')  # 400

    def test_top_climbing_only_positive(self):
        """Test that climbing only includes positive vertical rate."""
        aircraft_list = [
            {'hex': 'A', 'lat': 47.0, 'lon': -122.0, 'vr': 2000},
            {'hex': 'B', 'lat': 47.0, 'lon': -122.0, 'vr': -1500},
            {'hex': 'C', 'lat': 47.0, 'lon': -122.0, 'vr': 3500},
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/top/')
        data = response.json()

        climbing = data['climbing']
        hex_codes = [ac['hex'] for ac in climbing]
        self.assertIn('A', hex_codes)
        self.assertIn('C', hex_codes)
        self.assertNotIn('B', hex_codes)  # Negative vr

    def test_top_military_filtered(self):
        """Test that military filter works."""
        aircraft_list = [
            {'hex': 'A', 'lat': 47.0, 'lon': -122.0, 'military': True},
            {'hex': 'B', 'lat': 47.0, 'lon': -122.0, 'military': False},
            {'hex': 'C', 'lat': 47.0, 'lon': -122.0, 'military': True},
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/top/')
        data = response.json()

        military = data['military']
        hex_codes = [ac['hex'] for ac in military]
        self.assertIn('A', hex_codes)
        self.assertIn('C', hex_codes)
        self.assertNotIn('B', hex_codes)

    def test_top_limit_parameter(self):
        """Test limit query parameter."""
        aircraft_list = [
            {'hex': f'AC{i}', 'lat': 47.0, 'lon': -122.0, 'alt': 30000 + i * 1000}
            for i in range(10)
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/top/?limit=3')
        data = response.json()

        self.assertEqual(len(data['highest']), 3)

    def test_top_default_limit(self):
        """Test default limit is 5."""
        aircraft_list = [
            {'hex': f'AC{i}', 'lat': 47.0, 'lon': -122.0, 'alt': 30000 + i * 1000}
            for i in range(10)
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/top/')
        data = response.json()

        self.assertLessEqual(len(data['highest']), 5)

    def test_top_requires_position(self):
        """Test that aircraft without position are excluded."""
        aircraft_list = [
            {'hex': 'A', 'lat': 47.0, 'lon': -122.0, 'alt': 35000},
            {'hex': 'B', 'lat': None, 'lon': None, 'alt': 40000},
            {'hex': 'C', 'alt': 45000},  # No lat/lon
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/top/')
        data = response.json()

        # Only 'A' has valid position
        highest = data['highest']
        hex_codes = [ac['hex'] for ac in highest]
        self.assertIn('A', hex_codes)
        self.assertNotIn('B', hex_codes)
        self.assertNotIn('C', hex_codes)


class AircraftStatsViewTests(APITestCase):
    """Tests for the aircraft stats endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_stats_returns_200(self):
        """Test that stats endpoint returns 200 OK."""
        response = self.client.get('/api/v1/aircraft/stats/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_stats_response_structure(self):
        """Test that stats response has expected fields."""
        response = self.client.get('/api/v1/aircraft/stats/')
        data = response.json()

        expected_fields = [
            'total', 'with_position', 'military', 'emergency',
            'categories', 'altitude', 'messages', 'timestamp'
        ]
        for field in expected_fields:
            self.assertIn(field, data)

    def test_stats_empty_cache(self):
        """Test stats with empty cache."""
        response = self.client.get('/api/v1/aircraft/stats/')
        data = response.json()

        self.assertEqual(data['total'], 0)
        self.assertEqual(data['with_position'], 0)
        self.assertEqual(data['military'], 0)

    def test_stats_counts(self):
        """Test that stats counts are accurate."""
        aircraft_list = [
            {'hex': 'A', 'lat': 47.0, 'lon': -122.0, 'military': True},
            {'hex': 'B', 'lat': 47.0, 'lon': -122.0, 'military': False},
            {'hex': 'C', 'lat': None, 'lon': None, 'military': True},
            {'hex': 'D', 'lat': 47.0, 'lon': -122.0, 'military': False},
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/stats/')
        data = response.json()

        self.assertEqual(data['total'], 4)
        self.assertEqual(data['with_position'], 3)
        self.assertEqual(data['military'], 2)

    def test_stats_emergency_squawks(self):
        """Test that emergency squawks are detected."""
        aircraft_list = [
            {'hex': 'A', 'squawk': '7500'},  # Hijack
            {'hex': 'B', 'squawk': '7600'},  # Radio failure
            {'hex': 'C', 'squawk': '7700'},  # Emergency
            {'hex': 'D', 'squawk': '1234'},  # Normal
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/stats/')
        data = response.json()

        self.assertEqual(len(data['emergency']), 3)

    def test_stats_altitude_bands(self):
        """Test that altitude bands are calculated correctly."""
        aircraft_list = [
            {'hex': 'A', 'alt': 50},      # ground
            {'hex': 'B', 'alt': 5000},    # low
            {'hex': 'C', 'alt': 20000},   # medium
            {'hex': 'D', 'alt': 40000},   # high
            {'hex': 'E', 'alt': None},    # ground (no alt)
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/stats/')
        data = response.json()

        altitude = data['altitude']
        self.assertEqual(altitude['ground'], 2)
        self.assertEqual(altitude['low'], 1)
        self.assertEqual(altitude['medium'], 1)
        self.assertEqual(altitude['high'], 1)

    def test_stats_categories(self):
        """Test that categories are counted."""
        aircraft_list = [
            {'hex': 'A', 'category': 'A3'},
            {'hex': 'B', 'category': 'A3'},
            {'hex': 'C', 'category': 'A5'},
            {'hex': 'D', 'category': 'B2'},
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/aircraft/stats/')
        data = response.json()

        categories = data['categories']
        self.assertEqual(categories['A3'], 2)
        self.assertEqual(categories['A5'], 1)
        self.assertEqual(categories['B2'], 1)

    def test_stats_messages_count(self):
        """Test that messages count is returned."""
        cache.set('current_aircraft', [])
        cache.set('aircraft_messages', 54321)

        response = self.client.get('/api/v1/aircraft/stats/')
        data = response.json()

        self.assertEqual(data['messages'], 54321)


class UATAircraftViewTests(APITestCase):
    """Tests for the UAT aircraft list endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_uat_returns_200(self):
        """Test that UAT endpoint returns 200 OK."""
        response = self.client.get('/api/v1/uat/aircraft/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_uat_response_structure(self):
        """Test that UAT response has expected structure."""
        response = self.client.get('/api/v1/uat/aircraft/')
        data = response.json()

        self.assertIn('aircraft', data)
        self.assertIn('count', data)
        self.assertIn('now', data)
        self.assertIn('messages', data)
        self.assertIn('timestamp', data)

    def test_uat_empty_cache(self):
        """Test UAT with empty cache."""
        response = self.client.get('/api/v1/uat/aircraft/')
        data = response.json()

        self.assertEqual(data['aircraft'], [])
        self.assertEqual(data['count'], 0)

    def test_uat_with_cached_aircraft(self):
        """Test UAT with cached aircraft data."""
        uat_aircraft = [
            {'hex': '~UAT001', 'lat': 47.5, 'lon': -122.3, 'alt': 5000},
            {'hex': '~UAT002', 'lat': 47.6, 'lon': -122.4, 'alt': 6000},
        ]
        cache.set('uat_aircraft', uat_aircraft)

        response = self.client.get('/api/v1/uat/aircraft/')
        data = response.json()

        self.assertEqual(data['count'], 2)
        self.assertEqual(len(data['aircraft']), 2)

    def test_uat_separate_from_1090(self):
        """Test that UAT and 1090 aircraft are separate."""
        cache.set('current_aircraft', [{'hex': 'ABC123'}])
        cache.set('uat_aircraft', [{'hex': '~UAT001'}])

        # Check 1090
        response_1090 = self.client.get('/api/v1/aircraft/')
        data_1090 = response_1090.json()
        self.assertEqual(data_1090['count'], 1)
        self.assertEqual(data_1090['aircraft'][0]['hex'], 'ABC123')

        # Check UAT
        response_uat = self.client.get('/api/v1/uat/aircraft/')
        data_uat = response_uat.json()
        self.assertEqual(data_uat['count'], 1)
        self.assertEqual(data_uat['aircraft'][0]['hex'], '~UAT001')


class AircraftEndpointsIntegrationTests(APITestCase):
    """Integration tests for aircraft endpoints."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        cache.clear()

        # Set up realistic test data
        self.aircraft_list = [
            {
                'hex': 'ABC123',
                'icao_hex': 'ABC123',
                'flight': 'UAL123',
                'lat': 47.5,
                'lon': -122.3,
                'alt': 35000,
                'gs': 450,
                'track': 180,
                'vr': 500,
                'distance_nm': 15.5,
                'squawk': '1234',
                'category': 'A3',
                'military': False,
            },
            {
                'hex': 'MIL001',
                'icao_hex': 'MIL001',
                'flight': 'EVAC01',
                'lat': 47.6,
                'lon': -122.4,
                'alt': 25000,
                'gs': 350,
                'track': 90,
                'vr': 2500,
                'distance_nm': 8.2,
                'squawk': '7700',
                'category': 'A5',
                'military': True,
            },
        ]
        cache.set('current_aircraft', self.aircraft_list)
        cache.set('aircraft_messages', 99999)

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_list_and_retrieve_consistency(self):
        """Test that list and retrieve return consistent data."""
        list_response = self.client.get('/api/v1/aircraft/')
        list_data = list_response.json()

        for aircraft in list_data['aircraft']:
            hex_code = aircraft['hex']
            detail_response = self.client.get(f'/api/v1/aircraft/{hex_code}/')
            detail_data = detail_response.json()

            self.assertEqual(aircraft['hex'], detail_data['hex'])
            self.assertEqual(aircraft['flight'], detail_data['flight'])

    def test_stats_matches_list(self):
        """Test that stats counts match list data."""
        list_response = self.client.get('/api/v1/aircraft/')
        list_data = list_response.json()

        stats_response = self.client.get('/api/v1/aircraft/stats/')
        stats_data = stats_response.json()

        self.assertEqual(stats_data['total'], list_data['count'])

    def test_top_aircraft_in_list(self):
        """Test that top aircraft appear in list."""
        top_response = self.client.get('/api/v1/aircraft/top/')
        top_data = top_response.json()

        list_response = self.client.get('/api/v1/aircraft/')
        list_data = list_response.json()
        list_hex_codes = [ac['hex'] for ac in list_data['aircraft']]

        # Check that top aircraft are in the list
        for category in ['closest', 'highest', 'fastest']:
            for aircraft in top_data[category]:
                self.assertIn(aircraft['hex'], list_hex_codes)

    def test_all_endpoints_return_json(self):
        """Test that all endpoints return JSON."""
        endpoints = [
            '/api/v1/aircraft/',
            '/api/v1/aircraft/ABC123/',
            '/api/v1/aircraft/top/',
            '/api/v1/aircraft/stats/',
            '/api/v1/uat/aircraft/',
        ]

        for endpoint in endpoints:
            response = self.client.get(endpoint)
            if response.status_code == status.HTTP_200_OK:
                self.assertEqual(
                    response['Content-Type'],
                    'application/json',
                    f"Endpoint {endpoint} should return JSON"
                )

    def test_no_authentication_required(self):
        """Test that no authentication is required."""
        self.client.credentials()

        endpoints = [
            '/api/v1/aircraft/',
            '/api/v1/aircraft/top/',
            '/api/v1/aircraft/stats/',
        ]

        for endpoint in endpoints:
            response = self.client.get(endpoint)
            self.assertNotIn(
                response.status_code,
                [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]
            )
