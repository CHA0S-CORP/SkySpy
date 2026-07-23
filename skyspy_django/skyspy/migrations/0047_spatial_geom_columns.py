import django.contrib.gis.db.models.fields
from django.db import migrations


def backfill_polygons(apps, schema_editor):
    """Populate airspace `geom` (MultiPolygon) from the stored GeoJSON `polygon`
    dict. Guarded per-row so one malformed geometry can't abort the migration."""
    import json

    from django.contrib.gis.geos import GEOSGeometry, MultiPolygon
    from django.contrib.gis.geos.error import GEOSException

    for label in ("AirspaceAdvisory", "AirspaceBoundary"):
        model = apps.get_model("skyspy", label)
        batch = []
        for obj in model.objects.exclude(polygon=None).iterator():
            poly = obj.polygon
            if not isinstance(poly, dict) or not poly.get("coordinates"):
                continue
            try:
                geom = GEOSGeometry(json.dumps(poly), srid=4326)
            except (GEOSException, ValueError, TypeError):
                continue
            if geom.geom_type == "Polygon":
                geom = MultiPolygon(geom, srid=4326)
            elif geom.geom_type != "MultiPolygon":
                continue
            obj.geom = geom
            batch.append(obj)
            if len(batch) >= 500:
                model.objects.bulk_update(batch, ["geom"])
                batch = []
        if batch:
            model.objects.bulk_update(batch, ["geom"])


def clear_polygons(apps, schema_editor):
    for label in ("AirspaceAdvisory", "AirspaceBoundary"):
        apps.get_model("skyspy", label).objects.update(geom=None)


# Backfill point geom from lat/lon directly in SQL (fast, no GEOS round-trip,
# and can't raise on bad rows the way GeoJSON parsing can). geography cast.
_POINT_TABLES = ["cached_airports", "cached_navaids", "cached_pireps", "cached_wildfires"]


class Migration(migrations.Migration):
    dependencies = [
        ("skyspy", "0046_enable_postgis"),
    ]

    operations = [
        migrations.AddField(
            model_name="cachedairport",
            name="geom",
            field=django.contrib.gis.db.models.fields.PointField(blank=True, geography=True, null=True, srid=4326),
        ),
        migrations.AddField(
            model_name="cachednavaid",
            name="geom",
            field=django.contrib.gis.db.models.fields.PointField(blank=True, geography=True, null=True, srid=4326),
        ),
        migrations.AddField(
            model_name="cachedpirep",
            name="geom",
            field=django.contrib.gis.db.models.fields.PointField(blank=True, geography=True, null=True, srid=4326),
        ),
        migrations.AddField(
            model_name="cachedwildfire",
            name="geom",
            field=django.contrib.gis.db.models.fields.PointField(blank=True, geography=True, null=True, srid=4326),
        ),
        migrations.AddField(
            model_name="airspaceadvisory",
            name="geom",
            field=django.contrib.gis.db.models.fields.MultiPolygonField(blank=True, null=True, srid=4326),
        ),
        migrations.AddField(
            model_name="airspaceboundary",
            name="geom",
            field=django.contrib.gis.db.models.fields.MultiPolygonField(blank=True, null=True, srid=4326),
        ),
        *[
            migrations.RunSQL(
                sql=(
                    f"UPDATE {table} SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography "
                    "WHERE latitude IS NOT NULL AND longitude IS NOT NULL;"
                ),
                reverse_sql=f"UPDATE {table} SET geom = NULL;",
            )
            for table in _POINT_TABLES
        ],
        migrations.RunPython(backfill_polygons, clear_polygons),
    ]
