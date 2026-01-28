// Package export provides export functionality for SkySpy CLI
package export

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/skyspy/skyspy-go/internal/radar"
)

// ACARSMessage represents an ACARS message for export
type ACARSMessage struct {
	Timestamp time.Time
	Callsign  string
	Flight    string
	Label     string
	Text      string
}

// ExportAircraft exports aircraft data to CSV format
func ExportAircraft(aircraft map[string]*radar.Target, directory string) (string, error) {
	filename := GenerateFilename("skyspy_aircraft", "csv", directory)

	file, err := os.Create(filename)
	if err != nil {
		if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
			return "", fmt.Errorf("failed to create directory: %w", err)
		}
		file, err = os.Create(filename)
		if err != nil {
			return "", fmt.Errorf("failed to create file: %w", err)
		}
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Write header
	header := []string{
		"hex",
		"callsign",
		"lat",
		"lon",
		"altitude",
		"speed",
		"track",
		"vertical_rate",
		"squawk",
		"distance_nm",
		"bearing",
		"military",
		"rssi",
		"aircraft_type",
		"timestamp",
	}
	if err := writer.Write(header); err != nil {
		return "", fmt.Errorf("failed to write header: %w", err)
	}

	timestamp := time.Now().Format(time.RFC3339)

	// Write aircraft data
	for _, ac := range aircraft {
		row := []string{
			ac.Hex,
			ac.Callsign,
			formatFloat(ac.Lat, ac.HasLat),
			formatFloat(ac.Lon, ac.HasLon),
			formatInt(ac.Altitude, ac.HasAlt),
			formatFloat(ac.Speed, ac.HasSpeed),
			formatFloat(ac.Track, ac.HasTrack),
			formatFloat(ac.Vertical, ac.HasVS),
			ac.Squawk,
			formatFloatAlways(ac.Distance),
			formatFloatAlways(ac.Bearing),
			strconv.FormatBool(ac.Military),
			formatFloat(ac.RSSI, ac.HasRSSI),
			ac.ACType,
			timestamp,
		}
		if err := writer.Write(row); err != nil {
			return "", fmt.Errorf("failed to write row: %w", err)
		}
	}

	return filename, nil
}

// ExportAircraftToFile exports aircraft data to a specific file
func ExportAircraftToFile(aircraft map[string]*radar.Target, filename string) error {
	file, err := os.Create(filename)
	if err != nil {
		if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}
		file, err = os.Create(filename)
		if err != nil {
			return fmt.Errorf("failed to create file: %w", err)
		}
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Write header
	header := []string{
		"hex",
		"callsign",
		"lat",
		"lon",
		"altitude",
		"speed",
		"track",
		"vertical_rate",
		"squawk",
		"distance_nm",
		"bearing",
		"military",
		"rssi",
		"aircraft_type",
		"timestamp",
	}
	if err := writer.Write(header); err != nil {
		return fmt.Errorf("failed to write header: %w", err)
	}

	timestamp := time.Now().Format(time.RFC3339)

	// Write aircraft data
	for _, ac := range aircraft {
		row := []string{
			ac.Hex,
			ac.Callsign,
			formatFloat(ac.Lat, ac.HasLat),
			formatFloat(ac.Lon, ac.HasLon),
			formatInt(ac.Altitude, ac.HasAlt),
			formatFloat(ac.Speed, ac.HasSpeed),
			formatFloat(ac.Track, ac.HasTrack),
			formatFloat(ac.Vertical, ac.HasVS),
			ac.Squawk,
			formatFloatAlways(ac.Distance),
			formatFloatAlways(ac.Bearing),
			strconv.FormatBool(ac.Military),
			formatFloat(ac.RSSI, ac.HasRSSI),
			ac.ACType,
			timestamp,
		}
		if err := writer.Write(row); err != nil {
			return fmt.Errorf("failed to write row: %w", err)
		}
	}

	return nil
}

// ExportACARSMessages exports ACARS messages to CSV format
func ExportACARSMessages(messages []ACARSMessage, directory string) (string, error) {
	filename := GenerateFilename("skyspy_acars", "csv", directory)

	file, err := os.Create(filename)
	if err != nil {
		if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
			return "", fmt.Errorf("failed to create directory: %w", err)
		}
		file, err = os.Create(filename)
		if err != nil {
			return "", fmt.Errorf("failed to create file: %w", err)
		}
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Write header
	header := []string{
		"timestamp",
		"callsign",
		"flight",
		"label",
		"text",
	}
	if err := writer.Write(header); err != nil {
		return "", fmt.Errorf("failed to write header: %w", err)
	}

	// Write ACARS messages
	for _, msg := range messages {
		timestamp := msg.Timestamp.Format(time.RFC3339)
		if msg.Timestamp.IsZero() {
			timestamp = time.Now().Format(time.RFC3339)
		}

		row := []string{
			timestamp,
			msg.Callsign,
			msg.Flight,
			msg.Label,
			msg.Text,
		}
		if err := writer.Write(row); err != nil {
			return "", fmt.Errorf("failed to write row: %w", err)
		}
	}

	return filename, nil
}

// ExportACARSMessagesToFile exports ACARS messages to a specific file
func ExportACARSMessagesToFile(messages []ACARSMessage, filename string) error {
	file, err := os.Create(filename)
	if err != nil {
		if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}
		file, err = os.Create(filename)
		if err != nil {
			return fmt.Errorf("failed to create file: %w", err)
		}
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Write header
	header := []string{
		"timestamp",
		"callsign",
		"flight",
		"label",
		"text",
	}
	if err := writer.Write(header); err != nil {
		return fmt.Errorf("failed to write header: %w", err)
	}

	// Write ACARS messages
	for _, msg := range messages {
		timestamp := msg.Timestamp.Format(time.RFC3339)
		if msg.Timestamp.IsZero() {
			timestamp = time.Now().Format(time.RFC3339)
		}

		row := []string{
			timestamp,
			msg.Callsign,
			msg.Flight,
			msg.Label,
			msg.Text,
		}
		if err := writer.Write(row); err != nil {
			return fmt.Errorf("failed to write row: %w", err)
		}
	}

	return nil
}

// formatFloat formats a float64 value for CSV, returning empty string if not available
func formatFloat(val float64, hasVal bool) string {
	if !hasVal {
		return ""
	}
	return strconv.FormatFloat(val, 'f', 6, 64)
}

// formatFloatAlways formats a float64 value for CSV, always returning the value
func formatFloatAlways(val float64) string {
	if val == 0 {
		return ""
	}
	return strconv.FormatFloat(val, 'f', 6, 64)
}

// formatInt formats an int value for CSV, returning empty string if not available
func formatInt(val int, hasVal bool) string {
	if !hasVal {
		return ""
	}
	return strconv.Itoa(val)
}
