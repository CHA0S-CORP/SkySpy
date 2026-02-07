package airband

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestUploader_SuccessfulUpload(t *testing.T) {
	// Create a mock API server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/audio/upload/" {
			t.Errorf("expected /api/v1/audio/upload/, got %s", r.URL.Path)
		}

		// Verify multipart form
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			t.Errorf("failed to parse multipart form: %v", err)
		}

		if r.FormValue("channel_name") != "SEA-Twr-16L34R" {
			t.Errorf("expected channel_name SEA-Twr-16L34R, got %s", r.FormValue("channel_name"))
		}
		if r.FormValue("queue_transcription") != "true" {
			t.Errorf("expected queue_transcription true, got %s", r.FormValue("queue_transcription"))
		}

		_, _, err := r.FormFile("file")
		if err != nil {
			t.Errorf("expected file field: %v", err)
		}

		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Create temp file
	dir := t.TempDir()
	fpath := filepath.Join(dir, "test.mp3")
	if err := os.WriteFile(fpath, make([]byte, 5000), 0o644); err != nil {
		t.Fatal(err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	uploader := &Uploader{
		baseURL:    server.URL,
		client:     server.Client(),
		maxRetries: 1,
		logger:     logger,
	}

	meta := FileMetadata{
		FilePath:     fpath,
		Filename:     "test.mp3",
		ChannelName:  "SEA-Twr-16L34R",
		FrequencyMHz: 119.9,
		Timestamp:    time.Now(),
		FileSize:     5000,
		HasTimestamp:  true,
		HasFrequency: true,
	}

	if !uploader.Upload(meta) {
		t.Error("expected upload to succeed")
	}
}

func TestUploader_NonRetryable400(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	dir := t.TempDir()
	fpath := filepath.Join(dir, "test.mp3")
	if err := os.WriteFile(fpath, make([]byte, 5000), 0o644); err != nil {
		t.Fatal(err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	uploader := &Uploader{
		baseURL:    server.URL,
		client:     server.Client(),
		maxRetries: 3,
		logger:     logger,
	}

	meta := FileMetadata{
		FilePath:    fpath,
		Filename:    "test.mp3",
		ChannelName: "Test",
		FileSize:    5000,
	}

	if uploader.Upload(meta) {
		t.Error("expected upload to fail on 400")
	}
}

func TestUploader_NonRetryable413(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
	}))
	defer server.Close()

	dir := t.TempDir()
	fpath := filepath.Join(dir, "test.mp3")
	if err := os.WriteFile(fpath, make([]byte, 5000), 0o644); err != nil {
		t.Fatal(err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	uploader := &Uploader{
		baseURL:    server.URL,
		client:     server.Client(),
		maxRetries: 3,
		logger:     logger,
	}

	meta := FileMetadata{
		FilePath:    fpath,
		Filename:    "test.mp3",
		ChannelName: "Test",
		FileSize:    5000,
	}

	if uploader.Upload(meta) {
		t.Error("expected upload to fail on 413")
	}
}

func TestUploader_AuthHeaderSent(t *testing.T) {
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	dir := t.TempDir()
	fpath := filepath.Join(dir, "test.mp3")
	if err := os.WriteFile(fpath, make([]byte, 5000), 0o644); err != nil {
		t.Fatal(err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	uploader := &Uploader{
		baseURL: server.URL,
		authProvider: func() (string, error) {
			return "ApiKey sk_test123", nil
		},
		client:     server.Client(),
		maxRetries: 1,
		logger:     logger,
	}

	meta := FileMetadata{
		FilePath:    fpath,
		Filename:    "test.mp3",
		ChannelName: "Test",
		FileSize:    5000,
	}

	uploader.Upload(meta)

	if gotAuth != "ApiKey sk_test123" {
		t.Errorf("expected auth header 'ApiKey sk_test123', got '%s'", gotAuth)
	}
}
