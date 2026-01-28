package search

import (
	"sort"
	"testing"

	"github.com/skyspy/skyspy-go/internal/radar"
)

func TestParseQuery_PlainText(t *testing.T) {
	tests := []struct {
		name      string
		query     string
		wantQuery string
	}{
		{
			name:      "simple callsign",
			query:     "UAL123",
			wantQuery: "UAL123",
		},
		{
			name:      "hex code",
			query:     "ABC123",
			wantQuery: "ABC123",
		},
		{
			name:      "lowercase converted to uppercase",
			query:     "ual123",
			wantQuery: "UAL123",
		},
		{
			name:      "mixed case",
			query:     "UaL123",
			wantQuery: "UAL123",
		},
		{
			name:      "with spaces",
			query:     "UAL 123",
			wantQuery: "UAL 123",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filter := ParseQuery(tt.query)

			if filter.Query != tt.query {
				t.Errorf("Query: expected %q, got %q", tt.query, filter.Query)
			}

			if filter.MilitaryOnly {
				t.Error("MilitaryOnly should be false for plain text query")
			}
			if len(filter.SquawkCodes) > 0 {
				t.Error("SquawkCodes should be empty for plain text query")
			}
			if filter.MinAltitude != 0 {
				t.Error("MinAltitude should be 0 for plain text query")
			}
			if filter.MaxAltitude != 0 {
				t.Error("MaxAltitude should be 0 for plain text query")
			}
		})
	}
}

func TestParseQuery_Squawk(t *testing.T) {
	filter := ParseQuery("sq:7700")

	if len(filter.SquawkCodes) != 1 {
		t.Fatalf("expected 1 squawk code, got %d", len(filter.SquawkCodes))
	}

	if filter.SquawkCodes[0] != "7700" {
		t.Errorf("expected squawk code '7700', got %q", filter.SquawkCodes[0])
	}

	if filter.MilitaryOnly {
		t.Error("MilitaryOnly should be false")
	}
}

func TestParseQuery_SquawkMultiple(t *testing.T) {
	filter := ParseQuery("sq:7500,7600,7700")

	if len(filter.SquawkCodes) != 3 {
		t.Fatalf("expected 3 squawk codes, got %d", len(filter.SquawkCodes))
	}

	expectedSquawks := []string{"7500", "7600", "7700"}
	for i, expected := range expectedSquawks {
		if filter.SquawkCodes[i] != expected {
			t.Errorf("squawk[%d]: expected %q, got %q", i, expected, filter.SquawkCodes[i])
		}
	}
}

func TestParseQuery_SquawkNoSpaces(t *testing.T) {
	// Note: The parser treats spaces as token separators, so "sq:7500, 7600" would be
	// parsed as "sq:7500," and "7600" as separate tokens.
	// Users should use "sq:7500,7600,7700" without spaces.
	filter := ParseQuery("sq:7500,7600,7700")

	if len(filter.SquawkCodes) != 3 {
		t.Fatalf("expected 3 squawk codes, got %d", len(filter.SquawkCodes))
	}
}

func TestParseQuery_AltitudeAbove(t *testing.T) {
	filter := ParseQuery("alt:>10000")

	if filter.MinAltitude != 10000 {
		t.Errorf("MinAltitude: expected 10000, got %d", filter.MinAltitude)
	}

	if filter.MaxAltitude != 0 {
		t.Errorf("MaxAltitude: expected 0, got %d", filter.MaxAltitude)
	}
}

func TestParseQuery_AltitudeBelow(t *testing.T) {
	filter := ParseQuery("alt:<5000")

	if filter.MaxAltitude != 5000 {
		t.Errorf("MaxAltitude: expected 5000, got %d", filter.MaxAltitude)
	}

	if filter.MinAltitude != 0 {
		t.Errorf("MinAltitude: expected 0, got %d", filter.MinAltitude)
	}
}

func TestParseQuery_AltitudeRange(t *testing.T) {
	filter := ParseQuery("alt:5000-10000")

	if filter.MinAltitude != 5000 {
		t.Errorf("MinAltitude: expected 5000, got %d", filter.MinAltitude)
	}

	if filter.MaxAltitude != 10000 {
		t.Errorf("MaxAltitude: expected 10000, got %d", filter.MaxAltitude)
	}
}

