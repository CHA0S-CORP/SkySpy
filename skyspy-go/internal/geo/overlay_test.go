package geo

import (
	"archive/zip"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestNewOverlayManager(t *testing.T) {
	m := NewOverlayManager()
	if m == nil {
		t.Fatal("NewOverlayManager returned nil")
	}
	if m.overlays == nil {
		t.Error("overlays map should be initialized")
	}
	if m.overlayOrder == nil {
		t.Error("overlayOrder slice should be initialized")
	}
	if m.Count() != 0 {
		t.Errorf("New manager should have 0 overlays, got %d", m.Count())
	}
}

func TestOverlayManagerAddOverlay(t *testing.T) {
	m := NewOverlayManager()

	// Test adding overlay with empty key (should use name)
	overlay1 := &GeoOverlay{Name: "Test Overlay"}
	key1 := m.AddOverlay(overlay1, "")
	if key1 != "test_overlay" {
		t.Errorf("Expected key 'test_overlay', got '%s'", key1)
	}
	if m.Count() != 1 {
		t.Errorf("Expected 1 overlay, got %d", m.Count())
	}

	// Test adding overlay with explicit key
	overlay2 := &GeoOverlay{Name: "Another Overlay"}
	key2 := m.AddOverlay(overlay2, "custom_key")
	if key2 != "custom_key" {
		t.Errorf("Expected key 'custom_key', got '%s'", key2)
	}
	if m.Count() != 2 {
		t.Errorf("Expected 2 overlays, got %d", m.Count())
	}

	// Test adding overlay with duplicate key (should add suffix)
	overlay3 := &GeoOverlay{Name: "Another Overlay"}
	key3 := m.AddOverlay(overlay3, "custom_key")
	if key3 != "custom_key_1" {
		t.Errorf("Expected key 'custom_key_1', got '%s'", key3)
	}

	// Test adding another duplicate
	overlay4 := &GeoOverlay{Name: "Another Overlay"}
	key4 := m.AddOverlay(overlay4, "custom_key")
	if key4 != "custom_key_2" {
		t.Errorf("Expected key 'custom_key_2', got '%s'", key4)
	}
}

func TestOverlayManagerRemoveOverlay(t *testing.T) {
	m := NewOverlayManager()

	overlay := &GeoOverlay{Name: "Test"}
	key := m.AddOverlay(overlay, "test_key")

	// Test removing existing overlay
	removed := m.RemoveOverlay(key)
	if !removed {
		t.Error("Expected RemoveOverlay to return true")
	}
	if m.Count() != 0 {
		t.Errorf("Expected 0 overlays after removal, got %d", m.Count())
	}

	// Test removing non-existent overlay
	removed = m.RemoveOverlay("nonexistent")
	if removed {
		t.Error("Expected RemoveOverlay to return false for non-existent key")
	}
}

func TestOverlayManagerToggleOverlay(t *testing.T) {
	m := NewOverlayManager()

	overlay := &GeoOverlay{Name: "Test", Enabled: false}
	key := m.AddOverlay(overlay, "test_key")

	// Toggle on
	enabled := m.ToggleOverlay(key)
	if !enabled {
		t.Error("Expected overlay to be enabled after toggle")
	}

	// Toggle off
	enabled = m.ToggleOverlay(key)
	if enabled {
		t.Error("Expected overlay to be disabled after second toggle")
	}

	// Toggle non-existent
	result := m.ToggleOverlay("nonexistent")
	if result {
		t.Error("Expected false for non-existent key")
	}
}

func TestOverlayManagerSetOverlayColor(t *testing.T) {
	m := NewOverlayManager()

	overlay := &GeoOverlay{Name: "Test", Color: ""}
	key := m.AddOverlay(overlay, "test_key")

	m.SetOverlayColor(key, "red")
	if overlay.Color != "red" {
		t.Errorf("Expected color 'red', got '%s'", overlay.Color)
	}

	// Setting color on non-existent key should not panic
	m.SetOverlayColor("nonexistent", "blue")
}

func TestOverlayManagerGetEnabledOverlays(t *testing.T) {
	m := NewOverlayManager()

	overlay1 := &GeoOverlay{Name: "Enabled", Enabled: true}
	overlay2 := &GeoOverlay{Name: "Disabled", Enabled: false}
	overlay3 := &GeoOverlay{Name: "Also Enabled", Enabled: true}

	m.AddOverlay(overlay1, "enabled1")
	m.AddOverlay(overlay2, "disabled")
	m.AddOverlay(overlay3, "enabled2")

	enabled := m.GetEnabledOverlays()
	if len(enabled) != 2 {
		t.Errorf("Expected 2 enabled overlays, got %d", len(enabled))
	}

	// Verify order
	if enabled[0].Name != "Enabled" {
		t.Errorf("Expected first enabled overlay to be 'Enabled', got '%s'", enabled[0].Name)
	}
	if enabled[1].Name != "Also Enabled" {
		t.Errorf("Expected second enabled overlay to be 'Also Enabled', got '%s'", enabled[1].Name)
	}
}

func TestOverlayManagerGetOverlayList(t *testing.T) {
	m := NewOverlayManager()

	overlay1 := &GeoOverlay{Name: "First", Enabled: true}
	overlay2 := &GeoOverlay{Name: "Second", Enabled: false}

	m.AddOverlay(overlay1, "first")
	m.AddOverlay(overlay2, "second")

	list := m.GetOverlayList()
	if len(list) != 2 {
		t.Errorf("Expected 2 items in list, got %d", len(list))
	}

	// Check first item
	if list[0].Key != "first" || list[0].Name != "First" || !list[0].Enabled {
		t.Errorf("Unexpected first item: %+v", list[0])
	}

	// Check second item
	if list[1].Key != "second" || list[1].Name != "Second" || list[1].Enabled {
		t.Errorf("Unexpected second item: %+v", list[1])
	}
}

func TestOverlayManagerToConfig(t *testing.T) {
	m := NewOverlayManager()

	overlay1 := &GeoOverlay{Name: "First", Enabled: true, SourceFile: "/path/to/first.geojson", Color: "red"}
	overlay2 := &GeoOverlay{Name: "Second", Enabled: false, SourceFile: "/path/to/second.geojson", Color: ""}

	m.AddOverlay(overlay1, "first")
	m.AddOverlay(overlay2, "second")

	config := m.ToConfig()
	if len(config) != 2 {
		t.Errorf("Expected 2 config items, got %d", len(config))
	}

	// Check first item has color
	if config[0]["color"] != "red" {
		t.Errorf("Expected color 'red' in first config, got %v", config[0]["color"])
	}

	// Check second item has no color key (since it's empty)
	if _, hasColor := config[1]["color"]; hasColor {
		t.Error("Second config should not have color key when color is empty")
	}
}

func TestLoadOverlayNotFound(t *testing.T) {
	_, err := LoadOverlay("/nonexistent/path/file.geojson")
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

func TestLoadOverlayGeoJSON(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Test FeatureCollection GeoJSON
	geojsonContent := `{
		"type": "FeatureCollection",
		"name": "Test GeoJSON",
		"features": [
			{
				"type": "Feature",
				"geometry": {
					"type": "Point",
					"coordinates": [-122.4, 37.7]
				},
				"properties": {
					"name": "Test Point"
				}
			}
		]
	}`

	geojsonPath := filepath.Join(tmpDir, "test.geojson")
	if err := os.WriteFile(geojsonPath, []byte(geojsonContent), 0644); err != nil {
		t.Fatalf("Failed to write GeoJSON file: %v", err)
	}

	overlay, err := LoadOverlay(geojsonPath)
	if err != nil {
		t.Fatalf("Failed to load GeoJSON: %v", err)
	}

	if overlay.Name != "Test GeoJSON" {
		t.Errorf("Expected name 'Test GeoJSON', got '%s'", overlay.Name)
	}

	if len(overlay.Features) != 1 {
		t.Errorf("Expected 1 feature, got %d", len(overlay.Features))
	}
}

func TestLoadOverlayJSONExtension(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Test with .json extension
	geojsonContent := `{
		"type": "FeatureCollection",
		"features": [
			{
				"type": "Feature",
				"geometry": {
					"type": "Point",
					"coordinates": [-122.4, 37.7]
				},
				"properties": {}
			}
		]
	}`

	jsonPath := filepath.Join(tmpDir, "test.json")
	if err := os.WriteFile(jsonPath, []byte(geojsonContent), 0644); err != nil {
		t.Fatalf("Failed to write JSON file: %v", err)
	}

	overlay, err := LoadOverlay(jsonPath)
	if err != nil {
		t.Fatalf("Failed to load JSON: %v", err)
	}

	if len(overlay.Features) != 1 {
		t.Errorf("Expected 1 feature, got %d", len(overlay.Features))
	}
}

func TestLoadOverlayUnknownExtension(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Test with unknown extension - should try to auto-detect
	geojsonContent := `{
		"type": "FeatureCollection",
		"features": [
			{
				"type": "Feature",
				"geometry": {
					"type": "Point",
					"coordinates": [-122.4, 37.7]
				},
				"properties": {}
			}
		]
	}`

	unknownPath := filepath.Join(tmpDir, "test.unknown")
	if err := os.WriteFile(unknownPath, []byte(geojsonContent), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	overlay, err := LoadOverlay(unknownPath)
	if err != nil {
		t.Fatalf("Failed to load file with unknown extension: %v", err)
	}

	if len(overlay.Features) != 1 {
		t.Errorf("Expected 1 feature, got %d", len(overlay.Features))
	}
}

func TestLoadOverlayUnknownExtensionFails(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Test with unknown extension and invalid content
	unknownPath := filepath.Join(tmpDir, "test.xyz")
	if err := os.WriteFile(unknownPath, []byte("invalid content"), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	_, err = LoadOverlay(unknownPath)
	if err == nil {
		t.Error("Expected error for undetectable format")
	}
}

func TestLoadOverlayTildePath(t *testing.T) {
	// Test that tilde expansion doesn't crash (we won't actually test in home dir)
	_, err := LoadOverlay("~/nonexistent_test_file.geojson")
	if err == nil {
		t.Error("Expected error for nonexistent file in home")
	}
}

func TestLoadGeoJSONSingleGeometry(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Test single geometry (not FeatureCollection)
	tests := []struct {
		name     string
		content  string
		expected OverlayType
	}{
		{
			name:     "Single Polygon",
			content:  `{"type": "Polygon", "coordinates": [[[-122.5, 37.5], [-122.5, 37.7], [-122.3, 37.7], [-122.3, 37.5], [-122.5, 37.5]]]}`,
			expected: OverlayPolygon,
		},
		{
			name:     "Single LineString",
			content:  `{"type": "LineString", "coordinates": [[-122.5, 37.5], [-122.4, 37.6], [-122.3, 37.7]]}`,
			expected: OverlayLine,
		},
		{
			name:     "Single Point",
			content:  `{"type": "Point", "coordinates": [-122.4, 37.7]}`,
			expected: OverlayPoint,
		},
		{
			name:     "MultiPolygon",
			content:  `{"type": "MultiPolygon", "coordinates": [[[[-122.5, 37.5], [-122.5, 37.7], [-122.3, 37.7], [-122.3, 37.5], [-122.5, 37.5]]]]}`,
			expected: OverlayPolygon,
		},
		{
			name:     "MultiLineString",
			content:  `{"type": "MultiLineString", "coordinates": [[[-122.5, 37.5], [-122.4, 37.6]]]}`,
			expected: OverlayLine,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(tmpDir, tc.name+".geojson")
			if err := os.WriteFile(path, []byte(tc.content), 0644); err != nil {
				t.Fatalf("Failed to write file: %v", err)
			}

			overlay, err := LoadOverlay(path)
			if err != nil {
				t.Fatalf("Failed to load: %v", err)
			}

			if len(overlay.Features) == 0 {
				t.Fatal("Expected at least 1 feature")
			}

			if overlay.Features[0].Type != tc.expected {
				t.Errorf("Expected type %d, got %d", tc.expected, overlay.Features[0].Type)
			}
		})
	}
}

func TestParseGeoJSONFeatureNoGeometry(t *testing.T) {
	feature := map[string]interface{}{
		"type":       "Feature",
		"properties": map[string]interface{}{},
	}

	result := parseGeoJSONFeature(feature)
	if len(result) != 0 {
		t.Errorf("Expected 0 features for feature without geometry, got %d", len(result))
	}
}

func TestParseGeoJSONFeatureNilProperties(t *testing.T) {
	feature := map[string]interface{}{
		"type": "Feature",
		"geometry": map[string]interface{}{
			"type":        "Point",
			"coordinates": []interface{}{-122.4, 37.7},
		},
	}

	result := parseGeoJSONFeature(feature)
	if len(result) != 1 {
		t.Errorf("Expected 1 feature, got %d", len(result))
	}
	if result[0].Properties == nil {
		t.Error("Properties should be initialized even if not present")
	}
}

func TestParseGeoJSONFeaturePointTooFewCoords(t *testing.T) {
	feature := map[string]interface{}{
		"type": "Feature",
		"geometry": map[string]interface{}{
			"type":        "Point",
			"coordinates": []interface{}{-122.4}, // Only one coordinate
		},
		"properties": map[string]interface{}{},
	}

	result := parseGeoJSONFeature(feature)
	if len(result) != 0 {
		t.Errorf("Expected 0 features for point with too few coordinates, got %d", len(result))
	}
}

func TestParseGeoJSONFeatureLineStringEmpty(t *testing.T) {
	feature := map[string]interface{}{
		"type": "Feature",
		"geometry": map[string]interface{}{
			"type":        "LineString",
			"coordinates": []interface{}{},
		},
		"properties": map[string]interface{}{},
	}

	result := parseGeoJSONFeature(feature)
	if len(result) != 0 {
		t.Errorf("Expected 0 features for empty LineString, got %d", len(result))
	}
}

func TestParseGeoJSONFeaturePolygonEmpty(t *testing.T) {
	feature := map[string]interface{}{
		"type": "Feature",
		"geometry": map[string]interface{}{
			"type":        "Polygon",
			"coordinates": []interface{}{},
		},
		"properties": map[string]interface{}{},
	}

	result := parseGeoJSONFeature(feature)
	if len(result) != 0 {
		t.Errorf("Expected 0 features for empty Polygon, got %d", len(result))
	}
}

func TestParseGeoJSONFeaturePolygonEmptyOuterRing(t *testing.T) {
	feature := map[string]interface{}{
		"type": "Feature",
		"geometry": map[string]interface{}{
			"type":        "Polygon",
			"coordinates": []interface{}{[]interface{}{}},
		},
		"properties": map[string]interface{}{},
	}

	result := parseGeoJSONFeature(feature)
	if len(result) != 0 {
		t.Errorf("Expected 0 features for Polygon with empty outer ring, got %d", len(result))
	}
}

func TestParseGeoJSONFeatureMultiPolygonEmpty(t *testing.T) {
	feature := map[string]interface{}{
		"type": "Feature",
		"geometry": map[string]interface{}{
			"type":        "MultiPolygon",
			"coordinates": []interface{}{},
		},
		"properties": map[string]interface{}{},
	}

	result := parseGeoJSONFeature(feature)
	if len(result) != 0 {
		t.Errorf("Expected 0 features for empty MultiPolygon, got %d", len(result))
	}
}

func TestParseGeoJSONFeatureMultiLineStringEmpty(t *testing.T) {
	feature := map[string]interface{}{
		"type": "Feature",
		"geometry": map[string]interface{}{
			"type":        "MultiLineString",
			"coordinates": []interface{}{},
		},
		"properties": map[string]interface{}{},
	}

	result := parseGeoJSONFeature(feature)
	if len(result) != 0 {
		t.Errorf("Expected 0 features for empty MultiLineString, got %d", len(result))
	}
}

func TestParseGeoJSONFeatureNameKeys(t *testing.T) {
	tests := []struct {
		propKey string
		name    string
	}{
		{"name", "Test Name"},
		{"NAME", "Test NAME"},
		{"Name", "Test Name Mixed"},
		{"id", "Test ID"},
	}

	for _, tc := range tests {
		t.Run(tc.propKey, func(t *testing.T) {
			feature := map[string]interface{}{
				"type": "Feature",
				"geometry": map[string]interface{}{
					"type":        "Point",
					"coordinates": []interface{}{-122.4, 37.7},
				},
				"properties": map[string]interface{}{
					tc.propKey: tc.name,
				},
			}

			result := parseGeoJSONFeature(feature)
			if len(result) != 1 {
				t.Fatalf("Expected 1 feature, got %d", len(result))
			}
			if result[0].Name != tc.name {
				t.Errorf("Expected name '%s', got '%s'", tc.name, result[0].Name)
			}
		})
	}
}

func TestParseCoordinatesInvalidCoord(t *testing.T) {
	coords := []interface{}{
		"not a coordinate",
		[]interface{}{-122.4}, // Too few
		[]interface{}{-122.4, 37.7}, // Valid
	}

	points := parseCoordinates(coords)
	if len(points) != 1 {
		t.Errorf("Expected 1 valid point, got %d", len(points))
	}
}

func TestHaversineDistance(t *testing.T) {
	// Test known distance: San Francisco to Los Angeles is approximately 340 nm
	sfLat, sfLon := 37.7749, -122.4194
	laLat, laLon := 34.0522, -118.2437

	dist := HaversineDistance(sfLat, sfLon, laLat, laLon)

	// Distance should be approximately 300-350 nm
	if dist < 280 || dist > 360 {
		t.Errorf("Distance SF to LA should be ~300-350nm, got %f", dist)
	}

	// Test zero distance
	zeroDist := HaversineDistance(sfLat, sfLon, sfLat, sfLon)
	if zeroDist != 0 {
		t.Errorf("Distance to same point should be 0, got %f", zeroDist)
	}
}

func TestBearingBetween(t *testing.T) {
	// Due north
	bearing := BearingBetween(37.0, -122.0, 38.0, -122.0)
	if bearing < 355 && bearing > 5 {
		t.Errorf("Bearing due north should be ~0, got %f", bearing)
	}

	// Due east
	bearing = BearingBetween(37.0, -122.0, 37.0, -121.0)
	if bearing < 85 || bearing > 95 {
		t.Errorf("Bearing due east should be ~90, got %f", bearing)
	}

	// Due south
	bearing = BearingBetween(38.0, -122.0, 37.0, -122.0)
	if bearing < 175 || bearing > 185 {
		t.Errorf("Bearing due south should be ~180, got %f", bearing)
	}

	// Due west
	bearing = BearingBetween(37.0, -121.0, 37.0, -122.0)
	if bearing < 265 || bearing > 275 {
		t.Errorf("Bearing due west should be ~270, got %f", bearing)
	}
}

func TestDestinationPoint(t *testing.T) {
	// Start point
	lat, lon := 37.0, -122.0

	// Go north 60 nm (approximately 1 degree at this latitude)
	destLat, destLon := DestinationPoint(lat, lon, 0, 60)

	// Latitude should increase by approximately 1 degree
	if math.Abs(destLat-38.0) > 0.1 {
		t.Errorf("Expected destination lat ~38, got %f", destLat)
	}
	if math.Abs(destLon-(-122.0)) > 0.1 {
		t.Errorf("Expected destination lon ~-122, got %f", destLon)
	}

	// Go east 60 nm
	destLat, destLon = DestinationPoint(lat, lon, 90, 60)
	if math.Abs(destLat-37.0) > 0.1 {
		t.Errorf("Expected destination lat ~37 when going east, got %f", destLat)
	}
	if destLon <= -122.0 {
		t.Errorf("Expected destination lon > -122 when going east, got %f", destLon)
	}
}

func TestGeoToRadar(t *testing.T) {
	centerX, centerY := 50, 25
	maxRadius := 24
	maxRange := 50.0

	// Point at center (0 distance)
	x, y := GeoToRadar(0, 0, maxRange, centerX, centerY, maxRadius)
	if x != centerX || y != centerY {
		t.Errorf("Point at center should be at center: expected (%d,%d), got (%d,%d)", centerX, centerY, x, y)
	}

	// Point at max range due north (bearing 0)
	x, y = GeoToRadar(maxRange, 0, maxRange, centerX, centerY, maxRadius)
	if y >= centerY {
		t.Errorf("Point due north should have y < centerY, got y=%d", y)
	}

	// Point beyond max range should be clamped
	x, y = GeoToRadar(maxRange*2, 0, maxRange, centerX, centerY, maxRadius)
	x2, y2 := GeoToRadar(maxRange, 0, maxRange, centerX, centerY, maxRadius)
	if x != x2 || y != y2 {
		t.Errorf("Points beyond max range should be clamped to max range")
	}
}

func TestBresenhamLine(t *testing.T) {
	// Horizontal line
	points := BresenhamLine(0, 0, 5, 0)
	if len(points) != 6 {
		t.Errorf("Horizontal line from (0,0) to (5,0) should have 6 points, got %d", len(points))
	}
	if points[0][0] != 0 || points[0][1] != 0 {
		t.Errorf("First point should be (0,0), got (%d,%d)", points[0][0], points[0][1])
	}
	if points[5][0] != 5 || points[5][1] != 0 {
		t.Errorf("Last point should be (5,0), got (%d,%d)", points[5][0], points[5][1])
	}

	// Vertical line
	points = BresenhamLine(0, 0, 0, 5)
	if len(points) != 6 {
		t.Errorf("Vertical line from (0,0) to (0,5) should have 6 points, got %d", len(points))
	}

	// Diagonal line
	points = BresenhamLine(0, 0, 5, 5)
	if len(points) < 6 {
		t.Errorf("Diagonal line should have at least 6 points, got %d", len(points))
	}

	// Reverse direction (x1 > x2)
	points = BresenhamLine(5, 0, 0, 0)
	if len(points) != 6 {
		t.Errorf("Reverse horizontal line should have 6 points, got %d", len(points))
	}

	// Reverse direction (y1 > y2)
	points = BresenhamLine(0, 5, 0, 0)
	if len(points) != 6 {
		t.Errorf("Reverse vertical line should have 6 points, got %d", len(points))
	}

	// Single point
	points = BresenhamLine(5, 5, 5, 5)
	if len(points) != 1 {
		t.Errorf("Single point should have 1 point, got %d", len(points))
	}
}

func TestBresenhamLineMaxPoints(t *testing.T) {
	// Very long line - should be limited to 200 points
	points := BresenhamLine(0, 0, 1000, 0)
	if len(points) > 200 {
		t.Errorf("Line should be limited to 200 points, got %d", len(points))
	}
}

func TestAbs(t *testing.T) {
	if abs(5) != 5 {
		t.Error("abs(5) should be 5")
	}
	if abs(-5) != 5 {
		t.Error("abs(-5) should be 5")
	}
	if abs(0) != 0 {
		t.Error("abs(0) should be 0")
	}
}

func TestMin(t *testing.T) {
	if min(5, 3) != 3 {
		t.Error("min(5, 3) should be 3")
	}
	if min(3, 5) != 3 {
		t.Error("min(3, 5) should be 3")
	}
	if min(5, 5) != 5 {
		t.Error("min(5, 5) should be 5")
	}
}

func TestRenderOverlayToRadar(t *testing.T) {
	overlay := &GeoOverlay{
		Name:    "Test",
		Enabled: true,
		Color:   "green",
		Features: []GeoFeature{
			{
				Type:   OverlayPoint,
				Points: []GeoPoint{{Lat: 37.7749, Lon: -122.4194, Label: "SF"}},
			},
		},
	}

	// Center at same location, so point should be at center
	points := RenderOverlayToRadar(overlay, 37.7749, -122.4194, 50, 100, 50, "blue")

	if len(points) != 1 {
		t.Errorf("Expected 1 render point, got %d", len(points))
	}

	if len(points) > 0 {
		if points[0].Color != "green" {
			t.Errorf("Expected color 'green' from overlay, got '%s'", points[0].Color)
		}
		// Point at center should use first char of label
		if points[0].Char != 'S' {
			t.Errorf("Expected char 'S' from label, got '%c'", points[0].Char)
		}
	}
}

func TestRenderOverlayToRadarNoLabel(t *testing.T) {
	overlay := &GeoOverlay{
		Name:    "Test",
		Enabled: true,
		Features: []GeoFeature{
			{
				Type:   OverlayPoint,
				Points: []GeoPoint{{Lat: 37.7749, Lon: -122.4194}}, // No label
			},
		},
	}

	points := RenderOverlayToRadar(overlay, 37.7749, -122.4194, 50, 100, 50, "blue")

	if len(points) > 0 && points[0].Char != '\u25C7' { // Diamond character
		t.Errorf("Expected diamond char for point without label, got '%c'", points[0].Char)
	}
}

func TestRenderOverlayToRadarDefaultColor(t *testing.T) {
	overlay := &GeoOverlay{
		Name:    "Test",
		Enabled: true,
		Color:   "", // No color set
		Features: []GeoFeature{
			{
				Type:   OverlayPoint,
				Points: []GeoPoint{{Lat: 37.7749, Lon: -122.4194}},
			},
		},
	}

	points := RenderOverlayToRadar(overlay, 37.7749, -122.4194, 50, 100, 50, "cyan")

	if len(points) > 0 && points[0].Color != "cyan" {
		t.Errorf("Expected default color 'cyan', got '%s'", points[0].Color)
	}
}

func TestRenderOverlayToRadarPointOutOfRange(t *testing.T) {
	overlay := &GeoOverlay{
		Name:    "Test",
		Enabled: true,
		Features: []GeoFeature{
			{
				Type:   OverlayPoint,
				Points: []GeoPoint{{Lat: 37.7749, Lon: -122.4194}},
			},
		},
	}

	// Center far away, very small range - point should be out of range
	points := RenderOverlayToRadar(overlay, 0, 0, 1, 100, 50, "blue")

	if len(points) != 0 {
		t.Errorf("Expected 0 render points for out-of-range point, got %d", len(points))
	}
}

func TestRenderOverlayToRadarLine(t *testing.T) {
	overlay := &GeoOverlay{
		Name:    "Test",
		Enabled: true,
		Features: []GeoFeature{
			{
				Type: OverlayLine,
				Points: []GeoPoint{
					{Lat: 37.77, Lon: -122.42},
					{Lat: 37.78, Lon: -122.41},
				},
			},
		},
	}

	points := RenderOverlayToRadar(overlay, 37.77, -122.42, 50, 100, 50, "blue")

	// Should have multiple points along the line
	if len(points) == 0 {
		t.Error("Expected render points for line")
	}
}

func TestRenderOverlayToRadarPolygon(t *testing.T) {
	overlay := &GeoOverlay{
		Name:    "Test",
		Enabled: true,
		Features: []GeoFeature{
			{
				Type: OverlayPolygon,
				Points: []GeoPoint{
					{Lat: 37.76, Lon: -122.43},
					{Lat: 37.78, Lon: -122.43},
					{Lat: 37.78, Lon: -122.41},
					{Lat: 37.76, Lon: -122.41},
					// Not closing polygon to test auto-close
				},
			},
		},
	}

	points := RenderOverlayToRadar(overlay, 37.77, -122.42, 50, 100, 50, "blue")

	if len(points) == 0 {
		t.Error("Expected render points for polygon")
	}
}

func TestRenderOverlayToRadarPolygonAlreadyClosed(t *testing.T) {
	overlay := &GeoOverlay{
		Name:    "Test",
		Enabled: true,
		Features: []GeoFeature{
			{
				Type: OverlayPolygon,
				Points: []GeoPoint{
					{Lat: 37.76, Lon: -122.43},
					{Lat: 37.78, Lon: -122.43},
					{Lat: 37.78, Lon: -122.41},
					{Lat: 37.76, Lon: -122.41},
					{Lat: 37.76, Lon: -122.43}, // Already closed
				},
			},
		},
	}

	points := RenderOverlayToRadar(overlay, 37.77, -122.42, 50, 100, 50, "blue")

	if len(points) == 0 {
		t.Error("Expected render points for already-closed polygon")
	}
}

func TestRenderOverlayToRadarLineOutOfRange(t *testing.T) {
	overlay := &GeoOverlay{
		Name:    "Test",
		Enabled: true,
		Features: []GeoFeature{
			{
				Type: OverlayLine,
				Points: []GeoPoint{
					{Lat: 37.77, Lon: -122.42},
					{Lat: 37.78, Lon: -122.41},
				},
			},
		},
	}

	// Center far away with small range - both points out of range*1.5
	points := RenderOverlayToRadar(overlay, 0, 0, 1, 100, 50, "blue")

	if len(points) != 0 {
		t.Errorf("Expected 0 render points for line far out of range, got %d", len(points))
	}
}

func TestRenderOverlayToRadarPointOutsideScreen(t *testing.T) {
	overlay := &GeoOverlay{
		Name:    "Test",
		Enabled: true,
		Features: []GeoFeature{
			{
				Type:   OverlayPoint,
				Points: []GeoPoint{{Lat: 37.9, Lon: -122.0}}, // ~10nm away
			},
		},
	}

	// Very small screen size - point within range but off screen
	points := RenderOverlayToRadar(overlay, 37.77, -122.42, 50, 4, 4, "blue")

	// Point may or may not be rendered depending on calculations
	// Just ensure no panic
	_ = points
}

func TestCreateRangeRingOverlay(t *testing.T) {
	centerLat, centerLon := 37.7749, -122.4194
	ranges := []float64{5, 10, 20}
	pointsPerRing := 36

	overlay := CreateRangeRingOverlay(centerLat, centerLon, ranges, pointsPerRing)

	if overlay.Name != "Range Rings" {
		t.Errorf("Expected name 'Range Rings', got '%s'", overlay.Name)
	}

	if !overlay.Enabled {
		t.Error("Expected overlay to be enabled")
	}

	if overlay.Color != "cyan" {
		t.Errorf("Expected color 'cyan', got '%s'", overlay.Color)
	}

	if len(overlay.Features) != 3 {
		t.Errorf("Expected 3 features (one per ring), got %d", len(overlay.Features))
	}

	// Each ring should have pointsPerRing + 1 points
	for i, f := range overlay.Features {
		if f.Type != OverlayLine {
			t.Errorf("Ring %d should be a line type", i)
		}
		if len(f.Points) != pointsPerRing+1 {
			t.Errorf("Ring %d should have %d points, got %d", i, pointsPerRing+1, len(f.Points))
		}
	}
}

func TestOverlayManagerLoadFromFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a valid GeoJSON file
	geojsonContent := `{
		"type": "FeatureCollection",
		"name": "Loaded Overlay",
		"features": [
			{
				"type": "Feature",
				"geometry": {
					"type": "Point",
					"coordinates": [-122.4, 37.7]
				},
				"properties": {}
			}
		]
	}`

	geojsonPath := filepath.Join(tmpDir, "test.geojson")
	if err := os.WriteFile(geojsonPath, []byte(geojsonContent), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	m := NewOverlayManager()

	key, err := m.LoadFromFile(geojsonPath)
	if err != nil {
		t.Fatalf("Failed to load from file: %v", err)
	}

	if key != "loaded_overlay" {
		t.Errorf("Expected key 'loaded_overlay', got '%s'", key)
	}

	if m.Count() != 1 {
		t.Errorf("Expected 1 overlay, got %d", m.Count())
	}
}

func TestOverlayManagerLoadFromFileError(t *testing.T) {
	m := NewOverlayManager()

	_, err := m.LoadFromFile("/nonexistent/file.geojson")
	if err == nil {
		t.Error("Expected error for nonexistent file")
	}
}

func TestLoadGeoJSONInvalidJSON(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	invalidPath := filepath.Join(tmpDir, "invalid.geojson")
	if err := os.WriteFile(invalidPath, []byte("not valid json"), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	_, err = loadGeoJSON(invalidPath)
	if err == nil {
		t.Error("Expected error for invalid JSON")
	}
}

func TestLoadGeoJSONNonFeatureInArray(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Features array with non-object element
	content := `{
		"type": "FeatureCollection",
		"features": [
			"not a feature object",
			{
				"type": "Feature",
				"geometry": {"type": "Point", "coordinates": [-122.4, 37.7]},
				"properties": {}
			}
		]
	}`

	path := filepath.Join(tmpDir, "test.geojson")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	overlay, err := loadGeoJSON(path)
	if err != nil {
		t.Fatalf("Failed to load: %v", err)
	}

	// Should only have 1 feature (the valid one)
	if len(overlay.Features) != 1 {
		t.Errorf("Expected 1 feature, got %d", len(overlay.Features))
	}
}

func TestLoadOverlayWithShpExtension(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a valid shapefile
	shpPath := filepath.Join(tmpDir, "test.shp")

	// Build minimal shapefile data
	header := make([]byte, 100)
	// File code (big endian): 9994
	header[0], header[1], header[2], header[3] = 0, 0, 0x27, 0x0a // 9994 in big endian

	// File length in 16-bit words (big endian)
	header[24], header[25], header[26], header[27] = 0, 0, 0, 50

	// Version (little endian): 1000
	header[28], header[29], header[30], header[31] = 0xe8, 0x03, 0, 0

	// Shape type (little endian): 1 (point)
	header[32], header[33], header[34], header[35] = 1, 0, 0, 0

	if err := os.WriteFile(shpPath, header, 0644); err != nil {
		t.Fatalf("Failed to write shapefile: %v", err)
	}

	overlay, err := LoadOverlay(shpPath)
	if err != nil {
		t.Fatalf("Failed to load shapefile via LoadOverlay: %v", err)
	}

	if overlay == nil {
		t.Error("Expected overlay to be returned")
	}
}

func TestLoadOverlayWithKmlExtension(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Test KML</name>
    <Placemark>
      <name>Test Point</name>
      <Point>
        <coordinates>-122.4,37.7,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`

	kmlPath := filepath.Join(tmpDir, "test.kml")
	if err := os.WriteFile(kmlPath, []byte(kmlContent), 0644); err != nil {
		t.Fatalf("Failed to write KML file: %v", err)
	}

	overlay, err := LoadOverlay(kmlPath)
	if err != nil {
		t.Fatalf("Failed to load KML via LoadOverlay: %v", err)
	}

	if overlay.Name != "Test KML" {
		t.Errorf("Expected name 'Test KML', got '%s'", overlay.Name)
	}
}

func TestLoadOverlayWithKmzExtension(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Test KMZ</name>
    <Placemark>
      <name>Test Point</name>
      <Point>
        <coordinates>-122.4,37.7,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`

	kmzPath := filepath.Join(tmpDir, "test.kmz")

	// Create KMZ (zip) file
	zipFile, err := os.Create(kmzPath)
	if err != nil {
		t.Fatalf("Failed to create KMZ file: %v", err)
	}

	// Write a zip file with doc.kml inside
	// Simplified: just write a minimal zip structure
	// For a proper test, we'd use archive/zip, but for now reuse existing test helper
	zipFile.Close()

	// Use the zip package properly
	if err := os.Remove(kmzPath); err != nil {
		t.Fatalf("Failed to remove temp file: %v", err)
	}

	// Create using archive/zip
	zipFileHandle, err := os.Create(kmzPath)
	if err != nil {
		t.Fatalf("Failed to create KMZ: %v", err)
	}

	w := zip.NewWriter(zipFileHandle)
	f, err := w.Create("doc.kml")
	if err != nil {
		zipFileHandle.Close()
		t.Fatalf("Failed to create doc.kml in zip: %v", err)
	}
	f.Write([]byte(kmlContent))
	w.Close()
	zipFileHandle.Close()

	overlay, err := LoadOverlay(kmzPath)
	if err != nil {
		t.Fatalf("Failed to load KMZ via LoadOverlay: %v", err)
	}

	if overlay.Name != "Test KMZ" {
		t.Errorf("Expected name 'Test KMZ', got '%s'", overlay.Name)
	}
}

func TestLoadOverlayAutoDetectKML(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	kmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Auto-detect KML</name>
    <Placemark>
      <name>Test Point</name>
      <Point>
        <coordinates>-122.4,37.7,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`

	// Use unknown extension
	kmlPath := filepath.Join(tmpDir, "test.data")
	if err := os.WriteFile(kmlPath, []byte(kmlContent), 0644); err != nil {
		t.Fatalf("Failed to write file: %v", err)
	}

	overlay, err := LoadOverlay(kmlPath)
	if err != nil {
		t.Fatalf("Failed to auto-detect KML: %v", err)
	}

	if overlay.Name != "Auto-detect KML" {
		t.Errorf("Expected name 'Auto-detect KML', got '%s'", overlay.Name)
	}
}

func TestLoadOverlayAutoDetectShapefile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a valid shapefile with unknown extension
	shpPath := filepath.Join(tmpDir, "test.bin")

	// Build minimal shapefile data with a point
	header := make([]byte, 100)
	// File code (big endian): 9994
	header[0], header[1], header[2], header[3] = 0, 0, 0x27, 0x0a

	// File length in 16-bit words (big endian) - will update later
	header[24], header[25], header[26], header[27] = 0, 0, 0, 50

	// Version (little endian): 1000
	header[28], header[29], header[30], header[31] = 0xe8, 0x03, 0, 0

	// Shape type (little endian): 1 (point)
	header[32], header[33], header[34], header[35] = 1, 0, 0, 0

	if err := os.WriteFile(shpPath, header, 0644); err != nil {
		t.Fatalf("Failed to write shapefile: %v", err)
	}

	overlay, err := LoadOverlay(shpPath)
	if err != nil {
		t.Fatalf("Failed to auto-detect shapefile: %v", err)
	}

	if overlay == nil {
		t.Error("Expected overlay to be returned")
	}
}

func TestLoadGeoJSONReadError(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "geo_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Try to read a directory as a file - this should fail on ReadFile
	dirPath := filepath.Join(tmpDir, "subdir")
	if err := os.Mkdir(dirPath, 0755); err != nil {
		t.Fatalf("Failed to create directory: %v", err)
	}

	// loadGeoJSON calls os.ReadFile which fails for directories
	_, err = loadGeoJSON(dirPath)
	if err == nil {
		t.Error("Expected error when reading directory as file")
	}
}
