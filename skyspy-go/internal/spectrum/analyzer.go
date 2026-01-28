// Package spectrum provides signal spectrum analysis and visualization
package spectrum

import (
	"math"
	"sync"
)

// FrequencyRange defines the frequency range for spectrum analysis
type FrequencyRange struct {
	Min float64 // Minimum frequency in MHz
	Max float64 // Maximum frequency in MHz
}

// DefaultADSBRange is the typical ADS-B frequency range
var DefaultADSBRange = FrequencyRange{Min: 1090.0, Max: 1090.0}

// DistanceBand represents a distance-based signal band
type DistanceBand struct {
	MinDistance float64 // Minimum distance in nm
	MaxDistance float64 // Maximum distance in nm
	Label       string  // Label for display
}

// DefaultDistanceBands defines standard distance bands for spectrum visualization
var DefaultDistanceBands = []DistanceBand{
	{MinDistance: 0, MaxDistance: 10, Label: "0-10"},
	{MinDistance: 10, MaxDistance: 25, Label: "10-25"},
	{MinDistance: 25, MaxDistance: 50, Label: "25-50"},
	{MinDistance: 50, MaxDistance: 75, Label: "50-75"},
	{MinDistance: 75, MaxDistance: 100, Label: "75-100"},
	{MinDistance: 100, MaxDistance: 150, Label: "100-150"},
	{MinDistance: 150, MaxDistance: 200, Label: "150-200"},
	{MinDistance: 200, MaxDistance: 300, Label: "200-300"},
	{MinDistance: 300, MaxDistance: 400, Label: "300-400"},
	{MinDistance: 400, MaxDistance: 600, Label: "400+"},
}

// Sample represents a signal sample with RSSI and metadata
type Sample struct {
	RSSI       float64 // Signal strength in dBm (typically -30 to 0)
	Distance   float64 // Distance from receiver in nm
	Frequency  float64 // Frequency in MHz (optional)
	Timestamp  int64   // Unix timestamp in milliseconds
	AircraftID string  // Hex ID of the aircraft
}

// BandData holds aggregated data for a single band
type BandData struct {
	SampleCount   int
	TotalRSSI     float64
	MaxRSSI       float64
	MinRSSI       float64
	AircraftCount int
	aircraftSet   map[string]bool
}

// Analyzer aggregates signal data and produces spectrum visualizations
type Analyzer struct {
	mu            sync.RWMutex
	bands         []BandData
	distanceBands []DistanceBand
	decayRate     float64    // Rate at which old data fades (0.0 to 1.0)
	smoothing     float64    // Smoothing factor for display (0.0 to 1.0)
	prevSpectrum  []float64  // Previous spectrum values for smoothing
	peakValues    []float64  // Peak hold values
	peakDecay     float64    // Rate at which peaks decay
}

// NewAnalyzer creates a new spectrum analyzer
func NewAnalyzer() *Analyzer {
	bands := make([]BandData, len(DefaultDistanceBands))
	for i := range bands {
		bands[i] = BandData{
			MaxRSSI:     -100,
			MinRSSI:     0,
			aircraftSet: make(map[string]bool),
		}
	}

	return &Analyzer{
		bands:         bands,
		distanceBands: DefaultDistanceBands,
		decayRate:     0.15,   // 15% decay per update cycle
		smoothing:     0.3,    // 30% new value, 70% old value
		prevSpectrum:  make([]float64, len(DefaultDistanceBands)),
		peakValues:    make([]float64, len(DefaultDistanceBands)),
		peakDecay:     0.02,   // Peaks decay slowly
	}
}

// NewAnalyzerWithBands creates an analyzer with custom distance bands
func NewAnalyzerWithBands(bands []DistanceBand) *Analyzer {
	bandData := make([]BandData, len(bands))
	for i := range bandData {
		bandData[i] = BandData{
			MaxRSSI:     -100,
			MinRSSI:     0,
			aircraftSet: make(map[string]bool),
		}
	}

	return &Analyzer{
		bands:         bandData,
		distanceBands: bands,
		decayRate:     0.15,
		smoothing:     0.3,
		prevSpectrum:  make([]float64, len(bands)),
		peakValues:    make([]float64, len(bands)),
		peakDecay:     0.02,
	}
}

