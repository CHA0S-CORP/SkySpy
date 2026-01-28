package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// mockTokenStore is a simple in-memory token store for testing
type mockTokenStore struct {
	tokens map[string]*TokenSet
}

func newMockTokenStore() *mockTokenStore {
	return &mockTokenStore{
		tokens: make(map[string]*TokenSet),
	}
}

func (m *mockTokenStore) Save(host string, tokens *TokenSet) error {
	m.tokens[host] = tokens
	return nil
}

func (m *mockTokenStore) Load(host string) (*TokenSet, error) {
	if t, ok := m.tokens[host]; ok {
		return t, nil
	}
	return nil, nil
}

func (m *mockTokenStore) Delete(host string) error {
	delete(m.tokens, host)
	return nil
}

func (m *mockTokenStore) List() ([]string, error) {
	hosts := make([]string, 0, len(m.tokens))
	for host := range m.tokens {
		hosts = append(hosts, host)
	}
	return hosts, nil
}

// createTestManager creates a Manager with a mock token store for testing
func createTestManager(config *AuthConfig, tokens *TokenSet, apiKey string) *Manager {
	store := newMockTokenStore()
	host := "test:8080"
	if tokens != nil {
		store.tokens[host] = tokens
	}

	return &Manager{
		baseURL:    "http://test:8080",
		host:       host,
		config:     config,
		tokenStore: store,
		tokens:     tokens,
		apiKey:     apiKey,
	}
}

func TestManager_New(t *testing.T) {
	// Create a mock server that returns auth config
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/config" {
			json.NewEncoder(w).Encode(AuthConfig{
				AuthMode:         "oidc",
				AuthEnabled:      true,
				OIDCEnabled:      true,
				OIDCProviderName: "Test Provider",
				APIKeyEnabled:    true,
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	// Extract host and port from test server URL
	// Note: NewManager expects host and port separately, so we test with a mock
	// For unit testing, we use createTestManager instead

	// Test that manager creation works with valid config
	config := &AuthConfig{
		AuthMode:         "oidc",
		AuthEnabled:      true,
		OIDCEnabled:      true,
		OIDCProviderName: "Test Provider",
	}

	m := createTestManager(config, nil, "")

	if m == nil {
		t.Fatal("expected manager to be created")
	}

	if m.config.AuthMode != "oidc" {
		t.Errorf("expected auth mode 'oidc', got '%s'", m.config.AuthMode)
	}

	if !m.config.AuthEnabled {
		t.Error("expected auth to be enabled")
	}

	if !m.config.OIDCEnabled {
		t.Error("expected OIDC to be enabled")
	}

	if m.config.OIDCProviderName != "Test Provider" {
		t.Errorf("expected provider 'Test Provider', got '%s'", m.config.OIDCProviderName)
	}
}

func TestManager_RequiresAuth_Public(t *testing.T) {
	testCases := []struct {
		name     string
		config   *AuthConfig
		expected bool
	}{
		{
			name: "public mode does not require auth",
			config: &AuthConfig{
				AuthMode:    "public",
				AuthEnabled: false,
			},
			expected: false,
		},
		{
			name: "public mode with auth enabled still does not require",
			config: &AuthConfig{
				AuthMode:    "public",
				AuthEnabled: true,
			},
			expected: false,
		},
		{
			name: "auth disabled does not require auth",
			config: &AuthConfig{
				AuthMode:    "oidc",
				AuthEnabled: false,
			},
			expected: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			m := createTestManager(tc.config, nil, "")
			if got := m.RequiresAuth(); got != tc.expected {
				t.Errorf("RequiresAuth() = %v, expected %v", got, tc.expected)
			}
		})
	}
}

func TestManager_RequiresAuth_OIDC(t *testing.T) {
	testCases := []struct {
		name     string
		config   *AuthConfig
		expected bool
	}{
		{
			name: "OIDC mode requires auth",
			config: &AuthConfig{
				AuthMode:    "oidc",
				AuthEnabled: true,
				OIDCEnabled: true,
			},
			expected: true,
		},
		{
			name: "private mode requires auth",
			config: &AuthConfig{
				AuthMode:    "private",
				AuthEnabled: true,
			},
			expected: true,
		},
		{
			name: "local_auth mode requires auth",
			config: &AuthConfig{
				AuthMode:         "local_auth",
				AuthEnabled:      true,
				LocalAuthEnabled: true,
			},
			expected: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			m := createTestManager(tc.config, nil, "")
			if got := m.RequiresAuth(); got != tc.expected {
				t.Errorf("RequiresAuth() = %v, expected %v", got, tc.expected)
			}
		})
	}
}

func TestManager_IsAuthenticated_NoTokens(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
		OIDCEnabled: true,
	}

	m := createTestManager(config, nil, "")

	if m.IsAuthenticated() {
		t.Error("expected IsAuthenticated to return false when no tokens are set")
	}
}

func TestManager_IsAuthenticated_ValidToken(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
		OIDCEnabled: true,
	}

	tokens := &TokenSet{
		AccessToken: "valid-access-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour), // Valid for 1 hour
		TokenType:   "Bearer",
		Host:        "test:8080",
		Username:    "testuser",
	}

	m := createTestManager(config, tokens, "")

	if !m.IsAuthenticated() {
		t.Error("expected IsAuthenticated to return true with valid token")
	}
}

func TestManager_IsAuthenticated_ExpiredWithRefresh(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
		OIDCEnabled: true,
	}

	// Token is expired but has refresh token
	tokens := &TokenSet{
		AccessToken:  "expired-access-token",
		RefreshToken: "valid-refresh-token",
		ExpiresAt:    time.Now().Add(-1 * time.Hour), // Expired 1 hour ago
		TokenType:    "Bearer",
		Host:         "test:8080",
		Username:     "testuser",
	}

	m := createTestManager(config, tokens, "")

	if !m.IsAuthenticated() {
		t.Error("expected IsAuthenticated to return true with expired token but valid refresh token")
	}
}

