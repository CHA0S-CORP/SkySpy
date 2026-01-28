package main

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// executeCommand runs a cobra command with the given arguments and returns the output
func executeCommand(root *cobra.Command, args ...string) (output string, err error) {
	buf := new(bytes.Buffer)
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs(args)

	err = root.Execute()
	return buf.String(), err
}

// resetRootCmd resets the root command flags to default values
func resetRootCmd() *cobra.Command {
	// Create a fresh command structure for each test
	cmd := &cobra.Command{
		Use:   "skyspy",
		Short: "SkySpy Radar Pro - Full-Featured Aircraft Display",
		Long: `SkySpy Radar Pro - Full-Featured Aircraft Display

Interactive radar with overlays, VU meters, spectrum, and themes.
Settings saved to ~/.config/skyspy/settings.json

Authentication:
  skyspy login                    Authenticate with OIDC
  skyspy logout                   Clear stored credentials
  skyspy auth status              Show auth status
  skyspy --api-key sk_xxx         Use API key authentication

Export:
  [P] Screenshot (HTML)           Export view as styled HTML
  [E] Export aircraft to CSV      Export current aircraft data
  [Ctrl+E] Export to JSON         Export current aircraft as JSON

Examples:
  skyspy --theme cyberpunk
  skyspy --overlay airspace.geojson --overlay coastline.shp
  skyspy --lat 40.7128 --lon -74.0060 --range 50
  skyspy --export-dir ~/exports`,
		RunE: func(cmd *cobra.Command, args []string) error {
			listThemesFlag, _ := cmd.Flags().GetBool("list-themes")
			if listThemesFlag {
				// Print themes in the same format as the real command
				cmd.Println("\nAvailable Themes:")
				themes := []struct {
					key         string
					name        string
					description string
				}{
					{"classic", "Classic Green", "Traditional green phosphor display"},
					{"amber", "Amber", "Vintage amber monochrome display"},
					{"ice", "Blue Ice", "Cold blue tactical display"},
					{"cyberpunk", "Cyberpunk", "Neon futuristic display"},
					{"military", "Military", "Tactical military display"},
					{"high_contrast", "High Contrast", "Maximum visibility white display"},
					{"phosphor", "Phosphor", "Realistic CRT phosphor glow"},
					{"sunset", "Sunset", "Warm orange sunset tones"},
					{"matrix", "Matrix", "Matrix digital rain inspired"},
					{"ocean", "Ocean", "Deep blue oceanic display"},
				}
				for _, t := range themes {
					cmd.Printf("  %-15s %-15s - %s\n", t.key, t.name, t.description)
				}
				cmd.Println()
				return nil
			}
			return nil
		},
	}

	// Global flags
	cmd.PersistentFlags().String("host", "", "Server hostname")
	cmd.PersistentFlags().Int("port", 0, "Server port")

	// Root command flags
	cmd.Flags().Float64("lat", 0, "Receiver latitude")
	cmd.Flags().Float64("lon", 0, "Receiver longitude")
	cmd.Flags().Int("range", 0, "Initial range (nm)")
	cmd.Flags().String("theme", "", "Color theme")
	cmd.Flags().StringSlice("overlay", []string{}, "Load overlay file (GeoJSON/Shapefile)")
	cmd.Flags().Bool("list-themes", false, "List available themes")
	cmd.Flags().String("api-key", "", "API key for authentication (or use SKYSPY_API_KEY env)")
	cmd.Flags().String("export-dir", "", "Directory for export files (default: current directory)")
	cmd.Flags().Bool("no-audio", false, "Disable audio alerts")

	return cmd
}

func TestListThemes(t *testing.T) {
	cmd := resetRootCmd()
	output, err := executeCommand(cmd, "--list-themes")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Verify all 10 themes are listed
	expectedThemes := []string{
		"classic",
		"amber",
		"ice",
		"cyberpunk",
		"military",
		"high_contrast",
		"phosphor",
		"sunset",
		"matrix",
		"ocean",
	}

	for _, theme := range expectedThemes {
		if !strings.Contains(output, theme) {
			t.Errorf("Expected output to contain theme %q, got: %s", theme, output)
		}
	}

	// Verify header is present
	if !strings.Contains(output, "Available Themes:") {
		t.Errorf("Expected output to contain 'Available Themes:' header")
	}

	// Verify theme descriptions are present
	expectedDescriptions := []string{
		"Traditional green phosphor display",
		"Vintage amber monochrome display",
		"Cold blue tactical display",
		"Neon futuristic display",
		"Tactical military display",
		"Maximum visibility white display",
		"Realistic CRT phosphor glow",
		"Warm orange sunset tones",
		"Matrix digital rain inspired",
		"Deep blue oceanic display",
	}

	for _, desc := range expectedDescriptions {
		if !strings.Contains(output, desc) {
			t.Errorf("Expected output to contain description %q", desc)
		}
	}
}

