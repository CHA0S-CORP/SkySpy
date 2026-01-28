// Package geo provides geographic overlay support for SkySpy radar display
package geo

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// OverlayType represents the type of geographic feature
type OverlayType int

const (
	OverlayPolygon OverlayType = iota
	OverlayLine
	OverlayPoint
	OverlayCircle
)

// GeoPoint represents a geographic coordinate
type GeoPoint struct {
	Lat   float64
	Lon   float64
	Label string
}

// GeoFeature represents a geographic feature (polygon, line, or point)
type GeoFeature struct {
	Type       OverlayType
	Points     []GeoPoint
	Properties map[string]interface{}
	Name       string
	Style      string
}

// GeoOverlay represents a collection of geographic features
type GeoOverlay struct {
	Name       string
	Features   []GeoFeature
	Enabled    bool
	Color      string
	Opacity    float64
	SourceFile string
}

// RenderPoint represents a point to render on the radar
type RenderPoint struct {
	X     int
	Y     int
	Char  rune
	Color string
}

// OverlayManager manages loaded overlays
type OverlayManager struct {
	overlays     map[string]*GeoOverlay
	overlayOrder []string
}

// NewOverlayManager creates a new overlay manager
func NewOverlayManager() *OverlayManager {
	return &OverlayManager{
		overlays:     make(map[string]*GeoOverlay),
		overlayOrder: []string{},
	}
}

// AddOverlay adds an overlay with an optional key
func (m *OverlayManager) AddOverlay(overlay *GeoOverlay, key string) string {
	if key == "" {
		key = strings.ToLower(strings.ReplaceAll(overlay.Name, " ", "_"))
	}
	baseKey := key
	counter := 1
	for _, exists := m.overlays[key]; exists; _, exists = m.overlays[key] {
		key = fmt.Sprintf("%s_%d", baseKey, counter)
		counter++
	}

	m.overlays[key] = overlay
	m.overlayOrder = append(m.overlayOrder, key)
	return key
}

// RemoveOverlay removes an overlay by key
func (m *OverlayManager) RemoveOverlay(key string) bool {
	if _, exists := m.overlays[key]; !exists {
		return false
	}
	delete(m.overlays, key)
	for i, k := range m.overlayOrder {
		if k == key {
			m.overlayOrder = append(m.overlayOrder[:i], m.overlayOrder[i+1:]...)
			break
		}
	}
	return true
}

// ToggleOverlay toggles an overlay's enabled state
func (m *OverlayManager) ToggleOverlay(key string) bool {
	if overlay, exists := m.overlays[key]; exists {
		overlay.Enabled = !overlay.Enabled
		return overlay.Enabled
	}
	return false
}

// SetOverlayColor sets an overlay's color
func (m *OverlayManager) SetOverlayColor(key, color string) {
	if overlay, exists := m.overlays[key]; exists {
		overlay.Color = color
	}
}

// GetEnabledOverlays returns all enabled overlays in render order
func (m *OverlayManager) GetEnabledOverlays() []*GeoOverlay {
	var result []*GeoOverlay
	for _, key := range m.overlayOrder {
		if overlay, exists := m.overlays[key]; exists && overlay.Enabled {
			result = append(result, overlay)
		}
	}
	return result
}

// LoadFromFile loads an overlay from file and adds it
func (m *OverlayManager) LoadFromFile(filepath string) (string, error) {
	overlay, err := LoadOverlay(filepath)
	if err != nil {
		return "", err
	}
	return m.AddOverlay(overlay, ""), nil
}

// OverlayInfo contains overlay metadata
type OverlayInfo struct {
	Key     string
	Name    string
	Enabled bool
}

// GetOverlayList returns list of all overlays
func (m *OverlayManager) GetOverlayList() []OverlayInfo {
	var result []OverlayInfo
	for _, key := range m.overlayOrder {
		if overlay, exists := m.overlays[key]; exists {
			result = append(result, OverlayInfo{
				Key:     key,
				Name:    overlay.Name,
				Enabled: overlay.Enabled,
			})
		}
	}
	return result
}