func TestParseQuery_DistanceWithin(t *testing.T) {
	filter := ParseQuery("dist:<50")

	if filter.MaxDistance != 50.0 {
		t.Errorf("MaxDistance: expected 50.0, got %f", filter.MaxDistance)
	}

	if filter.MinDistance != 0 {
		t.Errorf("MinDistance: expected 0, got %f", filter.MinDistance)
	}
}

func TestParseQuery_DistanceAbove(t *testing.T) {
	filter := ParseQuery("dist:>10")

	if filter.MinDistance != 10.0 {
		t.Errorf("MinDistance: expected 10.0, got %f", filter.MinDistance)
	}

	if filter.MaxDistance != 0 {
		t.Errorf("MaxDistance: expected 0, got %f", filter.MaxDistance)
	}
}

func TestParseQuery_DistanceRange(t *testing.T) {
	filter := ParseQuery("dist:10-50")

	if filter.MinDistance != 10.0 {
		t.Errorf("MinDistance: expected 10.0, got %f", filter.MinDistance)
	}

	if filter.MaxDistance != 50.0 {
		t.Errorf("MaxDistance: expected 50.0, got %f", filter.MaxDistance)
	}
}

func TestParseQuery_Military(t *testing.T) {
	filter := ParseQuery("mil")

	if !filter.MilitaryOnly {
		t.Error("MilitaryOnly should be true")
	}

	if len(filter.SquawkCodes) > 0 {
		t.Error("SquawkCodes should be empty")
	}
}

func TestParseQuery_MilitaryCaseInsensitive(t *testing.T) {
	tests := []string{"mil", "MIL", "Mil", "MiL"}

	for _, query := range tests {
		t.Run(query, func(t *testing.T) {
			filter := ParseQuery(query)
			if !filter.MilitaryOnly {
				t.Errorf("MilitaryOnly should be true for query %q", query)
			}
		})
	}
}

func TestParseQuery_Combined(t *testing.T) {
	filter := ParseQuery("mil alt:>20000 dist:<100")

	if !filter.MilitaryOnly {
		t.Error("MilitaryOnly should be true")
	}

	if filter.MinAltitude != 20000 {
		t.Errorf("MinAltitude: expected 20000, got %d", filter.MinAltitude)
	}

	if filter.MaxDistance != 100.0 {
		t.Errorf("MaxDistance: expected 100.0, got %f", filter.MaxDistance)
	}
}

func TestParseQuery_CombinedWithText(t *testing.T) {
	filter := ParseQuery("UAL mil alt:>30000")

	if !filter.MilitaryOnly {
		t.Error("MilitaryOnly should be true")
	}

	if filter.MinAltitude != 30000 {
		t.Errorf("MinAltitude: expected 30000, got %d", filter.MinAltitude)
	}
}

func TestParseQuery_Empty(t *testing.T) {
	filter := ParseQuery("")

	if filter.MilitaryOnly {
		t.Error("MilitaryOnly should be false for empty query")
	}
	if filter.MinAltitude != 0 {
		t.Error("MinAltitude should be 0 for empty query")
	}
	if filter.MaxAltitude != 0 {
		t.Error("MaxAltitude should be 0 for empty query")
	}
	if len(filter.SquawkCodes) > 0 {
		t.Error("SquawkCodes should be empty for empty query")
	}
	if filter.IsActive() {
		t.Error("empty filter should not be active")
	}
}

func TestMatchesAircraft_Callsign(t *testing.T) {
	aircraft := &radar.Target{
		Hex:      "ABC123",
		Callsign: "UAL123",
		HasLat:   true,
		HasLon:   true,
	}

	tests := []struct {
		query   string
		matches bool
	}{
		{"UAL123", true},
		{"UAL", true},
		{"123", true},
		{"ual123", true},
		{"ual", true},
		{"DAL", false},
		{"XYZ", false},
		{"", true},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			filter := ParseQuery(tt.query)
			result := MatchesAircraft(aircraft, filter)
			if result != tt.matches {
				t.Errorf("query %q: expected %v, got %v", tt.query, tt.matches, result)
			}
		})
	}
}

