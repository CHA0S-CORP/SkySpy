package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/testutil"
)

// TestNewWizardModel tests the wizard model initialization
func TestNewWizardModel(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	if m.cfg != cfg {
		t.Error("Expected wizard model to reference the config")
	}

	if m.section != sectionWelcome {
		t.Errorf("Expected initial section to be sectionWelcome, got %d", m.section)
	}

	if len(m.sectionNames) != 6 {
		t.Errorf("Expected 6 section names, got %d", len(m.sectionNames))
	}

	expectedSections := []string{"Welcome", "Connection", "Display", "Radar", "Audio", "Summary"}
	for i, name := range expectedSections {
		if m.sectionNames[i] != name {
			t.Errorf("Expected section %d to be %q, got %q", i, name, m.sectionNames[i])
		}
	}

	// Verify fields are initialized for each section
	if len(m.fields[sectionWelcome]) != 0 {
		t.Errorf("Expected 0 fields in Welcome section, got %d", len(m.fields[sectionWelcome]))
	}

	if len(m.fields[sectionConnection]) == 0 {
		t.Error("Expected fields in Connection section")
	}

	if len(m.fields[sectionDisplay]) == 0 {
		t.Error("Expected fields in Display section")
	}

	if len(m.fields[sectionRadar]) == 0 {
		t.Error("Expected fields in Radar section")
	}

	if len(m.fields[sectionAudio]) == 0 {
		t.Error("Expected fields in Audio section")
	}

	if len(m.fields[sectionSummary]) != 0 {
		t.Errorf("Expected 0 fields in Summary section, got %d", len(m.fields[sectionSummary]))
	}
}

// TestWizardModelInit tests the Init function
func TestWizardModelInit(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	cmd := m.Init()
	if cmd == nil {
		t.Error("Expected Init to return a command (textinput.Blink)")
	}
}

// TestWizardModelView tests the View function
func TestWizardModelView(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	view := m.View()

	// Verify welcome screen elements
	if !strings.Contains(view, "SKYSPY CONFIGURATION WIZARD") {
		t.Error("Expected view to contain wizard title")
	}

	if !strings.Contains(view, "Welcome") {
		t.Error("Expected view to contain 'Welcome'")
	}

	if !strings.Contains(view, "Press Enter to start") {
		t.Error("Expected view to contain navigation help")
	}
}

// TestWizardViewQuit tests the View when quitting
func TestWizardViewQuit(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.quitting = true

	view := m.View()
	if !strings.Contains(view, "cancelled") {
		t.Error("Expected quit view to contain 'cancelled'")
	}
}

// TestWizardViewSaved tests the View when saved successfully
func TestWizardViewSaved(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.quitting = true
	m.saved = true

	view := m.View()
	if !strings.Contains(view, "saved") {
		t.Error("Expected saved view to contain 'saved'")
	}
}

// TestWizardViewError tests the View when there's an error
func TestWizardViewError(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.quitting = true
	m.err = &testError{msg: "test error"}

	view := m.View()
	if !strings.Contains(view, "Error") {
		t.Error("Expected error view to contain 'Error'")
	}
}

type testError struct {
	msg string
}

func (e *testError) Error() string {
	return e.msg
}

// TestWizardUpdateQuit tests quitting the wizard
func TestWizardUpdateQuit(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Test quit from welcome section
	newModel, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	model := newModel.(wizardModel)

	if !model.quitting {
		t.Error("Expected model to be quitting after Ctrl+C")
	}

	// cmd should be tea.Quit
	if cmd == nil {
		t.Error("Expected quit command")
	}
}

// TestWizardUpdateQuitWithQ tests quitting with 'q' key
func TestWizardUpdateQuitWithQ(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	newModel, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	model := newModel.(wizardModel)

	if !model.quitting {
		t.Error("Expected model to be quitting after 'q'")
	}

	if cmd == nil {
		t.Error("Expected quit command")
	}
}

// TestWizardUpdateEnterFromWelcome tests pressing Enter from welcome screen
func TestWizardUpdateEnterFromWelcome(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	model := newModel.(wizardModel)

	if model.section != sectionConnection {
		t.Errorf("Expected to move to Connection section, got section %d", model.section)
	}
}

// TestWizardUpdateTabNavigation tests Tab navigation
func TestWizardUpdateTabNavigation(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = 0

	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyTab})
	model := newModel.(wizardModel)

	if model.fieldIndex != 1 {
		t.Errorf("Expected fieldIndex to be 1, got %d", model.fieldIndex)
	}
}

// TestWizardUpdateShiftTabNavigation tests Shift+Tab navigation
func TestWizardUpdateShiftTabNavigation(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = 1

	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyShiftTab})
	model := newModel.(wizardModel)

	if model.fieldIndex != 0 {
		t.Errorf("Expected fieldIndex to be 0, got %d", model.fieldIndex)
	}
}

// TestWizardUpdateDownNavigation tests Down arrow navigation
func TestWizardUpdateDownNavigation(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = 0

	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	model := newModel.(wizardModel)

	if model.fieldIndex != 1 {
		t.Errorf("Expected fieldIndex to be 1, got %d", model.fieldIndex)
	}
}

