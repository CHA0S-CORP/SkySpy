// Package radio provides radio monitor display functionality for SkySpy
package radio

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/skyspy/skyspy-go/internal/ui"
)

// View renders the radio display
func (m *Model) View() string {
	if m.Mode == ModePro {
		return m.viewPro()
	}
	return m.viewBasic()
}

// viewBasic renders the basic radio display
func (m *Model) viewBasic() string {
	var sb strings.Builder

	// Header
	sb.WriteString(m.renderHeader())
	sb.WriteString("\n")

	// Aircraft table
	sb.WriteString(m.renderAircraftTable())
	sb.WriteString("\n")

	// ACARS panel
	sb.WriteString(m.renderACARSPanel())
	sb.WriteString("\n")

	// Stats bar
	sb.WriteString(m.renderStatsBar())
	sb.WriteString("\n")

	// Frequency display
	sb.WriteString(m.renderFrequencyLine())

	return sb.String()
}

// viewPro renders the pro radio display with additional features
func (m *Model) viewPro() string {
	var sb strings.Builder

	// Animated header
	sb.WriteString(m.renderProHeader())
	sb.WriteString("\n")

	// Main content layout - aircraft table with sidebar
	mainContent := m.renderAircraftDisplay()
	sidebar := m.renderProSidebar()

	// Side by side layout
	mainLines := strings.Split(mainContent, "\n")
	sidebarLines := strings.Split(sidebar, "\n")

	maxLines := len(mainLines)
	if len(sidebarLines) > maxLines {
		maxLines = len(sidebarLines)
	}

	for i := 0; i < maxLines; i++ {
		mainLine := ""
		if i < len(mainLines) {
			mainLine = mainLines[i]
		}
		sidebarLine := ""
		if i < len(sidebarLines) {
			sidebarLine = sidebarLines[i]
		}
		sb.WriteString(mainLine)
		sb.WriteString("  ")
		sb.WriteString(sidebarLine)
		sb.WriteString("\n")
	}

	// ACARS panel
	sb.WriteString(m.renderACARSPanel())
	sb.WriteString("\n")

	// Footer with scan display
	sb.WriteString(m.renderProFooter())

	return sb.String()
}

func (m *Model) renderHeader() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.Theme.Border)
	primaryBright := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright).Bold(true).Reverse(true)
	secondaryBright := lipgloss.NewStyle().Foreground(m.Theme.SecondaryBright)
	infoStyle := lipgloss.NewStyle().Foreground(m.Theme.Info)
	textDim := lipgloss.NewStyle().Foreground(m.Theme.TextDim)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render(" " + strings.Repeat("═", 69)))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render(" "))
	sb.WriteString(textDim.Render("░░ "))
	sb.WriteString(primaryBright.Render(" SKYSPY RADIO "))
	sb.WriteString(textDim.Render(" ░░"))
	sb.WriteString(borderStyle.Render(" ── "))
	sb.WriteString(secondaryBright.Render("ADS-B / ACARS MONITOR"))
	sb.WriteString(borderStyle.Render(" ── "))

	spin := m.Spinners[m.Frame%4]
	sb.WriteString(infoStyle.Render(spin + " "))
	sb.WriteString(infoStyle.Bold(true).Render("LIVE"))
	sb.WriteString(infoStyle.Render(" " + spin))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render(" " + strings.Repeat("═", 69)))

	return sb.String()
}

