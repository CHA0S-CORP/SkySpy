// Package airband implements the RTL-Airband recording uploader.
// It watches for MP3 recordings, maps frequencies to channel labels,
// filters empty/short transmissions, and uploads them to the Django API.
package airband

import (
	"fmt"
	"sync"
	"time"
)

// Action describes what happened to a file during processing.
type Action string

const (
	ActionUploaded  Action = "uploaded"
	ActionDiscarded Action = "discarded"
	ActionFailed    Action = "failed"
	ActionSkipped   Action = "skipped"
)

// FileMetadata holds parsed information extracted from a recording filename.
type FileMetadata struct {
	FilePath     string
	Filename     string
	ChannelName  string
	FrequencyMHz float64
	Timestamp    time.Time
	FileSize     int64
	HasTimestamp bool
	HasFrequency bool
}

// ProcessResult captures the outcome of processing a single file.
type ProcessResult struct {
	Metadata FileMetadata
	Action   Action
	Reason   string
	Err      error
}

// ChannelMap provides thread-safe lookup from frequency Hz to channel label.
type ChannelMap struct {
	mu      sync.RWMutex
	entries map[int64]string
}

// NewChannelMap creates a ChannelMap from a string-keyed map (as stored in config).
// Keys are frequency in Hz as strings, values are labels.
func NewChannelMap(raw map[string]string) *ChannelMap {
	cm := &ChannelMap{
		entries: make(map[int64]string, len(raw)),
	}
	for k, v := range raw {
		var hz int64
		if _, err := fmt.Sscanf(k, "%d", &hz); err == nil {
			cm.entries[hz] = v
		}
	}
	return cm
}

// Lookup returns the channel label for a frequency in Hz.
// If not found, returns "Unknown-<MHz>" format.
func (cm *ChannelMap) Lookup(freqHz int64) string {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if label, ok := cm.entries[freqHz]; ok {
		return label
	}
	mhz := float64(freqHz) / 1_000_000
	return fmt.Sprintf("Unknown-%.3f", mhz)
}

// Size returns the number of entries in the map.
func (cm *ChannelMap) Size() int {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return len(cm.entries)
}
