// Package radar provides radar scope rendering functionality
package radar

import (
	"fmt"
	"math"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/skyspy/skyspy-go/internal/geo"
	"github.com/skyspy/skyspy-go/internal/theme"
)

// Radar dimensions
const (
	RadarWidth   = 55
	RadarHeight  = 27
	RadarCenterX = RadarWidth / 2
	RadarCenterY = RadarHeight / 2
)

// Target represents an aircraft target on the radar
type Target struct {
	Hex       string
	Callsign  string
	Lat       float64
	Lon       float64
	Altitude  int
	Speed     float64
	Track     float64
	Vertical  float64
	Distance  float64
	Bearing   float64
	RSSI      float64
	Squawk    string
	ACType    string
	Military  bool
	HasLat    bool
	HasLon    bool
	HasAlt    bool
	HasSpeed  bool
	HasTrack  bool
	HasVS     bool
	HasRSSI   bool
}

// IsEmergency returns true if the target has an emergency squawk
func (t *Target) IsEmergency() bool {
	return t.Squawk == "7500" || t.Squawk == "7600" || t.Squawk == "7700"
}

// cell represents a single radar cell with character and color
type cell struct {
	char  rune
	color lipgloss.Color
}

// Scope handles radar scope rendering
type Scope struct {
	cells      [][]cell
	theme      *theme.Theme
	maxRange   float64
	rangeRings int
	showCompass bool
}

// NewScope creates a new radar scope
func NewScope(t *theme.Theme, maxRange float64, rangeRings int, showCompass bool) *Scope {
	cells := make([][]cell, RadarHeight)
	for y := range cells {
		cells[y] = make([]cell, RadarWidth)
		for x := range cells[y] {
			cells[y][x] = cell{char: ' '}
		}
	}
	return &Scope{
		cells:      cells,
		theme:      t,
		maxRange:   maxRange,
		rangeRings: rangeRings,
		showCompass: showCompass,
	}
}

// Clear clears the radar display
func (s *Scope) Clear() {
	for y := range s.cells {
		for x := range s.cells[y] {
			s.cells[y][x] = cell{char: ' '}
		}
	}
}

// SetTheme updates the theme
func (s *Scope) SetTheme(t *theme.Theme) {
	s.theme = t
}

// SetRange updates the max range
func (s *Scope) SetRange(maxRange float64) {
	s.maxRange = maxRange
}

// SetRangeRings updates range ring count
func (s *Scope) SetRangeRings(rings int) {
	s.rangeRings = rings
}

// DrawRangeRings draws the range rings
func (s *Scope) DrawRangeRings() {
	cx, cy := RadarCenterX, RadarCenterY
	maxRadius := min(RadarWidth/2, RadarHeight) - 1

	for ring := 1; ring <= s.rangeRings; ring++ {
		ringRadius := float64(ring) / float64(s.rangeRings) * float64(maxRadius)
		for angle := 0; angle < 360; angle += 4 {
			angleRad := float64(angle) * math.Pi / 180
			x := int(float64(cx) + ringRadius*math.Cos(angleRad)*2)
			y := int(float64(cy) + ringRadius*math.Sin(angleRad))
			if x >= 0 && x < RadarWidth && y >= 0 && y < RadarHeight {
				if s.cells[y][x].char == ' ' {
					s.cells[y][x] = cell{char: '·', color: s.theme.RadarRing}
				}
			}
		}
	}
}

// DrawCompass draws the compass axes
func (s *Scope) DrawCompass() {
	if !s.showCompass {
		return
	}

	cx, cy := RadarCenterX, RadarCenterY
	maxRadius := min(RadarWidth/2, RadarHeight) - 1

	// Draw axes
	for i := 1; i < maxRadius; i++ {
		// Vertical (N-S)
		for _, dy := range []int{-i, i} {
			ny := cy + dy
			if ny >= 0 && ny < RadarHeight {
				s.cells[ny][cx] = cell{char: '│', color: s.theme.RadarRing}
			}
		}
		// Horizontal (E-W)
		for _, dx := range []int{-i * 2, i * 2} {
			nx := cx + dx
			if nx >= 0 && nx < RadarWidth {
				s.cells[cy][nx] = cell{char: '─', color: s.theme.RadarRing}
			}
		}
	}

	// Draw cardinal labels
	labels := []struct {
		label string
		dx, dy int
	}{
		{"N", 0, -maxRadius},
		{"S", 0, maxRadius},
		{"E", maxRadius * 2, 0},
		{"W", -maxRadius * 2, 0},
	}
	for _, l := range labels {
		lx, ly := cx+l.dx, cy+l.dy
		if lx >= 0 && lx < RadarWidth && ly >= 0 && ly < RadarHeight {
			s.cells[ly][lx] = cell{char: rune(l.label[0]), color: s.theme.SecondaryBright}
		}
	}

	// Center crosshair
	s.cells[cy][cx] = cell{char: '╋', color: s.theme.PrimaryBright}
}

