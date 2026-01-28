// Package audio provides audio alert functionality for SkySpy CLI
package audio

import (
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/skyspy/skyspy-go/internal/config"
)

func TestNewAlertPlayer(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:          true,
		NewAircraftSound: true,
		EmergencySound:   true,
		MilitarySound:    true,
	}

	player := NewAlertPlayer(cfg)

	if player == nil {
		t.Fatal("NewAlertPlayer returned nil")
	}

	if player.config != cfg {
		t.Error("config was not set correctly")
	}

	if player.lastPlayed == nil {
		t.Error("lastPlayed map should be initialized")
	}

	if player.soundManager == nil {
		t.Error("soundManager should be initialized")
	}
}

func TestAlertPlayer_SetEnabled(t *testing.T) {
	cfg := &config.AudioSettings{Enabled: false}
	player := NewAlertPlayer(cfg)

	player.SetEnabled(true)
	if !player.config.Enabled {
		t.Error("SetEnabled(true) should enable audio")
	}

	player.SetEnabled(false)
	if player.config.Enabled {
		t.Error("SetEnabled(false) should disable audio")
	}
}

func TestAlertPlayer_IsEnabled(t *testing.T) {
	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	if !player.IsEnabled() {
		t.Error("IsEnabled should return true when enabled")
	}

	player.SetEnabled(false)
	if player.IsEnabled() {
		t.Error("IsEnabled should return false when disabled")
	}
}

func TestAlertPlayer_ShouldPlay_Disabled(t *testing.T) {
	cfg := &config.AudioSettings{Enabled: false}
	player := NewAlertPlayer(cfg)

	if player.shouldPlay(AlertNewAircraft) {
		t.Error("shouldPlay should return false when audio is disabled")
	}
}

func TestAlertPlayer_ShouldPlay_Debouncing(t *testing.T) {
	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	// First call should return true
	if !player.shouldPlay(AlertNewAircraft) {
		t.Error("First call to shouldPlay should return true")
	}

	// Immediate second call should return false (debounced)
	if player.shouldPlay(AlertNewAircraft) {
		t.Error("Immediate second call should be debounced")
	}

	// Different alert type should still work
	if !player.shouldPlay(AlertEmergency) {
		t.Error("Different alert type should not be debounced")
	}
}

func TestAlertPlayer_ShouldPlay_AfterDebounceInterval(t *testing.T) {
	// Create a player with direct access to modify lastPlayed
	cfg := &config.AudioSettings{Enabled: true}
	player := &AlertPlayer{
		config:       cfg,
		lastPlayed:   make(map[AlertType]time.Time),
		soundManager: NewSoundManager(),
	}

	// Set last played to before the debounce interval
	player.lastPlayed[AlertNewAircraft] = time.Now().Add(-3 * time.Second)

	// Should play now since debounce interval has passed
	if !player.shouldPlay(AlertNewAircraft) {
		t.Error("shouldPlay should return true after debounce interval")
	}
}

func TestAlertPlayer_PlayNewAircraft_Disabled(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:          false,
		NewAircraftSound: true,
	}
	player := NewAlertPlayer(cfg)

	// Should not panic when disabled
	player.PlayNewAircraft()
}

func TestAlertPlayer_PlayNewAircraft_SoundDisabled(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:          true,
		NewAircraftSound: false,
	}
	player := NewAlertPlayer(cfg)

	// Should not panic when new aircraft sound is disabled
	player.PlayNewAircraft()
}

func TestAlertPlayer_PlayNewAircraft_Enabled(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-audio-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.AudioSettings{
		Enabled:          true,
		NewAircraftSound: true,
	}
	player := &AlertPlayer{
		config:     cfg,
		lastPlayed: make(map[AlertType]time.Time),
		soundManager: &SoundManager{
			soundDir:   tempDir,
			soundPaths: make(map[AlertType]string),
		},
	}

	// Should not panic - this will try to play sound
	player.PlayNewAircraft()
}

func TestAlertPlayer_PlayEmergency_Disabled(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:        false,
		EmergencySound: true,
	}
	player := NewAlertPlayer(cfg)

	player.PlayEmergency()
}

func TestAlertPlayer_PlayEmergency_SoundDisabled(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:        true,
		EmergencySound: false,
	}
	player := NewAlertPlayer(cfg)

	player.PlayEmergency()
}

func TestAlertPlayer_PlayEmergency_Enabled(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-audio-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.AudioSettings{
		Enabled:        true,
		EmergencySound: true,
	}
	player := &AlertPlayer{
		config:     cfg,
		lastPlayed: make(map[AlertType]time.Time),
		soundManager: &SoundManager{
			soundDir:   tempDir,
			soundPaths: make(map[AlertType]string),
		},
	}

	player.PlayEmergency()
}

