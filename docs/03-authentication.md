---
title: Authentication & Authorization
slug: authentication
category:
  uri: core-features
position: 1
privacy:
  view: public
---

# Authentication and Authorization

SkySpy provides a comprehensive, enterprise-ready authentication and authorization system supporting multiple authentication methods, role-based access control (RBAC), and fine-grained feature permissions.

---

## Quick Reference

> **TL;DR** - Everything you need to get started in 30 seconds

| What | Where | Example |
|------|-------|---------|
| **Login** | `POST /api/v1/auth/login` | `{"username": "...", "password": "..."}` |
| **Refresh Token** | `POST /api/v1/auth/refresh` | `{"refresh": "eyJ..."}` |
| **Use Token** | `Authorization` header | `Bearer eyJ0eXAiOiJKV1Q...` |
| **API Key** | `X-API-Key` header | `sk_a1B2c3D4e5F6g7H8...` |
| **SSO/OIDC** | `GET /api/v1/auth/oidc/authorize` | Redirects to IdP |
| **Current User** | `GET /api/v1/auth/profile` | Returns user + permissions |

| Auth Method | Best For | Token Lifetime |
|-------------|----------|----------------|
| JWT | Web apps, SPAs | 60 min (access) / 2 days (refresh) |
| API Key | Scripts, integrations, CI/CD | Custom (up to years) |
| OIDC/SSO | Enterprise, corporate IdP | Follows IdP settings |

---

## Authentication Overview

SkySpy's authentication system is designed with flexibility and security in mind. It supports three operational modes and multiple authentication methods to accommodate various deployment scenarios.

### Architecture Diagram

```mermaid
flowchart TB
    subgraph Frontend["Frontend"]
        WEB[Web App<br/>React]
        AUTH_CTX[AuthContext<br/>JWT + OIDC]
    end

    subgraph API["Backend API"]
        REST[REST API<br/>Django REST]
        WS[WebSocket<br/>Channels]
    end

    subgraph AuthLayer["Auth Layer"]
        JWT_AUTH[JWT Auth]
        API_KEY[API Key Auth]
        OIDC[OIDC/SSO]
    end

    subgraph Permissions["Authorization"]
        RBAC[Role-Based<br/>Access Control]
        FEATURE[Feature-Based<br/>Permissions]
    end

    WEB --> AUTH_CTX
    AUTH_CTX --> REST
    AUTH_CTX --> WS
    REST --> JWT_AUTH
    REST --> API_KEY
    REST --> OIDC
    WS --> JWT_AUTH
    WS --> API_KEY
    JWT_AUTH --> RBAC
    API_KEY --> RBAC
    OIDC --> RBAC
    RBAC --> FEATURE
```

### Authentication Modes

SkySpy operates in one of three authentication modes, configured via the `AUTH_MODE` environment variable:

| Mode | Description | Use Case | Security Level |
|------|-------------|----------|----------------|
| `public` | No authentication required | Development, demos, public kiosks | Low |
| `private` | Authentication required for all endpoints | Enterprise, security-sensitive deployments | High |
| `hybrid` | Per-feature configuration **(default)** | Most production deployments | Flexible |

```bash
# Environment variable configuration
AUTH_MODE=hybrid  # Options: public, private, hybrid
```

---

## Authentication Methods

### Method Comparison

> **Which method should I use?**
>
> **Web Applications** - JWT tokens with automatic refresh
> **Scripts & Automation** - API keys with scoped access
> **Enterprise/Corporate** - OIDC/SSO with your identity provider

| Feature | JWT | API Key | OIDC |
|---------|-----|---------|------|
| **Stateless** | Yes | Yes | Yes |
| **Auto Refresh** | Yes | No | Yes |
| **Scoped Access** | No | Yes | Yes |
| **User Context** | Yes | Yes | Yes |
| **External IdP** | No | No | Yes |
| **WebSocket Support** | Yes | Yes | Yes |

---

### 1. JWT Token Authentication

SkySpy uses JSON Web Tokens (JWT) for stateless authentication. The implementation is built on `djangorestframework-simplejwt`.

