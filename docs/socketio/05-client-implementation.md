---
title: Client Implementation
slug: socketio-client-implementation
excerpt: Complete JavaScript and Python client examples with best practices
---

# Client Implementation

Complete, production-ready examples for implementing SkySpy Socket.IO clients in JavaScript and Python.

## JavaScript Client

Full-featured JavaScript client with reconnection, error handling, and request helpers.

### Installation

```bash npm
npm install socket.io-client
```

```bash yarn
yarn add socket.io-client
```

### Complete Client Class

```javascript skyspy-client.js
import { io } from 'socket.io-client';

class SkySpyClient {
  constructor(url, token, options = {}) {
    this.url = url;
    this.token = token;
    this.aircraft = new Map();
    this.pendingRequests = new Map();
    this.listeners = new Map();
    
    this.socket = io(url, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      randomizationFactor: 0.3,
      ...options
    });

    this.setupListeners();
  }

  setupListeners() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('✓ Connected:', this.socket.id);
      this.emit('connect');
    });

    this.socket.on('connect_error', (error) => {
      console.error('✗ Connection error:', error.message);
      this.emit('error', error);
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('⚠ Disconnected:', reason);
      this.emit('disconnect', reason);
    });

    // Subscription events
    this.socket.on('subscribed', (data) => {
      console.log('✓ Subscribed:', data.topics);
      if (data.denied && data.denied.length > 0) {
        console.warn('⚠ Permission denied:', data.denied);
      }
      this.emit('subscribed', data);
    });

    this.socket.on('unsubscribed', (data) => {
      console.log('✓ Unsubscribed:', data.topics);
      this.emit('unsubscribed', data);
    });

    // Request/Response
    this.socket.on('response', (data) => {
      const { request_id, data: responseData } = data;
      const pending = this.pendingRequests.get(request_id);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(responseData);
        this.pendingRequests.delete(request_id);
      }
    });

    this.socket.on('error', (data) => {
      const { request_id, message } = data;
      if (request_id) {
        const pending = this.pendingRequests.get(request_id);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(message || 'Request failed'));
          this.pendingRequests.delete(request_id);
        }
      } else {
        console.error('Error:', message);
        this.emit('error', new Error(message));
      }
    });

    // Aircraft events
    this.socket.on('aircraft:snapshot', (data) => {
      data.aircraft.forEach(ac => this.aircraft.set(ac.hex, ac));
      this.emit('aircraft:snapshot', data);
    });

    this.socket.on('aircraft:update', (aircraft) => {
      const list = Array.isArray(aircraft) ? aircraft : [aircraft];
      list.forEach(ac => this.aircraft.set(ac.hex, ac));
      this.emit('aircraft:update', list);
    });

    this.socket.on('aircraft:new', (aircraft) => {
      this.aircraft.set(aircraft.hex, aircraft);
      this.emit('aircraft:new', aircraft);
    });

    this.socket.on('aircraft:remove', (data) => {
      this.aircraft.delete(data.hex);
      this.emit('aircraft:remove', data);
    });

    this.socket.on('aircraft:delta', (delta) => {
      const existing = this.aircraft.get(delta.hex);
      if (existing) {
        Object.assign(existing, delta);
        this.emit('aircraft:delta', delta);
      }
    });

    // Safety events
    this.socket.on('safety:snapshot', (data) => {
      this.emit('safety:snapshot', data);
    });

    this.socket.on('safety:event', (event) => {
      this.emit('safety:event', event);
    });

    // Alert events
    this.socket.on('alert:triggered', (alert) => {
      this.emit('alert:triggered', alert);
    });

    // Batch events
    this.socket.on('batch', (data) => {
      data.messages.forEach(msg => {
        const event = msg.type.replace(':', '_');
        this.socket.emit(msg.type, msg.data);
      });
    });

    // Stats events
    this.socket.on('stats:update', (stats) => {
      this.emit('stats:update', stats);
    });

    // ACARS events
    this.socket.on('acars:message', (message) => {
      this.emit('acars:message', message);
    });
  }

  // Event emitter
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  // Subscription
  subscribe(topics) {
    this.socket.emit('subscribe', { topics });
  }

  unsubscribe(topics) {
    this.socket.emit('unsubscribe', { topics });
  }

  // Request/Response with timeout
  request(type, params = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${type}`));
      }, timeout);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutId
      });

      this.socket.emit('request', { type, request_id: requestId, params });
    });
  }

  // Convenience methods
  getAircraft() {
    return Array.from(this.aircraft.values());
  }

  getAircraftByHex(hex) {
    return this.aircraft.get(hex);
  }

  disconnect() {
    this.socket.disconnect();
  }
}

export default SkySpyClient;
```

### Usage Example

```javascript example.js
import SkySpyClient from './skyspy-client';

