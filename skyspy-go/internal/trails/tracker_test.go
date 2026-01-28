package trails

import (
	"testing"
	"time"
)

func TestNewTrailTracker(t *testing.T) {
	tracker := NewTrailTracker()
	if tracker == nil {
		t.Fatal("NewTrailTracker returned nil")
	}
	if tracker.GetMaxTrailLength() != DefaultMaxTrailLength {
		t.Errorf("Expected max trail length %d, got %d", DefaultMaxTrailLength, tracker.GetMaxTrailLength())
	}
	if tracker.Count() != 0 {
		t.Errorf("Expected 0 trails, got %d", tracker.Count())
	}
}

func TestNewTrailTrackerWithLength(t *testing.T) {
	tracker := NewTrailTrackerWithLength(10)
	if tracker.GetMaxTrailLength() != 10 {
		t.Errorf("Expected max trail length 10, got %d", tracker.GetMaxTrailLength())
	}

	// Test with invalid length
	tracker = NewTrailTrackerWithLength(0)
	if tracker.GetMaxTrailLength() != DefaultMaxTrailLength {
		t.Errorf("Expected default max trail length for invalid input, got %d", tracker.GetMaxTrailLength())
	}
}

func TestAddPosition(t *testing.T) {
	tracker := NewTrailTracker()

	// Add a position
	tracker.AddPosition("ABC123", 51.5074, -0.1278)

	// Verify trail exists
	trail := tracker.GetTrail("ABC123")
	if len(trail) != 1 {
		t.Errorf("Expected 1 position, got %d", len(trail))
	}
	if trail[0].Lat != 51.5074 || trail[0].Lon != -0.1278 {
		t.Errorf("Position mismatch: got (%f, %f)", trail[0].Lat, trail[0].Lon)
	}

	// Add another position (significantly different)
	tracker.AddPosition("ABC123", 51.6, -0.2)
	trail = tracker.GetTrail("ABC123")
	if len(trail) != 2 {
		t.Errorf("Expected 2 positions, got %d", len(trail))
	}

	// Test empty hex is ignored
	tracker.AddPosition("", 0, 0)
	if tracker.Count() != 1 {
		t.Errorf("Expected 1 aircraft, got %d", tracker.Count())
	}
}

func TestDuplicatePositionFiltering(t *testing.T) {
	tracker := NewTrailTracker()

	// Add same position multiple times
	tracker.AddPosition("ABC123", 51.5074, -0.1278)
	tracker.AddPosition("ABC123", 51.5074, -0.1278)
	tracker.AddPosition("ABC123", 51.5074, -0.1278)

	// Should only have 1 position
	trail := tracker.GetTrail("ABC123")
	if len(trail) != 1 {
		t.Errorf("Expected 1 position (duplicates filtered), got %d", len(trail))
	}
}

func TestMaxTrailLength(t *testing.T) {
	tracker := NewTrailTrackerWithLength(5)

	// Add more positions than max
	for i := 0; i < 10; i++ {
		tracker.AddPosition("ABC123", float64(i), float64(i))
	}

	trail := tracker.GetTrail("ABC123")
	if len(trail) != 5 {
		t.Errorf("Expected 5 positions (max length), got %d", len(trail))
	}

	// Verify oldest positions were removed (should have 5,6,7,8,9)
	if trail[0].Lat != 5 {
		t.Errorf("Expected oldest position to have Lat=5, got %f", trail[0].Lat)
	}
}

func TestSetMaxTrailLength(t *testing.T) {
	tracker := NewTrailTracker()

	// Add some positions
	for i := 0; i < 15; i++ {
		tracker.AddPosition("ABC123", float64(i), float64(i))
	}

	// Reduce max length
	tracker.SetMaxTrailLength(5)

	trail := tracker.GetTrail("ABC123")
	if len(trail) != 5 {
		t.Errorf("Expected 5 positions after reducing max length, got %d", len(trail))
	}

	// Invalid length should be ignored
	tracker.SetMaxTrailLength(0)
	if tracker.GetMaxTrailLength() != 5 {
		t.Errorf("Expected max length unchanged for invalid input")
	}
}

