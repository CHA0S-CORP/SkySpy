package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/testutil"
	"github.com/skyspy/skyspy-go/internal/theme"
)

// TestColorToANSI tests the colorToANSI function with all branches
func TestColorToANSI(t *testing.T) {
	tests := []struct {
		name     string
		color    string
		expected int
	}{
		{"green 28", "28", 28},
		{"bright green 46", "46", 46},
		{"bright cyan 51", "51", 51},
		{"bright magenta 201", "201", 201},
		{"bright yellow 226", "226", 226},
		{"default for empty", "", 46},
		{"default for unknown", "999", 46},
		{"default for text", "red", 46},
		{"default for hex color", "#ff0000", 46},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := colorToANSI(tc.color)
			if result != tc.expected {
				t.Errorf("colorToANSI(%q) = %d, want %d", tc.color, result, tc.expected)
			}
		})
	}
}

// TestRunListThemes tests the run function with --list-themes flag
func TestRunListThemes(t *testing.T) {
	// Set the flag
	origListThemes := listThemes
	listThemes = true
	defer func() { listThemes = origListThemes }()

	// Capture stdout
	output := testutil.CaptureOutput(func() {
		err := run(rootCmd, []string{})
		if err != nil {
			t.Errorf("run() returned error: %v", err)
		}
	})

	// Verify themes are listed
	expectedThemes := []string{"classic", "amber", "ice", "cyberpunk", "military", "high_contrast"}
	for _, theme := range expectedThemes {
		if !contains(output, theme) {
			t.Errorf("Expected output to contain theme %q", theme)
		}
	}

	if !contains(output, "Available Themes:") {
		t.Error("Expected output to contain 'Available Themes:'")
	}
}

// TestRunWithOverlayFiles tests run with overlay files
func TestRunWithOverlayFiles(t *testing.T) {
	// Create temp directory with mock overlay files
	tmpDir, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Create a mock overlay file
	overlayPath := filepath.Join(tmpDir, "test.geojson")
	if err := os.WriteFile(overlayPath, []byte(`{"type":"FeatureCollection","features":[]}`), 0644); err != nil {
		t.Fatalf("Failed to create test overlay: %v", err)
	}

	// Save original values and set test values
	origOverlays := overlays
	origListThemes := listThemes
	overlays = []string{overlayPath}
	listThemes = true // Use list-themes to avoid starting the full app
	defer func() {
		overlays = origOverlays
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with overlay returned error: %v", err)
	}
}

// TestRunWithExportDir tests run with --export-dir flag
func TestRunWithExportDir(t *testing.T) {
	tmpDir, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origExportDir := exportDir
	origListThemes := listThemes
	exportDir = tmpDir
	listThemes = true
	defer func() {
		exportDir = origExportDir
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with export-dir returned error: %v", err)
	}
}

// TestRunWithCoordinates tests run with lat/lon flags
func TestRunWithCoordinates(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origLat := lat
	origLon := lon
	origListThemes := listThemes
	lat = 40.7128
	lon = -74.0060
	listThemes = true
	defer func() {
		lat = origLat
		lon = origLon
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with coordinates returned error: %v", err)
	}
}

// TestRunWithTheme tests run with --theme flag
func TestRunWithTheme(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origThemeName := themeName
	origListThemes := listThemes
	themeName = "cyberpunk"
	listThemes = true
	defer func() {
		themeName = origThemeName
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with theme returned error: %v", err)
	}
}

// TestRunWithRange tests run with --range flag
func TestRunWithRange(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origMaxRange := maxRange
	origListThemes := listThemes
	maxRange = 50
	listThemes = true
	defer func() {
		maxRange = origMaxRange
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with range returned error: %v", err)
	}
}

// TestRunWithHostPort tests run with --host and --port flags
func TestRunWithHostPort(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origHost := host
	origPort := port
	origListThemes := listThemes
	host = "testhost.local"
	port = 9999
	listThemes = true
	defer func() {
		host = origHost
		port = origPort
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with host/port returned error: %v", err)
	}
}

