// Package alerts provides configurable alert rules for aircraft monitoring
package alerts

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// AlertEngine processes alert rules against aircraft data
type AlertEngine struct {
	ruleSet         *RuleSet
	geofenceManager *GeofenceManager

	// Aircraft state tracking for geofence entry detection
	prevStates map[string]*AircraftState
	mutex      sync.RWMutex

	// Alert history
	recentAlerts    []TriggeredAlert
	maxRecentAlerts int

	// Highlight tracking for radar display
	highlightedAircraft map[string]time.Time
	highlightDuration   time.Duration
}

// NewAlertEngine creates a new alert engine
func NewAlertEngine() *AlertEngine {
	engine := &AlertEngine{
		ruleSet:             NewRuleSet(),
		geofenceManager:     NewGeofenceManager(),
		prevStates:          make(map[string]*AircraftState),
		recentAlerts:        []TriggeredAlert{},
		maxRecentAlerts:     50,
		highlightedAircraft: make(map[string]time.Time),
		highlightDuration:   time.Minute * 2,
	}

	return engine
}

// NewAlertEngineWithDefaults creates an alert engine with default rules
func NewAlertEngineWithDefaults() *AlertEngine {
	engine := NewAlertEngine()

	// Add default rules
	for _, rule := range DefaultAlertRules() {
		engine.ruleSet.AddRule(rule)
	}

	return engine
}

// GetRuleSet returns the rule set
func (e *AlertEngine) GetRuleSet() *RuleSet {
	return e.ruleSet
}

// GetGeofenceManager returns the geofence manager
func (e *AlertEngine) GetGeofenceManager() *GeofenceManager {
	return e.geofenceManager
}

// AddRule adds a rule to the engine
func (e *AlertEngine) AddRule(rule *AlertRule) {
	e.ruleSet.AddRule(rule)
}

// AddGeofence adds a geofence to the engine
func (e *AlertEngine) AddGeofence(geofence *Geofence) {
	e.geofenceManager.AddGeofence(geofence)
}

// CheckAircraft checks an aircraft against all enabled rules
func (e *AlertEngine) CheckAircraft(state *AircraftState, prevState *AircraftState) []TriggeredAlert {
	var triggered []TriggeredAlert

	if state == nil {
		return triggered
	}

	// Get previous state from tracking if not provided
	if prevState == nil {
		e.mutex.RLock()
		prevState = e.prevStates[state.Hex]
		e.mutex.RUnlock()
	}

	// Check each enabled rule
	for _, rule := range e.ruleSet.GetEnabledRules() {
		if !rule.CanTrigger(state.Hex) {
			continue
		}

		if e.evaluateRule(rule, state, prevState) {
			alert := e.createAlert(rule, state)
			triggered = append(triggered, alert)
			rule.RecordTrigger(state.Hex)

			// Track highlighting
			for _, action := range alert.Actions {
				if action.Type == ActionHighlight {
					e.mutex.Lock()
					e.highlightedAircraft[state.Hex] = time.Now()
					e.mutex.Unlock()
				}
			}
		}
	}

	// Update previous state tracking
	e.mutex.Lock()
	e.prevStates[state.Hex] = state
	e.mutex.Unlock()

	// Record alerts in history
	if len(triggered) > 0 {
		e.mutex.Lock()
		e.recentAlerts = append(e.recentAlerts, triggered...)
		if len(e.recentAlerts) > e.maxRecentAlerts {
			e.recentAlerts = e.recentAlerts[len(e.recentAlerts)-e.maxRecentAlerts:]
		}
		e.mutex.Unlock()
	}

	return triggered
}

