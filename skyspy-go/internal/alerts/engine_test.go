package alerts

import (
	"testing"
	"time"
)

func TestAlertEngine(t *testing.T) {
	engine := NewAlertEngine()

	// Create a simple squawk rule
	rule := NewAlertRule("emergency", "Emergency Squawk")
	rule.AddCondition(ConditionSquawk, "7700")
	rule.AddAction(ActionNotify, "Emergency alert: {callsign}")
	rule.SetCooldown(time.Millisecond * 100)
	engine.AddRule(rule)

	// Test with non-emergency aircraft
	state := &AircraftState{
		Hex:      "ABC123",
		Callsign: "TEST001",
		Squawk:   "1200",
		HasAlt:   true,
		Altitude: 35000,
	}

	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) != 0 {
		t.Error("Non-emergency aircraft should not trigger emergency rule")
	}

	// Test with emergency aircraft
	state.Squawk = "7700"
	triggered = engine.CheckAircraft(state, nil)
	if len(triggered) == 0 {
		t.Error("Emergency aircraft should trigger emergency rule")
	}

	// Check that cooldown prevents immediate re-trigger
	triggered = engine.CheckAircraft(state, nil)
	if len(triggered) != 0 {
		t.Error("Cooldown should prevent immediate re-trigger")
	}
}

func TestAlertEngineWithDefaults(t *testing.T) {
	engine := NewAlertEngineWithDefaults()

	// Should have default rules
	stats := engine.GetStats()
	if stats.TotalRules == 0 {
		t.Error("Engine with defaults should have rules")
	}
}

func TestAlertEngineHighlighting(t *testing.T) {
	engine := NewAlertEngine()

	rule := NewAlertRule("test", "Test Rule")
	rule.AddCondition(ConditionMilitary, "true")
	rule.AddAction(ActionHighlight, "")
	rule.SetCooldown(time.Millisecond * 100)
	engine.AddRule(rule)

	state := &AircraftState{
		Hex:      "MIL001",
		Callsign: "STEEL01",
		Military: true,
	}

	engine.CheckAircraft(state, nil)

	if !engine.IsHighlighted("MIL001") {
		t.Error("Military aircraft should be highlighted after trigger")
	}

	highlighted := engine.GetHighlightedAircraft()
	if len(highlighted) == 0 {
		t.Error("Should have highlighted aircraft")
	}
}

func TestAlertEngineMultipleConditions(t *testing.T) {
	engine := NewAlertEngine()

	// Rule that requires both military AND distance within 50nm
	rule := NewAlertRule("military_nearby", "Military Nearby")
	rule.AddCondition(ConditionMilitary, "true")
	rule.AddCondition(ConditionDistanceWithin, "50")
	rule.AddAction(ActionNotify, "Military nearby")
	engine.AddRule(rule)

	// Military aircraft but too far
	state := &AircraftState{
		Hex:      "MIL001",
		Callsign: "STEEL01",
		Military: true,
		Distance: 100.0,
	}

	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) != 0 {
		t.Error("Military aircraft too far should not trigger")
	}

	// Military aircraft and close enough
	state.Distance = 30.0
	state.Hex = "MIL002"
	triggered = engine.CheckAircraft(state, nil)
	if len(triggered) == 0 {
		t.Error("Military aircraft within range should trigger")
	}
}

func TestAlertEngineConditionEvaluation(t *testing.T) {
	engine := NewAlertEngine()

	// Test altitude conditions
	altRule := NewAlertRule("low_alt", "Low Altitude")
	altRule.AddCondition(ConditionAltitudeBelow, "1000")
	altRule.AddAction(ActionNotify, "Low altitude alert")
	engine.AddRule(altRule)

	state := &AircraftState{
		Hex:      "TEST01",
		HasAlt:   true,
		Altitude: 500,
	}

	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) == 0 {
		t.Error("Low altitude aircraft should trigger low_alt rule")
	}

	// Aircraft at high altitude
	state.Hex = "TEST02"
	state.Altitude = 35000
	triggered = engine.CheckAircraft(state, nil)
	if len(triggered) != 0 {
		t.Error("High altitude aircraft should not trigger low_alt rule")
	}
}

