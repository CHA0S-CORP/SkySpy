// Package app provides the Bubble Tea application model for SkySpy radar
package app

import (
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/skyspy/skyspy-go/internal/audio"
	"github.com/skyspy/skyspy-go/internal/auth"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/export"
	"github.com/skyspy/skyspy-go/internal/geo"
	"github.com/skyspy/skyspy-go/internal/radar"
	"github.com/skyspy/skyspy-go/internal/search"
	"github.com/skyspy/skyspy-go/internal/spectrum"
	"github.com/skyspy/skyspy-go/internal/theme"
	"github.com/skyspy/skyspy-go/internal/trails"
	"github.com/skyspy/skyspy-go/internal/ws"
)

// ViewMode represents the current view
type ViewMode int

const (
	ViewRadar ViewMode = iota
	ViewSettings
	ViewHelp
	ViewOverlays
	ViewSearch
	ViewAlertRules
)

// ACARSMessage represents an ACARS message
type ACARSMessage struct {
	Callsign string
	Flight   string
	Label    string
	Text     string
}

// Model is the main application model
type Model struct {
	// Data
	aircraft      map[string]*radar.Target
	sortedTargets []string
	acarsMessages []ACARSMessage

	// Selection and navigation
	selectedHex     string
	rangeIdx        int
	rangeOptions    []int
	maxRange        float64
	settingsCursor  int
	overlayCursor   int

	// Animation state
	sweepAngle float64
	blink      bool
	frame      int
	spinners   []string

	// VU meters and spectrum (pro features)
	vuLeft           float64
	vuRight          float64
	spectrum         []float64
	spectrumPeaks    []float64
	spectrumAnalyzer *spectrum.Analyzer

	// Statistics
	peakAircraft    int
	sessionMessages int
	militaryCount   int
	emergencyCount  int

	// UI state
	viewMode         ViewMode
	notification     string
	notificationTime float64
	width, height    int
	lastRenderedView string

	// Search state
	searchQuery   string
	searchFilter  *search.Filter
	searchResults []string
	searchCursor  int

	// Configuration
	config         *config.Config
	theme          *theme.Theme
	overlayManager *geo.OverlayManager

	// Trail tracking
	trailTracker *trails.TrailTracker

	// Audio alerts
	alertPlayer     *audio.AlertPlayer
	alertedAircraft map[string]bool

	// Alert rules
	alertState      *AlertState
	alertRuleCursor int

	// WebSocket client
	wsClient *ws.Client
}

// NewModel creates a new application model
func NewModel(cfg *config.Config) *Model {
	t := theme.Get(cfg.Display.Theme)

	// Initialize overlay manager and load configured overlays
	overlayMgr := geo.NewOverlayManager()
	for _, ov := range cfg.Overlays.Overlays {
		if ov.Path != "" {
			if overlay, err := geo.LoadOverlay(ov.Path); err == nil {
				overlay.Enabled = ov.Enabled
				if ov.Color != nil {
					overlay.Color = *ov.Color
				}
				overlayMgr.AddOverlay(overlay, ov.Key)
			}
		}
	}

	rangeOptions := []int{25, 50, 100, 200, 400}
	rangeIdx := 2 // Default to 100nm
	maxRange := float64(cfg.Radar.DefaultRange)
	for i, r := range rangeOptions {
		if r >= cfg.Radar.DefaultRange {
			rangeIdx = i
			maxRange = float64(r)
			break
		}
	}

	spectrumBins := 24
	analyzer := spectrum.NewAnalyzer()

	return &Model{
		aircraft:         make(map[string]*radar.Target),
		sortedTargets:    []string{},
		acarsMessages:    make([]ACARSMessage, 0, 100),
		rangeIdx:         rangeIdx,
		rangeOptions:     rangeOptions,
		maxRange:         maxRange,
		sweepAngle:       0,
		blink:            false,
		frame:            0,
		spinners:         []string{"◐", "◓", "◑", "◒"},
		vuLeft:           0,
		vuRight:          0,
		spectrum:         make([]float64, spectrumBins),
		spectrumPeaks:    make([]float64, spectrumBins),
		spectrumAnalyzer: analyzer,
		viewMode:         ViewRadar,
		config:           cfg,
		theme:            t,
		overlayManager:   overlayMgr,
		trailTracker:     trails.NewTrailTracker(),
		alertPlayer:      audio.NewAlertPlayer(&cfg.Audio),
		alertedAircraft:  make(map[string]bool),
		alertState:       NewAlertState(cfg),
		wsClient:         ws.NewClient(cfg.Connection.Host, cfg.Connection.Port, cfg.Connection.ReconnectDelay),
	}
}

