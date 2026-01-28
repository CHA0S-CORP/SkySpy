// Package main provides the entry point for the SkySpy CLI application
package main

import (
	"fmt"
	"os"
	"path/filepath"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
	"github.com/skyspy/skyspy-go/internal/app"
	"github.com/skyspy/skyspy-go/internal/auth"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/theme"
)

var (
	host       string
	port       int
	lat        float64
	lon        float64
	maxRange   int
	themeName  string
	overlays   []string
	listThemes bool
	apiKey     string
	exportDir  string
	noAudio    bool
)

var rootCmd = &cobra.Command{
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
	RunE: run,
}

func init() {
	// Global flags (available to all commands)
	rootCmd.PersistentFlags().StringVar(&host, "host", "", "Server hostname")
	rootCmd.PersistentFlags().IntVar(&port, "port", 0, "Server port")

	// Root command flags
	rootCmd.Flags().Float64Var(&lat, "lat", 0, "Receiver latitude")
	rootCmd.Flags().Float64Var(&lon, "lon", 0, "Receiver longitude")
	rootCmd.Flags().IntVar(&maxRange, "range", 0, "Initial range (nm)")
	rootCmd.Flags().StringVar(&themeName, "theme", "", "Color theme")
	rootCmd.Flags().StringSliceVar(&overlays, "overlay", []string{}, "Load overlay file (GeoJSON/Shapefile)")
	rootCmd.Flags().BoolVar(&listThemes, "list-themes", false, "List available themes")
	rootCmd.Flags().StringVar(&apiKey, "api-key", "", "API key for authentication (or use SKYSPY_API_KEY env)")
	rootCmd.Flags().StringVar(&exportDir, "export-dir", "", "Directory for export files (default: current directory)")
	rootCmd.Flags().BoolVar(&noAudio, "no-audio", false, "Disable audio alerts")

	// Add subcommands
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(authCmd)
	rootCmd.AddCommand(radioCmd)
	rootCmd.AddCommand(radioProCmd)
	rootCmd.AddCommand(configureCmd)
}

func main() {
	// Check for API key in environment
	if envKey := os.Getenv("SKYSPY_API_KEY"); envKey != "" && apiKey == "" {
		apiKey = envKey
	}

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func run(cmd *cobra.Command, args []string) error {
	// List themes if requested
	if listThemes {
		fmt.Println("\nAvailable Themes:")
		for _, t := range theme.GetInfo() {
			fmt.Printf("  %-15s %-15s - %s\n", t.Key, t.Name, t.Description)
		}
		fmt.Println()
		return nil
	}

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
	if lat != 0 {
		cfg.Connection.ReceiverLat = lat
	}
	if lon != 0 {
		cfg.Connection.ReceiverLon = lon
	}
	if maxRange != 0 {
		cfg.Radar.DefaultRange = maxRange
	}
	if themeName != "" {
		cfg.Display.Theme = themeName
	}
	if exportDir != "" {
		absPath, err := filepath.Abs(exportDir)
		if err == nil {
			cfg.Export.Directory = absPath
		} else {
			cfg.Export.Directory = exportDir
		}
	}

	// Add command-line overlays
	for _, ov := range overlays {
		absPath, err := filepath.Abs(ov)
		if err != nil {
			absPath = ov
		}
		if _, err := os.Stat(absPath); err == nil {
			cfg.Overlays.Overlays = append(cfg.Overlays.Overlays, config.OverlayConfig{
				Path:    absPath,
				Enabled: true,
			})
		}
	}

	// Check authentication
	authMgr, err := auth.NewManager(cfg.Connection.Host, cfg.Connection.Port)
	if err != nil {
		fmt.Printf("⚠ Warning: Could not connect to server for auth check: %v\n", err)
	}

	// Set API key if provided
	if apiKey != "" {
		authMgr.SetAPIKey(apiKey)
	}

	// Check if authentication is required
	if authMgr != nil && authMgr.RequiresAuth() && !authMgr.IsAuthenticated() {
		authCfg := authMgr.GetAuthConfig()
		fmt.Printf("⚠ Server requires authentication\n")
		if authCfg.OIDCEnabled {
			fmt.Printf("  Run 'skyspy login' to authenticate with %s\n", authCfg.OIDCProviderName)
		}
		if authCfg.APIKeyEnabled {
			fmt.Printf("  Or use --api-key <key> for API key authentication\n")
		}
		fmt.Println()
		return fmt.Errorf("authentication required")
	}

	// Show startup banner
	t := theme.Get(cfg.Display.Theme)
	fmt.Printf("\033[38;5;%dm", colorToANSI(string(t.PrimaryBright)))
	fmt.Println("  ╔════════════════════════════════════════════╗")
	fmt.Println("  ║     SKYSPY RADAR PRO - INITIALIZING...     ║")
	fmt.Println("  ╚════════════════════════════════════════════╝")
	fmt.Print("\033[0m")
	fmt.Printf("  Theme: %s\n", t.Name)

	// Show auth status
	if authMgr != nil && authMgr.IsAuthenticated() {
		if username := authMgr.GetUsername(); username != "" {
			fmt.Printf("  User: %s\n", username)
		} else if apiKey != "" {
			fmt.Printf("  Auth: API Key\n")
		}
	}

	fmt.Printf("  Connecting to %s:%d...\n\n", cfg.Connection.Host, cfg.Connection.Port)

	// Create and run the Bubble Tea program
	model := app.NewModelWithAuth(cfg, authMgr)

	// Disable audio if --no-audio flag is set
	if noAudio {
		model.SetAudioEnabled(false)
	}

	p := tea.NewProgram(model,
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	if _, err := p.Run(); err != nil {
		return err
	}

	// Save config on exit
	_ = config.Save(cfg)
	fmt.Printf("\n  Settings saved. Clear skies!\n\n")

	return nil
}

// colorToANSI converts a color to an ANSI code (simplified)
func colorToANSI(color string) int {
	// Handle ANSI 256 colors
	switch color {
	case "28":
		return 28 // green
	case "46":
		return 46 // bright_green
	case "51":
		return 51 // bright_cyan
	case "201":
		return 201 // bright_magenta
	case "226":
		return 226 // bright_yellow
	default:
		return 46 // default to bright green
	}
}
