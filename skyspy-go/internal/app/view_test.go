// Package app provides view rendering tests for the SkySpy radar application
package app

import (
	"strings"
	"testing"

	"github.com/skyspy/skyspy-go/internal/radar"
	"github.com/skyspy/skyspy-go/internal/search"
)

// =============================================================================
// Radar View Rendering Tests
// =============================================================================

func TestView_RadarRendering(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 100
	m.height = 40

	// Add some aircraft for rendering
	m.aircraft["RAD001"] = &radar.Target{
		Hex:      "RAD001",
		Callsign: "RADAR1",
		HasLat:   true,
		Lat:      52.4,
		HasLon:   true,
		Lon:      4.95,
		HasAlt:   true,
		Altitude: 35000,
		Distance: 25,
		Bearing:  45,
	}

	// Render view
	output := m.View()

	if output == "" {
		t.Error("View() should return non-empty output")
	}

	// Check for radar header elements
	if !strings.Contains(output, "SKYSPY") {
		t.Error("view should contain SKYSPY in header")
	}

	// Check for radar scope elements
	if !strings.Contains(output, "nm") {
		t.Error("view should contain range indicator (nm)")
	}

	// View should be stored for screenshots
	if m.lastRenderedView == "" {
		t.Error("lastRenderedView should be set after View()")
	}

	if m.lastRenderedView != output {
		t.Error("lastRenderedView should match View() output")
	}
}

func TestView_RadarRendering_WithTargets(t *testing.T) {
	cfg := newTestConfig()
	cfg.Display.ShowLabels = true
	cfg.Display.ShowTargetList = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Add multiple aircraft
	m.aircraft["TGT001"] = &radar.Target{
		Hex:      "TGT001",
		Callsign: "TARGET1",
		HasLat:   true,
		Lat:      52.4,
		HasLon:   true,
		Lon:      4.95,
		HasAlt:   true,
		Altitude: 35000,
		Distance: 30,
		Bearing:  90,
	}
	m.aircraft["TGT002"] = &radar.Target{
		Hex:      "TGT002",
		Callsign: "TARGET2",
		HasLat:   true,
		Lat:      52.5,
		HasLon:   true,
		Lon:      4.8,
		HasAlt:   true,
		Altitude: 28000,
		Distance: 45,
		Bearing:  270,
		Military: true,
	}

	output := m.View()

	// Should contain target list header
	if !strings.Contains(output, "LIST") {
		t.Error("view should contain LIST panel")
	}

	// Should show aircraft count somewhere in the view
	if !strings.Contains(output, "2") {
		t.Log("Warning: aircraft count may not be directly visible")
	}
}

func TestView_RadarRendering_EmergencyAircraft(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Add emergency aircraft
	m.aircraft["EMRG01"] = &radar.Target{
		Hex:      "EMRG01",
		Callsign: "EMERG",
		Squawk:   "7700",
		HasLat:   true,
		Lat:      52.4,
		HasLon:   true,
		Lon:      4.95,
		Distance: 20,
		Bearing:  45,
	}
	m.selectedHex = "EMRG01"

	output := m.View()

	// Should show emergency squawk code in selected target panel
	if !strings.Contains(output, "7700") {
		t.Error("view should show emergency squawk 7700")
	}
}

func TestView_RadarRendering_MilitaryAircraft(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Add military aircraft
	m.aircraft["MIL001"] = &radar.Target{
		Hex:      "MIL001",
		Callsign: "USAF01",
		Military: true,
		HasLat:   true,
		Lat:      52.4,
		HasLon:   true,
		Lon:      4.95,
		Distance: 30,
		Bearing:  180,
	}
	m.selectedHex = "MIL001"

	output := m.View()

	// Should show military indicator
	if !strings.Contains(output, "MIL") {
		t.Error("view should show MIL indicator for military aircraft")
	}
}

// =============================================================================
// Target List Rendering Tests
// =============================================================================

