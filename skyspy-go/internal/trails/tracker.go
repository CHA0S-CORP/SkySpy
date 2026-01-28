// Package trails provides aircraft trail/history tracking functionality
package trails

import (
	"sync"
	"time"
)

// DefaultMaxTrailLength is the default number of positions to keep per aircraft
const DefaultMaxTrailLength = 20

// StaleTimeout is the duration after which a trail is considered stale
const StaleTimeout = 5 * time.Minute

// Position represents a single position in an aircraft's trail
type Position struct {
	Lat       float64
	Lon       float64
	Timestamp time.Time
}

// TrailTracker manages position history for multiple aircraft
type TrailTracker struct {
	mu             sync.RWMutex
	trails         map[string][]Position
	lastSeen       map[string]time.Time
	maxTrailLength int
}

// NewTrailTracker creates a new TrailTracker with default settings
func NewTrailTracker() *TrailTracker {
	return &TrailTracker{
		trails:         make(map[string][]Position),
		lastSeen:       make(map[string]time.Time),
		maxTrailLength: DefaultMaxTrailLength,
	}
}

// NewTrailTrackerWithLength creates a new TrailTracker with a custom max trail length
func NewTrailTrackerWithLength(maxLength int) *TrailTracker {
	if maxLength <= 0 {
		maxLength = DefaultMaxTrailLength
	}
	return &TrailTracker{
		trails:         make(map[string][]Position),
		lastSeen:       make(map[string]time.Time),
		maxTrailLength: maxLength,
	}
}

// SetMaxTrailLength updates the maximum trail length
func (t *TrailTracker) SetMaxTrailLength(length int) {
	if length <= 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.maxTrailLength = length

	// Trim existing trails if necessary
	for hex, trail := range t.trails {
		if len(trail) > length {
			t.trails[hex] = trail[len(trail)-length:]
		}
	}
}

// GetMaxTrailLength returns the current maximum trail length
func (t *TrailTracker) GetMaxTrailLength() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.maxTrailLength
}

// AddPosition adds a new position to an aircraft's trail
func (t *TrailTracker) AddPosition(hex string, lat, lon float64) {
	if hex == "" {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	pos := Position{
		Lat:       lat,
		Lon:       lon,
		Timestamp: now,
	}

	// Update last seen time
	t.lastSeen[hex] = now

	// Get existing trail or create new one
	trail, exists := t.trails[hex]
	if !exists {
		t.trails[hex] = []Position{pos}
		return
	}

	// Check if position has actually changed (avoid duplicates)
	if len(trail) > 0 {
		last := trail[len(trail)-1]
		// Skip if position hasn't changed significantly (within ~100m)
		if absFloat(last.Lat-lat) < 0.001 && absFloat(last.Lon-lon) < 0.001 {
			return
		}
	}

	// Append new position
	trail = append(trail, pos)

	// Trim to max length if needed
	if len(trail) > t.maxTrailLength {
		trail = trail[len(trail)-t.maxTrailLength:]
	}

	t.trails[hex] = trail
}

// GetTrail returns the position history for an aircraft
// Returns positions in chronological order (oldest first)
func (t *TrailTracker) GetTrail(hex string) []Position {
	t.mu.RLock()
	defer t.mu.RUnlock()

	trail, exists := t.trails[hex]
	if !exists {
		return nil
	}

	// Return a copy to prevent external modification
	result := make([]Position, len(trail))
	copy(result, trail)
	return result
}

// GetAllTrails returns all trails for all aircraft
// Returns a map of hex -> positions
func (t *TrailTracker) GetAllTrails() map[string][]Position {
	t.mu.RLock()
	defer t.mu.RUnlock()

	result := make(map[string][]Position, len(t.trails))
	for hex, trail := range t.trails {
		trailCopy := make([]Position, len(trail))
		copy(trailCopy, trail)
		result[hex] = trailCopy
	}
	return result
}

// RemoveTrail removes the trail for a specific aircraft
func (t *TrailTracker) RemoveTrail(hex string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.trails, hex)
	delete(t.lastSeen, hex)
}

// Cleanup removes stale trails (aircraft not seen in 5+ minutes)
func (t *TrailTracker) Cleanup() int {
	t.mu.Lock()
	defer t.mu.Unlock()

	cutoff := time.Now().Add(-StaleTimeout)
	removed := 0

	for hex, lastSeen := range t.lastSeen {
		if lastSeen.Before(cutoff) {
			delete(t.trails, hex)
			delete(t.lastSeen, hex)
			removed++
		}
	}

	return removed
}

// CleanupWithTimeout removes trails for aircraft not seen within the specified duration
func (t *TrailTracker) CleanupWithTimeout(timeout time.Duration) int {
	t.mu.Lock()
	defer t.mu.Unlock()

	cutoff := time.Now().Add(-timeout)
	removed := 0

	for hex, lastSeen := range t.lastSeen {
		if lastSeen.Before(cutoff) {
			delete(t.trails, hex)
			delete(t.lastSeen, hex)
			removed++
		}
	}

	return removed
}

// Clear removes all trails
func (t *TrailTracker) Clear() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.trails = make(map[string][]Position)
	t.lastSeen = make(map[string]time.Time)
}

// Count returns the number of aircraft being tracked
func (t *TrailTracker) Count() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.trails)
}

// TrailLength returns the length of a specific aircraft's trail
func (t *TrailTracker) TrailLength(hex string) int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.trails[hex])
}

// absFloat returns the absolute value of a float64
func absFloat(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}
