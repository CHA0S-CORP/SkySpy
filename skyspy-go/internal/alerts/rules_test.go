package alerts

import (
	"testing"
	"time"
)

func TestMatchesWildcard(t *testing.T) {
	tests := []struct {
		pattern  string
		value    string
		expected bool
	}{
		{"7700", "7700", true},
		{"77*", "7700", true},
		{"77*", "7777", true},
		{"77*", "7600", false},
		{"*00", "7700", true},
		{"*00", "7777", false},
		{"CALL*", "CALLSIGN", true},
		{"CALL*", "OTHER", false},
		{"", "TEST", false},
		{"TEST", "", false},
	}

	for _, tc := range tests {
		result := MatchesWildcard(tc.pattern, tc.value)
		if result != tc.expected {
			t.Errorf("MatchesWildcard(%q, %q) = %v, want %v", tc.pattern, tc.value, result, tc.expected)
		}
	}
}

func TestAlertRuleCooldown(t *testing.T) {
	rule := NewAlertRule("test", "Test Rule")
	rule.SetCooldown(time.Millisecond * 100)

	// First trigger should be allowed
	if !rule.CanTrigger("ABC123") {
		t.Error("First trigger should be allowed")
	}

	rule.RecordTrigger("ABC123")

	// Immediate second trigger should be blocked
	if rule.CanTrigger("ABC123") {
		t.Error("Immediate second trigger should be blocked")
	}

	// Wait for cooldown
	time.Sleep(time.Millisecond * 150)

	// After cooldown, trigger should be allowed again
	if !rule.CanTrigger("ABC123") {
		t.Error("Trigger after cooldown should be allowed")
	}
}

func TestDefaultAlertRules(t *testing.T) {
	rules := DefaultAlertRules()

	if len(rules) == 0 {
		t.Error("DefaultAlertRules should return at least one rule")
	}

	// Check that emergency rule exists
	hasEmergency := false
	for _, r := range rules {
		if r.ID == "emergency_squawk" {
			hasEmergency = true
			break
		}
	}

	if !hasEmergency {
		t.Error("Default rules should include emergency squawk rule")
	}
}

func TestRuleSet(t *testing.T) {
	rs := NewRuleSet()

	r1 := NewAlertRule("rule1", "Rule 1")
	r1.SetPriority(10)
	r1.Enabled = true

	r2 := NewAlertRule("rule2", "Rule 2")
	r2.SetPriority(50)
	r2.Enabled = true

	r3 := NewAlertRule("rule3", "Rule 3")
	r3.SetPriority(30)
	r3.Enabled = false

	rs.AddRule(r1)
	rs.AddRule(r2)
	rs.AddRule(r3)

	if rs.Count() != 3 {
		t.Errorf("RuleSet count = %d, want 3", rs.Count())
	}

	enabled := rs.GetEnabledRules()
	if len(enabled) != 2 {
		t.Errorf("Enabled rules count = %d, want 2", len(enabled))
	}

	// Should be sorted by priority (highest first)
	if enabled[0].ID != "rule2" {
		t.Error("Rules should be sorted by priority (highest first)")
	}

	// Toggle rule
	rs.ToggleRule("rule3")
	enabled = rs.GetEnabledRules()
	if len(enabled) != 3 {
		t.Error("After toggle, rule3 should be enabled")
	}
}

func TestConditionTypes(t *testing.T) {
	// Test that all condition types are valid
	types := []ConditionType{
		ConditionSquawk,
		ConditionCallsign,
		ConditionHex,
		ConditionMilitary,
		ConditionAltitudeAbove,
		ConditionAltitudeBelow,
		ConditionDistanceWithin,
		ConditionEnteringGeofence,
		ConditionSpeedAbove,
	}

	for _, ct := range types {
		if ct == "" {
			t.Error("Condition type should not be empty")
		}
	}
}

func TestActionTypes(t *testing.T) {
	// Test that all action types are valid
	types := []ActionType{
		ActionSound,
		ActionNotify,
		ActionLog,
		ActionHighlight,
	}

	for _, at := range types {
		if at == "" {
			t.Error("Action type should not be empty")
		}
	}
}

func TestClearOldTriggers(t *testing.T) {
	rule := NewAlertRule("test", "Test Rule")
	rule.SetCooldown(time.Millisecond * 10)

	// Record some triggers
	rule.RecordTrigger("ABC123")
	rule.RecordTrigger("DEF456")

	// Wait for triggers to become old (more than 2x cooldown)
	time.Sleep(time.Millisecond * 30)

	// Clear old triggers
	rule.ClearOldTriggers()

	// Triggers should be cleared
	if !rule.CanTrigger("ABC123") {
		t.Error("After clearing, should be able to trigger again")
	}
}

