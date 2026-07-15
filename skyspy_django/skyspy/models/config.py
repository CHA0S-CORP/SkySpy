"""
System configuration models for runtime-editable settings.

Provides database-backed configuration that can be modified through
the admin UI without requiring environment variable changes or restarts.
"""

import json
import os

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import DatabaseError, models

# Configuration categories matching the plan
CATEGORY_CHOICES = [
    ("adsb_sources", "ADS-B Sources"),
    ("location", "Location"),
    ("safety", "Safety Monitoring"),
    ("alerts", "Alerts"),
    ("acars", "ACARS"),
    ("storage", "Storage"),
    ("transcription", "Transcription"),
    ("external_apis", "External APIs"),
    ("monitoring", "Monitoring"),
    ("notifications", "Notifications"),
    ("aircraft_data", "Aircraft Data"),
    ("display", "Display"),
    ("advanced", "Advanced"),
]

# Value types for proper serialization/deserialization
VALUE_TYPE_CHOICES = [
    ("string", "String"),
    ("integer", "Integer"),
    ("float", "Float"),
    ("boolean", "Boolean"),
    ("json", "JSON"),
    ("secret", "Secret"),
]


class SystemConfig(models.Model):
    """
    Runtime-editable system configuration stored in the database.

    Environment variables take precedence over database values when set.
    Changes to some settings require a restart to take effect.
    """

    key = models.CharField(
        max_length=100, primary_key=True, help_text="Unique configuration key (e.g., safety.vs_change_threshold)"
    )
    category = models.CharField(
        max_length=30, choices=CATEGORY_CHOICES, db_index=True, help_text="Configuration category for grouping in UI"
    )
    value = models.TextField(blank=True, help_text="Current configuration value (stored as text)")
    value_type = models.CharField(
        max_length=20, choices=VALUE_TYPE_CHOICES, default="string", help_text="Data type for proper serialization"
    )
    display_name = models.CharField(max_length=100, help_text="Human-readable name for UI display")
    description = models.TextField(blank=True, help_text="Detailed description of what this setting controls")
    validation_rules = models.JSONField(
        default=dict, blank=True, help_text="Validation rules: {min, max, pattern, choices, required}"
    )
    env_var = models.CharField(
        max_length=100, blank=True, null=True, help_text="Environment variable name that overrides this setting"
    )
    default_value = models.TextField(blank=True, help_text="Default value if not set")
    requires_restart = models.BooleanField(
        default=False, help_text="Whether changing this setting requires a service restart"
    )
    is_sensitive = models.BooleanField(default=False, help_text="Whether this value should be masked in responses")
    is_readonly = models.BooleanField(
        default=False, help_text="Whether this setting can be modified (some are env-only)"
    )
    sort_order = models.IntegerField(default=0, help_text="Display order within category")
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="config_updates",
        help_text="User who last modified this setting",
    )

    class Meta:
        db_table = "system_config"
        ordering = ["category", "sort_order", "key"]
        verbose_name = "System Configuration"
        verbose_name_plural = "System Configurations"

    def __str__(self):
        return f"{self.display_name} ({self.key})"

    def clean(self):
        """Validate the configuration value against rules."""
        if self.is_readonly:
            return

        errors = self.validate_value(self.value)
        if errors:
            raise ValidationError({"value": errors})

    def validate_value(self, value):
        """
        Validate a value against this config's rules.
        Returns list of error messages or empty list if valid.
        """
        errors = []
        rules = self.validation_rules or {}

        # Check required
        if rules.get("required") and not value:
            errors.append("This field is required")
            return errors

        # Type-specific validation
        if self.value_type == "integer":
            try:
                int_val = int(value) if value else 0
                if "min" in rules and int_val < rules["min"]:
                    errors.append(f"Value must be at least {rules['min']}")
                if "max" in rules and int_val > rules["max"]:
                    errors.append(f"Value must be at most {rules['max']}")
            except (ValueError, TypeError):
                errors.append("Value must be a valid integer")

        elif self.value_type == "float":
            try:
                float_val = float(value) if value else 0.0
                if "min" in rules and float_val < rules["min"]:
                    errors.append(f"Value must be at least {rules['min']}")
                if "max" in rules and float_val > rules["max"]:
                    errors.append(f"Value must be at most {rules['max']}")
            except (ValueError, TypeError):
                errors.append("Value must be a valid number")

        elif self.value_type == "boolean":
            if value.lower() not in ("true", "false", "1", "0", "yes", "no", "on", "off", ""):
                errors.append("Value must be true or false")

        elif self.value_type == "json":
            try:
                if value:
                    json.loads(value)
            except json.JSONDecodeError as e:
                errors.append(f"Invalid JSON: {e}")

        # Check choices
        if "choices" in rules and value and value not in rules["choices"]:
            errors.append(f"Value must be one of: {', '.join(rules['choices'])}")

        # Check pattern
        if "pattern" in rules and value:
            import re

            if not re.match(rules["pattern"], value):
                errors.append(f"Value must match pattern: {rules['pattern']}")

        return errors

    def get_typed_value(self):
        """Get the value converted to its proper Python type."""
        # Check for environment variable override first
        if self.env_var:
            env_value = os.environ.get(self.env_var)
            if env_value is not None:
                return self._convert_value(env_value)

        return self._convert_value(self.value)

    def _convert_value(self, value):
        """Convert string value to proper Python type."""
        if value is None or value == "":
            return self._convert_value(self.default_value) if self.default_value else None

        if self.value_type == "integer":
            try:
                return int(value)
            except (ValueError, TypeError):
                return int(self.default_value) if self.default_value else 0

        elif self.value_type == "float":
            try:
                return float(value)
            except (ValueError, TypeError):
                return float(self.default_value) if self.default_value else 0.0

        elif self.value_type == "boolean":
            return str(value).lower() in ("true", "1", "yes", "on")

        elif self.value_type == "json":
            try:
                return json.loads(value) if value else None
            except json.JSONDecodeError:
                return None

        # string and secret types
        return value

    def get_masked_value(self):
        """Get value with sensitive data masked."""
        if self.is_sensitive and self.value:
            return "****"
        return self.value

    def has_env_override(self):
        """Check if this config has an active environment variable override."""
        if self.env_var:
            return os.environ.get(self.env_var) is not None
        return False

    @classmethod
    def get_value(cls, key, default=None):
        """
        Get a configuration value by key.

        Checks environment variable first, then database, then default.
        """
        try:
            config = cls.objects.get(key=key)
            typed_value = config.get_typed_value()
            return typed_value if typed_value is not None else default
        except cls.DoesNotExist:
            return default

    @classmethod
    def set_value(cls, key, value, user=None):
        """
        Set a configuration value by key.

        Creates audit log entry for the change.
        """
        try:
            config = cls.objects.get(key=key)
            if config.is_readonly:
                raise ValidationError(f"Configuration {key} is read-only")

            old_value = config.value
            config.value = str(value) if value is not None else ""
            config.updated_by = user
            config.full_clean()
            config.save()

            # Create audit log
            ConfigAuditLog.objects.create(
                config_key=key,
                old_value=old_value,
                new_value=config.value,
                changed_by=user,
            )

            return config
        except cls.DoesNotExist:
            raise ValidationError(f"Configuration {key} does not exist")

    @classmethod
    def get_by_category(cls, category=None):
        """Get all configurations, optionally filtered by category."""
        qs = cls.objects.all()
        if category:
            qs = qs.filter(category=category)
        return qs.select_related("updated_by")

    @classmethod
    def bulk_update_values(cls, updates, user=None):
        """
        Update multiple configuration values at once.

        Args:
            updates: dict of {key: value}
            user: User making the changes

        Returns:
            tuple of (updated_configs, errors)
        """
        updated = []
        errors = {}

        for key, value in updates.items():
            try:
                config = cls.set_value(key, value, user)
                updated.append(config)
            except ValidationError as e:
                errors[key] = str(e)
            except DatabaseError as e:
                errors[key] = str(e)

        return updated, errors

    @classmethod
    def export_config(cls, include_sensitive=False):
        """
        Export all configurations as a dictionary.

        Args:
            include_sensitive: Whether to include sensitive values
        """
        configs = cls.objects.all()
        result = {}

        for config in configs:
            if config.is_sensitive and not include_sensitive:
                continue
            result[config.key] = {
                "value": config.value,
                "category": config.category,
                "value_type": config.value_type,
            }

        return result

    @classmethod
    def import_config(cls, data, user=None, skip_readonly=True):
        """
        Import configurations from a dictionary.

        Args:
            data: dict of {key: {value, ...}}
            user: User performing the import
            skip_readonly: Skip readonly configs instead of erroring

        Returns:
            tuple of (imported_count, skipped_count, errors)
        """
        imported = 0
        skipped = 0
        errors = {}

        for key, config_data in data.items():
            try:
                config = cls.objects.get(key=key)

                if config.is_readonly:
                    if skip_readonly:
                        skipped += 1
                        continue
                    else:
                        errors[key] = "Configuration is read-only"
                        continue

                value = config_data.get("value", config_data) if isinstance(config_data, dict) else config_data
                cls.set_value(key, value, user)
                imported += 1

            except cls.DoesNotExist:
                errors[key] = "Configuration does not exist"
            except ValidationError as e:
                errors[key] = str(e)

        return imported, skipped, errors


