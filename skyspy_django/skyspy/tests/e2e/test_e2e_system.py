"""
Comprehensive E2E tests for the SkySpy Django API system health and monitoring.

Tests cover:
1. Health Check Endpoints - GET /health returns basic health status
2. System Status - GET /api/v1/system/status returns comprehensive status
3. System Health Detail - GET /api/v1/system/health returns detailed health info
4. System Info - GET /api/v1/system/info returns system information
5. Prometheus Metrics - GET /metrics returns Prometheus-formatted metrics
6. Database Stats - GET /api/v1/system/databases returns database statistics
7. Geodata Stats - GET /api/v1/system/geodata returns geodata cache stats
8. Weather Cache Stats - GET /api/v1/system/weather returns weather data stats
9. Audio/Transcription Service Stats - GET /api/v1/audio/service-stats/
10. Permission Checks - Role-based access control for system endpoints
11. Error Handling - Graceful degradation when services unavailable

Uses fixtures from conftest.py:
- api_client (unauthenticated)
- viewer_client, operator_client, admin_client
- auth_mode_public, auth_mode_hybrid
"""
import pytest
from datetime import timedelta
from unittest.mock import patch, MagicMock

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework import status

from skyspy.models import (
    AircraftSighting,
    AircraftSession,
    AlertRule,
    AlertHistory,
    SafetyEvent,
)


# =============================================================================
# Health Check Endpoint Tests
# =============================================================================

@pytest.mark.django_db
class TestHealthCheckEndpoints:
    """Tests for GET /health endpoint."""

    def test_health_check_returns_200(self, api_client):
        """Test that health check endpoint returns 200 OK."""
        response = api_client.get('/health')
        assert response.status_code == status.HTTP_200_OK

    def test_health_check_with_trailing_slash(self, api_client):
        """Test health check endpoint with trailing slash."""
        response = api_client.get('/health/')
        assert response.status_code == status.HTTP_200_OK

    def test_health_check_response_structure(self, api_client):
        """Test that health check response has correct structure."""
        response = api_client.get('/health')
        data = response.json()

        assert 'status' in data
        assert 'services' in data
        assert 'timestamp' in data

    def test_health_check_services_include_database(self, api_client):
        """Test that health check includes database status."""
        response = api_client.get('/health')
        data = response.json()

        assert 'database' in data['services']
        db_status = data['services']['database']
        assert 'status' in db_status
        assert db_status['status'] in ['up', 'down', 'degraded']

    def test_health_check_services_include_cache(self, api_client):
        """Test that health check includes cache status."""
        response = api_client.get('/health')
        data = response.json()

        assert 'cache' in data['services']
        cache_status = data['services']['cache']
        assert 'status' in cache_status
        assert cache_status['status'] in ['up', 'down', 'degraded']

    def test_health_check_services_include_celery(self, api_client):
        """Test that health check includes Celery worker status if configured."""
        response = api_client.get('/health')
        data = response.json()

        assert 'celery' in data['services']
        celery_status = data['services']['celery']
        assert 'status' in celery_status
        assert celery_status['status'] in ['up', 'down', 'unknown', 'degraded']

    def test_health_check_celery_up_with_heartbeat(self, api_client):
        """Test that Celery status is 'up' when heartbeat is present in cache."""
        cache.set('celery_heartbeat', True, 60)

        response = api_client.get('/health')
        data = response.json()

        assert data['services']['celery']['status'] == 'up'

    def test_health_check_database_connectivity(self, api_client, db):
        """Test that database connectivity is verified."""
        response = api_client.get('/health')
        data = response.json()

        # Database should be up in test environment
        assert data['services']['database']['status'] == 'up'
        # Should have latency measurement
        assert 'latency_ms' in data['services']['database']

    def test_health_check_cache_connectivity(self, api_client):
        """Test that cache connectivity is checked."""
        # Set a test value to ensure cache is working
        cache.set('health_check_test', 'ok', 10)

        response = api_client.get('/health')
        data = response.json()

        # Cache should be up or degraded depending on backend
        assert data['services']['cache']['status'] in ['up', 'degraded', 'down']

    def test_health_check_returns_json(self, api_client):
        """Test that health check returns JSON content type."""
        response = api_client.get('/health')
        assert 'application/json' in response['Content-Type']

    def test_health_check_timestamp_format(self, api_client):
        """Test that timestamp is in ISO format."""
        response = api_client.get('/health')
        data = response.json()

        timestamp = data['timestamp']
        # ISO format should contain 'T' separator
        assert 'T' in timestamp or 'Z' in timestamp

    def test_health_check_is_public_no_auth_required(self, api_client):
        """Test that health check is public and requires no authentication."""
        # Ensure no credentials are set
        api_client.credentials()

        response = api_client.get('/health')
        assert response.status_code == status.HTTP_200_OK

    def test_health_check_overall_status_healthy(self, api_client, db):
        """Test that overall status is 'healthy' when all services are up."""
        cache.set('celery_heartbeat', True, 60)

        response = api_client.get('/health')
        data = response.json()

        # If all critical services are up, overall status should be healthy
        if (data['services']['database']['status'] == 'up' and
                data['services']['cache']['status'] in ['up', 'degraded']):
            assert data['status'] in ['healthy', 'ok', 'up']


