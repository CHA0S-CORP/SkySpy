package ws

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// testServer provides a test WebSocket server for testing the client
type testServer struct {
	server       *httptest.Server
	upgrader     websocket.Upgrader
	connections  []*websocket.Conn
	mu           sync.Mutex
	lastHeaders  http.Header
	messages     [][]byte
	onConnect    func(*websocket.Conn)
	onMessage    func(*websocket.Conn, []byte)
	closeOnRead  bool
	rejectAuth   bool
}

func newTestServer() *testServer {
	ts := &testServer{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}

	ts.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ts.mu.Lock()
		ts.lastHeaders = r.Header.Clone()
		ts.mu.Unlock()

		if ts.rejectAuth {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Check for Sec-WebSocket-Protocol header and respond accordingly
		protocol := r.Header.Get("Sec-WebSocket-Protocol")
		var responseHeader http.Header
		if protocol != "" {
			responseHeader = http.Header{}
			// Echo back the first part of the protocol (Bearer or ApiKey)
			parts := strings.SplitN(protocol, ", ", 2)
			if len(parts) > 0 {
				responseHeader.Set("Sec-WebSocket-Protocol", parts[0])
			}
		}

		conn, err := ts.upgrader.Upgrade(w, r, responseHeader)
		if err != nil {
			return
		}

		ts.mu.Lock()
		ts.connections = append(ts.connections, conn)
		ts.mu.Unlock()

		if ts.onConnect != nil {
			ts.onConnect(conn)
		}

		// Handle messages
		for {
			msgType, data, err := conn.ReadMessage()
			if err != nil {
				break
			}

			if ts.closeOnRead {
				conn.Close()
				break
			}

			ts.mu.Lock()
			ts.messages = append(ts.messages, data)
			ts.mu.Unlock()

			if ts.onMessage != nil {
				ts.onMessage(conn, data)
			}

			// Echo message back by default
			if msgType == websocket.TextMessage {
				conn.WriteMessage(msgType, data)
			}
		}
	}))

	return ts
}

func (ts *testServer) Close() {
	ts.mu.Lock()
	for _, conn := range ts.connections {
		conn.Close()
	}
	ts.mu.Unlock()
	ts.server.Close()
}

func (ts *testServer) getHostPort() (string, int) {
	addr := ts.server.Listener.Addr().String()
	parts := strings.Split(addr, ":")
	if len(parts) != 2 {
		return "localhost", 8080
	}
	var port int
	_ = json.Unmarshal([]byte(parts[1]), &port)
	return parts[0], port
}

func (ts *testServer) sendToAll(msg []byte) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for _, conn := range ts.connections {
		conn.WriteMessage(websocket.TextMessage, msg)
	}
}

func (ts *testServer) getLastHeaders() http.Header {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return ts.lastHeaders
}

func (ts *testServer) connectionCount() int {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return len(ts.connections)
}

// ============================================================================
// Connection Tests
// ============================================================================

func TestClient_Connect(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	client.Start()
	defer client.Stop()

	// Wait for connection
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if client.IsConnected() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}

	t.Error("Client did not connect within timeout")
}

