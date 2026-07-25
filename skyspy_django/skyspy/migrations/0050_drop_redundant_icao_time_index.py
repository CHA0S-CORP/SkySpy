"""
Drop the redundant idx_sightings_icao_time index on aircraft_sightings.

idx_sightings_icao_time (icao_hex, timestamp ASC) duplicates
idx_sighting_icao_timestamp (icao_hex, timestamp DESC) — a btree scans either
direction, so the DESC index (the more-used of the two) covers the same icao+time
lookups. The ASC copy cost ~544 MB plus an index write on every insert. This
removes it from the model (Meta.indexes) and the DB.

SeparateDatabaseAndState: the STATE op (RemoveIndex) keeps Django's migration
graph consistent with the model; the DATABASE op is an idempotent
``DROP INDEX CONCURRENTLY IF EXISTS`` — a no-op on prod (already dropped by hand)
and the real drop on a from-scratch build (where 0001 recreates it first). Reverse
recreates it so a rollback restores.
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
    # DROP INDEX CONCURRENTLY cannot run inside a transaction.
    atomic = False

    dependencies = [
        ("skyspy", "0049_drop_unused_sighting_indexes"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveIndex(
                    model_name="aircraftsighting",
                    name="idx_sightings_icao_time",
                ),
            ],
            database_operations=[
                PostgreSQLOnlyRunSQL(
                    sql="DROP INDEX CONCURRENTLY IF EXISTS idx_sightings_icao_time;",
                    reverse_sql="""
                        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sightings_icao_time
                        ON aircraft_sightings(icao_hex, timestamp);
                    """,
                ),
            ],
        ),
    ]
