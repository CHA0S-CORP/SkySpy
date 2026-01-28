package alerts

import (
	"testing"
)

func TestCircleGeofence(t *testing.T) {
	// Create a circular geofence centered at (0, 0) with 10nm radius
	gf := NewCircleGeofence("test", "Test Circle", 0.0, 0.0, 10.0)

	// Point at center should be inside
	if !gf.Contains(0, 0) {
		t.Error("Center point should be inside circle geofence")
	}

	// Point far away should be outside
	if gf.Contains(45.0, 45.0) {
		t.Error("Point far away should be outside circle geofence")
	}

	// Disabled geofence should return false
	gf.Enabled = false
	if gf.Contains(0, 0) {
		t.Error("Disabled geofence should return false")
	}
}

func TestPolygonGeofence(t *testing.T) {
	// Create a square polygon geofence
	points := []GeofencePoint{
		{Lat: 0.0, Lon: 0.0},
		{Lat: 0.0, Lon: 1.0},
		{Lat: 1.0, Lon: 1.0},
		{Lat: 1.0, Lon: 0.0},
	}
	gf := NewPolygonGeofence("test", "Test Polygon", points)

	// Point inside should return true
	if !gf.Contains(0.5, 0.5) {
		t.Error("Point inside polygon should return true")
	}

	// Point outside should return false
	if gf.Contains(2.0, 2.0) {
		t.Error("Point outside polygon should return false")
	}
}

func TestGeofenceManager(t *testing.T) {
	mgr := NewGeofenceManager()

	gf1 := NewCircleGeofence("gf1", "Geofence 1", 0.0, 0.0, 10.0)
	gf2 := NewCircleGeofence("gf2", "Geofence 2", 10.0, 10.0, 5.0)
	gf2.Enabled = false

	mgr.AddGeofence(gf1)
	mgr.AddGeofence(gf2)

	if mgr.Count() != 2 {
		t.Errorf("GeofenceManager count = %d, want 2", mgr.Count())
	}

	enabled := mgr.GetEnabledGeofences()
	if len(enabled) != 1 {
		t.Errorf("Enabled geofences = %d, want 1", len(enabled))
	}

	// Check point in gf1
	results := mgr.CheckPoint(0.0, 0.0)
	if len(results) == 0 {
		t.Error("Point at (0,0) should be in gf1")
	}

	// Toggle gf2
	mgr.ToggleGeofence("gf2")
	enabled = mgr.GetEnabledGeofences()
	if len(enabled) != 2 {
		t.Error("After toggle, both geofences should be enabled")
	}

	// Remove gf1
	if !mgr.RemoveGeofence("gf1") {
		t.Error("RemoveGeofence should return true for existing geofence")
	}
	if mgr.Count() != 1 {
		t.Error("After removal, count should be 1")
	}
}

func TestHaversineDistanceNM(t *testing.T) {
	// Test distance from (0,0) to (0,1) - approximately 60nm at equator
	dist := haversineDistanceNM(0, 0, 0, 1)

	// Should be approximately 60nm (1 degree longitude at equator)
	if dist < 55 || dist > 65 {
		t.Errorf("Distance should be approximately 60nm, got %f", dist)
	}
}

func TestGeofenceBoundingBox(t *testing.T) {
	// Test circle bounding box
	circle := NewCircleGeofence("test", "Test", 45.0, -93.0, 10.0)
	minLat, minLon, maxLat, maxLon := circle.GetBoundingBox()

	if minLat >= maxLat {
		t.Error("minLat should be less than maxLat")
	}
	if minLon >= maxLon {
		t.Error("minLon should be less than maxLon")
	}

	// Test polygon bounding box
	points := []GeofencePoint{
		{Lat: 0.0, Lon: 0.0},
		{Lat: 0.0, Lon: 2.0},
		{Lat: 2.0, Lon: 2.0},
		{Lat: 2.0, Lon: 0.0},
	}
	polygon := NewPolygonGeofence("test", "Test", points)
	minLat, minLon, maxLat, maxLon = polygon.GetBoundingBox()

	if minLat != 0.0 || minLon != 0.0 || maxLat != 2.0 || maxLon != 2.0 {
		t.Errorf("Polygon bounding box incorrect: (%f,%f) to (%f,%f)", minLat, minLon, maxLat, maxLon)
	}
}

func TestCheckEntering(t *testing.T) {
	mgr := NewGeofenceManager()
	gf := NewCircleGeofence("test", "Test", 45.0, -93.0, 5.0)
	mgr.AddGeofence(gf)

	// Entering from outside to inside
	entered := mgr.CheckEntering(45.5, -93.0, 45.0, -93.0)
	if len(entered) == 0 {
		t.Error("Should detect entering geofence")
	}

	// Staying inside (not entering)
	entered = mgr.CheckEntering(45.0, -93.0, 45.0, -93.0)
	if len(entered) != 0 {
		t.Error("Should not detect entering when already inside")
	}

	// Staying outside
	entered = mgr.CheckEntering(50.0, -93.0, 50.1, -93.0)
	if len(entered) != 0 {
		t.Error("Should not detect entering when staying outside")
	}
}
