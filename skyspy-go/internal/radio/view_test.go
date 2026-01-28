package radio

import (
	"strings"
	"testing"

	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/ui"
)

func TestView(t *testing.T) {
	cfg := config.DefaultConfig()

	t.Run("basic mode", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		view := m.View()
		if view == "" {
			t.Error("View returned empty string")
		}
		// Basic view should contain SKYSPY RADIO
		if !strings.Contains(view, "SKYSPY RADIO") {
			t.Error("Basic view should contain SKYSPY RADIO")
		}
	})

	t.Run("pro mode", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		view := m.View()
		if view == "" {
			t.Error("View returned empty string")
		}
		// Pro view should contain SKYSPY RADIO PRO
		if !strings.Contains(view, "SKYSPY RADIO PRO") {
			t.Error("Pro view should contain SKYSPY RADIO PRO")
		}
	})
}

func TestViewBasic(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	view := m.viewBasic()

	// Check all components are present
	if !strings.Contains(view, "SKYSPY RADIO") {
		t.Error("viewBasic should contain header")
	}
	if !strings.Contains(view, "LIVE AIRCRAFT TRACKING") {
		t.Error("viewBasic should contain aircraft table header")
	}
	if !strings.Contains(view, "ACARS/VDL2 FEED") {
		t.Error("viewBasic should contain ACARS panel")
	}
	if !strings.Contains(view, "1090 MHz") {
		t.Error("viewBasic should contain frequency line")
	}
}

func TestViewPro(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	view := m.viewPro()

	// Check all components are present
	if !strings.Contains(view, "SKYSPY RADIO PRO") {
		t.Error("viewPro should contain pro header")
	}
	if !strings.Contains(view, "LIVE TRAFFIC") {
		t.Error("viewPro should contain aircraft display")
	}
	if !strings.Contains(view, "STATUS") {
		t.Error("viewPro should contain status panel")
	}
	if !strings.Contains(view, "FREQUENCIES") {
		t.Error("viewPro should contain frequency panel")
	}
	if !strings.Contains(view, "ACARS/VDL2 FEED") {
		t.Error("viewPro should contain ACARS panel")
	}
	if !strings.Contains(view, "Quit") {
		t.Error("viewPro should contain footer with help")
	}
}

func TestViewProSidebarLines(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	// Test with different line counts - add aircraft to make main content longer
	for i := 0; i < 20; i++ {
		hex := "AC" + itoa(i)
		m.Aircraft[hex] = &Aircraft{Hex: hex, Distance: float64(i)}
	}
	m.sortAircraft()

	view := m.viewPro()
	if view == "" {
		t.Error("viewPro returned empty string")
	}
}

func TestRenderHeader(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	header := m.renderHeader()

	if !strings.Contains(header, "SKYSPY RADIO") {
		t.Error("Header should contain SKYSPY RADIO")
	}
	if !strings.Contains(header, "ADS-B / ACARS MONITOR") {
		t.Error("Header should contain ADS-B / ACARS MONITOR")
	}
	if !strings.Contains(header, "LIVE") {
		t.Error("Header should contain LIVE indicator")
	}
}

func TestRenderHeaderAnimatedSpinner(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Test different frame values to exercise spinner animation
	for frame := 0; frame < 8; frame++ {
		m.Frame = frame
		header := m.renderHeader()
		if header == "" {
			t.Errorf("Header empty at frame %d", frame)
		}
	}
}

func TestRenderProHeader(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	header := m.renderProHeader()

	if !strings.Contains(header, "SKYSPY RADIO PRO") {
		t.Error("Pro header should contain SKYSPY RADIO PRO")
	}
	if !strings.Contains(header, "ADS-B & ACARS MONITOR") {
		t.Error("Pro header should contain ADS-B & ACARS MONITOR")
	}
	if !strings.Contains(header, "LIVE") {
		t.Error("Pro header should contain LIVE indicator")
	}
}

