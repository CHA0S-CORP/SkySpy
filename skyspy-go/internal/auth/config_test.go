package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchAuthConfig_Success(t *testing.T) {
	expectedConfig := AuthConfig{
		AuthMode:         "oidc",
		AuthEnabled:      true,
		OIDCEnabled:      true,
		OIDCProviderName: "Authentik",
		LocalAuthEnabled: false,
		APIKeyEnabled:    true,
		Features: map[string]FeatureAccess{
			"tracking": {
				ReadAccess:  "public",
				WriteAccess: "authenticated",
				IsEnabled:   true,
			},
			"alerts": {
				ReadAccess:  "authenticated",
				WriteAccess: "authenticated",
				IsEnabled:   true,
			},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/config" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}

		if r.Method != http.MethodGet {
			t.Errorf("expected GET request, got %s", r.Method)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedConfig)
	}))
	defer server.Close()

	config, err := FetchAuthConfig(server.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if config.AuthMode != expectedConfig.AuthMode {
		t.Errorf("expected AuthMode '%s', got '%s'", expectedConfig.AuthMode, config.AuthMode)
	}

	if config.AuthEnabled != expectedConfig.AuthEnabled {
		t.Errorf("expected AuthEnabled %v, got %v", expectedConfig.AuthEnabled, config.AuthEnabled)
	}

	if config.OIDCEnabled != expectedConfig.OIDCEnabled {
		t.Errorf("expected OIDCEnabled %v, got %v", expectedConfig.OIDCEnabled, config.OIDCEnabled)
	}

	if config.OIDCProviderName != expectedConfig.OIDCProviderName {
		t.Errorf("expected OIDCProviderName '%s', got '%s'", expectedConfig.OIDCProviderName, config.OIDCProviderName)
	}

	if config.LocalAuthEnabled != expectedConfig.LocalAuthEnabled {
		t.Errorf("expected LocalAuthEnabled %v, got %v", expectedConfig.LocalAuthEnabled, config.LocalAuthEnabled)
	}

	if config.APIKeyEnabled != expectedConfig.APIKeyEnabled {
		t.Errorf("expected APIKeyEnabled %v, got %v", expectedConfig.APIKeyEnabled, config.APIKeyEnabled)
	}
}

func TestFetchAuthConfig_ServerError(t *testing.T) {
	testCases := []struct {
		name       string
		statusCode int
	}{
		{"Internal Server Error", http.StatusInternalServerError},
		{"Service Unavailable", http.StatusServiceUnavailable},
		{"Bad Gateway", http.StatusBadGateway},
		{"Not Found", http.StatusNotFound},
		{"Unauthorized", http.StatusUnauthorized},
		{"Forbidden", http.StatusForbidden},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.statusCode)
			}))
			defer server.Close()

			_, err := FetchAuthConfig(server.URL)
			if err == nil {
				t.Errorf("expected error for status %d, got nil", tc.statusCode)
			}
		})
	}
}

func TestFetchAuthConfig_InvalidJSON(t *testing.T) {
	testCases := []struct {
		name     string
		response string
	}{
		{"empty response", ""},
		{"invalid JSON", "{invalid json}"},
		{"truncated JSON", `{"auth_mode": "oidc", "auth_enabled":`},
		{"non-object", `["array", "instead"]`},
		{"HTML response", `<!DOCTYPE html><html><body>Error</body></html>`},
		{"plain text", "Not JSON at all"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(tc.response))
			}))
			defer server.Close()

			_, err := FetchAuthConfig(server.URL)
			if err == nil {
				t.Errorf("expected error for response '%s', got nil", tc.name)
			}
		})
	}
}

func TestFetchAuthConfig_ConnectionError(t *testing.T) {
	// Try to connect to a server that doesn't exist
	_, err := FetchAuthConfig("http://127.0.0.1:59999")
	if err == nil {
		t.Error("expected error for connection failure, got nil")
	}
}

