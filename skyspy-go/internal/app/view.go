package app

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/skyspy/skyspy-go/internal/radar"
	"github.com/skyspy/skyspy-go/internal/theme"
)

// View renders the application
func (m *Model) View() string {
	var sb strings.Builder

	// Header
	sb.WriteString(m.renderHeader())
	sb.WriteString("\n")

	// Main content area
	radarView := m.renderRadar()
	var sidebarView string

	switch m.viewMode {
	case ViewSettings:
		sidebarView = m.renderSettingsPanel()
	case ViewHelp:
		sidebarView = m.renderHelpPanel()
	case ViewOverlays:
		sidebarView = m.renderOverlayPanel()
	case ViewSearch:
		sidebarView = m.renderSearchPanel()
	case ViewAlertRules:
		sidebarView = m.renderAlertRulesPanel()
	default:
		sidebarView = m.renderSidebar()
	}

	// Side by side layout
	radarLines := strings.Split(radarView, "\n")
	sidebarLines := strings.Split(sidebarView, "\n")

	maxLines := len(radarLines)
	if len(sidebarLines) > maxLines {
		maxLines = len(sidebarLines)
	}

	for i := 0; i < maxLines; i++ {
		radarLine := ""
		if i < len(radarLines) {
			radarLine = radarLines[i]
		}
		sidebarLine := ""
		if i < len(sidebarLines) {
			sidebarLine = sidebarLines[i]
		}
		sb.WriteString(radarLine)
		sb.WriteString(" ")
		sb.WriteString(sidebarLine)
		sb.WriteString("\n")
	}

	// ACARS panel if enabled
	if m.config.Display.ShowACARS && m.viewMode == ViewRadar {
		sb.WriteString(m.renderACARSPanel())
		sb.WriteString("\n")
	}

	// Status bar
	sb.WriteString(m.renderStatusBar())
	sb.WriteString("\n")

	// Footer
	sb.WriteString(m.renderFooter())

	result := sb.String()

	// Store last rendered view for screenshot exports
	m.lastRenderedView = result

	return result
}

func (m *Model) renderHeader() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	primaryBright := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright).Bold(true).Reverse(true)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright).Bold(true)
	infoStyle := lipgloss.NewStyle().Foreground(m.theme.Info)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)

	var sb strings.Builder
	sb.WriteString(borderStyle.Render("╔" + strings.Repeat("═", 98) + "╗"))
	sb.WriteString("\n")

	sb.WriteString(borderStyle.Render("║ "))
	sb.WriteString(textDim.Render("░░ "))
	sb.WriteString(primaryBright.Render("SKYSPY RADAR PRO"))
	sb.WriteString(textDim.Render(" ░░ "))
	sb.WriteString(borderStyle.Render(strings.Repeat("═", 18)))
	sb.WriteString(secondaryBright.Render(" ADS-B TACTICAL DISPLAY "))
	sb.WriteString(borderStyle.Render(strings.Repeat("═", 18)))

	spin := m.spinners[m.frame%4]
	sb.WriteString(infoStyle.Render(" " + spin + " "))
	sb.WriteString(infoStyle.Bold(true).Render("LIVE"))
	sb.WriteString(infoStyle.Render(" " + spin + "  "))
	sb.WriteString(borderStyle.Render("║"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("╠" + strings.Repeat("═", 98) + "╣"))

	return sb.String()
}

func (m *Model) renderRadar() string {
	scope := radar.NewScope(m.theme, m.maxRange, m.config.Radar.RangeRings, m.config.Radar.ShowCompass)
	scope.Clear()
	scope.DrawRangeRings()
	scope.DrawCompass()

	// Draw overlays
	if m.config.Radar.ShowOverlays {
		scope.DrawOverlays(
			m.overlayManager.GetEnabledOverlays(),
			m.config.Connection.ReceiverLat,
			m.config.Connection.ReceiverLon,
			m.config.Radar.OverlayColor,
		)
	}

	// Draw trails before targets so targets are rendered on top
	if m.config.Display.ShowTrails {
		scope.DrawTrails(
			m.GetTrailsForRadar(),
			m.config.Connection.ReceiverLat,
			m.config.Connection.ReceiverLon,
		)
	}

	scope.DrawSweep(m.sweepAngle)

	// Draw targets and update sorted list
	m.sortedTargets = scope.DrawTargets(
		m.aircraft,
		m.selectedHex,
		m.config.Filters.MilitaryOnly,
		m.config.Filters.HideGround,
		m.config.Display.ShowLabels,
		m.blink,
	)

	return scope.Render()
}

func (m *Model) renderSidebar() string {
	var sb strings.Builder

	// Target panel
	sb.WriteString(m.renderTargetPanel())
	sb.WriteString("\n")

	// Stats panel
	if m.config.Display.ShowStatsPanel {
		sb.WriteString(m.renderStatsPanel())
		sb.WriteString("\n")
	}

	// Target list
	if m.config.Display.ShowTargetList {
		sb.WriteString(m.renderTargetList())
		sb.WriteString("\n")
	}

	// Frequency panel
	if m.config.Display.ShowFrequencies {
		sb.WriteString(m.renderFreqPanel())
	}

	return sb.String()
}