// NewModelWithAuth creates a new application model with authentication support
func NewModelWithAuth(cfg *config.Config, authMgr *auth.Manager) *Model {
	t := theme.Get(cfg.Display.Theme)

	// Initialize overlay manager and load configured overlays
	overlayMgr := geo.NewOverlayManager()
	for _, ov := range cfg.Overlays.Overlays {
		if ov.Path != "" {
			if overlay, err := geo.LoadOverlay(ov.Path); err == nil {
				overlay.Enabled = ov.Enabled
				if ov.Color != nil {
					overlay.Color = *ov.Color
				}
				overlayMgr.AddOverlay(overlay, ov.Key)
			}
		}
	}

	rangeOptions := []int{25, 50, 100, 200, 400}
	rangeIdx := 2 // Default to 100nm
	maxRange := float64(cfg.Radar.DefaultRange)
	for i, r := range rangeOptions {
		if r >= cfg.Radar.DefaultRange {
			rangeIdx = i
			maxRange = float64(r)
			break
		}
	}

	// Create WebSocket client with auth provider if available
	var wsClient *ws.Client
	if authMgr != nil && authMgr.IsAuthenticated() {
		wsClient = ws.NewClientWithAuth(
			cfg.Connection.Host,
			cfg.Connection.Port,
			cfg.Connection.ReconnectDelay,
			authMgr.GetAuthHeader,
		)
	} else {
		wsClient = ws.NewClient(cfg.Connection.Host, cfg.Connection.Port, cfg.Connection.ReconnectDelay)
	}

	spectrumBins := 24
	analyzer := spectrum.NewAnalyzer()

	return &Model{
		aircraft:         make(map[string]*radar.Target),
		sortedTargets:    []string{},
		acarsMessages:    make([]ACARSMessage, 0, 100),
		rangeIdx:         rangeIdx,
		rangeOptions:     rangeOptions,
		maxRange:         maxRange,
		sweepAngle:       0,
		blink:            false,
		frame:            0,
		spinners:         []string{"◐", "◓", "◑", "◒"},
		vuLeft:           0,
		vuRight:          0,
		spectrum:         make([]float64, spectrumBins),
		spectrumPeaks:    make([]float64, spectrumBins),
		spectrumAnalyzer: analyzer,
		viewMode:         ViewRadar,
		config:           cfg,
		theme:            t,
		overlayManager:   overlayMgr,
		trailTracker:     trails.NewTrailTracker(),
		alertPlayer:      audio.NewAlertPlayer(&cfg.Audio),
		alertedAircraft:  make(map[string]bool),
		alertState:       NewAlertState(cfg),
		wsClient:         wsClient,
	}
}

// SetAudioEnabled enables or disables audio alerts
func (m *Model) SetAudioEnabled(enabled bool) {
	if m.alertPlayer != nil {
		m.alertPlayer.SetEnabled(enabled)
	}
}

// Init initializes the application
func (m *Model) Init() tea.Cmd {
	// Start WebSocket client
	m.wsClient.Start()

	return tea.Batch(
		tickCmd(),
		aircraftMsgCmd(m.wsClient),
		acarsMsgCmd(m.wsClient),
	)
}

// tickMsg is sent on each animation tick
type tickMsg time.Time

// aircraftMsg contains aircraft data
type aircraftMsg ws.Message

// acarsMsg contains ACARS data
type acarsMsg ws.Message

