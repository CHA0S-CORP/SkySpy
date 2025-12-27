<p align="center">
  <img src="docs/logo.png" alt="SkySpy Logo" width="200">
</p>

<h1 align="center">SkySpy</h1>

<p align="center">
  Real-time ADS-B aircraft tracking and monitoring system with a web-based dashboard.
</p>

![SkySpy Demo](docs/screenshots/map-view.gif)

## Overview

SkySpy is a sophisticated aircraft tracking platform that captures position data from 1090MHz Mode S and 978MHz UAT receivers, displays aircraft on an interactive map, monitors safety conditions, and provides advanced features like custom alerts, weather integration, and push notifications.

### Key Features

- **Real-Time Aircraft Tracking** - Live position updates from ADS-B receivers with distance, altitude, speed, and climb rate
- **Interactive Map Dashboard** - Canvas-based radar display with aircraft icons, flight paths, and detailed information panels
- **Safety Monitoring** - TCAS RA/TA detection, proximity alerts, extreme vertical speed warnings, and emergency squawk detection (7700/7600/7500)
- **Custom Alert Rules** - Flexible AND/OR logic conditions on ICAO, callsign, squawk, altitude, distance, aircraft type, and military status
- **Historical Data** - PostgreSQL-backed sighting history with session tracking and analytics
- **Aviation Weather** - METARs, TAFs, PIREPs, SIGMETs, and G-AIRMET integration
- **Push Notifications** - Apprise integration supporting 80+ services (Pushover, Telegram, Slack, Discord, email, etc.)
- **Aircraft Information** - Registration lookups, photos, airframe data, and operator information
- **ACARS/VDL2 Messages** - Aircraft communication message reception and display

## Screenshots

### Live Map View

Real-time aircraft tracking with position updates, flight labels, range rings, and interactive markers.

![Aircraft Detail](docs/screenshots/aircraft-detail.gif)

### Aircraft Detail Panel

Click any aircraft to view detailed information including registration, operator, altitude, speed, and external links.

![Aircraft Detail](docs/screenshots/detail.png)
![Aircraft Detail](docs/screenshots/airplane1.png)
![Aircraft Detail](docs/screenshots/airplane2.png)
![Aircraft Detail](docs/screenshots/airplane3.png)

### Safety Alerts & Proximity Warnings

Automatic detection and alerting for emergency squawks (7700/7600/7500) and proximity events.

![Safety Banner](docs/screenshots/safety1.png)
![Safety Banner2](docs/screenshots/saftey2.png)

### CRT Radar Mode

Classic ATC radar display with sweep animation and phosphor glow effects.

![CRT Mode](docs/screenshots/crt-mode.gif)

### PIREP Weather Reports

View pilot reports (PIREPs) for real-time weather conditions including turbulence, icing, and visibility.

![PIREP Popup](docs/screenshots/pirep.png)

### NavAid Information

Interactive navigation aid markers showing VORs, NDBs, and waypoints with frequency and identifier information.

![NavAid Popup](docs/screenshots/nav.png)

### Statistics Dashboard

Real-time statistics showing aircraft counts, altitude distribution, closest/highest/fastest aircraft.

![Stats View](docs/screenshots/stats.png)

### Flight History

Browse historical sightings with filters and detailed flight session information.

![History View](docs/screenshots/history.png)
![History View](docs/screenshots/history2.png)

### Alert Configuration

Create custom alert rules with flexible conditions and scheduling.

![Alerts View](docs/screenshots/alerts-view.gif)

### Settings

Configure API endpoints, map display modes, and themes.

![Settings](docs/screenshots/settings.gif)

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Ultrafeeder   │     │    dump978      │     │   ACARS Hub     │
│  (1090MHz ADS-B)│     │  (978MHz UAT)   │     │  (VDL2/ACARS)   │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │      SkySpy API         │
                    │    (FastAPI/Python)     │
                    │                         │
                    │  • Aircraft tracking    │
                    │  • Safety monitoring    │
                    │  • Alert engine         │
                    │  • Weather integration  │
                    │  • Socket.IO streaming  │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼─────────┐ ┌──────▼──────┐ ┌────────▼────────┐
    │    PostgreSQL     │ │    Redis    │ │   Web Dashboard │
    │  (History/Alerts) │ │  (Pub/Sub)  │ │     (React)     │
    └───────────────────┘ └─────────────┘ └─────────────────┘