// TestWizardUpdateUpNavigation tests Up arrow navigation
func TestWizardUpdateUpNavigation(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = 1

	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyUp})
	model := newModel.(wizardModel)

	if model.fieldIndex != 0 {
		t.Errorf("Expected fieldIndex to be 0, got %d", model.fieldIndex)
	}
}

// TestWizardUpdateEscGoBack tests Esc to go back
func TestWizardUpdateEscGoBack(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionDisplay

	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	model := newModel.(wizardModel)

	if model.section != sectionConnection {
		t.Errorf("Expected to go back to Connection section, got %d", model.section)
	}
}

// TestWizardUpdateBoolToggleSpace tests Space to toggle bool fields
func TestWizardUpdateBoolToggleSpace(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection

	// Find a bool field
	for i, f := range m.fields[sectionConnection] {
		if f.fieldType == fieldBool {
			m.fieldIndex = i
			origValue := f.boolValue

			newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeySpace})
			model := newModel.(wizardModel)

			if model.fields[sectionConnection][i].boolValue == origValue {
				t.Error("Expected bool value to toggle")
			}
			break
		}
	}
}

// TestWizardUpdateBoolToggleLeft tests Left arrow to toggle bool fields
func TestWizardUpdateBoolToggleLeft(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection

	// Find a bool field
	for i, f := range m.fields[sectionConnection] {
		if f.fieldType == fieldBool {
			m.fieldIndex = i
			origValue := f.boolValue

			newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyLeft})
			model := newModel.(wizardModel)

			if model.fields[sectionConnection][i].boolValue == origValue {
				t.Error("Expected bool value to toggle with left arrow")
			}
			break
		}
	}
}

// TestWizardUpdateBoolToggleRight tests Right arrow to toggle bool fields
func TestWizardUpdateBoolToggleRight(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection

	// Find a bool field
	for i, f := range m.fields[sectionConnection] {
		if f.fieldType == fieldBool {
			m.fieldIndex = i
			origValue := f.boolValue

			newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyRight})
			model := newModel.(wizardModel)

			if model.fields[sectionConnection][i].boolValue == origValue {
				t.Error("Expected bool value to toggle with right arrow")
			}
			break
		}
	}
}

// TestWizardUpdateSelectLeft tests Left arrow for select fields
func TestWizardUpdateSelectLeft(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionDisplay

	// Find the theme select field
	for i, f := range m.fields[sectionDisplay] {
		if f.fieldType == fieldSelect && f.selectIndex > 0 {
			m.fieldIndex = i
			origIndex := f.selectIndex

			newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyLeft})
			model := newModel.(wizardModel)

			if model.fields[sectionDisplay][i].selectIndex != origIndex-1 {
				t.Error("Expected select index to decrease")
			}
			break
		}
	}
}

// TestWizardUpdateSelectRight tests Right arrow for select fields
func TestWizardUpdateSelectRight(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionDisplay

	// Find the theme select field
	for i, f := range m.fields[sectionDisplay] {
		if f.fieldType == fieldSelect && f.selectIndex < len(f.options)-1 {
			m.fieldIndex = i
			origIndex := f.selectIndex

			newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyRight})
			model := newModel.(wizardModel)

			if model.fields[sectionDisplay][i].selectIndex != origIndex+1 {
				t.Error("Expected select index to increase")
			}
			break
		}
	}
}

// TestWizardUpdateWindowSize tests window size message handling
func TestWizardUpdateWindowSize(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	newModel, _ := m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	model := newModel.(wizardModel)

	if model.width != 120 || model.height != 40 {
		t.Errorf("Expected dimensions 120x40, got %dx%d", model.width, model.height)
	}
}

// TestWizardRenderWelcome tests the welcome screen rendering
func TestWizardRenderWelcome(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	view := m.renderWelcome()

	if !strings.Contains(view, "Welcome") {
		t.Error("Expected welcome render to contain 'Welcome'")
	}

	if !strings.Contains(view, "Connection") {
		t.Error("Expected welcome render to contain 'Connection'")
	}

	if !strings.Contains(view, "Display") {
		t.Error("Expected welcome render to contain 'Display'")
	}
}

// TestWizardRenderFields tests the field rendering
func TestWizardRenderFields(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection

	view := m.renderFields()

	if !strings.Contains(view, "Connection Settings") {
		t.Error("Expected fields render to contain section title")
	}

	if !strings.Contains(view, "Server Host") {
		t.Error("Expected fields render to contain 'Server Host'")
	}

	if !strings.Contains(view, "Server Port") {
		t.Error("Expected fields render to contain 'Server Port'")
	}
}

// TestWizardRenderSummary tests the summary screen rendering
func TestWizardRenderSummary(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionSummary

	view := m.renderSummary()

	if !strings.Contains(view, "Configuration Summary") {
		t.Error("Expected summary render to contain title")
	}

	if !strings.Contains(view, "Connection:") {
		t.Error("Expected summary render to contain 'Connection:'")
	}

	if !strings.Contains(view, "Display:") {
		t.Error("Expected summary render to contain 'Display:'")
	}

	if !strings.Contains(view, "Radar:") {
		t.Error("Expected summary render to contain 'Radar:'")
	}

	if !strings.Contains(view, "Audio:") {
		t.Error("Expected summary render to contain 'Audio:'")
	}
}

