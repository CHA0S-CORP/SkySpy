// Package audio provides audio alert functionality for SkySpy CLI
package audio

import (
	"os"
	"path/filepath"
	"sync"
)

// SoundManager handles sound file management and generation
type SoundManager struct {
	soundDir     string
	soundPaths   map[AlertType]string
	initialized  bool
	mu           sync.Mutex
}

// NewSoundManager creates a new sound manager
func NewSoundManager() *SoundManager {
	homeDir, _ := os.UserHomeDir()
	soundDir := filepath.Join(homeDir, ".config", "skyspy", "sounds")

	return &SoundManager{
		soundDir:   soundDir,
		soundPaths: make(map[AlertType]string),
	}
}

// GetSoundPath returns the path to the sound file for the given alert type
// It will generate the sound file if it doesn't exist
func (m *SoundManager) GetSoundPath(alertType AlertType) string {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.initialized {
		m.initializeSounds()
		m.initialized = true
	}

	return m.soundPaths[alertType]
}

// initializeSounds creates the sound directory and generates sound files
func (m *SoundManager) initializeSounds() {
	// Create sound directory if it doesn't exist
	if err := os.MkdirAll(m.soundDir, 0755); err != nil {
		return
	}

	// Generate each sound type
	m.soundPaths[AlertNewAircraft] = m.generateSound(AlertNewAircraft, "new_aircraft.wav")
	m.soundPaths[AlertEmergency] = m.generateSound(AlertEmergency, "emergency.wav")
	m.soundPaths[AlertMilitary] = m.generateSound(AlertMilitary, "military.wav")
}

// generateSound creates a WAV file for the given alert type
func (m *SoundManager) generateSound(alertType AlertType, filename string) string {
	soundPath := filepath.Join(m.soundDir, filename)

	// Check if sound already exists
	if _, err := os.Stat(soundPath); err == nil {
		return soundPath
	}

	// Generate the WAV data based on alert type
	var wavData []byte
	switch alertType {
	case AlertNewAircraft:
		// Short pleasant beep - 800Hz for 150ms
		wavData = generateWav(800, 150, 0.5)
	case AlertEmergency:
		// Urgent alarm - alternating 1000Hz/800Hz for 400ms
		wavData = generateAlarmWav(1000, 800, 400, 0.7)
	case AlertMilitary:
		// Two-tone alert - 600Hz then 900Hz, 100ms each
		wavData = generateTwoToneWav(600, 900, 100, 0.6)
	}

	// Write the WAV file
	if err := os.WriteFile(soundPath, wavData, 0644); err != nil {
		return ""
	}

	return soundPath
}

// generateWav creates a simple sine wave WAV file
func generateWav(frequency, durationMs int, volume float64) []byte {
	sampleRate := 44100
	numSamples := sampleRate * durationMs / 1000
	numChannels := 1
	bitsPerSample := 16
	byteRate := sampleRate * numChannels * bitsPerSample / 8
	blockAlign := numChannels * bitsPerSample / 8
	dataSize := numSamples * blockAlign

	// WAV header (44 bytes)
	header := make([]byte, 44)

	// RIFF header
	copy(header[0:4], "RIFF")
	writeLE32(header[4:8], uint32(36+dataSize))
	copy(header[8:12], "WAVE")

	// fmt chunk
	copy(header[12:16], "fmt ")
	writeLE32(header[16:20], 16) // chunk size
	writeLE16(header[20:22], 1)  // audio format (PCM)
	writeLE16(header[22:24], uint16(numChannels))
	writeLE32(header[24:28], uint32(sampleRate))
	writeLE32(header[28:32], uint32(byteRate))
	writeLE16(header[32:34], uint16(blockAlign))
	writeLE16(header[34:36], uint16(bitsPerSample))

	// data chunk
	copy(header[36:40], "data")
	writeLE32(header[40:44], uint32(dataSize))

	// Generate samples
	samples := make([]byte, dataSize)
	pi2 := 6.283185307179586 // 2 * Pi

	for i := 0; i < numSamples; i++ {
		t := float64(i) / float64(sampleRate)
		// Apply fade in/out envelope to avoid clicks
		envelope := 1.0
		fadeLen := numSamples / 10
		if i < fadeLen {
			envelope = float64(i) / float64(fadeLen)
		} else if i > numSamples-fadeLen {
			envelope = float64(numSamples-i) / float64(fadeLen)
		}

		sample := sin(pi2*float64(frequency)*t) * volume * envelope
		sampleInt := int16(sample * 32767)
		writeLE16(samples[i*2:i*2+2], uint16(sampleInt))
	}

	return append(header, samples...)
}