func (m *Model) renderTargetPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)
	selectedStyle := lipgloss.NewStyle().Foreground(m.theme.Selected).Bold(true)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright)
	primaryBright := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright)
	militaryStyle := lipgloss.NewStyle().Foreground(m.theme.Military).Bold(true)
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Success)
	errorStyle := lipgloss.NewStyle().Foreground(m.theme.Error)
	emergencyStyle := lipgloss.NewStyle().Foreground(m.theme.Emergency)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╭─") + titleStyle.Render("◄ TARGET ►") + borderStyle.Render("─────────────────╮"))
	sb.WriteString("\n")

	target, exists := m.aircraft[m.selectedHex]
	if !exists || m.selectedHex == "" {
		sb.WriteString(borderStyle.Render("│") + textDim.Render("  No target selected           ") + borderStyle.Render("│"))
		sb.WriteString("\n")
		sb.WriteString(borderStyle.Render("│") + textDim.Render("                               ") + borderStyle.Render("│"))
		sb.WriteString("\n")
		sb.WriteString(borderStyle.Render("│") + textDim.Render("  [↑↓] Select  [+-] Range      ") + borderStyle.Render("│"))
		sb.WriteString("\n")
		sb.WriteString(borderStyle.Render("│") + textDim.Render("  [T] Themes   [O] Overlays    ") + borderStyle.Render("│"))
		sb.WriteString("\n")
		sb.WriteString(borderStyle.Render("│") + textDim.Render("  [?] Help     [Q] Quit        ") + borderStyle.Render("│"))
		sb.WriteString("\n")
		sb.WriteString(borderStyle.Render("╰───────────────────────────────╯"))
		return sb.String()
	}

	cs := target.Callsign
	if cs == "" {
		cs = "-------"
	}

	// Callsign and hex
	sb.WriteString(borderStyle.Render("│") + selectedStyle.Render(fmt.Sprintf("  %-28s", cs)) + borderStyle.Render("│"))
	sb.WriteString("\n")

	hexLine := secondaryBright.Render("  " + strings.ToUpper(target.Hex))
	if target.Military {
		hexLine += militaryStyle.Render(" MIL")
	}
	sb.WriteString(borderStyle.Render("│") + fmt.Sprintf("%-31s", hexLine) + borderStyle.Render("│"))
	sb.WriteString("\n")

	sb.WriteString(borderStyle.Render("│") + "                               " + borderStyle.Render("│"))
	sb.WriteString("\n")

	// Data rows
	rows := []struct {
		label string
		value string
		style lipgloss.Style
	}{
		{"TYPE", target.ACType, primaryBright},
		{"ALT", m.formatAlt(target), primaryBright},
		{"GS", m.formatSpeed(target), primaryBright},
		{"VS", m.formatVS(target), m.getVSStyle(target)},
		{"HDG", m.formatTrack(target), primaryBright},
		{"DST", m.formatDistance(target), secondaryBright},
		{"BRG", m.formatBearing(target), secondaryBright},
		{"SQ", m.formatSquawk(target), m.getSquawkStyle(target)},
	}

	for _, row := range rows {
		if row.value == "" {
			row.value = "----"
		}
		sb.WriteString(borderStyle.Render("│") + textDim.Render(fmt.Sprintf("  %-4s ", row.label)) + row.style.Render(fmt.Sprintf("%-23s", row.value)) + borderStyle.Render("│"))
		sb.WriteString("\n")
	}

	// Signal strength
	sb.WriteString(borderStyle.Render("│") + textDim.Render("  SIG  ") + m.renderSignalBars(target) + strings.Repeat(" ", 18) + borderStyle.Render("│"))
	sb.WriteString("\n")

	sb.WriteString(borderStyle.Render("╰───────────────────────────────╯"))

	_ = successStyle
	_ = errorStyle
	_ = emergencyStyle

	return sb.String()
}

