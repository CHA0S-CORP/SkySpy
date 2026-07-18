# Services Layer

Stateless business logic layer. Views delegate to services; services coordinate between models and external APIs. 49 modules, ~29,600 lines total.

## Module Catalog

### Core Data (aircraft tracking, caching, stats)

| Module | Lines | `except Exception` | Purpose |
|--------|------:|---:|---------|
| `cache.py` | 590 | 1 | In-memory TTL cache with LRU eviction (RPi optimized) |
| `aircraft_info.py` | 579 | 0 | Unified aircraft lookup with caching, rate limiting, photo integration |
| `external_db.py` | 1,254 | 0 | Multi-source aircraft database: ADS-B Exchange, tar1090, FAA, OpenSky |
| `stats_cache.py` | 1,698 | 0 | Centralized stats cache: tracking quality, engagement, favorites |
| `flight_pattern_stats.py` | 1,084 | 11 | Flight pattern tracking and geographic statistics |
| `time_comparison_stats.py` | 846 | 1 | Time-based analytics: week/seasonal/hourly/daily trends |
| `registration_analysis.py` | ~200 | 0 | Aircraft registration country/type analysis |
| `geodata.py` | 588 | 0 | Geographic data service (GeoJSON caching) |
| `terrain_elevation.py` | ~200 | 0 | Elevation data service |
| `antenna_analytics.py` | 426 | 1 | Antenna polar coverage, RSSI/distance correlation |

### External API Integrations (network-dependent)

| Module | Lines | `except Exception` | Purpose |
|--------|------:|---:|---------|
| `opensky_live.py` | 450 | 5 | OpenSky Network live state vectors |
| `adsbx_live.py` | 509 | 3 | ADS-B Exchange unfiltered data via RapidAPI |
| `aviationstack.py` | 442 | 2 | Flight schedule and route data (100 req/month free) |
| `avwx.py` | 336 | 2 | AVWX weather API — METAR/TAF decoded data |
| `checkwx.py` | 392 | 2 | CheckWX weather API with flight category calculation |
| `openaip.py` | 507 | 4 | OpenAIP airspace boundaries, airports, navaids (unlimited free) |
| `openflights.py` | ~300 | 3 | OpenFlights airport database |
| `weather_cache.py` | 852 | 7 | Caching layer for weather APIs |
| `swim_fns.py` | 888 | 12 | FAA SWIM FNS NOTAM via Solace messaging (AIXM XML) |
| `notams.py` | 980 | 7 | NOTAM fetching, parsing, TFR boundaries from FAA APIs |
| `llm.py` | 571 | 5 | LLM-based transcript analysis with retry/cache |

### Alert Pipeline

| Module | Lines | `except Exception` | Purpose |
|--------|------:|---:|---------|
| `alerts.py` | 615 | 0 | Alert rule evaluation, notifications, cooldowns, metrics |
| `alert_rule_cache.py` | 595 | 5 | Compiled rule caching (AlertRule → CompiledRule) |
| `alert_cooldowns.py` | 371 | 7 | Distributed Redis cooldowns with LRU fallback |
| `alert_metrics.py` | 347 | 0 | Alert performance metrics: evaluation timing, trigger rates |
| `notification_router.py` | 297 | 1 | Notification channel routing by priority, quiet hours |
| `notification_dispatcher.py` | 312 | 3 | Central notification flow: templating, routing, delivery |
| `notifications.py` | ~400 | 5 | Apprise multi-platform notifications with SSRF prevention |
| `rich_formatters.py` | 543 | 0 | Discord/Slack embed formatting for alerts and safety events |
| `template_engine.py` | 289 | 1 | Notification template rendering with variable substitution |

### Safety & Security

| Module | Lines | `except Exception` | Purpose |
|--------|------:|---:|---------|
| `safety.py` | 1,253 | 0 | TCAS/emergency monitoring: squawks 7500/7600/7700, vertical speed |
| `military_db.py` | 384 | 2 | Military aircraft identification: hex ranges, callsigns, types |
| `law_enforcement_db.py` | 493 | 0 | Law enforcement detection: callsigns, operators, surveillance |
| `cannonball.py` | 1,253 | ~5 | Mobile threat detection and session management |

### ACARS & Decoders

| Module | Lines | `except Exception` | Purpose |
|--------|------:|---:|---------|
| `acars.py` | 633 | 7 | ACARS/VDL2 message service with deduplication |
| `acars_decoder.py` | 670 | 0 | ACARS message parsing: callsigns, airline extraction, labels |
| `acars_stats.py` | 557 | 3 | ACARS statistics: message types, airlines, trends |
| `pirep_decoder.py` | ~200 | 0 | PIREP decoder for turbulence/icing codes |
| `notam_decoder.py` | ~200 | 0 | NOTAM abbreviation and code translation |
| `aviation_llm.py` | ~130 | 0 | LLM plain-English summaries of ACARS/PIREP/NOTAM/METAR/TAF/SIGMET (gated on `llm_client.is_available()`, falls back to rule-based decoders) |
| `libacars_binding.py` | 162 | 0 | Python bindings for libacars CFFI/ctypes |

### Audio & Media

| Module | Lines | `except Exception` | Purpose |
|--------|------:|---:|---------|
| `audio.py` | 1,533 | 9 | Audio processing, transcription, airframe identification |
| `photo_cache.py` | 493 | 6 | Aircraft photo downloading and S3/local caching |
| `storage.py` | 416 | 9 | S3/MinIO and local filesystem storage with signed URLs |

### Other

| Module | Lines | `except Exception` | Purpose |
|--------|------:|---:|---------|
| `gamification.py` | 1,237 | 5 | Personal records, rare sightings, collection tracking |
| `task_metrics.py` | ~300 | 0 | Background task performance metrics |
| `le_data_import.py` | ~200 | 0 | Law enforcement database importing |

## Key Patterns

- **Lazy imports**: Socket.IO namespaces import services inside methods to avoid circular dependencies.
- **Cache-first**: Most read paths check Redis/in-memory cache before hitting the database.
- **Exception handling**: ~140 broad `except Exception` handlers remain across ~34 files (5 critical files fixed). When modifying, prefer specific exception types (`DatabaseError`, `httpx.HTTPError`, `ConnectionError`, `OSError`, etc.).
- **Service instantiation**: Some services are singletons (e.g., `SafetyMonitor`), others are instantiated per-call (e.g., `AlertService()`). Check conftest.py fixtures for test patterns.
