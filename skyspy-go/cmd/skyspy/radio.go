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
	radioFrequency string
	radioScanMode  bool
)

var radioCmd = &cobra.Command{
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
	RunE: runRadio,
}

func init() {
	radioCmd.Flags().StringVar(&radioFrequency, "frequency", "", "Monitor specific frequency (e.g., 1090, 136.9)")
	radioCmd.Flags().BoolVar(&radioScanMode, "scan", false, "Enable frequency scanning mode")
}

func runRadio(cmd *cobra.Command, args []string) error {
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
	fmt.Println("   _____ _            _____              _____           _ _       ")
	fmt.Println("  / ____| |          / ____|            |  __ \\         | (_)      ")
	fmt.Println(" | (___ | | ___   _ | (___  _ __  _   _ | |__) |__ _  __| |_  ___  ")
	fmt.Println("  \\___ \\| |/ / | | | \\___ \\| '_ \\| | | ||  _  // _` |/ _` | |/ _ \\ ")
	fmt.Println("  ____) |   <| |_| | ____) | |_) | |_| || | \\ \\ (_| | (_| | | (_) |")
	fmt.Println(" |_____/|_|\\_\\\\__, ||_____/| .__/ \\__, ||_|  \\_\\__,_|\\__,_|_|\\___/ ")
	fmt.Println("               __/ |       | |     __/ |                          ")
	fmt.Println("              |___/        |_|    |___/   v1.0 - LIVE FEED")
	fmt.Println("")
	fmt.Print("\033[0m")

	fmt.Printf("  Connecting to %s:%d...\n\n", cfg.Connection.Host, cfg.Connection.Port)

	// Create radio model
	model := radio.NewModel(cfg, radio.ModeBasic)
	model.ScanMode = radioScanMode
	model.FilterFrequency = radioFrequency

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
	fmt.Printf("\n  73s de SkySpy Radio - Clear skies!\n\n")

	return nil
}
