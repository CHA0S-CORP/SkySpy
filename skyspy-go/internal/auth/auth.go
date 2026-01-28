package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Manager handles authentication for the CLI
type Manager struct {
	baseURL    string
	host       string
	config     *AuthConfig
	tokenStore TokenStore
	tokens     *TokenSet
	apiKey     string
	mu         sync.RWMutex
}

// NewManager creates a new authentication manager
func NewManager(host string, port int) (*Manager, error) {
	baseURL := fmt.Sprintf("http://%s:%d", host, port)
	hostKey := fmt.Sprintf("%s:%d", host, port)

	// Fetch auth configuration
	config, err := FetchAuthConfig(baseURL)
	if err != nil {
		// If we can't fetch config, assume public mode
		config = &AuthConfig{
			AuthMode:    "public",
			AuthEnabled: false,
		}
	}

	// Initialize token store
	tokenStore, err := NewFileTokenStore()
	if err != nil {
		return nil, fmt.Errorf("failed to initialize token store: %w", err)
	}

	m := &Manager{
		baseURL:    baseURL,
		host:       hostKey,
		config:     config,
		tokenStore: tokenStore,
	}

	// Load existing tokens
	tokens, err := tokenStore.Load(hostKey)
	if err == nil && tokens != nil {
		m.tokens = tokens
	}

	return m, nil
}

// SetAPIKey sets an API key for authentication
func (m *Manager) SetAPIKey(key string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.apiKey = key
}

// RequiresAuth returns true if authentication is required
func (m *Manager) RequiresAuth() bool {
	return m.config.AuthEnabled && m.config.AuthMode != "public"
}

// IsAuthenticated returns true if we have valid credentials
func (m *Manager) IsAuthenticated() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// API key takes precedence
	if m.apiKey != "" {
		return true
	}

	// Check tokens
	if m.tokens == nil {
		return false
	}

	// If token is expired but we have refresh token, we can refresh
	if m.tokens.RefreshToken != "" {
		return true
	}

	return !m.tokens.IsExpired()
}

// GetAuthConfig returns the auth configuration
func (m *Manager) GetAuthConfig() *AuthConfig {
	return m.config
}

// GetUsername returns the authenticated user's username
func (m *Manager) GetUsername() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.tokens != nil {
		return m.tokens.Username
	}
	return ""
}

// Login initiates the login flow
func (m *Manager) Login(ctx context.Context) error {
	if !m.config.AuthEnabled {
		return fmt.Errorf("server does not require authentication")
	}

	if m.config.OIDCEnabled {
		return m.loginOIDC(ctx)
	}

	if m.config.LocalAuthEnabled {
		return fmt.Errorf("local authentication not supported in CLI - use OIDC or API key")
	}

	return fmt.Errorf("no supported authentication method available")
}

// loginOIDC performs OIDC authentication flow
func (m *Manager) loginOIDC(ctx context.Context) error {
	// Start callback server
	callbackServer, err := NewCallbackServer()
	if err != nil {
		return fmt.Errorf("failed to start callback server: %w", err)
	}
	defer callbackServer.Stop()

	if err := callbackServer.Start(); err != nil {
		return fmt.Errorf("failed to start callback server: %w", err)
	}

	// Get OIDC authorization URL
	redirectURI := callbackServer.RedirectURI()
	authResp, err := GetOIDCAuthorizationURL(m.baseURL, redirectURI)
	if err != nil {
		return fmt.Errorf("failed to get authorization URL: %w", err)
	}

	// Open browser
	fmt.Printf("Opening browser for authentication...\n")
	if CanOpenBrowser() {
		if err := OpenBrowser(authResp.AuthorizationURL); err != nil {
			fmt.Printf("Could not open browser automatically.\n")
			fmt.Printf("Please open this URL in your browser:\n\n%s\n\n", authResp.AuthorizationURL)
		}
	} else {
		fmt.Printf("Please open this URL in your browser:\n\n%s\n\n", authResp.AuthorizationURL)
	}

	// Wait for callback
	fmt.Printf("Waiting for authentication (timeout: 5 minutes)...\n")
	result, err := callbackServer.WaitForCallback(ctx, 5*time.Minute)
	if err != nil {
		return err
	}

	// Exchange code for tokens via the API callback endpoint
	tokens, err := m.exchangeCodeForTokens(result.Code, result.State, redirectURI)
	if err != nil {
		return fmt.Errorf("failed to exchange code for tokens: %w", err)
	}

	// Store tokens
	m.mu.Lock()
	m.tokens = tokens
	m.mu.Unlock()

	if err := m.tokenStore.Save(m.host, tokens); err != nil {
		return fmt.Errorf("failed to save tokens: %w", err)
	}

	return nil
}