func TestRenderProHeaderAnimatedIndicators(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	// Test different frame values
	for frame := 0; frame < 8; frame++ {
		m.Frame = frame
		header := m.renderProHeader()
		if header == "" {
			t.Errorf("Pro header empty at frame %d", frame)
		}
	}
}

func TestRenderAircraftTable(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Test empty table
	t.Run("empty table", func(t *testing.T) {
		table := m.renderAircraftTable()
		if !strings.Contains(table, "LIVE AIRCRAFT TRACKING") {
			t.Error("Table should contain title")
		}
		if !strings.Contains(table, "0 aircraft") {
			t.Error("Table should show 0 aircraft")
		}
	})

	// Test with aircraft
	t.Run("with aircraft", func(t *testing.T) {
		alt := 35000
		speed := 450.0
		track := 180.0
		rssi := -5.0

		m.Aircraft["ABC123"] = &Aircraft{
			Hex:      "ABC123",
			Callsign: "UAL123",
			ACType:   "B738",
			Altitude: alt,
			Speed:    speed,
			Track:    track,
			RSSI:     rssi,
			Distance: 25.0,
			Squawk:   "1200",
			HasAlt:   true,
			HasSpeed: true,
			HasTrack: true,
			HasRSSI:  true,
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		if !strings.Contains(table, "ABC123") {
			t.Error("Table should contain aircraft hex")
		}
		if !strings.Contains(table, "UAL123") {
			t.Error("Table should contain callsign")
		}
		if !strings.Contains(table, "1 aircraft") {
			t.Error("Table should show 1 aircraft")
		}
	})

	// Test military aircraft styling
	t.Run("military aircraft", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["MIL001"] = &Aircraft{
			Hex:      "MIL001",
			Callsign: "VIPER01",
			Military: true,
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		if !strings.Contains(table, "MIL001") {
			t.Error("Table should contain military aircraft hex")
		}
	})

	// Test emergency squawk styling
	t.Run("emergency squawk", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["EMERG"] = &Aircraft{
			Hex:    "EMERG",
			Squawk: "7700",
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		if !strings.Contains(table, "7700") {
			t.Error("Table should contain emergency squawk")
		}
	})

	// Test aircraft with no callsign
	t.Run("no callsign", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["NOCALL"] = &Aircraft{
			Hex:      "NOCALL",
			Callsign: "",
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		if !strings.Contains(table, "-------") {
			t.Error("Table should show dashes for missing callsign")
		}
	})

	// Test long callsign truncation
	t.Run("long callsign", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["LONG"] = &Aircraft{
			Hex:      "LONG",
			Callsign: "VERYLONGCALLSIGN",
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		// Should be truncated
		if strings.Contains(table, "VERYLONGCALLSIGN") {
			t.Error("Long callsign should be truncated")
		}
	})

	// Test altitude formatting
	t.Run("flight level", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["HIGH"] = &Aircraft{
			Hex:      "HIGH",
			Altitude: 35000,
			HasAlt:   true,
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		// Should show FL350
		if !strings.Contains(table, "FL350") {
			t.Error("High altitude should show flight level")
		}
	})

	t.Run("low altitude", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["LOW"] = &Aircraft{
			Hex:      "LOW",
			Altitude: 5000,
			HasAlt:   true,
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		if !strings.Contains(table, "5000") {
			t.Error("Low altitude should show feet")
		}
	})

	// Test max rows (15)
	t.Run("max rows", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		for i := 0; i < 20; i++ {
			hex := "AC" + itoa(i)
			m.Aircraft[hex] = &Aircraft{
				Hex:      hex,
				Distance: float64(i),
			}
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		// Should only show 15 aircraft
		if !strings.Contains(table, "20 aircraft") {
			t.Error("Table should show total aircraft count")
		}
	})

	// Test aircraft type truncation
	t.Run("long type", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["TYPE"] = &Aircraft{
			Hex:    "TYPE",
			ACType: "LONGTYPE",
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		if strings.Contains(table, "LONGTYPE") {
			t.Error("Long type should be truncated")
		}
	})

	// Test no altitude
	t.Run("no altitude", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["NOALT"] = &Aircraft{
			Hex:    "NOALT",
			HasAlt: false,
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		if !strings.Contains(table, "----") {
			t.Error("Missing altitude should show dashes")
		}
	})

	// Test no speed
	t.Run("no speed", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["NOSPD"] = &Aircraft{
			Hex:      "NOSPD",
			HasSpeed: false,
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		if !strings.Contains(table, "---kt") {
			t.Error("Missing speed should show dashes")
		}
	})

	// Test no track
	t.Run("no track", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["NOTRK"] = &Aircraft{
			Hex:      "NOTRK",
			HasTrack: false,
		}
		m.sortAircraft()

		// Just verify no panic
		_ = m.renderAircraftTable()
	})

	// Test no squawk
	t.Run("no squawk", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["NOSQ"] = &Aircraft{
			Hex:    "NOSQ",
			Squawk: "",
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		if !strings.Contains(table, "----") {
			t.Error("Missing squawk should show dashes")
		}
	})

	// Test distance zero
	t.Run("distance zero", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["DIST0"] = &Aircraft{
			Hex:      "DIST0",
			Distance: 0,
		}
		m.sortAircraft()

		table := m.renderAircraftTable()
		if !strings.Contains(table, "---") {
			t.Error("Zero distance should show dashes")
		}
	})
}

