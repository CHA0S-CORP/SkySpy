package main

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/theme"
)

var configureCmd = &cobra.Command{
	Use:   "configure",
	Short: "Interactive configuration wizard",
	Long: `Launch an interactive wizard to configure SkySpy settings.

The wizard guides you through configuring:
  - Connection settings (server host, port, receiver location)
  - Display settings (theme, labels, trails, panels)
  - Radar settings (range, rings, compass)
  - Audio settings (alerts, sounds)

Settings are saved to ~/.config/skyspy/settings.json

Examples:
  skyspy configure`,
	RunE: runConfigure,
}

// Wizard sections
const (
	sectionWelcome = iota
	sectionConnection
	sectionDisplay
	sectionRadar
	sectionAudio
	sectionSummary
)

// Field types
const (
	fieldText = iota
	fieldNumber
	fieldFloat
	fieldBool
	fieldSelect
)

type wizardField struct {
	name        string
	label       string
	help        string
	fieldType   int
	options     []string // for select fields
	optionKeys  []string // keys corresponding to options
	textInput   textinput.Model
	boolValue   bool
	selectIndex int
}

type wizardModel struct {
	cfg           *config.Config
	section       int
	fieldIndex    int
	fields        [][]wizardField
	sectionNames  []string
	width         int
	height        int
	quitting      bool
	saved         bool
	err           error

	// Styles
	titleStyle    lipgloss.Style
	sectionStyle  lipgloss.Style
	labelStyle    lipgloss.Style
	valueStyle    lipgloss.Style
	helpStyle     lipgloss.Style
	selectedStyle lipgloss.Style
	dimStyle      lipgloss.Style
	successStyle  lipgloss.Style
	errorStyle    lipgloss.Style
	boxStyle      lipgloss.Style
}

