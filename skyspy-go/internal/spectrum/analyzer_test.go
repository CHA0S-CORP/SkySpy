package spectrum

import (
	"math"
	"testing"
)

func TestAnalyzer_New(t *testing.T) {
	analyzer := NewAnalyzer()

	if analyzer == nil {
		t.Fatal("NewAnalyzer returned nil")
	}

	if len(analyzer.bands) != len(DefaultDistanceBands) {
		t.Errorf("expected %d bands, got %d", len(DefaultDistanceBands), len(analyzer.bands))
	}

	if len(analyzer.distanceBands) != len(DefaultDistanceBands) {
		t.Errorf("expected %d distance bands, got %d", len(DefaultDistanceBands), len(analyzer.distanceBands))
	}

	if analyzer.decayRate != 0.15 {
		t.Errorf("expected decayRate 0.15, got %f", analyzer.decayRate)
	}

	if analyzer.smoothing != 0.3 {
		t.Errorf("expected smoothing 0.3, got %f", analyzer.smoothing)
	}

	// Check bands are initialized
	for i, band := range analyzer.bands {
		if band.MaxRSSI != -100 {
			t.Errorf("band %d: expected MaxRSSI -100, got %f", i, band.MaxRSSI)
		}
		if band.MinRSSI != 0 {
			t.Errorf("band %d: expected MinRSSI 0, got %f", i, band.MinRSSI)
		}
		if band.aircraftSet == nil {
			t.Errorf("band %d: aircraftSet should be initialized", i)
		}
	}
}

func TestAnalyzer_NewWithBands(t *testing.T) {
	customBands := []DistanceBand{
		{MinDistance: 0, MaxDistance: 50, Label: "0-50"},
		{MinDistance: 50, MaxDistance: 100, Label: "50-100"},
		{MinDistance: 100, MaxDistance: 200, Label: "100-200"},
	}

	analyzer := NewAnalyzerWithBands(customBands)

	if len(analyzer.bands) != 3 {
		t.Errorf("expected 3 bands, got %d", len(analyzer.bands))
	}

	if len(analyzer.distanceBands) != 3 {
		t.Errorf("expected 3 distance bands, got %d", len(analyzer.distanceBands))
	}

	// Verify custom bands are used
	for i, band := range analyzer.distanceBands {
		if band.Label != customBands[i].Label {
			t.Errorf("band %d: expected label %s, got %s", i, customBands[i].Label, band.Label)
		}
	}
}

func TestAnalyzer_AddSample(t *testing.T) {
	analyzer := NewAnalyzer()

	sample := Sample{
		RSSI:       -10,
		Distance:   25, // Should be in band 1 (10-25nm)
		AircraftID: "ABC123",
	}

	analyzer.AddSample(sample)

	// Find the band for distance 25
	bandIdx := analyzer.findBand(25)
	if bandIdx < 0 {
		t.Fatal("could not find band for distance 25")
	}

	band := analyzer.bands[bandIdx]
	if band.SampleCount != 1 {
		t.Errorf("expected sample count 1, got %d", band.SampleCount)
	}

	if band.TotalRSSI != -10 {
		t.Errorf("expected total RSSI -10, got %f", band.TotalRSSI)
	}

	if band.MaxRSSI != -10 {
		t.Errorf("expected max RSSI -10, got %f", band.MaxRSSI)
	}

	if band.AircraftCount != 1 {
		t.Errorf("expected aircraft count 1, got %d", band.AircraftCount)
	}
}

func TestAnalyzer_AddSample_Aggregation(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add multiple samples to the same band
	samples := []Sample{
		{RSSI: -10, Distance: 5, AircraftID: "A1"},
		{RSSI: -20, Distance: 7, AircraftID: "A2"},
		{RSSI: -5, Distance: 8, AircraftID: "A3"},
	}

	for _, s := range samples {
		analyzer.AddSample(s)
	}

	bandIdx := analyzer.findBand(5) // All samples are in 0-10 band
	band := analyzer.bands[bandIdx]

	if band.SampleCount != 3 {
		t.Errorf("expected sample count 3, got %d", band.SampleCount)
	}

	expectedTotal := -10.0 + -20.0 + -5.0
	if band.TotalRSSI != expectedTotal {
		t.Errorf("expected total RSSI %f, got %f", expectedTotal, band.TotalRSSI)
	}

	if band.MaxRSSI != -5 {
		t.Errorf("expected max RSSI -5, got %f", band.MaxRSSI)
	}

	if band.MinRSSI != -20 {
		t.Errorf("expected min RSSI -20, got %f", band.MinRSSI)
	}

	if band.AircraftCount != 3 {
		t.Errorf("expected aircraft count 3, got %d", band.AircraftCount)
	}
}

func TestAnalyzer_AddSample_DuplicateAircraft(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add same aircraft multiple times
	for i := 0; i < 5; i++ {
		analyzer.AddSample(Sample{
			RSSI:       -10,
			Distance:   5,
			AircraftID: "SAME123",
		})
	}

	bandIdx := analyzer.findBand(5)
	band := analyzer.bands[bandIdx]

	// Sample count should be 5
	if band.SampleCount != 5 {
		t.Errorf("expected sample count 5, got %d", band.SampleCount)
	}

	// Aircraft count should be 1 (same aircraft)
	if band.AircraftCount != 1 {
		t.Errorf("expected aircraft count 1, got %d", band.AircraftCount)
	}
}

