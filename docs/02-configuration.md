---
title: Configuration Reference
slug: config-reference
category:
  uri: getting-started
position: 3
privacy:
  view: public
---

# ⚙️ Configuration Reference

> **Premium Documentation** — Everything you need to configure SkysPy for any environment

---

## 📋 Quick Reference Card

> 📌 **Info**
> Copy these essential settings to get started quickly!

```bash
# Minimum Required Configuration
DJANGO_SECRET_KEY=your-secure-random-key-here
FEEDER_LAT=47.9377
FEEDER_LON=-121.9687
AUTH_MODE=hybrid
```

| Setting | Purpose | Get Started |
|:--------|:--------|:------------|
| 🔑 `DJANGO_SECRET_KEY` | Cryptographic security | `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"` |
| 📍 `FEEDER_LAT/LON` | Your antenna location | Use GPS coordinates in decimal degrees |
| 🔐 `AUTH_MODE` | Access control | `public` / `private` / `hybrid` |
| 🗄️ `DATABASE_URL` | Database connection | `postgresql://user:pass@host:5432/db` |

---

## 🏗️ Configuration Architecture

```mermaid
flowchart TD
    subgraph Sources["📁 Configuration Sources"]
        ENV["🔧 .env File"]
        DOCKER["🐳 Docker Environment"]
        RUNTIME["⚡ Runtime / Admin"]
    end

    subgraph Layers["🎚️ Configuration Layers"]
        ENV --> DJANGO["🐍 Django Settings"]
        DOCKER --> DJANGO
        DJANGO --> COMPOSE["📦 Docker Compose"]
        COMPOSE --> RUNTIME
    end

    subgraph Outputs["🎯 Applied To"]
        RUNTIME --> API["🌐 API Server"]
        RUNTIME --> CELERY["⏰ Celery Workers"]
        RUNTIME --> WS["📡 WebSocket Channels"]
        RUNTIME --> FRONTEND["💻 Frontend"]
    end

    style ENV fill:#e1f5fe
    style DJANGO fill:#fff3e0
    style COMPOSE fill:#f3e5f5
    style RUNTIME fill:#e8f5e9
```

### 🚀 Quick Start Steps

1. Copy `.env.example` to `.env`
2. Set `DJANGO_SECRET_KEY` to a secure random value
3. Configure `FEEDER_LAT` and `FEEDER_LON` for your antenna location
4. Set `AUTH_MODE` based on your security requirements
5. Run `docker-compose up -d`

---

## 🔧 Core Django Settings

> ⚠️ **Warning**
> Never enable `DEBUG=True` in production environments. This exposes sensitive debugging information.

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `DEBUG` | Enable Django debug mode | `False` | ⚪ Optional |
| `DJANGO_SECRET_KEY` | Django secret key for cryptographic signing | None | 🔴 **Required** |
| `ALLOWED_HOSTS` | Comma-separated list of allowed host/domain names | `localhost,127.0.0.1,[::1]` | ⚪ Optional |
| `DJANGO_LOG_LEVEL` | Log level for Django framework | `INFO` | ⚪ Optional |
| `BUILD_MODE` | Set to `True` during Docker builds to skip external connections | `False` | ⚪ Optional |
| `DJANGO_SETTINGS_MODULE` | Python path to settings module | `skyspy.settings` | ⚪ Optional |

> 💡 **Tip**
> For Raspberry Pi deployments, use `DJANGO_SETTINGS_MODULE=skyspy.settings_rpi` for optimized performance.

### 👤 Default Superuser (Auto-Created on Startup)

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `DJANGO_SUPERUSER_USERNAME` | Username for auto-created admin account | `admin` | ⚪ Optional |
| `DJANGO_SUPERUSER_EMAIL` | Email for auto-created admin account | `admin@example.com` | ⚪ Optional |
| `DJANGO_SUPERUSER_PASSWORD` | Password for auto-created admin account | `changeme` | 🟡 Change in production |

---

## 🔐 Authentication & Authorization

### Authentication Modes

```mermaid
flowchart LR
    subgraph Modes["🔐 AUTH_MODE Options"]
        PUBLIC["🌍 public<br/>No auth required"]
        HYBRID["🔀 hybrid<br/>Per-feature control"]
        PRIVATE["🔒 private<br/>Full authentication"]
    end

    PUBLIC -.->|"Development"| DEV["💻 Local Dev"]
    HYBRID -.->|"Recommended"| PROD["🏭 Production"]
    PRIVATE -.->|"High Security"| ENT["🏢 Enterprise"]

    style PUBLIC fill:#fff9c4
    style HYBRID fill:#c8e6c9
    style PRIVATE fill:#ffcdd2
```

