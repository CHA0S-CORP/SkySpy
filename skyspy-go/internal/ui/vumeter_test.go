package ui

import (
	"strings"
	"testing"

	"github.com/skyspy/skyspy-go/internal/theme"
)

func TestVUMeter_New(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 20)

	if vu == nil {
		t.Fatal("NewVUMeter returned nil")
	}

	if vu.Width != 20 {
		t.Errorf("expected width 20, got %d", vu.Width)
	}

	if vu.Theme != th {
		t.Error("expected theme to be set")
	}

	if vu.GreenZone != 0.6 {
		t.Errorf("expected GreenZone 0.6, got %f", vu.GreenZone)
	}

	if vu.YellowZone != 0.8 {
		t.Errorf("expected YellowZone 0.8, got %f", vu.YellowZone)
	}
}

func TestVUMeter_New_DifferentWidths(t *testing.T) {
	th := theme.Get("classic")

	widths := []int{5, 10, 20, 50, 100}
	for _, width := range widths {
		vu := NewVUMeter(th, width)
		if vu.Width != width {
			t.Errorf("expected width %d, got %d", width, vu.Width)
		}
	}
}

func TestVUMeter_SetValue(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 10)

	// Test various values - VUMeter.Render handles the value directly
	testCases := []struct {
		value    float64
		expected float64
	}{
		{0.0, 0.0},
		{0.5, 0.5},
		{1.0, 1.0},
		{-0.5, 0.0},  // Should clamp to 0
		{1.5, 1.0},   // Should clamp to 1
		{-100, 0.0},  // Should clamp to 0
		{100, 1.0},   // Should clamp to 1
	}

	for _, tc := range testCases {
		output := vu.Render(tc.value)
		// Count filled characters (excluding ANSI codes)
		plainOutput := stripANSI(output)
		filled := strings.Count(plainOutput, "█")
		expected := int(tc.expected * float64(vu.Width))
		if filled != expected {
			t.Errorf("value %.2f: expected %d filled chars, got %d", tc.value, expected, filled)
		}
	}
}

func TestVUMeter_RenderHorizontal(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 10)

	testCases := []struct {
		level         float64
		expectedFull  int
		expectedEmpty int
	}{
		{0.0, 0, 10},
		{0.5, 5, 5},
		{1.0, 10, 0},
		{0.3, 3, 7},
		{0.7, 7, 3},
	}

	for _, tc := range testCases {
		output := vu.Render(tc.level)
		plainOutput := stripANSI(output)

		fullCount := strings.Count(plainOutput, "█")
		emptyCount := strings.Count(plainOutput, "░")

		if fullCount != tc.expectedFull {
			t.Errorf("level %.1f: expected %d full chars, got %d", tc.level, tc.expectedFull, fullCount)
		}

		if emptyCount != tc.expectedEmpty {
			t.Errorf("level %.1f: expected %d empty chars, got %d", tc.level, tc.expectedEmpty, emptyCount)
		}

		// Total characters should equal width
		if fullCount+emptyCount != vu.Width {
			t.Errorf("level %.1f: total chars %d != width %d", tc.level, fullCount+emptyCount, vu.Width)
		}
	}
}

func TestVUMeter_RenderHorizontal_Clamping(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 10)

	// Test clamping at boundaries
	testCases := []struct {
		level    float64
		expected int
	}{
		{-1.0, 0},   // Below 0 should clamp to 0
		{-0.5, 0},
		{0.0, 0},
		{1.0, 10},
		{1.5, 10},   // Above 1 should clamp to 1
		{10.0, 10},
	}

	for _, tc := range testCases {
		output := vu.Render(tc.level)
		plainOutput := stripANSI(output)
		filled := strings.Count(plainOutput, "█")
		if filled != tc.expected {
			t.Errorf("level %.1f: expected %d filled, got %d", tc.level, tc.expected, filled)
		}
	}
}

func TestVUMeter_RenderVertical(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 10)
	height := 8

	testCases := []struct {
		level         float64
		expectedFull  int
		expectedEmpty int
	}{
		{0.0, 0, 8},
		{0.5, 4, 4},
		{1.0, 8, 0},
		{0.25, 2, 6},
		{0.75, 6, 2},
	}

	for _, tc := range testCases {
		lines := vu.RenderVertical(tc.level, height)

		if len(lines) != height {
			t.Errorf("level %.1f: expected %d lines, got %d", tc.level, height, len(lines))
			continue
		}

		fullCount := 0
		emptyCount := 0
		for _, line := range lines {
			plain := stripANSI(line)
			fullCount += strings.Count(plain, "█")
			emptyCount += strings.Count(plain, "░")
		}

		if fullCount != tc.expectedFull {
			t.Errorf("level %.1f: expected %d full chars, got %d", tc.level, tc.expectedFull, fullCount)
		}

		if emptyCount != tc.expectedEmpty {
			t.Errorf("level %.1f: expected %d empty chars, got %d", tc.level, tc.expectedEmpty, emptyCount)
		}
	}
}