func tickCmd() tea.Cmd {
	return tea.Tick(150*time.Millisecond, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func aircraftMsgCmd(client *ws.Client) tea.Cmd {
	return func() tea.Msg {
		msg := <-client.AircraftMessages()
		return aircraftMsg(msg)
	}
}

func acarsMsgCmd(client *ws.Client) tea.Cmd {
	return func() tea.Msg {
		msg := <-client.ACARSMessages()
		return acarsMsg(msg)
	}
}

// Update handles messages and updates state
func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)

	case tickMsg:
		return m.handleTick()

	case aircraftMsg:
		m.handleAircraftMsg(ws.Message(msg))
		return m, aircraftMsgCmd(m.wsClient)

	case acarsMsg:
		m.handleACARSMsg(ws.Message(msg))
		return m, acarsMsgCmd(m.wsClient)
	}

	return m, nil
}

func (m *Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	key := msg.String()

	// Global quit (only when not in search mode)
	if m.viewMode != ViewSearch && (key == "q" || key == "Q" || key == "ctrl+c") {
		m.wsClient.Stop()
		_ = config.Save(m.config)
		return m, tea.Quit
	}

	// Handle ctrl+c in search mode
	if m.viewMode == ViewSearch && key == "ctrl+c" {
		m.wsClient.Stop()
		_ = config.Save(m.config)
		return m, tea.Quit
	}

	switch m.viewMode {
	case ViewSettings:
		return m.handleSettingsKey(key)
	case ViewHelp:
		m.viewMode = ViewRadar
		return m, nil
	case ViewOverlays:
		return m.handleOverlaysKey(key)
	case ViewSearch:
		return m.handleSearchKey(msg)
	case ViewAlertRules:
		m.handleAlertRulesKey(key)
		return m, nil
	default:
		return m.handleRadarKey(key)
	}
}

func (m *Model) handleRadarKey(key string) (tea.Model, tea.Cmd) {
	switch key {
	case "up", "k":
		m.selectPrev()
	case "down", "j":
		m.selectNext()
	case "+", "=":
		m.zoomOut()
	case "-", "_":
		m.zoomIn()
	case "l", "L":
		m.config.Display.ShowLabels = !m.config.Display.ShowLabels
		if m.config.Display.ShowLabels {
			m.notify("Labels: ON")
		} else {
			m.notify("Labels: OFF")
		}
	case "m", "M":
		m.config.Filters.MilitaryOnly = !m.config.Filters.MilitaryOnly
		if m.config.Filters.MilitaryOnly {
			m.notify("Military: ON")
		} else {
			m.notify("Military: OFF")
		}
	case "g", "G":
		m.config.Filters.HideGround = !m.config.Filters.HideGround
		if m.config.Filters.HideGround {
			m.notify("Ground: HIDE")
		} else {
			m.notify("Ground: SHOW")
		}
	case "a", "A":
		m.config.Display.ShowACARS = !m.config.Display.ShowACARS
	case "v", "V":
		m.config.Display.ShowVUMeters = !m.config.Display.ShowVUMeters
	case "s", "S":
		m.config.Display.ShowSpectrum = !m.config.Display.ShowSpectrum
	case "b", "B":
		m.config.Display.ShowTrails = !m.config.Display.ShowTrails
		if m.config.Display.ShowTrails {
			m.notify("Trails: ON")
		} else {
			m.notify("Trails: OFF")
		}
	case "r", "R":
		m.openAlertRulesView()
	case "t", "T":
		m.viewMode = ViewSettings
		m.settingsCursor = 0
	case "o", "O":
		m.viewMode = ViewOverlays
		m.overlayCursor = 0
	case "?", "h", "H":
		m.viewMode = ViewHelp
	case "/":
		m.enterSearchMode()
	case "f1":
		m.applyFilterPreset(search.PresetAllAircraft())
		m.notify("Filter: ALL")
	case "f2":
		m.applyFilterPreset(search.PresetMilitaryOnly())
		m.notify("Filter: MILITARY")
	case "f3":
		m.applyFilterPreset(search.PresetEmergencies())
		m.notify("Filter: EMERGENCY")
	case "f4":
		m.applyFilterPreset(search.PresetLowAltitude())
		m.notify("Filter: LOW ALT")
	case "p", "P":
		m.exportScreenshot()
	case "e", "E":
		m.exportAircraftCSV()
	case "ctrl+e":
		m.exportAircraftJSON()
	}
	return m, nil
}

