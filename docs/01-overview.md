---
title: Overview & Architecture
slug: overview
category:
  uri: getting-started
position: 2
privacy:
  view: public
---

# 🛩️ Project Overview and Architecture

<br/>

> 📡 **SkySpy** is an enterprise-grade, real-time ADS-B aircraft tracking and monitoring platform built for enthusiasts, researchers, and aviation professionals.

<br/>

---

## 🎯 What is SkySpy?

SkySpy captures position data from **1090MHz Mode S** and **978MHz UAT** receivers, displays aircraft on an interactive map, monitors safety conditions, and provides advanced features like custom alerts, weather integration, ACARS message decoding, and push notifications.

> 📘 **Deployment Flexibility**
>
> SkySpy is designed to run on hardware ranging from **Raspberry Pi edge devices** to **enterprise server infrastructure**, with configuration profiles optimized for each deployment scenario.

<br/>

---

## ✨ Key Capabilities

| Capability | Description | Status |
|:-----------|:------------|:------:|
| 📍 **Real-Time Tracking** | Sub-second aircraft position updates with distance, altitude, speed, and climb rate calculations | ✅ |
| 🖥️ **Interactive Dashboard** | Canvas-based radar display with multiple visualization modes including CRT phosphor effects | ✅ |
| 🚨 **Safety Monitoring** | TCAS RA/TA detection, proximity alerts, extreme vertical speed warnings, emergency squawk detection | ✅ |
| 🔔 **Custom Alert Rules** | Flexible AND/OR logic conditions with **80+** notification channel integrations | ✅ |
| 📊 **Historical Analytics** | PostgreSQL-backed sighting history with session tracking, gamification, and trend analysis | ✅ |
| 🌤️ **Aviation Weather** | METARs, TAFs, PIREPs, SIGMETs, G-AIRMETs, and NOTAMs integration | ✅ |
| 📻 **ACARS/VDL2 Decoding** | Aircraft communication message reception, parsing, and display with libacars integration | ✅ |
| 💻 **Multi-Platform CLI** | Native Go terminal radar client with themes, overlays, and export capabilities | ✅ |

<br/>

---

## 🏗️ High-Level Architecture

```mermaid
flowchart TB
    subgraph sources["📡 DATA SOURCES"]
        UF["🛩️ Ultrafeeder<br/>(1090MHz ADS-B)"]
        D978["📻 dump978<br/>(978MHz UAT)"]
        ACARS["📨 ACARS Hub<br/>(VDL2/ACARS)"]
    end

    subgraph server["🖥️ SKYSPY DJANGO API SERVER (Daphne ASGI)"]
        direction TB
        subgraph core["⚙️ Core Services"]
            AT["Aircraft Tracking"]
            SM["Safety Monitoring"]
            AE["Alert Engine"]
            WI["Weather Integration"]
            AD["ACARS Decoder"]
        end
        subgraph channels["🔌 Django Channels"]
            WS["WebSocket Consumers"]
        end
    end

    subgraph storage["💾 DATA LAYER"]
        PG["🐘 PostgreSQL<br/>━━━━━━━━━━<br/>• Aircraft Data<br/>• Sighting History<br/>• Alert Rules<br/>• User Accounts"]
        RD["⚡ Redis<br/>━━━━━━━━━━<br/>• Channel Layer<br/>• Cache<br/>• Message Broker<br/>• Pub/Sub"]
        CL["🔄 Celery Workers<br/>━━━━━━━━━━<br/>• Polling Tasks<br/>• Analytics<br/>• Notifications<br/>• Transcription"]
    end

    subgraph clients["👥 CLIENTS"]
        REACT["⚛️ React Frontend<br/>(Web SPA)<br/>━━━━━━━━━━<br/>• Map View<br/>• Aircraft List<br/>• Stats/History<br/>• Alerts Config"]
        GO["🔲 Go CLI Client<br/>(skyspy-go)<br/>━━━━━━━━━━<br/>• Terminal Radar<br/>• 10+ Themes<br/>• GeoJSON Layers<br/>• Export Tools"]
        EXT["🌐 External APIs<br/>━━━━━━━━━━<br/>• OpenSky DB<br/>• Aviation Wx<br/>• Planespotters<br/>• FAA NOTAMs<br/>• CheckWX/AVWX"]
    end

    sources --> server
    server --> storage
    storage --> clients
```