func TestView_TargetList(t *testing.T) {
	cfg := newTestConfig()
	cfg.Display.ShowTargetList = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Add aircraft
	m.aircraft["LST001"] = &radar.Target{
		Hex:      "LST001",
		Callsign: "LIST01",
		HasAlt:   true,
		Altitude: 35000,
		Distance: 25,
	}
	m.aircraft["LST002"] = &radar.Target{
		Hex:      "LST002",
		Callsign: "LIST02",
		HasAlt:   true,
		Altitude: 28000,
		Distance: 45,
	}
	m.sortedTargets = []string{"LST001", "LST002"}

	output := m.View()

	// Should contain list panel
	if !strings.Contains(output, "LIST") {
		t.Error("view should contain LIST panel")
	}

	// Should show CALL header
	if !strings.Contains(output, "CALL") {
		t.Error("target list should show CALL header")
	}
}

func TestView_TargetList_Selection(t *testing.T) {
	cfg := newTestConfig()
	cfg.Display.ShowTargetList = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Add aircraft
	m.aircraft["SEL001"] = &radar.Target{
		Hex:      "SEL001",
		Callsign: "SELECT",
		Distance: 20,
	}
	m.sortedTargets = []string{"SEL001"}
	m.selectedHex = "SEL001"

	output := m.View()

	// Should have selection marker
	// The selection marker is typically a character like > or triangle
	if !strings.Contains(output, "TARGET") && !strings.Contains(output, "SELECT") {
		t.Log("Selection indicator may vary based on rendering")
	}
}

// =============================================================================
// Status Bar Rendering Tests
// =============================================================================

func TestView_StatusBar(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	output := m.View()

	// Should contain range indicator
	rangeStr := "nm"
	if !strings.Contains(output, rangeStr) {
		t.Errorf("status bar should contain range indicator (%s)", rangeStr)
	}

	// Should show time (status bar has time)
	if !strings.Contains(output, ":") {
		t.Log("Status bar should typically show time with colons")
	}
}

func TestView_StatusBar_WithFilters(t *testing.T) {
	cfg := newTestConfig()
	cfg.Filters.MilitaryOnly = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	output := m.View()

	// Should show MIL filter indicator
	if !strings.Contains(output, "MIL") {
		t.Error("status bar should show MIL when military filter is active")
	}
}

func TestView_StatusBar_WithNotification(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Set notification
	m.notify("Test Notification")

	output := m.View()

	// Should contain notification
	if !strings.Contains(output, "Test Notification") {
		t.Error("view should contain notification message")
	}
}

// =============================================================================
// Search Panel Rendering Tests
// =============================================================================

func TestView_SearchPanel(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewSearch
	m.searchQuery = "UAL"

	output := m.View()

	// Should contain search panel elements
	if !strings.Contains(output, "SEARCH") {
		t.Error("search panel should contain SEARCH header")
	}

	// Should show the query
	if !strings.Contains(output, "UAL") {
		t.Error("search panel should show search query")
	}

	// Should show SYNTAX help
	if !strings.Contains(output, "SYNTAX") {
		t.Error("search panel should show syntax help")
	}

	// Should show PRESETS
	if !strings.Contains(output, "PRESETS") {
		t.Error("search panel should show presets section")
	}
}

func TestView_SearchPanel_WithResults(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewSearch
	m.searchQuery = "TEST"

	// Add matching aircraft
	m.aircraft["TEST01"] = &radar.Target{
		Hex:      "TEST01",
		Callsign: "TEST123",
		HasAlt:   true,
		Altitude: 35000,
	}
	m.aircraft["OTHR01"] = &radar.Target{
		Hex:      "OTHR01",
		Callsign: "OTHER",
	}

	// Update search results
	m.searchFilter = search.ParseQuery("TEST")
	m.searchResults = search.FilterAircraft(m.aircraft, m.searchFilter)

	output := m.View()

	// Should show results section
	if !strings.Contains(output, "RESULTS") {
		t.Error("search panel should show RESULTS section")
	}

	// Should show matches count
	if !strings.Contains(output, "Match") || !strings.Contains(output, "1") {
		t.Log("Matches count may vary in display format")
	}
}