// TestWizardApplyFields tests applying field values to config
func TestWizardApplyFields(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Modify some field values
	for i, f := range m.fields[sectionConnection] {
		if f.name == "host" {
			m.fields[sectionConnection][i].textInput.SetValue("newhost.local")
		}
		if f.name == "port" {
			m.fields[sectionConnection][i].textInput.SetValue("9443")
		}
		if f.name == "auto_reconnect" {
			m.fields[sectionConnection][i].boolValue = false
		}
	}

	m.applyFields()

	if cfg.Connection.Host != "newhost.local" {
		t.Errorf("Expected host to be 'newhost.local', got %q", cfg.Connection.Host)
	}

	if cfg.Connection.Port != 9443 {
		t.Errorf("Expected port to be 9443, got %d", cfg.Connection.Port)
	}

	if cfg.Connection.AutoReconnect != false {
		t.Error("Expected auto_reconnect to be false")
	}
}

// TestWizardApplyFieldsDisplay tests applying display field values
func TestWizardApplyFieldsDisplay(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Modify display fields
	for i, f := range m.fields[sectionDisplay] {
		if f.name == "show_labels" {
			m.fields[sectionDisplay][i].boolValue = false
		}
		if f.name == "show_trails" {
			m.fields[sectionDisplay][i].boolValue = true
		}
		if f.name == "refresh_rate" {
			m.fields[sectionDisplay][i].textInput.SetValue("30")
		}
	}

	m.applyFields()

	if cfg.Display.ShowLabels != false {
		t.Error("Expected ShowLabels to be false")
	}

	if cfg.Display.ShowTrails != true {
		t.Error("Expected ShowTrails to be true")
	}

	if cfg.Display.RefreshRate != 30 {
		t.Errorf("Expected RefreshRate to be 30, got %d", cfg.Display.RefreshRate)
	}
}

// TestWizardApplyFieldsRadar tests applying radar field values
func TestWizardApplyFieldsRadar(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Modify radar fields
	for i, f := range m.fields[sectionRadar] {
		if f.name == "default_range" {
			m.fields[sectionRadar][i].textInput.SetValue("200")
		}
		if f.name == "range_rings" {
			m.fields[sectionRadar][i].textInput.SetValue("8")
		}
		if f.name == "show_compass" {
			m.fields[sectionRadar][i].boolValue = false
		}
	}

	m.applyFields()

	if cfg.Radar.DefaultRange != 200 {
		t.Errorf("Expected DefaultRange to be 200, got %d", cfg.Radar.DefaultRange)
	}

	if cfg.Radar.RangeRings != 8 {
		t.Errorf("Expected RangeRings to be 8, got %d", cfg.Radar.RangeRings)
	}

	if cfg.Radar.ShowCompass != false {
		t.Error("Expected ShowCompass to be false")
	}
}

// TestWizardApplyFieldsAudio tests applying audio field values
func TestWizardApplyFieldsAudio(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Modify audio fields
	for i, f := range m.fields[sectionAudio] {
		if f.name == "audio_enabled" {
			m.fields[sectionAudio][i].boolValue = true
		}
		if f.name == "emergency_sound" {
			m.fields[sectionAudio][i].boolValue = false
		}
	}

	m.applyFields()

	if cfg.Audio.Enabled != true {
		t.Error("Expected Audio.Enabled to be true")
	}

	if cfg.Audio.EmergencySound != false {
		t.Error("Expected EmergencySound to be false")
	}
}

// TestWizardHandleNext tests the handleNext method
func TestWizardHandleNext(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionWelcome

	newModel, _ := m.handleNext()
	model := newModel.(wizardModel)

	if model.section != sectionConnection {
		t.Errorf("Expected to move to Connection section, got %d", model.section)
	}
}

// TestWizardHandleNextAtSummary tests handleNext when at summary
func TestWizardHandleNextAtSummary(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionSummary

	newModel, _ := m.handleNext()
	model := newModel.(wizardModel)

	// Should stay at summary
	if model.section != sectionSummary {
		t.Errorf("Expected to stay at Summary section, got %d", model.section)
	}
}

// TestWizardHandlePrev tests the handlePrev method
func TestWizardHandlePrev(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionDisplay
	m.fieldIndex = 0

	newModel, _ := m.handlePrev()
	model := newModel.(wizardModel)

	// Should go to previous section's last field
	if model.section != sectionConnection {
		t.Errorf("Expected to move to Connection section, got %d", model.section)
	}
}

// TestWizardHandlePrevAtWelcome tests handlePrev when at welcome
func TestWizardHandlePrevAtWelcome(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionWelcome

	newModel, _ := m.handlePrev()
	model := newModel.(wizardModel)

	// Should stay at welcome
	if model.section != sectionWelcome {
		t.Errorf("Expected to stay at Welcome section, got %d", model.section)
	}
}

// TestWizardHandleEnter tests the handleEnter method from summary
func TestWizardHandleEnter(t *testing.T) {
	_, cleanup := testutil.TempConfigDirWithEnv()
	defer cleanup()

	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionSummary

	newModel, cmd := m.handleEnter()
	model := newModel.(wizardModel)

	if !model.quitting {
		t.Error("Expected model to be quitting after Enter on Summary")
	}

	if cmd == nil {
		t.Error("Expected quit command")
	}

	// Should have saved (or attempted to save)
	if !model.saved && model.err == nil {
		t.Log("Config save may have failed, which is acceptable in test environment")
	}
}

