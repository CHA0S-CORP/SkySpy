"""
Migration to add performance-optimized indexes for Raspberry Pi deployment.

These indexes significantly improve query performance for:
- Time-based sighting queries (timestamp DESC)
- Distance-based filtering
- Active session lookups
- Recent aircraft discovery
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('skyspy', '0010_airframe_source_data'),
    ]

    operations = [
        # Index for timestamp-based sighting queries (most common pattern)
        # This supports: ORDER BY timestamp DESC, WHERE timestamp > X
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_timestamp_desc
                ON skyspy_aircraftsighting(timestamp DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_timestamp_desc;
            """,
        ),

        # Index for distance-based filtering (antenna analytics, closest aircraft)
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_distance
                ON skyspy_aircraftsighting(distance_nm)
                WHERE distance_nm IS NOT NULL;
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_distance;
            """,
        ),

        # Partial index for active sessions (last 24 hours)
        # Dramatically improves queries for "currently active" sessions
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_active_recent
                ON skyspy_aircraftsession(last_seen DESC)
                WHERE last_seen > NOW() - INTERVAL '1 day';
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_session_active_recent;
            """,
        ),

        # Index for first_seen queries (new aircraft discovery)
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spotted_first_seen
                ON skyspy_spottedaircraft(first_seen DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_spotted_first_seen;
            """,
        ),

        # Composite index for sighting queries with ICAO and timestamp
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_icao_timestamp
                ON skyspy_aircraftsighting(icao_hex, timestamp DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_icao_timestamp;
            """,
        ),

        # Index for session lookups by ICAO (common for session updates)
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_icao_lastseen
                ON skyspy_aircraftsession(icao_hex, last_seen DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_session_icao_lastseen;
            """,
        ),

        # Index for military aircraft filtering
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_military
                ON skyspy_aircraftsighting(is_military)
                WHERE is_military = TRUE;
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_military;
            """,
        ),

        # Index for safety events by timestamp
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_safety_event_timestamp
                ON skyspy_safetyevent(timestamp DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_safety_event_timestamp;
            """,
        ),

        # Index for alert history lookups
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alert_history_triggered
                ON skyspy_alerthistory(triggered_at DESC);
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_alert_history_triggered;
            """,
        ),

        # Index for RSSI-based queries (antenna analytics)
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_rssi
                ON skyspy_aircraftsighting(rssi)
                WHERE rssi IS NOT NULL;
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_rssi;
            """,
        ),

        # Index for track/bearing queries (polar coverage)
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sighting_track
                ON skyspy_aircraftsighting(track)
                WHERE track IS NOT NULL;
            """,
            reverse_sql="""
                DROP INDEX CONCURRENTLY IF EXISTS idx_sighting_track;
            """,
        ),
    ]
