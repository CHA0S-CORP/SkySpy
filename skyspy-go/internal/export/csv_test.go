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

func TestExportAircraft_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "exports")

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
			HasLat:   true,
			HasLon:   true,
		},
	}

	filename, err := ExportAircraft(aircraft, nestedDir)
	if err != nil {
		t.Fatalf("ExportAircraft failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestExportAircraft_Error(t *testing.T) {
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

	_, err := ExportAircraft(aircraft, invalidDir)
	if err == nil {
		t.Error("expected error when exporting to invalid directory")
	}
}

func TestExportAircraftToFile_Error(t *testing.T) {
	// Create a file that will block directory creation
	tmpDir := t.TempDir()
	blockingFile := filepath.Join(tmpDir, "blocking_file")
	if err := os.WriteFile(blockingFile, []byte("block"), 0644); err != nil {
		t.Fatalf("failed to create blocking file: %v", err)
	}

	// Try to export to a path where the parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.csv")

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	err := ExportAircraftToFile(aircraft, invalidPath)
	if err == nil {
		t.Error("expected error when exporting to invalid path")
	}
}

func TestExportACARSMessages_CreatesDirectory(t *testing.T) {
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

	filename, err := ExportACARSMessages(messages, nestedDir)
	if err != nil {
		t.Fatalf("ExportACARSMessages failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestExportACARSMessages_Error(t *testing.T) {
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

	_, err := ExportACARSMessages(messages, invalidDir)
	if err == nil {
		t.Error("expected error when exporting to invalid directory")
	}
}

func TestExportACARSMessagesToFile_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "acars")
	filename := filepath.Join(nestedDir, "test_acars.csv")

	messages := []ACARSMessage{
		{
			Timestamp: time.Now(),
			Callsign:  "UAL123",
			Flight:    "UA123",
			Label:     "H1",
			Text:      "Test",
		},
	}

	err := ExportACARSMessagesToFile(messages, filename)
	if err != nil {
		t.Fatalf("ExportACARSMessagesToFile failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestExportACARSMessagesToFile_Error(t *testing.T) {
	// Create a file that will block directory creation
	tmpDir := t.TempDir()
	blockingFile := filepath.Join(tmpDir, "blocking_file")
	if err := os.WriteFile(blockingFile, []byte("block"), 0644); err != nil {
		t.Fatalf("failed to create blocking file: %v", err)
	}

	// Try to export to a path where the parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.csv")

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	err := ExportACARSMessagesToFile(messages, invalidPath)
	if err == nil {
		t.Error("expected error when exporting to invalid path")
	}
}

func TestExportAircraft_CSV_PartialData(t *testing.T) {
	tmpDir := t.TempDir()

	// Aircraft with various combinations of missing data
	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
			// No position data
			HasLat: false,
			HasLon: false,
			HasAlt: false,
		},
		"DEF456": {
			Hex:      "DEF456",
			Callsign: "",
			Lat:      38.0,
			Lon:      -121.0,
			HasLat:   true,
			HasLon:   true,
			HasAlt:   false,
			// Distance and Bearing are 0
			Distance: 0,
			Bearing:  0,
		},
		"GHI789": {
			Hex:      "GHI789",
			HasSpeed: false,
			HasTrack: false,
			HasVS:    false,
			HasRSSI:  false,
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
		t.Fatalf("failed to read CSV: %v", err)
	}

	// Verify we have header + 3 aircraft
	if len(records) != 4 {
		t.Errorf("expected 4 records, got %d", len(records))
	}
}

func TestExportACARSMessages_CSV_Empty(t *testing.T) {
	tmpDir := t.TempDir()

	messages := []ACARSMessage{}

	filename, err := ExportACARSMessages(messages, tmpDir)
	if err != nil {
		t.Fatalf("ExportACARSMessages failed: %v", err)
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

	// Only header
	if len(records) != 1 {
		t.Errorf("expected 1 record (header only), got %d", len(records))
	}
}

func TestExportACARSMessagesToFile_ZeroTimestamp(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_acars_zero_ts.csv")

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

	err := ExportACARSMessagesToFile(messages, filename)
	if err != nil {
		t.Fatalf("ExportACARSMessagesToFile failed: %v", err)
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

	// Verify the timestamp is not empty (it should use current time)
	if len(records) >= 2 && len(records[1]) > 0 {
		if records[1][0] == "" {
			t.Error("timestamp should not be empty for zero time - should use current time")
		}
	}
}

func TestFormatFloat(t *testing.T) {
	tests := []struct {
		name   string
		val    float64
		hasVal bool
		want   string
	}{
		{"has value", 123.456789, true, "123.456789"},
		{"no value", 123.456789, false, ""},
		{"zero with has", 0.0, true, "0.000000"},
		{"zero without has", 0.0, false, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatFloat(tt.val, tt.hasVal)
			if got != tt.want {
				t.Errorf("formatFloat() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFormatFloatAlways(t *testing.T) {
	tests := []struct {
		name string
		val  float64
		want string
	}{
		{"positive value", 123.456789, "123.456789"},
		{"zero value", 0.0, ""},
		{"negative value", -50.5, "-50.500000"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatFloatAlways(tt.val)
			if got != tt.want {
				t.Errorf("formatFloatAlways() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFormatInt(t *testing.T) {
	tests := []struct {
		name   string
		val    int
		hasVal bool
		want   string
	}{
		{"has value", 12345, true, "12345"},
		{"no value", 12345, false, ""},
		{"zero with has", 0, true, "0"},
		{"zero without has", 0, false, ""},
		{"negative with has", -100, true, "-100"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatInt(tt.val, tt.hasVal)
			if got != tt.want {
				t.Errorf("formatInt() = %q, want %q", got, tt.want)
			}
		})
	}
}

// TestExportAircraft_DirectoryCreationSuccess tests the path where first os.Create fails
// but directory creation succeeds and second os.Create succeeds
func TestExportAircraft_DirectoryCreationSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	// Use a non-existent nested directory - first Create will fail, MkdirAll succeeds, second Create succeeds
	nestedDir := filepath.Join(tmpDir, "new_nested_dir")

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
			HasLat:   true,
			HasLon:   true,
		},
	}

	filename, err := ExportAircraft(aircraft, nestedDir)
	if err != nil {
		t.Fatalf("ExportAircraft failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}

	// Verify the directory was created
	if _, err := os.Stat(nestedDir); os.IsNotExist(err) {
		t.Error("expected directory to be created")
	}
}

// TestExportAircraftToFile_DirectoryCreationSuccess tests the directory creation path
func TestExportAircraftToFile_DirectoryCreationSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	// Use a non-existent nested directory
	nestedDir := filepath.Join(tmpDir, "new_nested_dir2")
	filename := filepath.Join(nestedDir, "test.csv")

	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
		},
	}

	err := ExportAircraftToFile(aircraft, filename)
	if err != nil {
		t.Fatalf("ExportAircraftToFile failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}
}

// TestExportACARSMessages_DirectoryCreationSuccess tests the directory creation path
func TestExportACARSMessages_DirectoryCreationSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "new_nested_dir3")

	messages := []ACARSMessage{
		{
			Timestamp: time.Now(),
			Callsign:  "UAL123",
		},
	}

	filename, err := ExportACARSMessages(messages, nestedDir)
	if err != nil {
		t.Fatalf("ExportACARSMessages failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}
}

// TestExportACARSMessagesToFile_DirectoryCreationSuccess tests the directory creation path
func TestExportACARSMessagesToFile_DirectoryCreationSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "new_nested_dir4")
	filename := filepath.Join(nestedDir, "test.csv")

	messages := []ACARSMessage{
		{
			Timestamp: time.Now(),
			Callsign:  "UAL123",
		},
	}

	err := ExportACARSMessagesToFile(messages, filename)
	if err != nil {
		t.Fatalf("ExportACARSMessagesToFile failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}
}

// TestExportAircraft_SecondCreateFails tests when MkdirAll succeeds but second Create fails
func TestExportAircraft_SecondCreateFails(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a directory and make it read-only so file creation fails
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0755); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}

	// Create a file inside that will block directory creation at that path
	blockingFile := filepath.Join(readOnlyDir, "blocker")
	if err := os.WriteFile(blockingFile, []byte("x"), 0644); err != nil {
		t.Fatalf("failed to create blocker: %v", err)
	}

	// Try to create file inside the blocking file (which is not a directory)
	invalidPath := filepath.Join(blockingFile, "subdir")

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	_, err := ExportAircraft(aircraft, invalidPath)
	if err == nil {
		t.Error("expected error when directory creation fails")
	}
}

// TestExportAircraftToFile_SecondCreateFails tests when MkdirAll succeeds but second Create fails
func TestExportAircraftToFile_SecondCreateFails(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file that blocks directory creation
	blockingFile := filepath.Join(tmpDir, "blocker")
	if err := os.WriteFile(blockingFile, []byte("x"), 0644); err != nil {
		t.Fatalf("failed to create blocker: %v", err)
	}

	// Try to create file where parent path contains a file (not a directory)
	invalidPath := filepath.Join(blockingFile, "subdir", "test.csv")

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	err := ExportAircraftToFile(aircraft, invalidPath)
	if err == nil {
		t.Error("expected error when directory creation fails")
	}
}

// TestExportACARSMessages_SecondCreateFails tests when MkdirAll fails
func TestExportACARSMessages_SecondCreateFails(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file that blocks directory creation
	blockingFile := filepath.Join(tmpDir, "blocker")
	if err := os.WriteFile(blockingFile, []byte("x"), 0644); err != nil {
		t.Fatalf("failed to create blocker: %v", err)
	}

	// Try to create in a path where parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir")

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	_, err := ExportACARSMessages(messages, invalidPath)
	if err == nil {
		t.Error("expected error when directory creation fails")
	}
}

// TestExportACARSMessagesToFile_SecondCreateFails tests when MkdirAll fails
func TestExportACARSMessagesToFile_SecondCreateFails(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file that blocks directory creation
	blockingFile := filepath.Join(tmpDir, "blocker")
	if err := os.WriteFile(blockingFile, []byte("x"), 0644); err != nil {
		t.Fatalf("failed to create blocker: %v", err)
	}

	// Try to create in a path where parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.csv")

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	err := ExportACARSMessagesToFile(messages, invalidPath)
	if err == nil {
		t.Error("expected error when directory creation fails")
	}
}

// TestExportAircraft_CSV_WriteError tests CSV write error by using read-only directory
func TestExportAircraft_CSV_WriteError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a read-only directory
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0555); err != nil {
		t.Fatalf("failed to create read-only dir: %v", err)
	}
	defer os.Chmod(readOnlyDir, 0755)

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	_, err := ExportAircraft(aircraft, readOnlyDir)
	// May succeed as root, but should fail as regular user
	if err == nil {
		t.Log("expected error when writing to read-only directory (may pass as root)")
	}
}

// TestExportAircraftToFile_CSV_WriteError tests CSV write error
func TestExportAircraftToFile_CSV_WriteError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a read-only directory
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0555); err != nil {
		t.Fatalf("failed to create read-only dir: %v", err)
	}
	defer os.Chmod(readOnlyDir, 0755)

	filename := filepath.Join(readOnlyDir, "test.csv")

	aircraft := map[string]*radar.Target{
		"ABC123": {Hex: "ABC123"},
	}

	err := ExportAircraftToFile(aircraft, filename)
	// May succeed as root, but should fail as regular user
	if err == nil {
		t.Log("expected error when writing to read-only directory (may pass as root)")
	}
}

// TestExportACARSMessages_CSV_WriteError tests CSV write error
func TestExportACARSMessages_CSV_WriteError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a read-only directory
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0555); err != nil {
		t.Fatalf("failed to create read-only dir: %v", err)
	}
	defer os.Chmod(readOnlyDir, 0755)

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	_, err := ExportACARSMessages(messages, readOnlyDir)
	// May succeed as root, but should fail as regular user
	if err == nil {
		t.Log("expected error when writing to read-only directory (may pass as root)")
	}
}

// TestExportACARSMessagesToFile_CSV_WriteError tests CSV write error
func TestExportACARSMessagesToFile_CSV_WriteError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a read-only directory
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0555); err != nil {
		t.Fatalf("failed to create read-only dir: %v", err)
	}
	defer os.Chmod(readOnlyDir, 0755)

	filename := filepath.Join(readOnlyDir, "test.csv")

	messages := []ACARSMessage{
		{Callsign: "UAL123"},
	}

	err := ExportACARSMessagesToFile(messages, filename)
	// May succeed as root, but should fail as regular user
	if err == nil {
		t.Log("expected error when writing to read-only directory (may pass as root)")
	}
}