#### Token Structure Visual

```
+-----------------------------------------------------------------------------+
|                              JWT ACCESS TOKEN                                |
+-----------------------------------------------------------------------------+
|  HEADER              |  PAYLOAD                    |  SIGNATURE              |
|  -------             |  --------                   |  ----------             |
|  {                   |  {                          |                         |
|    "typ": "JWT",     |    "token_type": "access",  |  HMACSHA256(            |
|    "alg": "HS256"    |    "exp": 1704067200,       |    base64(header) +     |
|  }                   |    "user_id": 42,           |    base64(payload),     |
|                      |    "jti": "unique-id"       |    secret               |
|                      |  }                          |  )                       |
+-----------------------------------------------------------------------------+
|  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIi4uLn0   |
|  --------------------------------------------------------------------------- |
|  Header (Base64)    Payload (Base64)              Signature                  |
+-----------------------------------------------------------------------------+
```

#### Configuration

```bash
# JWT Settings (environment variables)
JWT_SECRET_KEY=your-secret-key          # Separate from Django SECRET_KEY recommended
JWT_ACCESS_TOKEN_LIFETIME_MINUTES=60    # Access token validity (default: 60 min)
JWT_REFRESH_TOKEN_LIFETIME_DAYS=2       # Refresh token validity (default: 2 days)
JWT_AUTH_COOKIE=false                   # Enable httpOnly cookie storage
```

#### Token Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/auth/login` | POST | Obtain access and refresh tokens |
| `/api/v1/auth/refresh` | POST | Refresh access token |
| `/api/v1/auth/logout` | POST | Blacklist refresh token |

#### JWT Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    participant User as User
    participant App as Frontend
    participant API as SkySpy API
    participant DB as Database

    User->>App: Enter credentials
    App->>API: POST /auth/login<br/>{username, password}
    API->>DB: Validate credentials
    DB-->>API: User verified
    API-->>App: {access_token, refresh_token, user}
    App->>App: Store tokens in localStorage

    Note over User,DB: Making Authenticated Requests

    App->>API: GET /aircraft<br/>Authorization: Bearer {token}
    API->>API: Validate JWT signature
    API-->>App: Aircraft data

    Note over User,DB: Token Refresh (before expiry)

    App->>API: POST /auth/refresh<br/>{refresh_token}
    API->>DB: Validate & rotate token
    DB-->>API: New tokens generated
    API-->>App: {new_access_token, new_refresh_token}
```

#### Code Examples

**cURL**

```bash
# Login Request
curl -X POST https://your-skyspy-instance/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "operator",
    "password": "secure-password"
  }'
```

**JavaScript**

```javascript
// Login Request
const response = await fetch('https://your-skyspy-instance/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'operator',
    password: 'secure-password'
  })
});

const { access, refresh, user } = await response.json();
localStorage.setItem('skyspy_access_token', access);
localStorage.setItem('skyspy_refresh_token', refresh);
```

**Python**

```python
import requests

# Login Request
response = requests.post(
    'https://your-skyspy-instance/api/v1/auth/login',
    json={
        'username': 'operator',
        'password': 'secure-password'
    }
)

tokens = response.json()
access_token = tokens['access']
refresh_token = tokens['refresh']
```

#### Login Response

```json
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "user": {
    "id": 42,
    "username": "operator",
    "email": "operator@example.com",
    "display_name": "John Operator",
    "permissions": ["aircraft.view", "alerts.create", "alerts.edit"],
    "roles": ["operator"]
  }
}
```

#### Using JWT Tokens

**cURL**

```bash
# Include the access token in the Authorization header
curl https://your-skyspy-instance/api/v1/aircraft \
  -H "Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
```

**JavaScript**

```javascript
// Using the token in fetch requests
const token = localStorage.getItem('skyspy_access_token');