const client = new SkySpyClient(
  'https://skyspy.example.com',
  'your_token_here'
);

// Listen for connection
client.on('connect', () => {
  console.log('Connected!');
  
  // Subscribe to topics
  client.subscribe(['aircraft', 'safety', 'alerts']);
});

// Listen for aircraft updates
client.on('aircraft:snapshot', (data) => {
  console.log(`Snapshot: ${data.count} aircraft`);
  renderMap(client.getAircraft());
});

client.on('aircraft:update', (aircraft) => {
  console.log(`Update: ${aircraft.length} aircraft`);
  renderMap(client.getAircraft());
});

client.on('aircraft:new', (aircraft) => {
  console.log(`New: ${aircraft.flight || aircraft.hex}`);
});

// Listen for safety events
client.on('safety:event', (event) => {
  console.warn(`Safety: ${event.severity} - ${event.message}`);
  showAlert(event);
});

// Listen for custom alerts
client.on('alert:triggered', (alert) => {
  console.log(`Alert: ${alert.rule_name}`);
  showNotification(alert);
});

// Make requests
async function getAircraftInfo(icao) {
  try {
    const info = await client.request('aircraft-info', { icao });
    console.log('Aircraft info:', info);
    return info;
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

// Get sightings
async function getSightings() {
  try {
    const sightings = await client.request('sightings', {
      hours: 24,
      limit: 50
    });
    console.log('Sightings:', sightings);
    return sightings;
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  client.disconnect();
});
```

## Python Client

Full-featured Python client with async/await support and type hints.

### Installation

```bash pip
pip install python-socketio[client] aiohttp
```

### Complete Client Class

```python skyspy_client.py
import asyncio
import logging
import uuid
from typing import Any, Callable, Dict, List, Optional
import socketio

logger = logging.getLogger(__name__)

class SkySpyClient:
    """SkySpy Socket.IO client with async/await support."""
    
    def __init__(self, url: str, token: str, **kwargs):
        self.url = url
        self.token = token
        self.aircraft: Dict[str, dict] = {}
        self.pending_requests: Dict[str, asyncio.Future] = {}
        self.listeners: Dict[str, List[Callable]] = {}
        
        self.sio = socketio.AsyncClient(
            reconnection=True,
            reconnection_delay=1,
            reconnection_delay_max=30,
            **kwargs
        )
        
        self._setup_listeners()
    
    def _setup_listeners(self):
        """Setup Socket.IO event listeners."""
        
        @self.sio.event
        async def connect():
            logger.info(f'✓ Connected: {self.sio.sid}')
            await self._emit('connect')
        
        @self.sio.event
        async def connect_error(data):
            logger.error(f'✗ Connection error: {data}')
            await self._emit('error', Exception(str(data)))
        
        @self.sio.event
        async def disconnect():
            logger.warning('⚠ Disconnected')
            await self._emit('disconnect')
        
        @self.sio.event
        async def subscribed(data):
            logger.info(f"✓ Subscribed: {data.get('topics')}")
            if data.get('denied'):
                logger.warning(f"⚠ Permission denied: {data.get('denied')}")
            await self._emit('subscribed', data)
        
        @self.sio.event
        async def unsubscribed(data):
            logger.info(f"✓ Unsubscribed: {data.get('topics')}")
            await self._emit('unsubscribed', data)
        
        @self.sio.event
        async def response(data):
            request_id = data.get('request_id')
            if request_id in self.pending_requests:
                future = self.pending_requests.pop(request_id)
                future.set_result(data.get('data', data))
        
        @self.sio.event
        async def error(data):
            request_id = data.get('request_id')
            message = data.get('message', 'Request failed')
            
            if request_id and request_id in self.pending_requests:
                future = self.pending_requests.pop(request_id)
                future.set_exception(Exception(message))
            else:
                logger.error(f'Error: {message}')
                await self._emit('error', Exception(message))
        
        @self.sio.event
        async def aircraft_snapshot(data):
            for ac in data.get('aircraft', []):
                self.aircraft[ac['hex']] = ac
            await self._emit('aircraft:snapshot', data)
        
        @self.sio.event
        async def aircraft_update(aircraft):
            aircraft_list = aircraft if isinstance(aircraft, list) else [aircraft]
            for ac in aircraft_list:
                self.aircraft[ac['hex']] = ac
            await self._emit('aircraft:update', aircraft_list)
        
        @self.sio.event
        async def aircraft_new(aircraft):
            self.aircraft[aircraft['hex']] = aircraft
            await self._emit('aircraft:new', aircraft)
        
        @self.sio.event
        async def aircraft_remove(data):
            hex_code = data.get('hex')
            self.aircraft.pop(hex_code, None)
            await self._emit('aircraft:remove', data)
        
        @self.sio.event
        async def aircraft_delta(delta):
            hex_code = delta.get('hex')
            if hex_code in self.aircraft:
                self.aircraft[hex_code].update(delta)
                await self._emit('aircraft:delta', delta)
        
        @self.sio.event
        async def safety_snapshot(data):
            await self._emit('safety:snapshot', data)
        
        @self.sio.event
        async def safety_event(event):
            await self._emit('safety:event', event)
        
        @self.sio.event
        async def alert_triggered(alert):
            await self._emit('alert:triggered', alert)
        
        @self.sio.event
        async def batch(data):
            for msg in data.get('messages', []):
                event_name = msg.get('type', '').replace(':', '_')
                if hasattr(self.sio, event_name):
                    await getattr(self.sio, event_name)(msg.get('data', msg))
        
        @self.sio.event
        async def stats_update(stats):
            await self._emit('stats:update', stats)
        
        @self.sio.event
        async def acars_message(message):
            await self._emit('acars:message', message)
    
    async def connect(self):
        """Connect to the server."""
        await self.sio.connect(
            self.url,
            socketio_path='/socket.io',
            auth={'token': self.token},
            transports=['websocket']
        )
    
    async def disconnect(self):
        """Disconnect from the server."""
        await self.sio.disconnect()
    
    def on(self, event: str, callback: Callable) -> Callable:
        """Register an event listener."""
        if event not in self.listeners:
            self.listeners[event] = []
        self.listeners[event].append(callback)
        
        def remove():
            self.off(event, callback)
        return remove
    
    def off(self, event: str, callback: Callable):
        """Remove an event listener."""
        if event in self.listeners:
            try:
                self.listeners[event].remove(callback)
            except ValueError:
                pass
    
    async def _emit(self, event: str, data: Any = None):
        """Emit an event to registered listeners."""
        if event in self.listeners:
            for callback in self.listeners[event]:
                if asyncio.iscoroutinefunction(callback):
                    await callback(data)
                else:
                    callback(data)
    
    async def subscribe(self, topics: List[str]):
        """Subscribe to topics."""
        await self.sio.emit('subscribe', {'topics': topics})
    
    async def unsubscribe(self, topics: List[str]):
        """Unsubscribe from topics."""
        await self.sio.emit('unsubscribe', {'topics': topics})
    
    async def request(
        self,
        req_type: str,
        params: Optional[Dict] = None,
        timeout: float = 10.0
    ) -> Any:
        """Make a request with timeout."""
        request_id = f"req_{uuid.uuid4().hex}"
        future = asyncio.Future()
        self.pending_requests[request_id] = future
        
        await self.sio.emit('request', {
            'type': req_type,
            'request_id': request_id,
            'params': params or {}
        })
        
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self.pending_requests.pop(request_id, None)
            raise TimeoutError(f'Request timeout: {req_type}')
    
    def get_aircraft(self) -> List[dict]:
        """Get all aircraft."""
        return list(self.aircraft.values())
    
    def get_aircraft_by_hex(self, hex_code: str) -> Optional[dict]:
        """Get aircraft by hex code."""
        return self.aircraft.get(hex_code)
    
    async def wait(self):
        """Wait indefinitely (blocks until disconnect)."""
        await self.sio.wait()
```

### Usage Example

```python example.py
import asyncio
import logging
from skyspy_client import SkySpyClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def main():
    client = SkySpyClient(
        'https://skyspy.example.com',
        'your_token_here'
    )
    
    # Register event listeners
    @client.on('connect')
    async def on_connect(data):
        logger.info('Connected!')
        await client.subscribe(['aircraft', 'safety', 'alerts'])
    
    @client.on('aircraft:snapshot')
    async def on_aircraft_snapshot(data):
        logger.info(f"Snapshot: {data.get('count')} aircraft")
        render_map(client.get_aircraft())
    
    @client.on('aircraft:update')
    async def on_aircraft_update(aircraft):
        logger.info(f"Update: {len(aircraft)} aircraft")
        render_map(client.get_aircraft())
    
    @client.on('aircraft:new')
    async def on_aircraft_new(aircraft):
        flight = aircraft.get('flight') or aircraft.get('hex')
        logger.info(f"New: {flight}")
    
    @client.on('safety:event')
    async def on_safety_event(event):
        severity = event.get('severity', 'unknown')
        message = event.get('message', '')
        logger.warning(f"Safety: {severity} - {message}")
        show_alert(event)
    
    @client.on('alert:triggered')
    async def on_alert_triggered(alert):
        logger.info(f"Alert: {alert.get('rule_name')}")
        show_notification(alert)
    
    # Connect
    await client.connect()
    
    # Make some requests
    try:
        info = await client.request('aircraft-info', {'icao': 'A1B2C3'})
        logger.info(f"Aircraft info: {info}")
        
        sightings = await client.request('sightings', {
            'hours': 24,
            'limit': 50
        })
        logger.info(f"Sightings: {len(sightings)}")
    except Exception as e:
        logger.error(f"Request failed: {e}")
    
    # Wait indefinitely
    try:
        await client.wait()
    except KeyboardInterrupt:
        logger.info('Disconnecting...')
        await client.disconnect()

if __name__ == '__main__':
    asyncio.run(main())
```

## Best Practices

> ✅ Production Guidelines
>
> Follow these best practices for robust client implementations:

### Connection Management

| Practice | Rationale | Implementation |
|----------|----------|----------|
| **Always use TLS** | Secure credentials and data in transit | Use `https://` URLs in production |
| **Handle reconnection** | Networks are unreliable; clients should auto-reconnect | Enable `reconnection: true` (default) |
| **Resubscribe on reconnect** | Subscriptions are not persisted across connections | Call `subscribe()` in `connect` handler |
| **Use WebSocket transport** | Avoid polling overhead; lower latency | Set `transports: ['websocket']` |
| **Handle token expiry** | JWT tokens expire; refresh and reconnect | Catch auth errors, refresh token, reconnect |

### Error Handling

| Practice | Rationale | Implementation |
|----------|----------|----------|
| **Timeout requests** | Prevent hanging requests | Use timeout in `request()` helper |
| **Handle request errors** | Requests can fail (not found, permission denied, etc.) | Catch exceptions, show user-friendly errors |
| **Log errors** | Essential for debugging production issues | Use logging library, send to monitoring service |
| **Graceful degradation** | App should work with stale data during outages | Show offline indicator, cache data locally |

### Performance

| Practice | Rationale | Implementation |
|----------|----------|----------|
| **Throttle UI updates** | High-frequency updates can overwhelm rendering | Use `requestAnimationFrame()` or debouncing |
| **Subscribe selectively** | Reduces bandwidth and processing | Only subscribe to topics you need |
| **Use delta updates** | Smaller payloads, faster processing | Handle `aircraft:delta` events |
| **Batch map updates** | Avoid redrawing map for each aircraft | Collect updates, redraw once per frame |

### Security

| Practice | Rationale | Implementation |
|----------|----------|----------|
| **Never log tokens** | Prevents token leakage in logs | Redact auth object in debug logs |
| **Use auth object** | Tokens in query strings are often logged | Pass `auth: { token }` in Socket.IO options |
| **Store tokens securely** | Prevent XSS attacks from stealing tokens | Use `httpOnly` cookies or secure storage |
| **Validate inputs** | Prevent injection attacks | Validate user inputs before sending requests |

## Testing

### Unit Tests

```javascript skyspy-client.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { io } from 'socket.io-client';
import SkySpyClient from './skyspy-client';

vi.mock('socket.io-client');

describe('SkySpyClient', () => {
  let client;
  let mockSocket;

  beforeEach(() => {
    mockSocket = {
      on: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
      id: 'test-socket-id'
    };
    io.mockReturnValue(mockSocket);
    client = new SkySpyClient('https://test.com', 'test-token');
  });

  it('should connect with correct options', () => {
    expect(io).toHaveBeenCalledWith(
      'https://test.com',
      expect.objectContaining({
        path: '/socket.io',
        auth: { token: 'test-token' },
        transports: ['websocket']
      })
    );
  });

  it('should subscribe to topics', () => {
    client.subscribe(['aircraft', 'safety']);
    expect(mockSocket.emit).toHaveBeenCalledWith('subscribe', {
      topics: ['aircraft', 'safety']
    });
  });

  it('should handle aircraft snapshot', () => {
    const callback = vi.fn();
    client.on('aircraft:snapshot', callback);
    
    const snapshot = {
      aircraft: [
        { hex: 'A1B2C3', lat: 37.7749, lon: -122.4194 },
        { hex: 'D4E5F6', lat: 37.8044, lon: -122.2712 }
      ],
      count: 2,
      timestamp: '2024-01-15T10:30:00Z'
    };
    
    // Simulate snapshot event
    const snapshotHandler = mockSocket.on.mock.calls.find(
      call => call[0] === 'aircraft:snapshot'
    )[1];
    snapshotHandler(snapshot);
    
    expect(callback).toHaveBeenCalledWith(snapshot);
    expect(client.getAircraft()).toHaveLength(2);
  });
});
```

## Next Steps

> 📘 Additional Resources
>
> - [Troubleshooting](/docs/socketio-troubleshooting) - Debugging tips and common issues\n- [Main Namespace](/docs/socketio-main-namespace) - Complete API reference\n- [Specialized Namespaces](/docs/socketio-specialized-namespaces) - Audio and Cannonball features