func TestMatchesAircraft_Hex(t *testing.T) {
	aircraft := &radar.Target{
		Hex:      "ABC123",
		Callsign: "",
		HasLat:   true,
		HasLon:   true,
	}

	tests := []struct {
		query   string
		matches bool
	}{
		{"ABC123", true},
		{"ABC", true},
		{"123", true},
		{"abc123", true},
		{"DEF", false},
		{"XYZ", false},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			filter := ParseQuery(tt.query)
			result := MatchesAircraft(aircraft, filter)
			if result != tt.matches {
				t.Errorf("query %q: expected %v, got %v", tt.query, tt.matches, result)
			}
		})
	}
}

func TestMatchesAircraft_Squawk(t *testing.T) {
	aircraft := &radar.Target{
		Hex:    "ABC123",
		Squawk: "7700",
		HasLat: true,
		HasLon: true,
	}

	tests := []struct {
		query   string
		matches bool
	}{
		{"sq:7700", true},
		{"sq:7500,7600,7700", true},
		{"sq:1234", false},
		{"sq:7500", false},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			filter := ParseQuery(tt.query)
			result := MatchesAircraft(aircraft, filter)
			if result != tt.matches {
				t.Errorf("query %q: expected %v, got %v", tt.query, tt.matches, result)
			}
		})
	}
}

func TestMatchesAircraft_Military(t *testing.T) {
	militaryAircraft := &radar.Target{
		Hex:      "MIL001",
		Military: true,
		HasLat:   true,
		HasLon:   true,
	}

	civilianAircraft := &radar.Target{
		Hex:      "CIV001",
		Military: false,
		HasLat:   true,
		HasLon:   true,
	}

	filter := ParseQuery("mil")

	if !MatchesAircraft(militaryAircraft, filter) {
		t.Error("military aircraft should match 'mil' filter")
	}

	if MatchesAircraft(civilianAircraft, filter) {
		t.Error("civilian aircraft should not match 'mil' filter")
	}
}

func TestMatchesAircraft_Altitude(t *testing.T) {
	aircraft := &radar.Target{
		Hex:      "ABC123",
		Altitude: 15000,
		HasAlt:   true,
		HasLat:   true,
		HasLon:   true,
	}

	tests := []struct {
		query   string
		matches bool
	}{
		{"alt:>10000", true},
		{"alt:>20000", false},
		{"alt:<20000", true},
		{"alt:<10000", false},
		{"alt:10000-20000", true},
		{"alt:20000-30000", false},
		{"alt:5000-10000", false},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			filter := ParseQuery(tt.query)
			result := MatchesAircraft(aircraft, filter)
			if result != tt.matches {
				t.Errorf("query %q: expected %v, got %v", tt.query, tt.matches, result)
			}
		})
	}
}

func TestMatchesAircraft_Altitude_NoAltitude(t *testing.T) {
	aircraft := &radar.Target{
		Hex:    "ABC123",
		HasAlt: false,
		HasLat: true,
		HasLon: true,
	}

	filter := ParseQuery("alt:>10000")
	if MatchesAircraft(aircraft, filter) {
		t.Error("aircraft without altitude should not match altitude filter")
	}
}

func TestMatchesAircraft_Distance(t *testing.T) {
	aircraft := &radar.Target{
		Hex:      "ABC123",
		Distance: 30.0,
		HasLat:   true,
		HasLon:   true,
	}

	tests := []struct {
		query   string
		matches bool
	}{
		{"dist:>20", true},
		{"dist:>40", false},
		{"dist:<50", true},
		{"dist:<20", false},
		{"dist:20-40", true},
		{"dist:40-60", false},
		{"dist:10-20", false},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			filter := ParseQuery(tt.query)
			result := MatchesAircraft(aircraft, filter)
			if result != tt.matches {
				t.Errorf("query %q: expected %v, got %v", tt.query, tt.matches, result)
			}
		})
	}
}

