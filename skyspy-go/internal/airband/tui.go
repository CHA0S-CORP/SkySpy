package airband

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const maxLogLines = 20

// TUIModel is a Bubble Tea model for monitoring airband uploads.
type TUIModel struct {
	eventCh   <-chan ProcessResult
	logLines  []string
	okCount   int
	failCount int
	discCount int
	running   bool
	width     int
	height    int
}

type eventMsg ProcessResult
type tickMsg struct{}

// NewTUIModel creates a new TUI model connected to the watcher's event channel.
func NewTUIModel(eventCh <-chan ProcessResult) TUIModel {
	return TUIModel{
		eventCh:  eventCh,
		logLines: make([]string, 0, maxLogLines),
		running:  true,
	}
}

// Init starts the tick loop.
func (m TUIModel) Init() tea.Cmd {
	return tea.Batch(m.waitForEvent(), tickCmd())
}

// Update handles messages.
func (m TUIModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, tea.Quit
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case eventMsg:
		r := ProcessResult(msg)
		line := formatEvent(r)
		m.logLines = append(m.logLines, line)
		if len(m.logLines) > maxLogLines {
			m.logLines = m.logLines[len(m.logLines)-maxLogLines:]
		}
		switch r.Action {
		case ActionUploaded:
			m.okCount++
		case ActionFailed:
			m.failCount++
		case ActionDiscarded:
			m.discCount++
		}
		return m, m.waitForEvent()

	case tickMsg:
		return m, tickCmd()
	}

	return m, nil
}

// View renders the TUI.
func (m TUIModel) View() string {
	var b strings.Builder

	// Header
	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("46"))
	b.WriteString(headerStyle.Render("  SKYSPY AIRBAND UPLOADER"))
	b.WriteString("\n")

	// Status line
	status := "RUNNING"
	statusColor := "46"
	if !m.running {
		status = "STOPPED"
		statusColor = "196"
	}
	statusStyle := lipgloss.NewStyle().Foreground(lipgloss.Color(statusColor))
	b.WriteString(fmt.Sprintf("  Status: %s", statusStyle.Render(status)))
	b.WriteString(fmt.Sprintf("  |  OK: %d  Failed: %d  Discarded: %d", m.okCount, m.failCount, m.discCount))
	b.WriteString("\n")

	// Separator
	if m.width > 0 {
		b.WriteString("  " + strings.Repeat("─", min(m.width-4, 76)) + "\n")
	} else {
		b.WriteString("  " + strings.Repeat("─", 76) + "\n")
	}

	// Activity log
	dimStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	if len(m.logLines) == 0 {
		b.WriteString(dimStyle.Render("  Waiting for recordings..."))
		b.WriteString("\n")
	} else {
		for _, line := range m.logLines {
			b.WriteString("  " + line + "\n")
		}
	}

	// Footer
	b.WriteString("\n")
	b.WriteString(dimStyle.Render("  [Q] Quit"))
	b.WriteString("\n")

	return b.String()
}

func (m TUIModel) waitForEvent() tea.Cmd {
	return func() tea.Msg {
		r, ok := <-m.eventCh
		if !ok {
			return tea.Quit()
		}
		return eventMsg(r)
	}
}

func tickCmd() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return tickMsg{}
	})
}

func formatEvent(r ProcessResult) string {
	ts := time.Now().Format("15:04:05")

	var actionStr string
	switch r.Action {
	case ActionUploaded:
		style := lipgloss.NewStyle().Foreground(lipgloss.Color("46"))
		actionStr = style.Render("OK")
	case ActionFailed:
		style := lipgloss.NewStyle().Foreground(lipgloss.Color("196"))
		actionStr = style.Render("FAIL")
	case ActionDiscarded:
		style := lipgloss.NewStyle().Foreground(lipgloss.Color("226"))
		actionStr = style.Render("SKIP")
	case ActionSkipped:
		style := lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
		actionStr = style.Render("DRY")
	}

	freq := ""
	if r.Metadata.HasFrequency {
		freq = fmt.Sprintf("%.3f MHz", r.Metadata.FrequencyMHz)
	}

	reason := ""
	if r.Reason != "" {
		reason = fmt.Sprintf(" (%s)", r.Reason)
	}

	return fmt.Sprintf("%s  [%-4s]  %-22s  %-12s  %6d bytes%s",
		ts, actionStr, r.Metadata.ChannelName, freq, r.Metadata.FileSize, reason)
}
