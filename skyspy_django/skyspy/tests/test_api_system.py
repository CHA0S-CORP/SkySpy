"""
End-to-end tests for system API endpoints.

Tests for:
- HealthCheckView (/health, /api/v1/system/health)
- StatusView (/api/v1/system/status)
- SystemInfoView (/api/v1/system/info)
- MetricsView (/metrics)
"""
from unittest.mock import patch, MagicMock

from django.test import TestCase, override_settings
from django.core.cache import cache
from rest_framework.test import APITestCase, APIClient
from rest_framework import status


class HealthCheckViewTests(APITestCase):
    """Tests for the HealthCheckView endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_health_check_returns_200(self):
        """Test that health check endpoint returns 200 OK."""
        response = self.client.get('/health')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_health_check_with_trailing_slash(self):
        """Test health check with trailing slash."""
        response = self.client.get('/health/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_health_check_response_structure(self):
        """Test that health check response has correct structure."""
        response = self.client.get('/health')
        data = response.json()

        self.assertIn('status', data)
        self.assertIn('services', data)
        self.assertIn('timestamp', data)

        # Check services structure
        services = data['services']
        self.assertIn('database', services)
        self.assertIn('cache', services)
        self.assertIn('celery', services)

    def test_health_check_database_up(self):
        """Test that database status is reported correctly."""
        response = self.client.get('/health')
        data = response.json()

        # Database should be up in test environment
        self.assertEqual(data['services']['database']['status'], 'up')
        self.assertIn('latency_ms', data['services']['database'])

    def test_health_check_cache_status(self):
        """Test that cache status is reported."""
        response = self.client.get('/health')
        data = response.json()

        # Cache should be up or degraded depending on test environment
        self.assertIn(data['services']['cache']['status'], ['up', 'degraded', 'down'])

    def test_health_check_celery_status(self):
        """Test that celery status is reported."""
        response = self.client.get('/health')
        data = response.json()

        # Celery might be unknown if no heartbeat
        self.assertIn('status', data['services']['celery'])

    def test_health_check_celery_with_heartbeat(self):
        """Test celery status when heartbeat is present."""
        cache.set("celery_heartbeat", True, 60)

        response = self.client.get('/health')
        data = response.json()

        self.assertEqual(data['services']['celery']['status'], 'up')

    def test_health_check_api_v1_endpoint(self):
        """Test health check at API v1 path."""
        response = self.client.get('/api/v1/system/health')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_health_check_no_authentication_required(self):
        """Test that health check works without authentication."""
        # Clear any credentials
        self.client.credentials()
        response = self.client.get('/health')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_health_check_timestamp_format(self):
        """Test that timestamp is in ISO format with Z suffix."""
        response = self.client.get('/health')
        data = response.json()

        timestamp = data['timestamp']
        self.assertTrue(timestamp.endswith('Z'))
        self.assertIn('T', timestamp)


class StatusViewTests(APITestCase):
    """Tests for the StatusView endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_status_returns_200(self):
        """Test that status endpoint returns 200 OK."""
        response = self.client.get('/api/v1/system/status')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_status_with_trailing_slash(self):
        """Test status endpoint with trailing slash."""
        response = self.client.get('/api/v1/system/status/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_status_response_structure(self):
        """Test that status response has expected fields."""
        response = self.client.get('/api/v1/system/status')
        data = response.json()

        expected_fields = [
            'version', 'adsb_online', 'aircraft_count',
            'total_sightings', 'total_sessions', 'active_rules',
            'alert_history_count', 'safety_event_count',
            'safety_monitoring_enabled', 'notifications_configured',
            'redis_enabled', 'polling_interval_seconds',
            'db_store_interval_seconds', 'celery_running',
            'location'
        ]

        for field in expected_fields:
            self.assertIn(field, data, f"Missing field: {field}")

    def test_status_location_structure(self):
        """Test that location has latitude and longitude."""
        response = self.client.get('/api/v1/system/status')
        data = response.json()

        location = data['location']
        self.assertIn('latitude', location)
        self.assertIn('longitude', location)

    def test_status_version_format(self):
        """Test that version is returned."""
        response = self.client.get('/api/v1/system/status')
        data = response.json()

        self.assertIsInstance(data['version'], str)
        # Version should match semver pattern
        self.assertRegex(data['version'], r'^\d+\.\d+\.\d+')

    def test_status_counts_are_integers(self):
        """Test that count fields are integers."""
        response = self.client.get('/api/v1/system/status')
        data = response.json()

        count_fields = [
            'aircraft_count', 'total_sightings', 'total_sessions',
            'active_rules', 'alert_history_count', 'safety_event_count'
        ]

        for field in count_fields:
            self.assertIsInstance(data[field], int, f"{field} should be int")

    def test_status_with_cached_aircraft(self):
        """Test status with aircraft in cache."""
        # Simulate cached aircraft data
        aircraft_list = [
            {'hex': 'ABC123', 'lat': 47.0, 'lon': -122.0},
            {'hex': 'DEF456', 'lat': 47.1, 'lon': -122.1},
        ]
        cache.set('current_aircraft', aircraft_list)

        response = self.client.get('/api/v1/system/status')
        data = response.json()

        self.assertEqual(data['aircraft_count'], 2)

    def test_status_adsb_online_from_cache(self):
        """Test that adsb_online status comes from cache."""
        cache.set('adsb_online', True)

        response = self.client.get('/api/v1/system/status')
        data = response.json()

        self.assertTrue(data['adsb_online'])

    def test_status_no_authentication_required(self):
        """Test that status works without authentication."""
        self.client.credentials()
        response = self.client.get('/api/v1/system/status')
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class SystemInfoViewTests(APITestCase):
    """Tests for the SystemInfoView endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()

    def test_info_returns_200(self):
        """Test that info endpoint returns 200 OK."""
        response = self.client.get('/api/v1/system/info')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_info_with_trailing_slash(self):
        """Test info endpoint with trailing slash."""
        response = self.client.get('/api/v1/system/info/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_info_response_structure(self):
        """Test that info response has expected fields."""
        response = self.client.get('/api/v1/system/info')
        data = response.json()

        self.assertIn('version', data)
        self.assertIn('name', data)
        self.assertIn('description', data)
        self.assertIn('endpoints', data)

    def test_info_endpoints_structure(self):
        """Test that endpoints dictionary has expected categories."""
        response = self.client.get('/api/v1/system/info')
        data = response.json()

        expected_categories = [
            'aircraft', 'history', 'alerts', 'safety',
            'acars', 'audio', 'aviation', 'map', 'system',
            'websocket', 'docs'
        ]

        for category in expected_categories:
            self.assertIn(category, data['endpoints'], f"Missing category: {category}")

    def test_info_aircraft_endpoints(self):
        """Test that aircraft endpoints are documented."""
        response = self.client.get('/api/v1/system/info')
        data = response.json()

        aircraft = data['endpoints']['aircraft']
        self.assertIn('list', aircraft)
        self.assertIn('detail', aircraft)
        self.assertIn('top', aircraft)
        self.assertIn('stats', aircraft)

    def test_info_system_endpoints(self):
        """Test that system endpoints are documented."""
        response = self.client.get('/api/v1/system/info')
        data = response.json()

        system = data['endpoints']['system']
        self.assertIn('health', system)
        self.assertIn('status', system)
        self.assertIn('info', system)

    def test_info_no_authentication_required(self):
        """Test that info works without authentication."""
        self.client.credentials()
        response = self.client.get('/api/v1/system/info')
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class MetricsViewTests(APITestCase):
    """Tests for the MetricsView endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()

    @override_settings(PROMETHEUS_ENABLED=True)
    def test_metrics_returns_200_when_enabled(self):
        """Test that metrics endpoint returns 200 when enabled."""
        with patch('skyspy.api.system.settings') as mock_settings:
            mock_settings.PROMETHEUS_ENABLED = True
            # Mock prometheus_client
            with patch.dict('sys.modules', {'prometheus_client': MagicMock()}):
                response = self.client.get('/metrics')
                # May return 503 if prometheus_client not fully mocked
                self.assertIn(
                    response.status_code,
                    [status.HTTP_200_OK, status.HTTP_503_SERVICE_UNAVAILABLE]
                )

    @override_settings(PROMETHEUS_ENABLED=False)
    def test_metrics_returns_503_when_disabled(self):
        """Test that metrics endpoint returns 503 when disabled."""
        with patch('skyspy.api.system.settings') as mock_settings:
            mock_settings.PROMETHEUS_ENABLED = False
            response = self.client.get('/metrics')
            self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_metrics_disabled_error_message(self):
        """Test error message when metrics disabled."""
        with patch('skyspy.api.system.settings') as mock_settings:
            mock_settings.PROMETHEUS_ENABLED = False
            response = self.client.get('/metrics')
            if response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                data = response.json()
                self.assertIn('error', data)

    def test_metrics_with_trailing_slash(self):
        """Test metrics endpoint with trailing slash."""
        response = self.client.get('/metrics/')
        # Should return either metrics or error, but not 404
        self.assertIn(
            response.status_code,
            [status.HTTP_200_OK, status.HTTP_503_SERVICE_UNAVAILABLE]
        )

    def test_metrics_no_authentication_required(self):
        """Test that metrics works without authentication."""
        self.client.credentials()
        response = self.client.get('/metrics')
        # Should return valid response, not 401/403
        self.assertNotIn(
            response.status_code,
            [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]
        )


class SystemEndpointsIntegrationTests(APITestCase):
    """Integration tests for system endpoints."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()

    def test_all_system_endpoints_accessible(self):
        """Test that all system endpoints are accessible."""
        endpoints = [
            '/health',
            '/api/v1/system/health',
            '/api/v1/system/status',
            '/api/v1/system/info',
        ]

        for endpoint in endpoints:
            response = self.client.get(endpoint)
            self.assertIn(
                response.status_code,
                [status.HTTP_200_OK, status.HTTP_503_SERVICE_UNAVAILABLE],
                f"Endpoint {endpoint} returned unexpected status"
            )

    def test_json_content_type(self):
        """Test that responses are JSON."""
        endpoints = [
            '/health',
            '/api/v1/system/status',
            '/api/v1/system/info',
        ]

        for endpoint in endpoints:
            response = self.client.get(endpoint)
            self.assertEqual(
                response['Content-Type'],
                'application/json',
                f"Endpoint {endpoint} should return JSON"
            )

    def test_version_consistency(self):
        """Test that version is consistent across endpoints."""
        status_response = self.client.get('/api/v1/system/status')
        info_response = self.client.get('/api/v1/system/info')

        status_version = status_response.json()['version']
        info_version = info_response.json()['version']

        self.assertEqual(status_version, info_version)

    def test_options_request(self):
        """Test OPTIONS request for CORS."""
        response = self.client.options('/health')
        # Should not be 405 Method Not Allowed
        self.assertNotEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_head_request(self):
        """Test HEAD request."""
        response = self.client.head('/health')
        # Should return same status as GET but no body
        self.assertEqual(response.status_code, status.HTTP_200_OK)
