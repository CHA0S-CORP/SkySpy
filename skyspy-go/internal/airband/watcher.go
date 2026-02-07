package airband

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Watcher polls a directory for new MP3 recordings and processes them.
type Watcher struct {
	recordingsDir string
	chanMap       *ChannelMap
	uploader      *Uploader
	failedQueue   *FailedQueue
	metrics       *Metrics
	logger        *slog.Logger

	pollInterval     time.Duration
	retryInterval    time.Duration
	stabilitySeconds int
	minFileSize      int
	minDuration      float64
	dryRun           bool

	// eventCh emits ProcessResults for the TUI to display.
	eventCh chan ProcessResult
}

// WatcherConfig holds all settings needed to construct a Watcher.
type WatcherConfig struct {
	RecordingsDir    string
	ChanMap          *ChannelMap
	Uploader         *Uploader
	FailedQueue      *FailedQueue
	Metrics          *Metrics
	Logger           *slog.Logger
	PollInterval     int // seconds
	RetryInterval    int // seconds
	StabilitySeconds int
	MinFileSize      int
	MinDuration      float64
	DryRun           bool
}

// NewWatcher creates a Watcher from the given config.
func NewWatcher(cfg WatcherConfig) *Watcher {
	return &Watcher{
		recordingsDir:    cfg.RecordingsDir,
		chanMap:          cfg.ChanMap,
		uploader:         cfg.Uploader,
		failedQueue:      cfg.FailedQueue,
		metrics:          cfg.Metrics,
		logger:           cfg.Logger,
		pollInterval:     time.Duration(cfg.PollInterval) * time.Second,
		retryInterval:    time.Duration(cfg.RetryInterval) * time.Second,
		stabilitySeconds: cfg.StabilitySeconds,
		minFileSize:      cfg.MinFileSize,
		minDuration:      cfg.MinDuration,
		dryRun:           cfg.DryRun,
		eventCh:          make(chan ProcessResult, 100),
	}
}

// Events returns a channel that emits ProcessResults for the TUI.
func (w *Watcher) Events() <-chan ProcessResult {
	return w.eventCh
}

// Run starts the polling loop. It blocks until ctx is canceled.
func (w *Watcher) Run(ctx context.Context) {
	// Ensure directories exist
	if err := os.MkdirAll(w.recordingsDir, 0o755); err != nil {
		w.logger.Error("failed to create recordings directory", "dir", w.recordingsDir, "err", err)
		return
	}
	_ = w.failedQueue.EnsureDir()

	// Process any backlog
	w.pollOnce()

	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	retryTicker := time.NewTicker(w.retryInterval)
	defer retryTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			w.logger.Info("watcher shutting down")
			close(w.eventCh)
			return
		case <-ticker.C:
			w.pollOnce()
		case <-retryTicker.C:
			if !w.dryRun {
				w.failedQueue.RetryFailed(w.chanMap, w.uploader)
			}
		}
	}
}

// pollOnce reads the recordings directory and processes each MP3 file.
func (w *Watcher) pollOnce() {
	entries, err := os.ReadDir(w.recordingsDir)
	if err != nil {
		w.logger.Error("failed to read recordings directory", "err", err)
		return
	}

	// Update queue depth metrics
	mp3Count := 0
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".mp3") {
			mp3Count++
		}
	}
	if w.metrics != nil {
		w.metrics.SetQueueDepth("main", float64(mp3Count))
		w.metrics.SetFailedQueueDepth(float64(w.failedQueue.Count()))
	}

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".mp3") {
			continue
		}

		fpath := filepath.Join(w.recordingsDir, name)
		w.processFile(fpath)
	}
}

// processFile handles a single MP3 file: stability check, filter, upload/discard.
func (w *Watcher) processFile(fpath string) {
	// Stability check: file must not have been modified recently
	info, err := os.Stat(fpath)
	if err != nil {
		return
	}
	age := time.Since(info.ModTime())
	if age < time.Duration(w.stabilitySeconds)*time.Second {
		return // still being written
	}

	meta := ParseFilename(fpath, w.chanMap)

	// Filter
	fr := Filter(meta, w.minFileSize, w.minDuration)
	if !fr.Passed {
		if w.metrics != nil {
			w.metrics.IncUploadsDiscarded(meta.ChannelName, fr.Reason)
		}
		w.logger.Info("discarding transmission",
			"file", meta.Filename,
			"channel", meta.ChannelName,
			"reason", fr.Reason,
			"size", meta.FileSize,
		)
		result := ProcessResult{Metadata: meta, Action: ActionDiscarded, Reason: fr.Reason}
		w.emit(result)
		cleanupFiles(fpath)
		return
	}

	if w.metrics != nil {
		w.metrics.SetLastActivityTimestamp()
	}

	if w.dryRun {
		w.uploader.DryRun(meta)
		result := ProcessResult{Metadata: meta, Action: ActionSkipped, Reason: "dry-run"}
		w.emit(result)
		return
	}

	// Upload
	if w.uploader.Upload(meta) {
		cleanupFiles(fpath)
		result := ProcessResult{Metadata: meta, Action: ActionUploaded}
		w.emit(result)
	} else {
		w.failedQueue.MoveToFailed(fpath)
		result := ProcessResult{Metadata: meta, Action: ActionFailed, Reason: "upload_failed"}
		w.emit(result)
	}
}

// emit sends a result to the event channel without blocking.
func (w *Watcher) emit(r ProcessResult) {
	select {
	case w.eventCh <- r:
	default:
		// Drop if channel is full — TUI can't keep up, that's OK
	}
}
