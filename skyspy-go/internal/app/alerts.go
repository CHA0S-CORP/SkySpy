// Package app provides alert integration for the SkySpy radar
package app

import (
	"time"

	"github.com/skyspy/skyspy-go/internal/alerts"
	"github.com/skyspy/skyspy-go/internal/config"
	"github.com/skyspy/skyspy-go/internal/radar"
)

// AlertState holds alert-related state for the application
type AlertState struct {
	Engine        *alerts.AlertEngine
	RuleCursor    int
	RecentAlerts  []alerts.TriggeredAlert
	AlertsEnabled bool
}

// NewAlertState creates a new alert state with default rules
func NewAlertState(cfg *config.Config) *AlertState {
	engine := alerts.NewAlertEngine()

	// Load rules from config or use defaults
	if len(cfg.Alerts.Rules) > 0 {
		for _, ruleCfg := range cfg.Alerts.Rules {
			rule := configToAlertRule(ruleCfg)
			engine.AddRule(rule)
		}
	} else {
		// Add default rules
		for _, rule := range alerts.DefaultAlertRules() {
			engine.AddRule(rule)
		}
	}

	// Load geofences from config
	for _, gfCfg := range cfg.Alerts.Geofences {
		gf := configToGeofence(gfCfg)
		engine.AddGeofence(gf)
	}

	return &AlertState{
		Engine:        engine,
		RuleCursor:    0,
		RecentAlerts:  []alerts.TriggeredAlert{},
		AlertsEnabled: cfg.Alerts.Enabled,
	}
}

// CheckAircraft checks an aircraft against alert rules and returns any triggered alerts
func (a *AlertState) CheckAircraft(target *radar.Target, prevTarget *radar.Target) []alerts.TriggeredAlert {
	if !a.AlertsEnabled || a.Engine == nil {
		return nil
	}

	state := targetToAlertState(target)
	var prevState *alerts.AircraftState
	if prevTarget != nil {
		prevState = targetToAlertState(prevTarget)
	}

	triggered := a.Engine.CheckAircraft(state, prevState)

	// Add to recent alerts
	if len(triggered) > 0 {
		a.RecentAlerts = append(a.RecentAlerts, triggered...)
		// Keep only last 20 alerts
		if len(a.RecentAlerts) > 20 {
			a.RecentAlerts = a.RecentAlerts[len(a.RecentAlerts)-20:]
		}
	}

	return triggered
}

// GetRules returns all alert rules
func (a *AlertState) GetRules() []*alerts.AlertRule {
	if a.Engine == nil {
		return nil
	}
	return a.Engine.GetRuleSet().GetRules()
}

// ToggleRule toggles a rule's enabled state
func (a *AlertState) ToggleRule(id string) bool {
	if a.Engine == nil {
		return false
	}
	return a.Engine.GetRuleSet().ToggleRule(id)
}

// IsHighlighted checks if an aircraft should be highlighted due to an alert
func (a *AlertState) IsHighlighted(hex string) bool {
	if a.Engine == nil {
		return false
	}
	return a.Engine.IsHighlighted(hex)
}

// GetStats returns alert statistics
func (a *AlertState) GetStats() alerts.AlertStats {
	if a.Engine == nil {
		return alerts.AlertStats{}
	}
	return a.Engine.GetStats()
}

// Cleanup removes old alert data
func (a *AlertState) Cleanup() {
	if a.Engine != nil {
		a.Engine.CleanupOldData()
	}
}

// SaveToConfig saves alert configuration
func (a *AlertState) SaveToConfig(cfg *config.Config) {
	cfg.Alerts.Enabled = a.AlertsEnabled

	// Save rules
	rules := a.GetRules()
	cfg.Alerts.Rules = make([]config.AlertRuleConfig, len(rules))
	for i, rule := range rules {
		cfg.Alerts.Rules[i] = alertRuleToConfig(rule)
	}

	// Save geofences
	if a.Engine != nil {
		geofences := a.Engine.GetGeofenceManager().GetAllGeofences()
		cfg.Alerts.Geofences = make([]config.GeofenceConfig, len(geofences))
		for i, gf := range geofences {
			cfg.Alerts.Geofences[i] = geofenceToConfig(gf)
		}
	}
}

