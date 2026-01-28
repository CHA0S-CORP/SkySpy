// Package alerts provides configurable alert rules for aircraft monitoring
package alerts

import (
	"regexp"
	"strings"
	"sync"
	"time"
)

// ConditionType represents the type of condition to check
type ConditionType string

const (
	ConditionSquawk          ConditionType = "squawk"
	ConditionCallsign        ConditionType = "callsign"
	ConditionHex             ConditionType = "hex"
	ConditionMilitary        ConditionType = "military"
	ConditionAltitudeAbove   ConditionType = "altitude_above"
	ConditionAltitudeBelow   ConditionType = "altitude_below"
	ConditionDistanceWithin  ConditionType = "distance_within"
	ConditionEnteringGeofence ConditionType = "entering_geofence"
	ConditionSpeedAbove      ConditionType = "speed_above"
)

// ActionType represents the type of action to take when alert triggers
type ActionType string

const (
	ActionSound     ActionType = "sound"
	ActionNotify    ActionType = "notify"
	ActionLog       ActionType = "log"
	ActionHighlight ActionType = "highlight"
)

// Condition represents a single condition that must be met for an alert
type Condition struct {
	Type  ConditionType `json:"type"`
	Value string        `json:"value"`
}

// Action represents an action to take when an alert triggers
type Action struct {
	Type    ActionType `json:"type"`
	Message string     `json:"message,omitempty"`
	Sound   string     `json:"sound,omitempty"`
}

// AlertRule represents a configurable alert rule
type AlertRule struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Description  string        `json:"description,omitempty"`
	Enabled      bool          `json:"enabled"`
	Conditions   []Condition   `json:"conditions"`
	Actions      []Action      `json:"actions"`
	Cooldown     time.Duration `json:"cooldown"`
	Priority     int           `json:"priority"`

	// Runtime state (not serialized)
	lastTriggered map[string]time.Time
	mutex         sync.RWMutex
}

// NewAlertRule creates a new alert rule with default values
func NewAlertRule(id, name string) *AlertRule {
	return &AlertRule{
		ID:            id,
		Name:          name,
		Enabled:       true,
		Conditions:    []Condition{},
		Actions:       []Action{},
		Cooldown:      time.Minute * 5,
		Priority:      0,
		lastTriggered: make(map[string]time.Time),
	}
}

// AddCondition adds a condition to the rule
func (r *AlertRule) AddCondition(condType ConditionType, value string) *AlertRule {
	r.Conditions = append(r.Conditions, Condition{
		Type:  condType,
		Value: value,
	})
	return r
}

// AddAction adds an action to the rule
func (r *AlertRule) AddAction(actionType ActionType, message string) *AlertRule {
	r.Actions = append(r.Actions, Action{
		Type:    actionType,
		Message: message,
	})
	return r
}

// SetCooldown sets the cooldown duration
func (r *AlertRule) SetCooldown(d time.Duration) *AlertRule {
	r.Cooldown = d
	return r
}

// SetPriority sets the rule priority (higher = more important)
func (r *AlertRule) SetPriority(p int) *AlertRule {
	r.Priority = p
	return r
}

// CanTrigger checks if the rule can trigger for a given aircraft (cooldown check)
func (r *AlertRule) CanTrigger(hex string) bool {
	r.mutex.RLock()
	defer r.mutex.RUnlock()

	if lastTime, exists := r.lastTriggered[hex]; exists {
		return time.Since(lastTime) >= r.Cooldown
	}
	return true
}

// RecordTrigger records that the rule was triggered for an aircraft
func (r *AlertRule) RecordTrigger(hex string) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	if r.lastTriggered == nil {
		r.lastTriggered = make(map[string]time.Time)
	}
	r.lastTriggered[hex] = time.Now()
}

// ClearOldTriggers removes trigger records older than the cooldown period
func (r *AlertRule) ClearOldTriggers() {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	now := time.Now()
	for hex, triggered := range r.lastTriggered {
		if now.Sub(triggered) > r.Cooldown*2 {
			delete(r.lastTriggered, hex)
		}
	}
}

// TriggeredAlert represents an alert that has been triggered
type TriggeredAlert struct {
	Rule      *AlertRule
	Hex       string
	Callsign  string
	Message   string
	Timestamp time.Time
	Actions   []Action
}

// AircraftState represents the current state of an aircraft for alert checking
type AircraftState struct {
	Hex       string
	Callsign  string
	Squawk    string
	Lat       float64
	Lon       float64
	Altitude  int
	Speed     float64
	Distance  float64
	Military  bool
	HasLat    bool
	HasLon    bool
	HasAlt    bool
	HasSpeed  bool
}

// MatchesWildcard checks if a string matches a wildcard pattern
// Supports * as wildcard for any characters
func MatchesWildcard(pattern, value string) bool {
	if pattern == "" {
		return false
	}

	// Convert wildcard pattern to regex
	pattern = strings.ToUpper(pattern)
	value = strings.ToUpper(value)

	// Escape special regex characters except *
	escaped := regexp.QuoteMeta(pattern)
	// Replace escaped \* with .*
	escaped = strings.ReplaceAll(escaped, `\*`, `.*`)

	// Compile and match
	re, err := regexp.Compile("^" + escaped + "$")
	if err != nil {
		return pattern == value
	}

	return re.MatchString(value)
}