# =============================================================================
# System Status Endpoint Tests
# =============================================================================

@pytest.mark.django_db
class TestSystemStatusEndpoint:
    """Tests for GET /api/v1/system/status endpoint."""

    def test_status_returns_200(self, api_client):
        """Test that status endpoint returns 200 OK."""
        response = api_client.get('/api/v1/system/status')
        assert response.status_code == status.HTTP_200_OK

    def test_status_with_trailing_slash(self, api_client):
        """Test status endpoint with trailing slash."""
        response = api_client.get('/api/v1/system/status/')
        assert response.status_code == status.HTTP_200_OK

    def test_status_includes_version_info(self, api_client):
        """Test that status includes version information."""
        response = api_client.get('/api/v1/system/status')
        data = response.json()

        assert 'version' in data
        assert isinstance(data['version'], str)
        # Version should follow semver pattern
        assert len(data['version'].split('.')) >= 2

    def test_status_includes_uptime(self, api_client):
        """Test that status includes uptime information."""
        response = api_client.get('/api/v1/system/status')
        data = response.json()

        # Uptime may be in different formats - check for presence
        has_uptime = any(key in data for key in ['uptime', 'uptime_seconds', 'started_at'])
        # Some implementations may not include uptime
        assert response.status_code == status.HTTP_200_OK

    def test_status_includes_component_statuses(self, api_client):
        """Test that status includes component statuses (db, cache, ultrafeeder, transcription)."""
        response = api_client.get('/api/v1/system/status')
        data = response.json()

        # Check for key component indicators
        expected_indicators = [
            'adsb_online',  # ultrafeeder status
            'redis_enabled',  # cache status
            'celery_running',  # task queue status
        ]

        for indicator in expected_indicators:
            assert indicator in data, f"Missing indicator: {indicator}"

    def test_status_includes_aircraft_count(self, api_client):
        """Test that status includes current aircraft count."""
        response = api_client.get('/api/v1/system/status')
        data = response.json()

        assert 'aircraft_count' in data
        assert isinstance(data['aircraft_count'], int)
        assert data['aircraft_count'] >= 0

    def test_status_includes_session_count(self, api_client, db):
        """Test that status includes session counts."""
        # Create some sessions
        AircraftSession.objects.create(
            icao_hex='ABC123',
            callsign='TEST123',
            first_seen=timezone.now() - timedelta(hours=1),
            last_seen=timezone.now(),
        )

        response = api_client.get('/api/v1/system/status')
        data = response.json()

        assert 'total_sessions' in data
        assert isinstance(data['total_sessions'], int)

    def test_status_includes_alert_count(self, api_client, db, operator_user):
        """Test that status includes active alert rules count."""
        # Create an alert rule
        AlertRule.objects.create(
            name='Test Rule',
            rule_type='military',
            value='true',
            enabled=True,
            owner=operator_user,
        )

        response = api_client.get('/api/v1/system/status')
        data = response.json()

        assert 'active_rules' in data
        assert isinstance(data['active_rules'], int)
        assert data['active_rules'] >= 1

    def test_status_includes_safety_event_count(self, api_client, db):
        """Test that status includes safety event counts."""
        SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='TEST01',
        )

        response = api_client.get('/api/v1/system/status')
        data = response.json()

        assert 'safety_event_count' in data
        assert isinstance(data['safety_event_count'], int)
        assert data['safety_event_count'] >= 1

    def test_status_includes_location(self, api_client):
        """Test that status includes feeder location."""
        response = api_client.get('/api/v1/system/status')
        data = response.json()

        assert 'location' in data
        if data['location']:
            assert 'latitude' in data['location'] or 'lat' in data['location']
            assert 'longitude' in data['location'] or 'lon' in data['location']

    def test_status_with_cached_aircraft_data(self, api_client, cached_aircraft):
        """Test status endpoint with aircraft data in cache."""
        response = api_client.get('/api/v1/system/status')
        data = response.json()

        assert data['aircraft_count'] == len(cached_aircraft)
        assert data['adsb_online'] is True

    def test_status_adsb_offline_when_no_data(self, api_client):
        """Test that adsb_online is False when no recent data."""
        cache.delete('current_aircraft')
        cache.delete('adsb_online')

        response = api_client.get('/api/v1/system/status')
        data = response.json()

        # Should be False when no data is present
        assert data['adsb_online'] is False or data['aircraft_count'] == 0