func TestVUMeter_RenderVertical_Clamping(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 10)
	height := 10

	// Test clamping
	testCases := []struct {
		level    float64
		expected int
	}{
		{-1.0, 0},
		{0.0, 0},
		{1.0, 10},
		{2.0, 10},
	}

	for _, tc := range testCases {
		lines := vu.RenderVertical(tc.level, height)
		fullCount := 0
		for _, line := range lines {
			plain := stripANSI(line)
			fullCount += strings.Count(plain, "█")
		}
		if fullCount != tc.expected {
			t.Errorf("level %.1f: expected %d filled, got %d", tc.level, tc.expected, fullCount)
		}
	}
}

func TestVUMeter_RenderVertical_BottomUp(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 10)
	height := 5

	// At 0.4 level (2 bars filled), the bottom 2 lines should be filled
	lines := vu.RenderVertical(0.4, height)

	// Check that filled bars are at the bottom (last lines)
	// Since RenderVertical inverts for bottom-up rendering,
	// filled bars should appear at the end of the array
	for i, line := range lines {
		plain := stripANSI(line)
		hasFilled := strings.Contains(plain, "█")
		hasEmpty := strings.Contains(plain, "░")

		// Bottom rows (higher indices) should be filled first
		// With 0.4 level and height 5, 2 rows should be filled
		if i >= 3 { // Last 2 rows
			if !hasFilled {
				t.Errorf("row %d should be filled at level 0.4", i)
			}
		} else { // First 3 rows
			if !hasEmpty {
				t.Errorf("row %d should be empty at level 0.4", i)
			}
		}
	}
}

func TestSignalMeter_Render(t *testing.T) {
	th := theme.Get("classic")
	sm := NewSignalMeter(th, 5)

	if sm == nil {
		t.Fatal("NewSignalMeter returned nil")
	}

	if sm.Bars != 5 {
		t.Errorf("expected 5 bars, got %d", sm.Bars)
	}

	// Test RSSI to bars conversion
	// Based on the code: >-3: 5 bars, >-6: 4 bars, >-12: 3 bars, >-18: 2 bars, >-24: 1 bar
	testCases := []struct {
		rssi         float64
		expectedBars int
	}{
		{0, 5},      // Very strong
		{-2, 5},     // Still 5 bars
		{-5, 4},     // 4 bars
		{-10, 3},    // 3 bars
		{-15, 2},    // 2 bars
		{-20, 1},    // 1 bar
		{-30, 0},    // No bars
		{-50, 0},    // Very weak
	}

	for _, tc := range testCases {
		output := sm.Render(tc.rssi)
		plain := stripANSI(output)

		// Count filled characters (▆)
		filled := strings.Count(plain, "▆")
		if filled != tc.expectedBars {
			t.Errorf("RSSI %.0f: expected %d filled bars, got %d", tc.rssi, tc.expectedBars, filled)
		}

		// Total should be 5 (filled + empty)
		total := filled + strings.Count(plain, "▁")
		if total != 5 {
			t.Errorf("RSSI %.0f: expected 5 total bars, got %d", tc.rssi, total)
		}
	}
}

func TestSignalMeter_RenderFromLevel(t *testing.T) {
	th := theme.Get("classic")
	sm := NewSignalMeter(th, 5)

	testCases := []struct {
		level        float64
		expectedBars int
	}{
		{0.0, 0},
		{0.2, 1},
		{0.4, 2},
		{0.6, 3},
		{0.8, 4},
		{1.0, 5},
		{-0.5, 0},  // Clamped
		{1.5, 5},   // Clamped
	}

	for _, tc := range testCases {
		output := sm.RenderFromLevel(tc.level)
		plain := stripANSI(output)
		filled := strings.Count(plain, "▆")
		if filled != tc.expectedBars {
			t.Errorf("level %.1f: expected %d filled bars, got %d", tc.level, tc.expectedBars, filled)
		}
	}
}

