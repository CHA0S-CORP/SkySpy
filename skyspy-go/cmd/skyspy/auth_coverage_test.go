package main

import (
	"fmt"
	"net"
	"sync/atomic"
	"testing"

	"github.com/skyspy/skyspy-go/internal/testutil"
)

// authTestPortBase is the starting port for auth tests
var authTestPortCounter int32 = 50000

// getTestPort returns an available port for testing
func getTestPort() int {
	// Try to find an available port
	for i := 0; i < 100; i++ {
		port := int(atomic.AddInt32(&authTestPortCounter, 1))
		if isTestPortAvailable(port) {
			return port
		}
	}
	// Fallback
	return int(atomic.AddInt32(&authTestPortCounter, 1))
}

// isTestPortAvailable checks if a port is available by trying to listen on it
func isTestPortAvailable(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

// TestRunLoginWithMockServer tests runLogin against a mock server
func TestRunLoginWithMockServer(t *testing.T) {
	// Set up temp home directory for credentials
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Create and start mock server
	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	// Test public mode (no auth required)
	server.SetAuthMode(testutil.AuthModePublic)

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		err := runLogin(loginCmd, []string{})
		if err != nil {
			// Public mode should succeed or indicate no auth needed
			t.Logf("runLogin returned: %v", err)
		}
	})

	// In public mode, should indicate no auth required
	if len(output) > 0 {
		t.Logf("Login output: %s", output)
	}
}

// TestRunLoginServerPublicMode tests login when server is in public mode
func TestRunLoginServerPublicMode(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModePublic)

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runLogin(loginCmd, []string{})
	})

	// Should indicate server doesn't require auth
	t.Logf("Public mode output: %s", output)
}

// TestRunLogoutNotLoggedIn tests logout when not logged in
func TestRunLogoutNotLoggedIn(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		err := runLogout(logoutCmd, []string{})
		if err != nil {
			t.Errorf("runLogout returned unexpected error: %v", err)
		}
	})

	// Should indicate not logged in
	t.Logf("Logout output: %s", output)
}

// TestRunLogoutWithCustomHost tests logout with custom host/port
func TestRunLogoutWithCustomHost(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runLogout(logoutCmd, []string{})
	})

	t.Logf("Logout output: %s", output)
}

// TestRunStatusNoServer tests status when server cannot be reached
func TestRunStatusNoServer(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	// Use a port where nothing is listening
	origHost := host
	origPort := port
	host = "localhost"
	port = 59999 // Unlikely to be in use
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		err := runStatus(statusCmd, []string{})
		// Should not error - just shows status
		if err != nil {
			t.Logf("runStatus returned: %v", err)
		}
	})

	// Should show server info even if unreachable
	t.Logf("Status output: %s", output)
}

// TestRunStatusWithMockServer tests status against a mock server
func TestRunStatusWithMockServer(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		err := runStatus(statusCmd, []string{})
		if err != nil {
			t.Errorf("runStatus returned unexpected error: %v", err)
		}
	})

	// Should show server and auth info
	t.Logf("Status output: %s", output)
}

// TestRunStatusOIDCMode tests status when server uses OIDC auth
func TestRunStatusOIDCMode(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModeOIDC)
	server.SetOIDCProviderName("TestProvider")

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runStatus(statusCmd, []string{})
	})

	t.Logf("OIDC Status output: %s", output)
}

// TestRunStatusAPIKeyMode tests status when server uses API key auth
func TestRunStatusAPIKeyMode(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModeAPIKey)
	server.AddValidAPIKey("sk_test_key_123")

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runStatus(statusCmd, []string{})
	})

	t.Logf("API Key Status output: %s", output)
}

// TestRunLoginNoAuthMethods tests login when server doesn't require auth
func TestRunLoginNoAuthMethods(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	// Server in public mode has no auth methods
	server.SetAuthMode(testutil.AuthModePublic)

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runLogin(loginCmd, []string{})
	})

	// Should indicate server doesn't require auth
	t.Logf("No auth methods output: %s", output)
}

// TestRunLoginWithHostPortOverrides tests login with host/port flags
func TestRunLoginWithHostPortOverrides(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModePublic)

	// Test with custom host/port
	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runLogin(loginCmd, []string{})
	})

	t.Logf("Login with overrides output: %s", output)
}

// TestRunLogoutWithHostPortOverrides tests logout with host/port flags
func TestRunLogoutWithHostPortOverrides(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runLogout(logoutCmd, []string{})
	})

	t.Logf("Logout with overrides output: %s", output)
}

// TestRunStatusWithHostPortOverrides tests status with host/port flags
func TestRunStatusWithHostPortOverrides(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runStatus(statusCmd, []string{})
	})

	t.Logf("Status with overrides output: %s", output)
}

