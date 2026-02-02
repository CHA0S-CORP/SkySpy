package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/skyspy/skyspy-go/internal/auth"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/spf13/cobra"
)

var authCmd = &cobra.Command{
	Use:   "auth",
	Short: "Authentication commands",
	Long:  `Manage authentication for the SkySpy server.`,
}

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with the SkySpy server",
	Long: `Authenticate with the SkySpy server using OIDC.

This command will open your web browser for authentication.
After successful login, credentials are stored securely and used
for subsequent connections.

Examples:
  skyspy login
  skyspy login --host myserver.com --port 443`,
	RunE: runLogin,
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Log out from the SkySpy server",
	Long: `Clear stored credentials for the SkySpy server.

Examples:
  skyspy logout
  skyspy logout --host myserver.com --port 443`,
	RunE: runLogout,
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show authentication status",
	Long: `Display current authentication status and configuration.

Examples:
  skyspy auth status
  skyspy auth status --host myserver.com --port 443`,
	RunE: runStatus,
}

// RegisterAuthCommands sets up the auth command hierarchy.
// Call this from the main command initialization.
func RegisterAuthCommands() {
	// Add subcommands to auth
	authCmd.AddCommand(statusCmd)

	// Login and logout can be top-level or under auth
	// We'll add them as top-level for convenience
}

func runLogin(cmd *cobra.Command, args []string) error {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Apply command line overrides
	if host != "" {
		cfg.Connection.Host = host
	}
	if port != 0 {
		cfg.Connection.Port = port
	}

	fmt.Printf("🔐 Connecting to %s:%d...\n", cfg.Connection.Host, cfg.Connection.Port)

	// Create auth manager
	authMgr, err := auth.NewManager(cfg.Connection.Host, cfg.Connection.Port)
	if err != nil {
		return fmt.Errorf("failed to initialize auth: %w", err)
	}

	authCfg := authMgr.GetAuthConfig()

	// Check if auth is required
	if !authMgr.RequiresAuth() {
		fmt.Println("✓ Server does not require authentication (public mode)")
		return nil
	}

	// Check available auth methods
	if !authCfg.OIDCEnabled && !authCfg.LocalAuthEnabled {
		return fmt.Errorf("no supported authentication method available on server")
	}

	// Check if already authenticated
	if authMgr.IsAuthenticated() {
		username := authMgr.GetUsername()
		if username != "" {
			fmt.Printf("✓ Already authenticated as %s\n", username)
		} else {
			fmt.Println("✓ Already authenticated")
		}
		fmt.Println("  Use 'skyspy logout' to sign out first.")
		return nil
	}

	// Show auth method
	if authCfg.OIDCEnabled {
		providerName := authCfg.OIDCProviderName
		if providerName == "" {
			providerName = "OIDC"
		}
		fmt.Printf("📡 Starting authentication with %s...\n", providerName)
	}

	// Set up context with signal handling
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Println("\n⚠ Authentication canceled")
		cancel()
	}()

	// Perform login
	if err := authMgr.Login(ctx); err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	username := authMgr.GetUsername()
	if username != "" {
		fmt.Printf("✅ Successfully authenticated as %s\n", username)
	} else {
		fmt.Println("✅ Successfully authenticated!")
	}

	return nil
}

func runLogout(cmd *cobra.Command, args []string) error {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Apply command line overrides
	if host != "" {
		cfg.Connection.Host = host
	}
	if port != 0 {
		cfg.Connection.Port = port
	}

	// Create auth manager
	authMgr, err := auth.NewManager(cfg.Connection.Host, cfg.Connection.Port)
	if err != nil {
		return fmt.Errorf("failed to initialize auth: %w", err)
	}

	// Check if authenticated
	if !authMgr.IsAuthenticated() {
		fmt.Printf("Not logged in to %s:%d\n", cfg.Connection.Host, cfg.Connection.Port)
		return nil
	}

	// Logout
	if err := authMgr.Logout(); err != nil {
		return fmt.Errorf("logout failed: %w", err)
	}

	fmt.Printf("✓ Successfully logged out from %s:%d\n", cfg.Connection.Host, cfg.Connection.Port)
	return nil
}

func runStatus(cmd *cobra.Command, args []string) error {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Apply command line overrides
	if host != "" {
		cfg.Connection.Host = host
	}
	if port != 0 {
		cfg.Connection.Port = port
	}

	fmt.Printf("Server: %s:%d\n", cfg.Connection.Host, cfg.Connection.Port)
	fmt.Println()

	// Create auth manager
	authMgr, err := auth.NewManager(cfg.Connection.Host, cfg.Connection.Port)
	if err != nil {
		fmt.Printf("Status: ⚠ Cannot connect to server\n")
		fmt.Printf("Error: %v\n", err)
		return nil
	}

	info := authMgr.GetTokenInfo()

	// Auth configuration
	fmt.Println("Server Configuration:")
	fmt.Printf("  Auth Mode: %s\n", info["auth_mode"])
	fmt.Printf("  Auth Required: %v\n", info["auth_enabled"])

	if oidcEnabled, ok := info["oidc_enabled"].(bool); ok && oidcEnabled {
		provider := info["oidc_provider"]
		if provider == nil || provider == "" {
			provider = "OIDC"
		}
		fmt.Printf("  OIDC: enabled (via %s)\n", provider)
	} else {
		fmt.Printf("  OIDC: disabled\n")
	}

	fmt.Println()

	// Current auth status
	fmt.Println("Authentication Status:")
	authType, _ := info["auth_type"].(string)

	switch authType {
	case "oidc":
		fmt.Printf("  Status: ✓ Authenticated\n")
		if username := info["username"]; username != nil && username != "" {
			fmt.Printf("  User: %s\n", username)
		}
		if expiresAt := info["expires_at"]; expiresAt != nil {
			fmt.Printf("  Token Expires: %s\n", expiresAt)
		}
		if expired, ok := info["expired"].(bool); ok && expired {
			fmt.Printf("  ⚠ Token is expired\n")
			if hasRefresh, ok := info["has_refresh_token"].(bool); ok && hasRefresh {
				fmt.Printf("  Token will be refreshed on next request\n")
			}
		}
	case "api_key":
		fmt.Printf("  Status: ✓ Authenticated (API Key)\n")
		if prefix := info["api_key_prefix"]; prefix != nil {
			fmt.Printf("  Key: %s\n", prefix)
		}
	default:
		fmt.Printf("  Status: ✗ Not authenticated\n")
		if authEnabled, ok := info["auth_enabled"].(bool); ok && authEnabled {
			fmt.Printf("\n  Run 'skyspy login' to authenticate\n")
		}
	}

	return nil
}