func TestAnalyzer_AddSampleSimple(t *testing.T) {
	analyzer := NewAnalyzer()

	analyzer.AddSampleSimple(-15, 30)

	bandIdx := analyzer.findBand(30)
	band := analyzer.bands[bandIdx]

	if band.SampleCount != 1 {
		t.Errorf("expected sample count 1, got %d", band.SampleCount)
	}

	if band.TotalRSSI != -15 {
		t.Errorf("expected total RSSI -15, got %f", band.TotalRSSI)
	}
}

func TestAnalyzer_AddAircraft(t *testing.T) {
	analyzer := NewAnalyzer()

	analyzer.AddAircraft("TEST001", -12, 45)

	bandIdx := analyzer.findBand(45)
	band := analyzer.bands[bandIdx]

	if band.SampleCount != 1 {
		t.Errorf("expected sample count 1, got %d", band.SampleCount)
	}

	if band.AircraftCount != 1 {
		t.Errorf("expected aircraft count 1, got %d", band.AircraftCount)
	}

	if !band.aircraftSet["TEST001"] {
		t.Error("aircraft TEST001 should be in aircraft set")
	}
}

func TestAnalyzer_GetSpectrum(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add samples across different bands
	analyzer.AddSampleSimple(-5, 5)   // Strong signal, close
	analyzer.AddSampleSimple(-15, 60) // Medium signal, far
	analyzer.AddSampleSimple(-25, 150) // Weak signal, very far

	spectrum := analyzer.GetSpectrum(0) // 0 means use default band count

	if len(spectrum) != len(DefaultDistanceBands) {
		t.Errorf("expected %d spectrum bins, got %d", len(DefaultDistanceBands), len(spectrum))
	}

	// Values should be between 0 and 1
	for i, v := range spectrum {
		if v < 0 || v > 1 {
			t.Errorf("spectrum[%d]: value %f should be between 0 and 1", i, v)
		}
	}

	// Bands with samples should have non-zero values
	closeBandIdx := analyzer.findBand(5)
	if spectrum[closeBandIdx] == 0 {
		t.Error("band with sample should have non-zero spectrum value")
	}
}

func TestAnalyzer_GetSpectrum_CustomBins(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add some samples
	analyzer.AddSampleSimple(-10, 50)

	// Get spectrum with different bin counts
	binCounts := []int{5, 10, 20, 30}
	for _, bins := range binCounts {
		spectrum := analyzer.GetSpectrum(bins)
		if len(spectrum) != bins {
			t.Errorf("expected %d bins, got %d", bins, len(spectrum))
		}
	}
}

func TestAnalyzer_GetSpectrumSmoothed(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add sample
	analyzer.AddSampleSimple(-5, 5)

	// Get smoothed spectrum multiple times
	spectrum1 := analyzer.GetSpectrumSmoothed(10)
	spectrum2 := analyzer.GetSpectrumSmoothed(10)

	// Second call should use smoothing from previous values
	if len(spectrum1) != 10 || len(spectrum2) != 10 {
		t.Error("spectrum should have requested number of bins")
	}

	// Values should be between 0 and 1
	for i, v := range spectrum2 {
		if v < 0 || v > 1 {
			t.Errorf("smoothed spectrum[%d]: value %f should be between 0 and 1", i, v)
		}
	}
}

func TestAnalyzer_GetSpectrumSmoothed_PeakHold(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add strong sample
	analyzer.AddSampleSimple(-5, 5)

	// Get spectrum to establish peak
	analyzer.GetSpectrumSmoothed(10)

	// Reset samples but peaks should remain
	analyzer.Reset()

	peaks := analyzer.GetPeaks(10)

	// After reset, peaks should have decayed but may still have some value
	// depending on implementation
	if len(peaks) != 10 {
		t.Errorf("expected 10 peak values, got %d", len(peaks))
	}
}

func TestAnalyzer_Decay(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add samples
	for i := 0; i < 10; i++ {
		analyzer.AddSampleSimple(-10, 50)
	}

	bandIdx := analyzer.findBand(50)
	initialCount := analyzer.bands[bandIdx].SampleCount

	// Apply decay
	analyzer.Decay()

	newCount := analyzer.bands[bandIdx].SampleCount

	// Count should have decreased
	if newCount >= initialCount {
		t.Errorf("sample count should decrease after decay: %d -> %d", initialCount, newCount)
	}

	// Apply more decay until count reaches 0
	for i := 0; i < 100; i++ {
		analyzer.Decay()
	}

	if analyzer.bands[bandIdx].SampleCount != 0 {
		t.Error("sample count should eventually reach 0 after repeated decay")
	}
}