// evaluateRule checks if a rule's conditions are met
func (e *AlertEngine) evaluateRule(rule *AlertRule, state *AircraftState, prevState *AircraftState) bool {
	// For rules with multiple conditions of the same type (like emergency squawk),
	// we need OR logic for same-type conditions and AND logic between different types
	conditionsByType := make(map[ConditionType][]Condition)
	for _, cond := range rule.Conditions {
		conditionsByType[cond.Type] = append(conditionsByType[cond.Type], cond)
	}

	// Each type group must have at least one condition that matches
	for condType, conditions := range conditionsByType {
		anyMatch := false
		for _, cond := range conditions {
			if e.evaluateCondition(cond, state, prevState) {
				anyMatch = true
				break
			}
		}
		if !anyMatch {
			return false
		}
		_ = condType
	}

	return len(rule.Conditions) > 0
}

// evaluateCondition checks if a single condition is met
func (e *AlertEngine) evaluateCondition(cond Condition, state *AircraftState, prevState *AircraftState) bool {
	switch cond.Type {
	case ConditionSquawk:
		return MatchesWildcard(cond.Value, state.Squawk)

	case ConditionCallsign:
		return MatchesWildcard(cond.Value, state.Callsign)

	case ConditionHex:
		return MatchesWildcard(cond.Value, state.Hex)

	case ConditionMilitary:
		return strings.ToLower(cond.Value) == "true" && state.Military

	case ConditionAltitudeAbove:
		if !state.HasAlt {
			return false
		}
		threshold := ParseInt(cond.Value)
		return state.Altitude > threshold

	case ConditionAltitudeBelow:
		if !state.HasAlt {
			return false
		}
		threshold := ParseInt(cond.Value)
		// Only trigger for airborne aircraft (altitude > 0 but below threshold)
		return state.Altitude > 0 && state.Altitude < threshold

	case ConditionDistanceWithin:
		threshold := ParseFloat(cond.Value)
		return state.Distance > 0 && state.Distance <= threshold

	case ConditionEnteringGeofence:
		if !state.HasLat || !state.HasLon {
			return false
		}
		if prevState == nil || !prevState.HasLat || !prevState.HasLon {
			return false
		}

		geofence := e.geofenceManager.GetGeofence(cond.Value)
		if geofence == nil {
			// Check if entering ANY geofence
			if cond.Value == "*" || cond.Value == "" {
				entered := e.geofenceManager.CheckEntering(
					prevState.Lat, prevState.Lon,
					state.Lat, state.Lon,
				)
				return len(entered) > 0
			}
			return false
		}

		wasInside := geofence.Contains(prevState.Lat, prevState.Lon)
		isInside := geofence.Contains(state.Lat, state.Lon)
		return !wasInside && isInside

	case ConditionSpeedAbove:
		if !state.HasSpeed {
			return false
		}
		threshold := ParseFloat(cond.Value)
		return state.Speed > threshold

	default:
		return false
	}
}

// createAlert creates a triggered alert from a rule and aircraft state
func (e *AlertEngine) createAlert(rule *AlertRule, state *AircraftState) TriggeredAlert {
	message := ""
	if len(rule.Actions) > 0 {
		for _, action := range rule.Actions {
			if action.Type == ActionNotify && action.Message != "" {
				message = e.formatMessage(action.Message, state)
				break
			}
		}
	}

	if message == "" {
		message = fmt.Sprintf("%s: %s", rule.Name, state.Callsign)
		if state.Callsign == "" {
			message = fmt.Sprintf("%s: %s", rule.Name, state.Hex)
		}
	}

	return TriggeredAlert{
		Rule:      rule,
		Hex:       state.Hex,
		Callsign:  state.Callsign,
		Message:   message,
		Timestamp: time.Now(),
		Actions:   rule.Actions,
	}
}

