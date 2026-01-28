// Package testutil provides testing utilities for SkySpy Go CLI E2E tests
package testutil

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// AuthMode represents the authentication mode for the mock server
type AuthMode string

const (
	AuthModePublic AuthMode = "public"
	AuthModeOIDC   AuthMode = "oidc"
	AuthModeAPIKey AuthMode = "apikey"
)

// MockServer implements a fake SkySpy server for E2E testing
type MockServer struct {
	port     int
	server   *http.Server
	upgrader websocket.Upgrader

	// Configuration
	authMode         AuthMode
	authEnabled      bool
	oidcProviderName string
	validAPIKeys     map[string]bool
	validTokens      map[string]*MockUser

	// WebSocket connections
	aircraftClients map[*websocket.Conn]bool
	acarsClients    map[*websocket.Conn]bool

	// Tracking
	receivedMessages []ReceivedMessage
	connectedClients int

	mu      sync.RWMutex
	running bool
	stopCh  chan struct{}
}

// MockUser represents a mock authenticated user
type MockUser struct {
	ID          int      `json:"id"`
	Username    string   `json:"username"`
	Email       string   `json:"email"`
	DisplayName string   `json:"display_name"`
	Roles       []string `json:"roles"`
}

// ReceivedMessage tracks messages received from WebSocket clients
type ReceivedMessage struct {
	Endpoint  string
	Message   []byte
	Timestamp time.Time
}

// Aircraft represents aircraft data for the mock server
type Aircraft struct {
	Hex      string   `json:"hex"`
	Flight   string   `json:"flight,omitempty"`
	Lat      *float64 `json:"lat,omitempty"`
	Lon      *float64 `json:"lon,omitempty"`
	AltBaro  *int     `json:"alt_baro,omitempty"`
	Alt      *int     `json:"alt,omitempty"`
	GS       *float64 `json:"gs,omitempty"`
	Track    *float64 `json:"track,omitempty"`
	BaroRate *float64 `json:"baro_rate,omitempty"`
	VR       *float64 `json:"vr,omitempty"`
	Squawk   string   `json:"squawk,omitempty"`
	RSSI     *float64 `json:"rssi,omitempty"`
	Type     string   `json:"t,omitempty"`
	Military bool     `json:"military,omitempty"`
	Distance *float64 `json:"distance_nm,omitempty"`
	Bearing  *float64 `json:"bearing,omitempty"`
}

// ACARSMessage represents an ACARS message for the mock server
type ACARSMessage struct {
	Callsign  string `json:"callsign"`
	Flight    string `json:"flight,omitempty"`
	Label     string `json:"label"`
	Text      string `json:"text"`
	Timestamp string `json:"timestamp,omitempty"`
}

// WebSocketMessage represents a message sent over WebSocket
type WebSocketMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// NewMockServer creates a new mock server instance
func NewMockServer() *MockServer {
	return &MockServer{
		authMode:         AuthModePublic,
		authEnabled:      false,
		oidcProviderName: "MockOIDC",
		validAPIKeys:     make(map[string]bool),
		validTokens:      make(map[string]*MockUser),
		aircraftClients:  make(map[*websocket.Conn]bool),
		acarsClients:     make(map[*websocket.Conn]bool),
		receivedMessages: make([]ReceivedMessage, 0),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		stopCh: make(chan struct{}),
	}
}

// SetAuthMode configures the authentication mode
func (s *MockServer) SetAuthMode(mode AuthMode) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authMode = mode
	s.authEnabled = mode != AuthModePublic
}

// SetOIDCProviderName sets the OIDC provider name
func (s *MockServer) SetOIDCProviderName(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.oidcProviderName = name
}

// AddValidAPIKey adds a valid API key for testing
func (s *MockServer) AddValidAPIKey(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.validAPIKeys[key] = true
}

// AddValidToken adds a valid token with associated user
func (s *MockServer) AddValidToken(token string, user *MockUser) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.validTokens[token] = user
}