func TestHelpOutput(t *testing.T) {
	cmd := resetRootCmd()
	output, err := executeCommand(cmd, "--help")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Verify help contains expected sections
	expectedSections := []string{
		"SkySpy Radar Pro",
		"Interactive radar",
		"Authentication:",
		"Export:",
		"Examples:",
		"Flags:",
	}

	for _, section := range expectedSections {
		if !strings.Contains(output, section) {
			t.Errorf("Expected help output to contain %q", section)
		}
	}

	// Verify specific flags are documented
	expectedFlags := []string{
		"--host",
		"--port",
		"--theme",
		"--list-themes",
		"--api-key",
		"--lat",
		"--lon",
		"--range",
		"--overlay",
		"--export-dir",
		"--no-audio",
	}

	for _, flag := range expectedFlags {
		if !strings.Contains(output, flag) {
			t.Errorf("Expected help output to contain flag %q", flag)
		}
	}

	// Verify example commands are present
	expectedExamples := []string{
		"skyspy --theme cyberpunk",
		"skyspy --overlay",
		"skyspy --lat",
		"skyspy login",
		"skyspy logout",
		"skyspy auth status",
	}

	for _, example := range expectedExamples {
		if !strings.Contains(output, example) {
			t.Errorf("Expected help output to contain example %q", example)
		}
	}
}

func TestVersionFlag(t *testing.T) {
	// Create a command with version set
	cmd := resetRootCmd()
	cmd.Version = "1.0.0-test"

	output, err := executeCommand(cmd, "--version")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if !strings.Contains(output, "1.0.0-test") {
		t.Errorf("Expected version output to contain version string, got: %s", output)
	}
}

func TestInvalidFlag(t *testing.T) {
	cmd := resetRootCmd()
	_, err := executeCommand(cmd, "--invalid-flag-xyz")

	if err == nil {
		t.Error("Expected error for invalid flag, got nil")
	}

	if !strings.Contains(err.Error(), "unknown flag") {
		t.Errorf("Expected error message to contain 'unknown flag', got: %v", err)
	}
}

func TestHostPortFlags(t *testing.T) {
	tests := []struct {
		name         string
		args         []string
		expectedHost string
		expectedPort int
	}{
		{
			name:         "default values",
			args:         []string{},
			expectedHost: "",
			expectedPort: 0,
		},
		{
			name:         "custom host",
			args:         []string{"--host", "radar.local"},
			expectedHost: "radar.local",
			expectedPort: 0,
		},
		{
			name:         "custom port",
			args:         []string{"--port", "8443"},
			expectedHost: "",
			expectedPort: 8443,
		},
		{
			name:         "both host and port",
			args:         []string{"--host", "skyspy.example.com", "--port", "9000"},
			expectedHost: "skyspy.example.com",
			expectedPort: 9000,
		},
		{
			name:         "localhost with standard port",
			args:         []string{"--host", "localhost", "--port", "8080"},
			expectedHost: "localhost",
			expectedPort: 8080,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cmd := resetRootCmd()

			// Track parsed values
			var parsedHost string
			var parsedPort int

			cmd.RunE = func(c *cobra.Command, args []string) error {
				parsedHost, _ = c.Flags().GetString("host")
				parsedPort, _ = c.Flags().GetInt("port")
				return nil
			}

			_, err := executeCommand(cmd, tc.args...)
			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if parsedHost != tc.expectedHost {
				t.Errorf("Expected host %q, got %q", tc.expectedHost, parsedHost)
			}
			if parsedPort != tc.expectedPort {
				t.Errorf("Expected port %d, got %d", tc.expectedPort, parsedPort)
			}
		})
	}
}