class ConfigAuditLog(models.Model):
    """
    Audit log for all configuration changes.

    Tracks who changed what, when, and from what value.
    """

    config_key = models.CharField(max_length=100, db_index=True, help_text="Configuration key that was changed")
    old_value = models.TextField(blank=True, null=True, help_text="Previous value before change")
    new_value = models.TextField(blank=True, help_text="New value after change")
    changed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="config_audit_logs",
        help_text="User who made the change",
    )
    changed_at = models.DateTimeField(auto_now_add=True, db_index=True, help_text="When the change was made")
    ip_address = models.GenericIPAddressField(
        null=True, blank=True, help_text="IP address of the client making the change"
    )

    class Meta:
        db_table = "config_audit_log"
        ordering = ["-changed_at"]
        indexes = [
            models.Index(fields=["config_key", "changed_at"], name="idx_config_audit_key"),
            models.Index(fields=["changed_by", "changed_at"], name="idx_config_audit_user"),
        ]
        verbose_name = "Configuration Audit Log"
        verbose_name_plural = "Configuration Audit Logs"

    def __str__(self):
        user = self.changed_by.username if self.changed_by else "system"
        return f"{self.config_key} changed by {user} at {self.changed_at}"

    def get_masked_values(self):
        """Get old and new values with sensitive data masked."""
        try:
            config = SystemConfig.objects.get(key=self.config_key)
            if config.is_sensitive:
                return "****", "****"
        except SystemConfig.DoesNotExist:
            pass
        return self.old_value, self.new_value