// exchangeCodeForTokens exchanges the authorization code for tokens
func (m *Manager) exchangeCodeForTokens(code, state, redirectURI string) (*TokenSet, error) {
	// Call the API's callback endpoint to exchange the code
	// The API handles the actual token exchange with the OIDC provider
	callbackURL := fmt.Sprintf("%s/api/v1/auth/oidc/callback?code=%s&state=%s&redirect_uri=%s&cli=true",
		m.baseURL,
		url.QueryEscape(code),
		url.QueryEscape(state),
		url.QueryEscape(redirectURI))

	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// Don't follow redirects - we want the JSON response
			return http.ErrUseLastResponse
		},
	}

	resp, err := client.Get(callbackURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// The API might return tokens directly or in a different format
	// Try to parse the response
	if resp.StatusCode == http.StatusOK {
		var tokenResp struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int    `json:"expires_in"`
			TokenType    string `json:"token_type"`
		}

		if err := decodeJSON(resp.Body, &tokenResp); err != nil {
			return nil, fmt.Errorf("failed to parse token response: %w", err)
		}

		expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
		if tokenResp.ExpiresIn == 0 {
			expiresAt = time.Now().Add(60 * time.Minute) // Default 60 min
		}

		tokens := &TokenSet{
			AccessToken:  tokenResp.AccessToken,
			RefreshToken: tokenResp.RefreshToken,
			ExpiresAt:    expiresAt,
			TokenType:    tokenResp.TokenType,
			Host:         m.host,
		}

		// Fetch user profile to get username
		if profile, err := FetchUserProfile(m.baseURL, tokens.AccessToken); err == nil {
			tokens.Username = profile.Username
			if tokens.Username == "" {
				tokens.Username = profile.Email
			}
		}

		return tokens, nil
	}

	// Handle redirect response (API might redirect with tokens in URL)
	if resp.StatusCode == http.StatusFound || resp.StatusCode == http.StatusTemporaryRedirect {
		location := resp.Header.Get("Location")
		if location != "" {
			// Parse tokens from redirect URL
			return m.parseTokensFromRedirect(location)
		}
	}

	return nil, fmt.Errorf("unexpected response status: %d", resp.StatusCode)
}

// parseTokensFromRedirect extracts tokens from a redirect URL
func (m *Manager) parseTokensFromRedirect(redirectURL string) (*TokenSet, error) {
	parsed, err := url.Parse(redirectURL)
	if err != nil {
		return nil, err
	}

	// Check fragment (for implicit flow) or query params
	values := parsed.Query()
	if parsed.Fragment != "" {
		fragmentValues, err := url.ParseQuery(parsed.Fragment)
		if err == nil {
			for k, v := range fragmentValues {
				values[k] = v
			}
		}
	}

	accessToken := values.Get("access_token")
	if accessToken == "" {
		return nil, fmt.Errorf("no access token in redirect")
	}

	refreshToken := values.Get("refresh_token")
	expiresIn := 3600 // Default 1 hour
	if exp := values.Get("expires_in"); exp != "" {
		fmt.Sscanf(exp, "%d", &expiresIn)
	}

	tokens := &TokenSet{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    time.Now().Add(time.Duration(expiresIn) * time.Second),
		TokenType:    values.Get("token_type"),
		Host:         m.host,
	}

	// Fetch user profile
	if profile, err := FetchUserProfile(m.baseURL, tokens.AccessToken); err == nil {
		tokens.Username = profile.Username
		if tokens.Username == "" {
			tokens.Username = profile.Email
		}
	}

	return tokens, nil
}