func (m *Model) renderProHeader() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright)
	primaryBright := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright).Bold(true).Reverse(true)
	textDim := lipgloss.NewStyle().Foreground(m.Theme.TextDim)
	infoStyle := lipgloss.NewStyle().Foreground(m.Theme.Info)
	secondaryBright := lipgloss.NewStyle().Foreground(m.Theme.SecondaryBright)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╔" + strings.Repeat("═", 80) + "╗"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("║ "))
	sb.WriteString(textDim.Render("░░░"))
	sb.WriteString(primaryBright.Render(" SKYSPY RADIO PRO "))
	sb.WriteString(textDim.Render("░░░"))
	sb.WriteString(borderStyle.Render(" ── ADS-B & ACARS MONITOR ── "))

	// Animated indicator
	indicators := []string{"◐", "◓", "◑", "◒"}
	sb.WriteString(infoStyle.Render(indicators[m.Frame%4]))
	sb.WriteString(infoStyle.Bold(true).Render(" LIVE "))
	sb.WriteString(infoStyle.Render(indicators[(m.Frame+2)%4]))

	sb.WriteString(textDim.Render(" ░░░ "))
	sb.WriteString(secondaryBright.Render(time.Now().Format("15:04:05")))
	sb.WriteString(" ")
	sb.WriteString(borderStyle.Render("║"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("╠" + strings.Repeat("═", 80) + "╣"))

	return sb.String()
}

func (m *Model) renderAircraftTable() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.Theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright).Bold(true)
	headerStyle := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright).Bold(true)
	textDim := lipgloss.NewStyle().Foreground(m.Theme.TextDim)
	secondaryBright := lipgloss.NewStyle().Foreground(m.Theme.SecondaryBright)
	primaryBright := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright)
	militaryStyle := lipgloss.NewStyle().Foreground(m.Theme.Military).Bold(true)
	emergencyStyle := lipgloss.NewStyle().Foreground(m.Theme.Emergency).Bold(true)

	var sb strings.Builder

	// Title
	sb.WriteString(borderStyle.Render("╭─"))
	sb.WriteString(titleStyle.Render("◄ LIVE AIRCRAFT TRACKING ►"))
	sb.WriteString(borderStyle.Render("────────────────────────────────────────╮"))
	sb.WriteString("\n")

	// Header row
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString(headerStyle.Render("  ICAO   CALL      ALT    SPD  HDG   DIST   SQ    SIG   TYPE"))
	sb.WriteString(strings.Repeat(" ", 8))
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("├" + strings.Repeat("─", 69) + "┤"))
	sb.WriteString("\n")

	// Aircraft rows
	count := 0
	maxRows := 15
	for _, hex := range m.SortedHexes {
		if count >= maxRows {
			break
		}
		ac, exists := m.Aircraft[hex]
		if !exists {
			continue
		}

		sb.WriteString(borderStyle.Render("│"))

		// ICAO
		icaoStyle := secondaryBright
		if ac.Military {
			icaoStyle = militaryStyle
		}
		sb.WriteString(icaoStyle.Render(fmt.Sprintf("  %-6s ", strings.ToUpper(ac.Hex))))

		// Callsign
		cs := ac.Callsign
		if cs == "" {
			cs = "-------"
		}
		if len(cs) > 8 {
			cs = cs[:8]
		}
		sb.WriteString(primaryBright.Render(fmt.Sprintf("%-8s ", cs)))

		// Altitude
		alt := "----"
		if ac.HasAlt {
			if ac.Altitude >= 18000 {
				alt = fmt.Sprintf("FL%03d", ac.Altitude/100)
			} else {
				alt = fmt.Sprintf("%5d", ac.Altitude)
			}
		}
		sb.WriteString(primaryBright.Render(fmt.Sprintf("%6s ", alt)))

		// Speed
		spd := "---"
		if ac.HasSpeed {
			spd = fmt.Sprintf("%3d", int(ac.Speed))
		}
		sb.WriteString(primaryBright.Render(fmt.Sprintf("%4skt", spd)))

		// Heading
		hdg := "---"
		if ac.HasTrack {
			hdg = fmt.Sprintf("%03d", int(ac.Track))
		}
		sb.WriteString(textDim.Render(fmt.Sprintf(" %3s ", hdg)))

		// Distance
		dist := "---"
		if ac.Distance > 0 {
			dist = fmt.Sprintf("%.1f", ac.Distance)
		}
		sb.WriteString(secondaryBright.Render(fmt.Sprintf("%5snm ", dist)))

		// Squawk
		sq := ac.Squawk
		if sq == "" {
			sq = "----"
		}
		sqStyle := primaryBright
		if ac.IsEmergency() {
			sqStyle = emergencyStyle
		}
		sb.WriteString(sqStyle.Render(fmt.Sprintf("%4s ", sq)))

		// Signal
		sig := m.renderSignalBars(ac)
		sb.WriteString(sig + " ")

		// Type
		acType := ac.ACType
		if acType == "" {
			acType = "----"
		}
		if len(acType) > 4 {
			acType = acType[:4]
		}
		sb.WriteString(textDim.Render(fmt.Sprintf("%-4s", acType)))

		sb.WriteString(borderStyle.Render("│"))
		sb.WriteString("\n")
		count++
	}

	// Fill remaining rows
	for count < maxRows {
		sb.WriteString(borderStyle.Render("│"))
		sb.WriteString(textDim.Render(strings.Repeat(" ", 69)))
		sb.WriteString(borderStyle.Render("│"))
		sb.WriteString("\n")
		count++
	}

	// Footer
	sb.WriteString(borderStyle.Render("╰"))
	sb.WriteString(borderStyle.Render(strings.Repeat("─", 25)))
	sb.WriteString(textDim.Render(fmt.Sprintf(" %d aircraft ", len(m.Aircraft))))
	sb.WriteString(borderStyle.Render(strings.Repeat("─", 30)))
	sb.WriteString(borderStyle.Render("╯"))

	return sb.String()
}