func newWizardModel(cfg *config.Config) wizardModel {
	m := wizardModel{
		cfg:     cfg,
		section: sectionWelcome,
		sectionNames: []string{
			"Welcome",
			"Connection",
			"Display",
			"Radar",
			"Audio",
			"Summary",
		},
		width:  80,
		height: 24,
	}

	// Initialize styles
	m.titleStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("46")).
		MarginBottom(1)

	m.sectionStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("51"))

	m.labelStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("252"))

	m.valueStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("46"))

	m.helpStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("241")).
		Italic(true)

	m.selectedStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("226"))

	m.dimStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("240"))

	m.successStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("46"))

	m.errorStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("196"))

	m.boxStyle = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("28")).
		Padding(1, 2)

	// Initialize fields for each section
	m.fields = make([][]wizardField, 6)

	// Welcome section (no fields)
	m.fields[sectionWelcome] = []wizardField{}

	// Connection section
	m.fields[sectionConnection] = []wizardField{
		m.createTextField("host", "Server Host", "Hostname or IP of the SkySpy server", cfg.Connection.Host),
		m.createNumberField("port", "Server Port", "Port number (typically 80 or 443)", cfg.Connection.Port),
		m.createFloatField("receiver_lat", "Receiver Latitude", "Your receiver's latitude (-90 to 90)", cfg.Connection.ReceiverLat),
		m.createFloatField("receiver_lon", "Receiver Longitude", "Your receiver's longitude (-180 to 180)", cfg.Connection.ReceiverLon),
		m.createBoolField("auto_reconnect", "Auto Reconnect", "Automatically reconnect on connection loss", cfg.Connection.AutoReconnect),
	}

	// Display section - theme selection
	themeOptions := []string{}
	themeKeys := []string{}
	for _, t := range theme.GetInfo() {
		themeOptions = append(themeOptions, fmt.Sprintf("%s - %s", t.Name, t.Description))
		themeKeys = append(themeKeys, t.Key)
	}
	themeIndex := 0
	for i, key := range themeKeys {
		if key == cfg.Display.Theme {
			themeIndex = i
			break
		}
	}

	m.fields[sectionDisplay] = []wizardField{
		m.createSelectField("theme", "Color Theme", "Visual theme for the radar display", themeOptions, themeKeys, themeIndex),
		m.createBoolField("show_labels", "Show Labels", "Display aircraft callsign labels on radar", cfg.Display.ShowLabels),
		m.createBoolField("show_trails", "Show Trails", "Display aircraft movement trails", cfg.Display.ShowTrails),
		m.createBoolField("show_acars", "Show ACARS Panel", "Display ACARS message panel", cfg.Display.ShowACARS),
		m.createBoolField("show_target_list", "Show Target List", "Display aircraft target list", cfg.Display.ShowTargetList),
		m.createBoolField("show_vu_meters", "Show VU Meters", "Display signal VU meters", cfg.Display.ShowVUMeters),
		m.createBoolField("show_spectrum", "Show Spectrum", "Display frequency spectrum", cfg.Display.ShowSpectrum),
		m.createNumberField("refresh_rate", "Refresh Rate (Hz)", "Display update frequency (1-60)", cfg.Display.RefreshRate),
	}

	// Radar section
	m.fields[sectionRadar] = []wizardField{
		m.createNumberField("default_range", "Default Range (nm)", "Initial radar range in nautical miles", cfg.Radar.DefaultRange),
		m.createNumberField("range_rings", "Range Rings", "Number of concentric range rings (0-10)", cfg.Radar.RangeRings),
		m.createNumberField("sweep_speed", "Sweep Speed", "Radar sweep animation speed (1-20)", cfg.Radar.SweepSpeed),
		m.createBoolField("show_compass", "Show Compass", "Display compass rose around radar", cfg.Radar.ShowCompass),
		m.createBoolField("show_grid", "Show Grid", "Display coordinate grid on radar", cfg.Radar.ShowGrid),
		m.createBoolField("show_overlays", "Show Overlays", "Display map overlays on radar", cfg.Radar.ShowOverlays),
	}

	// Audio section
	m.fields[sectionAudio] = []wizardField{
		m.createBoolField("audio_enabled", "Enable Audio", "Enable audio alerts and sounds", cfg.Audio.Enabled),
		m.createBoolField("new_aircraft_sound", "New Aircraft Sound", "Play sound for new aircraft", cfg.Audio.NewAircraftSound),
		m.createBoolField("emergency_sound", "Emergency Sound", "Play sound for emergency squawks", cfg.Audio.EmergencySound),
		m.createBoolField("military_sound", "Military Sound", "Play sound for military aircraft", cfg.Audio.MilitarySound),
	}

	// Summary section (no fields)
	m.fields[sectionSummary] = []wizardField{}

	return m
}

func (m wizardModel) createTextField(name, label, help, value string) wizardField {
	ti := textinput.New()
	ti.SetValue(value)
	ti.CharLimit = 256
	ti.Width = 40
	return wizardField{
		name:      name,
		label:     label,
		help:      help,
		fieldType: fieldText,
		textInput: ti,
	}
}

func (m wizardModel) createNumberField(name, label, help string, value int) wizardField {
	ti := textinput.New()
	ti.SetValue(strconv.Itoa(value))
	ti.CharLimit = 10
	ti.Width = 20
	return wizardField{
		name:      name,
		label:     label,
		help:      help,
		fieldType: fieldNumber,
		textInput: ti,
	}
}

func (m wizardModel) createFloatField(name, label, help string, value float64) wizardField {
	ti := textinput.New()
	ti.SetValue(fmt.Sprintf("%.6f", value))
	ti.CharLimit = 20
	ti.Width = 25
	return wizardField{
		name:      name,
		label:     label,
		help:      help,
		fieldType: fieldFloat,
		textInput: ti,
	}
}

