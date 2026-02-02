---
title: "Client Implementation"
slug: "socketio-client-implementation"
excerpt: "Complete JavaScript and Python client examples with best practices"
hidden: false
---

# Client Implementation

Complete, production-ready examples for implementing SkySpy Socket.IO clients in JavaScript and Python.

## JavaScript Client

Full-featured JavaScript client with reconnection, error handling, and request helpers.

### Installation

[block:code]
{
  "codes": [
    {
      "code": "npm install socket.io-client",
      "language": "bash",
      "name": "npm"
    },
    {
      "code": "yarn add socket.io-client",
      "language": "bash",
      "name": "yarn"
    }
  ]
}
[/block]

### Complete Client Class

[block:code]
{
  "codes": [
    {
      "code": "import { io } from 'socket.io-client';\n\nclass SkySpyClient {\n  constructor(url, token, options = {}) {\n    this.url = url;\n    this.token = token;\n    this.aircraft = new Map();\n    this.pendingRequests = new Map();\n    this.listeners = new Map();\n    \n    this.socket = io(url, {\n      path: '/socket.io',\n      auth: { token },\n      transports: ['websocket'],\n      reconnection: true,\n      reconnectionDelay: 1000,\n      reconnectionDelayMax: 30000,\n      reconnectionAttempts: Infinity,\n      randomizationFactor: 0.3,\n      ...options\n    });\n\n    this.setupListeners();\n  }\n\n  setupListeners() {\n    // Connection events\n    this.socket.on('connect', () => {\n      console.log('✓ Connected:', this.socket.id);\n      this.emit('connect');\n    });\n\n    this.socket.on('connect_error', (error) => {\n      console.error('✗ Connection error:', error.message);\n      this.emit('error', error);\n    });\n\n    this.socket.on('disconnect', (reason) => {\n      console.warn('⚠ Disconnected:', reason);\n      this.emit('disconnect', reason);\n    });\n\n    // Subscription events\n    this.socket.on('subscribed', (data) => {\n      console.log('✓ Subscribed:', data.topics);\n      if (data.denied && data.denied.length > 0) {\n        console.warn('⚠ Permission denied:', data.denied);\n      }\n      this.emit('subscribed', data);\n    });\n\n    this.socket.on('unsubscribed', (data) => {\n      console.log('✓ Unsubscribed:', data.topics);\n      this.emit('unsubscribed', data);\n    });\n\n    // Request/Response\n    this.socket.on('response', (data) => {\n      const { request_id, data: responseData } = data;\n      const pending = this.pendingRequests.get(request_id);\n      if (pending) {\n        clearTimeout(pending.timeout);\n        pending.resolve(responseData);\n        this.pendingRequests.delete(request_id);\n      }\n    });\n\n    this.socket.on('error', (data) => {\n      const { request_id, message } = data;\n      if (request_id) {\n        const pending = this.pendingRequests.get(request_id);\n        if (pending) {\n          clearTimeout(pending.timeout);\n          pending.reject(new Error(message || 'Request failed'));\n          this.pendingRequests.delete(request_id);\n        }\n      } else {\n        console.error('Error:', message);\n        this.emit('error', new Error(message));\n      }\n    });\n\n    // Aircraft events\n    this.socket.on('aircraft:snapshot', (data) => {\n      data.aircraft.forEach(ac => this.aircraft.set(ac.hex, ac));\n      this.emit('aircraft:snapshot', data);\n    });\n\n    this.socket.on('aircraft:update', (aircraft) => {\n      const list = Array.isArray(aircraft) ? aircraft : [aircraft];\n      list.forEach(ac => this.aircraft.set(ac.hex, ac));\n      this.emit('aircraft:update', list);\n    });\n\n    this.socket.on('aircraft:new', (aircraft) => {\n      this.aircraft.set(aircraft.hex, aircraft);\n      this.emit('aircraft:new', aircraft);\n    });\n\n    this.socket.on('aircraft:remove', (data) => {\n      this.aircraft.delete(data.hex);\n      this.emit('aircraft:remove', data);\n    });\n\n    this.socket.on('aircraft:delta', (delta) => {\n      const existing = this.aircraft.get(delta.hex);\n      if (existing) {\n        Object.assign(existing, delta);\n        this.emit('aircraft:delta', delta);\n      }\n    });\n\n    // Safety events\n    this.socket.on('safety:snapshot', (data) => {\n      this.emit('safety:snapshot', data);\n    });\n\n    this.socket.on('safety:event', (event) => {\n      this.emit('safety:event', event);\n    });\n\n    // Alert events\n    this.socket.on('alert:triggered', (alert) => {\n      this.emit('alert:triggered', alert);\n    });\n\n    // Batch events\n    this.socket.on('batch', (data) => {\n      data.messages.forEach(msg => {\n        const event = msg.type.replace(':', '_');\n        this.socket.emit(msg.type, msg.data);\n      });\n    });\n\n    // Stats events\n    this.socket.on('stats:update', (stats) => {\n      this.emit('stats:update', stats);\n    });\n\n    // ACARS events\n    this.socket.on('acars:message', (message) => {\n      this.emit('acars:message', message);\n    });\n  }\n\n  // Event emitter\n  on(event, callback) {\n    if (!this.listeners.has(event)) {\n      this.listeners.set(event, []);\n    }\n    this.listeners.get(event).push(callback);\n    return () => this.off(event, callback);\n  }\n\n  off(event, callback) {\n    const listeners = this.listeners.get(event);\n    if (listeners) {\n      const index = listeners.indexOf(callback);\n      if (index > -1) {\n        listeners.splice(index, 1);\n      }\n    }\n  }\n\n  emit(event, data) {\n    const listeners = this.listeners.get(event);\n    if (listeners) {\n      listeners.forEach(callback => callback(data));\n    }\n  }\n\n  // Subscription\n  subscribe(topics) {\n    this.socket.emit('subscribe', { topics });\n  }\n\n  unsubscribe(topics) {\n    this.socket.emit('unsubscribe', { topics });\n  }\n\n  // Request/Response with timeout\n  request(type, params = {}, timeout = 10000) {\n    return new Promise((resolve, reject) => {\n      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;\n      \n      const timeoutId = setTimeout(() => {\n        this.pendingRequests.delete(requestId);\n        reject(new Error(`Request timeout: ${type}`));\n      }, timeout);\n\n      this.pendingRequests.set(requestId, {\n        resolve,\n        reject,\n        timeout: timeoutId\n      });\n\n      this.socket.emit('request', { type, request_id: requestId, params });\n    });\n  }\n\n  // Convenience methods\n  getAircraft() {\n    return Array.from(this.aircraft.values());\n  }\n\n  getAircraftByHex(hex) {\n    return this.aircraft.get(hex);\n  }\n\n  disconnect() {\n    this.socket.disconnect();\n  }\n}\n\nexport default SkySpyClient;",
      "language": "javascript",
      "name": "skyspy-client.js"
    }
  ]
}
[/block]