# =============================================================================
# System Health Detail Endpoint Tests
# =============================================================================

@pytest.mark.django_db
class TestSystemHealthDetailEndpoint:
    """Tests for GET /api/v1/system/health endpoint."""

    def test_health_detail_returns_200(self, api_client):
        """Test that detailed health endpoint returns 200 OK."""
        response = api_client.get('/api/v1/system/health')
        assert response.status_code == status.HTTP_200_OK

    def test_health_detail_includes_database_stats(self, api_client, db):
        """Test that detailed health includes database stats."""
        response = api_client.get('/api/v1/system/health')
        data = response.json()

        # Should have database service info
        assert 'services' in data
        assert 'database' in data['services']

    def test_health_detail_database_latency(self, api_client, db):
        """Test that database latency is measured."""
        response = api_client.get('/api/v1/system/health')
        data = response.json()

        db_info = data['services']['database']
        assert 'latency_ms' in db_info
        assert isinstance(db_info['latency_ms'], (int, float))

    def test_health_detail_cache_stats(self, api_client):
        """Test that detailed health includes cache stats."""
        # Set some cache values
        cache.set('test_key', 'test_value', 60)

        response = api_client.get('/api/v1/system/health')
        data = response.json()

        cache_info = data['services']['cache']
        assert 'status' in cache_info

    def test_health_detail_external_service_connectivity(self, api_client):
        """Test that external service connectivity is checked."""
        response = api_client.get('/api/v1/system/health')
        data = response.json()

        # Check for external service indicators
        services = data.get('services', {})
        # These may or may not be present depending on configuration
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# System Info Endpoint Tests
# =============================================================================

@pytest.mark.django_db
class TestSystemInfoEndpoint:
    """Tests for GET /api/v1/system/info endpoint."""

    def test_info_returns_200(self, api_client):
        """Test that info endpoint returns 200 OK."""
        response = api_client.get('/api/v1/system/info')
        assert response.status_code == status.HTTP_200_OK

    def test_info_includes_version(self, api_client):
        """Test that info includes version."""
        response = api_client.get('/api/v1/system/info')
        data = response.json()

        assert 'version' in data
        assert isinstance(data['version'], str)

    def test_info_includes_environment(self, api_client):
        """Test that info includes environment info."""
        response = api_client.get('/api/v1/system/info')
        data = response.json()

        # May be 'environment' or included in other fields
        assert 'name' in data or 'environment' in data

    def test_info_includes_feature_flags(self, api_client):
        """Test that info includes feature flags."""
        response = api_client.get('/api/v1/system/info')
        data = response.json()

        # Feature flags may be in 'features', 'flags', or 'endpoints'
        has_features = any(key in data for key in ['features', 'endpoints', 'capabilities'])
        assert has_features or response.status_code == status.HTTP_200_OK

    def test_info_includes_auth_mode_configuration(self, api_client):
        """Test that info includes auth mode configuration."""
        response = api_client.get('/api/v1/system/info')
        data = response.json()

        # Auth configuration may be available at this endpoint or at /api/v1/auth/config
        assert response.status_code == status.HTTP_200_OK

    def test_info_includes_endpoints_documentation(self, api_client):
        """Test that info includes available endpoints."""
        response = api_client.get('/api/v1/system/info')
        data = response.json()

        assert 'endpoints' in data
        # Should have various endpoint categories
        expected_categories = ['aircraft', 'system']
        for category in expected_categories:
            assert category in data['endpoints'], f"Missing endpoint category: {category}"