// SetDecayRate sets the decay rate for old samples (0.0 to 1.0)
func (a *Analyzer) SetDecayRate(rate float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.decayRate = clamp(rate, 0.0, 1.0)
}

// SetSmoothing sets the smoothing factor (0.0 = no smoothing, 1.0 = max smoothing)
func (a *Analyzer) SetSmoothing(factor float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.smoothing = clamp(factor, 0.0, 1.0)
}

// AddSample adds a signal sample to the analyzer
func (a *Analyzer) AddSample(sample Sample) {
	a.mu.Lock()
	defer a.mu.Unlock()

	bandIdx := a.findBand(sample.Distance)
	if bandIdx < 0 {
		return
	}

	band := &a.bands[bandIdx]
	band.SampleCount++
	band.TotalRSSI += sample.RSSI

	if sample.RSSI > band.MaxRSSI {
		band.MaxRSSI = sample.RSSI
	}
	if sample.RSSI < band.MinRSSI {
		band.MinRSSI = sample.RSSI
	}

	if sample.AircraftID != "" && !band.aircraftSet[sample.AircraftID] {
		band.aircraftSet[sample.AircraftID] = true
		band.AircraftCount++
	}
}

// AddSampleSimple adds a sample with just RSSI and distance
func (a *Analyzer) AddSampleSimple(rssi, distance float64) {
	a.AddSample(Sample{
		RSSI:     rssi,
		Distance: distance,
	})
}

// AddAircraft adds aircraft data directly to the analyzer
func (a *Analyzer) AddAircraft(aircraftID string, rssi, distance float64) {
	a.AddSample(Sample{
		RSSI:       rssi,
		Distance:   distance,
		AircraftID: aircraftID,
	})
}

// findBand returns the index of the band for a given distance
func (a *Analyzer) findBand(distance float64) int {
	for i, band := range a.distanceBands {
		if distance >= band.MinDistance && distance < band.MaxDistance {
			return i
		}
	}
	// If distance exceeds all bands, put in last band
	if distance >= a.distanceBands[len(a.distanceBands)-1].MinDistance {
		return len(a.distanceBands) - 1
	}
	return -1
}

// Decay applies decay to all band data, reducing old values over time
func (a *Analyzer) Decay() {
	a.mu.Lock()
	defer a.mu.Unlock()

	for i := range a.bands {
		band := &a.bands[i]

		// Decay sample count
		band.SampleCount = int(float64(band.SampleCount) * (1.0 - a.decayRate))
		if band.SampleCount < 0 {
			band.SampleCount = 0
		}

		// Decay total RSSI proportionally
		band.TotalRSSI *= (1.0 - a.decayRate)

		// Decay max RSSI towards minimum
		band.MaxRSSI = band.MaxRSSI - (band.MaxRSSI+30)*a.decayRate*0.5
		if band.MaxRSSI < -30 {
			band.MaxRSSI = -30
		}

		// Clear aircraft set on full decay
		if band.SampleCount == 0 {
			band.aircraftSet = make(map[string]bool)
			band.AircraftCount = 0
		}
	}

	// Decay peak values
	for i := range a.peakValues {
		a.peakValues[i] *= (1.0 - a.peakDecay)
		if a.peakValues[i] < 0 {
			a.peakValues[i] = 0
		}
	}
}

// Reset clears all accumulated data
func (a *Analyzer) Reset() {
	a.mu.Lock()
	defer a.mu.Unlock()

	for i := range a.bands {
		a.bands[i] = BandData{
			MaxRSSI:     -100,
			MinRSSI:     0,
			aircraftSet: make(map[string]bool),
		}
	}
	for i := range a.prevSpectrum {
		a.prevSpectrum[i] = 0
	}
	for i := range a.peakValues {
		a.peakValues[i] = 0
	}
}