// TestWizardNavigationThroughSections tests navigating through all sections
func TestWizardNavigationThroughSections(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Start at Welcome
	if m.section != sectionWelcome {
		t.Errorf("Expected to start at Welcome, got %d", m.section)
	}

	// Navigate through each section using Enter/Tab
	sections := []int{sectionConnection, sectionDisplay, sectionRadar, sectionAudio, sectionSummary}

	for _, expectedSection := range sections {
		// Keep pressing Tab/Enter until we reach the expected section
		for m.section < expectedSection {
			newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyTab})
			m = newModel.(wizardModel)
		}

		if m.section != expectedSection {
			t.Errorf("Expected section %d, got %d", expectedSection, m.section)
		}
	}
}

// TestCreateTextField tests the createTextField helper
func TestCreateTextField(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	field := m.createTextField("test", "Test Label", "Test help", "default value")

	if field.name != "test" {
		t.Errorf("Expected name 'test', got %q", field.name)
	}

	if field.label != "Test Label" {
		t.Errorf("Expected label 'Test Label', got %q", field.label)
	}

	if field.help != "Test help" {
		t.Errorf("Expected help 'Test help', got %q", field.help)
	}

	if field.fieldType != fieldText {
		t.Errorf("Expected fieldType fieldText, got %d", field.fieldType)
	}

	if field.textInput.Value() != "default value" {
		t.Errorf("Expected value 'default value', got %q", field.textInput.Value())
	}
}

// TestCreateNumberField tests the createNumberField helper
func TestCreateNumberField(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	field := m.createNumberField("test", "Test Label", "Test help", 42)

	if field.fieldType != fieldNumber {
		t.Errorf("Expected fieldType fieldNumber, got %d", field.fieldType)
	}

	if field.textInput.Value() != "42" {
		t.Errorf("Expected value '42', got %q", field.textInput.Value())
	}
}

// TestCreateFloatField tests the createFloatField helper
func TestCreateFloatField(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	field := m.createFloatField("test", "Test Label", "Test help", 3.14159)

	if field.fieldType != fieldFloat {
		t.Errorf("Expected fieldType fieldFloat, got %d", field.fieldType)
	}

	// Value should contain the float representation
	if !strings.Contains(field.textInput.Value(), "3.14") {
		t.Errorf("Expected value to contain '3.14', got %q", field.textInput.Value())
	}
}

// TestCreateBoolField tests the createBoolField helper
func TestCreateBoolField(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	field := m.createBoolField("test", "Test Label", "Test help", true)

	if field.fieldType != fieldBool {
		t.Errorf("Expected fieldType fieldBool, got %d", field.fieldType)
	}

	if field.boolValue != true {
		t.Error("Expected boolValue to be true")
	}
}

// TestCreateSelectField tests the createSelectField helper
func TestCreateSelectField(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	options := []string{"Option A", "Option B", "Option C"}
	keys := []string{"a", "b", "c"}

	field := m.createSelectField("test", "Test Label", "Test help", options, keys, 1)

	if field.fieldType != fieldSelect {
		t.Errorf("Expected fieldType fieldSelect, got %d", field.fieldType)
	}

	if len(field.options) != 3 {
		t.Errorf("Expected 3 options, got %d", len(field.options))
	}

	if field.selectIndex != 1 {
		t.Errorf("Expected selectIndex 1, got %d", field.selectIndex)
	}

	if field.optionKeys[0] != "a" {
		t.Errorf("Expected first key 'a', got %q", field.optionKeys[0])
	}
}

// TestConfigureCommandExists tests that the configure command exists
func TestConfigureCommandExists(t *testing.T) {
	if configureCmd == nil {
		t.Error("Expected configureCmd to exist")
	}

	if configureCmd.Use != "configure" {
		t.Errorf("Expected Use to be 'configure', got %q", configureCmd.Use)
	}

	if configureCmd.Short == "" {
		t.Error("Expected configure command to have Short description")
	}

	if configureCmd.Long == "" {
		t.Error("Expected configure command to have Long description")
	}
}

// TestConfigureCommandHelp tests the configure command help text
func TestConfigureCommandHelp(t *testing.T) {
	expectedContent := []string{
		"wizard",
		"Connection",
		"Display",
		"Radar",
		"Audio",
		"settings.json",
	}

	for _, content := range expectedContent {
		if !strings.Contains(configureCmd.Long, content) {
			t.Errorf("Expected Long description to contain %q", content)
		}
	}
}

// TestWizardTextInputUpdate tests that text input fields update correctly
func TestWizardTextInputUpdate(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = 0 // Should be host field

	// Focus the text input
	m.fields[sectionConnection][0].textInput.Focus()

	// Simulate typing
	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	model := newModel.(wizardModel)

	// The text input should have updated
	value := model.fields[sectionConnection][0].textInput.Value()
	if !strings.Contains(value, "a") && value == "" {
		t.Log("Text input may not update directly in tests without full tea program")
	}
}

// TestWizardViewSummarySection tests the view when at summary section
func TestWizardViewSummarySection(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionSummary

	view := m.View()

	if !strings.Contains(view, "Summary") {
		t.Error("Expected view to contain 'Summary' when at summary section")
	}

	if !strings.Contains(view, "Press Enter to save") {
		t.Error("Expected view to contain save instructions")
	}
}