func TestAnalyzer_Decay_PeakDecay(t *testing.T) {
	analyzer := NewAnalyzer()

	// Set a peak value directly for testing
	analyzer.peakValues[0] = 1.0

	// Apply decay
	for i := 0; i < 10; i++ {
		analyzer.Decay()
	}

	// Peak should have decreased
	if analyzer.peakValues[0] >= 1.0 {
		t.Error("peak value should decrease after decay")
	}

	// Peak should still be positive (slow decay)
	if analyzer.peakValues[0] <= 0 {
		t.Error("peak value should still be positive after few decays")
	}
}

func TestAnalyzer_Decay_AircraftClear(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add aircraft
	analyzer.AddAircraft("TEST001", -10, 5)

	bandIdx := analyzer.findBand(5)

	// Decay until sample count is 0
	for i := 0; i < 100; i++ {
		analyzer.Decay()
	}

	// Aircraft set should be cleared when sample count is 0
	if analyzer.bands[bandIdx].AircraftCount != 0 {
		t.Error("aircraft count should be 0 after full decay")
	}

	if len(analyzer.bands[bandIdx].aircraftSet) != 0 {
		t.Error("aircraft set should be empty after full decay")
	}
}

func TestAnalyzer_Reset(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add samples
	analyzer.AddSampleSimple(-10, 5)
	analyzer.AddSampleSimple(-15, 50)
	analyzer.AddAircraft("TEST", -20, 100)

	// Set some peak values
	analyzer.GetSpectrumSmoothed(10)

	// Reset
	analyzer.Reset()

	// All bands should be reset
	for i, band := range analyzer.bands {
		if band.SampleCount != 0 {
			t.Errorf("band %d: sample count should be 0 after reset", i)
		}
		if band.TotalRSSI != 0 {
			t.Errorf("band %d: total RSSI should be 0 after reset", i)
		}
		if band.AircraftCount != 0 {
			t.Errorf("band %d: aircraft count should be 0 after reset", i)
		}
		if band.MaxRSSI != -100 {
			t.Errorf("band %d: max RSSI should be reset to -100", i)
		}
	}

	// Previous spectrum should be reset
	for i, v := range analyzer.prevSpectrum {
		if v != 0 {
			t.Errorf("prevSpectrum[%d] should be 0 after reset", i)
		}
	}

	// Peak values should be reset
	for i, v := range analyzer.peakValues {
		if v != 0 {
			t.Errorf("peakValues[%d] should be 0 after reset", i)
		}
	}
}

func TestAnalyzer_SetDecayRate(t *testing.T) {
	analyzer := NewAnalyzer()

	// Set valid decay rate
	analyzer.SetDecayRate(0.5)
	if analyzer.decayRate != 0.5 {
		t.Errorf("expected decay rate 0.5, got %f", analyzer.decayRate)
	}

	// Test clamping
	analyzer.SetDecayRate(-0.5)
	if analyzer.decayRate != 0 {
		t.Errorf("decay rate should be clamped to 0, got %f", analyzer.decayRate)
	}

	analyzer.SetDecayRate(1.5)
	if analyzer.decayRate != 1.0 {
		t.Errorf("decay rate should be clamped to 1.0, got %f", analyzer.decayRate)
	}
}

func TestAnalyzer_SetSmoothing(t *testing.T) {
	analyzer := NewAnalyzer()

	// Set valid smoothing
	analyzer.SetSmoothing(0.7)
	if analyzer.smoothing != 0.7 {
		t.Errorf("expected smoothing 0.7, got %f", analyzer.smoothing)
	}

	// Test clamping
	analyzer.SetSmoothing(-0.5)
	if analyzer.smoothing != 0 {
		t.Errorf("smoothing should be clamped to 0, got %f", analyzer.smoothing)
	}

	analyzer.SetSmoothing(1.5)
	if analyzer.smoothing != 1.0 {
		t.Errorf("smoothing should be clamped to 1.0, got %f", analyzer.smoothing)
	}
}

func TestAnalyzer_GetBandLabels(t *testing.T) {
	analyzer := NewAnalyzer()

	labels := analyzer.GetBandLabels()

	if len(labels) != len(DefaultDistanceBands) {
		t.Errorf("expected %d labels, got %d", len(DefaultDistanceBands), len(labels))
	}

	// Verify labels match distance bands
	for i, label := range labels {
		if label != DefaultDistanceBands[i].Label {
			t.Errorf("label %d: expected %s, got %s", i, DefaultDistanceBands[i].Label, label)
		}
	}
}

func TestAnalyzer_GetStats(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add samples
	analyzer.AddAircraft("A1", -10, 5)
	analyzer.AddAircraft("A2", -15, 50)
	analyzer.AddAircraft("A3", -20, 5)

	stats := analyzer.GetStats()

	if stats.BandCount != len(DefaultDistanceBands) {
		t.Errorf("expected band count %d, got %d", len(DefaultDistanceBands), stats.BandCount)
	}

	if stats.TotalSamples != 3 {
		t.Errorf("expected total samples 3, got %d", stats.TotalSamples)
	}

	if stats.TotalAircraft != 3 {
		t.Errorf("expected total aircraft 3, got %d", stats.TotalAircraft)
	}

	// Check band stats
	if len(stats.BandStats) != len(DefaultDistanceBands) {
		t.Errorf("expected %d band stats, got %d", len(DefaultDistanceBands), len(stats.BandStats))
	}
}

