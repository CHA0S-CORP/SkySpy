---
title: Troubleshooting & Debugging
slug: socketio-troubleshooting
category:
  uri: uri-that-does-not-map-to-api-reference
position: 6
content:
  excerpt: 'Common issues, debugging tips, rate limits, and security best practices'
privacy:
  view: public
---

# Troubleshooting & Debugging

Solutions to common issues, debugging techniques, and best practices for production deployments.

## Common Issues

### Connection Problems

[block:parameters]
{
  "data": {
    "h-0": "Symptom",
    "h-1": "Possible Cause",
    "h-2": "Solution",
    "0-0": "Connection rejected immediately",
    "0-1": "Authentication required or invalid token",
    "0-2": "Check token validity; verify server auth mode (public/hybrid/private)",
    "1-0": "Connection timeout",
    "1-1": "Network issue, firewall, or wrong URL",
    "1-2": "Verify URL, check firewall rules, test with `curl`",
    "2-0": "Repeated reconnection attempts",
    "2-1": "Server rejecting connection; invalid credentials",
    "2-2": "Check logs for auth errors; refresh token if expired",
    "3-0": "Connection succeeds but immediately disconnects",
    "3-1": "Server-side validation failure",
    "3-2": "Check server logs; verify token has required permissions"
  },
  "cols": 3,
  "rows": 4
}
[/block]

> 🚧 Authentication Modes
>
> SkySpy supports three auth modes: `public` (no auth), `hybrid` (optional auth), and `private` (auth required). Check your server's `WS_AUTH_MODE` setting.

### Subscription Issues

[block:parameters]
{
  "data": {
    "h-0": "Symptom",
    "h-1": "Possible Cause",
    "h-2": "Solution",
    "0-0": "No events after connect",
    "0-1": "Not subscribed to topics",
    "0-2": "Emit `subscribe` with desired topics after `connect` event",
    "1-0": "No `aircraft:snapshot` on connect",
    "1-1": "Listener attached after event fired",
    "1-2": "Attach listeners before connecting, or request `aircraft-snapshot`",
    "2-0": "`subscribed` shows denied topics",
    "2-1": "Missing permissions for those topics",
    "2-2": "Check user/API key permissions; upgrade account if needed",
    "3-0": "Events stop after a while",
    "3-1": "Subscription lost on reconnect",
    "3-2": "Resubscribe in `connect` handler (subscriptions don't persist)"
  },
  "cols": 3,
  "rows": 4
}
[/block]

### Data Issues

[block:parameters]
{
  "data": {
    "h-0": "Symptom",
    "h-1": "Possible Cause",
    "h-2": "Solution",
    "0-0": "Delayed updates",
    "0-1": "Rate limiting or batching",
    "0-2": "Expected behavior; critical events are not batched",
    "1-0": "Missing aircraft fields",
    "1-1": "Not all fields available from ADS-B",
    "1-2": "Check for `null`/`undefined`; use fallbacks",
    "2-0": "ACARS not received on main namespace",
    "2-1": "Server sends ACARS only to `/acars` namespace",
    "2-2": "Connect to `/acars` namespace or check server config",
    "3-0": "Stale aircraft not removed",
    "3-1": "Not handling `aircraft:remove` event",
    "3-2": "Listen for `aircraft:remove` and update local state"
  },
  "cols": 3,
  "rows": 4
}
[/block]

### Request/Response Issues

[block:parameters]
{
  "data": {
    "h-0": "Symptom",
    "h-1": "Possible Cause",
    "h-2": "Solution",
    "0-0": "Request timeout",
    "0-1": "Server slow or not responding",
    "0-2": "Increase timeout; check server logs",
    "1-0": "Error: \"Unknown request type\"",
    "1-1": "Typo in request type or unsupported type",
    "1-2": "Check spelling; see supported request types in docs",
    "2-0": "Error: \"Missing parameter\"",
    "2-1": "Required param not provided",
    "2-2": "Check request type requirements; include all required params",
    "3-0": "Error: \"Permission denied\"",
    "3-1": "User lacks permission for request type",
    "3-2": "Authenticate or check user/API key permissions"
  },
  "cols": 3,
  "rows": 4
}
[/block]

## Debugging

### Enable Client Debug Logs

