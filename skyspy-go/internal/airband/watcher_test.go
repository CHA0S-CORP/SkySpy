package airband

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWatcher_ProcessesBacklog(t *testing.T) {
	dir := t.TempDir()

	// Create a "stable" MP3 file (old mod time)
	fpath := filepath.Join(dir, "airband_119900000_20260104_120000.mp3")
	if err := os.WriteFile(fpath, make([]byte, 10000), 0o644); err != nil {
		t.Fatal(err)
	}
	// Set mod time to 10 seconds ago to pass stability check
	past := time.Now().Add(-10 * time.Second)
	if err := os.Chtimes(fpath, past, past); err != nil {
		t.Fatal(err)
	}

	// Mock API server
	uploadCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uploadCount++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	chanMap := NewChannelMap(map[string]string{"119900000": "SEA-Twr"})

	uploader := &Uploader{
		baseURL:    server.URL,
		client:     server.Client(),
		maxRetries: 1,
		logger:     logger,
	}

	failedQueue := NewFailedQueue(dir, logger)

	watcher := NewWatcher(WatcherConfig{
		RecordingsDir:    dir,
		ChanMap:          chanMap,
		Uploader:         uploader,
		FailedQueue:      failedQueue,
		Logger:           logger,
		PollInterval:     1,
		RetryInterval:    60,
		StabilitySeconds: 2,
		MinFileSize:      2048,
		MinDuration:      2.0,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	go watcher.Run(ctx)

	// Wait for processing
	time.Sleep(2 * time.Second)
	cancel()

	if uploadCount == 0 {
		t.Error("expected at least one upload from backlog processing")
	}

	// File should be cleaned up after successful upload
	if _, err := os.Stat(fpath); !os.IsNotExist(err) {
		t.Error("expected file to be removed after successful upload")
	}
}

func TestWatcher_DiscardsSmallFiles(t *testing.T) {
	dir := t.TempDir()

	// Create a small MP3 file (below min size)
	fpath := filepath.Join(dir, "airband_119900000_20260104_120000.mp3")
	if err := os.WriteFile(fpath, make([]byte, 100), 0o644); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-10 * time.Second)
	if err := os.Chtimes(fpath, past, past); err != nil {
		t.Fatal(err)
	}

	uploadCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uploadCount++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	chanMap := NewChannelMap(map[string]string{})

	uploader := &Uploader{
		baseURL:    server.URL,
		client:     server.Client(),
		maxRetries: 1,
		logger:     logger,
	}

	failedQueue := NewFailedQueue(dir, logger)

	watcher := NewWatcher(WatcherConfig{
		RecordingsDir:    dir,
		ChanMap:          chanMap,
		Uploader:         uploader,
		FailedQueue:      failedQueue,
		Logger:           logger,
		PollInterval:     1,
		RetryInterval:    60,
		StabilitySeconds: 2,
		MinFileSize:      2048,
		MinDuration:      2.0,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	go watcher.Run(ctx)
	time.Sleep(2 * time.Second)
	cancel()

	if uploadCount != 0 {
		t.Errorf("expected no uploads for small file, got %d", uploadCount)
	}

	// File should be cleaned up (discarded)
	if _, err := os.Stat(fpath); !os.IsNotExist(err) {
		t.Error("expected small file to be cleaned up after discard")
	}
}

func TestWatcher_SkipsUnstableFiles(t *testing.T) {
	dir := t.TempDir()

	// Create a file with current mod time (not stable yet)
	fpath := filepath.Join(dir, "airband_119900000_20260104_120000.mp3")
	if err := os.WriteFile(fpath, make([]byte, 10000), 0o644); err != nil {
		t.Fatal(err)
	}
	// Don't set old mod time — file is "being written"

	uploadCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uploadCount++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

	uploader := &Uploader{
		baseURL:    server.URL,
		client:     server.Client(),
		maxRetries: 1,
		logger:     logger,
	}

	failedQueue := NewFailedQueue(dir, logger)

	watcher := NewWatcher(WatcherConfig{
		RecordingsDir:    dir,
		ChanMap:          NewChannelMap(map[string]string{}),
		Uploader:         uploader,
		FailedQueue:      failedQueue,
		Logger:           logger,
		PollInterval:     1,
		RetryInterval:    60,
		StabilitySeconds: 30, // Long stability window
		MinFileSize:      2048,
		MinDuration:      2.0,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	go watcher.Run(ctx)
	time.Sleep(1500 * time.Millisecond)
	cancel()

	if uploadCount != 0 {
		t.Errorf("expected no uploads for unstable file, got %d", uploadCount)
	}

	// File should still exist (not processed)
	if _, err := os.Stat(fpath); os.IsNotExist(err) {
		t.Error("expected unstable file to still exist")
	}
}

func TestWatcher_DryRun(t *testing.T) {
	dir := t.TempDir()

	fpath := filepath.Join(dir, "airband_119900000_20260104_120000.mp3")
	if err := os.WriteFile(fpath, make([]byte, 10000), 0o644); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-10 * time.Second)
	if err := os.Chtimes(fpath, past, past); err != nil {
		t.Fatal(err)
	}

	uploadCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uploadCount++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

	uploader := &Uploader{
		baseURL:    server.URL,
		client:     server.Client(),
		maxRetries: 1,
		logger:     logger,
	}

	failedQueue := NewFailedQueue(dir, logger)

	watcher := NewWatcher(WatcherConfig{
		RecordingsDir:    dir,
		ChanMap:          NewChannelMap(map[string]string{}),
		Uploader:         uploader,
		FailedQueue:      failedQueue,
		Logger:           logger,
		PollInterval:     1,
		RetryInterval:    60,
		StabilitySeconds: 2,
		MinFileSize:      2048,
		MinDuration:      2.0,
		DryRun:           true,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	go watcher.Run(ctx)
	time.Sleep(2 * time.Second)
	cancel()

	if uploadCount != 0 {
		t.Errorf("expected no uploads in dry-run mode, got %d", uploadCount)
	}

	// File should still exist in dry-run mode
	if _, err := os.Stat(fpath); os.IsNotExist(err) {
		t.Error("expected file to still exist in dry-run mode")
	}
}