```

## Tech Stack

**Backend (adsb-api)**
- Python 3.12+
- FastAPI with async/await
- SQLAlchemy 2.0+ (async ORM)
- Socket.IO for real-time streaming
- PostgreSQL for data persistence
- Redis for pub/sub messaging
- Apprise for notifications

**Frontend (web)**
- React 18
- Vite 5
- Canvas-based radar rendering
- Socket.IO client
- Lucide icons

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Python 3.12+ (for local development)
- Node.js 20+ (for local development)
- ADS-B receiver (Ultrafeeder/readsb/dump1090)

### Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/your-org/skyspy.git
cd skyspy

# Copy environment template
cp .env.test.sample .env

# Edit .env with your configuration
# At minimum, set:
#   FEEDER_LAT=your_latitude
#   FEEDER_LON=your_longitude
#   ULTRAFEEDER_HOST=your_receiver_host

# Start all services
docker compose up -d

# Access the dashboard at http://localhost:3000
# API available at http://localhost:5000
```

### Development Environment

```bash
# Start development environment with mock data
make dev

# Services:
#   Dashboard: http://localhost:3000
#   API: http://localhost:5000
#   Mock Ultrafeeder: http://localhost:8080
#   Mock dump978: http://localhost:8081

# Stop services
make dev-down
```

### Local Development

```bash
# Backend
cd adsb-api
pip install -e ".[dev]"
uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload

# Frontend
cd web
npm install
npm run dev
```

## Configuration

### Required Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/adsb

# ADS-B Receiver
ULTRAFEEDER_HOST=ultrafeeder    # readsb/dump1090 host
ULTRAFEEDER_PORT=80

# Feeder Location (for distance calculations)
FEEDER_LAT=47.9377
FEEDER_LON=-121.9687
```

### Optional Configuration

```bash
# UAT 978MHz Receiver
DUMP978_HOST=dump978
DUMP978_PORT=80

# Redis (for multi-worker deployments)
REDIS_URL=redis://localhost:6379

# Polling intervals
POLLING_INTERVAL=2              # seconds between aircraft polls
DB_STORE_INTERVAL=10            # seconds between DB writes

# Safety Monitoring
SAFETY_MONITORING_ENABLED=true
SAFETY_PROXIMITY_NM=1.0         # proximity alert distance (nm)
SAFETY_ALTITUDE_DIFF_FT=1000    # vertical separation threshold

# Push Notifications (Apprise URLs)
APPRISE_URLS=pushover://key@token;telegram://token/chatid
NOTIFICATION_COOLDOWN=300       # seconds between notifications

# ACARS/VDL2
ACARS_ENABLED=true
ACARS_PORT=5555

# Photo Caching
PHOTO_CACHE_ENABLED=true
PHOTO_CACHE_DIR=/data/photos

# S3 Storage (optional)
S3_ENABLED=false
S3_BUCKET=skyspy
S3_ENDPOINT_URL=https://s3.amazonaws.com
```

## API Reference

### Aircraft Data

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/aircraft` | All tracked aircraft |
| `GET /api/v1/aircraft/{hex}` | Single aircraft by ICAO hex |
| `GET /api/v1/aircraft/{hex}/info` | Registration and airframe data |
| `GET /api/v1/aircraft/{hex}/photo` | Aircraft photo URLs |
| `GET /api/v1/aircraft/stats` | Aggregate statistics |
| `GET /api/v1/uat/aircraft` | UAT 978MHz aircraft |

### Real-Time Streaming

