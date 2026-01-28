// Package ui provides reusable UI components for SkySpy applications
package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/skyspy/skyspy-go/internal/theme"
)

// Spectrum represents a frequency spectrum analyzer display
type Spectrum struct {
	Width  int
	Height int
	Theme  *theme.Theme
	Data   []float64
}

// NewSpectrum creates a new spectrum display
func NewSpectrum(t *theme.Theme, width, height int) *Spectrum {
	return &Spectrum{
		Width:  width,
		Height: height,
		Theme:  t,
		Data:   make([]float64, width),
	}
}

// Update updates spectrum data with decay
func (s *Spectrum) Update(values []float64, decay float64) {
	for i := 0; i < s.Width && i < len(values); i++ {
		target := values[i]
		if target > 1.0 {
			target = 1.0
		}
		if target < 0 {
			target = 0
		}
		s.Data[i] = s.Data[i]*decay + target*(1-decay)
	}
}

// SetValue sets a single column value
func (s *Spectrum) SetValue(index int, value float64) {
	if index >= 0 && index < len(s.Data) {
		if value > 1.0 {
			value = 1.0
		}
		if value < 0 {
			value = 0
		}
		s.Data[index] = value
	}
}

// Render renders the spectrum display as multiple lines
func (s *Spectrum) Render() []string {
	successStyle := lipgloss.NewStyle().Foreground(s.Theme.Success)
	warningStyle := lipgloss.NewStyle().Foreground(s.Theme.Warning)
	errorStyle := lipgloss.NewStyle().Foreground(s.Theme.Error)
	textDim := lipgloss.NewStyle().Foreground(s.Theme.TextDim)

	lines := make([]string, s.Height)

	for row := 0; row < s.Height; row++ {
		var sb strings.Builder
		threshold := float64(s.Height-row) / float64(s.Height)

		for col := 0; col < s.Width; col++ {
			value := 0.0
			if col < len(s.Data) {
				value = s.Data[col]
			}

			if value >= threshold {
				// Color based on height (top = red, middle = yellow, bottom = green)
				if row < s.Height/3 {
					sb.WriteString(errorStyle.Render("█"))
				} else if row < 2*s.Height/3 {
					sb.WriteString(warningStyle.Render("█"))
				} else {
					sb.WriteString(successStyle.Render("█"))
				}
			} else {
				sb.WriteString(textDim.Render("░"))
			}
		}
		lines[row] = sb.String()
	}

	return lines
}

// RenderCompact renders a single-line compact spectrum
func (s *Spectrum) RenderCompact() string {
	successStyle := lipgloss.NewStyle().Foreground(s.Theme.Success)
	warningStyle := lipgloss.NewStyle().Foreground(s.Theme.Warning)
	errorStyle := lipgloss.NewStyle().Foreground(s.Theme.Error)
	textDim := lipgloss.NewStyle().Foreground(s.Theme.TextDim)

	var sb strings.Builder
	for i := 0; i < s.Width; i++ {
		value := 0.0
		if i < len(s.Data) {
			value = s.Data[i]
		}

		if value > 0.8 {
			sb.WriteString(errorStyle.Render("█"))
		} else if value > 0.5 {
			sb.WriteString(warningStyle.Render("▄"))
		} else if value > 0.2 {
			sb.WriteString(successStyle.Render("▁"))
		} else {
			sb.WriteString(textDim.Render("▁"))
		}
	}
	return sb.String()
}

// Waterfall represents a scrolling waterfall/spectrogram display
type Waterfall struct {
	Width   int
	Height  int
	Theme   *theme.Theme
	History [][]float64
}

// NewWaterfall creates a new waterfall display
func NewWaterfall(t *theme.Theme, width, height int) *Waterfall {
	history := make([][]float64, height)
	for i := range history {
		history[i] = make([]float64, width)
	}
	return &Waterfall{
		Width:   width,
		Height:  height,
		Theme:   t,
		History: history,
	}
}

// Push adds a new spectrum line and scrolls history
func (w *Waterfall) Push(values []float64) {
	// Scroll history up
	for i := 0; i < len(w.History)-1; i++ {
		w.History[i] = w.History[i+1]
	}

	// Add new line at bottom
	newLine := make([]float64, w.Width)
	for i := 0; i < w.Width && i < len(values); i++ {
		newLine[i] = values[i]
	}
	w.History[len(w.History)-1] = newLine
}