func (m *Model) handleSettingsKey(key string) (tea.Model, tea.Cmd) {
	themes := theme.List()

	switch key {
	case "t", "T", "esc":
		m.viewMode = ViewRadar
	case "up", "k":
		m.settingsCursor = (m.settingsCursor - 1 + len(themes)) % len(themes)
	case "down", "j":
		m.settingsCursor = (m.settingsCursor + 1) % len(themes)
	case "enter", " ":
		m.setTheme(themes[m.settingsCursor])
	}
	return m, nil
}

func (m *Model) handleOverlaysKey(key string) (tea.Model, tea.Cmd) {
	overlays := m.overlayManager.GetOverlayList()

	switch key {
	case "o", "O", "esc":
		m.viewMode = ViewRadar
	case "up", "k":
		if len(overlays) > 0 {
			m.overlayCursor = (m.overlayCursor - 1 + len(overlays)) % len(overlays)
		}
	case "down", "j":
		if len(overlays) > 0 {
			m.overlayCursor = (m.overlayCursor + 1) % len(overlays)
		}
	case "enter", " ":
		if len(overlays) > 0 {
			enabled := m.overlayManager.ToggleOverlay(overlays[m.overlayCursor].Key)
			if enabled {
				m.notify("Overlay: ON")
			} else {
				m.notify("Overlay: OFF")
			}
			m.saveOverlays()
		}
	case "d", "D":
		if len(overlays) > 0 {
			m.overlayManager.RemoveOverlay(overlays[m.overlayCursor].Key)
			if m.overlayCursor >= len(overlays)-1 && m.overlayCursor > 0 {
				m.overlayCursor--
			}
			m.notify("Overlay removed")
			m.saveOverlays()
		}
	}
	return m, nil
}

func (m *Model) handleTick() (tea.Model, tea.Cmd) {
	// Update sweep angle
	m.sweepAngle = float64(int(m.sweepAngle+float64(m.config.Radar.SweepSpeed)) % 360)
	m.blink = !m.blink
	m.frame++

	// Update VU meters based on real signal activity
	m.updateVUMeters()

	// Update spectrum from real aircraft data
	m.updateSpectrum()

	// Update stats
	m.updateStats()

	// Cleanup stale trails periodically (every ~30 seconds, 200 frames at 150ms)
	if m.frame%200 == 0 {
		m.trailTracker.Cleanup()
		if m.alertState != nil {
			m.alertState.Cleanup()
		}
	}

	// Notification timer
	if m.notificationTime > 0 {
		m.notificationTime -= 0.15
		if m.notificationTime <= 0 {
			m.notification = ""
		}
	}

	return m, tickCmd()
}

func (m *Model) handleAircraftMsg(msg ws.Message) {
	switch msg.Type {
	case string(ws.AircraftSnapshot):
		aircraft, err := ws.ParseAircraftSnapshot(msg.Data)
		if err == nil {
			for _, ac := range aircraft {
				m.updateTarget(&ac, false)
			}
		}
	case string(ws.AircraftNew):
		ac, err := ws.ParseAircraft(msg.Data)
		if err == nil {
			m.updateTarget(ac, true)
			m.sessionMessages++
		}
	case string(ws.AircraftUpdate):
		ac, err := ws.ParseAircraft(msg.Data)
		if err == nil {
			m.updateTarget(ac, false)
			m.sessionMessages++
		}
	case string(ws.AircraftRemove):
		ac, err := ws.ParseAircraft(msg.Data)
		if err == nil && ac.Hex != "" {
			delete(m.aircraft, ac.Hex)
			delete(m.alertedAircraft, ac.Hex)
		}
	}
}

