package alerts

import (
	"math"
	"os"
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

func TestGetAllGeofences(t *testing.T) {
	mgr := NewGeofenceManager()

	gf1 := NewCircleGeofence("gf1", "Geofence 1", 0.0, 0.0, 10.0)
	gf2 := NewCircleGeofence("gf2", "Geofence 2", 10.0, 10.0, 5.0)

	mgr.AddGeofence(gf1)
	mgr.AddGeofence(gf2)

	all := mgr.GetAllGeofences()
	if len(all) != 2 {
		t.Errorf("GetAllGeofences count = %d, want 2", len(all))
	}

	// Check order is preserved
	if all[0].ID != "gf1" || all[1].ID != "gf2" {
		t.Error("GetAllGeofences should preserve insertion order")
	}
}

func TestLoadGeofencesFromFile(t *testing.T) {
	// Create a temp file with geofence JSON
	tmpDir := t.TempDir()
	tmpFile := tmpDir + "/geofences.json"

	// Test loading array of geofences
	jsonData := `[
		{"id": "gf1", "name": "Test 1", "type": "circle", "center": {"lat": 45.0, "lon": -93.0}, "radius_nm": 10.0, "enabled": true},
		{"id": "gf2", "name": "Test 2", "type": "polygon", "points": [{"lat": 0, "lon": 0}, {"lat": 0, "lon": 1}, {"lat": 1, "lon": 1}], "enabled": true}
	]`

	if err := os.WriteFile(tmpFile, []byte(jsonData), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	geofences, err := LoadGeofencesFromFile(tmpFile)
	if err != nil {
		t.Fatalf("LoadGeofencesFromFile failed: %v", err)
	}
	if len(geofences) != 2 {
		t.Errorf("Expected 2 geofences, got %d", len(geofences))
	}

	// Test loading single geofence
	singleFile := tmpDir + "/single.json"
	singleJson := `{"id": "single", "name": "Single", "type": "circle", "center": {"lat": 45.0, "lon": -93.0}, "radius_nm": 5.0, "enabled": true}`
	if err := os.WriteFile(singleFile, []byte(singleJson), 0644); err != nil {
		t.Fatalf("Failed to write single test file: %v", err)
	}

	geofences, err = LoadGeofencesFromFile(singleFile)
	if err != nil {
		t.Fatalf("LoadGeofencesFromFile (single) failed: %v", err)
	}
	if len(geofences) != 1 {
		t.Errorf("Expected 1 geofence, got %d", len(geofences))
	}

	// Test loading non-existent file
	_, err = LoadGeofencesFromFile(tmpDir + "/nonexistent.json")
	if err == nil {
		t.Error("LoadGeofencesFromFile should fail for non-existent file")
	}

	// Test loading invalid JSON
	invalidFile := tmpDir + "/invalid.json"
	if err := os.WriteFile(invalidFile, []byte("not json"), 0644); err != nil {
		t.Fatalf("Failed to write invalid test file: %v", err)
	}
	_, err = LoadGeofencesFromFile(invalidFile)
	if err == nil {
		t.Error("LoadGeofencesFromFile should fail for invalid JSON")
	}
}

func TestSaveGeofencesToFile(t *testing.T) {
	tmpDir := t.TempDir()
	tmpFile := tmpDir + "/save_test.json"

	geofences := []*Geofence{
		NewCircleGeofence("test1", "Test 1", 45.0, -93.0, 10.0),
		NewPolygonGeofence("test2", "Test 2", []GeofencePoint{{Lat: 0, Lon: 0}, {Lat: 0, Lon: 1}, {Lat: 1, Lon: 1}}),
	}

	err := SaveGeofencesToFile(tmpFile, geofences)
	if err != nil {
		t.Fatalf("SaveGeofencesToFile failed: %v", err)
	}

	// Verify the file was created and can be loaded back
	loaded, err := LoadGeofencesFromFile(tmpFile)
	if err != nil {
		t.Fatalf("Failed to load saved geofences: %v", err)
	}
	if len(loaded) != 2 {
		t.Errorf("Expected 2 loaded geofences, got %d", len(loaded))
	}
}

func TestLoadGeofenceFromGeoJSON(t *testing.T) {
	tmpDir := t.TempDir()

	// Test FeatureCollection
	featureCollectionFile := tmpDir + "/feature_collection.geojson"
	featureCollectionJson := `{
		"type": "FeatureCollection",
		"features": [{
			"type": "Feature",
			"properties": {"name": "Test Area"},
			"geometry": {
				"type": "Polygon",
				"coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
			}
		}]
	}`
	if err := os.WriteFile(featureCollectionFile, []byte(featureCollectionJson), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	gf, err := LoadGeofenceFromGeoJSON(featureCollectionFile)
	if err != nil {
		t.Fatalf("LoadGeofenceFromGeoJSON (FeatureCollection) failed: %v", err)
	}
	if gf.Name != "Test Area" {
		t.Errorf("Expected name 'Test Area', got %q", gf.Name)
	}
	if gf.Type != GeofencePolygon {
		t.Error("Expected polygon type")
	}

	// Test single Feature
	featureFile := tmpDir + "/feature.geojson"
	featureJson := `{
		"type": "Feature",
		"geometry": {
			"type": "Polygon",
			"coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
		}
	}`
	if err := os.WriteFile(featureFile, []byte(featureJson), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	gf, err = LoadGeofenceFromGeoJSON(featureFile)
	if err != nil {
		t.Fatalf("LoadGeofenceFromGeoJSON (Feature) failed: %v", err)
	}
	if gf.Type != GeofencePolygon {
		t.Error("Expected polygon type")
	}

	// Test Point geometry
	pointFile := tmpDir + "/point.geojson"
	pointJson := `{
		"type": "Point",
		"coordinates": [-93.0, 45.0]
	}`
	if err := os.WriteFile(pointFile, []byte(pointJson), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	gf, err = LoadGeofenceFromGeoJSON(pointFile)
	if err != nil {
		t.Fatalf("LoadGeofenceFromGeoJSON (Point) failed: %v", err)
	}
	if gf.Type != GeofenceCircle {
		t.Error("Expected circle type for Point geometry")
	}
	if gf.Center == nil {
		t.Error("Point geofence should have center")
	}
	if gf.RadiusNM != 5 {
		t.Errorf("Expected default radius of 5nm, got %f", gf.RadiusNM)
	}

	// Test with name property at root level
	namedFile := tmpDir + "/named.geojson"
	namedJson := `{
		"name": "My Geofence",
		"type": "Point",
		"coordinates": [-93.0, 45.0]
	}`
	if err := os.WriteFile(namedFile, []byte(namedJson), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	gf, err = LoadGeofenceFromGeoJSON(namedFile)
	if err != nil {
		t.Fatalf("LoadGeofenceFromGeoJSON (named) failed: %v", err)
	}
	if gf.Name != "My Geofence" {
		t.Errorf("Expected name 'My Geofence', got %q", gf.Name)
	}

	// Test non-existent file
	_, err = LoadGeofenceFromGeoJSON(tmpDir + "/nonexistent.geojson")
	if err == nil {
		t.Error("LoadGeofenceFromGeoJSON should fail for non-existent file")
	}

	// Test invalid JSON
	invalidFile := tmpDir + "/invalid.geojson"
	if err := os.WriteFile(invalidFile, []byte("not json"), 0644); err != nil {
		t.Fatalf("Failed to write invalid test file: %v", err)
	}
	_, err = LoadGeofenceFromGeoJSON(invalidFile)
	if err == nil {
		t.Error("LoadGeofenceFromGeoJSON should fail for invalid JSON")
	}
}

func TestCreateDefaultGeofences(t *testing.T) {
	geofences := CreateDefaultGeofences()

	if len(geofences) == 0 {
		t.Error("CreateDefaultGeofences should return at least one geofence")
	}

	// Check that the home geofence exists and is disabled by default
	found := false
	for _, gf := range geofences {
		if gf.ID == "home_area" {
			found = true
			if gf.Enabled {
				t.Error("Home area should be disabled by default")
			}
			break
		}
	}
	if !found {
		t.Error("Default geofences should include home_area")
	}
}

func TestToggleGeofenceNotFound(t *testing.T) {
	mgr := NewGeofenceManager()

	gf := NewCircleGeofence("test", "Test", 0, 0, 10)
	mgr.AddGeofence(gf)

	// Toggle non-existent geofence should return false
	result := mgr.ToggleGeofence("nonexistent")
	if result != false {
		t.Error("ToggleGeofence for non-existent geofence should return false")
	}
}

func TestRemoveGeofenceNotFound(t *testing.T) {
	mgr := NewGeofenceManager()

	gf := NewCircleGeofence("test", "Test", 0, 0, 10)
	mgr.AddGeofence(gf)

	// Remove non-existent geofence should return false
	result := mgr.RemoveGeofence("nonexistent")
	if result != false {
		t.Error("RemoveGeofence for non-existent geofence should return false")
	}
}

func TestContainsUnknownType(t *testing.T) {
	gf := &Geofence{
		ID:      "test",
		Name:    "Test",
		Type:    GeofenceType("unknown"),
		Enabled: true,
	}

	// Unknown type should return false
	if gf.Contains(0, 0) {
		t.Error("Unknown geofence type should return false")
	}
}

func TestContainsCircleNilCenter(t *testing.T) {
	gf := &Geofence{
		ID:       "test",
		Name:     "Test",
		Type:     GeofenceCircle,
		Center:   nil,
		RadiusNM: 10,
		Enabled:  true,
	}

	// Circle with nil center should return false
	if gf.Contains(0, 0) {
		t.Error("Circle geofence with nil center should return false")
	}
}

func TestContainsPolygonTooFewPoints(t *testing.T) {
	// Polygon with less than 3 points
	gf := NewPolygonGeofence("test", "Test", []GeofencePoint{
		{Lat: 0, Lon: 0},
		{Lat: 1, Lon: 1},
	})

	// Should return false for polygon with < 3 points
	if gf.Contains(0.5, 0.5) {
		t.Error("Polygon with < 3 points should return false")
	}
}

func TestGetBoundingBoxUnknownType(t *testing.T) {
	gf := &Geofence{
		ID:      "test",
		Name:    "Test",
		Type:    GeofenceType("unknown"),
		Enabled: true,
	}

	minLat, minLon, maxLat, maxLon := gf.GetBoundingBox()
	if minLat != 0 || minLon != 0 || maxLat != 0 || maxLon != 0 {
		t.Error("Unknown geofence type should return zero bounding box")
	}
}

func TestGetBoundingBoxCircleNilCenter(t *testing.T) {
	gf := &Geofence{
		ID:       "test",
		Name:     "Test",
		Type:     GeofenceCircle,
		Center:   nil,
		RadiusNM: 10,
		Enabled:  true,
	}

	minLat, minLon, maxLat, maxLon := gf.GetBoundingBox()
	if minLat != 0 || minLon != 0 || maxLat != 0 || maxLon != 0 {
		t.Error("Circle geofence with nil center should return zero bounding box")
	}
}

func TestGetBoundingBoxPolygonNoPoints(t *testing.T) {
	gf := &Geofence{
		ID:      "test",
		Name:    "Test",
		Type:    GeofencePolygon,
		Points:  []GeofencePoint{},
		Enabled: true,
	}

	minLat, minLon, maxLat, maxLon := gf.GetBoundingBox()
	if minLat != 0 || minLon != 0 || maxLat != 0 || maxLon != 0 {
		t.Error("Polygon geofence with no points should return zero bounding box")
	}
}

func TestAddGeofenceExisting(t *testing.T) {
	mgr := NewGeofenceManager()

	gf1 := NewCircleGeofence("test", "Test 1", 0, 0, 10)
	gf2 := NewCircleGeofence("test", "Test 2", 1, 1, 5)

	mgr.AddGeofence(gf1)
	mgr.AddGeofence(gf2) // Same ID, should replace

	if mgr.Count() != 1 {
		t.Errorf("Count should be 1 after adding same ID, got %d", mgr.Count())
	}

	// Should have the updated geofence
	gf := mgr.GetGeofence("test")
	if gf.Name != "Test 2" {
		t.Error("Geofence should be replaced with newer one")
	}
}

func TestLoadGeofencesFromFileWithTilde(t *testing.T) {
	// This test just ensures the tilde expansion code path is executed
	// We can't really test the actual home directory without knowing it

	// Test that env var expansion works
	tmpDir := t.TempDir()
	os.Setenv("TEST_GEOFENCE_DIR", tmpDir)
	defer os.Unsetenv("TEST_GEOFENCE_DIR")

	testFile := tmpDir + "/test.json"
	if err := os.WriteFile(testFile, []byte(`[]`), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	// Test with env var in path
	_, err := LoadGeofencesFromFile("$TEST_GEOFENCE_DIR/test.json")
	if err != nil {
		t.Errorf("LoadGeofencesFromFile with env var failed: %v", err)
	}
}

func TestSaveGeofencesToFileWithTilde(t *testing.T) {
	// Test that env var expansion works
	tmpDir := t.TempDir()
	os.Setenv("TEST_GEOFENCE_DIR", tmpDir)
	defer os.Unsetenv("TEST_GEOFENCE_DIR")

	err := SaveGeofencesToFile("$TEST_GEOFENCE_DIR/save_test.json", []*Geofence{})
	if err != nil {
		t.Errorf("SaveGeofencesToFile with env var failed: %v", err)
	}
}

func TestLoadGeofenceFromGeoJSONWithTilde(t *testing.T) {
	// Test that env var expansion works
	tmpDir := t.TempDir()
	os.Setenv("TEST_GEOFENCE_DIR", tmpDir)
	defer os.Unsetenv("TEST_GEOFENCE_DIR")

	testFile := tmpDir + "/test.geojson"
	if err := os.WriteFile(testFile, []byte(`{"type": "Point", "coordinates": [0, 0]}`), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	_, err := LoadGeofenceFromGeoJSON("$TEST_GEOFENCE_DIR/test.geojson")
	if err != nil {
		t.Errorf("LoadGeofenceFromGeoJSON with env var failed: %v", err)
	}
}

func TestLoadGeofencesFromFileWithTildeExpansion(t *testing.T) {
	// Get user's home directory
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("Could not get home directory")
	}

	// Create a test file in a temp location that simulates home
	tmpDir := t.TempDir()

	// Write a test file
	testFile := tmpDir + "/geofences_test_tilde.json"
	if err := os.WriteFile(testFile, []byte(`[]`), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	// Test tilde expansion by using the real home directory
	homeTestFile := home + "/.skyspy_test_geofences.json"
	if err := os.WriteFile(homeTestFile, []byte(`[]`), 0644); err != nil {
		t.Fatalf("Failed to write home test file: %v", err)
	}
	defer os.Remove(homeTestFile)

	// Test with tilde path
	_, err = LoadGeofencesFromFile("~/.skyspy_test_geofences.json")
	if err != nil {
		t.Errorf("LoadGeofencesFromFile with tilde failed: %v", err)
	}
}

func TestSaveGeofencesToFileWithTildeExpansion(t *testing.T) {
	// Get user's home directory
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("Could not get home directory")
	}

	// Test with tilde path
	homeTestFile := home + "/.skyspy_test_save_geofences.json"
	defer os.Remove(homeTestFile)

	err = SaveGeofencesToFile("~/.skyspy_test_save_geofences.json", []*Geofence{})
	if err != nil {
		t.Errorf("SaveGeofencesToFile with tilde failed: %v", err)
	}
}

func TestLoadGeofenceFromGeoJSONWithTildeExpansion(t *testing.T) {
	// Get user's home directory
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("Could not get home directory")
	}

	// Test with tilde path
	homeTestFile := home + "/.skyspy_test_geojson.json"
	if err := os.WriteFile(homeTestFile, []byte(`{"type": "Point", "coordinates": [0, 0]}`), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}
	defer os.Remove(homeTestFile)

	_, err = LoadGeofenceFromGeoJSON("~/.skyspy_test_geojson.json")
	if err != nil {
		t.Errorf("LoadGeofenceFromGeoJSON with tilde failed: %v", err)
	}
}

func TestLoadGeofenceFromGeoJSONFeatureWithName(t *testing.T) {
	tmpDir := t.TempDir()

	// Test Feature with properties but no geometry name extraction
	featureFile := tmpDir + "/feature_named.geojson"
	featureJson := `{
		"type": "FeatureCollection",
		"features": [{
			"type": "Feature",
			"properties": {},
			"geometry": {
				"type": "Polygon",
				"coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
			}
		}]
	}`
	if err := os.WriteFile(featureFile, []byte(featureJson), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	gf, err := LoadGeofenceFromGeoJSON(featureFile)
	if err != nil {
		t.Fatalf("LoadGeofenceFromGeoJSON failed: %v", err)
	}
	// Name should default to filename
	if gf.Name == "" {
		t.Error("Geofence name should not be empty")
	}
}

func TestGetBoundingBoxPolygonWithSinglePoint(t *testing.T) {
	// Create polygon with single point (edge case for min/max calculation)
	gf := NewPolygonGeofence("test", "Test", []GeofencePoint{
		{Lat: 45.0, Lon: -93.0},
	})

	minLat, minLon, maxLat, maxLon := gf.GetBoundingBox()

	// Single point should have same min/max
	if minLat != 45.0 || maxLat != 45.0 {
		t.Error("Single point polygon should have same min/max lat")
	}
	if minLon != -93.0 || maxLon != -93.0 {
		t.Error("Single point polygon should have same min/max lon")
	}
}

func TestGetBoundingBoxPolygonAllBranches(t *testing.T) {
	// Create polygon that exercises all min/max branches
	// First point at (2, 2), then points below, above, left, right
	gf := NewPolygonGeofence("test", "Test", []GeofencePoint{
		{Lat: 2.0, Lon: 2.0},   // Starting point
		{Lat: 1.0, Lon: 2.0},   // p.Lat < minLat
		{Lat: 3.0, Lon: 2.0},   // p.Lat > maxLat
		{Lat: 2.0, Lon: 1.0},   // p.Lon < minLon
		{Lat: 2.0, Lon: 3.0},   // p.Lon > maxLon
	})

	minLat, minLon, maxLat, maxLon := gf.GetBoundingBox()

	if minLat != 1.0 {
		t.Errorf("Expected minLat=1.0, got %f", minLat)
	}
	if maxLat != 3.0 {
		t.Errorf("Expected maxLat=3.0, got %f", maxLat)
	}
	if minLon != 1.0 {
		t.Errorf("Expected minLon=1.0, got %f", minLon)
	}
	if maxLon != 3.0 {
		t.Errorf("Expected maxLon=3.0, got %f", maxLon)
	}
}

func TestSaveGeofencesToFileMarshalError(t *testing.T) {
	tmpDir := t.TempDir()
	tmpFile := tmpDir + "/marshal_error.json"

	// Create a geofence with NaN values which cannot be marshaled to JSON
	gf := &Geofence{
		ID:       "test",
		Name:     "Test",
		Type:     GeofenceCircle,
		RadiusNM: math.NaN(), // NaN cannot be marshaled
		Enabled:  true,
	}

	err := SaveGeofencesToFile(tmpFile, []*Geofence{gf})
	if err == nil {
		t.Error("SaveGeofencesToFile should fail for NaN values")
	}
}