func (m wizardModel) createBoolField(name, label, help string, value bool) wizardField {
	return wizardField{
		name:      name,
		label:     label,
		help:      help,
		fieldType: fieldBool,
		boolValue: value,
	}
}

func (m wizardModel) createSelectField(name, label, help string, options, keys []string, selected int) wizardField {
	return wizardField{
		name:        name,
		label:       label,
		help:        help,
		fieldType:   fieldSelect,
		options:     options,
		optionKeys:  keys,
		selectIndex: selected,
	}
}

func (m wizardModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m wizardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			if m.section == sectionWelcome || m.section == sectionSummary {
				m.quitting = true
				return m, tea.Quit
			}
		case "esc":
			// Go back
			if m.section > sectionWelcome {
				m.section--
				m.fieldIndex = 0
				if len(m.fields[m.section]) > 0 && m.fields[m.section][0].fieldType <= fieldFloat {
					m.fields[m.section][0].textInput.Focus()
				}
			}
			return m, nil
		case "enter":
			return m.handleEnter()
		case "tab", "down":
			return m.handleNext()
		case "shift+tab", "up":
			return m.handlePrev()
		case "left":
			if m.section > sectionWelcome && m.section < sectionSummary {
				f := &m.fields[m.section][m.fieldIndex]
				if f.fieldType == fieldBool {
					f.boolValue = !f.boolValue
				} else if f.fieldType == fieldSelect && f.selectIndex > 0 {
					f.selectIndex--
				}
			}
			return m, nil
		case "right":
			if m.section > sectionWelcome && m.section < sectionSummary {
				f := &m.fields[m.section][m.fieldIndex]
				if f.fieldType == fieldBool {
					f.boolValue = !f.boolValue
				} else if f.fieldType == fieldSelect && f.selectIndex < len(f.options)-1 {
					f.selectIndex++
				}
			}
			return m, nil
		case " ":
			// Toggle for bool fields
			if m.section > sectionWelcome && m.section < sectionSummary {
				f := &m.fields[m.section][m.fieldIndex]
				if f.fieldType == fieldBool {
					f.boolValue = !f.boolValue
				}
			}
			return m, nil
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}

	// Update text input if active
	if m.section > sectionWelcome && m.section < sectionSummary {
		if len(m.fields[m.section]) > 0 {
			f := &m.fields[m.section][m.fieldIndex]
			if f.fieldType <= fieldFloat {
				var cmd tea.Cmd
				f.textInput, cmd = f.textInput.Update(msg)
				return m, cmd
			}
		}
	}

	return m, nil
}

func (m wizardModel) handleEnter() (tea.Model, tea.Cmd) {
	if m.section == sectionWelcome {
		m.section = sectionConnection
		m.fieldIndex = 0
		if len(m.fields[m.section]) > 0 && m.fields[m.section][0].fieldType <= fieldFloat {
			m.fields[m.section][0].textInput.Focus()
		}
		return m, nil
	}

	if m.section == sectionSummary {
		// Save and quit
		m.applyFields()
		if err := config.Save(m.cfg); err != nil {
			m.err = err
		} else {
			m.saved = true
		}
		m.quitting = true
		return m, tea.Quit
	}

	// Move to next field or section
	return m.handleNext()
}

func (m wizardModel) handleNext() (tea.Model, tea.Cmd) {
	if m.section == sectionWelcome {
		m.section = sectionConnection
		m.fieldIndex = 0
		if len(m.fields[m.section]) > 0 && m.fields[m.section][0].fieldType <= fieldFloat {
			m.fields[m.section][0].textInput.Focus()
		}
		return m, nil
	}

	if m.section == sectionSummary {
		return m, nil
	}

	// Unfocus current
	if len(m.fields[m.section]) > 0 && m.fieldIndex < len(m.fields[m.section]) {
		m.fields[m.section][m.fieldIndex].textInput.Blur()
	}

	m.fieldIndex++
	if m.fieldIndex >= len(m.fields[m.section]) {
		// Move to next section
		m.section++
		m.fieldIndex = 0
	}

	// Focus new field
	if m.section < sectionSummary && len(m.fields[m.section]) > 0 {
		f := &m.fields[m.section][m.fieldIndex]
		if f.fieldType <= fieldFloat {
			f.textInput.Focus()
		}
	}

	return m, nil
}

