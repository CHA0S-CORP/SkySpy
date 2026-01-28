// Package config handles configuration loading, saving, and defaults for SkySpy CLI
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config directories and files
var (
	ConfigDir    string
	ConfigFile   string
	OverlaysDir  string
)

func init() {
	homeDir, _ := os.UserHomeDir()
	ConfigDir = filepath.Join(homeDir, ".config", "skyspy")
	ConfigFile = filepath.Join(ConfigDir, "settings.json")
	OverlaysDir = filepath.Join(ConfigDir, "overlays")
}

// DisplaySettings contains UI display options
type DisplaySettings struct {
	Theme          string `json:"theme"`
	ShowLabels     bool   `json:"show_labels"`
	ShowTrails     bool   `json:"show_trails"`
	RefreshRate    int    `json:"refresh_rate"`
	CompactMode    bool   `json:"compact_mode"`
	ShowACARS      bool   `json:"show_acars"`
	ShowTargetList bool   `json:"show_target_list"`
	ShowVUMeters   bool   `json:"show_vu_meters"`
	ShowSpectrum   bool   `json:"show_spectrum"`
	ShowFrequencies bool  `json:"show_frequencies"`
	ShowStatsPanel bool   `json:"show_stats_panel"`
}

// RadarSettings contains radar scope options
type RadarSettings struct {
	DefaultRange int    `json:"default_range"`
	RangeRings   int    `json:"range_rings"`
	SweepSpeed   int    `json:"sweep_speed"`
	ShowCompass  bool   `json:"show_compass"`
	ShowGrid     bool   `json:"show_grid"`
	ShowOverlays bool   `json:"show_overlays"`
	OverlayColor string `json:"overlay_color"`
}

// FilterSettings contains aircraft filter options
type FilterSettings struct {
	MilitaryOnly bool    `json:"military_only"`
	MinAltitude  *int    `json:"min_altitude,omitempty"`
	MaxAltitude  *int    `json:"max_altitude,omitempty"`
	MinDistance  *float64 `json:"min_distance,omitempty"`
	MaxDistance  *float64 `json:"max_distance,omitempty"`
	HideGround   bool    `json:"hide_ground"`
}

// ConnectionSettings contains server connection options
type ConnectionSettings struct {
	Host           string  `json:"host"`
	Port           int     `json:"port"`
	ReceiverLat    float64 `json:"receiver_lat"`
	ReceiverLon    float64 `json:"receiver_lon"`
	AutoReconnect  bool    `json:"auto_reconnect"`
	ReconnectDelay int     `json:"reconnect_delay"`
}

// AudioSettings contains audio feedback options
type AudioSettings struct {
	Enabled          bool `json:"enabled"`
	NewAircraftSound bool `json:"new_aircraft_sound"`
	EmergencySound   bool `json:"emergency_sound"`
	MilitarySound    bool `json:"military_sound"`
}

// OverlayConfig represents a single overlay configuration
type OverlayConfig struct {
	Path    string  `json:"path"`
	Enabled bool    `json:"enabled"`
	Color   *string `json:"color,omitempty"`
	Name    *string `json:"name,omitempty"`
	Key     string  `json:"key,omitempty"`
}

// OverlaySettings contains overlay management options
type OverlaySettings struct {
	Overlays         []OverlayConfig `json:"overlays"`
	CustomRangeRings []int           `json:"custom_range_rings"`
}

// ExportSettings contains export options
type ExportSettings struct {
	Directory string `json:"directory"`
}

// ConditionConfig represents a condition in configuration
type ConditionConfig struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// ActionConfig represents an action in configuration
type ActionConfig struct {
	Type    string `json:"type"`
	Message string `json:"message,omitempty"`
	Sound   string `json:"sound,omitempty"`
}

// AlertRuleConfig represents an alert rule in configuration
type AlertRuleConfig struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Enabled     bool              `json:"enabled"`
	Conditions  []ConditionConfig `json:"conditions"`
	Actions     []ActionConfig    `json:"actions"`
	CooldownSec int               `json:"cooldown_sec"`
	Priority    int               `json:"priority"`
}