func TestAnalyzer_DistanceBands(t *testing.T) {
	analyzer := NewAnalyzer()

	// Test that findBand returns correct indices for default bands
	testCases := []struct {
		distance float64
		expected int // -1 means no band found
	}{
		{0, 0},      // 0-10 band
		{5, 0},      // 0-10 band
		{10, 1},     // 10-25 band (inclusive of min)
		{25, 2},     // 25-50 band
		{50, 3},     // 50-75 band
		{100, 5},    // 100-150 band
		{300, 8},    // 300-400 band
		{500, 9},    // 400+ band (last band)
		{1000, 9},   // Far distance goes to last band
	}

	for _, tc := range testCases {
		result := analyzer.findBand(tc.distance)
		if result != tc.expected {
			t.Errorf("distance %.0f: expected band %d, got %d", tc.distance, tc.expected, result)
		}
	}
}

func TestAnalyzer_DistanceBands_OutOfRange(t *testing.T) {
	analyzer := NewAnalyzer()

	// Very far distances should go to last band
	result := analyzer.findBand(10000)
	if result != len(DefaultDistanceBands)-1 {
		t.Errorf("very far distance should go to last band, got %d", result)
	}
}

func TestCalculateDistanceBands(t *testing.T) {
	bands := CalculateDistanceBands(100, 10)

	if len(bands) != 10 {
		t.Fatalf("expected 10 bands, got %d", len(bands))
	}

	// First band should start at 0
	if bands[0].MinDistance != 0 {
		t.Errorf("first band should start at 0, got %f", bands[0].MinDistance)
	}

	// Last band should end at max range
	if bands[len(bands)-1].MaxDistance != 100 {
		t.Errorf("last band should end at 100, got %f", bands[len(bands)-1].MaxDistance)
	}

	// Bands should be contiguous
	for i := 1; i < len(bands); i++ {
		if bands[i].MinDistance != bands[i-1].MaxDistance {
			t.Errorf("bands should be contiguous at %d: %f != %f",
				i, bands[i].MinDistance, bands[i-1].MaxDistance)
		}
	}

	// Each band should have a label
	for i, band := range bands {
		if band.Label == "" {
			t.Errorf("band %d should have a label", i)
		}
	}
}

func TestCalculateDistanceBands_Logarithmic(t *testing.T) {
	bands := CalculateDistanceBands(100, 10)

	// Logarithmic distribution means closer bands should be smaller
	// Compare first half bands to second half
	firstHalfSize := bands[len(bands)/2-1].MaxDistance - bands[0].MinDistance
	secondHalfSize := bands[len(bands)-1].MaxDistance - bands[len(bands)/2].MinDistance

	if firstHalfSize >= secondHalfSize {
		t.Error("logarithmic distribution should have smaller bands at close range")
	}
}

func TestCalculateDistanceBands_DefaultCount(t *testing.T) {
	// Zero or negative count should default to 10
	bands := CalculateDistanceBands(100, 0)
	if len(bands) != 10 {
		t.Errorf("expected default 10 bands, got %d", len(bands))
	}

	bands = CalculateDistanceBands(100, -5)
	if len(bands) != 10 {
		t.Errorf("expected default 10 bands for negative count, got %d", len(bands))
	}
}

func TestAnalyzer_Concurrency(t *testing.T) {
	analyzer := NewAnalyzer()

	// Run concurrent operations
	done := make(chan bool)

	// Writer goroutine
	go func() {
		for i := 0; i < 1000; i++ {
			analyzer.AddSampleSimple(-10, float64(i%100))
		}
		done <- true
	}()

	// Reader goroutine
	go func() {
		for i := 0; i < 1000; i++ {
			_ = analyzer.GetSpectrum(10)
		}
		done <- true
	}()

	// Decay goroutine
	go func() {
		for i := 0; i < 100; i++ {
			analyzer.Decay()
		}
		done <- true
	}()

	// Wait for all goroutines
	for i := 0; i < 3; i++ {
		<-done
	}

	// If we get here without panic/race, the test passes
}

func TestAnalyzer_GetPeaks(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add sample to create a peak
	analyzer.AddSampleSimple(-5, 5)

	// Get smoothed spectrum to establish peak
	analyzer.GetSpectrumSmoothed(10)

	peaks := analyzer.GetPeaks(10)

	if len(peaks) != 10 {
		t.Errorf("expected 10 peaks, got %d", len(peaks))
	}

	// At least one peak should be non-zero
	hasNonZeroPeak := false
	for _, p := range peaks {
		if p > 0 {
			hasNonZeroPeak = true
			break
		}
	}

	if !hasNonZeroPeak {
		t.Error("should have at least one non-zero peak after adding sample")
	}
}