[block:code]
{
  "codes": [
    {
      "code": "// Browser (localStorage)\nlocalStorage.setItem('debug', 'socket.io-client:*');\n\n// Then reload the page",
      "language": "javascript",
      "name": "Browser"
    },
    {
      "code": "# Node.js (environment variable)\nDEBUG=socket.io-client:* node app.js",
      "language": "bash",
      "name": "Node.js"
    },
    {
      "code": "# Python (logging)\nimport logging\n\nlogging.basicConfig(level=logging.DEBUG)\nlogging.getLogger('socketio').setLevel(logging.DEBUG)\nlogging.getLogger('engineio').setLevel(logging.DEBUG)",
      "language": "python",
      "name": "Python"
    }
  ]
}
[/block]

### Server-Side Debugging

Add debug logging to Django settings:

[block:code]
{
  "codes": [
    {
      "code": "LOGGING = {\n    'version': 1,\n    'disable_existing_loggers': False,\n    'handlers': {\n        'console': {\n            'class': 'logging.StreamHandler',\n        },\n    },\n    'root': {\n        'handlers': ['console'],\n        'level': 'INFO',\n    },\n    'loggers': {\n        'skyspy.socketio': {\n            'handlers': ['console'],\n            'level': 'DEBUG',\n            'propagate': False,\n        },\n        'socketio': {\n            'handlers': ['console'],\n            'level': 'DEBUG',\n            'propagate': False,\n        },\n        'engineio': {\n            'handlers': ['console'],\n            'level': 'DEBUG',\n            'propagate': False,\n        },\n    },\n}",
      "language": "python",
      "name": "Django settings.py"
    }
  ]
}
[/block]

### Network Inspection

#### Browser DevTools

1. Open DevTools (F12)
2. Go to **Network** tab
3. Filter by **WS** (WebSocket)
4. Select Socket.IO connection
5. View **Messages** tab for frame-by-frame inspection

#### Command Line

[block:code]
{
  "codes": [
    {
      "code": "# Test HTTP endpoint\ncurl -v https://skyspy.example.com/socket.io/\n\n# Test with authentication\ncurl -v -H \"Authorization: Bearer YOUR_TOKEN\" \\\n  https://skyspy.example.com/socket.io/\n\n# Check if WebSocket upgrade succeeds\nwscat -c wss://skyspy.example.com/socket.io/?EIO=4&transport=websocket",
      "language": "bash",
      "name": "Test Connection"
    }
  ]
}
[/block]

### Logging Events

Create a debug client that logs all events:

[block:code]
{
  "codes": [
    {
      "code": "const socket = io('https://skyspy.example.com', {\n  auth: { token: 'YOUR_TOKEN' }\n});\n\n// Log all incoming events\nconst originalOn = socket.on.bind(socket);\nsocket.on = function(event, callback) {\n  return originalOn(event, function(...args) {\n    console.log(`[Event] ${event}:`, args);\n    return callback(...args);\n  });\n};\n\n// Log all outgoing events\nconst originalEmit = socket.emit.bind(socket);\nsocket.emit = function(event, ...args) {\n  console.log(`[Emit] ${event}:`, args);\n  return originalEmit(event, ...args);\n};",
      "language": "javascript",
      "name": "JavaScript"
    },
    {
      "code": "import socketio\nimport logging\n\nlogger = logging.getLogger(__name__)\n\nclass DebugClient(socketio.Client):\n    def emit(self, event, data=None, *args, **kwargs):\n        logger.debug(f'[Emit] {event}: {data}')\n        return super().emit(event, data, *args, **kwargs)\n    \n    def on(self, event, handler=None):\n        def wrapper(data):\n            logger.debug(f'[Event] {event}: {data}')\n            if handler:\n                return handler(data)\n        return super().on(event, wrapper)\n\nsio = DebugClient()\nlogging.basicConfig(level=logging.DEBUG)",
      "language": "python",
      "name": "Python"
    }
  ]
}
[/block]

## Rate Limits

Understanding and working with rate limits.

### Default Rate Limits

[block:parameters]
{
  "data": {
    "h-0": "Topic / Event",
    "h-1": "Max Rate",
    "h-2": "Min Interval",
    "h-3": "Batching",
    "0-0": "`aircraft:update`",
    "0-1": "~10 Hz",
    "0-2": "100 ms",
    "0-3": "Yes (200ms window)",
    "1-0": "`aircraft:delta`",
    "1-1": "~10 Hz",
    "1-2": "100 ms",
    "1-3": "Yes (200ms window)",
    "2-0": "`stats:update`",
    "2-1": "~0.5 Hz",
    "2-2": "2 s",
    "2-3": "Yes",
    "3-0": "`safety:event`",
    "3-1": "No limit",
    "3-2": "—",
    "3-3": "No (critical)",
    "4-0": "`alert:triggered`",
    "4-1": "No limit",
    "4-2": "—",
    "4-3": "No (critical)",
    "5-0": "**Default**",
    "5-1": "~5 Hz",
    "5-2": "200 ms",
    "5-3": "Yes"
  },
  "cols": 4,
  "rows": 6
}
[/block]