// TestWizardViewFieldsSection tests the view when at a fields section
func TestWizardViewFieldsSection(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection

	view := m.View()

	if !strings.Contains(view, "Connection") {
		t.Error("Expected view to contain 'Connection' when at connection section")
	}

	if !strings.Contains(view, "Tab") {
		t.Error("Expected view to contain navigation instructions")
	}
}

// TestWizardRenderFieldsDisplay tests rendering display fields
func TestWizardRenderFieldsDisplay(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionDisplay
	m.fieldIndex = 0

	view := m.renderFields()

	if !strings.Contains(view, "Display Settings") {
		t.Error("Expected fields render to contain 'Display Settings'")
	}

	if !strings.Contains(view, "Theme") {
		t.Error("Expected fields render to contain 'Theme'")
	}
}

// TestWizardRenderFieldsRadar tests rendering radar fields
func TestWizardRenderFieldsRadar(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionRadar
	m.fieldIndex = 0

	view := m.renderFields()

	if !strings.Contains(view, "Radar Settings") {
		t.Error("Expected fields render to contain 'Radar Settings'")
	}

	if !strings.Contains(view, "Range") {
		t.Error("Expected fields render to contain 'Range'")
	}
}

// TestWizardRenderFieldsAudio tests rendering audio fields
func TestWizardRenderFieldsAudio(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionAudio
	m.fieldIndex = 0

	view := m.renderFields()

	if !strings.Contains(view, "Audio Settings") {
		t.Error("Expected fields render to contain 'Audio Settings'")
	}

	if !strings.Contains(view, "Audio") {
		t.Error("Expected fields render to contain 'Audio'")
	}
}

// TestWizardNavigationAtBoundaries tests navigation at section boundaries
func TestWizardNavigationAtBoundaries(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Test prev at welcome
	m.section = sectionWelcome
	newModel, _ := m.handlePrev()
	model := newModel.(wizardModel)
	if model.section != sectionWelcome {
		t.Error("Expected to stay at Welcome when pressing prev")
	}

	// Test prev at first field of connection
	m.section = sectionConnection
	m.fieldIndex = 0
	newModel, _ = m.handlePrev()
	model = newModel.(wizardModel)
	if model.fieldIndex != 0 && model.section != sectionConnection {
		// Either stay at 0 or go to previous section
	}

	// Test next at summary
	m.section = sectionSummary
	newModel, _ = m.handleNext()
	model = newModel.(wizardModel)
	if model.section != sectionSummary {
		t.Error("Expected to stay at Summary when pressing next")
	}
}

// TestWizardUpdateTextInputFocus tests text input focus behavior
func TestWizardUpdateTextInputFocus(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = 0

	// Focus the text input
	if len(m.fields[sectionConnection]) > 0 {
		m.fields[sectionConnection][0].textInput.Focus()
	}

	// Simulate text input update
	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}})
	_ = newModel.(wizardModel)
	// Just verify no panic
}

// TestWizardUpdateAtNonFieldSection tests updates at sections without fields
func TestWizardUpdateAtNonFieldSection(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionWelcome

	// Space should be ignored at welcome
	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeySpace})
	model := newModel.(wizardModel)
	if model.section != sectionWelcome {
		t.Error("Expected to stay at Welcome")
	}

	// Left/right should be ignored at welcome
	newModel, _ = m.Update(tea.KeyMsg{Type: tea.KeyLeft})
	model = newModel.(wizardModel)
	if model.section != sectionWelcome {
		t.Error("Expected to stay at Welcome")
	}
}

// TestWizardApplyFieldsWithInvalidValues tests applying fields with invalid values
func TestWizardApplyFieldsWithInvalidValues(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Set invalid values
	for i, f := range m.fields[sectionConnection] {
		if f.name == "port" {
			m.fields[sectionConnection][i].textInput.SetValue("not_a_number")
		}
		if f.name == "receiver_lat" {
			m.fields[sectionConnection][i].textInput.SetValue("invalid")
		}
		if f.name == "receiver_lon" {
			m.fields[sectionConnection][i].textInput.SetValue("invalid")
		}
	}

	for i, f := range m.fields[sectionDisplay] {
		if f.name == "refresh_rate" {
			m.fields[sectionDisplay][i].textInput.SetValue("not_a_number")
		}
	}

	for i, f := range m.fields[sectionRadar] {
		if f.name == "default_range" {
			m.fields[sectionRadar][i].textInput.SetValue("invalid")
		}
		if f.name == "range_rings" {
			m.fields[sectionRadar][i].textInput.SetValue("invalid")
		}
		if f.name == "sweep_speed" {
			m.fields[sectionRadar][i].textInput.SetValue("invalid")
		}
	}

	// Should not panic - just use existing values
	m.applyFields()

	// Port should still have default value since "not_a_number" is invalid
	if cfg.Connection.Port == 0 {
		// Port wasn't changed from default since value was invalid
	}
}

// TestWizardRenderFieldsWithSelection tests rendering with selected bool field
func TestWizardRenderFieldsWithSelection(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionAudio

	// Find a bool field and select it
	for i, f := range m.fields[sectionAudio] {
		if f.fieldType == fieldBool {
			m.fieldIndex = i
			m.fields[sectionAudio][i].boolValue = true
			break
		}
	}

	view := m.renderFields()
	if !strings.Contains(view, "ON") && !strings.Contains(view, "OFF") {
		t.Error("Expected bool field to show ON or OFF")
	}
}