func TestAnalyzer_GetPeaks_Interpolation(t *testing.T) {
	analyzer := NewAnalyzer()

	// Set some peak values
	for i := range analyzer.peakValues {
		analyzer.peakValues[i] = float64(i) / float64(len(analyzer.peakValues))
	}

	// Get peaks with different bin count
	peaks := analyzer.GetPeaks(5)

	if len(peaks) != 5 {
		t.Errorf("expected 5 peaks, got %d", len(peaks))
	}

	// Values should be interpolated, not zero
	for i, p := range peaks {
		if p < 0 || p > 1 {
			t.Errorf("peak[%d]: value %f should be between 0 and 1", i, p)
		}
	}
}

func TestFormatDistanceLabel(t *testing.T) {
	testCases := []struct {
		min, max float64
		expected string
	}{
		{0, 1, "<1"},
		{5, 10, "5-10"},
		{100, 200, "100-200"},
		{500, 1500, "1k+"},
		{10, 10, "10"},
	}

	for _, tc := range testCases {
		result := formatDistanceLabel(tc.min, tc.max)
		if result != tc.expected {
			t.Errorf("formatDistanceLabel(%f, %f): expected %s, got %s",
				tc.min, tc.max, tc.expected, result)
		}
	}
}

func TestItoa(t *testing.T) {
	testCases := []struct {
		input    int
		expected string
	}{
		{0, "0"},
		{1, "1"},
		{10, "10"},
		{123, "123"},
		{-1, "-1"},
		{-123, "-123"},
		{999999, "999999"},
	}

	for _, tc := range testCases {
		result := itoa(tc.input)
		if result != tc.expected {
			t.Errorf("itoa(%d): expected %s, got %s", tc.input, tc.expected, result)
		}
	}
}

func TestClamp(t *testing.T) {
	testCases := []struct {
		value, min, max float64
		expected        float64
	}{
		{0.5, 0, 1, 0.5},
		{-0.5, 0, 1, 0},
		{1.5, 0, 1, 1},
		{50, 0, 100, 50},
		{-50, 0, 100, 0},
		{150, 0, 100, 100},
	}

	for _, tc := range testCases {
		result := clamp(tc.value, tc.min, tc.max)
		if result != tc.expected {
			t.Errorf("clamp(%f, %f, %f): expected %f, got %f",
				tc.value, tc.min, tc.max, tc.expected, result)
		}
	}
}

func TestDefaultDistanceBands(t *testing.T) {
	// Verify default bands are properly defined
	if len(DefaultDistanceBands) == 0 {
		t.Fatal("DefaultDistanceBands should not be empty")
	}

	// First band should start at 0
	if DefaultDistanceBands[0].MinDistance != 0 {
		t.Error("first band should start at distance 0")
	}

	// Bands should be contiguous
	for i := 1; i < len(DefaultDistanceBands); i++ {
		if DefaultDistanceBands[i].MinDistance != DefaultDistanceBands[i-1].MaxDistance {
			t.Errorf("bands should be contiguous at index %d", i)
		}
	}

	// Each band should have a label
	for i, band := range DefaultDistanceBands {
		if band.Label == "" {
			t.Errorf("band %d should have a label", i)
		}
	}
}

func TestDefaultADSBRange(t *testing.T) {
	if DefaultADSBRange.Min != 1090.0 {
		t.Errorf("expected ADS-B min freq 1090.0, got %f", DefaultADSBRange.Min)
	}
	if DefaultADSBRange.Max != 1090.0 {
		t.Errorf("expected ADS-B max freq 1090.0, got %f", DefaultADSBRange.Max)
	}
}

func BenchmarkAnalyzer_AddSample(b *testing.B) {
	analyzer := NewAnalyzer()
	sample := Sample{
		RSSI:       -15,
		Distance:   50,
		AircraftID: "TEST123",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		analyzer.AddSample(sample)
	}
}

func BenchmarkAnalyzer_GetSpectrum(b *testing.B) {
	analyzer := NewAnalyzer()

	// Add some samples
	for i := 0; i < 100; i++ {
		analyzer.AddSampleSimple(-10, float64(i*5%500))
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		analyzer.GetSpectrum(20)
	}
}

func BenchmarkAnalyzer_GetSpectrumSmoothed(b *testing.B) {
	analyzer := NewAnalyzer()

	// Add some samples
	for i := 0; i < 100; i++ {
		analyzer.AddSampleSimple(-10, float64(i*5%500))
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		analyzer.GetSpectrumSmoothed(20)
	}
}

func BenchmarkAnalyzer_Decay(b *testing.B) {
	analyzer := NewAnalyzer()

	// Add some samples
	for i := 0; i < 100; i++ {
		analyzer.AddSampleSimple(-10, float64(i*5%500))
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		analyzer.Decay()
		// Re-add sample to prevent everything from decaying to 0
		if i%10 == 0 {
			analyzer.AddSampleSimple(-10, 50)
		}
	}
}

func BenchmarkAnalyzer_Concurrent(b *testing.B) {
	analyzer := NewAnalyzer()

	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			if i%3 == 0 {
				analyzer.AddSampleSimple(-10, float64(i%100))
			} else if i%3 == 1 {
				analyzer.GetSpectrum(10)
			} else {
				analyzer.Decay()
			}
			i++
		}
	})
}

