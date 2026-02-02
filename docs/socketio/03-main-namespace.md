---
title: Main Namespace
slug: socketio-main-namespace
excerpt: Aircraft tracking, safety events, alerts, and statistics on the default Socket.IO namespace
---

# Main Namespace

The main namespace (`/`) is the default connection point for most SkySpy features: aircraft tracking, safety monitoring, custom alerts, ACARS messages, statistics, and airspace data.

## Overview

Connect to the main namespace to receive real-time updates. Use topic subscriptions to control which data streams you receive.

> 📘 Automatic Snapshot
>
> On connection, the server automatically emits `aircraft:snapshot` with the current state of all aircraft in range. Subscribe to topics to receive ongoing updates.

## Topics

Subscribe to one or more topics to receive updates.

| Topic | Description | Events | Use Case |
|----------|----------|----------|----------|
| `aircraft` | Position and state updates | `aircraft:*` | Real-time tracking map |
| `safety` | Safety events (TCAS, emergencies, conflicts) | `safety:*` | Safety monitoring dashboard |
| `stats` | Live statistics and metrics | `stats:*` | Analytics widgets |
| `alerts` | Custom alert rule triggers | `alert:*` | Personalized notifications |
| `acars` | ACARS datalink messages | `acars:*` | Message decoding |
| `airspace` | Airspace advisories and boundaries | `airspace:*` | Flight planning |
| `notams` | NOTAMs and TFRs | `notams:*` | Airspace restrictions |
| `all` | All of the above | All events | Comprehensive monitoring |

### Subscribe Example

```javascript JavaScript
// Subscribe to specific topics
socket.emit('subscribe', { 
  topics: ['aircraft', 'safety', 'alerts'] 
});

socket.on('subscribed', (data) => {
  console.log('Subscribed to:', data.topics);
  console.log('Successfully joined:', data.joined);
  if (data.denied) {
    console.warn('Permission denied for:', data.denied);
  }
});
```

```python Python
# Subscribe to specific topics
sio.emit('subscribe', {
    'topics': ['aircraft', 'safety', 'alerts']
})

@sio.event
def subscribed(data):
    print('Subscribed to:', data.get('topics'))
    print('Successfully joined:', data.get('joined'))
    if data.get('denied'):
        print('Permission denied for:', data.get('denied'))
```

## Aircraft Events

Track aircraft positions in real-time with snapshot, update, new, and remove events.

| Event | Trigger | Payload | Frequency |
|----------|----------|----------|----------|
| `aircraft:snapshot` | On connect / request | `{ aircraft[], count, timestamp }` | Once on connect |
| `aircraft:update` | Periodic updates | Full or batched aircraft list | ~10 Hz (rate-limited) |
| `aircraft:new` | New detection | Single aircraft object | As detected |
| `aircraft:remove` | Timeout / out of range | `{ hex, reason? }` | As removed |
| `aircraft:delta` | Position change (if enabled) | Delta object with `hex` and changed fields | ~10 Hz (rate-limited) |
| `aircraft:heartbeat` | Keepalive | `{ count, timestamp }` | Every 30-60s |

### Aircraft Payload Fields

| Field | Type | Description | Example |
|----------|----------|----------|----------|
| `hex` | string | ICAO 24-bit address (unique identifier) | `"A1B2C3"` |
| `flight` | string | Callsign (trimmed) | `"UAL123"` |
| `lat` | number | Latitude in decimal degrees | `37.7749` |
| `lon` | number | Longitude in decimal degrees | `-122.4194` |
| `alt_baro` | number | Barometric altitude in feet | `35000` |
| `alt_geom` | number | Geometric (GNSS) altitude in feet | `35125` |
| `gs` | number | Ground speed in knots | `450.5` |
| `track` | number | Track angle in degrees (0-359) | `270.5` |
| `squawk` | string | Mode A squawk code | `"1200"` |
| `category` | string | Aircraft category (e.g., A3=large) | `"A3"` |
| `distance_nm` | number | Distance from receiver in nautical miles | `12.5` |
| `seen` | number | Seconds since last message | `2.3` |
| `rssi` | number | Received signal strength indicator (dBFS) | `-15.2` |

### Aircraft Events Example

```javascript JavaScript
const aircraftMap = new Map();

socket.on('aircraft:snapshot', (data) => {
  console.log(`Initial snapshot: ${data.count} aircraft`);
  data.aircraft.forEach(ac => {
    aircraftMap.set(ac.hex, ac);
  });
  renderMap(aircraftMap);
});

socket.on('aircraft:update', (aircraft) => {
  // Update or add aircraft
  if (Array.isArray(aircraft)) {
    aircraft.forEach(ac => aircraftMap.set(ac.hex, ac));
  } else {
    aircraftMap.set(aircraft.hex, aircraft);
  }
  renderMap(aircraftMap);
});

socket.on('aircraft:new', (aircraft) => {
  console.log(`New aircraft: ${aircraft.flight || aircraft.hex}`);
  aircraftMap.set(aircraft.hex, aircraft);
  renderMap(aircraftMap);
});

socket.on('aircraft:remove', (data) => {
  console.log(`Removed: ${data.hex} (${data.reason || 'timeout'})`);
  aircraftMap.delete(data.hex);
  renderMap(aircraftMap);
});

socket.on('aircraft:delta', (delta) => {
  // Merge delta into existing aircraft
  const existing = aircraftMap.get(delta.hex);
  if (existing) {
    Object.assign(existing, delta);
    renderMap(aircraftMap);
  }
});
```