const response = await fetch('https://your-skyspy-instance/api/v1/aircraft', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

**Python**

```python
import requests

headers = {
    'Authorization': f'Bearer {access_token}'
}

response = requests.get(
    'https://your-skyspy-instance/api/v1/aircraft',
    headers=headers
)
```

> **Security Note**
>
> Refresh tokens are **rotated on use** and the old token is blacklisted. This provides protection against token theft and replay attacks.

---

### 2. API Key Authentication

API keys provide programmatic access for integrations, scripts, and third-party applications.

#### Key Format

```
sk_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0
|  |
|  +-- Random characters
|
+-- Prefix identifier
```

> **Warning**
>
> The full API key is **only returned once** at creation time. Store it securely immediately - you cannot retrieve it later!

#### Creating API Keys

**cURL**

```bash
curl -X POST https://your-skyspy-instance/api/v1/auth/api-keys \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI/CD Pipeline",
    "scopes": ["aircraft", "alerts"],
    "expires_at": "2025-12-31T23:59:59Z"
  }'
```

**JavaScript**

```javascript
const response = await authFetch('/api/v1/auth/api-keys', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'CI/CD Pipeline',
    scopes: ['aircraft', 'alerts'],
    expires_at: '2025-12-31T23:59:59Z'
  })
});

const { key } = await response.json();
// Store this immediately - shown only once!
console.log('API Key:', key);
```

**Django**

```python
from skyspy.models import APIKey
from django.utils import timezone
from datetime import timedelta

api_key = APIKey.objects.create(
    user=user,
    name="Read-only Aircraft Data",
    scopes=["aircraft", "history"],
    expires_at=timezone.now() + timedelta(days=90)
)
```

#### Using API Keys

**cURL**

```bash
# Using Authorization header (recommended)
curl https://your-skyspy-instance/api/v1/aircraft \
  -H "Authorization: ApiKey sk_a1B2c3D4e5F6g7H8i9J0..."

# Using X-API-Key header
curl https://your-skyspy-instance/api/v1/aircraft \
  -H "X-API-Key: sk_a1B2c3D4e5F6g7H8i9J0..."
```

**JavaScript**

```javascript
const API_KEY = 'sk_a1B2c3D4e5F6g7H8i9J0...';

// Using Authorization header
const response = await fetch('https://your-skyspy-instance/api/v1/aircraft', {
  headers: {
    'Authorization': `ApiKey ${API_KEY}`
  }
});

// Or using X-API-Key header
const response2 = await fetch('https://your-skyspy-instance/api/v1/aircraft', {
  headers: {
    'X-API-Key': API_KEY
  }
});
```

#### Scope-Based Access

| Scope | Access Granted | Example Endpoints |
|-------|----------------|-------------------|
| `aircraft` | Aircraft tracking data | `/api/v1/aircraft/*` |
| `alerts` | Alert rules and history | `/api/v1/alerts/*` |
| `safety` | Safety event data | `/api/v1/safety/*` |
| `audio` | Audio transmissions | `/api/v1/audio/*` |
| `acars` | ACARS messages | `/api/v1/acars/*` |
| `history` | Historical data | `/api/v1/history/*` |
| `system` | System status and metrics | `/api/v1/system/*` |

---

### 3. OIDC/SSO Authentication

SkySpy supports OpenID Connect (OIDC) for enterprise single sign-on integration with identity providers like Okta, Auth0, Azure AD, and Keycloak.

#### Configuration

```bash
# OIDC Settings
OIDC_ENABLED=true
OIDC_PROVIDER_URL=https://your-idp.example.com
OIDC_CLIENT_ID=skyspy-client-id
OIDC_CLIENT_SECRET=your-client-secret
OIDC_PROVIDER_NAME=Corporate SSO       # Display name for UI
OIDC_SCOPES=openid profile email groups
OIDC_DEFAULT_ROLE=viewer               # Role for new OIDC users
```

#### OIDC Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    participant User as User
    participant App as SkySpy Frontend
    participant API as SkySpy Backend
    participant IdP as Identity Provider

    User->>App: Click "Login with SSO"
    App->>API: GET /auth/oidc/authorize
    API-->>App: Authorization URL + state
    App->>IdP: Redirect to IdP login

    Note over IdP: User authenticates<br/>with corporate credentials

    IdP->>User: Login form
    User->>IdP: Enter credentials
    IdP-->>App: Redirect with auth code
    App->>API: GET /auth/oidc/callback?code=xxx

    API->>IdP: Exchange code for tokens
    IdP-->>API: ID token + access token
    API->>IdP: Fetch user info
    IdP-->>API: User claims (email, groups, etc.)

    API->>API: Create/update user<br/>Map claims to roles
    API-->>App: SkySpy JWT tokens + user
    App->>App: Store tokens, redirect to dashboard
```

#### Claim-Based Role Mapping

Map your IdP groups to SkySpy roles automatically:

```json
{
  "name": "Admin Group Mapping",
  "claim_name": "groups",
  "match_type": "exact",
  "claim_value": "skyspy-admins",
  "role": "admin",
  "priority": 10,
  "is_active": true
}
```

| Match Type | Description | Example |
|------------|-------------|---------|
| `exact` | Claim value must match exactly | `"skyspy-admins"` matches `"skyspy-admins"` |
| `contains` | Claim must contain the string | `"admin"` matches `"skyspy-admins"` |
| `regex` | Claim must match the pattern | `"skyspy-.*"` matches `"skyspy-operators"` |

> **Security Warning**
>
> **Email linking** (`OIDC_ALLOW_EMAIL_LINKING`) is disabled by default. Enabling it allows existing accounts to be linked to OIDC based on matching email addresses.
>
> **Risk**: An attacker who controls an OIDC provider with matching email addresses could gain access to existing accounts.

---

### 4. Session-Based Authentication (Admin Only)

Django admin uses session-based authentication. This is separate from the API authentication system.

```python
# settings.py - Session configuration
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = True  # In production
```

---

## User Roles and Permissions

### Role-Based Access Control (RBAC)

SkySpy implements RBAC with the following default roles:

| Role | Priority | Description | Typical User |
|------|----------|-------------|--------------|
| `viewer` | 10 | Read-only access to allowed features | Public dashboards, guests |
| `operator` | 20 | Create/manage own alerts, acknowledge safety events | Daily users, shift workers |
| `analyst` | 30 | Extended access with export and transcription | Data analysts, researchers |
| `admin` | 40 | Full feature access with limited user management | Team leads, managers |
| `superadmin` | 100 | Full access including user and role management | System administrators |

### Permission Matrix

Permissions follow the format `feature.action`:

```
aircraft.view           # View aircraft data
aircraft.view_military  # View military aircraft
alerts.create          # Create alert rules
alerts.delete          # Delete alert rules
alerts.manage_all      # Manage all users' alerts
safety.acknowledge     # Acknowledge safety events
users.create           # Create new users
roles.edit             # Modify roles
```

### Role Permission Comparison

| Permission | Viewer | Operator | Analyst | Admin | Super |
|------------|--------|----------|---------|-------|-------|
| **aircraft.view** | Yes | Yes | Yes | Yes | Yes |
| **aircraft.view_military** | No | No | Yes | Yes | Yes |
| **alerts.view** | Yes | Yes | Yes | Yes | Yes |
| **alerts.create** | No | Yes | Yes | Yes | Yes |
| **alerts.manage_all** | No | No | No | Yes | Yes |
| **safety.acknowledge** | No | Yes | Yes | Yes | Yes |
| **audio.transcribe** | No | No | Yes | Yes | Yes |
| **history.export** | No | No | Yes | Yes | Yes |
| **users.view** | No | No | No | Yes | Yes |
| **users.create** | No | No | No | No | Yes |
| **roles.edit** | No | No | No | No | Yes |

### Creating Custom Roles

**cURL**

```bash
curl -X POST https://your-skyspy-instance/api/v1/roles \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "shift_supervisor",
    "display_name": "Shift Supervisor",
    "description": "Can manage alerts and acknowledge safety events",
    "permissions": [
      "aircraft.view",
      "aircraft.view_details",
      "alerts.view",
      "alerts.create",
      "alerts.edit",
      "alerts.delete",
      "safety.view",
      "safety.acknowledge",
      "safety.manage"
    ],
    "priority": 25
  }'