func (m *Model) renderAircraftDisplay() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.Theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright).Bold(true)
	headerStyle := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright).Bold(true).Reverse(true)
	textDim := lipgloss.NewStyle().Foreground(m.Theme.TextDim)
	secondaryBright := lipgloss.NewStyle().Foreground(m.Theme.SecondaryBright)
	primaryBright := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright)
	militaryStyle := lipgloss.NewStyle().Foreground(m.Theme.Military).Bold(true)
	emergencyStyle := lipgloss.NewStyle().Foreground(m.Theme.Emergency).Bold(true)
	successStyle := lipgloss.NewStyle().Foreground(m.Theme.Success)
	errorStyle := lipgloss.NewStyle().Foreground(m.Theme.Error)

	var sb strings.Builder

	// Title
	sb.WriteString(borderStyle.Render("╔══"))
	sb.WriteString(titleStyle.Render("◄◄ LIVE TRAFFIC ►►"))
	sb.WriteString(borderStyle.Render("══════════════════════════════════╗"))
	sb.WriteString("\n")

	// Header row
	sb.WriteString(borderStyle.Render("║"))
	sb.WriteString(headerStyle.Render(" ■ ICAO   CALLSIGN TYPE   ALT    GS    VS   HDG DST   SIG   SQ  "))
	sb.WriteString(borderStyle.Render("║"))
	sb.WriteString("\n")

	// Aircraft rows
	count := 0
	maxRows := 12
	for _, hex := range m.SortedHexes {
		if count >= maxRows {
			break
		}
		ac, exists := m.Aircraft[hex]
		if !exists {
			continue
		}

		sb.WriteString(borderStyle.Render("║"))

		// Status indicator
		if ac.Military {
			sb.WriteString(militaryStyle.Render(" ◆ "))
		} else if ac.IsEmergency() {
			if m.Blink {
				sb.WriteString(emergencyStyle.Render(" ! "))
			} else {
				sb.WriteString(emergencyStyle.Render(" ✖ "))
			}
		} else {
			ind := "●"
			if !m.Blink {
				ind = "○"
			}
			sb.WriteString(successStyle.Render(" " + ind + " "))
		}

		// ICAO
		icaoStyle := secondaryBright
		if ac.Military {
			icaoStyle = militaryStyle
		}
		sb.WriteString(icaoStyle.Render(fmt.Sprintf("%-6s ", strings.ToUpper(ac.Hex))))

		// Callsign
		cs := ac.Callsign
		if cs == "" {
			cs = "--------"
		}
		if len(cs) > 8 {
			cs = cs[:8]
		}
		sb.WriteString(primaryBright.Render(fmt.Sprintf("%-8s ", cs)))

		// Type
		acType := ac.ACType
		if acType == "" {
			acType = "----"
		}
		if len(acType) > 4 {
			acType = acType[:4]
		}
		sb.WriteString(textDim.Render(fmt.Sprintf("%-4s ", acType)))

		// Altitude
		alt := "----"
		if ac.HasAlt {
			if ac.Altitude >= 18000 {
				alt = fmt.Sprintf("FL%03d", ac.Altitude/100)
			} else {
				alt = fmt.Sprintf("%5d", ac.Altitude)
			}
		}
		sb.WriteString(primaryBright.Render(fmt.Sprintf("%6s ", alt)))

		// Speed
		spd := "---"
		if ac.HasSpeed {
			spd = fmt.Sprintf("%3d", int(ac.Speed))
		}
		sb.WriteString(textDim.Render(fmt.Sprintf("%4s ", spd)))

		// Vertical Speed
		vs := "---"
		vsStyle := textDim
		if ac.HasVS {
			if ac.Vertical > 0 {
				vs = fmt.Sprintf("+%d", int(ac.Vertical))
				vsStyle = successStyle
			} else if ac.Vertical < 0 {
				vs = fmt.Sprintf("%d", int(ac.Vertical))
				vsStyle = errorStyle
			} else {
				vs = "0"
			}
		}
		sb.WriteString(vsStyle.Render(fmt.Sprintf("%5s ", vs)))

		// Heading
		hdg := "---"
		if ac.HasTrack {
			hdg = getCompass(ac.Track)
		}
		sb.WriteString(textDim.Render(fmt.Sprintf("%-3s ", hdg)))

		// Distance
		dist := "---"
		if ac.Distance > 0 {
			dist = fmt.Sprintf("%.1f", ac.Distance)
		}
		sb.WriteString(secondaryBright.Render(fmt.Sprintf("%5s ", dist)))

		// Signal
		sig := m.renderSignalBars(ac)
		sb.WriteString(sig + " ")

		// Squawk
		sq := ac.Squawk
		if sq == "" {
			sq = "----"
		}
		sqStyle := primaryBright
		if ac.IsEmergency() {
			sqStyle = emergencyStyle
		}
		sb.WriteString(sqStyle.Render(fmt.Sprintf("%4s", sq)))

		sb.WriteString(borderStyle.Render("║"))
		sb.WriteString("\n")
		count++
	}

	// Fill remaining rows
	for count < maxRows {
		sb.WriteString(borderStyle.Render("║"))
		sb.WriteString(textDim.Render(strings.Repeat(" ", 66)))
		sb.WriteString(borderStyle.Render("║"))
		sb.WriteString("\n")
		count++
	}

	// Footer
	sb.WriteString(borderStyle.Render("╚"))
	sb.WriteString(borderStyle.Render(strings.Repeat("═", 20)))
	sb.WriteString(textDim.Render(fmt.Sprintf(" %d aircraft tracked ", len(m.Aircraft))))
	sb.WriteString(borderStyle.Render(strings.Repeat("═", 22)))
	sb.WriteString(borderStyle.Render("╝"))

	return sb.String()
}

