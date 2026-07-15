# Socket.IO Request-Type Reference

> Generated from source by `scripts/gen_socketio_events.py` (`make docs-socketio`). Do not edit by hand.

Every request type reaches the client via `on_request` on the main namespace, is dispatched by `_handle_generic_request()`, and requires the listed permission. A request type present here but with no handler is served by a dedicated `on_*` method rather than the generic table.

| Request type | Permission | Handler | Mixin | Description |
| --- | --- | --- | --- | --- |
| `acars-snapshot` | `acars.view` | `_handle_acars_snapshot` | `stats.py` | Get ACARS messages snapshot. |
| `acars-stats` | `acars.view` | `_handle_acars_stats` | `stats.py` | Get ACARS statistics. |
| `aircraft` | `aircraft.view` | `_handle_aircraft` | `aircraft.py` | Return single aircraft by ICAO. |
| `aircraft-info` | `aircraft.view` | `_handle_aircraft_info` | `aircraft.py` | Get detailed aircraft info. |
| `aircraft-info-bulk` | `aircraft.view` | `_handle_aircraft_info_bulk` | `aircraft.py` | Get detailed aircraft info for multiple ICAOs. |
| `aircraft-list` | `aircraft.view` | — | — |  |
| `aircraft-snapshot` | `aircraft.view` | `_handle_aircraft_snapshot` | `aircraft.py` | Return current aircraft snapshot. |
| `aircraft-stats` | `aircraft.view` | `_handle_aircraft_stats` | `aircraft.py` | Get live aircraft statistics. |
| `aircraft-top` | `aircraft.view` | `_handle_aircraft_top` | `aircraft.py` | Get top aircraft by category. |
| `aircraft_list` | `aircraft.view` | `_handle_aircraft_list` | `aircraft.py` | Return list of aircraft with optional filters. |
| `airport` | `notams.view` | `_handle_airport_notams` | `aviation_data.py` | Get NOTAMs for a specific airport. |
| `airports` | `airspace.view` | `_handle_airports` | `aviation_data.py` | Get nearby airports. |
| `airspace-boundaries` | `airspace.view` | `_handle_airspace_boundaries` | `aviation_data.py` | Get airspace boundaries. |
| `airspaces` | `airspace.view` | `_handle_airspace_advisories` | `aviation_data.py` | Get airspace advisories (G-AIRMETs, SIGMETs). |
| `alert-rule-create` | `alerts.manage` | `_handle_alert_rule_create` | `alerts.py` | Create a new alert rule. |
| `alert-rule-delete` | `alerts.manage` | `_handle_alert_rule_delete` | `alerts.py` | Delete an alert rule. |
| `alert-rule-toggle` | `alerts.manage` | `_handle_alert_rule_toggle` | `alerts.py` | Toggle an alert rule's enabled status. |
| `alert-rule-update` | `alerts.manage` | `_handle_alert_rule_update` | `alerts.py` | Update an existing alert rule. |
| `alert-rules` | `alerts.view` | `_handle_alert_rules` | `alerts.py` | List all alert rules. |
| `alert-snapshot` | `alerts.view` | `_handle_alert_snapshot` | `alerts.py` | Get alerts snapshot. |
| `antenna-analytics` | `stats.view` | `_handle_antenna_analytics` | `stats.py` | Get all antenna analytics data. |
| `antenna-polar` | `stats.view` | `_handle_antenna_polar` | `stats.py` | Get antenna polar coverage. |
| `antenna-rssi` | `stats.view` | `_handle_antenna_rssi` | `stats.py` | Get RSSI vs distance data. |
| `antenna-summary` | `stats.view` | `_handle_antenna_summary` | `stats.py` | Get antenna performance summary. |
| `boundaries` | `airspace.view` | `_handle_airspace_boundaries` | `aviation_data.py` | Get airspace boundaries. |
| `health` | `system.view_status` | `_handle_health` | `system.py` | Get service health checks. |
| `history-analytics-correlation` | `history.view` | `_handle_correlation_analytics` | `stats.py` | Get correlation analytics. |
| `history-analytics-distance` | `history.view` | `_handle_distance_analytics` | `stats.py` | Get distance analytics. |
| `history-analytics-speed` | `history.view` | `_handle_speed_analytics` | `stats.py` | Get speed analytics. |
| `history-sessions` | `history.view` | `_handle_history_sessions` | `stats.py` | Get aircraft sessions. |
| `history-stats` | `history.view` | `_handle_history_stats` | `stats.py` | Get history statistics. |
| `history-top` | `history.view` | `_handle_history_top` | `stats.py` | Get top performers. |
| `history-trends` | `history.view` | `_handle_history_trends` | `stats.py` | Get traffic trends. |
| `metar` | `airspace.view` | `_handle_metar_single` | `aviation_data.py` | Handle single METAR request by station. |
| `metars` | `airspace.view` | `_handle_metars` | `aviation_data.py` | Handle METARs request. |
| `navaids` | `airspace.view` | `_handle_navaids` | `aviation_data.py` | Get nearby navaids. |
| `notam-snapshot` | `notams.view` | `_handle_notam_snapshot` | `aviation_data.py` | Get full NOTAM snapshot with NOTAMs, TFRs, and stats. |
| `notification-channel-create` | `notifications.manage` | `_handle_notification_channel_create` | `notifications.py` | Create a new notification channel. |
| `notification-channel-delete` | `notifications.manage` | `_handle_notification_channel_delete` | `notifications.py` | Delete a notification channel. |
| `notification-channel-test` | `notifications.manage` | `_handle_notification_channel_test` | `notifications.py` | Test a notification channel. |
| `notification-channel-types` | `notifications.view` | `_handle_notification_channel_types` | `notifications.py` | Get available notification channel types. |
| `notification-channel-update` | `notifications.manage` | `_handle_notification_channel_update` | `notifications.py` | Update an existing notification channel. |
| `notification-channels` | `notifications.view` | `_handle_notification_channels` | `notifications.py` | List all notification channels. |
| `photo` | `aircraft.view` | `_handle_photo` | `aircraft.py` | Get aircraft photo URL. |
| `photo-cache` | `aircraft.view` | `_handle_photo` | `aircraft.py` | Get aircraft photo URL. |
| `pireps` | `airspace.view` | `_handle_pireps` | `aviation_data.py` | Handle PIREPs request. |
| `refresh` | `notams.view` | `_handle_notam_refresh` | `aviation_data.py` | Trigger a NOTAM refresh. |
| `safety-acknowledge` | `safety.manage` | `_handle_safety_acknowledge` | `safety.py` | Acknowledge a safety event. |
| `safety-event-detail` | `safety.view` | `_handle_safety_event_detail` | `safety.py` | Get a specific safety event by ID. |
| `safety-events` | `safety.view` | `_handle_safety_events` | `safety.py` | Get recent safety events. |
| `safety-snapshot` | `safety.view` | `_handle_safety_snapshot` | `safety.py` | Get safety events snapshot. |
| `safety-stats` | `safety.view` | `_handle_safety_stats` | `safety.py` | Get safety statistics. |
| `safety-status` | `safety.view` | `_handle_safety_monitor_status` | `safety.py` | Get safety monitor status. |
| `sightings` | `aircraft.view` | `_handle_sightings` | `aircraft.py` | Get historical sightings. |
| `stats-engagement` | `stats.view` | `_handle_engagement_stats` | `stats.py` | Get engagement statistics. |
| `stats-favorites` | `stats.view` | `_handle_favorites_stats` | `stats.py` | Get favorites statistics. |
| `stats-flight-patterns` | `stats.view` | `_handle_flight_patterns` | `stats.py` | Get flight pattern statistics. |
| `stats-geographic` | `stats.view` | `_handle_geographic_stats` | `stats.py` | Get geographic statistics. |
| `stats-time-comparison` | `stats.view` | `_handle_time_comparison` | `stats.py` | Get time comparison statistics. |
| `stats-tracking-quality` | `stats.view` | `_handle_tracking_quality` | `stats.py` | Get tracking quality metrics. |
| `status` | `system.view_status` | `_handle_status` | `system.py` | Get basic system status. |
| `system-databases` | `system.view_databases` | `_handle_database_stats` | `system.py` | Get database statistics. |
| `system-health` | `system.view_status` | `_handle_health` | `system.py` | Get service health checks. |
| `system-info` | `system.view_info` | `_handle_system_info` | `system.py` | Get system information. |
| `system-status` | `system.view_status` | `_handle_system_status` | `system.py` | Get detailed system status. |
| `taf` | `airspace.view` | `_handle_taf_single` | `aviation_data.py` | Handle single TAF request by station. |
| `tafs` | `airspace.view` | `_handle_tafs` | `aviation_data.py` | Handle TAFs request. |
| `ws-status` | `system.view_status` | `_handle_ws_status` | `system.py` | Get WebSocket service status. |

_Total request types: 68._
