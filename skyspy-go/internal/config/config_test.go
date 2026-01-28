// Package config handles configuration loading, saving, and defaults for SkySpy CLI
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg == nil {
		t.Fatal("DefaultConfig returned nil")
	}

	// Test Display defaults
	if cfg.Display.Theme != "classic" {
		t.Errorf("Display.Theme = %q, want %q", cfg.Display.Theme, "classic")
	}
	if !cfg.Display.ShowLabels {
		t.Error("Display.ShowLabels should be true by default")
	}
	if cfg.Display.ShowTrails {
		t.Error("Display.ShowTrails should be false by default")
	}
	if cfg.Display.RefreshRate != 10 {
		t.Errorf("Display.RefreshRate = %d, want 10", cfg.Display.RefreshRate)
	}
	if cfg.Display.CompactMode {
		t.Error("Display.CompactMode should be false by default")
	}
	if !cfg.Display.ShowACARS {
		t.Error("Display.ShowACARS should be true by default")
	}
	if !cfg.Display.ShowTargetList {
		t.Error("Display.ShowTargetList should be true by default")
	}
	if !cfg.Display.ShowVUMeters {
		t.Error("Display.ShowVUMeters should be true by default")
	}
	if !cfg.Display.ShowSpectrum {
		t.Error("Display.ShowSpectrum should be true by default")
	}
	if !cfg.Display.ShowFrequencies {
		t.Error("Display.ShowFrequencies should be true by default")
	}
	if !cfg.Display.ShowStatsPanel {
		t.Error("Display.ShowStatsPanel should be true by default")
	}

	// Test Radar defaults
	if cfg.Radar.DefaultRange != 100 {
		t.Errorf("Radar.DefaultRange = %d, want 100", cfg.Radar.DefaultRange)
	}
	if cfg.Radar.RangeRings != 4 {
		t.Errorf("Radar.RangeRings = %d, want 4", cfg.Radar.RangeRings)
	}
	if cfg.Radar.SweepSpeed != 6 {
		t.Errorf("Radar.SweepSpeed = %d, want 6", cfg.Radar.SweepSpeed)
	}
	if !cfg.Radar.ShowCompass {
		t.Error("Radar.ShowCompass should be true by default")
	}
	if cfg.Radar.ShowGrid {
		t.Error("Radar.ShowGrid should be false by default")
	}
	if !cfg.Radar.ShowOverlays {
		t.Error("Radar.ShowOverlays should be true by default")
	}
	if cfg.Radar.OverlayColor != "cyan" {
		t.Errorf("Radar.OverlayColor = %q, want %q", cfg.Radar.OverlayColor, "cyan")
	}

	// Test Filters defaults
	if cfg.Filters.MilitaryOnly {
		t.Error("Filters.MilitaryOnly should be false by default")
	}
	if cfg.Filters.MinAltitude != nil {
		t.Error("Filters.MinAltitude should be nil by default")
	}
	if cfg.Filters.MaxAltitude != nil {
		t.Error("Filters.MaxAltitude should be nil by default")
	}
	if cfg.Filters.MinDistance != nil {
		t.Error("Filters.MinDistance should be nil by default")
	}
	if cfg.Filters.MaxDistance != nil {
		t.Error("Filters.MaxDistance should be nil by default")
	}
	if cfg.Filters.HideGround {
		t.Error("Filters.HideGround should be false by default")
	}

	// Test Connection defaults
	if cfg.Connection.Host != "localhost" {
		t.Errorf("Connection.Host = %q, want %q", cfg.Connection.Host, "localhost")
	}
	if cfg.Connection.Port != 80 {
		t.Errorf("Connection.Port = %d, want 80", cfg.Connection.Port)
	}
	if cfg.Connection.ReceiverLat != 0.0 {
		t.Errorf("Connection.ReceiverLat = %f, want 0.0", cfg.Connection.ReceiverLat)
	}
	if cfg.Connection.ReceiverLon != 0.0 {
		t.Errorf("Connection.ReceiverLon = %f, want 0.0", cfg.Connection.ReceiverLon)
	}
	if !cfg.Connection.AutoReconnect {
		t.Error("Connection.AutoReconnect should be true by default")
	}
	if cfg.Connection.ReconnectDelay != 2 {
		t.Errorf("Connection.ReconnectDelay = %d, want 2", cfg.Connection.ReconnectDelay)
	}

	// Test Audio defaults
	if cfg.Audio.Enabled {
		t.Error("Audio.Enabled should be false by default")
	}
	if !cfg.Audio.NewAircraftSound {
		t.Error("Audio.NewAircraftSound should be true by default")
	}
	if !cfg.Audio.EmergencySound {
		t.Error("Audio.EmergencySound should be true by default")
	}
	if cfg.Audio.MilitarySound {
		t.Error("Audio.MilitarySound should be false by default")
	}

	// Test Overlays defaults
	if cfg.Overlays.Overlays == nil {
		t.Error("Overlays.Overlays should be initialized")
	}
	if len(cfg.Overlays.Overlays) != 0 {
		t.Errorf("Overlays.Overlays should be empty, got %d", len(cfg.Overlays.Overlays))
	}
	if cfg.Overlays.CustomRangeRings == nil {
		t.Error("Overlays.CustomRangeRings should be initialized")
	}
	if len(cfg.Overlays.CustomRangeRings) != 0 {
		t.Errorf("Overlays.CustomRangeRings should be empty, got %d", len(cfg.Overlays.CustomRangeRings))
	}

	// Test Export defaults
	if cfg.Export.Directory != "" {
		t.Errorf("Export.Directory = %q, want empty", cfg.Export.Directory)
	}

	// Test Alerts defaults
	if !cfg.Alerts.Enabled {
		t.Error("Alerts.Enabled should be true by default")
	}
	if cfg.Alerts.Rules == nil {
		t.Error("Alerts.Rules should be initialized")
	}
	if len(cfg.Alerts.Rules) != 0 {
		t.Errorf("Alerts.Rules should be empty, got %d", len(cfg.Alerts.Rules))
	}
	if cfg.Alerts.Geofences == nil {
		t.Error("Alerts.Geofences should be initialized")
	}
	if len(cfg.Alerts.Geofences) != 0 {
		t.Errorf("Alerts.Geofences should be empty, got %d", len(cfg.Alerts.Geofences))
	}
	if cfg.Alerts.LogFile != "" {
		t.Errorf("Alerts.LogFile = %q, want empty", cfg.Alerts.LogFile)
	}
	if cfg.Alerts.SoundDir != "" {
		t.Errorf("Alerts.SoundDir = %q, want empty", cfg.Alerts.SoundDir)
	}

	// Test RecentHosts defaults
	if cfg.RecentHosts == nil {
		t.Error("RecentHosts should be initialized")
	}
	if len(cfg.RecentHosts) != 0 {
		t.Errorf("RecentHosts should be empty, got %d", len(cfg.RecentHosts))
	}
}

