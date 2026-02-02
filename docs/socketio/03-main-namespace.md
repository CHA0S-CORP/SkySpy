---
title: Main Namespace
slug: socketio-main-namespace
category:
  uri: uri-that-does-not-map-to-api-reference
position: 3
content:
  excerpt: >-
    Aircraft tracking, safety events, alerts, and statistics on the default
    Socket.IO namespace
privacy:
  view: public
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

[block:parameters]
{
  "data": {
    "h-0": "Topic",
    "h-1": "Description",
    "h-2": "Events",
    "h-3": "Use Case",
    "0-0": "`aircraft`",
    "0-1": "Position and state updates",
    "0-2": "`aircraft:*`",
    "0-3": "Real-time tracking map",
    "1-0": "`safety`",
    "1-1": "Safety events (TCAS, emergencies, conflicts)",
    "1-2": "`safety:*`",
    "1-3": "Safety monitoring dashboard",
    "2-0": "`stats`",
    "2-1": "Live statistics and metrics",
    "2-2": "`stats:*`",
    "2-3": "Analytics widgets",
    "3-0": "`alerts`",
    "3-1": "Custom alert rule triggers",
    "3-2": "`alert:*`",
    "3-3": "Personalized notifications",
    "4-0": "`acars`",
    "4-1": "ACARS datalink messages",
    "4-2": "`acars:*`",
    "4-3": "Message decoding",
    "5-0": "`airspace`",
    "5-1": "Airspace advisories and boundaries",
    "5-2": "`airspace:*`",
    "5-3": "Flight planning",
    "6-0": "`notams`",
    "6-1": "NOTAMs and TFRs",
    "6-2": "`notams:*`",
    "6-3": "Airspace restrictions",
    "7-0": "`all`",
    "7-1": "All of the above",
    "7-2": "All events",
    "7-3": "Comprehensive monitoring"
  },
  "cols": 4,
  "rows": 8
}
[/block]

### Subscribe Example

[block:code]
{
  "codes": [
    {
      "code": "// Subscribe to specific topics\nsocket.emit('subscribe', { \n  topics: ['aircraft', 'safety', 'alerts'] \n});\n\nsocket.on('subscribed', (data) => {\n  console.log('Subscribed to:', data.topics);\n  console.log('Successfully joined:', data.joined);\n  if (data.denied) {\n    console.warn('Permission denied for:', data.denied);\n  }\n});",
      "language": "javascript",
      "name": "JavaScript"
    },
    {
      "code": "# Subscribe to specific topics\nsio.emit('subscribe', {\n    'topics': ['aircraft', 'safety', 'alerts']\n})\n\n@sio.event\ndef subscribed(data):\n    print('Subscribed to:', data.get('topics'))\n    print('Successfully joined:', data.get('joined'))\n    if data.get('denied'):\n        print('Permission denied for:', data.get('denied'))",
      "language": "python",
      "name": "Python"
    }
  ]
}
[/block]

## Aircraft Events

Track aircraft positions in real-time with snapshot, update, new, and remove events.

[block:parameters]
{
  "data": {
    "h-0": "Event",
    "h-1": "Trigger",
    "h-2": "Payload",
    "h-3": "Frequency",
    "0-0": "`aircraft:snapshot`",
    "0-1": "On connect / request",
    "0-2": "`{ aircraft[], count, timestamp }`",
    "0-3": "Once on connect",
    "1-0": "`aircraft:update`",
    "1-1": "Periodic updates",
    "1-2": "Full or batched aircraft list",
    "1-3": "~10 Hz (rate-limited)",
    "2-0": "`aircraft:new`",
    "2-1": "New detection",
    "2-2": "Single aircraft object",
    "2-3": "As detected",
    "3-0": "`aircraft:remove`",
    "3-1": "Timeout / out of range",
    "3-2": "`{ hex, reason? }`",
    "3-3": "As removed",
    "4-0": "`aircraft:delta`",
    "4-1": "Position change (if enabled)",
    "4-2": "Delta object with `hex` and changed fields",
    "4-3": "~10 Hz (rate-limited)",
    "5-0": "`aircraft:heartbeat`",
    "5-1": "Keepalive",
    "5-2": "`{ count, timestamp }`",
    "5-3": "Every 30-60s"
  },
  "cols": 4,
  "rows": 6
}
[/block]