```

**JavaScript**

```javascript
const newRole = await authFetch('/api/v1/roles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'shift_supervisor',
    display_name: 'Shift Supervisor',
    description: 'Can manage alerts and acknowledge safety events',
    permissions: [
      'aircraft.view',
      'aircraft.view_details',
      'alerts.view',
      'alerts.create',
      'alerts.edit',
      'alerts.delete',
      'safety.view',
      'safety.acknowledge',
      'safety.manage'
    ],
    priority: 25
  })
});
```

### Role Assignment with Expiration

Roles can be assigned with optional expiration for temporary access:

```bash
curl -X POST https://your-skyspy-instance/api/v1/user-roles \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "user": 42,
    "role": 3,
    "expires_at": "2024-02-01T00:00:00Z"
  }'
```

> **Tip: Temporary Access**
>
> Use role expiration for:
> - **Contractors** with limited engagement periods
> - **Trainees** who need elevated access during onboarding
> - **Incident response** requiring temporary admin privileges

---

## Feature-Based Access Control

Each feature can be configured with independent access levels:

### Access Levels

| Level | Description |
|-------|-------------|
| `public` | No authentication required |
| `authenticated` | Any logged-in user |
| `permission` | Specific permission required |

### Configuration Example

```bash
curl -X PATCH https://your-skyspy-instance/api/v1/feature-access/aircraft \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "read_access": "public",
    "write_access": "permission",
    "is_enabled": true
  }'