func TestSignalMeter_DifferentBarCounts(t *testing.T) {
	th := theme.Get("classic")

	barCounts := []int{3, 5, 8, 10}
	for _, count := range barCounts {
		sm := NewSignalMeter(th, count)
		output := sm.RenderFromLevel(1.0) // Max level
		plain := stripANSI(output)
		filled := strings.Count(plain, "▆")
		if filled != count {
			t.Errorf("bar count %d at max level: expected %d filled, got %d", count, count, filled)
		}
	}
}

func TestRenderStereoVU(t *testing.T) {
	th := theme.Get("classic")

	output := RenderStereoVU(th, 0.5, 0.8, 10)

	// Should contain L and R labels
	if !strings.Contains(output, "L") {
		t.Error("stereo VU should contain 'L' label")
	}
	if !strings.Contains(output, "R") {
		t.Error("stereo VU should contain 'R' label")
	}

	// Should have characters from both channels
	plain := stripANSI(output)
	if len(plain) == 0 {
		t.Error("stereo VU output is empty")
	}
}

func TestRenderStereoVU_SymmetricLevels(t *testing.T) {
	th := theme.Get("classic")

	// Both channels at same level
	output := RenderStereoVU(th, 0.6, 0.6, 10)
	plain := stripANSI(output)

	// Count all filled characters
	filled := strings.Count(plain, "█")
	// Each channel should have 6 filled (60% of 10)
	// Total should be 12
	if filled != 12 {
		t.Errorf("expected 12 total filled chars (6 per channel), got %d", filled)
	}
}

func TestRenderStereoVU_AsymmetricLevels(t *testing.T) {
	th := theme.Get("classic")

	// Different levels
	output := RenderStereoVU(th, 0.3, 0.7, 10)
	plain := stripANSI(output)

	// Count all filled characters
	filled := strings.Count(plain, "█")
	// Left: 3 filled, Right: 7 filled = 10 total
	if filled != 10 {
		t.Errorf("expected 10 total filled chars (3 left + 7 right), got %d", filled)
	}
}

func TestVUMeter_ColorZones(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 10)

	// Render at full level
	output := vu.Render(1.0)

	// In non-TTY environments (like CI), lipgloss may not add ANSI codes
	// Either the output has ANSI codes (longer than 10 chars) or it's plain text
	plain := stripANSI(output)

	// The plain content should have 10 filled blocks
	filled := strings.Count(plain, "█")
	if filled != 10 {
		t.Errorf("expected 10 filled blocks, got %d", filled)
	}

	// Note: ANSI styling is environment-dependent (lipgloss detects TTY)
	// In a terminal, output will be longer; in CI, it may be plain
}

func TestVUMeter_CustomZones(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 20)

	// Modify zones
	vu.GreenZone = 0.5
	vu.YellowZone = 0.75

	// Render and verify it still works
	output := vu.Render(1.0)
	plain := stripANSI(output)

	filled := strings.Count(plain, "█")
	if filled != 20 {
		t.Errorf("expected 20 filled chars at full level, got %d", filled)
	}
}

func TestVUMeter_EmptyWidth(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 0)

	// Should handle zero width gracefully
	output := vu.Render(0.5)
	plain := stripANSI(output)
	if len(plain) != 0 {
		t.Errorf("expected empty output for zero width, got %d chars", len(plain))
	}
}

func TestVUMeter_LargeWidth(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 100)

	output := vu.Render(0.5)
	plain := stripANSI(output)

	filled := strings.Count(plain, "█")
	empty := strings.Count(plain, "░")

	if filled != 50 {
		t.Errorf("expected 50 filled chars, got %d", filled)
	}
	if empty != 50 {
		t.Errorf("expected 50 empty chars, got %d", empty)
	}
}

// stripANSI removes ANSI escape codes from a string
func stripANSI(s string) string {
	var result strings.Builder
	inEscape := false

	for _, r := range s {
		if r == '\x1b' {
			inEscape = true
			continue
		}
		if inEscape {
			if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || r == 'm' {
				inEscape = false
			}
			continue
		}
		result.WriteRune(r)
	}

	return result.String()
}

func BenchmarkVUMeter_Render(b *testing.B) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 20)

	for i := 0; i < b.N; i++ {
		vu.Render(float64(i%100) / 100.0)
	}
}

func BenchmarkVUMeter_RenderVertical(b *testing.B) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 10)

	for i := 0; i < b.N; i++ {
		vu.RenderVertical(float64(i%100)/100.0, 20)
	}
}

func BenchmarkSignalMeter_Render(b *testing.B) {
	th := theme.Get("classic")
	sm := NewSignalMeter(th, 5)

	for i := 0; i < b.N; i++ {
		sm.Render(float64(-30 + i%30))
	}
}