func (m wizardModel) handlePrev() (tea.Model, tea.Cmd) {
	if m.section == sectionWelcome {
		return m, nil
	}

	// Unfocus current
	if m.section < sectionSummary && len(m.fields[m.section]) > 0 && m.fieldIndex < len(m.fields[m.section]) {
		m.fields[m.section][m.fieldIndex].textInput.Blur()
	}

	m.fieldIndex--
	if m.fieldIndex < 0 {
		// Move to previous section
		if m.section > sectionConnection {
			m.section--
			m.fieldIndex = len(m.fields[m.section]) - 1
		} else {
			m.fieldIndex = 0
		}
	}

	// Focus new field
	if m.section < sectionSummary && len(m.fields[m.section]) > 0 {
		f := &m.fields[m.section][m.fieldIndex]
		if f.fieldType <= fieldFloat {
			f.textInput.Focus()
		}
	}

	return m, nil
}

func (m *wizardModel) applyFields() {
	// Connection
	for _, f := range m.fields[sectionConnection] {
		switch f.name {
		case "host":
			m.cfg.Connection.Host = f.textInput.Value()
		case "port":
			if v, err := strconv.Atoi(f.textInput.Value()); err == nil {
				m.cfg.Connection.Port = v
			}
		case "receiver_lat":
			if v, err := strconv.ParseFloat(f.textInput.Value(), 64); err == nil {
				m.cfg.Connection.ReceiverLat = v
			}
		case "receiver_lon":
			if v, err := strconv.ParseFloat(f.textInput.Value(), 64); err == nil {
				m.cfg.Connection.ReceiverLon = v
			}
		case "auto_reconnect":
			m.cfg.Connection.AutoReconnect = f.boolValue
		}
	}

	// Display
	for _, f := range m.fields[sectionDisplay] {
		switch f.name {
		case "theme":
			if f.selectIndex < len(f.optionKeys) {
				m.cfg.Display.Theme = f.optionKeys[f.selectIndex]
			}
		case "show_labels":
			m.cfg.Display.ShowLabels = f.boolValue
		case "show_trails":
			m.cfg.Display.ShowTrails = f.boolValue
		case "show_acars":
			m.cfg.Display.ShowACARS = f.boolValue
		case "show_target_list":
			m.cfg.Display.ShowTargetList = f.boolValue
		case "show_vu_meters":
			m.cfg.Display.ShowVUMeters = f.boolValue
		case "show_spectrum":
			m.cfg.Display.ShowSpectrum = f.boolValue
		case "refresh_rate":
			if v, err := strconv.Atoi(f.textInput.Value()); err == nil {
				m.cfg.Display.RefreshRate = v
			}
		}
	}

	// Radar
	for _, f := range m.fields[sectionRadar] {
		switch f.name {
		case "default_range":
			if v, err := strconv.Atoi(f.textInput.Value()); err == nil {
				m.cfg.Radar.DefaultRange = v
			}
		case "range_rings":
			if v, err := strconv.Atoi(f.textInput.Value()); err == nil {
				m.cfg.Radar.RangeRings = v
			}
		case "sweep_speed":
			if v, err := strconv.Atoi(f.textInput.Value()); err == nil {
				m.cfg.Radar.SweepSpeed = v
			}
		case "show_compass":
			m.cfg.Radar.ShowCompass = f.boolValue
		case "show_grid":
			m.cfg.Radar.ShowGrid = f.boolValue
		case "show_overlays":
			m.cfg.Radar.ShowOverlays = f.boolValue
		}
	}

	// Audio
	for _, f := range m.fields[sectionAudio] {
		switch f.name {
		case "audio_enabled":
			m.cfg.Audio.Enabled = f.boolValue
		case "new_aircraft_sound":
			m.cfg.Audio.NewAircraftSound = f.boolValue
		case "emergency_sound":
			m.cfg.Audio.EmergencySound = f.boolValue
		case "military_sound":
			m.cfg.Audio.MilitarySound = f.boolValue
		}
	}
}