// DrawSweep draws the radar sweep line
func (s *Scope) DrawSweep(sweepAngle float64) {
	cx, cy := RadarCenterX, RadarCenterY
	maxRadius := min(RadarWidth/2, RadarHeight) - 1
	sweepRad := (sweepAngle - 90) * math.Pi / 180

	for i := 1; i <= maxRadius; i++ {
		x := int(float64(cx) + float64(i)*math.Cos(sweepRad)*2)
		y := int(float64(cy) + float64(i)*math.Sin(sweepRad))
		if x >= 0 && x < RadarWidth && y >= 0 && y < RadarHeight {
			s.cells[y][x] = cell{char: '░', color: s.theme.RadarSweep}
		}
	}
}

// DrawOverlays renders geographic overlays on the radar
func (s *Scope) DrawOverlays(overlays []*geo.GeoOverlay, receiverLat, receiverLon float64, overlayColor string) {
	if receiverLat == 0 && receiverLon == 0 {
		return
	}

	for _, overlay := range overlays {
		points := geo.RenderOverlayToRadar(overlay, receiverLat, receiverLon, s.maxRange,
			RadarWidth, RadarHeight, overlayColor)
		for _, p := range points {
			if p.X >= 0 && p.X < RadarWidth && p.Y >= 0 && p.Y < RadarHeight {
				if s.cells[p.Y][p.X].char == ' ' || s.cells[p.Y][p.X].char == '·' {
					s.cells[p.Y][p.X] = cell{char: p.Char, color: lipgloss.Color(p.Color)}
				}
			}
		}
	}
}

// TargetPosition represents a target's position on radar for sorting
type TargetPosition struct {
	Hex      string
	Distance float64
	X, Y     int
}

// DrawTargets draws aircraft targets and returns sorted target list
func (s *Scope) DrawTargets(targets map[string]*Target, selectedHex string, militaryOnly, hideGround, showLabels, blink bool) []string {
	var positions []TargetPosition

	for hex, t := range targets {
		if !t.HasLat || !t.HasLon {
			continue
		}
		if militaryOnly && !t.Military {
			continue
		}
		if hideGround && t.HasAlt && t.Altitude <= 0 {
			continue
		}

		x, y := TargetToRadarPos(t.Distance, t.Bearing, s.maxRange)
		if x >= 0 && x < RadarWidth && y >= 0 && y < RadarHeight {
			positions = append(positions, TargetPosition{
				Hex:      hex,
				Distance: t.Distance,
				X:        x,
				Y:        y,
			})
		}
	}

	// Sort by distance
	for i := 0; i < len(positions)-1; i++ {
		for j := i + 1; j < len(positions); j++ {
			if positions[i].Distance > positions[j].Distance {
				positions[i], positions[j] = positions[j], positions[i]
			}
		}
	}

	// Build sorted hex list
	sortedHexes := make([]string, len(positions))
	for i, p := range positions {
		sortedHexes[i] = p.Hex
	}

	// Draw targets
	for _, pos := range positions {
		t := targets[pos.Hex]
		isSelected := pos.Hex == selectedHex

		var symbol rune
		var color lipgloss.Color

		if t.IsEmergency() {
			if blink {
				symbol = '!'
			} else {
				symbol = '✖'
			}
			color = s.theme.Emergency
		} else if t.Military {
			symbol = '◆'
			color = s.theme.Military
		} else if isSelected {
			symbol = '◉'
			color = s.theme.Selected
		} else {
			symbol = '✦'
			color = s.theme.RadarTarget
		}

		s.cells[pos.Y][pos.X] = cell{char: symbol, color: color}

		// Draw label for selected or close targets
		if showLabels && (isSelected || t.Distance < s.maxRange*0.2) {
			label := t.Callsign
			if label == "" {
				label = t.Hex
			}
			if len(label) > 5 {
				label = label[:5]
			}

			labelColor := s.theme.TextDim
			if isSelected {
				labelColor = s.theme.Selected
			}

			for j, ch := range label {
				lx := pos.X + 1 + j
				if lx < RadarWidth {
					s.cells[pos.Y][lx] = cell{char: ch, color: labelColor}
				}
			}
		}

		// Draw heading vector for selected target
		if isSelected && t.HasTrack {
			hdgRad := (t.Track - 90) * math.Pi / 180
			for v := 1; v <= 2; v++ {
				hx := int(float64(pos.X) + float64(v)*math.Cos(hdgRad)*2)
				hy := int(float64(pos.Y) + float64(v)*math.Sin(hdgRad))
				if hx >= 0 && hx < RadarWidth && hy >= 0 && hy < RadarHeight {
					ch := '─'
					if v == 2 {
						ch = '›'
					}
					s.cells[hy][hx] = cell{char: ch, color: s.theme.Selected}
				}
			}
		}
	}

	return sortedHexes
}

