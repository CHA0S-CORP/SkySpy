"""
Serializers for Celery task results.
"""

from django_celery_results.models import TaskResult
from rest_framework import serializers


class TaskResultSerializer(serializers.ModelSerializer):
    """Serializer for Celery task results."""

    class Meta:
        model = TaskResult
        fields = [
            "task_id",
            "task_name",
            "task_args",
            "task_kwargs",
            "status",
            "result",
            "date_created",
            "date_done",
            "traceback",
            "meta",
            "worker",
        ]
        read_only_fields = fields


class TaskResultSummarySerializer(serializers.ModelSerializer):
    """Compact serializer for task list views."""

    duration_ms = serializers.SerializerMethodField()

    class Meta:
        model = TaskResult
        fields = [
            "task_id",
            "task_name",
            "status",
            "date_created",
            "date_done",
            "duration_ms",
            "worker",
        ]
        read_only_fields = fields

    def get_duration_ms(self, obj):
        """Calculate task duration in milliseconds."""
        if obj.date_done and obj.date_created:
            delta = obj.date_done - obj.date_created
            return int(delta.total_seconds() * 1000)
        return None


class TaskStatusSerializer(serializers.Serializer):
    """Serializer for async task status response."""

    task_id = serializers.CharField()
    status = serializers.CharField()
    result = serializers.JSONField(allow_null=True)
    traceback = serializers.CharField(allow_null=True)
    date_done = serializers.DateTimeField(allow_null=True)


class TaskSubmitResponseSerializer(serializers.Serializer):
    """Response serializer for task submission endpoints."""

    task_id = serializers.CharField(help_text="Unique task ID to track progress")
    status = serializers.CharField(help_text="Initial task status (usually PENDING)")
    message = serializers.CharField(help_text="Human-readable status message")