func TestRenderAircraftDisplay(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	// Test empty display
	t.Run("empty display", func(t *testing.T) {
		display := m.renderAircraftDisplay()
		if !strings.Contains(display, "LIVE TRAFFIC") {
			t.Error("Display should contain title")
		}
		if !strings.Contains(display, "0 aircraft tracked") {
			t.Error("Display should show 0 aircraft")
		}
	})

	// Test with aircraft
	t.Run("with aircraft", func(t *testing.T) {
		m.Aircraft["ABC123"] = &Aircraft{
			Hex:      "ABC123",
			Callsign: "UAL123",
			ACType:   "B738",
			Altitude: 35000,
			Speed:    450.0,
			Track:    180.0,
			Vertical: 500.0,
			RSSI:     -5.0,
			Distance: 25.0,
			Squawk:   "1200",
			HasAlt:   true,
			HasSpeed: true,
			HasTrack: true,
			HasVS:    true,
			HasRSSI:  true,
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		if !strings.Contains(display, "ABC123") {
			t.Error("Display should contain aircraft hex")
		}
	})

	// Test military aircraft indicator
	t.Run("military aircraft", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Aircraft["MIL001"] = &Aircraft{
			Hex:      "MIL001",
			Military: true,
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		// Military should have diamond indicator
		if !strings.Contains(display, "MIL001") {
			t.Error("Display should contain military aircraft")
		}
	})

	// Test emergency aircraft indicator with blink
	t.Run("emergency blink on", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Blink = true
		m.Aircraft["EMERG"] = &Aircraft{
			Hex:      "EMERG",
			Squawk:   "7700",
			Military: false,
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		if !strings.Contains(display, "7700") {
			t.Error("Display should contain emergency squawk")
		}
	})

	t.Run("emergency blink off", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Blink = false
		m.Aircraft["EMERG"] = &Aircraft{
			Hex:      "EMERG",
			Squawk:   "7700",
			Military: false,
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		if !strings.Contains(display, "7700") {
			t.Error("Display should contain emergency squawk")
		}
	})

	// Test normal aircraft blink states
	t.Run("normal blink on", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Blink = true
		m.Aircraft["NORMAL"] = &Aircraft{
			Hex:      "NORMAL",
			Military: false,
			Squawk:   "1200",
		}
		m.sortAircraft()

		_ = m.renderAircraftDisplay()
	})

	t.Run("normal blink off", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Blink = false
		m.Aircraft["NORMAL"] = &Aircraft{
			Hex:      "NORMAL",
			Military: false,
			Squawk:   "1200",
		}
		m.sortAircraft()

		_ = m.renderAircraftDisplay()
	})

	// Test vertical speed formatting
	t.Run("positive vs", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Aircraft["CLIMB"] = &Aircraft{
			Hex:      "CLIMB",
			Vertical: 1500.0,
			HasVS:    true,
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		if !strings.Contains(display, "+") {
			t.Error("Positive VS should show + sign")
		}
	})

	t.Run("negative vs", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Aircraft["DESC"] = &Aircraft{
			Hex:      "DESC",
			Vertical: -1500.0,
			HasVS:    true,
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		if !strings.Contains(display, "-1500") {
			t.Error("Negative VS should show negative value")
		}
	})

	t.Run("zero vs", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Aircraft["LEVEL"] = &Aircraft{
			Hex:      "LEVEL",
			Vertical: 0.0,
			HasVS:    true,
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		// Should show "0"
		if display == "" {
			t.Error("Display should not be empty")
		}
	})

	// Test no data cases
	t.Run("no callsign", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Aircraft["NOCALL"] = &Aircraft{
			Hex:      "NOCALL",
			Callsign: "",
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		if !strings.Contains(display, "--------") {
			t.Error("Missing callsign should show dashes")
		}
	})

	t.Run("long callsign", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Aircraft["LONG"] = &Aircraft{
			Hex:      "LONG",
			Callsign: "VERYLONGCALLSIGN",
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		if strings.Contains(display, "VERYLONGCALLSIGN") {
			t.Error("Long callsign should be truncated")
		}
	})

	t.Run("no type", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Aircraft["NOTYPE"] = &Aircraft{
			Hex:    "NOTYPE",
			ACType: "",
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		if !strings.Contains(display, "----") {
			t.Error("Missing type should show dashes")
		}
	})

	t.Run("long type", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		m.Aircraft["LTYPE"] = &Aircraft{
			Hex:    "LTYPE",
			ACType: "LONGTYPE",
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		if strings.Contains(display, "LONGTYPE") {
			t.Error("Long type should be truncated")
		}
	})

	// Test max rows (12 for pro)
	t.Run("max rows", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		for i := 0; i < 20; i++ {
			hex := "AC" + itoa(i)
			m.Aircraft[hex] = &Aircraft{
				Hex:      hex,
				Distance: float64(i),
			}
		}
		m.sortAircraft()

		display := m.renderAircraftDisplay()
		if !strings.Contains(display, "20 aircraft tracked") {
			t.Error("Display should show total aircraft count")
		}
	})
}