func (m *Model) renderStatsPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Success)
	errorStyle := lipgloss.NewStyle().Foreground(m.theme.Error)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright)
	warningStyle := lipgloss.NewStyle().Foreground(m.theme.Warning)
	militaryStyle := lipgloss.NewStyle().Foreground(m.theme.Military)
	infoStyle := lipgloss.NewStyle().Foreground(m.theme.Info)
	emergencyStyle := lipgloss.NewStyle().Foreground(m.theme.Emergency)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╭─") + titleStyle.Render("STATUS") + borderStyle.Render("─────────────────────╮"))
	sb.WriteString("\n")

	// Connection status
	if m.IsConnected() {
		ind := "◉"
		if !m.blink {
			ind = "○"
		}
		sb.WriteString(borderStyle.Render("│") + successStyle.Render("  "+ind+" ") + successStyle.Bold(true).Render("RECEIVING") + strings.Repeat(" ", 16) + borderStyle.Render("│"))
	} else {
		sb.WriteString(borderStyle.Render("│") + errorStyle.Render("  ○ ") + errorStyle.Bold(true).Render("OFFLINE") + strings.Repeat(" ", 18) + borderStyle.Render("│"))
	}
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("│") + "                               " + borderStyle.Render("│"))
	sb.WriteString("\n")

	// Stats
	stats := []struct {
		label string
		value string
		style lipgloss.Style
	}{
		{"TGT", fmt.Sprintf("%3d", len(m.aircraft)), secondaryBright},
		{"PEAK", fmt.Sprintf("%3d", m.peakAircraft), warningStyle},
		{"MIL", fmt.Sprintf("%3d", m.militaryCount), militaryStyle},
		{"EMRG", fmt.Sprintf("%3d", m.emergencyCount), emergencyStyle},
		{"MSG", fmt.Sprintf("%d", m.sessionMessages), infoStyle},
	}

	for _, stat := range stats {
		sb.WriteString(borderStyle.Render("│") + textDim.Render(fmt.Sprintf("  %-4s ", stat.label)) + stat.style.Render(fmt.Sprintf("%-23s", stat.value)) + borderStyle.Render("│"))
		sb.WriteString("\n")
	}

	// VU Meters
	if m.config.Display.ShowVUMeters {
		sb.WriteString(borderStyle.Render("│") + "                               " + borderStyle.Render("│"))
		sb.WriteString("\n")
		sb.WriteString(borderStyle.Render("│") + textDim.Render("  VU L ") + m.renderVUMeter(m.vuLeft, 10) + strings.Repeat(" ", 13) + borderStyle.Render("│"))
		sb.WriteString("\n")
		sb.WriteString(borderStyle.Render("│") + textDim.Render("  VU R ") + m.renderVUMeter(m.vuRight, 10) + strings.Repeat(" ", 13) + borderStyle.Render("│"))
		sb.WriteString("\n")
	}

	// Spectrum Analyzer
	if m.config.Display.ShowSpectrum {
		sb.WriteString(borderStyle.Render("│") + "                               " + borderStyle.Render("│"))
		sb.WriteString("\n")
		sb.WriteString(borderStyle.Render("│") + textDim.Render(" SPECTRUM (RSSI by Distance)   ") + borderStyle.Render("│"))
		sb.WriteString("\n")
		sb.WriteString(borderStyle.Render("│") + m.renderSpectrumBar() + borderStyle.Render("│"))
		sb.WriteString("\n")
		sb.WriteString(borderStyle.Render("│") + textDim.Render("  0    50   100   200   400+ nm") + borderStyle.Render("│"))
		sb.WriteString("\n")
	}

	sb.WriteString(borderStyle.Render("╰───────────────────────────────╯"))

	return sb.String()
}

func (m *Model) renderTargetList() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)
	selectedStyle := lipgloss.NewStyle().Foreground(m.theme.Selected).Bold(true)
	secondaryStyle := lipgloss.NewStyle().Foreground(m.theme.Secondary)
	primaryStyle := lipgloss.NewStyle().Foreground(m.theme.Primary).Bold(true)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╭─") + titleStyle.Render(fmt.Sprintf("LIST (%d)", len(m.aircraft))) + borderStyle.Render("─────────────────╮"))
	sb.WriteString("\n")

	// Header
	sb.WriteString(borderStyle.Render("│") + primaryStyle.Render("   CALL     ALT    D") + strings.Repeat(" ", 10) + borderStyle.Render("│"))
	sb.WriteString("\n")

	// List up to 8 targets
	count := 0
	for _, hex := range m.sortedTargets {
		if count >= 8 {
			break
		}
		target, exists := m.aircraft[hex]
		if !exists {
			continue
		}

		isSelected := hex == m.selectedHex
		marker := " "
		if isSelected {
			marker = "▶"
		}

		cs := target.Callsign
		if cs == "" {
			cs = target.Hex
		}
		if len(cs) > 6 {
			cs = cs[:6]
		}

		alt := "---"
		if target.HasAlt {
			if target.Altitude >= 1000 {
				alt = fmt.Sprintf("%d", target.Altitude/100)
			} else if target.Altitude == 0 {
				alt = "GND"
			}
		}

		dist := "-"
		if target.Distance > 0 {
			dist = fmt.Sprintf("%.0f", target.Distance)
		}

		var lineStyle lipgloss.Style
		if isSelected {
			lineStyle = selectedStyle
		} else {
			lineStyle = secondaryStyle
		}

		line := fmt.Sprintf("%s %-6s  %4s  %3s", marker, cs, alt, dist)
		sb.WriteString(borderStyle.Render("│") + lineStyle.Render(fmt.Sprintf(" %-29s", line)) + borderStyle.Render("│"))
		sb.WriteString("\n")
		count++
	}

	// Fill remaining rows if needed
	for count < 8 {
		sb.WriteString(borderStyle.Render("│") + textDim.Render(strings.Repeat(" ", 31)) + borderStyle.Render("│"))
		sb.WriteString("\n")
		count++
	}

	sb.WriteString(borderStyle.Render("╰───────────────────────────────╯"))

	return sb.String()
}

func (m *Model) renderFreqPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Success)
	infoStyle := lipgloss.NewStyle().Foreground(m.theme.Info)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright)
	errorStyle := lipgloss.NewStyle().Foreground(m.theme.Error)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╭─") + titleStyle.Render("FREQ") + borderStyle.Render("───────────────────────╮"))
	sb.WriteString("\n")

	freqs := []struct {
		freq   string
		label  string
		style  lipgloss.Style
	}{
		{"1090.000", "ADS-B", successStyle},
		{"136.900", "ACARS", infoStyle},
		{"136.725", "VDL2", secondaryBright},
		{"121.500", "GUARD", errorStyle},
	}

	for _, f := range freqs {
		ind := "○"
		indStyle := textDim
		// Simulate random activity
		if m.blink && m.frame%7 < 3 {
			ind = "●"
			indStyle = f.style
		}
		sb.WriteString(borderStyle.Render("│") + "  " + indStyle.Render(ind) + " " + f.style.Render(f.freq) + " " + textDim.Render(fmt.Sprintf("[%-5s]", f.label)) + strings.Repeat(" ", 8) + borderStyle.Render("│"))
		sb.WriteString("\n")
	}

	sb.WriteString(borderStyle.Render("╰───────────────────────────────╯"))

	return sb.String()
}

