package radar

import (
	"math"
	"strings"
	"testing"

	"github.com/skyspy/skyspy-go/internal/theme"
)

func TestScope_New(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, true)

	if scope == nil {
		t.Fatal("NewScope returned nil")
	}

	if scope.maxRange != 100.0 {
		t.Errorf("expected maxRange 100.0, got %f", scope.maxRange)
	}

	if scope.rangeRings != 4 {
		t.Errorf("expected rangeRings 4, got %d", scope.rangeRings)
	}

	if !scope.showCompass {
		t.Error("expected showCompass to be true")
	}

	if scope.theme != th {
		t.Error("expected theme to be set correctly")
	}

	// Verify cells are initialized to correct dimensions
	if len(scope.cells) != RadarHeight {
		t.Errorf("expected %d rows, got %d", RadarHeight, len(scope.cells))
	}

	for y, row := range scope.cells {
		if len(row) != RadarWidth {
			t.Errorf("row %d: expected %d cols, got %d", y, RadarWidth, len(row))
		}
		for x, c := range row {
			if c.char != ' ' {
				t.Errorf("cell [%d][%d]: expected space, got %c", y, x, c.char)
			}
		}
	}
}

func TestScope_Clear(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, true)

	// Fill some cells with content
	scope.cells[5][5] = cell{char: 'X', color: th.PrimaryBright}
	scope.cells[10][10] = cell{char: 'Y', color: th.Secondary}

	// Verify cells were modified
	if scope.cells[5][5].char != 'X' {
		t.Fatal("test setup failed: cell not modified")
	}

	// Clear the scope
	scope.Clear()

	// Verify all cells are now spaces
	for y, row := range scope.cells {
		for x, c := range row {
			if c.char != ' ' {
				t.Errorf("cell [%d][%d]: expected space after clear, got %c", y, x, c.char)
			}
		}
	}
}

func TestScope_DrawTarget(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, true)
	scope.Clear()

	targets := map[string]*Target{
		"abc123": {
			Hex:      "abc123",
			Callsign: "TEST01",
			Lat:      52.0,
			Lon:      4.0,
			Distance: 25.0, // 25nm out, should be within range
			Bearing:  90.0, // East
			HasLat:   true,
			HasLon:   true,
		},
	}

	sortedHexes := scope.DrawTargets(targets, "", false, false, false, false)

	// Verify target was returned in sorted list
	if len(sortedHexes) != 1 {
		t.Fatalf("expected 1 sorted hex, got %d", len(sortedHexes))
	}
	if sortedHexes[0] != "abc123" {
		t.Errorf("expected hex 'abc123', got '%s'", sortedHexes[0])
	}

	// Verify a target symbol was drawn somewhere
	found := false
	for _, row := range scope.cells {
		for _, c := range row {
			if c.char == '✦' {
				found = true
				break
			}
		}
		if found {
			break
		}
	}

	if !found {
		t.Error("expected target symbol '✦' to be drawn on scope")
	}
}

func TestScope_DrawTarget_Selected(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, true)
	scope.Clear()

	targets := map[string]*Target{
		"abc123": {
			Hex:      "abc123",
			Callsign: "TEST01",
			Distance: 25.0,
			Bearing:  0.0, // North
			HasLat:   true,
			HasLon:   true,
		},
	}

	// Draw with abc123 selected
	scope.DrawTargets(targets, "abc123", false, false, false, false)

	// Verify selected symbol was drawn
	found := false
	for _, row := range scope.cells {
		for _, c := range row {
			if c.char == '◉' {
				found = true
				if c.color != th.Selected {
					t.Error("selected target should use Selected color")
				}
				break
			}
		}
		if found {
			break
		}
	}

	if !found {
		t.Error("expected selected symbol '◉' to be drawn on scope")
	}
}

