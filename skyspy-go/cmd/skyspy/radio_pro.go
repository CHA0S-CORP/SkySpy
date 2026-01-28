// Package main provides the entry point for the SkySpy CLI application
package main

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/radio"
	"github.com/skyspy/skyspy-go/internal/theme"
)

var (
	radioProFrequency string
	radioProScanMode  bool
)

var radioProCmd = &cobra.Command{
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
	RunE: runRadioPro,
}

func init() {
	radioProCmd.Flags().StringVar(&radioProFrequency, "frequency", "", "Monitor specific frequency (e.g., 1090, 136.9)")
	radioProCmd.Flags().BoolVar(&radioProScanMode, "scan", false, "Enable frequency scanning mode")
}

func runRadioPro(cmd *cobra.Command, args []string) error {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Apply command line overrides from persistent flags
	if host != "" {
		cfg.Connection.Host = host
	}
	if port != 0 {
		cfg.Connection.Port = port
	}

	// Show startup banner
	t := theme.Get(cfg.Display.Theme)
	fmt.Printf("\033[38;5;%dm", colorToANSI(string(t.PrimaryBright)))
	fmt.Println("")
	fmt.Println("  ████████████████████████████████████████████")
	fmt.Println("  █                                          █")
	fmt.Println("  █   SKYSPY RADIO PRO - INITIALIZING...     █")
	fmt.Println("  █                                          █")
	fmt.Println("  █   Features:                              █")
	fmt.Println("  █   ◉ Live Aircraft Tracking               █")
	fmt.Println("  █   ◉ ACARS/VDL2 Data Link Feed            █")
	fmt.Println("  █   ◉ VU Meters & Spectrum Display         █")
	fmt.Println("  █   ◉ Frequency Scanning                   █")
	fmt.Println("  █                                          █")
	fmt.Println("  ████████████████████████████████████████████")
	fmt.Println("")
	fmt.Print("\033[0m")

	fmt.Printf("  Connecting to %s:%d...\n\n", cfg.Connection.Host, cfg.Connection.Port)

	// Create radio model in pro mode
	model := radio.NewModel(cfg, radio.ModePro)
	model.ScanMode = radioProScanMode
	model.FilterFrequency = radioProFrequency

	// Create and run the Bubble Tea program
	p := tea.NewProgram(model,
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	if _, err := p.Run(); err != nil {
		return err
	}

	// Save config on exit
	_ = config.Save(cfg)
	fmt.Printf("\n  73 de SkySpy Radio - Clear skies!\n\n")

	return nil
}
