"""Compact, rebuildable hourly aircraft statistics (raw sightings remain canonical)."""

from django.db import models


class TimeSummaryHour(models.Model):
    timestamp = models.DateTimeField(primary_key=True)
    dirty = models.BooleanField(default=True)
    built_at = models.DateTimeField(null=True)
    generation = models.BigIntegerField(default=1)


class TimeSummaryAircraft(models.Model):
    timestamp = models.DateTimeField(db_index=True)
    icao_hex = models.CharField(max_length=10)
    is_military = models.BooleanField()
    positions = models.BigIntegerField()
    altitude_sum = models.FloatField(default=0)
    altitude_count = models.BigIntegerField(default=0)
    distance_sum = models.FloatField(default=0)
    distance_count = models.BigIntegerField(default=0)
    distance_nm = models.FloatField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["timestamp", "icao_hex", "is_military"], name="unique_time_summary_aircraft"
            )
        ]