// formatMessage formats an alert message with aircraft data
func (e *AlertEngine) formatMessage(template string, state *AircraftState) string {
	msg := template

	callsign := state.Callsign
	if callsign == "" {
		callsign = state.Hex
	}

	msg = strings.ReplaceAll(msg, "{callsign}", callsign)
	msg = strings.ReplaceAll(msg, "{hex}", state.Hex)
	msg = strings.ReplaceAll(msg, "{squawk}", state.Squawk)

	if state.HasAlt {
		msg = strings.ReplaceAll(msg, "{altitude}", fmt.Sprintf("%d", state.Altitude))
	} else {
		msg = strings.ReplaceAll(msg, "{altitude}", "---")
	}

	if state.Distance > 0 {
		msg = strings.ReplaceAll(msg, "{distance}", fmt.Sprintf("%.1f", state.Distance))
	} else {
		msg = strings.ReplaceAll(msg, "{distance}", "---")
	}

	if state.HasSpeed {
		msg = strings.ReplaceAll(msg, "{speed}", fmt.Sprintf("%.0f", state.Speed))
	} else {
		msg = strings.ReplaceAll(msg, "{speed}", "---")
	}

	return msg
}

// GetRecentAlerts returns recent triggered alerts
func (e *AlertEngine) GetRecentAlerts() []TriggeredAlert {
	e.mutex.RLock()
	defer e.mutex.RUnlock()

	result := make([]TriggeredAlert, len(e.recentAlerts))
	copy(result, e.recentAlerts)
	return result
}

// IsHighlighted checks if an aircraft should be highlighted
func (e *AlertEngine) IsHighlighted(hex string) bool {
	e.mutex.RLock()
	defer e.mutex.RUnlock()

	if highlightTime, exists := e.highlightedAircraft[hex]; exists {
		if time.Since(highlightTime) < e.highlightDuration {
			return true
		}
	}
	return false
}

// GetHighlightedAircraft returns all currently highlighted aircraft hex codes
func (e *AlertEngine) GetHighlightedAircraft() []string {
	e.mutex.RLock()
	defer e.mutex.RUnlock()

	var result []string
	now := time.Now()
	for hex, highlightTime := range e.highlightedAircraft {
		if now.Sub(highlightTime) < e.highlightDuration {
			result = append(result, hex)
		}
	}
	return result
}

// CleanupOldData removes old state tracking data
func (e *AlertEngine) CleanupOldData() {
	e.mutex.Lock()
	defer e.mutex.Unlock()

	// Clean up old highlight entries
	now := time.Now()
	for hex, highlightTime := range e.highlightedAircraft {
		if now.Sub(highlightTime) > e.highlightDuration {
			delete(e.highlightedAircraft, hex)
		}
	}

	// Clean up old rule triggers
	e.ruleSet.ClearAllOldTriggers()
}

// RemoveAircraftState removes tracking data for an aircraft that is no longer seen
func (e *AlertEngine) RemoveAircraftState(hex string) {
	e.mutex.Lock()
	defer e.mutex.Unlock()
	delete(e.prevStates, hex)
}

// HasAction checks if any triggered alert has a specific action type
func HasAction(alerts []TriggeredAlert, actionType ActionType) bool {
	for _, alert := range alerts {
		for _, action := range alert.Actions {
			if action.Type == actionType {
				return true
			}
		}
	}
	return false
}

// GetNotifyMessages returns all notification messages from triggered alerts
func GetNotifyMessages(alerts []TriggeredAlert) []string {
	var messages []string
	for _, alert := range alerts {
		for _, action := range alert.Actions {
			if action.Type == ActionNotify {
				messages = append(messages, alert.Message)
				break
			}
		}
	}
	return messages
}

// AlertStats holds statistics about alert activity
type AlertStats struct {
	TotalRules     int
	EnabledRules   int
	TotalGeofences int
	RecentAlerts   int
	Highlighted    int
}

// GetStats returns current alert engine statistics
func (e *AlertEngine) GetStats() AlertStats {
	e.mutex.RLock()
	defer e.mutex.RUnlock()

	stats := AlertStats{
		TotalRules:     e.ruleSet.Count(),
		EnabledRules:   len(e.ruleSet.GetEnabledRules()),
		TotalGeofences: e.geofenceManager.Count(),
		RecentAlerts:   len(e.recentAlerts),
	}

	// Count currently highlighted aircraft
	now := time.Now()
	for _, highlightTime := range e.highlightedAircraft {
		if now.Sub(highlightTime) < e.highlightDuration {
			stats.Highlighted++
		}
	}

	return stats
}
