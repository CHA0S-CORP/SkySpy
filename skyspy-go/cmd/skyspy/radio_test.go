package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// createRadioCmd creates a test radio command matching the real structure
func createRadioCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "radio",
		Short: "SkySpy Radio - Old School Aircraft Monitor",
		Long: `SkySpy Radio - Old School Aircraft Monitor

A retro terminal interface for live ADS-B and ACARS tracking.
Displays aircraft in a classic radio monitor style.

Examples:
  skyspy radio
  skyspy radio --host server.local --port 8080
  skyspy radio --scan
  skyspy radio --frequency 1090`,
		RunE: func(cmd *cobra.Command, args []string) error {
			frequency, _ := cmd.Flags().GetString("frequency")
			scanMode, _ := cmd.Flags().GetBool("scan")
			host, _ := cmd.Flags().GetString("host")
			port, _ := cmd.Flags().GetInt("port")

			if host == "" {
				host = "localhost"
			}
			if port == 0 {
				port = 8080
			}

			cmd.Printf("Connecting to %s:%d...\n", host, port)
			if scanMode {
				cmd.Println("Scan mode enabled")
			}
			if frequency != "" {
				cmd.Printf("Filtering frequency: %s\n", frequency)
			}
			return nil
		},
	}

	cmd.Flags().String("frequency", "", "Monitor specific frequency (e.g., 1090, 136.9)")
	cmd.Flags().Bool("scan", false, "Enable frequency scanning mode")

	return cmd
}

// createRadioProCmd creates a test radio-pro command matching the real structure
func createRadioProCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "radio-pro",
		Short: "SkySpy Radio PRO - Ultimate Aircraft Monitor",
		Long: `SkySpy Radio PRO - Ultimate Aircraft Monitor

A fully immersive retro terminal interface for live ADS-B and ACARS
tracking with VU meters, spectrum display, and waterfall visualization.

Features:
  - Live aircraft tracking table with detailed info
  - ACARS/VDL2 message feed
  - Real-time VU meters
  - Spectrum analyzer display
  - Frequency scanning visualization
  - Signal history and waterfall display

Examples:
  skyspy radio-pro
  skyspy radio-pro --host server.local --port 8080
  skyspy radio-pro --scan
  skyspy radio-pro --frequency 1090`,
		RunE: func(cmd *cobra.Command, args []string) error {
			frequency, _ := cmd.Flags().GetString("frequency")
			scanMode, _ := cmd.Flags().GetBool("scan")
			host, _ := cmd.Flags().GetString("host")
			port, _ := cmd.Flags().GetInt("port")

			if host == "" {
				host = "localhost"
			}
			if port == 0 {
				port = 8080
			}

			cmd.Printf("Connecting to %s:%d...\n", host, port)
			if scanMode {
				cmd.Println("Scan mode enabled")
			}
			if frequency != "" {
				cmd.Printf("Filtering frequency: %s\n", frequency)
			}
			return nil
		},
	}

	cmd.Flags().String("frequency", "", "Monitor specific frequency (e.g., 1090, 136.9)")
	cmd.Flags().Bool("scan", false, "Enable frequency scanning mode")

	return cmd
}

// createTestRootWithRadio creates a root command with radio subcommands for testing
func createTestRootWithRadio() *cobra.Command {
	root := &cobra.Command{
		Use:   "skyspy",
		Short: "SkySpy Radar Pro - Full-Featured Aircraft Display",
	}

	root.PersistentFlags().String("host", "", "Server hostname")
	root.PersistentFlags().Int("port", 0, "Server port")

	root.AddCommand(createRadioCmd())
	root.AddCommand(createRadioProCmd())

	return root
}

// executeRadioCommand runs a command and captures output
func executeRadioCommand(root *cobra.Command, args ...string) (output string, err error) {
	buf := new(bytes.Buffer)
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs(args)

	err = root.Execute()
	return buf.String(), err
}

func TestRadioCommand_Help(t *testing.T) {
	root := createTestRootWithRadio()
	output, err := executeRadioCommand(root, "radio", "--help")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify help contains expected content
	expectedContent := []string{
		"SkySpy Radio",
		"Old School Aircraft Monitor",
		"retro terminal interface",
		"ADS-B",
		"ACARS",
		"classic radio monitor style",
		"Examples:",
		"skyspy radio",
		"skyspy radio --host server.local --port 8080",
		"skyspy radio --scan",
		"skyspy radio --frequency 1090",
	}

	for _, content := range expectedContent {
		if !strings.Contains(output, content) {
			t.Errorf("Expected radio help to contain %q, got:\n%s", content, output)
		}
	}

	// Verify flags are documented
	expectedFlags := []string{
		"--frequency",
		"--scan",
		"--host",
		"--port",
	}

	for _, flag := range expectedFlags {
		if !strings.Contains(output, flag) {
			t.Errorf("Expected radio help to contain flag %q", flag)
		}
	}
}