func (m *Model) renderACARSPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	infoStyle := lipgloss.NewStyle().Foreground(m.theme.Info)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright)
	primaryStyle := lipgloss.NewStyle().Foreground(m.theme.Primary)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╭─") + infoStyle.Render("ACARS") + borderStyle.Render(strings.Repeat("─", 87) + "╮"))
	sb.WriteString("\n")

	// Show last 3 messages
	start := len(m.acarsMessages) - 3
	if start < 0 {
		start = 0
	}

	count := 0
	for i := start; i < len(m.acarsMessages); i++ {
		msg := m.acarsMessages[i]
		cs := msg.Callsign
		if cs == "" {
			cs = msg.Flight
		}
		if len(cs) > 6 {
			cs = cs[:6]
		}
		label := msg.Label
		if len(label) > 2 {
			label = label[:2]
		}
		text := msg.Text
		if len(text) > 70 {
			text = text[:70]
		}

		line := secondaryBright.Render(fmt.Sprintf("%-6s ", cs)) +
			primaryStyle.Render(fmt.Sprintf("%2s ", label)) +
			textDim.Render(text)
		sb.WriteString(borderStyle.Render("│ ") + fmt.Sprintf("%-91s", line) + borderStyle.Render("│"))
		sb.WriteString("\n")
		count++
	}

	// Fill remaining rows
	for count < 3 {
		if count == 0 {
			sb.WriteString(borderStyle.Render("│") + textDim.Render("  Awaiting ACARS...") + strings.Repeat(" ", 73) + borderStyle.Render("│"))
		} else {
			sb.WriteString(borderStyle.Render("│") + strings.Repeat(" ", 92) + borderStyle.Render("│"))
		}
		sb.WriteString("\n")
		count++
	}

	sb.WriteString(borderStyle.Render("╰" + strings.Repeat("─", 92) + "╯"))

	return sb.String()
}

func (m *Model) renderStatusBar() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	borderDim := lipgloss.NewStyle().Foreground(m.theme.BorderDim)
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Success).Bold(true)
	errorStyle := lipgloss.NewStyle().Foreground(m.theme.Error).Bold(true)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright)
	primaryBright := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright)
	warningStyle := lipgloss.NewStyle().Foreground(m.theme.Warning)
	infoStyle := lipgloss.NewStyle().Foreground(m.theme.Info)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╟"))
	sb.WriteString(borderStyle.Render(strings.Repeat("─", 98)))
	sb.WriteString(borderStyle.Render("╢"))
	sb.WriteString("\n")

	sb.WriteString(borderStyle.Render("║ "))

	// Connection indicator
	if m.IsConnected() {
		ind := "◉"
		if !m.blink {
			ind = "○"
		}
		sb.WriteString(successStyle.Render(ind + " ON "))
	} else {
		sb.WriteString(errorStyle.Render("○ OFF "))
	}

	sb.WriteString(borderDim.Render("│"))
	sb.WriteString(secondaryBright.Render(fmt.Sprintf(" %3d ", len(m.aircraft))))
	sb.WriteString(borderDim.Render("│"))
	sb.WriteString(primaryBright.Render(fmt.Sprintf(" %dnm ", int(m.maxRange))))
	sb.WriteString(borderDim.Render("│"))

	// Active filters
	var filters []string
	if m.config.Filters.MilitaryOnly {
		filters = append(filters, "MIL")
	}
	if m.config.Filters.HideGround {
		filters = append(filters, "AIR")
	}
	if m.IsFilterActive() {
		filterDesc := m.searchFilter.Description()
		if len(filterDesc) > 15 {
			filterDesc = filterDesc[:15] + "..."
		}
		filters = append(filters, filterDesc)
	}
	if len(filters) > 0 {
		sb.WriteString(warningStyle.Render(" " + strings.Join(filters, "/") + " "))
		sb.WriteString(borderDim.Render("│"))
	}

	// Overlays
	enabledOverlays := 0
	for _, ov := range m.overlayManager.GetOverlayList() {
		if ov.Enabled {
			enabledOverlays++
		}
	}
	if enabledOverlays > 0 {
		sb.WriteString(infoStyle.Render(fmt.Sprintf(" OVL:%d ", enabledOverlays)))
		sb.WriteString(borderDim.Render("│"))
	}

	// Theme name
	themeName := m.theme.Name
	if len(themeName) > 12 {
		themeName = themeName[:12]
	}
	sb.WriteString(textDim.Render(" " + themeName + " "))
	sb.WriteString(borderDim.Render("│"))

	// Time
	sb.WriteString(secondaryBright.Render(" " + time.Now().Format("15:04:05") + " "))

	// Notification
	if m.notification != "" && m.notificationTime > 0 {
		sb.WriteString(borderDim.Render("│"))
		sb.WriteString(infoStyle.Bold(true).Render(" " + m.notification + " "))
	}

	// Pad to width
	remaining := 98 - lipgloss.Width(sb.String()) + 3 // Account for borders
	if remaining > 0 {
		sb.WriteString(strings.Repeat(" ", remaining))
	}

	sb.WriteString(borderStyle.Render("║"))

	return sb.String()
}