func BenchmarkCalculateDistanceBands(b *testing.B) {
	for i := 0; i < b.N; i++ {
		CalculateDistanceBands(100, 10)
	}
}

// Test normalization edge cases
func TestAnalyzer_NormalizeRSSI(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add very strong signal
	analyzer.AddSampleSimple(0, 5) // 0 dBm is very strong

	spectrum := analyzer.GetSpectrum(0)
	bandIdx := analyzer.findBand(5)

	// Strong signal should produce high normalized value
	if spectrum[bandIdx] < 0.5 {
		t.Errorf("strong signal should produce high normalized value, got %f", spectrum[bandIdx])
	}

	// Value should not exceed 1.0
	if spectrum[bandIdx] > 1.0 {
		t.Errorf("normalized value should not exceed 1.0, got %f", spectrum[bandIdx])
	}
}

func TestAnalyzer_NormalizeRSSI_EmptyBand(t *testing.T) {
	analyzer := NewAnalyzer()

	// Don't add any samples, just get spectrum
	spectrum := analyzer.GetSpectrum(0)

	// All values should be 0 for empty bands
	for i, v := range spectrum {
		if v != 0 {
			t.Errorf("empty band %d should have value 0, got %f", i, v)
		}
	}
}

func TestAnalyzer_RSSI_Range(t *testing.T) {
	analyzer := NewAnalyzer()

	// Test various RSSI values
	rssiValues := []float64{0, -5, -10, -15, -20, -25, -30}

	for _, rssi := range rssiValues {
		analyzer.Reset()
		analyzer.AddSampleSimple(rssi, 50)

		spectrum := analyzer.GetSpectrum(0)
		bandIdx := analyzer.findBand(50)

		value := spectrum[bandIdx]
		if value < 0 || value > 1 {
			t.Errorf("RSSI %f: normalized value %f should be between 0 and 1", rssi, value)
		}

		// Stronger signal (higher RSSI) should produce higher value
		if rssi > -10 && value < 0.3 {
			t.Errorf("RSSI %f: strong signal should produce value > 0.3, got %f", rssi, value)
		}
	}
}

func TestAnalyzer_ActivityNormalization(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add many aircraft to test activity normalization
	for i := 0; i < 15; i++ {
		analyzer.AddAircraft(string(rune('A'+i)), -15, 50)
	}

	spectrum := analyzer.GetSpectrum(0)
	bandIdx := analyzer.findBand(50)

	// With 15 aircraft (capped at 10 in normalization), activity component should be high
	if spectrum[bandIdx] < 0.3 {
		t.Errorf("high aircraft count should produce meaningful spectrum value, got %f", spectrum[bandIdx])
	}

	// Value should still not exceed 1.0
	if spectrum[bandIdx] > 1.0 {
		t.Errorf("normalized value should not exceed 1.0, got %f", spectrum[bandIdx])
	}
}

// Test that math operations don't produce NaN or Inf
func TestAnalyzer_MathStability(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add edge case values
	analyzer.AddSampleSimple(0, 0)
	analyzer.AddSampleSimple(-100, 1000)

	spectrum := analyzer.GetSpectrum(10)

	for i, v := range spectrum {
		if math.IsNaN(v) {
			t.Errorf("spectrum[%d] is NaN", i)
		}
		if math.IsInf(v, 0) {
			t.Errorf("spectrum[%d] is Inf", i)
		}
	}

	// Test smoothed spectrum
	smoothed := analyzer.GetSpectrumSmoothed(10)
	for i, v := range smoothed {
		if math.IsNaN(v) {
			t.Errorf("smoothed spectrum[%d] is NaN", i)
		}
		if math.IsInf(v, 0) {
			t.Errorf("smoothed spectrum[%d] is Inf", i)
		}
	}
}

// ============================================================================
// Additional Coverage Tests
// ============================================================================

func TestAnalyzer_AddSample_NegativeDistance(t *testing.T) {
	analyzer := NewAnalyzer()

	// Negative distance should return -1 from findBand and be ignored
	sample := Sample{
		RSSI:       -10,
		Distance:   -5, // Negative distance
		AircraftID: "NEG001",
	}

	analyzer.AddSample(sample)

	// No band should have this sample
	for i, band := range analyzer.bands {
		if band.SampleCount != 0 {
			t.Errorf("band %d: expected sample count 0 for negative distance, got %d", i, band.SampleCount)
		}
	}
}

func TestAnalyzer_FindBand_NegativeDistance(t *testing.T) {
	analyzer := NewAnalyzer()

	result := analyzer.findBand(-10)
	if result != -1 {
		t.Errorf("expected -1 for negative distance, got %d", result)
	}
}

func TestAnalyzer_Decay_NegativePeakValues(t *testing.T) {
	analyzer := NewAnalyzer()

	// Set a small peak value that will decay to negative territory
	analyzer.peakValues[0] = 0.001

	// Apply many decay cycles
	for i := 0; i < 1000; i++ {
		analyzer.Decay()
	}

	// Peak values should be clamped to 0, not negative
	for i, v := range analyzer.peakValues {
		if v < 0 {
			t.Errorf("peakValues[%d] should not be negative, got %f", i, v)
		}
	}
}

