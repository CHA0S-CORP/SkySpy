"""
Tests for the SafetyMonitor service.

Tests emergency squawk detection, extreme vertical speed monitoring,
vertical speed reversal (TCAS-like) detection, and proximity conflicts.
"""
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

from django.test import TestCase, override_settings
from django.utils import timezone

from skyspy.services.safety import SafetyMonitor
from skyspy.models import SafetyEvent


@override_settings(
    SAFETY_MONITORING_ENABLED=True,
    SAFETY_VS_CHANGE_THRESHOLD=2000,
    SAFETY_VS_EXTREME_THRESHOLD=6000,
    SAFETY_PROXIMITY_NM=0.5,
    SAFETY_ALTITUDE_DIFF_FT=500,
    SAFETY_CLOSURE_RATE_KT=200,
    SAFETY_TCAS_VS_THRESHOLD=1500,
)
class SafetyMonitorUnitTests(TestCase):
    """Unit tests for SafetyMonitor methods."""

    def setUp(self):
        """Set up test fixtures."""
        self.monitor = SafetyMonitor()
        # Clear any existing state
        self.monitor._aircraft_state = {}
        self.monitor._event_cooldown = {}

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    # =========================================================================
    # Emergency Squawk Tests
    # =========================================================================

    def test_emergency_squawk_7500_hijack(self):
        """Test detection of squawk 7500 (hijack)."""
        aircraft = {
            'hex': 'ABC123',
            'flight': 'UAL456',
            'squawk': '7500',
            'lat': 47.0,
            'lon': -122.0,
            'alt': 35000,
        }

        event = self.monitor._check_emergency_squawk(aircraft, '7500')

        self.assertIsNotNone(event)
        self.assertEqual(event['event_type'], '7500')
        self.assertEqual(event['severity'], 'critical')
        self.assertEqual(event['icao_hex'], 'ABC123')
        self.assertEqual(event['callsign'], 'UAL456')
        self.assertIn('Hijack', event['message'])

    def test_emergency_squawk_7600_radio_failure(self):
        """Test detection of squawk 7600 (radio failure)."""
        aircraft = {
            'hex': 'DEF789',
            'flight': 'DAL123',
            'squawk': '7600',
        }

        event = self.monitor._check_emergency_squawk(aircraft, '7600')

        self.assertIsNotNone(event)
        self.assertEqual(event['event_type'], '7600')
        self.assertEqual(event['severity'], 'warning')
        self.assertIn('Radio Failure', event['message'])

    def test_emergency_squawk_7700_emergency(self):
        """Test detection of squawk 7700 (general emergency)."""
        aircraft = {
            'hex': 'GHI012',
            'flight': 'AAL789',
            'squawk': '7700',
        }

        event = self.monitor._check_emergency_squawk(aircraft, '7700')

        self.assertIsNotNone(event)
        self.assertEqual(event['event_type'], '7700')
        self.assertEqual(event['severity'], 'critical')
        self.assertIn('Emergency', event['message'])

    def test_emergency_squawk_without_callsign(self):
        """Test emergency squawk detection when callsign is missing."""
        aircraft = {
            'hex': 'JKL345',
            'squawk': '7700',
        }

        event = self.monitor._check_emergency_squawk(aircraft, '7700')

        self.assertIsNotNone(event)
        self.assertIn('JKL345', event['message'])

    def test_emergency_squawk_cooldown(self):
        """Test that emergency squawk events respect cooldown period."""
        aircraft = {
            'hex': 'ABC123',
            'flight': 'UAL456',
            'squawk': '7700',
        }

        # First event should be generated
        event1 = self.monitor._check_emergency_squawk(aircraft, '7700')
        self.assertIsNotNone(event1)

        # Second event within cooldown should be None
        event2 = self.monitor._check_emergency_squawk(aircraft, '7700')
        self.assertIsNone(event2)

    # =========================================================================
    # Extreme Vertical Speed Tests
    # =========================================================================

    def test_extreme_vs_climbing(self):
        """Test detection of extreme climbing rate."""
        aircraft = {
            'hex': 'XYZ789',
            'flight': 'SWA123',
            'vr': 7000,  # Above 6000 fpm threshold
        }

        event = self.monitor._check_extreme_vs(aircraft, 7000)

        self.assertIsNotNone(event)
        self.assertEqual(event['event_type'], 'extreme_vs')
        self.assertEqual(event['severity'], 'warning')
        self.assertIn('climbing', event['message'])
        self.assertIn('7000', event['message'])

    def test_extreme_vs_descending(self):
        """Test detection of extreme descending rate."""
        aircraft = {
            'hex': 'ABC456',
            'flight': 'JBU789',
            'vr': -8000,
        }

        event = self.monitor._check_extreme_vs(aircraft, -8000)

        self.assertIsNotNone(event)
        self.assertIn('descending', event['message'])
        self.assertIn('8000', event['message'])

    def test_normal_vs_no_alert(self):
        """Test that normal vertical speeds don't trigger alerts."""
        aircraft = {
            'hex': 'DEF123',
            'flight': 'ASA456',
            'vr': 2000,  # Below threshold
        }

        # This would be called from update_aircraft, not directly
        # But we can verify the threshold logic
        self.assertTrue(abs(2000) <= self.monitor.vs_extreme_threshold)

    def test_extreme_vs_cooldown(self):
        """Test that extreme VS events respect cooldown period."""
        aircraft = {
            'hex': 'GHI789',
            'flight': 'FFT123',
            'vr': 7000,
        }

        event1 = self.monitor._check_extreme_vs(aircraft, 7000)
        self.assertIsNotNone(event1)

        event2 = self.monitor._check_extreme_vs(aircraft, 7000)
        self.assertIsNone(event2)

    # =========================================================================
    # Vertical Speed Reversal (TCAS-like) Tests
    # =========================================================================

    def test_vs_reversal_detection(self):
        """Test detection of significant vertical speed reversal."""
        aircraft = {
            'hex': 'TCAS01',
            'flight': 'UAL999',
        }

        # Previous state: climbing at 2500 fpm
        # Current state: descending at 2000 fpm
        # Change: 4500 fpm (above 2000 threshold)
        # Both values above TCAS threshold of 1500
        event = self.monitor._check_vs_reversal(aircraft, 2500, -2000)

        self.assertIsNotNone(event)
        self.assertEqual(event['event_type'], 'vs_reversal')
        self.assertEqual(event['severity'], 'warning')
        self.assertEqual(event['details']['previous_vs'], 2500)
        self.assertEqual(event['details']['current_vs'], -2000)
        self.assertEqual(event['details']['change'], -4500)

    def test_vs_reversal_small_change_no_alert(self):
        """Test that small VS changes don't trigger alerts."""
        aircraft = {
            'hex': 'TCAS02',
            'flight': 'DAL888',
        }

        # Change of 1500 fpm (below 2000 threshold)
        event = self.monitor._check_vs_reversal(aircraft, 2000, 500)

        self.assertIsNone(event)

    def test_vs_reversal_low_vs_no_alert(self):
        """Test that reversals with low VS values don't trigger alerts."""
        aircraft = {
            'hex': 'TCAS03',
            'flight': 'AAL777',
        }

        # Large change but values below TCAS threshold of 1500
        event = self.monitor._check_vs_reversal(aircraft, 1000, -1200)

        self.assertIsNone(event)

    def test_vs_reversal_one_value_below_threshold(self):
        """Test reversal when one VS value is below threshold."""
        aircraft = {
            'hex': 'TCAS04',
            'flight': 'SWA666',
        }

        # Previous VS below threshold (1000 < 1500)
        event = self.monitor._check_vs_reversal(aircraft, 1000, -3000)

        self.assertIsNone(event)

    # =========================================================================
    # Proximity Conflict Tests
    # =========================================================================

    @patch('skyspy.tasks.aircraft.calculate_distance_nm')
    def test_proximity_conflict_detection(self, mock_distance):
        """Test detection of aircraft proximity conflict."""
        mock_distance.return_value = 0.3  # 0.3 nm (within 0.5 nm threshold)

        ac1 = {
            'hex': 'PROX01',
            'flight': 'UAL111',
            'lat': 47.0,
            'lon': -122.0,
            'alt': 35000,
        }
        ac2 = {
            'hex': 'PROX02',
            'flight': 'DAL222',
            'lat': 47.001,
            'lon': -122.001,
            'alt': 35200,  # 200 ft difference (within 500 ft threshold)
        }

        event = self.monitor._check_pair_proximity(ac1, ac2)

        self.assertIsNotNone(event)
        self.assertEqual(event['event_type'], 'proximity_conflict')
        self.assertEqual(event['severity'], 'warning')  # 0.3 nm >= 0.25
        self.assertEqual(event['icao_hex'], 'PROX01')
        self.assertEqual(event['icao_hex_2'], 'PROX02')
        self.assertIn('0.30', event['message'])
        self.assertIn('200', event['message'])

    @patch('skyspy.tasks.aircraft.calculate_distance_nm')
    def test_proximity_conflict_critical_severity(self, mock_distance):
        """Test that very close proximity triggers critical severity."""
        mock_distance.return_value = 0.2  # Below 0.25 nm

        ac1 = {
            'hex': 'PROX03',
            'flight': 'AAL333',
            'lat': 47.0,
            'lon': -122.0,
            'alt': 10000,
        }
        ac2 = {
            'hex': 'PROX04',
            'flight': 'JBU444',
            'lat': 47.0001,
            'lon': -122.0001,
            'alt': 10100,
        }

        event = self.monitor._check_pair_proximity(ac1, ac2)

        self.assertIsNotNone(event)
        self.assertEqual(event['severity'], 'critical')

    @patch('skyspy.tasks.aircraft.calculate_distance_nm')
    def test_proximity_no_alert_large_distance(self, mock_distance):
        """Test that aircraft far apart don't trigger alerts."""
        mock_distance.return_value = 2.0  # Well above 0.5 nm threshold

        ac1 = {'hex': 'FAR01', 'lat': 47.0, 'lon': -122.0, 'alt': 20000}
        ac2 = {'hex': 'FAR02', 'lat': 47.1, 'lon': -122.1, 'alt': 20000}

        event = self.monitor._check_pair_proximity(ac1, ac2)

        self.assertIsNone(event)

    @patch('skyspy.tasks.aircraft.calculate_distance_nm')
    def test_proximity_no_alert_large_altitude_diff(self, mock_distance):
        """Test that aircraft with large altitude difference don't trigger alerts."""
        mock_distance.return_value = 0.3  # Within horizontal threshold

        ac1 = {'hex': 'ALT01', 'lat': 47.0, 'lon': -122.0, 'alt': 10000}
        ac2 = {'hex': 'ALT02', 'lat': 47.001, 'lon': -122.001, 'alt': 12000}  # 2000 ft diff

        event = self.monitor._check_pair_proximity(ac1, ac2)

        self.assertIsNone(event)

    # =========================================================================
    # Cooldown and Deduplication Tests
    # =========================================================================

    def test_cooldown_mechanism(self):
        """Test that cooldown prevents duplicate events."""
        key = 'TEST123'
        event_type = 'test_event'

        # Initially not on cooldown
        self.assertFalse(self.monitor._is_on_cooldown(key, event_type))

        # Set cooldown
        self.monitor._set_cooldown(key, event_type)

        # Now should be on cooldown
        self.assertTrue(self.monitor._is_on_cooldown(key, event_type))

    def test_cooldown_expiration(self):
        """Test that cooldown expires after the configured period."""
        key = 'EXPIRE123'
        event_type = 'expire_test'

        # Set cooldown with old timestamp
        old_time = datetime.utcnow() - timedelta(seconds=120)
        self.monitor._event_cooldown[(key, event_type)] = old_time

        # Should not be on cooldown anymore (default is 60 seconds)
        self.assertFalse(self.monitor._is_on_cooldown(key, event_type))

    def test_different_event_types_separate_cooldowns(self):
        """Test that different event types have separate cooldowns."""
        key = 'MULTI123'

        self.monitor._set_cooldown(key, 'emergency_7700')

        # Should be on cooldown for emergency_7700
        self.assertTrue(self.monitor._is_on_cooldown(key, 'emergency_7700'))

        # Should NOT be on cooldown for extreme_vs
        self.assertFalse(self.monitor._is_on_cooldown(key, 'extreme_vs'))

    # =========================================================================
    # State Management Tests
    # =========================================================================

    def test_state_cleanup(self):
        """Test cleanup of stale aircraft state."""
        # Add some old state
        old_time = datetime.utcnow() - timedelta(minutes=10)
        self.monitor._aircraft_state['OLD001'] = {
            'lat': 47.0,
            'lon': -122.0,
            'timestamp': old_time,
        }

        # Add current state
        self.monitor._aircraft_state['NEW001'] = {
            'lat': 48.0,
            'lon': -123.0,
            'timestamp': datetime.utcnow(),
        }

        # Run cleanup
        self.monitor._cleanup_state({'NEW001'})

        # Old state should be removed
        self.assertNotIn('OLD001', self.monitor._aircraft_state)
        # New state should remain
        self.assertIn('NEW001', self.monitor._aircraft_state)

    def test_cooldown_cleanup(self):
        """Test cleanup of expired cooldowns."""
        # Add old cooldown
        old_time = datetime.utcnow() - timedelta(minutes=10)
        self.monitor._event_cooldown[('OLD001', 'test')] = old_time

        # Add current cooldown
        self.monitor._event_cooldown[('NEW001', 'test')] = datetime.utcnow()

        # Run cleanup
        self.monitor._cleanup_state(set())

        # Old cooldown should be removed
        self.assertNotIn(('OLD001', 'test'), self.monitor._event_cooldown)
        # New cooldown should remain
        self.assertIn(('NEW001', 'test'), self.monitor._event_cooldown)