func (m *Model) handleACARSMsg(msg ws.Message) {
	switch msg.Type {
	case string(ws.ACARSMessage), string(ws.ACARSSnapshot):
		acarsData, err := ws.ParseACARSData(msg.Data)
		if err == nil {
			for _, data := range acarsData {
				acars := ACARSMessage{
					Callsign: data.Callsign,
					Flight:   data.Flight,
					Label:    data.Label,
					Text:     data.Text,
				}
				m.acarsMessages = append(m.acarsMessages, acars)
				if len(m.acarsMessages) > 100 {
					m.acarsMessages = m.acarsMessages[1:]
				}
			}
		}
	}
}

func (m *Model) updateTarget(ac *ws.Aircraft, isNew bool) {
	if ac.Hex == "" {
		return
	}

	target := &radar.Target{
		Hex:      ac.Hex,
		Callsign: strings.TrimSpace(ac.Flight),
		Squawk:   ac.Squawk,
		ACType:   ac.Type,
		Military: ac.Military,
	}

	if ac.Lat != nil {
		target.Lat = *ac.Lat
		target.HasLat = true
	}
	if ac.Lon != nil {
		target.Lon = *ac.Lon
		target.HasLon = true
	}
	if ac.AltBaro != nil {
		target.Altitude = *ac.AltBaro
		target.HasAlt = true
	} else if ac.Alt != nil {
		target.Altitude = *ac.Alt
		target.HasAlt = true
	}
	if ac.GS != nil {
		target.Speed = *ac.GS
		target.HasSpeed = true
	}
	if ac.Track != nil {
		target.Track = *ac.Track
		target.HasTrack = true
	}
	if ac.BaroRate != nil {
		target.Vertical = *ac.BaroRate
		target.HasVS = true
	} else if ac.VR != nil {
		target.Vertical = *ac.VR
		target.HasVS = true
	}
	if ac.RSSI != nil {
		target.RSSI = *ac.RSSI
		target.HasRSSI = true
	}

	// Calculate distance and bearing if we have position
	if target.HasLat && target.HasLon && (m.config.Connection.ReceiverLat != 0 || m.config.Connection.ReceiverLon != 0) {
		target.Distance, target.Bearing = radar.HaversineBearing(
			m.config.Connection.ReceiverLat, m.config.Connection.ReceiverLon,
			target.Lat, target.Lon,
		)
	} else if ac.Distance != nil {
		target.Distance = *ac.Distance
	}
	if ac.Bearing != nil {
		target.Bearing = *ac.Bearing
	}

	m.aircraft[ac.Hex] = target

	// Update trail tracker if we have a valid position
	if target.HasLat && target.HasLon {
		m.trailTracker.AddPosition(ac.Hex, target.Lat, target.Lon)
	}

	// Trigger audio alerts
	m.triggerAudioAlerts(target, isNew)
}

// triggerAudioAlerts checks if audio alerts should be triggered for this aircraft
func (m *Model) triggerAudioAlerts(target *radar.Target, isNew bool) {
	if m.alertPlayer == nil {
		return
	}

	// Play new aircraft sound for genuinely new aircraft
	if isNew && !m.alertedAircraft[target.Hex] {
		m.alertPlayer.PlayNewAircraft()
	}

	// Check for emergency squawk
	if target.IsEmergency() {
		m.alertPlayer.PlayEmergency()
	}

	// Check for military aircraft (first time seen)
	if target.Military && !m.alertedAircraft[target.Hex] {
		m.alertPlayer.PlayMilitary()
	}

	// Mark this aircraft as alerted
	m.alertedAircraft[target.Hex] = true

	// Check custom alert rules
	m.checkAlertRules(target)
}

// checkAlertRules checks custom alert rules for this aircraft
func (m *Model) checkAlertRules(target *radar.Target) {
	if m.alertState == nil {
		return
	}

	// Get previous state for comparison (for geofence entry detection)
	prevTarget, exists := m.aircraft[target.Hex]
	var prev *radar.Target
	if exists {
		prev = prevTarget
	}

	// Check alert rules
	triggered := m.alertState.CheckAircraft(target, prev)

	// Display notifications for triggered alerts
	for _, alert := range triggered {
		// Show notification
		m.notify(alert.Message)

		// Play sound if action specifies
		for _, action := range alert.Actions {
			if action.Type == "sound" && m.alertPlayer != nil {
				m.alertPlayer.PlayEmergency()
			}
		}
	}
}

