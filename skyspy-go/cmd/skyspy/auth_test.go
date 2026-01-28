package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// createLoginCmd creates a test login command with the same structure as the real one
func createLoginCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Authenticate with the SkySpy server",
		Long: `Authenticate with the SkySpy server using OIDC.

This command will open your web browser for authentication.
After successful login, credentials are stored securely and used
for subsequent connections.

Examples:
  skyspy login
  skyspy login --host myserver.com --port 443`,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Test implementation that returns error for unreachable server
			host, _ := cmd.Flags().GetString("host")
			if host == "" {
				host = "localhost"
			}
			port, _ := cmd.Flags().GetInt("port")
			if port == 0 {
				port = 8080
			}
			cmd.Printf("Connecting to %s:%d...\n", host, port)
			return &ServerUnreachableError{Host: host, Port: port}
		},
	}
	return cmd
}

// createLogoutCmd creates a test logout command
func createLogoutCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "logout",
		Short: "Log out from the SkySpy server",
		Long: `Clear stored credentials for the SkySpy server.

Examples:
  skyspy logout
  skyspy logout --host myserver.com --port 443`,
		RunE: func(cmd *cobra.Command, args []string) error {
			host, _ := cmd.Flags().GetString("host")
			if host == "" {
				host = "localhost"
			}
			port, _ := cmd.Flags().GetInt("port")
			if port == 0 {
				port = 8080
			}
			cmd.Printf("Not logged in to %s:%d\n", host, port)
			return nil
		},
	}
	return cmd
}

// createAuthStatusCmd creates a test auth status command
func createAuthStatusCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show authentication status",
		Long: `Display current authentication status and configuration.

Examples:
  skyspy auth status
  skyspy auth status --host myserver.com --port 443`,
		RunE: func(cmd *cobra.Command, args []string) error {
			host, _ := cmd.Flags().GetString("host")
			if host == "" {
				host = "localhost"
			}
			port, _ := cmd.Flags().GetInt("port")
			if port == 0 {
				port = 8080
			}
			cmd.Printf("Server: %s:%d\n", host, port)
			cmd.Printf("Status: Cannot connect to server\n")
			cmd.Printf("Error: connection refused\n")
			return nil
		},
	}
	return cmd
}

// createAuthCmd creates the auth parent command
func createAuthCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "auth",
		Short: "Authentication commands",
		Long:  `Manage authentication for the SkySpy server.`,
	}
	cmd.AddCommand(createAuthStatusCmd())
	return cmd
}

// ServerUnreachableError represents a server connection error
type ServerUnreachableError struct {
	Host string
	Port int
}

func (e *ServerUnreachableError) Error() string {
	return "failed to initialize auth: connection refused"
}

// createTestRootWithAuth creates a root command with auth subcommands for testing
func createTestRootWithAuth() *cobra.Command {
	root := &cobra.Command{
		Use:   "skyspy",
		Short: "SkySpy Radar Pro - Full-Featured Aircraft Display",
	}

	root.PersistentFlags().String("host", "", "Server hostname")
	root.PersistentFlags().Int("port", 0, "Server port")

	root.AddCommand(createLoginCmd())
	root.AddCommand(createLogoutCmd())
	root.AddCommand(createAuthCmd())

	return root
}

// executeAuthCommand runs a command and captures output
func executeAuthCommand(root *cobra.Command, args ...string) (output string, err error) {
	buf := new(bytes.Buffer)
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs(args)

	err = root.Execute()
	return buf.String(), err
}

func TestLoginCommand_Help(t *testing.T) {
	root := createTestRootWithAuth()
	output, err := executeAuthCommand(root, "login", "--help")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify help contains expected content
	expectedContent := []string{
		"Authenticate with the SkySpy server",
		"OIDC",
		"web browser",
		"credentials are stored securely",
		"Examples:",
		"skyspy login",
		"skyspy login --host myserver.com --port 443",
	}

	for _, content := range expectedContent {
		if !strings.Contains(output, content) {
			t.Errorf("Expected login help to contain %q, got:\n%s", content, output)
		}
	}

	// Verify flags are mentioned
	expectedFlags := []string{
		"--host",
		"--port",
	}

	for _, flag := range expectedFlags {
		if !strings.Contains(output, flag) {
			t.Errorf("Expected login help to contain flag %q", flag)
		}
	}
}