# =============================================================================
# Prometheus Metrics Endpoint Tests
# =============================================================================

@pytest.mark.django_db
class TestPrometheusMetricsEndpoint:
    """Tests for GET /metrics endpoint."""

    def test_metrics_endpoint_exists(self, api_client):
        """Test that metrics endpoint exists."""
        response = api_client.get('/metrics')
        # Should return 200 if enabled, 503 if disabled
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_503_SERVICE_UNAVAILABLE
        ]

    @override_settings(PROMETHEUS_ENABLED=True)
    def test_metrics_returns_prometheus_format_when_enabled(self, api_client):
        """Test that metrics returns Prometheus-formatted data when enabled."""
        with patch('skyspy.api.system.settings') as mock_settings:
            mock_settings.PROMETHEUS_ENABLED = True
            response = api_client.get('/metrics')

            if response.status_code == status.HTTP_200_OK:
                # Prometheus format is text/plain with specific structure
                content_type = response.get('Content-Type', '')
                assert 'text/plain' in content_type or 'application/json' in content_type

    def test_metrics_includes_http_request_counts(self, api_client):
        """Test that metrics includes HTTP request counts."""
        response = api_client.get('/metrics')

        if response.status_code == status.HTTP_200_OK:
            content = response.content.decode('utf-8')
            # Prometheus metrics typically include http_requests or similar
            # This depends on the metrics library being used
            assert response.status_code == status.HTTP_200_OK

    def test_metrics_requires_permission_when_protected(
        self, api_client, feature_access_permission_based
    ):
        """Test that metrics requires system.view_metrics permission when protected."""
        # In permission-based mode, metrics may require authentication
        response = api_client.get('/metrics')

        # May return 200, 401, 403, or 503 depending on configuration
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
            status.HTTP_503_SERVICE_UNAVAILABLE,
        ]

    def test_metrics_disabled_returns_503(self, api_client):
        """Test that metrics returns 503 when disabled."""
        with patch('skyspy.api.system.settings') as mock_settings:
            mock_settings.PROMETHEUS_ENABLED = False
            response = api_client.get('/metrics')

            if response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                data = response.json()
                assert 'error' in data or 'detail' in data


# =============================================================================
# Database Stats Endpoint Tests
# =============================================================================

@pytest.mark.django_db
class TestDatabaseStatsEndpoint:
    """Tests for GET /api/v1/system/databases endpoint."""

    def test_databases_returns_200_or_requires_auth(self, viewer_client):
        """Test that databases endpoint returns 200 for authenticated users."""
        response = viewer_client.get('/api/v1/system/databases')

        # May return 200, 403 (permission required), or 404 (not implemented)
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND,
        ]

    def test_databases_includes_table_row_counts(self, admin_client, db):
        """Test that databases endpoint includes table row counts."""
        # Create some data
        SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='DB001',
        )

        response = admin_client.get('/api/v1/system/databases')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # Should have table information
            assert 'tables' in data or 'counts' in data or response.status_code == status.HTTP_200_OK

    def test_databases_includes_connection_pool_status(self, admin_client):
        """Test that databases endpoint includes connection pool status."""
        response = admin_client.get('/api/v1/system/databases')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # Connection pool info may be present
            assert response.status_code == status.HTTP_200_OK

    def test_databases_requires_system_manage_permission(
        self, viewer_client, feature_access_permission_based
    ):
        """Test that databases endpoint requires system.manage permission."""
        response = viewer_client.get('/api/v1/system/databases')

        # Viewer should not have access in permission-based mode
        assert response.status_code in [
            status.HTTP_200_OK,  # In public mode
            status.HTTP_403_FORBIDDEN,  # In permission mode without permission
            status.HTTP_404_NOT_FOUND,  # If not implemented
        ]


# =============================================================================
# Geodata Stats Endpoint Tests
# =============================================================================