| Mode | Description | Use Case |
|:-----|:------------|:---------|
| 🌍 `public` | No authentication required for any endpoint | Local/development use |
| 🔀 `hybrid` | Per-feature access control with granular permissions | **Production (recommended)** |
| 🔒 `private` | Authentication required for all endpoints | Maximum security |

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `AUTH_MODE` | Authentication mode | `hybrid` | ⚪ Optional |
| `LOCAL_AUTH_ENABLED` | Enable local username/password authentication | `True` | ⚪ Optional |
| `API_KEY_ENABLED` | Enable API key authentication | `True` | ⚪ Optional |

### 🎫 JWT Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `JWT_SECRET_KEY` | Secret key for JWT signing | Uses `DJANGO_SECRET_KEY` | 🟡 Recommended |
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` | Access token validity period | `60` | ⚪ Optional |
| `JWT_REFRESH_TOKEN_LIFETIME_DAYS` | Refresh token validity period | `2` | ⚪ Optional |
| `JWT_AUTH_COOKIE` | Use httpOnly cookie for refresh token storage | `False` | ⚪ Optional |

> 💡 **Tip**
> Use a different secret key for `JWT_SECRET_KEY` than your `DJANGO_SECRET_KEY` for better security isolation.

### 🔗 OIDC / SSO Configuration

Enable Single Sign-On with identity providers like Keycloak, Authentik, Azure AD, Okta, or Auth0.

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `OIDC_ENABLED` | Enable OIDC authentication | `False` | ⚪ Optional |
| `OIDC_PROVIDER_NAME` | Display name shown on login button | `SSO` | ⚪ Optional |
| `OIDC_PROVIDER_URL` | Authorization server base URL | None | 🔴 If OIDC enabled |
| `OIDC_CLIENT_ID` | Client ID from your OIDC provider | None | 🔴 If OIDC enabled |
| `OIDC_CLIENT_SECRET` | Client secret from your OIDC provider | None | 🔴 If OIDC enabled |
| `OIDC_SCOPES` | Space-separated OAuth scopes to request | `openid profile email groups` | ⚪ Optional |
| `OIDC_DEFAULT_ROLE` | Default role for new OIDC users | `viewer` | ⚪ Optional |

<details>
<summary><strong>📚 OIDC Provider Configuration Examples</strong></summary>

#### Keycloak

```env
OIDC_ENABLED=True
OIDC_PROVIDER_NAME=Keycloak
OIDC_PROVIDER_URL=https://keycloak.example.com/realms/skyspy
OIDC_CLIENT_ID=skyspy-client
OIDC_CLIENT_SECRET=<client-secret>
```

#### Authentik

```env
OIDC_ENABLED=True
OIDC_PROVIDER_NAME=Authentik
OIDC_PROVIDER_URL=https://authentik.example.com/application/o/skyspy
OIDC_CLIENT_ID=<client-id>
OIDC_CLIENT_SECRET=<client-secret>
```

#### Azure AD / Entra ID

```env
OIDC_ENABLED=True
OIDC_PROVIDER_NAME=Microsoft
OIDC_PROVIDER_URL=https://login.microsoftonline.com/{tenant-id}/v2.0
OIDC_CLIENT_ID=<application-client-id>
OIDC_CLIENT_SECRET=<client-secret-value>
OIDC_SCOPES=openid profile email
```

</details>

---

## 🗄️ Database & Cache

### PostgreSQL Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `DATABASE_URL` | PostgreSQL connection URL | `postgresql://adsb:adsb@postgres:5432/adsb` | ⚪ Optional |
| `POSTGRES_USER` | PostgreSQL username (Docker Compose) | `adsb` | ⚪ Optional |
| `POSTGRES_PASSWORD` | PostgreSQL password (Docker Compose) | `adsb` | ⚪ Optional |
| `POSTGRES_DB` | PostgreSQL database name (Docker Compose) | `adsb` | ⚪ Optional |

### Redis Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `REDIS_URL` | Redis connection URL for Celery, cache, and channels | `redis://redis:6379/0` | ⚪ Optional |

### Caching Settings

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `CACHE_TTL` | Default cache time-to-live in seconds | `5` | ⚪ Optional |
| `UPSTREAM_API_MIN_INTERVAL` | Minimum seconds between upstream API calls | `60` | ⚪ Optional |

---

## 📡 ADS-B Data Sources

### Feeder Configuration