### Usage Example

[block:code]
{
  "codes": [
    {
      "code": "import SkySpyClient from './skyspy-client';\n\nconst client = new SkySpyClient(\n  'https://skyspy.example.com',\n  'your_token_here'\n);\n\n// Listen for connection\nclient.on('connect', () => {\n  console.log('Connected!');\n  \n  // Subscribe to topics\n  client.subscribe(['aircraft', 'safety', 'alerts']);\n});\n\n// Listen for aircraft updates\nclient.on('aircraft:snapshot', (data) => {\n  console.log(`Snapshot: ${data.count} aircraft`);\n  renderMap(client.getAircraft());\n});\n\nclient.on('aircraft:update', (aircraft) => {\n  console.log(`Update: ${aircraft.length} aircraft`);\n  renderMap(client.getAircraft());\n});\n\nclient.on('aircraft:new', (aircraft) => {\n  console.log(`New: ${aircraft.flight || aircraft.hex}`);\n});\n\n// Listen for safety events\nclient.on('safety:event', (event) => {\n  console.warn(`Safety: ${event.severity} - ${event.message}`);\n  showAlert(event);\n});\n\n// Listen for custom alerts\nclient.on('alert:triggered', (alert) => {\n  console.log(`Alert: ${alert.rule_name}`);\n  showNotification(alert);\n});\n\n// Make requests\nasync function getAircraftInfo(icao) {\n  try {\n    const info = await client.request('aircraft-info', { icao });\n    console.log('Aircraft info:', info);\n    return info;\n  } catch (error) {\n    console.error('Request failed:', error.message);\n  }\n}\n\n// Get sightings\nasync function getSightings() {\n  try {\n    const sightings = await client.request('sightings', {\n      hours: 24,\n      limit: 50\n    });\n    console.log('Sightings:', sightings);\n    return sightings;\n  } catch (error) {\n    console.error('Request failed:', error.message);\n  }\n}\n\n// Clean up on page unload\nwindow.addEventListener('beforeunload', () => {\n  client.disconnect();\n});",
      "language": "javascript",
      "name": "example.js"
    }
  ]
}
[/block]

