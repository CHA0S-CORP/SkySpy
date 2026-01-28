package radio

import (
	"encoding/json"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/ws"
)

func TestAircraftIsEmergency(t *testing.T) {
	tests := []struct {
		name     string
		squawk   string
		expected bool
	}{
		{"squawk 7500 (hijack)", "7500", true},
		{"squawk 7600 (comms failure)", "7600", true},
		{"squawk 7700 (emergency)", "7700", true},
		{"normal squawk 1200", "1200", false},
		{"empty squawk", "", false},
		{"normal squawk 4321", "4321", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ac := &Aircraft{Squawk: tt.squawk}
			if got := ac.IsEmergency(); got != tt.expected {
				t.Errorf("IsEmergency() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestNewModel(t *testing.T) {
	cfg := config.DefaultConfig()

	// Test basic mode
	t.Run("basic mode", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		if m == nil {
			t.Fatal("NewModel returned nil")
		}
		if m.Mode != ModeBasic {
			t.Errorf("Mode = %v, want %v", m.Mode, ModeBasic)
		}
		if m.Aircraft == nil {
			t.Error("Aircraft map is nil")
		}
		if m.ACARSMessages == nil {
			t.Error("ACARSMessages slice is nil")
		}
		if m.SortedHexes == nil {
			t.Error("SortedHexes slice is nil")
		}
		if m.Spectrum == nil {
			t.Error("Spectrum is nil")
		}
		if m.Waterfall == nil {
			t.Error("Waterfall is nil")
		}
		if m.FreqDisp == nil {
			t.Error("FreqDisp is nil")
		}
		if m.Config == nil {
			t.Error("Config is nil")
		}
		if m.Theme == nil {
			t.Error("Theme is nil")
		}
		if m.WSClient == nil {
			t.Error("WSClient is nil")
		}
		if len(m.Spinners) != 4 {
			t.Errorf("Spinners length = %d, want 4", len(m.Spinners))
		}
	})

	// Test pro mode
	t.Run("pro mode", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		if m == nil {
			t.Fatal("NewModel returned nil")
		}
		if m.Mode != ModePro {
			t.Errorf("Mode = %v, want %v", m.Mode, ModePro)
		}
		// Pro mode should have wider spectrum
		if m.Spectrum.Width != 40 {
			t.Errorf("Spectrum Width = %d, want 40", m.Spectrum.Width)
		}
		if m.Spectrum.Height != 8 {
			t.Errorf("Spectrum Height = %d, want 8", m.Spectrum.Height)
		}
	})
}

func TestModelUpdateWindowSize(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	msg := tea.WindowSizeMsg{Width: 100, Height: 50}
	newModel, cmd := m.Update(msg)

	model := newModel.(*Model)
	if model.Width != 100 {
		t.Errorf("Width = %d, want 100", model.Width)
	}
	if model.Height != 50 {
		t.Errorf("Height = %d, want 50", model.Height)
	}
	if cmd != nil {
		t.Error("Expected nil cmd for WindowSizeMsg")
	}
}

func TestModelUpdateUnhandledMsg(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Custom unhandled message type
	type unknownMsg struct{}
	newModel, cmd := m.Update(unknownMsg{})

	if newModel != m {
		t.Error("Expected same model for unhandled message")
	}
	if cmd != nil {
		t.Error("Expected nil cmd for unhandled message")
	}
}

func TestHandleKey(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Display.Theme = "classic"

	tests := []struct {
		name       string
		key        string
		expectQuit bool
		checkScan  bool
		checkTheme bool
	}{
		{"quit with q", "q", true, false, false},
		{"quit with Q", "Q", true, false, false},
		{"quit with ctrl+c", "ctrl+c", true, false, false},
		{"toggle scan with s", "s", false, true, false},
		{"toggle scan with S", "S", false, true, false},
		{"cycle theme with t", "t", false, false, true},
		{"cycle theme with T", "T", false, false, true},
		{"unhandled key", "x", false, false, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := config.DefaultConfig()
			cfg.Display.Theme = "classic"
			m := NewModel(cfg, ModeBasic)
			initialScanMode := m.ScanMode
			initialTheme := m.Config.Display.Theme

			msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(tt.key)}
			if tt.key == "ctrl+c" {
				msg = tea.KeyMsg{Type: tea.KeyCtrlC}
			}

			_, cmd := m.handleKey(msg)

			if tt.expectQuit {
				// Check if cmd is tea.Quit
				if cmd == nil {
					t.Error("Expected quit command")
				}
			}

			if tt.checkScan {
				if m.ScanMode == initialScanMode {
					t.Error("Expected ScanMode to be toggled")
				}
			}

			if tt.checkTheme {
				if m.Config.Display.Theme == initialTheme {
					t.Error("Expected theme to change")
				}
			}
		})
	}
}