// updateVUMeters updates VU meter values based on aircraft signal data
func (m *Model) updateVUMeters() {
	// Calculate average RSSI from all aircraft with signal data
	var totalRSSI float64
	var rssiCount int
	var maxRSSI float64 = -50

	for _, t := range m.aircraft {
		if t.HasRSSI {
			totalRSSI += t.RSSI
			rssiCount++
			if t.RSSI > maxRSSI {
				maxRSSI = t.RSSI
			}
		}
	}

	// Normalize RSSI to 0-1 range (typical RSSI: -30 to 0 dBm)
	var leftTarget, rightTarget float64
	if rssiCount > 0 {
		avgRSSI := totalRSSI / float64(rssiCount)
		// Normalize: -30 dBm = 0.0, 0 dBm = 1.0
		leftTarget = (avgRSSI + 30) / 30.0
		rightTarget = (maxRSSI + 30) / 30.0
	}

	// Clamp values
	if leftTarget < 0 {
		leftTarget = 0
	}
	if leftTarget > 1 {
		leftTarget = 1
	}
	if rightTarget < 0 {
		rightTarget = 0
	}
	if rightTarget > 1 {
		rightTarget = 1
	}

	// Smooth the VU meter movement (exponential decay)
	m.vuLeft = m.vuLeft*0.7 + leftTarget*0.3
	m.vuRight = m.vuRight*0.7 + rightTarget*0.3
}

// updateSpectrum updates the spectrum display from aircraft RSSI data by distance band
func (m *Model) updateSpectrum() {
	// Reset analyzer and feed current aircraft data
	m.spectrumAnalyzer.Reset()

	// Add all aircraft with RSSI and distance data
	for hex, t := range m.aircraft {
		if t.Distance > 0 {
			rssi := float64(-20) // Default RSSI if not available
			if t.HasRSSI {
				rssi = t.RSSI
			}
			m.spectrumAnalyzer.AddAircraft(hex, rssi, t.Distance)
		}
	}

	// Get smoothed spectrum values
	newSpectrum := m.spectrumAnalyzer.GetSpectrumSmoothed(len(m.spectrum))
	peaks := m.spectrumAnalyzer.GetPeaks(len(m.spectrum))

	// Apply exponential smoothing to the display values
	for i := range m.spectrum {
		m.spectrum[i] = m.spectrum[i]*0.6 + newSpectrum[i]*0.4
		// Update peak with slow decay
		if peaks[i] > m.spectrumPeaks[i] {
			m.spectrumPeaks[i] = peaks[i]
		} else {
			m.spectrumPeaks[i] *= 0.98 // Slow peak decay
		}
	}
}

func (m *Model) updateStats() {
	if len(m.aircraft) > m.peakAircraft {
		m.peakAircraft = len(m.aircraft)
	}

	m.militaryCount = 0
	m.emergencyCount = 0
	for _, t := range m.aircraft {
		if t.Military {
			m.militaryCount++
		}
		if t.IsEmergency() {
			m.emergencyCount++
		}
	}
}

func (m *Model) selectNext() {
	if len(m.sortedTargets) == 0 {
		return
	}
	if m.selectedHex == "" {
		m.selectedHex = m.sortedTargets[0]
		return
	}
	for i, hex := range m.sortedTargets {
		if hex == m.selectedHex {
			m.selectedHex = m.sortedTargets[(i+1)%len(m.sortedTargets)]
			return
		}
	}
	m.selectedHex = m.sortedTargets[0]
}

func (m *Model) selectPrev() {
	if len(m.sortedTargets) == 0 {
		return
	}
	if m.selectedHex == "" {
		m.selectedHex = m.sortedTargets[len(m.sortedTargets)-1]
		return
	}
	for i, hex := range m.sortedTargets {
		if hex == m.selectedHex {
			m.selectedHex = m.sortedTargets[(i-1+len(m.sortedTargets))%len(m.sortedTargets)]
			return
		}
	}
	m.selectedHex = m.sortedTargets[len(m.sortedTargets)-1]
}

