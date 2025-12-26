# ADS-B Metrics API v2.6.0

FastAPI-based aircraft tracking API with PostgreSQL storage, alert rules, safety monitoring, ACARS messages, and push notifications.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export DATABASE_URL="postgresql://user:pass@localhost/adsb"
export ULTRAFEEDER_HOST="localhost"
export ULTRAFEEDER_PORT="8080"
export FEEDER_LAT="47.7511"
export FEEDER_LON="-122.2055"

# Run development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 5000
```

## Project Structure

```
app/
├── core/
│   ├── config.py      # Pydantic Settings
│   ├── database.py    # AsyncPG + SQLAlchemy
│   ├── cache.py       # Caching decorator
│   └── utils.py       # Helper functions
├── services/
│   ├── sse.py         # SSE with Redis pub/sub
│   ├── notifications.py
│   ├── safety.py      # TCAS/safety monitoring
│   ├── alerts.py      # Alert rule evaluation
│   ├── aircraft_info.py  # Airframe data & photos
│   ├── photo_cache.py # Local photo caching
│   ├── opensky_db.py  # OpenSky offline database
│   └── acars.py       # ACARS/VDL2 message handling
├── routers/
│   ├── aircraft.py    # Live aircraft endpoints
│   ├── airframe.py    # Aircraft info & photos
│   ├── map.py         # GeoJSON + SSE streaming
│   ├── history.py     # Historical queries
│   ├── alerts.py      # Alert CRUD
│   ├── safety.py      # Safety events
│   ├── notifications.py
│   ├── aviation.py    # Weather, airports, airspace
│   ├── acars.py       # ACARS messages
│   └── system.py      # Health/status
├── models.py          # SQLAlchemy ORM
├── schemas.py         # Pydantic schemas
└── main.py            # FastAPI app
scripts/
└── download-opensky-db.sh  # Download OpenSky database
```

## API Endpoints

| Group | Endpoints |
|-------|-----------|
| Live | `/api/v1/aircraft`, `/api/v1/aircraft/top`, `/api/v1/aircraft/stats` |
| Airframe | `/api/v1/aircraft/{icao}/info`, `/api/v1/aircraft/{icao}/photo` |
| Map | `/api/v1/map/geojson`, `/api/v1/map/sse` |
| History | `/api/v1/history/sightings`, `/api/v1/history/sessions` |
| Alerts | `/api/v1/alerts/rules`, `/api/v1/alerts/history` |
| Safety | `/api/v1/safety/events`, `/api/v1/safety/stats` |
| Notifications | `/api/v1/notifications/config`, `/api/v1/notifications/test` |
| Aviation | `/api/v1/aviation/metars`, `/api/v1/aviation/airports`, `/api/v1/aviation/pireps` |
| ACARS | `/api/v1/acars/messages`, `/api/v1/acars/stats`, `/api/v1/acars/status` |
| System | `/api/v1/health`, `/api/v1/status` |

Interactive docs at `/docs` (Swagger UI) and `/redoc`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `ULTRAFEEDER_HOST` | `ultrafeeder` | tar1090 hostname |
| `ULTRAFEEDER_PORT` | `80` | tar1090 port |
| `FEEDER_LAT` | `0.0` | Feeder latitude |
| `FEEDER_LON` | `0.0` | Feeder longitude |
| `POLLING_INTERVAL` | `2` | Aircraft fetch interval (seconds) |
| `DB_STORE_INTERVAL` | `10` | Database write interval (seconds) |
| `REDIS_URL` | `None` | Redis URL for multi-worker SSE |
| `APPRISE_URLS` | `""` | Apprise notification URLs |
| `SAFETY_MONITORING_ENABLED` | `true` | Enable safety event detection |
| `ACARS_ENABLED` | `true` | Enable ACARS message reception |
| `ACARS_PORT` | `5555` | UDP port for ACARS messages |
| `VDLM2_PORT` | `5556` | UDP port for VDL2 messages |
| `PHOTO_CACHE_ENABLED` | `true` | Enable photo caching |
| `PHOTO_CACHE_DIR` | `/data/photos` | Local photo cache directory |
| `PHOTO_AUTO_DOWNLOAD` | `true` | Auto-download photos for new aircraft |
| `S3_ENABLED` | `false` | Use S3 for photo storage |
| `S3_BUCKET` | `""` | S3 bucket name |
| `S3_REGION` | `us-east-1` | S3 region |
| `S3_ACCESS_KEY` | `None` | S3 access key (or use IAM) |
| `S3_SECRET_KEY` | `None` | S3 secret key |
| `S3_ENDPOINT_URL` | `None` | Custom S3 endpoint (MinIO, Wasabi) |
| `S3_PREFIX` | `aircraft-photos` | S3 key prefix |
| `S3_PUBLIC_URL` | `None` | Public URL base for CDN |
| `OPENSKY_DB_ENABLED` | `true` | Enable local OpenSky database |
| `OPENSKY_DB_PATH` | `/data/opensky/aircraft-database.csv` | Path to OpenSky CSV |

## ACARS/VDL2 Configuration

The API receives ACARS and VDL2 messages via UDP from `acars_router` (acarshub).

### Option 1: Using docker-acarshub

```yaml
# docker-compose.yml
acars_router:
  image: ghcr.io/sdr-enthusiasts/docker-acarshub:latest
  environment:
    - FEED_ID=my-station
    - TZ=America/Los_Angeles
    # Enable decoders
    - ENABLE_ACARS=true
    - ENABLE_VDLM2=true
    # SDR device serials (find with rtl_test)
    - ACARS_SDR_SERIAL=00000001
    - VDLM2_SDR_SERIAL=00000002
    # Frequencies
    - ACARS_FREQS=130.025;130.450;131.125;131.550
    - VDLM2_FREQS=136.650;136.800;136.975
    # Send to our API
    - AR_SEND_UDP_ACARS=adsb-api:5555
    - AR_SEND_UDP_VDLM2=adsb-api:5556
  devices:
    - /dev/bus/usb:/dev/bus/usb
