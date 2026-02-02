---
title: Troubleshooting & Debugging
slug: socketio-troubleshooting
excerpt: Common issues, debugging tips, rate limits, and security best practices
---

# Troubleshooting & Debugging

Solutions to common issues, debugging techniques, and best practices for production deployments.

## Common Issues

### Connection Problems

| Symptom | Possible Cause | Solution |
|----------|----------|----------|
| Connection rejected immediately | Authentication required or invalid token | Check token validity; verify server auth mode (public/hybrid/private) |
| Connection timeout | Network issue, firewall, or wrong URL | Verify URL, check firewall rules, test with `curl` |
| Repeated reconnection attempts | Server rejecting connection; invalid credentials | Check logs for auth errors; refresh token if expired |
| Connection succeeds but immediately disconnects | Server-side validation failure | Check server logs; verify token has required permissions |

> ⚠️ Authentication Modes
>
> SkySpy supports three auth modes: `public` (no auth), `hybrid` (optional auth), and `private` (auth required). Check your server's `WS_AUTH_MODE` setting.

### Subscription Issues

| Symptom | Possible Cause | Solution |
|----------|----------|----------|
| No events after connect | Not subscribed to topics | Emit `subscribe` with desired topics after `connect` event |
| No `aircraft:snapshot` on connect | Listener attached after event fired | Attach listeners before connecting, or request `aircraft-snapshot` |
| `subscribed` shows denied topics | Missing permissions for those topics | Check user/API key permissions; upgrade account if needed |
| Events stop after a while | Subscription lost on reconnect | Resubscribe in `connect` handler (subscriptions don't persist) |

### Data Issues

| Symptom | Possible Cause | Solution |
|----------|----------|----------|
| Delayed updates | Rate limiting or batching | Expected behavior; critical events are not batched |
| Missing aircraft fields | Not all fields available from ADS-B | Check for `null`/`undefined`; use fallbacks |
| ACARS not received on main namespace | Server sends ACARS only to `/acars` namespace | Connect to `/acars` namespace or check server config |
| Stale aircraft not removed | Not handling `aircraft:remove` event | Listen for `aircraft:remove` and update local state |

### Request/Response Issues

| Symptom | Possible Cause | Solution |
|----------|----------|----------|
| Request timeout | Server slow or not responding | Increase timeout; check server logs |
| Error: "Unknown request type" | Typo in request type or unsupported type | Check spelling; see supported request types in docs |
| Error: "Missing parameter" | Required param not provided | Check request type requirements; include all required params |
| Error: "Permission denied" | User lacks permission for request type | Authenticate or check user/API key permissions |

## Debugging

### Enable Client Debug Logs

```javascript Browser
// Browser (localStorage)
localStorage.setItem('debug', 'socket.io-client:*');

// Then reload the page
```

```bash Node.js
# Node.js (environment variable)
DEBUG=socket.io-client:* node app.js
```

```python Python
# Python (logging)
import logging

logging.basicConfig(level=logging.DEBUG)
logging.getLogger('socketio').setLevel(logging.DEBUG)
logging.getLogger('engineio').setLevel(logging.DEBUG)
```

### Server-Side Debugging

Add debug logging to Django settings:

```python Django settings.py
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'skyspy.socketio': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
        'socketio': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
        'engineio': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
    },
}
```

### Network Inspection

#### Browser DevTools

1. Open DevTools (F12)
2. Go to **Network** tab
3. Filter by **WS** (WebSocket)
4. Select Socket.IO connection
5. View **Messages** tab for frame-by-frame inspection

#### Command Line

```bash Test Connection
# Test HTTP endpoint
curl -v https://skyspy.example.com/socket.io/

# Test with authentication
curl -v -H "Authorization: Bearer YOUR_TOKEN" \
  https://skyspy.example.com/socket.io/

# Check if WebSocket upgrade succeeds
wscat -c wss://skyspy.example.com/socket.io/?EIO=4&transport=websocket
```

### Logging Events

Create a debug client that logs all events:

```javascript JavaScript
const socket = io('https://skyspy.example.com', {
  auth: { token: 'YOUR_TOKEN' }
});

// Log all incoming events
const originalOn = socket.on.bind(socket);
socket.on = function(event, callback) {
  return originalOn(event, function(...args) {
    console.log(`[Event] ${event}:`, args);
    return callback(...args);
  });
};

// Log all outgoing events
const originalEmit = socket.emit.bind(socket);
socket.emit = function(event, ...args) {
  console.log(`[Emit] ${event}:`, args);
  return originalEmit(event, ...args);
};
```

```python Python
import socketio
import logging

logger = logging.getLogger(__name__)

class DebugClient(socketio.Client):
    def emit(self, event, data=None, *args, **kwargs):
        logger.debug(f'[Emit] {event}: {data}')
        return super().emit(event, data, *args, **kwargs)
    
    def on(self, event, handler=None):
        def wrapper(data):
            logger.debug(f'[Event] {event}: {data}')
            if handler:
                return handler(data)
        return super().on(event, wrapper)

sio = DebugClient()
logging.basicConfig(level=logging.DEBUG)
```

## Rate Limits

Understanding and working with rate limits.

### Default Rate Limits

| Topic / Event | Max Rate | Min Interval | Batching |
|----------|----------|----------|----------|
| `aircraft:update` | ~10 Hz | 100 ms | Yes (200ms window) |
| `aircraft:delta` | ~10 Hz | 100 ms | Yes (200ms window) |
| `stats:update` | ~0.5 Hz | 2 s | Yes |
| `safety:event` | No limit | — | No (critical) |
| `alert:triggered` | No limit | — | No (critical) |
| **Default** | ~5 Hz | 200 ms | Yes |

> ✅ Critical Events
>
> Safety events, alerts, and emergency events bypass batching and rate limits to ensure immediate delivery.

### Client-Side Throttling

If your UI can't keep up with updates, implement client-side throttling:

```javascript Throttling
import { throttle } from 'lodash';

// Throttle map updates to 30 FPS
const throttledRender = throttle((aircraft) => {
  renderMap(aircraft);
}, 1000 / 30);

socket.on('aircraft:update', (aircraft) => {
  // Update state immediately
  updateAircraftState(aircraft);
  
  // Throttle rendering
  throttledRender(getAircraft());
});

// Or use requestAnimationFrame
let updatePending = false;

socket.on('aircraft:update', (aircraft) => {
  updateAircraftState(aircraft);
  
  if (!updatePending) {
    updatePending = true;
    requestAnimationFrame(() => {
      renderMap(getAircraft());
      updatePending = false;
    });
  }
});
```

## Security

### Best Practices

> ⚠️ Production Security Checklist
>
> Follow these guidelines for secure production deployments:

| Practice | Rationale | Implementation |
|----------|----------|----------|
| **Use TLS (HTTPS/WSS)** | Encrypt credentials and data in transit | Use `https://` URLs; configure SSL certificates |
| **Pass tokens in auth object** | Query strings are often logged | Use `auth: { token }` in Socket.IO options |
| **Rotate tokens regularly** | Limit exposure window if token leaks | Use short-lived JWTs; refresh before expiry |
| **Use API keys for services** | Better access control than user tokens | Generate API keys in dashboard; use `sk_live_*` prefix |
| **Validate permissions** | Enforce least-privilege access | Check user/API key permissions on server |
| **Rate limit connections** | Prevent abuse and DoS attacks | Configure per-IP connection limits |
| **Monitor for anomalies** | Detect compromised tokens or attacks | Log suspicious activity; alert on unusual patterns |

### Token Expiry Handling

Handle JWT expiration gracefully:

```javascript Token Refresh
class SkySpyClient {
  constructor(url, getToken) {
    this.url = url;
    this.getToken = getToken; // Function to get/refresh token
    this.socket = null;
    this.connect();
  }

  connect() {
    const token = this.getToken();
    
    this.socket = io(this.url, {
      auth: { token },
      transports: ['websocket']
    });

    this.socket.on('connect_error', (error) => {
      if (error.message.includes('auth') || error.message.includes('token')) {
        console.log('Auth error, refreshing token...');
        this.refreshAndReconnect();
      }
    });

    this.socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // Server disconnected (possibly auth failure)
        console.log('Server disconnect, refreshing token...');
        this.refreshAndReconnect();
      }
    });
  }

  async refreshAndReconnect() {
    try {
      // Refresh token (e.g., call refresh endpoint)
      const newToken = await this.refreshToken();
      
      // Disconnect old socket
      if (this.socket) {
        this.socket.disconnect();
      }
      
      // Reconnect with new token
      this.connect();
    } catch (error) {
      console.error('Token refresh failed:', error);
      // Redirect to login or show error
    }
  }

  async refreshToken() {
    const response = await fetch('/api/auth/refresh/', {
      method: 'POST',
      credentials: 'include' // Send refresh cookie
    });
    
    if (!response.ok) {
      throw new Error('Failed to refresh token');
    }
    
    const data = await response.json();
    return data.access_token;
  }
}
```

### Secure Token Storage

| Environment | Storage Method | Security Notes |
|----------|----------|----------|
| **Browser (Web App)** | Memory variable or sessionStorage | Avoid localStorage (XSS risk); use httpOnly cookies for refresh tokens |
| **Mobile App** | Secure enclave / keychain | Use iOS Keychain or Android Keystore |
| **Server / CLI** | Environment variables or config file | Restrict file permissions (600); never commit to git |
| **Desktop App** | OS credential manager | Use platform APIs (e.g., Windows Credential Manager) |

## Error Messages Reference

Common error messages and their meanings:

| Error Message | Meaning | Resolution |
|----------|----------|----------|
| "Invalid JSON" | Malformed payload | Check payload format; ensure valid JSON |
| "Unknown action" | Unsupported event name | Use supported events (subscribe, request, etc.) |
| "Unknown request type" | Invalid request type in `request` event | Check spelling; see supported request types |
| "Missing parameter: X" | Required parameter not provided | Include parameter X in request params |
| "Permission denied" | User lacks permission for topic or request | Authenticate or check permissions |
| "Invalid token" | Token is invalid or expired | Refresh token and reconnect |
| "Authentication required" | Server in private mode; auth required | Provide valid token in auth object |
| "Rate limit exceeded" | Too many requests or connections | Slow down; implement backoff |

## Performance Optimization

### Reduce Bandwidth

| Technique | Description | Savings |
|----------|----------|----------|
| **Selective subscriptions** | Subscribe only to needed topics | 50-80% (vs. `all`) |
| **Delta updates** | Use `aircraft:delta` instead of full updates | 30-60% (payload size) |
| **Filter on server** | Use request params to filter results | Varies by query |
| **Compression** | Enable gzip/brotli on server | 60-80% (text data) |

### Reduce CPU Usage

| Technique | Description | Impact |
|----------|----------|----------|
| **Throttle rendering** | Render at 30 FPS instead of on every update | 70-90% (CPU) |
| **Debounce searches** | Wait for user to stop typing before searching | Reduces unnecessary requests |
| **Virtualize lists** | Only render visible items in large lists | 90%+ for large lists |
| **Web Workers** | Process data in background thread | Prevents UI blocking |

## Need More Help?

> 📘 Additional Resources
>
> - [Socket.IO Overview](/docs/socketio-overview) - Introduction and architecture\n- [Main Namespace](/docs/socketio-main-namespace) - Complete API reference\n- [Client Implementation](/docs/socketio-client-implementation) - Code examples\n- [REST API Documentation](/docs/rest-api) - HTTP API reference\n\nStill stuck? Check the GitHub Issues or join the community Discord.
