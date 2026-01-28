// Package search provides search and filter functionality for aircraft
package search

import (
	"strconv"
	"strings"

	"github.com/skyspy/skyspy-go/internal/radar"
)

// Filter represents search/filter criteria for aircraft
type Filter struct {
	Query       string
	MilitaryOnly bool
	MinAltitude  int
	MaxAltitude  int
	MinDistance  float64
	MaxDistance  float64
	SquawkCodes  []string
	textQuery    string // Plain text portion of query for callsign/hex matching
}

// EmergencySquawks contains the standard emergency squawk codes
var EmergencySquawks = []string{"7500", "7600", "7700"}

// PresetAllAircraft returns a filter that matches all aircraft (no filtering)
func PresetAllAircraft() *Filter {
	return &Filter{}
}

// PresetMilitaryOnly returns a filter for military aircraft only
func PresetMilitaryOnly() *Filter {
	return &Filter{
		Query:       "mil",
		MilitaryOnly: true,
	}
}

// PresetEmergencies returns a filter for aircraft with emergency squawks
func PresetEmergencies() *Filter {
	return &Filter{
		Query:       "sq:7500,7600,7700",
		SquawkCodes: EmergencySquawks,
	}
}

// PresetLowAltitude returns a filter for aircraft below 10000ft
func PresetLowAltitude() *Filter {
	return &Filter{
		Query:       "alt:<10000",
		MaxAltitude: 10000,
	}
}

// ParseQuery parses a search query string into a Filter
// Supported syntax:
//   - Plain text: matches callsign or hex code
//   - "sq:7700" or "sq:7500,7600,7700": matches squawk codes
//   - "alt:>10000": minimum altitude filter
//   - "alt:<10000": maximum altitude filter
//   - "alt:5000-10000": altitude range
//   - "dist:<50": maximum distance filter
//   - "dist:>10": minimum distance filter
//   - "dist:10-50": distance range
//   - "mil": military only
func ParseQuery(query string) *Filter {
	f := &Filter{
		Query: query,
	}

	if query == "" {
		return f
	}

	// Split query into tokens
	tokens := strings.Fields(query)
	var textParts []string

	for _, token := range tokens {
		tokenLower := strings.ToLower(token)

		// Handle "mil" keyword
		if tokenLower == "mil" {
			f.MilitaryOnly = true
			continue
		}

		// Handle squawk filter: sq:7700 or sq:7500,7600,7700
		if strings.HasPrefix(tokenLower, "sq:") {
			squawkPart := token[3:]
			squawks := strings.Split(squawkPart, ",")
			for _, sq := range squawks {
				sq = strings.TrimSpace(sq)
				if sq != "" {
					f.SquawkCodes = append(f.SquawkCodes, sq)
				}
			}
			continue
		}

		// Handle altitude filter: alt:>10000, alt:<10000, alt:5000-10000
		if strings.HasPrefix(tokenLower, "alt:") {
			altPart := token[4:]
			parseAltitudeFilter(altPart, f)
			continue
		}

		// Handle distance filter: dist:<50, dist:>10, dist:10-50
		if strings.HasPrefix(tokenLower, "dist:") {
			distPart := token[5:]
			parseDistanceFilter(distPart, f)
			continue
		}

		// Otherwise, treat as text query for callsign/hex matching
		textParts = append(textParts, token)
	}

	f.textQuery = strings.ToUpper(strings.Join(textParts, " "))
	return f
}

// parseAltitudeFilter parses altitude filter syntax
func parseAltitudeFilter(s string, f *Filter) {
	s = strings.TrimSpace(s)
	if s == "" {
		return
	}

	// Range: 5000-10000
	if strings.Contains(s, "-") && !strings.HasPrefix(s, "-") {
		parts := strings.SplitN(s, "-", 2)
		if len(parts) == 2 {
			if min, err := strconv.Atoi(parts[0]); err == nil {
				f.MinAltitude = min
			}
			if max, err := strconv.Atoi(parts[1]); err == nil {
				f.MaxAltitude = max
			}
		}
		return
	}

	// Greater than: >10000
	if strings.HasPrefix(s, ">") {
		if val, err := strconv.Atoi(s[1:]); err == nil {
			f.MinAltitude = val
		}
		return
	}

	// Less than: <10000
	if strings.HasPrefix(s, "<") {
		if val, err := strconv.Atoi(s[1:]); err == nil {
			f.MaxAltitude = val
		}
		return
	}

	// Exact value treated as minimum
	if val, err := strconv.Atoi(s); err == nil {
		f.MinAltitude = val
	}
}

