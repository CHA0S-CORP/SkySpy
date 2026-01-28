// Package theme provides color schemes for the SkySpy radar display
package theme

import "github.com/charmbracelet/lipgloss"

// Theme defines a color scheme for the radar display
type Theme struct {
	Name        string
	Description string

	// Primary colors
	Primary       lipgloss.Color
	PrimaryBright lipgloss.Color
	PrimaryDim    lipgloss.Color

	// Secondary colors
	Secondary       lipgloss.Color
	SecondaryBright lipgloss.Color

	// Status colors
	Success lipgloss.Color
	Warning lipgloss.Color
	Error   lipgloss.Color
	Info    lipgloss.Color

	// Special highlights
	Military  lipgloss.Color
	Emergency lipgloss.Color
	Selected  lipgloss.Color

	// UI elements
	Border     lipgloss.Color
	BorderDim  lipgloss.Color
	Text       lipgloss.Color
	TextDim    lipgloss.Color
	Background lipgloss.Color

	// Radar specific
	RadarSweep  lipgloss.Color
	RadarRing   lipgloss.Color
	RadarTarget lipgloss.Color
	RadarTrail  lipgloss.Color
}

// themes contains all available theme definitions
var themes = map[string]*Theme{
	"classic": {
		Name:            "Classic Green",
		Description:     "Traditional green phosphor display",
		Primary:         lipgloss.Color("28"),  // green
		PrimaryBright:   lipgloss.Color("46"),  // bright_green
		PrimaryDim:      lipgloss.Color("22"),  // dark_green
		Secondary:       lipgloss.Color("37"),  // cyan
		SecondaryBright: lipgloss.Color("51"),  // bright_cyan
		Success:         lipgloss.Color("46"),  // bright_green
		Warning:         lipgloss.Color("226"), // bright_yellow
		Error:           lipgloss.Color("196"), // bright_red
		Info:            lipgloss.Color("51"),  // bright_cyan
		Military:        lipgloss.Color("201"), // bright_magenta
		Emergency:       lipgloss.Color("196"), // bright_red
		Selected:        lipgloss.Color("226"), // bright_yellow
		Border:          lipgloss.Color("28"),  // green
		BorderDim:       lipgloss.Color("22"),  // dark_green
		Text:            lipgloss.Color("28"),  // green
		TextDim:         lipgloss.Color("22"),  // dark_green
		Background:      lipgloss.Color("0"),   // black
		RadarSweep:      lipgloss.Color("46"),  // bright_green
		RadarRing:       lipgloss.Color("22"),  // dark_green
		RadarTarget:     lipgloss.Color("46"),  // bright_green
		RadarTrail:      lipgloss.Color("28"),  // green
	},
	"amber": {
		Name:            "Amber",
		Description:     "Vintage amber monochrome display",
		Primary:         lipgloss.Color("178"), // yellow
		PrimaryBright:   lipgloss.Color("226"), // bright_yellow
		PrimaryDim:      lipgloss.Color("130"), // dark_orange
		Secondary:       lipgloss.Color("226"), // bright_yellow
		SecondaryBright: lipgloss.Color("231"), // bright_white
		Success:         lipgloss.Color("226"), // bright_yellow
		Warning:         lipgloss.Color("231"), // bright_white
		Error:           lipgloss.Color("196"), // bright_red
		Info:            lipgloss.Color("226"), // bright_yellow
		Military:        lipgloss.Color("201"), // bright_magenta
		Emergency:       lipgloss.Color("196"), // bright_red
		Selected:        lipgloss.Color("231"), // bright_white
		Border:          lipgloss.Color("178"), // yellow
		BorderDim:       lipgloss.Color("130"), // dark_orange
		Text:            lipgloss.Color("178"), // yellow
		TextDim:         lipgloss.Color("130"), // dark_orange
		Background:      lipgloss.Color("0"),   // black
		RadarSweep:      lipgloss.Color("226"), // bright_yellow
		RadarRing:       lipgloss.Color("130"), // dark_orange
		RadarTarget:     lipgloss.Color("226"), // bright_yellow
		RadarTrail:      lipgloss.Color("178"), // yellow
	},
	"ice": {
		Name:            "Blue Ice",
		Description:     "Cold blue tactical display",
		Primary:         lipgloss.Color("21"),  // blue
		PrimaryBright:   lipgloss.Color("33"),  // bright_blue
		PrimaryDim:      lipgloss.Color("18"),  // dark_blue
		Secondary:       lipgloss.Color("37"),  // cyan
		SecondaryBright: lipgloss.Color("51"),  // bright_cyan
		Success:         lipgloss.Color("51"),  // bright_cyan
		Warning:         lipgloss.Color("226"), // bright_yellow
		Error:           lipgloss.Color("196"), // bright_red
		Info:            lipgloss.Color("33"),  // bright_blue
		Military:        lipgloss.Color("201"), // bright_magenta
		Emergency:       lipgloss.Color("196"), // bright_red
		Selected:        lipgloss.Color("231"), // bright_white
		Border:          lipgloss.Color("21"),  // blue
		BorderDim:       lipgloss.Color("18"),  // dark_blue
		Text:            lipgloss.Color("33"),  // bright_blue
		TextDim:         lipgloss.Color("21"),  // blue
		Background:      lipgloss.Color("0"),   // black
		RadarSweep:      lipgloss.Color("51"),  // bright_cyan
		RadarRing:       lipgloss.Color("18"),  // dark_blue
		RadarTarget:     lipgloss.Color("51"),  // bright_cyan
		RadarTrail:      lipgloss.Color("21"),  // blue
	},
	"cyberpunk": {
		Name:            "Cyberpunk",
		Description:     "Neon futuristic display",
		Primary:         lipgloss.Color("165"), // magenta
		PrimaryBright:   lipgloss.Color("201"), // bright_magenta
		PrimaryDim:      lipgloss.Color("90"),  // dark_magenta
		Secondary:       lipgloss.Color("37"),  // cyan
		SecondaryBright: lipgloss.Color("51"),  // bright_cyan
		Success:         lipgloss.Color("51"),  // bright_cyan
		Warning:         lipgloss.Color("226"), // bright_yellow
		Error:           lipgloss.Color("196"), // bright_red
		Info:            lipgloss.Color("201"), // bright_magenta
		Military:        lipgloss.Color("226"), // bright_yellow
		Emergency:       lipgloss.Color("196"), // bright_red
		Selected:        lipgloss.Color("231"), // bright_white
		Border:          lipgloss.Color("201"), // bright_magenta
		BorderDim:       lipgloss.Color("165"), // magenta
		Text:            lipgloss.Color("51"),  // bright_cyan
		TextDim:         lipgloss.Color("37"),  // cyan
		Background:      lipgloss.Color("0"),   // black
		RadarSweep:      lipgloss.Color("201"), // bright_magenta
		RadarRing:       lipgloss.Color("90"),  // dark_magenta
		RadarTarget:     lipgloss.Color("51"),  // bright_cyan
		RadarTrail:      lipgloss.Color("165"), // magenta
	},
	"military": {
		Name:            "Military",
		Description:     "Tactical military display",
		Primary:         lipgloss.Color("28"),  // green
		PrimaryBright:   lipgloss.Color("46"),  // bright_green
		PrimaryDim:      lipgloss.Color("22"),  // dark_green
		Secondary:       lipgloss.Color("178"), // yellow
		SecondaryBright: lipgloss.Color("226"), // bright_yellow
		Success:         lipgloss.Color("46"),  // bright_green
		Warning:         lipgloss.Color("226"), // bright_yellow
		Error:           lipgloss.Color("196"), // bright_red
		Info:            lipgloss.Color("46"),  // bright_green
		Military:        lipgloss.Color("226"), // bright_yellow
		Emergency:       lipgloss.Color("196"), // bright_red
		Selected:        lipgloss.Color("231"), // bright_white
		Border:          lipgloss.Color("28"),  // green
		BorderDim:       lipgloss.Color("22"),  // dark_green
		Text:            lipgloss.Color("46"),  // bright_green
		TextDim:         lipgloss.Color("28"),  // green
		Background:      lipgloss.Color("0"),   // black
		RadarSweep:      lipgloss.Color("46"),  // bright_green
		RadarRing:       lipgloss.Color("22"),  // dark_green
		RadarTarget:     lipgloss.Color("226"), // bright_yellow
		RadarTrail:      lipgloss.Color("28"),  // green
	},
	"high_contrast": {
		Name:            "High Contrast",
		Description:     "Maximum visibility white display",
		Primary:         lipgloss.Color("231"), // white
		PrimaryBright:   lipgloss.Color("231"), // bright_white
		PrimaryDim:      lipgloss.Color("249"), // grey70
		Secondary:       lipgloss.Color("51"),  // bright_cyan
		SecondaryBright: lipgloss.Color("231"), // bright_white
		Success:         lipgloss.Color("46"),  // bright_green
		Warning:         lipgloss.Color("226"), // bright_yellow
		Error:           lipgloss.Color("196"), // bright_red
		Info:            lipgloss.Color("51"),  // bright_cyan
		Military:        lipgloss.Color("201"), // bright_magenta
		Emergency:       lipgloss.Color("196"), // bright_red
		Selected:        lipgloss.Color("226"), // bright_yellow
		Border:          lipgloss.Color("231"), // white
		BorderDim:       lipgloss.Color("244"), // grey50
		Text:            lipgloss.Color("231"), // bright_white
		TextDim:         lipgloss.Color("249"), // grey70
		Background:      lipgloss.Color("0"),   // black
		RadarSweep:      lipgloss.Color("231"), // bright_white
		RadarRing:       lipgloss.Color("244"), // grey50
		RadarTarget:     lipgloss.Color("231"), // bright_white
		RadarTrail:      lipgloss.Color("249"), // grey70
	},
	"phosphor": {
		Name:            "Phosphor",
		Description:     "Realistic CRT phosphor glow",
		Primary:         lipgloss.Color("#33ff33"),
		PrimaryBright:   lipgloss.Color("#66ff66"),
		PrimaryDim:      lipgloss.Color("#116611"),
		Secondary:       lipgloss.Color("#33ffff"),
		SecondaryBright: lipgloss.Color("#66ffff"),
		Success:         lipgloss.Color("#66ff66"),
		Warning:         lipgloss.Color("#ffff33"),
		Error:           lipgloss.Color("#ff3333"),
		Info:            lipgloss.Color("#33ffff"),
		Military:        lipgloss.Color("#ff33ff"),
		Emergency:       lipgloss.Color("#ff3333"),
		Selected:        lipgloss.Color("#ffff66"),
		Border:          lipgloss.Color("#33ff33"),
		BorderDim:       lipgloss.Color("#116611"),
		Text:            lipgloss.Color("#33ff33"),
		TextDim:         lipgloss.Color("#116611"),
		Background:      lipgloss.Color("0"),
		RadarSweep:      lipgloss.Color("#66ff66"),
		RadarRing:       lipgloss.Color("#114411"),
		RadarTarget:     lipgloss.Color("#66ff66"),
		RadarTrail:      lipgloss.Color("#227722"),
	},
	"sunset": {
		Name:            "Sunset",
		Description:     "Warm orange sunset tones",
		Primary:         lipgloss.Color("208"), // dark_orange
		PrimaryBright:   lipgloss.Color("196"), // bright_red
		PrimaryDim:      lipgloss.Color("160"), // red
		Secondary:       lipgloss.Color("226"), // bright_yellow
		SecondaryBright: lipgloss.Color("231"), // bright_white
		Success:         lipgloss.Color("46"),  // bright_green
		Warning:         lipgloss.Color("226"), // bright_yellow
		Error:           lipgloss.Color("196"), // bright_red
		Info:            lipgloss.Color("226"), // bright_yellow
		Military:        lipgloss.Color("201"), // bright_magenta
		Emergency:       lipgloss.Color("231"), // bright_white
		Selected:        lipgloss.Color("231"), // bright_white
		Border:          lipgloss.Color("208"), // dark_orange
		BorderDim:       lipgloss.Color("160"), // red
		Text:            lipgloss.Color("226"), // bright_yellow
		TextDim:         lipgloss.Color("208"), // dark_orange
		Background:      lipgloss.Color("0"),   // black
		RadarSweep:      lipgloss.Color("196"), // bright_red
		RadarRing:       lipgloss.Color("160"), // red
		RadarTarget:     lipgloss.Color("226"), // bright_yellow
		RadarTrail:      lipgloss.Color("208"), // dark_orange
	},
	"matrix": {
		Name:            "Matrix",
		Description:     "Matrix digital rain inspired",
		Primary:         lipgloss.Color("#00ff00"),
		PrimaryBright:   lipgloss.Color("#00ff00"),
		PrimaryDim:      lipgloss.Color("#003300"),
		Secondary:       lipgloss.Color("#00ff00"),
		SecondaryBright: lipgloss.Color("#88ff88"),
		Success:         lipgloss.Color("#00ff00"),
		Warning:         lipgloss.Color("#ffff00"),
		Error:           lipgloss.Color("#ff0000"),
		Info:            lipgloss.Color("#00ff00"),
		Military:        lipgloss.Color("#ff00ff"),
		Emergency:       lipgloss.Color("#ff0000"),
		Selected:        lipgloss.Color("#ffffff"),
		Border:          lipgloss.Color("#00ff00"),
		BorderDim:       lipgloss.Color("#004400"),
		Text:            lipgloss.Color("#00ff00"),
		TextDim:         lipgloss.Color("#006600"),
		Background:      lipgloss.Color("0"),
		RadarSweep:      lipgloss.Color("#00ff00"),
		RadarRing:       lipgloss.Color("#003300"),
		RadarTarget:     lipgloss.Color("#00ff00"),
		RadarTrail:      lipgloss.Color("#004400"),
	},
	"ocean": {
		Name:            "Ocean",
		Description:     "Deep blue oceanic display",
		Primary:         lipgloss.Color("#0066cc"),
		PrimaryBright:   lipgloss.Color("#0099ff"),
		PrimaryDim:      lipgloss.Color("#003366"),
		Secondary:       lipgloss.Color("#00cccc"),
		SecondaryBright: lipgloss.Color("#00ffff"),
		Success:         lipgloss.Color("#00cc66"),
		Warning:         lipgloss.Color("#ffcc00"),
		Error:           lipgloss.Color("#ff3333"),
		Info:            lipgloss.Color("#00ccff"),
		Military:        lipgloss.Color("#cc00cc"),
		Emergency:       lipgloss.Color("#ff3333"),
		Selected:        lipgloss.Color("#ffffff"),
		Border:          lipgloss.Color("#0066cc"),
		BorderDim:       lipgloss.Color("#003366"),
		Text:            lipgloss.Color("#0099ff"),
		TextDim:         lipgloss.Color("#006699"),
		Background:      lipgloss.Color("0"),
		RadarSweep:      lipgloss.Color("#00ccff"),
		RadarRing:       lipgloss.Color("#003366"),
		RadarTarget:     lipgloss.Color("#00ffff"),
		RadarTrail:      lipgloss.Color("#006699"),
	},
}