func TestRadioProCommand_Help(t *testing.T) {
	root := createTestRootWithRadio()
	output, err := executeRadioCommand(root, "radio-pro", "--help")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify help contains expected content
	expectedContent := []string{
		"SkySpy Radio PRO",
		"Ultimate Aircraft Monitor",
		"fully immersive retro terminal interface",
		"ADS-B",
		"ACARS",
		"VU meters",
		"spectrum display",
		"waterfall visualization",
		"Features:",
		"Live aircraft tracking",
		"ACARS/VDL2 message feed",
		"Real-time VU meters",
		"Spectrum analyzer",
		"Frequency scanning visualization",
		"Signal history",
		"Examples:",
		"skyspy radio-pro",
		"skyspy radio-pro --host server.local --port 8080",
		"skyspy radio-pro --scan",
		"skyspy radio-pro --frequency 1090",
	}

	for _, content := range expectedContent {
		if !strings.Contains(output, content) {
			t.Errorf("Expected radio-pro help to contain %q, got:\n%s", content, output)
		}
	}

	// Verify flags are documented
	expectedFlags := []string{
		"--frequency",
		"--scan",
		"--host",
		"--port",
	}

	for _, flag := range expectedFlags {
		if !strings.Contains(output, flag) {
			t.Errorf("Expected radio-pro help to contain flag %q", flag)
		}
	}
}

func TestRadioCommand_Flags(t *testing.T) {
	tests := []struct {
		name              string
		args              []string
		expectScanMode    bool
		expectFrequency   string
		expectInOutput    []string
		expectNotInOutput []string
	}{
		{
			name:              "default - no flags",
			args:              []string{"radio"},
			expectScanMode:    false,
			expectFrequency:   "",
			expectInOutput:    []string{"Connecting to"},
			expectNotInOutput: []string{"Scan mode enabled", "Filtering frequency"},
		},
		{
			name:              "scan mode enabled",
			args:              []string{"radio", "--scan"},
			expectScanMode:    true,
			expectFrequency:   "",
			expectInOutput:    []string{"Connecting to", "Scan mode enabled"},
			expectNotInOutput: []string{"Filtering frequency"},
		},
		{
			name:              "frequency filter",
			args:              []string{"radio", "--frequency", "1090"},
			expectScanMode:    false,
			expectFrequency:   "1090",
			expectInOutput:    []string{"Connecting to", "Filtering frequency: 1090"},
			expectNotInOutput: []string{"Scan mode enabled"},
		},
		{
			name:              "both scan and frequency",
			args:              []string{"radio", "--scan", "--frequency", "136.9"},
			expectScanMode:    true,
			expectFrequency:   "136.9",
			expectInOutput:    []string{"Connecting to", "Scan mode enabled", "Filtering frequency: 136.9"},
			expectNotInOutput: []string{},
		},
		{
			name:              "ACARS frequency",
			args:              []string{"radio", "--frequency", "131.550"},
			expectScanMode:    false,
			expectFrequency:   "131.550",
			expectInOutput:    []string{"Filtering frequency: 131.550"},
			expectNotInOutput: []string{"Scan mode enabled"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := createTestRootWithRadio()
			output, err := executeRadioCommand(root, tc.args...)

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			for _, expected := range tc.expectInOutput {
				if !strings.Contains(output, expected) {
					t.Errorf("Expected output to contain %q, got:\n%s", expected, output)
				}
			}

			for _, notExpected := range tc.expectNotInOutput {
				if strings.Contains(output, notExpected) {
					t.Errorf("Expected output NOT to contain %q, got:\n%s", notExpected, output)
				}
			}
		})
	}
}