func TestRenderProSidebar(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	sidebar := m.renderProSidebar()

	if !strings.Contains(sidebar, "STATUS") {
		t.Error("Sidebar should contain STATUS panel")
	}
	if !strings.Contains(sidebar, "FREQUENCIES") {
		t.Error("Sidebar should contain FREQUENCIES panel")
	}
}

func TestRenderStatusPanel(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	// Test connected state
	t.Run("connected blink on", func(t *testing.T) {
		m.Connected = true
		m.Blink = true
		panel := m.renderStatusPanel()
		if !strings.Contains(panel, "RECEIVING") {
			t.Error("Connected panel should show RECEIVING")
		}
	})

	t.Run("connected blink off", func(t *testing.T) {
		m.Connected = true
		m.Blink = false
		panel := m.renderStatusPanel()
		if !strings.Contains(panel, "RECEIVING") {
			t.Error("Connected panel should show RECEIVING")
		}
	})

	// Test disconnected state
	t.Run("disconnected", func(t *testing.T) {
		m.Connected = false
		panel := m.renderStatusPanel()
		if !strings.Contains(panel, "SCANNING") {
			t.Error("Disconnected panel should show SCANNING")
		}
	})

	// Test stats display
	t.Run("stats", func(t *testing.T) {
		m.Aircraft["A"] = &Aircraft{Hex: "A"}
		m.Aircraft["B"] = &Aircraft{Hex: "B"}
		m.PeakAircraft = 5
		m.TotalMessages = 1000

		panel := m.renderStatusPanel()
		if !strings.Contains(panel, "TARGETS") {
			t.Error("Panel should show TARGETS")
		}
		if !strings.Contains(panel, "PEAK") {
			t.Error("Panel should show PEAK")
		}
		if !strings.Contains(panel, "MSGS") {
			t.Error("Panel should show MSGS")
		}
		if !strings.Contains(panel, "UPTIME") {
			t.Error("Panel should show UPTIME")
		}
	})
}