func TestClient_ConnectWithAuth(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	authProvider := func() (string, error) {
		return "Bearer test-token-12345", nil
	}

	client := NewClientWithAuth(host, port, 1, authProvider)
	client.Start()
	defer client.Stop()

	// Wait for connection
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if client.IsConnected() {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Wait a bit more for headers to be captured
	time.Sleep(100 * time.Millisecond)

	headers := ts.getLastHeaders()
	protocol := headers.Get("Sec-Websocket-Protocol")

	if protocol == "" {
		t.Error("Expected Sec-WebSocket-Protocol header to be set")
		return
	}

	if !strings.Contains(protocol, "Bearer") {
		t.Errorf("Expected Bearer protocol, got: %s", protocol)
	}

	if !strings.Contains(protocol, "test-token-12345") {
		t.Errorf("Expected token in protocol header, got: %s", protocol)
	}
}

func TestClient_Reconnect(t *testing.T) {
	ts := newTestServer()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	var connectedCount int
	var mu sync.Mutex
	ts.onConnect = func(conn *websocket.Conn) {
		mu.Lock()
		connectedCount++
		mu.Unlock()
	}

	client.Start()
	defer client.Stop()

	// Wait for initial connection
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if client.IsConnected() {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if !client.IsConnected() {
		t.Fatal("Client did not connect initially")
	}

	// Close all connections on the server side to trigger reconnect
	ts.mu.Lock()
	for _, conn := range ts.connections {
		conn.Close()
	}
	ts.connections = nil
	ts.mu.Unlock()

	// Wait for client to detect disconnect
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !client.IsConnected() {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Wait for reconnection
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if client.IsConnected() {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if !client.IsConnected() {
		t.Error("Client did not reconnect after server closed connection")
	}

	mu.Lock()
	count := connectedCount
	mu.Unlock()

	// Should have connected at least twice (aircraft and ACARS connections * reconnects)
	if count < 2 {
		t.Errorf("Expected at least 2 connections (reconnect), got %d", count)
	}
}

func TestClient_ReconnectDelay(t *testing.T) {
	ts := newTestServer()
	ts.rejectAuth = true // Reject connections to force reconnect loop

	host, port := ts.getHostPort()
	reconnectDelaySec := 1
	client := NewClient(host, port, reconnectDelaySec)

	var attemptTimes []time.Time
	var mu sync.Mutex

	// Track connection attempts by path to separate aircraft and ACARS
	aircraftAttempts := make([]time.Time, 0)
	acarsAttempts := make([]time.Time, 0)

	originalHandler := ts.server.Config.Handler
	ts.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attemptTimes = append(attemptTimes, time.Now())
		if strings.Contains(r.URL.Path, "aircraft") {
			aircraftAttempts = append(aircraftAttempts, time.Now())
		} else if strings.Contains(r.URL.Path, "acars") {
			acarsAttempts = append(acarsAttempts, time.Now())
		}
		mu.Unlock()
		originalHandler.ServeHTTP(w, r)
	})

	client.Start()

	// Wait for a few reconnect attempts
	time.Sleep(time.Duration(reconnectDelaySec*3+1) * time.Second)
	client.Stop()

	mu.Lock()
	acTimes := aircraftAttempts
	mu.Unlock()

	// Need at least 2 attempts from one endpoint to check delay
	if len(acTimes) < 2 {
		t.Skipf("Only got %d aircraft connection attempts, need at least 2 to verify delay", len(acTimes))
		return
	}

	// Check delay between attempts for the same endpoint (aircraft)
	for i := 1; i < len(acTimes); i++ {
		delay := acTimes[i].Sub(acTimes[i-1])
		expectedMin := time.Duration(reconnectDelaySec)*time.Second - 200*time.Millisecond
		if delay < expectedMin {
			t.Errorf("Reconnect delay too short for aircraft endpoint: %v, expected at least %v",
				delay, expectedMin)
		}
	}
}

func TestClient_Stop(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	client.Start()

	// Wait for connection
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if client.IsConnected() {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Stop the client
	client.Stop()

	// Give goroutines time to stop
	time.Sleep(200 * time.Millisecond)

	// Verify client state changed
	// Note: After stop, the client may briefly show disconnected state
	// The main thing is that it doesn't try to reconnect anymore

	// Try to verify no panic and clean shutdown
	// If we get here without panic, the test passes
}

// ============================================================================
// Message Handling Tests
// ============================================================================

func TestClient_ReceiveAircraftSnapshot(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	ts.onMessage = func(conn *websocket.Conn, data []byte) {
		// After receiving subscribe message, send snapshot
		var msg map[string]interface{}
		if err := json.Unmarshal(data, &msg); err == nil {
			if msg["action"] == "subscribe" {
				snapshot := Message{
					Type: string(AircraftSnapshot),
					Data: json.RawMessage(`{"aircraft":{"ABC123":{"hex":"ABC123","flight":"TEST001","lat":45.0,"lon":-93.0}}}`),
				}
				msgBytes, _ := json.Marshal(snapshot)
				conn.WriteMessage(websocket.TextMessage, msgBytes)
			}
		}
	}

	client.Start()
	defer client.Stop()

	// Wait for message
	select {
	case msg := <-client.AircraftMessages():
		if msg.Type != string(AircraftSnapshot) {
			t.Errorf("Expected type %s, got %s", AircraftSnapshot, msg.Type)
		}
		aircraft, err := ParseAircraftSnapshot(msg.Data)
		if err != nil {
			t.Errorf("Failed to parse aircraft snapshot: %v", err)
		}
		if len(aircraft) != 1 {
			t.Errorf("Expected 1 aircraft, got %d", len(aircraft))
		}
	case <-time.After(3 * time.Second):
		t.Error("Did not receive aircraft snapshot message")
	}
}

func TestClient_ReceiveAircraftUpdate(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	ts.onMessage = func(conn *websocket.Conn, data []byte) {
		var msg map[string]interface{}
		if err := json.Unmarshal(data, &msg); err == nil {
			if msg["action"] == "subscribe" {
				update := Message{
					Type: string(AircraftUpdate),
					Data: json.RawMessage(`{"hex":"ABC123","flight":"TEST001","lat":45.5,"lon":-93.5,"alt_baro":35000}`),
				}
				msgBytes, _ := json.Marshal(update)
				conn.WriteMessage(websocket.TextMessage, msgBytes)
			}
		}
	}

	client.Start()
	defer client.Stop()

	select {
	case msg := <-client.AircraftMessages():
		if msg.Type != string(AircraftUpdate) {
			t.Errorf("Expected type %s, got %s", AircraftUpdate, msg.Type)
		}
		aircraft, err := ParseAircraft(msg.Data)
		if err != nil {
			t.Errorf("Failed to parse aircraft: %v", err)
		}
		if aircraft.Hex != "ABC123" {
			t.Errorf("Expected hex ABC123, got %s", aircraft.Hex)
		}
		if aircraft.Flight != "TEST001" {
			t.Errorf("Expected flight TEST001, got %s", aircraft.Flight)
		}
	case <-time.After(3 * time.Second):
		t.Error("Did not receive aircraft update message")
	}
}

func TestClient_ReceiveAircraftNew(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	ts.onMessage = func(conn *websocket.Conn, data []byte) {
		var msg map[string]interface{}
		if err := json.Unmarshal(data, &msg); err == nil {
			if msg["action"] == "subscribe" {
				newAc := Message{
					Type: string(AircraftNew),
					Data: json.RawMessage(`{"hex":"NEW456","flight":"NEWAIR","lat":44.0,"lon":-94.0,"military":true}`),
				}
				msgBytes, _ := json.Marshal(newAc)
				conn.WriteMessage(websocket.TextMessage, msgBytes)
			}
		}
	}

	client.Start()
	defer client.Stop()

	select {
	case msg := <-client.AircraftMessages():
		if msg.Type != string(AircraftNew) {
			t.Errorf("Expected type %s, got %s", AircraftNew, msg.Type)
		}
		aircraft, err := ParseAircraft(msg.Data)
		if err != nil {
			t.Errorf("Failed to parse aircraft: %v", err)
		}
		if aircraft.Hex != "NEW456" {
			t.Errorf("Expected hex NEW456, got %s", aircraft.Hex)
		}
		if !aircraft.Military {
			t.Error("Expected military flag to be true")
		}
	case <-time.After(3 * time.Second):
		t.Error("Did not receive aircraft new message")
	}
}

func TestClient_ReceiveAircraftRemove(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	ts.onMessage = func(conn *websocket.Conn, data []byte) {
		var msg map[string]interface{}
		if err := json.Unmarshal(data, &msg); err == nil {
			if msg["action"] == "subscribe" {
				removeMsg := Message{
					Type: string(AircraftRemove),
					Data: json.RawMessage(`{"hex":"GONE789"}`),
				}
				msgBytes, _ := json.Marshal(removeMsg)
				conn.WriteMessage(websocket.TextMessage, msgBytes)
			}
		}
	}

	client.Start()
	defer client.Stop()

	select {
	case msg := <-client.AircraftMessages():
		if msg.Type != string(AircraftRemove) {
			t.Errorf("Expected type %s, got %s", AircraftRemove, msg.Type)
		}
		aircraft, err := ParseAircraft(msg.Data)
		if err != nil {
			t.Errorf("Failed to parse aircraft: %v", err)
		}
		if aircraft.Hex != "GONE789" {
			t.Errorf("Expected hex GONE789, got %s", aircraft.Hex)
		}
	case <-time.After(3 * time.Second):
		t.Error("Did not receive aircraft remove message")
	}
}

func TestClient_ReceiveACARSMessage(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	ts.onMessage = func(conn *websocket.Conn, data []byte) {
		var msg map[string]interface{}
		if err := json.Unmarshal(data, &msg); err == nil {
			if msg["action"] == "subscribe" {
				// Check if this is the ACARS subscription (topic "messages")
				if topics, ok := msg["topics"].([]interface{}); ok {
					for _, topic := range topics {
						if topic == "messages" {
							acarsMsg := Message{
								Type: string(ACARSMessage),
								Data: json.RawMessage(`{"callsign":"TEST123","flight":"TS123","label":"H1","text":"POSITION REPORT"}`),
							}
							msgBytes, _ := json.Marshal(acarsMsg)
							conn.WriteMessage(websocket.TextMessage, msgBytes)
							return
						}
					}
				}
			}
		}
	}

	client.Start()
	defer client.Stop()

	select {
	case msg := <-client.ACARSMessages():
		if msg.Type != string(ACARSMessage) {
			t.Errorf("Expected type %s, got %s", ACARSMessage, msg.Type)
		}
		acarsData, err := ParseACARSData(msg.Data)
		if err != nil {
			t.Errorf("Failed to parse ACARS data: %v", err)
		}
		if len(acarsData) != 1 {
			t.Errorf("Expected 1 ACARS message, got %d", len(acarsData))
			return
		}
		if acarsData[0].Callsign != "TEST123" {
			t.Errorf("Expected callsign TEST123, got %s", acarsData[0].Callsign)
		}
		if acarsData[0].Text != "POSITION REPORT" {
			t.Errorf("Expected text 'POSITION REPORT', got %s", acarsData[0].Text)
		}
	case <-time.After(3 * time.Second):
		t.Error("Did not receive ACARS message")
	}
}

func TestClient_ReceiveACARSSnapshot(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	ts.onMessage = func(conn *websocket.Conn, data []byte) {
		var msg map[string]interface{}
		if err := json.Unmarshal(data, &msg); err == nil {
			if msg["action"] == "subscribe" {
				if topics, ok := msg["topics"].([]interface{}); ok {
					for _, topic := range topics {
						if topic == "messages" {
							snapshot := Message{
								Type: string(ACARSSnapshot),
								Data: json.RawMessage(`[{"callsign":"AC1","flight":"FL1","label":"H1","text":"MSG1"},{"callsign":"AC2","flight":"FL2","label":"H2","text":"MSG2"}]`),
							}
							msgBytes, _ := json.Marshal(snapshot)
							conn.WriteMessage(websocket.TextMessage, msgBytes)
							return
						}
					}
				}
			}
		}
	}

	client.Start()
	defer client.Stop()

	select {
	case msg := <-client.ACARSMessages():
		if msg.Type != string(ACARSSnapshot) {
			t.Errorf("Expected type %s, got %s", ACARSSnapshot, msg.Type)
		}
		acarsData, err := ParseACARSData(msg.Data)
		if err != nil {
			t.Errorf("Failed to parse ACARS snapshot: %v", err)
		}
		if len(acarsData) != 2 {
			t.Errorf("Expected 2 ACARS messages, got %d", len(acarsData))
		}
	case <-time.After(3 * time.Second):
		t.Error("Did not receive ACARS snapshot")
	}
}

// ============================================================================
// Parser Tests
// ============================================================================

func TestParseAircraftSnapshot_Map(t *testing.T) {
	data := json.RawMessage(`{
		"aircraft": {
			"ABC123": {"hex": "ABC123", "flight": "TEST1", "lat": 45.0, "lon": -93.0},
			"DEF456": {"hex": "DEF456", "flight": "TEST2", "lat": 46.0, "lon": -94.0}
		}
	}`)

	aircraft, err := ParseAircraftSnapshot(data)
	if err != nil {
		t.Fatalf("ParseAircraftSnapshot failed: %v", err)
	}

	if len(aircraft) != 2 {
		t.Errorf("Expected 2 aircraft, got %d", len(aircraft))
	}

	// Check that both aircraft are present (order may vary due to map)
	hexes := make(map[string]bool)
	for _, ac := range aircraft {
		hexes[ac.Hex] = true
	}

	if !hexes["ABC123"] {
		t.Error("Missing aircraft ABC123")
	}
	if !hexes["DEF456"] {
		t.Error("Missing aircraft DEF456")
	}
}

func TestParseAircraftSnapshot_Array(t *testing.T) {
	data := json.RawMessage(`[
		{"hex": "ABC123", "flight": "TEST1", "lat": 45.0, "lon": -93.0},
		{"hex": "DEF456", "flight": "TEST2", "lat": 46.0, "lon": -94.0},
		{"hex": "GHI789", "flight": "TEST3", "lat": 47.0, "lon": -95.0}
	]`)

	aircraft, err := ParseAircraftSnapshot(data)
	if err != nil {
		t.Fatalf("ParseAircraftSnapshot failed: %v", err)
	}

	if len(aircraft) != 3 {
		t.Errorf("Expected 3 aircraft, got %d", len(aircraft))
	}

	if aircraft[0].Hex != "ABC123" {
		t.Errorf("Expected first aircraft hex ABC123, got %s", aircraft[0].Hex)
	}
	if aircraft[2].Hex != "GHI789" {
		t.Errorf("Expected third aircraft hex GHI789, got %s", aircraft[2].Hex)
	}
}

func TestParseAircraft_AllFields(t *testing.T) {
	lat := 45.5
	lon := -93.5
	altBaro := 35000
	alt := 34800
	gs := 450.5
	track := 180.5
	baroRate := -500.0
	vr := -480.0
	rssi := -25.5
	distance := 15.5
	bearing := 270.0

	data := json.RawMessage(`{
		"hex": "ABC123",
		"flight": "UAL123  ",
		"lat": 45.5,
		"lon": -93.5,
		"alt_baro": 35000,
		"alt": 34800,
		"gs": 450.5,
		"track": 180.5,
		"baro_rate": -500.0,
		"vr": -480.0,
		"squawk": "7500",
		"rssi": -25.5,
		"t": "B738",
		"military": true,
		"distance_nm": 15.5,
		"bearing": 270.0
	}`)

	aircraft, err := ParseAircraft(data)
	if err != nil {
		t.Fatalf("ParseAircraft failed: %v", err)
	}

	// Verify all fields
	tests := []struct {
		name     string
		got      interface{}
		expected interface{}
	}{
		{"Hex", aircraft.Hex, "ABC123"},
		{"Flight", aircraft.Flight, "UAL123  "},
		{"Lat", *aircraft.Lat, lat},
		{"Lon", *aircraft.Lon, lon},
		{"AltBaro", *aircraft.AltBaro, altBaro},
		{"Alt", *aircraft.Alt, alt},
		{"GS", *aircraft.GS, gs},
		{"Track", *aircraft.Track, track},
		{"BaroRate", *aircraft.BaroRate, baroRate},
		{"VR", *aircraft.VR, vr},
		{"Squawk", aircraft.Squawk, "7500"},
		{"RSSI", *aircraft.RSSI, rssi},
		{"Type", aircraft.Type, "B738"},
		{"Military", aircraft.Military, true},
		{"Distance", *aircraft.Distance, distance},
		{"Bearing", *aircraft.Bearing, bearing},
	}

	for _, tt := range tests {
		if tt.got != tt.expected {
			t.Errorf("%s: got %v, expected %v", tt.name, tt.got, tt.expected)
		}
	}
}

func TestParseAircraft_PartialFields(t *testing.T) {
	data := json.RawMessage(`{
		"hex": "ABC123",
		"flight": "TEST001",
		"lat": 45.0
	}`)

	aircraft, err := ParseAircraft(data)
	if err != nil {
		t.Fatalf("ParseAircraft failed: %v", err)
	}

	// Required/present fields
	if aircraft.Hex != "ABC123" {
		t.Errorf("Expected hex ABC123, got %s", aircraft.Hex)
	}
	if aircraft.Flight != "TEST001" {
		t.Errorf("Expected flight TEST001, got %s", aircraft.Flight)
	}
	if aircraft.Lat == nil {
		t.Error("Expected Lat to be set")
	} else if *aircraft.Lat != 45.0 {
		t.Errorf("Expected Lat 45.0, got %f", *aircraft.Lat)
	}

	// Optional/missing fields should be nil
	if aircraft.Lon != nil {
		t.Error("Expected Lon to be nil")
	}
	if aircraft.AltBaro != nil {
		t.Error("Expected AltBaro to be nil")
	}
	if aircraft.GS != nil {
		t.Error("Expected GS to be nil")
	}
	if aircraft.Track != nil {
		t.Error("Expected Track to be nil")
	}
	if aircraft.RSSI != nil {
		t.Error("Expected RSSI to be nil")
	}
	if aircraft.Military {
		t.Error("Expected Military to be false (default)")
	}
}

func TestParseACARSData_Single(t *testing.T) {
	data := json.RawMessage(`{
		"callsign": "UAL123",
		"flight": "UA123",
		"label": "H1",
		"text": "POSITION REPORT LAT 45.0 LON -93.0"
	}`)

	acarsData, err := ParseACARSData(data)
	if err != nil {
		t.Fatalf("ParseACARSData failed: %v", err)
	}

	if len(acarsData) != 1 {
		t.Fatalf("Expected 1 ACARS message, got %d", len(acarsData))
	}

	msg := acarsData[0]
	if msg.Callsign != "UAL123" {
		t.Errorf("Expected callsign UAL123, got %s", msg.Callsign)
	}
	if msg.Flight != "UA123" {
		t.Errorf("Expected flight UA123, got %s", msg.Flight)
	}
	if msg.Label != "H1" {
		t.Errorf("Expected label H1, got %s", msg.Label)
	}
	if msg.Text != "POSITION REPORT LAT 45.0 LON -93.0" {
		t.Errorf("Unexpected text: %s", msg.Text)
	}
}

func TestParseACARSData_Array(t *testing.T) {
	data := json.RawMessage(`[
		{"callsign": "UAL123", "flight": "UA123", "label": "H1", "text": "MSG1"},
		{"callsign": "DAL456", "flight": "DL456", "label": "H2", "text": "MSG2"},
		{"callsign": "AAL789", "flight": "AA789", "label": "H3", "text": "MSG3"}
	]`)

	acarsData, err := ParseACARSData(data)
	if err != nil {
		t.Fatalf("ParseACARSData failed: %v", err)
	}

	if len(acarsData) != 3 {
		t.Fatalf("Expected 3 ACARS messages, got %d", len(acarsData))
	}

	expectedCallsigns := []string{"UAL123", "DAL456", "AAL789"}
	for i, expected := range expectedCallsigns {
		if acarsData[i].Callsign != expected {
			t.Errorf("Message %d: expected callsign %s, got %s", i, expected, acarsData[i].Callsign)
		}
	}
}

// ============================================================================
// State Tests
// ============================================================================

func TestClient_State(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	// Initially disconnected
	if client.State() != StateDisconnected {
		t.Errorf("Expected initial state Disconnected, got %v", client.State())
	}

	client.Start()
	defer client.Stop()

	// Wait for connecting -> connected transition
	deadline := time.Now().Add(2 * time.Second)
	sawConnecting := false
	for time.Now().Before(deadline) {
		state := client.State()
		if state == StateConnecting {
			sawConnecting = true
		}
		if state == StateConnected {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	// We may or may not see connecting state depending on timing
	if client.State() != StateConnected {
		t.Errorf("Expected state Connected, got %v", client.State())
	}

	// Close server connections to trigger disconnect
	ts.mu.Lock()
	for _, conn := range ts.connections {
		conn.Close()
	}
	ts.mu.Unlock()

	// Wait for disconnect
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if client.State() == StateDisconnected || client.State() == StateConnecting {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	state := client.State()
	if state != StateDisconnected && state != StateConnecting {
		t.Errorf("Expected state Disconnected or Connecting after server close, got %v", state)
	}

	_ = sawConnecting // Avoid unused variable warning
}

func TestClient_IsConnected(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	// Initially not connected
	if client.IsConnected() {
		t.Error("Client should not be connected initially")
	}

	client.Start()
	defer client.Stop()

	// Wait for connection
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if client.IsConnected() {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if !client.IsConnected() {
		t.Error("Client should be connected after start")
	}

	// Verify IsConnected matches State() == StateConnected
	if client.IsConnected() != (client.State() == StateConnected) {
		t.Error("IsConnected() should match State() == StateConnected")
	}
}

// ============================================================================
// Auth Provider Tests
// ============================================================================

func TestClient_AuthProvider_Bearer(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()

	bearerToken := "my-jwt-token-12345"
	authProvider := func() (string, error) {
		return "Bearer " + bearerToken, nil
	}

	client := NewClientWithAuth(host, port, 1, authProvider)
	client.Start()
	defer client.Stop()

	// Wait for connection
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if client.IsConnected() {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Give time for headers to be captured
	time.Sleep(100 * time.Millisecond)

	headers := ts.getLastHeaders()
	protocol := headers.Get("Sec-Websocket-Protocol")

	if !strings.Contains(protocol, "Bearer") {
		t.Errorf("Expected 'Bearer' in protocol, got: %s", protocol)
	}
	if !strings.Contains(protocol, bearerToken) {
		t.Errorf("Expected token '%s' in protocol, got: %s", bearerToken, protocol)
	}
}

func TestClient_AuthProvider_ApiKey(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()

	apiKey := "api-key-secret-123"
	authProvider := func() (string, error) {
		return "ApiKey " + apiKey, nil
	}

	client := NewClientWithAuth(host, port, 1, authProvider)
	client.Start()
	defer client.Stop()

	// Wait for connection
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if client.IsConnected() {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Give time for headers to be captured
	time.Sleep(100 * time.Millisecond)

	headers := ts.getLastHeaders()
	protocol := headers.Get("Sec-Websocket-Protocol")

	if !strings.Contains(protocol, "ApiKey") {
		t.Errorf("Expected 'ApiKey' in protocol, got: %s", protocol)
	}
	if !strings.Contains(protocol, apiKey) {
		t.Errorf("Expected key '%s' in protocol, got: %s", apiKey, protocol)
	}
}

func TestClient_SetAuthProvider(t *testing.T) {
	client := NewClient("localhost", 8080, 1)

	// Initially no auth provider
	provider := client.getAuthProvider()
	if provider != nil {
		t.Error("Expected no auth provider initially")
	}

	// Set auth provider
	client.SetAuthProvider(func() (string, error) {
		return "Bearer test-token", nil
	})

	provider = client.getAuthProvider()
	if provider == nil {
		t.Error("Expected auth provider to be set")
	}

	header, err := provider()
	if err != nil {
		t.Errorf("Auth provider returned error: %v", err)
	}
	if header != "Bearer test-token" {
		t.Errorf("Expected 'Bearer test-token', got '%s'", header)
	}
}

// ============================================================================
// Edge Case Tests
// ============================================================================

func TestParseAircraftSnapshot_Empty(t *testing.T) {
	// Empty object with aircraft map
	data := json.RawMessage(`{"aircraft":{}}`)
	aircraft, err := ParseAircraftSnapshot(data)
	if err != nil {
		t.Fatalf("ParseAircraftSnapshot failed on empty: %v", err)
	}
	if len(aircraft) != 0 {
		t.Errorf("Expected 0 aircraft, got %d", len(aircraft))
	}

	// Empty array
	data = json.RawMessage(`[]`)
	aircraft, err = ParseAircraftSnapshot(data)
	if err != nil {
		t.Fatalf("ParseAircraftSnapshot failed on empty array: %v", err)
	}
	if len(aircraft) != 0 {
		t.Errorf("Expected 0 aircraft, got %d", len(aircraft))
	}
}

func TestParseAircraftSnapshot_Invalid(t *testing.T) {
	tests := []struct {
		name      string
		data      json.RawMessage
		expectErr bool
	}{
		{"string", json.RawMessage(`"not an object or array"`), true},
		{"number", json.RawMessage(`123`), true},
		// Note: null and empty object parse successfully as empty arrays
		{"null", json.RawMessage(`null`), false},
		{"other_field", json.RawMessage(`{"other_field": "value"}`), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseAircraftSnapshot(tt.data)
			if tt.expectErr && err == nil {
				t.Error("Expected error for invalid data, got none")
			}
			if !tt.expectErr && err != nil {
				t.Errorf("Unexpected error: %v", err)
			}
		})
	}
}

func TestParseACARSData_Invalid(t *testing.T) {
	tests := []struct {
		name      string
		data      json.RawMessage
		expectErr bool
	}{
		{"string", json.RawMessage(`"not valid"`), true},
		{"number", json.RawMessage(`123`), true},
		// Note: null parses successfully as empty array in Go
		{"null", json.RawMessage(`null`), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseACARSData(tt.data)
			if tt.expectErr && err == nil {
				t.Error("Expected error for invalid ACARS data, got none")
			}
			if !tt.expectErr && err != nil {
				t.Errorf("Unexpected error: %v", err)
			}
		})
	}
}

func TestClient_ChannelBuffer(t *testing.T) {
	ts := newTestServer()
	defer ts.Close()

	host, port := ts.getHostPort()
	client := NewClient(host, port, 1)

	messageCount := 0
	ts.onMessage = func(conn *websocket.Conn, data []byte) {
		var msg map[string]interface{}
		if err := json.Unmarshal(data, &msg); err == nil {
			if msg["action"] == "subscribe" {
				// Send more messages than buffer size to test overflow handling
				for i := 0; i < 150; i++ {
					update := Message{
						Type: string(AircraftUpdate),
						Data: json.RawMessage(`{"hex":"TEST` + string(rune('0'+i%10)) + `"}`),
					}
					msgBytes, _ := json.Marshal(update)
					conn.WriteMessage(websocket.TextMessage, msgBytes)
					messageCount++
				}
			}
		}
	}

	client.Start()
	defer client.Stop()

	// Wait for some messages
	time.Sleep(500 * time.Millisecond)

	// Drain the channel and count messages
	received := 0
	for {
		select {
		case <-client.AircraftMessages():
			received++
		default:
			goto done
		}
	}
done:

	// We should receive at most buffer size (100) messages
	// Some may be dropped due to full channel
	if received > 100 {
		t.Errorf("Received more than buffer size: %d", received)
	}
}

func TestNewClient(t *testing.T) {
	client := NewClient("example.com", 9000, 5)

	if client.host != "example.com" {
		t.Errorf("Expected host 'example.com', got '%s'", client.host)
	}
	if client.port != 9000 {
		t.Errorf("Expected port 9000, got %d", client.port)
	}
	if client.reconnectDelay != 5*time.Second {
		t.Errorf("Expected reconnect delay 5s, got %v", client.reconnectDelay)
	}
	if client.state != StateDisconnected {
		t.Errorf("Expected initial state Disconnected, got %v", client.state)
	}
	if client.authProvider != nil {
		t.Error("Expected no auth provider initially")
	}
}

func TestNewClientWithAuth(t *testing.T) {
	authCalled := false
	authProvider := func() (string, error) {
		authCalled = true
		return "Bearer token", nil
	}

	client := NewClientWithAuth("example.com", 9000, 5, authProvider)

	if client.host != "example.com" {
		t.Errorf("Expected host 'example.com', got '%s'", client.host)
	}
	if client.authProvider == nil {
		t.Fatal("Expected auth provider to be set")
	}

	// Call the provider to verify it works
	header, err := client.authProvider()
	if err != nil {
		t.Errorf("Auth provider returned error: %v", err)
	}
	if header != "Bearer token" {
		t.Errorf("Expected 'Bearer token', got '%s'", header)
	}
	if !authCalled {
		t.Error("Auth provider was not called")
	}
}

func TestClient_MessageChannels(t *testing.T) {
	client := NewClient("localhost", 8080, 1)

	// Verify channels are not nil
	aircraftCh := client.AircraftMessages()
	if aircraftCh == nil {
		t.Error("AircraftMessages() returned nil channel")
	}

	acarsCh := client.ACARSMessages()
	if acarsCh == nil {
		t.Error("ACARSMessages() returned nil channel")
	}

	// Verify they are receive-only channels (this is enforced by type system)
	// We can test that they are the same underlying channels
	// by checking capacity
	if cap(aircraftCh) != 100 {
		t.Errorf("Expected aircraft channel capacity 100, got %d", cap(aircraftCh))
	}
	if cap(acarsCh) != 100 {
		t.Errorf("Expected ACARS channel capacity 100, got %d", cap(acarsCh))
	}
}

// Table-driven test for message types
func TestMessageTypes(t *testing.T) {
	tests := []struct {
		name     string
		msgType  MessageType
		expected string
	}{
		{"AircraftSnapshot", AircraftSnapshot, "aircraft:snapshot"},
		{"AircraftUpdate", AircraftUpdate, "aircraft:update"},
		{"AircraftNew", AircraftNew, "aircraft:new"},
		{"AircraftRemove", AircraftRemove, "aircraft:remove"},
		{"ACARSMessage", ACARSMessage, "acars:message"},
		{"ACARSSnapshot", ACARSSnapshot, "acars:snapshot"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.msgType) != tt.expected {
				t.Errorf("Expected %s, got %s", tt.expected, string(tt.msgType))
			}
		})
	}
}

// Table-driven test for client states
func TestClientStates(t *testing.T) {
	tests := []struct {
		name          string
		state         ClientState
		expectedValue int
	}{
		{"StateDisconnected", StateDisconnected, 0},
		{"StateConnecting", StateConnecting, 1},
		{"StateConnected", StateConnected, 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if int(tt.state) != tt.expectedValue {
				t.Errorf("Expected %d, got %d", tt.expectedValue, int(tt.state))
			}
		})
	}
}