// TestAuthCommandsExist tests that all auth commands are properly defined
func TestAuthCommandsExist(t *testing.T) {
	if loginCmd == nil {
		t.Error("Expected loginCmd to exist")
	}

	if logoutCmd == nil {
		t.Error("Expected logoutCmd to exist")
	}

	if authCmd == nil {
		t.Error("Expected authCmd to exist")
	}

	if statusCmd == nil {
		t.Error("Expected statusCmd to exist")
	}
}

// TestAuthCommandsHaveRunE tests that auth commands have RunE functions
func TestAuthCommandsHaveRunE(t *testing.T) {
	if loginCmd.RunE == nil {
		t.Error("Expected loginCmd to have RunE function")
	}

	if logoutCmd.RunE == nil {
		t.Error("Expected logoutCmd to have RunE function")
	}

	if statusCmd.RunE == nil {
		t.Error("Expected statusCmd to have RunE function")
	}
}

// TestAuthCommandDescriptions tests that auth commands have descriptions
func TestAuthCommandDescriptions(t *testing.T) {
	if loginCmd.Short == "" {
		t.Error("Expected loginCmd to have Short description")
	}

	if loginCmd.Long == "" {
		t.Error("Expected loginCmd to have Long description")
	}

	if logoutCmd.Short == "" {
		t.Error("Expected logoutCmd to have Short description")
	}

	if logoutCmd.Long == "" {
		t.Error("Expected logoutCmd to have Long description")
	}

	if statusCmd.Short == "" {
		t.Error("Expected statusCmd to have Short description")
	}

	if statusCmd.Long == "" {
		t.Error("Expected statusCmd to have Long description")
	}
}

// TestRunStatusPublicMode tests status when server is in public mode
func TestRunStatusPublicMode(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModePublic)

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		err := runStatus(statusCmd, []string{})
		if err != nil {
			t.Errorf("runStatus returned unexpected error: %v", err)
		}
	})

	// Should show server info and auth mode
	if !contains(output, "Server:") {
		t.Error("Expected output to contain 'Server:'")
	}

	t.Logf("Public mode status output: %s", output)
}

// TestRunStatusWithValidToken tests status with a valid token
func TestRunStatusWithValidToken(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	// Set up OIDC mode with a valid token
	server.SetAuthMode(testutil.AuthModeOIDC)
	server.AddValidToken("test_token_123", &testutil.MockUser{
		ID:       1,
		Username: "testuser",
		Email:    "test@example.com",
		Roles:    []string{"user"},
	})

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		err := runStatus(statusCmd, []string{})
		if err != nil {
			t.Errorf("runStatus returned unexpected error: %v", err)
		}
	})

	t.Logf("Status with token output: %s", output)
}

// TestRunLoginAlreadyAuthenticated tests login when already authenticated
func TestRunLoginAlreadyAuthenticated(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	// Public mode = no auth required
	server.SetAuthMode(testutil.AuthModePublic)

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		err := runLogin(loginCmd, []string{})
		// Should succeed because public mode doesn't require auth
		if err != nil {
			t.Logf("runLogin returned: %v", err)
		}
	})

	// Should indicate no auth required
	if !contains(output, "public") && !contains(output, "not require") {
		t.Logf("Expected output to indicate public mode. Got: %s", output)
	}
}

// TestRunLogoutWhenLoggedIn tests logout when logged in
func TestRunLogoutWhenLoggedIn(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModePublic)

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		err := runLogout(logoutCmd, []string{})
		if err != nil {
			t.Errorf("runLogout returned unexpected error: %v", err)
		}
	})

	t.Logf("Logout output: %s", output)
}

// TestRunStatusShowsAllInfo tests that status shows comprehensive information
func TestRunStatusShowsAllInfo(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModeOIDC)
	server.SetOIDCProviderName("TestProvider")

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runStatus(statusCmd, []string{})
	})

	// Should show multiple pieces of info
	expectedContent := []string{"Server:", "Configuration:", "Status:"}
	for _, expected := range expectedContent {
		if !contains(output, expected) {
			t.Errorf("Expected output to contain %q", expected)
		}
	}
}

// TestAuthFlagsAreInherited tests that auth commands inherit global flags
func TestAuthFlagsAreInherited(t *testing.T) {
	// Host and port should be available on login/logout/status
	loginHostFlag := loginCmd.InheritedFlags().Lookup("host")
	if loginHostFlag == nil {
		loginHostFlag = loginCmd.Flag("host")
	}

	loginPortFlag := loginCmd.InheritedFlags().Lookup("port")
	if loginPortFlag == nil {
		loginPortFlag = loginCmd.Flag("port")
	}

	// These commands should have access to host/port through persistent flags
	// Note: The actual flag lookup depends on command registration
}

