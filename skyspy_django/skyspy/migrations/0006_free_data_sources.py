"""
Migration for free data sources integration.

Adds:
- CachedNotam: NOTAM and TFR data from FAA
- CachedAirline: Airline data from OpenFlights
- CachedAircraftType: Aircraft type data from OpenFlights
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('skyspy', '0005_alertrule_notification_channels'),
    ]

    operations = [
        # Create CachedNotam model
        migrations.CreateModel(
            name='CachedNotam',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('notam_id', models.CharField(db_index=True, max_length=50, unique=True)),
                ('notam_type', models.CharField(
                    choices=[
                        ('D', 'NOTAM D'),
                        ('FDC', 'FDC NOTAM'),
                        ('TFR', 'Temporary Flight Restriction'),
                        ('GPS', 'GPS NOTAM'),
                        ('MIL', 'Military NOTAM'),
                        ('POINTER', 'Pointer NOTAM'),
                    ],
                    db_index=True,
                    max_length=10
                )),
                ('classification', models.CharField(
                    blank=True,
                    choices=[
                        ('FDC', 'Flight Data Center'),
                        ('INTL', 'International'),
                        ('DOM', 'Domestic'),
                        ('MIL', 'Military'),
                    ],
                    max_length=20,
                    null=True
                )),
                ('location', models.CharField(db_index=True, max_length=10)),
                ('latitude', models.FloatField(blank=True, db_index=True, null=True)),
                ('longitude', models.FloatField(blank=True, db_index=True, null=True)),
                ('radius_nm', models.FloatField(blank=True, null=True)),
                ('floor_ft', models.IntegerField(blank=True, null=True)),
                ('ceiling_ft', models.IntegerField(blank=True, null=True)),
                ('effective_start', models.DateTimeField(db_index=True)),
                ('effective_end', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('is_permanent', models.BooleanField(default=False)),
                ('text', models.TextField()),
                ('raw_text', models.TextField(blank=True, null=True)),
                ('keywords', models.JSONField(blank=True, null=True)),
                ('geometry', models.JSONField(blank=True, null=True)),
                ('reason', models.CharField(blank=True, max_length=200, null=True)),
                ('source_data', models.JSONField(blank=True, null=True)),
                ('fetched_at', models.DateTimeField(auto_now=True, db_index=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'db_table': 'cached_notams',
                'ordering': ['-effective_start'],
            },
        ),

        # Add indexes for CachedNotam
        migrations.AddIndex(
            model_name='cachednotam',
            index=models.Index(fields=['location', 'effective_start'], name='idx_notam_loc_start'),
        ),
        migrations.AddIndex(
            model_name='cachednotam',
            index=models.Index(fields=['notam_type', 'effective_start'], name='idx_notam_type_start'),
        ),
        migrations.AddIndex(
            model_name='cachednotam',
            index=models.Index(fields=['latitude', 'longitude'], name='idx_notam_location'),
        ),
        migrations.AddIndex(
            model_name='cachednotam',
            index=models.Index(fields=['effective_end', 'effective_start'], name='idx_notam_validity'),
        ),

        # Create CachedAirline model
        migrations.CreateModel(
            name='CachedAirline',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('icao_code', models.CharField(db_index=True, max_length=4, unique=True)),
                ('iata_code', models.CharField(blank=True, db_index=True, max_length=3, null=True)),
                ('name', models.CharField(max_length=200)),
                ('callsign', models.CharField(blank=True, max_length=100, null=True)),
                ('country', models.CharField(blank=True, max_length=100, null=True)),
                ('active', models.BooleanField(default=True)),
                ('source_data', models.JSONField(blank=True, null=True)),
                ('fetched_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'cached_airlines',
            },
        ),

        # Add indexes for CachedAirline
        migrations.AddIndex(
            model_name='cachedairline',
            index=models.Index(fields=['iata_code'], name='idx_airline_iata'),
        ),
        migrations.AddIndex(
            model_name='cachedairline',
            index=models.Index(fields=['callsign'], name='idx_airline_callsign'),
        ),

        # Create CachedAircraftType model
        migrations.CreateModel(
            name='CachedAircraftType',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('icao_code', models.CharField(db_index=True, max_length=10, unique=True)),
                ('iata_code', models.CharField(blank=True, db_index=True, max_length=5, null=True)),
                ('name', models.CharField(max_length=200)),
                ('manufacturer', models.CharField(blank=True, max_length=100, null=True)),
                ('source_data', models.JSONField(blank=True, null=True)),
                ('fetched_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'cached_aircraft_types',
            },
        ),

        # Add indexes for CachedAircraftType
        migrations.AddIndex(
            model_name='cachedaircrafttype',
            index=models.Index(fields=['iata_code'], name='idx_actype_iata'),
        ),
        migrations.AddIndex(
            model_name='cachedaircrafttype',
            index=models.Index(fields=['manufacturer'], name='idx_actype_mfr'),
        ),
    ]