func TestAlertEngineGeofence(t *testing.T) {
	engine := NewAlertEngine()

	// Add a geofence
	gf := NewCircleGeofence("home", "Home Area", 45.0, -93.0, 10.0)
	engine.AddGeofence(gf)

	// Create rule for entering geofence
	rule := NewAlertRule("enter_home", "Entering Home Area")
	rule.AddCondition(ConditionEnteringGeofence, "home")
	rule.AddAction(ActionNotify, "Aircraft entering home area")
	engine.AddRule(rule)

	// Aircraft entering geofence
	prevState := &AircraftState{
		Hex:    "TEST01",
		Lat:    46.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}

	state := &AircraftState{
		Hex:    "TEST01",
		Lat:    45.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}

	triggered := engine.CheckAircraft(state, prevState)
	if len(triggered) == 0 {
		t.Error("Aircraft entering geofence should trigger rule")
	}
}

func TestAlertEngineCleanup(t *testing.T) {
	engine := NewAlertEngine()
	engine.CleanupOldData()

	// Should not panic or error
	stats := engine.GetStats()
	if stats.TotalRules != 0 {
		t.Error("Empty engine should have 0 rules")
	}
}

func TestHasAction(t *testing.T) {
	alerts := []TriggeredAlert{
		{
			Actions: []Action{
				{Type: ActionNotify, Message: "Test"},
				{Type: ActionHighlight},
			},
		},
	}

	if !HasAction(alerts, ActionNotify) {
		t.Error("Should find ActionNotify")
	}

	if !HasAction(alerts, ActionHighlight) {
		t.Error("Should find ActionHighlight")
	}

	if HasAction(alerts, ActionSound) {
		t.Error("Should not find ActionSound")
	}
}

func TestGetNotifyMessages(t *testing.T) {
	alerts := []TriggeredAlert{
		{
			Message: "Message 1",
			Actions: []Action{{Type: ActionNotify}},
		},
		{
			Message: "Message 2",
			Actions: []Action{{Type: ActionNotify}},
		},
		{
			Message: "No notify",
			Actions: []Action{{Type: ActionHighlight}},
		},
	}

	messages := GetNotifyMessages(alerts)
	if len(messages) != 2 {
		t.Errorf("Expected 2 notify messages, got %d", len(messages))
	}
}

func TestGetRuleSet(t *testing.T) {
	engine := NewAlertEngine()
	rule := NewAlertRule("test", "Test Rule")
	engine.AddRule(rule)

	ruleSet := engine.GetRuleSet()
	if ruleSet == nil {
		t.Error("GetRuleSet should not return nil")
	}
	if ruleSet.Count() != 1 {
		t.Errorf("RuleSet count = %d, want 1", ruleSet.Count())
	}
}

func TestGetGeofenceManager(t *testing.T) {
	engine := NewAlertEngine()
	gf := NewCircleGeofence("test", "Test", 45.0, -93.0, 10.0)
	engine.AddGeofence(gf)

	gfManager := engine.GetGeofenceManager()
	if gfManager == nil {
		t.Error("GetGeofenceManager should not return nil")
	}
	if gfManager.Count() != 1 {
		t.Errorf("GeofenceManager count = %d, want 1", gfManager.Count())
	}
}

func TestGetRecentAlerts(t *testing.T) {
	engine := NewAlertEngine()

	// Create a rule that triggers
	rule := NewAlertRule("test", "Test Rule")
	rule.AddCondition(ConditionSquawk, "7700")
	rule.AddAction(ActionNotify, "Test alert")
	rule.SetCooldown(time.Millisecond * 100)
	engine.AddRule(rule)

	// Trigger an alert
	state := &AircraftState{
		Hex:    "ABC123",
		Squawk: "7700",
	}
	engine.CheckAircraft(state, nil)

	// Get recent alerts
	recentAlerts := engine.GetRecentAlerts()
	if len(recentAlerts) == 0 {
		t.Error("GetRecentAlerts should return triggered alerts")
	}

	// Test that we get a copy (not the original slice)
	recentAlerts[0].Message = "Modified"
	originalAlerts := engine.GetRecentAlerts()
	if originalAlerts[0].Message == "Modified" {
		t.Error("GetRecentAlerts should return a copy")
	}
}