func TestAuthConfig_Fields(t *testing.T) {
	testCases := []struct {
		name   string
		config AuthConfig
	}{
		{
			name: "public mode",
			config: AuthConfig{
				AuthMode:         "public",
				AuthEnabled:      false,
				OIDCEnabled:      false,
				OIDCProviderName: "",
				LocalAuthEnabled: false,
				APIKeyEnabled:    false,
			},
		},
		{
			name: "OIDC mode",
			config: AuthConfig{
				AuthMode:         "oidc",
				AuthEnabled:      true,
				OIDCEnabled:      true,
				OIDCProviderName: "Google",
				LocalAuthEnabled: false,
				APIKeyEnabled:    true,
			},
		},
		{
			name: "local auth mode",
			config: AuthConfig{
				AuthMode:         "local_auth",
				AuthEnabled:      true,
				OIDCEnabled:      false,
				OIDCProviderName: "",
				LocalAuthEnabled: true,
				APIKeyEnabled:    true,
			},
		},
		{
			name: "mixed mode with features",
			config: AuthConfig{
				AuthMode:         "oidc",
				AuthEnabled:      true,
				OIDCEnabled:      true,
				OIDCProviderName: "Authentik",
				LocalAuthEnabled: true,
				APIKeyEnabled:    true,
				Features: map[string]FeatureAccess{
					"tracking": {
						ReadAccess:  "public",
						WriteAccess: "authenticated",
						IsEnabled:   true,
					},
					"alerts": {
						ReadAccess:  "authenticated",
						WriteAccess: "authenticated",
						IsEnabled:   true,
					},
					"admin": {
						ReadAccess:  "admin",
						WriteAccess: "admin",
						IsEnabled:   false,
					},
				},
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(tc.config)
			}))
			defer server.Close()

			config, err := FetchAuthConfig(server.URL)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// Verify all fields
			if config.AuthMode != tc.config.AuthMode {
				t.Errorf("AuthMode: expected '%s', got '%s'", tc.config.AuthMode, config.AuthMode)
			}

			if config.AuthEnabled != tc.config.AuthEnabled {
				t.Errorf("AuthEnabled: expected %v, got %v", tc.config.AuthEnabled, config.AuthEnabled)
			}

			if config.OIDCEnabled != tc.config.OIDCEnabled {
				t.Errorf("OIDCEnabled: expected %v, got %v", tc.config.OIDCEnabled, config.OIDCEnabled)
			}

			if config.OIDCProviderName != tc.config.OIDCProviderName {
				t.Errorf("OIDCProviderName: expected '%s', got '%s'", tc.config.OIDCProviderName, config.OIDCProviderName)
			}

			if config.LocalAuthEnabled != tc.config.LocalAuthEnabled {
				t.Errorf("LocalAuthEnabled: expected %v, got %v", tc.config.LocalAuthEnabled, config.LocalAuthEnabled)
			}

			if config.APIKeyEnabled != tc.config.APIKeyEnabled {
				t.Errorf("APIKeyEnabled: expected %v, got %v", tc.config.APIKeyEnabled, config.APIKeyEnabled)
			}

			// Verify features if present
			if tc.config.Features != nil {
				if config.Features == nil {
					t.Error("expected Features to be non-nil")
				} else {
					if len(config.Features) != len(tc.config.Features) {
						t.Errorf("Features: expected %d features, got %d", len(tc.config.Features), len(config.Features))
					}

					for key, expected := range tc.config.Features {
						got, ok := config.Features[key]
						if !ok {
							t.Errorf("missing feature '%s'", key)
							continue
						}

						if got.ReadAccess != expected.ReadAccess {
							t.Errorf("Feature '%s' ReadAccess: expected '%s', got '%s'", key, expected.ReadAccess, got.ReadAccess)
						}

						if got.WriteAccess != expected.WriteAccess {
							t.Errorf("Feature '%s' WriteAccess: expected '%s', got '%s'", key, expected.WriteAccess, got.WriteAccess)
						}

						if got.IsEnabled != expected.IsEnabled {
							t.Errorf("Feature '%s' IsEnabled: expected %v, got %v", key, expected.IsEnabled, got.IsEnabled)
						}
					}
				}
			}
		})
	}
}

func TestGetOIDCAuthorizationURL_Success(t *testing.T) {
	expectedURL := "https://auth.example.com/authorize?client_id=skyspy&redirect_uri=http://localhost:8400/callback"
	expectedState := "random-state-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/oidc/authorize" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}

		// Check redirect_uri query param
		redirectURI := r.URL.Query().Get("redirect_uri")
		if redirectURI != "http://localhost:8400/callback" {
			t.Errorf("expected redirect_uri 'http://localhost:8400/callback', got '%s'", redirectURI)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(OIDCAuthorizeResponse{
			AuthorizationURL: expectedURL,
			State:            expectedState,
		})
	}))
	defer server.Close()

	resp, err := GetOIDCAuthorizationURL(server.URL, "http://localhost:8400/callback")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp.AuthorizationURL != expectedURL {
		t.Errorf("expected AuthorizationURL '%s', got '%s'", expectedURL, resp.AuthorizationURL)
	}

	if resp.State != expectedState {
		t.Errorf("expected State '%s', got '%s'", expectedState, resp.State)
	}
}

func TestGetOIDCAuthorizationURL_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	_, err := GetOIDCAuthorizationURL(server.URL, "http://localhost:8400/callback")
	if err == nil {
		t.Error("expected error for server error response")
	}
}

func TestRefreshAccessToken_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/refresh" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}

		if r.Method != http.MethodPost {
			t.Errorf("expected POST request, got %s", r.Method)
		}

		// Verify Authorization header
		auth := r.Header.Get("Authorization")
		if auth != "Bearer test-refresh-token" {
			t.Errorf("expected Authorization 'Bearer test-refresh-token', got '%s'", auth)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(TokenResponse{
			AccessToken:  "new-access-token",
			RefreshToken: "new-refresh-token",
			TokenType:    "Bearer",
			ExpiresIn:    3600,
		})
	}))
	defer server.Close()

	resp, err := RefreshAccessToken(server.URL, "test-refresh-token")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if resp.AccessToken != "new-access-token" {
		t.Errorf("expected AccessToken 'new-access-token', got '%s'", resp.AccessToken)
	}

	if resp.RefreshToken != "new-refresh-token" {
		t.Errorf("expected RefreshToken 'new-refresh-token', got '%s'", resp.RefreshToken)
	}

	if resp.ExpiresIn != 3600 {
		t.Errorf("expected ExpiresIn 3600, got %d", resp.ExpiresIn)
	}
}