> 📌 **Info**
> Accurate feeder location is essential for distance calculations and range analytics.

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `FEEDER_LAT` | Latitude of your antenna position (decimal degrees) | `47.9377` | 🟡 **Recommended** |
| `FEEDER_LON` | Longitude of your antenna position (decimal degrees) | `-121.9687` | 🟡 **Recommended** |
| `ULTRAFEEDER_HOST` | Hostname of Ultrafeeder/readsb/tar1090 service | `ultrafeeder` | ⚪ Optional |
| `ULTRAFEEDER_PORT` | HTTP port of Ultrafeeder service | `80` | ⚪ Optional |
| `DUMP978_HOST` | Hostname of dump978 UAT service | `dump978` | ⚪ Optional |
| `DUMP978_PORT` | HTTP port of dump978 service | `80` | ⚪ Optional |

### Polling & Session Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `POLLING_INTERVAL` | Seconds between ADS-B polls from data sources | `2` | ⚪ Optional |
| `DB_STORE_INTERVAL` | Seconds between database position writes | `5` | ⚪ Optional |
| `SESSION_TIMEOUT_MINUTES` | Minutes of inactivity before aircraft session ends | `30` | ⚪ Optional |

---

## 🛡️ Safety Monitoring

> ⚠️ **Warning**
> Safety monitoring generates alerts for potential aviation safety events. Review thresholds carefully for your environment.

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `SAFETY_MONITORING_ENABLED` | Enable safety event detection and alerts | `True` | ⚪ Optional |
| `SAFETY_VS_CHANGE_THRESHOLD` | Vertical speed change threshold (ft/min) | `2000` | ⚪ Optional |
| `SAFETY_VS_EXTREME_THRESHOLD` | Extreme vertical speed threshold (ft/min) | `6000` | ⚪ Optional |
| `SAFETY_PROXIMITY_NM` | Proximity alert distance in nautical miles | `0.5` | ⚪ Optional |
| `SAFETY_ALTITUDE_DIFF_FT` | Altitude difference for proximity alerts (feet) | `500` | ⚪ Optional |
| `SAFETY_CLOSURE_RATE_KT` | Closure rate threshold for alerts (knots) | `200` | ⚪ Optional |
| `SAFETY_TCAS_VS_THRESHOLD` | TCAS vertical speed threshold (ft/min) | `1500` | ⚪ Optional |

---

## 🔔 Alerts & Notifications

### Default Alert Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `PROXIMITY_ALERT_NM` | Default proximity alert radius in nautical miles | `5.0` | ⚪ Optional |
| `WATCH_ICAO_LIST` | Comma-separated ICAO hex codes to watch | Empty | ⚪ Optional |
| `WATCH_FLIGHT_LIST` | Comma-separated flight numbers to watch | Empty | ⚪ Optional |
| `ALERT_MILITARY` | Generate alerts for military aircraft | `True` | ⚪ Optional |
| `ALERT_EMERGENCY` | Generate alerts for emergency squawks (7500, 7600, 7700) | `True` | ⚪ Optional |

### 📲 Apprise Notifications

