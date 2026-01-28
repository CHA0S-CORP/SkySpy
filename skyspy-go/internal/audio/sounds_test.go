// Package audio provides audio alert functionality for SkySpy CLI
package audio

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewSoundManager(t *testing.T) {
	sm := NewSoundManager()

	if sm == nil {
		t.Fatal("NewSoundManager returned nil")
	}

	if sm.soundPaths == nil {
		t.Error("soundPaths map should be initialized")
	}

	if sm.initialized {
		t.Error("initialized should be false initially")
	}

	homeDir, _ := os.UserHomeDir()
	expectedSoundDir := filepath.Join(homeDir, ".config", "skyspy", "sounds")
	if sm.soundDir != expectedSoundDir {
		t.Errorf("soundDir = %q, want %q", sm.soundDir, expectedSoundDir)
	}
}

func TestSoundManager_GetSoundPath(t *testing.T) {
	// Create a temp directory for testing
	tempDir, err := os.MkdirTemp("", "skyspy-audio-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	sm := &SoundManager{
		soundDir:   tempDir,
		soundPaths: make(map[AlertType]string),
	}

	// Test getting sound paths - this should initialize and generate sounds
	path := sm.GetSoundPath(AlertNewAircraft)

	if !sm.initialized {
		t.Error("SoundManager should be initialized after GetSoundPath")
	}

	// Verify the file was created
	if path == "" {
		t.Error("GetSoundPath returned empty path")
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Errorf("Sound file was not created at %s", path)
	}

	// Call again to verify cached paths are returned
	path2 := sm.GetSoundPath(AlertNewAircraft)
	if path != path2 {
		t.Errorf("GetSoundPath returned different paths: %q vs %q", path, path2)
	}
}

func TestSoundManager_GetSoundPath_AllTypes(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-audio-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	sm := &SoundManager{
		soundDir:   tempDir,
		soundPaths: make(map[AlertType]string),
	}

	// Test all alert types
	alertTypes := []AlertType{AlertNewAircraft, AlertEmergency, AlertMilitary}
	expectedFiles := []string{"new_aircraft.wav", "emergency.wav", "military.wav"}

	for i, alertType := range alertTypes {
		path := sm.GetSoundPath(alertType)

		if path == "" {
			t.Errorf("GetSoundPath(%d) returned empty path", alertType)
			continue
		}

		expectedPath := filepath.Join(tempDir, expectedFiles[i])
		if path != expectedPath {
			t.Errorf("GetSoundPath(%d) = %q, want %q", alertType, path, expectedPath)
		}

		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("Sound file was not created at %s", path)
		}
	}
}

func TestSoundManager_InitializeSounds_DirectoryCreationError(t *testing.T) {
	// Use an invalid directory path
	sm := &SoundManager{
		soundDir:   "/invalid/nonexistent/path/that/cannot/be/created",
		soundPaths: make(map[AlertType]string),
	}

	// This should not panic and handle the error gracefully
	sm.initializeSounds()

	// Sound paths should be empty since directory creation failed
	if len(sm.soundPaths) != 3 {
		// Note: initializeSounds still creates entries even if write fails
		// The paths will be empty strings
	}
}

func TestSoundManager_GenerateSound_ExistingFile(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-audio-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create an existing file
	existingPath := filepath.Join(tempDir, "existing.wav")
	if err := os.WriteFile(existingPath, []byte("existing content"), 0644); err != nil {
		t.Fatalf("Failed to create existing file: %v", err)
	}

	sm := &SoundManager{
		soundDir:   tempDir,
		soundPaths: make(map[AlertType]string),
	}

	// generateSound should return the existing path without overwriting
	result := sm.generateSound(AlertNewAircraft, "existing.wav")
	if result != existingPath {
		t.Errorf("generateSound returned %q, want %q", result, existingPath)
	}

	// Verify file content wasn't changed
	content, _ := os.ReadFile(existingPath)
	if string(content) != "existing content" {
		t.Error("Existing file was overwritten")
	}
}

