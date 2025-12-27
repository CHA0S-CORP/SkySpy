# SkySpyAPI Real-Time API

Real-time data streaming via Socket.IO for live aircraft tracking, safety events, alerts, airspace updates, and ACARS messages.

**NEW:** Socket.IO provides robust connections with automatic reconnection and room-based subscriptions.

## Quick Start

### Connecting with Socket.IO

```javascript
import { io } from 'socket.io-client';

// Connect to Socket.IO
const socket = io('http://localhost:8000', {
  path: '/socket.io/socket.io',
  query: { topics: 'all' },
  transports: ['websocket', 'polling'],
});

socket.on('connect', () => console.log('Connected'));
socket.on('aircraft:snapshot', (data) => {
  console.log('Aircraft:', data.aircraft.length);
});
```

### Using the React Hook

```javascript
import { useWebSocket } from './hooks/useWebSocket';

function AircraftMap() {
  const {
    aircraft,
    connected,
    stats,
    safetyEvents,
    request,  // Request data on-demand
  } = useWebSocket(true, '', 'aircraft,safety,airspace');

  // Fetch PIREPs on-demand
  const loadPireps = async () => {
    const pireps = await request('pireps', { lat: 47.5, lon: -122.3, radius: 100 });
    console.log('PIREPs:', pireps.data);
  };

  // Fetch airspace advisories for current map view
  const loadAirspaces = async () => {
    const data = await request('airspaces', { lat: 47.9377, lon: -121.9687 });
    console.log('Advisories:', data.advisories);
  };

  return (
    <div>
      <p>Connected: {connected ? 'Yes' : 'No'}</p>
      <p>Aircraft: {aircraft.length}</p>
      <button onClick={loadPireps}>Load PIREPs</button>
      <button onClick={loadAirspaces}>Load Airspaces</button>
    </div>
  );
}
```

---

## Connection

### Socket.IO Endpoint

```
Socket.IO path: /socket.io/socket.io
Query parameters: topics={comma-separated-topics}
```

### Topics (Rooms)

Subscribe to specific event types by providing comma-separated topics:

| Topic | Events Received |
|-------|----------------|
| `aircraft` | `aircraft:snapshot`, `aircraft:new`, `aircraft:update`, `aircraft:remove`, `aircraft:heartbeat` |
| `airspace` | `airspace:snapshot`, `airspace:update`, `airspace:advisory`, `airspace:boundary` |
| `safety` | `safety:event` (TCAS conflicts, extreme vertical rates) |
| `alerts` | `alert:triggered` (custom alert rules) |
| `acars` | `acars:message` (ACARS/VDL2 messages) |
| `all` | All of the above |

**Connection Examples:**
```javascript
// Connect with all topics
const socket = io('http://localhost:8000', {
  path: '/socket.io/socket.io',
  query: { topics: 'all' },
});

// Connect with specific topics
const socket = io('http://localhost:8000', {
  path: '/socket.io/socket.io',
  query: { topics: 'aircraft,safety' },
});
```

### Dynamic Subscription

```javascript
// Subscribe to additional topics after connecting
socket.emit('subscribe', { topics: ['safety', 'alerts'] });

// Unsubscribe from topics
socket.emit('unsubscribe', { topics: ['acars'] });
```

---

## Event Format

Socket.IO events use colon-separated names (e.g., `aircraft:update`). The data is passed directly as the event payload.

```javascript
socket.on('aircraft:update', (data) => {
  console.log(data.aircraft); // Array of updated aircraft
  console.log(data.timestamp); // ISO timestamp
});
```

---

## Aircraft Events

### `aircraft:snapshot`

Sent immediately after connection with the current state of all tracked aircraft.

```javascript
socket.on('aircraft:snapshot', (data) => {
  // data.aircraft: Array of aircraft objects
  // data.count: Number of aircraft
  // data.timestamp: ISO timestamp
});
```

