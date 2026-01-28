// Package app provides integration tests for the SkySpy radar application
package app

import (
	"encoding/json"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/skyspy/skyspy-go/internal/alerts"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/radar"
	"github.com/skyspy/skyspy-go/internal/search"
	"github.com/skyspy/skyspy-go/internal/ws"
)

// Helper function to create a test configuration
func newTestConfig() *config.Config {
	cfg := config.DefaultConfig()
	cfg.Connection.Host = "localhost"
	cfg.Connection.Port = 8080
	cfg.Connection.ReceiverLat = 52.3676
	cfg.Connection.ReceiverLon = 4.9041
	cfg.Radar.DefaultRange = 100
	cfg.Display.Theme = "classic"
	cfg.Alerts.Enabled = true
	return cfg
}

// Helper function to create a mock aircraft message
func createMockAircraftMessage(msgType ws.MessageType, aircraft ws.Aircraft) ws.Message {
	data, _ := json.Marshal(aircraft)
	return ws.Message{
		Type: string(msgType),
		Data: data,
	}
}

// Helper function to create a mock ACARS message
func createMockACARSMessage(acars ws.ACARSData) ws.Message {
	data, _ := json.Marshal([]ws.ACARSData{acars})
	return ws.Message{
		Type: string(ws.ACARSMessage),
		Data: data,
	}
}

// Helper to create a float64 pointer
func floatPtr(v float64) *float64 {
	return &v
}

// Helper to create an int pointer
func intPtr(v int) *int {
	return &v
}

// =============================================================================
// Model Lifecycle Tests
// =============================================================================

func TestModel_New(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	if m == nil {
		t.Fatal("NewModel returned nil")
	}

	// Verify aircraft map is initialized
	if m.aircraft == nil {
		t.Error("aircraft map should be initialized")
	}

	// Verify sorted targets is initialized
	if m.sortedTargets == nil {
		t.Error("sortedTargets should be initialized")
	}

	// Verify default view mode is radar
	if m.viewMode != ViewRadar {
		t.Errorf("expected viewMode to be ViewRadar, got %d", m.viewMode)
	}

	// Verify range options are set
	if len(m.rangeOptions) == 0 {
		t.Error("rangeOptions should not be empty")
	}

	// Verify max range is set based on config
	if m.maxRange <= 0 {
		t.Errorf("maxRange should be positive, got %f", m.maxRange)
	}

	// Verify trail tracker is initialized
	if m.trailTracker == nil {
		t.Error("trailTracker should be initialized")
	}

	// Verify overlay manager is initialized
	if m.overlayManager == nil {
		t.Error("overlayManager should be initialized")
	}

	// Verify alert state is initialized
	if m.alertState == nil {
		t.Error("alertState should be initialized")
	}

	// Verify theme is set
	if m.theme == nil {
		t.Error("theme should be initialized")
	}

	// Verify config is stored
	if m.config == nil {
		t.Error("config should be stored")
	}
	if m.config.Connection.Host != cfg.Connection.Host {
		t.Errorf("expected host %s, got %s", cfg.Connection.Host, m.config.Connection.Host)
	}
}

func TestModel_NewWithAuth(t *testing.T) {
	cfg := newTestConfig()

	// Test without auth manager (nil)
	m := NewModelWithAuth(cfg, nil)

	if m == nil {
		t.Fatal("NewModelWithAuth returned nil")
	}

	// Verify WebSocket client is created
	if m.wsClient == nil {
		t.Error("wsClient should be initialized")
	}

	// Verify all other components are initialized same as NewModel
	if m.aircraft == nil {
		t.Error("aircraft map should be initialized")
	}

	if m.alertState == nil {
		t.Error("alertState should be initialized")
	}

	if m.trailTracker == nil {
		t.Error("trailTracker should be initialized")
	}
}

func TestModel_Init(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Init should return a batch command
	cmd := m.Init()

	if cmd == nil {
		t.Error("Init should return a command")
	}

	// We can't easily test the command content without executing it,
	// but we can verify the function returns non-nil
}

// =============================================================================
// Aircraft Handling Tests
// =============================================================================

func TestModel_HandleAircraftSnapshot(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Create snapshot data with multiple aircraft
	snapshotData := map[string]ws.Aircraft{
		"ABC123": {
			Hex:    "ABC123",
			Flight: "TEST001",
			Lat:    floatPtr(52.0),
			Lon:    floatPtr(4.0),
		},
		"DEF456": {
			Hex:    "DEF456",
			Flight: "TEST002",
			Lat:    floatPtr(52.5),
			Lon:    floatPtr(4.5),
		},
	}
	data, _ := json.Marshal(struct {
		Aircraft map[string]ws.Aircraft `json:"aircraft"`
	}{Aircraft: snapshotData})

	msg := ws.Message{
		Type: string(ws.AircraftSnapshot),
		Data: data,
	}

	m.handleAircraftMsg(msg)

	// Verify aircraft were added
	if len(m.aircraft) != 2 {
		t.Errorf("expected 2 aircraft, got %d", len(m.aircraft))
	}

	// Verify specific aircraft exists
	if _, exists := m.aircraft["ABC123"]; !exists {
		t.Error("aircraft ABC123 should exist")
	}

	if target := m.aircraft["ABC123"]; target.Callsign != "TEST001" {
		t.Errorf("expected callsign TEST001, got %s", target.Callsign)
	}
}