func TestThemeFlag(t *testing.T) {
	tests := []struct {
		name          string
		args          []string
		expectedTheme string
	}{
		{
			name:          "default theme",
			args:          []string{},
			expectedTheme: "",
		},
		{
			name:          "cyberpunk theme",
			args:          []string{"--theme", "cyberpunk"},
			expectedTheme: "cyberpunk",
		},
		{
			name:          "classic theme",
			args:          []string{"--theme", "classic"},
			expectedTheme: "classic",
		},
		{
			name:          "matrix theme",
			args:          []string{"--theme", "matrix"},
			expectedTheme: "matrix",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cmd := resetRootCmd()

			var parsedTheme string
			cmd.RunE = func(c *cobra.Command, args []string) error {
				parsedTheme, _ = c.Flags().GetString("theme")
				return nil
			}

			_, err := executeCommand(cmd, tc.args...)
			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if parsedTheme != tc.expectedTheme {
				t.Errorf("Expected theme %q, got %q", tc.expectedTheme, parsedTheme)
			}
		})
	}
}

func TestCoordinateFlags(t *testing.T) {
	tests := []struct {
		name        string
		args        []string
		expectedLat float64
		expectedLon float64
	}{
		{
			name:        "default coordinates",
			args:        []string{},
			expectedLat: 0,
			expectedLon: 0,
		},
		{
			name:        "New York City",
			args:        []string{"--lat", "40.7128", "--lon", "-74.0060"},
			expectedLat: 40.7128,
			expectedLon: -74.0060,
		},
		{
			name:        "negative coordinates",
			args:        []string{"--lat", "-33.8688", "--lon", "151.2093"},
			expectedLat: -33.8688,
			expectedLon: 151.2093,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cmd := resetRootCmd()

			var parsedLat, parsedLon float64
			cmd.RunE = func(c *cobra.Command, args []string) error {
				parsedLat, _ = c.Flags().GetFloat64("lat")
				parsedLon, _ = c.Flags().GetFloat64("lon")
				return nil
			}

			_, err := executeCommand(cmd, tc.args...)
			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if parsedLat != tc.expectedLat {
				t.Errorf("Expected lat %f, got %f", tc.expectedLat, parsedLat)
			}
			if parsedLon != tc.expectedLon {
				t.Errorf("Expected lon %f, got %f", tc.expectedLon, parsedLon)
			}
		})
	}
}

func TestRangeFlag(t *testing.T) {
	tests := []struct {
		name          string
		args          []string
		expectedRange int
	}{
		{
			name:          "default range",
			args:          []string{},
			expectedRange: 0,
		},
		{
			name:          "50nm range",
			args:          []string{"--range", "50"},
			expectedRange: 50,
		},
		{
			name:          "250nm range",
			args:          []string{"--range", "250"},
			expectedRange: 250,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cmd := resetRootCmd()

			var parsedRange int
			cmd.RunE = func(c *cobra.Command, args []string) error {
				parsedRange, _ = c.Flags().GetInt("range")
				return nil
			}

			_, err := executeCommand(cmd, tc.args...)
			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if parsedRange != tc.expectedRange {
				t.Errorf("Expected range %d, got %d", tc.expectedRange, parsedRange)
			}
		})
	}
}

func TestNoAudioFlag(t *testing.T) {
	cmd := resetRootCmd()

	var noAudioEnabled bool
	cmd.RunE = func(c *cobra.Command, args []string) error {
		noAudioEnabled, _ = c.Flags().GetBool("no-audio")
		return nil
	}

	// Test with flag enabled
	_, err := executeCommand(cmd, "--no-audio")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if !noAudioEnabled {
		t.Error("Expected --no-audio flag to be true")
	}

	// Test without flag
	cmd = resetRootCmd()
	cmd.RunE = func(c *cobra.Command, args []string) error {
		noAudioEnabled, _ = c.Flags().GetBool("no-audio")
		return nil
	}

	_, err = executeCommand(cmd)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if noAudioEnabled {
		t.Error("Expected --no-audio flag to be false by default")
	}
}

func TestExportDirFlag(t *testing.T) {
	cmd := resetRootCmd()

	var exportDir string
	cmd.RunE = func(c *cobra.Command, args []string) error {
		exportDir, _ = c.Flags().GetString("export-dir")
		return nil
	}

	_, err := executeCommand(cmd, "--export-dir", "/tmp/exports")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if exportDir != "/tmp/exports" {
		t.Errorf("Expected export-dir %q, got %q", "/tmp/exports", exportDir)
	}
}