```

### Hybrid Mode Setup Example

```json
{
  "aircraft": {
    "read_access": "public",
    "write_access": "permission",
    "is_enabled": true
  },
  "alerts": {
    "read_access": "authenticated",
    "write_access": "permission",
    "is_enabled": true
  },
  "safety": {
    "read_access": "authenticated",
    "write_access": "permission",
    "is_enabled": true
  },
  "users": {
    "read_access": "permission",
    "write_access": "permission",
    "is_enabled": true
  }
}
```

---

## WebSocket Authentication

WebSocket connections support both JWT tokens and API keys for real-time data streaming.

### WebSocket Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client
    participant WS as WebSocket Server
    participant Auth as Auth Middleware
    participant Consumer as Consumer

    Client->>WS: Connect with token<br/>(Sec-WebSocket-Protocol)
    WS->>Auth: Validate token

    alt Token Valid
        Auth-->>WS: User authenticated
        WS->>Consumer: Accept connection
        Consumer-->>Client: Connection accepted

        loop Real-time Updates
            Consumer->>Client: Aircraft data
            Consumer->>Client: Alert notifications
        end
    else Token Invalid
        Auth-->>WS: Authentication failed
        WS-->>Client: Close (4001)
    end
```

### Authentication Methods

> **Recommended: Sec-WebSocket-Protocol Header**
>
> ```javascript
> const ws = new WebSocket('wss://your-skyspy/ws/aircraft', ['Bearer', accessToken]);
> ```

> **Warning: Not Recommended - Query String**
>
> ```javascript
> const ws = new WebSocket('wss://your-skyspy/ws/aircraft?token=eyJ...');
> ```
>
> **Why?** Tokens may appear in server logs and browser history.

### Topic-Based Permissions

| Topic | Required Permission | Description |
|-------|---------------------|-------------|
| `aircraft` | `aircraft.view` | Live aircraft positions |
| `military` | `aircraft.view_military` | Military aircraft data |
| `alerts` | `alerts.view` | Alert notifications |
| `safety` | `safety.view` | Safety events |
| `acars` | `acars.view` | ACARS messages |
| `audio` | `audio.view` | Audio stream notifications |
| `system` | `system.view_status` | System status updates |

### Handling Connection Rejection

```javascript
const ws = new WebSocket('wss://your-skyspy/ws/aircraft', ['Bearer', token]);

ws.onclose = (event) => {
  switch (event.code) {
    case 4001:
      console.error('Authentication failed - invalid or expired token');
      // Trigger re-authentication
      break;
    case 4003:
      console.error('Permission denied - insufficient access');
      break;
    default:
      console.log('Connection closed:', event.code);
  }
};
```