func TestRadioProCommand_Flags(t *testing.T) {
	tests := []struct {
		name              string
		args              []string
		expectInOutput    []string
		expectNotInOutput []string
	}{
		{
			name:              "default - no flags",
			args:              []string{"radio-pro"},
			expectInOutput:    []string{"Connecting to"},
			expectNotInOutput: []string{"Scan mode enabled", "Filtering frequency"},
		},
		{
			name:              "scan mode enabled",
			args:              []string{"radio-pro", "--scan"},
			expectInOutput:    []string{"Connecting to", "Scan mode enabled"},
			expectNotInOutput: []string{"Filtering frequency"},
		},
		{
			name:              "frequency filter ADS-B",
			args:              []string{"radio-pro", "--frequency", "1090"},
			expectInOutput:    []string{"Connecting to", "Filtering frequency: 1090"},
			expectNotInOutput: []string{"Scan mode enabled"},
		},
		{
			name:              "frequency filter VDL2",
			args:              []string{"radio-pro", "--frequency", "136.725"},
			expectInOutput:    []string{"Connecting to", "Filtering frequency: 136.725"},
			expectNotInOutput: []string{"Scan mode enabled"},
		},
		{
			name:              "both scan and frequency",
			args:              []string{"radio-pro", "--scan", "--frequency", "1090"},
			expectInOutput:    []string{"Connecting to", "Scan mode enabled", "Filtering frequency: 1090"},
			expectNotInOutput: []string{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := createTestRootWithRadio()
			output, err := executeRadioCommand(root, tc.args...)

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			for _, expected := range tc.expectInOutput {
				if !strings.Contains(output, expected) {
					t.Errorf("Expected output to contain %q, got:\n%s", expected, output)
				}
			}

			for _, notExpected := range tc.expectNotInOutput {
				if strings.Contains(output, notExpected) {
					t.Errorf("Expected output NOT to contain %q, got:\n%s", notExpected, output)
				}
			}
		})
	}
}

func TestRadioCommand_HostPortFlags(t *testing.T) {
	tests := []struct {
		name         string
		args         []string
		expectedHost string
		expectedPort int
	}{
		{
			name:         "default host and port",
			args:         []string{"radio"},
			expectedHost: "localhost",
			expectedPort: 8080,
		},
		{
			name:         "custom host",
			args:         []string{"radio", "--host", "radar.local"},
			expectedHost: "radar.local",
			expectedPort: 8080,
		},
		{
			name:         "custom port",
			args:         []string{"radio", "--port", "9000"},
			expectedHost: "localhost",
			expectedPort: 9000,
		},
		{
			name:         "both custom",
			args:         []string{"radio", "--host", "skyspy.io", "--port", "8443"},
			expectedHost: "skyspy.io",
			expectedPort: 8443,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := createTestRootWithRadio()
			output, err := executeRadioCommand(root, tc.args...)

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			expectedConnectMsg := "Connecting to " + tc.expectedHost
			if !strings.Contains(output, expectedConnectMsg) {
				t.Errorf("Expected output to contain %q, got:\n%s", expectedConnectMsg, output)
			}
		})
	}
}

func TestRadioProCommand_HostPortFlags(t *testing.T) {
	tests := []struct {
		name         string
		args         []string
		expectedHost string
		expectedPort int
	}{
		{
			name:         "default host and port",
			args:         []string{"radio-pro"},
			expectedHost: "localhost",
			expectedPort: 8080,
		},
		{
			name:         "custom host",
			args:         []string{"radio-pro", "--host", "pro.radar.local"},
			expectedHost: "pro.radar.local",
			expectedPort: 8080,
		},
		{
			name:         "custom port",
			args:         []string{"radio-pro", "--port", "9443"},
			expectedHost: "localhost",
			expectedPort: 9443,
		},
		{
			name:         "both custom",
			args:         []string{"radio-pro", "--host", "premium.skyspy.io", "--port", "443"},
			expectedHost: "premium.skyspy.io",
			expectedPort: 443,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := createTestRootWithRadio()
			output, err := executeRadioCommand(root, tc.args...)

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			expectedConnectMsg := "Connecting to " + tc.expectedHost
			if !strings.Contains(output, expectedConnectMsg) {
				t.Errorf("Expected output to contain %q, got:\n%s", expectedConnectMsg, output)
			}
		})
	}
}

func TestRadioCommands_InvalidFlags(t *testing.T) {
	tests := []struct {
		name        string
		args        []string
		expectError bool
	}{
		{
			name:        "radio with invalid flag",
			args:        []string{"radio", "--invalid-flag"},
			expectError: true,
		},
		{
			name:        "radio-pro with invalid flag",
			args:        []string{"radio-pro", "--unknown-option"},
			expectError: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := createTestRootWithRadio()
			_, err := executeRadioCommand(root, tc.args...)

			if tc.expectError && err == nil {
				t.Error("Expected error for invalid flag, got nil")
			}
			if !tc.expectError && err != nil {
				t.Errorf("Unexpected error: %v", err)
			}
		})
	}
}

