"""
Migration to add descending timestamp indexes for improved stats query performance.

Based on P3: Database Index Optimization from BACKGROUND_SERVICES_IMPROVEMENT_PLAN.md

These Django-managed indexes complement the PostgreSQL-specific indexes in migration 0011
and ensure proper indexing across all database backends.

Note: Several models already have adequate timestamp indexing:
- AircraftSighting: idx_sightings_icao_time, plus db_index=True on timestamp
- SafetyEvent: idx_safety_events_type_time, idx_safety_events_sev_time, plus db_index=True
- AlertHistory: idx_alert_hist_user, idx_alert_hist_ack, plus db_index=True on triggered_at
- AircraftSession: idx_sessions_last_seen_icao, plus db_index=True on last_seen

This migration adds indexes for models that could benefit from additional optimization:
- AcarsMessage: standalone timestamp descending index for stats queries
- NotificationLog: standalone timestamp descending index for log queries
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("skyspy", "0021_pattern_analytics"),
    ]

    operations = [
        # AcarsMessage timestamp descending index
        # Optimizes: AcarsMessage.objects.order_by("-timestamp") queries in stats
        # Complements existing idx_acars_icao_time and idx_acars_label
        migrations.AddIndex(
            model_name="acarsmessage",
            index=models.Index(
                fields=["-timestamp"],
                name="acarsmsg_ts_desc_idx",
            ),
        ),
        # NotificationLog timestamp descending index
        # Optimizes: NotificationLog.objects.order_by("-timestamp") queries
        # Complements existing idx_notif_log_retry and idx_notif_log_icao
        migrations.AddIndex(
            model_name="notificationlog",
            index=models.Index(
                fields=["-timestamp"],
                name="notiflog_ts_desc_idx",
            ),
        ),
    ]