// ToConfig exports overlay configuration for saving
func (m *OverlayManager) ToConfig() []map[string]interface{} {
	var config []map[string]interface{}
	for _, key := range m.overlayOrder {
		if overlay, exists := m.overlays[key]; exists {
			item := map[string]interface{}{
				"key":         key,
				"name":        overlay.Name,
				"source_file": overlay.SourceFile,
				"enabled":     overlay.Enabled,
			}
			if overlay.Color != "" {
				item["color"] = overlay.Color
			}
			config = append(config, item)
		}
	}
	return config
}

// Count returns the number of overlays
func (m *OverlayManager) Count() int {
	return len(m.overlays)
}

// LoadOverlay loads an overlay from file (auto-detect format)
func LoadOverlay(path string) (*GeoOverlay, error) {
	path = os.ExpandEnv(path)
	if strings.HasPrefix(path, "~") {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, path[1:])
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, fmt.Errorf("file not found: %s", path)
	}

	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".geojson", ".json":
		return loadGeoJSON(path)
	case ".shp":
		return ParseShapefile(path)
	case ".kml":
		return ParseKML(path)
	case ".kmz":
		return ParseKMZ(path)
	default:
		// Try to detect format by attempting each parser
		// Try GeoJSON first (most common)
		if overlay, err := loadGeoJSON(path); err == nil {
			return overlay, nil
		}
		// Try KML
		if overlay, err := ParseKML(path); err == nil {
			return overlay, nil
		}
		// Try Shapefile
		if overlay, err := ParseShapefile(path); err == nil {
			return overlay, nil
		}
		return nil, fmt.Errorf("unable to detect overlay format for: %s (supported: .geojson, .json, .shp, .kml, .kmz)", path)
	}
}

// loadGeoJSON loads a GeoJSON file
func loadGeoJSON(path string) (*GeoOverlay, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	overlay := &GeoOverlay{
		Name:       filepath.Base(path),
		Enabled:    true,
		Opacity:    1.0,
		SourceFile: path,
	}

	if name, ok := raw["name"].(string); ok {
		overlay.Name = name
	}

	var geojsonFeatures []interface{}

	if features, ok := raw["features"].([]interface{}); ok {
		geojsonFeatures = features
	} else if geoType, ok := raw["type"].(string); ok {
		// Single geometry
		if geoType == "Polygon" || geoType == "LineString" || geoType == "Point" ||
			geoType == "MultiPolygon" || geoType == "MultiLineString" {
			geojsonFeatures = []interface{}{
				map[string]interface{}{
					"type":       "Feature",
					"geometry":   raw,
					"properties": map[string]interface{}{},
				},
			}
		}
	}

	for _, feat := range geojsonFeatures {
		if feature, ok := feat.(map[string]interface{}); ok {
			geoFeatures := parseGeoJSONFeature(feature)
			overlay.Features = append(overlay.Features, geoFeatures...)
		}
	}

	return overlay, nil
}

