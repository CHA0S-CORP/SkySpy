# Migration to add Cannonball mode models for law enforcement aircraft detection

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('skyspy', '0011_add_rpi_performance_indexes'),
    ]

    operations = [
        # CannonballSession must come before CannonballPattern (FK dependency)
        migrations.CreateModel(
            name='CannonballSession',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('icao_hex', models.CharField(db_index=True, max_length=10)),
                ('callsign', models.CharField(blank=True, max_length=10, null=True)),
                ('registration', models.CharField(blank=True, max_length=15, null=True)),
                ('identification_method', models.CharField(
                    choices=[
                        ('callsign', 'Callsign Match'),
                        ('registration', 'Registration Match'),
                        ('operator', 'Operator ICAO Match'),
                        ('pattern', 'Behavior Pattern'),
                        ('database', 'Known LE Database'),
                        ('manual', 'Manual Identification'),
                    ],
                    default='pattern',
                    max_length=20
                )),
                ('identification_reason', models.CharField(blank=True, max_length=200, null=True)),
                ('operator_name', models.CharField(blank=True, max_length=100, null=True)),
                ('operator_icao', models.CharField(blank=True, max_length=10, null=True)),
                ('aircraft_type', models.CharField(blank=True, max_length=50, null=True)),
                ('is_active', models.BooleanField(db_index=True, default=True)),
                ('threat_level', models.CharField(
                    choices=[('info', 'Info'), ('warning', 'Warning'), ('critical', 'Critical')],
                    default='info',
                    max_length=20
                )),
                ('urgency_score', models.FloatField(default=0.0)),
                ('last_lat', models.FloatField(blank=True, null=True)),
                ('last_lon', models.FloatField(blank=True, null=True)),
                ('last_altitude', models.IntegerField(blank=True, null=True)),
                ('last_ground_speed', models.IntegerField(blank=True, null=True)),
                ('last_track', models.IntegerField(blank=True, null=True)),
                ('distance_nm', models.FloatField(blank=True, null=True)),
                ('bearing', models.FloatField(blank=True, null=True)),
                ('closing_speed_kts', models.FloatField(blank=True, null=True)),
                ('first_seen', models.DateTimeField(auto_now_add=True)),
                ('last_seen', models.DateTimeField(auto_now=True)),
                ('session_duration_seconds', models.IntegerField(default=0)),
                ('pattern_count', models.IntegerField(default=0)),
                ('alert_count', models.IntegerField(default=0)),
                ('position_count', models.IntegerField(default=0)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('user', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='cannonball_sessions',
                    to=settings.AUTH_USER_MODEL
                )),
            ],
            options={
                'db_table': 'cannonball_sessions',
                'ordering': ['-last_seen'],
            },
        ),
        migrations.AddIndex(
            model_name='cannonballsession',
            index=models.Index(fields=['icao_hex', 'is_active'], name='idx_cb_session_icao_active'),
        ),
        migrations.AddIndex(
            model_name='cannonballsession',
            index=models.Index(fields=['threat_level', 'is_active'], name='idx_cb_session_threat'),
        ),
        migrations.AddIndex(
            model_name='cannonballsession',
            index=models.Index(fields=['user', 'is_active'], name='idx_cb_session_user'),
        ),
        migrations.AddIndex(
            model_name='cannonballsession',
            index=models.Index(fields=['last_seen'], name='idx_cb_session_last_seen'),
        ),

        # CannonballPattern
        migrations.CreateModel(
            name='CannonballPattern',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('icao_hex', models.CharField(db_index=True, max_length=10)),
                ('callsign', models.CharField(blank=True, max_length=10, null=True)),
                ('pattern_type', models.CharField(
                    choices=[
                        ('circling', 'Circling'),
                        ('loitering', 'Loitering'),
                        ('grid_search', 'Grid Search'),
                        ('speed_trap', 'Speed Trap'),
                        ('parallel_highway', 'Parallel to Highway'),
                        ('surveillance', 'General Surveillance'),
                        ('pursuit', 'Pursuit Pattern'),
                    ],
                    max_length=30
                )),
                ('confidence', models.CharField(
                    choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High')],
                    default='medium',
                    max_length=10
                )),
                ('confidence_score', models.FloatField(default=0.0)),
                ('center_lat', models.FloatField()),
                ('center_lon', models.FloatField()),
                ('radius_nm', models.FloatField(blank=True, null=True)),
                ('pattern_data', models.JSONField(blank=True, default=dict)),
                ('position_samples', models.JSONField(blank=True, default=list)),
                ('started_at', models.DateTimeField()),
                ('ended_at', models.DateTimeField(blank=True, null=True)),
                ('duration_seconds', models.IntegerField(default=0)),
                ('detected_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('session', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='patterns',
                    to='skyspy.cannonballsession'
                )),
            ],
            options={
                'db_table': 'cannonball_patterns',
                'ordering': ['-detected_at'],
            },
        ),
        migrations.AddIndex(
            model_name='cannonballpattern',
            index=models.Index(fields=['icao_hex', 'pattern_type'], name='idx_cb_pattern_icao_type'),
        ),
        migrations.AddIndex(
            model_name='cannonballpattern',
            index=models.Index(fields=['pattern_type', 'detected_at'], name='idx_cb_pattern_type_time'),
        ),
        migrations.AddIndex(
            model_name='cannonballpattern',
            index=models.Index(fields=['confidence', 'detected_at'], name='idx_cb_pattern_conf'),
        ),

        # CannonballAlert
        migrations.CreateModel(
            name='CannonballAlert',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('alert_type', models.CharField(
                    choices=[
                        ('le_detected', 'Law Enforcement Detected'),
                        ('pattern_detected', 'Suspicious Pattern'),
                        ('closing_fast', 'Aircraft Closing Fast'),
                        ('overhead', 'Aircraft Overhead'),
                        ('new_threat', 'New Threat'),
                        ('threat_escalated', 'Threat Level Escalated'),
                        ('threat_cleared', 'Threat Cleared'),
                    ],
                    max_length=30
                )),
                ('priority', models.CharField(
                    choices=[('info', 'Info'), ('warning', 'Warning'), ('critical', 'Critical')],
                    default='info',
                    max_length=20
                )),
                ('title', models.CharField(max_length=100)),
                ('message', models.TextField()),
                ('aircraft_lat', models.FloatField(blank=True, null=True)),
                ('aircraft_lon', models.FloatField(blank=True, null=True)),
                ('aircraft_altitude', models.IntegerField(blank=True, null=True)),
                ('user_lat', models.FloatField(blank=True, null=True)),
                ('user_lon', models.FloatField(blank=True, null=True)),
                ('distance_nm', models.FloatField(blank=True, null=True)),
                ('bearing', models.FloatField(blank=True, null=True)),
                ('notified', models.BooleanField(default=False)),
                ('announced', models.BooleanField(default=False)),
                ('acknowledged', models.BooleanField(default=False)),
                ('acknowledged_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('session', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='alerts',
                    to='skyspy.cannonballsession'
                )),
                ('pattern', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='alerts',
                    to='skyspy.cannonballpattern'
                )),
                ('user', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='cannonball_alerts',
                    to=settings.AUTH_USER_MODEL
                )),
            ],
            options={
                'db_table': 'cannonball_alerts',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='cannonballalert',
            index=models.Index(fields=['session', 'created_at'], name='idx_cb_alert_session'),
        ),
        migrations.AddIndex(
            model_name='cannonballalert',
            index=models.Index(fields=['alert_type', 'created_at'], name='idx_cb_alert_type'),
        ),
        migrations.AddIndex(
            model_name='cannonballalert',
            index=models.Index(fields=['priority', 'acknowledged'], name='idx_cb_alert_priority'),
        ),
        migrations.AddIndex(
            model_name='cannonballalert',
            index=models.Index(fields=['user', 'created_at'], name='idx_cb_alert_user'),
        ),

        # CannonballKnownAircraft
        migrations.CreateModel(
            name='CannonballKnownAircraft',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('icao_hex', models.CharField(db_index=True, max_length=10, unique=True)),
                ('registration', models.CharField(blank=True, db_index=True, max_length=15, null=True)),
                ('aircraft_type', models.CharField(blank=True, max_length=50, null=True)),
                ('aircraft_model', models.CharField(blank=True, max_length=100, null=True)),
                ('agency_name', models.CharField(max_length=200)),
                ('agency_type', models.CharField(
                    choices=[
                        ('federal', 'Federal'),
                        ('state', 'State'),
                        ('local', 'Local'),
                        ('military', 'Military'),
                        ('unknown', 'Unknown'),
                    ],
                    default='unknown',
                    max_length=20
                )),
                ('agency_state', models.CharField(blank=True, max_length=2, null=True)),
                ('agency_city', models.CharField(blank=True, max_length=100, null=True)),
                ('source', models.CharField(
                    choices=[
                        ('faa', 'FAA Registry'),
                        ('opensky', 'OpenSky Database'),
                        ('manual', 'Manual Entry'),
                        ('community', 'Community Submission'),
                        ('research', 'Research/FOIA'),
                    ],
                    default='manual',
                    max_length=20
                )),
                ('source_url', models.URLField(blank=True, null=True)),
                ('verified', models.BooleanField(default=False)),
                ('verified_at', models.DateTimeField(blank=True, null=True)),
                ('times_detected', models.IntegerField(default=0)),
                ('last_detected', models.DateTimeField(blank=True, null=True)),
                ('notes', models.TextField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('verified_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='verified_cannonball_aircraft',
                    to=settings.AUTH_USER_MODEL
                )),
            ],
            options={
                'db_table': 'cannonball_known_aircraft',
                'ordering': ['agency_name', 'registration'],
                'verbose_name_plural': 'Cannonball known aircraft',
            },
        ),
        migrations.AddIndex(
            model_name='cannonballknownaircraft',
            index=models.Index(fields=['agency_type', 'agency_state'], name='idx_cb_known_agency'),
        ),
        migrations.AddIndex(
            model_name='cannonballknownaircraft',
            index=models.Index(fields=['verified', 'times_detected'], name='idx_cb_known_verified'),
        ),

        # CannonballStats
        migrations.CreateModel(
            name='CannonballStats',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('period_type', models.CharField(
                    choices=[
                        ('hourly', 'Hourly'),
                        ('daily', 'Daily'),
                        ('weekly', 'Weekly'),
                        ('monthly', 'Monthly'),
                    ],
                    max_length=10
                )),
                ('period_start', models.DateTimeField(db_index=True)),
                ('period_end', models.DateTimeField()),
                ('total_detections', models.IntegerField(default=0)),
                ('unique_aircraft', models.IntegerField(default=0)),
                ('critical_alerts', models.IntegerField(default=0)),
                ('warning_alerts', models.IntegerField(default=0)),
                ('info_alerts', models.IntegerField(default=0)),
                ('circling_patterns', models.IntegerField(default=0)),
                ('loitering_patterns', models.IntegerField(default=0)),
                ('grid_search_patterns', models.IntegerField(default=0)),
                ('speed_trap_patterns', models.IntegerField(default=0)),
                ('top_aircraft', models.JSONField(blank=True, default=list)),
                ('top_agencies', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='cannonball_stats',
                    to=settings.AUTH_USER_MODEL
                )),
            ],
            options={
                'db_table': 'cannonball_stats',
                'ordering': ['-period_start'],
            },
        ),
        migrations.AddConstraint(
            model_name='cannonballstats',
            constraint=models.UniqueConstraint(
                fields=['period_type', 'period_start', 'user'],
                name='unique_cannonball_stats_period'
            ),
        ),
        migrations.AddIndex(
            model_name='cannonballstats',
            index=models.Index(fields=['period_type', 'period_start'], name='idx_cb_stats_period'),
        ),
        migrations.AddIndex(
            model_name='cannonballstats',
            index=models.Index(fields=['user', 'period_type'], name='idx_cb_stats_user'),
        ),
    ]
