"""
Drop three unused indexes on aircraft_sightings.

idx_sighting_distance / idx_sighting_rssi / idx_sighting_track were added in
0011 (RPi perf) but recorded ZERO index scans across ~5 days of production while
costing ~741 MB and an index write on every insert (~8.7M rows/day) — pure
write-amplification on the hottest table. The antenna-analytics task reads these
columns but filters by ``timestamp`` (idx_sighting_timestamp_desc), so it never
uses them. Dropping them speeds the stream-flush insert path and VACUUM.

Idempotent (IF EXISTS): a no-op on hosts where they were already dropped by hand.
Reverse recreates them (matching the 0011 definitions) so a rollback restores.
"""
from django.db import connection, migrations


def is_postgresql():
    return connection.vendor == "postgresql"


class PostgreSQLOnlyRunSQL(migrations.RunSQL):
    """RunSQL that only executes on PostgreSQL (sqlite build/test skips it)."""

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        if is_postgresql():
            super().database_forwards(app_label, schema_editor, from_state, to_state)

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        if is_postgresql():
            super().database_backwards(app_label, schema_editor, from_state, to_state)


class Migration(migrations.Migration):
    # CREATE/DROP INDEX CONCURRENTLY cannot run inside a transaction.
    atomic = False

    dependencies = [
        ("skyspy", "0048_liveaircraftposition"),
    ]

    operations = [
        PostgreSQLOnlyRunSQL(
            sql="DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_distance;",
            reverse_sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_distance
                ON aircraft_sightings(distance_nm)
                WHERE distance_nm IS NOT NULL;
            """,
        ),
        PostgreSQLOnlyRunSQL(
            sql="DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_rssi;",
            reverse_sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_rssi
                ON aircraft_sightings(rssi)
                WHERE rssi IS NOT NULL;
            """,
        ),
        PostgreSQLOnlyRunSQL(
            sql="DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_track;",
            reverse_sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_track
                ON aircraft_sightings(track)
                WHERE track IS NOT NULL;
            """,
        ),
    ]