// Start starts the mock server on the specified port
func (s *MockServer) Start(port int) error {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return fmt.Errorf("server already running")
	}
	s.port = port
	s.running = true
	s.stopCh = make(chan struct{})
	s.mu.Unlock()

	mux := http.NewServeMux()

	// HTTP endpoints
	mux.HandleFunc("/api/v1/auth/config", s.handleAuthConfig)
	mux.HandleFunc("/api/v1/auth/oidc/authorize", s.handleOIDCAuthorize)
	mux.HandleFunc("/api/v1/auth/oidc/callback", s.handleOIDCCallback)
	mux.HandleFunc("/api/v1/auth/refresh", s.handleRefresh)
	mux.HandleFunc("/api/v1/user/profile", s.handleUserProfile)
	mux.HandleFunc("/api/v1/auth/profile", s.handleUserProfile)

	// WebSocket endpoints
	mux.HandleFunc("/ws/aircraft/", s.handleAircraftWS)
	mux.HandleFunc("/ws/acars/", s.handleACARSWS)

	s.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
	}

	errCh := make(chan error, 1)
	go func() {
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	// Give the server a moment to start
	select {
	case err := <-errCh:
		return fmt.Errorf("failed to start server: %w", err)
	case <-time.After(100 * time.Millisecond):
		return nil
	}
}

// Stop stops the mock server
func (s *MockServer) Stop() error {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return nil
	}
	s.running = false

	// Close the stop channel to signal shutdown
	select {
	case <-s.stopCh:
		// Already closed
	default:
		close(s.stopCh)
	}

	// Close all WebSocket connections
	for conn := range s.aircraftClients {
		conn.Close()
	}
	for conn := range s.acarsClients {
		conn.Close()
	}
	s.aircraftClients = make(map[*websocket.Conn]bool)
	s.acarsClients = make(map[*websocket.Conn]bool)
	s.mu.Unlock()

	if s.server != nil {
		return s.server.Close()
	}
	return nil
}

// Port returns the port the server is running on
func (s *MockServer) Port() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.port
}

// BaseURL returns the base URL of the mock server
func (s *MockServer) BaseURL() string {
	return fmt.Sprintf("http://localhost:%d", s.Port())
}

// ConnectedClients returns the number of connected WebSocket clients
func (s *MockServer) ConnectedClients() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.aircraftClients) + len(s.acarsClients)
}

// AircraftClientCount returns the number of connected aircraft WebSocket clients
func (s *MockServer) AircraftClientCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.aircraftClients)
}

// ACARSClientCount returns the number of connected ACARS WebSocket clients
func (s *MockServer) ACARSClientCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.acarsClients)
}

// ReceivedMessages returns all messages received from clients
func (s *MockServer) ReceivedMessages() []ReceivedMessage {
	s.mu.RLock()
	defer s.mu.RUnlock()
	messages := make([]ReceivedMessage, len(s.receivedMessages))
	copy(messages, s.receivedMessages)
	return messages
}

// ClearReceivedMessages clears all tracked received messages
func (s *MockServer) ClearReceivedMessages() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.receivedMessages = make([]ReceivedMessage, 0)
}

