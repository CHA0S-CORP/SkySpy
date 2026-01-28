// Package audio provides audio alert functionality for SkySpy CLI
package audio

import (
	"os/exec"
	"runtime"
	"sync"
	"time"

	"github.com/skyspy/skyspy-go/internal/config"
)

// AlertType represents the type of audio alert
type AlertType int

const (
	AlertNewAircraft AlertType = iota
	AlertEmergency
	AlertMilitary
)

// debounceInterval is the minimum time between same alert types
const debounceInterval = 2 * time.Second

// AlertPlayer handles playing audio alerts with debouncing
type AlertPlayer struct {
	config       *config.AudioSettings
	lastPlayed   map[AlertType]time.Time
	mu           sync.Mutex
	soundManager *SoundManager
}

// NewAlertPlayer creates a new alert player with the given configuration
func NewAlertPlayer(cfg *config.AudioSettings) *AlertPlayer {
	return &AlertPlayer{
		config:       cfg,
		lastPlayed:   make(map[AlertType]time.Time),
		soundManager: NewSoundManager(),
	}
}

// SetEnabled enables or disables audio alerts
func (p *AlertPlayer) SetEnabled(enabled bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.config.Enabled = enabled
}

// IsEnabled returns whether audio alerts are enabled
func (p *AlertPlayer) IsEnabled() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.config.Enabled
}

// PlayNewAircraft plays the new aircraft alert sound
func (p *AlertPlayer) PlayNewAircraft() {
	if !p.shouldPlay(AlertNewAircraft) {
		return
	}
	p.mu.Lock()
	if !p.config.NewAircraftSound {
		p.mu.Unlock()
		return
	}
	p.mu.Unlock()

	p.playSound(AlertNewAircraft)
}

// PlayEmergency plays the emergency alert sound
func (p *AlertPlayer) PlayEmergency() {
	if !p.shouldPlay(AlertEmergency) {
		return
	}
	p.mu.Lock()
	if !p.config.EmergencySound {
		p.mu.Unlock()
		return
	}
	p.mu.Unlock()

	p.playSound(AlertEmergency)
}

// PlayMilitary plays the military aircraft alert sound
func (p *AlertPlayer) PlayMilitary() {
	if !p.shouldPlay(AlertMilitary) {
		return
	}
	p.mu.Lock()
	if !p.config.MilitarySound {
		p.mu.Unlock()
		return
	}
	p.mu.Unlock()

	p.playSound(AlertMilitary)
}

// shouldPlay checks if enough time has passed since the last alert of this type
func (p *AlertPlayer) shouldPlay(alertType AlertType) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.config.Enabled {
		return false
	}

	now := time.Now()
	if lastTime, exists := p.lastPlayed[alertType]; exists {
		if now.Sub(lastTime) < debounceInterval {
			return false
		}
	}

	p.lastPlayed[alertType] = now
	return true
}

// playSound plays the sound for the given alert type
func (p *AlertPlayer) playSound(alertType AlertType) {
	soundPath := p.soundManager.GetSoundPath(alertType)

	// Try platform-specific audio playback
	if soundPath != "" {
		if p.playPlatformSound(soundPath) {
			return
		}
	}

	// Fall back to terminal bell
	p.playTerminalBell()
}

// playPlatformSound attempts to play a sound file using platform-specific tools
func (p *AlertPlayer) playPlatformSound(soundPath string) bool {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		// macOS: use afplay
		cmd = exec.Command("afplay", soundPath)
	case "linux":
		// Linux: try paplay first (PulseAudio), then aplay (ALSA)
		if _, err := exec.LookPath("paplay"); err == nil {
			cmd = exec.Command("paplay", soundPath)
		} else if _, err := exec.LookPath("aplay"); err == nil {
			cmd = exec.Command("aplay", "-q", soundPath)
		} else {
			return false
		}
	case "windows":
		// Windows: use PowerShell to play sound
		cmd = exec.Command("powershell", "-c",
			"(New-Object Media.SoundPlayer '"+soundPath+"').PlaySync()")
	default:
		return false
	}

	// Run in background, don't block
	go func() {
		_ = cmd.Run()
	}()

	return true
}

// playTerminalBell sends the terminal bell character
func (p *AlertPlayer) playTerminalBell() {
	// Print the bell character to trigger terminal sound
	print("\a")
}

// playSystemBeep attempts to play a system beep using platform tools
func (p *AlertPlayer) playSystemBeep(frequency, durationMs int) bool {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		// macOS: use osascript to beep
		cmd = exec.Command("osascript", "-e", "beep")
	case "linux":
		// Linux: use beep command if available, or speaker-test
		if _, err := exec.LookPath("beep"); err == nil {
			cmd = exec.Command("beep", "-f", itoa(frequency), "-l", itoa(durationMs))
		} else if _, err := exec.LookPath("speaker-test"); err == nil {
			// speaker-test plays a sine wave
			cmd = exec.Command("speaker-test", "-t", "sine", "-f", itoa(frequency),
				"-l", "1", "-p", itoa(durationMs))
		} else {
			return false
		}
	case "windows":
		// Windows: use PowerShell to play a beep
		cmd = exec.Command("powershell", "-c",
			"[console]::beep("+itoa(frequency)+","+itoa(durationMs)+")")
	default:
		return false
	}

	go func() {
		_ = cmd.Run()
	}()

	return true
}

// itoa converts an int to a string without importing strconv
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