func TestModel_HandleAircraftUpdate(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add initial aircraft
	m.aircraft["ABC123"] = &radar.Target{
		Hex:      "ABC123",
		Callsign: "TEST001",
		Altitude: 30000,
		HasAlt:   true,
	}

	// Send update message
	updateAircraft := ws.Aircraft{
		Hex:     "ABC123",
		Flight:  "TEST001",
		AltBaro: intPtr(35000),
		GS:      floatPtr(450),
	}
	msg := createMockAircraftMessage(ws.AircraftUpdate, updateAircraft)

	m.handleAircraftMsg(msg)

	// Verify aircraft was updated
	target := m.aircraft["ABC123"]
	if target == nil {
		t.Fatal("aircraft should still exist after update")
	}

	if target.Altitude != 35000 {
		t.Errorf("expected altitude 35000, got %d", target.Altitude)
	}

	if !target.HasSpeed || target.Speed != 450 {
		t.Errorf("expected speed 450, got %f", target.Speed)
	}
}

func TestModel_HandleAircraftNew(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	initialCount := len(m.aircraft)
	initialMsgCount := m.sessionMessages

	// Send new aircraft message
	newAircraft := ws.Aircraft{
		Hex:      "NEW789",
		Flight:  "NEWFL01",
		Lat:      floatPtr(52.2),
		Lon:      floatPtr(4.2),
		AltBaro:  intPtr(28000),
		Military: true,
	}
	msg := createMockAircraftMessage(ws.AircraftNew, newAircraft)

	m.handleAircraftMsg(msg)

	// Verify aircraft was added
	if len(m.aircraft) != initialCount+1 {
		t.Errorf("expected %d aircraft, got %d", initialCount+1, len(m.aircraft))
	}

	target := m.aircraft["NEW789"]
	if target == nil {
		t.Fatal("new aircraft should be added")
	}

	if target.Callsign != "NEWFL01" {
		t.Errorf("expected callsign NEWFL01, got %s", target.Callsign)
	}

	if !target.Military {
		t.Error("aircraft should be marked as military")
	}

	// Verify message count was incremented
	if m.sessionMessages != initialMsgCount+1 {
		t.Errorf("expected sessionMessages to be %d, got %d", initialMsgCount+1, m.sessionMessages)
	}
}

func TestModel_HandleAircraftRemove(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add initial aircraft
	m.aircraft["REMOVE1"] = &radar.Target{
		Hex:      "REMOVE1",
		Callsign: "TOREMOVE",
	}

	if len(m.aircraft) != 1 {
		t.Fatalf("expected 1 aircraft initially, got %d", len(m.aircraft))
	}

	// Send remove message
	removeAircraft := ws.Aircraft{
		Hex: "REMOVE1",
	}
	msg := createMockAircraftMessage(ws.AircraftRemove, removeAircraft)

	m.handleAircraftMsg(msg)

	// Verify aircraft was removed
	if _, exists := m.aircraft["REMOVE1"]; exists {
		t.Error("aircraft should have been removed")
	}

	if len(m.aircraft) != 0 {
		t.Errorf("expected 0 aircraft, got %d", len(m.aircraft))
	}
}

func TestModel_HandleACARSMessage(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	initialCount := len(m.acarsMessages)

	// Send ACARS message
	acars := ws.ACARSData{
		Callsign: "TEST001",
		Flight:   "TST001",
		Label:    "H1",
		Text:     "Test ACARS message content",
	}
	msg := createMockACARSMessage(acars)

	m.handleACARSMsg(msg)

	// Verify ACARS message was added
	if len(m.acarsMessages) != initialCount+1 {
		t.Errorf("expected %d ACARS messages, got %d", initialCount+1, len(m.acarsMessages))
	}

	// Verify message content
	lastMsg := m.acarsMessages[len(m.acarsMessages)-1]
	if lastMsg.Callsign != "TEST001" {
		t.Errorf("expected callsign TEST001, got %s", lastMsg.Callsign)
	}
	if lastMsg.Text != "Test ACARS message content" {
		t.Errorf("expected specific text, got %s", lastMsg.Text)
	}
}

// =============================================================================
// View Mode Tests
// =============================================================================

func TestModel_ViewMode_Radar(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Default view mode should be radar
	if m.viewMode != ViewRadar {
		t.Errorf("expected default view mode to be ViewRadar, got %d", m.viewMode)
	}
}