// GetAccessToken returns a valid access token, refreshing if needed
func (m *Manager) GetAccessToken() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// API key takes precedence
	if m.apiKey != "" {
		return m.apiKey, nil
	}

	if m.tokens == nil {
		return "", fmt.Errorf("not authenticated")
	}

	// Check if refresh is needed
	if m.tokens.NeedsRefresh() && m.tokens.RefreshToken != "" {
		if err := m.refreshTokenLocked(); err != nil {
			// If refresh fails and token is expired, return error
			if m.tokens.IsExpired() {
				return "", fmt.Errorf("token expired and refresh failed: %w", err)
			}
			// Token not yet expired, use existing one
		}
	}

	if m.tokens.IsExpired() {
		return "", fmt.Errorf("token expired")
	}

	return m.tokens.AccessToken, nil
}

// GetAuthHeader returns the appropriate authorization header value
func (m *Manager) GetAuthHeader() (string, error) {
	m.mu.RLock()
	apiKey := m.apiKey
	m.mu.RUnlock()

	if apiKey != "" {
		// Check if it's an API key format
		if strings.HasPrefix(apiKey, "sk_") {
			return "ApiKey " + apiKey, nil
		}
		return "Bearer " + apiKey, nil
	}

	token, err := m.GetAccessToken()
	if err != nil {
		return "", err
	}

	return "Bearer " + token, nil
}

// refreshTokenLocked refreshes the access token (must be called with lock held)
func (m *Manager) refreshTokenLocked() error {
	tokenResp, err := RefreshAccessToken(m.baseURL, m.tokens.RefreshToken)
	if err != nil {
		return err
	}

	m.tokens.AccessToken = tokenResp.AccessToken
	if tokenResp.RefreshToken != "" {
		m.tokens.RefreshToken = tokenResp.RefreshToken
	}

	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	if tokenResp.ExpiresIn == 0 {
		expiresAt = time.Now().Add(60 * time.Minute)
	}
	m.tokens.ExpiresAt = expiresAt

	// Save updated tokens
	if err := m.tokenStore.Save(m.host, m.tokens); err != nil {
		// Log but don't fail
		fmt.Printf("Warning: failed to save refreshed tokens: %v\n", err)
	}

	return nil
}

// Logout clears stored credentials
func (m *Manager) Logout() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.tokens = nil
	m.apiKey = ""

	return m.tokenStore.Delete(m.host)
}

// GetTokenInfo returns information about the current token (for debugging)
func (m *Manager) GetTokenInfo() map[string]interface{} {
	m.mu.RLock()
	defer m.mu.RUnlock()

	info := make(map[string]interface{})
	info["host"] = m.host
	info["auth_enabled"] = m.config.AuthEnabled
	info["auth_mode"] = m.config.AuthMode
	info["oidc_enabled"] = m.config.OIDCEnabled
	info["oidc_provider"] = m.config.OIDCProviderName

	if m.apiKey != "" {
		info["auth_type"] = "api_key"
		info["api_key_prefix"] = m.apiKey[:min(10, len(m.apiKey))] + "..."
	} else if m.tokens != nil {
		info["auth_type"] = "oidc"
		info["username"] = m.tokens.Username
		info["expires_at"] = m.tokens.ExpiresAt.Format(time.RFC3339)
		info["expired"] = m.tokens.IsExpired()
		info["has_refresh_token"] = m.tokens.RefreshToken != ""
	} else {
		info["auth_type"] = "none"
	}

	return info
}

// Helper to decode JSON
func decodeJSON(r io.Reader, v interface{}) error {
	return json.NewDecoder(r).Decode(v)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