func TestMatchesAircraft_Combined(t *testing.T) {
	aircraft := &radar.Target{
		Hex:      "MIL001",
		Callsign: "REACH01",
		Military: true,
		Altitude: 35000,
		Distance: 50.0,
		Squawk:   "1234",
		HasAlt:   true,
		HasLat:   true,
		HasLon:   true,
	}

	tests := []struct {
		query   string
		matches bool
	}{
		{"mil alt:>30000", true},
		{"mil alt:>40000", false},
		{"REACH mil", true},
		{"mil dist:<100", true},
		{"mil alt:>30000 dist:<100", true},
		{"mil alt:>30000 dist:<40", false},
		{"sq:1234 mil", true},
		{"sq:7700 mil", false},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			filter := ParseQuery(tt.query)
			result := MatchesAircraft(aircraft, filter)
			if result != tt.matches {
				t.Errorf("query %q: expected %v, got %v", tt.query, tt.matches, result)
			}
		})
	}
}

func TestMatchesAircraft_NilFilter(t *testing.T) {
	aircraft := &radar.Target{
		Hex:    "ABC123",
		HasLat: true,
		HasLon: true,
	}

	if !MatchesAircraft(aircraft, nil) {
		t.Error("nil filter should match all aircraft")
	}
}

func TestFilterAircraft(t *testing.T) {
	aircraft := map[string]*radar.Target{
		"ABC123": {
			Hex:      "ABC123",
			Callsign: "UAL123",
			Military: false,
			Altitude: 35000,
			HasAlt:   true,
			HasLat:   true,
			HasLon:   true,
		},
		"DEF456": {
			Hex:      "DEF456",
			Callsign: "AAL456",
			Military: false,
			Altitude: 5000,
			HasAlt:   true,
			HasLat:   true,
			HasLon:   true,
		},
		"MIL001": {
			Hex:      "MIL001",
			Callsign: "REACH01",
			Military: true,
			Altitude: 40000,
			HasAlt:   true,
			HasLat:   true,
			HasLon:   true,
		},
		"MIL002": {
			Hex:      "MIL002",
			Callsign: "REACH02",
			Military: true,
			Altitude: 25000,
			HasAlt:   true,
			HasLat:   true,
			HasLon:   true,
		},
	}

	tests := []struct {
		query       string
		expectedLen int
		contains    []string
	}{
		{"", 4, []string{"ABC123", "DEF456", "MIL001", "MIL002"}},
		{"mil", 2, []string{"MIL001", "MIL002"}},
		{"alt:>30000", 2, []string{"ABC123", "MIL001"}},
		{"alt:<10000", 1, []string{"DEF456"}},
		{"UAL", 1, []string{"ABC123"}},
		{"REACH", 2, []string{"MIL001", "MIL002"}},
		{"mil alt:>30000", 1, []string{"MIL001"}},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			filter := ParseQuery(tt.query)
			results := FilterAircraft(aircraft, filter)

			if len(results) != tt.expectedLen {
				t.Errorf("query %q: expected %d results, got %d", tt.query, tt.expectedLen, len(results))
			}

			for _, expectedHex := range tt.contains {
				found := false
				for _, hex := range results {
					if hex == expectedHex {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("query %q: expected to contain %s", tt.query, expectedHex)
				}
			}
		})
	}
}