// Render renders the waterfall display
func (w *Waterfall) Render() []string {
	lines := make([]string, w.Height)

	// Define intensity levels with colors
	colors := []lipgloss.Color{
		w.Theme.TextDim,
		w.Theme.Primary,
		w.Theme.Secondary,
		w.Theme.Info,
		w.Theme.Success,
		w.Theme.Warning,
		w.Theme.Error,
		w.Theme.PrimaryBright,
	}

	for row := 0; row < w.Height; row++ {
		var sb strings.Builder
		data := w.History[row]

		for col := 0; col < w.Width; col++ {
			value := 0.0
			if col < len(data) {
				value = data[col]
			}

			// Map value to color index
			colorIdx := int(value * float64(len(colors)-1))
			if colorIdx < 0 {
				colorIdx = 0
			}
			if colorIdx >= len(colors) {
				colorIdx = len(colors) - 1
			}

			style := lipgloss.NewStyle().Foreground(colors[colorIdx])

			// Use different characters based on intensity
			char := " "
			if value > 0.1 {
				char = "░"
			}
			if value > 0.3 {
				char = "▒"
			}
			if value > 0.6 {
				char = "▓"
			}
			if value > 0.8 {
				char = "█"
			}

			sb.WriteString(style.Render(char))
		}
		lines[row] = sb.String()
	}

	return lines
}

// FrequencyDisplay represents a frequency scanning display
type FrequencyDisplay struct {
	Theme       *theme.Theme
	Frequencies []FrequencyInfo
	CurrentIdx  int
	ScanPos     int
}

// FrequencyInfo contains information about a frequency
type FrequencyInfo struct {
	Freq   string
	Label  string
	Active bool
}

// NewFrequencyDisplay creates a new frequency display
func NewFrequencyDisplay(t *theme.Theme) *FrequencyDisplay {
	return &FrequencyDisplay{
		Theme: t,
		Frequencies: []FrequencyInfo{
			{Freq: "1090.000", Label: "ADS-B", Active: true},
			{Freq: "136.900", Label: "ACARS", Active: true},
			{Freq: "136.725", Label: "VDL2", Active: true},
			{Freq: "121.500", Label: "GUARD", Active: false},
		},
		CurrentIdx: 0,
		ScanPos:    0,
	}
}

// SetFrequencies sets the frequency list
func (f *FrequencyDisplay) SetFrequencies(freqs []FrequencyInfo) {
	f.Frequencies = freqs
}

// Advance advances the scan position
func (f *FrequencyDisplay) Advance() {
	if len(f.Frequencies) > 0 {
		f.ScanPos = (f.ScanPos + 1) % (len(f.Frequencies) * 10)
		f.CurrentIdx = f.ScanPos / 10
	}
}

// Render renders the frequency scanning display
func (f *FrequencyDisplay) Render() string {
	successStyle := lipgloss.NewStyle().Foreground(f.Theme.Success)
	infoStyle := lipgloss.NewStyle().Foreground(f.Theme.Info)
	secondaryBright := lipgloss.NewStyle().Foreground(f.Theme.SecondaryBright)
	errorStyle := lipgloss.NewStyle().Foreground(f.Theme.Error)
	textDim := lipgloss.NewStyle().Foreground(f.Theme.TextDim)
	selectedStyle := lipgloss.NewStyle().Foreground(f.Theme.PrimaryBright).Bold(true)

	var sb strings.Builder
	sb.WriteString(textDim.Render("SCAN: "))

	for i, freq := range f.Frequencies {
		var style lipgloss.Style
		switch freq.Label {
		case "ADS-B":
			style = successStyle
		case "ACARS":
			style = infoStyle
		case "VDL2":
			style = secondaryBright
		case "GUARD":
			style = errorStyle
		default:
			style = textDim
		}

		if i == f.CurrentIdx {
			sb.WriteString(selectedStyle.Render(">" + freq.Freq + "<"))
		} else {
			sb.WriteString(style.Render(" " + freq.Freq + " "))
		}

		if i < len(f.Frequencies)-1 {
			sb.WriteString(textDim.Render("|"))
		}
	}

	return sb.String()
}

// RenderList renders frequencies as a vertical list
func (f *FrequencyDisplay) RenderList(blink bool) []string {
	successStyle := lipgloss.NewStyle().Foreground(f.Theme.Success)
	infoStyle := lipgloss.NewStyle().Foreground(f.Theme.Info)
	secondaryBright := lipgloss.NewStyle().Foreground(f.Theme.SecondaryBright)
	errorStyle := lipgloss.NewStyle().Foreground(f.Theme.Error)
	textDim := lipgloss.NewStyle().Foreground(f.Theme.TextDim)

	lines := make([]string, len(f.Frequencies))
	for i, freq := range f.Frequencies {
		var style lipgloss.Style
		switch freq.Label {
		case "ADS-B":
			style = successStyle
		case "ACARS":
			style = infoStyle
		case "VDL2":
			style = secondaryBright
		case "GUARD":
			style = errorStyle
		default:
			style = textDim
		}

		indicator := "○"
		indStyle := textDim
		if freq.Active && blink {
			indicator = "●"
			indStyle = style
		}

		lines[i] = "  " + indStyle.Render(indicator) + " " + style.Render(freq.Freq+" MHz") + " " + textDim.Render("["+freq.Label+"]")
	}

	return lines
}
