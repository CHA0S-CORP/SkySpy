// Package ui provides reusable UI components for SkySpy applications
package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/skyspy/skyspy-go/internal/theme"
)

// VUMeter represents a VU meter display configuration
type VUMeter struct {
	Width      int
	GreenZone  float64 // Percentage where green ends (0.0-1.0)
	YellowZone float64 // Percentage where yellow ends (0.0-1.0)
	Theme      *theme.Theme
}

// NewVUMeter creates a new VU meter with default settings
func NewVUMeter(t *theme.Theme, width int) *VUMeter {
	return &VUMeter{
		Width:      width,
		GreenZone:  0.6,
		YellowZone: 0.8,
		Theme:      t,
	}
}

// Render renders the VU meter at the specified level (0.0-1.0)
func (v *VUMeter) Render(level float64) string {
	if level < 0 {
		level = 0
	}
	if level > 1 {
		level = 1
	}

	filled := int(level * float64(v.Width))
	if filled > v.Width {
		filled = v.Width
	}

	successStyle := lipgloss.NewStyle().Foreground(v.Theme.Success)
	warningStyle := lipgloss.NewStyle().Foreground(v.Theme.Warning)
	errorStyle := lipgloss.NewStyle().Foreground(v.Theme.Error)
	textDim := lipgloss.NewStyle().Foreground(v.Theme.TextDim)

	var sb strings.Builder
	greenEnd := int(v.GreenZone * float64(v.Width))
	yellowEnd := int(v.YellowZone * float64(v.Width))

	for i := 0; i < v.Width; i++ {
		if i < filled {
			if i < greenEnd {
				sb.WriteString(successStyle.Render("█"))
			} else if i < yellowEnd {
				sb.WriteString(warningStyle.Render("█"))
			} else {
				sb.WriteString(errorStyle.Render("█"))
			}
		} else {
			sb.WriteString(textDim.Render("░"))
		}
	}
	return sb.String()
}

// RenderVertical renders a vertical VU meter
func (v *VUMeter) RenderVertical(level float64, height int) []string {
	if level < 0 {
		level = 0
	}
	if level > 1 {
		level = 1
	}

	filled := int(level * float64(height))

	successStyle := lipgloss.NewStyle().Foreground(v.Theme.Success)
	warningStyle := lipgloss.NewStyle().Foreground(v.Theme.Warning)
	errorStyle := lipgloss.NewStyle().Foreground(v.Theme.Error)
	textDim := lipgloss.NewStyle().Foreground(v.Theme.TextDim)

	greenEnd := int(v.GreenZone * float64(height))
	yellowEnd := int(v.YellowZone * float64(height))

	lines := make([]string, height)
	for i := 0; i < height; i++ {
		row := height - 1 - i // Invert for bottom-up rendering
		if row < filled {
			if row < greenEnd {
				lines[i] = successStyle.Render("█")
			} else if row < yellowEnd {
				lines[i] = warningStyle.Render("█")
			} else {
				lines[i] = errorStyle.Render("█")
			}
		} else {
			lines[i] = textDim.Render("░")
		}
	}
	return lines
}

// RenderStereo renders a stereo pair of VU meters
func RenderStereoVU(t *theme.Theme, left, right float64, width int) string {
	vu := NewVUMeter(t, width)
	textDim := lipgloss.NewStyle().Foreground(t.TextDim)

	return textDim.Render("L ") + vu.Render(left) + textDim.Render("  R ") + vu.Render(right)
}

// SignalMeter represents a signal strength meter
type SignalMeter struct {
	Bars   int
	Theme  *theme.Theme
}

// NewSignalMeter creates a new signal meter
func NewSignalMeter(t *theme.Theme, bars int) *SignalMeter {
	return &SignalMeter{
		Bars:  bars,
		Theme: t,
	}
}

// Render renders signal bars based on RSSI value
// RSSI typically ranges from -30 (very strong) to -120 (weak)
func (s *SignalMeter) Render(rssi float64) string {
	var bars int
	if rssi > -3 {
		bars = 5
	} else if rssi > -6 {
		bars = 4
	} else if rssi > -12 {
		bars = 3
	} else if rssi > -18 {
		bars = 2
	} else if rssi > -24 {
		bars = 1
	} else {
		bars = 0
	}

	if bars > s.Bars {
		bars = s.Bars
	}

	successStyle := lipgloss.NewStyle().Foreground(s.Theme.Success)
	warningStyle := lipgloss.NewStyle().Foreground(s.Theme.Warning)
	errorStyle := lipgloss.NewStyle().Foreground(s.Theme.Error)
	textDim := lipgloss.NewStyle().Foreground(s.Theme.TextDim)

	var sb strings.Builder
	for i := 0; i < s.Bars; i++ {
		if i < bars {
			if bars >= 4 {
				sb.WriteString(successStyle.Render("▆"))
			} else if bars >= 2 {
				sb.WriteString(warningStyle.Render("▆"))
			} else {
				sb.WriteString(errorStyle.Render("▆"))
			}
		} else {
			sb.WriteString(textDim.Render("▁"))
		}
	}
	return sb.String()
}

// RenderFromLevel renders signal bars based on a 0.0-1.0 level
func (s *SignalMeter) RenderFromLevel(level float64) string {
	if level < 0 {
		level = 0
	}
	if level > 1 {
		level = 1
	}

	bars := int(level * float64(s.Bars))

	successStyle := lipgloss.NewStyle().Foreground(s.Theme.Success)
	warningStyle := lipgloss.NewStyle().Foreground(s.Theme.Warning)
	errorStyle := lipgloss.NewStyle().Foreground(s.Theme.Error)
	textDim := lipgloss.NewStyle().Foreground(s.Theme.TextDim)

	threshold := int(0.6 * float64(s.Bars))
	warningThreshold := int(0.4 * float64(s.Bars))

	var sb strings.Builder
	for i := 0; i < s.Bars; i++ {
		if i < bars {
			if bars >= threshold {
				sb.WriteString(successStyle.Render("▆"))
			} else if bars >= warningThreshold {
				sb.WriteString(warningStyle.Render("▆"))
			} else {
				sb.WriteString(errorStyle.Render("▆"))
			}
		} else {
			sb.WriteString(textDim.Render("▁"))
		}
	}
	return sb.String()
}