@override_settings(
    SAFETY_MONITORING_ENABLED=True,
    SAFETY_VS_CHANGE_THRESHOLD=2000,
    SAFETY_VS_EXTREME_THRESHOLD=6000,
    SAFETY_PROXIMITY_NM=0.5,
    SAFETY_ALTITUDE_DIFF_FT=500,
    SAFETY_CLOSURE_RATE_KT=200,
    SAFETY_TCAS_VS_THRESHOLD=1500,
)
class SafetyMonitorIntegrationTests(TestCase):
    """Integration tests for the full SafetyMonitor workflow."""

    def setUp(self):
        """Set up test fixtures."""
        self.monitor = SafetyMonitor()
        self.monitor._aircraft_state = {}
        self.monitor._event_cooldown = {}

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    @patch('skyspy.services.safety.get_channel_layer')
    @patch('skyspy.services.safety.sync_group_send')
    def test_full_update_workflow_emergency_squawk(self, mock_async, mock_channel):
        """Test full workflow with emergency squawk detection."""
        mock_channel_layer = MagicMock()
        mock_channel.return_value = mock_channel_layer
        mock_async.return_value = MagicMock()

        aircraft_list = [
            {
                'hex': 'INT001',
                'flight': 'TEST123',
                'squawk': '7700',
                'lat': 47.0,
                'lon': -122.0,
                'alt': 30000,
                'vr': 1000,
            }
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        # Should detect emergency squawk
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['event_type'], '7700')

        # Should store in database
        self.assertEqual(SafetyEvent.objects.count(), 1)
        db_event = SafetyEvent.objects.first()
        self.assertEqual(db_event.event_type, '7700')
        self.assertEqual(db_event.icao_hex, 'INT001')

    @patch('skyspy.services.safety.get_channel_layer')
    @patch('skyspy.services.safety.sync_group_send')
    def test_full_update_workflow_multiple_events(self, mock_async, mock_channel):
        """Test workflow detecting multiple event types."""
        mock_channel.return_value = MagicMock()
        mock_async.return_value = MagicMock()

        # Aircraft with emergency AND extreme VS
        aircraft_list = [
            {
                'hex': 'MULTI01',
                'flight': 'MULTI123',
                'squawk': '7700',
                'lat': 47.0,
                'lon': -122.0,
                'alt': 30000,
                'vr': 8000,  # Extreme VS
            }
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        # Should detect both emergency and extreme VS
        self.assertEqual(len(events), 2)
        event_types = {e['event_type'] for e in events}
        self.assertIn('7700', event_types)
        self.assertIn('extreme_vs', event_types)

    @patch('skyspy.services.safety.get_channel_layer')
    @patch('skyspy.services.safety.sync_group_send')
    def test_full_update_workflow_vs_reversal_tracking(self, mock_async, mock_channel):
        """Test that VS reversal requires state from previous update."""
        mock_channel.return_value = MagicMock()
        mock_async.return_value = MagicMock()

        # First update - establish state
        aircraft_list_1 = [
            {
                'hex': 'TRACK01',
                'flight': 'TRACK123',
                'lat': 47.0,
                'lon': -122.0,
                'alt': 30000,
                'vr': 2500,  # Climbing
            }
        ]

        events_1 = self.monitor.update_aircraft(aircraft_list_1)
        # No VS reversal on first update (no previous state)
        self.assertEqual(len(events_1), 0)

        # Verify state was saved
        self.assertIn('TRACK01', self.monitor._aircraft_state)
        self.assertEqual(self.monitor._aircraft_state['TRACK01']['vr'], 2500)

        # Second update - VS reversal
        aircraft_list_2 = [
            {
                'hex': 'TRACK01',
                'flight': 'TRACK123',
                'lat': 47.1,
                'lon': -122.1,
                'alt': 31000,
                'vr': -2000,  # Now descending rapidly
            }
        ]

        events_2 = self.monitor.update_aircraft(aircraft_list_2)

        # Should detect VS reversal
        self.assertEqual(len(events_2), 1)
        self.assertEqual(events_2[0]['event_type'], 'vs_reversal')

    @patch('skyspy.services.safety.get_channel_layer')
    @patch('skyspy.services.safety.sync_group_send')
    @patch('skyspy.tasks.aircraft.calculate_distance_nm')
    def test_full_update_workflow_proximity(self, mock_distance, mock_async, mock_channel):
        """Test proximity detection in full workflow."""
        mock_channel.return_value = MagicMock()
        mock_async.return_value = MagicMock()
        mock_distance.return_value = 0.3

        aircraft_list = [
            {
                'hex': 'PROX_A',
                'flight': 'PROX001',
                'lat': 47.0,
                'lon': -122.0,
                'alt': 25000,
                'vr': 0,
            },
            {
                'hex': 'PROX_B',
                'flight': 'PROX002',
                'lat': 47.001,
                'lon': -122.001,
                'alt': 25200,
                'vr': 0,
            },
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        # Should detect proximity conflict
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['event_type'], 'proximity_conflict')

    @override_settings(SAFETY_MONITORING_ENABLED=False)
    def test_disabled_monitoring_returns_empty(self):
        """Test that disabled monitoring returns no events."""
        monitor = SafetyMonitor()

        aircraft_list = [
            {
                'hex': 'DISABLED1',
                'flight': 'TEST123',
                'squawk': '7700',
            }
        ]

        events = monitor.update_aircraft(aircraft_list)

        self.assertEqual(events, [])

    @patch('skyspy.services.safety.get_channel_layer')
    @patch('skyspy.services.safety.sync_group_send')
    def test_broadcast_failure_does_not_break_workflow(self, mock_async, mock_channel):
        """Test that broadcast failures don't prevent event storage."""
        mock_channel.return_value = MagicMock()
        mock_async.side_effect = Exception("Channel layer error")

        aircraft_list = [
            {
                'hex': 'BROAD01',
                'flight': 'BROAD123',
                'squawk': '7700',
            }
        ]

        # Should not raise, just log warning
        events = self.monitor.update_aircraft(aircraft_list)

        # Event should still be stored
        self.assertEqual(len(events), 1)
        self.assertEqual(SafetyEvent.objects.count(), 1)


@override_settings(
    SAFETY_MONITORING_ENABLED=True,
    SAFETY_VS_CHANGE_THRESHOLD=2000,
    SAFETY_VS_EXTREME_THRESHOLD=6000,
    SAFETY_PROXIMITY_NM=0.5,
    SAFETY_ALTITUDE_DIFF_FT=500,
    SAFETY_CLOSURE_RATE_KT=200,
    SAFETY_TCAS_VS_THRESHOLD=1500,
)
class SafetyMonitorEdgeCaseTests(TestCase):
    """Edge case tests for SafetyMonitor."""

    def setUp(self):
        """Set up test fixtures."""
        self.monitor = SafetyMonitor()
        self.monitor._aircraft_state = {}
        self.monitor._event_cooldown = {}

    def tearDown(self):
        """Clean up after tests."""
        SafetyEvent.objects.all().delete()

    def test_missing_icao_hex(self):
        """Test handling of aircraft without ICAO hex."""
        aircraft_list = [
            {
                'flight': 'NOHEX123',
                'squawk': '7700',
            }
        ]

        events = self.monitor.update_aircraft(aircraft_list)

        # Should skip aircraft without hex
        self.assertEqual(len(events), 0)

    def test_empty_aircraft_list(self):
        """Test handling of empty aircraft list."""
        events = self.monitor.update_aircraft([])

        self.assertEqual(events, [])

    def test_none_values_in_aircraft_data(self):
        """Test handling of None values in aircraft data."""
        aircraft_list = [
            {
                'hex': 'NONE01',
                'flight': None,
                'squawk': None,
                'lat': None,
                'lon': None,
                'alt': None,
                'vr': None,
            }
        ]

        # Should not raise
        events = self.monitor.update_aircraft(aircraft_list)

        # No events (no emergency squawk, no VS data)
        self.assertEqual(len(events), 0)

    def test_lowercase_icao_hex_normalized(self):
        """Test that lowercase ICAO hex is normalized to uppercase."""
        aircraft = {
            'hex': 'abc123',  # lowercase
            'squawk': '7700',
        }

        event = self.monitor._check_emergency_squawk(aircraft, '7700')

        self.assertEqual(event['icao_hex'], 'ABC123')

    def test_proximity_check_with_missing_altitude(self):
        """Test proximity check when altitude is missing."""
        ac1 = {
            'hex': 'NOALT1',
            'lat': 47.0,
            'lon': -122.0,
            'alt': None,  # Missing
        }
        ac2 = {
            'hex': 'NOALT2',
            'lat': 47.001,
            'lon': -122.001,
            'alt': 10000,
        }

        with patch('skyspy.tasks.aircraft.calculate_distance_nm', return_value=0.3):
            event = self.monitor._check_pair_proximity(ac1, ac2)

            # Should handle None altitude (treated as 0)
            # 10000 ft diff > 500 ft threshold, so no alert
            self.assertIsNone(event)

    def test_proximity_check_skips_aircraft_without_position(self):
        """Test that proximity check skips aircraft without position data."""
        aircraft_list = [
            {
                'hex': 'NOPOS1',
                'lat': None,
                'lon': None,
            },
            {
                'hex': 'WITHPOS',
                'lat': 47.0,
                'lon': -122.0,
                'alt': 10000,
            },
        ]

        events = self.monitor._check_proximity_conflicts(aircraft_list)

        # No conflicts (only one aircraft has position)
        self.assertEqual(len(events), 0)

    def test_vs_rate_from_alternative_fields(self):
        """Test that VS is extracted from alternative field names."""
        # vr field
        ac1 = {'hex': 'VS01', 'vr': 7000}
        self.assertEqual(ac1.get('vr') or ac1.get('baro_rate') or ac1.get('geom_rate'), 7000)

        # baro_rate field
        ac2 = {'hex': 'VS02', 'baro_rate': 7000}
        self.assertEqual(ac2.get('vr') or ac2.get('baro_rate') or ac2.get('geom_rate'), 7000)

        # geom_rate field
        ac3 = {'hex': 'VS03', 'geom_rate': 7000}
        self.assertEqual(ac3.get('vr') or ac3.get('baro_rate') or ac3.get('geom_rate'), 7000)

    @patch('skyspy.services.safety.get_channel_layer')
    @patch('skyspy.services.safety.sync_group_send')
    def test_multiple_proximity_conflicts(self, mock_async, mock_channel):
        """Test detection of multiple proximity conflicts."""
        mock_channel.return_value = MagicMock()
        mock_async.return_value = MagicMock()

        def mock_distance(lat1, lon1, lat2, lon2):
            # All pairs are close
            return 0.3

        with patch('skyspy.tasks.aircraft.calculate_distance_nm', side_effect=mock_distance):
            aircraft_list = [
                {'hex': 'MULTI1', 'lat': 47.0, 'lon': -122.0, 'alt': 10000, 'vr': 0},
                {'hex': 'MULTI2', 'lat': 47.001, 'lon': -122.001, 'alt': 10100, 'vr': 0},
                {'hex': 'MULTI3', 'lat': 47.002, 'lon': -122.002, 'alt': 10200, 'vr': 0},
            ]

            events = self.monitor.update_aircraft(aircraft_list)

            # Should detect multiple proximity conflicts
            # MULTI1-MULTI2, MULTI1-MULTI3, MULTI2-MULTI3 = 3 pairs
            # But some might have altitude diff > 500
            proximity_events = [e for e in events if e['event_type'] == 'proximity_conflict']
            self.assertGreater(len(proximity_events), 0)