func TestScope_DrawTarget_Military(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, true)
	scope.Clear()

	targets := map[string]*Target{
		"mil001": {
			Hex:      "mil001",
			Callsign: "FORCE1",
			Distance: 30.0,
			Bearing:  180.0, // South
			Military: true,
			HasLat:   true,
			HasLon:   true,
		},
	}

	scope.DrawTargets(targets, "", false, false, false, false)

	// Verify military symbol was drawn
	found := false
	for _, row := range scope.cells {
		for _, c := range row {
			if c.char == '◆' {
				found = true
				if c.color != th.Military {
					t.Error("military target should use Military color")
				}
				break
			}
		}
		if found {
			break
		}
	}

	if !found {
		t.Error("expected military symbol '◆' to be drawn on scope")
	}
}

func TestScope_DrawTarget_Emergency(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, true)

	emergencySquawks := []string{"7500", "7600", "7700"}

	for _, squawk := range emergencySquawks {
		scope.Clear()

		targets := map[string]*Target{
			"emrg01": {
				Hex:      "emrg01",
				Callsign: "EMRG01",
				Distance: 20.0,
				Bearing:  45.0,
				Squawk:   squawk,
				HasLat:   true,
				HasLon:   true,
			},
		}

		// Test with blink = false (shows ✖)
		scope.DrawTargets(targets, "", false, false, false, false)

		foundEmergencySymbol := false
		for _, row := range scope.cells {
			for _, c := range row {
				if c.char == '✖' || c.char == '!' {
					foundEmergencySymbol = true
					if c.color != th.Emergency {
						t.Errorf("squawk %s: emergency target should use Emergency color", squawk)
					}
					break
				}
			}
			if foundEmergencySymbol {
				break
			}
		}

		if !foundEmergencySymbol {
			t.Errorf("squawk %s: expected emergency symbol to be drawn on scope", squawk)
		}
	}
}

func TestScope_DrawRangeRings(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 3, false)
	scope.Clear()

	scope.DrawRangeRings()

	// Count range ring characters
	ringCount := 0
	for _, row := range scope.cells {
		for _, c := range row {
			if c.char == '·' && c.color == th.RadarRing {
				ringCount++
			}
		}
	}

	// Should have drawn multiple ring dots
	if ringCount < 50 {
		t.Errorf("expected at least 50 range ring dots, got %d", ringCount)
	}
}

