"""
End-to-end tests for system API endpoints.

Tests for:
- HealthCheckView (/health, /api/v1/system/health)
- StatusView (/api/v1/system/status)
- SystemInfoView (/api/v1/system/info)
- MetricsView (/metrics)

Public-deploy contract: anonymous callers get liveness/sanitized responses only;
the per-service health breakdown, sensitive status fields (feeder location, PID,
tasks), the API-surface catalog (/system/info) and Prometheus metrics require
authentication.
"""

from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient, APITestCase


def _superuser():
    User = get_user_model()
    return User.objects.create_superuser(username="admin-sys", password="pw", email="a@b.co")


class HealthCheckViewTests(APITestCase):
    """Tests for the HealthCheckView endpoint."""

    def setUp(self):
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_health_check_returns_200(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_health_check_with_trailing_slash(self):
        response = self.client.get("/health/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_health_check_anonymous_is_minimal(self):
        """Anonymous callers get liveness only — no service topology leak."""
        response = self.client.get("/health")
        data = response.json()
        self.assertIn("status", data)
        self.assertIn("timestamp", data)
        self.assertNotIn("services", data)

    def test_health_check_authenticated_has_services(self):
        """Authenticated callers get the full per-service breakdown."""
        self.client.force_authenticate(user=_superuser())
        response = self.client.get("/health")
        data = response.json()
        services = data["services"]
        self.assertIn("database", services)
        self.assertIn("cache", services)
        self.assertIn("celery", services)

    def test_health_check_database_up(self):
        self.client.force_authenticate(user=_superuser())
        response = self.client.get("/health")
        data = response.json()
        self.assertEqual(data["services"]["database"]["status"], "up")
        self.assertIn("latency_ms", data["services"]["database"])

    def test_health_check_celery_with_heartbeat(self):
        cache.set("celery_heartbeat", True, 60)
        self.client.force_authenticate(user=_superuser())
        response = self.client.get("/health")
        data = response.json()
        self.assertEqual(data["services"]["celery"]["status"], "up")

    def test_health_check_api_v1_endpoint(self):
        response = self.client.get("/api/v1/system/health")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_health_check_no_authentication_required(self):
        self.client.credentials()
        response = self.client.get("/health")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_health_check_timestamp_format(self):
        response = self.client.get("/health")
        data = response.json()
        timestamp = data["timestamp"]
        self.assertTrue(timestamp.endswith("Z"))
        self.assertIn("T", timestamp)


class StatusViewTests(APITestCase):
    """Tests for the StatusView endpoint."""

    def setUp(self):
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_status_returns_200(self):
        response = self.client.get("/api/v1/system/status")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_status_with_trailing_slash(self):
        response = self.client.get("/api/v1/system/status/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_status_response_structure(self):
        """Non-sensitive fields are present for everyone (public Statistics card)."""
        response = self.client.get("/api/v1/system/status")
        data = response.json()
        expected_fields = [
            "version",
            "adsb_online",
            "aircraft_count",
            "total_sightings",
            "total_sessions",
            "active_rules",
            "alert_history_count",
            "safety_event_count",
            "safety_monitoring_enabled",
            "notifications_configured",
            "redis_enabled",
            "polling_interval_seconds",
            "db_store_interval_seconds",
            "celery_running",
        ]
        for field in expected_fields:
            self.assertIn(field, data, f"Missing field: {field}")

    def test_status_hides_sensitive_fields_from_anonymous(self):
        """Feeder location, PID, tasks, connections are not exposed to anon."""
        response = self.client.get("/api/v1/system/status")
        data = response.json()
        for field in ("location", "worker_pid", "celery_tasks", "websocket_connections", "antenna"):
            self.assertNotIn(field, data, f"{field} leaked to anonymous caller")

    def test_status_authenticated_includes_location(self):
        self.client.force_authenticate(user=_superuser())
        response = self.client.get("/api/v1/system/status")
        data = response.json()
        self.assertIn("location", data)
        self.assertIn("latitude", data["location"])
        self.assertIn("longitude", data["location"])
        self.assertIn("worker_pid", data)

    def test_status_version_format(self):
        response = self.client.get("/api/v1/system/status")
        data = response.json()
        self.assertIsInstance(data["version"], str)
        self.assertRegex(data["version"], r"^\d+\.\d+\.\d+")

    def test_status_counts_are_integers(self):
        response = self.client.get("/api/v1/system/status")
        data = response.json()
        for field in (
            "aircraft_count",
            "total_sightings",
            "total_sessions",
            "active_rules",
            "alert_history_count",
            "safety_event_count",
        ):
            self.assertIsInstance(data[field], int, f"{field} should be int")

    def test_status_with_cached_aircraft(self):
        cache.set("current_aircraft", [{"hex": "ABC123"}, {"hex": "DEF456"}])
        response = self.client.get("/api/v1/system/status")
        self.assertEqual(response.json()["aircraft_count"], 2)

    def test_status_adsb_online_from_cache(self):
        cache.set("adsb_online", True)
        response = self.client.get("/api/v1/system/status")
        self.assertTrue(response.json()["adsb_online"])

    def test_status_no_authentication_required(self):
        self.client.credentials()
        response = self.client.get("/api/v1/system/status")
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class SystemInfoViewTests(APITestCase):
    """SystemInfoView now requires authentication (API-surface catalog)."""

    def setUp(self):
        self.client = APIClient()

    def test_info_requires_authentication(self):
        response = self.client.get("/api/v1/system/info")
        self.assertIn(response.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

    def test_info_returns_200_when_authenticated(self):
        self.client.force_authenticate(user=_superuser())
        response = self.client.get("/api/v1/system/info")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_info_response_structure(self):
        self.client.force_authenticate(user=_superuser())
        data = self.client.get("/api/v1/system/info").json()
        self.assertIn("version", data)
        self.assertIn("name", data)
        self.assertIn("description", data)
        self.assertIn("endpoints", data)

    def test_info_endpoints_structure(self):
        self.client.force_authenticate(user=_superuser())
        data = self.client.get("/api/v1/system/info").json()
        for category in ("aircraft", "history", "alerts", "safety", "acars", "audio", "aviation", "map", "system"):
            self.assertIn(category, data["endpoints"], f"Missing category: {category}")


class MetricsViewTests(APITestCase):
    """MetricsView now requires authentication."""

    def setUp(self):
        self.client = APIClient()

    def test_metrics_requires_authentication(self):
        response = self.client.get("/metrics")
        self.assertIn(response.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

    @override_settings(PROMETHEUS_ENABLED=False)
    def test_metrics_returns_503_when_disabled(self):
        self.client.force_authenticate(user=_superuser())
        with patch("skyspy.api.system.settings") as mock_settings:
            mock_settings.PROMETHEUS_ENABLED = False
            response = self.client.get("/metrics")
            self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_metrics_disabled_error_message(self):
        self.client.force_authenticate(user=_superuser())
        with patch("skyspy.api.system.settings") as mock_settings:
            mock_settings.PROMETHEUS_ENABLED = False
            response = self.client.get("/metrics")
            if response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                self.assertIn("error", response.json())


class SystemEndpointsIntegrationTests(APITestCase):
    """Integration tests for system endpoints."""

    def setUp(self):
        self.client = APIClient()
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_public_system_endpoints_accessible(self):
        for endpoint in ("/health", "/api/v1/system/health", "/api/v1/system/status"):
            response = self.client.get(endpoint)
            self.assertIn(
                response.status_code,
                [status.HTTP_200_OK, status.HTTP_503_SERVICE_UNAVAILABLE],
                f"Endpoint {endpoint} returned unexpected status",
            )

    def test_json_content_type(self):
        for endpoint in ("/health", "/api/v1/system/status"):
            response = self.client.get(endpoint)
            self.assertEqual(response["Content-Type"], "application/json", f"{endpoint} should return JSON")

    def test_version_consistency(self):
        self.client.force_authenticate(user=_superuser())
        status_version = self.client.get("/api/v1/system/status").json()["version"]
        info_version = self.client.get("/api/v1/system/info").json()["version"]
        self.assertEqual(status_version, info_version)

    def test_head_request(self):
        response = self.client.head("/health")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