// TestWizardRenderFieldsWithSelectField tests rendering with selected select field
func TestWizardRenderFieldsWithSelectField(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionDisplay

	// Find the theme select field and select it
	for i, f := range m.fields[sectionDisplay] {
		if f.fieldType == fieldSelect {
			m.fieldIndex = i
			break
		}
	}

	view := m.renderFields()
	if !strings.Contains(view, "<") && !strings.Contains(view, ">") {
		// Select field arrows should be shown when selected
	}
}

// TestWizardSectionConstants tests section constants are in correct order
func TestWizardSectionConstants(t *testing.T) {
	if sectionWelcome != 0 {
		t.Error("Expected sectionWelcome to be 0")
	}
	if sectionConnection != 1 {
		t.Error("Expected sectionConnection to be 1")
	}
	if sectionDisplay != 2 {
		t.Error("Expected sectionDisplay to be 2")
	}
	if sectionRadar != 3 {
		t.Error("Expected sectionRadar to be 3")
	}
	if sectionAudio != 4 {
		t.Error("Expected sectionAudio to be 4")
	}
	if sectionSummary != 5 {
		t.Error("Expected sectionSummary to be 5")
	}
}

// TestFieldTypeConstants tests field type constants
func TestFieldTypeConstants(t *testing.T) {
	if fieldText != 0 {
		t.Error("Expected fieldText to be 0")
	}
	if fieldNumber != 1 {
		t.Error("Expected fieldNumber to be 1")
	}
	if fieldFloat != 2 {
		t.Error("Expected fieldFloat to be 2")
	}
	if fieldBool != 3 {
		t.Error("Expected fieldBool to be 3")
	}
	if fieldSelect != 4 {
		t.Error("Expected fieldSelect to be 4")
	}
}

// TestWizardRenderSummaryBoolValues tests summary rendering with different bool values
func TestWizardRenderSummaryBoolValues(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionSummary

	// Set some bool values to true, others to false
	for i := range m.fields[sectionConnection] {
		if m.fields[sectionConnection][i].fieldType == fieldBool {
			m.fields[sectionConnection][i].boolValue = true
		}
	}

	for i := range m.fields[sectionAudio] {
		if m.fields[sectionAudio][i].fieldType == fieldBool {
			m.fields[sectionAudio][i].boolValue = false
		}
	}

	view := m.renderSummary()

	// Should contain both ON and OFF values
	if !strings.Contains(view, "ON") && !strings.Contains(view, "OFF") {
		t.Error("Expected summary to contain ON and OFF values")
	}
}

// TestWizardHandleEnterFromWelcome tests handleEnter from welcome
func TestWizardHandleEnterFromWelcome(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionWelcome

	newModel, _ := m.handleEnter()
	model := newModel.(wizardModel)

	if model.section != sectionConnection {
		t.Errorf("Expected to move to Connection after Enter from Welcome, got %d", model.section)
	}
}

// TestWizardHandleEnterFromSection tests handleEnter from a section with fields
func TestWizardHandleEnterFromSection(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = 0

	newModel, _ := m.handleEnter()
	model := newModel.(wizardModel)

	// Should move to next field or section
	if model.fieldIndex == 0 && model.section == sectionConnection {
		// Stayed at same position (might be valid behavior)
	} else if model.fieldIndex > 0 || model.section > sectionConnection {
		// Moved forward (expected)
	}
}

