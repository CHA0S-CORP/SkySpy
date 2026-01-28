// Package ws provides WebSocket client functionality for SkySpy
package ws

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// MessageType represents the type of WebSocket message
type MessageType string

const (
	AircraftSnapshot MessageType = "aircraft:snapshot"
	AircraftUpdate   MessageType = "aircraft:update"
	AircraftNew      MessageType = "aircraft:new"
	AircraftRemove   MessageType = "aircraft:remove"
	ACARSMessage     MessageType = "acars:message"
	ACARSSnapshot    MessageType = "acars:snapshot"
)

// Message represents a WebSocket message from the server
type Message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// Aircraft represents aircraft data from the WebSocket
type Aircraft struct {
	Hex       string   `json:"hex"`
	Flight    string   `json:"flight"`
	Lat       *float64 `json:"lat"`
	Lon       *float64 `json:"lon"`
	AltBaro   *int     `json:"alt_baro"`
	Alt       *int     `json:"alt"`
	GS        *float64 `json:"gs"`
	Track     *float64 `json:"track"`
	BaroRate  *float64 `json:"baro_rate"`
	VR        *float64 `json:"vr"`
	Squawk    string   `json:"squawk"`
	RSSI      *float64 `json:"rssi"`
	Type      string   `json:"t"`
	Military  bool     `json:"military"`
	Distance  *float64 `json:"distance_nm"`
	Bearing   *float64 `json:"bearing"`
}

// AircraftSnapshotData represents snapshot data containing multiple aircraft
type AircraftSnapshotData struct {
	Aircraft map[string]Aircraft `json:"aircraft"`
}

// ACARSData represents ACARS message data
type ACARSData struct {
	Callsign string `json:"callsign"`
	Flight   string `json:"flight"`
	Label    string `json:"label"`
	Text     string `json:"text"`
}

// ClientState represents the connection state
type ClientState int

const (
	StateDisconnected ClientState = iota
	StateConnecting
	StateConnected
)

// AuthProvider is a function that returns the current auth header value
type AuthProvider func() (string, error)

// Client handles WebSocket connections to the SkySpy server
type Client struct {
	host           string
	port           int
	reconnectDelay time.Duration
	state          ClientState
	authProvider   AuthProvider
	mu             sync.RWMutex
	stopCh         chan struct{}
	aircraftMsgCh  chan Message
	acarsMsgCh     chan Message
}

// NewClient creates a new WebSocket client
func NewClient(host string, port int, reconnectDelay int) *Client {
	return &Client{
		host:           host,
		port:           port,
		reconnectDelay: time.Duration(reconnectDelay) * time.Second,
		state:          StateDisconnected,
		stopCh:         make(chan struct{}),
		aircraftMsgCh:  make(chan Message, 100),
		acarsMsgCh:     make(chan Message, 100),
	}
}

// NewClientWithAuth creates a new WebSocket client with authentication
func NewClientWithAuth(host string, port int, reconnectDelay int, authProvider AuthProvider) *Client {
	client := NewClient(host, port, reconnectDelay)
	client.authProvider = authProvider
	return client
}

// SetAuthProvider sets the authentication provider
func (c *Client) SetAuthProvider(provider AuthProvider) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.authProvider = provider
}

// State returns the current connection state
func (c *Client) State() ClientState {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.state
}

// IsConnected returns true if the client is connected
func (c *Client) IsConnected() bool {
	return c.State() == StateConnected
}

// AircraftMessages returns the channel for aircraft messages
func (c *Client) AircraftMessages() <-chan Message {
	return c.aircraftMsgCh
}

// ACARSMessages returns the channel for ACARS messages
func (c *Client) ACARSMessages() <-chan Message {
	return c.acarsMsgCh
}

// Start begins the WebSocket connection goroutines
func (c *Client) Start() {
	go c.runAircraftConnection()
	go c.runACARSConnection()
}

// Stop closes all connections
func (c *Client) Stop() {
	close(c.stopCh)
}

func (c *Client) setState(state ClientState) {
	c.mu.Lock()
	c.state = state
	c.mu.Unlock()
}

func (c *Client) getAuthProvider() AuthProvider {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.authProvider
}