// generateAlarmWav creates an alternating frequency alarm sound
func generateAlarmWav(freq1, freq2, durationMs int, volume float64) []byte {
	sampleRate := 44100
	numSamples := sampleRate * durationMs / 1000
	numChannels := 1
	bitsPerSample := 16
	byteRate := sampleRate * numChannels * bitsPerSample / 8
	blockAlign := numChannels * bitsPerSample / 8
	dataSize := numSamples * blockAlign

	// WAV header (44 bytes)
	header := make([]byte, 44)

	// RIFF header
	copy(header[0:4], "RIFF")
	writeLE32(header[4:8], uint32(36+dataSize))
	copy(header[8:12], "WAVE")

	// fmt chunk
	copy(header[12:16], "fmt ")
	writeLE32(header[16:20], 16)
	writeLE16(header[20:22], 1)
	writeLE16(header[22:24], uint16(numChannels))
	writeLE32(header[24:28], uint32(sampleRate))
	writeLE32(header[28:32], uint32(byteRate))
	writeLE16(header[32:34], uint16(blockAlign))
	writeLE16(header[34:36], uint16(bitsPerSample))

	// data chunk
	copy(header[36:40], "data")
	writeLE32(header[40:44], uint32(dataSize))

	// Generate alternating frequency samples
	samples := make([]byte, dataSize)
	pi2 := 6.283185307179586
	switchInterval := numSamples / 8 // Switch frequency 8 times

	for i := 0; i < numSamples; i++ {
		t := float64(i) / float64(sampleRate)

		// Determine which frequency to use
		freq := freq1
		if (i/switchInterval)%2 == 1 {
			freq = freq2
		}

		// Apply envelope
		envelope := 1.0
		fadeLen := numSamples / 20
		if i < fadeLen {
			envelope = float64(i) / float64(fadeLen)
		} else if i > numSamples-fadeLen {
			envelope = float64(numSamples-i) / float64(fadeLen)
		}

		sample := sin(pi2*float64(freq)*t) * volume * envelope
		sampleInt := int16(sample * 32767)
		writeLE16(samples[i*2:i*2+2], uint16(sampleInt))
	}

	return append(header, samples...)
}

// generateTwoToneWav creates a two-tone sequential alert sound
func generateTwoToneWav(freq1, freq2, toneDurationMs int, volume float64) []byte {
	sampleRate := 44100
	samplesPerTone := sampleRate * toneDurationMs / 1000
	numSamples := samplesPerTone * 2
	numChannels := 1
	bitsPerSample := 16
	byteRate := sampleRate * numChannels * bitsPerSample / 8
	blockAlign := numChannels * bitsPerSample / 8
	dataSize := numSamples * blockAlign

	// WAV header (44 bytes)
	header := make([]byte, 44)

	// RIFF header
	copy(header[0:4], "RIFF")
	writeLE32(header[4:8], uint32(36+dataSize))
	copy(header[8:12], "WAVE")

	// fmt chunk
	copy(header[12:16], "fmt ")
	writeLE32(header[16:20], 16)
	writeLE16(header[20:22], 1)
	writeLE16(header[22:24], uint16(numChannels))
	writeLE32(header[24:28], uint32(sampleRate))
	writeLE32(header[28:32], uint32(byteRate))
	writeLE16(header[32:34], uint16(blockAlign))
	writeLE16(header[34:36], uint16(bitsPerSample))

	// data chunk
	copy(header[36:40], "data")
	writeLE32(header[40:44], uint32(dataSize))

	// Generate two-tone samples
	samples := make([]byte, dataSize)
	pi2 := 6.283185307179586

	for i := 0; i < numSamples; i++ {
		t := float64(i) / float64(sampleRate)

		// First or second tone
		freq := freq1
		localI := i
		if i >= samplesPerTone {
			freq = freq2
			localI = i - samplesPerTone
		}

		// Apply envelope per tone
		envelope := 1.0
		fadeLen := samplesPerTone / 10
		if localI < fadeLen {
			envelope = float64(localI) / float64(fadeLen)
		} else if localI > samplesPerTone-fadeLen {
			envelope = float64(samplesPerTone-localI) / float64(fadeLen)
		}

		sample := sin(pi2*float64(freq)*t) * volume * envelope
		sampleInt := int16(sample * 32767)
		writeLE16(samples[i*2:i*2+2], uint16(sampleInt))
	}

	return append(header, samples...)
}

// sin computes sine using Taylor series (avoids math import)
func sin(x float64) float64 {
	// Normalize to [-pi, pi]
	pi := 3.141592653589793
	for x > pi {
		x -= 2 * pi
	}
	for x < -pi {
		x += 2 * pi
	}

	// Taylor series: sin(x) = x - x^3/3! + x^5/5! - x^7/7! + ...
	x2 := x * x
	x3 := x2 * x
	x5 := x3 * x2
	x7 := x5 * x2
	x9 := x7 * x2
	x11 := x9 * x2

	return x - x3/6 + x5/120 - x7/5040 + x9/362880 - x11/39916800
}

// writeLE16 writes a 16-bit value in little-endian format
func writeLE16(b []byte, v uint16) {
	b[0] = byte(v)
	b[1] = byte(v >> 8)
}

// writeLE32 writes a 32-bit value in little-endian format
func writeLE32(b []byte, v uint32) {
	b[0] = byte(v)
	b[1] = byte(v >> 8)
	b[2] = byte(v >> 16)
	b[3] = byte(v >> 24)
}

// GetCustomSoundPath returns the path for custom sounds in the config directory
func GetCustomSoundPath(soundType string) string {
	homeDir, _ := os.UserHomeDir()
	soundDir := filepath.Join(homeDir, ".config", "skyspy", "sounds")
	return filepath.Join(soundDir, soundType+".wav")
}
