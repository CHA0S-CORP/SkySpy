// Package app provides alert rules view for SkySpy radar
package app

import (
	"github.com/skyspy/skyspy-go/internal/alerts"
)

// Key constants for alert rules view
const (
	keyEsc   = "esc"
	keyDown  = "down"
	keyEnter = "enter"
)

// handleAlertRulesKey handles keyboard input in alert rules view
func (m *Model) handleAlertRulesKey(key string) {
	rules := m.GetAlertRules()
	ruleCount := len(rules)

	switch key {
	case keyEsc, "R":
		m.viewMode = ViewRadar
	case "up", "k":
		if ruleCount > 0 {
			m.alertRuleCursor = (m.alertRuleCursor - 1 + ruleCount) % ruleCount
		}
	case keyDown, "j":
		if ruleCount > 0 {
			m.alertRuleCursor = (m.alertRuleCursor + 1) % ruleCount
		}
	case keyEnter, " ":
		if ruleCount > 0 && m.alertState != nil {
			rule := rules[m.alertRuleCursor]
			enabled := m.alertState.ToggleRule(rule.ID)
			if enabled {
				m.notify("Rule enabled: " + rule.Name)
			} else {
				m.notify("Rule disabled: " + rule.Name)
			}
		}
	case "a", "A":
		if m.alertState != nil {
			m.alertState.AlertsEnabled = !m.alertState.AlertsEnabled
			if m.alertState.AlertsEnabled {
				m.notify("Alerts: ON")
			} else {
				m.notify("Alerts: OFF")
			}
		}
	}
}

// GetAlertRules returns all alert rules
func (m *Model) GetAlertRules() []*alerts.AlertRule {
	if m.alertState == nil {
		return nil
	}
	return m.alertState.GetRules()
}

// GetAlertRuleCursor returns the current alert rule cursor position
func (m *Model) GetAlertRuleCursor() int {
	return m.alertRuleCursor
}

// IsAlertHighlighted checks if an aircraft should be highlighted due to alert
func (m *Model) IsAlertHighlighted(hex string) bool {
	if m.alertState == nil {
		return false
	}
	return m.alertState.IsHighlighted(hex)
}

// GetRecentAlerts returns recent triggered alerts
func (m *Model) GetRecentAlerts() []alerts.TriggeredAlert {
	if m.alertState == nil {
		return nil
	}
	return m.alertState.RecentAlerts
}

// IsAlertsEnabled returns whether alerts are enabled
func (m *Model) IsAlertsEnabled() bool {
	if m.alertState == nil {
		return false
	}
	return m.alertState.AlertsEnabled
}

// GetAlertStats returns alert statistics
func (m *Model) GetAlertStats() alerts.AlertStats {
	if m.alertState == nil {
		return alerts.AlertStats{}
	}
	return m.alertState.GetStats()
}

// openAlertRulesView opens the alert rules panel
func (m *Model) openAlertRulesView() {
	m.viewMode = ViewAlertRules
	m.alertRuleCursor = 0
}