---

## Frontend Authentication Flow

The React frontend uses the `AuthContext` provider for authentication state management.

### AuthContext API

```jsx
import { useAuth } from '../contexts/AuthContext';

function MyComponent() {
  const {
    // State
    status,           // 'loading' | 'anonymous' | 'authenticated'
    user,             // Current user object
    config,           // Auth configuration
    error,            // Last error message
    isLoading,        // Boolean shorthand
    isAuthenticated,  // Boolean shorthand
    isAnonymous,      // Boolean shorthand

    // Actions
    login,            // (username, password) => Promise
    logout,           // () => Promise
    loginWithOIDC,    // () => Promise
    refreshAccessToken, // () => Promise<boolean>
    authFetch,        // Authenticated fetch wrapper

    // Permission checks
    hasPermission,    // (permission) => boolean
    hasAnyPermission, // ([permissions]) => boolean
    hasAllPermissions,// ([permissions]) => boolean
    canAccessFeature, // (feature, action?) => boolean

    // Token access
    getAccessToken,   // () => string | null

    // Error handling
    clearError,       // () => void
  } = useAuth();
}
```

### Frontend Login Flow

```mermaid
flowchart LR
    subgraph Login["Login"]
        A[User enters credentials] --> B[Call login]
        B --> C{Success?}
        C -->|Yes| D[Store tokens]
        C -->|No| E[Show error]
        D --> F[Redirect to dashboard]
    end
```

**Standard Login**

```javascript
const { login, error } = useAuth();

async function handleLogin(username, password) {
  const result = await login(username, password);
  if (result.success) {
    navigate('/dashboard');
  } else {
    console.error(result.error);
  }
}
```

**OIDC/SSO Login**

```javascript
const { loginWithOIDC, config } = useAuth();

async function handleOIDCLogin() {
  try {
    const result = await loginWithOIDC();
    if (result.success) {
      navigate('/dashboard');
    }
  } catch (err) {
    // User closed popup or login timed out
    console.error(err.message);
  }
}

// Show OIDC button if enabled
{config.oidcEnabled && (
  <button onClick={handleOIDCLogin}>
    Login with {config.oidcProviderName}
  </button>
)}
```

### Permission Checking

```jsx
const { hasPermission, canAccessFeature } = useAuth();

// Check specific permission
if (hasPermission('alerts.create')) {
  return <CreateAlertButton />;
}

// Check feature access
if (canAccessFeature('safety', 'write')) {
  return <AcknowledgeButton />;
}

// Check multiple permissions
if (hasAllPermissions(['alerts.view', 'alerts.edit'])) {
  return <AlertManagement />;
}
```

### Automatic Token Refresh

```
+--------------------------------------------------------------------+
|                    TOKEN REFRESH TIMELINE                          |
+--------------------------------------------------------------------+
|                                                                    |
|  Token Created        Refresh Scheduled       Token Expires        |
|       |                      |                      |              |
|       v                      v                      v              |
|  ------------------------------------------------------>  Time     |
|  |                          |                      |               |
|  +-------- 59 min 30s ------+                      |               |
|                             +------ 30s buffer ----+               |
|                                                                    |
|  New token obtained before expiry = seamless user experience       |
+--------------------------------------------------------------------+
```

### Token Storage

| Key | Value | Description |
|-----|-------|-------------|
| `skyspy_access_token` | JWT access token | Used for API requests |
| `skyspy_refresh_token` | JWT refresh token | Used to obtain new access tokens |
| `skyspy_user` | Serialized user object | Cached user info |

---

## Security Best Practices

### Security Checklist

> **Production Security Checklist**
>
> Before going to production, verify these settings:
>
> **Environment & Secrets**
> - `DEBUG=false`
> - Strong, unique `DJANGO_SECRET_KEY`
> - Separate `JWT_SECRET_KEY` from Django secret
> - Secrets not committed to version control
>
> **Authentication**
> - `AUTH_MODE=hybrid` or `private`
> - Rate limiting enabled on auth endpoints
> - JWT token lifetimes appropriate for use case
>
> **Cookies & Transport**
> - `SESSION_COOKIE_SECURE=true`
> - `CSRF_COOKIE_SECURE=true`
> - HTTPS enforced
> - CORS restricted to known origins
>
> **API Keys**
> - Scoped to minimum required permissions
> - Expiration dates set
> - Query parameter auth disabled