// GetSpectrum returns normalized spectrum values (0.0 to 1.0)
// The bins parameter specifies how many output bins to produce
func (a *Analyzer) GetSpectrum(bins int) []float64 {
	a.mu.RLock()
	defer a.mu.RUnlock()

	if bins <= 0 {
		bins = len(a.bands)
	}

	spectrum := make([]float64, bins)

	// If bins match bands, direct mapping
	if bins == len(a.bands) {
		for i, band := range a.bands {
			spectrum[i] = a.normalizeRSSI(band)
		}
	} else {
		// Interpolate/decimate to match requested bins
		bandSpectrum := make([]float64, len(a.bands))
		for i, band := range a.bands {
			bandSpectrum[i] = a.normalizeRSSI(band)
		}

		for i := 0; i < bins; i++ {
			// Map output bin to input band
			bandIdx := float64(i) * float64(len(a.bands)-1) / float64(bins-1)
			lowIdx := int(bandIdx)
			highIdx := lowIdx + 1
			if highIdx >= len(a.bands) {
				highIdx = len(a.bands) - 1
			}
			frac := bandIdx - float64(lowIdx)
			spectrum[i] = bandSpectrum[lowIdx]*(1-frac) + bandSpectrum[highIdx]*frac
		}
	}

	return spectrum
}

// GetSpectrumSmoothed returns smoothed spectrum values with peak hold
func (a *Analyzer) GetSpectrumSmoothed(bins int) []float64 {
	a.mu.Lock()
	defer a.mu.Unlock()

	if bins <= 0 {
		bins = len(a.bands)
	}

	// Ensure prevSpectrum and peakValues are correct size
	if len(a.prevSpectrum) != bins {
		a.prevSpectrum = make([]float64, bins)
	}
	if len(a.peakValues) != bins {
		a.peakValues = make([]float64, bins)
	}

	spectrum := make([]float64, bins)

	// Calculate raw spectrum values
	rawSpectrum := make([]float64, len(a.bands))
	for i, band := range a.bands {
		rawSpectrum[i] = a.normalizeRSSI(band)
	}

	// Map to output bins
	for i := 0; i < bins; i++ {
		var raw float64
		if bins == len(a.bands) {
			raw = rawSpectrum[i]
		} else {
			bandIdx := float64(i) * float64(len(a.bands)-1) / float64(bins-1)
			lowIdx := int(bandIdx)
			highIdx := lowIdx + 1
			if highIdx >= len(a.bands) {
				highIdx = len(a.bands) - 1
			}
			frac := bandIdx - float64(lowIdx)
			raw = rawSpectrum[lowIdx]*(1-frac) + rawSpectrum[highIdx]*frac
		}

		// Apply smoothing
		smoothed := a.prevSpectrum[i]*(1-a.smoothing) + raw*a.smoothing
		spectrum[i] = smoothed
		a.prevSpectrum[i] = smoothed

		// Update peaks
		if smoothed > a.peakValues[i] {
			a.peakValues[i] = smoothed
		}
	}

	return spectrum
}

// GetPeaks returns the current peak values
func (a *Analyzer) GetPeaks(bins int) []float64 {
	a.mu.RLock()
	defer a.mu.RUnlock()

	if bins <= 0 || bins == len(a.peakValues) {
		result := make([]float64, len(a.peakValues))
		copy(result, a.peakValues)
		return result
	}

	// Interpolate peaks to match bins
	peaks := make([]float64, bins)
	for i := 0; i < bins; i++ {
		peakIdx := float64(i) * float64(len(a.peakValues)-1) / float64(bins-1)
		lowIdx := int(peakIdx)
		highIdx := lowIdx + 1
		if highIdx >= len(a.peakValues) {
			highIdx = len(a.peakValues) - 1
		}
		frac := peakIdx - float64(lowIdx)
		peaks[i] = a.peakValues[lowIdx]*(1-frac) + a.peakValues[highIdx]*frac
	}
	return peaks
}

// GetBandLabels returns labels for each band
func (a *Analyzer) GetBandLabels() []string {
	a.mu.RLock()
	defer a.mu.RUnlock()

	labels := make([]string, len(a.distanceBands))
	for i, band := range a.distanceBands {
		labels[i] = band.Label
	}
	return labels
}