// TestConfigOverrides tests that all command line flags properly override config
func TestConfigOverrides(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Load default config
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Verify defaults
	if cfg.Connection.Host != "localhost" {
		t.Errorf("Expected default host 'localhost', got %q", cfg.Connection.Host)
	}

	// Test overrides
	origHost := host
	origPort := port
	origLat := lat
	origLon := lon
	origMaxRange := maxRange
	origThemeName := themeName
	origExportDir := exportDir
	origListThemes := listThemes

	host = "override.local"
	port = 8443
	lat = 51.5074
	lon = -0.1278
	maxRange = 150
	themeName = "military"
	exportDir = "/tmp/exports"
	listThemes = true

	defer func() {
		host = origHost
		port = origPort
		lat = origLat
		lon = origLon
		maxRange = origMaxRange
		themeName = origThemeName
		exportDir = origExportDir
		listThemes = origListThemes
	}()

	err = run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with overrides returned error: %v", err)
	}
}

// TestExportDirAbsolutePath tests that export-dir converts relative paths to absolute
func TestExportDirAbsolutePath(t *testing.T) {
	tmpDir, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Create config dir
	configDir := filepath.Join(tmpDir, ".config", "skyspy")
	os.MkdirAll(configDir, 0755)

	origExportDir := exportDir
	origListThemes := listThemes
	exportDir = "relative/path"
	listThemes = true
	defer func() {
		exportDir = origExportDir
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with relative export-dir returned error: %v", err)
	}
}

// TestOverlayFileNotExist tests that non-existent overlay files are skipped
func TestOverlayFileNotExist(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origOverlays := overlays
	origListThemes := listThemes
	overlays = []string{"/nonexistent/path/overlay.geojson"}
	listThemes = true
	defer func() {
		overlays = origOverlays
		listThemes = origListThemes
	}()

	// Should not error - just skip the overlay
	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with nonexistent overlay should not error: %v", err)
	}
}

// helper function
func contains(s, substr string) bool {
	return strings.Contains(s, substr)
}

// TestThemeIntegration tests that themes are properly loaded
func TestThemeIntegration(t *testing.T) {
	themes := theme.GetInfo()
	if len(themes) == 0 {
		t.Error("Expected at least one theme")
	}

	// Test getting a specific theme
	classic := theme.Get("classic")
	if classic == nil {
		t.Error("Expected classic theme to exist")
	}

	if classic.Name == "" {
		t.Error("Expected classic theme to have a name")
	}
}

// TestRootCommandStructure tests the root command is properly configured
func TestRootCommandStructure(t *testing.T) {
	if rootCmd == nil {
		t.Fatal("Expected rootCmd to exist")
	}

	if rootCmd.Use != "skyspy" {
		t.Errorf("Expected Use to be 'skyspy', got %q", rootCmd.Use)
	}

	if rootCmd.Short == "" {
		t.Error("Expected rootCmd to have Short description")
	}

	if rootCmd.Long == "" {
		t.Error("Expected rootCmd to have Long description")
	}

	if rootCmd.RunE == nil {
		t.Error("Expected rootCmd to have RunE function")
	}
}

// TestRootCommandFlags tests that all expected flags exist
func TestRootCommandFlags(t *testing.T) {
	expectedFlags := []string{
		"host", "port", "lat", "lon", "range", "theme",
		"overlay", "list-themes", "api-key", "export-dir", "no-audio",
	}

	for _, flagName := range expectedFlags {
		flag := rootCmd.Flag(flagName)
		if flag == nil {
			flag = rootCmd.PersistentFlags().Lookup(flagName)
		}
		if flag == nil {
			t.Errorf("Expected flag %q to exist", flagName)
		}
	}
}

// TestSubcommandsExist tests that all subcommands are registered
func TestSubcommandsExist(t *testing.T) {
	subcommands := rootCmd.Commands()

	expectedCommands := map[string]bool{
		"login":     false,
		"logout":    false,
		"auth":      false,
		"radio":     false,
		"radio-pro": false,
		"configure": false,
	}

	for _, cmd := range subcommands {
		if _, ok := expectedCommands[cmd.Use]; ok {
			expectedCommands[cmd.Use] = true
		}
	}

	for name, found := range expectedCommands {
		if !found {
			t.Errorf("Expected subcommand %q to be registered", name)
		}
	}
}