### Environment Variables

```bash
# Production settings
DEBUG=false
DJANGO_SECRET_KEY=<strong-random-key>
JWT_SECRET_KEY=<different-strong-key>
AUTH_MODE=hybrid

# Enable secure cookies
SESSION_COOKIE_SECURE=true
CSRF_COOKIE_SECURE=true
JWT_AUTH_COOKIE=true
```

### Rate Limiting

| Endpoint | Rate Limit | Purpose |
|----------|------------|---------|
| `/api/v1/auth/login` | 5/minute | Prevent brute force attacks |
| `/api/v1/auth/refresh` | 5/minute | Prevent token abuse |
| Anonymous requests | 100/minute | General protection |
| Authenticated requests | 1000/minute | Fair usage |

### Token Security Best Practices

| Practice | Implementation | Why It Matters |
|----------|----------------|----------------|
| **Separate JWT Secret** | Use different `JWT_SECRET_KEY` than `DJANGO_SECRET_KEY` | Limits blast radius if one key is compromised |
| **Short Access Tokens** | Default 60 minutes, adjust as needed | Limits window for stolen tokens |
| **Token Rotation** | Refresh tokens blacklisted on use | Prevents replay attacks |
| **Secure Storage** | Use httpOnly cookies (`JWT_AUTH_COOKIE=true`) | Prevents XSS token theft |

### API Key Security

> **Warning: API Key Best Practices**
>
> 1. **No Query Parameters** - API keys cannot be passed in URLs (prevents logging/leakage)
> 2. **Hashed Storage** - Only SHA-256 hash stored in database
> 3. **Scoped Access** - Limit API keys to required features only
> 4. **Expiration** - Always set expiration dates on API keys
> 5. **Rotation** - Rotate keys periodically and after team changes

### CORS Configuration

```bash
CORS_ALLOW_ALL_ORIGINS=false
CORS_ALLOW_CREDENTIALS=true
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
```

---

## Configuration Reference

### Authentication Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `AUTH_MODE` | `hybrid` | Authentication mode (public/private/hybrid) |
| `LOCAL_AUTH_ENABLED` | `true` | Enable username/password login |
| `API_KEY_ENABLED` | `true` | Enable API key authentication |
| `JWT_SECRET_KEY` | `SECRET_KEY` | Key for signing JWTs |
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` | `60` | Access token validity |
| `JWT_REFRESH_TOKEN_LIFETIME_DAYS` | `2` | Refresh token validity |
| `JWT_AUTH_COOKIE` | `false` | Store tokens in httpOnly cookies |

### OIDC Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `OIDC_ENABLED` | `false` | Enable OIDC authentication |
| `OIDC_PROVIDER_URL` | - | Base URL of the OIDC provider |
| `OIDC_CLIENT_ID` | - | OAuth client ID |
| `OIDC_CLIENT_SECRET` | - | OAuth client secret |
| `OIDC_PROVIDER_NAME` | `SSO` | Display name for UI |
| `OIDC_SCOPES` | `openid profile email groups` | OAuth scopes to request |
| `OIDC_DEFAULT_ROLE` | `viewer` | Default role for new OIDC users |
| `OIDC_ALLOW_EMAIL_LINKING` | `false` | Allow linking by email (security risk) |

### Rate Limiting Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `DEFAULT_THROTTLE_RATES.anon` | `100/minute` | Anonymous user rate limit |
| `DEFAULT_THROTTLE_RATES.user` | `1000/minute` | Authenticated user rate limit |
| Auth endpoints | `5/minute` | Login/refresh rate limit |

---

## API Endpoints Reference

### Authentication Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/auth/config` | GET | No | Get auth configuration |
| `/api/v1/auth/login` | POST | No | Login with credentials |
| `/api/v1/auth/logout` | POST | Yes | Logout and blacklist token |
| `/api/v1/auth/refresh` | POST | No | Refresh access token |
| `/api/v1/auth/profile` | GET | Yes | Get current user profile |
| `/api/v1/auth/profile` | PATCH | Yes | Update current user profile |
| `/api/v1/auth/password` | POST | Yes | Change password |
| `/api/v1/auth/oidc/authorize` | GET | No | Get OIDC authorization URL |
| `/api/v1/auth/oidc/callback` | GET | No | OIDC callback handler |
| `/api/v1/auth/permissions` | GET | No | List all permissions |
| `/api/v1/auth/my-permissions` | GET | Yes | Get current user permissions |

