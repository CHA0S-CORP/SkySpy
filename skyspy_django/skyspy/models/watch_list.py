"""
Watch list model for tracked aircraft.
"""

from django.db import models


class WatchedAircraft(models.Model):
    """Aircraft on the user's watch list."""

    hex = models.CharField(max_length=6, db_index=True, unique=True)
    callsign = models.CharField(max_length=10, blank=True, default="")
    registration = models.CharField(max_length=10, blank=True, default="")
    type_code = models.CharField(max_length=4, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "watched_aircraft"
        ordering = ["-added_at"]

    def __str__(self):
        return f"Watch: {self.hex} ({self.callsign or 'unknown'})"