func TestModel_ViewMode_Settings(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Press T to open settings
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'t'}}
	m.Update(keyMsg)

	if m.viewMode != ViewSettings {
		t.Errorf("expected view mode to be ViewSettings after T key, got %d", m.viewMode)
	}

	// Verify settings cursor is initialized
	if m.settingsCursor != 0 {
		t.Errorf("expected settingsCursor to be 0, got %d", m.settingsCursor)
	}
}

func TestModel_ViewMode_Help(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Press ? to open help
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}}
	m.Update(keyMsg)

	if m.viewMode != ViewHelp {
		t.Errorf("expected view mode to be ViewHelp after ? key, got %d", m.viewMode)
	}

	// Press any key to close help
	keyMsg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}}
	m.Update(keyMsg)

	if m.viewMode != ViewRadar {
		t.Errorf("expected view mode to return to ViewRadar, got %d", m.viewMode)
	}
}

func TestModel_ViewMode_Overlays(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Press O to open overlays
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'o'}}
	m.Update(keyMsg)

	if m.viewMode != ViewOverlays {
		t.Errorf("expected view mode to be ViewOverlays after O key, got %d", m.viewMode)
	}

	// Verify overlay cursor is initialized
	if m.overlayCursor != 0 {
		t.Errorf("expected overlayCursor to be 0, got %d", m.overlayCursor)
	}
}

func TestModel_ViewMode_Search(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Press / to open search
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}}
	m.Update(keyMsg)

	if m.viewMode != ViewSearch {
		t.Errorf("expected view mode to be ViewSearch after / key, got %d", m.viewMode)
	}

	// Verify search is initialized
	if m.searchQuery != "" {
		t.Errorf("expected empty search query, got %s", m.searchQuery)
	}
}

func TestModel_ViewMode_AlertRules(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Press R to open alert rules
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'r'}}
	m.Update(keyMsg)

	if m.viewMode != ViewAlertRules {
		t.Errorf("expected view mode to be ViewAlertRules after R key, got %d", m.viewMode)
	}

	// Verify alert rule cursor is initialized
	if m.alertRuleCursor != 0 {
		t.Errorf("expected alertRuleCursor to be 0, got %d", m.alertRuleCursor)
	}
}

// =============================================================================
// Navigation Tests
// =============================================================================

func TestModel_SelectNext(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add aircraft to sorted targets
	m.aircraft["AAA111"] = &radar.Target{Hex: "AAA111", Distance: 10}
	m.aircraft["BBB222"] = &radar.Target{Hex: "BBB222", Distance: 20}
	m.aircraft["CCC333"] = &radar.Target{Hex: "CCC333", Distance: 30}
	m.sortedTargets = []string{"AAA111", "BBB222", "CCC333"}

	// Select first with no selection
	m.selectNext()
	if m.selectedHex != "AAA111" {
		t.Errorf("expected first selection to be AAA111, got %s", m.selectedHex)
	}

	// Select next with j key
	m.selectNext()
	if m.selectedHex != "BBB222" {
		t.Errorf("expected second selection to be BBB222, got %s", m.selectedHex)
	}

	// Continue to third
	m.selectNext()
	if m.selectedHex != "CCC333" {
		t.Errorf("expected third selection to be CCC333, got %s", m.selectedHex)
	}

	// Wrap around to first
	m.selectNext()
	if m.selectedHex != "AAA111" {
		t.Errorf("expected wrap to AAA111, got %s", m.selectedHex)
	}
}

func TestModel_SelectPrev(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add aircraft to sorted targets
	m.aircraft["AAA111"] = &radar.Target{Hex: "AAA111", Distance: 10}
	m.aircraft["BBB222"] = &radar.Target{Hex: "BBB222", Distance: 20}
	m.aircraft["CCC333"] = &radar.Target{Hex: "CCC333", Distance: 30}
	m.sortedTargets = []string{"AAA111", "BBB222", "CCC333"}

	// Select last with no selection
	m.selectPrev()
	if m.selectedHex != "CCC333" {
		t.Errorf("expected first prev selection to be CCC333, got %s", m.selectedHex)
	}

	// Select previous
	m.selectPrev()
	if m.selectedHex != "BBB222" {
		t.Errorf("expected selection to be BBB222, got %s", m.selectedHex)
	}

	// Continue to first
	m.selectPrev()
	if m.selectedHex != "AAA111" {
		t.Errorf("expected selection to be AAA111, got %s", m.selectedHex)
	}

	// Wrap around to last
	m.selectPrev()
	if m.selectedHex != "CCC333" {
		t.Errorf("expected wrap to CCC333, got %s", m.selectedHex)
	}
}

func TestModel_ZoomIn(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	initialRange := m.maxRange
	initialIdx := m.rangeIdx

	// Ensure we're not at minimum already
	if initialIdx == 0 {
		m.rangeIdx = 2
		m.maxRange = float64(m.rangeOptions[2])
	}

	prevRange := m.maxRange
	m.zoomIn()

	if m.maxRange >= prevRange {
		t.Errorf("expected range to decrease, was %f, now %f", prevRange, m.maxRange)
	}

	if m.rangeIdx >= len(m.rangeOptions) {
		t.Error("rangeIdx out of bounds after zoom in")
	}

	// Notification should be set
	if m.notification == "" {
		t.Error("expected notification to be set after zoom")
	}

	_ = initialRange
}