## Python Client

Full-featured Python client with async/await support and type hints.

### Installation

[block:code]
{
  "codes": [
    {
      "code": "pip install python-socketio[client] aiohttp",
      "language": "bash",
      "name": "pip"
    }
  ]
}
[/block]

### Complete Client Class

[block:code]
{
  "codes": [
    {
      "code": "import asyncio\nimport logging\nimport uuid\nfrom typing import Any, Callable, Dict, List, Optional\nimport socketio\n\nlogger = logging.getLogger(__name__)\n\nclass SkySpyClient:\n    \"\"\"SkySpy Socket.IO client with async/await support.\"\"\"\n    \n    def __init__(self, url: str, token: str, **kwargs):\n        self.url = url\n        self.token = token\n        self.aircraft: Dict[str, dict] = {}\n        self.pending_requests: Dict[str, asyncio.Future] = {}\n        self.listeners: Dict[str, List[Callable]] = {}\n        \n        self.sio = socketio.AsyncClient(\n            reconnection=True,\n            reconnection_delay=1,\n            reconnection_delay_max=30,\n            **kwargs\n        )\n        \n        self._setup_listeners()\n    \n    def _setup_listeners(self):\n        \"\"\"Setup Socket.IO event listeners.\"\"\"\n        \n        @self.sio.event\n        async def connect():\n            logger.info(f'✓ Connected: {self.sio.sid}')\n            await self._emit('connect')\n        \n        @self.sio.event\n        async def connect_error(data):\n            logger.error(f'✗ Connection error: {data}')\n            await self._emit('error', Exception(str(data)))\n        \n        @self.sio.event\n        async def disconnect():\n            logger.warning('⚠ Disconnected')\n            await self._emit('disconnect')\n        \n        @self.sio.event\n        async def subscribed(data):\n            logger.info(f\"✓ Subscribed: {data.get('topics')}\")\n            if data.get('denied'):\n                logger.warning(f\"⚠ Permission denied: {data.get('denied')}\")\n            await self._emit('subscribed', data)\n        \n        @self.sio.event\n        async def unsubscribed(data):\n            logger.info(f\"✓ Unsubscribed: {data.get('topics')}\")\n            await self._emit('unsubscribed', data)\n        \n        @self.sio.event\n        async def response(data):\n            request_id = data.get('request_id')\n            if request_id in self.pending_requests:\n                future = self.pending_requests.pop(request_id)\n                future.set_result(data.get('data', data))\n        \n        @self.sio.event\n        async def error(data):\n            request_id = data.get('request_id')\n            message = data.get('message', 'Request failed')\n            \n            if request_id and request_id in self.pending_requests:\n                future = self.pending_requests.pop(request_id)\n                future.set_exception(Exception(message))\n            else:\n                logger.error(f'Error: {message}')\n                await self._emit('error', Exception(message))\n        \n        @self.sio.event\n        async def aircraft_snapshot(data):\n            for ac in data.get('aircraft', []):\n                self.aircraft[ac['hex']] = ac\n            await self._emit('aircraft:snapshot', data)\n        \n        @self.sio.event\n        async def aircraft_update(aircraft):\n            aircraft_list = aircraft if isinstance(aircraft, list) else [aircraft]\n            for ac in aircraft_list:\n                self.aircraft[ac['hex']] = ac\n            await self._emit('aircraft:update', aircraft_list)\n        \n        @self.sio.event\n        async def aircraft_new(aircraft):\n            self.aircraft[aircraft['hex']] = aircraft\n            await self._emit('aircraft:new', aircraft)\n        \n        @self.sio.event\n        async def aircraft_remove(data):\n            hex_code = data.get('hex')\n            self.aircraft.pop(hex_code, None)\n            await self._emit('aircraft:remove', data)\n        \n        @self.sio.event\n        async def aircraft_delta(delta):\n            hex_code = delta.get('hex')\n            if hex_code in self.aircraft:\n                self.aircraft[hex_code].update(delta)\n                await self._emit('aircraft:delta', delta)\n        \n        @self.sio.event\n        async def safety_snapshot(data):\n            await self._emit('safety:snapshot', data)\n        \n        @self.sio.event\n        async def safety_event(event):\n            await self._emit('safety:event', event)\n        \n        @self.sio.event\n        async def alert_triggered(alert):\n            await self._emit('alert:triggered', alert)\n        \n        @self.sio.event\n        async def batch(data):\n            for msg in data.get('messages', []):\n                event_name = msg.get('type', '').replace(':', '_')\n                if hasattr(self.sio, event_name):\n                    await getattr(self.sio, event_name)(msg.get('data', msg))\n        \n        @self.sio.event\n        async def stats_update(stats):\n            await self._emit('stats:update', stats)\n        \n        @self.sio.event\n        async def acars_message(message):\n            await self._emit('acars:message', message)\n    \n    async def connect(self):\n        \"\"\"Connect to the server.\"\"\"\n        await self.sio.connect(\n            self.url,\n            socketio_path='/socket.io',\n            auth={'token': self.token},\n            transports=['websocket']\n        )\n    \n    async def disconnect(self):\n        \"\"\"Disconnect from the server.\"\"\"\n        await self.sio.disconnect()\n    \n    def on(self, event: str, callback: Callable) -> Callable:\n        \"\"\"Register an event listener.\"\"\"\n        if event not in self.listeners:\n            self.listeners[event] = []\n        self.listeners[event].append(callback)\n        \n        def remove():\n            self.off(event, callback)\n        return remove\n    \n    def off(self, event: str, callback: Callable):\n        \"\"\"Remove an event listener.\"\"\"\n        if event in self.listeners:\n            try:\n                self.listeners[event].remove(callback)\n            except ValueError:\n                pass\n    \n    async def _emit(self, event: str, data: Any = None):\n        \"\"\"Emit an event to registered listeners.\"\"\"\n        if event in self.listeners:\n            for callback in self.listeners[event]:\n                if asyncio.iscoroutinefunction(callback):\n                    await callback(data)\n                else:\n                    callback(data)\n    \n    async def subscribe(self, topics: List[str]):\n        \"\"\"Subscribe to topics.\"\"\"\n        await self.sio.emit('subscribe', {'topics': topics})\n    \n    async def unsubscribe(self, topics: List[str]):\n        \"\"\"Unsubscribe from topics.\"\"\"\n        await self.sio.emit('unsubscribe', {'topics': topics})\n    \n    async def request(\n        self,\n        req_type: str,\n        params: Optional[Dict] = None,\n        timeout: float = 10.0\n    ) -> Any:\n        \"\"\"Make a request with timeout.\"\"\"\n        request_id = f\"req_{uuid.uuid4().hex}\"\n        future = asyncio.Future()\n        self.pending_requests[request_id] = future\n        \n        await self.sio.emit('request', {\n            'type': req_type,\n            'request_id': request_id,\n            'params': params or {}\n        })\n        \n        try:\n            return await asyncio.wait_for(future, timeout=timeout)\n        except asyncio.TimeoutError:\n            self.pending_requests.pop(request_id, None)\n            raise TimeoutError(f'Request timeout: {req_type}')\n    \n    def get_aircraft(self) -> List[dict]:\n        \"\"\"Get all aircraft.\"\"\"\n        return list(self.aircraft.values())\n    \n    def get_aircraft_by_hex(self, hex_code: str) -> Optional[dict]:\n        \"\"\"Get aircraft by hex code.\"\"\"\n        return self.aircraft.get(hex_code)\n    \n    async def wait(self):\n        \"\"\"Wait indefinitely (blocks until disconnect).\"\"\"\n        await self.sio.wait()",
      "language": "python",
      "name": "skyspy_client.py"
    }
  ]
}
[/block]

