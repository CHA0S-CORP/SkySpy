// Package alerts provides configurable alert rules for aircraft monitoring
package alerts

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// GeofenceType represents the type of geofence
type GeofenceType string

const (
	GeofencePolygon GeofenceType = "polygon"
	GeofenceCircle  GeofenceType = "circle"
)

// GeofencePoint represents a coordinate point
type GeofencePoint struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// Geofence represents a geographic boundary
type Geofence struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Type        GeofenceType    `json:"type"`
	Points      []GeofencePoint `json:"points,omitempty"`      // For polygon
	Center      *GeofencePoint  `json:"center,omitempty"`      // For circle
	RadiusNM    float64         `json:"radius_nm,omitempty"`   // For circle (nautical miles)
	Enabled     bool            `json:"enabled"`
	Description string          `json:"description,omitempty"`
}

// NewPolygonGeofence creates a new polygon geofence
func NewPolygonGeofence(id, name string, points []GeofencePoint) *Geofence {
	return &Geofence{
		ID:      id,
		Name:    name,
		Type:    GeofencePolygon,
		Points:  points,
		Enabled: true,
	}
}

// NewCircleGeofence creates a new circular geofence
func NewCircleGeofence(id, name string, centerLat, centerLon, radiusNM float64) *Geofence {
	return &Geofence{
		ID:       id,
		Name:     name,
		Type:     GeofenceCircle,
		Center:   &GeofencePoint{Lat: centerLat, Lon: centerLon},
		RadiusNM: radiusNM,
		Enabled:  true,
	}
}

// Contains checks if a point is inside the geofence
func (g *Geofence) Contains(lat, lon float64) bool {
	if !g.Enabled {
		return false
	}

	switch g.Type {
	case GeofenceCircle:
		return g.containsCircle(lat, lon)
	case GeofencePolygon:
		return g.containsPolygon(lat, lon)
	default:
		return false
	}
}

// containsCircle checks if a point is within the circular geofence
func (g *Geofence) containsCircle(lat, lon float64) bool {
	if g.Center == nil {
		return false
	}

	distance := haversineDistanceNM(g.Center.Lat, g.Center.Lon, lat, lon)
	return distance <= g.RadiusNM
}

// containsPolygon checks if a point is within the polygon geofence
// Uses ray casting algorithm
func (g *Geofence) containsPolygon(lat, lon float64) bool {
	if len(g.Points) < 3 {
		return false
	}

	n := len(g.Points)
	inside := false

	j := n - 1
	for i := 0; i < n; i++ {
		xi, yi := g.Points[i].Lat, g.Points[i].Lon
		xj, yj := g.Points[j].Lat, g.Points[j].Lon

		if ((yi > lon) != (yj > lon)) &&
			(lat < (xj-xi)*(lon-yi)/(yj-yi)+xi) {
			inside = !inside
		}
		j = i
	}

	return inside
}

// GetBoundingBox returns the bounding box of the geofence
func (g *Geofence) GetBoundingBox() (minLat, minLon, maxLat, maxLon float64) {
	switch g.Type {
	case GeofenceCircle:
		if g.Center == nil {
			return 0, 0, 0, 0
		}
		// Approximate bounding box for circle
		// 1 degree latitude = ~60 nm, 1 degree longitude varies
		latDelta := g.RadiusNM / 60.0
		lonDelta := g.RadiusNM / (60.0 * math.Cos(g.Center.Lat*math.Pi/180))
		return g.Center.Lat - latDelta, g.Center.Lon - lonDelta,
			g.Center.Lat + latDelta, g.Center.Lon + lonDelta

	case GeofencePolygon:
		if len(g.Points) == 0 {
			return 0, 0, 0, 0
		}
		minLat, minLon = g.Points[0].Lat, g.Points[0].Lon
		maxLat, maxLon = g.Points[0].Lat, g.Points[0].Lon
		for _, p := range g.Points {
			if p.Lat < minLat {
				minLat = p.Lat
			}
			if p.Lat > maxLat {
				maxLat = p.Lat
			}
			if p.Lon < minLon {
				minLon = p.Lon
			}
			if p.Lon > maxLon {
				maxLon = p.Lon
			}
		}
		return minLat, minLon, maxLat, maxLon
	}

	return 0, 0, 0, 0
}

// haversineDistanceNM calculates the distance in nautical miles between two points
func haversineDistanceNM(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 3440.065 // Earth radius in nautical miles

	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return R * c
}

// GeofenceManager manages a collection of geofences
type GeofenceManager struct {
	geofences map[string]*Geofence
	order     []string
}

// NewGeofenceManager creates a new geofence manager
func NewGeofenceManager() *GeofenceManager {
	return &GeofenceManager{
		geofences: make(map[string]*Geofence),
		order:     []string{},
	}
}

// AddGeofence adds a geofence to the manager
func (m *GeofenceManager) AddGeofence(geofence *Geofence) {
	if _, exists := m.geofences[geofence.ID]; !exists {
		m.order = append(m.order, geofence.ID)
	}
	m.geofences[geofence.ID] = geofence
}

