package ui

import (
	"strings"
	"testing"

	"github.com/skyspy/skyspy-go/internal/theme"
)

func TestSpectrum_New(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 20, 5)

	if spec == nil {
		t.Fatal("NewSpectrum returned nil")
	}

	if spec.Width != 20 {
		t.Errorf("expected width 20, got %d", spec.Width)
	}

	if spec.Height != 5 {
		t.Errorf("expected height 5, got %d", spec.Height)
	}

	if spec.Theme != th {
		t.Error("expected theme to be set")
	}

	if len(spec.Data) != 20 {
		t.Errorf("expected data length 20, got %d", len(spec.Data))
	}

	// All data should be initialized to 0
	for i, v := range spec.Data {
		if v != 0 {
			t.Errorf("data[%d] should be 0, got %f", i, v)
		}
	}
}

func TestSpectrum_New_DifferentSizes(t *testing.T) {
	th := theme.Get("classic")

	sizes := []struct {
		width, height int
	}{
		{10, 3},
		{30, 8},
		{50, 10},
		{100, 20},
	}

	for _, size := range sizes {
		spec := NewSpectrum(th, size.width, size.height)
		if spec.Width != size.width {
			t.Errorf("expected width %d, got %d", size.width, spec.Width)
		}
		if spec.Height != size.height {
			t.Errorf("expected height %d, got %d", size.height, spec.Height)
		}
		if len(spec.Data) != size.width {
			t.Errorf("expected data length %d, got %d", size.width, len(spec.Data))
		}
	}
}

func TestSpectrum_Update(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 10, 5)

	values := []float64{0.2, 0.4, 0.6, 0.8, 1.0, 0.8, 0.6, 0.4, 0.2, 0.0}
	decay := 0.0 // No decay - should directly use new values

	spec.Update(values, decay)

	// With decay 0, new values should be directly applied
	for i := 0; i < len(values); i++ {
		if spec.Data[i] != values[i] {
			t.Errorf("data[%d]: expected %f, got %f", i, values[i], spec.Data[i])
		}
	}
}

func TestSpectrum_Update_WithDecay(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 5, 3)

	// Set initial values
	for i := range spec.Data {
		spec.Data[i] = 1.0
	}

	// Update with all zeros and 50% decay
	newValues := []float64{0, 0, 0, 0, 0}
	spec.Update(newValues, 0.5) // 50% decay means: oldValue*0.5 + newValue*0.5

	// With decay 0.5, values should be: 1.0*0.5 + 0*0.5 = 0.5
	for i, v := range spec.Data {
		if v != 0.5 {
			t.Errorf("data[%d]: expected 0.5 with 50%% decay, got %f", i, v)
		}
	}
}

func TestSpectrum_Update_Clamping(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 5, 3)

	// Test values outside 0-1 range get clamped
	values := []float64{-0.5, 1.5, 2.0, -1.0, 0.5}
	spec.Update(values, 0.0)

	expected := []float64{0, 1.0, 1.0, 0, 0.5}
	for i := range expected {
		if spec.Data[i] != expected[i] {
			t.Errorf("data[%d]: expected %f (clamped), got %f", i, expected[i], spec.Data[i])
		}
	}
}

func TestSpectrum_SetValue(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 10, 5)

	// Set individual values
	spec.SetValue(0, 0.5)
	spec.SetValue(5, 0.8)
	spec.SetValue(9, 1.0)

	if spec.Data[0] != 0.5 {
		t.Errorf("expected data[0] = 0.5, got %f", spec.Data[0])
	}
	if spec.Data[5] != 0.8 {
		t.Errorf("expected data[5] = 0.8, got %f", spec.Data[5])
	}
	if spec.Data[9] != 1.0 {
		t.Errorf("expected data[9] = 1.0, got %f", spec.Data[9])
	}
}

func TestSpectrum_SetValue_OutOfBounds(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 10, 5)

	// Setting out of bounds should not panic
	spec.SetValue(-1, 0.5)  // Should be ignored
	spec.SetValue(10, 0.5)  // Should be ignored
	spec.SetValue(100, 0.5) // Should be ignored

	// All data should still be 0
	for i, v := range spec.Data {
		if v != 0 {
			t.Errorf("data[%d] should be 0 after out-of-bounds set, got %f", i, v)
		}
	}
}

func TestSpectrum_SetValue_Clamping(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 5, 3)

	spec.SetValue(0, 2.0)  // Should clamp to 1.0
	spec.SetValue(1, -0.5) // Should clamp to 0.0

	if spec.Data[0] != 1.0 {
		t.Errorf("expected data[0] = 1.0 (clamped), got %f", spec.Data[0])
	}
	if spec.Data[1] != 0.0 {
		t.Errorf("expected data[1] = 0.0 (clamped), got %f", spec.Data[1])
	}
}