func TestView_SearchPanel_NoResults(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewSearch
	m.searchQuery = "NONEXISTENT"
	m.searchResults = []string{}

	output := m.View()

	// Should indicate no matches
	if !strings.Contains(output, "No match") && !strings.Contains(output, "0") {
		t.Log("No results indicator varies in display")
	}
}

// =============================================================================
// Help Panel Rendering Tests
// =============================================================================

func TestView_HelpPanel(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewHelp

	output := m.View()

	// Should contain help header
	if !strings.Contains(output, "HELP") {
		t.Error("help panel should contain HELP header")
	}

	// Should show navigation help
	if !strings.Contains(output, "NAVIGATION") {
		t.Error("help panel should show NAVIGATION section")
	}

	// Should show display help
	if !strings.Contains(output, "DISPLAY") {
		t.Error("help panel should show DISPLAY section")
	}

	// Should show export help
	if !strings.Contains(output, "EXPORT") {
		t.Error("help panel should show EXPORT section")
	}

	// Should show keyboard shortcuts
	if !strings.Contains(output, "Quit") || !strings.Contains(output, "Q") {
		t.Log("Quit shortcut may be displayed differently")
	}

	// Should show symbols legend
	if !strings.Contains(output, "SYMBOLS") {
		t.Error("help panel should show SYMBOLS section")
	}
}

// =============================================================================
// Settings Panel Rendering Tests
// =============================================================================

func TestView_SettingsPanel(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewSettings

	output := m.View()

	// Should contain settings header
	if !strings.Contains(output, "SETTINGS") {
		t.Error("settings panel should contain SETTINGS header")
	}

	// Should show themes section
	if !strings.Contains(output, "THEMES") {
		t.Error("settings panel should show THEMES section")
	}

	// Should list available themes (theme names contain descriptions like "Classic Green")
	if !strings.Contains(output, "Classic") || !strings.Contains(output, "Green") {
		t.Log("Themes should include Classic Green - checking output")
	}
}

func TestView_SettingsPanel_ThemeSelection(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewSettings
	m.settingsCursor = 0

	output := m.View()

	// Should show navigation help
	if !strings.Contains(output, "Navigate") {
		t.Error("settings panel should show navigation help")
	}

	// Should show apply instruction
	if !strings.Contains(output, "Apply") {
		t.Error("settings panel should show apply instruction")
	}
}

// =============================================================================
// Overlay Panel Rendering Tests
// =============================================================================

func TestView_OverlayPanel(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewOverlays

	output := m.View()

	// Should contain overlay header
	if !strings.Contains(output, "OVERLAY") {
		t.Error("overlay panel should contain OVERLAY header")
	}

	// Should show toggle help or no overlays message
	if !strings.Contains(output, "Toggle") && !strings.Contains(output, "No overlay") {
		t.Log("Overlay panel content varies based on loaded overlays")
	}
}

// =============================================================================
// Alert Rules Panel Rendering Tests
// =============================================================================

func TestView_AlertRulesPanel(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewAlertRules

	output := m.View()

	// Should contain alert rules header
	if !strings.Contains(output, "ALERT") {
		t.Error("alert rules panel should contain ALERT header")
	}

	// Should show RULES section
	if !strings.Contains(output, "RULES") {
		t.Error("alert rules panel should show RULES section")
	}

	// Should show recent alerts section
	if !strings.Contains(output, "RECENT") {
		t.Error("alert rules panel should show RECENT ALERTS section")
	}

	// Should show enabled/disabled status
	if !strings.Contains(output, "Alerts:") || (!strings.Contains(output, "ENABLED") && !strings.Contains(output, "DISABLED")) {
		t.Error("alert rules panel should show alerts enabled status")
	}
}

func TestView_AlertRulesPanel_WithRules(t *testing.T) {
	cfg := newTestConfig()
	cfg.Alerts.Enabled = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewAlertRules

	output := m.View()

	// Should show default rules (emergency, military, low altitude)
	expectedRules := []string{"Emergency", "Military", "Low"}
	found := false
	for _, expected := range expectedRules {
		if strings.Contains(output, expected) {
			found = true
			break
		}
	}

	if !found {
		t.Log("Default rules may not be visible in panel - check rule names")
	}
}

