// Package auth provides authentication functionality for SkySpy CLI
package auth

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// AuthConfig represents the authentication configuration from the API
type AuthConfig struct {
	AuthMode         string                    `json:"auth_mode"`
	AuthEnabled      bool                      `json:"auth_enabled"`
	OIDCEnabled      bool                      `json:"oidc_enabled"`
	OIDCProviderName string                    `json:"oidc_provider_name"`
	LocalAuthEnabled bool                      `json:"local_auth_enabled"`
	APIKeyEnabled    bool                      `json:"api_key_enabled"`
	Features         map[string]FeatureAccess  `json:"features,omitempty"`
}

// FeatureAccess represents access configuration for a feature
type FeatureAccess struct {
	ReadAccess  string `json:"read_access"`
	WriteAccess string `json:"write_access"`
	IsEnabled   bool   `json:"is_enabled"`
}

// OIDCAuthorizeResponse is the response from the OIDC authorize endpoint
type OIDCAuthorizeResponse struct {
	AuthorizationURL string `json:"authorization_url"`
	State            string `json:"state,omitempty"`
}

// TokenResponse represents tokens received from the API
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
}

// UserProfile represents the authenticated user
type UserProfile struct {
	ID          int      `json:"id"`
	Username    string   `json:"username"`
	Email       string   `json:"email"`
	DisplayName string   `json:"display_name"`
	Roles       []string `json:"roles"`
}

// FetchAuthConfig retrieves authentication configuration from the API
func FetchAuthConfig(baseURL string) (*AuthConfig, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	resp, err := client.Get(baseURL + "/api/v1/auth/config")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch auth config: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("auth config returned status %d", resp.StatusCode)
	}

	var config AuthConfig
	if err := json.NewDecoder(resp.Body).Decode(&config); err != nil {
		return nil, fmt.Errorf("failed to decode auth config: %w", err)
	}

	return &config, nil
}

// GetOIDCAuthorizationURL gets the OIDC authorization URL from the API
func GetOIDCAuthorizationURL(baseURL, redirectURI string) (*OIDCAuthorizeResponse, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	url := baseURL + "/api/v1/auth/oidc/authorize"
	if redirectURI != "" {
		url += "?redirect_uri=" + redirectURI
	}

	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to get OIDC auth URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OIDC authorize returned status %d", resp.StatusCode)
	}

	var authResp OIDCAuthorizeResponse
	if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
		return nil, fmt.Errorf("failed to decode OIDC auth response: %w", err)
	}

	return &authResp, nil
}

// RefreshAccessToken refreshes the access token using the refresh token
func RefreshAccessToken(baseURL, refreshToken string) (*TokenResponse, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	req, err := http.NewRequest("POST", baseURL+"/api/v1/auth/refresh", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+refreshToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to refresh token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token refresh returned status %d", resp.StatusCode)
	}

	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("failed to decode token response: %w", err)
	}

	return &tokenResp, nil
}

// FetchUserProfile retrieves the current user's profile
func FetchUserProfile(baseURL, accessToken string) (*UserProfile, error) {
	client := &http.Client{Timeout: 10 * time.Second}

	req, err := http.NewRequest("GET", baseURL+"/api/v1/auth/profile", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch profile: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("profile request returned status %d", resp.StatusCode)
	}

	var profile UserProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return nil, fmt.Errorf("failed to decode profile: %w", err)
	}

	return &profile, nil
}