// Helper functions

func targetToAlertState(t *radar.Target) *alerts.AircraftState {
	if t == nil {
		return nil
	}
	return &alerts.AircraftState{
		Hex:      t.Hex,
		Callsign: t.Callsign,
		Squawk:   t.Squawk,
		Lat:      t.Lat,
		Lon:      t.Lon,
		Altitude: t.Altitude,
		Speed:    t.Speed,
		Distance: t.Distance,
		Military: t.Military,
		HasLat:   t.HasLat,
		HasLon:   t.HasLon,
		HasAlt:   t.HasAlt,
		HasSpeed: t.HasSpeed,
	}
}

func configToAlertRule(cfg config.AlertRuleConfig) *alerts.AlertRule {
	rule := alerts.NewAlertRule(cfg.ID, cfg.Name)
	rule.Description = cfg.Description
	rule.Enabled = cfg.Enabled
	rule.Priority = cfg.Priority

	if cfg.CooldownSec > 0 {
		rule.Cooldown = time.Duration(cfg.CooldownSec) * time.Second
	}

	for _, cond := range cfg.Conditions {
		rule.AddCondition(alerts.ConditionType(cond.Type), cond.Value)
	}

	for _, act := range cfg.Actions {
		action := alerts.Action{
			Type:    alerts.ActionType(act.Type),
			Message: act.Message,
			Sound:   act.Sound,
		}
		rule.Actions = append(rule.Actions, action)
	}

	return rule
}

func alertRuleToConfig(rule *alerts.AlertRule) config.AlertRuleConfig {
	cfg := config.AlertRuleConfig{
		ID:          rule.ID,
		Name:        rule.Name,
		Description: rule.Description,
		Enabled:     rule.Enabled,
		Priority:    rule.Priority,
		CooldownSec: int(rule.Cooldown.Seconds()),
	}

	cfg.Conditions = make([]config.ConditionConfig, len(rule.Conditions))
	for i, cond := range rule.Conditions {
		cfg.Conditions[i] = config.ConditionConfig{
			Type:  string(cond.Type),
			Value: cond.Value,
		}
	}

	cfg.Actions = make([]config.ActionConfig, len(rule.Actions))
	for i, act := range rule.Actions {
		cfg.Actions[i] = config.ActionConfig{
			Type:    string(act.Type),
			Message: act.Message,
			Sound:   act.Sound,
		}
	}

	return cfg
}

func configToGeofence(cfg config.GeofenceConfig) *alerts.Geofence {
	gf := &alerts.Geofence{
		ID:          cfg.ID,
		Name:        cfg.Name,
		Type:        alerts.GeofenceType(cfg.Type),
		Enabled:     cfg.Enabled,
		Description: cfg.Description,
	}

	if cfg.Type == "circle" {
		gf.Center = &alerts.GeofencePoint{
			Lat: cfg.CenterLat,
			Lon: cfg.CenterLon,
		}
		gf.RadiusNM = cfg.RadiusNM
	} else {
		gf.Points = make([]alerts.GeofencePoint, len(cfg.Points))
		for i, p := range cfg.Points {
			gf.Points[i] = alerts.GeofencePoint{
				Lat: p.Lat,
				Lon: p.Lon,
			}
		}
	}

	return gf
}

func geofenceToConfig(gf *alerts.Geofence) config.GeofenceConfig {
	cfg := config.GeofenceConfig{
		ID:          gf.ID,
		Name:        gf.Name,
		Type:        string(gf.Type),
		Enabled:     gf.Enabled,
		Description: gf.Description,
	}

	if gf.Type == alerts.GeofenceCircle && gf.Center != nil {
		cfg.CenterLat = gf.Center.Lat
		cfg.CenterLon = gf.Center.Lon
		cfg.RadiusNM = gf.RadiusNM
	} else {
		cfg.Points = make([]config.GeofencePointConfig, len(gf.Points))
		for i, p := range gf.Points {
			cfg.Points[i] = config.GeofencePointConfig{
				Lat: p.Lat,
				Lon: p.Lon,
			}
		}
	}

	return cfg
}