### User Management Endpoints

| Endpoint | Method | Permission | Description |
|----------|--------|------------|-------------|
| `/api/v1/users` | GET | `users.view` | List users |
| `/api/v1/users` | POST | `users.create` | Create user |
| `/api/v1/users/{id}` | GET | `users.view` | Get user details |
| `/api/v1/users/{id}` | PATCH | `users.edit` | Update user |
| `/api/v1/users/{id}` | DELETE | `users.delete` | Delete user |

### Role Management Endpoints

| Endpoint | Method | Permission | Description |
|----------|--------|------------|-------------|
| `/api/v1/roles` | GET | `roles.view` | List roles |
| `/api/v1/roles` | POST | `roles.create` | Create role |
| `/api/v1/roles/{id}` | GET | `roles.view` | Get role details |
| `/api/v1/roles/{id}` | PATCH | `roles.edit` | Update role |
| `/api/v1/roles/{id}` | DELETE | `roles.delete` | Delete role |

### API Key Management Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/api-keys` | GET | Yes | List user's API keys |
| `/api/v1/api-keys` | POST | Yes | Create API key |
| `/api/v1/api-keys/{id}` | DELETE | Yes | Delete API key |

---

## Troubleshooting

### Common Issues

> **401 Unauthorized**
>
> **Possible causes:**
> - Token is expired
> - Invalid Authorization header format (should be `Bearer <token>`)
> - User account is deactivated
>
> **Solutions:**
> 1. Check token expiration with a JWT decoder
> 2. Verify header format: `Authorization: Bearer eyJ...`
> 3. Confirm user `is_active=True` in database

> **Warning: 403 Forbidden**
>
> **Possible causes:**
> - User lacks required permission
> - Feature is disabled
> - API key scope doesn't include the feature
>
> **Solutions:**
> 1. Check user permissions via `/api/v1/auth/my-permissions`
> 2. Verify feature is enabled in admin
> 3. Check API key scopes if using API key auth

> **OIDC Login Failed**
>
> **Possible causes:**
> - Incorrect `OIDC_CLIENT_SECRET`
> - Redirect URIs not configured in IdP
> - Scopes not allowed by IdP
>
> **Solutions:**
> 1. Double-check client secret in environment
> 2. Add callback URL to IdP allowed redirects: `https://your-domain/api/v1/auth/oidc/callback`
> 3. Verify scopes are enabled in IdP application settings

> **WebSocket Connection Rejected (4001)**
>
> **Possible causes:**
> - Token is invalid or expired
> - Using query string instead of header
> - `WS_REJECT_INVALID_TOKENS` is enabled
>
> **Solutions:**
> 1. Refresh token before connecting
> 2. Use `Sec-WebSocket-Protocol` header: `new WebSocket(url, ['Bearer', token])`
> 3. Check WebSocket middleware configuration

### Debug Logging

Enable debug logging for authentication issues:

```python
LOGGING = {
    'loggers': {
        'skyspy.auth': {
            'level': 'DEBUG',
            'handlers': ['console'],
        },
    },
}
```

---

## Next Steps

> **Ready to integrate?**
>
> - **Quick Start**: Try the `/api/v1/auth/login` endpoint with your credentials
> - **API Keys**: Create a scoped API key for your integration
> - **Enterprise**: Configure OIDC with your identity provider
> - **Support**: Check our GitHub issues or contact support