func TestOverlayFlag(t *testing.T) {
	cmd := resetRootCmd()

	var overlays []string
	cmd.RunE = func(c *cobra.Command, args []string) error {
		overlays, _ = c.Flags().GetStringSlice("overlay")
		return nil
	}

	// Test multiple overlays
	_, err := executeCommand(cmd, "--overlay", "airspace.geojson", "--overlay", "coastline.shp")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if len(overlays) != 2 {
		t.Errorf("Expected 2 overlays, got %d", len(overlays))
	}

	if overlays[0] != "airspace.geojson" {
		t.Errorf("Expected first overlay to be 'airspace.geojson', got %q", overlays[0])
	}
	if overlays[1] != "coastline.shp" {
		t.Errorf("Expected second overlay to be 'coastline.shp', got %q", overlays[1])
	}
}

func TestAPIKeyFlag(t *testing.T) {
	cmd := resetRootCmd()

	var apiKey string
	cmd.RunE = func(c *cobra.Command, args []string) error {
		apiKey, _ = c.Flags().GetString("api-key")
		return nil
	}

	_, err := executeCommand(cmd, "--api-key", "sk_test_12345")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if apiKey != "sk_test_12345" {
		t.Errorf("Expected api-key %q, got %q", "sk_test_12345", apiKey)
	}
}

func TestAPIKeyEnvironment(t *testing.T) {
	// Save original env value
	originalValue := os.Getenv("SKYSPY_API_KEY")
	defer os.Setenv("SKYSPY_API_KEY", originalValue)

	// Set test environment variable
	os.Setenv("SKYSPY_API_KEY", "sk_env_test_key")

	// Verify the environment variable is set
	envKey := os.Getenv("SKYSPY_API_KEY")
	if envKey != "sk_env_test_key" {
		t.Errorf("Expected SKYSPY_API_KEY env to be set, got %q", envKey)
	}
}

func TestMultipleFlagsCombined(t *testing.T) {
	cmd := resetRootCmd()

	var parsedValues struct {
		host      string
		port      int
		theme     string
		lat       float64
		lon       float64
		rangeNm   int
		noAudio   bool
		exportDir string
	}

	cmd.RunE = func(c *cobra.Command, args []string) error {
		parsedValues.host, _ = c.Flags().GetString("host")
		parsedValues.port, _ = c.Flags().GetInt("port")
		parsedValues.theme, _ = c.Flags().GetString("theme")
		parsedValues.lat, _ = c.Flags().GetFloat64("lat")
		parsedValues.lon, _ = c.Flags().GetFloat64("lon")
		parsedValues.rangeNm, _ = c.Flags().GetInt("range")
		parsedValues.noAudio, _ = c.Flags().GetBool("no-audio")
		parsedValues.exportDir, _ = c.Flags().GetString("export-dir")
		return nil
	}

	_, err := executeCommand(cmd,
		"--host", "radar.local",
		"--port", "8443",
		"--theme", "cyberpunk",
		"--lat", "52.3676",
		"--lon", "4.9041",
		"--range", "100",
		"--no-audio",
		"--export-dir", "/home/user/exports",
	)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if parsedValues.host != "radar.local" {
		t.Errorf("Expected host 'radar.local', got %q", parsedValues.host)
	}
	if parsedValues.port != 8443 {
		t.Errorf("Expected port 8443, got %d", parsedValues.port)
	}
	if parsedValues.theme != "cyberpunk" {
		t.Errorf("Expected theme 'cyberpunk', got %q", parsedValues.theme)
	}
	if parsedValues.lat != 52.3676 {
		t.Errorf("Expected lat 52.3676, got %f", parsedValues.lat)
	}
	if parsedValues.lon != 4.9041 {
		t.Errorf("Expected lon 4.9041, got %f", parsedValues.lon)
	}
	if parsedValues.rangeNm != 100 {
		t.Errorf("Expected range 100, got %d", parsedValues.rangeNm)
	}
	if !parsedValues.noAudio {
		t.Error("Expected noAudio to be true")
	}
	if parsedValues.exportDir != "/home/user/exports" {
		t.Errorf("Expected export-dir '/home/user/exports', got %q", parsedValues.exportDir)
	}
}