<br/>

---

## 🔧 Technology Stack

### 🐍 Backend (Django API Server)

| Component | Technology | Purpose |
|:----------|:-----------|:--------|
| ![Django](https://img.shields.io/badge/Framework-Django%205.x-092E20?logo=django) | Django 5.x | Web framework with ORM |
| ![Daphne](https://img.shields.io/badge/Server-Daphne-44B78B) | Daphne | WebSocket-capable async server |
| ![DRF](https://img.shields.io/badge/API-DRF-A30000) | Django REST Framework | RESTful API with OpenAPI schema |
| ![Channels](https://img.shields.io/badge/Realtime-Channels-44B78B) | Django Channels | WebSocket consumers and channel layers |
| ![Celery](https://img.shields.io/badge/Tasks-Celery-37814A?logo=celery) | Celery + gevent | Background task processing with green threads |
| ![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%2016-4169E1?logo=postgresql) | PostgreSQL 16 | Primary data store |
| ![Redis](https://img.shields.io/badge/Cache-Redis%207-DC382D?logo=redis) | Redis 7 | Caching, message broker, channel layer |
| ![JWT](https://img.shields.io/badge/Auth-JWT%20+%20OIDC-000000?logo=jsonwebtokens) | SimpleJWT + OIDC | JWT tokens with SSO support |
| ![ACARS](https://img.shields.io/badge/Decoder-libacars%202.2-blue) | libacars 2.2 | Native ACARS message decoding |
| ![Apprise](https://img.shields.io/badge/Notifications-Apprise-orange) | Apprise | 80+ notification services |

<br/>

### ⚛️ Frontend (React SPA)

| Component | Technology | Purpose |
|:----------|:-----------|:--------|
| ![React](https://img.shields.io/badge/Framework-React%2018-61DAFB?logo=react) | React 18 | Component-based UI |
| ![Vite](https://img.shields.io/badge/Build-Vite%205-646CFF?logo=vite) | Vite 5 | Fast development and bundling |
| ![Leaflet](https://img.shields.io/badge/Maps-Leaflet-199900?logo=leaflet) | Leaflet | Interactive mapping |
| ![Lucide](https://img.shields.io/badge/Icons-Lucide-F56565) | Lucide React | Iconography |
| ![CSS](https://img.shields.io/badge/Styling-CSS%20Modules-1572B6?logo=css3) | CSS Modules | Scoped component styles |
| ![Playwright](https://img.shields.io/badge/Testing-Playwright-2EAD33?logo=playwright) | Playwright | End-to-end testing |

<br/>

### 🖥️ CLI Client (Go)

| Component | Technology | Purpose |
|:----------|:-----------|:--------|
| ![Go](https://img.shields.io/badge/TUI-Bubble%20Tea-00ADD8?logo=go) | Bubble Tea | Terminal user interface |
| ![LipGloss](https://img.shields.io/badge/Styling-Lip%20Gloss-FF69B4) | Lip Gloss | Terminal styling |
| ![WebSocket](https://img.shields.io/badge/WebSocket-Gorilla-1F8ACB) | Gorilla WebSocket | Real-time data streaming |
| ![Cobra](https://img.shields.io/badge/CLI-Cobra-00ADD8) | Cobra | Command-line parsing |
| ![Auth](https://img.shields.io/badge/Auth-OIDC%20+%20API%20Keys-000000) | OIDC + API Keys | Authentication support |

<br/>

---

## ⚙️ Core Components

<br/>

### 1️⃣ Aircraft Tracking Service

> 💡 **Core Engine**
>
> The aircraft tracking service is the heart of SkySpy, processing thousands of position updates per minute.

**Responsibilities:**

- 📡 Polling ADS-B receivers (Ultrafeeder/readsb/dump1090) at configurable intervals
- 🔄 Processing and normalizing aircraft position data
- 📐 Calculating distance and bearing from receiver location
- ⏱️ Managing aircraft sessions (first seen, last seen, tracking quality)
- 📢 Broadcasting updates via WebSocket to connected clients

```python
# Polling configuration (celery.py)
'poll-aircraft-every-2s': {
    'task': 'skyspy.tasks.aircraft.poll_aircraft',
    'schedule': 2.0,
    'options': {'expires': 2.0},
}
```

<br/>

### 2️⃣ Safety Monitoring Engine

> ⚠️ **Critical Monitoring**
>
> Continuous real-time monitoring for safety-critical events that require immediate attention.

| Event Type | Trigger Condition | Priority |
|:-----------|:------------------|:--------:|
| 🚨 Emergency Squawk | 7500, 7600, 7700 | 🔴 Critical |
| ⚠️ TCAS RA | Resolution Advisory detected | 🔴 Critical |
| ⚡ TCAS TA | Traffic Advisory detected | 🟠 High |
| 📍 Proximity Alert | Aircraft within threshold distance | 🟠 High |
| 📈 Extreme VS | Vertical speed > 6000 ft/min | 🟡 Medium |
| 📉 VS Change | Sudden VS change > 2000 ft/min | 🟡 Medium |

<br/>

### 3️⃣ Alert Rule Engine

> 📘 **Flexible Alerting**
>
> Create sophisticated alert rules using AND/OR condition logic with support for 80+ notification channels.

```json
{
  "name": "Military Aircraft Alert",
  "conditions": {
    "operator": "AND",
    "conditions": [
      { "field": "military", "operator": "eq", "value": true },
      { "field": "distance", "operator": "lt", "value": 50 }
    ]
  },
  "actions": ["notify", "log"]
}
```

<br/>

### 4️⃣ WebSocket Consumers

Django Channels provides real-time data streaming via WebSocket:

| Endpoint | Purpose | Description |
|:---------|:--------|:------------|
| 🛩️ `/ws/aircraft/` | Aircraft Updates | Real-time position streaming |
| 🚨 `/ws/safety/` | Safety Events | Emergency and TCAS notifications |
| 🔔 `/ws/alerts/` | Alert Triggers | Custom rule match notifications |
| 📻 `/ws/acars/` | ACARS Stream | Decoded message feed |
| 📊 `/ws/stats/` | Statistics | Live metrics updates |
| 📱 `/ws/cannonball/` | Mobile Mode | GPS-based threat detection |

<br/>

### 5️⃣ Celery Task System

Background task processing with priority queues:

| Queue | Tasks | Priority |
|:------|:------|:--------:|
| `polling` | Aircraft polling, stats updates | 🔴 High (time-sensitive) |
| `default` | General background tasks | 🟡 Normal |
| `database` | DB operations, cleanup | 🟡 Normal |
| `notifications` | Push notification delivery | 🟡 Normal |
| `transcription` | Audio transcription | 🔵 Low |
| `low_priority` | Analytics, aggregation | 🔵 Low |

<br/>

---

## 🔄 Data Flow

### 📡 ADS-B Data Ingestion

```mermaid
flowchart TD
    A["📡 ADS-B Receiver<br/>(Ultrafeeder)"] --> B["🔗 JSON API Endpoint<br/>/tar1090/data/aircraft.json"]
    B --> C["⚙️ Celery Task<br/>poll_aircraft"]
    C --> D["⚡ Update Redis Cache<br/>(live aircraft state)"]
    C --> E["📢 Broadcast via<br/>Django Channels"]
    C --> F["💾 Store to PostgreSQL<br/>(periodic snapshots)"]
    D --> G["👥 Connected Clients"]
    E --> G

    subgraph clients["📱 Clients"]
        G1["⚛️ Web Dashboard<br/>(React)"]
        G2["🖥️ CLI Client<br/>(Go)"]
        G3["📱 Mobile Apps"]
    end
    G --> clients
```

<br/>

### 🚨 Safety Event Detection

```mermaid
flowchart TD
    A["✈️ Aircraft Position Update"] --> B["🔍 Safety Monitoring Service"]

    B --> C{"🚨 Check Emergency<br/>Squawks 7500/7600/7700"}
    B --> D{"📐 Calculate Proximity<br/>to Other Aircraft"}
    B --> E{"📈 Analyze Vertical<br/>Speed Changes"}
    B --> F{"⚠️ Detect TCAS<br/>Alerts"}

    C --> G{"Event Detected?"}
    D --> G
    E --> G
    F --> G

    G -->|Yes| H["💾 Create SafetyEvent Record"]
    H --> I["📢 Broadcast via /ws/safety/"]
    I --> J["🔔 Trigger Notifications<br/>(if configured)"]
```

<br/>

### 🔔 Alert Rule Processing

```mermaid
flowchart TD
    A["✈️ Aircraft Update Received"] --> B["📋 Alert Rule Cache<br/>(Redis)"]
    B --> C["🔄 Evaluate Each Active Rule"]

    C --> D["🔀 Parse AND/OR Conditions"]
    D --> E["✅ Check Field Values<br/>Against Thresholds"]
    E --> F["⏱️ Apply Cooldown Logic"]

    F --> G{"Rule Matches?"}
    G -->|Yes| H["💾 Create AlertHistory Record"]
    H --> I["📤 Dispatch Notifications"]
    I --> J["📢 Broadcast via /ws/alerts/"]
```

<br/>

---

## 🌟 Key Features Summary

<br/>

### ✈️ Aircraft Tracking

- 📍 Real-time position updates from 1090MHz and 978MHz receivers
- 🔌 Support for multiple receiver sources (Ultrafeeder, dump978)
- 📐 Distance and bearing calculation from receiver location
- ⏱️ Session management with first/last seen timestamps
- 🏷️ Aircraft type classification (commercial, military, private, etc.)

<br/>

### 🖥️ Interactive Dashboard

- 🗺️ Canvas-based map with multiple rendering modes
- 📟 CRT radar mode with sweep animation
- 📋 Aircraft detail panels with registration, operator, and photo
- 📊 Real-time statistics (count, altitude distribution, closest/highest/fastest)
- 🔍 Filter and search capabilities

<br/>

### 📚 Historical Data

- 🕒 Sighting history with advanced filtering
- 📈 Session analytics and tracking quality metrics
- ✈️ Flight pattern analysis
- 📊 Time comparison statistics (hourly, daily, weekly trends)
- 📻 ACARS message history

<br/>

### 🌤️ Aviation Weather

- 📍 **METAR** - Current weather observations
- 📅 **TAF** - Terminal area forecasts
- 👨‍✈️ **PIREPs** - Pilot reports
- ⚠️ **SIGMETs/AIRMETs** - Hazardous weather
- 📋 **NOTAMs** - Notices to airmen

<br/>

### 🔔 Notification System

> 📘 **80+ Channels Supported**
>
> Pushover, Telegram, Slack, Discord, email, and many more via Apprise integration.

- 📝 Rich message formatting with aircraft details
- ⏱️ Cooldown management to prevent spam
- ⚙️ Per-rule notification configuration

<br/>

### 🔐 Authentication & Authorization

| Mode | Description | Icon |
|:-----|:------------|:----:|
| `public` | No authentication required | 🌐 |
| `private` | Authentication required for all endpoints | 🔒 |
| `hybrid` | Per-feature access control **(default)** | 🔓 |

**Supported Auth Methods:**

- 🔑 Local username/password authentication
- 🔗 API key authentication for integrations
- 🌐 OIDC/SSO support (Keycloak, Authentik, Azure AD, Okta)
- 👥 Role-based access control (viewer, operator, analyst, admin)

<br/>

### 📱 Mobile Features (Cannonball Mode)

- 📍 GPS-based threat detection
- 📺 Edge-to-edge radar display
- 📐 Real-time proximity calculations
- 🔊 Audio/haptic alerts
- 🎬 Session recording and playback

<br/>

---

## 🚀 Deployment Options

### 🐳 Docker Compose (Recommended)

```bash
# Production deployment
docker-compose up -d

# With ACARS listener
docker-compose --profile acars up -d
```

<br/>

### 🏛️ Services Architecture

| Service | Container | Port | Status |
|:--------|:----------|:-----|:------:|
| 🌐 `api` | skyspy-api | `8000` | ✅ |
| ⚙️ `celery-worker` | skyspy-celery-worker | - | ✅ |
| ⏰ `celery-beat` | skyspy-celery-beat | - | ✅ |
| 🐘 `postgres` | skyspy-postgres | `5432` | ✅ |
| ⚡ `redis` | skyspy-redis | `6379` | ✅ |
| 📻 `acars-listener` | skyspy-acars-listener | `5555/udp`, `5556/udp` | ✅ |

<br/>

### 🍓 Raspberry Pi Optimization

> 💡 **Edge Deployment**
>
> SkySpy includes optimized settings specifically tuned for Raspberry Pi 4/5 deployment.

```python
# settings_rpi.py
POLLING_INTERVAL = 3  # Reduced polling frequency
RPI_TASK_INTERVALS = {
    'stats_cache': 90.0,
    'safety_stats': 60.0,
    'acars_stats': 120.0,
}
```

<br/>

---

## 🌐 External Data Sources

| Source | Data Provided | Rate Limit | Status |
|:-------|:--------------|:-----------|:------:|
| 🌍 **OpenSky Network** | Aircraft database, live positions | 4,000 credits/day | ✅ |
| 📷 **Planespotters.net** | Aircraft photos | Cached locally | ✅ |
| 🌤️ **Aviation Weather Center** | METARs, TAFs, PIREPs | Unlimited | ✅ |
| 🇺🇸 **FAA** | NOTAMs, TFRs | Unlimited | ✅ |
| ☁️ **CheckWX** | Weather data | 3,000/day | ✅ |
| 🌧️ **AVWX** | Weather data | Unlimited basic | ✅ |
| ✈️ **OpenAIP** | Airspace boundaries | Unlimited | ✅ |

<br/>

---

## 📖 API Documentation

SkySpy provides a comprehensive REST API with OpenAPI documentation:

| Documentation | URL | Description |
|:--------------|:----|:------------|
| 📘 **Swagger UI** | `/api/docs/` | Interactive API explorer |
| 📕 **ReDoc** | `/api/redoc/` | Beautiful API reference |
| 📄 **OpenAPI Schema** | `/api/schema/` | Machine-readable spec |

<br/>

### 🔗 Key Endpoints

| Category | Base Path | Description |
|:---------|:----------|:------------|
| ✈️ Aircraft | `/api/v1/aircraft/` | Live aircraft tracking |
| 📚 History | `/api/v1/sightings/`, `/api/v1/sessions/` | Historical data |
| 🔔 Alerts | `/api/v1/alerts/rules/`, `/api/v1/alerts/history/` | Alert management |
| 🚨 Safety | `/api/v1/safety/events/` | Safety event monitoring |
| 🌤️ Aviation | `/api/v1/aviation/` | Weather and airspace data |
| 📻 ACARS | `/api/v1/acars/` | ACARS message history |
| 🎙️ Audio | `/api/v1/audio/` | Radio transmission recordings |
| ⚙️ System | `/api/v1/system/` | Health and status |

<br/>

---

## 📦 Version Information

| Component | Version | Status |
|:----------|:--------|:------:|
| 🚀 **SkySpy API** | `2.6.0` | ![Stable](https://img.shields.io/badge/status-stable-green) |
| 🌐 **Web Dashboard** | `2.5.0` | ![Stable](https://img.shields.io/badge/status-stable-green) |
| 🖥️ **Go CLI** | `1.0.0` | ![Stable](https://img.shields.io/badge/status-stable-green) |
| 🐍 **Django** | `5.x` | ![Required](https://img.shields.io/badge/required-5.x-blue) |
| 🐍 **Python** | `3.12+` | ![Required](https://img.shields.io/badge/required-3.12+-blue) |
| 📦 **Node.js** | `20+` | ![Required](https://img.shields.io/badge/required-20+-blue) |
| 🔵 **Go** | `1.21+` | ![Required](https://img.shields.io/badge/required-1.21+-blue) |

<br/>

---

## 📚 Next Steps

| Link | Description |
|:-----|:------------|
| 📥 [Installation Guide](./02-installation.md) | Detailed setup instructions |
| ⚙️ [Configuration Reference](./03-configuration.md) | Environment variables and settings |
| 🔗 [API Reference](./04-api-reference.md) | Complete API documentation |
| 🔌 [WebSocket Protocol](./05-websocket.md) | Real-time streaming guide |
| 🔔 [Alert Rules](./06-alerts.md) | Custom alert configuration |
| 🔐 [Authentication](./07-authentication.md) | Auth modes and SSO setup |

<br/>

---

<br/>

> 🛩️ **SkySpy** - Enterprise-grade aircraft tracking for enthusiasts and professionals alike.