// Render renders the radar scope to a string
func (s *Scope) Render() string {
	var sb strings.Builder

	// Top border with range
	rangeStr := fmt.Sprintf(" %dnm ", int(s.maxRange))
	pad := (RadarWidth - len(rangeStr)) / 2

	borderStyle := lipgloss.NewStyle().Foreground(s.theme.Border)

	sb.WriteString(borderStyle.Render("╔"))
	sb.WriteString(borderStyle.Render(strings.Repeat("═", pad)))
	sb.WriteString(borderStyle.Render(rangeStr))
	sb.WriteString(borderStyle.Render(strings.Repeat("═", RadarWidth-pad-len(rangeStr))))
	sb.WriteString(borderStyle.Render("╗"))
	sb.WriteString("\n")

	// Radar content
	for y := 0; y < RadarHeight; y++ {
		sb.WriteString(borderStyle.Render("║"))
		for x := 0; x < RadarWidth; x++ {
			c := s.cells[y][x]
			if c.color != "" {
				style := lipgloss.NewStyle().Foreground(c.color)
				sb.WriteString(style.Render(string(c.char)))
			} else {
				style := lipgloss.NewStyle().Foreground(s.theme.TextDim)
				sb.WriteString(style.Render(string(c.char)))
			}
		}
		sb.WriteString(borderStyle.Render("║"))
		sb.WriteString("\n")
	}

	// Bottom border
	sb.WriteString(borderStyle.Render("╚"))
	sb.WriteString(borderStyle.Render(strings.Repeat("═", RadarWidth)))
	sb.WriteString(borderStyle.Render("╝"))

	return sb.String()
}

// TrailPoint represents a single point in an aircraft's trail for rendering
type TrailPoint struct {
	Lat float64
	Lon float64
}

// DrawTrails draws aircraft trails on the radar
// trails is a map of hex -> slice of TrailPoints (oldest first)
// receiverLat/Lon are the receiver coordinates for distance/bearing calculation
func (s *Scope) DrawTrails(trails map[string][]TrailPoint, receiverLat, receiverLon float64) {
	if receiverLat == 0 && receiverLon == 0 {
		return
	}

	for _, trail := range trails {
		if len(trail) < 2 {
			continue
		}

		// Draw trail points (skip the most recent point which will be the current position)
		for i := 0; i < len(trail)-1; i++ {
			point := trail[i]
			distance, bearing := HaversineBearing(receiverLat, receiverLon, point.Lat, point.Lon)

			if distance > s.maxRange {
				continue
			}

			x, y := TargetToRadarPos(distance, bearing, s.maxRange)
			if x >= 0 && x < RadarWidth && y >= 0 && y < RadarHeight {
				// Only draw if the cell is empty or has a range ring
				if s.cells[y][x].char == ' ' || s.cells[y][x].char == '·' {
					// Use different characters based on trail age
					// Older points are more faded (use dots), newer points use small dots
					char := '·'
					if i < len(trail)/3 {
						// Oldest third - faintest
						char = '·'
					} else if i < 2*len(trail)/3 {
						// Middle third
						char = '•'
					} else {
						// Newest third (but not current position)
						char = '∘'
					}
					s.cells[y][x] = cell{char: char, color: s.theme.RadarTrail}
				}
			}
		}
	}
}

// TargetToRadarPos converts distance/bearing to radar coordinates
func TargetToRadarPos(distance, bearing, maxRange float64) (int, int) {
	if distance > maxRange {
		return -1, -1
	}
	radius := (distance / maxRange) * float64(min(RadarWidth, RadarHeight*2)/2-2)
	angleRad := (bearing - 90) * math.Pi / 180
	x := int(float64(RadarCenterX) + radius*math.Cos(angleRad)*2)
	y := int(float64(RadarCenterY) + radius*math.Sin(angleRad))
	return x, y
}

// HaversineBearing calculates distance (nm) and bearing between two points
func HaversineBearing(lat1, lon1, lat2, lon2 float64) (float64, float64) {
	const R = 3440.065 // Earth radius in nm
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	distance := R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	y := math.Sin(deltaLon) * math.Cos(lat2Rad)
	x := math.Cos(lat1Rad)*math.Sin(lat2Rad) - math.Sin(lat1Rad)*math.Cos(lat2Rad)*math.Cos(deltaLon)
	bearing := math.Mod(math.Atan2(y, x)*180/math.Pi+360, 360)

	return distance, bearing
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