func TestAlertPlayer_PlayMilitary_Disabled(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:       false,
		MilitarySound: true,
	}
	player := NewAlertPlayer(cfg)

	player.PlayMilitary()
}

func TestAlertPlayer_PlayMilitary_SoundDisabled(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:       true,
		MilitarySound: false,
	}
	player := NewAlertPlayer(cfg)

	player.PlayMilitary()
}

func TestAlertPlayer_PlayMilitary_Enabled(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-audio-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfg := &config.AudioSettings{
		Enabled:       true,
		MilitarySound: true,
	}
	player := &AlertPlayer{
		config:     cfg,
		lastPlayed: make(map[AlertType]time.Time),
		soundManager: &SoundManager{
			soundDir:   tempDir,
			soundPaths: make(map[AlertType]string),
		},
	}

	player.PlayMilitary()
}

func TestAlertPlayer_PlaySound_EmptyPath(t *testing.T) {
	cfg := &config.AudioSettings{Enabled: true}
	player := &AlertPlayer{
		config:     cfg,
		lastPlayed: make(map[AlertType]time.Time),
		soundManager: &SoundManager{
			soundDir:   "/nonexistent",
			soundPaths: make(map[AlertType]string),
		},
	}

	// Should fall back to terminal bell without panicking
	player.playSound(AlertNewAircraft)
}

func TestAlertPlayer_PlayPlatformSound_Darwin(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Skipping darwin-specific test")
	}

	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	// Test with a non-existent file - should return true (command started)
	result := player.playPlatformSound("/nonexistent/sound.wav")
	if !result {
		t.Error("playPlatformSound should return true on darwin")
	}
}

func TestAlertPlayer_PlayPlatformSound_Linux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Skipping linux-specific test")
	}

	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	// Test with a non-existent file
	result := player.playPlatformSound("/nonexistent/sound.wav")
	// Result depends on whether paplay or aplay is available
	_ = result // We just want to ensure it doesn't panic
}

func TestAlertPlayer_PlayPlatformSound_Windows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Skipping windows-specific test")
	}

	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	result := player.playPlatformSound("C:\\nonexistent\\sound.wav")
	if !result {
		t.Error("playPlatformSound should return true on windows")
	}
}

func TestAlertPlayer_PlayPlatformSound_UnknownOS(t *testing.T) {
	// We can't easily test this since runtime.GOOS is a constant
	// But we can verify the function exists and handles known OS
	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	// Just ensure it doesn't panic
	_ = player.playPlatformSound("/some/path.wav")
}

func TestAlertPlayer_PlayTerminalBell(t *testing.T) {
	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	// Should not panic
	player.playTerminalBell()
}

func TestAlertPlayer_PlaySystemBeep_Darwin(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Skipping darwin-specific test")
	}

	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	result := player.playSystemBeep(1000, 100)
	if !result {
		t.Error("playSystemBeep should return true on darwin")
	}
}

func TestAlertPlayer_PlaySystemBeep_Linux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Skipping linux-specific test")
	}

	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	// Result depends on whether beep or speaker-test is available
	_ = player.playSystemBeep(1000, 100)
}

func TestAlertPlayer_PlaySystemBeep_Windows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Skipping windows-specific test")
	}

	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	result := player.playSystemBeep(1000, 100)
	if !result {
		t.Error("playSystemBeep should return true on windows")
	}
}

func TestItoa(t *testing.T) {
	tests := []struct {
		input    int
		expected string
	}{
		{0, "0"},
		{1, "1"},
		{10, "10"},
		{123, "123"},
		{-1, "-1"},
		{-123, "-123"},
		{1000000, "1000000"},
		{-1000000, "-1000000"},
	}

	for _, tt := range tests {
		result := itoa(tt.input)
		if result != tt.expected {
			t.Errorf("itoa(%d) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestAlertType_Constants(t *testing.T) {
	// Verify alert type constants
	if AlertNewAircraft != 0 {
		t.Errorf("AlertNewAircraft = %d, want 0", AlertNewAircraft)
	}
	if AlertEmergency != 1 {
		t.Errorf("AlertEmergency = %d, want 1", AlertEmergency)
	}
	if AlertMilitary != 2 {
		t.Errorf("AlertMilitary = %d, want 2", AlertMilitary)
	}
}

func TestAlertPlayer_Concurrency(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:          true,
		NewAircraftSound: true,
		EmergencySound:   true,
		MilitarySound:    true,
	}
	player := NewAlertPlayer(cfg)

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(3)
		go func() {
			defer wg.Done()
			player.SetEnabled(true)
			_ = player.IsEnabled()
		}()
		go func() {
			defer wg.Done()
			player.SetEnabled(false)
			_ = player.IsEnabled()
		}()
		go func() {
			defer wg.Done()
			_ = player.shouldPlay(AlertNewAircraft)
		}()
	}
	wg.Wait()
}

func TestAlertPlayer_PlayNewAircraft_Debouncing(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:          true,
		NewAircraftSound: true,
	}
	player := NewAlertPlayer(cfg)

	// First play should work
	player.PlayNewAircraft()

	// Second play immediately should be debounced
	// (We verify this by checking lastPlayed has the entry)
	player.mu.Lock()
	_, exists := player.lastPlayed[AlertNewAircraft]
	player.mu.Unlock()

	if !exists {
		t.Error("lastPlayed should have AlertNewAircraft entry")
	}
}