func (m *Model) renderFooter() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	return borderStyle.Render("╚" + strings.Repeat("═", 98) + "╝")
}

func (m *Model) renderSettingsPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright).Bold(true)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright).Bold(true)
	borderDim := lipgloss.NewStyle().Foreground(m.theme.BorderDim)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)
	selectedStyle := lipgloss.NewStyle().Foreground(m.theme.Selected).Bold(true)
	textStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Success)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╔══════════════════════════════════╗"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("║") + titleStyle.Render("         SETTINGS & THEMES        ") + borderStyle.Render("║"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("╚══════════════════════════════════╝"))
	sb.WriteString("\n\n")

	sb.WriteString(secondaryBright.Render("  THEMES"))
	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 34)))
	sb.WriteString("\n")

	themes := theme.GetInfo()
	for i, t := range themes {
		isCurrent := t.Key == m.config.Display.Theme
		isCursor := i == m.settingsCursor

		prefix := "  "
		if isCursor {
			prefix = "▶ "
		}
		marker := "○"
		if isCurrent {
			marker = "●"
		}

		var style, markerStyle lipgloss.Style
		if isCursor {
			style = selectedStyle
		} else {
			style = textStyle
		}
		if isCurrent {
			markerStyle = successStyle
		} else {
			markerStyle = textDim
		}

		name := t.Name
		if len(name) > 14 {
			name = name[:14]
		}
		desc := t.Description
		if len(desc) > 16 {
			desc = desc[:16]
		}

		sb.WriteString("  " + style.Render(prefix) + markerStyle.Render(marker+" ") + style.Render(fmt.Sprintf("%-14s", name)) + textDim.Render(" "+desc))
		sb.WriteString("\n")
	}

	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 34)))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  [↑/↓] Navigate  [Enter] Apply"))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  [T/Esc] Close"))

	return sb.String()
}

func (m *Model) renderOverlayPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright).Bold(true)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright).Bold(true)
	borderDim := lipgloss.NewStyle().Foreground(m.theme.BorderDim)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)
	selectedStyle := lipgloss.NewStyle().Foreground(m.theme.Selected).Bold(true)
	textStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Success)
	infoStyle := lipgloss.NewStyle().Foreground(m.theme.Info)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╔══════════════════════════════════╗"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("║") + titleStyle.Render("         OVERLAY MANAGER          ") + borderStyle.Render("║"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("╚══════════════════════════════════╝"))
	sb.WriteString("\n\n")

	overlays := m.overlayManager.GetOverlayList()

	if len(overlays) > 0 {
		sb.WriteString(secondaryBright.Render("  LOADED OVERLAYS"))
		sb.WriteString("\n")
		sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 34)))
		sb.WriteString("\n")

		for i, ov := range overlays {
			isCursor := i == m.overlayCursor

			prefix := "  "
			if isCursor {
				prefix = "▶ "
			}
			marker := "○"
			if ov.Enabled {
				marker = "●"
			}

			var style, markerStyle lipgloss.Style
			if isCursor {
				style = selectedStyle
			} else {
				style = textStyle
			}
			if ov.Enabled {
				markerStyle = successStyle
			} else {
				markerStyle = textDim
			}

			name := ov.Name
			if len(name) > 25 {
				name = name[:25]
			}

			sb.WriteString("  " + style.Render(prefix) + markerStyle.Render(marker+" ") + style.Render(name))
			sb.WriteString("\n")
		}
	} else {
		sb.WriteString(textDim.Render("  No overlays loaded"))
		sb.WriteString("\n")
	}

	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 34)))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  [↑/↓] Navigate  [Enter] Toggle"))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  [D] Delete  [O/Esc] Close"))
	sb.WriteString("\n\n")
	sb.WriteString(textDim.Render("  Add overlays:"))
	sb.WriteString("\n")
	sb.WriteString(infoStyle.Render("  --overlay /path/to/file.geojson"))

	return sb.String()
}