func TestSpectrum_Render(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 10, 5)

	// Set some data
	for i := range spec.Data {
		spec.Data[i] = float64(i) / 10.0
	}

	lines := spec.Render()

	if len(lines) != 5 {
		t.Fatalf("expected 5 lines, got %d", len(lines))
	}

	// Each line should have content
	for i, line := range lines {
		plain := stripANSI(line)
		if len(plain) != 10 {
			t.Errorf("line %d: expected 10 chars, got %d", i, len(plain))
		}
	}
}

func TestSpectrum_Render_AllZeros(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 10, 5)

	// All data is 0
	lines := spec.Render()

	// All characters should be empty (░)
	for i, line := range lines {
		plain := stripANSI(line)
		emptyCount := strings.Count(plain, "░")
		if emptyCount != 10 {
			t.Errorf("line %d: expected 10 empty chars at zero level, got %d", i, emptyCount)
		}
	}
}

func TestSpectrum_Render_AllMax(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 10, 5)

	// Set all data to max
	for i := range spec.Data {
		spec.Data[i] = 1.0
	}

	lines := spec.Render()

	// All characters should be filled (█)
	for i, line := range lines {
		plain := stripANSI(line)
		fillCount := strings.Count(plain, "█")
		if fillCount != 10 {
			t.Errorf("line %d: expected 10 filled chars at max level, got %d", i, fillCount)
		}
	}
}

func TestSpectrum_RenderCompact(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 10, 5)

	// Set varying data
	spec.Data = []float64{0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0, 0.6, 0.4, 0.2}

	output := spec.RenderCompact()
	plain := stripANSI(output)

	if len(plain) != 10 {
		t.Errorf("expected compact output length 10, got %d", len(plain))
	}
}

func TestSpectrum_RenderCompact_Characters(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 4, 5)

	// Test different levels produce different characters
	spec.Data = []float64{0.1, 0.4, 0.7, 0.9}

	output := spec.RenderCompact()
	plain := stripANSI(output)

	// Based on the code:
	// > 0.8: █
	// > 0.5: ▄
	// > 0.2: ▁
	// else: ▁ (dim)
	if len(plain) != 4 {
		t.Errorf("expected 4 chars, got %d", len(plain))
	}
}

func TestSpectrum_Decay(t *testing.T) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 5, 3)

	// Set initial values
	for i := range spec.Data {
		spec.Data[i] = 1.0
	}

	// Apply update with high decay (old values weighted more)
	newValues := []float64{0, 0, 0, 0, 0}

	// Decay 0.8 means: oldValue*0.8 + newValue*0.2
	spec.Update(newValues, 0.8)

	// Values should be: 1.0*0.8 + 0*0.2 = 0.8
	for i, v := range spec.Data {
		expected := 0.8
		tolerance := 0.001
		if v < expected-tolerance || v > expected+tolerance {
			t.Errorf("data[%d]: expected ~%f with decay 0.8, got %f", i, expected, v)
		}
	}

	// Apply again
	spec.Update(newValues, 0.8)

	// Values should be: 0.8*0.8 + 0*0.2 = 0.64
	for i, v := range spec.Data {
		expected := 0.64
		tolerance := 0.001
		if v < expected-tolerance || v > expected+tolerance {
			t.Errorf("data[%d]: expected ~%f after second decay, got %f", i, expected, v)
		}
	}
}

func TestWaterfall_New(t *testing.T) {
	th := theme.Get("classic")
	wf := NewWaterfall(th, 20, 10)

	if wf == nil {
		t.Fatal("NewWaterfall returned nil")
	}

	if wf.Width != 20 {
		t.Errorf("expected width 20, got %d", wf.Width)
	}

	if wf.Height != 10 {
		t.Errorf("expected height 10, got %d", wf.Height)
	}

	if wf.Theme != th {
		t.Error("expected theme to be set")
	}

	if len(wf.History) != 10 {
		t.Errorf("expected history length 10, got %d", len(wf.History))
	}

	// Each history row should have correct width
	for i, row := range wf.History {
		if len(row) != 20 {
			t.Errorf("history[%d]: expected length 20, got %d", i, len(row))
		}
		// All values should be 0
		for j, v := range row {
			if v != 0 {
				t.Errorf("history[%d][%d] should be 0, got %f", i, j, v)
			}
		}
	}
}

func TestWaterfall_AddRow(t *testing.T) {
	th := theme.Get("classic")
	wf := NewWaterfall(th, 10, 5)

	// Add a row
	values := []float64{0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0}
	wf.Push(values)

	// New row should be at the bottom (last index)
	lastRow := wf.History[len(wf.History)-1]
	for i, v := range lastRow {
		if v != values[i] {
			t.Errorf("last row[%d]: expected %f, got %f", i, values[i], v)
		}
	}

	// Other rows should still be 0 (they were shifted)
	for i := 0; i < len(wf.History)-1; i++ {
		for j, v := range wf.History[i] {
			if v != 0 {
				t.Errorf("history[%d][%d] should be 0 after first push, got %f", i, j, v)
			}
		}
	}
}

