"""
End-to-end tests for safety API endpoints.

Tests for:
- SafetyEventViewSet
  - list (GET /api/v1/safety/events/)
  - retrieve (GET /api/v1/safety/events/{id}/)
  - stats (GET /api/v1/safety/events/stats/)
  - aircraft (GET /api/v1/safety/events/aircraft/)
  - acknowledge (POST /api/v1/safety/events/{id}/acknowledge/)
  - unacknowledge (DELETE /api/v1/safety/events/{id}/unacknowledge/)
  - delete (DELETE /api/v1/safety/events/{id}/)
"""
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient
from rest_framework import status

from skyspy.models import SafetyEvent


class SafetyEventListViewTests(APITestCase):
    """Tests for the safety events list endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        SafetyEvent.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_list_returns_200(self):
        """Test that list returns 200 OK."""
        response = self.client.get('/api/v1/safety/events/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_list_empty(self):
        """Test list response when no events exist."""
        response = self.client.get('/api/v1/safety/events/')
        data = response.json()

        self.assertIn('events', data)
        self.assertIn('count', data)
        self.assertEqual(data['events'], [])
        self.assertEqual(data['count'], 0)

    def test_list_with_events(self):
        """Test list response with existing events."""
        SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='ABC123',
            callsign='UAL123',
            message='TCAS RA: Climb',
        )
        SafetyEvent.objects.create(
            event_type='extreme_vs',
            severity='warning',
            icao_hex='DEF456',
            message='Extreme vertical speed detected',
        )

        response = self.client.get('/api/v1/safety/events/')
        data = response.json()

        self.assertEqual(data['count'], 2)
        self.assertEqual(len(data['events']), 2)

    def test_list_event_structure(self):
        """Test that events have expected fields."""
        SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='ABC123',
            icao_hex_2='DEF456',
            callsign='UAL123',
            callsign_2='DAL456',
            message='TCAS RA detected',
            details={'altitude_diff': 500},
            acknowledged=False,
        )

        response = self.client.get('/api/v1/safety/events/')
        event = response.json()['events'][0]

        expected_fields = [
            'id', 'event_type', 'severity', 'icao', 'icao_2',
            'callsign', 'callsign_2', 'message', 'details',
            'aircraft_snapshot', 'aircraft_snapshot_2',
            'acknowledged', 'acknowledged_at', 'timestamp'
        ]
        for field in expected_fields:
            self.assertIn(field, event, f"Missing field: {field}")

    def test_list_filter_by_event_type(self):
        """Test filtering events by type."""
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='A')
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='B')
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='C')

        response = self.client.get('/api/v1/safety/events/?event_type=tcas_ra')
        data = response.json()

        self.assertEqual(data['count'], 2)
        for event in data['events']:
            self.assertEqual(event['event_type'], 'tcas_ra')

    def test_list_filter_by_severity(self):
        """Test filtering events by severity."""
        SafetyEvent.objects.create(event_type='tcas_ra', severity='critical', icao_hex='A')
        SafetyEvent.objects.create(event_type='extreme_vs', severity='warning', icao_hex='B')

        response = self.client.get('/api/v1/safety/events/?severity=critical')
        data = response.json()

        self.assertEqual(data['count'], 1)
        self.assertEqual(data['events'][0]['severity'], 'critical')

    def test_list_filter_by_icao(self):
        """Test filtering events by ICAO hex."""
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='ABC123')
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='DEF456')

        response = self.client.get('/api/v1/safety/events/?icao_hex=ABC123')
        data = response.json()

        self.assertEqual(data['count'], 1)
        self.assertEqual(data['events'][0]['icao'], 'ABC123')

    def test_list_filter_by_acknowledged(self):
        """Test filtering events by acknowledged status."""
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='A', acknowledged=True)
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='B', acknowledged=False)

        response = self.client.get('/api/v1/safety/events/?acknowledged=true')
        data = response.json()

        self.assertEqual(data['count'], 1)
        self.assertTrue(data['events'][0]['acknowledged'])

    def test_list_time_filter(self):
        """Test filtering by time range."""
        # Create event outside time range
        old_event = SafetyEvent.objects.create(
            event_type='tcas_ra',
            icao_hex='OLD123',
        )
        old_event.timestamp = timezone.now() - timedelta(hours=48)
        old_event.save()

        # Create recent event
        SafetyEvent.objects.create(
            event_type='extreme_vs',
            icao_hex='NEW123',
        )

        response = self.client.get('/api/v1/safety/events/?hours=24')
        data = response.json()

        self.assertEqual(data['count'], 1)
        self.assertEqual(data['events'][0]['icao'], 'NEW123')

    def test_list_ordered_by_timestamp(self):
        """Test that events are ordered by timestamp descending."""
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='FIRST')
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='SECOND')

        response = self.client.get('/api/v1/safety/events/')
        data = response.json()

        # Most recent should be first
        self.assertEqual(data['events'][0]['icao'], 'SECOND')


class SafetyEventRetrieveViewTests(APITestCase):
    """Tests for retrieving a single safety event."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        SafetyEvent.objects.all().delete()
        self.event = SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='ABC123',
            callsign='UAL123',
            message='TCAS RA: Climb',
        )

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_retrieve_existing_event(self):
        """Test retrieving an existing event."""
        response = self.client.get(f'/api/v1/safety/events/{self.event.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_retrieve_event_data(self):
        """Test that retrieved event has correct data."""
        response = self.client.get(f'/api/v1/safety/events/{self.event.id}/')
        data = response.json()

        self.assertEqual(data['event_type'], 'tcas_ra')
        self.assertEqual(data['severity'], 'critical')
        self.assertEqual(data['icao'], 'ABC123')
        self.assertEqual(data['callsign'], 'UAL123')
        self.assertEqual(data['message'], 'TCAS RA: Climb')

    def test_retrieve_nonexistent_event(self):
        """Test retrieving non-existent event returns 404."""
        response = self.client.get('/api/v1/safety/events/99999/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class SafetyEventStatsViewTests(APITestCase):
    """Tests for the safety events stats endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        SafetyEvent.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_stats_returns_200(self):
        """Test that stats returns 200 OK."""
        response = self.client.get('/api/v1/safety/events/stats/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_stats_response_structure(self):
        """Test that stats response has expected fields."""
        response = self.client.get('/api/v1/safety/events/stats/')
        data = response.json()

        expected_fields = [
            'monitoring_enabled', 'thresholds', 'time_range_hours',
            'events_by_type', 'events_by_severity', 'events_by_type_severity',
            'total_events', 'unique_aircraft', 'event_rate_per_hour',
            'top_aircraft', 'recent_events', 'timestamp'
        ]
        for field in expected_fields:
            self.assertIn(field, data, f"Missing field: {field}")

    def test_stats_thresholds(self):
        """Test that thresholds are included in stats."""
        response = self.client.get('/api/v1/safety/events/stats/')
        data = response.json()

        thresholds = data['thresholds']
        expected_thresholds = [
            'vs_change_threshold', 'vs_extreme_threshold',
            'proximity_nm', 'altitude_diff_ft', 'closure_rate_kt',
            'tcas_vs_threshold'
        ]
        for threshold in expected_thresholds:
            self.assertIn(threshold, thresholds)

    def test_stats_counts_by_type(self):
        """Test that events are counted by type."""
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='A')
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='B')
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='C')

        response = self.client.get('/api/v1/safety/events/stats/')
        data = response.json()

        self.assertEqual(data['events_by_type'].get('tcas_ra', 0), 2)
        self.assertEqual(data['events_by_type'].get('extreme_vs', 0), 1)

    def test_stats_counts_by_severity(self):
        """Test that events are counted by severity."""
        SafetyEvent.objects.create(event_type='tcas_ra', severity='critical', icao_hex='A')
        SafetyEvent.objects.create(event_type='extreme_vs', severity='warning', icao_hex='B')
        SafetyEvent.objects.create(event_type='vs_reversal', severity='warning', icao_hex='C')

        response = self.client.get('/api/v1/safety/events/stats/')
        data = response.json()

        self.assertEqual(data['events_by_severity'].get('critical', 0), 1)
        self.assertEqual(data['events_by_severity'].get('warning', 0), 2)

    def test_stats_unique_aircraft(self):
        """Test unique aircraft count."""
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='ABC123')
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='ABC123')  # Same ICAO
        SafetyEvent.objects.create(event_type='vs_reversal', icao_hex='DEF456')

        response = self.client.get('/api/v1/safety/events/stats/')
        data = response.json()

        self.assertEqual(data['unique_aircraft'], 2)

    def test_stats_total_events(self):
        """Test total events count."""
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='A')
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='B')
        SafetyEvent.objects.create(event_type='vs_reversal', icao_hex='C')

        response = self.client.get('/api/v1/safety/events/stats/')
        data = response.json()

        self.assertEqual(data['total_events'], 3)

    def test_stats_event_rate(self):
        """Test event rate per hour."""
        # Create 24 events for 24 hours = 1 per hour
        for i in range(24):
            SafetyEvent.objects.create(event_type='tcas_ra', icao_hex=f'AC{i}')

        response = self.client.get('/api/v1/safety/events/stats/?hours=24')
        data = response.json()

        self.assertEqual(data['event_rate_per_hour'], 1.0)

    def test_stats_top_aircraft(self):
        """Test top aircraft list."""
        # Create multiple events for same aircraft
        for _ in range(5):
            SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='FREQUENT')
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='SINGLE')

        response = self.client.get('/api/v1/safety/events/stats/')
        data = response.json()

        # FREQUENT should be first in top_aircraft
        self.assertTrue(len(data['top_aircraft']) > 0)
        self.assertEqual(data['top_aircraft'][0]['icao_hex'], 'FREQUENT')
        self.assertEqual(data['top_aircraft'][0]['count'], 5)

    def test_stats_recent_events(self):
        """Test recent events list."""
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='A')
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='B')

        response = self.client.get('/api/v1/safety/events/stats/')
        data = response.json()

        # Should have recent events
        self.assertIsInstance(data['recent_events'], list)

    def test_stats_time_filter(self):
        """Test that stats respect time filter."""
        # Create old event
        old_event = SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='OLD')
        old_event.timestamp = timezone.now() - timedelta(hours=48)
        old_event.save()

        # Create recent event
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='NEW')

        response = self.client.get('/api/v1/safety/events/stats/?hours=24')
        data = response.json()

        self.assertEqual(data['total_events'], 1)


class SafetyEventAircraftStatsViewTests(APITestCase):
    """Tests for the safety events aircraft stats endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        SafetyEvent.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_aircraft_stats_returns_200(self):
        """Test that aircraft stats returns 200 OK."""
        response = self.client.get('/api/v1/safety/events/aircraft/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_aircraft_stats_response_structure(self):
        """Test that response has expected structure."""
        response = self.client.get('/api/v1/safety/events/aircraft/')
        data = response.json()

        self.assertIn('aircraft', data)
        self.assertIn('total_aircraft', data)
        self.assertIn('time_range_hours', data)
        self.assertIn('timestamp', data)

    def test_aircraft_stats_empty(self):
        """Test aircraft stats with no events."""
        response = self.client.get('/api/v1/safety/events/aircraft/')
        data = response.json()

        self.assertEqual(data['aircraft'], [])
        self.assertEqual(data['total_aircraft'], 0)

    def test_aircraft_stats_with_events(self):
        """Test aircraft stats with events."""
        SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='ABC123',
            callsign='UAL123',
        )
        SafetyEvent.objects.create(
            event_type='extreme_vs',
            severity='warning',
            icao_hex='ABC123',
            callsign='UAL123',
        )

        response = self.client.get('/api/v1/safety/events/aircraft/')
        data = response.json()

        self.assertEqual(data['total_aircraft'], 1)
        self.assertEqual(len(data['aircraft']), 1)

        aircraft = data['aircraft'][0]
        self.assertEqual(aircraft['icao_hex'], 'ABC123')
        self.assertEqual(aircraft['total_events'], 2)

    def test_aircraft_stats_structure(self):
        """Test that aircraft stats have expected fields."""
        SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='ABC123',
            callsign='UAL123',
        )

        response = self.client.get('/api/v1/safety/events/aircraft/')
        aircraft = response.json()['aircraft'][0]

        expected_fields = [
            'icao_hex', 'callsign', 'total_events',
            'events_by_type', 'events_by_severity',
            'worst_severity', 'last_event_time', 'last_event_type'
        ]
        for field in expected_fields:
            self.assertIn(field, aircraft, f"Missing field: {field}")

    def test_aircraft_stats_worst_severity(self):
        """Test worst severity calculation."""
        SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='ABC123',
        )
        SafetyEvent.objects.create(
            event_type='extreme_vs',
            severity='warning',
            icao_hex='ABC123',
        )

        response = self.client.get('/api/v1/safety/events/aircraft/')
        aircraft = response.json()['aircraft'][0]

        self.assertEqual(aircraft['worst_severity'], 'critical')

    def test_aircraft_stats_ordered_by_event_count(self):
        """Test that aircraft are ordered by event count."""
        for _ in range(5):
            SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='FREQUENT')
        for _ in range(2):
            SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='MODERATE')
        SafetyEvent.objects.create(event_type='vs_reversal', icao_hex='RARE')

        response = self.client.get('/api/v1/safety/events/aircraft/')
        data = response.json()

        self.assertEqual(data['aircraft'][0]['icao_hex'], 'FREQUENT')
        self.assertEqual(data['aircraft'][0]['total_events'], 5)