func (m *Model) renderSearchPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright).Bold(true)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright).Bold(true)
	borderDim := lipgloss.NewStyle().Foreground(m.theme.BorderDim)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)
	selectedStyle := lipgloss.NewStyle().Foreground(m.theme.Selected).Bold(true)
	textStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	infoStyle := lipgloss.NewStyle().Foreground(m.theme.Info)
	warningStyle := lipgloss.NewStyle().Foreground(m.theme.Warning)
	primaryBright := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╔══════════════════════════════════╗"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("║") + titleStyle.Render("        SEARCH & FILTER           ") + borderStyle.Render("║"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("╚══════════════════════════════════╝"))
	sb.WriteString("\n\n")

	// Search input box
	sb.WriteString(secondaryBright.Render("  SEARCH"))
	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 34)))
	sb.WriteString("\n")

	// Input field with cursor
	query := m.searchQuery
	if len(query) > 28 {
		query = query[len(query)-28:]
	}
	cursor := ""
	if m.blink {
		cursor = "_"
	}
	inputLine := query + cursor
	sb.WriteString("  " + borderStyle.Render("[") + primaryBright.Render(fmt.Sprintf("%-28s", inputLine)) + borderStyle.Render("]"))
	sb.WriteString("\n\n")

	// Results count
	resultCount := len(m.searchResults)
	totalCount := len(m.aircraft)
	if m.searchQuery != "" {
		sb.WriteString("  " + infoStyle.Render(fmt.Sprintf("Matches: %d/%d", resultCount, totalCount)))
	} else {
		sb.WriteString("  " + textDim.Render(fmt.Sprintf("Total: %d aircraft", totalCount)))
	}
	sb.WriteString("\n\n")

	// Results list
	sb.WriteString(secondaryBright.Render("  RESULTS"))
	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 34)))
	sb.WriteString("\n")

	if len(m.searchResults) > 0 {
		// Show up to 8 results
		displayCount := 8
		if len(m.searchResults) < displayCount {
			displayCount = len(m.searchResults)
		}

		startIdx := 0
		if m.searchCursor >= displayCount {
			startIdx = m.searchCursor - displayCount + 1
		}

		for i := startIdx; i < startIdx+displayCount && i < len(m.searchResults); i++ {
			hex := m.searchResults[i]
			target, exists := m.aircraft[hex]
			if !exists {
				continue
			}

			isCursor := i == m.searchCursor
			prefix := "  "
			if isCursor {
				prefix = "▶ "
			}

			// Format callsign/hex with highlighting
			cs := target.Callsign
			if cs == "" {
				cs = target.Hex
			}
			if len(cs) > 8 {
				cs = cs[:8]
			}

			// Highlight matching text
			var csDisplay string
			if m.searchFilter != nil {
				before, match, after := m.searchFilter.HighlightMatch(cs)
				if match != "" {
					csDisplay = textStyle.Render(before) + warningStyle.Bold(true).Render(match) + textStyle.Render(after)
				} else {
					csDisplay = textStyle.Render(cs)
				}
			} else {
				csDisplay = textStyle.Render(cs)
			}

			var lineStyle lipgloss.Style
			if isCursor {
				lineStyle = selectedStyle
			} else {
				lineStyle = textStyle
			}

			// Add altitude/distance info
			alt := "---"
			if target.HasAlt {
				if target.Altitude >= 1000 {
					alt = fmt.Sprintf("%d", target.Altitude/100)
				} else {
					alt = "GND"
				}
			}

			line := fmt.Sprintf("%s%-8s %4s", prefix, "", alt)
			sb.WriteString("  " + lineStyle.Render(prefix) + csDisplay + textDim.Render(fmt.Sprintf(" %4s", alt)))
			sb.WriteString("\n")

			_ = line
		}

		// Fill remaining rows
		for i := displayCount; i < 8; i++ {
			sb.WriteString("  " + textDim.Render(strings.Repeat(" ", 30)))
			sb.WriteString("\n")
		}
	} else if m.searchQuery != "" {
		sb.WriteString("  " + textDim.Render("No matches found"))
		sb.WriteString("\n")
		for i := 0; i < 7; i++ {
			sb.WriteString("  " + textDim.Render(strings.Repeat(" ", 30)))
			sb.WriteString("\n")
		}
	} else {
		sb.WriteString("  " + textDim.Render("Type to search..."))
		sb.WriteString("\n")
		for i := 0; i < 7; i++ {
			sb.WriteString("  " + textDim.Render(strings.Repeat(" ", 30)))
			sb.WriteString("\n")
		}
	}

	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 34)))
	sb.WriteString("\n")
	sb.WriteString(secondaryBright.Render("  SYNTAX"))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  text     Callsign/hex"))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  sq:7700  Squawk code"))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  alt:>10000  Altitude filter"))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  dist:<50    Distance filter"))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  mil      Military only"))
	sb.WriteString("\n\n")

	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 34)))
	sb.WriteString("\n")
	sb.WriteString(secondaryBright.Render("  PRESETS"))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  [F1] All  [F2] Military"))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  [F3] Emergency  [F4] Low Alt"))
	sb.WriteString("\n\n")

	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 34)))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  [Enter] Apply  [Esc] Cancel"))

	return sb.String()
}

func (m *Model) renderHelpPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright).Bold(true)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright).Bold(true)
	borderDim := lipgloss.NewStyle().Foreground(m.theme.BorderDim)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)
	primaryBright := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright)
	textStyle := lipgloss.NewStyle().Foreground(m.theme.Text)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╔══════════════════════════════════════════╗"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("║") + titleStyle.Render("           SKYSPY RADAR HELP              ") + borderStyle.Render("║"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("╚══════════════════════════════════════════╝"))
	sb.WriteString("\n\n")

	sections := []struct {
		title string
		items [][]string
	}{
		{"NAVIGATION", [][]string{{"↑/↓ j/k", "Select target"}, {"+/-", "Zoom range"}, {"/", "Search"}}},
		{"DISPLAY", [][]string{{"L", "Labels"}, {"B", "Trails"}, {"M", "Military only"}, {"G", "Ground filter"}, {"A", "ACARS"}, {"V", "VU meters"}}},
		{"EXPORT", [][]string{{"P", "Screenshot (HTML)"}, {"E", "Export CSV"}, {"Ctrl+E", "Export JSON"}}},
		{"PANELS", [][]string{{"T", "Themes"}, {"O", "Overlays"}, {"R", "Alert Rules"}, {"?", "Help"}, {"Q", "Quit"}}},
		{"SYMBOLS", [][]string{{"✦", "Aircraft"}, {"◉", "Selected"}, {"◆", "Military"}, {"!", "Emergency"}}},
	}

	for _, section := range sections {
		sb.WriteString(secondaryBright.Render("  " + section.title))
		sb.WriteString("\n")
		sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 40)))
		sb.WriteString("\n")
		for _, item := range section.items {
			sb.WriteString("   " + primaryBright.Render(fmt.Sprintf("[%7s]", item[0])) + " " + textStyle.Render(item[1]))
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}

	sb.WriteString(textDim.Render("  Press any key to close"))

	return sb.String()
}