func TestWaterfall_AddRow_Scrolling(t *testing.T) {
	th := theme.Get("classic")
	wf := NewWaterfall(th, 5, 3)

	// Push 5 different rows
	for i := 0; i < 5; i++ {
		values := make([]float64, 5)
		for j := range values {
			values[j] = float64(i+1) * 0.1 // 0.1, 0.2, 0.3, 0.4, 0.5
		}
		wf.Push(values)
	}

	// With height 3, we should have rows 3, 4, 5 (values 0.3, 0.4, 0.5)
	// History[0] should be row 3 (0.3)
	// History[1] should be row 4 (0.4)
	// History[2] should be row 5 (0.5)
	expectedValues := []float64{0.3, 0.4, 0.5}
	for i, expected := range expectedValues {
		if wf.History[i][0] != expected {
			t.Errorf("after scrolling, history[%d][0]: expected %f, got %f", i, expected, wf.History[i][0])
		}
	}
}

func TestWaterfall_AddRow_PartialValues(t *testing.T) {
	th := theme.Get("classic")
	wf := NewWaterfall(th, 10, 3)

	// Push fewer values than width
	values := []float64{0.5, 0.6, 0.7}
	wf.Push(values)

	lastRow := wf.History[len(wf.History)-1]

	// First 3 values should be set
	for i := 0; i < 3; i++ {
		if lastRow[i] != values[i] {
			t.Errorf("lastRow[%d]: expected %f, got %f", i, values[i], lastRow[i])
		}
	}

	// Remaining values should be 0
	for i := 3; i < 10; i++ {
		if lastRow[i] != 0 {
			t.Errorf("lastRow[%d]: expected 0 for unset value, got %f", i, lastRow[i])
		}
	}
}

func TestWaterfall_Render(t *testing.T) {
	th := theme.Get("classic")
	wf := NewWaterfall(th, 10, 5)

	// Add some data
	for i := 0; i < 5; i++ {
		values := make([]float64, 10)
		for j := range values {
			values[j] = float64(i) / 5.0
		}
		wf.Push(values)
	}

	lines := wf.Render()

	if len(lines) != 5 {
		t.Fatalf("expected 5 lines, got %d", len(lines))
	}

	for i, line := range lines {
		plain := stripANSI(line)
		if len(plain) != 10 {
			t.Errorf("line %d: expected 10 chars, got %d", i, len(plain))
		}
	}
}

func TestWaterfall_Render_Characters(t *testing.T) {
	th := theme.Get("classic")
	wf := NewWaterfall(th, 5, 1)

	// Set specific values to test character mapping
	// Based on code: >0.8: █, >0.6: ▓, >0.3: ▒, >0.1: ░, else: space
	values := []float64{0.05, 0.2, 0.5, 0.7, 0.9}
	wf.Push(values)

	lines := wf.Render()
	plain := stripANSI(lines[0])

	// Check characters based on intensity levels
	expectedChars := []rune{' ', '░', '▒', '▓', '█'}
	for i, expected := range expectedChars {
		if rune(plain[i]) != expected {
			t.Errorf("position %d: expected '%c' for value %f, got '%c'",
				i, expected, values[i], plain[i])
		}
	}
}

func TestWaterfall_Render_Empty(t *testing.T) {
	th := theme.Get("classic")
	wf := NewWaterfall(th, 10, 5)

	// No data pushed, all zeros
	lines := wf.Render()

	for i, line := range lines {
		plain := stripANSI(line)
		// All should be spaces (value 0)
		for j, c := range plain {
			if c != ' ' {
				t.Errorf("line %d, pos %d: expected space for zero value, got '%c'", i, j, c)
			}
		}
	}
}

func TestFrequencyDisplay_New(t *testing.T) {
	th := theme.Get("classic")
	fd := NewFrequencyDisplay(th)

	if fd == nil {
		t.Fatal("NewFrequencyDisplay returned nil")
	}

	if fd.Theme != th {
		t.Error("expected theme to be set")
	}

	if len(fd.Frequencies) != 4 {
		t.Errorf("expected 4 default frequencies, got %d", len(fd.Frequencies))
	}

	// Check default frequencies
	expectedFreqs := []string{"1090.000", "136.900", "136.725", "121.500"}
	for i, expected := range expectedFreqs {
		if fd.Frequencies[i].Freq != expected {
			t.Errorf("frequency %d: expected %s, got %s", i, expected, fd.Frequencies[i].Freq)
		}
	}
}

