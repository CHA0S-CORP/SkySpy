"""Alert rule handlers for MainNamespace."""

import logging
from datetime import timedelta

from asgiref.sync import sync_to_async
from django.utils import timezone

from skyspy.socketio.namespaces.mixins import parse_int_param

logger = logging.getLogger(__name__)


class AlertHandlerMixin:
    """Alert rule CRUD and alert history snapshot."""

    async def _handle_alert_rules(self, params: dict):
        """List all alert rules."""
        return await self._get_alert_rules(params)

    async def _handle_alert_rule_create(self, params: dict):
        """Create a new alert rule."""
        return await self._create_alert_rule(params)

    async def _handle_alert_rule_update(self, params: dict):
        """Update an existing alert rule."""
        rule_id = params.get("id")
        if not rule_id:
            raise ValueError("Missing rule id")
        return await self._update_alert_rule(rule_id, params)

    async def _handle_alert_rule_delete(self, params: dict):
        """Delete an alert rule."""
        rule_id = params.get("id")
        if not rule_id:
            raise ValueError("Missing rule id")
        return await self._delete_alert_rule(rule_id)

    async def _handle_alert_rule_toggle(self, params: dict):
        """Toggle an alert rule's enabled status."""
        rule_id = params.get("id")
        if not rule_id:
            raise ValueError("Missing rule id")
        enabled = params.get("enabled")
        return await self._toggle_alert_rule(rule_id, enabled)

    async def _handle_alert_snapshot(self, params: dict):
        """Get alerts snapshot."""
        return await self._get_alert_snapshot(params)

    # -----------------------------------------------------------------
    # Data access
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_alert_rules(self, params: dict):
        """Get all alert rules."""
        from skyspy.models import AlertRule

        rules = AlertRule.objects.all().order_by("-created_at")
        return {
            "rules": [
                {
                    "id": str(rule.id),
                    "name": rule.name,
                    "description": rule.description,
                    "enabled": rule.enabled,
                    "priority": rule.priority,
                    "conditions": rule.conditions,
                    "cooldown_minutes": rule.cooldown_minutes,
                    "created_at": rule.created_at.isoformat() if rule.created_at else None,
                    "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
                }
                for rule in rules
            ]
        }

    @sync_to_async
    def _create_alert_rule(self, params: dict):
        """Create a new alert rule."""
        from skyspy.models import AlertRule

        rule = AlertRule.objects.create(
            name=params.get("name", "New Rule"),
            description=params.get("description", ""),
            enabled=params.get("enabled", True),
            priority=params.get("priority", "info"),
            conditions=params.get("conditions", {}),
            cooldown_minutes=params.get("cooldown_minutes", 5),
        )
        return {
            "id": str(rule.id),
            "name": rule.name,
            "description": rule.description,
            "enabled": rule.enabled,
            "priority": rule.priority,
            "conditions": rule.conditions,
            "cooldown_minutes": rule.cooldown_minutes,
            "created_at": rule.created_at.isoformat() if rule.created_at else None,
        }

    @sync_to_async
    def _update_alert_rule(self, rule_id, params: dict):
        """Update an alert rule."""
        from skyspy.models import AlertRule

        try:
            rule = AlertRule.objects.get(id=rule_id)
        except AlertRule.DoesNotExist:
            raise ValueError("Rule not found")

        update_fields = []
        if "name" in params:
            rule.name = params["name"]
            update_fields.append("name")
        if "description" in params:
            rule.description = params["description"]
            update_fields.append("description")
        if "enabled" in params:
            rule.enabled = params["enabled"]
            update_fields.append("enabled")
        if "priority" in params:
            rule.priority = params["priority"]
            update_fields.append("priority")
        if "conditions" in params:
            rule.conditions = params["conditions"]
            update_fields.append("conditions")
        if "cooldown_minutes" in params:
            rule.cooldown_minutes = params["cooldown_minutes"]
            update_fields.append("cooldown_minutes")

        if update_fields:
            update_fields.append("updated_at")
            rule.save(update_fields=update_fields)

        return {
            "id": str(rule.id),
            "name": rule.name,
            "description": rule.description,
            "enabled": rule.enabled,
            "priority": rule.priority,
            "conditions": rule.conditions,
            "cooldown_minutes": rule.cooldown_minutes,
            "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
        }

    @sync_to_async
    def _delete_alert_rule(self, rule_id):
        """Delete an alert rule."""
        from skyspy.models import AlertRule

        try:
            rule = AlertRule.objects.get(id=rule_id)
            rule.delete()
            return {"success": True, "id": str(rule_id)}
        except AlertRule.DoesNotExist:
            raise ValueError("Rule not found")

    @sync_to_async
    def _toggle_alert_rule(self, rule_id, enabled=None):
        """Toggle an alert rule's enabled status."""
        from skyspy.models import AlertRule

        try:
            rule = AlertRule.objects.get(id=rule_id)
            if enabled is not None:
                rule.enabled = enabled
            else:
                rule.enabled = not rule.enabled
            rule.save(update_fields=["enabled", "updated_at"])
            return {
                "success": True,
                "id": str(rule.id),
                "enabled": rule.enabled,
            }
        except AlertRule.DoesNotExist:
            raise ValueError("Rule not found")

    @sync_to_async
    def _get_alert_snapshot(self, params: dict):
        """Get recent alert history."""
        from skyspy.models import AlertHistory

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=168)
        limit = parse_int_param(params.get("limit"), 50, min_val=1, max_val=200)

        cutoff = timezone.now() - timedelta(hours=hours)

        alerts = []
        for alert in AlertHistory.objects.filter(triggered_at__gte=cutoff).order_by("-triggered_at")[:limit]:
            alerts.append(
                {
                    "id": str(alert.id),
                    "rule_name": alert.rule_name,
                    "icao_hex": alert.icao_hex,
                    "callsign": alert.callsign,
                    "priority": alert.priority,
                    "triggered_at": alert.triggered_at.isoformat() if alert.triggered_at else None,
                    "message": alert.message,
                    "data": alert.data,
                }
            )

        return {"alerts": alerts, "count": len(alerts)}