func TestRadioCommands_FrequencyFlagValues(t *testing.T) {
	// Test various frequency values that should be accepted
	frequencies := []struct {
		name      string
		frequency string
		desc      string
	}{
		{"ADS-B", "1090", "Mode S/ADS-B frequency"},
		{"ACARS Primary", "131.550", "Primary ACARS frequency"},
		{"ACARS Secondary", "131.725", "Secondary ACARS frequency"},
		{"VDL2 Primary", "136.725", "VDL2 primary frequency"},
		{"VDL2 Secondary", "136.775", "VDL2 secondary frequency"},
		{"VDL2 Tertiary", "136.875", "VDL2 tertiary frequency"},
		{"HFDL", "10081", "HF Data Link frequency"},
	}

	for _, freq := range frequencies {
		t.Run("radio_"+freq.name, func(t *testing.T) {
			root := createTestRootWithRadio()
			output, err := executeRadioCommand(root, "radio", "--frequency", freq.frequency)

			if err != nil {
				t.Fatalf("Unexpected error for frequency %s: %v", freq.frequency, err)
			}

			if !strings.Contains(output, freq.frequency) {
				t.Errorf("Expected output to contain frequency %q, got:\n%s", freq.frequency, output)
			}
		})

		t.Run("radio-pro_"+freq.name, func(t *testing.T) {
			root := createTestRootWithRadio()
			output, err := executeRadioCommand(root, "radio-pro", "--frequency", freq.frequency)

			if err != nil {
				t.Fatalf("Unexpected error for frequency %s: %v", freq.frequency, err)
			}

			if !strings.Contains(output, freq.frequency) {
				t.Errorf("Expected output to contain frequency %q, got:\n%s", freq.frequency, output)
			}
		})
	}
}

func TestRadioCommands_CommandStructure(t *testing.T) {
	root := createTestRootWithRadio()

	// Verify radio command exists
	radioCmd, _, err := root.Find([]string{"radio"})
	if err != nil {
		t.Fatalf("Failed to find radio command: %v", err)
	}

	if radioCmd.Use != "radio" {
		t.Errorf("Expected radio command Use to be 'radio', got %q", radioCmd.Use)
	}

	// Verify radio-pro command exists
	radioProCmd, _, err := root.Find([]string{"radio-pro"})
	if err != nil {
		t.Fatalf("Failed to find radio-pro command: %v", err)
	}

	if radioProCmd.Use != "radio-pro" {
		t.Errorf("Expected radio-pro command Use to be 'radio-pro', got %q", radioProCmd.Use)
	}

	// Verify both commands have required flags
	for _, cmd := range []*cobra.Command{radioCmd, radioProCmd} {
		freqFlag := cmd.Flag("frequency")
		if freqFlag == nil {
			t.Errorf("Expected %s command to have --frequency flag", cmd.Use)
		}

		scanFlag := cmd.Flag("scan")
		if scanFlag == nil {
			t.Errorf("Expected %s command to have --scan flag", cmd.Use)
		}
	}
}

func TestRadioCommands_ScanFlagIsBool(t *testing.T) {
	root := createTestRootWithRadio()

	// Test that --scan is a boolean flag (no value needed)
	output, err := executeRadioCommand(root, "radio", "--scan")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if !strings.Contains(output, "Scan mode enabled") {
		t.Error("Expected scan mode to be enabled with --scan flag")
	}

	// Test radio-pro as well
	output, err = executeRadioCommand(root, "radio-pro", "--scan")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if !strings.Contains(output, "Scan mode enabled") {
		t.Error("Expected scan mode to be enabled with --scan flag for radio-pro")
	}
}

func TestRadioCommands_FrequencyFlagIsString(t *testing.T) {
	root := createTestRootWithRadio()

	// Test that --frequency accepts string values (including decimals)
	testFrequencies := []string{"1090", "136.725", "131.550", "10.0", "999.999"}

	for _, freq := range testFrequencies {
		root = createTestRootWithRadio()
		output, err := executeRadioCommand(root, "radio", "--frequency", freq)
		if err != nil {
			t.Errorf("Unexpected error for frequency %q: %v", freq, err)
		}

		if !strings.Contains(output, freq) {
			t.Errorf("Expected output to contain frequency %q", freq)
		}
	}
}

func TestRadioCommands_CombinedWithGlobalFlags(t *testing.T) {
	tests := []struct {
		name           string
		args           []string
		expectInOutput []string
	}{
		{
			name: "radio with all flags",
			args: []string{"radio", "--host", "custom.host", "--port", "9999", "--scan", "--frequency", "1090"},
			expectInOutput: []string{
				"Connecting to custom.host:9999",
				"Scan mode enabled",
				"Filtering frequency: 1090",
			},
		},
		{
			name: "radio-pro with all flags",
			args: []string{"radio-pro", "--host", "pro.host", "--port", "8888", "--scan", "--frequency", "136.725"},
			expectInOutput: []string{
				"Connecting to pro.host:8888",
				"Scan mode enabled",
				"Filtering frequency: 136.725",
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := createTestRootWithRadio()
			output, err := executeRadioCommand(root, tc.args...)

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			for _, expected := range tc.expectInOutput {
				if !strings.Contains(output, expected) {
					t.Errorf("Expected output to contain %q, got:\n%s", expected, output)
				}
			}
		})
	}
}