func TestHandleTick(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Add some aircraft to test activity-based VU meters
	m.Aircraft["ABC123"] = &Aircraft{Hex: "ABC123"}
	m.Aircraft["DEF456"] = &Aircraft{Hex: "DEF456"}

	initialBlink := m.Blink
	initialFrame := m.Frame

	_, cmd := m.handleTick()

	if m.Blink == initialBlink {
		t.Error("Expected Blink to toggle")
	}
	if m.Frame != initialFrame+1 {
		t.Errorf("Frame = %d, want %d", m.Frame, initialFrame+1)
	}
	if cmd == nil {
		t.Error("Expected tick cmd to be returned")
	}

	// Test peak aircraft update
	m.Aircraft["GHI789"] = &Aircraft{Hex: "GHI789"}
	m.PeakAircraft = 0
	m.handleTick()
	if m.PeakAircraft != 3 {
		t.Errorf("PeakAircraft = %d, want 3", m.PeakAircraft)
	}
}

func TestHandleTickProMode(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	// Test waterfall update in pro mode (only every 3rd frame)
	m.Frame = 0
	m.handleTick() // Frame becomes 1
	m.handleTick() // Frame becomes 2
	m.handleTick() // Frame becomes 3, waterfall should push
	// Just verify no panic occurs
}

func TestHandleTickScanMode(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)
	m.ScanMode = true

	initialScanPos := m.FreqDisp.ScanPos
	m.handleTick()

	// FreqDisp.Advance() should be called
	if m.FreqDisp.ScanPos == initialScanPos {
		t.Error("Expected FreqDisp to advance in scan mode")
	}
}

func TestHandleTickActivityCapping(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Add more than 30 aircraft to test capping
	for i := 0; i < 50; i++ {
		hex := "AC" + itoa(i)
		m.Aircraft[hex] = &Aircraft{Hex: hex}
	}

	m.handleTick()
	// Just verify no panic and VU meters are within bounds
	if m.VULeft < 0 || m.VULeft > 1 {
		t.Errorf("VULeft out of bounds: %f", m.VULeft)
	}
	if m.VURight < 0 || m.VURight > 1 {
		t.Errorf("VURight out of bounds: %f", m.VURight)
	}
}

