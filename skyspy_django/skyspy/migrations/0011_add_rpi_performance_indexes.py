"""
Migration to add performance-optimized indexes for Raspberry Pi deployment.

These indexes significantly improve query performance for:
- Time-based sighting queries (timestamp DESC)
- Distance-based filtering
- Active session lookups
- Recent aircraft discovery
"""
from django.db import connection, migrations


def is_postgresql():
    """Check if we're using PostgreSQL."""
    return connection.vendor == 'postgresql'


class PostgreSQLOnlyRunSQL(migrations.RunSQL):
    """RunSQL operation that only executes on PostgreSQL."""

    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        if is_postgresql():
            super().database_forwards(app_label, schema_editor, from_state, to_state)

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        if is_postgresql():
            super().database_backwards(app_label, schema_editor, from_state, to_state)


class Migration(migrations.Migration):
    # Required for CREATE INDEX CONCURRENTLY - cannot run inside a transaction
    atomic = False

    dependencies = [
        ('skyspy', '0010_airframe_source_data'),
    ]

    operations = [
        # Index for timestamp-based sighting queries (most common pattern)
        # This supports: ORDER BY timestamp DESC, WHERE timestamp > X
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_timestamp_desc
                ON aircraft_sightings(timestamp DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_timestamp_desc;
            """,
        ),

        # Index for distance-based filtering (antenna analytics, closest aircraft)
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_distance
                ON aircraft_sightings(distance_nm)
                WHERE distance_nm IS NOT NULL;
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_distance;
            """,
        ),

        # Note: Partial index with NOW() not possible (requires IMMUTABLE predicate)
        # Instead, create a simple index on last_seen for session queries
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_last_seen
                ON aircraft_sessions(last_seen DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_session_last_seen;
            """,
        ),

        # Index for first_seen queries (new aircraft discovery)
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spotted_first_seen
                ON spotted_aircraft(first_seen DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_spotted_first_seen;
            """,
        ),

        # Composite index for sighting queries with ICAO and timestamp
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_icao_timestamp
                ON aircraft_sightings(icao_hex, timestamp DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_icao_timestamp;
            """,
        ),

        # Index for session lookups by ICAO (common for session updates)
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_icao_lastseen
                ON aircraft_sessions(icao_hex, last_seen DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_session_icao_lastseen;
            """,
        ),

        # Index for military aircraft filtering
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_military
                ON aircraft_sightings(is_military)
                WHERE is_military = TRUE;
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_military;
            """,
        ),

        # Index for safety events by timestamp
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_safety_event_timestamp
                ON safety_events(timestamp DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_safety_event_timestamp;
            """,
        ),

        # Index for alert history lookups
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alert_history_triggered
                ON alert_history(triggered_at DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_alert_history_triggered;
            """,
        ),

        # Index for RSSI-based queries (antenna analytics)
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_rssi
                ON aircraft_sightings(rssi)
                WHERE rssi IS NOT NULL;
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_rssi;
            """,
        ),

        # Index for track/bearing queries (polar coverage)
        PostgreSQLOnlyRunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_track
                ON aircraft_sightings(track)
                WHERE track IS NOT NULL;
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_track;
            """,
        ),
    ]