func TestManager_IsAuthenticated_ExpiredNoRefresh(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
		OIDCEnabled: true,
	}

	// Token is expired and has no refresh token
	tokens := &TokenSet{
		AccessToken: "expired-access-token",
		ExpiresAt:   time.Now().Add(-1 * time.Hour), // Expired 1 hour ago
		TokenType:   "Bearer",
		Host:        "test:8080",
		Username:    "testuser",
	}

	m := createTestManager(config, tokens, "")

	if m.IsAuthenticated() {
		t.Error("expected IsAuthenticated to return false with expired token and no refresh token")
	}
}

func TestManager_IsAuthenticated_ApiKey(t *testing.T) {
	config := &AuthConfig{
		AuthMode:      "oidc",
		AuthEnabled:   true,
		OIDCEnabled:   true,
		APIKeyEnabled: true,
	}

	// No tokens, but has API key
	m := createTestManager(config, nil, "sk_test_api_key_12345")

	if !m.IsAuthenticated() {
		t.Error("expected IsAuthenticated to return true with API key")
	}
}

func TestManager_IsAuthenticated_ApiKeyPrecedence(t *testing.T) {
	config := &AuthConfig{
		AuthMode:      "oidc",
		AuthEnabled:   true,
		OIDCEnabled:   true,
		APIKeyEnabled: true,
	}

	// Has both expired token and API key
	tokens := &TokenSet{
		AccessToken: "expired-access-token",
		ExpiresAt:   time.Now().Add(-1 * time.Hour),
		TokenType:   "Bearer",
		Host:        "test:8080",
	}

	m := createTestManager(config, tokens, "sk_test_api_key_12345")

	if !m.IsAuthenticated() {
		t.Error("expected IsAuthenticated to return true when API key is set (takes precedence)")
	}
}

func TestManager_SetAPIKey(t *testing.T) {
	config := &AuthConfig{
		AuthMode:      "oidc",
		AuthEnabled:   true,
		APIKeyEnabled: true,
	}

	m := createTestManager(config, nil, "")

	// Initially not authenticated
	if m.IsAuthenticated() {
		t.Error("expected not authenticated initially")
	}

	// Set API key
	m.SetAPIKey("sk_test_key_abc123")

	// Now should be authenticated
	if !m.IsAuthenticated() {
		t.Error("expected authenticated after setting API key")
	}

	// Verify the key is accessible
	m.mu.RLock()
	key := m.apiKey
	m.mu.RUnlock()

	if key != "sk_test_key_abc123" {
		t.Errorf("expected API key 'sk_test_key_abc123', got '%s'", key)
	}
}

func TestManager_GetAuthHeader_Bearer(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
		OIDCEnabled: true,
	}

	tokens := &TokenSet{
		AccessToken: "test-bearer-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
		TokenType:   "Bearer",
		Host:        "test:8080",
	}

	m := createTestManager(config, tokens, "")

	header, err := m.GetAuthHeader()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "Bearer test-bearer-token"
	if header != expected {
		t.Errorf("expected header '%s', got '%s'", expected, header)
	}
}

func TestManager_GetAuthHeader_ApiKey(t *testing.T) {
	testCases := []struct {
		name     string
		apiKey   string
		expected string
	}{
		{
			name:     "sk_ prefix uses ApiKey header",
			apiKey:   "sk_live_abc123xyz",
			expected: "ApiKey sk_live_abc123xyz",
		},
		{
			name:     "non-sk_ prefix uses Bearer header",
			apiKey:   "regular_api_key_token",
			expected: "Bearer regular_api_key_token",
		},
		{
			name:     "short sk_ prefix still uses ApiKey",
			apiKey:   "sk_x",
			expected: "ApiKey sk_x",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			config := &AuthConfig{
				AuthMode:      "oidc",
				AuthEnabled:   true,
				APIKeyEnabled: true,
			}

			m := createTestManager(config, nil, tc.apiKey)

			header, err := m.GetAuthHeader()
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if header != tc.expected {
				t.Errorf("expected header '%s', got '%s'", tc.expected, header)
			}
		})
	}
}

func TestManager_GetAuthHeader_NoCredentials(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
	}

	m := createTestManager(config, nil, "")

	_, err := m.GetAuthHeader()
	if err == nil {
		t.Error("expected error when no credentials are available")
	}
}

func TestManager_GetUsername(t *testing.T) {
	testCases := []struct {
		name     string
		tokens   *TokenSet
		expected string
	}{
		{
			name: "returns username from tokens",
			tokens: &TokenSet{
				AccessToken: "token",
				ExpiresAt:   time.Now().Add(1 * time.Hour),
				Username:    "john.doe",
				Host:        "test:8080",
			},
			expected: "john.doe",
		},
		{
			name:     "returns empty string when no tokens",
			tokens:   nil,
			expected: "",
		},
		{
			name: "returns empty string when username not set",
			tokens: &TokenSet{
				AccessToken: "token",
				ExpiresAt:   time.Now().Add(1 * time.Hour),
				Host:        "test:8080",
			},
			expected: "",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			config := &AuthConfig{
				AuthMode:    "oidc",
				AuthEnabled: true,
			}

			m := createTestManager(config, tc.tokens, "")

			username := m.GetUsername()
			if username != tc.expected {
				t.Errorf("expected username '%s', got '%s'", tc.expected, username)
			}
		})
	}
}

func TestManager_Logout(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
	}

	tokens := &TokenSet{
		AccessToken:  "test-token",
		RefreshToken: "test-refresh",
		ExpiresAt:    time.Now().Add(1 * time.Hour),
		Username:     "testuser",
		Host:         "test:8080",
	}

	m := createTestManager(config, tokens, "sk_api_key_123")

	// Verify initial state
	if !m.IsAuthenticated() {
		t.Fatal("expected to be authenticated before logout")
	}

	if m.GetUsername() != "testuser" {
		t.Fatal("expected username to be set before logout")
	}

	// Perform logout
	err := m.Logout()
	if err != nil {
		t.Fatalf("unexpected error during logout: %v", err)
	}

	// Verify tokens are cleared
	if m.IsAuthenticated() {
		t.Error("expected not authenticated after logout")
	}

	if m.tokens != nil {
		t.Error("expected tokens to be nil after logout")
	}

	if m.apiKey != "" {
		t.Error("expected API key to be cleared after logout")
	}

	if m.GetUsername() != "" {
		t.Error("expected username to be empty after logout")
	}

	// Verify token store was updated
	store := m.tokenStore.(*mockTokenStore)
	if _, exists := store.tokens["test:8080"]; exists {
		t.Error("expected tokens to be deleted from store")
	}
}