func TestScope_DrawCompass(t *testing.T) {
	th := theme.Get("classic")

	// Test with compass enabled
	scope := NewScope(th, 100.0, 4, true)
	scope.Clear()
	scope.DrawCompass()

	// Check for compass axes
	foundVertical := false
	foundHorizontal := false
	foundCenter := false

	for y, row := range scope.cells {
		for x, c := range row {
			if c.char == '│' {
				foundVertical = true
			}
			if c.char == '─' {
				foundHorizontal = true
			}
			if c.char == '╋' && x == RadarCenterX && y == RadarCenterY {
				foundCenter = true
			}
		}
	}

	if !foundVertical {
		t.Error("expected vertical axis to be drawn")
	}
	if !foundHorizontal {
		t.Error("expected horizontal axis to be drawn")
	}
	if !foundCenter {
		t.Error("expected center crosshair to be drawn at center")
	}

	// Check for cardinal labels (N, S, E, W)
	cardinals := []rune{'N', 'S', 'E', 'W'}
	for _, cardinal := range cardinals {
		found := false
		for _, row := range scope.cells {
			for _, c := range row {
				if c.char == cardinal {
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if !found {
			t.Errorf("expected cardinal direction '%c' to be drawn", cardinal)
		}
	}

	// Test with compass disabled
	scope2 := NewScope(th, 100.0, 4, false)
	scope2.Clear()
	scope2.DrawCompass()

	// Should not have drawn compass elements
	compassElementCount := 0
	for _, row := range scope2.cells {
		for _, c := range row {
			if c.char == '│' || c.char == '─' || c.char == '╋' {
				compassElementCount++
			}
		}
	}

	if compassElementCount > 0 {
		t.Error("compass elements should not be drawn when showCompass is false")
	}
}

func TestScope_DrawSweep(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, false)
	scope.Clear()

	scope.DrawSweep(45.0) // 45 degrees (NE direction)

	// Count sweep characters
	sweepCount := 0
	for _, row := range scope.cells {
		for _, c := range row {
			if c.char == '░' && c.color == th.RadarSweep {
				sweepCount++
			}
		}
	}

	// Should have drawn sweep line
	if sweepCount < 5 {
		t.Errorf("expected at least 5 sweep characters, got %d", sweepCount)
	}

	// Test different angles
	angles := []float64{0.0, 90.0, 180.0, 270.0, 360.0}
	for _, angle := range angles {
		scope.Clear()
		scope.DrawSweep(angle)

		count := 0
		for _, row := range scope.cells {
			for _, c := range row {
				if c.char == '░' {
					count++
				}
			}
		}

		if count < 5 {
			t.Errorf("angle %.0f: expected at least 5 sweep characters, got %d", angle, count)
		}
	}
}

func TestScope_DrawTrails(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, false)
	scope.Clear()

	// Create trail points
	trails := map[string][]TrailPoint{
		"abc123": {
			{Lat: 52.00, Lon: 4.00}, // Oldest
			{Lat: 52.01, Lon: 4.01},
			{Lat: 52.02, Lon: 4.02},
			{Lat: 52.03, Lon: 4.03},
			{Lat: 52.04, Lon: 4.04},
			{Lat: 52.05, Lon: 4.05}, // Newest (current position)
		},
	}

	// Receiver at a location
	receiverLat := 52.0
	receiverLon := 4.0

	scope.DrawTrails(trails, receiverLat, receiverLon)

	// Count trail characters
	trailChars := []rune{'·', '•', '∘'}
	trailCount := 0
	for _, row := range scope.cells {
		for _, c := range row {
			for _, trailChar := range trailChars {
				if c.char == trailChar && c.color == th.RadarTrail {
					trailCount++
					break
				}
			}
		}
	}

	// Should have drawn some trail points (not the last one which is current position)
	if trailCount < 1 {
		t.Errorf("expected at least 1 trail point, got %d", trailCount)
	}
}

func TestScope_DrawTrails_NoReceiver(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, false)
	scope.Clear()

	trails := map[string][]TrailPoint{
		"abc123": {
			{Lat: 52.00, Lon: 4.00},
			{Lat: 52.01, Lon: 4.01},
		},
	}

	// No receiver coordinates (both 0)
	scope.DrawTrails(trails, 0, 0)

	// Should not have drawn any trails
	for _, row := range scope.cells {
		for _, c := range row {
			if c.char != ' ' {
				t.Error("expected no trails to be drawn when receiver coordinates are 0")
				return
			}
		}
	}
}

func TestScope_Render(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 50.0, 3, true)
	scope.Clear()
	scope.DrawRangeRings()
	scope.DrawCompass()

	output := scope.Render()

	// Check for basic structure
	if !strings.Contains(output, "╔") {
		t.Error("render output missing top border")
	}
	if !strings.Contains(output, "╗") {
		t.Error("render output missing top right border")
	}
	if !strings.Contains(output, "╚") {
		t.Error("render output missing bottom border")
	}
	if !strings.Contains(output, "╝") {
		t.Error("render output missing bottom right border")
	}
	if !strings.Contains(output, "║") {
		t.Error("render output missing side borders")
	}

	// Check for range display
	if !strings.Contains(output, "50nm") {
		t.Error("render output missing range indicator")
	}

	// Check for multiple lines
	lines := strings.Split(output, "\n")
	// Should have RadarHeight + 2 lines (top border, content, bottom border)
	expectedMinLines := RadarHeight + 2
	if len(lines) < expectedMinLines {
		t.Errorf("expected at least %d lines, got %d", expectedMinLines, len(lines))
	}
}