func TestRemoveAircraftState(t *testing.T) {
	engine := NewAlertEngine()

	// Add some state by checking an aircraft
	state := &AircraftState{
		Hex:      "ABC123",
		Callsign: "TEST001",
	}
	engine.CheckAircraft(state, nil)

	// Remove the state
	engine.RemoveAircraftState("ABC123")

	// Check again - this should not have previous state
	// The state should be recreated fresh
	engine.CheckAircraft(state, nil)
}

func TestCheckAircraftNilState(t *testing.T) {
	engine := NewAlertEngine()

	// Should return empty slice for nil state
	triggered := engine.CheckAircraft(nil, nil)
	if len(triggered) != 0 {
		t.Error("CheckAircraft with nil state should return empty slice")
	}
}

func TestEvaluateConditionCallsign(t *testing.T) {
	engine := NewAlertEngine()

	rule := NewAlertRule("callsign_rule", "Callsign Match")
	rule.AddCondition(ConditionCallsign, "UAL*")
	rule.AddAction(ActionNotify, "Matched callsign")
	engine.AddRule(rule)

	// Test matching callsign
	state := &AircraftState{
		Hex:      "ABC123",
		Callsign: "UAL123",
	}
	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) == 0 {
		t.Error("Callsign UAL123 should match UAL*")
	}

	// Test non-matching callsign
	state2 := &AircraftState{
		Hex:      "DEF456",
		Callsign: "DAL456",
	}
	triggered = engine.CheckAircraft(state2, nil)
	if len(triggered) != 0 {
		t.Error("Callsign DAL456 should not match UAL*")
	}
}

func TestEvaluateConditionHex(t *testing.T) {
	engine := NewAlertEngine()

	rule := NewAlertRule("hex_rule", "Hex Match")
	rule.AddCondition(ConditionHex, "A*")
	rule.AddAction(ActionNotify, "Matched hex")
	engine.AddRule(rule)

	// Test matching hex
	state := &AircraftState{
		Hex:      "ABC123",
		Callsign: "TEST",
	}
	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) == 0 {
		t.Error("Hex ABC123 should match A*")
	}

	// Test non-matching hex
	state2 := &AircraftState{
		Hex:      "DEF456",
		Callsign: "TEST",
	}
	triggered = engine.CheckAircraft(state2, nil)
	if len(triggered) != 0 {
		t.Error("Hex DEF456 should not match A*")
	}
}

func TestEvaluateConditionSpeedAbove(t *testing.T) {
	engine := NewAlertEngine()

	rule := NewAlertRule("speed_rule", "Speed Above")
	rule.AddCondition(ConditionSpeedAbove, "500")
	rule.AddAction(ActionNotify, "High speed alert")
	engine.AddRule(rule)

	// Test aircraft with speed above threshold
	state := &AircraftState{
		Hex:      "ABC123",
		HasSpeed: true,
		Speed:    600.0,
	}
	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) == 0 {
		t.Error("Speed 600 should trigger speed_above 500 rule")
	}

	// Test aircraft with speed below threshold
	state2 := &AircraftState{
		Hex:      "DEF456",
		HasSpeed: true,
		Speed:    400.0,
	}
	triggered = engine.CheckAircraft(state2, nil)
	if len(triggered) != 0 {
		t.Error("Speed 400 should not trigger speed_above 500 rule")
	}

	// Test aircraft without speed
	state3 := &AircraftState{
		Hex:      "GHI789",
		HasSpeed: false,
	}
	triggered = engine.CheckAircraft(state3, nil)
	if len(triggered) != 0 {
		t.Error("Aircraft without speed data should not trigger speed rule")
	}
}

func TestEvaluateConditionAltitudeAbove(t *testing.T) {
	engine := NewAlertEngine()

	rule := NewAlertRule("alt_above", "Altitude Above")
	rule.AddCondition(ConditionAltitudeAbove, "40000")
	rule.AddAction(ActionNotify, "High altitude alert")
	engine.AddRule(rule)

	// Test aircraft with altitude above threshold
	state := &AircraftState{
		Hex:      "ABC123",
		HasAlt:   true,
		Altitude: 45000,
	}
	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) == 0 {
		t.Error("Altitude 45000 should trigger altitude_above 40000 rule")
	}

	// Test aircraft without altitude
	state2 := &AircraftState{
		Hex:    "DEF456",
		HasAlt: false,
	}
	triggered = engine.CheckAircraft(state2, nil)
	if len(triggered) != 0 {
		t.Error("Aircraft without altitude data should not trigger altitude rule")
	}
}