func (m *Model) renderProSidebar() string {
	var sb strings.Builder

	// Status panel
	sb.WriteString(m.renderStatusPanel())
	sb.WriteString("\n")

	// Frequency panel
	sb.WriteString(m.renderFrequencyPanel())

	return sb.String()
}

func (m *Model) renderStatusPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.Theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright)
	textDim := lipgloss.NewStyle().Foreground(m.Theme.TextDim)
	successStyle := lipgloss.NewStyle().Foreground(m.Theme.Success)
	errorStyle := lipgloss.NewStyle().Foreground(m.Theme.Error)
	secondaryBright := lipgloss.NewStyle().Foreground(m.Theme.SecondaryBright)
	warningStyle := lipgloss.NewStyle().Foreground(m.Theme.Warning)
	infoStyle := lipgloss.NewStyle().Foreground(m.Theme.Info)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╭─"))
	sb.WriteString(titleStyle.Render("STATUS"))
	sb.WriteString(borderStyle.Render("─────────────────╮"))
	sb.WriteString("\n")

	// Connection status
	sb.WriteString(borderStyle.Render("│"))
	if m.Connected {
		ind := "◉"
		if !m.Blink {
			ind = "○"
		}
		sb.WriteString(successStyle.Render("  " + ind + " "))
		sb.WriteString(successStyle.Bold(true).Render("RECEIVING"))
		sb.WriteString(strings.Repeat(" ", 9))
	} else {
		sb.WriteString(errorStyle.Render("  ○ "))
		sb.WriteString(errorStyle.Bold(true).Render("SCANNING"))
		sb.WriteString(strings.Repeat(" ", 10))
	}
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString("\n")

	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString(strings.Repeat(" ", 24))
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString("\n")

	// Stats
	stats := []struct {
		label string
		value string
		style lipgloss.Style
	}{
		{"TARGETS", fmt.Sprintf("%3d", len(m.Aircraft)), secondaryBright},
		{"PEAK", fmt.Sprintf("%3d", m.PeakAircraft), warningStyle},
		{"MSGS", fmt.Sprintf("%d", m.TotalMessages), infoStyle},
		{"UPTIME", m.GetUptime(), successStyle},
	}

	for _, stat := range stats {
		sb.WriteString(borderStyle.Render("│"))
		sb.WriteString(textDim.Render(fmt.Sprintf("  %-7s ", stat.label)))
		sb.WriteString(stat.style.Render(fmt.Sprintf("%-13s", stat.value)))
		sb.WriteString(borderStyle.Render("│"))
		sb.WriteString("\n")
	}

	// VU Meters
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString(strings.Repeat(" ", 24))
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString("\n")

	vu := ui.NewVUMeter(m.Theme, 10)
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString(textDim.Render("  VU L "))
	sb.WriteString(vu.Render(m.VULeft))
	sb.WriteString(strings.Repeat(" ", 6))
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString("\n")

	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString(textDim.Render("  VU R "))
	sb.WriteString(vu.Render(m.VURight))
	sb.WriteString(strings.Repeat(" ", 6))
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString("\n")

	sb.WriteString(borderStyle.Render("╰" + strings.Repeat("─", 24) + "╯"))

	return sb.String()
}