func TestRenderFrequencyPanel(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	panel := m.renderFrequencyPanel()

	if !strings.Contains(panel, "FREQUENCIES") {
		t.Error("Panel should contain FREQUENCIES title")
	}
}

func TestRenderFrequencyPanelBlink(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	// Test both blink states
	m.Blink = true
	panel1 := m.renderFrequencyPanel()

	m.Blink = false
	panel2 := m.renderFrequencyPanel()

	if panel1 == "" || panel2 == "" {
		t.Error("Frequency panels should not be empty")
	}
}

func TestRenderACARSPanel(t *testing.T) {
	cfg := config.DefaultConfig()

	// Test empty panel basic mode
	t.Run("empty basic", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		panel := m.renderACARSPanel()
		if !strings.Contains(panel, "ACARS/VDL2 FEED") {
			t.Error("Panel should contain title")
		}
		if !strings.Contains(panel, "Waiting for ACARS messages") {
			t.Error("Empty panel should show waiting message")
		}
	})

	// Test empty panel pro mode
	t.Run("empty pro", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		panel := m.renderACARSPanel()
		if !strings.Contains(panel, "ACARS/VDL2 FEED") {
			t.Error("Panel should contain title")
		}
	})

	// Test with messages
	t.Run("with messages", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.ACARSMessages = []ACARSMessage{
			{
				Timestamp: "12:34:56",
				Callsign:  "UAL123",
				Flight:    "UA123",
				Label:     "H1",
				Text:      "Test message",
				Source:    "ACARS",
			},
		}

		panel := m.renderACARSPanel()
		if !strings.Contains(panel, "12:34:56") {
			t.Error("Panel should contain timestamp")
		}
		if !strings.Contains(panel, "UAL123") {
			t.Error("Panel should contain callsign")
		}
	})

	// Test with empty timestamp
	t.Run("empty timestamp", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.ACARSMessages = []ACARSMessage{
			{
				Timestamp: "",
				Callsign:  "UAL123",
			},
		}

		panel := m.renderACARSPanel()
		if !strings.Contains(panel, "--:--:--") {
			t.Error("Empty timestamp should show dashes")
		}
	})

	// Test with empty source
	t.Run("empty source", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.ACARSMessages = []ACARSMessage{
			{
				Timestamp: "12:34:56",
				Source:    "",
			},
		}

		panel := m.renderACARSPanel()
		if !strings.Contains(panel, "ACARS") {
			t.Error("Empty source should default to ACARS")
		}
	})

	// Test with long source
	t.Run("long source", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.ACARSMessages = []ACARSMessage{
			{
				Timestamp: "12:34:56",
				Source:    "LONGSOURCE",
			},
		}

		panel := m.renderACARSPanel()
		if strings.Contains(panel, "LONGSOURCE") {
			t.Error("Long source should be truncated")
		}
	})

	// Test callsign fallback to flight
	t.Run("callsign fallback", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.ACARSMessages = []ACARSMessage{
			{
				Timestamp: "12:34:56",
				Callsign:  "",
				Flight:    "UA123",
			},
		}

		panel := m.renderACARSPanel()
		if !strings.Contains(panel, "UA123") {
			t.Error("Empty callsign should fall back to flight")
		}
	})

	// Test empty callsign and flight
	t.Run("empty callsign and flight", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.ACARSMessages = []ACARSMessage{
			{
				Timestamp: "12:34:56",
				Callsign:  "",
				Flight:    "",
			},
		}

		panel := m.renderACARSPanel()
		if !strings.Contains(panel, "-------") {
			t.Error("Empty callsign should show dashes")
		}
	})

	// Test long callsign
	t.Run("long callsign", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.ACARSMessages = []ACARSMessage{
			{
				Timestamp: "12:34:56",
				Callsign:  "VERYLONGCALLSIGN",
			},
		}

		panel := m.renderACARSPanel()
		if strings.Contains(panel, "VERYLONGCALLSIGN") {
			t.Error("Long callsign should be truncated")
		}
	})

	// Test empty label
	t.Run("empty label", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.ACARSMessages = []ACARSMessage{
			{
				Timestamp: "12:34:56",
				Callsign:  "UAL123",
				Label:     "",
			},
		}

		panel := m.renderACARSPanel()
		if !strings.Contains(panel, "L:--") {
			t.Error("Empty label should show dashes")
		}
	})

	// Test long label
	t.Run("long label", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.ACARSMessages = []ACARSMessage{
			{
				Timestamp: "12:34:56",
				Callsign:  "UAL123",
				Label:     "LONGLABEL",
			},
		}

		panel := m.renderACARSPanel()
		if strings.Contains(panel, "LONGLABEL") {
			t.Error("Long label should be truncated")
		}
	})

	// Test long text truncation
	t.Run("long text", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		longText := strings.Repeat("X", 100)
		m.ACARSMessages = []ACARSMessage{
			{
				Timestamp: "12:34:56",
				Callsign:  "UAL123",
				Text:      longText,
			},
		}

		panel := m.renderACARSPanel()
		if strings.Contains(panel, longText) {
			t.Error("Long text should be truncated")
		}
	})

	// Test max messages display (6 for basic, 8 for pro)
	t.Run("max messages basic", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		for i := 0; i < 10; i++ {
			m.ACARSMessages = append(m.ACARSMessages, ACARSMessage{
				Timestamp: "12:34:5" + itoa(i),
				Callsign:  "UAL" + itoa(i),
			})
		}

		panel := m.renderACARSPanel()
		// Should only show last 6
		if strings.Contains(panel, "UAL0") {
			t.Error("Basic mode should only show last 6 messages")
		}
	})

	t.Run("max messages pro", func(t *testing.T) {
		m := NewModel(cfg, ModePro)
		for i := 0; i < 15; i++ {
			m.ACARSMessages = append(m.ACARSMessages, ACARSMessage{
				Timestamp: "12:34:" + pad(i),
				Callsign:  "UAL" + itoa(i),
			})
		}

		panel := m.renderACARSPanel()
		// Should only show last 8
		if strings.Contains(panel, "UAL0") {
			t.Error("Pro mode should only show last 8 messages")
		}
	})

	// Test partial messages (less than maxMessages)
	t.Run("partial messages basic", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.ACARSMessages = []ACARSMessage{
			{Timestamp: "12:34:56", Callsign: "UAL123"},
			{Timestamp: "12:34:57", Callsign: "DAL456"},
		}

		panel := m.renderACARSPanel()
		if !strings.Contains(panel, "UAL123") || !strings.Contains(panel, "DAL456") {
			t.Error("Should show all messages when count < maxMessages")
		}
	})
}