func TestScope_CoordinateConversion(t *testing.T) {
	testCases := []struct {
		distance float64
		bearing  float64
		maxRange float64
		desc     string
	}{
		{0, 0, 100, "center at origin"},
		{50, 0, 100, "north at half range"},
		{50, 90, 100, "east at half range"},
		{50, 180, 100, "south at half range"},
		{50, 270, 100, "west at half range"},
		{100, 45, 100, "NE at max range"},
		{150, 0, 100, "beyond max range"},
	}

	for _, tc := range testCases {
		x, y := TargetToRadarPos(tc.distance, tc.bearing, tc.maxRange)

		if tc.distance > tc.maxRange {
			// Should return -1, -1 for out of range
			if x != -1 || y != -1 {
				t.Errorf("%s: expected (-1, -1) for out of range, got (%d, %d)", tc.desc, x, y)
			}
		} else {
			// Should be within bounds
			if x < 0 || x >= RadarWidth || y < 0 || y >= RadarHeight {
				t.Errorf("%s: position (%d, %d) out of bounds", tc.desc, x, y)
			}

			// Center should be near radar center for distance 0
			if tc.distance == 0 {
				if x != RadarCenterX || y != RadarCenterY {
					t.Errorf("%s: expected center (%d, %d), got (%d, %d)",
						tc.desc, RadarCenterX, RadarCenterY, x, y)
				}
			}
		}
	}
}

func TestScope_CoordinateConversion_Bearings(t *testing.T) {
	maxRange := 100.0
	distance := 50.0

	// North (0 degrees) should be above center
	x, y := TargetToRadarPos(distance, 0, maxRange)
	if y >= RadarCenterY {
		t.Errorf("north bearing: expected y < %d, got %d", RadarCenterY, y)
	}

	// South (180 degrees) should be below center
	x, y = TargetToRadarPos(distance, 180, maxRange)
	if y <= RadarCenterY {
		t.Errorf("south bearing: expected y > %d, got %d", RadarCenterY, y)
	}

	// East (90 degrees) should be right of center
	x, y = TargetToRadarPos(distance, 90, maxRange)
	if x <= RadarCenterX {
		t.Errorf("east bearing: expected x > %d, got %d", RadarCenterX, x)
	}

	// West (270 degrees) should be left of center
	x, y = TargetToRadarPos(distance, 270, maxRange)
	if x >= RadarCenterX {
		t.Errorf("west bearing: expected x < %d, got %d", RadarCenterX, x)
	}
}

func TestHaversineBearing(t *testing.T) {
	testCases := []struct {
		lat1, lon1       float64
		lat2, lon2       float64
		expectedDist     float64 // in nm
		expectedBearing  float64 // in degrees
		distTolerance    float64
		bearingTolerance float64
		desc             string
	}{
		{
			lat1: 0, lon1: 0, lat2: 0, lon2: 0,
			expectedDist: 0, expectedBearing: 0,
			distTolerance: 0.1, bearingTolerance: 1,
			desc: "same point",
		},
		{
			lat1: 0, lon1: 0, lat2: 1, lon2: 0,
			expectedDist: 60.0, // 1 degree lat ~ 60nm
			expectedBearing: 0, // Due north
			distTolerance: 1, bearingTolerance: 1,
			desc: "1 degree north",
		},
		{
			lat1: 0, lon1: 0, lat2: 0, lon2: 1,
			expectedDist: 60.0, // 1 degree lon at equator ~ 60nm
			expectedBearing: 90, // Due east
			distTolerance: 1, bearingTolerance: 1,
			desc: "1 degree east at equator",
		},
		{
			lat1: 52.0, lon1: 4.0, lat2: 52.0, lon2: 5.0,
			expectedDist: 37.0, // At latitude 52, 1 degree lon ~ 37nm
			expectedBearing: 90, // Due east
			distTolerance: 2, bearingTolerance: 2,
			desc: "1 degree east at Amsterdam",
		},
		{
			lat1: 51.5, lon1: -0.1, lat2: 48.8, lon2: 2.3,
			expectedDist: 187.0, // London to Paris ~ 187nm
			expectedBearing: 148, // Southeast
			distTolerance: 5, bearingTolerance: 5,
			desc: "London to Paris",
		},
	}

	for _, tc := range testCases {
		dist, bearing := HaversineBearing(tc.lat1, tc.lon1, tc.lat2, tc.lon2)

		if math.Abs(dist-tc.expectedDist) > tc.distTolerance {
			t.Errorf("%s: expected distance ~%.1fnm, got %.1fnm",
				tc.desc, tc.expectedDist, dist)
		}

		// Normalize bearing for comparison
		expectedBearing := math.Mod(tc.expectedBearing+360, 360)
		actualBearing := math.Mod(bearing+360, 360)

		bearingDiff := math.Abs(actualBearing - expectedBearing)
		if bearingDiff > 180 {
			bearingDiff = 360 - bearingDiff
		}

		if bearingDiff > tc.bearingTolerance {
			t.Errorf("%s: expected bearing ~%.1f, got %.1f",
				tc.desc, expectedBearing, actualBearing)
		}
	}
}

