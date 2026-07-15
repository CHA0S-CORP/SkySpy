# API Layer

DRF ViewSets and APIViews registered under `/api/v1/` via `DefaultRouter`. ~11,700 lines across 25 files.

## ViewSet → URL → Service → Test Mapping

### Core Data

| ViewSet | URL | Service | Test file |
|---------|-----|---------|-----------|
| `AircraftViewSet` | `aircraft/` | cache (direct) | `test_api_aircraft.py` (excluded) |
| `AirframeViewSet` | `airframes/` | `aircraft_info`, `external_db` | — |
| `PhotoServeView` | `photos/<icao>/` | `photo_cache` | — |
| `MapViewSet` | `map/` | cache, models | — |

### History & Analytics

| ViewSet | URL | Service | Test file |
|---------|-----|---------|-----------|
| `SightingViewSet` | `sightings/` | models (direct) | `test_api_history.py` (excluded) |
| `SessionViewSet` | `sessions/` | models (direct) | `test_api_history.py` (excluded) |
| `HistoryViewSet` | `history/` | models, stats | `test_api_history.py` (excluded) |
| `AntennaAnalyticsViewSet` | `antenna/` | `antenna_analytics` | — |
| `TrackingQualityViewSet` | `stats/tracking-quality/` | `stats_cache` | — |
| `EngagementViewSet` | `stats/engagement/` | `stats_cache` | — |
| `FavoritesViewSet` | `stats/favorites/` | `stats_cache` | — |
| `FlightPatternStatsViewSet` | `stats/flight-patterns/` | `flight_pattern_stats` | — |
| `GeographicStatsViewSet` | `stats/geographic/` | `flight_pattern_stats` | — |
| `CombinedStatsViewSet` | `stats/combined/` | `flight_pattern_stats` | — |
| `ArchiveViewSet` | `archive/` | `notams` | — |

### Alerts & Safety

| ViewSet | URL | Service | Test file |
|---------|-----|---------|-----------|
| `AlertRuleViewSet` | `alerts/rules/` | `alerts` | `test_api_alerts.py` (excluded) |
| `AlertSubscriptionViewSet` | `alerts/subscriptions/` | models | `test_api_alerts.py` (excluded) |
| `AlertHistoryViewSet` | `alerts/history/` | models | `test_api_alerts.py` (excluded) |
| `SafetyEventViewSet` | `safety/events/` | `safety` | `test_api_safety.py` (excluded) |

### Notifications & Audio

| ViewSet | URL | Service | Test file |
|---------|-----|---------|-----------|
| `NotificationViewSet` | `notifications/` | `notifications` | — |
| `NotificationChannelViewSet` | `notifications/channels/` | models | — |
| `AudioViewSet` | `audio/` | `audio`, `storage` | — |
| `AcarsViewSet` | `acars/` | `acars_stats` | — |

### Aviation & NOTAMs

| ViewSet | URL | Service | Test file |
|---------|-----|---------|-----------|
| `AviationViewSet` | `aviation/` | `geodata` | — |
| `NotamViewSet` | `notams/` | `notams` | — |

### Mobile & Cannonball

| ViewSet | URL | Service | Test file |
|---------|-----|---------|-----------|
| `MobileViewSet` | `mobile/` | `law_enforcement_db` | — |
| `CannonballSessionViewSet` | `cannonball/sessions/` | models | — |
| `CannonballPatternViewSet` | `cannonball/patterns/` | models | — |
| `CannonballAlertViewSet` | `cannonball/alerts/` | models | — |
| `CannonballKnownAircraftViewSet` | `cannonball/known-aircraft/` | models | — |
| `CannonballStatsViewSet` | `cannonball/stats/` | models | — |
| `CannonballThreatsView` | `cannonball/threats/` | `law_enforcement_db` | — |
| `WatchListViewSet` | `watchlist/` | models | — |

### System & Admin

| ViewSet | URL | Service | Test file |
|---------|-----|---------|-----------|
| `HealthCheckView` | `health/`, `system/health/` | — | `test_api_system.py` |
| `StatusView` | `system/status/` | — | `test_api_system.py` |
| `SystemInfoView` | `system/info/` | — | `test_api_system.py` |
| `TaskResultViewSet` | `tasks/` | django-celery-results | — |
| `ConfigViewSet` | `admin/config/` | models | — |
| Admin auth ViewSets | `admin/users/`, `roles/`, `api-keys/`, etc. | models | — |

## Authentication Patterns

- **Public endpoints**: `authentication_classes = []`, `permission_classes = [AllowAny]`
- **Standard endpoints**: `[OptionalJWTAuthentication, APIKeyAuthentication]` + `FeatureBasedPermission`
- **Admin endpoints**: Require `HasPermission.with_perms()` or `HasSystemManagePermission`
- **Owner-scoped**: `IsOwnerOrAdmin` (alerts, notification channels)

## Notes

- "excluded" test files use `APITestCase` and are skipped in CI due to PgBouncer deadlocks
- "—" in test file column means no dedicated API test exists for that ViewSet
- API docs auto-generated: Swagger UI `/api/docs/`, ReDoc `/api/redoc/`