SkysPy uses [Apprise](https://github.com/caronc/apprise) for multi-platform notifications.

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `APPRISE_URLS` | Comma-separated Apprise notification URLs | Empty | ⚪ Optional |
| `NOTIFICATION_COOLDOWN` | Seconds between duplicate notifications | `300` | ⚪ Optional |

<details>
<summary><strong>📚 Apprise URL Examples</strong></summary>

```bash
# Telegram
APPRISE_URLS=telegram://bot_token/chat_id

# Discord
APPRISE_URLS=discord://webhook_id/webhook_token

# Slack
APPRISE_URLS=slack://token_a/token_b/token_c

# Pushover
APPRISE_URLS=pushover://user_key/app_token

# Email
APPRISE_URLS=email://user:password@smtp.example.com

# Multiple services (comma-separated)
APPRISE_URLS=telegram://...,discord://...,email://...
```

</details>

---

## 📻 ACARS / VDL2 Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `ACARS_ENABLED` | Enable ACARS message processing | `True` | ⚪ Optional |
| `ACARS_PORT` | UDP port for ACARS messages | `5555` | ⚪ Optional |
| `VDLM2_PORT` | UDP port for VDL Mode 2 messages | `5556` | ⚪ Optional |

---

## 🎙️ Radio & Audio

### Radio Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `RADIO_ENABLED` | Enable radio transmission processing | `True` | ⚪ Optional |
| `RADIO_AUDIO_DIR` | Directory for audio file storage | `/data/radio` | ⚪ Optional |
| `RADIO_MAX_FILE_SIZE_MB` | Maximum audio file size in megabytes | `50` | ⚪ Optional |
| `RADIO_RETENTION_DAYS` | Days to retain audio files | `7` | ⚪ Optional |
| `RADIO_S3_PREFIX` | S3 prefix for radio file storage | `radio-transmissions` | ⚪ Optional |

### 🎤 Transcription Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `TRANSCRIPTION_ENABLED` | Enable audio transcription | `False` | ⚪ Optional |
| `TRANSCRIPTION_SERVICE_URL` | External transcription service URL | None | 🔴 If using external |
| `TRANSCRIPTION_MODEL` | Model to use for transcription | None | ⚪ Optional |
| `TRANSCRIPTION_API_KEY` | API key for transcription service | None | 🔴 If using external |

### Whisper Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `WHISPER_ENABLED` | Enable local Whisper transcription | `False` | ⚪ Optional |
| `WHISPER_URL` | URL of Whisper service | `http://whisper:9000` | ⚪ Optional |

<details>
<summary><strong>🎯 ATC-Whisper Configuration (Specialized ATC Transcription)</strong></summary>

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `ATC_WHISPER_ENABLED` | Enable ATC-optimized Whisper transcription | `False` | ⚪ Optional |
| `ATC_WHISPER_MAX_CONCURRENT` | Maximum concurrent transcription jobs | `2` | ⚪ Optional |
| `ATC_WHISPER_SEGMENT_BY_VAD` | Use voice activity detection for segmentation | `True` | ⚪ Optional |
| `ATC_WHISPER_PREPROCESS` | Enable audio preprocessing | `True` | ⚪ Optional |
| `ATC_WHISPER_NOISE_REDUCE` | Enable noise reduction | `True` | ⚪ Optional |
| `ATC_WHISPER_POSTPROCESS` | Enable post-processing cleanup | `True` | ⚪ Optional |

</details>

---

## 🤖 LLM API Configuration

Optional LLM integration for improved callsign extraction accuracy from transcripts.

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `LLM_ENABLED` | Enable LLM-enhanced transcript analysis | `False` | ⚪ Optional |
| `LLM_API_URL` | OpenAI-compatible API endpoint | `https://api.openai.com/v1` | ⚪ Optional |
| `LLM_API_KEY` | API key (not needed for local Ollama) | Empty | 🔴 If using cloud |
| `LLM_MODEL` | Model to use | `gpt-4o-mini` | ⚪ Optional |
| `LLM_TIMEOUT` | Request timeout in seconds | `30` | ⚪ Optional |
| `LLM_MAX_RETRIES` | Maximum retries on failure | `3` | ⚪ Optional |
| `LLM_CACHE_TTL` | Cache TTL in seconds | `3600` | ⚪ Optional |
| `LLM_MAX_TOKENS` | Maximum response tokens | `500` | ⚪ Optional |
| `LLM_TEMPERATURE` | Temperature (lower = more deterministic) | `0.1` | ⚪ Optional |

<details>
<summary><strong>📚 LLM Provider Examples</strong></summary>

#### OpenAI

```env
LLM_ENABLED=True
LLM_API_URL=https://api.openai.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=gpt-4o-mini
```

#### Local Ollama

```env
LLM_ENABLED=True
LLM_API_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3.2
```

#### Anthropic via OpenRouter

```env
LLM_ENABLED=True
LLM_API_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-xxx
LLM_MODEL=anthropic/claude-3-haiku
```

</details>

---

## 📷 Photo Cache Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `PHOTO_CACHE_ENABLED` | Enable aircraft photo caching | `True` | ⚪ Optional |
| `PHOTO_CACHE_DIR` | Directory for cached photos | `/data/photos` | ⚪ Optional |
| `PHOTO_AUTO_DOWNLOAD` | Automatically download photos for tracked aircraft | `True` | ⚪ Optional |

---

## ☁️ S3 / Object Storage

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `S3_ENABLED` | Enable S3 storage for photos and audio | `False` | ⚪ Optional |
| `S3_BUCKET` | S3 bucket name | Empty | 🔴 If S3 enabled |
| `S3_REGION` | AWS region | `us-east-1` | ⚪ Optional |
| `S3_ACCESS_KEY` | AWS access key ID | None | 🔴 If S3 enabled |
| `S3_SECRET_KEY` | AWS secret access key | None | 🔴 If S3 enabled |
| `S3_ENDPOINT_URL` | Custom endpoint URL for S3-compatible storage | None | ⚪ Optional |
| `S3_PREFIX` | Prefix for photo storage | `aircraft-photos` | ⚪ Optional |
| `S3_PUBLIC_URL` | Public URL for serving files | None | ⚪ Optional |

---

## 🌐 External Data Sources

### OpenSky Database

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `OPENSKY_DB_ENABLED` | Enable OpenSky aircraft database lookup | `True` | ⚪ Optional |
| `OPENSKY_DB_PATH` | Path to OpenSky CSV database file | `/data/opensky/aircraft-database.csv` | ⚪ Optional |

<details>
<summary><strong>🌍 External API Integrations</strong></summary>

### CheckWX Weather API

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `CHECKWX_ENABLED` | Enable CheckWX weather data (3,000 req/day free) | `False` | ⚪ Optional |
| `CHECKWX_API_KEY` | CheckWX API key | Empty | 🔴 If enabled |

### AVWX Weather API

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `AVWX_ENABLED` | Enable AVWX weather data (unlimited basic) | `True` | ⚪ Optional |
| `AVWX_API_KEY` | AVWX API key (optional, higher rate limits) | Empty | ⚪ Optional |

### OpenAIP Airspace

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `OPENAIP_ENABLED` | Enable OpenAIP airspace data | `False` | ⚪ Optional |
| `OPENAIP_API_KEY` | OpenAIP API key | Empty | 🔴 If enabled |

### OpenSky Network Live API

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `OPENSKY_LIVE_ENABLED` | Enable OpenSky live data (4,000 credits/day free) | `False` | ⚪ Optional |
| `OPENSKY_USERNAME` | OpenSky Network username | Empty | 🔴 If enabled |
| `OPENSKY_PASSWORD` | OpenSky Network password | Empty | 🔴 If enabled |

### ADS-B Exchange Live API

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `ADSBX_LIVE_ENABLED` | Enable ADS-B Exchange live data via RapidAPI | `False` | ⚪ Optional |
| `ADSBX_RAPIDAPI_KEY` | RapidAPI key for ADS-B Exchange | Empty | 🔴 If enabled |

### Aviationstack Flight Schedules

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `AVIATIONSTACK_ENABLED` | Enable Aviationstack schedules (100 req/month free) | `False` | ⚪ Optional |
| `AVIATIONSTACK_API_KEY` | Aviationstack API key | Empty | 🔴 If enabled |

</details>

---

## 📊 Monitoring & Observability

### Sentry Error Tracking

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `SENTRY_DSN` | Sentry DSN for error tracking | Empty | ⚪ Optional |
| `SENTRY_ENVIRONMENT` | Environment tag (e.g., `production`, `staging`) | `development` | ⚪ Optional |
| `SENTRY_TRACES_SAMPLE_RATE` | Performance tracing sample rate (0.0 to 1.0) | `0.1` | ⚪ Optional |
| `SENTRY_PROFILES_SAMPLE_RATE` | Profiling sample rate (0.0 to 1.0) | `0.1` | ⚪ Optional |

### Prometheus Metrics

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `PROMETHEUS_ENABLED` | Enable Prometheus metrics endpoint | `True` | ⚪ Optional |

---

## 🌍 CORS Configuration

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | Empty | ⚪ Optional |

```bash
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://skyspy.example.com
```

---

## 🔒 Security Settings

| Variable | Description | Default | Status |
|:---------|:------------|:--------|:------:|
| `FORCE_SECURE_COOKIES` | Force secure cookie flags in debug mode | `False` | ⚪ Optional |

---

## 🐍 Django Settings Files

### settings.py (Standard Configuration)

The main settings file provides the default configuration for most deployments.

| Characteristic | Value |
|:---------------|:------|
| Polling Interval | 2 seconds |
| Database Store Interval | 5 seconds |
| All Features | Enabled |
| Cache TTL | 5 seconds |
| Logging Level | INFO (DEBUG when `DEBUG=True`) |

### settings_rpi.py (Raspberry Pi Optimization)

> 💡 **Tip**
> Use `DJANGO_SETTINGS_MODULE=skyspy.settings_rpi` for resource-constrained deployments.

```bash
# Enable RPi settings via environment
export DJANGO_SETTINGS_MODULE=skyspy.settings_rpi

# Or in Docker Compose
environment:
  - DJANGO_SETTINGS_MODULE=skyspy.settings_rpi
```

<details>
<summary><strong>🍓 Raspberry Pi Optimization Details</strong></summary>

#### Performance Comparison

| Setting | Standard | RPi-Optimized | Impact |
|:--------|:---------|:--------------|:-------|
| `POLLING_INTERVAL` | 2s | 3s | ~33% CPU reduction |
| `DB_STORE_INTERVAL` | 5s | 10s | 50% fewer DB writes |
| `CACHE_TTL` | 5s | 10s | Fewer cache refreshes |
| `MAX_SEEN_AIRCRAFT` | 10,000 | 5,000 | 50% memory savings |
| `ACARS_BUFFER_SIZE` | 50 | 30 | Reduced buffer memory |
| `WEBSOCKET_CAPACITY` | 1,500 | 1,000 | Lower memory usage |
| `CONN_MAX_AGE` | 60s | 120s | Fewer DB connections |

#### Task Interval Overrides

| Task | Standard | RPi-Optimized |
|:-----|:---------|:--------------|
| Flight pattern/geographic stats | 2 min | 10 min |
| Time comparison stats | 5 min | 15 min |
| Tracking quality stats | 2 min | 10 min |
| Engagement stats | 2 min | 10 min |
| Antenna analytics | 5 min | 10 min |
| ACARS stats | 60s | 2 min |
| Stats cache | 60s | 90s |
| Safety stats | 30s | 60s |

#### Data Retention (Reduced)

| Data Type | Standard | RPi |
|:----------|:---------|:----|
| Sighting retention | 30 days | 7 days |
| Session retention | 90 days | 14 days |
| Alert history | 30 days | 7 days |
| Antenna snapshots | 7 days | 3 days |

#### Query Limits

| Limit | Value |
|:------|:------|
| `MAX_HISTORY_HOURS` | 72 hours |
| `MAX_QUERY_RESULTS` | 10,000 |
| `MAX_STATS_SAMPLE_SIZE` | 1,000 |

</details>

---

## 💻 Frontend Configuration

The frontend stores user preferences in browser localStorage via `/web/src/utils/config.js`.

### Default Configuration

```javascript
{
  apiBaseUrl: '',              // Always empty (uses relative URLs)
  mapMode: 'pro',              // Map display mode
  mapDarkMode: true,           // Dark mode enabled
  browserNotifications: false, // Browser notification permission
  shortTrackLength: 15,        // Track trail positions (5-50)
}
```

### 🗺️ Map Modes

| Mode | Description |
|:-----|:------------|
| 📡 `radar` | Classic radar sweep display |
| 🖥️ `crt` | Retro CRT monitor aesthetic |
| ✈️ `pro` | Professional aviation display |
| 🗺️ `map` | Standard map view |

<details>
<summary><strong>🎨 Default Overlay Settings</strong></summary>

```javascript
{
  aircraft: true,       // Aircraft icons
  vors: true,           // VOR navigation aids
  airports: true,       // Airport locations
  airspace: true,       // Airspace boundaries
  metars: false,        // Weather observations
  pireps: false,        // Pilot reports

  // Terrain overlays (pro mode)
  water: false,
  counties: false,
  states: false,
  countries: false,

  // Aviation overlays (pro mode)
  usArtcc: false,       // US ARTCC boundaries
  usRefueling: false,   // US A2A refueling tracks
  ukMilZones: false,    // UK military zones
  euMilAwacs: false,    // EU military AWACS orbits
  trainingAreas: false  // IFT/USAFA training areas
}
```

</details>

### Vite Development Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `VITE_API_TARGET` | Backend API URL for proxy | `http://localhost:8000` |
| `NODE_ENV` | Node environment | `development` |
| `DASHBOARD_PORT` | Frontend dev server port | `3000` |

---

## 🚩 Feature Flags

<details>
<summary><strong>📋 Complete Feature Flag Reference</strong></summary>

### Core Features

| Feature | Environment Variable | Default |
|:--------|:---------------------|:--------|
| Safety Monitoring | `SAFETY_MONITORING_ENABLED` | `True` |
| ACARS Processing | `ACARS_ENABLED` | `True` |
| Photo Caching | `PHOTO_CACHE_ENABLED` | `True` |
| Auto Photo Download | `PHOTO_AUTO_DOWNLOAD` | `True` |
| Radio Processing | `RADIO_ENABLED` | `True` |
| OpenSky Database | `OPENSKY_DB_ENABLED` | `True` |
| Prometheus | `PROMETHEUS_ENABLED` | `True` |
| Local Auth | `LOCAL_AUTH_ENABLED` | `True` |
| API Key Auth | `API_KEY_ENABLED` | `True` |

### Optional Features (Disabled by Default)

| Feature | Environment Variable | Default |
|:--------|:---------------------|:--------|
| Transcription | `TRANSCRIPTION_ENABLED` | `False` |
| Whisper | `WHISPER_ENABLED` | `False` |
| ATC Whisper | `ATC_WHISPER_ENABLED` | `False` |
| LLM Analysis | `LLM_ENABLED` | `False` |
| S3 Storage | `S3_ENABLED` | `False` |
| OIDC/SSO | `OIDC_ENABLED` | `False` |

### External Data Sources

| Feature | Environment Variable | Default |
|:--------|:---------------------|:--------|
| AVWX Weather | `AVWX_ENABLED` | `True` |
| CheckWX Weather | `CHECKWX_ENABLED` | `False` |
| OpenAIP Airspace | `OPENAIP_ENABLED` | `False` |
| OpenSky Live | `OPENSKY_LIVE_ENABLED` | `False` |
| ADS-B Exchange | `ADSBX_LIVE_ENABLED` | `False` |
| Aviationstack | `AVIATIONSTACK_ENABLED` | `False` |

</details>

---

## ⚡ Performance Tuning

<details>
<summary><strong>📡 WebSocket Rate Limiting</strong></summary>

Control WebSocket broadcast frequencies to prevent client overload:

```python
WS_RATE_LIMITS = {
    'aircraft:update': 10,      # Max 10 Hz
    'aircraft:position': 5,     # Max 5 Hz for position-only
    'aircraft:delta': 10,       # Max 10 Hz for delta updates
    'stats:update': 0.5,        # Max 0.5 Hz (2s minimum)
    'default': 5,               # Default rate limit
}
```

</details>

<details>
<summary><strong>📦 Message Batching</strong></summary>

Configure message batching for efficiency:

```python
WS_BATCH_WINDOW_MS = 50         # Collect messages for 50ms
WS_MAX_BATCH_SIZE = 50          # Maximum messages per batch
WS_IMMEDIATE_TYPES = [          # Types that bypass batching
    'alert', 'safety', 'emergency',
    'aircraft:update', 'aircraft:new', 'aircraft:position',
]
```

</details>

<details>
<summary><strong>⏰ Celery Worker Configuration</strong></summary>

```yaml
# docker-compose.yml
celery-worker:
  command: >
    celery -A skyspy worker
    --loglevel=info
    --concurrency=100          # Adjust based on resources
    --queues=polling,default,database,transcription,notifications
    --pool=gevent              # Greenlet-based concurrency
```

### Task Queue Routing

| Queue | Tasks | Priority |
|:------|:------|:---------|
| `polling` | Aircraft polling, stats updates | High |
| `default` | General tasks | Normal |
| `database` | External DB sync, cleanup | Low |
| `transcription` | Audio transcription | Low |
| `notifications` | Alert notifications | Normal |
| `low_priority` | Analytics, cleanup | Lowest |

</details>

<details>
<summary><strong>🔴 Redis Configuration</strong></summary>

```yaml
redis:
  command: >
    redis-server
    --appendonly yes
    --maxmemory 256mb
    --maxmemory-policy allkeys-lru
```

</details>

<details>
<summary><strong>📡 Channel Layer Configuration</strong></summary>

```python
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [REDIS_URL],
            'capacity': 1500,      # Message capacity per channel
            'expiry': 60,          # Message expiry (seconds)
            'group_expiry': 300,   # Group membership expiry
        },
    },
}
```

</details>

<details>
<summary><strong>🗄️ Database Connection Pooling</strong></summary>

```python
DATABASES = {
    'default': {
        'CONN_MAX_AGE': 60,        # Connection lifetime (seconds)
        'OPTIONS': {
            'connect_timeout': 10,  # Connection timeout
        },
    }
}
```

For high-load deployments, consider PgBouncer:

```yaml
pgbouncer:
  environment:
    - POOL_MODE=transaction
    - MAX_CLIENT_CONN=1000
    - DEFAULT_POOL_SIZE=20
```

</details>

---

## 📝 Debug and Logging

### Log Levels

| Logger | Debug Mode | Production |
|:-------|:-----------|:-----------|
| `root` | INFO | INFO |
| `django` | Configurable via `DJANGO_LOG_LEVEL` | INFO |
| `skyspy` | DEBUG | INFO |
| `celery` | INFO | INFO |

<details>
<summary><strong>📋 Logging Configuration</strong></summary>

```python
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
    },
    'loggers': {
        'django': {
            'level': os.environ.get('DJANGO_LOG_LEVEL', 'INFO'),
        },
        'skyspy': {
            'level': 'DEBUG' if DEBUG else 'INFO',
        },
        'celery': {
            'level': 'INFO',
        },
    },
}
```

### RPi Logging (Reduced Verbosity)

```python
# settings_rpi.py
LOGGING['root']['level'] = 'WARNING'
LOGGING['loggers']['skyspy']['level'] = 'INFO'
LOGGING['loggers']['django']['level'] = 'WARNING'
```

</details>

### Debug Mode Behaviors

When `DEBUG=True`:

- Django debug toolbar enabled
- Detailed error pages
- Auto-generated secret key (development only)
- Default `ALLOWED_HOSTS` includes localhost
- `skyspy` logger set to DEBUG level
- Stack traces in API error responses

### Viewing Logs

```bash
# Docker Compose logs
docker-compose logs -f api
docker-compose logs -f celery-worker
docker-compose logs -f celery-beat

# Filter by service
docker-compose logs -f api celery-worker

# Last 100 lines
docker-compose logs --tail=100 api
```

---

## 🚦 API Rate Limiting

| User Type | Rate Limit |
|:----------|:-----------|
| Anonymous | 100 requests/minute |
| Authenticated | 1,000 requests/minute |

<details>
<summary><strong>⚙️ Rate Limiting Configuration</strong></summary>

```python
REST_FRAMEWORK = {
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/minute',
        'user': '1000/minute',
    }
}
```

</details>

---

## ✅ Security Best Practices

> ⚠️ **Warning**
> Complete this checklist before deploying to production!

### Production Checklist

- [ ] Set unique `DJANGO_SECRET_KEY`
- [ ] Set unique `JWT_SECRET_KEY` (different from Django secret)
- [ ] Set `DEBUG=False`
- [ ] Configure `ALLOWED_HOSTS` explicitly
- [ ] Use `AUTH_MODE=private` or `AUTH_MODE=hybrid`
- [ ] Change default superuser password
- [ ] Configure `CORS_ALLOWED_ORIGINS`
- [ ] Enable HTTPS (via reverse proxy)
- [ ] Review and restrict API rate limits
- [ ] Enable Sentry for error tracking
- [ ] Secure Redis with password if exposed
- [ ] Use strong PostgreSQL credentials

### 🔑 Generating Secure Keys

```bash
# Django Secret Key
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"

# JWT Secret Key (use a different value)
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

---

## 🐳 Docker Configuration

### Docker Compose Profiles

| Profile | Description | Usage |
|:--------|:------------|:------|
| (default) | Core services: api, postgres, redis, celery | `docker-compose up -d` |
| `acars` | Include ACARS UDP listener | `docker-compose --profile acars up -d` |
| `dev` | Development with hot-reload | `docker-compose -f docker-compose.test.yaml --profile dev up` |
| `test` | Run test suite | `docker-compose -f docker-compose.test.yaml --profile test up` |

### Volume Mounts

| Volume | Path | Description |
|:-------|:-----|:------------|
| `postgres_data` | `/var/lib/postgresql/data` | PostgreSQL database |
| `redis_data` | `/data` | Redis persistence |
| `photo_cache` | `/data/photos` | Cached aircraft photos |
| `radio_data` | `/data/radio` | Audio transmissions |
| `opensky_data` | `/data/opensky` | OpenSky database |

### Network Configuration

Default Docker network: `skyspy-network`

| Service | Internal Port | Default External Port |
|:--------|:--------------|:----------------------|
| API | 8000 | `$API_PORT` (8000) |
| PostgreSQL | 5432 | Not exposed |
| Redis | 6379 | Not exposed |
| ACARS (UDP) | 5555 | `$ACARS_PORT` (5555) |
| VDL2 (UDP) | 5556 | `$VDLM2_PORT` (5556) |

---

## 🔧 Troubleshooting

<details>
<summary><strong>🚨 Common Issues and Solutions</strong></summary>

### Secret Key Error in Production

```
ImproperlyConfigured: DJANGO_SECRET_KEY must be set in production
```

**Solution:** Set `DJANGO_SECRET_KEY` environment variable.

---

### Database Connection Failed

```
could not connect to server: Connection refused
```

**Solution:** Ensure PostgreSQL container is healthy before starting API.

---

### Redis Connection Failed

```
redis.exceptions.ConnectionError
```

**Solution:** Check `REDIS_URL` and ensure Redis container is running.

---

### CORS Errors

```
Access-Control-Allow-Origin header missing
```

**Solution:** Add your frontend origin to `CORS_ALLOWED_ORIGINS`.

---

### JWT Token Invalid

```
Token is invalid or expired
```

**Solution:** Ensure `JWT_SECRET_KEY` is consistent across all services.

</details>

---

## 📚 Related Documentation

| Document | Description |
|:---------|:------------|
| [Installation Guide](./01-installation.md) | Getting started with SkysPy |
| [API Reference](./03-api-reference.md) | REST API documentation |
| [WebSocket Events](./04-websockets.md) | Real-time event reference |
| [Deployment Guide](./05-deployment.md) | Production deployment |