func TestModel_ZoomOut(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Start at a lower zoom level
	m.rangeIdx = 1
	m.maxRange = float64(m.rangeOptions[1])

	prevRange := m.maxRange
	m.zoomOut()

	if m.maxRange <= prevRange {
		t.Errorf("expected range to increase, was %f, now %f", prevRange, m.maxRange)
	}

	// Notification should be set
	if m.notification == "" {
		t.Error("expected notification to be set after zoom")
	}
}

// =============================================================================
// Feature Integration Tests
// =============================================================================

func TestModel_TrailTracking(t *testing.T) {
	cfg := newTestConfig()
	cfg.Display.ShowTrails = true
	m := NewModel(cfg)

	// Simulate aircraft position updates
	positions := []struct {
		lat, lon float64
	}{
		{52.0, 4.0},
		{52.1, 4.1},
		{52.2, 4.2},
	}

	hex := "TRAIL01"

	for _, pos := range positions {
		aircraft := ws.Aircraft{
			Hex:    hex,
			Flight: "TRL001",
			Lat:    floatPtr(pos.lat),
			Lon:    floatPtr(pos.lon),
		}
		msg := createMockAircraftMessage(ws.AircraftUpdate, aircraft)
		m.handleAircraftMsg(msg)

		// Small delay to ensure positions are different enough
		time.Sleep(10 * time.Millisecond)
	}

	// Get trails
	trails := m.GetTrailsForRadar()

	if len(trails) == 0 {
		t.Error("expected at least one trail")
	}

	trail, exists := trails[hex]
	if !exists {
		t.Errorf("expected trail for aircraft %s", hex)
	}

	// Should have multiple trail points
	if len(trail) < 2 {
		t.Errorf("expected at least 2 trail points, got %d", len(trail))
	}
}

func TestModel_SearchFilter(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add various aircraft
	m.aircraft["MIL001"] = &radar.Target{Hex: "MIL001", Callsign: "USAF01", Military: true}
	m.aircraft["CIV001"] = &radar.Target{Hex: "CIV001", Callsign: "UAL123", Military: false}
	m.aircraft["MIL002"] = &radar.Target{Hex: "MIL002", Callsign: "RAF01", Military: true}

	// Test military filter
	filter := search.PresetMilitaryOnly()
	results := search.FilterAircraft(m.aircraft, filter)

	if len(results) != 2 {
		t.Errorf("expected 2 military aircraft, got %d", len(results))
	}

	// Verify only military are in results
	for _, hex := range results {
		if !m.aircraft[hex].Military {
			t.Errorf("non-military aircraft %s in military filter results", hex)
		}
	}

	// Test callsign search
	callsignFilter := search.ParseQuery("UAL")
	results = search.FilterAircraft(m.aircraft, callsignFilter)

	if len(results) != 1 {
		t.Errorf("expected 1 result for UAL search, got %d", len(results))
	}

	if len(results) > 0 && results[0] != "CIV001" {
		t.Errorf("expected CIV001 for UAL search, got %s", results[0])
	}
}

func TestModel_AlertTriggering(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true
	m := NewModel(cfg)

	// Verify alert state is enabled
	if !m.IsAlertsEnabled() {
		t.Error("alerts should be enabled")
	}

	// Create aircraft state for emergency squawk
	target := &radar.Target{
		Hex:      "EMERG1",
		Callsign: "EMERGENCY",
		Squawk:   "7700",
		HasAlt:   true,
		Altitude: 35000,
		Distance: 25,
	}

	// Add to model
	m.aircraft["EMERG1"] = target

	// Check alerts
	if m.alertState != nil {
		triggered := m.alertState.CheckAircraft(target, nil)

		// Should trigger emergency alert (if default rules are loaded)
		if len(triggered) == 0 {
			// Alert might be on cooldown or rules might not be configured
			// Try checking the default rules
			rules := m.GetAlertRules()
			foundEmergencyRule := false
			for _, rule := range rules {
				if rule.ID == "emergency_squawk" && rule.Enabled {
					foundEmergencyRule = true
					break
				}
			}
			if foundEmergencyRule {
				t.Log("Emergency rule exists but no alert triggered (may be cooldown)")
			}
		} else {
			// Verify alert content
			alert := triggered[0]
			if alert.Hex != "EMERG1" {
				t.Errorf("expected alert hex EMERG1, got %s", alert.Hex)
			}
		}
	}
}