func TestHandleAircraftMsg(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Test snapshot message
	t.Run("snapshot", func(t *testing.T) {
		snapshotData := map[string]interface{}{
			"aircraft": map[string]interface{}{
				"ABC123": map[string]interface{}{
					"hex":    "ABC123",
					"flight": "UAL123",
				},
				"DEF456": map[string]interface{}{
					"hex":    "DEF456",
					"flight": "DAL456",
				},
			},
		}
		data, _ := json.Marshal(snapshotData)
		msg := ws.Message{Type: string(ws.AircraftSnapshot), Data: data}
		m.handleAircraftMsg(msg)

		if len(m.Aircraft) != 2 {
			t.Errorf("Aircraft count = %d, want 2", len(m.Aircraft))
		}
	})

	// Test update message
	t.Run("update", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		updateData := map[string]interface{}{
			"hex":    "GHI789",
			"flight": "AAL789",
		}
		data, _ := json.Marshal(updateData)
		msg := ws.Message{Type: string(ws.AircraftUpdate), Data: data}
		m.handleAircraftMsg(msg)

		if len(m.Aircraft) != 1 {
			t.Errorf("Aircraft count = %d, want 1", len(m.Aircraft))
		}
		if m.TotalMessages != 1 {
			t.Errorf("TotalMessages = %d, want 1", m.TotalMessages)
		}
	})

	// Test new aircraft message
	t.Run("new", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		newData := map[string]interface{}{
			"hex":    "JKL012",
			"flight": "SWA012",
		}
		data, _ := json.Marshal(newData)
		msg := ws.Message{Type: string(ws.AircraftNew), Data: data}
		m.handleAircraftMsg(msg)

		if len(m.Aircraft) != 1 {
			t.Errorf("Aircraft count = %d, want 1", len(m.Aircraft))
		}
	})

	// Test remove message
	t.Run("remove", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["MNO345"] = &Aircraft{Hex: "MNO345"}

		removeData := map[string]interface{}{
			"hex": "MNO345",
		}
		data, _ := json.Marshal(removeData)
		msg := ws.Message{Type: string(ws.AircraftRemove), Data: data}
		m.handleAircraftMsg(msg)

		if len(m.Aircraft) != 0 {
			t.Errorf("Aircraft count = %d, want 0", len(m.Aircraft))
		}
	})

	// Test remove with empty hex
	t.Run("remove empty hex", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["PQR678"] = &Aircraft{Hex: "PQR678"}

		removeData := map[string]interface{}{
			"hex": "",
		}
		data, _ := json.Marshal(removeData)
		msg := ws.Message{Type: string(ws.AircraftRemove), Data: data}
		m.handleAircraftMsg(msg)

		if len(m.Aircraft) != 1 {
			t.Errorf("Aircraft count = %d, want 1 (should not remove)", len(m.Aircraft))
		}
	})

	// Test invalid snapshot data
	t.Run("invalid snapshot", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		msg := ws.Message{Type: string(ws.AircraftSnapshot), Data: []byte("invalid json")}
		m.handleAircraftMsg(msg)
		// Should not panic, just ignore invalid data
		if len(m.Aircraft) != 0 {
			t.Errorf("Aircraft count = %d, want 0", len(m.Aircraft))
		}
	})

	// Test invalid update data
	t.Run("invalid update", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		msg := ws.Message{Type: string(ws.AircraftUpdate), Data: []byte("invalid json")}
		m.handleAircraftMsg(msg)
		// Should not panic, just ignore invalid data
	})

	// Test invalid remove data
	t.Run("invalid remove", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["TEST"] = &Aircraft{Hex: "TEST"}
		msg := ws.Message{Type: string(ws.AircraftRemove), Data: []byte("invalid json")}
		m.handleAircraftMsg(msg)
		// Should not panic, aircraft should remain
		if len(m.Aircraft) != 1 {
			t.Errorf("Aircraft count = %d, want 1", len(m.Aircraft))
		}
	})
}