func TestHaversineBearing_Symmetry(t *testing.T) {
	lat1, lon1 := 52.0, 4.0
	lat2, lon2 := 52.5, 4.5

	dist1, _ := HaversineBearing(lat1, lon1, lat2, lon2)
	dist2, _ := HaversineBearing(lat2, lon2, lat1, lon1)

	// Distance should be symmetric
	if math.Abs(dist1-dist2) > 0.001 {
		t.Errorf("distance not symmetric: %.3f vs %.3f", dist1, dist2)
	}
}

func TestTarget_IsEmergency(t *testing.T) {
	testCases := []struct {
		squawk   string
		expected bool
	}{
		{"7500", true},  // Hijack
		{"7600", true},  // Radio failure
		{"7700", true},  // Emergency
		{"1200", false}, // VFR
		{"7777", false}, // Military
		{"1234", false}, // Random
		{"", false},     // No squawk
	}

	for _, tc := range testCases {
		target := Target{Squawk: tc.squawk}
		if target.IsEmergency() != tc.expected {
			t.Errorf("squawk %s: expected IsEmergency=%v, got %v",
				tc.squawk, tc.expected, target.IsEmergency())
		}
	}
}

func TestScope_SetRange(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, true)

	scope.SetRange(200.0)
	if scope.maxRange != 200.0 {
		t.Errorf("expected maxRange 200.0, got %f", scope.maxRange)
	}

	scope.SetRange(50.0)
	if scope.maxRange != 50.0 {
		t.Errorf("expected maxRange 50.0, got %f", scope.maxRange)
	}
}

func TestScope_SetRangeRings(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, true)

	scope.SetRangeRings(6)
	if scope.rangeRings != 6 {
		t.Errorf("expected rangeRings 6, got %d", scope.rangeRings)
	}
}

func TestScope_SetTheme(t *testing.T) {
	th1 := theme.Get("classic")
	th2 := theme.Get("amber")
	scope := NewScope(th1, 100.0, 4, true)

	scope.SetTheme(th2)
	if scope.theme != th2 {
		t.Error("expected theme to be updated to amber")
	}
}