// handleAuthConfig handles GET /api/v1/auth/config
func (s *MockServer) handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.RLock()
	config := map[string]interface{}{
		"auth_mode":          string(s.authMode),
		"auth_enabled":       s.authEnabled,
		"oidc_enabled":       s.authMode == AuthModeOIDC,
		"oidc_provider_name": s.oidcProviderName,
		"local_auth_enabled": false,
		"api_key_enabled":    s.authMode == AuthModeAPIKey,
		"features": map[string]interface{}{
			"aircraft": map[string]interface{}{
				"read_access":  "public",
				"write_access": "authenticated",
				"is_enabled":   true,
			},
			"acars": map[string]interface{}{
				"read_access":  "authenticated",
				"write_access": "authenticated",
				"is_enabled":   true,
			},
		},
	}
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// handleOIDCAuthorize handles GET /api/v1/auth/oidc/authorize
func (s *MockServer) handleOIDCAuthorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	redirectURI := r.URL.Query().Get("redirect_uri")
	if redirectURI == "" {
		redirectURI = "http://localhost:8765/callback"
	}

	state := "mock_state_" + fmt.Sprintf("%d", time.Now().UnixNano())

	response := map[string]string{
		"authorization_url": fmt.Sprintf("%s/mock-oidc/authorize?redirect_uri=%s&state=%s", s.BaseURL(), redirectURI, state),
		"state":             state,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleOIDCCallback handles GET /api/v1/auth/oidc/callback
func (s *MockServer) handleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Missing authorization code", http.StatusBadRequest)
		return
	}

	// Generate mock tokens
	accessToken := "mock_access_token_" + fmt.Sprintf("%d", time.Now().UnixNano())
	refreshToken := "mock_refresh_token_" + fmt.Sprintf("%d", time.Now().UnixNano())

	// Add the token to valid tokens with a mock user
	s.AddValidToken(accessToken, &MockUser{
		ID:          1,
		Username:    "testuser",
		Email:       "testuser@example.com",
		DisplayName: "Test User",
		Roles:       []string{"user"},
	})

	response := map[string]interface{}{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"token_type":    "Bearer",
		"expires_in":    3600,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleRefresh handles POST /api/v1/auth/refresh
func (s *MockServer) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		http.Error(w, "Missing authorization header", http.StatusUnauthorized)
		return
	}

	// Generate new tokens
	accessToken := "mock_refreshed_token_" + fmt.Sprintf("%d", time.Now().UnixNano())
	refreshToken := "mock_refresh_token_" + fmt.Sprintf("%d", time.Now().UnixNano())

	// Add the new token to valid tokens
	s.AddValidToken(accessToken, &MockUser{
		ID:          1,
		Username:    "testuser",
		Email:       "testuser@example.com",
		DisplayName: "Test User",
		Roles:       []string{"user"},
	})

	response := map[string]interface{}{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"token_type":    "Bearer",
		"expires_in":    3600,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleUserProfile handles GET /api/v1/user/profile and /api/v1/auth/profile
func (s *MockServer) handleUserProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	user, err := s.authenticateRequest(r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// authenticateRequest validates the request's authentication
func (s *MockServer) authenticateRequest(r *http.Request) (*MockUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if !s.authEnabled {
		return &MockUser{
			ID:          0,
			Username:    "anonymous",
			Email:       "",
			DisplayName: "Anonymous User",
			Roles:       []string{"anonymous"},
		}, nil
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return nil, fmt.Errorf("missing authorization header")
	}

	// Check for Bearer token
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		token := authHeader[7:]
		if user, ok := s.validTokens[token]; ok {
			return user, nil
		}
	}

	// Check for API key
	if len(authHeader) > 7 && authHeader[:7] == "ApiKey " {
		key := authHeader[7:]
		if s.validAPIKeys[key] {
			return &MockUser{
				ID:          99,
				Username:    "api_user",
				Email:       "api@example.com",
				DisplayName: "API User",
				Roles:       []string{"api"},
			}, nil
		}
	}

	return nil, fmt.Errorf("invalid credentials")
}

// authenticateWebSocket validates WebSocket authentication
func (s *MockServer) authenticateWebSocket(r *http.Request) (*MockUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if !s.authEnabled {
		return &MockUser{
			ID:          0,
			Username:    "anonymous",
			Email:       "",
			DisplayName: "Anonymous User",
			Roles:       []string{"anonymous"},
		}, nil
	}

	// Check Sec-WebSocket-Protocol header for authentication
	protocol := r.Header.Get("Sec-WebSocket-Protocol")
	if protocol != "" {
		// Format: "Bearer, <token>" or "ApiKey, <key>"
		if len(protocol) > 8 && protocol[:8] == "Bearer, " {
			token := protocol[8:]
			if user, ok := s.validTokens[token]; ok {
				return user, nil
			}
		}
		if len(protocol) > 8 && protocol[:8] == "ApiKey, " {
			key := protocol[8:]
			if s.validAPIKeys[key] {
				return &MockUser{
					ID:          99,
					Username:    "api_user",
					Email:       "api@example.com",
					DisplayName: "API User",
					Roles:       []string{"api"},
				}, nil
			}
		}
	}

	// Check query parameter for token
	token := r.URL.Query().Get("token")
	if token != "" {
		if user, ok := s.validTokens[token]; ok {
			return user, nil
		}
	}

	return nil, fmt.Errorf("unauthorized")
}

// handleAircraftWS handles the /ws/aircraft/ WebSocket endpoint
func (s *MockServer) handleAircraftWS(w http.ResponseWriter, r *http.Request) {
	_, err := s.authenticateWebSocket(r)
	if err != nil {
		s.mu.RLock()
		authRequired := s.authEnabled
		s.mu.RUnlock()
		if authRequired {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
	}

	// Set response protocol if client requested one
	responseHeader := http.Header{}
	protocol := r.Header.Get("Sec-WebSocket-Protocol")
	if protocol != "" {
		// Echo back the protocol to confirm authentication method
		if len(protocol) > 8 && protocol[:8] == "Bearer, " {
			responseHeader.Set("Sec-WebSocket-Protocol", "Bearer")
		} else if len(protocol) > 8 && protocol[:8] == "ApiKey, " {
			responseHeader.Set("Sec-WebSocket-Protocol", "ApiKey")
		}
	}

	conn, err := s.upgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		return
	}

	s.mu.Lock()
	s.aircraftClients[conn] = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.aircraftClients, conn)
		s.mu.Unlock()
		conn.Close()
	}()

	// Read messages from the client (for tracking purposes)
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		s.mu.Lock()
		s.receivedMessages = append(s.receivedMessages, ReceivedMessage{
			Endpoint:  "/ws/aircraft/",
			Message:   message,
			Timestamp: time.Now(),
		})
		s.mu.Unlock()
	}
}