### Aircraft Payload Fields

[block:parameters]
{
  "data": {
    "h-0": "Field",
    "h-1": "Type",
    "h-2": "Description",
    "h-3": "Example",
    "0-0": "`hex`",
    "0-1": "string",
    "0-2": "ICAO 24-bit address (unique identifier)",
    "0-3": "`\"A1B2C3\"`",
    "1-0": "`flight`",
    "1-1": "string",
    "1-2": "Callsign (trimmed)",
    "1-3": "`\"UAL123\"`",
    "2-0": "`lat`",
    "2-1": "number",
    "2-2": "Latitude in decimal degrees",
    "2-3": "`37.7749`",
    "3-0": "`lon`",
    "3-1": "number",
    "3-2": "Longitude in decimal degrees",
    "3-3": "`-122.4194`",
    "4-0": "`alt_baro`",
    "4-1": "number",
    "4-2": "Barometric altitude in feet",
    "4-3": "`35000`",
    "5-0": "`alt_geom`",
    "5-1": "number",
    "5-2": "Geometric (GNSS) altitude in feet",
    "5-3": "`35125`",
    "6-0": "`gs`",
    "6-1": "number",
    "6-2": "Ground speed in knots",
    "6-3": "`450.5`",
    "7-0": "`track`",
    "7-1": "number",
    "7-2": "Track angle in degrees (0-359)",
    "7-3": "`270.5`",
    "8-0": "`squawk`",
    "8-1": "string",
    "8-2": "Mode A squawk code",
    "8-3": "`\"1200\"`",
    "9-0": "`category`",
    "9-1": "string",
    "9-2": "Aircraft category (e.g., A3=large)",
    "9-3": "`\"A3\"`",
    "10-0": "`distance_nm`",
    "10-1": "number",
    "10-2": "Distance from receiver in nautical miles",
    "10-3": "`12.5`",
    "11-0": "`seen`",
    "11-1": "number",
    "11-2": "Seconds since last message",
    "11-3": "`2.3`",
    "12-0": "`rssi`",
    "12-1": "number",
    "12-2": "Received signal strength indicator (dBFS)",
    "12-3": "`-15.2`"
  },
  "cols": 4,
  "rows": 13
}
[/block]

### Aircraft Events Example

[block:code]
{
  "codes": [
    {
      "code": "const aircraftMap = new Map();\n\nsocket.on('aircraft:snapshot', (data) => {\n  console.log(`Initial snapshot: ${data.count} aircraft`);\n  data.aircraft.forEach(ac => {\n    aircraftMap.set(ac.hex, ac);\n  });\n  renderMap(aircraftMap);\n});\n\nsocket.on('aircraft:update', (aircraft) => {\n  // Update or add aircraft\n  if (Array.isArray(aircraft)) {\n    aircraft.forEach(ac => aircraftMap.set(ac.hex, ac));\n  } else {\n    aircraftMap.set(aircraft.hex, aircraft);\n  }\n  renderMap(aircraftMap);\n});\n\nsocket.on('aircraft:new', (aircraft) => {\n  console.log(`New aircraft: ${aircraft.flight || aircraft.hex}`);\n  aircraftMap.set(aircraft.hex, aircraft);\n  renderMap(aircraftMap);\n});\n\nsocket.on('aircraft:remove', (data) => {\n  console.log(`Removed: ${data.hex} (${data.reason || 'timeout'})`);\n  aircraftMap.delete(data.hex);\n  renderMap(aircraftMap);\n});\n\nsocket.on('aircraft:delta', (delta) => {\n  // Merge delta into existing aircraft\n  const existing = aircraftMap.get(delta.hex);\n  if (existing) {\n    Object.assign(existing, delta);\n    renderMap(aircraftMap);\n  }\n});",
      "language": "javascript",
      "name": "JavaScript"
    },
    {
      "code": "aircraft_map = {}\n\n@sio.event\ndef aircraft_snapshot(data):\n    print(f\"Initial snapshot: {data.get('count')} aircraft\")\n    for ac in data.get('aircraft', []):\n        aircraft_map[ac['hex']] = ac\n    render_map(aircraft_map)\n\n@sio.event\ndef aircraft_update(aircraft):\n    # Update or add aircraft\n    if isinstance(aircraft, list):\n        for ac in aircraft:\n            aircraft_map[ac['hex']] = ac\n    else:\n        aircraft_map[aircraft['hex']] = aircraft\n    render_map(aircraft_map)\n\n@sio.event\ndef aircraft_new(aircraft):\n    print(f\"New aircraft: {aircraft.get('flight') or aircraft['hex']}\")\n    aircraft_map[aircraft['hex']] = aircraft\n    render_map(aircraft_map)\n\n@sio.event\ndef aircraft_remove(data):\n    hex_code = data.get('hex')\n    reason = data.get('reason', 'timeout')\n    print(f\"Removed: {hex_code} ({reason})\")\n    aircraft_map.pop(hex_code, None)\n    render_map(aircraft_map)\n\n@sio.event\ndef aircraft_delta(delta):\n    # Merge delta into existing aircraft\n    hex_code = delta.get('hex')\n    if hex_code in aircraft_map:\n        aircraft_map[hex_code].update(delta)\n        render_map(aircraft_map)",
      "language": "python",
      "name": "Python"
    }
  ]
}
[/block]