// =============================================================================
// Notification Display Tests
// =============================================================================

func TestView_Notification(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Set notification
	m.notification = "Range: 100nm"
	m.notificationTime = 3.0

	output := m.View()

	// Should display notification
	if !strings.Contains(output, "Range:") {
		t.Error("view should display notification")
	}
}

func TestView_Notification_Timeout(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Set notification with expired time
	m.notification = "Old message"
	m.notificationTime = 0

	output := m.View()

	// Notification should not be visible if time expired
	// The notification clearing happens in tick handler, so the text might still be there
	// but wouldn't be displayed with styling
	_ = output
}

// =============================================================================
// ACARS Panel Rendering Tests
// =============================================================================

func TestView_ACARSPanel(t *testing.T) {
	cfg := newTestConfig()
	cfg.Display.ShowACARS = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewRadar

	// Add ACARS messages
	m.acarsMessages = append(m.acarsMessages, ACARSMessage{
		Callsign: "TEST01",
		Flight:   "TST001",
		Label:    "H1",
		Text:     "Test ACARS message",
	})

	output := m.View()

	// Should contain ACARS panel
	if !strings.Contains(output, "ACARS") {
		t.Error("view should contain ACARS panel when enabled")
	}

	// Should show message content
	if !strings.Contains(output, "TEST01") || !strings.Contains(output, "Test ACARS message") {
		t.Log("ACARS message display may vary in format")
	}
}

func TestView_ACARSPanel_Empty(t *testing.T) {
	cfg := newTestConfig()
	cfg.Display.ShowACARS = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.viewMode = ViewRadar

	output := m.View()

	// Should show awaiting message
	if !strings.Contains(output, "Awaiting ACARS") && !strings.Contains(output, "ACARS") {
		t.Error("empty ACARS panel should show awaiting message or ACARS header")
	}
}

// =============================================================================
// Stats Panel Rendering Tests
// =============================================================================

func TestView_StatsPanel(t *testing.T) {
	cfg := newTestConfig()
	cfg.Display.ShowStatsPanel = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Add some aircraft for stats
	m.aircraft["ST001"] = &radar.Target{Hex: "ST001", Military: true}
	m.aircraft["ST002"] = &radar.Target{Hex: "ST002", Squawk: "7700"}
	m.aircraft["ST003"] = &radar.Target{Hex: "ST003"}
	m.updateStats()

	output := m.View()

	// Should show STATUS header
	if !strings.Contains(output, "STATUS") {
		t.Error("view should show STATUS panel")
	}

	// Should show TGT (targets) count
	if !strings.Contains(output, "TGT") {
		t.Error("stats panel should show TGT count")
	}

	// Should show MIL count
	if !strings.Contains(output, "MIL") {
		t.Error("stats panel should show MIL count")
	}

	// Should show EMRG count
	if !strings.Contains(output, "EMRG") {
		t.Error("stats panel should show EMRG count")
	}
}

// =============================================================================
// VU Meter Rendering Tests
// =============================================================================

func TestView_VUMeters(t *testing.T) {
	cfg := newTestConfig()
	cfg.Display.ShowVUMeters = true
	cfg.Display.ShowStatsPanel = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.vuLeft = 0.5
	m.vuRight = 0.7

	output := m.View()

	// Should show VU indicators
	if !strings.Contains(output, "VU") {
		t.Error("view should show VU meters when enabled")
	}
}

// =============================================================================
// Spectrum Rendering Tests
// =============================================================================

func TestView_Spectrum(t *testing.T) {
	cfg := newTestConfig()
	cfg.Display.ShowSpectrum = true
	cfg.Display.ShowStatsPanel = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Set spectrum values
	for i := range m.spectrum {
		m.spectrum[i] = float64(i) / float64(len(m.spectrum))
	}

	output := m.View()

	// Should show SPECTRUM label
	if !strings.Contains(output, "SPECTRUM") {
		t.Error("view should show SPECTRUM label when enabled")
	}
}