func (m wizardModel) View() string {
	if m.quitting {
		if m.err != nil {
			return m.errorStyle.Render(fmt.Sprintf("\n  Error saving configuration: %v\n\n", m.err))
		}
		if m.saved {
			return m.successStyle.Render("\n  Configuration saved to ~/.config/skyspy/settings.json\n\n")
		}
		return "\n  Configuration wizard cancelled.\n\n"
	}

	var b strings.Builder

	// Header
	b.WriteString("\n")
	b.WriteString(m.titleStyle.Render("  SKYSPY CONFIGURATION WIZARD"))
	b.WriteString("\n\n")

	// Progress indicator
	b.WriteString("  ")
	for i, name := range m.sectionNames {
		if i == m.section {
			b.WriteString(m.selectedStyle.Render(fmt.Sprintf("[%s]", name)))
		} else if i < m.section {
			b.WriteString(m.successStyle.Render(fmt.Sprintf("[%s]", name)))
		} else {
			b.WriteString(m.dimStyle.Render(fmt.Sprintf("[%s]", name)))
		}
		if i < len(m.sectionNames)-1 {
			b.WriteString(m.dimStyle.Render(" > "))
		}
	}
	b.WriteString("\n\n")

	// Section content
	switch m.section {
	case sectionWelcome:
		b.WriteString(m.renderWelcome())
	case sectionSummary:
		b.WriteString(m.renderSummary())
	default:
		b.WriteString(m.renderFields())
	}

	// Navigation help
	b.WriteString("\n")
	if m.section == sectionWelcome {
		b.WriteString(m.helpStyle.Render("  Press Enter to start, q to quit"))
	} else if m.section == sectionSummary {
		b.WriteString(m.helpStyle.Render("  Press Enter to save, Esc to go back, q to quit without saving"))
	} else {
		b.WriteString(m.helpStyle.Render("  Tab/Down: next  Shift+Tab/Up: previous  Space: toggle  Esc: back"))
	}
	b.WriteString("\n")

	return b.String()
}

func (m wizardModel) renderWelcome() string {
	var b strings.Builder

	welcome := `  Welcome to the SkySpy Configuration Wizard!

  This wizard will help you configure:

    1. Connection  - Server host, port, and receiver location
    2. Display     - Theme, panels, and visual options
    3. Radar       - Range, rings, and radar appearance
    4. Audio       - Sound alerts and notifications

  Your settings will be saved to:
    ~/.config/skyspy/settings.json

  You can also edit this file directly or use command-line flags
  to override individual settings.`

	b.WriteString(m.labelStyle.Render(welcome))
	b.WriteString("\n")

	return b.String()
}

