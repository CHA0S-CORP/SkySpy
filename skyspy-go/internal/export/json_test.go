package export

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/skyspy/skyspy-go/internal/radar"
)

func TestExportAircraft_JSON(t *testing.T) {
	tmpDir := t.TempDir()

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
			Lat:      37.7749,
			Lon:      -122.4194,
			Altitude: 35000,
			Speed:    450.5,
			Track:    270.0,
			Vertical: -500.0,
			Squawk:   "1234",
			Distance: 25.5,
			Bearing:  180.0,
			Military: false,
			RSSI:     -85.5,
			ACType:   "B738",
			HasLat:   true,
			HasLon:   true,
			HasAlt:   true,
			HasSpeed: true,
			HasTrack: true,
			HasVS:    true,
			HasRSSI:  true,
		},
		"DEF456": {
			Hex:      "DEF456",
			Callsign: "AAL456",
			Lat:      38.0,
			Lon:      -121.0,
			Altitude: 28000,
			Speed:    380.0,
			Track:    90.0,
			Vertical: 1500.0,
			Squawk:   "5678",
			Distance: 50.0,
			Bearing:  45.0,
			Military: true,
			RSSI:     -90.0,
			ACType:   "A320",
			HasLat:   true,
			HasLon:   true,
			HasAlt:   true,
			HasSpeed: true,
			HasTrack: true,
			HasVS:    true,
			HasRSSI:  true,
		},
	}

	filename, err := ExportAircraftJSON(aircraft, tmpDir)
	if err != nil {
		t.Fatalf("ExportAircraftJSON failed: %v", err)
	}

	if !strings.HasPrefix(filepath.Base(filename), "skyspy_aircraft_") {
		t.Errorf("expected filename to start with 'skyspy_aircraft_', got %s", filepath.Base(filename))
	}
	if !strings.HasSuffix(filename, ".json") {
		t.Errorf("expected filename to end with '.json', got %s", filename)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	var exportData AircraftExportData
	if err := json.Unmarshal(data, &exportData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if exportData.ExportVersion != "1.0" {
		t.Errorf("expected export_version '1.0', got %q", exportData.ExportVersion)
	}

	if exportData.TotalAircraft != 2 {
		t.Errorf("expected total_aircraft 2, got %d", exportData.TotalAircraft)
	}

	if len(exportData.Aircraft) != 2 {
		t.Errorf("expected 2 aircraft, got %d", len(exportData.Aircraft))
	}

	if exportData.Timestamp == "" {
		t.Error("expected timestamp to be set")
	}

	foundABC123 := false
	foundDEF456 := false

	for _, ac := range exportData.Aircraft {
		if ac.Hex == "ABC123" {
			foundABC123 = true
			if ac.Callsign != "UAL123" {
				t.Errorf("ABC123 callsign: expected 'UAL123', got %q", ac.Callsign)
			}
			if ac.Lat == nil || *ac.Lat != 37.7749 {
				t.Error("ABC123 lat not correct")
			}
			if ac.Lon == nil || *ac.Lon != -122.4194 {
				t.Error("ABC123 lon not correct")
			}
			if ac.Altitude == nil || *ac.Altitude != 35000 {
				t.Error("ABC123 altitude not correct")
			}
			if ac.Military {
				t.Error("ABC123 should not be military")
			}
			if ac.AircraftType != "B738" {
				t.Errorf("ABC123 aircraft_type: expected 'B738', got %q", ac.AircraftType)
			}
		}
		if ac.Hex == "DEF456" {
			foundDEF456 = true
			if !ac.Military {
				t.Error("DEF456 should be military")
			}
		}
	}

	if !foundABC123 {
		t.Error("ABC123 not found in exported JSON")
	}
	if !foundDEF456 {
		t.Error("DEF456 not found in exported JSON")
	}
}

func TestExportAircraft_JSON_Empty(t *testing.T) {
	tmpDir := t.TempDir()

	aircraft := map[string]*radar.Target{}

	filename, err := ExportAircraftJSON(aircraft, tmpDir)
	if err != nil {
		t.Fatalf("ExportAircraftJSON failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	var exportData AircraftExportData
	if err := json.Unmarshal(data, &exportData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if exportData.TotalAircraft != 0 {
		t.Errorf("expected total_aircraft 0, got %d", exportData.TotalAircraft)
	}

	if len(exportData.Aircraft) != 0 {
		t.Errorf("expected 0 aircraft, got %d", len(exportData.Aircraft))
	}

	if exportData.Aircraft == nil {
		t.Error("aircraft array should not be nil (should be empty array)")
	}

	if exportData.ExportVersion != "1.0" {
		t.Errorf("expected export_version '1.0', got %q", exportData.ExportVersion)
	}

	if exportData.Timestamp == "" {
		t.Error("expected timestamp to be set even for empty export")
	}
}

func TestExportAircraft_JSON_Metadata(t *testing.T) {
	tmpDir := t.TempDir()

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:    "ABC123",
			HasLat: true,
			HasLon: true,
		},
		"DEF456": {
			Hex:    "DEF456",
			HasLat: true,
			HasLon: true,
		},
		"GHI789": {
			Hex:    "GHI789",
			HasLat: true,
			HasLon: true,
		},
	}

	before := time.Now()
	filename, err := ExportAircraftJSON(aircraft, tmpDir)
	after := time.Now()

	if err != nil {
		t.Fatalf("ExportAircraftJSON failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	var exportData AircraftExportData
	if err := json.Unmarshal(data, &exportData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if exportData.ExportVersion != "1.0" {
		t.Errorf("expected export_version '1.0', got %q", exportData.ExportVersion)
	}

	if exportData.TotalAircraft != 3 {
		t.Errorf("expected total_aircraft 3, got %d", exportData.TotalAircraft)
	}

	parsedTime, err := time.Parse(time.RFC3339, exportData.Timestamp)
	if err != nil {
		t.Errorf("failed to parse timestamp: %v", err)
	} else {
		if parsedTime.Before(before.Add(-time.Second)) || parsedTime.After(after.Add(time.Second)) {
			t.Errorf("timestamp %v not within expected range [%v, %v]", parsedTime, before, after)
		}
	}
}

func TestExportACARSJSON(t *testing.T) {
	tmpDir := t.TempDir()

	now := time.Now()
	messages := []ACARSMessage{
		{
			Timestamp: now,
			Callsign:  "UAL123",
			Flight:    "UA123",
			Label:     "H1",
			Text:      "Position report 37.77N 122.41W",
		},
		{
			Timestamp: now.Add(-5 * time.Minute),
			Callsign:  "AAL456",
			Flight:    "AA456",
			Label:     "H2",
			Text:      "Weather request",
		},
		{
			Timestamp: time.Time{},
			Callsign:  "DAL789",
			Flight:    "DL789",
			Label:     "SA",
			Text:      "Engine status normal",
		},
	}

	filename, err := ExportACARSJSON(messages, tmpDir)
	if err != nil {
		t.Fatalf("ExportACARSJSON failed: %v", err)
	}

	if !strings.HasPrefix(filepath.Base(filename), "skyspy_acars_") {
		t.Errorf("expected filename to start with 'skyspy_acars_', got %s", filepath.Base(filename))
	}
	if !strings.HasSuffix(filename, ".json") {
		t.Errorf("expected filename to end with '.json', got %s", filename)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	var exportData ACARSExportData
	if err := json.Unmarshal(data, &exportData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if exportData.ExportVersion != "1.0" {
		t.Errorf("expected export_version '1.0', got %q", exportData.ExportVersion)
	}

	if exportData.TotalMessages != 3 {
		t.Errorf("expected total_messages 3, got %d", exportData.TotalMessages)
	}

	if len(exportData.Messages) != 3 {
		t.Errorf("expected 3 messages, got %d", len(exportData.Messages))
	}

	foundUAL := false
	foundAAL := false
	foundDAL := false

	for _, msg := range exportData.Messages {
		switch msg.Callsign {
		case "UAL123":
			foundUAL = true
			if msg.Flight != "UA123" {
				t.Errorf("UAL123 flight: expected 'UA123', got %q", msg.Flight)
			}
			if msg.Label != "H1" {
				t.Errorf("UAL123 label: expected 'H1', got %q", msg.Label)
			}
			if msg.Text != "Position report 37.77N 122.41W" {
				t.Errorf("UAL123 text not correct")
			}
		case "AAL456":
			foundAAL = true
		case "DAL789":
			foundDAL = true
			if msg.Timestamp == "" {
				t.Error("DAL789 should have a timestamp (uses current time for zero time)")
			}
		}
	}

	if !foundUAL {
		t.Error("UAL123 message not found")
	}
	if !foundAAL {
		t.Error("AAL456 message not found")
	}
	if !foundDAL {
		t.Error("DAL789 message not found")
	}
}

func TestJSONPrettyPrint(t *testing.T) {
	tmpDir := t.TempDir()

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
			Lat:      37.7749,
			Lon:      -122.4194,
			Altitude: 35000,
			HasLat:   true,
			HasLon:   true,
			HasAlt:   true,
		},
	}

	filename, err := ExportAircraftJSON(aircraft, tmpDir)
	if err != nil {
		t.Fatalf("ExportAircraftJSON failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	content := string(data)

	if !strings.Contains(content, "\n") {
		t.Error("expected JSON to contain newlines for pretty printing")
	}

	if !strings.Contains(content, "  ") {
		t.Error("expected JSON to contain indentation (two spaces)")
	}

	lines := strings.Split(content, "\n")
	foundIndentedLine := false
	for _, line := range lines {
		if strings.HasPrefix(line, "  ") {
			foundIndentedLine = true
			break
		}
	}
	if !foundIndentedLine {
		t.Error("expected at least one indented line in pretty-printed JSON")
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Errorf("pretty-printed JSON should still be valid: %v", err)
	}
}

func TestExportAircraftJSONToFile(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_aircraft.json")

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
			Lat:      37.7749,
			Lon:      -122.4194,
			Altitude: 35000,
			HasLat:   true,
			HasLon:   true,
			HasAlt:   true,
		},
	}

	err := ExportAircraftJSONToFile(aircraft, filename)
	if err != nil {
		t.Fatalf("ExportAircraftJSONToFile failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	var exportData AircraftExportData
	if err := json.Unmarshal(data, &exportData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if len(exportData.Aircraft) != 1 {
		t.Errorf("expected 1 aircraft, got %d", len(exportData.Aircraft))
	}
}

func TestExportAircraftJSONToFile_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "dir")
	filename := filepath.Join(nestedDir, "test_aircraft.json")

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
			HasLat:   true,
			HasLon:   true,
		},
	}

	err := ExportAircraftJSONToFile(aircraft, filename)
	if err != nil {
		t.Fatalf("ExportAircraftJSONToFile failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestExportACARSJSONToFile(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_acars.json")

	messages := []ACARSMessage{
		{
			Timestamp: time.Now(),
			Callsign:  "UAL123",
			Flight:    "UA123",
			Label:     "H1",
			Text:      "Test message",
		},
	}

	err := ExportACARSJSONToFile(messages, filename)
	if err != nil {
		t.Fatalf("ExportACARSJSONToFile failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	var exportData ACARSExportData
	if err := json.Unmarshal(data, &exportData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if len(exportData.Messages) != 1 {
		t.Errorf("expected 1 message, got %d", len(exportData.Messages))
	}
}

func TestJSON_OptionalFieldsOmitted(t *testing.T) {
	tmpDir := t.TempDir()

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Military: false,
		},
	}

	filename, err := ExportAircraftJSON(aircraft, tmpDir)
	if err != nil {
		t.Fatalf("ExportAircraftJSON failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	content := string(data)

	if strings.Contains(content, `"callsign":`) {
		var exportData AircraftExportData
		json.Unmarshal(data, &exportData)
		for _, ac := range exportData.Aircraft {
			if ac.Hex == "ABC123" && ac.Callsign != "" {
				t.Error("empty callsign should be omitted from JSON")
			}
		}
	}

	if strings.Contains(content, `"lat":null`) {
		t.Error("null lat should be omitted from JSON")
	}
	if strings.Contains(content, `"altitude":null`) {
		t.Error("null altitude should be omitted from JSON")
	}
}
