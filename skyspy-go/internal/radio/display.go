// Package radio provides radio monitor display functionality for SkySpy
package radio

import (
	"math/rand"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/theme"
	"github.com/skyspy/skyspy-go/internal/ui"
	"github.com/skyspy/skyspy-go/internal/ws"
)

// DisplayMode represents the display variant
type DisplayMode int

const (
	ModeBasic DisplayMode = iota
	ModePro
)

// Aircraft represents an aircraft in the radio display
type Aircraft struct {
	Hex       string
	Callsign  string
	ACType    string
	Altitude  int
	Speed     float64
	Track     float64
	Vertical  float64
	Distance  float64
	RSSI      float64
	Squawk    string
	Military  bool
	HasAlt    bool
	HasSpeed  bool
	HasTrack  bool
	HasVS     bool
	HasRSSI   bool
}

// IsEmergency returns true if aircraft has emergency squawk
func (a *Aircraft) IsEmergency() bool {
	return a.Squawk == "7500" || a.Squawk == "7600" || a.Squawk == "7700"
}

// ACARSMessage represents an ACARS message
type ACARSMessage struct {
	Timestamp string
	Callsign  string
	Flight    string
	Label     string
	Text      string
	Source    string
	Frequency string
}

// Model is the Bubble Tea model for radio display
type Model struct {
	// Display mode
	Mode DisplayMode

	// Data
	Aircraft      map[string]*Aircraft
	ACARSMessages []ACARSMessage
	SortedHexes   []string

	// Stats
	TotalMessages int
	PeakAircraft  int
	StartTime     time.Time
	Connected     bool

	// Animation state
	Blink     bool
	Frame     int
	ScanPos   int
	Spinners  []string

	// VU meters
	VULeft  float64
	VURight float64

	// Spectrum data
	Spectrum  *ui.Spectrum
	Waterfall *ui.Waterfall
	FreqDisp  *ui.FrequencyDisplay

	// Configuration
	Config    *config.Config
	Theme     *theme.Theme
	WSClient  *ws.Client
	Width     int
	Height    int

	// Scanning mode
	ScanMode        bool
	FilterFrequency string
}

// NewModel creates a new radio display model
func NewModel(cfg *config.Config, mode DisplayMode) *Model {
	t := theme.Get(cfg.Display.Theme)

	specWidth := 32
	specHeight := 6
	if mode == ModePro {
		specWidth = 40
		specHeight = 8
	}

	return &Model{
		Mode:          mode,
		Aircraft:      make(map[string]*Aircraft),
		ACARSMessages: make([]ACARSMessage, 0, 100),
		SortedHexes:   []string{},
		StartTime:     time.Now(),
		Spinners:      []string{"◐", "◓", "◑", "◒"},
		Spectrum:      ui.NewSpectrum(t, specWidth, specHeight),
		Waterfall:     ui.NewWaterfall(t, specWidth, 10),
		FreqDisp:      ui.NewFrequencyDisplay(t),
		Config:        cfg,
		Theme:         t,
		WSClient:      ws.NewClient(cfg.Connection.Host, cfg.Connection.Port, cfg.Connection.ReconnectDelay),
	}
}

// Init initializes the model
func (m *Model) Init() tea.Cmd {
	m.WSClient.Start()

	return tea.Batch(
		tickCmd(),
		aircraftMsgCmd(m.WSClient),
		acarsMsgCmd(m.WSClient),
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
		m.Width = msg.Width
		m.Height = msg.Height
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)

	case tickMsg:
		return m.handleTick()

	case aircraftMsg:
		m.handleAircraftMsg(ws.Message(msg))
		return m, aircraftMsgCmd(m.WSClient)

	case acarsMsg:
		m.handleACARSMsg(ws.Message(msg))
		return m, acarsMsgCmd(m.WSClient)
	}

	return m, nil
}

func (m *Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "Q", "ctrl+c":
		m.WSClient.Stop()
		return m, tea.Quit
	case "s", "S":
		m.ScanMode = !m.ScanMode
	case "t", "T":
		// Cycle through themes
		themes := theme.List()
		currentIdx := 0
		for i, t := range themes {
			if t == m.Config.Display.Theme {
				currentIdx = i
				break
			}
		}
		nextIdx := (currentIdx + 1) % len(themes)
		m.Config.Display.Theme = themes[nextIdx]
		m.Theme = theme.Get(themes[nextIdx])
		m.Spectrum.Theme = m.Theme
		m.Waterfall.Theme = m.Theme
		m.FreqDisp.Theme = m.Theme
	}
	return m, nil
}

