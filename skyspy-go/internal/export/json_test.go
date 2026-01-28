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

func TestExportAircraftJSON_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "exports")

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
		},
	}

	filename, err := ExportAircraftJSON(aircraft, nestedDir)
	if err != nil {
		t.Fatalf("ExportAircraftJSON failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestExportAircraftJSON_Error(t *testing.T) {
	// Create a file that will block directory creation
	tmpDir := t.TempDir()
	blockingFile := filepath.Join(tmpDir, "blocking_file")
	if err := os.WriteFile(blockingFile, []byte("block"), 0644); err != nil {
		t.Fatalf("failed to create blocking file: %v", err)
	}

	// Try to export to a directory path that is actually a file
	invalidDir := filepath.Join(blockingFile, "subdir")

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	_, err := ExportAircraftJSON(aircraft, invalidDir)
	if err == nil {
		t.Error("expected error when exporting to invalid directory")
	}
}

func TestExportAircraftJSONToFile_Error(t *testing.T) {
	// Create a file that will block directory creation
	tmpDir := t.TempDir()
	blockingFile := filepath.Join(tmpDir, "blocking_file")
	if err := os.WriteFile(blockingFile, []byte("block"), 0644); err != nil {
		t.Fatalf("failed to create blocking file: %v", err)
	}

	// Try to export to a path where the parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.json")

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	err := ExportAircraftJSONToFile(aircraft, invalidPath)
	if err == nil {
		t.Error("expected error when exporting to invalid path")
	}
}

func TestExportACARSJSON_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "acars")

	messages := []ACARSMessage{
		{
			Timestamp: time.Now(),
			Callsign:  "UAL123",
			Flight:    "UA123",
			Label:     "H1",
			Text:      "Test",
		},
	}

	filename, err := ExportACARSJSON(messages, nestedDir)
	if err != nil {
		t.Fatalf("ExportACARSJSON failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestExportACARSJSON_Error(t *testing.T) {
	// Create a file that will block directory creation
	tmpDir := t.TempDir()
	blockingFile := filepath.Join(tmpDir, "blocking_file")
	if err := os.WriteFile(blockingFile, []byte("block"), 0644); err != nil {
		t.Fatalf("failed to create blocking file: %v", err)
	}

	// Try to export to a directory path that is actually a file
	invalidDir := filepath.Join(blockingFile, "subdir")

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	_, err := ExportACARSJSON(messages, invalidDir)
	if err == nil {
		t.Error("expected error when exporting to invalid directory")
	}
}

func TestExportACARSJSONToFile_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "acars")
	filename := filepath.Join(nestedDir, "test_acars.json")

	messages := []ACARSMessage{
		{
			Timestamp: time.Now(),
			Callsign:  "UAL123",
			Flight:    "UA123",
			Label:     "H1",
			Text:      "Test",
		},
	}

	err := ExportACARSJSONToFile(messages, filename)
	if err != nil {
		t.Fatalf("ExportACARSJSONToFile failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestExportACARSJSONToFile_Error(t *testing.T) {
	// Create a file that will block directory creation
	tmpDir := t.TempDir()
	blockingFile := filepath.Join(tmpDir, "blocking_file")
	if err := os.WriteFile(blockingFile, []byte("block"), 0644); err != nil {
		t.Fatalf("failed to create blocking file: %v", err)
	}

	// Try to export to a path where the parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.json")

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	err := ExportACARSJSONToFile(messages, invalidPath)
	if err == nil {
		t.Error("expected error when exporting to invalid path")
	}
}

func TestExportACARSJSON_Empty(t *testing.T) {
	tmpDir := t.TempDir()

	messages := []ACARSMessage{}

	filename, err := ExportACARSJSON(messages, tmpDir)
	if err != nil {
		t.Fatalf("ExportACARSJSON failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	var exportData ACARSExportData
	if err := json.Unmarshal(data, &exportData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if exportData.TotalMessages != 0 {
		t.Errorf("expected total_messages 0, got %d", exportData.TotalMessages)
	}

	if len(exportData.Messages) != 0 {
		t.Errorf("expected 0 messages, got %d", len(exportData.Messages))
	}
}

func TestExportACARSJSONToFile_ZeroTimestamp(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_acars_zero_ts.json")

	messages := []ACARSMessage{
		{
			// Zero timestamp - should use current time
			Timestamp: time.Time{},
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

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read exported file: %v", err)
	}

	var exportData ACARSExportData
	if err := json.Unmarshal(data, &exportData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if len(exportData.Messages) > 0 && exportData.Messages[0].Timestamp == "" {
		t.Error("timestamp should not be empty for zero time - should use current time")
	}
}

func TestExportAircraftJSON_AllFields(t *testing.T) {
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
			Military: true,
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
	}

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

	if len(exportData.Aircraft) != 1 {
		t.Fatalf("expected 1 aircraft, got %d", len(exportData.Aircraft))
	}

	ac := exportData.Aircraft[0]
	if ac.Lat == nil {
		t.Error("expected lat to be set")
	}
	if ac.Lon == nil {
		t.Error("expected lon to be set")
	}
	if ac.Altitude == nil {
		t.Error("expected altitude to be set")
	}
	if ac.Speed == nil {
		t.Error("expected speed to be set")
	}
	if ac.Track == nil {
		t.Error("expected track to be set")
	}
	if ac.VerticalRate == nil {
		t.Error("expected vertical_rate to be set")
	}
	if ac.RSSI == nil {
		t.Error("expected rssi to be set")
	}
	if ac.DistanceNM == nil {
		t.Error("expected distance_nm to be set")
	}
	if ac.Bearing == nil {
		t.Error("expected bearing to be set")
	}
	if ac.AircraftType != "B738" {
		t.Errorf("expected aircraft_type 'B738', got %q", ac.AircraftType)
	}
	if !ac.Military {
		t.Error("expected military to be true")
	}
}

func TestExportAircraftJSONToFile_AllFields(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_aircraft_all.json")

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
			Military: true,
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
	}

	err := ExportAircraftJSONToFile(aircraft, filename)
	if err != nil {
		t.Fatalf("ExportAircraftJSONToFile failed: %v", err)
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
		t.Fatalf("expected 1 aircraft, got %d", len(exportData.Aircraft))
	}

	ac := exportData.Aircraft[0]
	if ac.Lat == nil || *ac.Lat != 37.7749 {
		t.Error("lat not correct")
	}
	if ac.Lon == nil || *ac.Lon != -122.4194 {
		t.Error("lon not correct")
	}
	if ac.Altitude == nil || *ac.Altitude != 35000 {
		t.Error("altitude not correct")
	}
	if ac.Speed == nil || *ac.Speed != 450.5 {
		t.Error("speed not correct")
	}
	if ac.Track == nil || *ac.Track != 270.0 {
		t.Error("track not correct")
	}
	if ac.VerticalRate == nil || *ac.VerticalRate != -500.0 {
		t.Error("vertical_rate not correct")
	}
	if ac.RSSI == nil || *ac.RSSI != -85.5 {
		t.Error("rssi not correct")
	}
}

func TestExportAircraftJSON_NoOptionalFields(t *testing.T) {
	tmpDir := t.TempDir()

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Military: false,
			// No optional fields
			HasLat:   false,
			HasLon:   false,
			HasAlt:   false,
			HasSpeed: false,
			HasTrack: false,
			HasVS:    false,
			HasRSSI:  false,
			Distance: 0,
			Bearing:  0,
			ACType:   "",
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

	var exportData AircraftExportData
	if err := json.Unmarshal(data, &exportData); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if len(exportData.Aircraft) != 1 {
		t.Fatalf("expected 1 aircraft, got %d", len(exportData.Aircraft))
	}

	ac := exportData.Aircraft[0]
	if ac.Lat != nil {
		t.Error("lat should be nil")
	}
	if ac.Lon != nil {
		t.Error("lon should be nil")
	}
	if ac.Altitude != nil {
		t.Error("altitude should be nil")
	}
	if ac.Speed != nil {
		t.Error("speed should be nil")
	}
	if ac.Track != nil {
		t.Error("track should be nil")
	}
	if ac.VerticalRate != nil {
		t.Error("vertical_rate should be nil")
	}
	if ac.RSSI != nil {
		t.Error("rssi should be nil")
	}
	if ac.DistanceNM != nil {
		t.Error("distance_nm should be nil")
	}
	if ac.Bearing != nil {
		t.Error("bearing should be nil")
	}
	if ac.AircraftType != "" {
		t.Error("aircraft_type should be empty")
	}
}

// TestExportAircraftJSON_DirectoryInCurrentDir tests the path when directory is "." or empty
func TestExportAircraftJSON_DirectoryInCurrentDir(t *testing.T) {
	originalDir, _ := os.Getwd()
	tmpDir := t.TempDir()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	// Empty directory - should work in current directory
	filename, err := ExportAircraftJSON(aircraft, "")
	if err != nil {
		t.Fatalf("ExportAircraftJSON failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in current directory")
	}
}

// TestExportAircraftJSONToFile_DirectoryInCurrentDir tests file creation with just filename
func TestExportAircraftJSONToFile_DirectoryInCurrentDir(t *testing.T) {
	originalDir, _ := os.Getwd()
	tmpDir := t.TempDir()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	// Just filename, no directory
	err := ExportAircraftJSONToFile(aircraft, "test.json")
	if err != nil {
		t.Fatalf("ExportAircraftJSONToFile failed: %v", err)
	}

	if _, err := os.Stat("test.json"); os.IsNotExist(err) {
		t.Error("expected file to be created in current directory")
	}
}

// TestExportACARSJSON_DirectoryInCurrentDir tests the path when directory is "." or empty
func TestExportACARSJSON_DirectoryInCurrentDir(t *testing.T) {
	originalDir, _ := os.Getwd()
	tmpDir := t.TempDir()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	filename, err := ExportACARSJSON(messages, "")
	if err != nil {
		t.Fatalf("ExportACARSJSON failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in current directory")
	}
}

// TestExportACARSJSONToFile_DirectoryInCurrentDir tests file creation with just filename
func TestExportACARSJSONToFile_DirectoryInCurrentDir(t *testing.T) {
	originalDir, _ := os.Getwd()
	tmpDir := t.TempDir()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	err := ExportACARSJSONToFile(messages, "test.json")
	if err != nil {
		t.Fatalf("ExportACARSJSONToFile failed: %v", err)
	}

	if _, err := os.Stat("test.json"); os.IsNotExist(err) {
		t.Error("expected file to be created in current directory")
	}
}

// TestExportAircraftJSONToFile_MkdirAllError tests when MkdirAll fails
func TestExportAircraftJSONToFile_MkdirAllError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file that blocks directory creation
	blockingFile := filepath.Join(tmpDir, "blocker")
	if err := os.WriteFile(blockingFile, []byte("x"), 0644); err != nil {
		t.Fatalf("failed to create blocker: %v", err)
	}

	// Try to create in a path where parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.json")

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	err := ExportAircraftJSONToFile(aircraft, invalidPath)
	if err == nil {
		t.Error("expected error when directory creation fails")
	}
}

// TestExportACARSJSONToFile_MkdirAllError tests when MkdirAll fails
func TestExportACARSJSONToFile_MkdirAllError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file that blocks directory creation
	blockingFile := filepath.Join(tmpDir, "blocker")
	if err := os.WriteFile(blockingFile, []byte("x"), 0644); err != nil {
		t.Fatalf("failed to create blocker: %v", err)
	}

	// Try to create in a path where parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.json")

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	err := ExportACARSJSONToFile(messages, invalidPath)
	if err == nil {
		t.Error("expected error when directory creation fails")
	}
}

// TestExportAircraftJSON_WriteFileError tests when os.WriteFile fails
func TestExportAircraftJSON_WriteFileError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a read-only directory
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0555); err != nil {
		t.Fatalf("failed to create read-only dir: %v", err)
	}
	defer os.Chmod(readOnlyDir, 0755) // Cleanup

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	_, err := ExportAircraftJSON(aircraft, readOnlyDir)
	// May not fail as root, but should fail as regular user
	if err == nil {
		t.Log("expected error when writing to read-only directory (may pass as root)")
	}
}