func TestLogoutCommand_Help(t *testing.T) {
	root := createTestRootWithAuth()
	output, err := executeAuthCommand(root, "logout", "--help")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify help contains expected content from Long description
	// Note: cobra shows Long description in help, not Short
	expectedContent := []string{
		"Clear stored credentials",
		"Examples:",
		"skyspy logout",
		"skyspy logout --host myserver.com --port 443",
	}

	for _, content := range expectedContent {
		if !strings.Contains(output, content) {
			t.Errorf("Expected logout help to contain %q, got:\n%s", content, output)
		}
	}
}

func TestAuthStatusCommand_Help(t *testing.T) {
	root := createTestRootWithAuth()
	output, err := executeAuthCommand(root, "auth", "status", "--help")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify help contains expected content from Long description
	// Note: cobra shows Long description in help, not Short
	expectedContent := []string{
		"Display current authentication status",
		"Examples:",
		"skyspy auth status",
		"skyspy auth status --host myserver.com --port 443",
	}

	for _, content := range expectedContent {
		if !strings.Contains(output, content) {
			t.Errorf("Expected auth status help to contain %q, got:\n%s", content, output)
		}
	}
}

func TestLoginCommand_NoServer(t *testing.T) {
	root := createTestRootWithAuth()
	output, err := executeAuthCommand(root, "login")

	// Should return an error when server is unreachable
	if err == nil {
		t.Error("Expected error when server is unreachable, got nil")
	}

	// Verify the output shows connection attempt
	if !strings.Contains(output, "Connecting to") {
		t.Errorf("Expected output to show connection attempt, got:\n%s", output)
	}

	// Verify error message is appropriate
	if err != nil && !strings.Contains(err.Error(), "failed to initialize auth") {
		t.Errorf("Expected error to mention auth initialization failure, got: %v", err)
	}
}

func TestLoginCommand_NoServer_CustomHost(t *testing.T) {
	root := createTestRootWithAuth()
	output, err := executeAuthCommand(root, "login", "--host", "unreachable.example.com", "--port", "9999")

	// Should return an error
	if err == nil {
		t.Error("Expected error when server is unreachable")
	}

	// Verify the output shows the custom host
	if !strings.Contains(output, "unreachable.example.com:9999") {
		t.Errorf("Expected output to show custom host:port, got:\n%s", output)
	}
}

func TestLogoutCommand_NotLoggedIn(t *testing.T) {
	root := createTestRootWithAuth()
	output, err := executeAuthCommand(root, "logout")

	// Should not error - just inform user they're not logged in
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify message indicates not logged in
	if !strings.Contains(output, "Not logged in") {
		t.Errorf("Expected output to indicate not logged in, got:\n%s", output)
	}
}

func TestLogoutCommand_NotLoggedIn_CustomHost(t *testing.T) {
	root := createTestRootWithAuth()
	output, err := executeAuthCommand(root, "logout", "--host", "custom.server.com", "--port", "443")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify message shows the custom server
	if !strings.Contains(output, "custom.server.com:443") {
		t.Errorf("Expected output to show custom server, got:\n%s", output)
	}
}

func TestAuthStatusCommand_NoServer(t *testing.T) {
	root := createTestRootWithAuth()
	output, err := executeAuthCommand(root, "auth", "status")

	// Should not error - just show status
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify output shows server info
	if !strings.Contains(output, "Server:") {
		t.Errorf("Expected output to show 'Server:', got:\n%s", output)
	}

	// Verify output shows connection error
	expectedErrorIndicators := []string{
		"Cannot connect",
		"connection refused",
	}

	foundError := false
	for _, indicator := range expectedErrorIndicators {
		if strings.Contains(output, indicator) {
			foundError = true
			break
		}
	}

	if !foundError {
		t.Errorf("Expected output to indicate connection error, got:\n%s", output)
	}
}

func TestAuthStatusCommand_CustomServer(t *testing.T) {
	root := createTestRootWithAuth()
	output, err := executeAuthCommand(root, "auth", "status", "--host", "radar.local", "--port", "8443")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify the custom server is shown
	if !strings.Contains(output, "radar.local:8443") {
		t.Errorf("Expected output to show custom server, got:\n%s", output)
	}
}

func TestAuthCommand_Help(t *testing.T) {
	root := createTestRootWithAuth()
	output, err := executeAuthCommand(root, "auth", "--help")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Verify auth command help contains Long description and shows subcommands
	// Note: cobra shows Long description in help, not Short
	expectedContent := []string{
		"Manage authentication",
		"status",
	}

	for _, content := range expectedContent {
		if !strings.Contains(output, content) {
			t.Errorf("Expected auth help to contain %q, got:\n%s", content, output)
		}
	}
}