**Data Structure:**
```json
{
  "aircraft": [
    {
      "hex": "A12345",
      "flight": "UAL123",
      "lat": 47.6062,
      "lon": -122.3321,
      "alt": 35000,
      "gs": 450,
      "track": 270,
      "vr": -500,
      "squawk": "1200",
      "category": "A3",
      "type": "B738",
      "military": false,
      "emergency": false
    }
  ],
  "count": 1,
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### `aircraft:new`

New aircraft detected (not previously tracked).

```javascript
socket.on('aircraft:new', (data) => {
  data.aircraft.forEach(ac => {
    console.log('New aircraft:', ac.hex, ac.flight);
  });
});
```

### `aircraft:update`

Position or state changed significantly (>0.001 lat/lon, >100ft altitude, >5 track, or squawk change).

```javascript
socket.on('aircraft:update', (data) => {
  data.aircraft.forEach(ac => {
    // Update existing aircraft in your state
  });
});
```

### `aircraft:remove`

Aircraft no longer tracked (left coverage area or signal lost).

```javascript
socket.on('aircraft:remove', (data) => {
  data.icaos.forEach(icao => {
    console.log('Aircraft removed:', icao);
  });
});
```

**Data Structure:**
```json
{
  "icaos": ["C11111", "D22222"],
  "timestamp": "2024-01-15T12:00:15Z"
}
```

### `aircraft:heartbeat`

Periodic status update with current aircraft count.

```javascript
socket.on('aircraft:heartbeat', (data) => {
  console.log('Tracking', data.count, 'aircraft');
});
```

### Aircraft Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `hex` | string | ICAO 24-bit address (uppercase) |
| `flight` | string | Callsign/flight number (trimmed) |
| `lat` | number | Latitude in degrees |
| `lon` | number | Longitude in degrees |
| `alt` | number | Barometric altitude in feet |
| `gs` | number | Ground speed in knots |
| `track` | number | Track heading in degrees (0-359) |
| `vr` | number | Vertical rate in ft/min |
| `squawk` | string | Transponder squawk code |
| `category` | string | Wake category (A1-A5, B1-B4, etc.) |
| `type` | string | Aircraft type code (B738, A320, etc.) |
| `military` | boolean | Military aircraft flag |
| `emergency` | boolean | Emergency squawk (7500/7600/7700) |

---

## Airspace Events

### `airspace:snapshot`

Sent on connection with current airspace advisories and boundaries.

```javascript
socket.on('airspace:snapshot', (data) => {
  console.log('Advisories:', data.advisories.length);
  console.log('Boundaries:', data.boundaries.length);
});
```

### `airspace:update`

Full airspace data refresh.

```javascript
socket.on('airspace:update', (data) => {
  // data.advisories: Array of G-AIRMET/SIGMET advisories
  // data.boundaries: Array of static airspace boundaries
});
```

### `airspace:advisory`

G-AIRMET/SIGMET advisories changed (refreshed every 5 minutes).

```javascript
socket.on('airspace:advisory', (data) => {
  console.log('Advisory update:', data.count, 'advisories');
});
```

### `airspace:boundary`

Static airspace boundaries updated (refreshed every 24 hours).

```javascript
socket.on('airspace:boundary', (data) => {
  console.log('Boundary update:', data.count, 'boundaries');
});
```

---

## Safety Events

### `safety:event`

Safety monitoring detected a potential issue.

```javascript
socket.on('safety:event', (data) => {
  console.warn(`Safety: ${data.event_type} - ${data.message}`);
});
```

**Event Types:**

| Type | Severity | Description |
|------|----------|-------------|
| `proximity_conflict` | critical | Two aircraft too close |
| `extreme_vertical_rate` | warning/critical | Vertical rate > 4500 ft/min |
| `tcas_ra_detected` | critical | Sudden vertical rate reversal |
| `emergency_squawk` | critical | 7500/7600/7700 squawk detected |

**Data Structure:**
```json
{
  "event_type": "proximity_conflict",
  "severity": "critical",
  "icao": "A12345",
  "icao_2": "B67890",
  "callsign": "UAL123",
  "callsign_2": "DAL456",
  "message": "Proximity conflict: 0.5nm lateral, 500ft vertical separation",
  "details": {
    "distance_nm": 0.5,
    "altitude_diff_ft": 500
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

---

## Alert Events

### `alert:triggered`

Custom alert rule matched an aircraft.

```javascript
socket.on('alert:triggered', (data) => {
  console.log(`Alert: ${data.rule_name} - ${data.message}`);
});
```

**Data Structure:**
```json
{
  "rule_id": 1,
  "rule_name": "Low Altitude Alert",
  "icao": "A12345",
  "callsign": "UAL123",
  "message": "Aircraft below 3000ft within 10nm",
  "priority": "warning",
  "aircraft_data": {
    "hex": "A12345",
    "flight": "UAL123",
    "alt": 2500,
    "lat": 47.6,
    "lon": -122.3
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

---

## ACARS Events

### `acars:message`

ACARS or VDL2 message received.

```javascript
socket.on('acars:message', (data) => {
  console.log(`ACARS from ${data.callsign}: ${data.text}`);
});
```

**Data Structure:**
```json
{
  "source": "acars",
  "icao_hex": "A12345",
  "registration": "N12345",
  "callsign": "UAL123",
  "label": "H1",
  "text": "DEPARTURE CLEARANCE CONFIRMED SEA",
  "frequency": 130.025,
  "signal_level": -42.5,
  "timestamp": "2024-01-15T12:00:00Z"
}
```

---

## Request/Response Pattern (On-Demand Data)

Socket.IO supports request/response for fetching data on-demand. This allows the frontend to request aviation data without making separate HTTP calls.

### Sending Requests

```javascript
socket.emit('request', {
  type: 'airspaces',
  request_id: 'unique-id-123',
  params: { lat: 47.9377, lon: -121.9687 }
});
```

### Receiving Responses

```javascript
// Success response
socket.on('response', (data) => {
  if (data.request_id === 'unique-id-123') {
    console.log('Result:', data.data);
  }
});

// Error response
socket.on('error', (data) => {
  if (data.request_id === 'unique-id-123') {
    console.error('Error:', data.error);
  }
});
```

### Response Format

**Success:**
```json
{
  "request_id": "unique-id-123",
  "request_type": "airspaces",
  "data": {
    "advisories": [...],
    "count": 5,
    "center": {"lat": 47.9377, "lon": -121.9687}
  },
  "timestamp": "2024-01-15T12:00:00Z"
}
```

**Error:**
```json
{
  "request_id": "unique-id-123",
  "request_type": "airspaces",
  "error": "lat and lon parameters required",
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### Supported Request Types

| Type | Description | Required Params | Optional Params |
|------|-------------|-----------------|-----------------|
| `airspaces` | G-AIRMET advisories | `lat`, `lon` | `hazard` |
| `airspace-boundaries` | Static airspace boundaries | - | `lat`, `lon`, `radius`, `class` |
| `pireps` | Pilot reports | `lat`, `lon` | `radius`, `hours` |
| `metars` | METAR observations by area | `lat`, `lon` | `radius`, `hours`, `limit` |
| `metar` | Single station METAR | `station` | `hours` |
| `taf` | Terminal aerodrome forecast | `station` | - |
| `sigmets` | SIGMET advisories | - | `hazard`, `lat`, `lon`, `radius` |
| `airports` | Nearby airports | `lat`, `lon` | `radius`, `limit` |
| `navaids` | Navigation aids | `lat`, `lon` | `radius`, `limit`, `type` |
| `safety-events` | Recent safety events | - | `limit`, `event_type`, `severity` |
| `aircraft-info` | Aircraft info by ICAO | `icao` | - |

### Request Examples

```javascript
// Fetch PIREPs
socket.emit('request', {
  type: 'pireps',
  request_id: 'req-001',
  params: { lat: 47.5, lon: -122.3, radius: 150, hours: 3 }
});

// Fetch METAR for station
socket.emit('request', {
  type: 'metar',
  request_id: 'req-002',
  params: { station: 'KSEA' }
});

// Fetch nearby airports
socket.emit('request', {
  type: 'airports',
  request_id: 'req-003',
  params: { lat: 47.5, lon: -122.3, radius: 50, limit: 10 }
});
```

---

## Client Actions

### Subscribe to Topics

```javascript
socket.emit('subscribe', { topics: ['safety', 'alerts'] });
```

### Unsubscribe from Topics

```javascript
socket.emit('unsubscribe', { topics: ['acars'] });
```

### Ping/Pong Keepalive

```javascript
socket.emit('ping');
socket.on('pong', (data) => {
  console.log('Pong received:', data.timestamp);
});
```

---

## Complete Implementation Example

```javascript
import { io } from 'socket.io-client';

class AircraftTracker {
  constructor() {
    this.aircraft = new Map();
    this.pending = new Map();
    this.connect();
  }

  connect() {
    this.socket = io(window.location.origin, {
      path: '/socket.io/socket.io',
      query: { topics: 'aircraft,safety' },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
    });

    this.socket.on('connect', () => {
      console.log('Connected to Socket.IO');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
    });

    // Aircraft events
    this.socket.on('aircraft:snapshot', (data) => {
      this.aircraft.clear();
      data.aircraft.forEach(ac => this.aircraft.set(ac.hex, ac));
      this.render();
    });

    this.socket.on('aircraft:new', (data) => {
      data.aircraft.forEach(ac => this.aircraft.set(ac.hex, ac));
      this.render();
    });

    this.socket.on('aircraft:update', (data) => {
      data.aircraft.forEach(ac => {
        const existing = this.aircraft.get(ac.hex) || {};
        this.aircraft.set(ac.hex, { ...existing, ...ac });
      });
      this.render();
    });

    this.socket.on('aircraft:remove', (data) => {
      data.icaos.forEach(icao => this.aircraft.delete(icao));
      this.render();
    });

    // Safety events
    this.socket.on('safety:event', (data) => {
      console.warn(`Safety: ${data.event_type} - ${data.message}`);
    });

    // Request/response
    this.socket.on('response', (data) => {
      const pending = this.pending.get(data.request_id);
      if (pending) {
        this.pending.delete(data.request_id);
        clearTimeout(pending.timeout);
        pending.resolve(data.data);
      }
    });

    this.socket.on('error', (data) => {
      const pending = this.pending.get(data.request_id);
      if (pending) {
        this.pending.delete(data.request_id);
        clearTimeout(pending.timeout);
        pending.reject(new Error(data.error));
      }
    });
  }

  async request(type, params = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timeout });

      this.socket.emit('request', {
        type,
        request_id: requestId,
        params,
      });
    });
  }

  render() {
    console.log(`Tracking ${this.aircraft.size} aircraft`);
  }
}

const tracker = new AircraftTracker();

// Request PIREPs on-demand
tracker.request('pireps', { lat: 47.5, lon: -122.3, radius: 100 })
  .then(data => console.log('PIREPs:', data))
  .catch(err => console.error('Error:', err));
```

---

## React Hook Implementation

```javascript
import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

export function useSocketIO(enabled, apiBase, topics = 'all') {
  const [aircraft, setAircraft] = useState({});
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState({ count: 0 });
  const [safetyEvents, setSafetyEvents] = useState([]);
  const socketRef = useRef(null);
  const pendingRequests = useRef(new Map());

  useEffect(() => {
    if (!enabled) return;

    const socketUrl = apiBase || window.location.origin;

    const socket = io(socketUrl, {
      path: '/socket.io/socket.io',
      query: { topics },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    // Aircraft events
    socket.on('aircraft:snapshot', (data) => {
      const newAircraft = {};
      data.aircraft.forEach(ac => newAircraft[ac.hex] = ac);
      setAircraft(newAircraft);
      setStats(prev => ({ ...prev, count: data.count }));
    });

    socket.on('aircraft:update', (data) => {
      setAircraft(prev => {
        const updated = { ...prev };
        data.aircraft.forEach(ac => {
          updated[ac.hex] = { ...updated[ac.hex], ...ac };
        });
        return updated;
      });
    });

    socket.on('aircraft:remove', (data) => {
      setAircraft(prev => {
        const next = { ...prev };
        data.icaos.forEach(icao => delete next[icao]);
        return next;
      });
    });

    socket.on('aircraft:heartbeat', (data) => {
      setStats(prev => ({ ...prev, count: data.count }));
    });

    // Safety events
    socket.on('safety:event', (data) => {
      setSafetyEvents(prev => [data, ...prev].slice(0, 100));
    });

    // Request/response
    socket.on('response', (data) => {
      if (pendingRequests.current.has(data.request_id)) {
        const { resolve, timeout } = pendingRequests.current.get(data.request_id);
        clearTimeout(timeout);
        pendingRequests.current.delete(data.request_id);
        resolve(data.data);
      }
    });

    socket.on('error', (data) => {
      if (pendingRequests.current.has(data.request_id)) {
        const { reject, timeout } = pendingRequests.current.get(data.request_id);
        clearTimeout(timeout);
        pendingRequests.current.delete(data.request_id);
        reject(new Error(data.error));
      }
    });

    return () => socket.disconnect();
  }, [enabled, apiBase, topics]);

  const request = useCallback((type, params = {}, timeoutMs = 10000) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current?.connected) {
        reject(new Error('Not connected'));
        return;
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const timeout = setTimeout(() => {
        pendingRequests.current.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeoutMs);

      pendingRequests.current.set(requestId, { resolve, reject, timeout });

      socketRef.current.emit('request', {
        type,
        request_id: requestId,
        params,
      });
    });
  }, []);

  return {
    aircraft: Object.values(aircraft),
    aircraftMap: aircraft,
    connected,
    stats,
    safetyEvents,
    request,
  };
}
```

---

## Legacy WebSocket Support

The native WebSocket endpoint at `/ws` is still available for backwards compatibility:

```javascript
const ws = new WebSocket('ws://localhost:8000/ws?topics=all');
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  // Event types use underscores: aircraft_snapshot, aircraft_update, etc.
};
```

Note: Socket.IO is the recommended connection method for new integrations.

---

## Redis Support for Multi-Worker Deployments

When `REDIS_URL` is configured, Socket.IO automatically uses Redis for pub/sub, enabling horizontal scaling across multiple API workers.

```bash
REDIS_URL=redis://localhost:6379
```

---

## Best Practices

1. **Use Socket.IO client library** - Handles reconnection automatically
2. **Subscribe to specific topics** - Reduce bandwidth by only subscribing to needed events
3. **Use request pattern for on-demand data** - Avoid HTTP polling for aviation data
4. **Handle disconnections gracefully** - Socket.IO reconnects automatically
5. **Store aircraft in a Map by hex** - Enables O(1) lookups and updates