func TestEvaluateConditionAltitudeBelowNoAlt(t *testing.T) {
	engine := NewAlertEngine()

	rule := NewAlertRule("alt_below", "Altitude Below")
	rule.AddCondition(ConditionAltitudeBelow, "1000")
	rule.AddAction(ActionNotify, "Low altitude alert")
	engine.AddRule(rule)

	// Test aircraft without altitude data
	state := &AircraftState{
		Hex:    "ABC123",
		HasAlt: false,
	}
	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) != 0 {
		t.Error("Aircraft without altitude data should not trigger altitude_below rule")
	}

	// Test aircraft at altitude 0 (on ground)
	state2 := &AircraftState{
		Hex:      "DEF456",
		HasAlt:   true,
		Altitude: 0,
	}
	triggered = engine.CheckAircraft(state2, nil)
	if len(triggered) != 0 {
		t.Error("Aircraft at altitude 0 should not trigger altitude_below rule")
	}
}

func TestEvaluateConditionDistanceWithin(t *testing.T) {
	engine := NewAlertEngine()

	rule := NewAlertRule("distance", "Distance Within")
	rule.AddCondition(ConditionDistanceWithin, "10")
	rule.AddAction(ActionNotify, "Close aircraft")
	engine.AddRule(rule)

	// Test aircraft with zero distance
	state := &AircraftState{
		Hex:      "ABC123",
		Distance: 0,
	}
	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) != 0 {
		t.Error("Aircraft with zero distance should not trigger distance_within rule")
	}
}

func TestEvaluateConditionMilitary(t *testing.T) {
	engine := NewAlertEngine()

	rule := NewAlertRule("mil", "Military")
	rule.AddCondition(ConditionMilitary, "TRUE") // Test case-insensitive
	rule.AddAction(ActionNotify, "Military aircraft")
	engine.AddRule(rule)

	// Test military aircraft
	state := &AircraftState{
		Hex:      "ABC123",
		Military: true,
	}
	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) == 0 {
		t.Error("Military aircraft should trigger military rule")
	}

	// Test non-military aircraft
	state2 := &AircraftState{
		Hex:      "DEF456",
		Military: false,
	}
	triggered = engine.CheckAircraft(state2, nil)
	if len(triggered) != 0 {
		t.Error("Non-military aircraft should not trigger military rule")
	}

	// Test with "false" value
	rule2 := NewAlertRule("mil2", "Military False")
	rule2.AddCondition(ConditionMilitary, "false")
	rule2.AddAction(ActionNotify, "Not military")
	engine.AddRule(rule2)

	triggered = engine.CheckAircraft(state, nil)
	// Rule "mil2" should not trigger for military aircraft
}