## Safety Events

Monitor safety-critical events like TCAS alerts, emergency squawks, and proximity conflicts.

[block:parameters]
{
  "data": {
    "h-0": "Event",
    "h-1": "Trigger",
    "h-2": "Payload",
    "0-0": "`safety:snapshot`",
    "0-1": "Initial state on subscription",
    "0-2": "`{ events[], count, timestamp }`",
    "1-0": "`safety:event`",
    "1-1": "New safety event detected",
    "1-2": "Single event object"
  },
  "cols": 3,
  "rows": 2
}
[/block]

### Safety Event Fields

[block:parameters]
{
  "data": {
    "h-0": "Field",
    "h-1": "Type",
    "h-2": "Description",
    "0-0": "`id`",
    "0-1": "string",
    "0-2": "Unique event ID",
    "1-0": "`event_type`",
    "1-1": "string",
    "1-2": "Event type: `tcas`, `emergency`, `conflict`, `low_altitude`, etc.",
    "2-0": "`severity`",
    "2-1": "string",
    "2-2": "Severity level: `critical`, `high`, `medium`, `low`",
    "3-0": "`icao_hex`",
    "3-1": "string",
    "3-2": "Aircraft ICAO hex code",
    "4-0": "`callsign`",
    "4-1": "string",
    "4-2": "Aircraft callsign",
    "5-0": "`message`",
    "5-1": "string",
    "5-2": "Human-readable description",
    "6-0": "`details`",
    "6-1": "object",
    "6-2": "Event-specific details (e.g., conflicting aircraft, altitude)",
    "7-0": "`timestamp`",
    "7-1": "string",
    "7-2": "ISO 8601 timestamp"
  },
  "cols": 3,
  "rows": 8
}
[/block]

### Safety Events Example

[block:code]
{
  "codes": [
    {
      "code": "socket.on('safety:snapshot', (data) => {\n  console.log(`Active safety events: ${data.count}`);\n  data.events.forEach(event => {\n    displaySafetyAlert(event);\n  });\n});\n\nsocket.on('safety:event', (event) => {\n  console.warn(`⚠️  ${event.severity.toUpperCase()}: ${event.message}`);\n  \n  // Play alert sound for critical events\n  if (event.severity === 'critical') {\n    playAlertSound();\n  }\n  \n  // Show notification\n  showNotification({\n    title: `Safety Alert: ${event.event_type}`,\n    body: event.message,\n    icon: 'warning',\n    data: event\n  });\n  \n  // Display in UI\n  displaySafetyAlert(event);\n});",
      "language": "javascript",
      "name": "JavaScript"
    },
    {
      "code": "@sio.event\ndef safety_snapshot(data):\n    print(f\"Active safety events: {data.get('count')}\")\n    for event in data.get('events', []):\n        display_safety_alert(event)\n\n@sio.event\ndef safety_event(event):\n    severity = event.get('severity', 'unknown').upper()\n    message = event.get('message', '')\n    print(f\"⚠️  {severity}: {message}\")\n    \n    # Play alert sound for critical events\n    if event.get('severity') == 'critical':\n        play_alert_sound()\n    \n    # Send notification\n    send_notification(\n        title=f\"Safety Alert: {event.get('event_type')}\",\n        body=message,\n        data=event\n    )\n    \n    # Display in UI\n    display_safety_alert(event)",
      "language": "python",
      "name": "Python"
    }
  ]
}
[/block]