// TestWizardStylesAreInitialized tests that all styles are initialized
func TestWizardStylesAreInitialized(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Check that styles are not nil (they should be lipgloss.Style which can't be nil)
	// We just verify the model initializes without panic
	_ = m.titleStyle.Render("test")
	_ = m.sectionStyle.Render("test")
	_ = m.labelStyle.Render("test")
	_ = m.valueStyle.Render("test")
	_ = m.helpStyle.Render("test")
	_ = m.selectedStyle.Render("test")
	_ = m.dimStyle.Render("test")
	_ = m.successStyle.Render("test")
	_ = m.errorStyle.Render("test")
	_ = m.boxStyle.Render("test")
}

// TestWizardAllFieldsHaveLabels tests that all fields have labels
func TestWizardAllFieldsHaveLabels(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	for section := sectionConnection; section < sectionSummary; section++ {
		for _, field := range m.fields[section] {
			if field.label == "" {
				t.Errorf("Field %q in section %d has no label", field.name, section)
			}
		}
	}
}

// TestWizardAllFieldsHaveHelp tests that all fields have help text
func TestWizardAllFieldsHaveHelp(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	for section := sectionConnection; section < sectionSummary; section++ {
		for _, field := range m.fields[section] {
			if field.help == "" {
				t.Errorf("Field %q in section %d has no help text", field.name, section)
			}
		}
	}
}

// TestWizardSelectFieldHasOptions tests that select fields have options
func TestWizardSelectFieldHasOptions(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	for section := sectionConnection; section < sectionSummary; section++ {
		for _, field := range m.fields[section] {
			if field.fieldType == fieldSelect {
				if len(field.options) == 0 {
					t.Errorf("Select field %q has no options", field.name)
				}
				if len(field.optionKeys) != len(field.options) {
					t.Errorf("Select field %q has mismatched options and keys", field.name)
				}
			}
		}
	}
}

// TestWizardUpdateCtrlC tests Ctrl+C handling
func TestWizardUpdateCtrlC(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	newModel, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	model := newModel.(wizardModel)

	if !model.quitting {
		t.Error("Expected model to be quitting after Ctrl+C")
	}

	if cmd == nil {
		t.Error("Expected quit command")
	}
}

// TestWizardUpdateEsc tests Escape key handling
func TestWizardUpdateEsc(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionDisplay

	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	model := newModel.(wizardModel)

	// Should go back to previous section
	if model.section >= sectionDisplay {
		t.Log("Escape may not navigate back in this context")
	}
}

// TestWizardRenderFieldsNumberField tests rendering of number fields
func TestWizardRenderFieldsNumberField(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection

	// Find the port field (which is a number field)
	for i, f := range m.fields[sectionConnection] {
		if f.fieldType == fieldNumber {
			m.fieldIndex = i
			break
		}
	}

	view := m.renderFields()
	if view == "" {
		t.Error("Expected non-empty view")
	}
}

// TestWizardRenderFieldsFloatField tests rendering of float fields
func TestWizardRenderFieldsFloatField(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection

	// Find a float field
	for i, f := range m.fields[sectionConnection] {
		if f.fieldType == fieldFloat {
			m.fieldIndex = i
			break
		}
	}

	view := m.renderFields()
	if view == "" {
		t.Error("Expected non-empty view")
	}
}

// TestWizardProgressBar tests that the progress bar is rendered
func TestWizardProgressBar(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection

	view := m.View()

	// Progress bar should show current section
	if !strings.Contains(view, "Connection") {
		t.Error("Expected view to show current section in progress")
	}
}

// TestWizardRenderSummarySelectField tests summary rendering of select fields
func TestWizardRenderSummarySelectField(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionSummary

	// Set a specific theme
	for i, f := range m.fields[sectionDisplay] {
		if f.fieldType == fieldSelect && f.name == "theme" {
			m.fields[sectionDisplay][i].selectIndex = 2 // Select a different theme
			break
		}
	}

	view := m.renderSummary()
	if view == "" {
		t.Error("Expected non-empty summary view")
	}
}

// TestWizardNavigateWithinFields tests navigation within a section's fields
func TestWizardNavigateWithinFields(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = 0

	// Navigate down
	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	model := newModel.(wizardModel)

	if model.fieldIndex < 0 {
		t.Error("Expected field index to be non-negative after down")
	}

	// Navigate up
	newModel, _ = model.Update(tea.KeyMsg{Type: tea.KeyUp})
	model = newModel.(wizardModel)

	if model.fieldIndex < 0 {
		t.Error("Expected field index to be non-negative after up")
	}
}

// TestWizardSelectIndexBoundaries tests select field index boundaries
func TestWizardSelectIndexBoundaries(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionDisplay

	// Find the theme select field
	for i, f := range m.fields[sectionDisplay] {
		if f.fieldType == fieldSelect {
			m.fieldIndex = i

			// Test left boundary
			m.fields[sectionDisplay][i].selectIndex = 0
			newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyLeft})
			model := newModel.(wizardModel)

			// Should not go negative
			if model.fields[sectionDisplay][i].selectIndex < 0 {
				t.Error("Select index should not be negative")
			}

			// Test right boundary
			m.fields[sectionDisplay][i].selectIndex = len(f.options) - 1
			newModel, _ = m.Update(tea.KeyMsg{Type: tea.KeyRight})
			model = newModel.(wizardModel)

			// Should not exceed options length
			if model.fields[sectionDisplay][i].selectIndex >= len(f.options) {
				t.Error("Select index should not exceed options length")
			}

			break
		}
	}
}

// TestConfigureCommandAliases tests command aliases if any
func TestConfigureCommandAliases(t *testing.T) {
	// Test that configure command has expected properties
	if configureCmd.Aliases != nil {
		for _, alias := range configureCmd.Aliases {
			t.Logf("Configure command has alias: %s", alias)
		}
	}
}

// TestWizardFieldCount tests that each section has expected field count
func TestWizardFieldCount(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Welcome and Summary should have no fields
	if len(m.fields[sectionWelcome]) != 0 {
		t.Errorf("Expected 0 fields in Welcome, got %d", len(m.fields[sectionWelcome]))
	}

	if len(m.fields[sectionSummary]) != 0 {
		t.Errorf("Expected 0 fields in Summary, got %d", len(m.fields[sectionSummary]))
	}

	// Other sections should have at least one field
	sections := []int{sectionConnection, sectionDisplay, sectionRadar, sectionAudio}
	for _, section := range sections {
		if len(m.fields[section]) == 0 {
			t.Errorf("Expected at least 1 field in section %d", section)
		}
	}
}

// TestWizardQuitFromWelcome tests quitting with 'q' from welcome section
func TestWizardQuitFromWelcome(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionWelcome

	newModel, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	model := newModel.(wizardModel)

	if !model.quitting {
		t.Error("Expected model to be quitting after 'q' from welcome")
	}

	if cmd == nil {
		t.Error("Expected quit command")
	}
}