// parseDistanceFilter parses distance filter syntax
func parseDistanceFilter(s string, f *Filter) {
	s = strings.TrimSpace(s)
	if s == "" {
		return
	}

	// Range: 10-50
	if strings.Contains(s, "-") && !strings.HasPrefix(s, "-") {
		parts := strings.SplitN(s, "-", 2)
		if len(parts) == 2 {
			if min, err := strconv.ParseFloat(parts[0], 64); err == nil {
				f.MinDistance = min
			}
			if max, err := strconv.ParseFloat(parts[1], 64); err == nil {
				f.MaxDistance = max
			}
		}
		return
	}

	// Greater than: >10
	if strings.HasPrefix(s, ">") {
		if val, err := strconv.ParseFloat(s[1:], 64); err == nil {
			f.MinDistance = val
		}
		return
	}

	// Less than: <50
	if strings.HasPrefix(s, "<") {
		if val, err := strconv.ParseFloat(s[1:], 64); err == nil {
			f.MaxDistance = val
		}
		return
	}

	// Exact value treated as maximum
	if val, err := strconv.ParseFloat(s, 64); err == nil {
		f.MaxDistance = val
	}
}

// MatchesAircraft returns true if the aircraft matches the filter criteria
func MatchesAircraft(aircraft *radar.Target, filter *Filter) bool {
	if filter == nil {
		return true
	}

	// Military only filter
	if filter.MilitaryOnly && !aircraft.Military {
		return false
	}

	// Altitude filters
	if filter.MinAltitude > 0 {
		if !aircraft.HasAlt || aircraft.Altitude < filter.MinAltitude {
			return false
		}
	}
	if filter.MaxAltitude > 0 {
		if !aircraft.HasAlt || aircraft.Altitude > filter.MaxAltitude {
			return false
		}
	}

	// Distance filters
	if filter.MinDistance > 0 {
		if aircraft.Distance < filter.MinDistance {
			return false
		}
	}
	if filter.MaxDistance > 0 {
		if aircraft.Distance > filter.MaxDistance {
			return false
		}
	}

	// Squawk code filter
	if len(filter.SquawkCodes) > 0 {
		found := false
		for _, sq := range filter.SquawkCodes {
			if strings.EqualFold(aircraft.Squawk, sq) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// Text query filter (callsign or hex)
	if filter.textQuery != "" {
		callsignUpper := strings.ToUpper(strings.TrimSpace(aircraft.Callsign))
		hexUpper := strings.ToUpper(aircraft.Hex)

		if !strings.Contains(callsignUpper, filter.textQuery) &&
			!strings.Contains(hexUpper, filter.textQuery) {
			return false
		}
	}

	return true
}

// IsActive returns true if the filter has any active criteria
func (f *Filter) IsActive() bool {
	if f == nil {
		return false
	}
	return f.MilitaryOnly ||
		f.MinAltitude > 0 ||
		f.MaxAltitude > 0 ||
		f.MinDistance > 0 ||
		f.MaxDistance > 0 ||
		len(f.SquawkCodes) > 0 ||
		f.textQuery != ""
}

// Description returns a human-readable description of the active filter
func (f *Filter) Description() string {
	if f == nil || !f.IsActive() {
		return ""
	}

	var parts []string

	if f.textQuery != "" {
		parts = append(parts, "\""+f.textQuery+"\"")
	}
	if f.MilitaryOnly {
		parts = append(parts, "MIL")
	}
	if len(f.SquawkCodes) > 0 {
		parts = append(parts, "SQ:"+strings.Join(f.SquawkCodes, ","))
	}
	if f.MinAltitude > 0 && f.MaxAltitude > 0 {
		parts = append(parts, "ALT:"+strconv.Itoa(f.MinAltitude)+"-"+strconv.Itoa(f.MaxAltitude))
	} else if f.MinAltitude > 0 {
		parts = append(parts, "ALT>"+strconv.Itoa(f.MinAltitude))
	} else if f.MaxAltitude > 0 {
		parts = append(parts, "ALT<"+strconv.Itoa(f.MaxAltitude))
	}
	if f.MinDistance > 0 && f.MaxDistance > 0 {
		parts = append(parts, "DST:"+strconv.FormatFloat(f.MinDistance, 'f', 0, 64)+"-"+strconv.FormatFloat(f.MaxDistance, 'f', 0, 64))
	} else if f.MinDistance > 0 {
		parts = append(parts, "DST>"+strconv.FormatFloat(f.MinDistance, 'f', 0, 64))
	} else if f.MaxDistance > 0 {
		parts = append(parts, "DST<"+strconv.FormatFloat(f.MaxDistance, 'f', 0, 64))
	}

	return strings.Join(parts, " ")
}

// HighlightMatch returns the portions of text that match the query
// Returns (beforeMatch, match, afterMatch) for highlighting
func (f *Filter) HighlightMatch(text string) (string, string, string) {
	if f == nil || f.textQuery == "" {
		return text, "", ""
	}

	textUpper := strings.ToUpper(text)
	idx := strings.Index(textUpper, f.textQuery)
	if idx == -1 {
		return text, "", ""
	}

	return text[:idx], text[idx : idx+len(f.textQuery)], text[idx+len(f.textQuery):]
}

// FilterAircraft filters a map of aircraft and returns the hexes of matching aircraft
func FilterAircraft(aircraft map[string]*radar.Target, filter *Filter) []string {
	var results []string
	for hex, ac := range aircraft {
		if MatchesAircraft(ac, filter) {
			results = append(results, hex)
		}
	}
	return results
}