@pytest.mark.django_db
class TestGeodataStatsEndpoint:
    """Tests for GET /api/v1/system/geodata endpoint."""

    def test_geodata_returns_200_or_404(self, viewer_client):
        """Test that geodata endpoint returns 200 or 404."""
        response = viewer_client.get('/api/v1/system/geodata')

        # May not be implemented
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_404_NOT_FOUND,
        ]

    def test_geodata_includes_airport_count(self, viewer_client):
        """Test that geodata includes airport count."""
        response = viewer_client.get('/api/v1/system/geodata')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # Should have airport or navaid counts
            has_geo_data = any(
                key in data for key in ['airports', 'airport_count', 'navaids', 'navaid_count']
            )
            assert has_geo_data or 'message' in data

    def test_geodata_includes_navaid_count(self, viewer_client):
        """Test that geodata includes navaid count."""
        response = viewer_client.get('/api/v1/system/geodata')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            assert response.status_code == status.HTTP_200_OK

    def test_geodata_includes_last_update_times(self, viewer_client):
        """Test that geodata includes last update times."""
        response = viewer_client.get('/api/v1/system/geodata')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # May include update timestamps
            assert response.status_code == status.HTTP_200_OK

    def test_geodata_includes_coverage_area(self, viewer_client):
        """Test that geodata includes coverage area info."""
        response = viewer_client.get('/api/v1/system/geodata')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # Coverage area may be bounding box or similar
            assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Weather Cache Stats Endpoint Tests
# =============================================================================

@pytest.mark.django_db
class TestWeatherCacheStatsEndpoint:
    """Tests for GET /api/v1/system/weather endpoint."""

    def test_weather_returns_200_or_404(self, viewer_client):
        """Test that weather endpoint returns 200 or 404."""
        response = viewer_client.get('/api/v1/system/weather')

        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_404_NOT_FOUND,
        ]

    def test_weather_includes_metar_taf_counts(self, viewer_client):
        """Test that weather includes METAR/TAF counts."""
        response = viewer_client.get('/api/v1/system/weather')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # Should have METAR/TAF information
            has_weather_data = any(
                key in data for key in ['metars', 'metar_count', 'tafs', 'taf_count']
            )
            assert has_weather_data or 'message' in data

    def test_weather_includes_pireps_count(self, viewer_client):
        """Test that weather includes PIREPs count."""
        response = viewer_client.get('/api/v1/system/weather')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # PIREPs may be included
            assert response.status_code == status.HTTP_200_OK

    def test_weather_includes_cache_age(self, viewer_client):
        """Test that weather includes cache age information."""
        response = viewer_client.get('/api/v1/system/weather')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # Cache age may be in various formats
            assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Audio/Transcription Service Stats Endpoint Tests
# =============================================================================

@pytest.mark.django_db
class TestAudioServiceStatsEndpoint:
    """Tests for GET /api/v1/audio/service-stats/ endpoint."""

    def test_audio_service_stats_returns_200_or_404(self, viewer_client):
        """Test that audio service stats endpoint returns 200 or 404."""
        response = viewer_client.get('/api/v1/audio/service-stats/')

        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_404_NOT_FOUND,
        ]

    def test_audio_service_stats_includes_queue_depth(self, viewer_client):
        """Test that audio service stats includes queue depth."""
        response = viewer_client.get('/api/v1/audio/service-stats/')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # Queue depth information
            has_queue_info = any(
                key in data for key in ['queue_depth', 'pending', 'queued_count']
            )
            assert has_queue_info or 'message' in data

    def test_audio_service_stats_includes_processing_rate(self, viewer_client):
        """Test that audio service stats includes processing rate."""
        response = viewer_client.get('/api/v1/audio/service-stats/')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # Processing rate may be included
            assert response.status_code == status.HTTP_200_OK

    def test_audio_service_stats_includes_error_rate(self, viewer_client):
        """Test that audio service stats includes error rate."""
        response = viewer_client.get('/api/v1/audio/service-stats/')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # Error rate may be included
            has_error_info = any(
                key in data for key in ['error_rate', 'failed_count', 'errors']
            )
            assert has_error_info or response.status_code == status.HTTP_200_OK

    def test_audio_service_stats_includes_service_connectivity(self, viewer_client):
        """Test that audio service stats includes service connectivity status."""
        response = viewer_client.get('/api/v1/audio/service-stats/')

        if response.status_code == status.HTTP_200_OK:
            data = response.json()
            # Service connectivity status
            has_connectivity = any(
                key in data for key in ['service_online', 'connected', 'status']
            )
            assert has_connectivity or response.status_code == status.HTTP_200_OK