func TestUpdateAircraft(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Test full aircraft data
	altBaro := 35000
	alt := 34000
	gs := 450.5
	track := 180.0
	baroRate := 500.0
	vr := 480.0
	rssi := -5.5
	distance := 25.5

	ac := &ws.Aircraft{
		Hex:      "ABC123",
		Flight:   "  UAL123  ",
		Type:     "B738",
		Squawk:   "1200",
		Military: true,
		AltBaro:  &altBaro,
		GS:       &gs,
		Track:    &track,
		BaroRate: &baroRate,
		RSSI:     &rssi,
		Distance: &distance,
	}

	m.updateAircraft(ac)

	if len(m.Aircraft) != 1 {
		t.Errorf("Aircraft count = %d, want 1", len(m.Aircraft))
	}

	aircraft := m.Aircraft["ABC123"]
	if aircraft == nil {
		t.Fatal("Aircraft not found")
	}
	if aircraft.Callsign != "UAL123" {
		t.Errorf("Callsign = %q, want %q", aircraft.Callsign, "UAL123")
	}
	if aircraft.Altitude != 35000 {
		t.Errorf("Altitude = %d, want 35000", aircraft.Altitude)
	}
	if !aircraft.HasAlt {
		t.Error("Expected HasAlt to be true")
	}
	if aircraft.Speed != 450.5 {
		t.Errorf("Speed = %f, want 450.5", aircraft.Speed)
	}
	if !aircraft.HasSpeed {
		t.Error("Expected HasSpeed to be true")
	}
	if aircraft.Track != 180.0 {
		t.Errorf("Track = %f, want 180.0", aircraft.Track)
	}
	if !aircraft.HasTrack {
		t.Error("Expected HasTrack to be true")
	}
	if aircraft.Vertical != 500.0 {
		t.Errorf("Vertical = %f, want 500.0", aircraft.Vertical)
	}
	if !aircraft.HasVS {
		t.Error("Expected HasVS to be true")
	}
	if aircraft.RSSI != -5.5 {
		t.Errorf("RSSI = %f, want -5.5", aircraft.RSSI)
	}
	if !aircraft.HasRSSI {
		t.Error("Expected HasRSSI to be true")
	}
	if aircraft.Distance != 25.5 {
		t.Errorf("Distance = %f, want 25.5", aircraft.Distance)
	}
	if !aircraft.Military {
		t.Error("Expected Military to be true")
	}

	// Test with Alt instead of AltBaro
	t.Run("alt fallback", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		ac := &ws.Aircraft{
			Hex: "DEF456",
			Alt: &alt,
		}
		m.updateAircraft(ac)
		if m.Aircraft["DEF456"].Altitude != 34000 {
			t.Errorf("Altitude = %d, want 34000", m.Aircraft["DEF456"].Altitude)
		}
	})

	// Test with VR instead of BaroRate
	t.Run("vr fallback", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		ac := &ws.Aircraft{
			Hex: "GHI789",
			VR:  &vr,
		}
		m.updateAircraft(ac)
		if m.Aircraft["GHI789"].Vertical != 480.0 {
			t.Errorf("Vertical = %f, want 480.0", m.Aircraft["GHI789"].Vertical)
		}
	})

	// Test with empty hex
	t.Run("empty hex", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		ac := &ws.Aircraft{
			Hex: "",
		}
		m.updateAircraft(ac)
		if len(m.Aircraft) != 0 {
			t.Errorf("Aircraft count = %d, want 0", len(m.Aircraft))
		}
	})
}

func TestSortAircraft(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Add aircraft with different distances
	m.Aircraft["FAR"] = &Aircraft{Hex: "FAR", Distance: 100.0}
	m.Aircraft["NEAR"] = &Aircraft{Hex: "NEAR", Distance: 10.0}
	m.Aircraft["MID"] = &Aircraft{Hex: "MID", Distance: 50.0}

	m.sortAircraft()

	if len(m.SortedHexes) != 3 {
		t.Errorf("SortedHexes length = %d, want 3", len(m.SortedHexes))
	}

	if m.SortedHexes[0] != "NEAR" {
		t.Errorf("SortedHexes[0] = %s, want NEAR", m.SortedHexes[0])
	}
	if m.SortedHexes[1] != "MID" {
		t.Errorf("SortedHexes[1] = %s, want MID", m.SortedHexes[1])
	}
	if m.SortedHexes[2] != "FAR" {
		t.Errorf("SortedHexes[2] = %s, want FAR", m.SortedHexes[2])
	}
}

func TestSortAircraftEmpty(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	m.sortAircraft()

	if len(m.SortedHexes) != 0 {
		t.Errorf("SortedHexes length = %d, want 0", len(m.SortedHexes))
	}
}

func TestSortAircraftSingle(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	m.Aircraft["ONLY"] = &Aircraft{Hex: "ONLY", Distance: 50.0}

	m.sortAircraft()

	if len(m.SortedHexes) != 1 {
		t.Errorf("SortedHexes length = %d, want 1", len(m.SortedHexes))
	}
	if m.SortedHexes[0] != "ONLY" {
		t.Errorf("SortedHexes[0] = %s, want ONLY", m.SortedHexes[0])
	}
}