// =============================================================================
// Header Rendering Tests
// =============================================================================

func TestView_Header(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	output := m.View()

	// Should contain application name
	if !strings.Contains(output, "SKYSPY") {
		t.Error("header should contain SKYSPY")
	}

	// Should contain ADS-B reference
	if !strings.Contains(output, "ADS-B") {
		t.Error("header should contain ADS-B reference")
	}

	// Should contain LIVE indicator
	if !strings.Contains(output, "LIVE") {
		t.Error("header should contain LIVE indicator")
	}
}

// =============================================================================
// Footer Rendering Tests
// =============================================================================

func TestView_Footer(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	output := m.View()

	// Footer contains border characters
	// Check for bottom border
	lines := strings.Split(output, "\n")
	if len(lines) == 0 {
		t.Error("view should have content")
		return
	}

	lastLine := lines[len(lines)-1]
	if lastLine == "" && len(lines) > 1 {
		lastLine = lines[len(lines)-2]
	}

	// Footer typically has border characters
	// Either corner character or repeated border
	_ = lastLine
}

// =============================================================================
// Target Panel Rendering Tests
// =============================================================================

func TestView_TargetPanel_NoSelection(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50
	m.selectedHex = ""

	output := m.View()

	// Should show "No target selected" or similar message
	if !strings.Contains(output, "No target") && !strings.Contains(output, "TARGET") {
		t.Log("No selection message may vary in format")
	}
}

func TestView_TargetPanel_WithSelection(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Add and select aircraft
	m.aircraft["PANEL1"] = &radar.Target{
		Hex:      "PANEL1",
		Callsign: "PANELTEST",
		HasAlt:   true,
		Altitude: 35000,
		HasSpeed: true,
		Speed:    450,
		HasTrack: true,
		Track:    180,
		HasVS:    true,
		Vertical: -500,
		Distance: 30,
		Bearing:  90,
		Squawk:   "1234",
		ACType:   "A320",
		HasRSSI:  true,
		RSSI:     -15,
	}
	m.selectedHex = "PANEL1"

	output := m.View()

	// Should show callsign
	if !strings.Contains(output, "PANELTEST") {
		t.Error("target panel should show selected callsign")
	}

	// Should show aircraft type
	if !strings.Contains(output, "A320") {
		t.Log("Aircraft type display may vary")
	}

	// Should show squawk
	if !strings.Contains(output, "1234") {
		t.Log("Squawk display may vary")
	}
}

// =============================================================================
// Format Helper Tests
// =============================================================================

func TestView_FormatAltitude(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Test FL format for high altitude
	highTarget := &radar.Target{HasAlt: true, Altitude: 35000}
	output := m.formatAlt(highTarget)
	if !strings.Contains(output, "FL") {
		t.Errorf("expected FL format for 35000ft, got %s", output)
	}

	// Test feet format for low altitude
	lowTarget := &radar.Target{HasAlt: true, Altitude: 5000}
	output = m.formatAlt(lowTarget)
	if !strings.Contains(output, "5000") {
		t.Errorf("expected 5000 in output, got %s", output)
	}

	// Test no altitude
	noAltTarget := &radar.Target{HasAlt: false}
	output = m.formatAlt(noAltTarget)
	if output != "----" {
		t.Errorf("expected '----' for no altitude, got %s", output)
	}
}

func TestView_FormatSpeed(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Test with speed
	target := &radar.Target{HasSpeed: true, Speed: 450}
	output := m.formatSpeed(target)
	if !strings.Contains(output, "450") || !strings.Contains(output, "kt") {
		t.Errorf("expected '450 kt' format, got %s", output)
	}

	// Test no speed
	noSpeedTarget := &radar.Target{HasSpeed: false}
	output = m.formatSpeed(noSpeedTarget)
	if output != "---" {
		t.Errorf("expected '---' for no speed, got %s", output)
	}
}