### Usage Example

[block:code]
{
  "codes": [
    {
      "code": "import asyncio\nimport logging\nfrom skyspy_client import SkySpyClient\n\nlogging.basicConfig(level=logging.INFO)\nlogger = logging.getLogger(__name__)\n\nasync def main():\n    client = SkySpyClient(\n        'https://skyspy.example.com',\n        'your_token_here'\n    )\n    \n    # Register event listeners\n    @client.on('connect')\n    async def on_connect(data):\n        logger.info('Connected!')\n        await client.subscribe(['aircraft', 'safety', 'alerts'])\n    \n    @client.on('aircraft:snapshot')\n    async def on_aircraft_snapshot(data):\n        logger.info(f\"Snapshot: {data.get('count')} aircraft\")\n        render_map(client.get_aircraft())\n    \n    @client.on('aircraft:update')\n    async def on_aircraft_update(aircraft):\n        logger.info(f\"Update: {len(aircraft)} aircraft\")\n        render_map(client.get_aircraft())\n    \n    @client.on('aircraft:new')\n    async def on_aircraft_new(aircraft):\n        flight = aircraft.get('flight') or aircraft.get('hex')\n        logger.info(f\"New: {flight}\")\n    \n    @client.on('safety:event')\n    async def on_safety_event(event):\n        severity = event.get('severity', 'unknown')\n        message = event.get('message', '')\n        logger.warning(f\"Safety: {severity} - {message}\")\n        show_alert(event)\n    \n    @client.on('alert:triggered')\n    async def on_alert_triggered(alert):\n        logger.info(f\"Alert: {alert.get('rule_name')}\")\n        show_notification(alert)\n    \n    # Connect\n    await client.connect()\n    \n    # Make some requests\n    try:\n        info = await client.request('aircraft-info', {'icao': 'A1B2C3'})\n        logger.info(f\"Aircraft info: {info}\")\n        \n        sightings = await client.request('sightings', {\n            'hours': 24,\n            'limit': 50\n        })\n        logger.info(f\"Sightings: {len(sightings)}\")\n    except Exception as e:\n        logger.error(f\"Request failed: {e}\")\n    \n    # Wait indefinitely\n    try:\n        await client.wait()\n    except KeyboardInterrupt:\n        logger.info('Disconnecting...')\n        await client.disconnect()\n\nif __name__ == '__main__':\n    asyncio.run(main())",
      "language": "python",
      "name": "example.py"
    }
  ]
}
[/block]

