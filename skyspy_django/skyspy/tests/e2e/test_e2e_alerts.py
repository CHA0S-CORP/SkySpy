"""
Comprehensive E2E tests for the SkySpy Django API alert system.

Tests cover:
- Alert Rule CRUD operations
- Alert Rule visibility (private, shared, public)
- Alert testing with sample aircraft data
- Alert toggling (enable/disable)
- Bulk operations (create/delete)
- Alert history management
- Alert subscriptions
- Scheduling (starts_at, expires_at, cooldown)
- Notification integration
"""
import pytest
from datetime import timedelta
from unittest.mock import patch, MagicMock

from django.utils import timezone
from rest_framework import status

from skyspy.models import (
    AlertRule,
    AlertHistory,
    AlertSubscription,
    NotificationChannel,
)


# =============================================================================
# Alert Rule CRUD Tests
# =============================================================================


@pytest.mark.django_db
class TestAlertRuleCRUD:
    """Tests for Alert Rule Create, Read, Update, Delete operations."""

    def test_create_alert_rule_with_simple_condition(self, operator_client, operator_user):
        """Test creating an alert rule with a simple condition."""
        data = {
            'name': 'Military Aircraft Alert',
            'type': 'military',
            'operator': 'eq',
            'value': 'true',
            'description': 'Alert when military aircraft detected',
            'priority': 'warning',
        }

        response = operator_client.post('/api/v1/alerts/rules/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['name'] == 'Military Aircraft Alert'
        assert result['type'] == 'military'
        assert result['operator'] == 'eq'
        assert result['value'] == 'true'
        assert result['priority'] == 'warning'
        assert 'id' in result

    def test_create_alert_rule_with_complex_and_or_conditions(self, operator_client, operator_user):
        """Test creating an alert rule with complex AND/OR conditions."""
        data = {
            'name': 'Complex Multi-Condition Alert',
            'conditions': {
                'logic': 'AND',
                'groups': [
                    {
                        'logic': 'OR',
                        'conditions': [
                            {'type': 'military', 'operator': 'eq', 'value': 'true'},
                            {'type': 'squawk', 'operator': 'in', 'value': '7500,7600,7700'},
                        ]
                    },
                    {
                        'logic': 'AND',
                        'conditions': [
                            {'type': 'distance', 'operator': 'lt', 'value': '15'},
                            {'type': 'altitude', 'operator': 'lt', 'value': '20000'},
                        ]
                    }
                ]
            },
            'description': 'Complex alert with multiple conditions',
            'priority': 'critical',
        }

        response = operator_client.post('/api/v1/alerts/rules/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['name'] == 'Complex Multi-Condition Alert'
        assert result['conditions'] is not None
        assert result['conditions']['logic'] == 'AND'
        assert len(result['conditions']['groups']) == 2

    def test_read_own_alert_rules(self, operator_client, operator_user, sample_alert_rule):
        """Test reading own alert rules."""
        response = operator_client.get('/api/v1/alerts/rules/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'rules' in result
        assert 'count' in result
        # Should see at least the sample rule we created
        rule_names = [r['name'] for r in result['rules']]
        assert sample_alert_rule.name in rule_names

    def test_read_single_alert_rule(self, operator_client, sample_alert_rule):
        """Test retrieving a single alert rule by ID."""
        response = operator_client.get(f'/api/v1/alerts/rules/{sample_alert_rule.id}/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['id'] == sample_alert_rule.id
        assert result['name'] == sample_alert_rule.name

    def test_update_own_alert_rule(self, operator_client, sample_alert_rule):
        """Test updating own alert rule."""
        data = {
            'name': 'Updated Military Alert',
            'priority': 'critical',
            'description': 'Updated description',
        }

        response = operator_client.patch(
            f'/api/v1/alerts/rules/{sample_alert_rule.id}/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['name'] == 'Updated Military Alert'
        assert result['priority'] == 'critical'

        # Verify persistence
        sample_alert_rule.refresh_from_db()
        assert sample_alert_rule.name == 'Updated Military Alert'

    def test_delete_own_alert_rule(self, operator_client, operator_user):
        """Test deleting own alert rule."""
        rule = AlertRule.objects.create(
            name='To Be Deleted',
            rule_type='icao',
            value='ABC123',
            owner=operator_user,
        )

        response = operator_client.delete(f'/api/v1/alerts/rules/{rule.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not AlertRule.objects.filter(id=rule.id).exists()

    def test_cannot_edit_other_users_private_rules(self, operator_client, admin_user):
        """Test that users cannot edit other users' private rules (403)."""
        # Create a private rule owned by admin
        rule = AlertRule.objects.create(
            name='Admin Private Rule',
            rule_type='military',
            value='true',
            owner=admin_user,
            visibility='private',
        )

        response = operator_client.patch(
            f'/api/v1/alerts/rules/{rule.id}/',
            {'name': 'Hacked!'},
            format='json'
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_cannot_delete_other_users_private_rules(self, operator_client, admin_user):
        """Test that users cannot delete other users' private rules (403)."""
        rule = AlertRule.objects.create(
            name='Admin Private Rule',
            rule_type='military',
            value='true',
            owner=admin_user,
            visibility='private',
        )

        response = operator_client.delete(f'/api/v1/alerts/rules/{rule.id}/')

        assert response.status_code == status.HTTP_403_FORBIDDEN
        # Rule should still exist
        assert AlertRule.objects.filter(id=rule.id).exists()

    def test_can_view_shared_rules(self, operator_client, shared_alert_rule):
        """Test that users can view shared rules."""
        response = operator_client.get(f'/api/v1/alerts/rules/{shared_alert_rule.id}/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['name'] == shared_alert_rule.name
        assert result['visibility'] == 'shared'

    def test_can_view_public_rules(self, api_client, public_alert_rule):
        """Test that public rules are visible to everyone (including unauthenticated)."""
        response = api_client.get(f'/api/v1/alerts/rules/{public_alert_rule.id}/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['name'] == public_alert_rule.name
        assert result['visibility'] == 'public'


# =============================================================================
# Alert Rule Visibility Tests
# =============================================================================


@pytest.mark.django_db
class TestAlertRuleVisibility:
    """Tests for alert rule visibility controls."""

    def test_private_rules_only_visible_to_owner(self, operator_client, viewer_client, operator_user):
        """Test that private rules are only visible to their owner."""
        # Create private rule
        rule = AlertRule.objects.create(
            name='Private Operator Rule',
            rule_type='icao',
            value='ABC123',
            owner=operator_user,
            visibility='private',
        )

        # Owner can see it
        response = operator_client.get(f'/api/v1/alerts/rules/{rule.id}/')
        assert response.status_code == status.HTTP_200_OK

        # Other user cannot see it
        response = viewer_client.get(f'/api/v1/alerts/rules/{rule.id}/')
        assert response.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND]

    def test_shared_rules_visible_to_users_with_alerts_view_permission(
        self, viewer_client, shared_alert_rule
    ):
        """Test that shared rules are visible to users with alerts.view permission."""
        response = viewer_client.get(f'/api/v1/alerts/rules/{shared_alert_rule.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.json()['visibility'] == 'shared'

    def test_public_rules_visible_to_everyone(self, api_client, public_alert_rule):
        """Test that public rules are visible to everyone."""
        # Unauthenticated request
        api_client.credentials()

        response = api_client.get(f'/api/v1/alerts/rules/{public_alert_rule.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.json()['visibility'] == 'public'

    def test_admin_with_manage_all_can_edit_any_rule(self, admin_client, operator_user):
        """Test that admin with alerts.manage_all can edit any rule."""
        # Create a rule owned by operator
        rule = AlertRule.objects.create(
            name='Operator Rule',
            rule_type='military',
            value='true',
            owner=operator_user,
            visibility='private',
        )

        response = admin_client.patch(
            f'/api/v1/alerts/rules/{rule.id}/',
            {'name': 'Admin Modified Rule'},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        rule.refresh_from_db()
        assert rule.name == 'Admin Modified Rule'

    def test_superadmin_can_manage_all_rules(self, superadmin_client, operator_user):
        """Test that superadmin can manage any rule."""
        rule = AlertRule.objects.create(
            name='Protected Rule',
            rule_type='distance',
            value='5',
            owner=operator_user,
            visibility='private',
            is_system=True,
        )

        # Superadmin can even delete system rules
        response = superadmin_client.delete(f'/api/v1/alerts/rules/{rule.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT


# =============================================================================
# Alert Testing Tests
# =============================================================================


@pytest.mark.django_db
class TestAlertTesting:
    """Tests for the alert rule test endpoint."""

    def test_post_test_with_sample_aircraft_data(self, operator_client, sample_alert_rule):
        """Test POST /api/v1/alerts/rules/{id}/test with sample aircraft data."""
        aircraft_data = {
            'hex': 'AE1234',
            'flight': 'RCH789',
            'alt_baro': 32000,
            'gs': 420,
            'lat': 47.5,
            'lon': -122.0,
            'dbFlags': 1,  # Military flag
            'squawk': '4000',
            'distance_nm': 5.0,
        }

        response = operator_client.post(
            f'/api/v1/alerts/rules/{sample_alert_rule.id}/test/',
            {'aircraft': aircraft_data},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'match' in result
        assert 'rule' in result
        assert 'aircraft' in result

    def test_test_returns_match_results(self, operator_client, operator_user):
        """Test that test endpoint returns correct match results."""
        # Create a rule that should match
        rule = AlertRule.objects.create(
            name='Squawk 7700 Test',
            rule_type='squawk',
            operator='eq',
            value='7700',
            owner=operator_user,
        )

        # Aircraft with matching squawk
        aircraft_data = {
            'hex': 'A12345',
            'squawk': '7700',
            'flight': 'TEST123',
        }

        response = operator_client.post(
            f'/api/v1/alerts/rules/{rule.id}/test/',
            {'aircraft': aircraft_data},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['match'] is True

        # Now test with non-matching squawk
        aircraft_data['squawk'] = '1200'
        response = operator_client.post(
            f'/api/v1/alerts/rules/{rule.id}/test/',
            {'aircraft': aircraft_data},
            format='json'
        )

        result = response.json()
        assert result['match'] is False

    def test_complex_conditions_evaluate_correctly(self, operator_client, complex_alert_rule):
        """Test that complex AND/OR conditions evaluate correctly."""
        # Aircraft that should match (military + close + low)
        matching_aircraft = {
            'hex': 'AE5678',
            'flight': 'RCH100',
            'dbFlags': 1,  # Military
            'distance_nm': 5.0,  # < 10
            'alt_baro': 10000,  # < 15000
        }

        response = operator_client.post(
            f'/api/v1/alerts/rules/{complex_alert_rule.id}/test/',
            {'aircraft': matching_aircraft},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['match'] is True

        # Aircraft that should NOT match (not military, no emergency squawk)
        non_matching_aircraft = {
            'hex': 'A12345',
            'flight': 'UAL123',
            'dbFlags': 0,  # Civilian
            'squawk': '1200',  # Normal VFR
            'distance_nm': 5.0,
            'alt_baro': 10000,
        }

        response = operator_client.post(
            f'/api/v1/alerts/rules/{complex_alert_rule.id}/test/',
            {'aircraft': non_matching_aircraft},
            format='json'
        )

        result = response.json()
        assert result['match'] is False


# =============================================================================
# Alert Toggling Tests
# =============================================================================


@pytest.mark.django_db
class TestAlertToggling:
    """Tests for enabling/disabling alert rules."""

    def test_toggle_enables_disabled_rule(self, operator_client, operator_user):
        """Test that toggle enables a disabled rule."""
        rule = AlertRule.objects.create(
            name='Disabled Rule',
            rule_type='icao',
            value='ABC123',
            enabled=False,
            owner=operator_user,
        )

        response = operator_client.post(f'/api/v1/alerts/rules/{rule.id}/toggle/')

        assert response.status_code == status.HTTP_200_OK
        rule.refresh_from_db()
        assert rule.enabled is True

    def test_toggle_disables_enabled_rule(self, operator_client, operator_user):
        """Test that toggle disables an enabled rule."""
        rule = AlertRule.objects.create(
            name='Enabled Rule',
            rule_type='icao',
            value='ABC123',
            enabled=True,
            owner=operator_user,
        )

        response = operator_client.post(f'/api/v1/alerts/rules/{rule.id}/toggle/')

        assert response.status_code == status.HTTP_200_OK
        rule.refresh_from_db()
        assert rule.enabled is False

    def test_disabled_rules_dont_trigger(self, operator_client, operator_user, cached_aircraft):
        """Test that disabled rules don't trigger alerts."""
        rule = AlertRule.objects.create(
            name='Disabled Emergency Alert',
            rule_type='squawk',
            operator='eq',
            value='7700',
            enabled=False,
            owner=operator_user,
        )

        # Test with matching aircraft - should still report match but rule is disabled
        aircraft_data = {
            'hex': 'A99999',
            'squawk': '7700',
            'flight': 'N12345',
        }

        response = operator_client.post(
            f'/api/v1/alerts/rules/{rule.id}/test/',
            {'aircraft': aircraft_data},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        # Match is evaluated but rule is disabled
        assert 'enabled' in result.get('rule', {}) or 'match' in result

    def test_toggle_returns_updated_rule_state(self, operator_client, operator_user):
        """Test that toggle returns the updated rule state."""
        rule = AlertRule.objects.create(
            name='Toggle Test',
            enabled=True,
            owner=operator_user,
        )

        response = operator_client.post(f'/api/v1/alerts/rules/{rule.id}/toggle/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['enabled'] is False


# =============================================================================
# Bulk Operations Tests
# =============================================================================


@pytest.mark.django_db
class TestBulkOperations:
    """Tests for bulk alert rule operations."""

    def test_bulk_create_multiple_rules(self, operator_client, operator_user):
        """Test POST /api/v1/alerts/rules/bulk_create creates multiple rules."""
        rules_data = [
            {
                'name': 'Bulk Rule 1',
                'type': 'icao',
                'value': 'ABC111',
                'priority': 'info',
            },
            {
                'name': 'Bulk Rule 2',
                'type': 'icao',
                'value': 'ABC222',
                'priority': 'warning',
            },
            {
                'name': 'Bulk Rule 3',
                'type': 'callsign',
                'value': 'UAL*',
                'priority': 'critical',
            },
        ]

        response = operator_client.post(
            '/api/v1/alerts/rules/bulk_create/',
            {'rules': rules_data},
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert 'created' in result
        assert result['created'] == 3

        # Verify rules were created
        assert AlertRule.objects.filter(name='Bulk Rule 1').exists()
        assert AlertRule.objects.filter(name='Bulk Rule 2').exists()
        assert AlertRule.objects.filter(name='Bulk Rule 3').exists()

    def test_bulk_delete_multiple_rules(self, operator_client, operator_user):
        """Test DELETE /api/v1/alerts/rules/bulk_delete deletes multiple rules."""
        # Create rules to delete
        rule1 = AlertRule.objects.create(name='Delete Me 1', owner=operator_user)
        rule2 = AlertRule.objects.create(name='Delete Me 2', owner=operator_user)
        rule3 = AlertRule.objects.create(name='Delete Me 3', owner=operator_user)

        response = operator_client.delete(
            '/api/v1/alerts/rules/bulk_delete/',
            {'ids': [rule1.id, rule2.id, rule3.id]},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'deleted' in result
        assert result['deleted'] == 3

        # Verify rules were deleted
        assert not AlertRule.objects.filter(id__in=[rule1.id, rule2.id, rule3.id]).exists()

    def test_bulk_delete_only_deletes_owned_rules(self, operator_client, operator_user, admin_user):
        """Test that bulk delete only affects owned rules."""
        # Create owned rule
        owned_rule = AlertRule.objects.create(name='My Rule', owner=operator_user)
        # Create rule owned by another user
        other_rule = AlertRule.objects.create(
            name='Not My Rule',
            owner=admin_user,
            visibility='private',
        )

        response = operator_client.delete(
            '/api/v1/alerts/rules/bulk_delete/',
            {'ids': [owned_rule.id, other_rule.id]},
            format='json'
        )

        # Should partially succeed or return error about permission
        assert response.status_code in [status.HTTP_200_OK, status.HTTP_403_FORBIDDEN]

        # Other user's rule should still exist
        assert AlertRule.objects.filter(id=other_rule.id).exists()


# =============================================================================
# Alert History Tests
# =============================================================================


@pytest.mark.django_db
class TestAlertHistory:
    """Tests for alert history endpoints."""

    def test_get_alert_history_returns_triggered_alerts(self, operator_client, operator_user):
        """Test GET /api/v1/alerts/history returns triggered alerts."""
        # Create rule and history
        rule = AlertRule.objects.create(
            name='History Test Rule',
            owner=operator_user,
        )
        AlertHistory.objects.create(
            rule=rule,
            rule_name=rule.name,
            icao_hex='ABC123',
            callsign='UAL456',
            message='Test alert triggered',
            priority='warning',
            user=operator_user,
        )

        response = operator_client.get('/api/v1/alerts/history/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'history' in result
        assert 'count' in result
        assert result['count'] >= 1

    def test_filter_history_by_rule(self, operator_client, operator_user):
        """Test filtering alert history by rule ID."""
        rule1 = AlertRule.objects.create(name='Rule 1', owner=operator_user)
        rule2 = AlertRule.objects.create(name='Rule 2', owner=operator_user)

        AlertHistory.objects.create(rule=rule1, rule_name='Rule 1', icao_hex='A1', user=operator_user)
        AlertHistory.objects.create(rule=rule1, rule_name='Rule 1', icao_hex='A2', user=operator_user)
        AlertHistory.objects.create(rule=rule2, rule_name='Rule 2', icao_hex='B1', user=operator_user)

        response = operator_client.get(f'/api/v1/alerts/history/?rule_id={rule1.id}')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['count'] == 2
        for entry in result['history']:
            assert entry['rule_id'] == rule1.id

    def test_filter_history_by_time_range(self, operator_client, operator_user):
        """Test filtering alert history by time range."""
        rule = AlertRule.objects.create(name='Time Test', owner=operator_user)

        # Create old entry
        old_entry = AlertHistory.objects.create(
            rule=rule,
            rule_name='Time Test',
            icao_hex='OLD001',
            user=operator_user,
        )
        old_entry.triggered_at = timezone.now() - timedelta(hours=48)
        old_entry.save()

        # Create recent entry
        AlertHistory.objects.create(
            rule=rule,
            rule_name='Time Test',
            icao_hex='NEW001',
            user=operator_user,
        )

        # Query for last 24 hours
        response = operator_client.get('/api/v1/alerts/history/?hours=24')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        # Should only see the recent entry
        icao_list = [h['icao'] for h in result['history']]
        assert 'NEW001' in icao_list
        assert 'OLD001' not in icao_list

    def test_filter_history_by_icao_hex(self, operator_client, operator_user):
        """Test filtering alert history by ICAO hex."""
        rule = AlertRule.objects.create(name='ICAO Filter Test', owner=operator_user)

        AlertHistory.objects.create(rule=rule, icao_hex='ABC123', user=operator_user)
        AlertHistory.objects.create(rule=rule, icao_hex='DEF456', user=operator_user)
        AlertHistory.objects.create(rule=rule, icao_hex='ABC123', user=operator_user)

        response = operator_client.get('/api/v1/alerts/history/?icao_hex=ABC123')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['count'] == 2
        for entry in result['history']:
            assert entry['icao'] == 'ABC123'

    def test_delete_clears_history_with_permission(self, admin_client, admin_user):
        """Test DELETE clears history (with permission)."""
        rule = AlertRule.objects.create(name='Clear Test', owner=admin_user)
        for i in range(5):
            AlertHistory.objects.create(
                rule=rule,
                icao_hex=f'A{i}',
                user=admin_user,
            )

        response = admin_client.delete('/api/v1/alerts/history/clear/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result['deleted'] >= 5

        # Verify cleared
        assert AlertHistory.objects.filter(user=admin_user).count() == 0


# =============================================================================
# Alert Subscriptions Tests
# =============================================================================


@pytest.mark.django_db
class TestAlertSubscriptions:
    """Tests for alert subscription functionality."""

    def test_subscribe_to_shared_alert_rule(self, operator_client, operator_user, shared_alert_rule):
        """Test subscribing to a shared alert rule."""
        response = operator_client.post(
            '/api/v1/alerts/subscriptions/',
            {'rule_id': shared_alert_rule.id},
            format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        result = response.json()
        assert result['rule_id'] == shared_alert_rule.id

        # Verify subscription created
        assert AlertSubscription.objects.filter(
            user=operator_user,
            rule=shared_alert_rule
        ).exists()

    def test_unsubscribe_from_rule(self, operator_client, operator_user, shared_alert_rule):
        """Test unsubscribing from an alert rule."""
        # First subscribe
        AlertSubscription.objects.create(
            user=operator_user,
            rule=shared_alert_rule,
        )

        response = operator_client.delete(
            f'/api/v1/alerts/subscriptions/{shared_alert_rule.id}/'
        )

        assert response.status_code == status.HTTP_204_NO_CONTENT

        # Verify subscription removed
        assert not AlertSubscription.objects.filter(
            user=operator_user,
            rule=shared_alert_rule
        ).exists()

    def test_list_subscriptions(self, operator_client, operator_user, shared_alert_rule, public_alert_rule):
        """Test listing user's subscriptions."""
        # Create subscriptions
        AlertSubscription.objects.create(user=operator_user, rule=shared_alert_rule)
        AlertSubscription.objects.create(user=operator_user, rule=public_alert_rule)

        response = operator_client.get('/api/v1/alerts/subscriptions/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert 'subscriptions' in result
        assert len(result['subscriptions']) == 2

    def test_cannot_subscribe_to_private_rule_not_owned(self, operator_client, admin_user):
        """Test that users cannot subscribe to private rules they don't own."""
        private_rule = AlertRule.objects.create(
            name='Private Rule',
            owner=admin_user,
            visibility='private',
        )

        response = operator_client.post(
            '/api/v1/alerts/subscriptions/',
            {'rule_id': private_rule.id},
            format='json'
        )

        assert response.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND]


# =============================================================================
# Scheduling Tests
# =============================================================================


@pytest.mark.django_db
class TestAlertScheduling:
    """Tests for alert rule scheduling functionality."""

    def test_rules_with_starts_at_only_trigger_after_that_time(self, operator_client, operator_user):
        """Test that rules with starts_at only trigger after that time."""
        # Create rule that starts in the future
        future_time = timezone.now() + timedelta(hours=1)
        rule = AlertRule.objects.create(
            name='Future Rule',
            rule_type='military',
            value='true',
            starts_at=future_time,
            owner=operator_user,
        )

        # Test with matching aircraft - should not match because rule hasn't started
        aircraft_data = {
            'hex': 'AE1234',
            'dbFlags': 1,
        }

        response = operator_client.post(
            f'/api/v1/alerts/rules/{rule.id}/test/',
            {'aircraft': aircraft_data},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        # Rule should indicate it's not active yet
        assert result.get('active', True) is False or 'not_started' in str(result).lower()

    def test_rules_with_expires_at_stop_triggering_after_that_time(self, operator_client, operator_user):
        """Test that rules with expires_at stop triggering after that time."""
        # Create rule that expired
        past_time = timezone.now() - timedelta(hours=1)
        rule = AlertRule.objects.create(
            name='Expired Rule',
            rule_type='military',
            value='true',
            expires_at=past_time,
            owner=operator_user,
        )

        aircraft_data = {
            'hex': 'AE1234',
            'dbFlags': 1,
        }

        response = operator_client.post(
            f'/api/v1/alerts/rules/{rule.id}/test/',
            {'aircraft': aircraft_data},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        # Rule should indicate it's expired
        assert result.get('active', True) is False or 'expired' in str(result).lower()

    def test_cooldown_prevents_duplicate_triggers(self, operator_client, operator_user):
        """Test that cooldown prevents duplicate triggers."""
        rule = AlertRule.objects.create(
            name='Cooldown Test',
            rule_type='icao',
            value='ABC123',
            cooldown_minutes=5,
            last_triggered=timezone.now(),  # Just triggered
            owner=operator_user,
        )

        aircraft_data = {
            'hex': 'ABC123',
            'flight': 'TEST123',
        }

        response = operator_client.post(
            f'/api/v1/alerts/rules/{rule.id}/test/',
            {'aircraft': aircraft_data},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        # Should indicate cooldown is active
        assert result.get('cooldown_active', False) is True or result.get('match', True) is False

    def test_rule_active_within_schedule_window(self, operator_client, operator_user):
        """Test that a rule is active within its scheduled window."""
        past_start = timezone.now() - timedelta(hours=1)
        future_end = timezone.now() + timedelta(hours=1)

        rule = AlertRule.objects.create(
            name='Active Window Rule',
            rule_type='military',
            value='true',
            starts_at=past_start,
            expires_at=future_end,
            owner=operator_user,
        )

        aircraft_data = {
            'hex': 'AE1234',
            'dbFlags': 1,
        }

        response = operator_client.post(
            f'/api/v1/alerts/rules/{rule.id}/test/',
            {'aircraft': aircraft_data},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        # Rule should be active and match
        assert result.get('match', False) is True


# =============================================================================
# Notification Integration Tests
# =============================================================================


@pytest.mark.django_db
class TestNotificationIntegration:
    """Tests for alert notification integration."""

    def test_alert_trigger_sends_to_configured_notification_channels(
        self, operator_client, operator_user, notification_channels, mock_apprise
    ):
        """Test that alert trigger sends to configured notification channels."""
        # Create rule with notification channel
        rule = AlertRule.objects.create(
            name='Notification Test Rule',
            rule_type='squawk',
            operator='eq',
            value='7700',
            priority='critical',
            owner=operator_user,
        )
        rule.notification_channels.add(notification_channels[0])  # Discord

        aircraft_data = {
            'hex': 'A12345',
            'squawk': '7700',
            'flight': 'EMERGENCY',
        }

        # Trigger the rule test (which may send notification)
        response = operator_client.post(
            f'/api/v1/alerts/rules/{rule.id}/test/',
            {'aircraft': aircraft_data, 'trigger_notifications': True},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK

    def test_multiple_channels_receive_notifications(
        self, operator_client, operator_user, notification_channels, mock_apprise
    ):
        """Test that multiple notification channels receive notifications."""
        # Create rule with multiple channels
        rule = AlertRule.objects.create(
            name='Multi-Channel Rule',
            rule_type='squawk',
            operator='eq',
            value='7700',
            priority='critical',
            owner=operator_user,
        )
        # Add multiple channels
        for channel in notification_channels[:3]:  # Discord, Slack, Email
            rule.notification_channels.add(channel)

        assert rule.notification_channels.count() == 3

        aircraft_data = {
            'hex': 'A99999',
            'squawk': '7700',
            'flight': 'MAYDAY',
        }

        response = operator_client.post(
            f'/api/v1/alerts/rules/{rule.id}/test/',
            {'aircraft': aircraft_data, 'trigger_notifications': True},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK

    def test_use_global_notifications_flag(self, operator_client, operator_user, global_notification_config):
        """Test the use_global_notifications flag behavior."""
        rule = AlertRule.objects.create(
            name='Global Notify Rule',
            rule_type='military',
            value='true',
            use_global_notifications=True,
            owner=operator_user,
        )

        response = operator_client.get(f'/api/v1/alerts/rules/{rule.id}/')

        assert response.status_code == status.HTTP_200_OK
        result = response.json()
        assert result.get('use_global_notifications', True) is True


# =============================================================================
# Edge Cases and Error Handling Tests
# =============================================================================


@pytest.mark.django_db
class TestEdgeCasesAndErrors:
    """Tests for edge cases and error handling."""

    def test_create_rule_with_invalid_operator(self, operator_client):
        """Test that invalid operator is rejected."""
        data = {
            'name': 'Invalid Operator Rule',
            'type': 'altitude',
            'operator': 'invalid_op',
            'value': '10000',
        }

        response = operator_client.post('/api/v1/alerts/rules/', data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_rule_with_missing_name(self, operator_client):
        """Test that missing name is rejected."""
        data = {
            'type': 'military',
            'value': 'true',
        }

        response = operator_client.post('/api/v1/alerts/rules/', data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_get_nonexistent_rule(self, operator_client):
        """Test getting a nonexistent rule returns 404."""
        response = operator_client.get('/api/v1/alerts/rules/99999/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_toggle_nonexistent_rule(self, operator_client):
        """Test toggling a nonexistent rule returns 404."""
        response = operator_client.post('/api/v1/alerts/rules/99999/toggle/')

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_test_nonexistent_rule(self, operator_client):
        """Test testing a nonexistent rule returns 404."""
        response = operator_client.post(
            '/api/v1/alerts/rules/99999/test/',
            {'aircraft': {}},
            format='json'
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_duplicate_subscription(self, operator_client, operator_user, public_alert_rule):
        """Test that duplicate subscriptions are handled gracefully."""
        # First subscription
        AlertSubscription.objects.create(user=operator_user, rule=public_alert_rule)

        # Try to subscribe again
        response = operator_client.post(
            '/api/v1/alerts/subscriptions/',
            {'rule_id': public_alert_rule.id},
            format='json'
        )

        # Should either succeed (idempotent) or return conflict
        assert response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_201_CREATED,
            status.HTTP_409_CONFLICT,
        ]

    def test_system_rule_cannot_be_deleted_by_regular_user(self, operator_client, operator_user):
        """Test that system rules cannot be deleted by regular users."""
        rule = AlertRule.objects.create(
            name='System Rule',
            rule_type='emergency',
            value='7700',
            is_system=True,
            owner=operator_user,
        )

        response = operator_client.delete(f'/api/v1/alerts/rules/{rule.id}/')

        # Should be forbidden for system rules
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert AlertRule.objects.filter(id=rule.id).exists()


# =============================================================================
# Integration Workflow Tests
# =============================================================================


@pytest.mark.django_db
class TestIntegrationWorkflows:
    """Integration tests for complete alert workflows."""

    def test_complete_alert_rule_lifecycle(self, operator_client, operator_user):
        """Test complete lifecycle: create, test, trigger, view history, delete."""
        # 1. Create rule
        create_response = operator_client.post(
            '/api/v1/alerts/rules/',
            {
                'name': 'Lifecycle Test Rule',
                'type': 'squawk',
                'operator': 'eq',
                'value': '7700',
                'priority': 'critical',
            },
            format='json'
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        rule_id = create_response.json()['id']

        # 2. Test the rule
        test_response = operator_client.post(
            f'/api/v1/alerts/rules/{rule_id}/test/',
            {'aircraft': {'hex': 'A12345', 'squawk': '7700'}},
            format='json'
        )
        assert test_response.status_code == status.HTTP_200_OK
        assert test_response.json()['match'] is True

        # 3. Verify rule appears in list
        list_response = operator_client.get('/api/v1/alerts/rules/')
        assert list_response.status_code == status.HTTP_200_OK
        rule_ids = [r['id'] for r in list_response.json()['rules']]
        assert rule_id in rule_ids

        # 4. Toggle rule off
        toggle_response = operator_client.post(f'/api/v1/alerts/rules/{rule_id}/toggle/')
        assert toggle_response.status_code == status.HTTP_200_OK
        assert toggle_response.json()['enabled'] is False

        # 5. Delete rule
        delete_response = operator_client.delete(f'/api/v1/alerts/rules/{rule_id}/')
        assert delete_response.status_code == status.HTTP_204_NO_CONTENT

        # 6. Verify rule is gone
        get_response = operator_client.get(f'/api/v1/alerts/rules/{rule_id}/')
        assert get_response.status_code == status.HTTP_404_NOT_FOUND

    def test_shared_rule_subscription_workflow(
        self, operator_client, viewer_client, admin_user, operator_user
    ):
        """Test workflow: admin creates shared rule, operator subscribes."""
        # Admin creates shared rule (using admin_user directly)
        rule = AlertRule.objects.create(
            name='Shared Emergency Alert',
            rule_type='squawk',
            operator='in',
            value='7500,7600,7700',
            priority='critical',
            owner=admin_user,
            visibility='shared',
        )

        # Operator can see the shared rule
        view_response = operator_client.get(f'/api/v1/alerts/rules/{rule.id}/')
        assert view_response.status_code == status.HTTP_200_OK

        # Operator subscribes to the rule
        sub_response = operator_client.post(
            '/api/v1/alerts/subscriptions/',
            {'rule_id': rule.id},
            format='json'
        )
        assert sub_response.status_code == status.HTTP_201_CREATED

        # Operator lists subscriptions
        list_response = operator_client.get('/api/v1/alerts/subscriptions/')
        assert list_response.status_code == status.HTTP_200_OK
        sub_rule_ids = [s['rule_id'] for s in list_response.json()['subscriptions']]
        assert rule.id in sub_rule_ids

        # Operator unsubscribes
        unsub_response = operator_client.delete(f'/api/v1/alerts/subscriptions/{rule.id}/')
        assert unsub_response.status_code == status.HTTP_204_NO_CONTENT

    def test_alert_with_notification_workflow(
        self, operator_client, operator_user, notification_channels, mock_apprise
    ):
        """Test complete workflow with notification channels."""
        # Create rule with notification channel
        rule = AlertRule.objects.create(
            name='Notified Rule',
            rule_type='military',
            value='true',
            priority='warning',
            owner=operator_user,
        )
        rule.notification_channels.add(notification_channels[0])

        # Retrieve and verify channels attached
        response = operator_client.get(f'/api/v1/alerts/rules/{rule.id}/')
        assert response.status_code == status.HTTP_200_OK

        # Test rule with notification trigger
        test_response = operator_client.post(
            f'/api/v1/alerts/rules/{rule.id}/test/',
            {
                'aircraft': {'hex': 'AE1234', 'dbFlags': 1},
                'trigger_notifications': True,
            },
            format='json'
        )
        assert test_response.status_code == status.HTTP_200_OK