func parseGeoJSONFeature(feature map[string]interface{}) []GeoFeature {
	var result []GeoFeature

	geometry, ok := feature["geometry"].(map[string]interface{})
	if !ok {
		return result
	}

	properties, _ := feature["properties"].(map[string]interface{})
	if properties == nil {
		properties = make(map[string]interface{})
	}

	geoType, _ := geometry["type"].(string)
	coords, _ := geometry["coordinates"].([]interface{})

	name := ""
	for _, key := range []string{"name", "NAME", "Name", "id"} {
		if n, ok := properties[key].(string); ok {
			name = n
			break
		}
	}

	switch geoType {
	case "Point":
		if len(coords) >= 2 {
			lon, _ := coords[0].(float64)
			lat, _ := coords[1].(float64)
			result = append(result, GeoFeature{
				Type:       OverlayPoint,
				Points:     []GeoPoint{{Lat: lat, Lon: lon, Label: name}},
				Properties: properties,
				Name:       name,
			})
		}

	case "LineString":
		points := parseCoordinates(coords)
		if len(points) > 0 {
			result = append(result, GeoFeature{
				Type:       OverlayLine,
				Points:     points,
				Properties: properties,
				Name:       name,
			})
		}

	case "Polygon":
		if len(coords) > 0 {
			outerRing, _ := coords[0].([]interface{})
			points := parseCoordinates(outerRing)
			if len(points) > 0 {
				result = append(result, GeoFeature{
					Type:       OverlayPolygon,
					Points:     points,
					Properties: properties,
					Name:       name,
				})
			}
		}

	case "MultiPolygon":
		for _, polygon := range coords {
			if poly, ok := polygon.([]interface{}); ok && len(poly) > 0 {
				outerRing, _ := poly[0].([]interface{})
				points := parseCoordinates(outerRing)
				if len(points) > 0 {
					result = append(result, GeoFeature{
						Type:       OverlayPolygon,
						Points:     points,
						Properties: properties,
						Name:       name,
					})
				}
			}
		}

	case "MultiLineString":
		for _, line := range coords {
			if lineCoords, ok := line.([]interface{}); ok {
				points := parseCoordinates(lineCoords)
				if len(points) > 0 {
					result = append(result, GeoFeature{
						Type:       OverlayLine,
						Points:     points,
						Properties: properties,
						Name:       name,
					})
				}
			}
		}
	}

	return result
}

func parseCoordinates(coords []interface{}) []GeoPoint {
	var points []GeoPoint
	for _, coord := range coords {
		if c, ok := coord.([]interface{}); ok && len(c) >= 2 {
			lon, _ := c[0].(float64)
			lat, _ := c[1].(float64)
			points = append(points, GeoPoint{Lat: lat, Lon: lon})
		}
	}
	return points
}


// HaversineDistance calculates distance in nautical miles between two points
func HaversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 3440.065 // Earth radius in nm
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	return R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// BearingBetween calculates bearing from point 1 to point 2
func BearingBetween(lat1, lon1, lat2, lon2 float64) float64 {
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	y := math.Sin(deltaLon) * math.Cos(lat2Rad)
	x := math.Cos(lat1Rad)*math.Sin(lat2Rad) - math.Sin(lat1Rad)*math.Cos(lat2Rad)*math.Cos(deltaLon)
	bearing := math.Atan2(y, x) * 180 / math.Pi
	return math.Mod(bearing+360, 360)
}

// DestinationPoint calculates destination point given start, bearing, and distance
func DestinationPoint(lat, lon, bearing, distanceNM float64) (float64, float64) {
	const R = 3440.065 // Earth radius in nm

	latRad := lat * math.Pi / 180
	lonRad := lon * math.Pi / 180
	bearingRad := bearing * math.Pi / 180

	d := distanceNM / R

	lat2 := math.Asin(
		math.Sin(latRad)*math.Cos(d) +
			math.Cos(latRad)*math.Sin(d)*math.Cos(bearingRad))

	lon2 := lonRad + math.Atan2(
		math.Sin(bearingRad)*math.Sin(d)*math.Cos(latRad),
		math.Cos(d)-math.Sin(latRad)*math.Sin(lat2))

	return lat2 * 180 / math.Pi, lon2 * 180 / math.Pi
}

// GeoToRadar converts distance/bearing to radar screen coordinates
func GeoToRadar(distance, bearing, maxRange float64, centerX, centerY, maxRadius int) (int, int) {
	if distance > maxRange {
		distance = maxRange
	}

	radius := (distance / maxRange) * float64(maxRadius)
	angleRad := (bearing - 90) * math.Pi / 180 // 0° = North = up

	x := centerX + int(radius*math.Cos(angleRad)*2) // *2 for char aspect ratio
	y := centerY + int(radius*math.Sin(angleRad))

	return x, y
}