func TestRenderStatsBar(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Test connected state
	t.Run("connected blink on", func(t *testing.T) {
		m.Connected = true
		m.Blink = true
		bar := m.renderStatsBar()
		if !strings.Contains(bar, "CONNECTED") {
			t.Error("Connected bar should show CONNECTED")
		}
	})

	t.Run("connected blink off", func(t *testing.T) {
		m.Connected = true
		m.Blink = false
		bar := m.renderStatsBar()
		if !strings.Contains(bar, "CONNECTED") {
			t.Error("Connected bar should show CONNECTED")
		}
	})

	// Test disconnected state
	t.Run("disconnected", func(t *testing.T) {
		m.Connected = false
		bar := m.renderStatsBar()
		if !strings.Contains(bar, "DISCONNECTED") {
			t.Error("Disconnected bar should show DISCONNECTED")
		}
	})

	// Test military count
	t.Run("military count", func(t *testing.T) {
		m.Aircraft["MIL1"] = &Aircraft{Hex: "MIL1", Military: true}
		m.Aircraft["MIL2"] = &Aircraft{Hex: "MIL2", Military: true}
		m.Aircraft["CIV1"] = &Aircraft{Hex: "CIV1", Military: false}

		bar := m.renderStatsBar()
		if !strings.Contains(bar, "MIL:2") {
			t.Error("Stats bar should show military count")
		}
	})

	// Test no military
	t.Run("no military", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.Aircraft["CIV1"] = &Aircraft{Hex: "CIV1", Military: false}

		bar := m.renderStatsBar()
		if strings.Contains(bar, "MIL:") {
			t.Error("Stats bar should not show military count when 0")
		}
	})

	// Test message count
	t.Run("message count", func(t *testing.T) {
		m := NewModel(cfg, ModeBasic)
		m.TotalMessages = 12345

		bar := m.renderStatsBar()
		if !strings.Contains(bar, "12345") {
			t.Error("Stats bar should show message count")
		}
	})
}