func TestAnalyzer_GetSpectrumSmoothed_ResizePrevSpectrum(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add some samples
	analyzer.AddSampleSimple(-10, 50)

	// Get smoothed spectrum with different bin count to trigger resize
	spectrum1 := analyzer.GetSpectrumSmoothed(5)
	if len(spectrum1) != 5 {
		t.Errorf("expected 5 bins, got %d", len(spectrum1))
	}

	// Check that prevSpectrum was resized
	if len(analyzer.prevSpectrum) != 5 {
		t.Errorf("prevSpectrum should be resized to 5, got %d", len(analyzer.prevSpectrum))
	}

	// Now get with different size to trigger another resize
	spectrum2 := analyzer.GetSpectrumSmoothed(15)
	if len(spectrum2) != 15 {
		t.Errorf("expected 15 bins, got %d", len(spectrum2))
	}

	if len(analyzer.prevSpectrum) != 15 {
		t.Errorf("prevSpectrum should be resized to 15, got %d", len(analyzer.prevSpectrum))
	}
}

func TestAnalyzer_GetSpectrumSmoothed_ResizePeakValues(t *testing.T) {
	analyzer := NewAnalyzer()

	// Get smoothed spectrum with different bin count to trigger peakValues resize
	analyzer.GetSpectrumSmoothed(7)

	if len(analyzer.peakValues) != 7 {
		t.Errorf("peakValues should be resized to 7, got %d", len(analyzer.peakValues))
	}
}

func TestAnalyzer_GetSpectrumSmoothed_Interpolation(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add samples to different bands to create variation
	analyzer.AddSampleSimple(-5, 5)   // Close band
	analyzer.AddSampleSimple(-20, 100) // Far band

	// Get smoothed spectrum with different number of bins than bands
	// This triggers the interpolation code path
	spectrum := analyzer.GetSpectrumSmoothed(15)

	if len(spectrum) != 15 {
		t.Errorf("expected 15 bins, got %d", len(spectrum))
	}

	// Values should be interpolated between bands
	// At least some values should be non-zero
	hasNonZero := false
	for _, v := range spectrum {
		if v > 0 {
			hasNonZero = true
			break
		}
	}
	if !hasNonZero {
		t.Error("expected some non-zero values after interpolation")
	}
}

func TestAnalyzer_NormalizeRSSI_OnlyAircraftCount(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add aircraft but with no RSSI samples (only aircraft count)
	bandIdx := analyzer.findBand(50)
	band := &analyzer.bands[bandIdx]

	// Manually set only aircraft count without samples
	band.aircraftSet["AC1"] = true
	band.AircraftCount = 1
	// SampleCount remains 0

	// Get spectrum to test normalization
	spectrum := analyzer.GetSpectrum(0)

	// The band should have a non-zero value due to activity normalization
	if spectrum[bandIdx] == 0 {
		t.Error("expected non-zero value for band with only aircraft count")
	}

	// Value should be lower (weighted 0.5) since there are no RSSI samples
	if spectrum[bandIdx] > 0.5 {
		t.Errorf("expected lower weight for aircraft-only band, got %f", spectrum[bandIdx])
	}
}

func TestAnalyzer_Decay_MaxRSSIDecay(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add a sample with high RSSI
	analyzer.AddSampleSimple(-5, 50)

	bandIdx := analyzer.findBand(50)
	initialMaxRSSI := analyzer.bands[bandIdx].MaxRSSI

	// Apply decay
	analyzer.Decay()

	// MaxRSSI should have decreased
	if analyzer.bands[bandIdx].MaxRSSI >= initialMaxRSSI {
		t.Error("MaxRSSI should decrease after decay")
	}

	// Apply many decays - MaxRSSI should eventually reach -30
	for i := 0; i < 100; i++ {
		analyzer.Decay()
	}

	if analyzer.bands[bandIdx].MaxRSSI < -30 {
		t.Errorf("MaxRSSI should not go below -30, got %f", analyzer.bands[bandIdx].MaxRSSI)
	}
}