func (m *Model) zoomIn() {
	if m.rangeIdx > 0 {
		m.rangeIdx--
		m.maxRange = float64(m.rangeOptions[m.rangeIdx])
		m.notify("Range: " + itoa(int(m.maxRange)) + "nm")
	}
}

func (m *Model) zoomOut() {
	if m.rangeIdx < len(m.rangeOptions)-1 {
		m.rangeIdx++
		m.maxRange = float64(m.rangeOptions[m.rangeIdx])
		m.notify("Range: " + itoa(int(m.maxRange)) + "nm")
	}
}

func (m *Model) setTheme(name string) {
	m.theme = theme.Get(name)
	m.config.Display.Theme = name
	_ = config.Save(m.config)
	m.notify("Theme: " + m.theme.Name)
}

func (m *Model) notify(message string) {
	m.notification = message
	m.notificationTime = 3.0
}

func (m *Model) saveOverlays() {
	overlayConfigs := m.overlayManager.ToConfig()
	m.config.Overlays.Overlays = make([]config.OverlayConfig, len(overlayConfigs))
	for i, ov := range overlayConfigs {
		m.config.Overlays.Overlays[i] = config.OverlayConfig{
			Path:    ov["source_file"].(string),
			Enabled: ov["enabled"].(bool),
			Key:     ov["key"].(string),
		}
		if color, ok := ov["color"].(string); ok && color != "" {
			m.config.Overlays.Overlays[i].Color = &color
		}
	}
	_ = config.Save(m.config)
}

// IsConnected returns true if connected to server
func (m *Model) IsConnected() bool {
	return m.wsClient.IsConnected()
}

// SetLastRenderedView stores the last rendered view for screenshot exports
func (m *Model) SetLastRenderedView(view string) {
	m.lastRenderedView = view
}

// GetExportDirectory returns the configured export directory or current directory
func (m *Model) GetExportDirectory() string {
	if m.config.Export.Directory != "" {
		return m.config.Export.Directory
	}
	return ""
}

// exportScreenshot saves the current view as HTML
func (m *Model) exportScreenshot() {
	if m.lastRenderedView == "" {
		m.notify("No view to export")
		return
	}

	filename, err := export.CaptureScreen(m.lastRenderedView, m.GetExportDirectory())
	if err != nil {
		m.notify("Export failed: " + err.Error())
		return
	}

	m.notify("Screenshot: " + filepath.Base(filename))
}

// exportAircraftCSV exports aircraft data to CSV
func (m *Model) exportAircraftCSV() {
	if len(m.aircraft) == 0 {
		m.notify("No aircraft to export")
		return
	}

	filename, err := export.ExportAircraft(m.aircraft, m.GetExportDirectory())
	if err != nil {
		m.notify("Export failed: " + err.Error())
		return
	}

	m.notify("CSV: " + filepath.Base(filename))
}

// exportAircraftJSON exports aircraft data to JSON
func (m *Model) exportAircraftJSON() {
	if len(m.aircraft) == 0 {
		m.notify("No aircraft to export")
		return
	}

	filename, err := export.ExportAircraftJSON(m.aircraft, m.GetExportDirectory())
	if err != nil {
		m.notify("Export failed: " + err.Error())
		return
	}

	m.notify("JSON: " + filepath.Base(filename))
}

// ExportACARSCSV exports ACARS messages to CSV (can be called externally)
func (m *Model) ExportACARSCSV() (string, error) {
	messages := make([]export.ACARSMessage, len(m.acarsMessages))
	for i, msg := range m.acarsMessages {
		messages[i] = export.ACARSMessage{
			Callsign: msg.Callsign,
			Flight:   msg.Flight,
			Label:    msg.Label,
			Text:     msg.Text,
		}
	}
	return export.ExportACARSMessages(messages, m.GetExportDirectory())
}