func TestHandleACARSMsg(t *testing.T) {
	cfg := config.DefaultConfig()

	// Test single ACARS message
	t.Run("single message", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		acarsData := map[string]interface{}{
			"callsign": "UAL123",
			"flight":   "UA123",
			"label":    "H1",
			"text":     "Hello World",
		}
		data, _ := json.Marshal(acarsData)
		msg := ws.Message{Type: string(ws.ACARSMessage), Data: data}
		m.handleACARSMsg(msg)

		if len(m.ACARSMessages) != 1 {
			t.Errorf("ACARSMessages count = %d, want 1", len(m.ACARSMessages))
		}
		if m.TotalMessages != 1 {
			t.Errorf("TotalMessages = %d, want 1", m.TotalMessages)
		}
		if m.ACARSMessages[0].Callsign != "UAL123" {
			t.Errorf("Callsign = %s, want UAL123", m.ACARSMessages[0].Callsign)
		}
	})

	// Test snapshot with multiple messages
	t.Run("snapshot", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		acarsData := []map[string]interface{}{
			{"callsign": "UAL123", "flight": "UA123", "label": "H1", "text": "Msg1"},
			{"callsign": "DAL456", "flight": "DL456", "label": "H2", "text": "Msg2"},
		}
		data, _ := json.Marshal(acarsData)
		msg := ws.Message{Type: string(ws.ACARSSnapshot), Data: data}
		m.handleACARSMsg(msg)

		if len(m.ACARSMessages) != 2 {
			t.Errorf("ACARSMessages count = %d, want 2", len(m.ACARSMessages))
		}
	})

	// Test overflow handling (max 100 messages)
	t.Run("overflow", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		for i := 0; i < 105; i++ {
			acarsData := map[string]interface{}{
				"callsign": "UAL" + itoa(i),
				"flight":   "UA" + itoa(i),
				"label":    "H1",
				"text":     "Message " + itoa(i),
			}
			data, _ := json.Marshal(acarsData)
			msg := ws.Message{Type: string(ws.ACARSMessage), Data: data}
			m.handleACARSMsg(msg)
		}

		if len(m.ACARSMessages) != 100 {
			t.Errorf("ACARSMessages count = %d, want 100", len(m.ACARSMessages))
		}
	})

	// Test invalid data
	t.Run("invalid data", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		msg := ws.Message{Type: string(ws.ACARSMessage), Data: []byte("invalid json")}
		m.handleACARSMsg(msg)
		// Should not panic
		if len(m.ACARSMessages) != 0 {
			t.Errorf("ACARSMessages count = %d, want 0", len(m.ACARSMessages))
		}
	})

	// Test unhandled message type
	t.Run("unhandled type", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		msg := ws.Message{Type: "unknown:type", Data: []byte("{}")}
		m.handleACARSMsg(msg)
		// Should not panic
		if len(m.ACARSMessages) != 0 {
			t.Errorf("ACARSMessages count = %d, want 0", len(m.ACARSMessages))
		}
	})
}

func TestGetUptime(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Set start time to a known value
	m.StartTime = time.Now().Add(-1*time.Hour - 30*time.Minute - 45*time.Second)

	uptime := m.GetUptime()
	// Should be approximately "01:30:45"
	if len(uptime) != 8 {
		t.Errorf("Uptime format wrong, got %s", uptime)
	}
}

func TestGetMilitaryCount(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	m.Aircraft["CIV1"] = &Aircraft{Hex: "CIV1", Military: false}
	m.Aircraft["MIL1"] = &Aircraft{Hex: "MIL1", Military: true}
	m.Aircraft["MIL2"] = &Aircraft{Hex: "MIL2", Military: true}
	m.Aircraft["CIV2"] = &Aircraft{Hex: "CIV2", Military: false}

	count := m.GetMilitaryCount()
	if count != 2 {
		t.Errorf("MilitaryCount = %d, want 2", count)
	}
}

func TestGetMilitaryCountEmpty(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	count := m.GetMilitaryCount()
	if count != 0 {
		t.Errorf("MilitaryCount = %d, want 0", count)
	}
}