func TestEnsureConfigDir(t *testing.T) {
	// Save original values
	origConfigDir := ConfigDir
	origOverlaysDir := OverlaysDir

	// Create temp directory
	tempDir, err := os.MkdirTemp("", "skyspy-config-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Set config paths to temp directory
	ConfigDir = filepath.Join(tempDir, "config")
	OverlaysDir = filepath.Join(tempDir, "config", "overlays")

	// Restore original values after test
	defer func() {
		ConfigDir = origConfigDir
		OverlaysDir = origOverlaysDir
	}()

	err = EnsureConfigDir()
	if err != nil {
		t.Fatalf("EnsureConfigDir failed: %v", err)
	}

	// Verify directories were created
	if _, err := os.Stat(ConfigDir); os.IsNotExist(err) {
		t.Error("ConfigDir was not created")
	}

	if _, err := os.Stat(OverlaysDir); os.IsNotExist(err) {
		t.Error("OverlaysDir was not created")
	}
}

func TestEnsureConfigDir_Error(t *testing.T) {
	// Save original values
	origConfigDir := ConfigDir
	origOverlaysDir := OverlaysDir

	// Set to invalid path
	ConfigDir = "/invalid/path/that/cannot/be/created\x00null"
	OverlaysDir = "/invalid/path/that/cannot/be/created\x00null/overlays"

	defer func() {
		ConfigDir = origConfigDir
		OverlaysDir = origOverlaysDir
	}()

	err := EnsureConfigDir()
	if err == nil {
		t.Error("EnsureConfigDir should return error for invalid path")
	}
}

func TestLoad_NoFile(t *testing.T) {
	// Save original value
	origConfigFile := ConfigFile

	// Set to non-existent file
	ConfigFile = "/nonexistent/path/settings.json"

	defer func() {
		ConfigFile = origConfigFile
	}()

	cfg, err := Load()
	if err != nil {
		t.Errorf("Load should not return error for non-existent file: %v", err)
	}

	if cfg == nil {
		t.Fatal("Load should return default config")
	}

	// Verify it's the default config
	if cfg.Display.Theme != "classic" {
		t.Error("Returned config should be default")
	}
}

func TestLoad_ValidFile(t *testing.T) {
	// Create temp directory
	tempDir, err := os.MkdirTemp("", "skyspy-config-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Save original value
	origConfigFile := ConfigFile
	ConfigFile = filepath.Join(tempDir, "settings.json")

	defer func() {
		ConfigFile = origConfigFile
	}()

	// Create a custom config file
	customConfig := &Config{
		Display: DisplaySettings{
			Theme:       "amber",
			ShowLabels:  false,
			RefreshRate: 5,
		},
		Connection: ConnectionSettings{
			Host: "example.com",
			Port: 8080,
		},
	}

	data, err := json.Marshal(customConfig)
	if err != nil {
		t.Fatalf("Failed to marshal config: %v", err)
	}

	if err := os.WriteFile(ConfigFile, data, 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Errorf("Load returned error: %v", err)
	}

	if cfg.Display.Theme != "amber" {
		t.Errorf("Display.Theme = %q, want %q", cfg.Display.Theme, "amber")
	}
	if cfg.Display.ShowLabels {
		t.Error("Display.ShowLabels should be false")
	}
	if cfg.Connection.Host != "example.com" {
		t.Errorf("Connection.Host = %q, want %q", cfg.Connection.Host, "example.com")
	}
	if cfg.Connection.Port != 8080 {
		t.Errorf("Connection.Port = %d, want 8080", cfg.Connection.Port)
	}
}

func TestLoad_InvalidJSON(t *testing.T) {
	// Create temp directory
	tempDir, err := os.MkdirTemp("", "skyspy-config-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Save original value
	origConfigFile := ConfigFile
	ConfigFile = filepath.Join(tempDir, "settings.json")

	defer func() {
		ConfigFile = origConfigFile
	}()

	// Write invalid JSON
	if err := os.WriteFile(ConfigFile, []byte("invalid json {{{"), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Errorf("Load should not return error for invalid JSON: %v", err)
	}

	// Should return default config
	if cfg == nil {
		t.Fatal("Load should return default config")
	}
	if cfg.Display.Theme != "classic" {
		t.Error("Returned config should be default")
	}
}

func TestLoad_UnreadableFile(t *testing.T) {
	// Create temp directory
	tempDir, err := os.MkdirTemp("", "skyspy-config-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Save original value
	origConfigFile := ConfigFile
	ConfigFile = filepath.Join(tempDir, "settings.json")

	defer func() {
		ConfigFile = origConfigFile
	}()

	// Create a directory with the same name as the config file
	// This will make ReadFile fail
	if err := os.Mkdir(ConfigFile, 0755); err != nil {
		t.Fatalf("Failed to create directory: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Errorf("Load should not return error: %v", err)
	}

	// Should return default config
	if cfg == nil {
		t.Fatal("Load should return default config")
	}
}

func TestSave(t *testing.T) {
	// Create temp directory
	tempDir, err := os.MkdirTemp("", "skyspy-config-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Save original values
	origConfigDir := ConfigDir
	origConfigFile := ConfigFile
	origOverlaysDir := OverlaysDir

	ConfigDir = filepath.Join(tempDir, "config")
	ConfigFile = filepath.Join(ConfigDir, "settings.json")
	OverlaysDir = filepath.Join(ConfigDir, "overlays")

	defer func() {
		ConfigDir = origConfigDir
		ConfigFile = origConfigFile
		OverlaysDir = origOverlaysDir
	}()

	cfg := DefaultConfig()
	cfg.Display.Theme = "cyberpunk"
	cfg.Connection.Host = "test.example.com"

	err = Save(cfg)
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Verify file was created
	if _, err := os.Stat(ConfigFile); os.IsNotExist(err) {
		t.Error("Config file was not created")
	}

	// Read and verify contents
	data, err := os.ReadFile(ConfigFile)
	if err != nil {
		t.Fatalf("Failed to read config file: %v", err)
	}

	var loaded Config
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("Failed to unmarshal config: %v", err)
	}

	if loaded.Display.Theme != "cyberpunk" {
		t.Errorf("Display.Theme = %q, want %q", loaded.Display.Theme, "cyberpunk")
	}
	if loaded.Connection.Host != "test.example.com" {
		t.Errorf("Connection.Host = %q, want %q", loaded.Connection.Host, "test.example.com")
	}
}

func TestSave_EnsureConfigDirError(t *testing.T) {
	// Save original values
	origConfigDir := ConfigDir
	origConfigFile := ConfigFile
	origOverlaysDir := OverlaysDir

	// Set to invalid path
	ConfigDir = "/invalid\x00/path"
	ConfigFile = "/invalid\x00/path/settings.json"
	OverlaysDir = "/invalid\x00/path/overlays"

	defer func() {
		ConfigDir = origConfigDir
		ConfigFile = origConfigFile
		OverlaysDir = origOverlaysDir
	}()

	err := Save(DefaultConfig())
	if err == nil {
		t.Error("Save should return error when EnsureConfigDir fails")
	}
}

func TestSave_WriteFileError(t *testing.T) {
	// Create temp directory
	tempDir, err := os.MkdirTemp("", "skyspy-config-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Save original values
	origConfigDir := ConfigDir
	origConfigFile := ConfigFile
	origOverlaysDir := OverlaysDir

	ConfigDir = filepath.Join(tempDir, "config")
	OverlaysDir = filepath.Join(ConfigDir, "overlays")
	// Set ConfigFile to a path that will fail (directory instead of file)
	ConfigFile = filepath.Join(ConfigDir, "settings.json")

	// Create the directory structure first
	if err := os.MkdirAll(ConfigDir, 0755); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}

	// Create a directory where the file should be - this will cause WriteFile to fail
	if err := os.MkdirAll(ConfigFile, 0755); err != nil {
		t.Fatalf("Failed to create blocking dir: %v", err)
	}

	defer func() {
		ConfigDir = origConfigDir
		ConfigFile = origConfigFile
		OverlaysDir = origOverlaysDir
	}()

	err = Save(DefaultConfig())
	if err == nil {
		t.Error("Save should return error when WriteFile fails")
	}
}

func TestGetConfigPath(t *testing.T) {
	result := GetConfigPath()
	if result != ConfigFile {
		t.Errorf("GetConfigPath() = %q, want %q", result, ConfigFile)
	}
}

func TestGetOverlaysDir(t *testing.T) {
	// Create temp directory
	tempDir, err := os.MkdirTemp("", "skyspy-config-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Save original values
	origConfigDir := ConfigDir
	origOverlaysDir := OverlaysDir

	ConfigDir = filepath.Join(tempDir, "config")
	OverlaysDir = filepath.Join(ConfigDir, "overlays")

	defer func() {
		ConfigDir = origConfigDir
		OverlaysDir = origOverlaysDir
	}()

	result := GetOverlaysDir()
	if result != OverlaysDir {
		t.Errorf("GetOverlaysDir() = %q, want %q", result, OverlaysDir)
	}

	// Verify directory was created
	if _, err := os.Stat(OverlaysDir); os.IsNotExist(err) {
		t.Error("OverlaysDir was not created")
	}
}

func TestConfigStructs_JSON(t *testing.T) {
	// Test that all structs serialize/deserialize correctly
	cfg := &Config{
		Display: DisplaySettings{
			Theme:           "test",
			ShowLabels:      true,
			ShowTrails:      true,
			RefreshRate:     30,
			CompactMode:     true,
			ShowACARS:       false,
			ShowTargetList:  false,
			ShowVUMeters:    false,
			ShowSpectrum:    false,
			ShowFrequencies: false,
			ShowStatsPanel:  false,
		},
		Radar: RadarSettings{
			DefaultRange: 200,
			RangeRings:   8,
			SweepSpeed:   10,
			ShowCompass:  false,
			ShowGrid:     true,
			ShowOverlays: false,
			OverlayColor: "red",
		},
		Filters: FilterSettings{
			MilitaryOnly: true,
			MinAltitude:  intPtr(1000),
			MaxAltitude:  intPtr(50000),
			MinDistance:  floatPtr(5.0),
			MaxDistance:  floatPtr(100.0),
			HideGround:   true,
		},
		Connection: ConnectionSettings{
			Host:           "192.168.1.1",
			Port:           8080,
			ReceiverLat:    37.7749,
			ReceiverLon:    -122.4194,
			AutoReconnect:  false,
			ReconnectDelay: 10,
		},
		Audio: AudioSettings{
			Enabled:          true,
			NewAircraftSound: false,
			EmergencySound:   false,
			MilitarySound:    true,
		},
		Overlays: OverlaySettings{
			Overlays: []OverlayConfig{
				{
					Path:    "/path/to/overlay.geojson",
					Enabled: true,
					Color:   stringPtr("blue"),
					Name:    stringPtr("Test Overlay"),
					Key:     "test",
				},
			},
			CustomRangeRings: []int{10, 25, 50, 100},
		},
		Export: ExportSettings{
			Directory: "/tmp/export",
		},
		Alerts: AlertSettings{
			Enabled: true,
			Rules: []AlertRuleConfig{
				{
					ID:          "rule1",
					Name:        "Test Rule",
					Description: "A test rule",
					Enabled:     true,
					Conditions: []ConditionConfig{
						{Type: "altitude", Value: ">10000"},
					},
					Actions: []ActionConfig{
						{Type: "sound", Sound: "alert.wav"},
						{Type: "notify", Message: "Aircraft detected"},
					},
					CooldownSec: 60,
					Priority:    1,
				},
			},
			Geofences: []GeofenceConfig{
				{
					ID:          "geo1",
					Name:        "Test Geofence",
					Type:        "polygon",
					Points: []GeofencePointConfig{
						{Lat: 37.0, Lon: -122.0},
						{Lat: 38.0, Lon: -122.0},
						{Lat: 38.0, Lon: -121.0},
					},
					Enabled:     true,
					Description: "A test geofence",
				},
				{
					ID:        "geo2",
					Name:      "Circle Geofence",
					Type:      "circle",
					CenterLat: 37.5,
					CenterLon: -121.5,
					RadiusNM:  10.0,
					Enabled:   false,
				},
			},
			LogFile:  "/tmp/alerts.log",
			SoundDir: "/tmp/sounds",
		},
		RecentHosts: []string{"host1", "host2"},
	}

	// Serialize
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("Failed to marshal config: %v", err)
	}

	// Deserialize
	var loaded Config
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("Failed to unmarshal config: %v", err)
	}

	// Verify key fields
	if loaded.Display.Theme != "test" {
		t.Error("Display.Theme not preserved")
	}
	if loaded.Radar.DefaultRange != 200 {
		t.Error("Radar.DefaultRange not preserved")
	}
	if loaded.Filters.MinAltitude == nil || *loaded.Filters.MinAltitude != 1000 {
		t.Error("Filters.MinAltitude not preserved")
	}
	if loaded.Filters.MaxDistance == nil || *loaded.Filters.MaxDistance != 100.0 {
		t.Error("Filters.MaxDistance not preserved")
	}
	if loaded.Connection.ReceiverLat != 37.7749 {
		t.Error("Connection.ReceiverLat not preserved")
	}
	if len(loaded.Overlays.Overlays) != 1 {
		t.Error("Overlays not preserved")
	}
	if loaded.Overlays.Overlays[0].Color == nil || *loaded.Overlays.Overlays[0].Color != "blue" {
		t.Error("Overlay color not preserved")
	}
	if len(loaded.Alerts.Rules) != 1 {
		t.Error("Alerts.Rules not preserved")
	}
	if len(loaded.Alerts.Rules[0].Conditions) != 1 {
		t.Error("Alert conditions not preserved")
	}
	if len(loaded.Alerts.Rules[0].Actions) != 2 {
		t.Error("Alert actions not preserved")
	}
	if len(loaded.Alerts.Geofences) != 2 {
		t.Error("Geofences not preserved")
	}
	if len(loaded.RecentHosts) != 2 {
		t.Error("RecentHosts not preserved")
	}
}

func TestInit(t *testing.T) {
	// Verify init() set up the package variables
	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Skip("Could not get user home dir")
	}

	expectedConfigDir := filepath.Join(homeDir, ".config", "skyspy")
	expectedConfigFile := filepath.Join(expectedConfigDir, "settings.json")
	expectedOverlaysDir := filepath.Join(expectedConfigDir, "overlays")

	if ConfigDir != expectedConfigDir {
		t.Errorf("ConfigDir = %q, want %q", ConfigDir, expectedConfigDir)
	}
	if ConfigFile != expectedConfigFile {
		t.Errorf("ConfigFile = %q, want %q", ConfigFile, expectedConfigFile)
	}
	if OverlaysDir != expectedOverlaysDir {
		t.Errorf("OverlaysDir = %q, want %q", OverlaysDir, expectedOverlaysDir)
	}
}

// Helper functions
func intPtr(i int) *int {
	return &i
}

func floatPtr(f float64) *float64 {
	return &f
}

func stringPtr(s string) *string {
	return &s
}
