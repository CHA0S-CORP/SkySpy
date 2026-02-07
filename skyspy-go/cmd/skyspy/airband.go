// Package main provides the entry point for the SkySpy CLI application
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/skyspy/skyspy-go/internal/airband"
	"github.com/skyspy/skyspy-go/internal/auth"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/spf13/cobra"
)

var (
	airbandDir           string
	airbandTUI           bool
	airbandFreqMapFile   string
	airbandPollInterval  int
	airbandMinFileSize   int
	airbandMinDuration   float64
	airbandMaxRetries    int
	airbandMetricsPort   int
	airbandUploadTimeout int
	airbandStability     int
	airbandDryRun        bool
)

var airbandCmd = &cobra.Command{
	Use:   "airband",
	Short: "RTL-Airband Recording Uploader",
	Long: `RTL-Airband Recording Uploader

Watches a directory for MP3 recordings from rtl-airband, maps frequencies
to channel labels, filters empty/short transmissions, and uploads them
to the SkySpy API.

Runs as a headless daemon by default. Use --tui for a live monitoring display.

Examples:
  skyspy airband --dir /recordings
  skyspy airband --dir /recordings --tui
  skyspy airband --dir /recordings --freq-map /etc/skyspy/freq-map.json
  skyspy airband --dir /recordings --dry-run
  skyspy airband --dir /recordings --host server.local --port 8000 --api-key sk_xxx`,
	RunE: runAirband,
}

// RegisterAirbandFlags sets up the airband command flags.
func RegisterAirbandFlags() {
	airbandCmd.Flags().StringVar(&airbandDir, "dir", "", "Recordings directory (required, or SKYSPY_RECORDINGS_DIR)")
	airbandCmd.Flags().BoolVar(&airbandTUI, "tui", false, "Enable live monitoring TUI")
	airbandCmd.Flags().StringVar(&airbandFreqMapFile, "freq-map", "", "Path to JSON frequency map file (or SKYSPY_FREQ_MAP)")
	airbandCmd.Flags().IntVar(&airbandPollInterval, "poll-interval", 0, "Poll interval in seconds (default 5)")
	airbandCmd.Flags().IntVar(&airbandMinFileSize, "min-file-size", 0, "Minimum file size in bytes (default 2048)")
	airbandCmd.Flags().Float64Var(&airbandMinDuration, "min-duration", 0, "Minimum duration in seconds (default 2.0)")
	airbandCmd.Flags().IntVar(&airbandMaxRetries, "max-retries", 0, "Maximum upload retries (default 3)")
	airbandCmd.Flags().IntVar(&airbandMetricsPort, "metrics-port", 0, "Prometheus metrics port, 0 to disable (default 9090)")
	airbandCmd.Flags().IntVar(&airbandUploadTimeout, "upload-timeout", 0, "Upload timeout in seconds (default 60)")
	airbandCmd.Flags().IntVar(&airbandStability, "stability-seconds", 0, "File stability wait in seconds (default 2)")
	airbandCmd.Flags().BoolVar(&airbandDryRun, "dry-run", false, "Parse and filter without uploading")
}

