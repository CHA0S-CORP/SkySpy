# Migration to add AirframeSourceData model for per-source airframe storage

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('skyspy', '0009_update_admin_permissions'),
    ]

    operations = [
        migrations.CreateModel(
            name='AirframeSourceData',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source', models.CharField(
                    choices=[
                        ('faa', 'FAA Registry'),
                        ('adsbx', 'ADS-B Exchange'),
                        ('tar1090', 'tar1090-db'),
                        ('opensky', 'OpenSky Network'),
                        ('hexdb', 'HexDB API'),
                        ('adsblol', 'adsb.lol API'),
                        ('planespotters', 'Planespotters API'),
                    ],
                    db_index=True,
                    max_length=20
                )),
                ('raw_data', models.JSONField(default=dict)),
                ('registration', models.CharField(blank=True, max_length=20, null=True)),
                ('type_code', models.CharField(blank=True, max_length=10, null=True)),
                ('type_name', models.CharField(blank=True, max_length=100, null=True)),
                ('manufacturer', models.CharField(blank=True, max_length=100, null=True)),
                ('model', models.CharField(blank=True, max_length=100, null=True)),
                ('serial_number', models.CharField(blank=True, max_length=50, null=True)),
                ('year_built', models.IntegerField(blank=True, null=True)),
                ('operator', models.CharField(blank=True, max_length=100, null=True)),
                ('operator_icao', models.CharField(blank=True, max_length=4, null=True)),
                ('owner', models.CharField(blank=True, max_length=200, null=True)),
                ('country', models.CharField(blank=True, max_length=100, null=True)),
                ('city', models.CharField(blank=True, max_length=100, null=True)),
                ('state', models.CharField(blank=True, max_length=10, null=True)),
                ('category', models.CharField(blank=True, max_length=20, null=True)),
                ('is_military', models.BooleanField(default=False)),
                ('is_interesting', models.BooleanField(default=False)),
                ('is_pia', models.BooleanField(default=False)),
                ('is_ladd', models.BooleanField(default=False)),
                ('fetched_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('aircraft_info', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='source_data',
                    to='skyspy.aircraftinfo'
                )),
            ],
            options={
                'db_table': 'airframe_source_data',
            },
        ),
        migrations.AddConstraint(
            model_name='airframesourcedata',
            constraint=models.UniqueConstraint(
                fields=['aircraft_info', 'source'],
                name='unique_aircraft_source'
            ),
        ),
        migrations.AddIndex(
            model_name='airframesourcedata',
            index=models.Index(
                fields=['source', 'registration'],
                name='idx_source_data_src_reg'
            ),
        ),
    ]