func (m *Model) renderFrequencyPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.Theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright)
	textDim := lipgloss.NewStyle().Foreground(m.Theme.TextDim)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╭─"))
	sb.WriteString(titleStyle.Render("FREQUENCIES"))
	sb.WriteString(borderStyle.Render("────────────╮"))
	sb.WriteString("\n")

	// Frequency list
	freqLines := m.FreqDisp.RenderList(m.Blink)
	for _, line := range freqLines {
		sb.WriteString(borderStyle.Render("│"))
		// Pad line to fit panel width
		lineWidth := lipgloss.Width(line)
		padding := 24 - lineWidth
		if padding < 0 {
			padding = 0
		}
		sb.WriteString(line)
		sb.WriteString(strings.Repeat(" ", padding))
		sb.WriteString(borderStyle.Render("│"))
		sb.WriteString("\n")
	}

	// Mini spectrum
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString(textDim.Render("  "))
	compact := m.Spectrum.RenderCompact()
	if lipgloss.Width(compact) > 20 {
		compact = compact[:20]
	}
	sb.WriteString(compact)
	sb.WriteString(strings.Repeat(" ", 22-lipgloss.Width(compact)))
	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString("\n")

	sb.WriteString(borderStyle.Render("╰" + strings.Repeat("─", 24) + "╯"))

	return sb.String()
}