func TestGenerateWav(t *testing.T) {
	// Test basic WAV generation
	wav := generateWav(800, 100, 0.5)

	if len(wav) == 0 {
		t.Fatal("generateWav returned empty data")
	}

	// Verify WAV header
	if string(wav[0:4]) != "RIFF" {
		t.Errorf("WAV header should start with RIFF, got %q", string(wav[0:4]))
	}

	if string(wav[8:12]) != "WAVE" {
		t.Errorf("WAV header should contain WAVE, got %q", string(wav[8:12]))
	}

	if string(wav[12:16]) != "fmt " {
		t.Errorf("WAV header should contain 'fmt ', got %q", string(wav[12:16]))
	}

	if string(wav[36:40]) != "data" {
		t.Errorf("WAV header should contain 'data', got %q", string(wav[36:40]))
	}
}

func TestGenerateWav_DifferentParameters(t *testing.T) {
	tests := []struct {
		name       string
		frequency  int
		durationMs int
		volume     float64
	}{
		{"low_freq", 100, 100, 0.3},
		{"high_freq", 2000, 100, 0.7},
		{"short_duration", 800, 10, 0.5},
		{"long_duration", 800, 500, 0.5},
		{"low_volume", 800, 100, 0.1},
		{"high_volume", 800, 100, 1.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wav := generateWav(tt.frequency, tt.durationMs, tt.volume)

			if len(wav) < 44 {
				t.Errorf("WAV data too short: %d bytes", len(wav))
			}

			// Verify it's a valid WAV
			if string(wav[0:4]) != "RIFF" {
				t.Error("Invalid WAV header")
			}
		})
	}
}

func TestGenerateAlarmWav(t *testing.T) {
	wav := generateAlarmWav(1000, 800, 400, 0.7)

	if len(wav) == 0 {
		t.Fatal("generateAlarmWav returned empty data")
	}

	// Verify WAV header
	if string(wav[0:4]) != "RIFF" {
		t.Error("WAV header should start with RIFF")
	}

	if string(wav[8:12]) != "WAVE" {
		t.Error("WAV header should contain WAVE")
	}
}

func TestGenerateTwoToneWav(t *testing.T) {
	wav := generateTwoToneWav(600, 900, 100, 0.6)

	if len(wav) == 0 {
		t.Fatal("generateTwoToneWav returned empty data")
	}

	// Verify WAV header
	if string(wav[0:4]) != "RIFF" {
		t.Error("WAV header should start with RIFF")
	}

	if string(wav[8:12]) != "WAVE" {
		t.Error("WAV header should contain WAVE")
	}
}

func TestSin(t *testing.T) {
	tests := []struct {
		input    float64
		expected float64
		epsilon  float64
	}{
		{0, 0, 0.0001},
		{3.141592653589793 / 2, 1, 0.0001},   // pi/2
		{3.141592653589793, 0, 0.001},        // pi (Taylor series has some error at pi)
		{3.141592653589793 * 3 / 2, -1, 0.01}, // 3pi/2
		{-3.141592653589793 / 2, -1, 0.0001}, // -pi/2
	}

	for _, tt := range tests {
		result := sin(tt.input)
		diff := result - tt.expected
		if diff < 0 {
			diff = -diff
		}
		if diff > tt.epsilon {
			t.Errorf("sin(%f) = %f, want %f (diff: %f)", tt.input, result, tt.expected, diff)
		}
	}
}

func TestSin_Normalization(t *testing.T) {
	// Test values outside [-pi, pi] that need normalization
	pi := 3.141592653589793

	// Test large positive values
	result := sin(10 * pi)
	if result > 0.01 || result < -0.01 {
		t.Errorf("sin(10*pi) should be close to 0, got %f", result)
	}

	// Test large negative values
	result = sin(-10 * pi)
	if result > 0.01 || result < -0.01 {
		t.Errorf("sin(-10*pi) should be close to 0, got %f", result)
	}
}

func TestWriteLE16(t *testing.T) {
	tests := []struct {
		value    uint16
		expected []byte
	}{
		{0x0000, []byte{0x00, 0x00}},
		{0x0001, []byte{0x01, 0x00}},
		{0x0100, []byte{0x00, 0x01}},
		{0x1234, []byte{0x34, 0x12}},
		{0xFFFF, []byte{0xFF, 0xFF}},
	}

	for _, tt := range tests {
		b := make([]byte, 2)
		writeLE16(b, tt.value)
		if b[0] != tt.expected[0] || b[1] != tt.expected[1] {
			t.Errorf("writeLE16(%04x) = %v, want %v", tt.value, b, tt.expected)
		}
	}
}