| Endpoint | Description |
|----------|-------------|
| `Socket.IO /` | WebSocket connection for real-time updates |
| `GET /api/v1/map/sse` | Server-Sent Events stream |
| `GET /api/v1/map/geojson` | GeoJSON feature collection |

**Socket.IO Topics:** `aircraft`, `safety`, `alerts`, `acars`, `airspace`, `all`

### Historical Data

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/history/sightings` | Query sightings with filters |
| `GET /api/v1/history/sessions` | Tracking sessions |

### Alerts

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/alerts/rules` | List alert rules |
| `POST /api/v1/alerts/rules` | Create alert rule |
| `PUT /api/v1/alerts/rules/{id}` | Update alert rule |
| `DELETE /api/v1/alerts/rules/{id}` | Delete alert rule |

### Aviation Data

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/aviation/metars` | Weather observations |
| `GET /api/v1/aviation/pireps` | Pilot reports |
| `GET /api/v1/aviation/sigmets` | Hazardous weather |
| `GET /api/v1/aviation/airspaces` | Active airspace advisories |

### System

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/health` | Health check |
| `GET /api/v1/status` | System status |
| `GET /api/v1/info` | API information |

## Alert Rules

Create custom alerts using flexible condition logic:

```json
{
  "name": "Military Aircraft Alert",
  "enabled": true,
  "priority": "high",
  "conditions": {
    "operator": "AND",
    "conditions": [
      { "field": "military", "operator": "eq", "value": true },
      { "field": "distance", "operator": "lt", "value": 50 }
    ]
  },
  "notification_enabled": true
}
```

**Available Fields:** `icao`, `callsign`, `squawk`, `altitude`, `distance`, `type`, `military`, `registration`

**Operators:** `eq`, `ne`, `lt`, `gt`, `le`, `ge`, `contains`, `startswith`

## Safety Monitoring

SkySpy automatically monitors for safety-related events:

- **TCAS Alerts** - Resolution Advisory (RA) and Traffic Advisory (TA) detection
- **Proximity Warnings** - Aircraft within configurable distance threshold
- **Extreme Vertical Rates** - Climb/descent exceeding 4500 ft/min
- **Emergency Squawks** - 7700 (emergency), 7600 (comm failure), 7500 (hijack)

Safety events are logged, displayed on the dashboard, and can trigger push notifications.

## Testing

```bash
# Run tests in Docker
make test

# Run backend tests locally
cd adsb-api
pytest

# Run with coverage
pytest --cov=app --cov-report=html
```

## Project Structure

```
skyspy/
├── adsb-api/                 # Backend API
│   ├── app/
│   │   ├── main.py           # FastAPI application
│   │   ├── models.py         # SQLAlchemy models
│   │   ├── schemas.py        # Pydantic schemas
│   │   ├── routers/          # API endpoints
│   │   └── services/         # Business logic
│   ├── tests/                # Test suite
│   └── pyproject.toml        # Python dependencies
│
├── web/                      # Frontend dashboard
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── hooks/            # Custom hooks
│   │   └── utils/            # Utilities
│   └── package.json          # Node dependencies
│
├── test/                     # Test infrastructure
│   ├── mock-1090/            # Mock ADS-B receiver
│   └── acars-mock/           # Mock ACARS hub
│
├── docker-compose.yaml       # Production compose
├── docker-compose.test.yaml  # Test/dev compose
├── Makefile                  # Build commands
└── README.md
```

## Data Sources

- **Aircraft Positions:** Ultrafeeder (readsb/dump1090) JSON API
- **UAT Positions:** dump978 for 978MHz reception
- **Aircraft Info:** hexdb.io, OpenSky Network, Planespotters.net
- **Aviation Weather:** Aviation Weather Center (aviationweather.gov)
- **ACARS/VDL2:** dumpvdl2, acarsdec receivers

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`make test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Ultrafeeder](https://github.com/sdr-enthusiasts/docker-adsb-ultrafeeder) for ADS-B reception
- [OpenSky Network](https://opensky-network.org/) for aircraft database
- [Aviation Weather Center](https://aviationweather.gov/) for weather data