// Helper methods

func (m *Model) formatAlt(t *radar.Target) string {
	if !t.HasAlt {
		return "----"
	}
	if t.Altitude >= 18000 {
		return fmt.Sprintf("FL%03d", t.Altitude/100)
	}
	return fmt.Sprintf("%d'", t.Altitude)
}

func (m *Model) formatSpeed(t *radar.Target) string {
	if !t.HasSpeed {
		return "---"
	}
	return fmt.Sprintf("%d kt", int(t.Speed))
}

func (m *Model) formatVS(t *radar.Target) string {
	if !t.HasVS {
		return "---"
	}
	if t.Vertical > 0 {
		return fmt.Sprintf("+%d", int(t.Vertical))
	}
	return fmt.Sprintf("%d", int(t.Vertical))
}

func (m *Model) formatTrack(t *radar.Target) string {
	if !t.HasTrack {
		return "---"
	}
	return fmt.Sprintf("%03d°", int(t.Track))
}

func (m *Model) formatDistance(t *radar.Target) string {
	if t.Distance <= 0 {
		return "---"
	}
	return fmt.Sprintf("%.1fnm", t.Distance)
}

func (m *Model) formatBearing(t *radar.Target) string {
	if t.Bearing <= 0 {
		return "---"
	}
	return fmt.Sprintf("%03d°", int(t.Bearing))
}

func (m *Model) formatSquawk(t *radar.Target) string {
	if t.Squawk == "" {
		return "----"
	}
	return t.Squawk
}

func (m *Model) getVSStyle(t *radar.Target) lipgloss.Style {
	if !t.HasVS {
		return lipgloss.NewStyle().Foreground(m.theme.TextDim)
	}
	if t.Vertical > 0 {
		return lipgloss.NewStyle().Foreground(m.theme.Success)
	}
	return lipgloss.NewStyle().Foreground(m.theme.Error)
}

func (m *Model) getSquawkStyle(t *radar.Target) lipgloss.Style {
	if t.IsEmergency() {
		return lipgloss.NewStyle().Foreground(m.theme.Emergency)
	}
	return lipgloss.NewStyle().Foreground(m.theme.PrimaryBright)
}

func (m *Model) renderSignalBars(t *radar.Target) string {
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Success)
	warningStyle := lipgloss.NewStyle().Foreground(m.theme.Warning)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)

	if !t.HasRSSI {
		return textDim.Render("░░░░░")
	}

	bars := int((t.RSSI + 30) / 6)
	if bars < 0 {
		bars = 0
	}
	if bars > 5 {
		bars = 5
	}

	var sb strings.Builder
	for i := 0; i < 5; i++ {
		if i < bars {
			if bars > 2 {
				sb.WriteString(successStyle.Render("█"))
			} else {
				sb.WriteString(warningStyle.Render("█"))
			}
		} else {
			sb.WriteString(textDim.Render("░"))
		}
	}
	return sb.String()
}

func (m *Model) renderVUMeter(level float64, width int) string {
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Success)
	warningStyle := lipgloss.NewStyle().Foreground(m.theme.Warning)
	errorStyle := lipgloss.NewStyle().Foreground(m.theme.Error)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)

	filled := int(level * float64(width))
	var sb strings.Builder

	for i := 0; i < width; i++ {
		if i < filled {
			if float64(i) < float64(width)*0.6 {
				sb.WriteString(successStyle.Render("█"))
			} else if float64(i) < float64(width)*0.8 {
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

// renderSpectrumBar renders a spectrum analyzer bar showing RSSI by distance band
func (m *Model) renderSpectrumBar() string {
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Success)
	warningStyle := lipgloss.NewStyle().Foreground(m.theme.Warning)
	errorStyle := lipgloss.NewStyle().Foreground(m.theme.Error)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)
	primaryBright := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright)

	var sb strings.Builder
	sb.WriteString(" ")

	// Spectrum bars - we have up to 24 bins but display 29 chars wide
	displayBins := 29
	if len(m.spectrum) < displayBins {
		displayBins = len(m.spectrum)
	}

	peaks := m.GetSpectrumPeaks()

	for i := 0; i < displayBins; i++ {
		var level float64
		if i < len(m.spectrum) {
			level = m.spectrum[i]
		}

		var peakLevel float64
		if i < len(peaks) {
			peakLevel = peaks[i]
		}

		// Get bar character based on level (0.0 to 1.0)
		// Use different characters for different heights
		barChar := "░"
		var style lipgloss.Style

		if level > 0.05 {
			// Determine color based on level
			if level < 0.3 {
				style = successStyle
			} else if level < 0.6 {
				style = warningStyle
			} else {
				style = errorStyle
			}

			// Choose bar character based on height
			if level < 0.15 {
				barChar = "▁"
			} else if level < 0.3 {
				barChar = "▂"
			} else if level < 0.45 {
				barChar = "▃"
			} else if level < 0.6 {
				barChar = "▄"
			} else if level < 0.75 {
				barChar = "▅"
			} else if level < 0.9 {
				barChar = "▆"
			} else {
				barChar = "▇"
			}

			// Show peak indicator if peak is higher than current
			if peakLevel > level+0.1 && peakLevel > 0.3 {
				barChar = "▇"
				style = primaryBright
			}

			sb.WriteString(style.Render(barChar))
		} else {
			sb.WriteString(textDim.Render(barChar))
		}
	}

	// Pad remaining space
	remaining := 30 - displayBins - 1
	for i := 0; i < remaining; i++ {
		sb.WriteString(textDim.Render("░"))
	}

	return sb.String()
}

