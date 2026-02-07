---
title: "RTL-Airband Recording Uploader"
slug: "cli-airband"
excerpt: "Watch and upload aviation radio recordings from rtl-airband to SkySpy"
hidden: false
---

# RTL-Airband Recording Uploader

The `skyspy airband` command is an integrated RTL-Airband recording uploader that watches a directory for MP3 recordings from [rtl-airband](https://github.com/charlie-foxtrot/RTLSDR-Airband), maps frequencies to human-readable channel labels, filters empty or short transmissions, and uploads them to the SkySpy Django API for transcription and archival.

> 📘 Migration from Python Service
>
> The rtl-airband-uploader was previously a standalone Python service. It's now integrated into the Go CLI as `skyspy airband`, eliminating the need for a Python runtime — especially useful on Raspberry Pi and embedded systems.

## Overview

**What it does:**
- Watches a directory for new MP3 recordings created by rtl-airband
- Parses filenames to extract frequency, timestamp, and channel metadata
- Maps frequencies to channel labels via a configurable frequency map
- Filters out empty/short transmissions based on file size and estimated duration
- Uploads valid recordings to the SkySpy API at `POST /api/v1/audio/upload/`
- Handles retries with exponential backoff for transient failures
- Exposes Prometheus metrics for monitoring upload health

**Modes:**
- **Headless daemon** (default): Runs in the background with structured logging via `log/slog`
- **Live TUI** (`--tui`): Displays a real-time Bubble Tea monitoring interface
- **Dry run** (`--dry-run`): Parse and filter files without actually uploading

**Monitoring:**
- Prometheus metrics exposed on port 9090 by default
- 13 metrics covering upload success/failure, file size, duration, queue depth, retry attempts, and API response codes
- Disable metrics with `--metrics-port 0`

## Quick Start

```bash
# Basic usage - watch /recordings and upload to localhost:8000
skyspy airband --dir /recordings --host localhost --port 8000

# With API key authentication
skyspy airband --dir /recordings --host skyspy.local --port 8000 --api-key sk_xxx

# Dry run - parse and filter without uploading
skyspy airband --dir /recordings --dry-run

# With live TUI monitoring
skyspy airband --dir /recordings --host localhost --port 8000 --tui

# With custom frequency map
skyspy airband --dir /recordings --freq-map /etc/skyspy/freq-map.json
```

## Command Reference

### Flags

| Flag | Environment Variable | Default | Description |
|------|---------------------|---------|-------------|
| `--dir` | `SKYSPY_RECORDINGS_DIR` | (required) | Recordings directory to watch |
| `--tui` | — | `false` | Enable live monitoring TUI |
| `--freq-map` | `SKYSPY_FREQ_MAP` | — | Path to JSON frequency map file |
| `--poll-interval` | — | `5` | Poll interval in seconds |
| `--min-file-size` | — | `2048` | Minimum file size in bytes |
| `--min-duration` | — | `2.0` | Minimum estimated duration in seconds |
| `--max-retries` | — | `3` | Maximum upload retries |
| `--metrics-port` | — | `9090` | Prometheus metrics port (0 to disable) |
| `--upload-timeout` | — | `60` | Upload timeout in seconds |
| `--stability-seconds` | — | `2` | File stability wait in seconds |
| `--dry-run` | — | `false` | Parse and filter without uploading |

**Inherited global flags:**
- `--host`: API server hostname (default: `localhost`)
- `--port`: API server port (default: `80`)
- `--api-key`: API key for authentication

### Priority Order

Settings are resolved in this order (highest to lowest priority):
1. CLI flags (e.g., `--dir`, `--freq-map`)
2. Environment variables (e.g., `SKYSPY_RECORDINGS_DIR`, `SKYSPY_FREQ_MAP`)
3. Configuration file (`~/.config/skyspy/settings.json` under `airband` key)
4. Built-in defaults

## Frequency Map

The frequency map is a JSON file that maps frequency values (in Hz) to human-readable channel labels.

### Format

```json
{
  "119900000": "SEA-Twr-16L34R",
  "120950000": "SEA-Twr-16R34L",
  "121500000": "Guard",
  "118300000": "BFI-Twr-13L31R",
  "127400000": "SEA-ATIS"
}
```

**Key format:** Frequency in Hz as a string (e.g., `"119900000"` for 119.9 MHz)
**Value format:** Any descriptive label you want to use for that frequency

### Unknown Frequencies

If a recording's frequency is not found in the map, it will be labeled `Unknown-<MHz>`:
- Example: `Unknown-119.900` for a 119.9 MHz recording with no map entry

### Setting the Frequency Map

Three ways to provide a frequency map:

1. **CLI flag:** `--freq-map /path/to/freq-map.json`
2. **Environment variable:** `SKYSPY_FREQ_MAP=/path/to/freq-map.json`
3. **Config file:** Set `frequency_map` object under `airband` in `~/.config/skyspy/settings.json`

```json
{
  "airband": {
    "frequency_map": {
      "119900000": "SEA-Twr-16L34R",
      "121500000": "Guard"
    }
  }
}
```

## Filename Formats

The uploader supports two rtl-airband recording filename patterns:

### Standard Format
```
prefix_freqHz_YYYYMMDD_HHMMSS.mp3
```
Example: `airband_119900000_20260104_123005.mp3`

### Alternate Format
```
prefix_YYYYMMDD_HHMMSS_freqHz.mp3
```
Example: `prefix_20260104_120000_119900000.mp3`

**Extracted fields:**
- Frequency in Hz (e.g., `119900000` = 119.9 MHz)
- Timestamp (YYYYMMDD_HHMMSS format)
- Filename for upload

Files that don't match either pattern will be skipped.

## Filtering

The uploader applies two filters to discard empty or short transmissions:

### Size Filter
Files smaller than `--min-file-size` (default 2048 bytes) are immediately discarded.

**Rationale:** Empty or corrupt MP3 files are typically very small and not worth processing.

### Duration Filter
Estimated duration is calculated from file size using an assumed bitrate of ~24kbps (3000 bytes/second):

```
estimated_duration = file_size_bytes / 3000.0
```

Files with estimated duration less than `--min-duration` (default 2.0 seconds) are discarded.

**Rationale:** Short transmissions (e.g., carrier squelch blips) are usually not meaningful and can clutter the archive.

> 🚧 Adjust Thresholds as Needed
>
> If you find legitimate transmissions being filtered out, lower `--min-file-size` or `--min-duration`. If too much noise is getting through, raise these values.

## Upload Behavior

### Endpoint
Uploads are sent to:
```
POST http://{host}:{port}/api/v1/audio/upload/
```

### Request Format
Multipart form-data with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `file` | file | MP3 audio file (Content-Type: `audio/mpeg`) |
| `channel_name` | string | Human-readable channel label from frequency map |
| `frequency_mhz` | float | Frequency in MHz (e.g., `119.900`) |
| `queue_transcription` | boolean | Always set to `true` to request transcription |
| `timestamp_utc` | string | Recording timestamp in RFC3339 format (if available) |

### Authentication
If an API key is provided via `--api-key` or environment variable, it will be sent as:
```
Authorization: ApiKey sk_xxx
```

If JWT authentication is used, the uploader will automatically include:
```
Authorization: Bearer <token>
```

### Retry Logic

Uploads are retried with exponential backoff:

1. **Initial attempt**
2. **Retry 1** after 2 seconds
3. **Retry 2** after 4 seconds
4. **Retry 3** after 8 seconds

**Retryable errors:**
- Network timeouts
- Connection failures
- HTTP 5xx server errors

**Non-retryable errors** (immediate move to failed directory):
- HTTP 400 Bad Request (malformed data)
- HTTP 413 Request Entity Too Large (file too big)
- HTTP 503 Service Unavailable (radio service disabled on API)

After exhausting all retries, failed files are moved to a `failed/` subdirectory and periodically retried every 60 seconds.

### Response Codes

The uploader tracks API response codes and increments Prometheus metrics accordingly:

| Code | Meaning | Action |
|------|---------|--------|
| 200, 201 | Success | File deleted after upload |
| 400 | Bad Request | Move to failed, no retry |
| 413 | File Too Large | Move to failed, no retry |
| 503 | Service Disabled | Move to failed, no retry |
| 5xx | Server Error | Retry with backoff |
| Other | Unknown Error | Retry with backoff |

## Prometheus Metrics

When enabled (default port 9090), the uploader exposes 13 Prometheus metrics at `http://localhost:9090/metrics`.

### Counters

| Metric | Labels | Description |
|--------|--------|-------------|
| `rtl_airband_uploads_total` | `status`, `channel` | Total upload attempts (status: `attempt`, `success`, `failed`) |
| `rtl_airband_uploads_success_total` | `channel` | Total successful uploads |
| `rtl_airband_uploads_failed_total` | `channel`, `reason` | Total failed uploads (reason: `max_retries`, `bad_request`, `file_too_large`, `service_disabled`) |
| `rtl_airband_uploads_discarded_total` | `channel`, `reason` | Total discarded files (reason: `size`, `duration`) |
| `rtl_airband_retry_attempts_total` | `channel` | Total retry attempts |
| `rtl_airband_api_response_codes_total` | `code` | HTTP response codes from API |

### Histograms

| Metric | Labels | Buckets | Description |
|--------|--------|---------|-------------|
| `rtl_airband_upload_duration_seconds` | `channel` | 0.5, 1, 2, 5, 10, 30, 60, 120 | Time spent uploading files |
| `rtl_airband_file_size_bytes` | `channel` | 1KB, 5KB, 10KB, 50KB, 100KB, 500KB, 1MB, 5MB | Size of uploaded files |

### Gauges

| Metric | Labels | Description |
|--------|--------|-------------|
| `rtl_airband_queue_depth` | `directory` | Number of files waiting to be processed |
| `rtl_airband_failed_queue_depth` | — | Number of files in failed queue |
| `rtl_airband_last_upload_timestamp` | `channel` | Unix timestamp of last successful upload per channel |
| `rtl_airband_last_activity_timestamp` | — | Unix timestamp of last file activity (new file detected) |
| `rtl_airband_uploader_info` | `version`, `map_size` | Static info about uploader version and frequency map size |

### Scraping the Metrics

Add this job to your Prometheus configuration:

```yaml
scrape_configs:
  - job_name: 'skyspy-airband'
    static_configs:
      - targets: ['localhost:9090']
```

### Disabling Metrics

To disable Prometheus metrics entirely:
```bash
skyspy airband --dir /recordings --metrics-port 0
```

## Configuration File

Settings can be persisted in `~/.config/skyspy/settings.json` under the `airband` key:

```json
{
  "airband": {
    "recordings_dir": "/recordings",
    "poll_interval": 5,
    "min_file_size": 2048,
    "min_duration": 2.0,
    "max_retries": 3,
    "metrics_port": 9090,
    "upload_timeout": 60,
    "retry_interval": 60,
    "stability_seconds": 2,
    "frequency_map": {
      "119900000": "SEA-Twr-16L34R",
      "120950000": "SEA-Twr-16R34L",
      "121500000": "Guard"
    }
  },
  "connection": {
    "host": "localhost",
    "port": 8000
  }
}
```

**Benefits:**
- Avoid repeating flags on every invocation
- Centralize frequency map in one place
- Share configuration across multiple systems

**Location:** The config file path is `~/.config/skyspy/settings.json` on Linux/macOS.

## Deployment Examples

### systemd Service (Raspberry Pi)

Create a systemd service file at `/etc/systemd/system/skyspy-airband.service`:

```ini
[Unit]
Description=SkySpy RTL-Airband Uploader
After=network.target rtl-airband.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi
ExecStart=/usr/local/bin/skyspy airband \
  --dir /recordings \
  --host skyspy.local \
  --port 8000 \
  --api-key sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Enable and start the service:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable skyspy-airband
sudo systemctl start skyspy-airband
```

**View logs:**
```bash
journalctl -u skyspy-airband -f
```

### Docker Environment Variables

If running in a Docker container, set environment variables instead of flags:

```bash
docker run -d \
  --name skyspy-airband \
  -v /recordings:/recordings:ro \
  -e SKYSPY_RECORDINGS_DIR=/recordings \
  -e SKYSPY_HOST=skyspy.local \
  -e SKYSPY_PORT=8000 \
  -e SKYSPY_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -e SKYSPY_FREQ_MAP=/config/freq-map.json \
  -v /config:/config:ro \
  skyspy/skyspy-go:latest airband
```

**docker-compose.yml example:**
```yaml
version: '3.8'
services:
  airband-uploader:
    image: skyspy/skyspy-go:latest
    command: airband
    volumes:
      - /recordings:/recordings:ro
      - ./config:/config:ro
    environment:
      SKYSPY_RECORDINGS_DIR: /recordings
      SKYSPY_HOST: skyspy.local
      SKYSPY_PORT: 8000
      SKYSPY_API_KEY: sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
      SKYSPY_FREQ_MAP: /config/freq-map.json
    restart: unless-stopped
```

### Cron Job (Simple Batch Mode)

For non-daemon usage, run as a cron job to process recordings periodically:

```cron
# Process recordings every 5 minutes
*/5 * * * * /usr/local/bin/skyspy airband --dir /recordings --host localhost --port 8000 --dry-run=false 2>&1 | logger -t skyspy-airband
```

> 📘 Daemon vs Cron
>
> The uploader is designed to run as a long-lived daemon (systemd service or Docker container). Cron is less ideal because:
> - Files may not be processed immediately
> - No live monitoring or metrics
> - Higher overhead from repeated process startup
>
> Use cron only if you have constraints preventing a daemon (e.g., shared hosting).

## Troubleshooting

### Files Not Being Uploaded

**Check the logs for filtering reasons:**
```bash
# If running as systemd service
journalctl -u skyspy-airband -n 100

# If running manually with slog
# Logs will show: "file discarded" with reason "size" or "duration"
```

**Common causes:**
- Files are too small (increase `--min-file-size`)
- Files are too short (increase `--min-duration`)
- Filename format doesn't match expected patterns

**Verify filename format:**
```bash
# Should match one of these:
# prefix_119900000_20260104_123005.mp3
# prefix_20260104_123005_119900000.mp3
```

### Upload Failures

**Check API availability:**
```bash
curl http://localhost:8000/api/v1/health/
```

**Check authentication:**
```bash
# Test with API key
curl -X POST http://localhost:8000/api/v1/audio/upload/ \
  -H "Authorization: ApiKey sk_xxx" \
  -F "file=@test.mp3" \
  -F "channel_name=Test" \
  -F "frequency_mhz=119.900" \
  -F "queue_transcription=true"
```

**Check logs for retry behavior:**
- Look for "retrying after backoff" messages
- Non-retryable errors (400, 413, 503) will show "skipping" instead

### Metrics Not Showing

**Verify metrics port is not in use:**
```bash
lsof -i :9090
```

**Check Prometheus scrape config:**
```bash
# Ensure target is reachable
curl http://localhost:9090/metrics
```

**Verify metrics are enabled:**
- Default is port 9090
- Set `--metrics-port 0` to disable
- Check logs for "prometheus metrics enabled" message

### Permission Errors

**Ensure the uploader has read access to recordings directory:**
```bash
ls -la /recordings/
# Should be readable by the user running skyspy airband
```

**Ensure write access to failed directory:**
```bash
# Failed files are moved to /recordings/failed/
# Directory is auto-created but parent must be writable
```

## Next Steps

- [CLI Overview](/docs/cli-overview) - Learn about other `skyspy` commands
- [Authentication](/docs/authentication) - Configure API keys and JWT tokens
- [API Reference](/docs/api-audio) - Audio upload endpoint documentation
- [Monitoring](/docs/monitoring) - Set up Prometheus and Grafana dashboards