## Custom Alerts

Receive notifications when custom alert rules are triggered (geo-fence, altitude, callsign, etc.).

> 📘 User-Specific
>
> Alert events are sent to authenticated users only. Each user receives alerts for their own rules.

[block:parameters]
{
  "data": {
    "h-0": "Event",
    "h-1": "Trigger",
    "h-2": "Payload",
    "0-0": "`alert:triggered`",
    "0-1": "Alert rule condition met",
    "0-2": "Alert object with rule and aircraft data",
    "1-0": "`alert:snapshot`",
    "1-1": "Initial state on subscription",
    "1-2": "List of active alerts"
  },
  "cols": 3,
  "rows": 2
}
[/block]

### Alerts Example

[block:code]
{
  "codes": [
    {
      "code": "socket.on('alert:triggered', (alert) => {\n  console.log('Alert triggered:', alert.rule_name);\n  \n  // Show notification\n  showNotification({\n    title: alert.rule_name,\n    body: `${alert.aircraft.flight || alert.aircraft.hex} - ${alert.message}`,\n    icon: 'alert',\n    data: alert\n  });\n  \n  // Send push notification if enabled\n  if (alert.rule.notification_channels.includes('push')) {\n    sendPushNotification(alert);\n  }\n  \n  // Log to alert history\n  logAlert(alert);\n});",
      "language": "javascript",
      "name": "JavaScript"
    },
    {
      "code": "@sio.event\ndef alert_triggered(alert):\n    print(f\"Alert triggered: {alert.get('rule_name')}\")\n    \n    aircraft = alert.get('aircraft', {})\n    flight = aircraft.get('flight') or aircraft.get('hex')\n    message = alert.get('message', '')\n    \n    # Send notification\n    send_notification(\n        title=alert.get('rule_name'),\n        body=f\"{flight} - {message}\",\n        data=alert\n    )\n    \n    # Send push notification if enabled\n    rule = alert.get('rule', {})\n    if 'push' in rule.get('notification_channels', []):\n        send_push_notification(alert)\n    \n    # Log to alert history\n    log_alert(alert)",
      "language": "python",
      "name": "Python"
    }
  ]
}
[/block]

## Request Types

Make on-demand queries using the `request` event. All request types from the REST API are supported.

### Common Request Types

[block:parameters]
{
  "data": {
    "h-0": "Request Type",
    "h-1": "Parameters",
    "h-2": "Description",
    "0-0": "`aircraft`",
    "0-1": "`icao`",
    "0-2": "Single aircraft by ICAO hex",
    "1-0": "`aircraft_list`",
    "1-1": "`military_only`, `category`, `min_altitude`, `max_altitude`",
    "1-2": "Filtered aircraft list",
    "2-0": "`aircraft-info`",
    "2-1": "`icao`",
    "2-2": "Detailed aircraft metadata (registration, type, operator)",
    "3-0": "`aircraft-info-bulk`",
    "3-1": "`icaos[]`",
    "3-2": "Bulk aircraft info for multiple hex codes",
    "4-0": "`aircraft-stats`",
    "4-1": "—",
    "4-2": "Live statistics (total, by type, by altitude, etc.)",
    "5-0": "`aircraft-snapshot`",
    "5-1": "—",
    "5-2": "Current aircraft snapshot (same as `aircraft:snapshot` event)",
    "6-0": "`photo`",
    "6-1": "`icao`, `thumbnail`",
    "6-2": "Aircraft photo URL from external sources",
    "7-0": "`sightings`",
    "7-1": "`hours`, `limit`, `offset`, `icao_hex`, `callsign`",
    "7-2": "Historical sightings with pagination"
  },
  "cols": 3,
  "rows": 8
}
[/block]

### Advanced Request Types