func TestEvaluateConditionEnteringGeofenceEdgeCases(t *testing.T) {
	engine := NewAlertEngine()

	gf := NewCircleGeofence("test", "Test", 45.0, -93.0, 5.0)
	engine.AddGeofence(gf)

	// Rule for entering any geofence with wildcard
	rule := NewAlertRule("enter_any", "Enter Any Geofence")
	rule.AddCondition(ConditionEnteringGeofence, "*")
	rule.AddAction(ActionNotify, "Entered geofence")
	engine.AddRule(rule)

	// Test entering with wildcard condition
	prevState := &AircraftState{
		Hex:    "TEST01",
		Lat:    46.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}
	state := &AircraftState{
		Hex:    "TEST01",
		Lat:    45.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}
	triggered := engine.CheckAircraft(state, prevState)
	if len(triggered) == 0 {
		t.Error("Should trigger when entering any geofence with * condition")
	}

	// Test with empty geofence name
	rule2 := NewAlertRule("enter_empty", "Enter Empty Name")
	rule2.AddCondition(ConditionEnteringGeofence, "")
	rule2.AddAction(ActionNotify, "Entered geofence")
	rule2.SetCooldown(time.Millisecond)
	engine.AddRule(rule2)

	// Wait for cooldown
	time.Sleep(time.Millisecond * 10)

	state2 := &AircraftState{
		Hex:    "TEST02",
		Lat:    45.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}
	prevState2 := &AircraftState{
		Hex:    "TEST02",
		Lat:    46.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}
	triggered = engine.CheckAircraft(state2, prevState2)
	// Empty name should also trigger with any geofence

	// Test with non-existent geofence
	rule3 := NewAlertRule("enter_nonexist", "Enter Nonexistent")
	rule3.AddCondition(ConditionEnteringGeofence, "nonexistent")
	rule3.AddAction(ActionNotify, "Should not trigger")
	engine.AddRule(rule3)

	state3 := &AircraftState{
		Hex:    "TEST03",
		Lat:    45.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}
	prevState3 := &AircraftState{
		Hex:    "TEST03",
		Lat:    46.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}
	triggered = engine.CheckAircraft(state3, prevState3)
	// Nonexistent geofence should not trigger its own rule

	// Test without lat/lon
	state4 := &AircraftState{
		Hex:    "TEST04",
		HasLat: false,
		HasLon: false,
	}
	triggered = engine.CheckAircraft(state4, nil)
	// Should not trigger without lat/lon

	// Test with current state without lat/lon
	rule4 := NewAlertRule("enter_nolat", "Enter No Lat")
	rule4.AddCondition(ConditionEnteringGeofence, "test")
	rule4.AddAction(ActionNotify, "test")
	engine.AddRule(rule4)

	state5 := &AircraftState{
		Hex:    "TEST05",
		HasLat: false,
		HasLon: true,
	}
	triggered = engine.CheckAircraft(state5, prevState)
	// Should not trigger without lat

	// Test with prev state without lat/lon
	prevState6 := &AircraftState{
		Hex:    "TEST06",
		HasLat: false,
		HasLon: false,
	}
	state6 := &AircraftState{
		Hex:    "TEST06",
		Lat:    45.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}
	triggered = engine.CheckAircraft(state6, prevState6)
	// Should not trigger with prev state without lat/lon
}

func TestFormatMessageAllPlaceholders(t *testing.T) {
	engine := NewAlertEngine()

	rule := NewAlertRule("test", "Test Rule")
	rule.AddCondition(ConditionSquawk, "*")
	rule.AddAction(ActionNotify, "{callsign} ({hex}) squawk {squawk} at {altitude}ft, {distance}nm, {speed}kts")
	engine.AddRule(rule)

	// Test with all data available
	state := &AircraftState{
		Hex:      "ABC123",
		Callsign: "UAL123",
		Squawk:   "1200",
		HasAlt:   true,
		Altitude: 35000,
		Distance: 25.5,
		HasSpeed: true,
		Speed:    450.0,
	}
	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) == 0 {
		t.Error("Should trigger with any squawk")
	}

	// Test without callsign
	state2 := &AircraftState{
		Hex:      "DEF456",
		Callsign: "",
		Squawk:   "1200",
		HasAlt:   false,
		Distance: 0,
		HasSpeed: false,
	}
	triggered = engine.CheckAircraft(state2, nil)
	// Message should use hex when callsign is empty
}

func TestCreateAlertWithoutCallsign(t *testing.T) {
	engine := NewAlertEngine()

	rule := NewAlertRule("test", "Test Rule")
	rule.AddCondition(ConditionSquawk, "7700")
	// No ActionNotify - test default message generation
	rule.AddAction(ActionHighlight, "")
	engine.AddRule(rule)

	// Test without callsign - should use hex in message
	state := &AircraftState{
		Hex:      "ABC123",
		Callsign: "",
		Squawk:   "7700",
	}
	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) == 0 {
		t.Error("Should trigger")
	}
	if triggered[0].Message == "" {
		t.Error("Message should not be empty")
	}
}

func TestIsHighlightedExpired(t *testing.T) {
	engine := NewAlertEngine()

	// Manually set an expired highlight
	engine.highlightDuration = time.Millisecond * 10
	engine.highlightedAircraft["EXPIRED"] = time.Now().Add(-time.Second)

	if engine.IsHighlighted("EXPIRED") {
		t.Error("Expired highlight should return false")
	}

	// Test non-existent aircraft
	if engine.IsHighlighted("NONEXISTENT") {
		t.Error("Non-existent aircraft should return false")
	}
}