func runAirband(cmd *cobra.Command, args []string) error {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Apply persistent flag overrides
	if host != "" {
		cfg.Connection.Host = host
	}
	if port != 0 {
		cfg.Connection.Port = port
	}

	// Apply airband-specific overrides (CLI flags > env vars > config defaults)
	ab := &cfg.Airband

	// --dir / SKYSPY_RECORDINGS_DIR
	if airbandDir != "" {
		ab.RecordingsDir = airbandDir
	} else if envDir := os.Getenv("SKYSPY_RECORDINGS_DIR"); envDir != "" {
		ab.RecordingsDir = envDir
	}
	if ab.RecordingsDir == "" {
		return fmt.Errorf("recordings directory required: use --dir or SKYSPY_RECORDINGS_DIR")
	}

	// Numeric overrides
	if airbandPollInterval > 0 {
		ab.PollInterval = airbandPollInterval
	}
	if airbandMinFileSize > 0 {
		ab.MinFileSize = airbandMinFileSize
	}
	if airbandMinDuration > 0 {
		ab.MinDuration = airbandMinDuration
	}
	if airbandMaxRetries > 0 {
		ab.MaxRetries = airbandMaxRetries
	}
	if cmd.Flags().Changed("metrics-port") {
		ab.MetricsPort = airbandMetricsPort
	}
	if airbandUploadTimeout > 0 {
		ab.UploadTimeout = airbandUploadTimeout
	}
	if airbandStability > 0 {
		ab.StabilitySeconds = airbandStability
	}

	// Frequency map: --freq-map file > SKYSPY_FREQ_MAP env > config
	freqMapFile := airbandFreqMapFile
	if freqMapFile == "" {
		freqMapFile = os.Getenv("SKYSPY_FREQ_MAP")
	}
	if freqMapFile != "" {
		fmData, err := os.ReadFile(freqMapFile)
		if err != nil {
			return fmt.Errorf("failed to read frequency map file: %w", err)
		}
		var fmRaw map[string]string
		if err := json.Unmarshal(fmData, &fmRaw); err != nil {
			return fmt.Errorf("failed to parse frequency map JSON: %w", err)
		}
		ab.FrequencyMap = fmRaw
	}

	chanMap := airband.NewChannelMap(ab.FrequencyMap)

	// Logger
	logger := slog.Default()

	// Auth
	var authProvider airband.AuthProvider
	if !airbandDryRun {
		authMgr, err := auth.NewManager(cfg.Connection.Host, cfg.Connection.Port)
		if err != nil {
			logger.Warn("could not connect to server for auth check", "err", err)
		}
		if apiKey != "" {
			authMgr.SetAPIKey(apiKey)
		}
		authProvider = authMgr.GetAuthHeader
	}

	// Prometheus metrics
	var metrics *airband.Metrics
	var metricsSrv interface{ Close() error }
	if ab.MetricsPort > 0 {
		reg := prometheus.NewRegistry()
		metrics = airband.NewMetrics(reg)
		metrics.SetUploaderInfo("2.0.0", strconv.Itoa(chanMap.Size()))
		handler := airband.NewMetricsHandler(reg)
		metricsSrv = airband.ServeMetrics(ab.MetricsPort, handler)
		logger.Info("prometheus metrics enabled", "port", ab.MetricsPort)
	}

	// Uploader
	uploader := airband.NewUploader(
		cfg.Connection.Host,
		cfg.Connection.Port,
		ab.UploadTimeout,
		ab.MaxRetries,
		authProvider,
		metrics,
		logger,
	)

	// Failed queue
	failedQueue := airband.NewFailedQueue(ab.RecordingsDir, logger)

	// Watcher
	watcher := airband.NewWatcher(airband.WatcherConfig{
		RecordingsDir:    ab.RecordingsDir,
		ChanMap:          chanMap,
		Uploader:         uploader,
		FailedQueue:      failedQueue,
		Metrics:          metrics,
		Logger:           logger,
		PollInterval:     ab.PollInterval,
		RetryInterval:    ab.RetryInterval,
		StabilitySeconds: ab.StabilitySeconds,
		MinFileSize:      ab.MinFileSize,
		MinDuration:      ab.MinDuration,
		DryRun:           airbandDryRun,
	})

	// Context for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Log startup
	logger.Info("starting airband uploader",
		"dir", ab.RecordingsDir,
		"host", cfg.Connection.Host,
		"port", cfg.Connection.Port,
		"freq_map_size", chanMap.Size(),
		"dry_run", airbandDryRun,
	)

	if airbandTUI {
		// TUI mode: run watcher in background, Bubble Tea in foreground
		go watcher.Run(ctx)

		model := airband.NewTUIModel(watcher.Events())
		p := tea.NewProgram(model, tea.WithAltScreen())
		if _, err := p.Run(); err != nil {
			cancel()
			return err
		}
		cancel()
	} else {
		// Headless daemon mode
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

		go watcher.Run(ctx)

		<-sigCh
		logger.Info("received shutdown signal")
		cancel()
	}

	if metricsSrv != nil {
		_ = metricsSrv.Close()
	}

	return nil
}