func (m *Model) renderACARSPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.Theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.Theme.Info).Bold(true)
	textDim := lipgloss.NewStyle().Foreground(m.Theme.TextDim)
	secondaryBright := lipgloss.NewStyle().Foreground(m.Theme.SecondaryBright)
	primaryStyle := lipgloss.NewStyle().Foreground(m.Theme.Primary)
	infoStyle := lipgloss.NewStyle().Foreground(m.Theme.Info)

	var sb strings.Builder

	width := 69
	if m.Mode == ModePro {
		width = 92
	}

	sb.WriteString(borderStyle.Render("╭─"))
	sb.WriteString(titleStyle.Render("◄ ACARS/VDL2 FEED ►"))
	sb.WriteString(borderStyle.Render(strings.Repeat("─", width-22) + "╮"))
	sb.WriteString("\n")

	// Show last 6 messages (8 for pro)
	maxMessages := 6
	if m.Mode == ModePro {
		maxMessages = 8
	}

	start := len(m.ACARSMessages) - maxMessages
	if start < 0 {
		start = 0
	}

	count := 0
	for i := start; i < len(m.ACARSMessages); i++ {
		msg := m.ACARSMessages[i]

		sb.WriteString(borderStyle.Render("│"))

		// Timestamp
		ts := msg.Timestamp
		if ts == "" {
			ts = "--:--:--"
		}
		sb.WriteString(textDim.Render(" [" + ts + "] "))

		// Source
		src := msg.Source
		if src == "" {
			src = "ACARS"
		}
		if len(src) > 4 {
			src = src[:4]
		}
		sb.WriteString(infoStyle.Render(fmt.Sprintf("[%-4s] ", src)))

		// Callsign
		cs := msg.Callsign
		if cs == "" {
			cs = msg.Flight
		}
		if cs == "" {
			cs = "-------"
		}
		if len(cs) > 7 {
			cs = cs[:7]
		}
		sb.WriteString(secondaryBright.Render(fmt.Sprintf("%-7s ", cs)))

		// Label
		label := msg.Label
		if label == "" {
			label = "--"
		}
		if len(label) > 2 {
			label = label[:2]
		}
		sb.WriteString(primaryStyle.Render(fmt.Sprintf("L:%-2s ", label)))

		// Text
		text := msg.Text
		maxText := width - 42
		if len(text) > maxText {
			text = text[:maxText]
		}
		sb.WriteString(textDim.Render(text))

		// Padding
		lineLen := 42 + len(text)
		if lineLen < width {
			sb.WriteString(strings.Repeat(" ", width-lineLen))
		}

		sb.WriteString(borderStyle.Render("│"))
		sb.WriteString("\n")
		count++
	}

	// Fill remaining rows if needed
	for count < maxMessages {
		sb.WriteString(borderStyle.Render("│"))
		if count == 0 {
			sb.WriteString(textDim.Render("  Waiting for ACARS messages..."))
			sb.WriteString(strings.Repeat(" ", width-32))
		} else {
			sb.WriteString(strings.Repeat(" ", width))
		}
		sb.WriteString(borderStyle.Render("│"))
		sb.WriteString("\n")
		count++
	}

	sb.WriteString(borderStyle.Render("╰" + strings.Repeat("─", width) + "╯"))

	return sb.String()
}