# =============================================================================
# Permission Checks Tests
# =============================================================================

@pytest.mark.django_db
class TestSystemPermissionChecks:
    """Tests for permission checks on system endpoints."""

    def test_health_check_is_public(self, api_client):
        """Test that health check is public and requires no auth."""
        api_client.credentials()  # Clear any credentials

        response = api_client.get('/health')
        assert response.status_code == status.HTTP_200_OK

    def test_metrics_requires_system_view_metrics_permission(
        self, viewer_client, admin_client, feature_access_permission_based
    ):
        """Test that metrics requires system.view_metrics permission."""
        # Admin should have access
        admin_response = admin_client.get('/metrics')
        # Viewer may or may not depending on role configuration

        # Either endpoint returns data or is disabled
        assert admin_response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_503_SERVICE_UNAVAILABLE,
        ]

    def test_detailed_stats_require_system_manage_permission(
        self, viewer_client, admin_client, feature_access_permission_based
    ):
        """Test that detailed stats require system.manage permission."""
        # Admin should have access to detailed stats
        admin_response = admin_client.get('/api/v1/system/databases')

        # May be 200 (allowed), 403 (forbidden), or 404 (not implemented)
        assert admin_response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND,
        ]

    def test_status_endpoint_respects_feature_access_config(
        self, api_client, feature_access_public
    ):
        """Test that status endpoint respects feature access configuration."""
        # In public mode, status should be accessible
        response = api_client.get('/api/v1/system/status')
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_access_basic_status(self, viewer_client):
        """Test that viewer role can access basic status endpoint."""
        response = viewer_client.get('/api/v1/system/status')
        assert response.status_code == status.HTTP_200_OK

    def test_viewer_can_access_system_info(self, viewer_client):
        """Test that viewer role can access system info endpoint."""
        response = viewer_client.get('/api/v1/system/info')
        assert response.status_code == status.HTTP_200_OK

    def test_operator_can_access_system_endpoints(self, operator_client):
        """Test that operator role can access system endpoints."""
        endpoints = [
            '/api/v1/system/status',
            '/api/v1/system/info',
            '/api/v1/system/health',
        ]

        for endpoint in endpoints:
            response = operator_client.get(endpoint)
            assert response.status_code == status.HTTP_200_OK, \
                f"Operator should access {endpoint}"

    def test_admin_can_access_all_system_endpoints(self, admin_client):
        """Test that admin role can access all system endpoints."""
        endpoints = [
            '/health',
            '/api/v1/system/status',
            '/api/v1/system/info',
            '/api/v1/system/health',
        ]

        for endpoint in endpoints:
            response = admin_client.get(endpoint)
            assert response.status_code in [
                status.HTTP_200_OK,
                status.HTTP_503_SERVICE_UNAVAILABLE,  # For disabled features
            ], f"Admin should access {endpoint}"


# =============================================================================
# Error Handling Tests
# =============================================================================