// handleACARSWS handles the /ws/acars/ WebSocket endpoint
func (s *MockServer) handleACARSWS(w http.ResponseWriter, r *http.Request) {
	_, err := s.authenticateWebSocket(r)
	if err != nil {
		s.mu.RLock()
		authRequired := s.authEnabled
		s.mu.RUnlock()
		if authRequired {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
	}

	// Set response protocol if client requested one
	responseHeader := http.Header{}
	protocol := r.Header.Get("Sec-WebSocket-Protocol")
	if protocol != "" {
		if len(protocol) > 8 && protocol[:8] == "Bearer, " {
			responseHeader.Set("Sec-WebSocket-Protocol", "Bearer")
		} else if len(protocol) > 8 && protocol[:8] == "ApiKey, " {
			responseHeader.Set("Sec-WebSocket-Protocol", "ApiKey")
		}
	}

	conn, err := s.upgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		return
	}

	s.mu.Lock()
	s.acarsClients[conn] = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.acarsClients, conn)
		s.mu.Unlock()
		conn.Close()
	}()

	// Read messages from the client
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		s.mu.Lock()
		s.receivedMessages = append(s.receivedMessages, ReceivedMessage{
			Endpoint:  "/ws/acars/",
			Message:   message,
			Timestamp: time.Now(),
		})
		s.mu.Unlock()
	}
}

// SendAircraftSnapshot sends an aircraft snapshot to all connected aircraft clients
func (s *MockServer) SendAircraftSnapshot(aircraft []Aircraft) error {
	aircraftMap := make(map[string]Aircraft)
	for _, ac := range aircraft {
		aircraftMap[ac.Hex] = ac
	}

	msg := WebSocketMessage{
		Type: "aircraft:snapshot",
		Data: map[string]interface{}{
			"aircraft": aircraftMap,
		},
	}

	return s.broadcastToAircraftClients(msg)
}

// SendAircraftUpdate sends an aircraft update to all connected aircraft clients
func (s *MockServer) SendAircraftUpdate(aircraft Aircraft) error {
	msg := WebSocketMessage{
		Type: "aircraft:update",
		Data: aircraft,
	}

	return s.broadcastToAircraftClients(msg)
}