func TestFormatTime(t *testing.T) {
	tests := []struct {
		h, m, s  int
		expected string
	}{
		{0, 0, 0, "00:00:00"},
		{1, 2, 3, "01:02:03"},
		{12, 34, 56, "12:34:56"},
		{99, 59, 59, "99:59:59"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := formatTime(tt.h, tt.m, tt.s)
			if result != tt.expected {
				t.Errorf("formatTime(%d, %d, %d) = %s, want %s", tt.h, tt.m, tt.s, result, tt.expected)
			}
		})
	}
}

func TestPad(t *testing.T) {
	tests := []struct {
		n        int
		expected string
	}{
		{0, "00"},
		{5, "05"},
		{9, "09"},
		{10, "10"},
		{99, "99"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := pad(tt.n)
			if result != tt.expected {
				t.Errorf("pad(%d) = %s, want %s", tt.n, result, tt.expected)
			}
		})
	}
}

func TestItoa(t *testing.T) {
	tests := []struct {
		n        int
		expected string
	}{
		{0, "0"},
		{1, "1"},
		{-1, "-1"},
		{123, "123"},
		{-456, "-456"},
		{999999, "999999"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := itoa(tt.n)
			if result != tt.expected {
				t.Errorf("itoa(%d) = %s, want %s", tt.n, result, tt.expected)
			}
		})
	}
}

func TestDisplayModeConstants(t *testing.T) {
	if ModeBasic != 0 {
		t.Errorf("ModeBasic = %d, want 0", ModeBasic)
	}
	if ModePro != 1 {
		t.Errorf("ModePro = %d, want 1", ModePro)
	}
}

func TestTickCmd(t *testing.T) {
	cmd := tickCmd()
	if cmd == nil {
		t.Error("tickCmd returned nil")
	}
}

func TestTickMsgType(t *testing.T) {
	// Verify tickMsg is a time.Time alias
	var msg tickMsg = tickMsg(time.Now())
	_ = time.Time(msg) // Should compile without error
}

func TestAircraftMsgType(t *testing.T) {
	// Verify aircraftMsg is a ws.Message alias
	var msg aircraftMsg = aircraftMsg(ws.Message{Type: "test"})
	_ = ws.Message(msg) // Should compile without error
}

func TestAcarsMsgType(t *testing.T) {
	// Verify acarsMsg is a ws.Message alias
	var msg acarsMsg = acarsMsg(ws.Message{Type: "test"})
	_ = ws.Message(msg) // Should compile without error
}

func TestACARSMessageStruct(t *testing.T) {
	msg := ACARSMessage{
		Timestamp: "12:34:56",
		Callsign:  "UAL123",
		Flight:    "UA123",
		Label:     "H1",
		Text:      "Test message",
		Source:    "ACARS",
		Frequency: "136.900",
	}

	if msg.Timestamp != "12:34:56" {
		t.Errorf("Timestamp = %s, want 12:34:56", msg.Timestamp)
	}
	if msg.Callsign != "UAL123" {
		t.Errorf("Callsign = %s, want UAL123", msg.Callsign)
	}
	if msg.Flight != "UA123" {
		t.Errorf("Flight = %s, want UA123", msg.Flight)
	}
	if msg.Label != "H1" {
		t.Errorf("Label = %s, want H1", msg.Label)
	}
	if msg.Text != "Test message" {
		t.Errorf("Text = %s, want Test message", msg.Text)
	}
	if msg.Source != "ACARS" {
		t.Errorf("Source = %s, want ACARS", msg.Source)
	}
	if msg.Frequency != "136.900" {
		t.Errorf("Frequency = %s, want 136.900", msg.Frequency)
	}
}

func TestAircraftStruct(t *testing.T) {
	ac := Aircraft{
		Hex:      "ABC123",
		Callsign: "UAL123",
		ACType:   "B738",
		Altitude: 35000,
		Speed:    450.0,
		Track:    180.0,
		Vertical: 500.0,
		Distance: 25.0,
		RSSI:     -5.5,
		Squawk:   "1200",
		Military: true,
		HasAlt:   true,
		HasSpeed: true,
		HasTrack: true,
		HasVS:    true,
		HasRSSI:  true,
	}

	if ac.Hex != "ABC123" {
		t.Errorf("Hex = %s, want ABC123", ac.Hex)
	}
	if !ac.Military {
		t.Error("Expected Military to be true")
	}
	if !ac.HasAlt {
		t.Error("Expected HasAlt to be true")
	}
}