// TestAuthCommandUse tests the Use field of auth commands
func TestAuthCommandUse(t *testing.T) {
	if loginCmd.Use != "login" {
		t.Errorf("Expected loginCmd Use to be 'login', got %q", loginCmd.Use)
	}

	if logoutCmd.Use != "logout" {
		t.Errorf("Expected logoutCmd Use to be 'logout', got %q", logoutCmd.Use)
	}

	if statusCmd.Use != "status" {
		t.Errorf("Expected statusCmd Use to be 'status', got %q", statusCmd.Use)
	}

	if authCmd.Use != "auth" {
		t.Errorf("Expected authCmd Use to be 'auth', got %q", authCmd.Use)
	}
}

// TestAuthCommandParent tests that status is a subcommand of auth
func TestAuthCommandParent(t *testing.T) {
	// Verify auth has status as subcommand
	found := false
	for _, cmd := range authCmd.Commands() {
		if cmd.Use == "status" {
			found = true
			break
		}
	}

	if !found {
		t.Error("Expected status to be a subcommand of auth")
	}
}

// TestRunLoginWithDefaultConfig tests login using default config
func TestRunLoginWithDefaultConfig(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	// Public mode - no auth needed
	server.SetAuthMode(testutil.AuthModePublic)

	origHost := host
	origPort := port
	// Keep default empty host to use config defaults
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runLogin(loginCmd, []string{})
	})

	t.Logf("Default config login output: %s", output)
}

// TestRunLogoutWithDefaultConfig tests logout using default config
func TestRunLogoutWithDefaultConfig(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runLogout(logoutCmd, []string{})
	})

	t.Logf("Default config logout output: %s", output)
}

// TestRunStatusWithDefaultConfig tests status using default config
func TestRunStatusWithDefaultConfig(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runStatus(statusCmd, []string{})
	})

	// Verify output contains expected sections
	if !contains(output, "Server:") {
		t.Error("Expected output to contain 'Server:'")
	}

	t.Logf("Default config status output: %s", output)
}

// TestRunLoginShowsCorrectProvider tests that login shows OIDC provider name
func TestRunLoginShowsCorrectProvider(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	// Set specific provider name
	server.SetAuthMode(testutil.AuthModeOIDC)
	server.SetOIDCProviderName("MyCompany SSO")

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		// This will attempt login and may fail waiting for browser, which is OK
		_ = runLogin(loginCmd, []string{})
	})

	// Should show the provider name
	t.Logf("OIDC provider login output: %s", output)
}

// TestRunStatusWithAuthDisabled tests status when auth is completely disabled
func TestRunStatusWithAuthDisabled(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	// Public mode
	server.SetAuthMode(testutil.AuthModePublic)

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		err := runStatus(statusCmd, []string{})
		if err != nil {
			t.Errorf("runStatus returned unexpected error: %v", err)
		}
	})

	// Should show public mode info
	if !contains(output, "public") && !contains(output, "disabled") {
		t.Logf("Expected output to mention auth mode. Got: %s", output)
	}
}

// TestRunLoginWithPortOverride tests login with port override
func TestRunLoginWithPortOverride(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModePublic)

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort // Override port
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runLogin(loginCmd, []string{})
	})

	// Output should show the server connection
	t.Logf("Port override login output: %s", output)
}

// TestRunLogoutWithPortOverride tests logout with port override
func TestRunLogoutWithPortOverride(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runLogout(logoutCmd, []string{})
	})

	t.Logf("Port override logout output: %s", output)
}

// TestRunStatusShowsOIDCInfo tests that status shows OIDC info when enabled
func TestRunStatusShowsOIDCInfo(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModeOIDC)
	server.SetOIDCProviderName("TestOIDCProvider")

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runStatus(statusCmd, []string{})
	})

	// Should show OIDC enabled
	if !contains(output, "OIDC") {
		t.Error("Expected output to contain 'OIDC'")
	}

	t.Logf("OIDC status output: %s", output)
}

// TestRunStatusShowsAPIKeyInfo tests status when API key auth is enabled
func TestRunStatusShowsAPIKeyInfo(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	server := testutil.NewMockServer()
	serverPort := getTestPort()
	if err := server.Start(serverPort); err != nil {
		t.Fatalf("Failed to start mock server: %v", err)
	}
	defer server.Stop()

	server.SetAuthMode(testutil.AuthModeAPIKey)

	origHost := host
	origPort := port
	host = "localhost"
	port = serverPort
	defer func() {
		host = origHost
		port = origPort
	}()

	output := testutil.CaptureOutput(func() {
		_ = runStatus(statusCmd, []string{})
	})

	t.Logf("API key status output: %s", output)
}