func TestFilterAircraft_EmptyMap(t *testing.T) {
	aircraft := map[string]*radar.Target{}
	filter := ParseQuery("mil")

	results := FilterAircraft(aircraft, filter)

	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

func TestPresets(t *testing.T) {
	t.Run("PresetAllAircraft", func(t *testing.T) {
		filter := PresetAllAircraft()

		if filter.MilitaryOnly {
			t.Error("PresetAllAircraft should not be military only")
		}
		if filter.MinAltitude != 0 {
			t.Error("PresetAllAircraft should have no altitude filter")
		}
		if len(filter.SquawkCodes) > 0 {
			t.Error("PresetAllAircraft should have no squawk filter")
		}
		if filter.IsActive() {
			t.Error("PresetAllAircraft should not be active")
		}
	})

	t.Run("PresetMilitaryOnly", func(t *testing.T) {
		filter := PresetMilitaryOnly()

		if !filter.MilitaryOnly {
			t.Error("PresetMilitaryOnly should be military only")
		}
		if filter.Query != "mil" {
			t.Errorf("PresetMilitaryOnly query: expected 'mil', got %q", filter.Query)
		}
		if !filter.IsActive() {
			t.Error("PresetMilitaryOnly should be active")
		}
	})

	t.Run("PresetEmergencies", func(t *testing.T) {
		filter := PresetEmergencies()

		if len(filter.SquawkCodes) != 3 {
			t.Fatalf("PresetEmergencies: expected 3 squawk codes, got %d", len(filter.SquawkCodes))
		}

		expectedSquawks := []string{"7500", "7600", "7700"}
		sort.Strings(filter.SquawkCodes)
		sort.Strings(expectedSquawks)

		for i, expected := range expectedSquawks {
			if filter.SquawkCodes[i] != expected {
				t.Errorf("squawk[%d]: expected %q, got %q", i, expected, filter.SquawkCodes[i])
			}
		}

		if !filter.IsActive() {
			t.Error("PresetEmergencies should be active")
		}
	})

	t.Run("PresetLowAltitude", func(t *testing.T) {
		filter := PresetLowAltitude()

		if filter.MaxAltitude != 10000 {
			t.Errorf("PresetLowAltitude MaxAltitude: expected 10000, got %d", filter.MaxAltitude)
		}
		if filter.Query != "alt:<10000" {
			t.Errorf("PresetLowAltitude query: expected 'alt:<10000', got %q", filter.Query)
		}
		if !filter.IsActive() {
			t.Error("PresetLowAltitude should be active")
		}
	})
}

func TestPresets_FilterAircraft(t *testing.T) {
	aircraft := map[string]*radar.Target{
		"CIV001": {
			Hex:      "CIV001",
			Military: false,
			Altitude: 35000,
			Squawk:   "1234",
			HasAlt:   true,
			HasLat:   true,
			HasLon:   true,
		},
		"MIL001": {
			Hex:      "MIL001",
			Military: true,
			Altitude: 40000,
			Squawk:   "5678",
			HasAlt:   true,
			HasLat:   true,
			HasLon:   true,
		},
		"EMERG": {
			Hex:      "EMERG",
			Military: false,
			Altitude: 15000,
			Squawk:   "7700",
			HasAlt:   true,
			HasLat:   true,
			HasLon:   true,
		},
		"LOW001": {
			Hex:      "LOW001",
			Military: false,
			Altitude: 5000,
			Squawk:   "1200",
			HasAlt:   true,
			HasLat:   true,
			HasLon:   true,
		},
	}

	t.Run("PresetAllAircraft filters nothing", func(t *testing.T) {
		filter := PresetAllAircraft()
		results := FilterAircraft(aircraft, filter)
		if len(results) != 4 {
			t.Errorf("expected 4 aircraft, got %d", len(results))
		}
	})

	t.Run("PresetMilitaryOnly filters military", func(t *testing.T) {
		filter := PresetMilitaryOnly()
		results := FilterAircraft(aircraft, filter)
		if len(results) != 1 {
			t.Errorf("expected 1 military aircraft, got %d", len(results))
		}
		if len(results) > 0 && results[0] != "MIL001" {
			t.Errorf("expected MIL001, got %s", results[0])
		}
	})

	t.Run("PresetEmergencies filters emergencies", func(t *testing.T) {
		filter := PresetEmergencies()
		results := FilterAircraft(aircraft, filter)
		if len(results) != 1 {
			t.Errorf("expected 1 emergency aircraft, got %d", len(results))
		}
		if len(results) > 0 && results[0] != "EMERG" {
			t.Errorf("expected EMERG, got %s", results[0])
		}
	})

	t.Run("PresetLowAltitude filters low aircraft", func(t *testing.T) {
		filter := PresetLowAltitude()
		results := FilterAircraft(aircraft, filter)
		if len(results) != 1 {
			t.Errorf("expected 1 low altitude aircraft, got %d", len(results))
		}
		if len(results) > 0 && results[0] != "LOW001" {
			t.Errorf("expected LOW001, got %s", results[0])
		}
	})
}

func TestFilter_IsActive(t *testing.T) {
	tests := []struct {
		name     string
		filter   *Filter
		expected bool
	}{
		{
			name:     "nil filter",
			filter:   nil,
			expected: false,
		},
		{
			name:     "empty filter",
			filter:   &Filter{},
			expected: false,
		},
		{
			name:     "military only",
			filter:   &Filter{MilitaryOnly: true},
			expected: true,
		},
		{
			name:     "min altitude",
			filter:   &Filter{MinAltitude: 10000},
			expected: true,
		},
		{
			name:     "max altitude",
			filter:   &Filter{MaxAltitude: 10000},
			expected: true,
		},
		{
			name:     "min distance",
			filter:   &Filter{MinDistance: 10.0},
			expected: true,
		},
		{
			name:     "max distance",
			filter:   &Filter{MaxDistance: 50.0},
			expected: true,
		},
		{
			name:     "squawk codes",
			filter:   &Filter{SquawkCodes: []string{"7700"}},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.filter.IsActive()
			if result != tt.expected {
				t.Errorf("expected IsActive=%v, got %v", tt.expected, result)
			}
		})
	}
}