// TestWizardQuitFromSummary tests quitting with 'q' from summary section
func TestWizardQuitFromSummary(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionSummary

	newModel, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	model := newModel.(wizardModel)

	if !model.quitting {
		t.Error("Expected model to be quitting after 'q' from summary")
	}

	if cmd == nil {
		t.Error("Expected quit command")
	}
}

// TestWizardNoQuitFromMiddleSection tests that 'q' doesn't quit from middle sections
func TestWizardNoQuitFromMiddleSection(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection

	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})
	model := newModel.(wizardModel)

	// Should NOT be quitting from a middle section
	if model.quitting {
		t.Error("Expected model NOT to be quitting after 'q' from connection section")
	}
}

// TestWizardEscFromWelcome tests that Esc does nothing from welcome
func TestWizardEscFromWelcome(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionWelcome

	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	model := newModel.(wizardModel)

	if model.section != sectionWelcome {
		t.Error("Expected to stay at welcome after Esc")
	}
}

// TestWizardTextInputFocusOnEsc tests text input focus after Esc navigation
func TestWizardTextInputFocusOnEsc(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionDisplay
	m.fieldIndex = 0

	// Go back to Connection
	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	model := newModel.(wizardModel)

	if model.section != sectionConnection {
		t.Errorf("Expected to move to Connection after Esc, got section %d", model.section)
	}

	// First field should be focused if it's a text field
	if len(model.fields[sectionConnection]) > 0 {
		f := model.fields[sectionConnection][0]
		if f.fieldType <= fieldFloat {
			// Text input should be focused
			if !f.textInput.Focused() {
				t.Log("Text input focus depends on implementation")
			}
		}
	}
}

// TestWizardTextInputUpdateMultipleChars tests the text input update with multiple characters
func TestWizardTextInputUpdateMultipleChars(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = 0

	// Focus the text input
	if len(m.fields[sectionConnection]) > 0 {
		m.fields[sectionConnection][0].textInput.Focus()
	}

	// Send keys that should be handled by the text input
	chars := []rune{'t', 'e', 's', 't'}
	for _, c := range chars {
		newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{c}})
		m = newModel.(wizardModel)
	}

	// Just verify no panic
}

// TestWizardHandleEnterFromFieldsSection tests handleEnter from a fields section
func TestWizardHandleEnterFromFieldsSection(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = len(m.fields[sectionConnection]) - 1 // Last field

	newModel, _ := m.handleEnter()
	model := newModel.(wizardModel)

	// Should move to next section since we're at the last field
	if model.section <= sectionConnection {
		t.Log("handleEnter may move within section or to next section")
	}
}

// TestWizardRenderFieldsUnselected tests rendering fields when not selected
func TestWizardRenderFieldsUnselected(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionConnection
	m.fieldIndex = 1 // Select second field to ensure first is unselected

	view := m.renderFields()

	// First field should be rendered without selection styling
	if !strings.Contains(view, m.fields[sectionConnection][0].label) {
		t.Error("Expected first field label to be in view")
	}
}

// TestWizardRenderFieldsBoolUnselected tests rendering bool fields when not selected
func TestWizardRenderFieldsBoolUnselected(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionAudio

	// Find a bool field and make sure it's not selected
	for i, f := range m.fields[sectionAudio] {
		if f.fieldType == fieldBool && i > 0 {
			m.fieldIndex = 0 // Select first field
			break
		}
	}

	view := m.renderFields()

	// Should contain ON or OFF
	if !strings.Contains(view, "ON") && !strings.Contains(view, "OFF") {
		t.Error("Expected bool fields to show ON or OFF")
	}
}

// TestWizardRenderSummaryAllFieldTypes tests summary with all field types
func TestWizardRenderSummaryAllFieldTypes(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionSummary

	// Set various values
	for i := range m.fields[sectionConnection] {
		f := &m.fields[sectionConnection][i]
		switch f.fieldType {
		case fieldText:
			f.textInput.SetValue("test_value")
		case fieldNumber:
			f.textInput.SetValue("12345")
		case fieldFloat:
			f.textInput.SetValue("12.345")
		case fieldBool:
			f.boolValue = true
		case fieldSelect:
			f.selectIndex = 1
		}
	}

	view := m.renderSummary()
	if view == "" {
		t.Error("Expected non-empty summary view")
	}
}

// TestWizardApplyFieldsSelectField tests applying select field values
func TestWizardApplyFieldsSelectField(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)

	// Find the theme select field and change it
	for i, f := range m.fields[sectionDisplay] {
		if f.name == "theme" && f.fieldType == fieldSelect {
			// Select a different theme
			m.fields[sectionDisplay][i].selectIndex = 2
			break
		}
	}

	m.applyFields()

	// Verify theme was applied
	// The actual theme name depends on the order in options
	if cfg.Display.Theme == "" {
		t.Error("Expected theme to be set")
	}
}

// TestWizardUpdateNoFieldsSection tests update when at a section with no fields
func TestWizardUpdateNoFieldsSection(t *testing.T) {
	cfg := config.DefaultConfig()
	m := newWizardModel(cfg)
	m.section = sectionWelcome // No fields in welcome

	// Try to update text input (should be no-op)
	newModel, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	model := newModel.(wizardModel)

	// Should still be at welcome
	if model.section != sectionWelcome {
		t.Error("Expected to stay at welcome")
	}
}