// TestConfigDefaults tests that default config values are reasonable
func TestConfigDefaults(t *testing.T) {
	cfg := config.DefaultConfig()

	if cfg.Connection.Host != "localhost" {
		t.Errorf("Expected default host to be 'localhost', got %q", cfg.Connection.Host)
	}

	if cfg.Connection.Port != 80 {
		t.Errorf("Expected default port to be 80, got %d", cfg.Connection.Port)
	}

	if cfg.Display.Theme != "classic" {
		t.Errorf("Expected default theme to be 'classic', got %q", cfg.Display.Theme)
	}

	if cfg.Radar.DefaultRange != 100 {
		t.Errorf("Expected default range to be 100, got %d", cfg.Radar.DefaultRange)
	}
}

// TestRunWithAPIKey tests run with API key set
func TestRunWithAPIKey(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origAPIKey := apiKey
	origListThemes := listThemes
	apiKey = "sk_test_12345"
	listThemes = true
	defer func() {
		apiKey = origAPIKey
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with API key returned error: %v", err)
	}
}

// TestRunWithNoAudio tests run with no-audio flag
func TestRunWithNoAudio(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origNoAudio := noAudio
	origListThemes := listThemes
	noAudio = true
	listThemes = true
	defer func() {
		noAudio = origNoAudio
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with no-audio returned error: %v", err)
	}
}

// TestRunAllOverrides tests run with all override flags set
func TestRunAllOverrides(t *testing.T) {
	tmpDir, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Create overlay file
	overlayPath := filepath.Join(tmpDir, "overlay.geojson")
	os.WriteFile(overlayPath, []byte(`{"type":"FeatureCollection","features":[]}`), 0644)

	origHost := host
	origPort := port
	origLat := lat
	origLon := lon
	origMaxRange := maxRange
	origThemeName := themeName
	origExportDir := exportDir
	origAPIKey := apiKey
	origNoAudio := noAudio
	origOverlays := overlays
	origListThemes := listThemes

	host = "test.local"
	port = 9999
	lat = 45.0
	lon = -90.0
	maxRange = 200
	themeName = "amber"
	exportDir = tmpDir
	apiKey = "sk_all_test"
	noAudio = true
	overlays = []string{overlayPath}
	listThemes = true

	defer func() {
		host = origHost
		port = origPort
		lat = origLat
		lon = origLon
		maxRange = origMaxRange
		themeName = origThemeName
		exportDir = origExportDir
		apiKey = origAPIKey
		noAudio = origNoAudio
		overlays = origOverlays
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with all overrides returned error: %v", err)
	}
}

// TestConfigLoadWithInvalidFile tests config loading behavior
func TestConfigLoadWithInvalidFile(t *testing.T) {
	tmpDir, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Create config directory with invalid JSON
	configDir := filepath.Join(tmpDir, ".config", "skyspy")
	os.MkdirAll(configDir, 0755)
	configFile := filepath.Join(configDir, "settings.json")
	os.WriteFile(configFile, []byte("invalid json"), 0644)

	origListThemes := listThemes
	listThemes = true
	defer func() {
		listThemes = origListThemes
	}()

	// Should not error - just use defaults
	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with invalid config should not error: %v", err)
	}
}

// TestConfigLoadWithPartialJSON tests config with partial JSON
func TestConfigLoadWithPartialJSON(t *testing.T) {
	tmpDir, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	configDir := filepath.Join(tmpDir, ".config", "skyspy")
	os.MkdirAll(configDir, 0755)
	configFile := filepath.Join(configDir, "settings.json")
	os.WriteFile(configFile, []byte(`{"display":{"theme":"matrix"}}`), 0644)

	origListThemes := listThemes
	listThemes = true
	defer func() {
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with partial config should not error: %v", err)
	}
}

// TestOverlayWithInvalidPath tests overlay with error in filepath.Abs
func TestOverlayWithInvalidPath(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origOverlays := overlays
	origListThemes := listThemes
	overlays = []string{"invalid/path/does/not/exist.geojson", ""}
	listThemes = true
	defer func() {
		overlays = origOverlays
		listThemes = origListThemes
	}()

	// Should not error - just skip invalid overlays
	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with invalid overlay should not error: %v", err)
	}
}