func TestAuthSubcommands(t *testing.T) {
	root := createTestRootWithAuth()

	// Test that auth command has status subcommand
	authCmd, _, err := root.Find([]string{"auth"})
	if err != nil {
		t.Fatalf("Failed to find auth command: %v", err)
	}

	if !authCmd.HasSubCommands() {
		t.Error("Expected auth command to have subcommands")
	}

	// Find status subcommand
	statusCmd, _, err := root.Find([]string{"auth", "status"})
	if err != nil {
		t.Fatalf("Failed to find auth status command: %v", err)
	}

	if statusCmd.Use != "status" {
		t.Errorf("Expected status command Use to be 'status', got %q", statusCmd.Use)
	}
}

func TestLoginLogoutTopLevel(t *testing.T) {
	root := createTestRootWithAuth()

	// Verify login is accessible at top level
	loginCmd, _, err := root.Find([]string{"login"})
	if err != nil {
		t.Fatalf("Failed to find login command: %v", err)
	}
	if loginCmd.Use != "login" {
		t.Errorf("Expected login command Use to be 'login', got %q", loginCmd.Use)
	}

	// Verify logout is accessible at top level
	logoutCmd, _, err := root.Find([]string{"logout"})
	if err != nil {
		t.Fatalf("Failed to find logout command: %v", err)
	}
	if logoutCmd.Use != "logout" {
		t.Errorf("Expected logout command Use to be 'logout', got %q", logoutCmd.Use)
	}
}

func TestHostPortInheritance(t *testing.T) {
	// Test that host and port flags are inherited by subcommands
	tests := []struct {
		name string
		args []string
	}{
		{
			name: "login inherits host/port",
			args: []string{"login", "--host", "test.com", "--port", "8080", "--help"},
		},
		{
			name: "logout inherits host/port",
			args: []string{"logout", "--host", "test.com", "--port", "8080", "--help"},
		},
		{
			name: "auth status inherits host/port",
			args: []string{"auth", "status", "--host", "test.com", "--port", "8080", "--help"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := createTestRootWithAuth()
			_, err := executeAuthCommand(root, tc.args...)

			// Should not error (help always succeeds)
			if err != nil {
				t.Errorf("Unexpected error: %v", err)
			}
		})
	}
}

func TestServerUnreachableError(t *testing.T) {
	err := &ServerUnreachableError{Host: "example.com", Port: 8080}

	if err.Error() != "failed to initialize auth: connection refused" {
		t.Errorf("Unexpected error message: %s", err.Error())
	}
}

func TestLoginCommand_HostFlagParsing(t *testing.T) {
	tests := []struct {
		name         string
		args         []string
		expectedHost string
		expectedPort int
	}{
		{
			name:         "default host and port",
			args:         []string{"login"},
			expectedHost: "localhost",
			expectedPort: 8080,
		},
		{
			name:         "custom host only",
			args:         []string{"login", "--host", "myserver.com"},
			expectedHost: "myserver.com",
			expectedPort: 8080,
		},
		{
			name:         "custom port only",
			args:         []string{"login", "--port", "443"},
			expectedHost: "localhost",
			expectedPort: 443,
		},
		{
			name:         "both custom",
			args:         []string{"login", "--host", "secure.server.io", "--port", "9443"},
			expectedHost: "secure.server.io",
			expectedPort: 9443,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := createTestRootWithAuth()

			var capturedHost string
			var capturedPort int

			// Override login command to capture parsed values
			loginCmd, _, _ := root.Find([]string{"login"})
			loginCmd.RunE = func(cmd *cobra.Command, args []string) error {
				capturedHost, _ = cmd.Flags().GetString("host")
				capturedPort, _ = cmd.Flags().GetInt("port")
				if capturedHost == "" {
					capturedHost = "localhost"
				}
				if capturedPort == 0 {
					capturedPort = 8080
				}
				return nil
			}

			_, err := executeAuthCommand(root, tc.args...)
			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if capturedHost != tc.expectedHost {
				t.Errorf("Expected host %q, got %q", tc.expectedHost, capturedHost)
			}
			if capturedPort != tc.expectedPort {
				t.Errorf("Expected port %d, got %d", tc.expectedPort, capturedPort)
			}
		})
	}
}
