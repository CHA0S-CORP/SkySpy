"""
Serializers for system configuration management.
"""

from rest_framework import serializers

from skyspy.models.config import ConfigAuditLog, SystemConfig


class ConfigSerializer(serializers.ModelSerializer):
    """Full configuration response serializer."""

    value = serializers.SerializerMethodField()
    has_env_override = serializers.SerializerMethodField()
    updated_by_username = serializers.CharField(source="updated_by.username", read_only=True, allow_null=True)

    class Meta:
        model = SystemConfig
        fields = [
            "key",
            "category",
            "value",
            "value_type",
            "display_name",
            "description",
            "validation_rules",
            "env_var",
            "default_value",
            "requires_restart",
            "is_sensitive",
            "is_readonly",
            "sort_order",
            "has_env_override",
            "updated_at",
            "updated_by_username",
        ]
        read_only_fields = [
            "key",
            "category",
            "value_type",
            "display_name",
            "description",
            "validation_rules",
            "env_var",
            "default_value",
            "requires_restart",
            "is_sensitive",
            "is_readonly",
            "sort_order",
            "updated_at",
        ]

    def get_value(self, obj) -> str:
        """Return masked value for sensitive configs."""
        return obj.get_masked_value()

    def get_has_env_override(self, obj) -> bool:
        """Check if env var is currently overriding database value."""
        return obj.has_env_override()


class ConfigDetailSerializer(ConfigSerializer):
    """
    Detailed config response with reveal option for sensitive values.

    Used when admin explicitly requests to see a sensitive value.
    """

    actual_value = serializers.SerializerMethodField()

    class Meta(ConfigSerializer.Meta):
        fields = ConfigSerializer.Meta.fields + ["actual_value"]

    def get_actual_value(self, obj) -> str:
        """Return actual value (unmasked) - only for authorized reveal requests."""
        reveal = self.context.get("reveal", False)
        if reveal and obj.is_sensitive:
            return obj.value
        return None


class ConfigUpdateSerializer(serializers.Serializer):
    """Request body for updating a single configuration value."""

    value = serializers.CharField(allow_blank=True, help_text="New value for the configuration")

    def validate_value(self, value):
        """Validate against config's validation rules."""
        config = self.context.get("config")
        if config:
            errors = config.validate_value(value)
            if errors:
                raise serializers.ValidationError(errors)
        return value


class ConfigBulkUpdateSerializer(serializers.Serializer):
    """Request body for updating multiple configurations at once."""

    updates = serializers.DictField(
        child=serializers.CharField(allow_blank=True), help_text="Dictionary of {key: value} pairs to update"
    )

    def validate_updates(self, updates):
        """Validate all updates against their configs."""
        errors = {}

        for key, value in updates.items():
            try:
                config = SystemConfig.objects.get(key=key)
                if config.is_readonly:
                    errors[key] = ["Configuration is read-only"]
                    continue

                validation_errors = config.validate_value(value)
                if validation_errors:
                    errors[key] = validation_errors

            except SystemConfig.DoesNotExist:
                errors[key] = ["Configuration does not exist"]

        if errors:
            raise serializers.ValidationError(errors)

        return updates


class ConfigResetSerializer(serializers.Serializer):
    """Request body for resetting a configuration to default."""

    keys = serializers.ListField(
        child=serializers.CharField(max_length=100),
        min_length=1,
        help_text="List of configuration keys to reset to defaults",
    )


class ConfigExportSerializer(serializers.Serializer):
    """Response for configuration export."""

    configs = serializers.DictField(help_text="Dictionary of configuration key-value pairs")
    exported_at = serializers.DateTimeField(help_text="Export timestamp")
    version = serializers.CharField(help_text="Export format version")


class ConfigImportSerializer(serializers.Serializer):
    """Request body for importing configurations."""

    configs = serializers.DictField(help_text="Dictionary of {key: value} or {key: {value, ...}} pairs")
    skip_readonly = serializers.BooleanField(default=True, help_text="Skip read-only configs instead of erroring")
    dry_run = serializers.BooleanField(default=False, help_text="Validate without actually importing")


class ConfigImportResultSerializer(serializers.Serializer):
    """Response for configuration import."""

    imported = serializers.IntegerField(help_text="Number of configs imported")
    skipped = serializers.IntegerField(help_text="Number of configs skipped")
    errors = serializers.DictField(
        child=serializers.CharField(), help_text="Dictionary of {key: error_message} for failed imports"
    )


class ConfigAuditLogSerializer(serializers.ModelSerializer):
    """Audit log entry serializer."""

    old_value = serializers.SerializerMethodField()
    new_value = serializers.SerializerMethodField()
    changed_by_username = serializers.CharField(source="changed_by.username", read_only=True, allow_null=True)
    config_display_name = serializers.SerializerMethodField()

    class Meta:
        model = ConfigAuditLog
        fields = [
            "id",
            "config_key",
            "config_display_name",
            "old_value",
            "new_value",
            "changed_by",
            "changed_by_username",
            "changed_at",
            "ip_address",
        ]

    def get_old_value(self, obj) -> str:
        """Return masked old value for sensitive configs."""
        old, _ = obj.get_masked_values()
        return old

    def get_new_value(self, obj) -> str:
        """Return masked new value for sensitive configs."""
        _, new = obj.get_masked_values()
        return new

    def get_config_display_name(self, obj) -> str:
        """Get the display name for the config key."""
        try:
            config = SystemConfig.objects.get(key=obj.config_key)
            return config.display_name
        except SystemConfig.DoesNotExist:
            return obj.config_key


class ConfigSchemaSerializer(serializers.Serializer):
    """Schema information for frontend form generation."""

    categories = serializers.ListField(child=serializers.DictField(), help_text="Available categories with labels")
    value_types = serializers.ListField(child=serializers.DictField(), help_text="Available value types with labels")
    configs = ConfigSerializer(many=True, help_text="All configuration definitions")


class ConfigCategorySerializer(serializers.Serializer):
    """Grouped configurations by category."""

    category = serializers.CharField(help_text="Category key")
    category_display = serializers.CharField(help_text="Category display name")
    configs = ConfigSerializer(many=True, help_text="Configurations in this category")
    has_changes = serializers.BooleanField(
        default=False, help_text="Whether any config in this category requires restart"
    )


class ConfigListResponseSerializer(serializers.Serializer):
    """Response for listing all configurations grouped by category."""

    categories = ConfigCategorySerializer(many=True, help_text="Configs grouped by category")
    total_count = serializers.IntegerField(help_text="Total number of configurations")


class ConfigValidateSerializer(serializers.Serializer):
    """Request body for validating a configuration value."""

    key = serializers.CharField(max_length=100, help_text="Configuration key to validate")
    value = serializers.CharField(allow_blank=True, help_text="Value to validate")


class ConfigValidateResponseSerializer(serializers.Serializer):
    """Response for configuration validation."""

    valid = serializers.BooleanField(help_text="Whether the value is valid")
    errors = serializers.ListField(child=serializers.CharField(), help_text="List of validation error messages")
