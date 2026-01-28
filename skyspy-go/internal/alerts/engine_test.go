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