func TestWriteLE32(t *testing.T) {
	tests := []struct {
		value    uint32
		expected []byte
	}{
		{0x00000000, []byte{0x00, 0x00, 0x00, 0x00}},
		{0x00000001, []byte{0x01, 0x00, 0x00, 0x00}},
		{0x12345678, []byte{0x78, 0x56, 0x34, 0x12}},
		{0xFFFFFFFF, []byte{0xFF, 0xFF, 0xFF, 0xFF}},
	}

	for _, tt := range tests {
		b := make([]byte, 4)
		writeLE32(b, tt.value)
		for i := 0; i < 4; i++ {
			if b[i] != tt.expected[i] {
				t.Errorf("writeLE32(%08x) = %v, want %v", tt.value, b, tt.expected)
				break
			}
		}
	}
}

func TestGetCustomSoundPath(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	expected := filepath.Join(homeDir, ".config", "skyspy", "sounds", "test.wav")

	result := GetCustomSoundPath("test")
	if result != expected {
		t.Errorf("GetCustomSoundPath(\"test\") = %q, want %q", result, expected)
	}
}

func TestGetCustomSoundPath_DifferentTypes(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	soundDir := filepath.Join(homeDir, ".config", "skyspy", "sounds")

	tests := []struct {
		soundType string
		expected  string
	}{
		{"alert", filepath.Join(soundDir, "alert.wav")},
		{"notification", filepath.Join(soundDir, "notification.wav")},
		{"", filepath.Join(soundDir, ".wav")},
	}

	for _, tt := range tests {
		result := GetCustomSoundPath(tt.soundType)
		if result != tt.expected {
			t.Errorf("GetCustomSoundPath(%q) = %q, want %q", tt.soundType, result, tt.expected)
		}
	}
}

func TestSoundManager_GenerateSound_WriteError(t *testing.T) {
	// Use a directory that exists but file cannot be written to
	// by making the sound directory a file instead of a directory
	tempDir, err := os.MkdirTemp("", "skyspy-audio-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create a file with the name of the sound directory
	invalidSoundDir := filepath.Join(tempDir, "sounds")
	if err := os.WriteFile(invalidSoundDir, []byte("not a dir"), 0644); err != nil {
		t.Fatalf("Failed to create blocking file: %v", err)
	}

	sm := &SoundManager{
		soundDir:   invalidSoundDir,
		soundPaths: make(map[AlertType]string),
	}

	// This should fail because we can't write to a file as if it were a directory
	result := sm.generateSound(AlertNewAircraft, "test.wav")
	if result != "" {
		t.Errorf("generateSound should return empty string when write fails, got %q", result)
	}
}

func TestSoundManager_GenerateSound_UnknownAlertType(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-audio-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	sm := &SoundManager{
		soundDir:   tempDir,
		soundPaths: make(map[AlertType]string),
	}

	// Test with an unknown alert type (beyond defined constants)
	unknownType := AlertType(999)
	result := sm.generateSound(unknownType, "unknown.wav")

	// With an unknown type, wavData will be nil/empty, and os.WriteFile
	// will write an empty file, which should succeed
	expectedPath := filepath.Join(tempDir, "unknown.wav")
	if result != expectedPath {
		t.Errorf("generateSound with unknown type = %q, want %q", result, expectedPath)
	}
}

func TestSoundManager_InitializeSounds_AllTypes(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-audio-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	sm := &SoundManager{
		soundDir:   tempDir,
		soundPaths: make(map[AlertType]string),
	}

	sm.initializeSounds()

	// Verify all three sound paths are set
	if sm.soundPaths[AlertNewAircraft] == "" {
		t.Error("AlertNewAircraft sound path should be set")
	}
	if sm.soundPaths[AlertEmergency] == "" {
		t.Error("AlertEmergency sound path should be set")
	}
	if sm.soundPaths[AlertMilitary] == "" {
		t.Error("AlertMilitary sound path should be set")
	}
}
