from django.contrib.postgres.operations import CreateExtension
from django.db import migrations


class Migration(migrations.Migration):
    """Enable the PostGIS extension so geometry columns / spatial lookups work.

    Runs before any geom field is added (0047). Requires the DB image to ship
    PostGIS (docker/postgres/Dockerfile) and the connecting role to be able to
    CREATE EXTENSION (the compose POSTGRES_USER is a superuser). Reversible.
    """

    dependencies = [
        ("skyspy", "0045_acars_route_fields"),
    ]

    operations = [
        CreateExtension("postgis"),
    ]