func TestGetRules(t *testing.T) {
	rs := NewRuleSet()

	r1 := NewAlertRule("rule1", "Rule 1")
	r2 := NewAlertRule("rule2", "Rule 2")

	rs.AddRule(r1)
	rs.AddRule(r2)

	rules := rs.GetRules()
	if len(rules) != 2 {
		t.Errorf("GetRules count = %d, want 2", len(rules))
	}

	// Test that we get a copy (not the original slice)
	rules[0] = nil
	originalRules := rs.GetRules()
	if originalRules[0] == nil {
		t.Error("GetRules should return a copy")
	}
}

func TestGetRuleByID(t *testing.T) {
	rs := NewRuleSet()

	r1 := NewAlertRule("rule1", "Rule 1")
	r2 := NewAlertRule("rule2", "Rule 2")

	rs.AddRule(r1)
	rs.AddRule(r2)

	// Test finding existing rule
	found := rs.GetRuleByID("rule1")
	if found == nil {
		t.Error("GetRuleByID should find existing rule")
	}
	if found.Name != "Rule 1" {
		t.Error("GetRuleByID returned wrong rule")
	}

	// Test finding non-existent rule
	notFound := rs.GetRuleByID("nonexistent")
	if notFound != nil {
		t.Error("GetRuleByID should return nil for non-existent rule")
	}
}

func TestParseFloat(t *testing.T) {
	tests := []struct {
		input    string
		expected float64
	}{
		{"123", 123.0},
		{"123.456", 123.456},
		{"-123", -123.0},
		{"-123.456", -123.456},
		{"0", 0.0},
		{"0.5", 0.5},
		{"", 0.0},
		{"abc", 0.0},
		{"12abc", 12.0},
		{"12.34.56", 12.34},
		{"-", 0.0},
		{"-.5", -0.5},
		{"123abc456", 123.0},
		{"12.abc", 12.0},
	}

	for _, tc := range tests {
		result := ParseFloat(tc.input)
		if result != tc.expected {
			t.Errorf("ParseFloat(%q) = %f, want %f", tc.input, result, tc.expected)
		}
	}
}

func TestParseInt(t *testing.T) {
	tests := []struct {
		input    string
		expected int
	}{
		{"123", 123},
		{"-123", -123},
		{"0", 0},
		{"", 0},
		{"abc", 0},
		{"12abc", 12},
		{"-12abc", -12},
		{"-", 0},
		{"--12", 0}, // Second - is not valid
	}

	for _, tc := range tests {
		result := ParseInt(tc.input)
		if result != tc.expected {
			t.Errorf("ParseInt(%q) = %d, want %d", tc.input, result, tc.expected)
		}
	}
}

func TestToggleRuleNotFound(t *testing.T) {
	rs := NewRuleSet()

	r1 := NewAlertRule("rule1", "Rule 1")
	r1.Enabled = true
	rs.AddRule(r1)

	// Toggle non-existent rule should return false
	result := rs.ToggleRule("nonexistent")
	if result != false {
		t.Error("ToggleRule for non-existent rule should return false")
	}
}

func TestRecordTriggerNilMap(t *testing.T) {
	// Create a rule with nil lastTriggered map
	rule := &AlertRule{
		ID:            "test",
		Name:          "Test",
		Cooldown:      time.Minute,
		lastTriggered: nil, // Explicitly nil
	}

	// Should not panic and should create the map
	rule.RecordTrigger("ABC123")

	// Should be able to check trigger now
	if rule.CanTrigger("ABC123") {
		t.Error("Should not be able to trigger immediately after recording")
	}
}

func TestMatchesWildcardCaseInsensitive(t *testing.T) {
	// Test case insensitivity
	if !MatchesWildcard("call*", "CALLSIGN") {
		t.Error("Pattern should match case-insensitively")
	}
	if !MatchesWildcard("CALL*", "callsign") {
		t.Error("Pattern should match case-insensitively")
	}
}

func TestClearAllOldTriggers(t *testing.T) {
	rs := NewRuleSet()

	r1 := NewAlertRule("rule1", "Rule 1")
	r1.SetCooldown(time.Millisecond * 10)
	r1.RecordTrigger("ABC123")

	r2 := NewAlertRule("rule2", "Rule 2")
	r2.SetCooldown(time.Millisecond * 10)
	r2.RecordTrigger("DEF456")

	rs.AddRule(r1)
	rs.AddRule(r2)

	// Wait for triggers to become old
	time.Sleep(time.Millisecond * 30)

	// Clear all old triggers
	rs.ClearAllOldTriggers()

	// Both rules should be able to trigger again
	if !r1.CanTrigger("ABC123") {
		t.Error("Rule 1 should be able to trigger after clearing")
	}
	if !r2.CanTrigger("DEF456") {
		t.Error("Rule 2 should be able to trigger after clearing")
	}
}