// SendAircraftNew sends a new aircraft notification to all connected aircraft clients
func (s *MockServer) SendAircraftNew(aircraft Aircraft) error {
	msg := WebSocketMessage{
		Type: "aircraft:new",
		Data: aircraft,
	}

	return s.broadcastToAircraftClients(msg)
}

// SendAircraftRemove sends an aircraft removal notification to all connected aircraft clients
func (s *MockServer) SendAircraftRemove(hex string) error {
	msg := WebSocketMessage{
		Type: "aircraft:remove",
		Data: map[string]string{
			"hex": hex,
		},
	}

	return s.broadcastToAircraftClients(msg)
}

// SendACARSMessage sends an ACARS message to all connected ACARS clients
func (s *MockServer) SendACARSMessage(acars ACARSMessage) error {
	if acars.Timestamp == "" {
		acars.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	msg := WebSocketMessage{
		Type: "acars:message",
		Data: acars,
	}

	return s.broadcastToACARSClients(msg)
}

// SendACARSSnapshot sends an ACARS snapshot to all connected ACARS clients
func (s *MockServer) SendACARSSnapshot(messages []ACARSMessage) error {
	msg := WebSocketMessage{
		Type: "acars:snapshot",
		Data: messages,
	}

	return s.broadcastToACARSClients(msg)
}

// broadcastToAircraftClients sends a message to all connected aircraft WebSocket clients
func (s *MockServer) broadcastToAircraftClients(msg WebSocketMessage) error {
	s.mu.RLock()
	clients := make([]*websocket.Conn, 0, len(s.aircraftClients))
	for conn := range s.aircraftClients {
		clients = append(clients, conn)
	}
	s.mu.RUnlock()

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	var lastErr error
	for _, conn := range clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			lastErr = err
		}
	}

	return lastErr
}

// broadcastToACARSClients sends a message to all connected ACARS WebSocket clients
func (s *MockServer) broadcastToACARSClients(msg WebSocketMessage) error {
	s.mu.RLock()
	clients := make([]*websocket.Conn, 0, len(s.acarsClients))
	for conn := range s.acarsClients {
		clients = append(clients, conn)
	}
	s.mu.RUnlock()

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	var lastErr error
	for _, conn := range clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			lastErr = err
		}
	}

	return lastErr
}

// SendRawMessage sends a raw JSON message to aircraft clients (for testing edge cases)
func (s *MockServer) SendRawMessage(endpoint string, data []byte) error {
	s.mu.RLock()
	var clients []*websocket.Conn
	if endpoint == "/ws/aircraft/" {
		clients = make([]*websocket.Conn, 0, len(s.aircraftClients))
		for conn := range s.aircraftClients {
			clients = append(clients, conn)
		}
	} else if endpoint == "/ws/acars/" {
		clients = make([]*websocket.Conn, 0, len(s.acarsClients))
		for conn := range s.acarsClients {
			clients = append(clients, conn)
		}
	}
	s.mu.RUnlock()

	var lastErr error
	for _, conn := range clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			lastErr = err
		}
	}

	return lastErr
}

// Reset clears all state (useful between tests)
func (s *MockServer) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.receivedMessages = make([]ReceivedMessage, 0)
	s.validAPIKeys = make(map[string]bool)
	s.validTokens = make(map[string]*MockUser)
	s.authMode = AuthModePublic
	s.authEnabled = false
}

// WaitForClients waits until the expected number of clients are connected
func (s *MockServer) WaitForClients(aircraftClients, acarsClients int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		s.mu.RLock()
		acCount := len(s.aircraftClients)
		acarsCount := len(s.acarsClients)
		s.mu.RUnlock()

		if acCount >= aircraftClients && acarsCount >= acarsClients {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return fmt.Errorf("timeout waiting for clients: got %d aircraft, %d acars; want %d, %d",
		s.AircraftClientCount(), s.ACARSClientCount(), aircraftClients, acarsClients)
}