func BenchmarkRenderStereoVU(b *testing.B) {
	th := theme.Get("classic")

	for i := 0; i < b.N; i++ {
		left := float64(i%100) / 100.0
		right := float64((i+50)%100) / 100.0
		RenderStereoVU(th, left, right, 20)
	}
}

// ============================================================================
// Additional Coverage Tests
// ============================================================================

func TestVUMeter_Render_FilledGreaterThanWidth(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 10)

	// Level > 1 should be clamped, and filled should not exceed width
	output := vu.Render(1.5)
	plain := stripANSI(output)

	filled := strings.Count(plain, "█")
	if filled > 10 {
		t.Errorf("filled chars should not exceed width, got %d", filled)
	}
	if filled != 10 {
		t.Errorf("expected 10 filled chars at clamped max level, got %d", filled)
	}
}

func TestSignalMeter_Render_BarsExceedMax(t *testing.T) {
	th := theme.Get("classic")

	// Create meter with 3 bars
	sm := NewSignalMeter(th, 3)

	// Very strong signal that would produce 5 bars (but capped at 3)
	output := sm.Render(0) // 0 dBm = 5 bars, but meter only has 3

	plain := stripANSI(output)
	filled := strings.Count(plain, "▆")

	// Should be capped at 3 bars
	if filled > 3 {
		t.Errorf("filled bars should not exceed meter bars count, got %d", filled)
	}
	if filled != 3 {
		t.Errorf("expected 3 filled bars (capped), got %d", filled)
	}
}

func TestSignalMeter_Render_AllLevels(t *testing.T) {
	th := theme.Get("classic")
	sm := NewSignalMeter(th, 5)

	// Test all RSSI threshold levels
	testCases := []struct {
		rssi         float64
		expectedBars int
	}{
		{0, 5},    // Very strong: >-3 = 5 bars
		{-3, 4},   // Strong: >-6 = 4 bars
		{-6, 3},   // Good: >-12 = 3 bars
		{-12, 2},  // Fair: >-18 = 2 bars
		{-18, 1},  // Weak: >-24 = 1 bar
		{-24, 0},  // Very weak: 0 bars
		{-50, 0},  // No signal: 0 bars
	}

	for _, tc := range testCases {
		output := sm.Render(tc.rssi)
		plain := stripANSI(output)
		filled := strings.Count(plain, "▆")
		if filled != tc.expectedBars {
			t.Errorf("RSSI %.0f: expected %d bars, got %d", tc.rssi, tc.expectedBars, filled)
		}
	}
}

func TestSignalMeter_RenderFromLevel_ColorZones(t *testing.T) {
	th := theme.Get("classic")
	sm := NewSignalMeter(th, 10)

	// Test that different levels produce output
	levels := []float64{0.0, 0.2, 0.4, 0.6, 0.8, 1.0}

	for _, level := range levels {
		output := sm.RenderFromLevel(level)
		plain := stripANSI(output)

		// Total should always be 10 (filled + empty)
		total := strings.Count(plain, "▆") + strings.Count(plain, "▁")
		if total != 10 {
			t.Errorf("level %.1f: expected 10 total bars, got %d", level, total)
		}
	}
}

func TestVUMeter_RenderVertical_AllLevels(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 10)
	height := 10

	levels := []float64{0.0, 0.25, 0.5, 0.75, 1.0}

	for _, level := range levels {
		lines := vu.RenderVertical(level, height)

		if len(lines) != height {
			t.Errorf("level %.1f: expected %d lines, got %d", level, height, len(lines))
		}

		// Count total characters
		totalFilled := 0
		totalEmpty := 0
		for _, line := range lines {
			plain := stripANSI(line)
			totalFilled += strings.Count(plain, "█")
			totalEmpty += strings.Count(plain, "░")
		}

		expectedFilled := int(level * float64(height))
		if totalFilled != expectedFilled {
			t.Errorf("level %.1f: expected %d filled, got %d", level, expectedFilled, totalFilled)
		}
	}
}

func TestVUMeter_Render_FilledClampToWidth(t *testing.T) {
	th := theme.Get("classic")
	vu := NewVUMeter(th, 5)

	// Test values that might cause floating point issues
	// when int(level * width) could potentially exceed width
	testLevels := []float64{
		0.9999999999999999, // Very close to 1
		1.0,
		1.0000000000000001, // Slightly over 1
	}

	for _, level := range testLevels {
		output := vu.Render(level)
		plain := stripANSI(output)
		filled := strings.Count(plain, "█")

		// Should never exceed width
		if filled > 5 {
			t.Errorf("level %v: filled %d should not exceed width 5", level, filled)
		}
	}
}