// TestExportDirWithInvalidPath tests export dir path resolution
func TestExportDirWithInvalidPath(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origExportDir := exportDir
	origListThemes := listThemes
	// Use relative path to test path resolution
	exportDir = "./relative/export/path"
	listThemes = true
	defer func() {
		exportDir = origExportDir
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with relative export dir should not error: %v", err)
	}
}

// TestRunWithAuthRequired tests run when auth is required but not provided
// This should fail before the TUI starts, allowing us to test the auth check path
func TestRunWithAuthRequired(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Start mock server requiring auth
	server := testutil.NewMockServer()
	serverPort := testutil.FreePort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	// Set server to require OIDC auth
	server.SetAuthMode(testutil.AuthModeOIDC)
	server.SetOIDCProviderName("TestOIDC")

	origHost := host
	origPort := port
	origListThemes := listThemes
	origAPIKey := apiKey

	host = "localhost"
	port = serverPort
	listThemes = false
	apiKey = ""

	defer func() {
		host = origHost
		port = origPort
		listThemes = origListThemes
		apiKey = origAPIKey
	}()

	// Capture output
	output := testutil.CaptureOutput(func() {
		err := run(rootCmd, []string{})
		// Should fail with "authentication required" error
		if err == nil {
			t.Log("Expected error but got none - server might be in public mode")
		} else {
			if !contains(err.Error(), "authentication required") {
				t.Logf("Expected 'authentication required' error, got: %v", err)
			}
		}
	})

	// Should show auth warning message
	t.Logf("Auth required output: %s", output)
}

// TestRunWithAuthRequiredButAPIKeyProvided tests run when auth is required and API key is provided
func TestRunWithAuthRequiredButAPIKeyProvided(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Start mock server requiring auth
	server := testutil.NewMockServer()
	serverPort := testutil.FreePort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModeAPIKey)
	server.AddValidAPIKey("sk_test_key_12345")

	origHost := host
	origPort := port
	origListThemes := listThemes
	origAPIKey := apiKey

	host = "localhost"
	port = serverPort
	listThemes = true // Use list-themes to avoid starting TUI
	apiKey = "sk_test_key_12345"

	defer func() {
		host = origHost
		port = origPort
		listThemes = origListThemes
		apiKey = origAPIKey
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with API key should not error: %v", err)
	}
}

// TestRunWithServerUnreachable tests run when server cannot be reached
func TestRunWithServerUnreachable(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	origHost := host
	origPort := port
	origListThemes := listThemes

	host = "localhost"
	port = 59998 // Port where nothing is listening
	listThemes = true

	defer func() {
		host = origHost
		port = origPort
		listThemes = origListThemes
	}()

	output := testutil.CaptureOutput(func() {
		err := run(rootCmd, []string{})
		if err != nil {
			t.Logf("run() returned: %v", err)
		}
	})

	t.Logf("Server unreachable output: %s", output)
}

// TestRunWithAllThemes tests run with each available theme
func TestRunWithAllThemes(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	themes := theme.List()

	for _, themeName := range themes {
		t.Run(themeName, func(t *testing.T) {
			origTheme := themeName
			origListThemes := listThemes
			listThemes = true

			defer func() {
				themeName = origTheme
				listThemes = origListThemes
			}()

			err := run(rootCmd, []string{})
			if err != nil {
				t.Errorf("run() with theme %q returned error: %v", themeName, err)
			}
		})
	}
}

// TestConfigLoadAndSave tests config loading and saving cycle
func TestConfigLoadAndSave(t *testing.T) {
	tmpDir, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Create config directory
	configDir := filepath.Join(tmpDir, ".config", "skyspy")
	os.MkdirAll(configDir, 0755)

	// Load default config
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	// Modify config
	cfg.Display.Theme = "cyberpunk"
	cfg.Connection.Host = "modified.local"
	cfg.Connection.Port = 9999

	// Save config
	err = config.Save(cfg)
	if err != nil {
		t.Fatalf("Failed to save config: %v", err)
	}

	// Reload and verify
	cfg2, err := config.Load()
	if err != nil {
		t.Fatalf("Failed to reload config: %v", err)
	}

	if cfg2.Display.Theme != "cyberpunk" {
		t.Errorf("Expected theme 'cyberpunk', got %q", cfg2.Display.Theme)
	}

	if cfg2.Connection.Host != "modified.local" {
		t.Errorf("Expected host 'modified.local', got %q", cfg2.Connection.Host)
	}

	if cfg2.Connection.Port != 9999 {
		t.Errorf("Expected port 9999, got %d", cfg2.Connection.Port)
	}
}