func TestRenderFrequencyLine(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	line := m.renderFrequencyLine()

	if !strings.Contains(line, "1090 MHz") {
		t.Error("Frequency line should contain 1090 MHz")
	}
	if !strings.Contains(line, "ADS-B") {
		t.Error("Frequency line should contain ADS-B")
	}
	if !strings.Contains(line, "136.900 MHz") {
		t.Error("Frequency line should contain 136.900 MHz")
	}
	if !strings.Contains(line, "ACARS") {
		t.Error("Frequency line should contain ACARS")
	}
	if !strings.Contains(line, "136.725 MHz") {
		t.Error("Frequency line should contain 136.725 MHz")
	}
	if !strings.Contains(line, "VDL2") {
		t.Error("Frequency line should contain VDL2")
	}
}

func TestRenderProFooter(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	footer := m.renderProFooter()

	if !strings.Contains(footer, "Quit") {
		t.Error("Footer should contain Quit")
	}
	if !strings.Contains(footer, "Theme") {
		t.Error("Footer should contain Theme")
	}
	if !strings.Contains(footer, "Scan Mode") {
		t.Error("Footer should contain Scan Mode")
	}
}

func TestRenderSignalBars(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Test with RSSI
	t.Run("with rssi", func(t *testing.T) {
		ac := &Aircraft{
			Hex:     "TEST",
			RSSI:    -5.0,
			HasRSSI: true,
		}
		bars := m.renderSignalBars(ac)
		if bars == "" {
			t.Error("Signal bars should not be empty")
		}
	})

	// Test without RSSI
	t.Run("without rssi", func(t *testing.T) {
		ac := &Aircraft{
			Hex:     "TEST",
			HasRSSI: false,
		}
		bars := m.renderSignalBars(ac)
		if !strings.Contains(bars, "░") {
			t.Error("No RSSI should show empty bars")
		}
	})
}

func TestGetCompass(t *testing.T) {
	tests := []struct {
		heading  float64
		expected string
	}{
		{0, "N"},
		{22, "N"},
		{23, "NE"},
		{45, "NE"},
		{67, "NE"},
		{68, "E"},
		{90, "E"},
		{112, "E"},
		{113, "SE"},
		{135, "SE"},
		{157, "SE"},
		{158, "S"},
		{180, "S"},
		{202, "S"},
		{203, "SW"},
		{225, "SW"},
		{247, "SW"},
		{248, "W"},
		{270, "W"},
		{292, "W"},
		{293, "NW"},
		{315, "NW"},
		{337, "NW"},
		{338, "N"},
		{359, "N"},
		{360, "N"},
	}

	for _, tt := range tests {
		t.Run(itoa(int(tt.heading))+"deg", func(t *testing.T) {
			result := getCompass(tt.heading)
			if result != tt.expected {
				t.Errorf("getCompass(%f) = %s, want %s", tt.heading, result, tt.expected)
			}
		})
	}
}

func TestViewWithDifferentThemes(t *testing.T) {
	themes := []string{"classic", "amber", "ice", "cyberpunk", "military", "high_contrast"}

	for _, themeName := range themes {
		t.Run(themeName, func(t *testing.T) {
			cfg := config.DefaultConfig()
			cfg.Display.Theme = themeName
			m := NewModel(cfg, ModeBasic)

			view := m.View()
			if view == "" {
				t.Errorf("View with theme %s returned empty string", themeName)
			}
		})
	}
}