func TestFrequencyDisplay_SetFrequencies(t *testing.T) {
	th := theme.Get("classic")
	fd := NewFrequencyDisplay(th)

	newFreqs := []FrequencyInfo{
		{Freq: "100.000", Label: "TEST1", Active: true},
		{Freq: "200.000", Label: "TEST2", Active: false},
	}

	fd.SetFrequencies(newFreqs)

	if len(fd.Frequencies) != 2 {
		t.Errorf("expected 2 frequencies after set, got %d", len(fd.Frequencies))
	}

	if fd.Frequencies[0].Freq != "100.000" {
		t.Errorf("expected freq 100.000, got %s", fd.Frequencies[0].Freq)
	}
}

func TestFrequencyDisplay_Advance(t *testing.T) {
	th := theme.Get("classic")
	fd := NewFrequencyDisplay(th)

	// Check initial state
	if fd.ScanPos != 0 {
		t.Errorf("expected initial ScanPos 0, got %d", fd.ScanPos)
	}
	if fd.CurrentIdx != 0 {
		t.Errorf("expected initial CurrentIdx 0, got %d", fd.CurrentIdx)
	}

	// Advance multiple times
	for i := 0; i < 10; i++ {
		fd.Advance()
	}

	// ScanPos should be 10, CurrentIdx should be 10/10 = 1
	if fd.ScanPos != 10 {
		t.Errorf("expected ScanPos 10, got %d", fd.ScanPos)
	}
	if fd.CurrentIdx != 1 {
		t.Errorf("expected CurrentIdx 1, got %d", fd.CurrentIdx)
	}

	// Advance to wrap around
	for i := 0; i < 30; i++ {
		fd.Advance()
	}

	// Should have wrapped (4 frequencies * 10 = 40)
	if fd.ScanPos >= 40 {
		t.Errorf("ScanPos should have wrapped, got %d", fd.ScanPos)
	}
}

func TestFrequencyDisplay_Render(t *testing.T) {
	th := theme.Get("classic")
	fd := NewFrequencyDisplay(th)

	output := fd.Render()

	// Should contain SCAN label
	if !strings.Contains(output, "SCAN") {
		t.Error("render output should contain SCAN label")
	}

	// Should contain frequency values
	for _, freq := range fd.Frequencies {
		if !strings.Contains(output, freq.Freq) {
			t.Errorf("render output should contain frequency %s", freq.Freq)
		}
	}
}

func TestFrequencyDisplay_RenderList(t *testing.T) {
	th := theme.Get("classic")
	fd := NewFrequencyDisplay(th)

	lines := fd.RenderList(true)

	if len(lines) != len(fd.Frequencies) {
		t.Errorf("expected %d lines, got %d", len(fd.Frequencies), len(lines))
	}

	// Each line should contain frequency and label
	for i, line := range lines {
		if !strings.Contains(line, fd.Frequencies[i].Freq) {
			t.Errorf("line %d should contain frequency %s", i, fd.Frequencies[i].Freq)
		}
		if !strings.Contains(line, fd.Frequencies[i].Label) {
			t.Errorf("line %d should contain label %s", i, fd.Frequencies[i].Label)
		}
	}
}

func TestFrequencyDisplay_RenderList_BlinkState(t *testing.T) {
	th := theme.Get("classic")
	fd := NewFrequencyDisplay(th)

	// Render with blink on
	linesOn := fd.RenderList(true)

	// Render with blink off
	linesOff := fd.RenderList(false)

	// Both should have same number of lines
	if len(linesOn) != len(linesOff) {
		t.Error("blink state should not change number of lines")
	}
}

func BenchmarkSpectrum_Render(b *testing.B) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 30, 10)

	for i := range spec.Data {
		spec.Data[i] = float64(i) / 30.0
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		spec.Render()
	}
}

func BenchmarkSpectrum_Update(b *testing.B) {
	th := theme.Get("classic")
	spec := NewSpectrum(th, 30, 10)
	values := make([]float64, 30)
	for i := range values {
		values[i] = float64(i) / 30.0
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		spec.Update(values, 0.3)
	}
}

func BenchmarkWaterfall_Push(b *testing.B) {
	th := theme.Get("classic")
	wf := NewWaterfall(th, 30, 20)
	values := make([]float64, 30)
	for i := range values {
		values[i] = float64(i) / 30.0
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		wf.Push(values)
	}
}

func BenchmarkWaterfall_Render(b *testing.B) {
	th := theme.Get("classic")
	wf := NewWaterfall(th, 30, 20)

	// Fill with data
	for i := 0; i < 20; i++ {
		values := make([]float64, 30)
		for j := range values {
			values[j] = float64(i+j) / 50.0
		}
		wf.Push(values)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		wf.Render()
	}
}

func BenchmarkFrequencyDisplay_Render(b *testing.B) {
	th := theme.Get("classic")
	fd := NewFrequencyDisplay(th)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		fd.Advance()
		fd.Render()
	}
}