// RemoveGeofence removes a geofence by ID
func (m *GeofenceManager) RemoveGeofence(id string) bool {
	if _, exists := m.geofences[id]; !exists {
		return false
	}
	delete(m.geofences, id)
	for i, gid := range m.order {
		if gid == id {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	return true
}

// GetGeofence returns a geofence by ID
func (m *GeofenceManager) GetGeofence(id string) *Geofence {
	return m.geofences[id]
}

// GetAllGeofences returns all geofences in order
func (m *GeofenceManager) GetAllGeofences() []*Geofence {
	result := make([]*Geofence, 0, len(m.order))
	for _, id := range m.order {
		if gf, exists := m.geofences[id]; exists {
			result = append(result, gf)
		}
	}
	return result
}

// GetEnabledGeofences returns only enabled geofences
func (m *GeofenceManager) GetEnabledGeofences() []*Geofence {
	var result []*Geofence
	for _, id := range m.order {
		if gf, exists := m.geofences[id]; exists && gf.Enabled {
			result = append(result, gf)
		}
	}
	return result
}

// ToggleGeofence toggles a geofence's enabled state
func (m *GeofenceManager) ToggleGeofence(id string) bool {
	if gf, exists := m.geofences[id]; exists {
		gf.Enabled = !gf.Enabled
		return gf.Enabled
	}
	return false
}

// CheckPoint checks if a point is inside any enabled geofence
func (m *GeofenceManager) CheckPoint(lat, lon float64) []*Geofence {
	var result []*Geofence
	for _, gf := range m.GetEnabledGeofences() {
		if gf.Contains(lat, lon) {
			result = append(result, gf)
		}
	}
	return result
}

// CheckEntering checks if an aircraft has entered any geofence
// (was outside in prevState, now inside in currentState)
func (m *GeofenceManager) CheckEntering(prevLat, prevLon, currLat, currLon float64) []*Geofence {
	var entered []*Geofence
	for _, gf := range m.GetEnabledGeofences() {
		wasInside := gf.Contains(prevLat, prevLon)
		isInside := gf.Contains(currLat, currLon)
		if !wasInside && isInside {
			entered = append(entered, gf)
		}
	}
	return entered
}

// Count returns the number of geofences
func (m *GeofenceManager) Count() int {
	return len(m.geofences)
}

// LoadGeofencesFromFile loads geofences from a JSON file
func LoadGeofencesFromFile(path string) ([]*Geofence, error) {
	path = os.ExpandEnv(path)
	if strings.HasPrefix(path, "~") {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, path[1:])
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var geofences []*Geofence
	if err := json.Unmarshal(data, &geofences); err != nil {
		// Try loading as a single geofence
		var single Geofence
		if err := json.Unmarshal(data, &single); err != nil {
			return nil, err
		}
		geofences = []*Geofence{&single}
	}

	return geofences, nil
}

// SaveGeofencesToFile saves geofences to a JSON file
func SaveGeofencesToFile(path string, geofences []*Geofence) error {
	path = os.ExpandEnv(path)
	if strings.HasPrefix(path, "~") {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, path[1:])
	}

	data, err := json.MarshalIndent(geofences, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

// LoadGeofenceFromGeoJSON loads a geofence from a GeoJSON file
func LoadGeofenceFromGeoJSON(path string) (*Geofence, error) {
	path = os.ExpandEnv(path)
	if strings.HasPrefix(path, "~") {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, path[1:])
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	geofence := &Geofence{
		ID:      filepath.Base(path),
		Name:    filepath.Base(path),
		Enabled: true,
	}

	// Extract name from properties if available
	if name, ok := raw["name"].(string); ok {
		geofence.Name = name
		geofence.ID = strings.ToLower(strings.ReplaceAll(name, " ", "_"))
	}

	// Handle FeatureCollection
	if features, ok := raw["features"].([]interface{}); ok && len(features) > 0 {
		// Use first feature
		if feature, ok := features[0].(map[string]interface{}); ok {
			if props, ok := feature["properties"].(map[string]interface{}); ok {
				if name, ok := props["name"].(string); ok {
					geofence.Name = name
					geofence.ID = strings.ToLower(strings.ReplaceAll(name, " ", "_"))
				}
			}
			if geom, ok := feature["geometry"].(map[string]interface{}); ok {
				parseGeometry(geofence, geom)
			}
		}
	} else if geomType, ok := raw["type"].(string); ok && geomType == "Feature" {
		// Single Feature
		if geom, ok := raw["geometry"].(map[string]interface{}); ok {
			parseGeometry(geofence, geom)
		}
	} else if geomType, ok := raw["type"].(string); ok {
		// Direct geometry
		parseGeometry(geofence, raw)
		_ = geomType
	}

	return geofence, nil
}

func parseGeometry(geofence *Geofence, geom map[string]interface{}) {
	geomType, _ := geom["type"].(string)
	coords, _ := geom["coordinates"].([]interface{})

	switch geomType {
	case "Polygon":
		geofence.Type = GeofencePolygon
		if len(coords) > 0 {
			// Outer ring
			if ring, ok := coords[0].([]interface{}); ok {
				for _, coord := range ring {
					if c, ok := coord.([]interface{}); ok && len(c) >= 2 {
						lon, _ := c[0].(float64)
						lat, _ := c[1].(float64)
						geofence.Points = append(geofence.Points, GeofencePoint{Lat: lat, Lon: lon})
					}
				}
			}
		}

	case "Point":
		// Create a small circular geofence around the point
		if len(coords) >= 2 {
			lon, _ := coords[0].(float64)
			lat, _ := coords[1].(float64)
			geofence.Type = GeofenceCircle
			geofence.Center = &GeofencePoint{Lat: lat, Lon: lon}
			geofence.RadiusNM = 5 // Default 5nm radius for point geofences
		}
	}
}

// CreateDefaultGeofences creates some example geofences
func CreateDefaultGeofences() []*Geofence {
	geofences := []*Geofence{}

	// Example: Home area (10nm radius) - users should customize
	home := NewCircleGeofence("home_area", "Home Area", 0, 0, 10)
	home.Enabled = false // Disabled by default since coordinates are 0,0
	home.Description = "Alert when aircraft enter home area"
	geofences = append(geofences, home)

	return geofences
}