// BresenhamLine generates points along a line using Bresenham's algorithm
func BresenhamLine(x1, y1, x2, y2 int) [][2]int {
	var points [][2]int

	dx := abs(x2 - x1)
	dy := abs(y2 - y1)
	sx := 1
	if x1 >= x2 {
		sx = -1
	}
	sy := 1
	if y1 >= y2 {
		sy = -1
	}
	err := dx - dy

	const maxPoints = 200
	count := 0

	for count < maxPoints {
		points = append(points, [2]int{x1, y1})
		count++

		if x1 == x2 && y1 == y2 {
			break
		}

		e2 := 2 * err
		if e2 > -dy {
			err -= dy
			x1 += sx
		}
		if e2 < dx {
			err += dx
			y1 += sy
		}
	}

	return points
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// RenderOverlayToRadar renders an overlay to radar coordinates
func RenderOverlayToRadar(overlay *GeoOverlay, centerLat, centerLon, maxRange float64,
	radarWidth, radarHeight int, themeColor string) []RenderPoint {
	var points []RenderPoint

	color := overlay.Color
	if color == "" {
		color = themeColor
	}

	centerX := radarWidth / 2
	centerY := radarHeight / 2
	maxRadius := min(radarWidth/2, radarHeight) - 1

	for _, feature := range overlay.Features {
		switch feature.Type {
		case OverlayPoint:
			for _, point := range feature.Points {
				dist := HaversineDistance(centerLat, centerLon, point.Lat, point.Lon)
				if dist <= maxRange {
					brg := BearingBetween(centerLat, centerLon, point.Lat, point.Lon)
					x, y := GeoToRadar(dist, brg, maxRange, centerX, centerY, maxRadius)
					if x >= 0 && x < radarWidth && y >= 0 && y < radarHeight {
						char := '◇'
						if point.Label != "" {
							char = rune(point.Label[0])
						}
						points = append(points, RenderPoint{X: x, Y: y, Char: char, Color: color})
					}
				}
			}

		case OverlayLine, OverlayPolygon:
			featurePoints := feature.Points
			if feature.Type == OverlayPolygon && len(featurePoints) > 0 {
				// Close polygon
				if featurePoints[0] != featurePoints[len(featurePoints)-1] {
					featurePoints = append(featurePoints, featurePoints[0])
				}
			}

			for i := 0; i < len(featurePoints)-1; i++ {
				p1, p2 := featurePoints[i], featurePoints[i+1]

				dist1 := HaversineDistance(centerLat, centerLon, p1.Lat, p1.Lon)
				dist2 := HaversineDistance(centerLat, centerLon, p2.Lat, p2.Lon)

				// Skip if both points are way out of range
				if dist1 > maxRange*1.5 && dist2 > maxRange*1.5 {
					continue
				}

				brg1 := BearingBetween(centerLat, centerLon, p1.Lat, p1.Lon)
				brg2 := BearingBetween(centerLat, centerLon, p2.Lat, p2.Lon)

				x1, y1 := GeoToRadar(dist1, brg1, maxRange, centerX, centerY, maxRadius)
				x2, y2 := GeoToRadar(dist2, brg2, maxRange, centerX, centerY, maxRadius)

				linePoints := BresenhamLine(x1, y1, x2, y2)
				for _, lp := range linePoints {
					if lp[0] >= 0 && lp[0] < radarWidth && lp[1] >= 0 && lp[1] < radarHeight {
						points = append(points, RenderPoint{X: lp[0], Y: lp[1], Char: '·', Color: color})
					}
				}
			}
		}
	}

	return points
}

// CreateRangeRingOverlay creates custom range rings as an overlay
func CreateRangeRingOverlay(centerLat, centerLon float64, ranges []float64, pointsPerRing int) *GeoOverlay {
	overlay := &GeoOverlay{
		Name:    "Range Rings",
		Enabled: true,
		Color:   "cyan",
	}

	for _, rangeNM := range ranges {
		var ringPoints []GeoPoint
		for i := 0; i <= pointsPerRing; i++ {
			bearing := float64(360/pointsPerRing) * float64(i)
			lat, lon := DestinationPoint(centerLat, centerLon, bearing, rangeNM)
			ringPoints = append(ringPoints, GeoPoint{Lat: lat, Lon: lon})
		}
		overlay.Features = append(overlay.Features, GeoFeature{
			Type:   OverlayLine,
			Points: ringPoints,
			Name:   fmt.Sprintf("%dnm ring", int(rangeNM)),
		})
	}

	return overlay
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
