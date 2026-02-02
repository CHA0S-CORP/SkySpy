"""
Celery task results API views.

Provides endpoints to query and manage Celery task results stored
via django-celery-results.
"""

import contextlib
import logging

from celery import current_app
from celery.result import AsyncResult
from django_celery_results.models import TaskResult
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import FeatureBasedPermission
from skyspy.serializers.tasks import (
    TaskResultSerializer,
    TaskResultSummarySerializer,
    TaskStatusSerializer,
)

logger = logging.getLogger(__name__)


class TaskResultViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for querying Celery task results.

    Provides read-only access to task execution history and status.
    Useful for tracking long-running background operations.
    """

    queryset = TaskResult.objects.all()
    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "task_name", "worker"]
    search_fields = ["task_id", "task_name"]
    ordering_fields = ["date_created", "date_done", "status"]
    ordering = ["-date_created"]
    lookup_field = "task_id"

    def get_serializer_class(self):
        if self.action == "list":
            return TaskResultSummarySerializer
        return TaskResultSerializer

    @extend_schema(
        summary="List task results",
        description="List all stored Celery task results with filtering and pagination",
        parameters=[
            OpenApiParameter(
                name="status",
                type=str,
                description="Filter by status (PENDING, STARTED, SUCCESS, FAILURE, RETRY, REVOKED)",
            ),
            OpenApiParameter(name="task_name", type=str, description="Filter by task name"),
            OpenApiParameter(name="worker", type=str, description="Filter by worker hostname"),
            OpenApiParameter(name="search", type=str, description="Search by task_id or task_name"),
        ],
        responses={200: TaskResultSummarySerializer(many=True)},
    )
    def list(self, request, *args, **kwargs):
        """List task results with optional filtering."""
        queryset = self.filter_queryset(self.get_queryset())

        # Apply limit from query params
        limit = request.query_params.get("limit")
        if limit:
            with contextlib.suppress(ValueError, TypeError):
                queryset = queryset[: int(limit)]

        serializer = self.get_serializer(queryset, many=True)
        return Response(
            {
                "tasks": serializer.data,
                "count": len(serializer.data),
            }
        )

    @extend_schema(
        summary="Get task result",
        description="Get detailed information about a specific task by its ID",
        responses={200: TaskResultSerializer},
    )
    def retrieve(self, request, *args, **kwargs):
        """Get detailed task result by task_id."""
        return super().retrieve(request, *args, **kwargs)

    @extend_schema(
        summary="Get live task status",
        description="Get the current status of a task from Celery (not just the database). Useful for checking tasks that may still be running.",
        responses={200: TaskStatusSerializer},
    )
    @action(detail=True, methods=["get"])
    def status(self, request, task_id=None):
        """
        Get live task status from Celery.

        This queries Celery directly rather than the database, so it can
        return status for tasks that haven't completed yet.
        """
        result = AsyncResult(task_id)

        response_data = {
            "task_id": task_id,
            "status": result.status,
            "result": None,
            "traceback": None,
            "date_done": None,
        }

        if result.ready():
            # Task is complete
            try:
                response_data["result"] = result.result
                if result.failed():
                    response_data["traceback"] = str(result.traceback)
            except Exception as e:
                logger.warning(f"Could not get result for task {task_id}: {e}")
                response_data["result"] = {"error": str(e)}

        # Try to get date_done from database if available
        try:
            db_result = TaskResult.objects.filter(task_id=task_id).first()
            if db_result and db_result.date_done:
                response_data["date_done"] = db_result.date_done.isoformat()
        except Exception:
            pass

        return Response(response_data)

    @extend_schema(
        summary="Revoke/cancel a task",
        description="Attempt to revoke a pending or running task. Only works for tasks that haven't completed.",
        responses={200: dict},
    )
    @action(detail=True, methods=["post"])
    def revoke(self, request, task_id=None):
        """
        Revoke (cancel) a pending or running task.

        Note: This sends a revoke signal to workers. Tasks already running
        may not be immediately stopped unless they check for revocation.
        """
        terminate = request.data.get("terminate", False)

        try:
            result = AsyncResult(task_id)

            if result.ready():
                return Response(
                    {
                        "success": False,
                        "message": f"Task already completed with status: {result.status}",
                        "task_id": task_id,
                    }
                )

            # Revoke the task
            result.revoke(terminate=terminate)

            return Response(
                {
                    "success": True,
                    "message": "Task revocation signal sent",
                    "task_id": task_id,
                    "terminate": terminate,
                }
            )

        except Exception as e:
            logger.error(f"Failed to revoke task {task_id}: {e}")
            return Response(
                {"success": False, "message": str(e), "task_id": task_id},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @extend_schema(
        summary="Get task statistics",
        description="Get aggregated statistics about task execution",
        responses={200: dict},
    )
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get task execution statistics."""
        from datetime import timedelta

        from django.db.models import Avg, Count, F
        from django.utils import timezone

        # Get time range from query params (default: last 24 hours)
        hours = int(request.query_params.get("hours", 24))
        cutoff = timezone.now() - timedelta(hours=hours)

        # Filter by task name if specified
        task_name = request.query_params.get("task_name")
        queryset = TaskResult.objects.filter(date_created__gte=cutoff)
        if task_name:
            queryset = queryset.filter(task_name=task_name)

        # Status counts
        status_counts = dict(queryset.values("status").annotate(count=Count("id")).values_list("status", "count"))

        # Tasks by name (top 10)
        by_name = list(queryset.values("task_name").annotate(count=Count("id")).order_by("-count")[:10])

        # Average duration for completed tasks
        completed = queryset.filter(
            status="SUCCESS",
            date_done__isnull=False,
        )
        avg_duration = completed.annotate(duration=F("date_done") - F("date_created")).aggregate(avg=Avg("duration"))

        avg_duration_ms = None
        if avg_duration["avg"]:
            avg_duration_ms = int(avg_duration["avg"].total_seconds() * 1000)

        # Recent failures
        recent_failures = list(
            queryset.filter(status="FAILURE")
            .order_by("-date_created")
            .values("task_id", "task_name", "date_created", "traceback")[:5]
        )

        # Workers
        workers = list(
            queryset.exclude(worker__isnull=True)
            .exclude(worker="")
            .values("worker")
            .annotate(count=Count("id"))
            .order_by("-count")
        )

        return Response(
            {
                "period_hours": hours,
                "total_tasks": queryset.count(),
                "status_counts": status_counts,
                "by_name": by_name,
                "avg_duration_ms": avg_duration_ms,
                "recent_failures": recent_failures,
                "workers": workers,
            }
        )

    @extend_schema(
        summary="List registered tasks",
        description="Get list of all Celery tasks registered with the application",
        responses={200: dict},
    )
    @action(detail=False, methods=["get"])
    def registered(self, request):
        """List all registered Celery tasks."""
        try:
            tasks = sorted(current_app.tasks.keys())
            # Filter out internal celery tasks
            app_tasks = [t for t in tasks if not t.startswith("celery.")]

            return Response(
                {
                    "tasks": app_tasks,
                    "count": len(app_tasks),
                }
            )
        except Exception as e:
            logger.error(f"Failed to get registered tasks: {e}")
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @extend_schema(
        summary="Get active tasks",
        description="Get currently executing tasks from Celery workers (requires active workers)",
        responses={200: dict},
    )
    @action(detail=False, methods=["get"])
    def active(self, request):
        """Get currently active (running) tasks from workers."""
        try:
            inspect = current_app.control.inspect()
            active = inspect.active() or {}

            # Flatten and format
            tasks = []
            for worker, worker_tasks in active.items():
                for task in worker_tasks:
                    tasks.append(
                        {
                            "task_id": task.get("id"),
                            "task_name": task.get("name"),
                            "worker": worker,
                            "args": task.get("args"),
                            "kwargs": task.get("kwargs"),
                            "time_start": task.get("time_start"),
                        }
                    )

            return Response(
                {
                    "active_tasks": tasks,
                    "count": len(tasks),
                    "workers": list(active.keys()),
                }
            )
        except Exception as e:
            logger.warning(f"Could not get active tasks (workers may be offline): {e}")
            return Response(
                {
                    "active_tasks": [],
                    "count": 0,
                    "workers": [],
                    "warning": "Could not reach workers - they may be offline",
                }
            )

    @extend_schema(
        summary="Purge old task results",
        description="Delete task results older than the specified number of days",
        responses={200: dict},
    )
    @action(detail=False, methods=["post"])
    def purge(self, request):
        """Purge old task results from the database."""
        from datetime import timedelta

        from django.utils import timezone

        days = int(request.data.get("days", 7))
        if days < 1:
            return Response(
                {"error": "days must be at least 1"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cutoff = timezone.now() - timedelta(days=days)

        # Count before delete
        count = TaskResult.objects.filter(date_created__lt=cutoff).count()

        if count > 0:
            TaskResult.objects.filter(date_created__lt=cutoff).delete()

        return Response(
            {
                "deleted": count,
                "cutoff_date": cutoff.isoformat(),
                "days": days,
            }
        )