```python Python
aircraft_map = {}

@sio.event
def aircraft_snapshot(data):
    print(f"Initial snapshot: {data.get('count')} aircraft")
    for ac in data.get('aircraft', []):
        aircraft_map[ac['hex']] = ac
    render_map(aircraft_map)

@sio.event
def aircraft_update(aircraft):
    # Update or add aircraft
    if isinstance(aircraft, list):
        for ac in aircraft:
            aircraft_map[ac['hex']] = ac
    else:
        aircraft_map[aircraft['hex']] = aircraft
    render_map(aircraft_map)

@sio.event
def aircraft_new(aircraft):
    print(f"New aircraft: {aircraft.get('flight') or aircraft['hex']}")
    aircraft_map[aircraft['hex']] = aircraft
    render_map(aircraft_map)

@sio.event
def aircraft_remove(data):
    hex_code = data.get('hex')
    reason = data.get('reason', 'timeout')
    print(f"Removed: {hex_code} ({reason})")
    aircraft_map.pop(hex_code, None)
    render_map(aircraft_map)

@sio.event
def aircraft_delta(delta):
    # Merge delta into existing aircraft
    hex_code = delta.get('hex')
    if hex_code in aircraft_map:
        aircraft_map[hex_code].update(delta)
        render_map(aircraft_map)
```

## Safety Events

Monitor safety-critical events like TCAS alerts, emergency squawks, and proximity conflicts.

| Event | Trigger | Payload |
|----------|----------|----------|
| `safety:snapshot` | Initial state on subscription | `{ events[], count, timestamp }` |
| `safety:event` | New safety event detected | Single event object |

### Safety Event Fields

| Field | Type | Description |
|----------|----------|----------|
| `id` | string | Unique event ID |
| `event_type` | string | Event type: `tcas`, `emergency`, `conflict`, `low_altitude`, etc. |
| `severity` | string | Severity level: `critical`, `high`, `medium`, `low` |
| `icao_hex` | string | Aircraft ICAO hex code |
| `callsign` | string | Aircraft callsign |
| `message` | string | Human-readable description |
| `details` | object | Event-specific details (e.g., conflicting aircraft, altitude) |
| `timestamp` | string | ISO 8601 timestamp |

### Safety Events Example

```javascript JavaScript
socket.on('safety:snapshot', (data) => {
  console.log(`Active safety events: ${data.count}`);
  data.events.forEach(event => {
    displaySafetyAlert(event);
  });
});

socket.on('safety:event', (event) => {
  console.warn(`⚠️  ${event.severity.toUpperCase()}: ${event.message}`);
  
  // Play alert sound for critical events
  if (event.severity === 'critical') {
    playAlertSound();
  }
  
  // Show notification
  showNotification({
    title: `Safety Alert: ${event.event_type}`,
    body: event.message,
    icon: 'warning',
    data: event
  });
  
  // Display in UI
  displaySafetyAlert(event);
});
```

```python Python
@sio.event
def safety_snapshot(data):
    print(f"Active safety events: {data.get('count')}")
    for event in data.get('events', []):
        display_safety_alert(event)

@sio.event
def safety_event(event):
    severity = event.get('severity', 'unknown').upper()
    message = event.get('message', '')
    print(f"⚠️  {severity}: {message}")
    
    # Play alert sound for critical events
    if event.get('severity') == 'critical':
        play_alert_sound()
    
    # Send notification
    send_notification(
        title=f"Safety Alert: {event.get('event_type')}",
        body=message,
        data=event
    )
    
    # Display in UI
    display_safety_alert(event)
```

## Custom Alerts

Receive notifications when custom alert rules are triggered (geo-fence, altitude, callsign, etc.).

> 📘 User-Specific
>
> Alert events are sent to authenticated users only. Each user receives alerts for their own rules.

| Event | Trigger | Payload |
|----------|----------|----------|
| `alert:triggered` | Alert rule condition met | Alert object with rule and aircraft data |
| `alert:snapshot` | Initial state on subscription | List of active alerts |

### Alerts Example

```javascript JavaScript
socket.on('alert:triggered', (alert) => {
  console.log('Alert triggered:', alert.rule_name);
  
  // Show notification
  showNotification({
    title: alert.rule_name,
    body: `${alert.aircraft.flight || alert.aircraft.hex} - ${alert.message}`,
    icon: 'alert',
    data: alert
  });
  
  // Send push notification if enabled
  if (alert.rule.notification_channels.includes('push')) {
    sendPushNotification(alert);
  }
  
  // Log to alert history
  logAlert(alert);
});
```

