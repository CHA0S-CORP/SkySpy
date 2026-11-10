"""Bounded hourly rebuilds; PostgreSQL marks affected hours on insert/delete.

One row per aircraft/military flag/hour preserves exact distinct counts across
hours. Weighted averages use non-null observation counts, never average averages.
The refresh lock in time_comparison_stats serializes rebuilds and readers.
"""

import time
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Max, Min, Sum
from django.utils import timezone

from skyspy.models import AircraftSighting, TimeSummaryAircraft, TimeSummaryHour


def rebuild_hours(max_hours=24, budget_seconds=10):
    now = timezone.now()
    floor = (now - timedelta(days=397)).replace(minute=0, second=0, microsecond=0)
    current = now.replace(minute=0, second=0, microsecond=0)
    earliest = AircraftSighting.objects.filter(timestamp__gte=floor).aggregate(first=Min("timestamp"))["first"]
    earliest = earliest or now
    first = earliest.replace(minute=0, second=0, microsecond=0)
    existing = set(TimeSummaryHour.objects.filter(timestamp__gte=first).values_list("timestamp", flat=True))
    missing = []
    hour = first
    while hour <= current:
        if hour not in existing:
            missing.append(TimeSummaryHour(timestamp=hour))
        hour += timedelta(hours=1)
    TimeSummaryHour.objects.bulk_create(missing, ignore_conflicts=True, batch_size=500)
    # Catch changes in the open hour even on non-Postgres test databases.
    TimeSummaryHour.objects.filter(timestamp=current).update(dirty=True)
    started = time.monotonic()
    pending = TimeSummaryHour.objects.filter(dirty=True, timestamp__gte=floor).order_by("-timestamp")[:max_hours]
    for marker in pending:
        if time.monotonic() - started >= budget_seconds:
            break
        end = marker.timestamp + timedelta(hours=1)
        rows = (
            AircraftSighting.objects.filter(timestamp__gte=marker.timestamp, timestamp__lt=end)
            .values("icao_hex", "is_military")
            .annotate(
                positions=Count("id"),
                altitude_sum=Sum("altitude_baro"),
                altitude_count=Count("altitude_baro"),
                distance_sum=Sum("distance_nm"),
                distance_count=Count("distance_nm"),
                distance_nm=Max("distance_nm"),
            )
        )
        buckets = [
            TimeSummaryAircraft(
                timestamp=marker.timestamp,
                **{**row, "altitude_sum": row["altitude_sum"] or 0, "distance_sum": row["distance_sum"] or 0},
            )
            for row in rows
        ]
        with transaction.atomic():
            TimeSummaryAircraft.objects.filter(timestamp=marker.timestamp).delete()
            TimeSummaryAircraft.objects.bulk_create(buckets, batch_size=500)
            TimeSummaryHour.objects.filter(timestamp=marker.timestamp).update(built_at=now)
            # A concurrent insert increments generation; leave the hour dirty
            # rather than incorrectly declaring a potentially stale rebuild final.
            TimeSummaryHour.objects.filter(timestamp=marker.timestamp, generation=marker.generation).update(dirty=False)
    TimeSummaryAircraft.objects.filter(timestamp__lt=floor).delete()
    TimeSummaryHour.objects.filter(timestamp__lt=floor).delete()
    return not TimeSummaryHour.objects.filter(built_at__isnull=True, timestamp__gte=floor).exists()