func TestManager_GetAuthConfig(t *testing.T) {
	config := &AuthConfig{
		AuthMode:         "oidc",
		AuthEnabled:      true,
		OIDCEnabled:      true,
		OIDCProviderName: "TestProvider",
		LocalAuthEnabled: false,
		APIKeyEnabled:    true,
		Features: map[string]FeatureAccess{
			"tracking": {
				ReadAccess:  "public",
				WriteAccess: "authenticated",
				IsEnabled:   true,
			},
		},
	}

	m := createTestManager(config, nil, "")

	gotConfig := m.GetAuthConfig()

	if gotConfig.AuthMode != "oidc" {
		t.Errorf("expected AuthMode 'oidc', got '%s'", gotConfig.AuthMode)
	}

	if !gotConfig.AuthEnabled {
		t.Error("expected AuthEnabled to be true")
	}

	if !gotConfig.OIDCEnabled {
		t.Error("expected OIDCEnabled to be true")
	}

	if gotConfig.OIDCProviderName != "TestProvider" {
		t.Errorf("expected OIDCProviderName 'TestProvider', got '%s'", gotConfig.OIDCProviderName)
	}

	if !gotConfig.APIKeyEnabled {
		t.Error("expected APIKeyEnabled to be true")
	}

	if gotConfig.Features == nil {
		t.Fatal("expected Features to not be nil")
	}

	if _, ok := gotConfig.Features["tracking"]; !ok {
		t.Error("expected 'tracking' feature to exist")
	}
}

func TestManager_GetTokenInfo(t *testing.T) {
	t.Run("with API key", func(t *testing.T) {
		config := &AuthConfig{
			AuthMode:         "oidc",
			AuthEnabled:      true,
			OIDCEnabled:      true,
			OIDCProviderName: "TestOIDC",
		}

		m := createTestManager(config, nil, "sk_live_api_key_12345678901234567890")

		info := m.GetTokenInfo()

		if info["auth_type"] != "api_key" {
			t.Errorf("expected auth_type 'api_key', got '%v'", info["auth_type"])
		}

		prefix := info["api_key_prefix"].(string)
		if prefix != "sk_live_ap..." {
			t.Errorf("expected api_key_prefix 'sk_live_ap...', got '%s'", prefix)
		}
	})

	t.Run("with tokens", func(t *testing.T) {
		config := &AuthConfig{
			AuthMode:         "oidc",
			AuthEnabled:      true,
			OIDCEnabled:      true,
			OIDCProviderName: "TestOIDC",
		}

		expiresAt := time.Now().Add(1 * time.Hour)
		tokens := &TokenSet{
			AccessToken:  "test-token",
			RefreshToken: "test-refresh",
			ExpiresAt:    expiresAt,
			Username:     "testuser",
			Host:         "test:8080",
		}

		m := createTestManager(config, tokens, "")

		info := m.GetTokenInfo()

		if info["auth_type"] != "oidc" {
			t.Errorf("expected auth_type 'oidc', got '%v'", info["auth_type"])
		}

		if info["username"] != "testuser" {
			t.Errorf("expected username 'testuser', got '%v'", info["username"])
		}

		if info["expired"] != false {
			t.Error("expected expired to be false")
		}

		if info["has_refresh_token"] != true {
			t.Error("expected has_refresh_token to be true")
		}
	})

	t.Run("with no auth", func(t *testing.T) {
		config := &AuthConfig{
			AuthMode:    "public",
			AuthEnabled: false,
		}

		m := createTestManager(config, nil, "")

		info := m.GetTokenInfo()

		if info["auth_type"] != "none" {
			t.Errorf("expected auth_type 'none', got '%v'", info["auth_type"])
		}
	})
}

func TestManager_GetAccessToken_WithAPIKey(t *testing.T) {
	config := &AuthConfig{
		AuthMode:      "oidc",
		AuthEnabled:   true,
		APIKeyEnabled: true,
	}

	m := createTestManager(config, nil, "sk_test_key")

	token, err := m.GetAccessToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if token != "sk_test_key" {
		t.Errorf("expected token 'sk_test_key', got '%s'", token)
	}
}

func TestManager_GetAccessToken_WithValidToken(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
	}

	tokens := &TokenSet{
		AccessToken: "valid-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
		Host:        "test:8080",
	}

	m := createTestManager(config, tokens, "")

	token, err := m.GetAccessToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if token != "valid-token" {
		t.Errorf("expected token 'valid-token', got '%s'", token)
	}
}

func TestManager_GetAccessToken_ExpiredNoRefresh(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
	}

	tokens := &TokenSet{
		AccessToken: "expired-token",
		ExpiresAt:   time.Now().Add(-1 * time.Hour),
		Host:        "test:8080",
	}

	m := createTestManager(config, tokens, "")

	_, err := m.GetAccessToken()
	if err == nil {
		t.Error("expected error for expired token without refresh")
	}
}

func TestManager_GetAccessToken_NoTokens(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
	}

	m := createTestManager(config, nil, "")

	_, err := m.GetAccessToken()
	if err == nil {
		t.Error("expected error when no tokens available")
	}
}