func (m wizardModel) renderFields() string {
	var b strings.Builder

	sectionName := m.sectionNames[m.section]
	b.WriteString(m.sectionStyle.Render(fmt.Sprintf("  %s Settings", sectionName)))
	b.WriteString("\n\n")

	for i, f := range m.fields[m.section] {
		isSelected := i == m.fieldIndex

		// Label
		label := f.label
		if isSelected {
			b.WriteString(m.selectedStyle.Render(fmt.Sprintf("  > %s: ", label)))
		} else {
			b.WriteString(m.labelStyle.Render(fmt.Sprintf("    %s: ", label)))
		}

		// Value
		switch f.fieldType {
		case fieldText, fieldNumber, fieldFloat:
			if isSelected {
				b.WriteString(f.textInput.View())
			} else {
				b.WriteString(m.valueStyle.Render(f.textInput.Value()))
			}
		case fieldBool:
			if f.boolValue {
				b.WriteString(m.successStyle.Render("[ON] "))
				b.WriteString(m.dimStyle.Render("OFF"))
			} else {
				b.WriteString(m.dimStyle.Render("ON "))
				b.WriteString(m.errorStyle.Render("[OFF]"))
			}
		case fieldSelect:
			if isSelected {
				// Show current option with arrows
				b.WriteString(m.dimStyle.Render("< "))
				b.WriteString(m.valueStyle.Render(f.options[f.selectIndex]))
				b.WriteString(m.dimStyle.Render(" >"))
			} else {
				b.WriteString(m.valueStyle.Render(f.options[f.selectIndex]))
			}
		}

		b.WriteString("\n")

		// Help text for selected field
		if isSelected && f.help != "" {
			b.WriteString(m.helpStyle.Render(fmt.Sprintf("      %s", f.help)))
			b.WriteString("\n")
		}
	}

	return b.String()
}

func (m wizardModel) renderSummary() string {
	var b strings.Builder

	b.WriteString(m.sectionStyle.Render("  Configuration Summary"))
	b.WriteString("\n\n")

	// Connection
	b.WriteString(m.labelStyle.Render("  Connection:\n"))
	for _, f := range m.fields[sectionConnection] {
		value := ""
		switch f.fieldType {
		case fieldText, fieldNumber, fieldFloat:
			value = f.textInput.Value()
		case fieldBool:
			if f.boolValue {
				value = "ON"
			} else {
				value = "OFF"
			}
		}
		b.WriteString(fmt.Sprintf("    %s: %s\n", m.dimStyle.Render(f.label), m.valueStyle.Render(value)))
	}
	b.WriteString("\n")

	// Display
	b.WriteString(m.labelStyle.Render("  Display:\n"))
	for _, f := range m.fields[sectionDisplay] {
		value := ""
		switch f.fieldType {
		case fieldText, fieldNumber, fieldFloat:
			value = f.textInput.Value()
		case fieldBool:
			if f.boolValue {
				value = "ON"
			} else {
				value = "OFF"
			}
		case fieldSelect:
			value = f.optionKeys[f.selectIndex]
		}
		b.WriteString(fmt.Sprintf("    %s: %s\n", m.dimStyle.Render(f.label), m.valueStyle.Render(value)))
	}
	b.WriteString("\n")

	// Radar
	b.WriteString(m.labelStyle.Render("  Radar:\n"))
	for _, f := range m.fields[sectionRadar] {
		value := ""
		switch f.fieldType {
		case fieldText, fieldNumber, fieldFloat:
			value = f.textInput.Value()
		case fieldBool:
			if f.boolValue {
				value = "ON"
			} else {
				value = "OFF"
			}
		}
		b.WriteString(fmt.Sprintf("    %s: %s\n", m.dimStyle.Render(f.label), m.valueStyle.Render(value)))
	}
	b.WriteString("\n")

	// Audio
	b.WriteString(m.labelStyle.Render("  Audio:\n"))
	for _, f := range m.fields[sectionAudio] {
		value := ""
		switch f.fieldType {
		case fieldText, fieldNumber, fieldFloat:
			value = f.textInput.Value()
		case fieldBool:
			if f.boolValue {
				value = "ON"
			} else {
				value = "OFF"
			}
		}
		b.WriteString(fmt.Sprintf("    %s: %s\n", m.dimStyle.Render(f.label), m.valueStyle.Render(value)))
	}

	return b.String()
}

func runConfigure(cmd *cobra.Command, args []string) error {
	// Load existing configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Create and run the wizard
	model := newWizardModel(cfg)
	p := tea.NewProgram(model)

	if _, err := p.Run(); err != nil {
		return err
	}

	return nil
}