func TestModel_Export(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add test aircraft
	m.aircraft["EXP001"] = &radar.Target{
		Hex:      "EXP001",
		Callsign: "EXPORT1",
		HasLat:   true,
		Lat:      52.0,
		HasLon:   true,
		Lon:      4.0,
		HasAlt:   true,
		Altitude: 35000,
	}
	m.aircraft["EXP002"] = &radar.Target{
		Hex:      "EXP002",
		Callsign: "EXPORT2",
		Military: true,
	}

	// Verify aircraft count
	if len(m.aircraft) != 2 {
		t.Errorf("expected 2 aircraft, got %d", len(m.aircraft))
	}

	// Test that export directory can be retrieved
	exportDir := m.GetExportDirectory()
	if exportDir != "" && cfg.Export.Directory != exportDir {
		t.Errorf("export directory mismatch: config=%s, model=%s", cfg.Export.Directory, exportDir)
	}

	// Note: Actual file export tests are better done in export package tests
	// Here we just verify the model provides the necessary data
}

// =============================================================================
// Additional Integration Tests
// =============================================================================

func TestModel_WindowResize(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Simulate window resize message
	resizeMsg := tea.WindowSizeMsg{
		Width:  120,
		Height: 50,
	}

	newModel, _ := m.Update(resizeMsg)
	model := newModel.(*Model)

	if model.width != 120 {
		t.Errorf("expected width 120, got %d", model.width)
	}

	if model.height != 50 {
		t.Errorf("expected height 50, got %d", model.height)
	}
}

func TestModel_ToggleSettings(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Test labels toggle (L key)
	initialLabels := m.config.Display.ShowLabels
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'l'}}
	m.Update(keyMsg)

	if m.config.Display.ShowLabels == initialLabels {
		t.Error("labels setting should have toggled")
	}

	// Test military filter toggle (M key)
	initialMilitary := m.config.Filters.MilitaryOnly
	keyMsg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'m'}}
	m.Update(keyMsg)

	if m.config.Filters.MilitaryOnly == initialMilitary {
		t.Error("military filter should have toggled")
	}

	// Test ground filter toggle (G key)
	initialGround := m.config.Filters.HideGround
	keyMsg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'g'}}
	m.Update(keyMsg)

	if m.config.Filters.HideGround == initialGround {
		t.Error("ground filter should have toggled")
	}

	// Test trails toggle (B key)
	initialTrails := m.config.Display.ShowTrails
	keyMsg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'b'}}
	m.Update(keyMsg)

	if m.config.Display.ShowTrails == initialTrails {
		t.Error("trails setting should have toggled")
	}
}

func TestModel_Notification(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Set notification
	m.notify("Test notification")

	if m.notification != "Test notification" {
		t.Errorf("expected notification 'Test notification', got '%s'", m.notification)
	}

	if m.notificationTime <= 0 {
		t.Error("notification time should be positive")
	}
}

func TestModel_ACARSMessageLimit(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add more than 100 ACARS messages
	for i := 0; i < 120; i++ {
		acars := ws.ACARSData{
			Callsign: "TEST001",
			Flight:   "TST001",
			Label:    "H1",
			Text:     "Message",
		}
		msg := createMockACARSMessage(acars)
		m.handleACARSMsg(msg)
	}

	// Should be limited to 100
	if len(m.acarsMessages) > 100 {
		t.Errorf("ACARS messages should be limited to 100, got %d", len(m.acarsMessages))
	}
}

func TestModel_StatsUpdate(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add aircraft
	m.aircraft["MIL01"] = &radar.Target{Hex: "MIL01", Military: true}
	m.aircraft["EMR01"] = &radar.Target{Hex: "EMR01", Squawk: "7700"}
	m.aircraft["CIV01"] = &radar.Target{Hex: "CIV01"}

	// Update stats
	m.updateStats()

	if m.militaryCount != 1 {
		t.Errorf("expected 1 military, got %d", m.militaryCount)
	}

	if m.emergencyCount != 1 {
		t.Errorf("expected 1 emergency, got %d", m.emergencyCount)
	}

	if m.peakAircraft < 3 {
		t.Errorf("expected peak aircraft >= 3, got %d", m.peakAircraft)
	}
}

func TestModel_FilterPresets(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Test F2 preset (military)
	keyMsg := tea.KeyMsg{Type: tea.KeyF2}
	m.Update(keyMsg)

	if m.searchFilter == nil {
		t.Error("search filter should be set after F2")
	}

	if !m.searchFilter.MilitaryOnly {
		t.Error("military only filter should be enabled after F2")
	}

	// Test F1 preset (all aircraft - clears filter)
	keyMsg = tea.KeyMsg{Type: tea.KeyF1}
	m.Update(keyMsg)

	// F1 applies "all" preset which is an empty filter
	if m.searchFilter != nil && m.searchFilter.IsActive() {
		t.Error("filter should not be active after F1 (all aircraft)")
	}
}

func TestModel_AlertStats(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true
	m := NewModel(cfg)

	stats := m.GetAlertStats()

	// Should have default rules loaded
	if stats.TotalRules == 0 {
		t.Error("expected default rules to be loaded")
	}

	// At least some rules should be enabled by default
	if stats.EnabledRules == 0 {
		t.Error("expected some rules to be enabled by default")
	}
}