func (m *Model) renderAlertRulesPanel() string {
	borderStyle := lipgloss.NewStyle().Foreground(m.theme.Border)
	titleStyle := lipgloss.NewStyle().Foreground(m.theme.PrimaryBright).Bold(true)
	secondaryBright := lipgloss.NewStyle().Foreground(m.theme.SecondaryBright).Bold(true)
	borderDim := lipgloss.NewStyle().Foreground(m.theme.BorderDim)
	textDim := lipgloss.NewStyle().Foreground(m.theme.TextDim)
	selectedStyle := lipgloss.NewStyle().Foreground(m.theme.Selected).Bold(true)
	textStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Success)
	errorStyle := lipgloss.NewStyle().Foreground(m.theme.Error)
	warningStyle := lipgloss.NewStyle().Foreground(m.theme.Warning)

	var sb strings.Builder

	sb.WriteString(borderStyle.Render("╔══════════════════════════════════════════╗"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("║") + titleStyle.Render("            ALERT RULES                   ") + borderStyle.Render("║"))
	sb.WriteString("\n")
	sb.WriteString(borderStyle.Render("╚══════════════════════════════════════════╝"))
	sb.WriteString("\n\n")

	alertsEnabled := m.IsAlertsEnabled()
	enabledText := "DISABLED"
	enabledStyle := errorStyle
	if alertsEnabled {
		enabledText = "ENABLED"
		enabledStyle = successStyle
	}
	sb.WriteString("  Alerts: " + enabledStyle.Render(enabledText) + " " + textDim.Render("[A] toggle"))
	sb.WriteString("\n\n")

	sb.WriteString(secondaryBright.Render("  RULES"))
	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 40)))
	sb.WriteString("\n")

	rules := m.GetAlertRules()
	if len(rules) == 0 {
		sb.WriteString("  " + textDim.Render("No alert rules configured"))
		sb.WriteString("\n")
	} else {
		for i, rule := range rules {
			isCursor := i == m.alertRuleCursor

			prefix := "  "
			if isCursor {
				prefix = "▶ "
			}

			marker := "○"
			markerStyle := textDim
			if rule.Enabled {
				marker = "●"
				markerStyle = successStyle
			}

			var style lipgloss.Style
			if isCursor {
				style = selectedStyle
			} else {
				style = textStyle
			}

			name := rule.Name
			if len(name) > 25 {
				name = name[:22] + "..."
			}

			priorityStyle := textDim
			if rule.Priority >= 80 {
				priorityStyle = errorStyle
			} else if rule.Priority >= 40 {
				priorityStyle = warningStyle
			}

			sb.WriteString(fmt.Sprintf("%s%s %s %s\n",
				prefix,
				markerStyle.Render(marker),
				style.Render(fmt.Sprintf("%-25s", name)),
				priorityStyle.Render(fmt.Sprintf("P%d", rule.Priority)),
			))
		}
	}

	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 40)))
	sb.WriteString("\n")

	sb.WriteString(secondaryBright.Render("  RECENT ALERTS"))
	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 40)))
	sb.WriteString("\n")

	recentAlerts := m.GetRecentAlerts()
	if len(recentAlerts) == 0 {
		sb.WriteString("  " + textDim.Render("No recent alerts"))
		sb.WriteString("\n")
	} else {
		start := 0
		if len(recentAlerts) > 5 {
			start = len(recentAlerts) - 5
		}
		for i := start; i < len(recentAlerts); i++ {
			alert := recentAlerts[i]
			ago := time.Since(alert.Timestamp)
			agoStr := fmt.Sprintf("%ds", int(ago.Seconds()))
			if ago > time.Minute {
				agoStr = fmt.Sprintf("%dm", int(ago.Minutes()))
			}

			msg := alert.Message
			if len(msg) > 28 {
				msg = msg[:25] + "..."
			}

			sb.WriteString(fmt.Sprintf("  %s %s\n",
				textDim.Render(fmt.Sprintf("[%4s]", agoStr)),
				warningStyle.Render(msg),
			))
		}
	}

	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 40)))
	sb.WriteString("\n")

	stats := m.GetAlertStats()
	sb.WriteString(fmt.Sprintf("  Rules: %d enabled / %d total\n", stats.EnabledRules, stats.TotalRules))
	sb.WriteString(fmt.Sprintf("  Geofences: %d  Highlighted: %d\n", stats.TotalGeofences, stats.Highlighted))

	sb.WriteString("\n")
	sb.WriteString(borderDim.Render("  " + strings.Repeat("─", 40)))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  [Space/Enter] Toggle rule"))
	sb.WriteString("\n")
	sb.WriteString(textDim.Render("  [A] Toggle alerts  [R/Esc] Close"))

	return sb.String()
}
