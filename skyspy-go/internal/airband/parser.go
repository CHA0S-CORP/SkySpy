package airband

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Filename patterns matching rtl-airband recording formats.
var (
	// Standard: prefix_freqHz_YYYYMMDD_HHMMSS.mp3
	// Example: airband_119900000_20260104_123005.mp3
	reStandard = regexp.MustCompile(`^([^_]+)_(\d+)_(\d{8})_(\d{6})\.mp3$`)

	// Alternate: prefix_YYYYMMDD_HHMMSS_freqHz.mp3
	// Example: prefix_20260104_120000_119900000.mp3
	reAlternate = regexp.MustCompile(`^(.+?)_(\d{8})_(\d{6})_(\d+)\.mp3$`)
)

// ParseFilename extracts metadata from an rtl-airband recording filename
// and maps the frequency to a channel label via the provided ChannelMap.
func ParseFilename(fpath string, chanMap *ChannelMap) FileMetadata {
	filename := filepath.Base(fpath)
	var fileSize int64
	if info, err := os.Stat(fpath); err == nil {
		fileSize = info.Size()
	}

	var freqHz int64
	var dateStr, timeStr string
	matched := false

	if m := reStandard.FindStringSubmatch(filename); m != nil {
		freqHz, _ = strconv.ParseInt(m[2], 10, 64)
		dateStr = m[3]
		timeStr = m[4]
		matched = true
	} else if m := reAlternate.FindStringSubmatch(filename); m != nil {
		freqHz, _ = strconv.ParseInt(m[4], 10, 64)
		dateStr = m[2]
		timeStr = m[3]
		matched = true
	}

	if !matched {
		// Unknown format — use stem as channel name
		stem := strings.TrimSuffix(filename, filepath.Ext(filename))
		return FileMetadata{
			FilePath:    fpath,
			Filename:    filename,
			ChannelName: stem,
			FileSize:    fileSize,
		}
	}

	// Resolve frequency
	var channelName string
	var frequencyMHz float64
	hasFrequency := false
	if freqHz > 0 {
		frequencyMHz = float64(freqHz) / 1_000_000
		hasFrequency = true
		if chanMap != nil {
			channelName = chanMap.Lookup(freqHz)
		} else {
			channelName = fmt.Sprintf("Unknown-%.3f", frequencyMHz)
		}
	} else {
		channelName = "Unknown"
	}

	// Parse timestamp
	var ts time.Time
	hasTimestamp := false
	parsed, err := time.Parse("20060102150405", dateStr+timeStr)
	if err == nil {
		ts = parsed
		hasTimestamp = true
	} else {
		ts = time.Now()
		hasTimestamp = true
	}

	return FileMetadata{
		FilePath:     fpath,
		Filename:     filename,
		ChannelName:  channelName,
		FrequencyMHz: frequencyMHz,
		Timestamp:    ts,
		FileSize:     fileSize,
		HasTimestamp: hasTimestamp,
		HasFrequency: hasFrequency,
	}
}