// Get returns a theme by name, defaults to classic if not found
func Get(name string) *Theme {
	if t, ok := themes[name]; ok {
		return t
	}
	return themes["classic"]
}

// List returns all available theme names
func List() []string {
	names := make([]string, 0, len(themes))
	// Return in a consistent order
	order := []string{"classic", "amber", "ice", "cyberpunk", "military", "high_contrast", "phosphor", "sunset", "matrix", "ocean"}
	for _, name := range order {
		if _, ok := themes[name]; ok {
			names = append(names, name)
		}
	}
	return names
}

// ThemeInfo contains theme metadata for display
type ThemeInfo struct {
	Key         string
	Name        string
	Description string
}

// GetInfo returns information about all themes
func GetInfo() []ThemeInfo {
	order := []string{"classic", "amber", "ice", "cyberpunk", "military", "high_contrast", "phosphor", "sunset", "matrix", "ocean"}
	info := make([]ThemeInfo, 0, len(order))
	for _, key := range order {
		if t, ok := themes[key]; ok {
			info = append(info, ThemeInfo{
				Key:         key,
				Name:        t.Name,
				Description: t.Description,
			})
		}
	}
	return info
}

// Style helpers for creating lipgloss styles

// PrimaryStyle returns a style using the primary color
func (t *Theme) PrimaryStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(t.Primary)
}

// PrimaryBrightStyle returns a style using the bright primary color
func (t *Theme) PrimaryBrightStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(t.PrimaryBright)
}

// SecondaryStyle returns a style using the secondary color
func (t *Theme) SecondaryStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(t.Secondary)
}

// BorderStyle returns a style using the border color
func (t *Theme) BorderStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(t.Border)
}

// TextStyle returns a style using the text color
func (t *Theme) TextStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(t.Text)
}

// TextDimStyle returns a style using the dim text color
func (t *Theme) TextDimStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(t.TextDim)
}

// SuccessStyle returns a style using the success color
func (t *Theme) SuccessStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(t.Success)
}

// WarningStyle returns a style using the warning color
func (t *Theme) WarningStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(t.Warning)
}

// ErrorStyle returns a style using the error color
func (t *Theme) ErrorStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(t.Error)
}

// InfoStyle returns a style using the info color
func (t *Theme) InfoStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(t.Info)
}