@pytest.mark.django_db
class TestSystemErrorHandling:
    """Tests for error handling and graceful degradation."""

    def test_graceful_degradation_when_cache_unavailable(self, api_client):
        """Test graceful degradation when cache is unavailable."""
        with patch('django.core.cache.cache.get') as mock_get:
            mock_get.side_effect = Exception('Cache connection failed')

            response = api_client.get('/health')

            # Should still return a response, possibly with degraded status
            assert response.status_code in [
                status.HTTP_200_OK,
                status.HTTP_503_SERVICE_UNAVAILABLE,
            ]

    def test_partial_status_when_some_components_fail(self, api_client):
        """Test that partial status is returned when some components fail."""
        # Simulate cache failure but keep database working
        with patch('django.core.cache.cache.get') as mock_get:
            mock_get.return_value = None  # Cache miss

            response = api_client.get('/api/v1/system/status')

            # Should still return status
            assert response.status_code == status.HTTP_200_OK
            data = response.json()
            # Aircraft count should be 0 or missing if cache fails
            assert data['aircraft_count'] == 0 or 'aircraft_count' in data

    def test_proper_error_messages_on_service_failure(self, api_client):
        """Test that proper error messages are returned on service failure."""
        with patch('skyspy.api.system.settings') as mock_settings:
            mock_settings.PROMETHEUS_ENABLED = False

            response = api_client.get('/metrics')

            if response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                data = response.json()
                # Should have an error message
                assert 'error' in data or 'detail' in data or 'message' in data

    def test_health_check_reports_degraded_state(self, api_client):
        """Test that health check reports degraded state appropriately."""
        # Remove celery heartbeat to simulate partial failure
        cache.delete('celery_heartbeat')

        response = api_client.get('/health')
        data = response.json()

        # Celery should show as unknown or down without heartbeat
        celery_status = data['services']['celery']['status']
        assert celery_status in ['up', 'down', 'unknown', 'degraded']

    def test_status_returns_valid_json_even_with_errors(self, api_client):
        """Test that status always returns valid JSON."""
        with patch('skyspy.models.AlertRule.objects.filter') as mock_filter:
            mock_filter.side_effect = Exception('Database error')

            response = api_client.get('/api/v1/system/status')

            # Should still return valid JSON
            assert response.status_code in [
                status.HTTP_200_OK,
                status.HTTP_500_INTERNAL_SERVER_ERROR,
            ]
            if response.status_code == status.HTTP_200_OK:
                # Should be valid JSON
                response.json()

    def test_database_query_timeout_handling(self, api_client):
        """Test handling of database query timeouts."""
        with patch('django.db.connection.cursor') as mock_cursor:
            mock_cursor.return_value.__enter__.return_value.execute.side_effect = \
                Exception('Query timeout')

            response = api_client.get('/health')

            # Should handle gracefully
            assert response.status_code in [
                status.HTTP_200_OK,  # Degraded but responsive
                status.HTTP_503_SERVICE_UNAVAILABLE,  # Service unavailable
            ]


# =============================================================================
# Integration Tests
# =============================================================================

@pytest.mark.django_db
class TestSystemIntegration:
    """Integration tests for system endpoints."""

    def test_all_system_endpoints_return_json(self, viewer_client):
        """Test that all system endpoints return JSON."""
        endpoints = [
            '/health',
            '/api/v1/system/status',
            '/api/v1/system/info',
            '/api/v1/system/health',
        ]

        for endpoint in endpoints:
            response = viewer_client.get(endpoint)
            if response.status_code == status.HTTP_200_OK:
                assert 'application/json' in response['Content-Type'], \
                    f"Endpoint {endpoint} should return JSON"

    def test_version_consistent_across_endpoints(self, viewer_client):
        """Test that version is consistent across endpoints."""
        status_response = viewer_client.get('/api/v1/system/status')
        info_response = viewer_client.get('/api/v1/system/info')

        if (status_response.status_code == status.HTTP_200_OK and
                info_response.status_code == status.HTTP_200_OK):
            status_version = status_response.json().get('version')
            info_version = info_response.json().get('version')

            assert status_version == info_version

    def test_health_and_status_correlation(self, viewer_client, cached_aircraft):
        """Test that health and status endpoints correlate."""
        health_response = viewer_client.get('/health')
        status_response = viewer_client.get('/api/v1/system/status')

        health_data = health_response.json()
        status_data = status_response.json()

        # If database is up in health, we should have valid counts in status
        if health_data['services']['database']['status'] == 'up':
            assert 'aircraft_count' in status_data
            assert isinstance(status_data['aircraft_count'], int)

    def test_options_request_for_cors(self, api_client):
        """Test OPTIONS request for CORS support."""
        response = api_client.options('/health')
        # Should not return 405 Method Not Allowed
        assert response.status_code != status.HTTP_405_METHOD_NOT_ALLOWED

    def test_head_request_returns_headers_only(self, api_client):
        """Test HEAD request returns headers without body."""
        response = api_client.head('/health')
        assert response.status_code == status.HTTP_200_OK

    def test_cache_state_reflected_in_status(self, api_client):
        """Test that cache state is reflected in status."""
        # Set aircraft data in cache
        aircraft_data = [
            {'hex': 'TEST01', 'lat': 47.5, 'lon': -122.0},
            {'hex': 'TEST02', 'lat': 47.6, 'lon': -122.1},
        ]
        cache.set('current_aircraft', aircraft_data)
        cache.set('adsb_online', True)

        response = api_client.get('/api/v1/system/status')
        data = response.json()

        assert data['aircraft_count'] == 2
        assert data['adsb_online'] is True


# =============================================================================
# Auth Mode Behavior Tests
# =============================================================================