func TestRefreshAccessToken_Error(t *testing.T) {
	testCases := []struct {
		name       string
		statusCode int
	}{
		{"Unauthorized", http.StatusUnauthorized},
		{"Forbidden", http.StatusForbidden},
		{"Internal Server Error", http.StatusInternalServerError},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.statusCode)
			}))
			defer server.Close()

			_, err := RefreshAccessToken(server.URL, "test-refresh-token")
			if err == nil {
				t.Errorf("expected error for status %d", tc.statusCode)
			}
		})
	}
}

func TestFetchUserProfile_Success(t *testing.T) {
	expectedProfile := UserProfile{
		ID:          123,
		Username:    "johndoe",
		Email:       "john@example.com",
		DisplayName: "John Doe",
		Roles:       []string{"user", "viewer"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/profile" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}

		// Verify Authorization header
		auth := r.Header.Get("Authorization")
		if auth != "Bearer test-access-token" {
			t.Errorf("expected Authorization 'Bearer test-access-token', got '%s'", auth)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedProfile)
	}))
	defer server.Close()

	profile, err := FetchUserProfile(server.URL, "test-access-token")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if profile.ID != expectedProfile.ID {
		t.Errorf("expected ID %d, got %d", expectedProfile.ID, profile.ID)
	}

	if profile.Username != expectedProfile.Username {
		t.Errorf("expected Username '%s', got '%s'", expectedProfile.Username, profile.Username)
	}

	if profile.Email != expectedProfile.Email {
		t.Errorf("expected Email '%s', got '%s'", expectedProfile.Email, profile.Email)
	}

	if profile.DisplayName != expectedProfile.DisplayName {
		t.Errorf("expected DisplayName '%s', got '%s'", expectedProfile.DisplayName, profile.DisplayName)
	}

	if len(profile.Roles) != len(expectedProfile.Roles) {
		t.Errorf("expected %d roles, got %d", len(expectedProfile.Roles), len(profile.Roles))
	}
}

func TestFetchUserProfile_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	_, err := FetchUserProfile(server.URL, "invalid-token")
	if err == nil {
		t.Error("expected error for unauthorized response")
	}
}

func TestTokenResponse_Fields(t *testing.T) {
	jsonData := `{
		"access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test",
		"refresh_token": "refresh_token_value",
		"token_type": "Bearer",
		"expires_in": 7200
	}`

	var resp TokenResponse
	err := json.Unmarshal([]byte(jsonData), &resp)
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if resp.AccessToken != "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test" {
		t.Errorf("unexpected AccessToken: %s", resp.AccessToken)
	}

	if resp.RefreshToken != "refresh_token_value" {
		t.Errorf("unexpected RefreshToken: %s", resp.RefreshToken)
	}

	if resp.TokenType != "Bearer" {
		t.Errorf("unexpected TokenType: %s", resp.TokenType)
	}

	if resp.ExpiresIn != 7200 {
		t.Errorf("unexpected ExpiresIn: %d", resp.ExpiresIn)
	}
}

func TestUserProfile_Fields(t *testing.T) {
	jsonData := `{
		"id": 42,
		"username": "testuser",
		"email": "test@example.com",
		"display_name": "Test User",
		"roles": ["admin", "user", "viewer"]
	}`

	var profile UserProfile
	err := json.Unmarshal([]byte(jsonData), &profile)
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if profile.ID != 42 {
		t.Errorf("unexpected ID: %d", profile.ID)
	}

	if profile.Username != "testuser" {
		t.Errorf("unexpected Username: %s", profile.Username)
	}

	if profile.Email != "test@example.com" {
		t.Errorf("unexpected Email: %s", profile.Email)
	}

	if profile.DisplayName != "Test User" {
		t.Errorf("unexpected DisplayName: %s", profile.DisplayName)
	}

	expectedRoles := []string{"admin", "user", "viewer"}
	if len(profile.Roles) != len(expectedRoles) {
		t.Errorf("expected %d roles, got %d", len(expectedRoles), len(profile.Roles))
	}

	for i, role := range expectedRoles {
		if profile.Roles[i] != role {
			t.Errorf("expected role[%d] '%s', got '%s'", i, role, profile.Roles[i])
		}
	}
}

func TestFeatureAccess_Fields(t *testing.T) {
	jsonData := `{
		"read_access": "public",
		"write_access": "authenticated",
		"is_enabled": true
	}`

	var fa FeatureAccess
	err := json.Unmarshal([]byte(jsonData), &fa)
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if fa.ReadAccess != "public" {
		t.Errorf("unexpected ReadAccess: %s", fa.ReadAccess)
	}

	if fa.WriteAccess != "authenticated" {
		t.Errorf("unexpected WriteAccess: %s", fa.WriteAccess)
	}

	if !fa.IsEnabled {
		t.Error("expected IsEnabled to be true")
	}
}