> ✅ Critical Events
>
> Safety events, alerts, and emergency events bypass batching and rate limits to ensure immediate delivery.

### Client-Side Throttling

If your UI can't keep up with updates, implement client-side throttling:

[block:code]
{
  "codes": [
    {
      "code": "import { throttle } from 'lodash';\n\n// Throttle map updates to 30 FPS\nconst throttledRender = throttle((aircraft) => {\n  renderMap(aircraft);\n}, 1000 / 30);\n\nsocket.on('aircraft:update', (aircraft) => {\n  // Update state immediately\n  updateAircraftState(aircraft);\n  \n  // Throttle rendering\n  throttledRender(getAircraft());\n});\n\n// Or use requestAnimationFrame\nlet updatePending = false;\n\nsocket.on('aircraft:update', (aircraft) => {\n  updateAircraftState(aircraft);\n  \n  if (!updatePending) {\n    updatePending = true;\n    requestAnimationFrame(() => {\n      renderMap(getAircraft());\n      updatePending = false;\n    });\n  }\n});",
      "language": "javascript",
      "name": "Throttling"
    }
  ]
}
[/block]

## Security

### Best Practices

> 🚧 Production Security Checklist
>
> Follow these guidelines for secure production deployments:

[block:parameters]
{
  "data": {
    "h-0": "Practice",
    "h-1": "Rationale",
    "h-2": "Implementation",
    "0-0": "**Use TLS (HTTPS/WSS)**",
    "0-1": "Encrypt credentials and data in transit",
    "0-2": "Use `https://` URLs; configure SSL certificates",
    "1-0": "**Pass tokens in auth object**",
    "1-1": "Query strings are often logged",
    "1-2": "Use `auth: { token }` in Socket.IO options",
    "2-0": "**Rotate tokens regularly**",
    "2-1": "Limit exposure window if token leaks",
    "2-2": "Use short-lived JWTs; refresh before expiry",
    "3-0": "**Use API keys for services**",
    "3-1": "Better access control than user tokens",
    "3-2": "Generate API keys in dashboard; use `sk_live_*` prefix",
    "4-0": "**Validate permissions**",
    "4-1": "Enforce least-privilege access",
    "4-2": "Check user/API key permissions on server",
    "5-0": "**Rate limit connections**",
    "5-1": "Prevent abuse and DoS attacks",
    "5-2": "Configure per-IP connection limits",
    "6-0": "**Monitor for anomalies**",
    "6-1": "Detect compromised tokens or attacks",
    "6-2": "Log suspicious activity; alert on unusual patterns"
  },
  "cols": 3,
  "rows": 7
}
[/block]

### Token Expiry Handling

Handle JWT expiration gracefully:

[block:code]
{
  "codes": [
    {
      "code": "class SkySpyClient {\n  constructor(url, getToken) {\n    this.url = url;\n    this.getToken = getToken; // Function to get/refresh token\n    this.socket = null;\n    this.connect();\n  }\n\n  connect() {\n    const token = this.getToken();\n    \n    this.socket = io(this.url, {\n      auth: { token },\n      transports: ['websocket']\n    });\n\n    this.socket.on('connect_error', (error) => {\n      if (error.message.includes('auth') || error.message.includes('token')) {\n        console.log('Auth error, refreshing token...');\n        this.refreshAndReconnect();\n      }\n    });\n\n    this.socket.on('disconnect', (reason) => {\n      if (reason === 'io server disconnect') {\n        // Server disconnected (possibly auth failure)\n        console.log('Server disconnect, refreshing token...');\n        this.refreshAndReconnect();\n      }\n    });\n  }\n\n  async refreshAndReconnect() {\n    try {\n      // Refresh token (e.g., call refresh endpoint)\n      const newToken = await this.refreshToken();\n      \n      // Disconnect old socket\n      if (this.socket) {\n        this.socket.disconnect();\n      }\n      \n      // Reconnect with new token\n      this.connect();\n    } catch (error) {\n      console.error('Token refresh failed:', error);\n      // Redirect to login or show error\n    }\n  }\n\n  async refreshToken() {\n    const response = await fetch('/api/auth/refresh/', {\n      method: 'POST',\n      credentials: 'include' // Send refresh cookie\n    });\n    \n    if (!response.ok) {\n      throw new Error('Failed to refresh token');\n    }\n    \n    const data = await response.json();\n    return data.access_token;\n  }\n}",
      "language": "javascript",
      "name": "Token Refresh"
    }
  ]
}
[/block]

