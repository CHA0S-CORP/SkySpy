package export

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/skyspy/skyspy-go/internal/radar"
)

func TestExportAircraft_CSV(t *testing.T) {
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

	filename, err := ExportAircraft(aircraft, tmpDir)
	if err != nil {
		t.Fatalf("ExportAircraft failed: %v", err)
	}

	if !strings.HasPrefix(filepath.Base(filename), "skyspy_aircraft_") {
		t.Errorf("expected filename to start with 'skyspy_aircraft_', got %s", filepath.Base(filename))
	}
	if !strings.HasSuffix(filename, ".csv") {
		t.Errorf("expected filename to end with '.csv', got %s", filename)
	}

	file, err := os.Open(filename)
	if err != nil {
		t.Fatalf("failed to open exported file: %v", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("failed to read CSV: %v", err)
	}

	if len(records) < 1 {
		t.Fatal("CSV has no records")
	}

	header := records[0]
	expectedHeader := []string{
		"hex", "callsign", "lat", "lon", "altitude", "speed", "track",
		"vertical_rate", "squawk", "distance_nm", "bearing", "military",
		"rssi", "aircraft_type", "timestamp",
	}

	if len(header) != len(expectedHeader) {
		t.Errorf("expected %d columns, got %d", len(expectedHeader), len(header))
	}

	for i, col := range expectedHeader {
		if i < len(header) && header[i] != col {
			t.Errorf("column %d: expected %q, got %q", i, col, header[i])
		}
	}

	if len(records) != 3 {
		t.Errorf("expected 3 records (header + 2 aircraft), got %d", len(records))
	}

	foundABC123 := false
	foundDEF456 := false
	for _, row := range records[1:] {
		if len(row) > 0 {
			if row[0] == "ABC123" {
				foundABC123 = true
				if row[1] != "UAL123" {
					t.Errorf("ABC123 callsign: expected 'UAL123', got %q", row[1])
				}
				if row[11] != "false" {
					t.Errorf("ABC123 military: expected 'false', got %q", row[11])
				}
			}
			if row[0] == "DEF456" {
				foundDEF456 = true
				if row[1] != "AAL456" {
					t.Errorf("DEF456 callsign: expected 'AAL456', got %q", row[1])
				}
				if row[11] != "true" {
					t.Errorf("DEF456 military: expected 'true', got %q", row[11])
				}
			}
		}
	}

	if !foundABC123 {
		t.Error("ABC123 not found in exported CSV")
	}
	if !foundDEF456 {
		t.Error("DEF456 not found in exported CSV")
	}
}

func TestExportAircraft_CSV_Empty(t *testing.T) {
	tmpDir := t.TempDir()

	aircraft := map[string]*radar.Target{}

	filename, err := ExportAircraft(aircraft, tmpDir)
	if err != nil {
		t.Fatalf("ExportAircraft failed: %v", err)
	}

	file, err := os.Open(filename)
	if err != nil {
		t.Fatalf("failed to open exported file: %v", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("failed to read CSV: %v", err)
	}

	if len(records) != 1 {
		t.Errorf("expected 1 record (header only), got %d", len(records))
	}

	header := records[0]
	if len(header) != 15 {
		t.Errorf("expected 15 columns in header, got %d", len(header))
	}
}

func TestExportAircraft_CSV_SpecialChars(t *testing.T) {
	tmpDir := t.TempDir()

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL,123",
			Lat:      37.7749,
			Lon:      -122.4194,
			Altitude: 35000,
			Squawk:   "1234",
			HasLat:   true,
			HasLon:   true,
			HasAlt:   true,
		},
		"DEF456": {
			Hex:      "DEF456",
			Callsign: `Call"sign`,
			Lat:      38.0,
			Lon:      -121.0,
			Altitude: 28000,
			Squawk:   "5678",
			HasLat:   true,
			HasLon:   true,
			HasAlt:   true,
		},
		"GHI789": {
			Hex:      "GHI789",
			Callsign: "New\nLine",
			Lat:      39.0,
			Lon:      -120.0,
			Altitude: 30000,
			Squawk:   "9012",
			HasLat:   true,
			HasLon:   true,
			HasAlt:   true,
		},
	}

	filename, err := ExportAircraft(aircraft, tmpDir)
	if err != nil {
		t.Fatalf("ExportAircraft failed: %v", err)
	}

	file, err := os.Open(filename)
	if err != nil {
		t.Fatalf("failed to open exported file: %v", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("failed to read CSV with special characters: %v", err)
	}

	if len(records) != 4 {
		t.Errorf("expected 4 records, got %d", len(records))
	}

	foundComma := false
	foundQuote := false
	foundNewline := false

	for _, row := range records[1:] {
		if len(row) > 1 {
			if row[1] == "UAL,123" {
				foundComma = true
			}
			if row[1] == `Call"sign` {
				foundQuote = true
			}
			if row[1] == "New\nLine" {
				foundNewline = true
			}
		}
	}

	if !foundComma {
		t.Error("callsign with comma not properly escaped/preserved")
	}
	if !foundQuote {
		t.Error("callsign with quote not properly escaped/preserved")
	}
	if !foundNewline {
		t.Error("callsign with newline not properly escaped/preserved")
	}
}

func TestExportACARSMessages_CSV(t *testing.T) {
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

	filename, err := ExportACARSMessages(messages, tmpDir)
	if err != nil {
		t.Fatalf("ExportACARSMessages failed: %v", err)
	}

	if !strings.HasPrefix(filepath.Base(filename), "skyspy_acars_") {
		t.Errorf("expected filename to start with 'skyspy_acars_', got %s", filepath.Base(filename))
	}
	if !strings.HasSuffix(filename, ".csv") {
		t.Errorf("expected filename to end with '.csv', got %s", filename)
	}

	file, err := os.Open(filename)
	if err != nil {
		t.Fatalf("failed to open exported file: %v", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("failed to read CSV: %v", err)
	}

	header := records[0]
	expectedHeader := []string{"timestamp", "callsign", "flight", "label", "text"}

	if len(header) != len(expectedHeader) {
		t.Errorf("expected %d columns, got %d", len(expectedHeader), len(header))
	}

	for i, col := range expectedHeader {
		if i < len(header) && header[i] != col {
			t.Errorf("column %d: expected %q, got %q", i, col, header[i])
		}
	}

	if len(records) != 4 {
		t.Errorf("expected 4 records (header + 3 messages), got %d", len(records))
	}

	foundUAL := false
	foundAAL := false
	foundDAL := false

	for _, row := range records[1:] {
		if len(row) >= 5 {
			switch row[1] {
			case "UAL123":
				foundUAL = true
				if row[2] != "UA123" {
					t.Errorf("UAL123 flight: expected 'UA123', got %q", row[2])
				}
				if row[3] != "H1" {
					t.Errorf("UAL123 label: expected 'H1', got %q", row[3])
				}
			case "AAL456":
				foundAAL = true
			case "DAL789":
				foundDAL = true
				if row[0] == "" {
					t.Error("DAL789 should have a timestamp (uses current time for zero time)")
				}
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

func TestGenerateFilename(t *testing.T) {
	tests := []struct {
		name      string
		prefix    string
		extension string
		directory string
	}{
		{
			name:      "with directory",
			prefix:    "skyspy_aircraft",
			extension: "csv",
			directory: "/tmp/exports",
		},
		{
			name:      "without directory",
			prefix:    "skyspy_acars",
			extension: "json",
			directory: "",
		},
		{
			name:      "html extension",
			prefix:    "skyspy_screenshot",
			extension: "html",
			directory: "/home/user/data",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			before := time.Now()
			filename := GenerateFilename(tt.prefix, tt.extension, tt.directory)
			after := time.Now()

			if !strings.HasSuffix(filename, "."+tt.extension) {
				t.Errorf("expected filename to end with '.%s', got %s", tt.extension, filename)
			}

			base := filepath.Base(filename)
			if !strings.HasPrefix(base, tt.prefix+"_") {
				t.Errorf("expected filename to start with '%s_', got %s", tt.prefix, base)
			}

			if tt.directory != "" {
				expectedDir := filepath.Dir(filename)
				if expectedDir != tt.directory {
					t.Errorf("expected directory %q, got %q", tt.directory, expectedDir)
				}
			}

			timestampPart := strings.TrimPrefix(base, tt.prefix+"_")
			timestampPart = strings.TrimSuffix(timestampPart, "."+tt.extension)

			parsedTime, err := time.ParseInLocation("20060102_150405", timestampPart, time.Local)
			if err != nil {
				t.Errorf("failed to parse timestamp from filename: %v", err)
			} else {
				// Allow 2 second window for test execution time
				if parsedTime.Before(before.Add(-2*time.Second)) || parsedTime.After(after.Add(2*time.Second)) {
					t.Errorf("timestamp %v not within expected range [%v, %v]", parsedTime, before, after)
				}
			}
		})
	}
}

func TestExportAircraftToFile(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_aircraft.csv")

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

	err := ExportAircraftToFile(aircraft, filename)
	if err != nil {
		t.Fatalf("ExportAircraftToFile failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}

	file, err := os.Open(filename)
	if err != nil {
		t.Fatalf("failed to open exported file: %v", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("failed to read CSV: %v", err)
	}

	if len(records) != 2 {
		t.Errorf("expected 2 records (header + 1 aircraft), got %d", len(records))
	}
}

func TestExportAircraftToFile_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "dir")
	filename := filepath.Join(nestedDir, "test_aircraft.csv")

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
			HasLat:   true,
			HasLon:   true,
		},
	}

	err := ExportAircraftToFile(aircraft, filename)
	if err != nil {
		t.Fatalf("ExportAircraftToFile failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestExportACARSMessagesToFile(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_acars.csv")

	messages := []ACARSMessage{
		{
			Timestamp: time.Now(),
			Callsign:  "UAL123",
			Flight:    "UA123",
			Label:     "H1",
			Text:      "Test message",
		},
	}

	err := ExportACARSMessagesToFile(messages, filename)
	if err != nil {
		t.Fatalf("ExportACARSMessagesToFile failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}

	file, err := os.Open(filename)
	if err != nil {
		t.Fatalf("failed to open exported file: %v", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("failed to read CSV: %v", err)
	}

	if len(records) != 2 {
		t.Errorf("expected 2 records (header + 1 message), got %d", len(records))
	}
}