func TestScope_DrawTargets_Filtering(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, false)

	// Test military only filter
	targets := map[string]*Target{
		"civil": {
			Hex:      "civil",
			Distance: 20.0,
			Bearing:  45.0,
			Military: false,
			HasLat:   true,
			HasLon:   true,
		},
		"military": {
			Hex:      "military",
			Distance: 20.0,
			Bearing:  90.0,
			Military: true,
			HasLat:   true,
			HasLon:   true,
		},
	}

	scope.Clear()
	sortedHexes := scope.DrawTargets(targets, "", true, false, false, false) // militaryOnly=true

	if len(sortedHexes) != 1 || sortedHexes[0] != "military" {
		t.Errorf("military only filter: expected only 'military', got %v", sortedHexes)
	}

	// Test hide ground filter
	targets2 := map[string]*Target{
		"airborne": {
			Hex:      "airborne",
			Distance: 20.0,
			Bearing:  45.0,
			Altitude: 10000,
			HasLat:   true,
			HasLon:   true,
			HasAlt:   true,
		},
		"ground": {
			Hex:      "ground",
			Distance: 20.0,
			Bearing:  90.0,
			Altitude: 0,
			HasLat:   true,
			HasLon:   true,
			HasAlt:   true,
		},
	}

	scope.Clear()
	sortedHexes = scope.DrawTargets(targets2, "", false, true, false, false) // hideGround=true

	if len(sortedHexes) != 1 || sortedHexes[0] != "airborne" {
		t.Errorf("hide ground filter: expected only 'airborne', got %v", sortedHexes)
	}
}

func TestScope_DrawTargets_NoPosition(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, false)

	targets := map[string]*Target{
		"nopos": {
			Hex:      "nopos",
			Distance: 20.0,
			Bearing:  45.0,
			HasLat:   false, // No position
			HasLon:   false,
		},
	}

	scope.Clear()
	sortedHexes := scope.DrawTargets(targets, "", false, false, false, false)

	if len(sortedHexes) != 0 {
		t.Errorf("expected no targets without position, got %v", sortedHexes)
	}
}

func TestScope_DrawTargets_Sorting(t *testing.T) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, false)

	targets := map[string]*Target{
		"far": {
			Hex:      "far",
			Distance: 80.0,
			Bearing:  0.0,
			HasLat:   true,
			HasLon:   true,
		},
		"near": {
			Hex:      "near",
			Distance: 10.0,
			Bearing:  90.0,
			HasLat:   true,
			HasLon:   true,
		},
		"mid": {
			Hex:      "mid",
			Distance: 40.0,
			Bearing:  180.0,
			HasLat:   true,
			HasLon:   true,
		},
	}

	scope.Clear()
	sortedHexes := scope.DrawTargets(targets, "", false, false, false, false)

	// Should be sorted by distance (nearest first)
	if len(sortedHexes) != 3 {
		t.Fatalf("expected 3 sorted hexes, got %d", len(sortedHexes))
	}

	if sortedHexes[0] != "near" {
		t.Errorf("expected 'near' first, got '%s'", sortedHexes[0])
	}
	if sortedHexes[1] != "mid" {
		t.Errorf("expected 'mid' second, got '%s'", sortedHexes[1])
	}
	if sortedHexes[2] != "far" {
		t.Errorf("expected 'far' third, got '%s'", sortedHexes[2])
	}
}

func BenchmarkScope_Render(b *testing.B) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, true)

	for i := 0; i < b.N; i++ {
		scope.Clear()
		scope.DrawRangeRings()
		scope.DrawCompass()
		scope.DrawSweep(float64(i % 360))
		scope.Render()
	}
}

func BenchmarkScope_DrawTargets(b *testing.B) {
	th := theme.Get("classic")
	scope := NewScope(th, 100.0, 4, true)

	// Create 50 targets
	targets := make(map[string]*Target)
	for i := 0; i < 50; i++ {
		hex := string(rune('A'+i/26)) + string(rune('A'+i%26)) + "123"
		targets[hex] = &Target{
			Hex:      hex,
			Callsign: "TST" + string(rune('0'+i%10)),
			Distance: float64(i*2) + 5,
			Bearing:  float64(i * 7 % 360),
			HasLat:   true,
			HasLon:   true,
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		scope.Clear()
		scope.DrawTargets(targets, "", false, false, false, false)
	}
}

func BenchmarkHaversineBearing(b *testing.B) {
	for i := 0; i < b.N; i++ {
		HaversineBearing(52.0, 4.0, 52.5+float64(i%10)*0.01, 4.5+float64(i%10)*0.01)
	}
}