### Secure Token Storage

[block:parameters]
{
  "data": {
    "h-0": "Environment",
    "h-1": "Storage Method",
    "h-2": "Security Notes",
    "0-0": "**Browser (Web App)**",
    "0-1": "Memory variable or sessionStorage",
    "0-2": "Avoid localStorage (XSS risk); use httpOnly cookies for refresh tokens",
    "1-0": "**Mobile App**",
    "1-1": "Secure enclave / keychain",
    "1-2": "Use iOS Keychain or Android Keystore",
    "2-0": "**Server / CLI**",
    "2-1": "Environment variables or config file",
    "2-2": "Restrict file permissions (600); never commit to git",
    "3-0": "**Desktop App**",
    "3-1": "OS credential manager",
    "3-2": "Use platform APIs (e.g., Windows Credential Manager)"
  },
  "cols": 3,
  "rows": 4
}
[/block]

## Error Messages Reference

Common error messages and their meanings:

[block:parameters]
{
  "data": {
    "h-0": "Error Message",
    "h-1": "Meaning",
    "h-2": "Resolution",
    "0-0": "\"Invalid JSON\"",
    "0-1": "Malformed payload",
    "0-2": "Check payload format; ensure valid JSON",
    "1-0": "\"Unknown action\"",
    "1-1": "Unsupported event name",
    "1-2": "Use supported events (subscribe, request, etc.)",
    "2-0": "\"Unknown request type\"",
    "2-1": "Invalid request type in `request` event",
    "2-2": "Check spelling; see supported request types",
    "3-0": "\"Missing parameter: X\"",
    "3-1": "Required parameter not provided",
    "3-2": "Include parameter X in request params",
    "4-0": "\"Permission denied\"",
    "4-1": "User lacks permission for topic or request",
    "4-2": "Authenticate or check permissions",
    "5-0": "\"Invalid token\"",
    "5-1": "Token is invalid or expired",
    "5-2": "Refresh token and reconnect",
    "6-0": "\"Authentication required\"",
    "6-1": "Server in private mode; auth required",
    "6-2": "Provide valid token in auth object",
    "7-0": "\"Rate limit exceeded\"",
    "7-1": "Too many requests or connections",
    "7-2": "Slow down; implement backoff"
  },
  "cols": 3,
  "rows": 8
}
[/block]

## Performance Optimization

### Reduce Bandwidth

[block:parameters]
{
  "data": {
    "h-0": "Technique",
    "h-1": "Description",
    "h-2": "Savings",
    "0-0": "**Selective subscriptions**",
    "0-1": "Subscribe only to needed topics",
    "0-2": "50-80% (vs. `all`)",
    "1-0": "**Delta updates**",
    "1-1": "Use `aircraft:delta` instead of full updates",
    "1-2": "30-60% (payload size)",
    "2-0": "**Filter on server**",
    "2-1": "Use request params to filter results",
    "2-2": "Varies by query",
    "3-0": "**Compression**",
    "3-1": "Enable gzip/brotli on server",
    "3-2": "60-80% (text data)"
  },
  "cols": 3,
  "rows": 4
}
[/block]

### Reduce CPU Usage

[block:parameters]
{
  "data": {
    "h-0": "Technique",
    "h-1": "Description",
    "h-2": "Impact",
    "0-0": "**Throttle rendering**",
    "0-1": "Render at 30 FPS instead of on every update",
    "0-2": "70-90% (CPU)",
    "1-0": "**Debounce searches**",
    "1-1": "Wait for user to stop typing before searching",
    "1-2": "Reduces unnecessary requests",
    "2-0": "**Virtualize lists**",
    "2-1": "Only render visible items in large lists",
    "2-2": "90%+ for large lists",
    "3-0": "**Web Workers**",
    "3-1": "Process data in background thread",
    "3-2": "Prevents UI blocking"
  },
  "cols": 3,
  "rows": 4
}
[/block]

## Need More Help?

> 📘 Additional Resources
>
> - [Socket.IO Overview](/docs/socketio-overview) - Introduction and architecture
> - [Main Namespace](/docs/socketio-main-namespace) - Complete API reference
> - [Client Implementation](/docs/socketio-client-implementation) - Code examples
> - [REST API Documentation](/docs/rest-api) - HTTP API reference
>
> Still stuck? Check the [GitHub Issues](https://github.com/your-repo/skyspy/issues) or join the community Discord.