## Best Practices

[block:callout]
{
  "type": "success",
  "title": "Production Guidelines",
  "body": "Follow these best practices for robust client implementations:"
}
[/block]

### Connection Management

[block:parameters]
{
  "data": {
    "h-0": "Practice",
    "h-1": "Rationale",
    "h-2": "Implementation",
    "0-0": "**Always use TLS**",
    "0-1": "Secure credentials and data in transit",
    "0-2": "Use `https://` URLs in production",
    "1-0": "**Handle reconnection**",
    "1-1": "Networks are unreliable; clients should auto-reconnect",
    "1-2": "Enable `reconnection: true` (default)",
    "2-0": "**Resubscribe on reconnect**",
    "2-1": "Subscriptions are not persisted across connections",
    "2-2": "Call `subscribe()` in `connect` handler",
    "3-0": "**Use WebSocket transport**",
    "3-1": "Avoid polling overhead; lower latency",
    "3-2": "Set `transports: ['websocket']`",
    "4-0": "**Handle token expiry**",
    "4-1": "JWT tokens expire; refresh and reconnect",
    "4-2": "Catch auth errors, refresh token, reconnect"
  },
  "cols": 3,
  "rows": 5
}
[/block]

### Error Handling

[block:parameters]
{
  "data": {
    "h-0": "Practice",
    "h-1": "Rationale",
    "h-2": "Implementation",
    "0-0": "**Timeout requests**",
    "0-1": "Prevent hanging requests",
    "0-2": "Use timeout in `request()` helper",
    "1-0": "**Handle request errors**",
    "1-1": "Requests can fail (not found, permission denied, etc.)",
    "1-2": "Catch exceptions, show user-friendly errors",
    "2-0": "**Log errors**",
    "2-1": "Essential for debugging production issues",
    "2-2": "Use logging library, send to monitoring service",
    "3-0": "**Graceful degradation**",
    "3-1": "App should work with stale data during outages",
    "3-2": "Show offline indicator, cache data locally"
  },
  "cols": 3,
  "rows": 4
}
[/block]

### Performance