func (c *Client) runAircraftConnection() {
	url := fmt.Sprintf("ws://%s:%d/ws/aircraft/?topics=aircraft", c.host, c.port)
	c.runConnection(url, c.aircraftMsgCh, "aircraft")
}

func (c *Client) runACARSConnection() {
	url := fmt.Sprintf("ws://%s:%d/ws/acars/?topics=messages", c.host, c.port)
	c.runConnection(url, c.acarsMsgCh, "messages")
}

func (c *Client) runConnection(url string, msgCh chan<- Message, topic string) {
	for {
		select {
		case <-c.stopCh:
			return
		default:
		}

		c.setState(StateConnecting)

		// Build WebSocket dialer with auth
		dialer := websocket.Dialer{
			HandshakeTimeout: 10 * time.Second,
		}

		header := http.Header{}

		// Add authentication if available
		authProvider := c.getAuthProvider()
		if authProvider != nil {
			authHeader, err := authProvider()
			if err == nil && authHeader != "" {
				// Use Sec-WebSocket-Protocol for token (recommended by API)
				// Format: "Bearer, <token>" or "ApiKey, <key>"
				if strings.HasPrefix(authHeader, "Bearer ") {
					token := strings.TrimPrefix(authHeader, "Bearer ")
					header.Set("Sec-WebSocket-Protocol", "Bearer, "+token)
				} else if strings.HasPrefix(authHeader, "ApiKey ") {
					key := strings.TrimPrefix(authHeader, "ApiKey ")
					header.Set("Sec-WebSocket-Protocol", "ApiKey, "+key)
				}
			}
		}

		conn, _, err := dialer.Dial(url, header)
		if err != nil {
			c.setState(StateDisconnected)
			select {
			case <-c.stopCh:
				return
			case <-time.After(c.reconnectDelay):
				continue
			}
		}

		// Subscribe to topics
		subscribeMsg := map[string]interface{}{
			"action": "subscribe",
			"topics": []string{topic},
		}
		if err := conn.WriteJSON(subscribeMsg); err != nil {
			conn.Close()
			continue
		}

		c.setState(StateConnected)

		// Read messages
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				conn.Close()
				c.setState(StateDisconnected)
				break
			}

			var msg Message
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}

			select {
			case msgCh <- msg:
			default:
				// Channel full, skip message
			}
		}

		// Wait before reconnecting
		select {
		case <-c.stopCh:
			return
		case <-time.After(c.reconnectDelay):
		}
	}
}

// ParseAircraftSnapshot parses aircraft snapshot data
func ParseAircraftSnapshot(data json.RawMessage) ([]Aircraft, error) {
	// Try parsing as object with aircraft map
	var snapshot AircraftSnapshotData
	if err := json.Unmarshal(data, &snapshot); err == nil && snapshot.Aircraft != nil {
		aircraft := make([]Aircraft, 0, len(snapshot.Aircraft))
		for _, ac := range snapshot.Aircraft {
			aircraft = append(aircraft, ac)
		}
		return aircraft, nil
	}

	// Try parsing as array
	var list []Aircraft
	if err := json.Unmarshal(data, &list); err == nil {
		return list, nil
	}

	// Try parsing as object with nested data
	var nested struct {
		Aircraft map[string]Aircraft `json:"aircraft"`
	}
	if err := json.Unmarshal(data, &nested); err == nil && nested.Aircraft != nil {
		aircraft := make([]Aircraft, 0, len(nested.Aircraft))
		for _, ac := range nested.Aircraft {
			aircraft = append(aircraft, ac)
		}
		return aircraft, nil
	}

	return nil, fmt.Errorf("unable to parse aircraft snapshot")
}

// ParseAircraft parses single aircraft data
func ParseAircraft(data json.RawMessage) (*Aircraft, error) {
	var ac Aircraft
	if err := json.Unmarshal(data, &ac); err != nil {
		return nil, err
	}
	return &ac, nil
}

// ParseACARSData parses ACARS message data
func ParseACARSData(data json.RawMessage) ([]ACARSData, error) {
	// Try parsing as array
	var list []ACARSData
	if err := json.Unmarshal(data, &list); err == nil {
		return list, nil
	}

	// Try parsing as single message
	var single ACARSData
	if err := json.Unmarshal(data, &single); err == nil {
		return []ACARSData{single}, nil
	}

	return nil, fmt.Errorf("unable to parse ACARS data")
}