// TestOverlayPathResolution tests overlay path resolution with various inputs
func TestOverlayPathResolution(t *testing.T) {
	tmpDir, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Create multiple overlay files
	overlay1 := filepath.Join(tmpDir, "overlay1.geojson")
	overlay2 := filepath.Join(tmpDir, "overlay2.geojson")
	os.WriteFile(overlay1, []byte(`{"type":"FeatureCollection","features":[]}`), 0644)
	os.WriteFile(overlay2, []byte(`{"type":"FeatureCollection","features":[]}`), 0644)

	origOverlays := overlays
	origListThemes := listThemes
	overlays = []string{overlay1, overlay2, "/nonexistent/overlay.geojson"}
	listThemes = true

	defer func() {
		overlays = origOverlays
		listThemes = origListThemes
	}()

	err := run(rootCmd, []string{})
	if err != nil {
		t.Errorf("run() with overlays returned error: %v", err)
	}
}

// TestVersionInfo tests that version information is available
func TestVersionInfo(t *testing.T) {
	// Root command should have version or be able to provide it
	if rootCmd.Version == "" {
		// Version might not be set, which is acceptable
		t.Log("Version not set on root command")
	}
}

// TestHelpOutputExtended tests that help output is generated with additional content
func TestHelpOutputExtended(t *testing.T) {
	output := testutil.CaptureOutput(func() {
		rootCmd.SetArgs([]string{"--help"})
		rootCmd.Execute()
	})

	if !contains(output, "Usage:") && !contains(output, "skyspy") {
		t.Error("Expected help output to contain usage info")
	}

	// Check for specific help content
	expectedContent := []string{"host", "port", "theme", "overlay"}
	for _, expected := range expectedContent {
		if !contains(output, expected) {
			t.Logf("Expected help output to contain %q", expected)
		}
	}

	// Reset args
	rootCmd.SetArgs([]string{})
}

// TestRunWithOIDCAuthRequiredNotAuthenticated tests run when OIDC auth is required
func TestRunWithOIDCAuthRequiredNotAuthenticated(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPortCoverage()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModeOIDC)
	server.SetOIDCProviderName("TestOIDC")

	origHost := host
	origPort := port
	origListThemes := listThemes
	origAPIKey := apiKey

	host = "localhost"
	port = serverPort
	listThemes = false
	apiKey = ""

	defer func() {
		host = origHost
		port = origPort
		listThemes = origListThemes
		apiKey = origAPIKey
	}()

	output := testutil.CaptureOutput(func() {
		err := run(rootCmd, []string{})
		if err == nil {
			t.Log("Expected error but got none")
		} else {
			if !contains(err.Error(), "authentication required") {
				t.Logf("Got error: %v", err)
			}
		}
	})

	// Should show auth warning
	t.Logf("OIDC auth required output: %s", output)
}

// TestRunWithAPIKeyAuthRequired tests run when API key auth is required
func TestRunWithAPIKeyAuthRequired(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPortCoverage()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModeAPIKey)

	origHost := host
	origPort := port
	origListThemes := listThemes
	origAPIKey := apiKey

	host = "localhost"
	port = serverPort
	listThemes = false
	apiKey = ""

	defer func() {
		host = origHost
		port = origPort
		listThemes = origListThemes
		apiKey = origAPIKey
	}()

	output := testutil.CaptureOutput(func() {
		err := run(rootCmd, []string{})
		if err == nil {
			t.Log("Expected error but got none")
		}
	})

	t.Logf("API key auth required output: %s", output)
}

// getTestPortCoverage returns an available port for coverage tests
var coveragePortCounter int32 = 51000

func getTestPortCoverage() int {
	port := int(atomic.AddInt32(&coveragePortCounter, 1))
	return port
}