func (m *Model) renderStatsBar() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.Theme.Border)
	textDim := lipgloss.NewStyle().Foreground(m.Theme.TextDim)
	successStyle := lipgloss.NewStyle().Foreground(m.Theme.Success).Bold(true)
	errorStyle := lipgloss.NewStyle().Foreground(m.Theme.Error).Bold(true)
	secondaryBright := lipgloss.NewStyle().Foreground(m.Theme.SecondaryBright)
	militaryStyle := lipgloss.NewStyle().Foreground(m.Theme.Military)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╭" + strings.Repeat("─", 69) + "╮"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("│ "))

	// Connection status
	if m.Connected {
		ind := "◉"
		if !m.Blink {
			ind = "○"
		}
		sb.WriteString(successStyle.Render(ind + " CONNECTED"))
	} else {
		sb.WriteString(errorStyle.Render("○ DISCONNECTED"))
	}

	sb.WriteString(textDim.Render("  │  "))

	// Aircraft count
	sb.WriteString(textDim.Render("AIRCRAFT: "))
	sb.WriteString(successStyle.Render(fmt.Sprintf("%3d", len(m.Aircraft))))

	milCount := m.GetMilitaryCount()
	if milCount > 0 {
		sb.WriteString(militaryStyle.Render(fmt.Sprintf(" (MIL:%d)", milCount)))
	}

	sb.WriteString(textDim.Render("  │  "))

	// Messages
	sb.WriteString(textDim.Render("MSGS: "))
	sb.WriteString(secondaryBright.Render(fmt.Sprintf("%d", m.TotalMessages)))

	sb.WriteString(textDim.Render("  │  "))

	// Time
	sb.WriteString(textDim.Render("UTC: "))
	sb.WriteString(secondaryBright.Render(time.Now().Format("15:04:05")))

	// Padding
	remaining := 68 - lipgloss.Width(sb.String()) + 3
	if remaining > 0 {
		sb.WriteString(strings.Repeat(" ", remaining))
	}

	sb.WriteString(borderStyle.Render("│"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("╰" + strings.Repeat("─", 69) + "╯"))

	return sb.String()
}

func (m *Model) renderFrequencyLine() string {
	textDim := lipgloss.NewStyle().Foreground(m.Theme.TextDim)
	successStyle := lipgloss.NewStyle().Foreground(m.Theme.Success)
	infoStyle := lipgloss.NewStyle().Foreground(m.Theme.Info)
	secondaryBright := lipgloss.NewStyle().Foreground(m.Theme.SecondaryBright)

	var sb strings.Builder
	sb.WriteString("  ")
	sb.WriteString(successStyle.Render("▸ 1090 MHz "))
	sb.WriteString(textDim.Render("[ADS-B]"))
	sb.WriteString("  ")
	sb.WriteString(infoStyle.Render("▸ 136.900 MHz "))
	sb.WriteString(textDim.Render("[ACARS]"))
	sb.WriteString("  ")
	sb.WriteString(secondaryBright.Render("▸ 136.725 MHz "))
	sb.WriteString(textDim.Render("[VDL2]"))

	return sb.String()
}

func (m *Model) renderProFooter() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.Theme.PrimaryBright)
	textDim := lipgloss.NewStyle().Foreground(m.Theme.TextDim)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╠" + strings.Repeat("═", 80) + "╣"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("║ "))

	// Scan display
	scanLine := m.FreqDisp.Render()
	sb.WriteString(scanLine)

	// Padding
	remaining := 78 - lipgloss.Width(scanLine)
	if remaining > 0 {
		sb.WriteString(strings.Repeat(" ", remaining))
	}

	sb.WriteString(borderStyle.Render(" ║"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("╚" + strings.Repeat("═", 80) + "╝"))
	sb.WriteString("\n")

	// Help line
	sb.WriteString(textDim.Render("  [Q] Quit  [T] Theme  [S] Scan Mode"))

	return sb.String()
}

func (m *Model) renderSignalBars(ac *Aircraft) string {
	sigMeter := ui.NewSignalMeter(m.Theme, 5)
	if ac.HasRSSI {
		return sigMeter.Render(ac.RSSI)
	}
	return lipgloss.NewStyle().Foreground(m.Theme.TextDim).Render("░░░░░")
}

func getCompass(heading float64) string {
	directions := []string{"N", "NE", "E", "SE", "S", "SW", "W", "NW"}
	idx := int((heading + 22.5) / 45) % 8
	return directions[idx]
}