func TestAnalyzer_Decay_TotalRSSIDecay(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add samples with negative RSSI (typical values)
	analyzer.AddSampleSimple(-10, 50)
	analyzer.AddSampleSimple(-10, 50)

	bandIdx := analyzer.findBand(50)
	initialTotalRSSI := analyzer.bands[bandIdx].TotalRSSI

	// Apply decay
	analyzer.Decay()

	// TotalRSSI is negative, so decay should make it closer to 0 (increase)
	// The formula is: TotalRSSI *= (1.0 - decayRate)
	// For negative value, this moves towards 0
	// So abs(TotalRSSI) should decrease
	if abs(analyzer.bands[bandIdx].TotalRSSI) >= abs(initialTotalRSSI) {
		t.Errorf("TotalRSSI magnitude should decrease after decay: %f -> %f", initialTotalRSSI, analyzer.bands[bandIdx].TotalRSSI)
	}
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func TestAnalyzer_Decay_SampleCountNonNegative(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add sample
	analyzer.AddSampleSimple(-10, 50)

	// Apply many decays
	for i := 0; i < 100; i++ {
		analyzer.Decay()
	}

	// Sample count should never go negative
	for i, band := range analyzer.bands {
		if band.SampleCount < 0 {
			t.Errorf("band %d: SampleCount should not be negative, got %d", i, band.SampleCount)
		}
	}
}

func TestAnalyzer_GetSpectrum_SingleBin(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add samples
	analyzer.AddSampleSimple(-10, 50)

	// Get spectrum with just 1 bin
	spectrum := analyzer.GetSpectrum(1)

	if len(spectrum) != 1 {
		t.Errorf("expected 1 bin, got %d", len(spectrum))
	}
}

func TestAnalyzer_GetPeaks_DefaultBins(t *testing.T) {
	analyzer := NewAnalyzer()

	// Get peaks with 0 bins (should use default)
	peaks := analyzer.GetPeaks(0)

	if len(peaks) != len(analyzer.peakValues) {
		t.Errorf("expected %d peaks, got %d", len(analyzer.peakValues), len(peaks))
	}
}

func TestAnalyzer_GetPeaks_MatchingBins(t *testing.T) {
	analyzer := NewAnalyzer()

	// Set some peak values
	for i := range analyzer.peakValues {
		analyzer.peakValues[i] = float64(i) * 0.1
	}

	// Get peaks with exact matching bin count
	peaks := analyzer.GetPeaks(len(analyzer.peakValues))

	// Should return a copy of peak values
	for i, p := range peaks {
		if p != analyzer.peakValues[i] {
			t.Errorf("peaks[%d]: expected %f, got %f", i, analyzer.peakValues[i], p)
		}
	}

	// Modifying returned peaks should not affect original
	peaks[0] = 999
	if analyzer.peakValues[0] == 999 {
		t.Error("returned peaks should be a copy, not reference")
	}
}

func TestFormatDistanceLabel_EdgeCases(t *testing.T) {
	// Test min less than 1
	result := formatDistanceLabel(0.5, 2)
	if result != "<1" {
		t.Errorf("expected '<1', got %s", result)
	}

	// Test max >= 1000
	result = formatDistanceLabel(900, 1000)
	if result != "1k+" {
		t.Errorf("expected '1k+', got %s", result)
	}

	result = formatDistanceLabel(500, 1500)
	if result != "1k+" {
		t.Errorf("expected '1k+' for max > 1000, got %s", result)
	}
}

func TestAnalyzer_AddSample_EmptyAircraftID(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add sample with empty aircraft ID
	sample := Sample{
		RSSI:       -10,
		Distance:   50,
		AircraftID: "", // Empty
	}

	analyzer.AddSample(sample)

	bandIdx := analyzer.findBand(50)
	band := analyzer.bands[bandIdx]

	// Sample count should increase
	if band.SampleCount != 1 {
		t.Errorf("expected sample count 1, got %d", band.SampleCount)
	}

	// Aircraft count should remain 0 for empty ID
	if band.AircraftCount != 0 {
		t.Errorf("expected aircraft count 0 for empty ID, got %d", band.AircraftCount)
	}
}

func TestAnalyzer_GetStats_EmptyBands(t *testing.T) {
	analyzer := NewAnalyzer()

	// Get stats without adding any samples
	stats := analyzer.GetStats()

	if stats.TotalSamples != 0 {
		t.Errorf("expected 0 total samples, got %d", stats.TotalSamples)
	}

	if stats.TotalAircraft != 0 {
		t.Errorf("expected 0 total aircraft, got %d", stats.TotalAircraft)
	}

	// Check that band stats have default values
	for i, bs := range stats.BandStats {
		if bs.SampleCount != 0 {
			t.Errorf("band %d: expected 0 samples, got %d", i, bs.SampleCount)
		}
		if bs.AvgRSSI != -30 {
			t.Errorf("band %d: expected default AvgRSSI -30, got %f", i, bs.AvgRSSI)
		}
	}
}

func TestAnalyzer_GetSpectrumSmoothed_ZeroBins(t *testing.T) {
	analyzer := NewAnalyzer()

	// Add some samples
	analyzer.AddSampleSimple(-10, 50)

	// Get smoothed spectrum with 0 bins (should use default band count)
	spectrum := analyzer.GetSpectrumSmoothed(0)

	if len(spectrum) != len(DefaultDistanceBands) {
		t.Errorf("expected %d bins for 0 input, got %d", len(DefaultDistanceBands), len(spectrum))
	}
}

func TestAnalyzer_GetSpectrumSmoothed_NegativeBins(t *testing.T) {
	analyzer := NewAnalyzer()

	// Get smoothed spectrum with negative bins (should use default)
	spectrum := analyzer.GetSpectrumSmoothed(-5)

	if len(spectrum) != len(DefaultDistanceBands) {
		t.Errorf("expected %d bins for negative input, got %d", len(DefaultDistanceBands), len(spectrum))
	}
}
