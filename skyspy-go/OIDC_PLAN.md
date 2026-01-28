# OIDC Authentication Plan for SkySpy Go CLI

## Overview

Implement OAuth 2.0 / OIDC authentication in the Go CLI to support the existing Django API's OIDC flow. This follows the same pattern used by `kubectl`, `gh` (GitHub CLI), `gcloud`, and `aws-cli`.

## Current API Capabilities

The Django API already supports:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/auth/config` | Returns auth configuration (oidc_enabled, provider_name, etc.) |
| `GET /api/v1/auth/oidc/authorize?redirect_uri=X` | Returns OIDC authorization URL |
| `GET /api/v1/auth/oidc/callback?code=X&state=X` | Exchanges code for tokens |
| `POST /api/v1/auth/refresh` | Refresh access token |
| `GET /api/v1/auth/profile` | Get current user info |

WebSocket authentication accepts tokens via:
- Query string: `?token=eyJ...` (not recommended)
- `Sec-WebSocket-Protocol: Bearer, eyJ...` (recommended)

## Authentication Flow

```
┌─────────┐       ┌─────────┐       ┌─────────┐       ┌─────────┐
│   CLI   │       │  Local  │       │ Browser │       │  OIDC   │
│         │       │ Server  │       │         │       │Provider │
└────┬────┘       └────┬────┘       └────┬────┘       └────┬────┘
     │                 │                 │                 │
     │ 1. Start local  │                 │                 │
     │    callback     │                 │                 │
     │    server       │                 │                 │
     ├────────────────►│                 │                 │
     │                 │                 │                 │
     │ 2. Get auth URL │                 │                 │
     │    from API     │                 │                 │
     ├─────────────────┼─────────────────┼────────────────►│
     │                 │                 │                 │
     │ 3. Open browser │                 │                 │
     ├─────────────────┼────────────────►│                 │
     │                 │                 │                 │
     │                 │                 │ 4. User logs in │
     │                 │                 ├────────────────►│
     │                 │                 │                 │
     │                 │                 │◄────────────────┤
     │                 │                 │ 5. Redirect     │
     │                 │                 │    with code    │
     │                 │◄────────────────┤                 │
     │                 │ 6. Callback     │                 │
     │                 │    received     │                 │
     │◄────────────────┤                 │                 │
     │ 7. Exchange     │                 │                 │
     │    code via API │                 │                 │
     ├─────────────────┼─────────────────┼────────────────►│
     │                 │                 │                 │
     │◄────────────────┼─────────────────┼─────────────────┤
     │ 8. Receive      │                 │                 │
     │    tokens       │                 │                 │
     │                 │                 │                 │
     │ 9. Store tokens │                 │                 │
     │    securely     │                 │                 │
     │                 │                 │                 │
```

## Implementation Phases

### Phase 1: Auth Package Foundation

Create `internal/auth/` package with:

```
internal/auth/
├── auth.go           # Main auth manager
├── config.go         # Fetch auth config from API
├── tokens.go         # Token storage and refresh
├── oidc.go           # OIDC flow implementation
├── callback.go       # Local callback server
└── keyring.go        # Secure credential storage
```

#### 1.1 Auth Configuration Fetching

```go
// internal/auth/config.go

type AuthConfig struct {
    AuthMode         string `json:"auth_mode"`
    AuthEnabled      bool   `json:"auth_enabled"`
    OIDCEnabled      bool   `json:"oidc_enabled"`
    OIDCProviderName string `json:"oidc_provider_name"`
    LocalAuthEnabled bool   `json:"local_auth_enabled"`
    APIKeyEnabled    bool   `json:"api_key_enabled"`
}

// FetchAuthConfig gets auth configuration from the API
func FetchAuthConfig(baseURL string) (*AuthConfig, error) {
    resp, err := http.Get(baseURL + "/api/v1/auth/config")
    // Parse and return config
}
```

#### 1.2 Token Storage

Store tokens securely using OS keychain/keyring:
- macOS: Keychain via `github.com/keybase/go-keychain`
- Linux: Secret Service / libsecret via `github.com/zalando/go-keyring`
- Windows: Windows Credential Manager via same library
- Fallback: Encrypted file in `~/.config/skyspy/credentials.json`

```go
// internal/auth/tokens.go