```

### Option 2: Standalone acarsdec/vdlm2dec

```bash
# ACARS decoder
acarsdec -v -o 4 -j adsb-api:5555 -r 0 130.025 130.450 131.125 131.550

# VDL2 decoder
vdlm2dec -v -J -j adsb-api:5556 -r 1 136.650 136.800 136.975
```

### Common ACARS Frequencies

**VHF ACARS (acarsdec):**
- North America: 130.025, 130.450, 131.125, 131.550
- Europe: 131.525, 131.725, 131.825

**VDL2 (vdlm2dec):**
- Worldwide: 136.650, 136.800, 136.975

### SSE Events

ACARS messages are broadcast via SSE:
```javascript
const sse = new EventSource('/api/v1/map/sse');
sse.addEventListener('acars_message', (e) => {
  const msg = JSON.parse(e.data);
  console.log(`${msg.callsign}: ${msg.text}`);
});
```

## Aircraft Info & Photos

The API fetches aircraft information from open sources and caches it in the database:

- **Local OpenSky Database** - Offline aircraft metadata (fastest)
- **hexdb.io** - Aircraft registration, type, operator
- **OpenSky Network API** - Aircraft metadata
- **Planespotters.net** - Aircraft photos

### OpenSky Database (Offline Lookup)

For fastest lookups and offline operation, download the OpenSky aircraft database:

```bash
# Download the database (~500MB)
./scripts/download-opensky-db.sh

# Or manually:
curl -L -o /data/opensky/aircraft-database.csv \
  "https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2025-08.csv"
```

The database contains ~600,000 aircraft and is checked first before any external API calls.

### Photo Caching

Photos are automatically downloaded and cached when new aircraft are seen.
Supports local filesystem (default) or S3-compatible storage.

**Local Storage (default):**
```bash
PHOTO_CACHE_ENABLED=true
PHOTO_CACHE_DIR=/data/photos
PHOTO_AUTO_DOWNLOAD=true
```

Photos stored as:
```
/data/photos/A12345.jpg       # Full-size
/data/photos/A12345_thumb.jpg # Thumbnail
```

**S3/MinIO/Wasabi Storage:**
```bash
# Enable S3
S3_ENABLED=true
S3_BUCKET=my-aircraft-photos
S3_REGION=us-east-1

# Credentials (or use IAM role)
S3_ACCESS_KEY=AKIAXXXXXXXX
S3_SECRET_KEY=xxxxxxxx

# Optional: Key prefix
S3_PREFIX=aircraft-photos

# Optional: Custom endpoint for MinIO, Wasabi, etc.
S3_ENDPOINT_URL=https://minio.local:9000

# Optional: Public URL base for CDN
S3_PUBLIC_URL=https://cdn.example.com/aircraft-photos
```

S3 keys:
```
s3://my-bucket/aircraft-photos/A12345.jpg
s3://my-bucket/aircraft-photos/A12345_thumb.jpg
```

**Comparison:**

| Feature | Local | S3 |
|---------|-------|-----|
| Setup | Simple | Requires bucket |
| Scaling | Single server | Multi-server |
| Cost | Disk only | Per-request + storage |
| CDN | Manual | Native |
| Backup | Manual | Built-in |

Environment variables:
```bash
PHOTO_CACHE_ENABLED=true
PHOTO_CACHE_DIR=/data/photos
PHOTO_AUTO_DOWNLOAD=true
OPENSKY_DB_ENABLED=true
OPENSKY_DB_PATH=/data/opensky/aircraft-database.csv
```

### Endpoints

```bash
# Get aircraft info (uses local DB first, then external APIs)
curl http://localhost:5000/api/v1/aircraft/A12345/info

# Get photo URLs
curl http://localhost:5000/api/v1/aircraft/A12345/photo

# Download photo (serves from local cache if available)
curl http://localhost:5000/api/v1/aircraft/A12345/photo/download -o photo.jpg

# Get thumbnail
curl "http://localhost:5000/api/v1/aircraft/A12345/photo/download?thumbnail=true"

# Direct local database lookup
curl http://localhost:5000/api/v1/opensky/lookup/A12345

# Check database stats
curl http://localhost:5000/api/v1/opensky/stats

# Check photo cache stats
curl http://localhost:5000/api/v1/photos/cache

# Bulk lookup (cached only)
curl -X POST http://localhost:5000/api/v1/aircraft/info/bulk \
  -H "Content-Type: application/json" \
  -d '["A12345", "A67890"]'
```

## Production Deployment

```bash
# Single worker
uvicorn app.main:app --host 0.0.0.0 --port 5000

# Multi-worker with Redis
export REDIS_URL="redis://localhost:6379"
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:5000
```

## Key Features

- **Async/Await**: Full async support with asyncpg
- **SSE Streaming**: Real-time aircraft and ACARS updates
- **Alert Rules**: Complex AND/OR conditions with scheduling
- **Safety Monitoring**: TCAS RA detection, extreme VS alerts, proximity conflicts
- **Aircraft Info**: Airframe data, photos, age from open sources
- **Offline Database**: Local OpenSky database for fast lookups (~600k aircraft)
- **Photo Caching**: Automatic local caching of aircraft photos
- **ACARS/VDL2**: Receive and display aircraft data link messages
- **Aviation Weather**: METARs, TAFs, PIREPs, airports, navaids
- **Push Notifications**: Via Apprise (Pushover, Telegram, Discord, etc.)
- **Historical Data**: PostgreSQL-backed sightings and session tracking