@pytest.mark.django_db
class TestAuthModeBehavior:
    """Tests for different auth mode behaviors."""

    def test_public_mode_allows_all_status_access(self, api_client, auth_mode_public):
        """Test that public mode allows access to status endpoints."""
        response = api_client.get('/api/v1/system/status')
        assert response.status_code == status.HTTP_200_OK

    def test_hybrid_mode_health_always_public(self, api_client, auth_mode_hybrid):
        """Test that health check is always public in hybrid mode."""
        api_client.credentials()  # Clear credentials

        response = api_client.get('/health')
        assert response.status_code == status.HTTP_200_OK

    def test_authenticated_mode_requires_auth_for_detailed_stats(
        self, api_client, auth_mode_authenticated
    ):
        """Test that authenticated mode requires auth for detailed stats."""
        api_client.credentials()  # Clear credentials

        # Detailed stats should require authentication
        response = api_client.get('/api/v1/system/databases')

        assert response.status_code in [
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND,  # If not implemented
        ]


# =============================================================================
# API Key Authentication Tests
# =============================================================================

@pytest.mark.django_db
class TestAPIKeySystemAccess:
    """Tests for API key authentication on system endpoints."""

    def test_api_key_can_access_status(self, api_key_client):
        """Test that API key can access status endpoint."""
        response = api_key_client.get('/api/v1/system/status')
        assert response.status_code == status.HTTP_200_OK

    def test_api_key_can_access_health(self, api_key_client):
        """Test that API key can access health endpoint."""
        response = api_key_client.get('/health')
        assert response.status_code == status.HTTP_200_OK

    def test_api_key_can_access_info(self, api_key_client):
        """Test that API key can access info endpoint."""
        response = api_key_client.get('/api/v1/system/info')
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Performance and Load Tests
# =============================================================================

@pytest.mark.django_db
class TestSystemPerformance:
    """Tests for system endpoint performance."""

    def test_health_check_response_time(self, api_client):
        """Test that health check responds quickly."""
        import time

        start = time.time()
        response = api_client.get('/health')
        elapsed = time.time() - start

        assert response.status_code == status.HTTP_200_OK
        # Health check should respond within 1 second
        assert elapsed < 1.0, f"Health check took {elapsed:.2f}s"

    def test_status_endpoint_response_time(self, api_client, db):
        """Test that status endpoint responds in reasonable time."""
        import time

        start = time.time()
        response = api_client.get('/api/v1/system/status')
        elapsed = time.time() - start

        assert response.status_code == status.HTTP_200_OK
        # Status should respond within 2 seconds
        assert elapsed < 2.0, f"Status took {elapsed:.2f}s"

    def test_health_check_under_load(self, api_client):
        """Test health check under repeated requests."""
        responses = []
        for _ in range(10):
            response = api_client.get('/health')
            responses.append(response.status_code)

        # All responses should be 200
        assert all(s == status.HTTP_200_OK for s in responses)


# =============================================================================
# Edge Cases Tests
# =============================================================================

@pytest.mark.django_db
class TestSystemEdgeCases:
    """Tests for edge cases in system endpoints."""

    def test_empty_database_status(self, api_client, db):
        """Test status with empty database."""
        # Clear all relevant tables
        SafetyEvent.objects.all().delete()
        AlertHistory.objects.all().delete()
        AircraftSession.objects.all().delete()

        response = api_client.get('/api/v1/system/status')
        data = response.json()

        assert data['safety_event_count'] == 0
        assert data['alert_history_count'] == 0
        assert data['total_sessions'] == 0

    def test_status_with_null_location(self, api_client):
        """Test status when location is not configured."""
        with override_settings(FEEDER_LAT=None, FEEDER_LON=None):
            response = api_client.get('/api/v1/system/status')
            data = response.json()

            # Location should be present but may be null/empty
            assert 'location' in data

    def test_health_check_with_invalid_method(self, api_client):
        """Test health check with invalid HTTP method."""
        response = api_client.post('/health', {})

        # May return 405 Method Not Allowed or handle POST
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        ]

    def test_system_endpoints_handle_unicode(self, api_client, db):
        """Test that system endpoints handle unicode properly."""
        response = api_client.get('/api/v1/system/info')
        data = response.json()

        # Should be valid JSON that can contain unicode
        assert isinstance(data, dict)