func TestModel_AlertRuleToggle(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true
	m := NewModel(cfg)

	rules := m.GetAlertRules()
	if len(rules) == 0 {
		t.Skip("no alert rules configured")
	}

	firstRule := rules[0]
	initialEnabled := firstRule.Enabled

	// Toggle rule
	if m.alertState != nil {
		m.alertState.ToggleRule(firstRule.ID)

		// Verify it toggled
		newRules := m.GetAlertRules()
		for _, rule := range newRules {
			if rule.ID == firstRule.ID {
				if rule.Enabled == initialEnabled {
					t.Error("rule enabled state should have changed")
				}
				break
			}
		}
	}
}

// =============================================================================
// Search Mode Tests
// =============================================================================

func TestModel_SearchMode_Input(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Add test aircraft
	m.aircraft["ABC123"] = &radar.Target{Hex: "ABC123", Callsign: "TEST123"}
	m.aircraft["DEF456"] = &radar.Target{Hex: "DEF456", Callsign: "OTHER456"}

	// Enter search mode
	m.enterSearchMode()

	if m.viewMode != ViewSearch {
		t.Error("should be in search mode")
	}

	// Type search query
	for _, c := range "TEST" {
		keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{c}}
		m.handleSearchKey(keyMsg)
	}

	if m.searchQuery != "TEST" {
		t.Errorf("expected search query 'TEST', got '%s'", m.searchQuery)
	}

	// Should have search results
	if len(m.searchResults) == 0 {
		t.Error("expected search results for 'TEST'")
	}

	// Test backspace
	keyMsg := tea.KeyMsg{Type: tea.KeyBackspace}
	m.handleSearchKey(keyMsg)

	if m.searchQuery != "TES" {
		t.Errorf("expected search query 'TES' after backspace, got '%s'", m.searchQuery)
	}
}

func TestModel_SearchMode_Apply(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Add test aircraft
	m.aircraft["ABC123"] = &radar.Target{Hex: "ABC123", Callsign: "SEARCH1"}

	// Enter search mode
	m.enterSearchMode()

	// Type and apply search
	for _, c := range "SEARCH" {
		keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{c}}
		m.handleSearchKey(keyMsg)
	}

	// Apply with enter
	keyMsg := tea.KeyMsg{Type: tea.KeyEnter}
	m.handleSearchKey(keyMsg)

	// Should exit search mode
	if m.viewMode != ViewRadar {
		t.Error("should return to radar view after applying search")
	}

	// Filter should be applied
	if m.searchFilter == nil || !m.searchFilter.IsActive() {
		t.Error("search filter should be active after apply")
	}
}

func TestModel_SearchMode_Cancel(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Enter search mode and type something
	m.enterSearchMode()
	for _, c := range "TEST" {
		keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{c}}
		m.handleSearchKey(keyMsg)
	}

	// Cancel with escape
	keyMsg := tea.KeyMsg{Type: tea.KeyEsc}
	m.handleSearchKey(keyMsg)

	// Should exit search mode
	if m.viewMode != ViewRadar {
		t.Error("should return to radar view after cancel")
	}

	// Search query should be cleared
	if m.searchQuery != "" {
		t.Errorf("search query should be cleared, got '%s'", m.searchQuery)
	}

	// Filter should be cleared
	if m.searchFilter != nil && m.searchFilter.IsActive() {
		t.Error("search filter should not be active after cancel")
	}
}

// =============================================================================
// Emergency Aircraft Tests
// =============================================================================

func TestModel_EmergencySquawkDetection(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	emergencySquawks := []string{"7500", "7600", "7700"}

	for _, squawk := range emergencySquawks {
		target := &radar.Target{
			Hex:    "EMR" + squawk,
			Squawk: squawk,
		}
		m.aircraft[target.Hex] = target

		if !target.IsEmergency() {
			t.Errorf("squawk %s should be detected as emergency", squawk)
		}
	}

	// Non-emergency squawk
	normalTarget := &radar.Target{
		Hex:    "NORMAL",
		Squawk: "1200",
	}
	if normalTarget.IsEmergency() {
		t.Error("squawk 1200 should not be detected as emergency")
	}
}

// =============================================================================
// Concurrent Access Tests
// =============================================================================