func TestAlertPlayer_PlayEmergency_Debouncing(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:        true,
		EmergencySound: true,
	}
	player := NewAlertPlayer(cfg)

	player.PlayEmergency()

	player.mu.Lock()
	_, exists := player.lastPlayed[AlertEmergency]
	player.mu.Unlock()

	if !exists {
		t.Error("lastPlayed should have AlertEmergency entry")
	}
}

func TestAlertPlayer_PlayMilitary_Debouncing(t *testing.T) {
	cfg := &config.AudioSettings{
		Enabled:       true,
		MilitarySound: true,
	}
	player := NewAlertPlayer(cfg)

	player.PlayMilitary()

	player.mu.Lock()
	_, exists := player.lastPlayed[AlertMilitary]
	player.mu.Unlock()

	if !exists {
		t.Error("lastPlayed should have AlertMilitary entry")
	}
}

func TestAlertPlayer_PlayPlatformSound_AllPlatforms(t *testing.T) {
	// This test exercises the playPlatformSound method on the current platform
	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	// Test with a valid looking path (file doesn't need to exist for the code path)
	result := player.playPlatformSound("/tmp/test_sound.wav")

	// On known platforms (darwin, linux, windows), this should return true
	// because the command is spawned (even if it fails later)
	switch runtime.GOOS {
	case "darwin", "windows":
		if !result {
			t.Errorf("playPlatformSound should return true on %s", runtime.GOOS)
		}
	case "linux":
		// On Linux, result depends on whether paplay or aplay is available
		// Just make sure it doesn't panic
		_ = result
	default:
		// On unknown OS, should return false
		if result {
			t.Errorf("playPlatformSound should return false on unknown OS %s", runtime.GOOS)
		}
	}
}

func TestAlertPlayer_PlaySystemBeep_AllPlatforms(t *testing.T) {
	cfg := &config.AudioSettings{Enabled: true}
	player := NewAlertPlayer(cfg)

	result := player.playSystemBeep(1000, 100)

	switch runtime.GOOS {
	case "darwin", "windows":
		if !result {
			t.Errorf("playSystemBeep should return true on %s", runtime.GOOS)
		}
	case "linux":
		// On Linux, result depends on whether beep or speaker-test is available
		_ = result
	default:
		if result {
			t.Errorf("playSystemBeep should return false on unknown OS %s", runtime.GOOS)
		}
	}
}

func TestAlertPlayer_PlaySound_WithValidPath(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyspy-audio-test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create a valid sound file
	soundPath := filepath.Join(tempDir, "test.wav")
	wavData := generateWav(800, 100, 0.5)
	if err := os.WriteFile(soundPath, wavData, 0644); err != nil {
		t.Fatalf("Failed to write sound file: %v", err)
	}

	cfg := &config.AudioSettings{Enabled: true}
	player := &AlertPlayer{
		config:     cfg,
		lastPlayed: make(map[AlertType]time.Time),
		soundManager: &SoundManager{
			soundDir:    tempDir,
			soundPaths:  map[AlertType]string{AlertNewAircraft: soundPath},
			initialized: true,
		},
	}

	// This should try to play the sound
	player.playSound(AlertNewAircraft)
}

func TestAlertPlayer_PlaySound_FallbackToBell(t *testing.T) {
	cfg := &config.AudioSettings{Enabled: true}
	player := &AlertPlayer{
		config:     cfg,
		lastPlayed: make(map[AlertType]time.Time),
		soundManager: &SoundManager{
			soundDir:    "/nonexistent",
			soundPaths:  map[AlertType]string{},
			initialized: true,
		},
	}

	// With no sound path, should fall back to terminal bell
	player.playSound(AlertNewAircraft)
}