func TestViewProWithDifferentThemes(t *testing.T) {
	themes := []string{"classic", "amber", "ice", "cyberpunk", "military", "high_contrast"}

	for _, themeName := range themes {
		t.Run(themeName, func(t *testing.T) {
			cfg := config.DefaultConfig()
			cfg.Display.Theme = themeName
			m := NewModel(cfg, ModePro)

			view := m.View()
			if view == "" {
				t.Errorf("Pro view with theme %s returned empty string", themeName)
			}
		})
	}
}

func TestRenderAircraftTableNonExistentHex(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Add hex to sorted list but not to aircraft map
	m.SortedHexes = []string{"NOTEXIST"}

	table := m.renderAircraftTable()
	// Should skip non-existent aircraft gracefully
	if !strings.Contains(table, "0 aircraft") {
		t.Error("Table should show 0 aircraft for non-existent hex")
	}
}

func TestRenderAircraftDisplayNonExistentHex(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	// Add hex to sorted list but not to aircraft map
	m.SortedHexes = []string{"NOTEXIST"}

	display := m.renderAircraftDisplay()
	// Should skip non-existent aircraft gracefully
	if !strings.Contains(display, "0 aircraft tracked") {
		t.Error("Display should show 0 aircraft for non-existent hex")
	}
}

func TestProSidebarLongerThanMain(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	// Clear aircraft to make main content shorter
	m.Aircraft = make(map[string]*Aircraft)
	m.SortedHexes = []string{}

	view := m.viewPro()
	if view == "" {
		t.Error("Pro view should not be empty")
	}
}

func TestRenderAircraftDisplayLowAltitude(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	// Add aircraft with low altitude (below 18000)
	m.Aircraft["LOW"] = &Aircraft{
		Hex:      "LOW",
		Altitude: 5000,
		HasAlt:   true,
	}
	m.sortAircraft()

	display := m.renderAircraftDisplay()
	// Low altitude should show feet, not flight level
	if !strings.Contains(display, "5000") {
		t.Error("Low altitude should display in feet")
	}
	if strings.Contains(display, "FL") {
		t.Error("Low altitude should not show flight level")
	}
}

func TestRenderFrequencyPanelNegativePadding(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModePro)

	// Set up a very wide frequency list to trigger negative padding edge case
	// The line format is: "  ○ {freq} MHz [{label}]"
	// We need lineWidth > 24 to trigger padding < 0
	m.FreqDisp.SetFrequencies([]ui.FrequencyInfo{
		{Freq: "1234567890.123456", Label: "VERYLONGLABEL", Active: true},
	})

	panel := m.renderFrequencyPanel()
	if panel == "" {
		t.Error("Frequency panel should not be empty")
	}
}

func TestRenderStatsBarPaddingEdgeCase(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Add many aircraft and messages to make stats bar content very long
	// This tests the remaining > 0 branch (which is always true in normal usage)
	for i := 0; i < 50; i++ {
		hex := "LONG" + itoa(i)
		m.Aircraft[hex] = &Aircraft{Hex: hex, Military: true}
	}
	m.TotalMessages = 9999999999

	bar := m.renderStatsBar()
	if bar == "" {
		t.Error("Stats bar should not be empty")
	}
}

func TestRenderStatsBarNoPaddingNeeded(t *testing.T) {
	cfg := config.DefaultConfig()
	m := NewModel(cfg, ModeBasic)

	// Try to get remaining <= 0 by having many military aircraft which adds "(MIL:N)"
	// and very high message count
	for i := 0; i < 999; i++ {
		hex := "M" + itoa(i)
		m.Aircraft[hex] = &Aircraft{Hex: hex, Military: true}
	}
	m.TotalMessages = 99999999999999999

	bar := m.renderStatsBar()
	if bar == "" {
		t.Error("Stats bar should not be empty")
	}
}
