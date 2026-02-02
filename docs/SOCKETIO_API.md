# SkysPy Socket.IO API Reference

This document provides comprehensive documentation for the Socket.IO real-time API, including all namespaces, events, JSON structures, and authentication.

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Main Namespace (/)](#main-namespace-)
4. [Audio Namespace (/audio)](#audio-namespace-audio)
5. [Cannonball Namespace (/cannonball)](#cannonball-namespace-cannonball)
6. [Server Broadcasts](#server-broadcasts)
7. [Rooms and Topics](#rooms-and-topics)
8. [Error Handling](#error-handling)

---

## Overview

SkysPy uses Socket.IO for real-time bidirectional communication. The system supports:

- **Three namespaces**: `/` (main), `/audio`, `/cannonball`
- **Redis pub/sub** for multi-process support
- **JWT and API key** authentication
- **Role-based permissions** for topic subscriptions
- **Request/response pattern** for on-demand data queries

### Connection URL

```
wss://your-skyspy-instance/socket.io/
```

### Quick Start

```javascript
import { io } from 'socket.io-client';

const socket = io('https://skyspy.example.com', {
  auth: { token: 'your-jwt-token' }
});

socket.on('connect', () => {
  socket.emit('subscribe', { topics: ['aircraft', 'safety'] });
});

socket.on('aircraft:update', (data) => {
  console.log('Aircraft update:', data);
});
```

---

## Authentication

### Authentication Modes

| Mode | Description | Token Required |
|------|-------------|----------------|
| `public` | All access allowed | No |
| `hybrid` | Anonymous allowed unless `WS_REJECT_INVALID_TOKENS=true` | Optional |
| `private` | Authentication required | Yes |

### JWT Authentication

```javascript
const socket = io('https://skyspy.example.com', {
  auth: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }
});
```

### API Key Authentication

```javascript
const socket = io('https://skyspy.example.com', {
  auth: {
    token: 'sk_abcdef123456789...'  // Prefix sk_ identifies API keys
  }
});
```

### Session Structure

After connection, the server maintains session data:

```json
{
  "user": "<User object or AnonymousUser>",
  "subscribed_topics": ["aircraft", "safety"],
  "client_filters": {},
  "rate_limiter": "<RateLimiter instance>",
  "connected_at": "2026-02-01T10:30:00Z"
}
```

---

## Main Namespace (/)

The default namespace handles aircraft tracking, aviation data, alerts, and system status.

### Subscription Topics

| Topic | Permission | Description |
|-------|------------|-------------|
| `aircraft` | `aircraft.view` | Real-time aircraft positions |
| `safety` | `safety.view` | Safety alerts and events |
| `stats` | `stats.view` | Statistics updates |
| `alerts` | `alerts.view` | Custom alert notifications |
| `acars` | `acars.view` | ACARS messages |
| `airspace` | `airspace.view` | Airspace boundaries |
| `notams` | `notams.view` | NOTAMs and TFRs |

### Client Events

#### `subscribe` - Subscribe to topics

```json
// Request
{
  "topics": ["aircraft", "safety", "stats"]
}

// Or subscribe to all
{
  "topics": "all"
}
```

**Response:** `subscribed` event
```json
{
  "topics": ["aircraft", "safety", "stats"],
  "joined": ["aircraft", "safety", "stats"],
  "denied": []
}
```

#### `unsubscribe` - Unsubscribe from topics

```json
// Request
{
  "topics": ["safety"]
}
```

**Response:** `unsubscribed` event
```json
{
  "topics": ["safety"],
  "remaining": ["aircraft", "stats"]
}
```

#### `ping` - Keepalive

```json
// Request
{}

// Response: pong event
{
  "timestamp": "2026-02-01T12:34:56Z"
}
```

#### `request` - Request/Response Pattern

All data queries use a unified request pattern:

```json
// Request
{
  "type": "aircraft-snapshot",
  "request_id": "unique-id-123",
  "params": {}
}

// Success Response: response event
{
  "request_id": "unique-id-123",
  "request_type": "aircraft-snapshot",
  "data": { ... }
}

// Error Response: error event
{
  "request_id": "unique-id-123",
  "message": "Error description"
}
```

### Request Types

#### Aircraft Requests

**`aircraft`** - Single aircraft by ICAO
```json
{
  "type": "aircraft",
  "request_id": "req-001",
  "params": { "icao": "A1B2C3" }
}
```

Response:
```json
{
  "hex": "A1B2C3",
  "callsign": "UAL456",
  "lat": 39.8,
  "lon": -104.7,
  "alt_baro": 35000,
  "gs": 450,
  "track": 180,
  "vr": 1200,
  "distance_nm": 15.2,
  "rssi": -25.5,
  "military": false,
  "emergency": false
}
```

**`aircraft-snapshot`** - Current aircraft snapshot
```json
{
  "type": "aircraft-snapshot",
  "request_id": "req-002",
  "params": {}
}
```

Response:
```json
{
  "aircraft": [
    {
      "hex": "A1B2C3",
      "callsign": "UAL456",
      "lat": 39.8,
      "lon": -104.7,
      "alt_baro": 35000,
      "alt": 35000,
      "gs": 450,
      "track": 180,
      "vr": 1200,
      "distance_nm": 15.2,
      "military": false,
      "emergency": false
    }
  ],
  "count": 42,
  "timestamp": "2026-02-01T12:34:56Z"
}
```

**`aircraft-list`** - Filtered aircraft list
```json
{
  "type": "aircraft-list",
  "request_id": "req-003",
  "params": {
    "military_only": false,
    "category": "A3",
    "min_altitude": 5000,
    "max_altitude": 35000
  }
}
```

**`aircraft-info`** - Detailed aircraft information
```json
{
  "type": "aircraft-info",
  "request_id": "req-004",
  "params": { "icao": "A1B2C3" }
}
```

Response:
```json
{
  "icao_hex": "A1B2C3",
  "registration": "N123UA",
  "type_code": "B789",
  "manufacturer": "Boeing",
  "model": "787-9 Dreamliner",
  "operator": "United Airlines",
  "operator_icao": "UAL",
  "owner": "United Airlines Inc",
  "year_built": 2015,
  "serial_number": "35935",
  "country": "US",
  "category": "L",
  "is_military": false,
  "photo_url": "https://...",
  "photo_photographer": "John Doe",
  "source": "airframes.org"
}
```

**`aircraft-info-bulk`** - Multiple aircraft info (max 100)
```json
{
  "type": "aircraft-info-bulk",
  "request_id": "req-005",
  "params": {
    "icaos": ["A1B2C3", "D4E5F6", "G7H8I9"]
  }
}
```

Response:
```json
{
  "aircraft": {
    "A1B2C3": { "icao_hex": "A1B2C3", "registration": "N123UA", ... },
    "D4E5F6": { "icao_hex": "D4E5F6", "registration": "N456AA", ... }
  },
  "found": 2,
  "requested": 3
}
```

**`aircraft-stats`** - Live aircraft statistics
```json
{
  "type": "aircraft-stats",
  "request_id": "req-006",
  "params": {}
}
```

Response:
```json
{
  "total": 42,
  "with_position": 40,
  "military": 3,
  "emergency": 0,
  "categories": { "A3": 25, "A5": 10, "B2": 7 },
  "altitude_bands": {
    "ground": 2,
    "low": 10,
    "medium": 15,
    "high": 15
  },
  "timestamp": "2026-02-01T12:34:56Z"
}
```

#### History Requests

**`sightings`** - Historical aircraft sightings
```json
{
  "type": "sightings",
  "request_id": "req-010",
  "params": {
    "hours": 24,
    "limit": 100,
    "offset": 0,
    "icao_hex": "A1B2C3",
    "callsign": "UAL456"
  }
}
```

Response:
```json
{
  "sightings": [
    {
      "id": 123,
      "timestamp": "2026-02-01T12:00:00Z",
      "icao_hex": "A1B2C3",
      "callsign": "UAL456",
      "lat": 39.8,
      "lon": -104.7,
      "altitude": 25000,
      "gs": 450,
      "track": 180,
      "vr": 0,
      "distance_nm": 15.2,
      "rssi": -25.5,
      "is_military": false
    }
  ],
  "count": 1,
  "hours": 24,
  "offset": 0,
  "limit": 100
}
```

**`history-stats`** - History statistics
```json
{
  "type": "history-stats",
  "request_id": "req-011",
  "params": { "hours": 24, "military_only": false }
}
```

**`history-trends`** - Traffic trends
```json
{
  "type": "history-trends",
  "request_id": "req-012",
  "params": { "hours": 24 }
}
```

Response:
```json
{
  "hourly": [
    { "hour": "2026-02-01T00:00:00Z", "count": 150, "unique_aircraft": 25 },
    { "hour": "2026-02-01T01:00:00Z", "count": 120, "unique_aircraft": 22 }
  ],
  "hours": 24,
  "timestamp": "2026-02-01T12:34:56Z"
}
```

#### Safety Requests

**`safety-events`** - Recent safety events
```json
{
  "type": "safety-events",
  "request_id": "req-020",
  "params": { "hours": 24, "limit": 50 }
}
```

Response:
```json
[
  {
    "id": "123",
    "event_type": "emergency_squawk",
    "severity": "critical",
    "icao_hex": "A1B2C3",
    "callsign": "UAL456",
    "timestamp": "2026-02-01T12:00:00Z",
    "description": "Emergency squawk 7700 detected",
    "acknowledged": false
  }
]
```

**`safety-acknowledge`** - Acknowledge safety event
```json
{
  "type": "safety-acknowledge",
  "request_id": "req-021",
  "params": { "id": "123" }
}
```

#### Aviation Data Requests

**`airports`** - Nearby airports
```json
{
  "type": "airports",
  "request_id": "req-030",
  "params": { "lat": 39.8, "lon": -104.7, "radius": 50, "limit": 20 }
}
```

Response:
```json
[
  {
    "icao": "KDEN",
    "name": "Denver International Airport",
    "lat": 39.85,
    "lon": -104.67,
    "elev": 5430,
    "type": "large_airport"
  }
]
```

**`airspace-boundaries`** - Airspace boundaries
```json
{
  "type": "airspace-boundaries",
  "request_id": "req-031",
  "params": { "lat": 39.8, "lon": -104.7, "radius": 100 }
}
```

**`airspaces`** - Airspace advisories (G-AIRMETs, SIGMETs)
```json
{
  "type": "airspaces",
  "request_id": "req-032",
  "params": { "hazard": "CONVECTIVE" }
}
```

**`pireps`** - Pilot reports
```json
{
  "type": "pireps",
  "request_id": "req-033",
  "params": { "lat": 39.8, "lon": -104.7, "radius": 500, "hours": 6 }
}
```

**`metar`** - Single METAR
```json
{
  "type": "metar",
  "request_id": "req-034",
  "params": { "station": "KDEN" }
}
```

**`taf`** - Single TAF
```json
{
  "type": "taf",
  "request_id": "req-035",
  "params": { "station": "KDEN" }
}
```

#### System Requests

**`status`** - System status
```json
{
  "type": "status",
  "request_id": "req-040",
  "params": {}
}
```

Response:
```json
{
  "online": true,
  "aircraft_count": 42,
  "celery_running": true,
  "timestamp": "2026-02-01T12:34:56Z"
}
```

**`system-info`** - System information
```json
{
  "type": "system-info",
  "request_id": "req-041",
  "params": {}
}
```

Response:
```json
{
  "version": "1.0.0",
  "python_version": "3.11.0",
  "platform": "Linux-5.15.0",
  "django_version": "4.2.0",
  "debug": false,
  "feeder": { "latitude": 39.8, "longitude": -104.7 },
  "features": {
    "acars_enabled": true,
    "safety_monitoring": true,
    "photo_cache": true,
    "s3_storage": false
  },
  "timestamp": "2026-02-01T12:34:56Z"
}
```

#### Alert Rule Requests

**`alert-rules`** - List all rules
```json
{
  "type": "alert-rules",
  "request_id": "req-050",
  "params": {}
}
```

Response:
```json
{
  "rules": [
    {
      "id": "123",
      "name": "Military Aircraft Alert",
      "description": "Alert on military aircraft entry",
      "enabled": true,
      "priority": "high",
      "conditions": { "is_military": true },
      "actions": [{ "type": "notify", "channels": ["456"] }],
      "cooldown_minutes": 5,
      "created_at": "2026-02-01T00:00:00Z"
    }
  ]
}
```

**`alert-rule-create`** - Create rule
```json
{
  "type": "alert-rule-create",
  "request_id": "req-051",
  "params": {
    "name": "Military Aircraft Alert",
    "description": "Alert on military aircraft entry",
    "enabled": true,
    "priority": "high",
    "conditions": { "is_military": true },
    "actions": [{ "type": "notify", "channels": ["456"] }],
    "cooldown_minutes": 5
  }
}
```

**`alert-rule-update`** - Update rule
```json
{
  "type": "alert-rule-update",
  "request_id": "req-052",
  "params": { "id": "123", "enabled": false }
}
```

**`alert-rule-delete`** - Delete rule
```json
{
  "type": "alert-rule-delete",
  "request_id": "req-053",
  "params": { "id": "123" }
}
```

#### Notification Channel Requests

**`notification-channels`** - List channels
```json
{
  "type": "notification-channels",
  "request_id": "req-060",
  "params": {}
}
```

**`notification-channel-create`** - Create channel
```json
{
  "type": "notification-channel-create",
  "request_id": "req-061",
  "params": {
    "name": "Email Alerts",
    "channel_type": "email",
    "enabled": true,
    "config": { "email": "alerts@example.com" }
  }
}
```

**`notification-channel-test`** - Test channel
```json
{
  "type": "notification-channel-test",
  "request_id": "req-062",
  "params": { "id": "123" }
}
```

---

## Audio Namespace (/audio)

Real-time audio transcription updates for radio communications.

### Connection

```javascript
const audioSocket = io('https://skyspy.example.com/audio', {
  auth: { token: 'your-jwt-token' }
});
```

### Rooms

| Room | Description |
|------|-------------|
| `audio_transmissions` | New audio transmissions |
| `audio_transcriptions` | Transcription state changes |
| `audio_all` | All audio events |

### Server Events

**`audio:snapshot`** - Sent on connect
```json
{
  "recent_transmissions": [
    {
      "id": 123,
      "created_at": "2026-02-01T10:30:45.123456",
      "filename": "transmission_20260201_103045.wav",
      "s3_url": "https://bucket.s3.amazonaws.com/audio/123.wav",
      "file_size_bytes": 512000,
      "duration_seconds": 15.5,
      "format": "wav",
      "frequency_mhz": 121.5,
      "channel_name": "Tower",
      "squelch_level": -40,
      "transcription_status": "completed",
      "transcription_queued_at": "2026-02-01T10:30:46",
      "transcription_completed_at": "2026-02-01T10:31:15",
      "transcript": "November 1 2 3 4 5 cleared for takeoff",
      "transcript_confidence": 0.95,
      "transcript_language": "en",
      "identified_airframes": ["N12345"]
    }
  ],
  "pending_transcriptions": 5,
  "timestamp": "2026-02-01T10:30:45Z"
}
```

**`audio:transmission`** - New audio uploaded
```json
{
  "id": 124,
  "created_at": "2026-02-01T10:31:00.123456",
  "filename": "transmission_20260201_103100.wav",
  "s3_url": "https://bucket.s3.amazonaws.com/audio/124.wav",
  "file_size_bytes": 256000,
  "duration_seconds": 8.2,
  "format": "wav",
  "frequency_mhz": 121.5,
  "channel_name": "Tower",
  "transcription_status": "pending"
}
```

**`audio:transcription_started`**
```json
{
  "transmission_id": 124,
  "transcription_status": "processing",
  "transcription_queued_at": "2026-02-01T10:31:05",
  "timestamp": "2026-02-01T10:31:05Z"
}
```

**`audio:transcription_completed`**
```json
{
  "transmission_id": 124,
  "transcription_status": "completed",
  "transcript": "Cessna 123 requesting vectors to the north",
  "transcript_confidence": 0.92,
  "transcript_language": "en",
  "transcription_completed_at": "2026-02-01T10:31:25",
  "identified_airframes": ["N1234AB"],
  "timestamp": "2026-02-01T10:31:25Z"
}
```

**`audio:transcription_failed`**
```json
{
  "transmission_id": 124,
  "transcription_status": "failed",
  "error": "Audio quality too low for transcription",
  "timestamp": "2026-02-01T10:31:30Z"
}
```

### Client Events

**`subscribe`** / **`unsubscribe`** - Manage subscriptions
```json
{ "topics": ["transmissions", "transcriptions"] }
// or
{ "topics": "all" }
```

**`request`** - Data queries

**Type: `transmissions`** - Get filtered list
```json
{
  "type": "transmissions",
  "request_id": "req-001",
  "params": {
    "frequency": 121.5,
    "channel_name": "Tower",
    "transcription_status": "completed",
    "limit": 50
  }
}
```

**Type: `transmission`** - Get single by ID
```json
{
  "type": "transmission",
  "request_id": "req-002",
  "params": { "id": 123 }
}
```

**Type: `stats`** - Get audio statistics
```json
{
  "type": "stats",
  "request_id": "req-003",
  "params": {}
}
```

Response:
```json
{
  "total_transmissions": 1250,
  "last_24h": 145,
  "total_duration_seconds": 18750,
  "status_counts": {
    "completed": 1200,
    "pending": 30,
    "failed": 20
  },
  "top_frequencies": [
    { "frequency_mhz": 121.5, "count": 250 },
    { "frequency_mhz": 118.1, "count": 180 }
  ],
  "timestamp": "2026-02-01T10:35:00Z"
}
```

---

## Cannonball Namespace (/cannonball)

Mobile threat detection for law enforcement and surveillance aircraft.

### Connection

```javascript
const cbSocket = io('https://skyspy.example.com/cannonball', {
  auth: { token: 'your-jwt-token' }
});
```

### Server Events

**`session_started`** - Sent on connect
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-02-01T10:30:45Z"
}
```

**`threats`** - Threat list (sent after position update)
```json
{
  "data": [
    {
      "hex": "A24BEF",
      "callsign": "N1234AB",
      "category": "Law Enforcement Helicopter",
      "description": "LAPD Bell 407",
      "distance_nm": 3.5,
      "bearing": 45.0,
      "relative_bearing": 90.5,
      "direction": "NE",
      "altitude": 1500,
      "ground_speed": 120,
      "vertical_rate": 500,
      "trend": "approaching",
      "threat_level": "critical",
      "is_law_enforcement": true,
      "is_helicopter": true,
      "confidence": "high",
      "aircraft_type": "H47",
      "registration": "N1234AB",
      "lat": 34.08,
      "lon": -118.22
    }
  ],
  "count": 1,
  "position": { "lat": 34.05, "lon": -118.25 },
  "timestamp": "2026-02-01T10:30:50Z"
}
```

**Threat Level Values:**
- `critical` - Immediate threat (< 5nm, approaching)
- `warning` - Moderate threat (5-15nm)
- `info` - Awareness only (> 15nm or departing)

**Trend Values:**
- `approaching` - Distance decreasing > 0.05nm
- `departing` - Distance increasing > 0.05nm
- `holding` - Distance stable
- `unknown` - No previous position

**`radius_updated`** - Confirmation of radius change
```json
{
  "radius_nm": 25.0
}
```

### Client Events

**`position_update`** - Send device position
```json
{
  "lat": 34.05,
  "lon": -118.25,
  "heading": 180,
  "accuracy": 10
}
```

Parameters:
- `lat` (required): Latitude (-90 to 90)
- `lon` (required): Longitude (-180 to 180)
- `heading` (optional): Compass heading (0-360)
- `accuracy` (optional): Position accuracy in meters

**`set_radius`** - Set threat detection radius
```json
{
  "radius_nm": 25.0
}
```
Radius is clamped to 1.0-100.0 nautical miles.

**`get_threats`** - Request current threats without position update
```json
{}
```

**`request`** - Data queries

**Type: `threats`**
```json
{
  "type": "threats",
  "request_id": "req-001",
  "params": {}
}
```

**Type: `session-info`**
```json
{
  "type": "session-info",
  "request_id": "req-002",
  "params": {}
}
```

Response:
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "position": { "lat": 34.05, "lon": -118.25 },
  "heading": 180,
  "radius_nm": 25.0
}
```

**Type: `sessions`** (requires `cannonball.view_sessions`)
```json
{
  "type": "sessions",
  "request_id": "req-003",
  "params": { "active_only": true, "hours": 24, "limit": 50 }
}
```

**Type: `patterns`** (requires `cannonball.view_patterns`)
```json
{
  "type": "patterns",
  "request_id": "req-004",
  "params": { "hours": 24, "limit": 100 }
}
```

**Type: `alerts`** (requires `cannonball.view_alerts`)
```json
{
  "type": "alerts",
  "request_id": "req-005",
  "params": { "hours": 24, "unacknowledged": false, "limit": 100 }
}
```

**Type: `alert-acknowledge`** (requires `cannonball.manage_alerts`)
```json
{
  "type": "alert-acknowledge",
  "request_id": "req-006",
  "params": { "id": "alert-uuid" }
}
```

**Type: `stats-summary`** (requires `cannonball.view_stats`)
```json
{
  "type": "stats-summary",
  "request_id": "req-007",
  "params": { "hours": 24 }
}
```

**Type: `known-aircraft-check`**
```json
{
  "type": "known-aircraft-check",
  "request_id": "req-008",
  "params": {
    "icao_hex": "A24BEF",
    "callsign": "N1234AB",
    "operator": "LAPD",
    "category": "Helicopter",
    "type_code": "H47"
  }
}
```

---

## Server Broadcasts

Events broadcast from Celery tasks to connected clients.

### Aircraft Events (Room: `topic_aircraft`)

**`positions:update`** - Real-time position updates (10+ Hz)
```json
{
  "positions": [
    { "hex": "A1B2C3", "lat": 40.1, "lon": -74.5, "alt": 35000, "track": 180, "gs": 450, "vr": 1000 }
  ],
  "removed": ["D4E5F6"],
  "count": 42,
  "timestamp": "2026-02-01T12:34:56Z"
}
```

**`aircraft:update`** - Full aircraft state
```json
{
  "aircraft": [
    {
      "hex": "A1B2C3",
      "flight": "AAL123",
      "lat": 40.1,
      "lon": -74.5,
      "alt": 35000,
      "track": 180,
      "gs": 450,
      "vr": 1000,
      "distance_nm": 50.5,
      "military": false,
      "emergency": false
    }
  ],
  "count": 42,
  "timestamp": "2026-02-01T12:34:56Z",
  "stream": true
}
```

**`aircraft:new`** - New aircraft appeared
```json
{
  "aircraft": [{ "hex": "A1B2C3", ... }],
  "count": 1,
  "timestamp": "2026-02-01T12:34:56Z"
}
```

**`aircraft:remove`** - Aircraft removed
```json
{
  "icaos": ["A1B2C3", "D4E5F6"],
  "count": 2,
  "timestamp": "2026-02-01T12:34:56Z"
}
```

### Safety Events (Room: `topic_safety`)

**`safety:event`**
```json
{
  "event_type": "emergency_squawk",
  "severity": "critical",
  "icao": "A1B2C3",
  "icao_hex": "A1B2C3",
  "callsign": "AAL123",
  "message": "Emergency squawk 7700 detected",
  "details": {
    "squawk": "7700",
    "altitude": 35000,
    "latitude": 40.1,
    "longitude": -74.5
  },
  "timestamp": "2026-02-01T12:34:56Z"
}
```

**Event Types:**
- `emergency_squawk` - 7500/7600/7700 detected
- `tcas_ra` - TCAS Resolution Advisory
- `extreme_vertical_speed` - Unusual climb/descent
- `proximity_conflict` - Aircraft too close

### Airspace Events (Room: `topic_aircraft`)

**`airspace:advisory`**
```json
{
  "count": 12,
  "timestamp": "2026-02-01T12:34:56Z"
}
```

**`notam:refresh`**
```json
{
  "count": 15,
  "active_notams": 45,
  "active_tfrs": 3,
  "timestamp": "2026-02-01T12:34:56Z"
}
```

**`tfr:new`**
```json
{
  "tfr": {
    "notam_id": "TFR123",
    "effective_start": "2026-02-01T12:00:00Z",
    "effective_end": "2026-02-01T18:00:00Z",
    "reason": "PRESIDENTIAL",
    "geometry": { "type": "Polygon", "coordinates": [...] }
  },
  "timestamp": "2026-02-01T12:34:56Z"
}
```

### Antenna Analytics (Room: `topic_aircraft`)

**`antenna:analytics_update`**
```json
{
  "max_range_by_direction": { "0": 150.5, "30": 145.2 },
  "overall_max_range": 160.0,
  "avg_range": 95.5,
  "total_positions": 5000,
  "unique_aircraft": 45,
  "avg_rssi": -40.5,
  "timestamp": "2026-02-01T12:34:56Z"
}
```

---

## Rooms and Topics

### Main Namespace Rooms

| Room | Joined Via | Events Received |
|------|------------|-----------------|
| `topic_aircraft` | Subscribe to `aircraft` | positions:update, aircraft:*, notam:*, tfr:*, airspace:*, antenna:* |
| `topic_safety` | Subscribe to `safety` | safety:event |
| `topic_stats` | Subscribe to `stats` | stats:update |
| `topic_alerts` | Subscribe to `alerts` | alert:new, alert:update |
| `topic_acars` | Subscribe to `acars` | acars:message |
| `topic_airspace` | Subscribe to `airspace` | airspace:*, notam:* |
| `topic_notams` | Subscribe to `notams` | notam:*, tfr:* |

### Audio Namespace Rooms

| Room | Joined On | Events Received |
|------|-----------|-----------------|
| `audio_transmissions` | Connect | audio:transmission |
| `audio_transcriptions` | Connect | audio:transcription_* |
| `audio_all` | Connect | All audio events |

---

## Error Handling

### Error Response Format

```json
{
  "request_id": "original-request-id",
  "message": "Descriptive error message"
}
```

### Common Errors

| Error | Description |
|-------|-------------|
| `"Missing request type"` | Request type not specified |
| `"Permission denied"` | User lacks required permission |
| `"Unknown request type: <type>"` | Unrecognized request type |
| `"Internal server error"` | Server exception |
| `"Missing <param> parameter"` | Required parameter missing |
| `"Rate limit exceeded"` | Too many requests |
| `"Channel not found"` | Notification channel doesn't exist |
| `"Rule not found"` | Alert rule doesn't exist |

### Rate Limiting

Per-client rate limits are enforced:

| Topic | Rate Limit |
|-------|------------|
| `aircraft:update` | 10 Hz |
| `aircraft:position` | 5 Hz |
| `stats:update` | 0.5 Hz |
| `request` | 10/second |
| `default` | 5/second |

---

## Permission Reference

### Topic Permissions

| Topic | Permission |
|-------|------------|
| `aircraft` | `aircraft.view` |
| `military` | `aircraft.view_military` |
| `alerts` | `alerts.view` |
| `safety` | `safety.view` |
| `acars` | `acars.view` |
| `audio` | `audio.view` |
| `system` | `system.view_status` |
| `stats` | `stats.view` |
| `airspace` | `airspace.view` |
| `notams` | `notams.view` |

### Request Permissions

| Request | Permission |
|---------|------------|
| `aircraft-info` | `aircraft.view` |
| `safety-acknowledge` | `safety.manage` |
| `alert-rule-create` | `alerts.manage` |
| `notification-channel-create` | `notifications.manage` |
| `system-info` | `system.view_info` |

---

## Best Practices

1. **Always include `request_id`** in requests for response correlation
2. **Subscribe only to needed topics** to reduce bandwidth
3. **Handle reconnection** - Socket.IO auto-reconnects but subscriptions need re-establishing
4. **Rate limit client requests** to avoid server-side throttling
5. **Use position updates sparingly** in Cannonball mode (every 5-10 seconds)
6. **Clean up on disconnect** - unsubscribe from rooms explicitly