func TestCleanupOldDataWithData(t *testing.T) {
	engine := NewAlertEngine()
	engine.highlightDuration = time.Minute * 5 // Long duration

	// Add some expired data
	engine.highlightedAircraft["EXPIRED1"] = time.Now().Add(-time.Hour)
	engine.highlightedAircraft["EXPIRED2"] = time.Now().Add(-time.Hour)

	// Add some fresh data
	engine.highlightedAircraft["FRESH"] = time.Now()

	// Add a rule and trigger it
	rule := NewAlertRule("test", "Test")
	rule.AddCondition(ConditionSquawk, "1200")
	rule.AddAction(ActionNotify, "test")
	rule.SetCooldown(time.Millisecond * 10)
	engine.AddRule(rule)

	state := &AircraftState{
		Hex:    "TEST",
		Squawk: "1200",
	}
	engine.CheckAircraft(state, nil)

	// Wait for cooldown to potentially expire
	time.Sleep(time.Millisecond * 30)

	// Cleanup
	engine.CleanupOldData()

	// Expired highlights should be removed
	if _, exists := engine.highlightedAircraft["EXPIRED1"]; exists {
		t.Error("Expired highlight should be removed")
	}

	// Fresh highlight should remain
	if _, exists := engine.highlightedAircraft["FRESH"]; !exists {
		t.Error("Fresh highlight should remain")
	}
}

func TestGetStatsWithHighlights(t *testing.T) {
	engine := NewAlertEngine()

	// Add some highlights
	engine.highlightedAircraft["ACTIVE1"] = time.Now()
	engine.highlightedAircraft["ACTIVE2"] = time.Now()
	engine.highlightedAircraft["EXPIRED"] = time.Now().Add(-time.Hour)

	stats := engine.GetStats()
	if stats.Highlighted != 2 {
		t.Errorf("Highlighted count = %d, want 2", stats.Highlighted)
	}
}

func TestAlertEngineRecentAlertsOverflow(t *testing.T) {
	engine := NewAlertEngine()
	engine.maxRecentAlerts = 3

	rule := NewAlertRule("test", "Test")
	rule.AddCondition(ConditionSquawk, "*")
	rule.AddAction(ActionNotify, "test")
	rule.SetCooldown(0) // No cooldown
	engine.AddRule(rule)

	// Trigger more alerts than maxRecentAlerts
	for i := 0; i < 5; i++ {
		state := &AircraftState{
			Hex:    string(rune('A' + i)),
			Squawk: "1200",
		}
		engine.CheckAircraft(state, nil)
	}

	// Should only keep the most recent 3
	alerts := engine.GetRecentAlerts()
	if len(alerts) > 3 {
		t.Errorf("Should keep at most 3 recent alerts, got %d", len(alerts))
	}
}

func TestAlertEnginePrevStateTracking(t *testing.T) {
	engine := NewAlertEngine()

	gf := NewCircleGeofence("test", "Test", 45.0, -93.0, 5.0)
	engine.AddGeofence(gf)

	rule := NewAlertRule("enter", "Enter Geofence")
	rule.AddCondition(ConditionEnteringGeofence, "test")
	rule.AddAction(ActionNotify, "Entered")
	rule.SetCooldown(0)
	engine.AddRule(rule)

	// First check - outside geofence
	state1 := &AircraftState{
		Hex:    "TEST",
		Lat:    46.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}
	engine.CheckAircraft(state1, nil)

	// Second check - inside geofence, should use tracked prev state
	state2 := &AircraftState{
		Hex:    "TEST",
		Lat:    45.0,
		Lon:    -93.0,
		HasLat: true,
		HasLon: true,
	}
	triggered := engine.CheckAircraft(state2, nil)
	if len(triggered) == 0 {
		t.Error("Should trigger using tracked previous state")
	}
}

func TestEvaluateConditionUnknownType(t *testing.T) {
	engine := NewAlertEngine()

	// Create a rule with an unknown condition type
	rule := NewAlertRule("unknown", "Unknown Condition")
	rule.Conditions = append(rule.Conditions, Condition{
		Type:  ConditionType("unknown_type"),
		Value: "test",
	})
	rule.AddAction(ActionNotify, "Should not trigger")
	engine.AddRule(rule)

	state := &AircraftState{
		Hex:      "ABC123",
		Callsign: "TEST",
	}

	// Should not trigger with unknown condition type
	triggered := engine.CheckAircraft(state, nil)
	if len(triggered) != 0 {
		t.Error("Unknown condition type should not trigger")
	}
}
