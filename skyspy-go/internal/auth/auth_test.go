package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