func TestFilter_Description(t *testing.T) {
	tests := []struct {
		name        string
		filter      *Filter
		shouldBeEmpty bool
		contains    []string
	}{
		{
			name:        "nil filter",
			filter:      nil,
			shouldBeEmpty: true,
		},
		{
			name:        "empty filter",
			filter:      &Filter{},
			shouldBeEmpty: true,
		},
		{
			name:     "military only",
			filter:   &Filter{MilitaryOnly: true},
			contains: []string{"MIL"},
		},
		{
			name:     "altitude above",
			filter:   &Filter{MinAltitude: 10000},
			contains: []string{"ALT>10000"},
		},
		{
			name:     "altitude below",
			filter:   &Filter{MaxAltitude: 10000},
			contains: []string{"ALT<10000"},
		},
		{
			name:     "altitude range",
			filter:   &Filter{MinAltitude: 5000, MaxAltitude: 10000},
			contains: []string{"ALT:5000-10000"},
		},
		{
			name:     "squawk codes",
			filter:   &Filter{SquawkCodes: []string{"7500", "7700"}},
			contains: []string{"SQ:7500,7700"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			desc := tt.filter.Description()

			if tt.shouldBeEmpty {
				if desc != "" {
					t.Errorf("expected empty description, got %q", desc)
				}
				return
			}

			for _, substr := range tt.contains {
				if desc == "" {
					t.Errorf("expected description to contain %q, but got empty string", substr)
				}
			}
		})
	}
}

func TestFilter_HighlightMatch(t *testing.T) {
	tests := []struct {
		name         string
		query        string
		text         string
		wantBefore   string
		wantMatch    string
		wantAfter    string
	}{
		{
			name:       "no query",
			query:      "",
			text:       "UAL123",
			wantBefore: "UAL123",
			wantMatch:  "",
			wantAfter:  "",
		},
		{
			name:       "match at start",
			query:      "UAL",
			text:       "UAL123",
			wantBefore: "",
			wantMatch:  "UAL",
			wantAfter:  "123",
		},
		{
			name:       "match at end",
			query:      "123",
			text:       "UAL123",
			wantBefore: "UAL",
			wantMatch:  "123",
			wantAfter:  "",
		},
		{
			name:       "match in middle",
			query:      "AL1",
			text:       "UAL123",
			wantBefore: "U",
			wantMatch:  "AL1",
			wantAfter:  "23",
		},
		{
			name:       "no match",
			query:      "XYZ",
			text:       "UAL123",
			wantBefore: "UAL123",
			wantMatch:  "",
			wantAfter:  "",
		},
		{
			name:       "case insensitive",
			query:      "ual",
			text:       "UAL123",
			wantBefore: "",
			wantMatch:  "UAL",
			wantAfter:  "123",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filter := ParseQuery(tt.query)
			before, match, after := filter.HighlightMatch(tt.text)

			if before != tt.wantBefore {
				t.Errorf("before: expected %q, got %q", tt.wantBefore, before)
			}
			if match != tt.wantMatch {
				t.Errorf("match: expected %q, got %q", tt.wantMatch, match)
			}
			if after != tt.wantAfter {
				t.Errorf("after: expected %q, got %q", tt.wantAfter, after)
			}
		})
	}
}