// ParseFloat parses a string to float64, returns 0 on error
func ParseFloat(s string) float64 {
	var result float64
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= '0' && c <= '9' {
			result = result*10 + float64(c-'0')
		} else if c == '.' {
			// Parse decimal part
			decimal := 0.1
			for j := i + 1; j < len(s); j++ {
				c := s[j]
				if c >= '0' && c <= '9' {
					result += float64(c-'0') * decimal
					decimal *= 0.1
				} else {
					break
				}
			}
			break
		} else if c == '-' && i == 0 {
			// Negative number handled at end
			continue
		} else {
			break
		}
	}

	if len(s) > 0 && s[0] == '-' {
		result = -result
	}

	return result
}

// ParseInt parses a string to int, returns 0 on error
func ParseInt(s string) int {
	var result int
	negative := false

	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= '0' && c <= '9' {
			result = result*10 + int(c-'0')
		} else if c == '-' && i == 0 {
			negative = true
		} else {
			break
		}
	}

	if negative {
		result = -result
	}

	return result
}

// DefaultAlertRules returns the default alert rules
func DefaultAlertRules() []*AlertRule {
	rules := []*AlertRule{}

	// Emergency squawk rule (7500/7600/7700)
	emergency := NewAlertRule("emergency_squawk", "Emergency Squawk")
	emergency.Description = "Aircraft transmitting emergency squawk code"
	emergency.AddCondition(ConditionSquawk, "77*")
	emergency.AddCondition(ConditionSquawk, "76*")
	emergency.AddCondition(ConditionSquawk, "75*")
	emergency.AddAction(ActionNotify, "EMERGENCY: {callsign} squawking {squawk}")
	emergency.AddAction(ActionSound, "emergency")
	emergency.AddAction(ActionHighlight, "")
	emergency.SetCooldown(time.Minute * 1)
	emergency.SetPriority(100)
	rules = append(rules, emergency)

	// Military aircraft nearby
	military := NewAlertRule("military_nearby", "Military Aircraft Nearby")
	military.Description = "Military aircraft within 50nm"
	military.AddCondition(ConditionMilitary, "true")
	military.AddCondition(ConditionDistanceWithin, "50")
	military.AddAction(ActionNotify, "MILITARY: {callsign} at {distance}nm")
	military.AddAction(ActionHighlight, "")
	military.SetCooldown(time.Minute * 10)
	military.SetPriority(50)
	rules = append(rules, military)

	// Low altitude aircraft
	lowAlt := NewAlertRule("low_altitude", "Low Altitude Aircraft")
	lowAlt.Description = "Aircraft below 1000ft AGL"
	lowAlt.AddCondition(ConditionAltitudeBelow, "1000")
	lowAlt.AddCondition(ConditionDistanceWithin, "25")
	lowAlt.AddAction(ActionNotify, "LOW ALT: {callsign} at {altitude}ft")
	lowAlt.SetCooldown(time.Minute * 5)
	lowAlt.SetPriority(30)
	rules = append(rules, lowAlt)

	return rules
}

// RuleSet manages a collection of alert rules
type RuleSet struct {
	rules []*AlertRule
	mutex sync.RWMutex
}

// NewRuleSet creates a new empty rule set
func NewRuleSet() *RuleSet {
	return &RuleSet{
		rules: []*AlertRule{},
	}
}

// AddRule adds a rule to the set
func (rs *RuleSet) AddRule(rule *AlertRule) {
	rs.mutex.Lock()
	defer rs.mutex.Unlock()
	rs.rules = append(rs.rules, rule)
}

// GetRules returns all rules
func (rs *RuleSet) GetRules() []*AlertRule {
	rs.mutex.RLock()
	defer rs.mutex.RUnlock()

	result := make([]*AlertRule, len(rs.rules))
	copy(result, rs.rules)
	return result
}

// GetEnabledRules returns only enabled rules, sorted by priority
func (rs *RuleSet) GetEnabledRules() []*AlertRule {
	rs.mutex.RLock()
	defer rs.mutex.RUnlock()

	var enabled []*AlertRule
	for _, rule := range rs.rules {
		if rule.Enabled {
			enabled = append(enabled, rule)
		}
	}

	// Sort by priority (higher first)
	for i := 0; i < len(enabled)-1; i++ {
		for j := i + 1; j < len(enabled); j++ {
			if enabled[i].Priority < enabled[j].Priority {
				enabled[i], enabled[j] = enabled[j], enabled[i]
			}
		}
	}

	return enabled
}

// ToggleRule toggles a rule's enabled state by ID
func (rs *RuleSet) ToggleRule(id string) bool {
	rs.mutex.Lock()
	defer rs.mutex.Unlock()

	for _, rule := range rs.rules {
		if rule.ID == id {
			rule.Enabled = !rule.Enabled
			return rule.Enabled
		}
	}
	return false
}

// GetRuleByID returns a rule by its ID
func (rs *RuleSet) GetRuleByID(id string) *AlertRule {
	rs.mutex.RLock()
	defer rs.mutex.RUnlock()

	for _, rule := range rs.rules {
		if rule.ID == id {
			return rule
		}
	}
	return nil
}

// Count returns the number of rules
func (rs *RuleSet) Count() int {
	rs.mutex.RLock()
	defer rs.mutex.RUnlock()
	return len(rs.rules)
}

// ClearAllOldTriggers clears old triggers from all rules
func (rs *RuleSet) ClearAllOldTriggers() {
	rs.mutex.RLock()
	defer rs.mutex.RUnlock()

	for _, rule := range rs.rules {
		rule.ClearOldTriggers()
	}
}