// GetStats returns current statistics
func (a *Analyzer) GetStats() SpectrumStats {
	a.mu.RLock()
	defer a.mu.RUnlock()

	stats := SpectrumStats{
		BandCount:   len(a.bands),
		BandStats:   make([]BandStats, len(a.bands)),
	}

	for i, band := range a.bands {
		avgRSSI := float64(-30)
		if band.SampleCount > 0 {
			avgRSSI = band.TotalRSSI / float64(band.SampleCount)
		}
		stats.BandStats[i] = BandStats{
			Label:         a.distanceBands[i].Label,
			SampleCount:   band.SampleCount,
			AircraftCount: band.AircraftCount,
			AvgRSSI:       avgRSSI,
			MaxRSSI:       band.MaxRSSI,
		}
		stats.TotalSamples += band.SampleCount
		stats.TotalAircraft += band.AircraftCount
	}

	return stats
}

// normalizeRSSI converts band data to a 0.0-1.0 value
// RSSI typically ranges from -30 (strong) to 0 (weak) in our system
// We also factor in aircraft count for activity visualization
func (a *Analyzer) normalizeRSSI(band BandData) float64 {
	if band.SampleCount == 0 && band.AircraftCount == 0 {
		return 0.0
	}

	// Calculate average RSSI
	avgRSSI := float64(-30)
	if band.SampleCount > 0 {
		avgRSSI = band.TotalRSSI / float64(band.SampleCount)
	}

	// Normalize RSSI: -30 dBm = 0.0, 0 dBm = 1.0
	// Most signals are between -30 and -5 dBm
	rssiNorm := (avgRSSI + 30) / 30.0
	rssiNorm = clamp(rssiNorm, 0.0, 1.0)

	// Factor in aircraft count for activity (capped at 10 aircraft per band)
	activityNorm := float64(band.AircraftCount) / 10.0
	activityNorm = clamp(activityNorm, 0.0, 1.0)

	// Combine RSSI and activity: weight RSSI more when we have samples
	if band.SampleCount > 0 {
		return rssiNorm*0.7 + activityNorm*0.3
	}
	return activityNorm * 0.5 // Lower weight when we only have aircraft count
}

// SpectrumStats contains analyzer statistics
type SpectrumStats struct {
	BandCount     int
	TotalSamples  int
	TotalAircraft int
	BandStats     []BandStats
}

// BandStats contains statistics for a single band
type BandStats struct {
	Label         string
	SampleCount   int
	AircraftCount int
	AvgRSSI       float64
	MaxRSSI       float64
}

// clamp restricts a value to a range
func clamp(value, min, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

// Utility functions for creating spectrum from aircraft data

// CalculateDistanceBands creates optimal distance bands based on max range
func CalculateDistanceBands(maxRange float64, numBands int) []DistanceBand {
	if numBands <= 0 {
		numBands = 10
	}

	bands := make([]DistanceBand, numBands)

	// Use logarithmic spacing for better resolution at closer ranges
	for i := 0; i < numBands; i++ {
		// Logarithmic distribution gives more bins for close range
		t := float64(i) / float64(numBands)
		minDist := maxRange * math.Pow(t, 1.5)

		t2 := float64(i+1) / float64(numBands)
		maxDist := maxRange * math.Pow(t2, 1.5)

		bands[i] = DistanceBand{
			MinDistance: minDist,
			MaxDistance: maxDist,
			Label:       formatDistanceLabel(minDist, maxDist),
		}
	}

	return bands
}

// formatDistanceLabel creates a readable label for a distance range
func formatDistanceLabel(min, max float64) string {
	if min < 1 {
		return "<1"
	}
	if max >= 1000 {
		return "1k+"
	}
	minInt := int(min)
	maxInt := int(max)
	if minInt == maxInt {
		return itoa(minInt)
	}
	return itoa(minInt) + "-" + itoa(maxInt)
}

// itoa converts an integer to string without importing strconv
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var b [20]byte
	n := len(b) - 1
	for i > 0 {
		b[n] = byte('0' + i%10)
		i /= 10
		n--
	}
	if neg {
		b[n] = '-'
		n--
	}
	return string(b[n+1:])
}