[block:parameters]
{
  "data": {
    "h-0": "Practice",
    "h-1": "Rationale",
    "h-2": "Implementation",
    "0-0": "**Throttle UI updates**",
    "0-1": "High-frequency updates can overwhelm rendering",
    "0-2": "Use `requestAnimationFrame()` or debouncing",
    "1-0": "**Subscribe selectively**",
    "1-1": "Reduces bandwidth and processing",
    "1-2": "Only subscribe to topics you need",
    "2-0": "**Use delta updates**",
    "2-1": "Smaller payloads, faster processing",
    "2-2": "Handle `aircraft:delta` events",
    "3-0": "**Batch map updates**",
    "3-1": "Avoid redrawing map for each aircraft",
    "3-2": "Collect updates, redraw once per frame"
  },
  "cols": 3,
  "rows": 4
}
[/block]

### Security

[block:parameters]
{
  "data": {
    "h-0": "Practice",
    "h-1": "Rationale",
    "h-2": "Implementation",
    "0-0": "**Never log tokens**",
    "0-1": "Prevents token leakage in logs",
    "0-2": "Redact auth object in debug logs",
    "1-0": "**Use auth object**",
    "1-1": "Tokens in query strings are often logged",
    "1-2": "Pass `auth: { token }` in Socket.IO options",
    "2-0": "**Store tokens securely**",
    "2-1": "Prevent XSS attacks from stealing tokens",
    "2-2": "Use `httpOnly` cookies or secure storage",
    "3-0": "**Validate inputs**",
    "3-1": "Prevent injection attacks",
    "3-2": "Validate user inputs before sending requests"
  },
  "cols": 3,
  "rows": 4
}
[/block]

## Testing

### Unit Tests

[block:code]
{
  "codes": [
    {
      "code": "import { describe, it, expect, vi, beforeEach } from 'vitest';\nimport { io } from 'socket.io-client';\nimport SkySpyClient from './skyspy-client';\n\nvi.mock('socket.io-client');\n\ndescribe('SkySpyClient', () => {\n  let client;\n  let mockSocket;\n\n  beforeEach(() => {\n    mockSocket = {\n      on: vi.fn(),\n      emit: vi.fn(),\n      disconnect: vi.fn(),\n      id: 'test-socket-id'\n    };\n    io.mockReturnValue(mockSocket);\n    client = new SkySpyClient('https://test.com', 'test-token');\n  });\n\n  it('should connect with correct options', () => {\n    expect(io).toHaveBeenCalledWith(\n      'https://test.com',\n      expect.objectContaining({\n        path: '/socket.io',\n        auth: { token: 'test-token' },\n        transports: ['websocket']\n      })\n    );\n  });\n\n  it('should subscribe to topics', () => {\n    client.subscribe(['aircraft', 'safety']);\n    expect(mockSocket.emit).toHaveBeenCalledWith('subscribe', {\n      topics: ['aircraft', 'safety']\n    });\n  });\n\n  it('should handle aircraft snapshot', () => {\n    const callback = vi.fn();\n    client.on('aircraft:snapshot', callback);\n    \n    const snapshot = {\n      aircraft: [\n        { hex: 'A1B2C3', lat: 37.7749, lon: -122.4194 },\n        { hex: 'D4E5F6', lat: 37.8044, lon: -122.2712 }\n      ],\n      count: 2,\n      timestamp: '2024-01-15T10:30:00Z'\n    };\n    \n    // Simulate snapshot event\n    const snapshotHandler = mockSocket.on.mock.calls.find(\n      call => call[0] === 'aircraft:snapshot'\n    )[1];\n    snapshotHandler(snapshot);\n    \n    expect(callback).toHaveBeenCalledWith(snapshot);\n    expect(client.getAircraft()).toHaveLength(2);\n  });\n});",
      "language": "javascript",
      "name": "skyspy-client.test.js"
    }
  ]
}
[/block]

## Next Steps

[block:callout]
{
  "type": "info",
  "title": "Additional Resources",
  "body": "- [Troubleshooting](/docs/socketio-troubleshooting) - Debugging tips and common issues\n- [Main Namespace](/docs/socketio-main-namespace) - Complete API reference\n- [Specialized Namespaces](/docs/socketio-specialized-namespaces) - Audio and Cannonball features"
}
[/block]
