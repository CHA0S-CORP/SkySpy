// Package export provides export functionality for SkySpy CLI
package export

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/skyspy/skyspy-go/internal/radar"
)

// AircraftExport represents aircraft data for JSON export
type AircraftExport struct {
	Hex          string   `json:"hex"`
	Callsign     string   `json:"callsign,omitempty"`
	Lat          *float64 `json:"lat,omitempty"`
	Lon          *float64 `json:"lon,omitempty"`
	Altitude     *int     `json:"altitude,omitempty"`
	Speed        *float64 `json:"speed,omitempty"`
	Track        *float64 `json:"track,omitempty"`
	VerticalRate *float64 `json:"vertical_rate,omitempty"`
	Squawk       string   `json:"squawk,omitempty"`
	DistanceNM   *float64 `json:"distance_nm,omitempty"`
	Bearing      *float64 `json:"bearing,omitempty"`
	Military     bool     `json:"military"`
	RSSI         *float64 `json:"rssi,omitempty"`
	AircraftType string   `json:"aircraft_type,omitempty"`
}

// AircraftExportData represents the full JSON export structure
type AircraftExportData struct {
	Timestamp     string           `json:"timestamp"`
	ExportVersion string           `json:"export_version"`
	TotalAircraft int              `json:"total_aircraft"`
	Aircraft      []AircraftExport `json:"aircraft"`
}

// ACARSExportData represents the full ACARS JSON export structure
type ACARSExportData struct {
	Timestamp     string            `json:"timestamp"`
	ExportVersion string            `json:"export_version"`
	TotalMessages int               `json:"total_messages"`
	Messages      []ACARSExportItem `json:"messages"`
}

// ACARSExportItem represents an ACARS message for JSON export
type ACARSExportItem struct {
	Timestamp string `json:"timestamp"`
	Callsign  string `json:"callsign,omitempty"`
	Flight    string `json:"flight,omitempty"`
	Label     string `json:"label,omitempty"`
	Text      string `json:"text,omitempty"`
}

// ExportAircraftJSON exports aircraft data to pretty-printed JSON
func ExportAircraftJSON(aircraft map[string]*radar.Target, directory string) (string, error) {
	filename := GenerateFilename("skyspy_aircraft", "json", directory)

	data := AircraftExportData{
		Timestamp:     time.Now().Format(time.RFC3339),
		ExportVersion: "1.0",
		TotalAircraft: len(aircraft),
		Aircraft:      make([]AircraftExport, 0, len(aircraft)),
	}

	for _, ac := range aircraft {
		export := AircraftExport{
			Hex:      ac.Hex,
			Callsign: ac.Callsign,
			Military: ac.Military,
			Squawk:   ac.Squawk,
		}

		if ac.ACType != "" {
			export.AircraftType = ac.ACType
		}

		if ac.HasLat {
			export.Lat = &ac.Lat
		}
		if ac.HasLon {
			export.Lon = &ac.Lon
		}
		if ac.HasAlt {
			export.Altitude = &ac.Altitude
		}
		if ac.HasSpeed {
			export.Speed = &ac.Speed
		}
		if ac.HasTrack {
			export.Track = &ac.Track
		}
		if ac.HasVS {
			export.VerticalRate = &ac.Vertical
		}
		if ac.HasRSSI {
			export.RSSI = &ac.RSSI
		}
		if ac.Distance > 0 {
			export.DistanceNM = &ac.Distance
		}
		if ac.Bearing > 0 {
			export.Bearing = &ac.Bearing
		}

		data.Aircraft = append(data.Aircraft, export)
	}

	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal JSON: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil && filepath.Dir(filename) != "" && filepath.Dir(filename) != "." {
		return "", fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(filename, jsonData, 0644); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	return filename, nil
}

// ExportAircraftJSONToFile exports aircraft data to a specific JSON file
func ExportAircraftJSONToFile(aircraft map[string]*radar.Target, filename string) error {
	data := AircraftExportData{
		Timestamp:     time.Now().Format(time.RFC3339),
		ExportVersion: "1.0",
		TotalAircraft: len(aircraft),
		Aircraft:      make([]AircraftExport, 0, len(aircraft)),
	}

	for _, ac := range aircraft {
		export := AircraftExport{
			Hex:      ac.Hex,
			Callsign: ac.Callsign,
			Military: ac.Military,
			Squawk:   ac.Squawk,
		}

		if ac.ACType != "" {
			export.AircraftType = ac.ACType
		}

		if ac.HasLat {
			export.Lat = &ac.Lat
		}
		if ac.HasLon {
			export.Lon = &ac.Lon
		}
		if ac.HasAlt {
			export.Altitude = &ac.Altitude
		}
		if ac.HasSpeed {
			export.Speed = &ac.Speed
		}
		if ac.HasTrack {
			export.Track = &ac.Track
		}
		if ac.HasVS {
			export.VerticalRate = &ac.Vertical
		}
		if ac.HasRSSI {
			export.RSSI = &ac.RSSI
		}
		if ac.Distance > 0 {
			export.DistanceNM = &ac.Distance
		}
		if ac.Bearing > 0 {
			export.Bearing = &ac.Bearing
		}

		data.Aircraft = append(data.Aircraft, export)
	}

	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil && filepath.Dir(filename) != "" && filepath.Dir(filename) != "." {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(filename, jsonData, 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

// ExportACARSJSON exports ACARS messages to pretty-printed JSON
func ExportACARSJSON(messages []ACARSMessage, directory string) (string, error) {
	filename := GenerateFilename("skyspy_acars", "json", directory)

	data := ACARSExportData{
		Timestamp:     time.Now().Format(time.RFC3339),
		ExportVersion: "1.0",
		TotalMessages: len(messages),
		Messages:      make([]ACARSExportItem, 0, len(messages)),
	}

	for _, msg := range messages {
		timestamp := msg.Timestamp.Format(time.RFC3339)
		if msg.Timestamp.IsZero() {
			timestamp = time.Now().Format(time.RFC3339)
		}

		data.Messages = append(data.Messages, ACARSExportItem{
			Timestamp: timestamp,
			Callsign:  msg.Callsign,
			Flight:    msg.Flight,
			Label:     msg.Label,
			Text:      msg.Text,
		})
	}

	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal JSON: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil && filepath.Dir(filename) != "" && filepath.Dir(filename) != "." {
		return "", fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(filename, jsonData, 0644); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	return filename, nil
}

// ExportACARSJSONToFile exports ACARS messages to a specific JSON file
func ExportACARSJSONToFile(messages []ACARSMessage, filename string) error {
	data := ACARSExportData{
		Timestamp:     time.Now().Format(time.RFC3339),
		ExportVersion: "1.0",
		TotalMessages: len(messages),
		Messages:      make([]ACARSExportItem, 0, len(messages)),
	}

	for _, msg := range messages {
		timestamp := msg.Timestamp.Format(time.RFC3339)
		if msg.Timestamp.IsZero() {
			timestamp = time.Now().Format(time.RFC3339)
		}

		data.Messages = append(data.Messages, ACARSExportItem{
			Timestamp: timestamp,
			Callsign:  msg.Callsign,
			Flight:    msg.Flight,
			Label:     msg.Label,
			Text:      msg.Text,
		})
	}

	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil && filepath.Dir(filename) != "" && filepath.Dir(filename) != "." {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(filename, jsonData, 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}