func TestGetAllTrails(t *testing.T) {
	tracker := NewTrailTracker()

	tracker.AddPosition("ABC123", 1, 1)
	tracker.AddPosition("DEF456", 2, 2)
	tracker.AddPosition("GHI789", 3, 3)

	all := tracker.GetAllTrails()
	if len(all) != 3 {
		t.Errorf("Expected 3 trails, got %d", len(all))
	}

	// Verify we get copies, not the original slices
	original := tracker.GetTrail("ABC123")
	all["ABC123"][0].Lat = 999
	if original[0].Lat == 999 {
		t.Error("GetAllTrails should return copies, not original slices")
	}
}

func TestRemoveTrail(t *testing.T) {
	tracker := NewTrailTracker()

	tracker.AddPosition("ABC123", 1, 1)
	tracker.AddPosition("DEF456", 2, 2)

	tracker.RemoveTrail("ABC123")

	if tracker.Count() != 1 {
		t.Errorf("Expected 1 trail after removal, got %d", tracker.Count())
	}

	trail := tracker.GetTrail("ABC123")
	if trail != nil {
		t.Error("Expected nil trail after removal")
	}
}

func TestClear(t *testing.T) {
	tracker := NewTrailTracker()

	tracker.AddPosition("ABC123", 1, 1)
	tracker.AddPosition("DEF456", 2, 2)

	tracker.Clear()

	if tracker.Count() != 0 {
		t.Errorf("Expected 0 trails after clear, got %d", tracker.Count())
	}
}

func TestTrailLength(t *testing.T) {
	tracker := NewTrailTracker()

	tracker.AddPosition("ABC123", 1, 1)
	tracker.AddPosition("ABC123", 2, 2)
	tracker.AddPosition("ABC123", 3, 3)

	if tracker.TrailLength("ABC123") != 3 {
		t.Errorf("Expected trail length 3, got %d", tracker.TrailLength("ABC123"))
	}

	if tracker.TrailLength("NONEXISTENT") != 0 {
		t.Error("Expected trail length 0 for non-existent aircraft")
	}
}

func TestCleanup(t *testing.T) {
	tracker := NewTrailTracker()

	// Add positions
	tracker.AddPosition("ABC123", 1, 1)
	tracker.AddPosition("DEF456", 2, 2)

	// Cleanup shouldn't remove anything yet
	removed := tracker.Cleanup()
	if removed != 0 {
		t.Errorf("Expected 0 removed (fresh trails), got %d", removed)
	}

	// Manually set lastSeen to old time to test cleanup
	tracker.mu.Lock()
	tracker.lastSeen["ABC123"] = time.Now().Add(-6 * time.Minute)
	tracker.mu.Unlock()

	removed = tracker.Cleanup()
	if removed != 1 {
		t.Errorf("Expected 1 removed (stale trail), got %d", removed)
	}

	if tracker.Count() != 1 {
		t.Errorf("Expected 1 trail remaining, got %d", tracker.Count())
	}
}

func TestCleanupWithTimeout(t *testing.T) {
	tracker := NewTrailTracker()

	tracker.AddPosition("ABC123", 1, 1)

	// Cleanup with very short timeout
	tracker.mu.Lock()
	tracker.lastSeen["ABC123"] = time.Now().Add(-1 * time.Second)
	tracker.mu.Unlock()

	removed := tracker.CleanupWithTimeout(500 * time.Millisecond)
	if removed != 1 {
		t.Errorf("Expected 1 removed, got %d", removed)
	}
}

func TestConcurrency(t *testing.T) {
	tracker := NewTrailTracker()

	// Run multiple goroutines adding positions
	done := make(chan bool, 10)
	for i := 0; i < 10; i++ {
		go func(id int) {
			hex := "AC" + string(rune('0'+id))
			for j := 0; j < 100; j++ {
				tracker.AddPosition(hex, float64(j), float64(j))
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify we have 10 aircraft
	if tracker.Count() != 10 {
		t.Errorf("Expected 10 aircraft, got %d", tracker.Count())
	}
}

func TestGetTrailReturnsNilForNonexistent(t *testing.T) {
	tracker := NewTrailTracker()

	trail := tracker.GetTrail("NONEXISTENT")
	if trail != nil {
		t.Error("Expected nil for non-existent aircraft")
	}
}
