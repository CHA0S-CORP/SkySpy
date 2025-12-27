# SkySpyAPI

A FastAPI-based REST and WebSocket API for real-time ADS-B aircraft tracking with historical data storage, customizable alerts, safety monitoring, and push notifications.

## Features

- **Live Aircraft Tracking** - Real-time positions from 1090MHz Mode S and 978MHz UAT receivers
- **Real-Time Streaming** - Server-Sent Events (SSE) and Socket.IO for live updates
- **Historical Data** - PostgreSQL-backed sighting history and session tracking
- **Custom Alerts** - Flexible alert rules with AND/OR logic and scheduling
- **Safety Monitoring** - TCAS detection, proximity alerts, extreme vertical speed changes
- **Aviation Weather** - METARs, TAFs, PIREPs, SIGMETs from Aviation Weather Center
- **Airspace Data** - G-AIRMET advisories and static airspace boundaries
- **ACARS/VDL2** - Aircraft communication message reception and storage
- **Push Notifications** - Apprise-based notifications (80+ services supported)
- **Aircraft Info** - Registration, photos, and airframe data from multiple sources

## Quick Start

### Prerequisites

- Python 3.12+
- PostgreSQL 12+
- Redis (optional, for multi-worker deployments)

### Installation

```bash
cd adsb-api
pip install -e .
```

### Running

```bash
# Development
uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload

# Production
uvicorn app.main:app --host 0.0.0.0 --port 5000 --workers 4
```

### Docker Compose

```yaml
services:
  api:
    build: ./adsb-api
    ports:
      - "5000:5000"
    environment:
      DATABASE_URL: postgresql://adsb:adsb@postgres:5432/adsb
      ULTRAFEEDER_HOST: ultrafeeder
      FEEDER_LAT: 47.9377
      FEEDER_LON: -121.9687
    depends_on:
      - postgres
```

## API Documentation

Interactive documentation is available at:

- **Swagger UI**: `http://localhost:5000/docs`
- **ReDoc**: `http://localhost:5000/redoc`
- **OpenAPI JSON**: `http://localhost:5000/openapi.json`

## Endpoints

### Aircraft Tracking

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/aircraft` | All tracked aircraft |
| GET | `/api/v1/aircraft/top` | Top 5 by category (closest, highest, fastest, climbing, military) |
| GET | `/api/v1/aircraft/stats` | Aggregate statistics |
| GET | `/api/v1/aircraft/{hex}` | Single aircraft by ICAO hex |
| GET | `/api/v1/uat/aircraft` | 978MHz UAT aircraft |

### Aircraft Information

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/aircraft/{icao_hex}/info` | Full aircraft info (registration, photos, airframe) |
| GET | `/api/v1/aircraft/{icao_hex}/photo` | Photo URLs |
| GET | `/api/v1/aircraft/{icao_hex}/photo/download` | Proxy/download aircraft photo |
| POST | `/api/v1/aircraft/info/bulk` | Bulk lookup (cached data only) |
| GET | `/api/v1/aircraft/info/cache/stats` | Cache statistics |

### Map Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/map/geojson` | GeoJSON FeatureCollection for map visualization |
| GET | `/api/v1/map/sse` | Server-Sent Events stream |
| GET | `/api/v1/map/sse/status` | SSE service status |

### Historical Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/history/sightings` | Query sightings with filters |
| GET | `/api/v1/history/sightings/{icao_hex}` | Flight path for specific aircraft |
| GET | `/api/v1/history/sessions` | Tracking sessions |
| GET | `/api/v1/history/stats` | Historical statistics |

### Alert Rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/alerts/rules` | List all rules |
| POST | `/api/v1/alerts/rules` | Create rule |
| PUT | `/api/v1/alerts/rules/{rule_id}` | Update rule |
| DELETE | `/api/v1/alerts/rules/{rule_id}` | Delete rule |
| GET | `/api/v1/alerts/history` | Alert trigger history |

### Safety Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/safety/events` | Query safety events |
| GET | `/api/v1/safety/stats` | Safety monitoring statistics |

**Event Types:**
- `tcas_ra` - TCAS Resolution Advisory
- `tcas_ta` - TCAS Traffic Advisory
- `extreme_vs` - Extreme vertical speed (>4500 ft/min)
- `proximity` - Aircraft in close proximity

### Aviation Weather & Airspace

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/aviation/metars` | METAR observations by location |
| GET | `/api/v1/aviation/metar/{station}` | Single station METAR |
| GET | `/api/v1/aviation/taf/{station}` | Terminal Aerodrome Forecast |
| GET | `/api/v1/aviation/pireps` | Pilot reports by location |
| GET | `/api/v1/aviation/sigmets` | Active SIGMETs |
| GET | `/api/v1/aviation/airports` | Nearby airports |
| GET | `/api/v1/aviation/navaids` | Navigation aids |
| GET | `/api/v1/aviation/airspaces` | G-AIRMET advisories |
| GET | `/api/v1/aviation/airspace-boundaries` | Static airspace boundaries |

### ACARS/VDL2

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/acars/messages` | Query ACARS/VDL2 messages |
| GET | `/api/v1/acars/stats` | Message statistics |
| GET | `/api/v1/acars/status` | Receiver service status |
| GET | `/api/v1/acars/labels` | ACARS label reference |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/notifications/config` | Get configuration |
| PUT | `/api/v1/notifications/config` | Update configuration |
| POST | `/api/v1/notifications/test` | Send test notification |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/status` | System status |
| GET | `/api/v1/info` | API information |

## Real-Time Streaming

### Socket.IO (Recommended)

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  path: '/socket.io',
  query: { topics: 'aircraft,safety,alerts' },
  transports: ['websocket', 'polling']
});