func TestUpdateWithTickMsg(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Create a tickMsg
	msg := tickMsg(time.Now())
	newModel, cmd := m.Update(msg)

	if newModel == nil {
		t.Error("Update returned nil model")
	}
	if cmd == nil {
		t.Error("Expected cmd to be returned for tickMsg")
	}
}

func TestUpdateWithAircraftMsg(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Create aircraftMsg with valid data
	data, _ := json.Marshal(map[string]interface{}{
		"hex":    "ABC123",
		"flight": "UAL123",
	})
	msg := aircraftMsg(ws.Message{Type: string(ws.AircraftNew), Data: data})

	newModel, cmd := m.Update(msg)

	model := newModel.(*Model)
	if model == nil {
		t.Error("Update returned nil model")
	}
	if cmd == nil {
		t.Error("Expected cmd to be returned for aircraftMsg")
	}
	if len(model.Aircraft) != 1 {
		t.Errorf("Aircraft count = %d, want 1", len(model.Aircraft))
	}
}

func TestUpdateWithACARSMsg(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Create acarsMsg with valid data
	data, _ := json.Marshal(map[string]interface{}{
		"callsign": "UAL123",
		"flight":   "UA123",
		"label":    "H1",
		"text":     "Test",
	})
	msg := acarsMsg(ws.Message{Type: string(ws.ACARSMessage), Data: data})

	newModel, cmd := m.Update(msg)

	model := newModel.(*Model)
	if model == nil {
		t.Error("Update returned nil model")
	}
	if cmd == nil {
		t.Error("Expected cmd to be returned for acarsMsg")
	}
	if len(model.ACARSMessages) != 1 {
		t.Errorf("ACARSMessages count = %d, want 1", len(model.ACARSMessages))
	}
}

func TestUpdateWithKeyMsg(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Display.Theme = "classic"
	m := NewModel(cfg, ModeBasic)

	// Test quit key via Update
	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("q")}
	_, cmd := m.Update(msg)

	// Should return quit command
	if cmd == nil {
		t.Error("Expected quit command for 'q' key")
	}
}

func TestInit(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Init starts the WebSocket client and returns batch commands
	cmd := m.Init()

	if cmd == nil {
		t.Error("Init should return a command")
	}
}

func TestTickCmdReturnsCmd(t *testing.T) {
	cmd := tickCmd()
	if cmd == nil {
		t.Error("tickCmd should return a command")
	}
}

func TestAircraftMsgCmdReturnsCmd(t *testing.T) {
	client := ws.NewClient("localhost", 8080, 1)
	cmd := aircraftMsgCmd(client)
	if cmd == nil {
		t.Error("aircraftMsgCmd should return a command")
	}
}

func TestAcarsMsgCmdReturnsCmd(t *testing.T) {
	client := ws.NewClient("localhost", 8080, 1)
	cmd := acarsMsgCmd(client)
	if cmd == nil {
		t.Error("acarsMsgCmd should return a command")
	}
}

func TestTickCmdInnerFunction(t *testing.T) {
	// Get the command
	cmd := tickCmd()
	if cmd == nil {
		t.Error("tickCmd should return a command")
		return
	}

	// The returned command is a tea.Tick that will invoke our callback
	// We can't easily execute it without the full tea framework
	// but we verify it was created correctly
}

func TestMsgCmdFunctions(t *testing.T) {
	// These functions return commands that block on channels
	// We verify they return valid commands
	client := ws.NewClient("localhost", 8080, 1)

	acCmd := aircraftMsgCmd(client)
	if acCmd == nil {
		t.Error("aircraftMsgCmd should return non-nil command")
	}

	acarsCmd := acarsMsgCmd(client)
	if acarsCmd == nil {
		t.Error("acarsMsgCmd should return non-nil command")
	}
}

