package airband

import (
	"fmt"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics holds all Prometheus metrics for the airband uploader,
// mirroring the 13 metrics from the Python uploader.
type Metrics struct {
	uploadsTotal        *prometheus.CounterVec
	uploadsSuccess      *prometheus.CounterVec
	uploadsFailed       *prometheus.CounterVec
	uploadsDiscarded    *prometheus.CounterVec
	uploadDuration      *prometheus.HistogramVec
	fileSizeBytes       *prometheus.HistogramVec
	queueDepth          *prometheus.GaugeVec
	failedQueueDepth    prometheus.Gauge
	lastUploadTimestamp *prometheus.GaugeVec
	lastActivityTS      prometheus.Gauge
	retryAttempts       *prometheus.CounterVec
	apiResponseCodes    *prometheus.CounterVec
	uploaderInfo        *prometheus.GaugeVec
}

// NewMetrics registers and returns all Prometheus metrics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	m := &Metrics{
		uploadsTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rtl_airband_uploads_total",
			Help: "Total number of upload attempts",
		}, []string{"status", "channel"}),

		uploadsSuccess: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rtl_airband_uploads_success_total",
			Help: "Total successful uploads",
		}, []string{"channel"}),

		uploadsFailed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rtl_airband_uploads_failed_total",
			Help: "Total failed uploads",
		}, []string{"channel", "reason"}),

		uploadsDiscarded: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rtl_airband_uploads_discarded_total",
			Help: "Total discarded uploads (empty/too small)",
		}, []string{"channel", "reason"}),

		uploadDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "rtl_airband_upload_duration_seconds",
			Help:    "Time spent uploading files",
			Buckets: []float64{0.5, 1, 2, 5, 10, 30, 60, 120},
		}, []string{"channel"}),

		fileSizeBytes: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "rtl_airband_file_size_bytes",
			Help:    "Size of uploaded files in bytes",
			Buckets: []float64{1024, 5120, 10240, 51200, 102400, 512000, 1048576, 5242880},
		}, []string{"channel"}),

		queueDepth: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "rtl_airband_queue_depth",
			Help: "Number of files waiting to be uploaded",
		}, []string{"directory"}),

		failedQueueDepth: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "rtl_airband_failed_queue_depth",
			Help: "Number of files in failed queue",
		}),

		lastUploadTimestamp: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "rtl_airband_last_upload_timestamp",
			Help: "Unix timestamp of last successful upload",
		}, []string{"channel"}),

		lastActivityTS: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "rtl_airband_last_activity_timestamp",
			Help: "Unix timestamp of last file activity (new file detected)",
		}),

		retryAttempts: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rtl_airband_retry_attempts_total",
			Help: "Total retry attempts for failed uploads",
		}, []string{"channel"}),

		apiResponseCodes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rtl_airband_api_response_codes_total",
			Help: "HTTP response codes from API",
		}, []string{"code"}),

		uploaderInfo: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "rtl_airband_uploader_info",
			Help: "Information about the uploader service",
		}, []string{"version", "map_size"}),
	}

	reg.MustRegister(
		m.uploadsTotal,
		m.uploadsSuccess,
		m.uploadsFailed,
		m.uploadsDiscarded,
		m.uploadDuration,
		m.fileSizeBytes,
		m.queueDepth,
		m.failedQueueDepth,
		m.lastUploadTimestamp,
		m.lastActivityTS,
		m.retryAttempts,
		m.apiResponseCodes,
		m.uploaderInfo,
	)

	return m
}

// SetUploaderInfo sets the static info metric.
func (m *Metrics) SetUploaderInfo(version, mapSize string) {
	m.uploaderInfo.WithLabelValues(version, mapSize).Set(1)
}

// IncUploadsTotal increments the total uploads counter.
func (m *Metrics) IncUploadsTotal(status, channel string) {
	m.uploadsTotal.WithLabelValues(status, channel).Inc()
}

// IncUploadsSuccess increments the success counter.
func (m *Metrics) IncUploadsSuccess(channel string) {
	m.uploadsSuccess.WithLabelValues(channel).Inc()
}

// IncUploadsFailed increments the failed counter.
func (m *Metrics) IncUploadsFailed(channel, reason string) {
	m.uploadsFailed.WithLabelValues(channel, reason).Inc()
}

// IncUploadsDiscarded increments the discarded counter.
func (m *Metrics) IncUploadsDiscarded(channel, reason string) {
	m.uploadsDiscarded.WithLabelValues(channel, reason).Inc()
}

// ObserveUploadDuration records an upload duration.
func (m *Metrics) ObserveUploadDuration(channel string, seconds float64) {
	m.uploadDuration.WithLabelValues(channel).Observe(seconds)
}

// ObserveFileSize records a file size.
func (m *Metrics) ObserveFileSize(channel string, bytes float64) {
	m.fileSizeBytes.WithLabelValues(channel).Observe(bytes)
}

// SetQueueDepth sets the queue depth gauge.
func (m *Metrics) SetQueueDepth(directory string, count float64) {
	m.queueDepth.WithLabelValues(directory).Set(count)
}

// SetFailedQueueDepth sets the failed queue depth gauge.
func (m *Metrics) SetFailedQueueDepth(count float64) {
	m.failedQueueDepth.Set(count)
}

// SetLastUploadTimestamp records the current time as last upload.
func (m *Metrics) SetLastUploadTimestamp(channel string) {
	m.lastUploadTimestamp.WithLabelValues(channel).Set(float64(time.Now().Unix()))
}

// SetLastActivityTimestamp records the current time as last activity.
func (m *Metrics) SetLastActivityTimestamp() {
	m.lastActivityTS.Set(float64(time.Now().Unix()))
}

// IncRetryAttempts increments the retry counter.
func (m *Metrics) IncRetryAttempts(channel string) {
	m.retryAttempts.WithLabelValues(channel).Inc()
}

// IncAPIResponseCodes increments the API response code counter.
func (m *Metrics) IncAPIResponseCodes(code string) {
	m.apiResponseCodes.WithLabelValues(code).Inc()
}

// ServeMetrics starts an HTTP server for Prometheus scraping on the given port.
// It blocks until the server shuts down. Pass 0 to disable.
func ServeMetrics(port int, handler http.Handler) *http.Server {
	if port == 0 {
		return nil
	}
	mux := http.NewServeMux()
	mux.Handle("/metrics", handler)

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		_ = srv.ListenAndServe()
	}()
	return srv
}

// NewMetricsHandler returns a promhttp.Handler for the given registry.
func NewMetricsHandler(reg *prometheus.Registry) http.Handler {
	return promhttp.HandlerFor(reg, promhttp.HandlerOpts{})
}