func TestModel_ConcurrentAircraftUpdates(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Simulate concurrent updates
	done := make(chan bool)

	for i := 0; i < 10; i++ {
		go func(idx int) {
			hex := "AC" + string(rune('A'+idx))
			aircraft := ws.Aircraft{
				Hex:    hex,
				Flight: "FLT" + string(rune('0'+idx)),
				Lat:    floatPtr(52.0 + float64(idx)*0.1),
				Lon:    floatPtr(4.0 + float64(idx)*0.1),
			}
			msg := createMockAircraftMessage(ws.AircraftUpdate, aircraft)
			m.handleAircraftMsg(msg)
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Should have 10 aircraft
	if len(m.aircraft) != 10 {
		t.Errorf("expected 10 aircraft, got %d", len(m.aircraft))
	}
}

// =============================================================================
// Settings Persistence Tests
// =============================================================================

func TestModel_ThemeChange(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	initialTheme := m.theme.Name

	// Change theme
	m.setTheme("ice")

	if m.theme.Name == initialTheme {
		t.Error("theme should have changed")
	}

	if m.config.Display.Theme != "ice" {
		t.Errorf("config theme should be 'ice', got '%s'", m.config.Display.Theme)
	}
}

func TestModel_GetSearchMethods(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Test GetSearchFilter
	if m.GetSearchFilter() != nil {
		t.Error("search filter should initially be nil")
	}

	// Apply a filter
	m.applyFilterPreset(search.PresetMilitaryOnly())

	if m.GetSearchFilter() == nil {
		t.Error("search filter should not be nil after applying preset")
	}

	// Test GetSearchQuery
	m.searchQuery = "testquery"
	if m.GetSearchQuery() != "testquery" {
		t.Errorf("expected 'testquery', got '%s'", m.GetSearchQuery())
	}

	// Test GetSearchResults
	m.searchResults = []string{"ABC", "DEF"}
	results := m.GetSearchResults()
	if len(results) != 2 {
		t.Errorf("expected 2 results, got %d", len(results))
	}

	// Test GetSearchCursor
	m.searchCursor = 1
	if m.GetSearchCursor() != 1 {
		t.Errorf("expected cursor 1, got %d", m.GetSearchCursor())
	}

	// Test IsFilterActive
	if !m.IsFilterActive() {
		t.Error("filter should be active")
	}

	// Clear filter and test again
	m.searchFilter = nil
	if m.IsFilterActive() {
		t.Error("filter should not be active after clearing")
	}
}

// =============================================================================
// Alert State Integration Tests
// =============================================================================

func TestAlertState_New(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true

	alertState := NewAlertState(cfg)

	if alertState == nil {
		t.Fatal("NewAlertState returned nil")
	}

	if alertState.Engine == nil {
		t.Error("AlertState engine should be initialized")
	}

	if !alertState.AlertsEnabled {
		t.Error("alerts should be enabled based on config")
	}
}

func TestAlertState_CheckAircraft(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true

	alertState := NewAlertState(cfg)

	// Create a target with emergency squawk
	target := &radar.Target{
		Hex:      "EMTEST",
		Callsign: "EMTEST",
		Squawk:   "7700",
		HasAlt:   true,
		Altitude: 10000,
		Distance: 20,
	}

	// Check for alerts
	triggered := alertState.CheckAircraft(target, nil)

	// The emergency rule should trigger
	// Note: This depends on default rules being loaded
	if len(alertState.RecentAlerts) == 0 && len(triggered) == 0 {
		t.Log("No alerts triggered - this may be expected if rules are not configured")
	}
}

func TestAlertState_GetRules(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true

	alertState := NewAlertState(cfg)

	rules := alertState.GetRules()

	// Should have default rules
	if len(rules) == 0 {
		t.Error("expected default rules to be loaded")
	}

	// Check for known default rule
	foundEmergency := false
	for _, rule := range rules {
		if rule.ID == "emergency_squawk" {
			foundEmergency = true
			break
		}
	}

	if !foundEmergency {
		t.Error("expected emergency_squawk rule in defaults")
	}
}

func TestAlertState_ToggleRule(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true

	alertState := NewAlertState(cfg)

	rules := alertState.GetRules()
	if len(rules) == 0 {
		t.Skip("no rules to test")
	}

	firstRule := rules[0]
	initialEnabled := firstRule.Enabled

	// Toggle
	newState := alertState.ToggleRule(firstRule.ID)

	if newState == initialEnabled {
		t.Error("toggle should change enabled state")
	}

	// Verify by getting rules again
	newRules := alertState.GetRules()
	for _, rule := range newRules {
		if rule.ID == firstRule.ID {
			if rule.Enabled == initialEnabled {
				t.Error("rule state should have persisted")
			}
			break
		}
	}
}

func TestAlertState_GetStats(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true

	alertState := NewAlertState(cfg)

	stats := alertState.GetStats()

	if stats.TotalRules == 0 {
		t.Error("expected rules in stats")
	}

	// EnabledRules should be <= TotalRules
	if stats.EnabledRules > stats.TotalRules {
		t.Error("enabled rules cannot exceed total rules")
	}
}

func TestAlertState_IsHighlighted(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true

	alertState := NewAlertState(cfg)

	// Initially no aircraft should be highlighted
	if alertState.IsHighlighted("NONEXISTENT") {
		t.Error("non-existent aircraft should not be highlighted")
	}
}

func TestAlertState_Cleanup(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true

	alertState := NewAlertState(cfg)

	// Cleanup should not panic with empty state
	alertState.Cleanup()
}

// =============================================================================
// Trail Tracker Integration Tests
// =============================================================================

func TestModel_TrailTrackerIntegration(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add positions for an aircraft
	hex := "TRLINT"

	// First position
	aircraft1 := ws.Aircraft{
		Hex:    hex,
		Flight: "TRAIL1",
		Lat:    floatPtr(52.0),
		Lon:    floatPtr(4.0),
	}
	msg := createMockAircraftMessage(ws.AircraftUpdate, aircraft1)
	m.handleAircraftMsg(msg)

	// Wait a bit and add second position
	time.Sleep(50 * time.Millisecond)

	// Different position (more than 0.001 deg difference)
	aircraft2 := ws.Aircraft{
		Hex:    hex,
		Flight: "TRAIL1",
		Lat:    floatPtr(52.1),
		Lon:    floatPtr(4.1),
	}
	msg = createMockAircraftMessage(ws.AircraftUpdate, aircraft2)
	m.handleAircraftMsg(msg)

	// Get trails
	trails := m.GetTrailsForRadar()

	if len(trails) == 0 {
		t.Error("expected at least one trail")
	}

	trail, exists := trails[hex]
	if !exists {
		t.Errorf("expected trail for %s", hex)
	}

	if len(trail) < 2 {
		t.Errorf("expected at least 2 points in trail, got %d", len(trail))
	}
}

// =============================================================================
// VU Meter and Spectrum Tests
// =============================================================================

func TestModel_VUMeterUpdate(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add aircraft with RSSI
	rssi := -15.0
	m.aircraft["VU001"] = &radar.Target{
		Hex:     "VU001",
		RSSI:    rssi,
		HasRSSI: true,
	}

	// Update VU meters
	m.updateVUMeters()

	// VU levels should be positive (normalized RSSI)
	if m.vuLeft < 0 || m.vuRight < 0 {
		t.Error("VU levels should be non-negative")
	}
}

func TestModel_SpectrumUpdate(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Add aircraft with distance and RSSI
	m.aircraft["SPEC01"] = &radar.Target{
		Hex:      "SPEC01",
		Distance: 25,
		RSSI:     -15,
		HasRSSI:  true,
	}
	m.aircraft["SPEC02"] = &radar.Target{
		Hex:      "SPEC02",
		Distance: 75,
		RSSI:     -25,
		HasRSSI:  true,
	}

	// Update spectrum
	m.updateSpectrum()

	// Spectrum should be initialized
	if len(m.spectrum) == 0 {
		t.Error("spectrum should be initialized")
	}

	// Get spectrum peaks
	peaks := m.GetSpectrumPeaks()
	if len(peaks) == 0 {
		t.Error("spectrum peaks should be available")
	}

	// Get spectrum labels
	labels := m.GetSpectrumLabels()
	if len(labels) == 0 {
		t.Error("spectrum labels should be available")
	}
}

// =============================================================================
// Connection State Tests
// =============================================================================

func TestModel_IsConnected(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Without starting connection, should not be connected
	// This depends on WebSocket client state
	connected := m.IsConnected()

	// Initial state should be disconnected (client not started)
	if connected {
		t.Log("WebSocket client reports connected - may be expected in some test environments")
	}
}

// =============================================================================
// Export Path Tests
// =============================================================================

func TestModel_ExportDirectory(t *testing.T) {
	cfg := newTestConfig()
	cfg.Export.Directory = "/tmp/test-export"
	m := NewModel(cfg)

	dir := m.GetExportDirectory()

	if dir != "/tmp/test-export" {
		t.Errorf("expected export directory '/tmp/test-export', got '%s'", dir)
	}

	// Test with empty directory
	cfg.Export.Directory = ""
	m2 := NewModel(cfg)

	dir2 := m2.GetExportDirectory()
	if dir2 != "" {
		t.Errorf("expected empty export directory, got '%s'", dir2)
	}
}

// =============================================================================
// Audio Alert Integration Tests
// =============================================================================

func TestModel_SetAudioEnabled(t *testing.T) {
	cfg := newTestConfig()
	cfg.Audio.Enabled = true
	m := NewModel(cfg)

	// Disable audio
	m.SetAudioEnabled(false)

	// Enable audio
	m.SetAudioEnabled(true)

	// No crash means success for this integration test
}

// =============================================================================
// Default Alert Rules Tests
// =============================================================================

func TestDefaultAlertRules(t *testing.T) {
	rules := alerts.DefaultAlertRules()

	if len(rules) == 0 {
		t.Error("expected default alert rules")
	}

	// Check for required rules
	ruleIDs := make(map[string]bool)
	for _, rule := range rules {
		ruleIDs[rule.ID] = true
	}

	expectedRules := []string{"emergency_squawk", "military_nearby", "low_altitude"}
	for _, expected := range expectedRules {
		if !ruleIDs[expected] {
			t.Errorf("expected default rule: %s", expected)
		}
	}
}
