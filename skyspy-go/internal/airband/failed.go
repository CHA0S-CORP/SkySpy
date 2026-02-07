package airband

import (
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// FailedQueue manages the failed/ subdirectory for recordings that could
// not be uploaded.
type FailedQueue struct {
	failedDir string
	logger    *slog.Logger
}

// NewFailedQueue creates a FailedQueue rooted at <recordingsDir>/failed.
func NewFailedQueue(recordingsDir string, logger *slog.Logger) *FailedQueue {
	return &FailedQueue{
		failedDir: filepath.Join(recordingsDir, "failed"),
		logger:    logger,
	}
}

// EnsureDir creates the failed directory if it doesn't exist.
func (fq *FailedQueue) EnsureDir() error {
	return os.MkdirAll(fq.failedDir, 0o755)
}

// MoveToFailed moves an MP3 file (and its .meta companion) to the failed directory.
func (fq *FailedQueue) MoveToFailed(fpath string) {
	if err := fq.EnsureDir(); err != nil {
		fq.logger.Error("failed to create failed directory", "err", err)
		return
	}

	filename := filepath.Base(fpath)
	dest := filepath.Join(fq.failedDir, filename)

	if err := os.Rename(fpath, dest); err != nil {
		fq.logger.Error("failed to move file to failed dir", "file", filename, "err", err)
		return
	}

	// Also move .meta file if it exists
	metaPath := strings.TrimSuffix(fpath, filepath.Ext(fpath)) + ".meta"
	if _, err := os.Stat(metaPath); err == nil {
		metaDest := filepath.Join(fq.failedDir, filepath.Base(metaPath))
		_ = os.Rename(metaPath, metaDest)
	}

	fq.logger.Info("moved to failed", "file", filename)
}

// RetryFailed attempts to re-upload all MP3s in the failed directory.
// It re-parses each filename so updated frequency maps take effect.
func (fq *FailedQueue) RetryFailed(chanMap *ChannelMap, uploader *Uploader) {
	entries, err := os.ReadDir(fq.failedDir)
	if err != nil {
		return // directory may not exist yet
	}

	var mp3s []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".mp3") {
			mp3s = append(mp3s, filepath.Join(fq.failedDir, e.Name()))
		}
	}

	if len(mp3s) == 0 {
		return
	}

	sort.Strings(mp3s)
	fq.logger.Info("retrying failed uploads", "count", len(mp3s))

	for _, fpath := range mp3s {
		meta := ParseFilename(fpath, chanMap)
		if uploader.Upload(meta) {
			cleanupFiles(fpath)
		}
	}
}

// Count returns the number of MP3 files in the failed directory.
func (fq *FailedQueue) Count() int {
	entries, err := os.ReadDir(fq.failedDir)
	if err != nil {
		return 0
	}
	count := 0
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".mp3") {
			count++
		}
	}
	return count
}

// cleanupFiles removes an MP3 and its .meta companion.
func cleanupFiles(fpath string) {
	_ = os.Remove(fpath)
	metaPath := strings.TrimSuffix(fpath, filepath.Ext(fpath)) + ".meta"
	_ = os.Remove(metaPath)
}