func (m *Model) handleTick() (tea.Model, tea.Cmd) {
	m.Blink = !m.Blink
	m.Frame++
	m.Connected = m.WSClient.IsConnected()

	// Update VU meters based on activity
	activity := float64(len(m.Aircraft)) / 30.0
	if activity > 1.0 {
		activity = 1.0
	}
	m.VULeft = m.VULeft*0.8 + (activity+rand.Float64()*0.2)*0.2
	m.VURight = m.VURight*0.8 + (activity+rand.Float64()*0.2)*0.2

	// Update spectrum with simulated data based on activity
	specValues := make([]float64, m.Spectrum.Width)
	for i := range specValues {
		specValues[i] = rand.Float64() * activity * 0.8
	}
	m.Spectrum.Update(specValues, 0.7)

	// Update waterfall
	if m.Mode == ModePro && m.Frame%3 == 0 {
		m.Waterfall.Push(m.Spectrum.Data)
	}

	// Update scan position
	if m.ScanMode {
		m.FreqDisp.Advance()
	}

	// Update peak aircraft
	if len(m.Aircraft) > m.PeakAircraft {
		m.PeakAircraft = len(m.Aircraft)
	}

	return m, tickCmd()
}

func (m *Model) handleAircraftMsg(msg ws.Message) {
	switch msg.Type {
	case string(ws.AircraftSnapshot):
		aircraft, err := ws.ParseAircraftSnapshot(msg.Data)
		if err == nil {
			for _, ac := range aircraft {
				m.updateAircraft(&ac)
			}
		}
	case string(ws.AircraftUpdate), string(ws.AircraftNew):
		ac, err := ws.ParseAircraft(msg.Data)
		if err == nil {
			m.updateAircraft(ac)
			m.TotalMessages++
		}
	case string(ws.AircraftRemove):
		ac, err := ws.ParseAircraft(msg.Data)
		if err == nil && ac.Hex != "" {
			delete(m.Aircraft, ac.Hex)
		}
	}

	m.sortAircraft()
}

func (m *Model) updateAircraft(ac *ws.Aircraft) {
	if ac.Hex == "" {
		return
	}

	aircraft := &Aircraft{
		Hex:      ac.Hex,
		Callsign: strings.TrimSpace(ac.Flight),
		ACType:   ac.Type,
		Squawk:   ac.Squawk,
		Military: ac.Military,
	}

	if ac.AltBaro != nil {
		aircraft.Altitude = *ac.AltBaro
		aircraft.HasAlt = true
	} else if ac.Alt != nil {
		aircraft.Altitude = *ac.Alt
		aircraft.HasAlt = true
	}
	if ac.GS != nil {
		aircraft.Speed = *ac.GS
		aircraft.HasSpeed = true
	}
	if ac.Track != nil {
		aircraft.Track = *ac.Track
		aircraft.HasTrack = true
	}
	if ac.BaroRate != nil {
		aircraft.Vertical = *ac.BaroRate
		aircraft.HasVS = true
	} else if ac.VR != nil {
		aircraft.Vertical = *ac.VR
		aircraft.HasVS = true
	}
	if ac.RSSI != nil {
		aircraft.RSSI = *ac.RSSI
		aircraft.HasRSSI = true
	}
	if ac.Distance != nil {
		aircraft.Distance = *ac.Distance
	}

	m.Aircraft[ac.Hex] = aircraft
}

func (m *Model) sortAircraft() {
	// Sort by distance
	type sortEntry struct {
		hex      string
		distance float64
	}

	entries := make([]sortEntry, 0, len(m.Aircraft))
	for hex, ac := range m.Aircraft {
		entries = append(entries, sortEntry{hex: hex, distance: ac.Distance})
	}

	// Simple bubble sort for small lists
	for i := 0; i < len(entries)-1; i++ {
		for j := i + 1; j < len(entries); j++ {
			if entries[i].distance > entries[j].distance {
				entries[i], entries[j] = entries[j], entries[i]
			}
		}
	}

	m.SortedHexes = make([]string, len(entries))
	for i, e := range entries {
		m.SortedHexes[i] = e.hex
	}
}

func (m *Model) handleACARSMsg(msg ws.Message) {
	switch msg.Type {
	case string(ws.ACARSMessage), string(ws.ACARSSnapshot):
		acarsData, err := ws.ParseACARSData(msg.Data)
		if err == nil {
			for _, data := range acarsData {
				acars := ACARSMessage{
					Timestamp: time.Now().Format("15:04:05"),
					Callsign:  data.Callsign,
					Flight:    data.Flight,
					Label:     data.Label,
					Text:      data.Text,
					Source:    "ACARS",
				}
				m.ACARSMessages = append(m.ACARSMessages, acars)
				if len(m.ACARSMessages) > 100 {
					m.ACARSMessages = m.ACARSMessages[1:]
				}
				m.TotalMessages++
			}
		}
	}
}

// GetUptime returns the formatted uptime
func (m *Model) GetUptime() string {
	uptime := time.Since(m.StartTime)
	hours := int(uptime.Hours())
	minutes := int(uptime.Minutes()) % 60
	seconds := int(uptime.Seconds()) % 60
	return formatTime(hours, minutes, seconds)
}

// GetMilitaryCount returns the number of military aircraft
func (m *Model) GetMilitaryCount() int {
	count := 0
	for _, ac := range m.Aircraft {
		if ac.Military {
			count++
		}
	}
	return count
}

func formatTime(h, m, s int) string {
	return pad(h) + ":" + pad(m) + ":" + pad(s)
}

func pad(n int) string {
	if n < 10 {
		return "0" + itoa(n)
	}
	return itoa(n)
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