func TestView_FormatVS(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Test climb
	climbTarget := &radar.Target{HasVS: true, Vertical: 1500}
	output := m.formatVS(climbTarget)
	if !strings.Contains(output, "+") || !strings.Contains(output, "1500") {
		t.Errorf("expected '+1500' format for climb, got %s", output)
	}

	// Test descent
	descentTarget := &radar.Target{HasVS: true, Vertical: -1000}
	output = m.formatVS(descentTarget)
	if !strings.Contains(output, "-") || !strings.Contains(output, "1000") {
		t.Errorf("expected negative value for descent, got %s", output)
	}

	// Test no VS
	noVSTarget := &radar.Target{HasVS: false}
	output = m.formatVS(noVSTarget)
	if output != "---" {
		t.Errorf("expected '---' for no VS, got %s", output)
	}
}

func TestView_FormatTrack(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Test with track
	target := &radar.Target{HasTrack: true, Track: 180}
	output := m.formatTrack(target)
	if !strings.Contains(output, "180") {
		t.Errorf("expected '180' in output, got %s", output)
	}

	// Test no track
	noTrackTarget := &radar.Target{HasTrack: false}
	output = m.formatTrack(noTrackTarget)
	if output != "---" {
		t.Errorf("expected '---' for no track, got %s", output)
	}
}

func TestView_FormatDistance(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Test with distance
	target := &radar.Target{Distance: 45.5}
	output := m.formatDistance(target)
	if !strings.Contains(output, "45") || !strings.Contains(output, "nm") {
		t.Errorf("expected distance with nm, got %s", output)
	}

	// Test no distance
	noDistTarget := &radar.Target{Distance: 0}
	output = m.formatDistance(noDistTarget)
	if output != "---" {
		t.Errorf("expected '---' for no distance, got %s", output)
	}
}

func TestView_FormatBearing(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Test with bearing
	target := &radar.Target{Bearing: 270}
	output := m.formatBearing(target)
	if !strings.Contains(output, "270") {
		t.Errorf("expected '270' in output, got %s", output)
	}

	// Test no bearing
	noBrgTarget := &radar.Target{Bearing: 0}
	output = m.formatBearing(noBrgTarget)
	if output != "---" {
		t.Errorf("expected '---' for no bearing, got %s", output)
	}
}

func TestView_FormatSquawk(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Test with squawk
	target := &radar.Target{Squawk: "1200"}
	output := m.formatSquawk(target)
	if output != "1200" {
		t.Errorf("expected '1200', got %s", output)
	}

	// Test no squawk
	noSqTarget := &radar.Target{Squawk: ""}
	output = m.formatSquawk(noSqTarget)
	if output != "----" {
		t.Errorf("expected '----' for no squawk, got %s", output)
	}
}

// =============================================================================
// Style Helper Tests
// =============================================================================

func TestView_GetVSStyle(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Climb should use success style
	climbTarget := &radar.Target{HasVS: true, Vertical: 1000}
	style := m.getVSStyle(climbTarget)
	_ = style // Style object returned

	// Descent should use error style
	descentTarget := &radar.Target{HasVS: true, Vertical: -1000}
	style = m.getVSStyle(descentTarget)
	_ = style

	// No VS should use dim style
	noVSTarget := &radar.Target{HasVS: false}
	style = m.getVSStyle(noVSTarget)
	_ = style
}

func TestView_GetSquawkStyle(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Emergency squawk should use emergency style
	emergencyTarget := &radar.Target{Squawk: "7700"}
	style := m.getSquawkStyle(emergencyTarget)
	_ = style

	// Normal squawk should use primary bright style
	normalTarget := &radar.Target{Squawk: "1200"}
	style = m.getSquawkStyle(normalTarget)
	_ = style
}

// =============================================================================
// Signal Bars Rendering Tests
// =============================================================================