// GeofencePointConfig represents a coordinate in configuration
type GeofencePointConfig struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// GeofenceConfig represents a geofence in configuration
type GeofenceConfig struct {
	ID          string                `json:"id"`
	Name        string                `json:"name"`
	Type        string                `json:"type"`
	Points      []GeofencePointConfig `json:"points,omitempty"`
	CenterLat   float64               `json:"center_lat,omitempty"`
	CenterLon   float64               `json:"center_lon,omitempty"`
	RadiusNM    float64               `json:"radius_nm,omitempty"`
	Enabled     bool                  `json:"enabled"`
	Description string                `json:"description,omitempty"`
}

// AlertSettings contains alert configuration options
type AlertSettings struct {
	Enabled   bool              `json:"enabled"`
	Rules     []AlertRuleConfig `json:"rules"`
	Geofences []GeofenceConfig  `json:"geofences"`
	LogFile   string            `json:"log_file,omitempty"`
	SoundDir  string            `json:"sound_dir,omitempty"`
}

// Config is the main configuration container
type Config struct {
	Display     DisplaySettings    `json:"display"`
	Radar       RadarSettings      `json:"radar"`
	Filters     FilterSettings     `json:"filters"`
	Connection  ConnectionSettings `json:"connection"`
	Audio       AudioSettings      `json:"audio"`
	Overlays    OverlaySettings    `json:"overlays"`
	Export      ExportSettings     `json:"export"`
	Alerts      AlertSettings      `json:"alerts"`
	RecentHosts []string           `json:"recent_hosts"`
}

// DefaultConfig returns a new Config with default values
func DefaultConfig() *Config {
	return &Config{
		Display: DisplaySettings{
			Theme:          "classic",
			ShowLabels:     true,
			ShowTrails:     false,
			RefreshRate:    10,
			CompactMode:    false,
			ShowACARS:      true,
			ShowTargetList: true,
			ShowVUMeters:   true,
			ShowSpectrum:   true,
			ShowFrequencies: true,
			ShowStatsPanel: true,
		},
		Radar: RadarSettings{
			DefaultRange: 100,
			RangeRings:   4,
			SweepSpeed:   6,
			ShowCompass:  true,
			ShowGrid:     false,
			ShowOverlays: true,
			OverlayColor: "cyan",
		},
		Filters: FilterSettings{
			MilitaryOnly: false,
			HideGround:   false,
		},
		Connection: ConnectionSettings{
			Host:           "localhost",
			Port:           80,
			ReceiverLat:    0.0,
			ReceiverLon:    0.0,
			AutoReconnect:  true,
			ReconnectDelay: 2,
		},
		Audio: AudioSettings{
			Enabled:          false,
			NewAircraftSound: true,
			EmergencySound:   true,
			MilitarySound:    false,
		},
		Overlays: OverlaySettings{
			Overlays:         []OverlayConfig{},
			CustomRangeRings: []int{},
		},
		Export: ExportSettings{
			Directory: "",
		},
		Alerts: AlertSettings{
			Enabled:   true,
			Rules:     []AlertRuleConfig{},
			Geofences: []GeofenceConfig{},
			LogFile:   "",
			SoundDir:  "",
		},
		RecentHosts: []string{},
	}
}

// EnsureConfigDir creates config directories if they don't exist
func EnsureConfigDir() error {
	if err := os.MkdirAll(ConfigDir, 0755); err != nil {
		return err
	}
	return os.MkdirAll(OverlaysDir, 0755)
}

// Load loads configuration from file or returns defaults
func Load() (*Config, error) {
	if _, err := os.Stat(ConfigFile); os.IsNotExist(err) {
		return DefaultConfig(), nil
	}

	data, err := os.ReadFile(ConfigFile)
	if err != nil {
		return DefaultConfig(), nil
	}

	config := DefaultConfig()
	if err := json.Unmarshal(data, config); err != nil {
		return DefaultConfig(), nil
	}

	return config, nil
}

// Save saves configuration to file
func Save(config *Config) error {
	if err := EnsureConfigDir(); err != nil {
		return err
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(ConfigFile, data, 0644)
}

// GetConfigPath returns the config file path
func GetConfigPath() string {
	return ConfigFile
}

// GetOverlaysDir returns the overlays directory path
func GetOverlaysDir() string {
	_ = EnsureConfigDir()
	return OverlaysDir
}