type TokenSet struct {
    AccessToken  string    `json:"access_token"`
    RefreshToken string    `json:"refresh_token"`
    ExpiresAt    time.Time `json:"expires_at"`
    TokenType    string    `json:"token_type"`
}

type TokenStore interface {
    Save(host string, tokens *TokenSet) error
    Load(host string) (*TokenSet, error)
    Delete(host string) error
}

// KeyringStore uses OS keychain
type KeyringStore struct{}

// FileStore uses encrypted file (fallback)
type FileStore struct {
    path string
}
```

#### 1.3 OIDC Flow

```go
// internal/auth/oidc.go

type OIDCFlow struct {
    baseURL      string
    callbackPort int
    state        string
    codeCh       chan string
    errCh        chan error
}

// Start initiates the OIDC login flow
func (f *OIDCFlow) Start(ctx context.Context) (*TokenSet, error) {
    // 1. Start local callback server
    // 2. Get authorization URL from API
    // 3. Open browser
    // 4. Wait for callback
    // 5. Exchange code for tokens
    // 6. Return tokens
}
```

#### 1.4 Local Callback Server

```go
// internal/auth/callback.go

type CallbackServer struct {
    port   int
    server *http.Server
    codeCh chan string
    errCh  chan error
}

func (s *CallbackServer) Start() error {
    // Find available port in range 8400-8500
    // Start HTTP server
    // Handle callback at /callback
}

func (s *CallbackServer) handleCallback(w http.ResponseWriter, r *http.Request) {
    // Extract code and state from query params
    // Validate state
    // Send code to channel
    // Return success HTML page to browser
}
```

### Phase 2: Auth Manager

```go
// internal/auth/auth.go

type Manager struct {
    baseURL    string
    config     *AuthConfig
    tokenStore TokenStore
    tokens     *TokenSet
    mu         sync.RWMutex
}

// NewManager creates a new auth manager
func NewManager(baseURL string) (*Manager, error) {
    // Fetch auth config
    // Initialize token store
    // Load existing tokens if any
}

// RequiresAuth returns true if authentication is required
func (m *Manager) RequiresAuth() bool {
    return m.config.AuthEnabled && m.config.AuthMode != "public"
}

// IsAuthenticated returns true if we have valid tokens
func (m *Manager) IsAuthenticated() bool {
    return m.tokens != nil && m.tokens.ExpiresAt.After(time.Now())
}

// Login initiates the appropriate login flow
func (m *Manager) Login(ctx context.Context) error {
    if m.config.OIDCEnabled {
        return m.loginOIDC(ctx)
    }
    return errors.New("no supported auth method available")
}

// GetAccessToken returns a valid access token, refreshing if needed
func (m *Manager) GetAccessToken() (string, error) {
    // Check if token is expired
    // Refresh if needed
    // Return access token
}

// Logout clears stored credentials
func (m *Manager) Logout() error {
    return m.tokenStore.Delete(m.baseURL)
}
```

### Phase 3: CLI Integration

#### 3.1 New CLI Commands

```bash
# Login command
skyspy login [--host HOST]

# Logout command
skyspy logout [--host HOST]

# Status command (show auth status)
skyspy auth status

# Token command (print current token for debugging)
skyspy auth token [--decode]
```

#### 3.2 Command Implementations

```go
// cmd/skyspy/login.go

var loginCmd = &cobra.Command{
    Use:   "login",
    Short: "Authenticate with the SkySpy server",
    RunE: func(cmd *cobra.Command, args []string) error {
        // Load config
        cfg, _ := config.Load()

        // Create auth manager
        baseURL := fmt.Sprintf("http://%s:%d", cfg.Connection.Host, cfg.Connection.Port)
        authMgr, err := auth.NewManager(baseURL)
        if err != nil {
            return err
        }

        // Check if auth is required
        if !authMgr.RequiresAuth() {
            fmt.Println("Server does not require authentication")
            return nil
        }

        // Check if already authenticated
        if authMgr.IsAuthenticated() {
            fmt.Println("Already authenticated. Use 'skyspy logout' to sign out.")
            return nil
        }

        // Perform login
        fmt.Println("Opening browser for authentication...")
        if err := authMgr.Login(cmd.Context()); err != nil {
            return err
        }

        fmt.Println("Successfully authenticated!")
        return nil
    },
}
```

#### 3.3 WebSocket Integration

Update the WebSocket client to use authentication:

```go
// internal/ws/client.go