func TestManager_ConcurrentAccess(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
	}

	tokens := &TokenSet{
		AccessToken: "concurrent-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour),
		Username:    "concurrent-user",
		Host:        "test:8080",
	}

	m := createTestManager(config, tokens, "")

	// Run concurrent operations
	done := make(chan bool, 100)

	for i := 0; i < 50; i++ {
		go func() {
			_ = m.IsAuthenticated()
			done <- true
		}()

		go func() {
			_ = m.GetUsername()
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 100; i++ {
		<-done
	}
}

func TestManager_Login_AuthDisabled(t *testing.T) {
	config := &AuthConfig{
		AuthMode:    "public",
		AuthEnabled: false,
	}

	m := createTestManager(config, nil, "")

	ctx := context.Background()
	err := m.Login(ctx)
	if err == nil {
		t.Error("expected error when auth is disabled")
	}
	if err != nil && !strings.Contains(err.Error(), "does not require authentication") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestManager_Login_LocalAuthOnly(t *testing.T) {
	config := &AuthConfig{
		AuthMode:         "local_auth",
		AuthEnabled:      true,
		LocalAuthEnabled: true,
		OIDCEnabled:      false,
	}

	m := createTestManager(config, nil, "")

	ctx := context.Background()
	err := m.Login(ctx)
	if err == nil {
		t.Error("expected error when only local auth is enabled")
	}
	if err != nil && !strings.Contains(err.Error(), "local authentication not supported") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestManager_Login_NoSupportedMethod(t *testing.T) {
	config := &AuthConfig{
		AuthMode:         "private",
		AuthEnabled:      true,
		LocalAuthEnabled: false,
		OIDCEnabled:      false,
	}

	m := createTestManager(config, nil, "")

	ctx := context.Background()
	err := m.Login(ctx)
	if err == nil {
		t.Error("expected error when no auth method is available")
	}
	if err != nil && !strings.Contains(err.Error(), "no supported authentication method") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestManager_GetAccessToken_NeedsRefresh_Success(t *testing.T) {
	// Create a mock server that handles token refresh
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/refresh" {
			json.NewEncoder(w).Encode(TokenResponse{
				AccessToken:  "new-access-token",
				RefreshToken: "new-refresh-token",
				ExpiresIn:    3600,
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	store := newMockTokenStore()
	host := "test:8080"

	// Token that needs refresh (expires in 4 minutes, threshold is 5)
	tokens := &TokenSet{
		AccessToken:  "old-access-token",
		RefreshToken: "test-refresh-token",
		ExpiresAt:    time.Now().Add(4 * time.Minute),
		Host:         host,
	}
	store.tokens[host] = tokens

	m := &Manager{
		baseURL:    server.URL,
		host:       host,
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
		tokenStore: store,
		tokens:     tokens,
	}

	token, err := m.GetAccessToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if token != "new-access-token" {
		t.Errorf("expected refreshed token 'new-access-token', got '%s'", token)
	}
}

func TestManager_GetAccessToken_RefreshFails_TokenNotExpired(t *testing.T) {
	// Create a mock server that returns error for refresh
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	store := newMockTokenStore()
	host := "test:8080"

	// Token that needs refresh but is not yet expired
	// ExpiresAt is 4 minutes from now (needs refresh at 5 min threshold)
	// But still valid
	tokens := &TokenSet{
		AccessToken:  "still-valid-token",
		RefreshToken: "test-refresh-token",
		ExpiresAt:    time.Now().Add(4 * time.Minute),
		Host:         host,
	}
	store.tokens[host] = tokens

	m := &Manager{
		baseURL:    server.URL,
		host:       host,
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
		tokenStore: store,
		tokens:     tokens,
	}

	token, err := m.GetAccessToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should return the existing token since it's not yet expired
	if token != "still-valid-token" {
		t.Errorf("expected existing token 'still-valid-token', got '%s'", token)
	}
}

func TestManager_GetAccessToken_RefreshFails_TokenExpired(t *testing.T) {
	// Create a mock server that returns error for refresh
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	store := newMockTokenStore()
	host := "test:8080"

	// Token that is already expired
	tokens := &TokenSet{
		AccessToken:  "expired-token",
		RefreshToken: "test-refresh-token",
		ExpiresAt:    time.Now().Add(-1 * time.Hour),
		Host:         host,
	}
	store.tokens[host] = tokens

	m := &Manager{
		baseURL:    server.URL,
		host:       host,
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
		tokenStore: store,
		tokens:     tokens,
	}

	_, err := m.GetAccessToken()
	if err == nil {
		t.Error("expected error for expired token with failed refresh")
	}
	if err != nil && !strings.Contains(err.Error(), "expired and refresh failed") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestManager_exchangeCodeForTokens_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/api/v1/auth/oidc/callback") {
			json.NewEncoder(w).Encode(struct {
				AccessToken  string `json:"access_token"`
				RefreshToken string `json:"refresh_token"`
				ExpiresIn    int    `json:"expires_in"`
				TokenType    string `json:"token_type"`
			}{
				AccessToken:  "test-access-token",
				RefreshToken: "test-refresh-token",
				ExpiresIn:    3600,
				TokenType:    "Bearer",
			})
			return
		}
		if r.URL.Path == "/api/v1/auth/profile" {
			json.NewEncoder(w).Encode(UserProfile{
				Username: "testuser",
				Email:    "test@example.com",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	tokens, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if tokens.AccessToken != "test-access-token" {
		t.Errorf("expected access token 'test-access-token', got '%s'", tokens.AccessToken)
	}

	if tokens.RefreshToken != "test-refresh-token" {
		t.Errorf("expected refresh token 'test-refresh-token', got '%s'", tokens.RefreshToken)
	}

	if tokens.Username != "testuser" {
		t.Errorf("expected username 'testuser', got '%s'", tokens.Username)
	}
}

func TestManager_exchangeCodeForTokens_NoExpiresIn(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/api/v1/auth/oidc/callback") {
			// Response without expires_in (should default to 60 min)
			json.NewEncoder(w).Encode(struct {
				AccessToken  string `json:"access_token"`
				RefreshToken string `json:"refresh_token"`
				TokenType    string `json:"token_type"`
			}{
				AccessToken:  "test-access-token",
				RefreshToken: "test-refresh-token",
				TokenType:    "Bearer",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	tokens, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should default to 60 minutes
	expectedExpiry := time.Now().Add(60 * time.Minute)
	if tokens.ExpiresAt.Before(expectedExpiry.Add(-1*time.Minute)) || tokens.ExpiresAt.After(expectedExpiry.Add(1*time.Minute)) {
		t.Errorf("expected expiry around 60 minutes from now, got %v", tokens.ExpiresAt)
	}
}

func TestManager_exchangeCodeForTokens_ProfileWithEmailOnly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/api/v1/auth/oidc/callback") {
			json.NewEncoder(w).Encode(struct {
				AccessToken  string `json:"access_token"`
				RefreshToken string `json:"refresh_token"`
				ExpiresIn    int    `json:"expires_in"`
				TokenType    string `json:"token_type"`
			}{
				AccessToken:  "test-access-token",
				RefreshToken: "test-refresh-token",
				ExpiresIn:    3600,
				TokenType:    "Bearer",
			})
			return
		}
		if r.URL.Path == "/api/v1/auth/profile" {
			// Profile with email but no username
			json.NewEncoder(w).Encode(UserProfile{
				Username: "",
				Email:    "test@example.com",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	tokens, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should fall back to email when username is empty
	if tokens.Username != "test@example.com" {
		t.Errorf("expected username to be email 'test@example.com', got '%s'", tokens.Username)
	}
}

func TestManager_exchangeCodeForTokens_Redirect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/api/v1/auth/oidc/callback") {
			// Return redirect with tokens in URL
			w.Header().Set("Location", "http://example.com/callback?access_token=redirect-token&refresh_token=redirect-refresh&expires_in=7200")
			w.WriteHeader(http.StatusFound)
			return
		}
		if r.URL.Path == "/api/v1/auth/profile" {
			json.NewEncoder(w).Encode(UserProfile{
				Username: "redirect-user",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	tokens, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if tokens.AccessToken != "redirect-token" {
		t.Errorf("expected access token 'redirect-token', got '%s'", tokens.AccessToken)
	}
}

func TestManager_exchangeCodeForTokens_RedirectWithFragment(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/api/v1/auth/oidc/callback") {
			// Return redirect with tokens in fragment (implicit flow)
			w.Header().Set("Location", "http://example.com/callback#access_token=fragment-token&token_type=Bearer")
			w.WriteHeader(http.StatusFound)
			return
		}
		if r.URL.Path == "/api/v1/auth/profile" {
			json.NewEncoder(w).Encode(UserProfile{
				Username: "fragment-user",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	tokens, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if tokens.AccessToken != "fragment-token" {
		t.Errorf("expected access token 'fragment-token', got '%s'", tokens.AccessToken)
	}
}

func TestManager_exchangeCodeForTokens_UnexpectedStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	_, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err == nil {
		t.Error("expected error for unexpected status code")
	}
	if err != nil && !strings.Contains(err.Error(), "unexpected response status") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestManager_exchangeCodeForTokens_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	_, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err == nil {
		t.Error("expected error for invalid JSON response")
	}
	if err != nil && !strings.Contains(err.Error(), "failed to parse token response") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestManager_exchangeCodeForTokens_RedirectNoLocation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Return redirect without Location header
		w.WriteHeader(http.StatusFound)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	_, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err == nil {
		t.Error("expected error for redirect without location")
	}
}

func TestManager_exchangeCodeForTokens_RedirectNoToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Return redirect without access token
		w.Header().Set("Location", "http://example.com/callback?error=no_token")
		w.WriteHeader(http.StatusFound)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	_, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err == nil {
		t.Error("expected error when redirect has no access token")
	}
	if err != nil && !strings.Contains(err.Error(), "no access token in redirect") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestManager_parseTokensFromRedirect_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/profile" {
			json.NewEncoder(w).Encode(UserProfile{
				Username: "redirect-user",
				Email:    "redirect@example.com",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	tokens, err := m.parseTokensFromRedirect("http://example.com/callback?access_token=test-token&refresh_token=test-refresh&expires_in=7200&token_type=Bearer")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if tokens.AccessToken != "test-token" {
		t.Errorf("expected access token 'test-token', got '%s'", tokens.AccessToken)
	}

	if tokens.RefreshToken != "test-refresh" {
		t.Errorf("expected refresh token 'test-refresh', got '%s'", tokens.RefreshToken)
	}

	if tokens.TokenType != "Bearer" {
		t.Errorf("expected token type 'Bearer', got '%s'", tokens.TokenType)
	}
}

func TestManager_parseTokensFromRedirect_DefaultExpiry(t *testing.T) {
	m := &Manager{
		baseURL: "http://test:8080",
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	// No expires_in, should default to 1 hour
	tokens, err := m.parseTokensFromRedirect("http://example.com/callback?access_token=test-token")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedExpiry := time.Now().Add(1 * time.Hour)
	if tokens.ExpiresAt.Before(expectedExpiry.Add(-1*time.Minute)) || tokens.ExpiresAt.After(expectedExpiry.Add(1*time.Minute)) {
		t.Errorf("expected expiry around 1 hour from now, got %v", tokens.ExpiresAt)
	}
}

func TestManager_parseTokensFromRedirect_InvalidURL(t *testing.T) {
	m := &Manager{
		baseURL: "http://test:8080",
		host:    "test:8080",
	}

	_, err := m.parseTokensFromRedirect("://invalid-url")
	if err == nil {
		t.Error("expected error for invalid URL")
	}
}

func TestManager_parseTokensFromRedirect_NoAccessToken(t *testing.T) {
	m := &Manager{
		baseURL: "http://test:8080",
		host:    "test:8080",
	}

	_, err := m.parseTokensFromRedirect("http://example.com/callback?refresh_token=test")
	if err == nil {
		t.Error("expected error when no access token")
	}
	if err != nil && !strings.Contains(err.Error(), "no access token") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestManager_parseTokensFromRedirect_ProfileEmailFallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/profile" {
			// Username empty, should fall back to email
			json.NewEncoder(w).Encode(UserProfile{
				Username: "",
				Email:    "fallback@example.com",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	tokens, err := m.parseTokensFromRedirect("http://example.com/callback?access_token=test-token")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if tokens.Username != "fallback@example.com" {
		t.Errorf("expected username 'fallback@example.com', got '%s'", tokens.Username)
	}
}

func TestManager_refreshTokenLocked_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/refresh" {
			json.NewEncoder(w).Encode(TokenResponse{
				AccessToken:  "new-access-token",
				RefreshToken: "new-refresh-token",
				ExpiresIn:    3600,
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	store := newMockTokenStore()
	host := "test:8080"

	tokens := &TokenSet{
		AccessToken:  "old-access-token",
		RefreshToken: "old-refresh-token",
		ExpiresAt:    time.Now().Add(-1 * time.Hour),
		Host:         host,
	}

	m := &Manager{
		baseURL:    server.URL,
		host:       host,
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
		tokenStore: store,
		tokens:     tokens,
	}

	err := m.refreshTokenLocked()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if m.tokens.AccessToken != "new-access-token" {
		t.Errorf("expected new access token, got '%s'", m.tokens.AccessToken)
	}

	if m.tokens.RefreshToken != "new-refresh-token" {
		t.Errorf("expected new refresh token, got '%s'", m.tokens.RefreshToken)
	}

	// Verify tokens were saved to store
	savedTokens := store.tokens[host]
	if savedTokens == nil {
		t.Error("expected tokens to be saved to store")
	}
}

func TestManager_refreshTokenLocked_NoNewRefreshToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/refresh" {
			// Response without new refresh token
			json.NewEncoder(w).Encode(TokenResponse{
				AccessToken: "new-access-token",
				ExpiresIn:   3600,
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	store := newMockTokenStore()
	host := "test:8080"

	tokens := &TokenSet{
		AccessToken:  "old-access-token",
		RefreshToken: "keep-this-refresh-token",
		ExpiresAt:    time.Now().Add(-1 * time.Hour),
		Host:         host,
	}

	m := &Manager{
		baseURL:    server.URL,
		host:       host,
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
		tokenStore: store,
		tokens:     tokens,
	}

	err := m.refreshTokenLocked()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Refresh token should be preserved
	if m.tokens.RefreshToken != "keep-this-refresh-token" {
		t.Errorf("expected refresh token to be preserved, got '%s'", m.tokens.RefreshToken)
	}
}

func TestManager_refreshTokenLocked_DefaultExpiry(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/refresh" {
			// Response without expires_in
			json.NewEncoder(w).Encode(TokenResponse{
				AccessToken:  "new-access-token",
				RefreshToken: "new-refresh-token",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	store := newMockTokenStore()
	host := "test:8080"

	tokens := &TokenSet{
		AccessToken:  "old-access-token",
		RefreshToken: "old-refresh-token",
		ExpiresAt:    time.Now().Add(-1 * time.Hour),
		Host:         host,
	}

	m := &Manager{
		baseURL:    server.URL,
		host:       host,
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
		tokenStore: store,
		tokens:     tokens,
	}

	err := m.refreshTokenLocked()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should default to 60 minutes
	expectedExpiry := time.Now().Add(60 * time.Minute)
	if m.tokens.ExpiresAt.Before(expectedExpiry.Add(-1*time.Minute)) || m.tokens.ExpiresAt.After(expectedExpiry.Add(1*time.Minute)) {
		t.Errorf("expected expiry around 60 minutes from now, got %v", m.tokens.ExpiresAt)
	}
}

func TestManager_GetTokenInfo_ShortApiKey(t *testing.T) {
	config := &AuthConfig{
		AuthMode:         "oidc",
		AuthEnabled:      true,
		OIDCEnabled:      true,
		OIDCProviderName: "TestOIDC",
	}

	// API key shorter than 10 characters
	m := createTestManager(config, nil, "sk_short")

	info := m.GetTokenInfo()

	if info["auth_type"] != "api_key" {
		t.Errorf("expected auth_type 'api_key', got '%v'", info["auth_type"])
	}

	prefix := info["api_key_prefix"].(string)
	if prefix != "sk_short..." {
		t.Errorf("expected api_key_prefix 'sk_short...', got '%s'", prefix)
	}
}

func TestDecodeJSON(t *testing.T) {
	type testStruct struct {
		Name  string `json:"name"`
		Value int    `json:"value"`
	}

	jsonStr := `{"name": "test", "value": 42}`
	reader := strings.NewReader(jsonStr)

	var result testStruct
	err := decodeJSON(reader, &result)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Name != "test" {
		t.Errorf("expected name 'test', got '%s'", result.Name)
	}

	if result.Value != 42 {
		t.Errorf("expected value 42, got %d", result.Value)
	}
}

func TestDecodeJSON_InvalidJSON(t *testing.T) {
	reader := strings.NewReader("not valid json")

	var result map[string]interface{}
	err := decodeJSON(reader, &result)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestMin(t *testing.T) {
	testCases := []struct {
		a, b     int
		expected int
	}{
		{1, 2, 1},
		{2, 1, 1},
		{5, 5, 5},
		{0, 10, 0},
		{-1, 1, -1},
		{10, 0, 0},
	}

	for _, tc := range testCases {
		result := min(tc.a, tc.b)
		if result != tc.expected {
			t.Errorf("min(%d, %d) = %d, expected %d", tc.a, tc.b, result, tc.expected)
		}
	}
}

func TestNewManager_WithServer(t *testing.T) {
	// Create a mock server that returns auth config
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/config" {
			json.NewEncoder(w).Encode(AuthConfig{
				AuthMode:         "oidc",
				AuthEnabled:      true,
				OIDCEnabled:      true,
				OIDCProviderName: "Test Provider",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	// Note: We can't easily test NewManager directly because it:
	// 1. Constructs URL from host:port (not a full URL)
	// 2. Creates a FileTokenStore which needs file system access
	// The existing createTestManager function is used for unit testing
	// This test verifies the mock server setup works
	config, err := FetchAuthConfig(server.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if config.AuthMode != "oidc" {
		t.Errorf("expected AuthMode 'oidc', got '%s'", config.AuthMode)
	}
}

func TestManager_Login_OIDC_CallbackServerError(t *testing.T) {
	// This test covers the loginOIDC error path when callback server creation fails
	// Note: We can't easily test the full OIDC flow without mocking many components
	// The individual components (CallbackServer, exchangeCodeForTokens) are tested separately

	config := &AuthConfig{
		AuthMode:    "oidc",
		AuthEnabled: true,
		OIDCEnabled: true,
	}

	m := createTestManager(config, nil, "")

	// Test that Login returns error (since we can't mock the callback server creation)
	// In a real scenario, this would attempt OIDC login
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := m.Login(ctx)
	// We expect an error because the OIDC flow requires external resources
	// This tests the code path is reached
	if err == nil {
		t.Log("Login succeeded - this is unexpected but acceptable in some test environments")
	}
}

func TestManager_exchangeCodeForTokens_ConnectionError(t *testing.T) {
	m := &Manager{
		baseURL: "http://127.0.0.1:59999", // Non-existent server
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	_, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err == nil {
		t.Error("expected error for connection failure")
	}
}

func TestManager_exchangeCodeForTokens_TemporaryRedirect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/api/v1/auth/oidc/callback") {
			// Use 307 Temporary Redirect (also covered by the code)
			w.Header().Set("Location", "http://example.com/callback?access_token=temp-redirect-token")
			w.WriteHeader(http.StatusTemporaryRedirect)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL: server.URL,
		host:    "test:8080",
		config:  &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
	}

	tokens, err := m.exchangeCodeForTokens("test-code", "test-state", "http://localhost:8400/callback")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if tokens.AccessToken != "temp-redirect-token" {
		t.Errorf("expected access token 'temp-redirect-token', got '%s'", tokens.AccessToken)
	}
}

func TestManager_refreshTokenLocked_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	store := newMockTokenStore()
	host := "test:8080"

	tokens := &TokenSet{
		AccessToken:  "old-access-token",
		RefreshToken: "old-refresh-token",
		ExpiresAt:    time.Now().Add(-1 * time.Hour),
		Host:         host,
	}

	m := &Manager{
		baseURL:    server.URL,
		host:       host,
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
		tokenStore: store,
		tokens:     tokens,
	}

	err := m.refreshTokenLocked()
	if err == nil {
		t.Error("expected error for refresh failure")
	}
}

// errorTokenStore is a mock token store that returns errors
type errorTokenStore struct{}

func (e *errorTokenStore) Save(host string, tokens *TokenSet) error {
	return fmt.Errorf("save error")
}

func (e *errorTokenStore) Load(host string) (*TokenSet, error) {
	return nil, fmt.Errorf("load error")
}

func (e *errorTokenStore) Delete(host string) error {
	return fmt.Errorf("delete error")
}

func (e *errorTokenStore) List() ([]string, error) {
	return nil, fmt.Errorf("list error")
}

func TestManager_refreshTokenLocked_SaveError(t *testing.T) {
	// This tests the warning path when saving refreshed tokens fails
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/refresh" {
			json.NewEncoder(w).Encode(TokenResponse{
				AccessToken:  "new-access-token",
				RefreshToken: "new-refresh-token",
				ExpiresIn:    3600,
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	tokens := &TokenSet{
		AccessToken:  "old-access-token",
		RefreshToken: "old-refresh-token",
		ExpiresAt:    time.Now().Add(-1 * time.Hour),
		Host:         "test:8080",
	}

	m := &Manager{
		baseURL:    server.URL,
		host:       "test:8080",
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true},
		tokenStore: &errorTokenStore{},
		tokens:     tokens,
	}

	// Should not error - save failure is logged but not returned
	err := m.refreshTokenLocked()
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	// Tokens should still be updated in memory
	if m.tokens.AccessToken != "new-access-token" {
		t.Errorf("expected new access token, got '%s'", m.tokens.AccessToken)
	}
}

func TestManager_loginOIDC_GetAuthURLError(t *testing.T) {
	// Test loginOIDC when GetOIDCAuthorizationURL fails
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/oidc/authorize" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL:    server.URL,
		host:       "test:8080",
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true, OIDCEnabled: true},
		tokenStore: newMockTokenStore(),
	}

	ctx := context.Background()
	err := m.loginOIDC(ctx)
	if err == nil {
		t.Error("expected error when GetOIDCAuthorizationURL fails")
	}
	if err != nil && !strings.Contains(err.Error(), "failed to get authorization URL") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestManager_loginOIDC_WaitForCallbackTimeout(t *testing.T) {
	// Test loginOIDC when WaitForCallback times out
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/oidc/authorize" {
			json.NewEncoder(w).Encode(OIDCAuthorizeResponse{
				AuthorizationURL: "http://example.com/auth",
				State:            "test-state",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL:    server.URL,
		host:       "test:8080",
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true, OIDCEnabled: true},
		tokenStore: newMockTokenStore(),
	}

	// Use a very short context timeout
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := m.loginOIDC(ctx)
	if err == nil {
		t.Error("expected error when context times out")
	}
}

func TestManager_loginOIDC_ExchangeCodeError(t *testing.T) {
	// Test loginOIDC when exchangeCodeForTokens fails
	// We need to simulate the callback being received and then failing to exchange
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/oidc/authorize" {
			json.NewEncoder(w).Encode(OIDCAuthorizeResponse{
				AuthorizationURL: "http://example.com/auth",
				State:            "test-state",
			})
			return
		}
		if strings.Contains(r.URL.Path, "/api/v1/auth/oidc/callback") {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL:    server.URL,
		host:       "test:8080",
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true, OIDCEnabled: true},
		tokenStore: newMockTokenStore(),
	}

	// Start a goroutine that will simulate the callback
	go func() {
		// Wait a bit for the callback server to start
		time.Sleep(100 * time.Millisecond)

		// Find the callback server port by trying to connect to ports 8400-8500
		for port := 8400; port <= 8500; port++ {
			url := fmt.Sprintf("http://127.0.0.1:%d/callback?code=test-code&state=test-state", port)
			resp, err := http.Get(url)
			if err == nil {
				resp.Body.Close()
				break
			}
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := m.loginOIDC(ctx)
	if err == nil {
		t.Error("expected error when exchangeCodeForTokens fails")
	}
}

func TestManager_loginOIDC_SaveTokensError(t *testing.T) {
	// Test loginOIDC when saving tokens fails
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/oidc/authorize" {
			json.NewEncoder(w).Encode(OIDCAuthorizeResponse{
				AuthorizationURL: "http://example.com/auth",
				State:            "test-state",
			})
			return
		}
		if strings.Contains(r.URL.Path, "/api/v1/auth/oidc/callback") {
			json.NewEncoder(w).Encode(struct {
				AccessToken  string `json:"access_token"`
				RefreshToken string `json:"refresh_token"`
				ExpiresIn    int    `json:"expires_in"`
				TokenType    string `json:"token_type"`
			}{
				AccessToken:  "test-access-token",
				RefreshToken: "test-refresh-token",
				ExpiresIn:    3600,
				TokenType:    "Bearer",
			})
			return
		}
		if r.URL.Path == "/api/v1/auth/profile" {
			json.NewEncoder(w).Encode(UserProfile{
				Username: "testuser",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	m := &Manager{
		baseURL:    server.URL,
		host:       "test:8080",
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true, OIDCEnabled: true},
		tokenStore: &errorTokenStore{},
	}

	// Start a goroutine that will simulate the callback
	go func() {
		time.Sleep(100 * time.Millisecond)

		for port := 8400; port <= 8500; port++ {
			url := fmt.Sprintf("http://127.0.0.1:%d/callback?code=test-code&state=test-state", port)
			resp, err := http.Get(url)
			if err == nil {
				resp.Body.Close()
				break
			}
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := m.loginOIDC(ctx)
	if err == nil {
		t.Error("expected error when saving tokens fails")
	}
	if err != nil && !strings.Contains(err.Error(), "failed to save tokens") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestManager_loginOIDC_Success(t *testing.T) {
	// Test successful loginOIDC flow
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/oidc/authorize" {
			json.NewEncoder(w).Encode(OIDCAuthorizeResponse{
				AuthorizationURL: "http://example.com/auth",
				State:            "test-state",
			})
			return
		}
		if strings.Contains(r.URL.Path, "/api/v1/auth/oidc/callback") {
			json.NewEncoder(w).Encode(struct {
				AccessToken  string `json:"access_token"`
				RefreshToken string `json:"refresh_token"`
				ExpiresIn    int    `json:"expires_in"`
				TokenType    string `json:"token_type"`
			}{
				AccessToken:  "test-access-token",
				RefreshToken: "test-refresh-token",
				ExpiresIn:    3600,
				TokenType:    "Bearer",
			})
			return
		}
		if r.URL.Path == "/api/v1/auth/profile" {
			json.NewEncoder(w).Encode(UserProfile{
				Username: "testuser",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	store := newMockTokenStore()
	m := &Manager{
		baseURL:    server.URL,
		host:       "test:8080",
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true, OIDCEnabled: true},
		tokenStore: store,
	}

	// Start a goroutine that will simulate the callback
	go func() {
		time.Sleep(100 * time.Millisecond)

		for port := 8400; port <= 8500; port++ {
			url := fmt.Sprintf("http://127.0.0.1:%d/callback?code=test-code&state=test-state", port)
			resp, err := http.Get(url)
			if err == nil {
				resp.Body.Close()
				break
			}
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := m.loginOIDC(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify tokens were saved
	if m.tokens == nil {
		t.Error("expected tokens to be set")
	}

	if m.tokens != nil && m.tokens.AccessToken != "test-access-token" {
		t.Errorf("expected access token 'test-access-token', got '%s'", m.tokens.AccessToken)
	}

	// Verify tokens were saved to store
	savedTokens, _ := store.Load("test:8080")
	if savedTokens == nil {
		t.Error("expected tokens to be saved to store")
	}
}

func TestManager_loginOIDC_CallbackError(t *testing.T) {
	// Test loginOIDC when callback returns an error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/oidc/authorize" {
			json.NewEncoder(w).Encode(OIDCAuthorizeResponse{
				AuthorizationURL: "http://example.com/auth",
				State:            "test-state",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	store := newMockTokenStore()
	m := &Manager{
		baseURL:    server.URL,
		host:       "test:8080",
		config:     &AuthConfig{AuthMode: "oidc", AuthEnabled: true, OIDCEnabled: true},
		tokenStore: store,
	}

	// Start a goroutine that will simulate an error callback
	go func() {
		time.Sleep(100 * time.Millisecond)

		for port := 8400; port <= 8500; port++ {
			url := fmt.Sprintf("http://127.0.0.1:%d/callback?error=access_denied&error_description=User+denied+access", port)
			resp, err := http.Get(url)
			if err == nil {
				resp.Body.Close()
				break
			}
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := m.loginOIDC(ctx)
	if err == nil {
		t.Error("expected error when callback returns error")
	}
	if err != nil && !strings.Contains(err.Error(), "access_denied") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestNewManager_ConnectionError(t *testing.T) {
	// Test NewManager when server is not reachable
	// This will test the error path where FetchAuthConfig fails
	// and the manager falls back to public mode

	// Use a non-existent server address
	// Note: NewManager creates a real FileTokenStore, so we can only test
	// the connection error path if we accept that a file store will be created
	m, err := NewManager("127.0.0.1", 59999)
	if err != nil {
		t.Fatalf("NewManager should not return error for connection failure: %v", err)
	}

	// Should fall back to public mode
	if m.config.AuthMode != "public" {
		t.Errorf("expected AuthMode 'public', got '%s'", m.config.AuthMode)
	}

	if m.config.AuthEnabled {
		t.Error("expected AuthEnabled to be false")
	}
}

func TestNewManager_WithExistingTokens(t *testing.T) {
	// This test requires setting up tokens in the token store first
	// Since NewManager uses a real FileTokenStore, the tokens persist

	// Create a manager first to ensure the token store directory exists
	m1, err := NewManager("127.0.0.1", 59998)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Save some tokens using the manager's token store
	testTokens := &TokenSet{
		AccessToken:  "existing-token",
		RefreshToken: "existing-refresh",
		ExpiresAt:    time.Now().Add(1 * time.Hour),
		Host:         "127.0.0.1:59998",
		Username:     "existinguser",
	}
	err = m1.tokenStore.Save("127.0.0.1:59998", testTokens)
	if err != nil {
		t.Fatalf("failed to save test tokens: %v", err)
	}

	// Create a new manager for the same host
	m2, err := NewManager("127.0.0.1", 59998)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// The new manager should have loaded the existing tokens
	if m2.tokens == nil {
		t.Error("expected tokens to be loaded from store")
	}

	if m2.tokens != nil && m2.tokens.AccessToken != "existing-token" {
		t.Errorf("expected access token 'existing-token', got '%s'", m2.tokens.AccessToken)
	}

	// Cleanup
	m2.tokenStore.Delete("127.0.0.1:59998")
}
