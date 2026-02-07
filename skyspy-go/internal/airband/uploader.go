package airband

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"time"
)

// AuthProvider returns an Authorization header value (e.g. "Bearer xxx" or "ApiKey sk_xxx").
type AuthProvider func() (string, error)

// Uploader handles HTTP multipart uploads to the Django API.
type Uploader struct {
	baseURL      string
	authProvider AuthProvider
	client       *http.Client
	maxRetries   int
	metrics      *Metrics
	logger       *slog.Logger
}

// NewUploader creates an Uploader targeting the given API base URL.
func NewUploader(host string, port int, timeout int, maxRetries int, authProvider AuthProvider, metrics *Metrics, logger *slog.Logger) *Uploader {
	baseURL := fmt.Sprintf("http://%s:%d", host, port)
	return &Uploader{
		baseURL:      baseURL,
		authProvider: authProvider,
		client: &http.Client{
			Timeout: time.Duration(timeout) * time.Second,
		},
		maxRetries: maxRetries,
		metrics:    metrics,
		logger:     logger,
	}
}

// Upload sends a recording to POST /api/v1/audio/upload/ with retry and
// exponential backoff. Returns true on success.
func (u *Uploader) Upload(meta FileMetadata) bool {
	channel := meta.ChannelName

	if u.metrics != nil {
		u.metrics.ObserveFileSize(channel, float64(meta.FileSize))
	}

	for attempt := 1; attempt <= u.maxRetries; attempt++ {
		if attempt == 1 {
			u.logger.Info("uploading recording",
				"file", meta.Filename,
				"channel", channel,
				"frequency_mhz", meta.FrequencyMHz,
				"size", meta.FileSize,
			)
		}

		if u.metrics != nil {
			u.metrics.IncUploadsTotal("attempt", channel)
			if attempt > 1 {
				u.metrics.IncRetryAttempts(channel)
			}
		}

		start := time.Now()
		ok, retryable := u.tryUpload(meta, channel)
		duration := time.Since(start).Seconds()

		if u.metrics != nil {
			u.metrics.ObserveUploadDuration(channel, duration)
		}

		if ok {
			if u.metrics != nil {
				u.metrics.IncUploadsSuccess(channel)
				u.metrics.IncUploadsTotal("success", channel)
				u.metrics.SetLastUploadTimestamp(channel)
			}
			return true
		}

		if !retryable {
			break
		}

		if attempt < u.maxRetries {
			backoff := time.Duration(1<<uint(attempt)) * time.Second // 2s, 4s, 8s...
			u.logger.Info("retrying after backoff", "attempt", attempt, "backoff", backoff)
			time.Sleep(backoff)
		}
	}

	if u.metrics != nil {
		u.metrics.IncUploadsFailed(channel, "max_retries")
		u.metrics.IncUploadsTotal("failed", channel)
	}
	u.logger.Error("failed all retries", "file", meta.Filename)
	return false
}

// DryRun logs what would happen without actually uploading.
func (u *Uploader) DryRun(meta FileMetadata) {
	u.logger.Info("[dry-run] would upload",
		"file", meta.Filename,
		"channel", meta.ChannelName,
		"frequency_mhz", meta.FrequencyMHz,
		"size", meta.FileSize,
	)
}

// tryUpload performs a single upload attempt. Returns (success, retryable).
func (u *Uploader) tryUpload(meta FileMetadata, channel string) (bool, bool) {
	f, err := os.Open(meta.FilePath)
	if err != nil {
		u.logger.Error("failed to open file", "file", meta.FilePath, "err", err)
		return false, false
	}
	defer f.Close()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Add file field
	part, err := writer.CreateFormFile("file", meta.Filename)
	if err != nil {
		u.logger.Error("failed to create form file", "err", err)
		return false, false
	}
	if _, err := io.Copy(part, f); err != nil {
		u.logger.Error("failed to copy file data", "err", err)
		return false, false
	}

	// Add form fields
	_ = writer.WriteField("queue_transcription", "true")
	_ = writer.WriteField("channel_name", meta.ChannelName)

	if meta.HasFrequency {
		_ = writer.WriteField("frequency_mhz", strconv.FormatFloat(meta.FrequencyMHz, 'f', -1, 64))
	}
	if meta.HasTimestamp {
		_ = writer.WriteField("timestamp_utc", meta.Timestamp.UTC().Format(time.RFC3339))
	}

	if err := writer.Close(); err != nil {
		u.logger.Error("failed to close multipart writer", "err", err)
		return false, false
	}

	endpoint := u.baseURL + "/api/v1/audio/upload/"
	req, err := http.NewRequest(http.MethodPost, endpoint, body)
	if err != nil {
		u.logger.Error("failed to create request", "err", err)
		return false, false
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	// Set auth header
	if u.authProvider != nil {
		if authHeader, err := u.authProvider(); err == nil && authHeader != "" {
			req.Header.Set("Authorization", authHeader)
		}
	}

	resp, err := u.client.Do(req)
	if err != nil {
		u.logger.Warn("upload request failed", "err", err)
		return false, true // connection/timeout errors are retryable
	}
	defer resp.Body.Close()

	if u.metrics != nil {
		u.metrics.IncAPIResponseCodes(strconv.Itoa(resp.StatusCode))
	}

	switch {
	case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated:
		return true, false

	case resp.StatusCode == http.StatusBadRequest:
		u.logger.Error("bad request, skipping", "file", meta.Filename, "status", resp.StatusCode)
		if u.metrics != nil {
			u.metrics.IncUploadsFailed(channel, "bad_request")
		}
		return false, false

	case resp.StatusCode == http.StatusRequestEntityTooLarge:
		u.logger.Error("file too large, skipping", "file", meta.Filename)
		if u.metrics != nil {
			u.metrics.IncUploadsFailed(channel, "file_too_large")
		}
		return false, false

	case resp.StatusCode == http.StatusServiceUnavailable:
		u.logger.Error("radio service disabled on API")
		if u.metrics != nil {
			u.metrics.IncUploadsFailed(channel, "service_disabled")
		}
		return false, false

	default:
		// 5xx and other errors are retryable
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		u.logger.Warn("upload failed",
			"status", resp.StatusCode,
			"body", string(bodyBytes),
		)
		return false, resp.StatusCode >= 500
	}
}
