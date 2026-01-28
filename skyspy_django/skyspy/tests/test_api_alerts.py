"""
End-to-end tests for alerts API endpoints.

Tests for:
- AlertRuleViewSet (CRUD operations)
  - list (GET /api/v1/alerts/rules/)
  - create (POST /api/v1/alerts/rules/)
  - retrieve (GET /api/v1/alerts/rules/{id}/)
  - update (PUT /api/v1/alerts/rules/{id}/)
  - partial_update (PATCH /api/v1/alerts/rules/{id}/)
  - destroy (DELETE /api/v1/alerts/rules/{id}/)
  - toggle (POST /api/v1/alerts/rules/{id}/toggle/)
- AlertHistoryViewSet
  - list (GET /api/v1/alerts/history/)
  - clear (DELETE /api/v1/alerts/history/clear/)
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient
from rest_framework import status

from skyspy.models import AlertRule, AlertHistory


class AlertRuleListViewTests(APITestCase):
    """Tests for the alert rules list endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        AlertRule.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        AlertRule.objects.all().delete()

    def test_list_returns_200(self):
        """Test that list returns 200 OK."""
        response = self.client.get('/api/v1/alerts/rules/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_list_empty(self):
        """Test list response when no rules exist."""
        response = self.client.get('/api/v1/alerts/rules/')
        data = response.json()

        self.assertIn('rules', data)
        self.assertIn('count', data)
        self.assertEqual(data['rules'], [])
        self.assertEqual(data['count'], 0)

    def test_list_with_rules(self):
        """Test list response with existing rules."""
        AlertRule.objects.create(name='Rule 1', rule_type='icao', value='ABC123', visibility='public')
        AlertRule.objects.create(name='Rule 2', rule_type='callsign', value='UAL*', visibility='public')

        response = self.client.get('/api/v1/alerts/rules/')
        data = response.json()

        self.assertEqual(data['count'], 2)
        self.assertEqual(len(data['rules']), 2)

    def test_list_rule_structure(self):
        """Test that rules have expected fields."""
        AlertRule.objects.create(
            name='Test Rule',
            rule_type='icao',
            operator='eq',
            value='ABC123',
            description='Test description',
            enabled=True,
            priority='warning',
            visibility='public',
        )

        response = self.client.get('/api/v1/alerts/rules/')
        rule = response.json()['rules'][0]

        expected_fields = [
            'id', 'name', 'type', 'operator', 'value', 'conditions',
            'description', 'enabled', 'priority', 'starts_at', 'expires_at',
            'api_url', 'created_at', 'updated_at'
        ]
        for field in expected_fields:
            self.assertIn(field, rule, f"Missing field: {field}")

    def test_list_filter_by_enabled(self):
        """Test filtering rules by enabled status."""
        AlertRule.objects.create(name='Enabled', enabled=True, visibility='public')
        AlertRule.objects.create(name='Disabled', enabled=False, visibility='public')

        response = self.client.get('/api/v1/alerts/rules/?enabled=true')
        data = response.json()

        self.assertEqual(data['count'], 1)
        self.assertEqual(data['rules'][0]['name'], 'Enabled')

    def test_list_filter_by_priority(self):
        """Test filtering rules by priority."""
        AlertRule.objects.create(name='Info', priority='info', visibility='public')
        AlertRule.objects.create(name='Warning', priority='warning', visibility='public')
        AlertRule.objects.create(name='Critical', priority='critical', visibility='public')

        response = self.client.get('/api/v1/alerts/rules/?priority=critical')
        data = response.json()

        self.assertEqual(data['count'], 1)
        self.assertEqual(data['rules'][0]['name'], 'Critical')

    def test_list_filter_by_rule_type(self):
        """Test filtering rules by type."""
        AlertRule.objects.create(name='ICAO Rule', rule_type='icao', visibility='public')
        AlertRule.objects.create(name='Callsign Rule', rule_type='callsign', visibility='public')

        response = self.client.get('/api/v1/alerts/rules/?rule_type=icao')
        data = response.json()

        self.assertEqual(data['count'], 1)
        self.assertEqual(data['rules'][0]['name'], 'ICAO Rule')


class AlertRuleCreateViewTests(APITestCase):
    """Tests for creating alert rules."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        AlertRule.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        AlertRule.objects.all().delete()

    def test_create_simple_rule(self):
        """Test creating a simple alert rule."""
        data = {
            'name': 'Watch ABC123',
            'type': 'icao',
            'operator': 'eq',
            'value': 'ABC123',
            'priority': 'info',
        }

        response = self.client.post('/api/v1/alerts/rules/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_returns_rule(self):
        """Test that create returns the created rule."""
        data = {
            'name': 'Watch ABC123',
            'type': 'icao',
            'value': 'ABC123',
        }

        response = self.client.post('/api/v1/alerts/rules/', data, format='json')
        result = response.json()

        self.assertIn('id', result)
        self.assertEqual(result['name'], 'Watch ABC123')
        self.assertEqual(result['type'], 'icao')

    def test_create_rule_persisted(self):
        """Test that created rule is persisted in database."""
        data = {
            'name': 'Persistent Rule',
            'type': 'callsign',
            'value': 'UAL*',
        }

        response = self.client.post('/api/v1/alerts/rules/', data, format='json')
        rule_id = response.json()['id']

        self.assertTrue(AlertRule.objects.filter(id=rule_id).exists())

    def test_create_with_all_fields(self):
        """Test creating rule with all optional fields."""
        data = {
            'name': 'Full Rule',
            'type': 'icao',
            'operator': 'contains',
            'value': 'MIL',
            'description': 'Watch military aircraft',
            'enabled': True,
            'priority': 'warning',
            'api_url': 'https://example.com/webhook',
        }

        response = self.client.post('/api/v1/alerts/rules/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        result = response.json()
        self.assertEqual(result['description'], 'Watch military aircraft')
        self.assertEqual(result['priority'], 'warning')
        self.assertEqual(result['api_url'], 'https://example.com/webhook')

    def test_create_with_complex_conditions(self):
        """Test creating rule with complex conditions."""
        data = {
            'name': 'Complex Rule',
            'conditions': {
                'logic': 'AND',
                'groups': [
                    {
                        'logic': 'OR',
                        'conditions': [
                            {'type': 'icao', 'operator': 'eq', 'value': 'ABC123'},
                            {'type': 'icao', 'operator': 'eq', 'value': 'DEF456'},
                        ]
                    }
                ]
            },
            'priority': 'critical',
        }

        response = self.client.post('/api/v1/alerts/rules/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_missing_name(self):
        """Test that name is required."""
        data = {
            'type': 'icao',
            'value': 'ABC123',
        }

        response = self.client.post('/api/v1/alerts/rules/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_default_values(self):
        """Test that default values are applied."""
        data = {
            'name': 'Minimal Rule',
        }

        response = self.client.post('/api/v1/alerts/rules/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        result = response.json()
        self.assertTrue(result['enabled'])  # Default True
        self.assertEqual(result['priority'], 'info')  # Default info
        self.assertEqual(result['operator'], 'eq')  # Default eq

    def test_create_invalid_priority(self):
        """Test that invalid priority is rejected."""
        data = {
            'name': 'Bad Priority',
            'priority': 'invalid',
        }

        response = self.client.post('/api/v1/alerts/rules/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class AlertRuleRetrieveViewTests(APITestCase):
    """Tests for retrieving a single alert rule."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        AlertRule.objects.all().delete()
        self.rule = AlertRule.objects.create(
            name='Test Rule',
            rule_type='icao',
            value='ABC123',
            priority='warning',
            visibility='public',
        )

    def tearDown(self):
        """Clean up after tests."""
        AlertRule.objects.all().delete()

    def test_retrieve_existing_rule(self):
        """Test retrieving an existing rule."""
        response = self.client.get(f'/api/v1/alerts/rules/{self.rule.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_retrieve_rule_data(self):
        """Test that retrieved rule has correct data."""
        response = self.client.get(f'/api/v1/alerts/rules/{self.rule.id}/')
        data = response.json()

        self.assertEqual(data['name'], 'Test Rule')
        self.assertEqual(data['type'], 'icao')
        self.assertEqual(data['value'], 'ABC123')

    def test_retrieve_nonexistent_rule(self):
        """Test retrieving non-existent rule returns 404."""
        response = self.client.get('/api/v1/alerts/rules/99999/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class AlertRuleUpdateViewTests(APITestCase):
    """Tests for updating alert rules."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        AlertRule.objects.all().delete()
        self.rule = AlertRule.objects.create(
            name='Original Name',
            rule_type='icao',
            value='ABC123',
            priority='info',
            enabled=True,
            visibility='public',
        )

    def tearDown(self):
        """Clean up after tests."""
        AlertRule.objects.all().delete()

    def test_full_update(self):
        """Test full update (PUT) of a rule."""
        data = {
            'name': 'Updated Name',
            'operator': 'contains',
            'value': 'DEF',
            'priority': 'critical',
            'enabled': False,
        }

        response = self.client.put(
            f'/api/v1/alerts/rules/{self.rule.id}/',
            data,
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_partial_update(self):
        """Test partial update (PATCH) of a rule."""
        data = {
            'name': 'New Name Only',
        }

        response = self.client.patch(
            f'/api/v1/alerts/rules/{self.rule.id}/',
            data,
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        result = response.json()
        self.assertEqual(result['name'], 'New Name Only')
        # Other fields should be preserved
        self.assertEqual(result['value'], 'ABC123')

    def test_update_persisted(self):
        """Test that updates are persisted."""
        data = {'name': 'Persisted Name'}

        self.client.patch(
            f'/api/v1/alerts/rules/{self.rule.id}/',
            data,
            format='json'
        )

        self.rule.refresh_from_db()
        self.assertEqual(self.rule.name, 'Persisted Name')

    def test_update_nonexistent_rule(self):
        """Test updating non-existent rule returns 404."""
        data = {'name': 'New Name'}

        response = self.client.patch(
            '/api/v1/alerts/rules/99999/',
            data,
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_priority(self):
        """Test updating rule priority."""
        data = {'priority': 'critical'}

        response = self.client.patch(
            f'/api/v1/alerts/rules/{self.rule.id}/',
            data,
            format='json'
        )

        self.rule.refresh_from_db()
        self.assertEqual(self.rule.priority, 'critical')

    def test_update_enabled_status(self):
        """Test updating enabled status."""
        data = {'enabled': False}

        response = self.client.patch(
            f'/api/v1/alerts/rules/{self.rule.id}/',
            data,
            format='json'
        )

        self.rule.refresh_from_db()
        self.assertFalse(self.rule.enabled)


class AlertRuleDeleteViewTests(APITestCase):
    """Tests for deleting alert rules."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        AlertRule.objects.all().delete()
        self.rule = AlertRule.objects.create(name='To Delete', visibility='public')

    def tearDown(self):
        """Clean up after tests."""
        AlertRule.objects.all().delete()

    def test_delete_rule(self):
        """Test deleting a rule."""
        response = self.client.delete(f'/api/v1/alerts/rules/{self.rule.id}/')
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_delete_removes_from_db(self):
        """Test that delete removes rule from database."""
        rule_id = self.rule.id
        self.client.delete(f'/api/v1/alerts/rules/{rule_id}/')

        self.assertFalse(AlertRule.objects.filter(id=rule_id).exists())

    def test_delete_nonexistent_rule(self):
        """Test deleting non-existent rule returns 404."""
        response = self.client.delete('/api/v1/alerts/rules/99999/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_delete_twice(self):
        """Test that deleting same rule twice returns 404 on second."""
        self.client.delete(f'/api/v1/alerts/rules/{self.rule.id}/')
        response = self.client.delete(f'/api/v1/alerts/rules/{self.rule.id}/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class AlertRuleToggleViewTests(APITestCase):
    """Tests for the alert rule toggle action."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        AlertRule.objects.all().delete()
        self.rule = AlertRule.objects.create(name='Toggle Test', enabled=True, visibility='public')

    def tearDown(self):
        """Clean up after tests."""
        AlertRule.objects.all().delete()

    def test_toggle_enabled_to_disabled(self):
        """Test toggling enabled rule to disabled."""
        self.assertTrue(self.rule.enabled)

        response = self.client.post(f'/api/v1/alerts/rules/{self.rule.id}/toggle/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.rule.refresh_from_db()
        self.assertFalse(self.rule.enabled)

    def test_toggle_disabled_to_enabled(self):
        """Test toggling disabled rule to enabled."""
        self.rule.enabled = False
        self.rule.save()

        response = self.client.post(f'/api/v1/alerts/rules/{self.rule.id}/toggle/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.rule.refresh_from_db()
        self.assertTrue(self.rule.enabled)

    def test_toggle_returns_updated_rule(self):
        """Test that toggle returns the updated rule."""
        response = self.client.post(f'/api/v1/alerts/rules/{self.rule.id}/toggle/')
        data = response.json()

        self.assertIn('enabled', data)
        self.assertFalse(data['enabled'])  # Was True, now False

    def test_toggle_nonexistent_rule(self):
        """Test toggling non-existent rule returns 404."""
        response = self.client.post('/api/v1/alerts/rules/99999/toggle/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_toggle_twice_returns_to_original(self):
        """Test that toggling twice returns to original state."""
        original_state = self.rule.enabled

        self.client.post(f'/api/v1/alerts/rules/{self.rule.id}/toggle/')
        self.client.post(f'/api/v1/alerts/rules/{self.rule.id}/toggle/')

        self.rule.refresh_from_db()
        self.assertEqual(self.rule.enabled, original_state)


class AlertHistoryListViewTests(APITestCase):
    """Tests for the alert history list endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        AlertHistory.objects.all().delete()
        AlertRule.objects.all().delete()

    def tearDown(self):
        """Clean up after tests."""
        AlertHistory.objects.all().delete()
        AlertRule.objects.all().delete()

    def test_list_returns_200(self):
        """Test that list returns 200 OK."""
        response = self.client.get('/api/v1/alerts/history/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_list_empty(self):
        """Test list response when no history exists."""
        response = self.client.get('/api/v1/alerts/history/')
        data = response.json()

        self.assertIn('history', data)
        self.assertIn('count', data)
        self.assertEqual(data['count'], 0)

    def test_list_with_history(self):
        """Test list with existing history entries."""
        rule = AlertRule.objects.create(name='Test Rule', visibility='public')
        AlertHistory.objects.create(
            rule=rule,
            rule_name='Test Rule',
            icao_hex='ABC123',
            message='Alert triggered',
            priority='warning',
        )

        response = self.client.get('/api/v1/alerts/history/')
        data = response.json()

        self.assertEqual(data['count'], 1)

    def test_list_time_filter(self):
        """Test filtering by time range."""
        rule = AlertRule.objects.create(name='Test Rule', visibility='public')

        # Create entry outside time range
        old_entry = AlertHistory.objects.create(
            rule=rule,
            rule_name='Old',
            icao_hex='OLD123',
        )
        # Manually set old timestamp
        old_entry.triggered_at = timezone.now() - timedelta(hours=48)
        old_entry.save()

        # Create recent entry
        AlertHistory.objects.create(
            rule=rule,
            rule_name='Recent',
            icao_hex='NEW123',
        )

        response = self.client.get('/api/v1/alerts/history/?hours=24')
        data = response.json()

        self.assertEqual(data['count'], 1)
        self.assertEqual(data['history'][0]['icao'], 'NEW123')

    def test_list_filter_by_icao(self):
        """Test filtering history by ICAO hex."""
        rule = AlertRule.objects.create(name='Test', visibility='public')
        AlertHistory.objects.create(rule=rule, icao_hex='ABC123')
        AlertHistory.objects.create(rule=rule, icao_hex='DEF456')

        response = self.client.get('/api/v1/alerts/history/?icao_hex=ABC123')
        data = response.json()

        self.assertEqual(data['count'], 1)
        self.assertEqual(data['history'][0]['icao'], 'ABC123')

    def test_list_filter_by_priority(self):
        """Test filtering history by priority."""
        rule = AlertRule.objects.create(name='Test', visibility='public')
        AlertHistory.objects.create(rule=rule, icao_hex='A', priority='info')
        AlertHistory.objects.create(rule=rule, icao_hex='B', priority='critical')

        response = self.client.get('/api/v1/alerts/history/?priority=critical')
        data = response.json()

        self.assertEqual(data['count'], 1)
        self.assertEqual(data['history'][0]['priority'], 'critical')

    def test_list_ordered_by_time(self):
        """Test that history is ordered by triggered time descending."""
        rule = AlertRule.objects.create(name='Test', visibility='public')
        AlertHistory.objects.create(rule=rule, icao_hex='FIRST')
        AlertHistory.objects.create(rule=rule, icao_hex='SECOND')

        response = self.client.get('/api/v1/alerts/history/')
        data = response.json()

        # Most recent should be first
        self.assertEqual(data['history'][0]['icao'], 'SECOND')


class AlertHistoryClearViewTests(APITestCase):
    """Tests for the alert history clear endpoint."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        AlertHistory.objects.all().delete()
        AlertRule.objects.all().delete()
        # Create a superuser for authenticated requests
        from django.contrib.auth import get_user_model
        import uuid
        User = get_user_model()
        username = f'admin_{uuid.uuid4().hex[:8]}'
        self.user = User.objects.create_superuser(
            username=username,
            email=f'{username}@test.com',
            password='testpass123'
        )
        self.client.force_authenticate(user=self.user)

    def tearDown(self):
        """Clean up after tests."""
        self.client.force_authenticate(user=None)
        AlertHistory.objects.all().delete()
        AlertRule.objects.all().delete()

    def test_clear_returns_200(self):
        """Test that clear returns 200 OK."""
        response = self.client.delete('/api/v1/alerts/history/clear/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_clear_deletes_all(self):
        """Test that clear deletes all history entries."""
        rule = AlertRule.objects.create(name='Test')
        AlertHistory.objects.create(rule=rule, icao_hex='A')
        AlertHistory.objects.create(rule=rule, icao_hex='B')
        AlertHistory.objects.create(rule=rule, icao_hex='C')

        response = self.client.delete('/api/v1/alerts/history/clear/')

        self.assertEqual(AlertHistory.objects.count(), 0)

    def test_clear_returns_count(self):
        """Test that clear returns deleted count."""
        rule = AlertRule.objects.create(name='Test')
        AlertHistory.objects.create(rule=rule, icao_hex='A')
        AlertHistory.objects.create(rule=rule, icao_hex='B')

        response = self.client.delete('/api/v1/alerts/history/clear/')
        data = response.json()

        self.assertIn('deleted', data)
        self.assertEqual(data['deleted'], 2)

    def test_clear_empty_history(self):
        """Test clearing empty history."""
        response = self.client.delete('/api/v1/alerts/history/clear/')
        data = response.json()

        self.assertEqual(data['deleted'], 0)

    def test_clear_does_not_affect_rules(self):
        """Test that clearing history doesn't delete rules."""
        rule = AlertRule.objects.create(name='Keep Me')
        AlertHistory.objects.create(rule=rule, icao_hex='A')

        self.client.delete('/api/v1/alerts/history/clear/')

        self.assertTrue(AlertRule.objects.filter(id=rule.id).exists())


class AlertsIntegrationTests(APITestCase):
    """Integration tests for alerts endpoints."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = APIClient()
        AlertRule.objects.all().delete()
        AlertHistory.objects.all().delete()
        # Create a superuser for authenticated requests
        from django.contrib.auth import get_user_model
        User = get_user_model()
        self.user = User.objects.create_superuser(
            username='admin',
            email='admin@test.com',
            password='testpass123'
        )
        self.client.force_authenticate(user=self.user)

    def tearDown(self):
        """Clean up after tests."""
        AlertRule.objects.all().delete()
        AlertHistory.objects.all().delete()
        from django.contrib.auth import get_user_model
        get_user_model().objects.all().delete()

    def test_crud_workflow(self):
        """Test complete CRUD workflow."""
        # Create
        create_response = self.client.post(
            '/api/v1/alerts/rules/',
            {'name': 'CRUD Test', 'type': 'icao', 'value': 'ABC123'},
            format='json'
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        rule_id = create_response.json()['id']

        # Read
        read_response = self.client.get(f'/api/v1/alerts/rules/{rule_id}/')
        self.assertEqual(read_response.status_code, status.HTTP_200_OK)
        self.assertEqual(read_response.json()['name'], 'CRUD Test')

        # Update
        update_response = self.client.patch(
            f'/api/v1/alerts/rules/{rule_id}/',
            {'name': 'Updated CRUD Test'},
            format='json'
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.json()['name'], 'Updated CRUD Test')

        # Delete
        delete_response = self.client.delete(f'/api/v1/alerts/rules/{rule_id}/')
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

        # Verify deleted
        verify_response = self.client.get(f'/api/v1/alerts/rules/{rule_id}/')
        self.assertEqual(verify_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_history_linked_to_rule(self):
        """Test that history entries are linked to rules."""
        # Create rule - must be public for anonymous access or owned by authenticated user
        rule = AlertRule.objects.create(name='History Test', visibility='public')

        # Create history entry linked to rule
        AlertHistory.objects.create(
            rule=rule,
            rule_name='History Test',
            icao_hex='ABC123',
        )

        # Get history
        response = self.client.get('/api/v1/alerts/history/')
        history = response.json()['history'][0]

        self.assertEqual(history['rule_id'], rule.id)
        self.assertEqual(history['rule_name'], 'History Test')

    def test_all_endpoints_return_json(self):
        """Test that all endpoints return JSON."""
        rule = AlertRule.objects.create(name='JSON Test', visibility='public')

        endpoints = [
            ('/api/v1/alerts/rules/', 'GET'),
            ('/api/v1/alerts/rules/', 'POST'),
            (f'/api/v1/alerts/rules/{rule.id}/', 'GET'),
            ('/api/v1/alerts/history/', 'GET'),
        ]

        for endpoint, method in endpoints:
            if method == 'GET':
                response = self.client.get(endpoint)
            elif method == 'POST':
                response = self.client.post(
                    endpoint,
                    {'name': 'Test'},
                    format='json'
                )

            if response.status_code in [200, 201]:
                self.assertEqual(
                    response['Content-Type'],
                    'application/json',
                    f"{method} {endpoint} should return JSON"
                )

    def test_no_authentication_required(self):
        """Test that no authentication is required."""
        self.client.credentials()

        rule = AlertRule.objects.create(name='Auth Test')

        endpoints = [
            ('/api/v1/alerts/rules/', 'GET'),
            (f'/api/v1/alerts/rules/{rule.id}/', 'GET'),
            ('/api/v1/alerts/history/', 'GET'),
        ]

        for endpoint, method in endpoints:
            response = self.client.get(endpoint)
            self.assertNotIn(
                response.status_code,
                [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN],
                f"{endpoint} should not require authentication"
            )