// ExportACARSJSON exports ACARS messages to JSON (can be called externally)
func (m *Model) ExportACARSJSON() (string, error) {
	messages := make([]export.ACARSMessage, len(m.acarsMessages))
	for i, msg := range m.acarsMessages {
		messages[i] = export.ACARSMessage{
			Callsign: msg.Callsign,
			Flight:   msg.Flight,
			Label:    msg.Label,
			Text:     msg.Text,
		}
	}
	return export.ExportACARSJSON(messages, m.GetExportDirectory())
}

// GetTrailsForRadar returns trail data in the format expected by the radar scope
func (m *Model) GetTrailsForRadar() map[string][]radar.TrailPoint {
	allTrails := m.trailTracker.GetAllTrails()
	result := make(map[string][]radar.TrailPoint, len(allTrails))

	for hex, trail := range allTrails {
		points := make([]radar.TrailPoint, len(trail))
		for i, pos := range trail {
			points[i] = radar.TrailPoint{
				Lat: pos.Lat,
				Lon: pos.Lon,
			}
		}
		result[hex] = points
	}

	return result
}

// GetSpectrumPeaks returns the current spectrum peak values for rendering
func (m *Model) GetSpectrumPeaks() []float64 {
	return m.spectrumPeaks
}

// GetSpectrumLabels returns labels for spectrum bands
func (m *Model) GetSpectrumLabels() []string {
	return m.spectrumAnalyzer.GetBandLabels()
}

func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

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

// Search mode methods

func (m *Model) handleSearchKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	key := msg.String()

	switch key {
	case "esc":
		m.viewMode = ViewRadar
		m.searchQuery = ""
		m.searchFilter = nil
		m.searchResults = nil
		return m, nil
	case "enter":
		m.applySearchFilter()
		m.viewMode = ViewRadar
		return m, nil
	case "backspace":
		if len(m.searchQuery) > 0 {
			m.searchQuery = m.searchQuery[:len(m.searchQuery)-1]
			m.updateSearchResults()
		}
		return m, nil
	case "up":
		if len(m.searchResults) > 0 {
			m.searchCursor = (m.searchCursor - 1 + len(m.searchResults)) % len(m.searchResults)
		}
		return m, nil
	case "down":
		if len(m.searchResults) > 0 {
			m.searchCursor = (m.searchCursor + 1) % len(m.searchResults)
		}
		return m, nil
	default:
		// Handle printable characters
		if len(key) == 1 {
			r := rune(key[0])
			if r >= 32 && r < 127 {
				m.searchQuery += key
				m.updateSearchResults()
				m.searchCursor = 0
			}
		} else if key == "space" {
			m.searchQuery += " "
			m.updateSearchResults()
			m.searchCursor = 0
		}
		return m, nil
	}
}

func (m *Model) enterSearchMode() {
	m.viewMode = ViewSearch
	m.searchQuery = ""
	m.searchCursor = 0
	m.searchResults = []string{}
}

func (m *Model) applyFilterPreset(filter *search.Filter) {
	m.searchFilter = filter
}

func (m *Model) applySearchFilter() {
	if m.searchQuery == "" {
		m.searchFilter = nil
		return
	}
	m.searchFilter = search.ParseQuery(m.searchQuery)
}

func (m *Model) updateSearchResults() {
	if m.searchQuery == "" {
		m.searchResults = nil
		return
	}
	filter := search.ParseQuery(m.searchQuery)
	m.searchResults = search.FilterAircraft(m.aircraft, filter)
}

// GetSearchFilter returns the current active search filter
func (m *Model) GetSearchFilter() *search.Filter {
	return m.searchFilter
}

// GetSearchQuery returns the current search query
func (m *Model) GetSearchQuery() string {
	return m.searchQuery
}

// GetSearchResults returns the current search results
func (m *Model) GetSearchResults() []string {
	return m.searchResults
}

// GetSearchCursor returns the current search cursor position
func (m *Model) GetSearchCursor() int {
	return m.searchCursor
}

// IsFilterActive returns true if a search filter is active
func (m *Model) IsFilterActive() bool {
	return m.searchFilter != nil && m.searchFilter.IsActive()
}