[block:parameters]
{
  "data": {
    "h-0": "Request Type",
    "h-1": "Parameters",
    "h-2": "Description",
    "0-0": "`safety-events`",
    "0-1": "`event_type`, `severity`, `hours`, `limit`",
    "0-2": "Historical safety events with filtering",
    "1-0": "`safety-event-detail`",
    "1-1": "`id` or `event_id`",
    "1-2": "Detailed event information",
    "2-0": "`safety-acknowledge`",
    "2-1": "`id` or `event_id`",
    "2-2": "Acknowledge safety event",
    "3-0": "`alert-rules`",
    "3-1": "—",
    "3-2": "User's alert rules",
    "4-0": "`acars-stats`",
    "4-1": "—",
    "4-2": "ACARS statistics",
    "5-0": "`metars`",
    "5-1": "`lat`, `lon`, `radius_nm`, `limit`",
    "5-2": "METARs within radius",
    "6-0": "`taf`",
    "6-1": "`lat`, `lon`, `radius_nm`, `limit`",
    "6-2": "TAFs within radius",
    "7-0": "`pireps`",
    "7-1": "`lat`, `lon`, `radius_nm`, `hours`, `limit`",
    "7-2": "Pilot reports within radius and time",
    "8-0": "`airports`",
    "8-1": "`lat`, `lon`, `radius_nm`, `limit`",
    "8-2": "Airports within radius",
    "9-0": "`navaids`",
    "9-1": "`lat`, `lon`, `radius_nm`, `limit`",
    "9-2": "Navaids within radius"
  },
  "cols": 3,
  "rows": 10
}
[/block]

### Request Example

[block:code]
{
  "codes": [
    {
      "code": "// Request aircraft info\nconst requestId = `req_${Date.now()}`;\nsocket.emit('request', {\n  type: 'aircraft-info',\n  request_id: requestId,\n  params: { icao: 'A1B2C3' }\n});\n\nsocket.on('response', (data) => {\n  if (data.request_id === requestId) {\n    console.log('Aircraft info:', data.data);\n  }\n});\n\n// Request sightings with pagination\nconst sightingsId = `req_${Date.now()}`;\nsocket.emit('request', {\n  type: 'sightings',\n  request_id: sightingsId,\n  params: {\n    hours: 24,\n    limit: 50,\n    offset: 0,\n    icao_hex: 'A1B2C3'\n  }\n});",
      "language": "javascript",
      "name": "JavaScript"
    },
    {
      "code": "import uuid\n\n# Request aircraft info\nrequest_id = f\"req_{uuid.uuid4().hex}\"\nsio.emit('request', {\n    'type': 'aircraft-info',\n    'request_id': request_id,\n    'params': {'icao': 'A1B2C3'}\n})\n\n@sio.event\ndef response(data):\n    if data.get('request_id') == request_id:\n        print('Aircraft info:', data.get('data'))\n\n# Request sightings with pagination\nsightings_id = f\"req_{uuid.uuid4().hex}\"\nsio.emit('request', {\n    'type': 'sightings',\n    'request_id': sightings_id,\n    'params': {\n        'hours': 24,\n        'limit': 50,\n        'offset': 0,\n        'icao_hex': 'A1B2C3'\n    }\n})",
      "language": "python",
      "name": "Python"
    }
  ]
}
[/block]

## Statistics

Subscribe to the `stats` topic for live analytics updates.

[block:code]
{
  "codes": [
    {
      "code": "socket.on('stats:update', (stats) => {\n  updateDashboard({\n    total: stats.total_aircraft,\n    military: stats.military_count,\n    commercial: stats.commercial_count,\n    avgAltitude: stats.avg_altitude,\n    maxDistance: stats.max_distance_nm\n  });\n});",
      "language": "javascript",
      "name": "JavaScript"
    },
    {
      "code": "@sio.event\ndef stats_update(stats):\n    update_dashboard(\n        total=stats.get('total_aircraft'),\n        military=stats.get('military_count'),\n        commercial=stats.get('commercial_count'),\n        avg_altitude=stats.get('avg_altitude'),\n        max_distance=stats.get('max_distance_nm')\n    )",
      "language": "python",
      "name": "Python"
    }
  ]
}
[/block]

## Next Steps

> 📘 Explore More Features
>
> - [Specialized Namespaces](/docs/socketio-specialized-namespaces) - Audio and Cannonball namespaces
> - [Client Implementation](/docs/socketio-client-implementation) - Complete examples
> - [Troubleshooting](/docs/socketio-troubleshooting) - Common issues and solutions