class SafetyEventAcknowledgeViewTests(APITestCase):
    """Tests for the safety event acknowledge endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        SafetyEvent.objects.all().delete()
        self.event = SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='ABC123',
            acknowledged=False,
        )

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_acknowledge_event(self):
        """Test acknowledging an event."""
        response = self.client.post(f'/api/v1/safety/events/{self.event.id}/acknowledge/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.event.refresh_from_db()
        self.assertTrue(self.event.acknowledged)

    def test_acknowledge_sets_timestamp(self):
        """Test that acknowledge sets acknowledged_at timestamp."""
        self.assertIsNone(self.event.acknowledged_at)

        self.client.post(f'/api/v1/safety/events/{self.event.id}/acknowledge/')

        self.event.refresh_from_db()
        self.assertIsNotNone(self.event.acknowledged_at)

    def test_acknowledge_returns_event(self):
        """Test that acknowledge returns the updated event."""
        response = self.client.post(f'/api/v1/safety/events/{self.event.id}/acknowledge/')
        data = response.json()

        self.assertTrue(data['acknowledged'])
        self.assertIsNotNone(data['acknowledged_at'])

    def test_acknowledge_nonexistent_event(self):
        """Test acknowledging non-existent event returns 404."""
        response = self.client.post('/api/v1/safety/events/99999/acknowledge/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_acknowledge_already_acknowledged(self):
        """Test acknowledging an already acknowledged event."""
        self.event.acknowledged = True
        self.event.acknowledged_at = timezone.now()
        self.event.save()

        response = self.client.post(f'/api/v1/safety/events/{self.event.id}/acknowledge/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Should still be acknowledged
        self.event.refresh_from_db()
        self.assertTrue(self.event.acknowledged)


class SafetyEventUnacknowledgeViewTests(APITestCase):
    """Tests for the safety event unacknowledge endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        SafetyEvent.objects.all().delete()
        self.event = SafetyEvent.objects.create(
            event_type='tcas_ra',
            severity='critical',
            icao_hex='ABC123',
            acknowledged=True,
            acknowledged_at=timezone.now(),
        )

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_unacknowledge_event(self):
        """Test unacknowledging an event."""
        response = self.client.delete(f'/api/v1/safety/events/{self.event.id}/unacknowledge/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.event.refresh_from_db()
        self.assertFalse(self.event.acknowledged)

    def test_unacknowledge_clears_timestamp(self):
        """Test that unacknowledge clears acknowledged_at timestamp."""
        self.assertIsNotNone(self.event.acknowledged_at)

        self.client.delete(f'/api/v1/safety/events/{self.event.id}/unacknowledge/')

        self.event.refresh_from_db()
        self.assertIsNone(self.event.acknowledged_at)

    def test_unacknowledge_returns_event(self):
        """Test that unacknowledge returns the updated event."""
        response = self.client.delete(f'/api/v1/safety/events/{self.event.id}/unacknowledge/')
        data = response.json()

        self.assertFalse(data['acknowledged'])
        self.assertIsNone(data['acknowledged_at'])

    def test_unacknowledge_nonexistent_event(self):
        """Test unacknowledging non-existent event returns 404."""
        response = self.client.delete('/api/v1/safety/events/99999/unacknowledge/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class SafetyEventDeleteViewTests(APITestCase):
    """Tests for deleting safety events."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        SafetyEvent.objects.all().delete()
        self.event = SafetyEvent.objects.create(
            event_type='tcas_ra',
            icao_hex='ABC123',
        )

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_delete_event(self):
        """Test deleting an event."""
        response = self.client.delete(f'/api/v1/safety/events/{self.event.id}/')
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_delete_removes_from_db(self):
        """Test that delete removes event from database."""
        event_id = self.event.id
        self.client.delete(f'/api/v1/safety/events/{event_id}/')

        self.assertFalse(SafetyEvent.objects.filter(id=event_id).exists())

    def test_delete_nonexistent_event(self):
        """Test deleting non-existent event returns 404."""
        response = self.client.delete('/api/v1/safety/events/99999/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class SafetyEventValidationTests(APITestCase):
    """Tests for safety event validation."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        SafetyEvent.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_event_types(self):
        """Test that all event types are valid."""
        valid_types = [
            'tcas_ra', 'tcas_ta', 'extreme_vs', 'vs_reversal',
            'proximity_conflict', 'emergency_squawk', '7500', '7600', '7700'
        ]

        for event_type in valid_types:
            event = SafetyEvent.objects.create(
                event_type=event_type,
                icao_hex='TEST123',
            )
            self.assertEqual(event.event_type, event_type)

    def test_severity_levels(self):
        """Test that all severity levels are valid."""
        valid_severities = ['info', 'warning', 'critical']

        for severity in valid_severities:
            event = SafetyEvent.objects.create(
                event_type='tcas_ra',
                severity=severity,
                icao_hex='TEST123',
            )
            self.assertEqual(event.severity, severity)


class SafetyEventsIntegrationTests(APITestCase):
    """Integration tests for safety events endpoints."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        SafetyEvent.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_acknowledge_workflow(self):
        """Test complete acknowledge/unacknowledge workflow."""
        # Create event
        event = SafetyEvent.objects.create(
            event_type='tcas_ra',
            icao_hex='ABC123',
            acknowledged=False,
        )

        # Acknowledge
        ack_response = self.client.post(f'/api/v1/safety/events/{event.id}/acknowledge/')
        self.assertEqual(ack_response.status_code, status.HTTP_200_OK)
        self.assertTrue(ack_response.json()['acknowledged'])

        # Verify in list
        list_response = self.client.get('/api/v1/safety/events/?acknowledged=true')
        self.assertEqual(list_response.json()['count'], 1)

        # Unacknowledge
        unack_response = self.client.delete(f'/api/v1/safety/events/{event.id}/unacknowledge/')
        self.assertEqual(unack_response.status_code, status.HTTP_200_OK)
        self.assertFalse(unack_response.json()['acknowledged'])

        # Verify in list
        list_response = self.client.get('/api/v1/safety/events/?acknowledged=false')
        self.assertEqual(list_response.json()['count'], 1)

    def test_stats_consistency(self):
        """Test that stats are consistent with list data."""
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='A')
        SafetyEvent.objects.create(event_type='extreme_vs', icao_hex='B')
        SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='C')

        list_response = self.client.get('/api/v1/safety/events/')
        stats_response = self.client.get('/api/v1/safety/events/stats/')

        list_count = list_response.json()['count']
        stats_total = stats_response.json()['total_events']

        self.assertEqual(list_count, stats_total)

    def test_all_endpoints_return_json(self):
        """Test that all endpoints return JSON."""
        event = SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='ABC123')

        endpoints = [
            '/api/v1/safety/events/',
            f'/api/v1/safety/events/{event.id}/',
            '/api/v1/safety/events/stats/',
            '/api/v1/safety/events/aircraft/',
        ]

        for endpoint in endpoints:
            response = self.client.get(endpoint)
            self.assertEqual(
                response['Content-Type'],
                'application/json',
                f"Endpoint {endpoint} should return JSON"
            )

    def test_no_authentication_required(self):
        """Test that no authentication is required."""
        self.client.credentials()

        event = SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='ABC123')

        endpoints = [
            '/api/v1/safety/events/',
            f'/api/v1/safety/events/{event.id}/',
            '/api/v1/safety/events/stats/',
            '/api/v1/safety/events/aircraft/',
        ]

        for endpoint in endpoints:
            response = self.client.get(endpoint)
            self.assertNotIn(
                response.status_code,
                [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN],
                f"{endpoint} should not require authentication"
            )

    def test_http_methods_restricted(self):
        """Test that only allowed HTTP methods work."""
        # POST should not be allowed on list endpoint (events are created by system)
        # Note: SafetyEventViewSet has http_method_names = ['get', 'post', 'delete']
        # POST is for acknowledge action, not creating events via list
        event = SafetyEvent.objects.create(event_type='tcas_ra', icao_hex='ABC123')

        # PUT should not be allowed
        response = self.client.put(
            f'/api/v1/safety/events/{event.id}/',
            {'event_type': 'extreme_vs'},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