```python Python
@sio.event
def alert_triggered(alert):
    print(f"Alert triggered: {alert.get('rule_name')}")
    
    aircraft = alert.get('aircraft', {})
    flight = aircraft.get('flight') or aircraft.get('hex')
    message = alert.get('message', '')
    
    # Send notification
    send_notification(
        title=alert.get('rule_name'),
        body=f"{flight} - {message}",
        data=alert
    )
    
    # Send push notification if enabled
    rule = alert.get('rule', {})
    if 'push' in rule.get('notification_channels', []):
        send_push_notification(alert)
    
    # Log to alert history
    log_alert(alert)
```

## Request Types

Make on-demand queries using the `request` event. All request types from the REST API are supported.

### Common Request Types

| Request Type | Parameters | Description |
|----------|----------|----------|
| `aircraft` | `icao` | Single aircraft by ICAO hex |
| `aircraft_list` | `military_only`, `category`, `min_altitude`, `max_altitude` | Filtered aircraft list |
| `aircraft-info` | `icao` | Detailed aircraft metadata (registration, type, operator) |
| `aircraft-info-bulk` | `icaos[]` | Bulk aircraft info for multiple hex codes |
| `aircraft-stats` | — | Live statistics (total, by type, by altitude, etc.) |
| `aircraft-snapshot` | — | Current aircraft snapshot (same as `aircraft:snapshot` event) |
| `photo` | `icao`, `thumbnail` | Aircraft photo URL from external sources |
| `sightings` | `hours`, `limit`, `offset`, `icao_hex`, `callsign` | Historical sightings with pagination |

### Advanced Request Types

| Request Type | Parameters | Description |
|----------|----------|----------|
| `safety-events` | `event_type`, `severity`, `hours`, `limit` | Historical safety events with filtering |
| `safety-event-detail` | `id` or `event_id` | Detailed event information |
| `safety-acknowledge` | `id` or `event_id` | Acknowledge safety event |
| `alert-rules` | — | User's alert rules |
| `acars-stats` | — | ACARS statistics |
| `metars` | `lat`, `lon`, `radius_nm`, `limit` | METARs within radius |
| `taf` | `lat`, `lon`, `radius_nm`, `limit` | TAFs within radius |
| `pireps` | `lat`, `lon`, `radius_nm`, `hours`, `limit` | Pilot reports within radius and time |
| `airports` | `lat`, `lon`, `radius_nm`, `limit` | Airports within radius |
| `navaids` | `lat`, `lon`, `radius_nm`, `limit` | Navaids within radius |

### Request Example

```javascript JavaScript
// Request aircraft info
const requestId = `req_${Date.now()}`;
socket.emit('request', {
  type: 'aircraft-info',
  request_id: requestId,
  params: { icao: 'A1B2C3' }
});

socket.on('response', (data) => {
  if (data.request_id === requestId) {
    console.log('Aircraft info:', data.data);
  }
});

// Request sightings with pagination
const sightingsId = `req_${Date.now()}`;
socket.emit('request', {
  type: 'sightings',
  request_id: sightingsId,
  params: {
    hours: 24,
    limit: 50,
    offset: 0,
    icao_hex: 'A1B2C3'
  }
});
```

```python Python
import uuid

# Request aircraft info
request_id = f"req_{uuid.uuid4().hex}"
sio.emit('request', {
    'type': 'aircraft-info',
    'request_id': request_id,
    'params': {'icao': 'A1B2C3'}
})

@sio.event
def response(data):
    if data.get('request_id') == request_id:
        print('Aircraft info:', data.get('data'))

# Request sightings with pagination
sightings_id = f"req_{uuid.uuid4().hex}"
sio.emit('request', {
    'type': 'sightings',
    'request_id': sightings_id,
    'params': {
        'hours': 24,
        'limit': 50,
        'offset': 0,
        'icao_hex': 'A1B2C3'
    }
})
```

## Statistics

Subscribe to the `stats` topic for live analytics updates.

```javascript JavaScript
socket.on('stats:update', (stats) => {
  updateDashboard({
    total: stats.total_aircraft,
    military: stats.military_count,
    commercial: stats.commercial_count,
    avgAltitude: stats.avg_altitude,
    maxDistance: stats.max_distance_nm
  });
});
```

```python Python
@sio.event
def stats_update(stats):
    update_dashboard(
        total=stats.get('total_aircraft'),
        military=stats.get('military_count'),
        commercial=stats.get('commercial_count'),
        avg_altitude=stats.get('avg_altitude'),
        max_distance=stats.get('max_distance_nm')
    )
```

## Next Steps

> 📘 Explore More Features
>
> - [Specialized Namespaces](/docs/socketio-specialized-namespaces) - Audio and Cannonball namespaces\n- [Client Implementation](/docs/socketio-client-implementation) - Complete examples\n- [Troubleshooting](/docs/socketio-troubleshooting) - Common issues and solutions