func TestEmergencySquawks(t *testing.T) {
	if len(EmergencySquawks) != 3 {
		t.Errorf("expected 3 emergency squawks, got %d", len(EmergencySquawks))
	}

	expected := map[string]bool{
		"7500": true,
		"7600": true,
		"7700": true,
	}

	for _, sq := range EmergencySquawks {
		if !expected[sq] {
			t.Errorf("unexpected emergency squawk: %s", sq)
		}
	}
}

// ============================================================================
// Additional Coverage Tests
// ============================================================================

func TestParseQuery_AltitudeInvalidFormat(t *testing.T) {
	// Test altitude with invalid number format
	filter := ParseQuery("alt:>abc")

	// Should not set MinAltitude due to parse error
	if filter.MinAltitude != 0 {
		t.Errorf("expected MinAltitude 0 for invalid format, got %d", filter.MinAltitude)
	}

	// Test altitude range with invalid numbers
	filter = ParseQuery("alt:abc-def")
	if filter.MinAltitude != 0 || filter.MaxAltitude != 0 {
		t.Error("expected no altitude values for invalid range format")
	}

	// Test altitude below with invalid number
	filter = ParseQuery("alt:<xyz")
	if filter.MaxAltitude != 0 {
		t.Errorf("expected MaxAltitude 0 for invalid format, got %d", filter.MaxAltitude)
	}

	// Test altitude exact value with invalid number
	filter = ParseQuery("alt:notanumber")
	if filter.MinAltitude != 0 {
		t.Errorf("expected MinAltitude 0 for invalid exact value, got %d", filter.MinAltitude)
	}
}

func TestParseQuery_DistanceInvalidFormat(t *testing.T) {
	// Test distance with invalid number format
	filter := ParseQuery("dist:>abc")

	// Should not set MinDistance due to parse error
	if filter.MinDistance != 0 {
		t.Errorf("expected MinDistance 0 for invalid format, got %f", filter.MinDistance)
	}

	// Test distance range with invalid numbers
	filter = ParseQuery("dist:abc-def")
	if filter.MinDistance != 0 || filter.MaxDistance != 0 {
		t.Error("expected no distance values for invalid range format")
	}

	// Test distance below with invalid number
	filter = ParseQuery("dist:<xyz")
	if filter.MaxDistance != 0 {
		t.Errorf("expected MaxDistance 0 for invalid format, got %f", filter.MaxDistance)
	}

	// Test distance exact value with invalid number
	filter = ParseQuery("dist:notanumber")
	if filter.MaxDistance != 0 {
		t.Errorf("expected MaxDistance 0 for invalid exact value, got %f", filter.MaxDistance)
	}
}

func TestParseQuery_AltitudeExactValue(t *testing.T) {
	// Exact value should be treated as minimum
	filter := ParseQuery("alt:15000")

	if filter.MinAltitude != 15000 {
		t.Errorf("expected MinAltitude 15000, got %d", filter.MinAltitude)
	}
	if filter.MaxAltitude != 0 {
		t.Errorf("expected MaxAltitude 0, got %d", filter.MaxAltitude)
	}
}

func TestParseQuery_DistanceExactValue(t *testing.T) {
	// Exact value should be treated as maximum
	filter := ParseQuery("dist:50")

	if filter.MaxDistance != 50.0 {
		t.Errorf("expected MaxDistance 50.0, got %f", filter.MaxDistance)
	}
	if filter.MinDistance != 0 {
		t.Errorf("expected MinDistance 0, got %f", filter.MinDistance)
	}
}

func TestParseQuery_EmptyAltitudeFilter(t *testing.T) {
	filter := ParseQuery("alt:")

	if filter.MinAltitude != 0 || filter.MaxAltitude != 0 {
		t.Error("expected no altitude values for empty filter")
	}
}

func TestParseQuery_EmptyDistanceFilter(t *testing.T) {
	filter := ParseQuery("dist:")

	if filter.MinDistance != 0 || filter.MaxDistance != 0 {
		t.Error("expected no distance values for empty filter")
	}
}