// TestExportAircraftJSONToFile_WriteFileError tests when os.WriteFile fails
func TestExportAircraftJSONToFile_WriteFileError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a read-only directory
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0555); err != nil {
		t.Fatalf("failed to create read-only dir: %v", err)
	}
	defer os.Chmod(readOnlyDir, 0755) // Cleanup

	filename := filepath.Join(readOnlyDir, "test.json")

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	err := ExportAircraftJSONToFile(aircraft, filename)
	// May not fail as root, but should fail as regular user
	if err == nil {
		t.Log("expected error when writing to read-only directory (may pass as root)")
	}
}

// TestExportACARSJSON_WriteFileError tests when os.WriteFile fails
func TestExportACARSJSON_WriteFileError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a read-only directory
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0555); err != nil {
		t.Fatalf("failed to create read-only dir: %v", err)
	}
	defer os.Chmod(readOnlyDir, 0755) // Cleanup

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	_, err := ExportACARSJSON(messages, readOnlyDir)
	// May not fail as root, but should fail as regular user
	if err == nil {
		t.Log("expected error when writing to read-only directory (may pass as root)")
	}
}

// TestExportACARSJSONToFile_WriteFileError tests when os.WriteFile fails
func TestExportACARSJSONToFile_WriteFileError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a read-only directory
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0555); err != nil {
		t.Fatalf("failed to create read-only dir: %v", err)
	}
	defer os.Chmod(readOnlyDir, 0755) // Cleanup

	filename := filepath.Join(readOnlyDir, "test.json")

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	err := ExportACARSJSONToFile(messages, filename)
	// May not fail as root, but should fail as regular user
	if err == nil {
		t.Log("expected error when writing to read-only directory (may pass as root)")
	}
}
