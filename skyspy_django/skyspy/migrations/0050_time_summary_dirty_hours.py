from django.db import migrations


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    for event, relation in [("INSERT", "new_rows"), ("DELETE", "old_rows")]:
        name = "time_summary_dirty_" + event.lower()
        schema_editor.execute(f"""
        CREATE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          INSERT INTO skyspy_timesummaryhour (timestamp, dirty, generation)
          SELECT DISTINCT date_trunc('hour', timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', true, 1
          FROM {relation}
          ON CONFLICT (timestamp) DO UPDATE SET dirty=true,
            generation=skyspy_timesummaryhour.generation+1;
          RETURN NULL;
        END $$;
        CREATE TRIGGER {name} AFTER {event} ON aircraft_sightings
        REFERENCING {"NEW" if event == "INSERT" else "OLD"} TABLE AS {relation}
        FOR EACH STATEMENT EXECUTE FUNCTION {name}();
        """)
    schema_editor.execute("""
    CREATE FUNCTION time_summary_dirty_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO skyspy_timesummaryhour (timestamp, dirty, generation)
      SELECT DISTINCT date_trunc('hour', timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', true, 1
      FROM (SELECT timestamp FROM new_rows UNION SELECT timestamp FROM old_rows) changed
      ON CONFLICT (timestamp) DO UPDATE SET dirty=true,
        generation=skyspy_timesummaryhour.generation+1;
      RETURN NULL;
    END $$;
    CREATE TRIGGER time_summary_dirty_update AFTER UPDATE ON aircraft_sightings
    REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION time_summary_dirty_update();
    """)


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    for event in ["insert", "delete", "update"]:
        name = "time_summary_dirty_" + event
        schema_editor.execute(f"DROP TRIGGER IF EXISTS {name} ON aircraft_sightings; DROP FUNCTION IF EXISTS {name}();")


class Migration(migrations.Migration):
    dependencies = [("skyspy", "0049_timesummaryhour_timesummaryaircraft")]
    operations = [migrations.RunPython(install, uninstall)]