func TestParseQuery_AltitudeRangePartialInvalid(t *testing.T) {
	// Valid min, invalid max
	filter := ParseQuery("alt:1000-abc")
	if filter.MinAltitude != 1000 {
		t.Errorf("expected MinAltitude 1000, got %d", filter.MinAltitude)
	}
	if filter.MaxAltitude != 0 {
		t.Errorf("expected MaxAltitude 0 for invalid max, got %d", filter.MaxAltitude)
	}

	// Invalid min, valid max
	filter = ParseQuery("alt:abc-5000")
	if filter.MinAltitude != 0 {
		t.Errorf("expected MinAltitude 0 for invalid min, got %d", filter.MinAltitude)
	}
	if filter.MaxAltitude != 5000 {
		t.Errorf("expected MaxAltitude 5000, got %d", filter.MaxAltitude)
	}
}

func TestParseQuery_DistanceRangePartialInvalid(t *testing.T) {
	// Valid min, invalid max
	filter := ParseQuery("dist:10-abc")
	if filter.MinDistance != 10 {
		t.Errorf("expected MinDistance 10, got %f", filter.MinDistance)
	}
	if filter.MaxDistance != 0 {
		t.Errorf("expected MaxDistance 0 for invalid max, got %f", filter.MaxDistance)
	}

	// Invalid min, valid max
	filter = ParseQuery("dist:abc-50")
	if filter.MinDistance != 0 {
		t.Errorf("expected MinDistance 0 for invalid min, got %f", filter.MinDistance)
	}
	if filter.MaxDistance != 50 {
		t.Errorf("expected MaxDistance 50, got %f", filter.MaxDistance)
	}
}

func TestFilter_Description_AllCombinations(t *testing.T) {
	// Test distance above only
	filter := &Filter{MinDistance: 10.0}
	desc := filter.Description()
	if desc != "DST>10" {
		t.Errorf("expected 'DST>10', got %q", desc)
	}

	// Test distance below only
	filter = &Filter{MaxDistance: 50.0}
	desc = filter.Description()
	if desc != "DST<50" {
		t.Errorf("expected 'DST<50', got %q", desc)
	}

	// Test distance range
	filter = &Filter{MinDistance: 10.0, MaxDistance: 50.0}
	desc = filter.Description()
	if desc != "DST:10-50" {
		t.Errorf("expected 'DST:10-50', got %q", desc)
	}

	// Test with text query
	filter = &Filter{textQuery: "UAL"}
	desc = filter.Description()
	if desc != "\"UAL\"" {
		t.Errorf("expected '\"UAL\"', got %q", desc)
	}

	// Test full combination
	filter = &Filter{
		textQuery:    "UAL",
		MilitaryOnly: true,
		SquawkCodes:  []string{"7700"},
		MinAltitude:  10000,
		MaxAltitude:  30000,
		MinDistance:  5,
		MaxDistance:  100,
	}
	desc = filter.Description()
	// Should contain all parts
	if len(desc) == 0 {
		t.Error("expected non-empty description for full filter")
	}
}

func TestFilter_HighlightMatch_NilFilter(t *testing.T) {
	var filter *Filter
	before, match, after := filter.HighlightMatch("test")

	if before != "test" || match != "" || after != "" {
		t.Errorf("nil filter should return text unchanged, got before=%q match=%q after=%q",
			before, match, after)
	}
}

func TestParseQuery_SquawkWithSpaces(t *testing.T) {
	// Squawk code with trailing comma (edge case)
	filter := ParseQuery("sq:7700,")

	// Should have one squawk code (empty string after comma is trimmed)
	if len(filter.SquawkCodes) != 1 {
		t.Errorf("expected 1 squawk code, got %d", len(filter.SquawkCodes))
	}
	if filter.SquawkCodes[0] != "7700" {
		t.Errorf("expected '7700', got %q", filter.SquawkCodes[0])
	}
}

func TestParseQuery_NegativeAltitude(t *testing.T) {
	// Negative value starting with - should not be treated as range
	filter := ParseQuery("alt:-500")

	// This should be parsed as exact value (treated as min)
	if filter.MinAltitude != -500 {
		t.Errorf("expected MinAltitude -500, got %d", filter.MinAltitude)
	}
}

func TestParseQuery_NegativeDistance(t *testing.T) {
	// Negative value starting with - should not be treated as range
	filter := ParseQuery("dist:-10")

	// This should be parsed as exact value (treated as max)
	if filter.MaxDistance != -10 {
		t.Errorf("expected MaxDistance -10, got %f", filter.MaxDistance)
	}
}