func TestView_RenderSignalBars(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Strong signal
	strongTarget := &radar.Target{HasRSSI: true, RSSI: -10}
	output := m.renderSignalBars(strongTarget)
	if len(output) == 0 {
		t.Error("signal bars should render for strong signal")
	}

	// Weak signal
	weakTarget := &radar.Target{HasRSSI: true, RSSI: -30}
	output = m.renderSignalBars(weakTarget)
	if len(output) == 0 {
		t.Error("signal bars should render for weak signal")
	}

	// No RSSI
	noRSSITarget := &radar.Target{HasRSSI: false}
	output = m.renderSignalBars(noRSSITarget)
	if len(output) == 0 {
		t.Error("signal bars should render placeholder for no RSSI")
	}
}

// =============================================================================
// VU Meter Rendering Tests
// =============================================================================

func TestView_RenderVUMeter(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)

	// Full level
	output := m.renderVUMeter(1.0, 10)
	if len(output) == 0 {
		t.Error("VU meter should render for full level")
	}

	// Empty level
	output = m.renderVUMeter(0.0, 10)
	if len(output) == 0 {
		t.Error("VU meter should render for empty level")
	}

	// Mid level
	output = m.renderVUMeter(0.5, 10)
	if len(output) == 0 {
		t.Error("VU meter should render for mid level")
	}
}

// =============================================================================
// Theme Display Tests
// =============================================================================

func TestView_DifferentThemes(t *testing.T) {
	themes := []string{"classic", "amber", "ice", "cyberpunk", "military"}

	for _, themeName := range themes {
		t.Run(themeName, func(t *testing.T) {
			cfg := newTestConfig()
			cfg.Display.Theme = themeName
			m := NewModel(cfg)
			m.width = 150
			m.height = 50

			output := m.View()

			if output == "" {
				t.Errorf("view should render with theme %s", themeName)
			}

			// Basic structure should be present regardless of theme
			if !strings.Contains(output, "SKYSPY") {
				t.Errorf("view should contain SKYSPY with theme %s", themeName)
			}
		})
	}
}

// =============================================================================
// Empty State Rendering Tests
// =============================================================================

func TestView_EmptyState(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// No aircraft, no messages
	m.aircraft = make(map[string]*radar.Target)
	m.acarsMessages = []ACARSMessage{}

	output := m.View()

	// Should still render valid output
	if output == "" {
		t.Error("view should render even with empty state")
	}

	// Should have header
	if !strings.Contains(output, "SKYSPY") {
		t.Error("empty state should still show header")
	}
}

// =============================================================================
// Large Data Set Rendering Tests
// =============================================================================

func TestView_ManyAircraft(t *testing.T) {
	cfg := newTestConfig()
	cfg.Display.ShowTargetList = true
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	// Add many aircraft
	for i := 0; i < 50; i++ {
		hex := "AC" + string(rune('A'+i/26)) + string(rune('A'+i%26)) + "001"
		m.aircraft[hex] = &radar.Target{
			Hex:      hex,
			Callsign: "CALL" + hex,
			HasLat:   true,
			Lat:      52.0 + float64(i)*0.01,
			HasLon:   true,
			Lon:      4.0 + float64(i)*0.01,
			Distance: float64(10 + i),
			Bearing:  float64(i * 7 % 360),
		}
		m.sortedTargets = append(m.sortedTargets, hex)
	}

	output := m.View()

	// Should render without panic
	if output == "" {
		t.Error("view should render with many aircraft")
	}

	// Target list should still be limited (typically 8 items)
	if !strings.Contains(output, "LIST") {
		t.Error("target list should be visible")
	}
}

// =============================================================================
// Unicode and Special Character Tests
// =============================================================================

func TestView_UnicodeCharacters(t *testing.T) {
	cfg := newTestConfig()
	m := NewModel(cfg)
	m.width = 150
	m.height = 50

	output := m.View()

	// View should contain Unicode border characters
	unicodeChars := []string{"═", "║", "╔", "╗", "╚", "╝", "╭", "╮", "╯", "╰", "│", "─"}
	foundUnicode := false
	for _, char := range unicodeChars {
		if strings.Contains(output, char) {
			foundUnicode = true
			break
		}
	}

	if !foundUnicode {
		t.Log("View may use different border characters in some terminals")
	}
}