type Client struct {
    // ... existing fields
    authManager *auth.Manager
}

func (c *Client) getWebSocketHeader() http.Header {
    header := http.Header{}

    if c.authManager != nil && c.authManager.IsAuthenticated() {
        token, err := c.authManager.GetAccessToken()
        if err == nil {
            // Use Sec-WebSocket-Protocol for token (recommended by API)
            header.Set("Sec-WebSocket-Protocol", "Bearer, "+token)
        }
    }

    return header
}
```

#### 3.4 App Integration

Update the main app to handle authentication:

```go
// internal/app/app.go

func NewModel(cfg *config.Config) *Model {
    // Create auth manager
    baseURL := fmt.Sprintf("http://%s:%d", cfg.Connection.Host, cfg.Connection.Port)
    authMgr, err := auth.NewManager(baseURL)

    // Check authentication status
    if authMgr.RequiresAuth() && !authMgr.IsAuthenticated() {
        // Show login prompt or error
    }

    // Pass auth manager to WebSocket client
    wsClient := ws.NewClient(cfg.Connection.Host, cfg.Connection.Port,
        cfg.Connection.ReconnectDelay, authMgr)

    // ...
}
```

### Phase 4: Enhanced Features

#### 4.1 API Key Support

For non-interactive/CI environments:

```go
// internal/auth/apikey.go

func (m *Manager) LoginWithAPIKey(key string) error {
    // Validate key format (sk_...)
    // Store key
    // Mark as authenticated
}
```

CLI flag:
```bash
skyspy --api-key sk_xxxxx
# or
SKYSPY_API_KEY=sk_xxxxx skyspy
```

#### 4.2 Token Auto-Refresh

Automatic token refresh before expiration:

```go
func (m *Manager) startAutoRefresh(ctx context.Context) {
    go func() {
        for {
            // Calculate time until refresh needed (e.g., 5 min before expiry)
            refreshAt := m.tokens.ExpiresAt.Add(-5 * time.Minute)
            sleepDuration := time.Until(refreshAt)

            select {
            case <-ctx.Done():
                return
            case <-time.After(sleepDuration):
                m.refreshToken()
            }
        }
    }()
}
```

#### 4.3 Multiple Host Support

Store credentials per-host:

```
~/.config/skyspy/
├── settings.json
└── credentials/
    ├── localhost_80.json
    └── skyspy.example.com_443.json
```

### Phase 5: User Experience Polish

#### 5.1 Browser Detection

```go
// internal/auth/browser.go

func OpenBrowser(url string) error {
    var cmd *exec.Cmd

    switch runtime.GOOS {
    case "darwin":
        cmd = exec.Command("open", url)
    case "linux":
        // Try xdg-open, then fallback to common browsers
        cmd = exec.Command("xdg-open", url)
    case "windows":
        cmd = exec.Command("cmd", "/c", "start", url)
    }

    return cmd.Run()
}
```

#### 5.2 Callback HTML Page

Beautiful success/error pages for the browser:

```go
const successHTML = `<!DOCTYPE html>
<html>
<head>
    <title>SkySpy - Authentication Successful</title>
    <style>
        body { font-family: -apple-system, sans-serif;
               display: flex; justify-content: center;
               align-items: center; height: 100vh; margin: 0;
               background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); }
        .container { text-align: center; color: #fff; }
        .icon { font-size: 64px; margin-bottom: 20px; }
        h1 { color: #00ff88; }
        p { color: #8892b0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✓</div>
        <h1>Authentication Successful</h1>
        <p>You can close this window and return to the terminal.</p>
    </div>
</body>
</html>`
```

#### 5.3 CLI Progress Feedback

```go
fmt.Println("🔐 Starting authentication...")
fmt.Println("📡 Fetching auth configuration...")
fmt.Println("🌐 Opening browser for login...")
fmt.Println("⏳ Waiting for authentication...")
fmt.Println("✅ Successfully authenticated as user@example.com")
```

#### 5.4 Device Code Flow (Alternative)

For environments without browser (e.g., SSH sessions):

```
$ skyspy login
No browser available. Use device code flow:

Visit: https://provider.com/device
Enter code: ABCD-EFGH

Waiting for authentication...
```

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `internal/auth/auth.go` | Main auth manager |
| `internal/auth/config.go` | API auth config fetching |
| `internal/auth/tokens.go` | Token storage interface |
| `internal/auth/keyring.go` | OS keychain integration |
| `internal/auth/file_store.go` | Encrypted file fallback |
| `internal/auth/oidc.go` | OIDC flow implementation |
| `internal/auth/callback.go` | Local HTTP callback server |
| `internal/auth/browser.go` | Browser opening utilities |
| `internal/auth/apikey.go` | API key authentication |
| `cmd/skyspy/login.go` | Login command |
| `cmd/skyspy/logout.go` | Logout command |
| `cmd/skyspy/auth.go` | Auth subcommands |

### Modified Files

| File | Changes |
|------|---------|
| `cmd/skyspy/main.go` | Add auth subcommands, --api-key flag |
| `internal/ws/client.go` | Add auth header support |
| `internal/app/app.go` | Integrate auth manager |
| `internal/config/config.go` | Add credential storage config |
| `go.mod` | Add keyring dependency |

## Dependencies

Add to `go.mod`:

```go
require (
    github.com/zalando/go-keyring v0.2.3  // Cross-platform keyring
    github.com/pkg/browser v0.0.0-20210911075715-681adbf594b8  // Browser opening
)
```

## Security Considerations

1. **Token Storage**: Use OS keychain when available, encrypted file as fallback
2. **State Parameter**: Generate cryptographically secure random state for CSRF protection
3. **Callback Validation**: Only accept callbacks on localhost
4. **No Token Logging**: Never log access or refresh tokens
5. **Secure Defaults**: Require HTTPS for non-localhost connections
6. **Token Refresh**: Refresh before expiry, not after failure
7. **Credential Isolation**: Store credentials per-host to prevent cross-site attacks

## Testing Plan

1. **Unit Tests**: Mock HTTP responses for auth config/token exchange
2. **Integration Tests**: Test with actual OIDC provider (Keycloak in Docker)
3. **Manual Testing**:
   - Fresh login flow
   - Token refresh
   - Expired token handling
   - Logout
   - Multiple hosts
   - API key authentication

## API Changes Needed

The current API callback handles browser redirects. For CLI, we may want:

1. **Option A**: Use existing callback with CLI's local redirect
   - CLI provides `redirect_uri=http://localhost:8400/callback`
   - Works with current API implementation

2. **Option B**: Add CLI-specific callback endpoint (optional)
   - `GET /api/v1/auth/oidc/callback/cli`
   - Returns JSON instead of HTML/redirect
   - Simpler for CLI to parse

Recommendation: Start with **Option A** as it requires no API changes.

## Timeline Estimate

| Phase | Description | Complexity |
|-------|-------------|------------|
| 1 | Auth package foundation | Medium |
| 2 | Auth manager | Medium |
| 3 | CLI integration | Medium |
| 4 | Enhanced features | Low |
| 5 | UX polish | Low |

## Example Usage

```bash
# Check if auth is required
$ skyspy auth status
Server: http://localhost:80
Auth Mode: hybrid
OIDC: enabled (via Keycloak)
Status: Not authenticated

# Login
$ skyspy login
🔐 Starting authentication with Keycloak...
🌐 Opening browser for login...
⏳ Waiting for authentication...
✅ Successfully authenticated as user@example.com

# Now radar works
$ skyspy
[Radar display with authenticated WebSocket connection]

# Logout
$ skyspy logout
Successfully logged out from localhost:80

# Non-interactive with API key
$ skyspy --api-key sk_abc123xyz
[Radar display with API key authentication]

# Or via environment
$ SKYSPY_API_KEY=sk_abc123xyz skyspy
```