socket.on('aircraft:update', (data) => {
  console.log('Aircraft update:', data);
});

socket.on('safety:event', (event) => {
  console.log('Safety event:', event);
});

socket.on('alert:triggered', (alert) => {
  console.log('Alert triggered:', alert);
});
```

**Available Topics:** `aircraft`, `airspace`, `safety`, `alerts`, `acars`, `all`

**Event Types:**
- `aircraft:snapshot` - Full aircraft state
- `aircraft:update` - Position/state updates
- `aircraft:new` - New aircraft detected
- `aircraft:remove` - Aircraft left coverage
- `aircraft:heartbeat` - Connection keepalive
- `safety:event` - Safety monitoring events
- `alert:triggered` - Alert rule matches
- `acars:message` - ACARS/VDL2 messages
- `airspace:advisory` - Airspace advisories

See [WEBSOCKET_API.md](WEBSOCKET_API.md) for detailed Socket.IO documentation.

### Server-Sent Events (Legacy)

```javascript
const eventSource = new EventSource('/api/v1/map/sse');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Update:', data);
};
```

## Configuration

### Environment Variables

```bash
# ADS-B Sources
ULTRAFEEDER_HOST=ultrafeeder
ULTRAFEEDER_PORT=80
DUMP978_HOST=dump978
DUMP978_PORT=80

# Database
DATABASE_URL=postgresql://user:pass@postgres:5432/adsb

# Feeder Location (for distance calculations)
FEEDER_LAT=47.9377
FEEDER_LON=-121.9687

# Polling & Storage
POLLING_INTERVAL=2        # Seconds between aircraft updates
DB_STORE_INTERVAL=10      # Seconds between database writes

# Caching
CACHE_TTL=5               # Response cache TTL in seconds

# Redis (optional)
REDIS_URL=redis://localhost:6379
REDIS_ENABLED=true

# Notifications (Apprise URLs)
APPRISE_URLS="pushover://key@token;telegram://token/chatid"
NOTIFICATION_COOLDOWN=300

# Safety Monitoring
SAFETY_MONITORING_ENABLED=true
SAFETY_VS_CHANGE_THRESHOLD=3000      # ft/min
SAFETY_VS_EXTREME_THRESHOLD=4500     # ft/min
SAFETY_PROXIMITY_NM=1.0              # nautical miles
SAFETY_ALTITUDE_DIFF_FT=1000         # feet

# ACARS
ACARS_ENABLED=true
ACARS_PORT=5555
VDLM2_PORT=5556

# Aircraft Info Cache
PHOTO_CACHE_ENABLED=true
PHOTO_CACHE_DIR=/data/photos

# OpenSky Database
OPENSKY_DB_ENABLED=true
OPENSKY_DB_PATH=/data/opensky/aircraft-database.csv

# Server
PORT=5000
```

## Alert Rules

Create custom alerts with flexible conditions:

```json
{
  "name": "Military Aircraft Alert",
  "description": "Alert when military aircraft detected",
  "enabled": true,
  "priority": "warning",
  "conditions": {
    "type": "simple",
    "field": "military",
    "operator": "eq",
    "value": true
  }
}
```

**Complex rules with AND/OR logic:**

```json
{
  "name": "Low Flying Fast Aircraft",
  "conditions": {
    "type": "group",
    "logic": "and",
    "conditions": [
      { "type": "simple", "field": "altitude", "operator": "lt", "value": 5000 },
      { "type": "simple", "field": "speed", "operator": "gt", "value": 300 }
    ]
  }
}
```

**Condition Fields:** `icao`, `callsign`, `squawk`, `altitude`, `distance`, `type`, `military`

**Operators:** `eq`, `ne`, `lt`, `gt`, `le`, `ge`, `contains`, `startswith`

## Project Structure

```
adsb-api/
├── app/
│   ├── main.py              # FastAPI app entry point
│   ├── models.py            # SQLAlchemy ORM models
│   ├── schemas.py           # Pydantic request/response models
│   ├── core/
│   │   ├── config.py        # Settings (environment variables)
│   │   ├── database.py      # Database setup
│   │   ├── cache.py         # Response caching
│   │   └── utils.py         # Helper functions
│   ├── routers/
│   │   ├── aircraft.py      # Aircraft tracking endpoints
│   │   ├── airframe.py      # Aircraft info endpoints
│   │   ├── map.py           # GeoJSON and SSE endpoints
│   │   ├── history.py       # Historical data endpoints
│   │   ├── alerts.py        # Alert rule endpoints
│   │   ├── safety.py        # Safety event endpoints
│   │   ├── aviation.py      # Weather/airspace endpoints
│   │   ├── acars.py         # ACARS message endpoints
│   │   ├── notifications.py # Notification endpoints
│   │   └── system.py        # Health/status endpoints
│   └── services/
│       ├── aircraft_info.py     # Aircraft data lookup
│       ├── safety.py            # Safety event detection
│       ├── alerts.py            # Alert rule checking
│       ├── notifications.py     # Push notifications
│       ├── acars.py             # ACARS receiver
│       ├── sse.py               # SSE manager
│       ├── socketio_manager.py  # Socket.IO implementation
│       └── airspace.py          # Airspace data
├── tests/
├── pyproject.toml
├── requirements.txt
└── Dockerfile
```

## Data Sources

- **Aircraft Positions**: Ultrafeeder (readsb/dump1090) via JSON API
- **UAT Positions**: dump978 for 978MHz reception
- **Aircraft Info**: hexdb.io, OpenSky Network, Planespotters.net
- **Aviation Weather**: Aviation Weather Center (aviationweather.gov)
- **ACARS/VDL2**: dumpvdl2, acarsdec receivers

## License

MIT
