"""
System configuration management API views.

Provides admin-only endpoints for managing runtime-editable configuration
stored in the database. Environment variables always take precedence.
"""

import logging

from django.core.exceptions import ValidationError
from django.db import DatabaseError
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from skyspy.api.throttles import AuthRateThrottle
from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import HasSystemManagePermission
from skyspy.models.config import CATEGORY_CHOICES, ConfigAuditLog, SystemConfig
from skyspy.serializers.config import (
    ConfigAuditLogSerializer,
    ConfigBulkUpdateSerializer,
    ConfigCategorySerializer,
    ConfigDetailSerializer,
    ConfigImportResultSerializer,
    ConfigImportSerializer,
    ConfigListResponseSerializer,
    ConfigResetSerializer,
    ConfigSchemaSerializer,
    ConfigSerializer,
    ConfigUpdateSerializer,
    ConfigValidateResponseSerializer,
    ConfigValidateSerializer,
)

logger = logging.getLogger(__name__)


def get_client_ip(request):
    """Extract client IP from request."""
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


class ConfigViewSet(viewsets.ViewSet):
    """
    ViewSet for system configuration management.

    Requires system.manage permission (admin/superadmin only).
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [HasSystemManagePermission]
    throttle_classes = [AuthRateThrottle]
    # Allow dots in lookup field (for keys like 'safety.vs_change_threshold')
    lookup_field = "pk"
    lookup_value_regex = r"[^/]+"

    @extend_schema(
        summary="List all configurations",
        description="Get all configurations grouped by category",
        parameters=[
            OpenApiParameter(name="category", type=str, description="Filter by category"),
        ],
        responses={200: ConfigListResponseSerializer},
    )
    def list(self, request):
        """List all configurations grouped by category."""
        category_filter = request.query_params.get("category")

        # Validate category_filter against CATEGORY_CHOICES
        valid_categories = {cat_key for cat_key, _ in CATEGORY_CHOICES}
        if category_filter and category_filter not in valid_categories:
            return Response(
                {"error": f"Invalid category. Must be one of: {', '.join(sorted(valid_categories))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queryset = SystemConfig.objects.select_related("updated_by")
        if category_filter:
            queryset = queryset.filter(category=category_filter)

        # Group by category
        categories_data = []
        dict(CATEGORY_CHOICES)

        for cat_key, cat_display in CATEGORY_CHOICES:
            cat_configs = [c for c in queryset if c.category == cat_key]
            if not cat_configs:
                continue

            serializer = ConfigSerializer(cat_configs, many=True, context={"request": request})
            has_restart = any(c.requires_restart for c in cat_configs)

            categories_data.append(
                {
                    "category": cat_key,
                    "category_display": cat_display,
                    "configs": serializer.data,
                    "has_changes": has_restart,
                }
            )

        return Response(
            {
                "categories": categories_data,
                "total_count": queryset.count(),
            }
        )

    @extend_schema(summary="Get configuration by key", responses={200: ConfigDetailSerializer})
    def retrieve(self, request, pk=None):
        """Get a single configuration by key."""
        try:
            config = SystemConfig.objects.select_related("updated_by").get(key=pk)
        except SystemConfig.DoesNotExist:
            return Response({"error": "Configuration not found"}, status=status.HTTP_404_NOT_FOUND)

        # Check if reveal is requested for sensitive values
        reveal = request.query_params.get("reveal", "").lower() == "true"

        serializer = ConfigDetailSerializer(config, context={"request": request, "reveal": reveal})
        return Response(serializer.data)

    @extend_schema(summary="Update configuration", request=ConfigUpdateSerializer, responses={200: ConfigSerializer})
    def partial_update(self, request, pk=None):
        """Update a single configuration value."""
        try:
            config = SystemConfig.objects.get(key=pk)
        except SystemConfig.DoesNotExist:
            return Response({"error": "Configuration not found"}, status=status.HTTP_404_NOT_FOUND)

        if config.is_readonly:
            return Response({"error": "Configuration is read-only"}, status=status.HTTP_403_FORBIDDEN)

        serializer = ConfigUpdateSerializer(data=request.data, context={"request": request, "config": config})
        serializer.is_valid(raise_exception=True)

        old_value = config.value
        new_value = serializer.validated_data["value"]

        # Update the config
        config.value = new_value
        config.updated_by = request.user if request.user.is_authenticated else None
        config.save()

        # Create audit log
        ConfigAuditLog.objects.create(
            config_key=pk,
            old_value=old_value,
            new_value=new_value,
            changed_by=request.user if request.user.is_authenticated else None,
            ip_address=get_client_ip(request),
        )

        logger.info(f"Config {pk} updated by {request.user}: {old_value} -> {new_value}")

        return Response(ConfigSerializer(config, context={"request": request}).data)

    @extend_schema(
        summary="Get configuration schema",
        description="Get schema information for frontend form generation",
        responses={200: ConfigSchemaSerializer},
    )
    @action(detail=False, methods=["get"])
    def schema(self, request):
        """Get configuration schema for form generation."""
        configs = SystemConfig.objects.select_related("updated_by").all()
        serializer = ConfigSerializer(configs, many=True, context={"request": request})

        return Response(
            {
                "categories": [{"value": k, "label": v} for k, v in CATEGORY_CHOICES],
                "value_types": [
                    {"value": "string", "label": "String"},
                    {"value": "integer", "label": "Integer"},
                    {"value": "float", "label": "Float"},
                    {"value": "boolean", "label": "Boolean"},
                    {"value": "json", "label": "JSON"},
                    {"value": "secret", "label": "Secret"},
                ],
                "configs": serializer.data,
            }
        )

    @extend_schema(summary="Bulk update configurations", request=ConfigBulkUpdateSerializer, responses={200: dict})
    @action(detail=False, methods=["post"])
    def bulk_update(self, request):
        """Update multiple configurations at once."""
        serializer = ConfigBulkUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        updates = serializer.validated_data["updates"]
        user = request.user if request.user.is_authenticated else None
        ip_address = get_client_ip(request)

        updated = []
        errors = {}
        requires_restart = []

        for key, value in updates.items():
            try:
                config = SystemConfig.objects.get(key=key)

                if config.is_readonly:
                    errors[key] = "Configuration is read-only"
                    continue

                old_value = config.value
                config.value = value
                config.updated_by = user
                config.save()

                # Create audit log
                ConfigAuditLog.objects.create(
                    config_key=key,
                    old_value=old_value,
                    new_value=value,
                    changed_by=user,
                    ip_address=ip_address,
                )

                updated.append(key)
                if config.requires_restart:
                    requires_restart.append(key)

            except SystemConfig.DoesNotExist:
                errors[key] = "Configuration does not exist"
            except (DatabaseError, ValidationError, ValueError, TypeError) as e:
                errors[key] = str(e)

        return Response(
            {
                "updated": updated,
                "errors": errors,
                "requires_restart": requires_restart,
            }
        )

    @extend_schema(summary="Reset configurations to defaults", request=ConfigResetSerializer, responses={200: dict})
    @action(detail=False, methods=["post"])
    def reset_to_default(self, request):
        """Reset configurations to their default values."""
        keys = request.data.get("keys", [])

        if not keys:
            return Response({"error": "No keys provided"}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user if request.user.is_authenticated else None
        ip_address = get_client_ip(request)

        reset = []
        errors = {}

        for key in keys:
            try:
                config = SystemConfig.objects.get(key=key)

                if config.is_readonly:
                    errors[key] = "Configuration is read-only"
                    continue

                old_value = config.value
                config.value = config.default_value
                config.updated_by = user
                config.save()

                # Create audit log
                ConfigAuditLog.objects.create(
                    config_key=key,
                    old_value=old_value,
                    new_value=config.default_value,
                    changed_by=user,
                    ip_address=ip_address,
                )

                reset.append(key)

            except SystemConfig.DoesNotExist:
                errors[key] = "Configuration does not exist"

        return Response(
            {
                "reset": reset,
                "errors": errors,
            }
        )

    @extend_schema(
        summary="View configuration audit log",
        parameters=[
            OpenApiParameter(name="config_key", type=str, description="Filter by config key"),
            OpenApiParameter(name="hours", type=int, description="Time range in hours"),
            OpenApiParameter(name="limit", type=int, description="Maximum entries to return"),
        ],
        responses={200: ConfigAuditLogSerializer(many=True)},
    )
    @action(detail=False, methods=["get"])
    def audit_log(self, request):
        """View configuration change history."""
        queryset = ConfigAuditLog.objects.select_related("changed_by")

        # Filter by config key
        config_key = request.query_params.get("config_key")
        if config_key:
            queryset = queryset.filter(config_key=config_key)

        # Filter by time range
        hours = request.query_params.get("hours")
        if hours:
            try:
                hours = int(hours)
                cutoff = timezone.now() - timezone.timedelta(hours=hours)
                queryset = queryset.filter(changed_at__gte=cutoff)
            except ValueError:
                pass

        # Limit results
        limit = request.query_params.get("limit", 100)
        try:
            limit = min(int(limit), 500)
        except ValueError:
            limit = 100

        queryset = queryset.order_by("-changed_at")[:limit]
        serializer = ConfigAuditLogSerializer(queryset, many=True)

        return Response(
            {
                "audit_log": serializer.data,
                "count": len(serializer.data),
            }
        )

    @extend_schema(
        summary="Export configurations",
        parameters=[
            OpenApiParameter(name="include_sensitive", type=bool, description="Include sensitive values"),
        ],
        responses={200: dict},
    )
    @action(detail=False, methods=["get"])
    def export(self, request):
        """Export all configurations as JSON."""
        include_sensitive = request.query_params.get("include_sensitive", "").lower() == "true"

        configs = SystemConfig.export_config(include_sensitive=include_sensitive)

        return Response(
            {
                "configs": configs,
                "exported_at": timezone.now().isoformat(),
                "version": "1.0",
                "include_sensitive": include_sensitive,
            }
        )

    @extend_schema(
        summary="Import configurations", request=ConfigImportSerializer, responses={200: ConfigImportResultSerializer}
    )
    @action(detail=False, methods=["post"])
    def import_config(self, request):
        """Import configurations from JSON."""
        serializer = ConfigImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        configs = serializer.validated_data["configs"]
        skip_readonly = serializer.validated_data.get("skip_readonly", True)
        dry_run = serializer.validated_data.get("dry_run", False)

        if dry_run:
            # Validate without actually importing
            imported = 0
            skipped = 0
            errors = {}

            for key, config_data in configs.items():
                try:
                    config = SystemConfig.objects.get(key=key)
                    if config.is_readonly:
                        if skip_readonly:
                            skipped += 1
                        else:
                            errors[key] = "Configuration is read-only"
                        continue

                    value = config_data.get("value", config_data) if isinstance(config_data, dict) else config_data
                    validation_errors = config.validate_value(value)
                    if validation_errors:
                        errors[key] = validation_errors
                    else:
                        imported += 1

                except SystemConfig.DoesNotExist:
                    errors[key] = "Configuration does not exist"

            return Response(
                {
                    "imported": imported,
                    "skipped": skipped,
                    "errors": errors,
                    "dry_run": True,
                }
            )

        # Actual import
        user = request.user if request.user.is_authenticated else None
        imported, skipped, errors = SystemConfig.import_config(configs, user=user, skip_readonly=skip_readonly)

        return Response(
            {
                "imported": imported,
                "skipped": skipped,
                "errors": errors,
                "dry_run": False,
            }
        )

    @extend_schema(
        summary="Validate configuration value",
        request=ConfigValidateSerializer,
        responses={200: ConfigValidateResponseSerializer},
    )
    @action(detail=False, methods=["post"])
    def validate(self, request):
        """Validate a configuration value without saving."""
        key = request.data.get("key")
        value = request.data.get("value", "")

        if not key:
            return Response({"error": "key is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            config = SystemConfig.objects.get(key=key)
        except SystemConfig.DoesNotExist:
            return Response(
                {"valid": False, "errors": ["Configuration does not exist"]},
            )

        errors = config.validate_value(value)

        return Response(
            {
                "valid": len(errors) == 0,
                "errors": errors,
            }
        )

    @extend_schema(summary="Get configuration by category", responses={200: ConfigCategorySerializer})
    @action(detail=False, methods=["get"], url_path="category/(?P<category>[^/.]+)")
    def by_category(self, request, category=None):
        """Get all configurations for a specific category."""
        category_dict = dict(CATEGORY_CHOICES)

        if category not in category_dict:
            return Response(
                {"error": f"Invalid category. Must be one of: {', '.join(category_dict.keys())}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        configs = SystemConfig.objects.filter(category=category).select_related("updated_by")
        serializer = ConfigSerializer(configs, many=True, context={"request": request})
        has_restart = any(c.requires_restart for c in configs)

        return Response(
            {
                "category": category,
                "category_display": category_dict[category],
                "configs": serializer.data,
                "has_changes": has_restart,
            }
        )

    @extend_schema(
        summary="Reveal sensitive value",
        description="Get the actual value of a sensitive configuration (requires additional confirmation)",
        responses={200: dict},
    )
    @action(detail=True, methods=["post"])
    def reveal(self, request, pk=None):
        """Reveal the actual value of a sensitive configuration."""
        try:
            config = SystemConfig.objects.get(key=pk)
        except SystemConfig.DoesNotExist:
            return Response({"error": "Configuration not found"}, status=status.HTTP_404_NOT_FOUND)

        if not config.is_sensitive:
            return Response({"error": "Configuration is not sensitive"}, status=status.HTTP_400_BAD_REQUEST)

        # Log the reveal action
        logger.info(f"Sensitive config {pk} revealed by {request.user}")

        return Response(
            {
                "key": config.key,
                "value": config.value,
                "revealed_at": timezone.now().isoformat(),
            }
        )


# =============================================================================
# Task Metrics Views
# =============================================================================


class TaskMetricsView(viewsets.ViewSet):
    """
    ViewSet for Celery task metrics monitoring.

    Requires system.manage permission (admin/superadmin only).
    Provides real-time visibility into background task health.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [HasSystemManagePermission]
    throttle_classes = [AuthRateThrottle]

    @extend_schema(
        summary="Get task metrics",
        description="Get comprehensive Celery task execution metrics",
        parameters=[
            OpenApiParameter(
                name="format",
                type=str,
                description="Output format: 'json' (default) or 'prometheus'",
            ),
            OpenApiParameter(
                name="task",
                type=str,
                description="Filter metrics for a specific task name",
            ),
        ],
        responses={200: dict},
    )
    def list(self, request):
        """Get all task metrics."""
        from skyspy.services.task_metrics import task_metrics

        output_format = request.query_params.get("format", "json")
        task_filter = request.query_params.get("task")

        if output_format == "prometheus":
            return Response(task_metrics.export_prometheus(), content_type="text/plain")

        if task_filter:
            metrics = task_metrics.get_task_metrics(task_filter)
            if not metrics:
                return Response(
                    {"error": f"No metrics found for task: {task_filter}"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            return Response({"task": task_filter, "metrics": metrics})

        return Response(task_metrics.get_all_metrics())

    @extend_schema(
        summary="Get task health status",
        description="Check health of critical tasks and detect issues",
        responses={200: dict},
    )
    @action(detail=False, methods=["get"])
    def health(self, request):
        """Get task health status."""
        from skyspy.services.task_metrics import task_metrics

        # Expected max age for critical tasks (in seconds)
        critical_task_intervals = {
            "skyspy.tasks.aircraft.poll_aircraft": 10,
            "skyspy.tasks.aircraft.update_aircraft_sessions_from_cache": 30,
            "skyspy.tasks.aircraft.update_stats_cache": 120,
            "skyspy.tasks.aircraft.update_safety_stats": 90,
            "skyspy.tasks.aircraft_stream.stream_aircraft": 120,
            "skyspy.tasks.analytics.update_antenna_analytics": 360,
        }

        stale_tasks = task_metrics.get_stale_tasks(critical_task_intervals)
        failing_tasks = task_metrics.get_failing_tasks(min_failure_rate=0.3, min_executions=5)

        all_metrics = task_metrics.get_all_metrics()

        health_status = "degraded" if stale_tasks or failing_tasks else "healthy"

        return Response(
            {
                "status": health_status,
                "stale_tasks": stale_tasks,
                "failing_tasks": failing_tasks,
                "queues": all_metrics.get("queues", {}),
                "total_active": all_metrics.get("total_active", 0),
                "total_executions": all_metrics.get("total_executions", 0),
                "total_failures": all_metrics.get("total_failures", 0),
            }
        )

    @extend_schema(
        summary="Get queue depths",
        description="Get current depth of all Celery queues",
        responses={200: dict},
    )
    @action(detail=False, methods=["get"])
    def queues(self, request):
        """Get queue depth information."""
        from skyspy.services.task_metrics import task_metrics

        all_metrics = task_metrics.get_all_metrics()

        queues = all_metrics.get("queues", {})
        total_depth = sum(queues.values())

        # Flag any queues with high depth
        warnings = []
        for queue, depth in queues.items():
            if depth > 100:
                warnings.append(f"Queue '{queue}' has {depth} pending tasks")

        return Response(
            {
                "queues": queues,
                "total_depth": total_depth,
                "warnings": warnings,
            }
        )

    @extend_schema(
        summary="Reset task metrics",
        description="Reset metrics for a specific task or all tasks",
        request=dict,
        responses={200: dict},
    )
    @action(detail=False, methods=["post"])
    def reset(self, request):
        """Reset task metrics."""
        from skyspy.services.task_metrics import task_metrics

        task_name = request.data.get("task")

        if task_name:
            task_metrics.reset_task_metrics(task_name)
            logger.info(f"Task metrics reset for {task_name} by {request.user}")
            return Response({"status": "ok", "message": f"Metrics reset for {task_name}"})
        else:
            task_metrics.reset_all_metrics()
            logger.info(f"All task metrics reset by {request.user}")
            return Response({"status": "ok", "message": "All metrics reset"})
