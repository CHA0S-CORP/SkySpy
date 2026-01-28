// Package theme provides color schemes for the SkySpy radar display
package theme

import (
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestGet_ValidTheme(t *testing.T) {
	validThemes := []string{
		"classic", "amber", "ice", "cyberpunk", "military",
		"high_contrast", "phosphor", "sunset", "matrix", "ocean",
	}

	for _, name := range validThemes {
		t.Run(name, func(t *testing.T) {
			theme := Get(name)
			if theme == nil {
				t.Errorf("Get(%q) returned nil", name)
			}
			if theme.Name == "" {
				t.Errorf("Theme %q has empty Name", name)
			}
			if theme.Description == "" {
				t.Errorf("Theme %q has empty Description", name)
			}
		})
	}
}

func TestGet_InvalidTheme(t *testing.T) {
	theme := Get("nonexistent")
	if theme == nil {
		t.Fatal("Get should return default theme for invalid name")
	}

	// Should return classic theme
	classicTheme := Get("classic")
	if theme != classicTheme {
		t.Error("Invalid theme name should return classic theme")
	}
}

func TestGet_EmptyString(t *testing.T) {
	theme := Get("")
	if theme == nil {
		t.Fatal("Get should return default theme for empty string")
	}

	classicTheme := Get("classic")
	if theme != classicTheme {
		t.Error("Empty theme name should return classic theme")
	}
}

func TestList(t *testing.T) {
	list := List()

	if len(list) == 0 {
		t.Fatal("List returned empty slice")
	}

	expectedThemes := []string{
		"classic", "amber", "ice", "cyberpunk", "military",
		"high_contrast", "phosphor", "sunset", "matrix", "ocean",
	}

	if len(list) != len(expectedThemes) {
		t.Errorf("List returned %d themes, want %d", len(list), len(expectedThemes))
	}

	// Verify order is preserved
	for i, expected := range expectedThemes {
		if list[i] != expected {
			t.Errorf("List()[%d] = %q, want %q", i, list[i], expected)
		}
	}
}

func TestGetInfo(t *testing.T) {
	info := GetInfo()

	if len(info) == 0 {
		t.Fatal("GetInfo returned empty slice")
	}

	expectedCount := 10
	if len(info) != expectedCount {
		t.Errorf("GetInfo returned %d items, want %d", len(info), expectedCount)
	}

	// Verify first item is classic
	if info[0].Key != "classic" {
		t.Errorf("First theme key = %q, want %q", info[0].Key, "classic")
	}
	if info[0].Name != "Classic Green" {
		t.Errorf("First theme name = %q, want %q", info[0].Name, "Classic Green")
	}
	if info[0].Description == "" {
		t.Error("First theme description should not be empty")
	}
}

func TestGetInfo_AllThemes(t *testing.T) {
	info := GetInfo()

	for _, themeInfo := range info {
		if themeInfo.Key == "" {
			t.Error("ThemeInfo has empty Key")
		}
		if themeInfo.Name == "" {
			t.Error("ThemeInfo has empty Name")
		}
		if themeInfo.Description == "" {
			t.Errorf("Theme %q has empty Description", themeInfo.Key)
		}

		// Verify the theme actually exists
		theme := Get(themeInfo.Key)
		if theme == nil {
			t.Errorf("Theme %q from GetInfo doesn't exist", themeInfo.Key)
		}
		if theme.Name != themeInfo.Name {
			t.Errorf("Theme name mismatch: info=%q, theme=%q", themeInfo.Name, theme.Name)
		}
	}
}

func TestTheme_PrimaryStyle(t *testing.T) {
	theme := Get("classic")
	style := theme.PrimaryStyle()

	// Verify it returns a valid style by rendering some text
	result := style.Render("test")
	if result == "" {
		t.Error("PrimaryStyle should render text")
	}
}

func TestTheme_PrimaryBrightStyle(t *testing.T) {
	theme := Get("classic")
	style := theme.PrimaryBrightStyle()

	result := style.Render("test")
	if result == "" {
		t.Error("PrimaryBrightStyle should render text")
	}
}

func TestTheme_SecondaryStyle(t *testing.T) {
	theme := Get("classic")
	style := theme.SecondaryStyle()

	result := style.Render("test")
	if result == "" {
		t.Error("SecondaryStyle should render text")
	}
}

func TestTheme_BorderStyle(t *testing.T) {
	theme := Get("classic")
	style := theme.BorderStyle()

	result := style.Render("test")
	if result == "" {
		t.Error("BorderStyle should render text")
	}
}

func TestTheme_TextStyle(t *testing.T) {
	theme := Get("classic")
	style := theme.TextStyle()

	result := style.Render("test")
	if result == "" {
		t.Error("TextStyle should render text")
	}
}

func TestTheme_TextDimStyle(t *testing.T) {
	theme := Get("classic")
	style := theme.TextDimStyle()

	result := style.Render("test")
	if result == "" {
		t.Error("TextDimStyle should render text")
	}
}

func TestTheme_SuccessStyle(t *testing.T) {
	theme := Get("classic")
	style := theme.SuccessStyle()

	result := style.Render("test")
	if result == "" {
		t.Error("SuccessStyle should render text")
	}
}

func TestTheme_WarningStyle(t *testing.T) {
	theme := Get("classic")
	style := theme.WarningStyle()

	result := style.Render("test")
	if result == "" {
		t.Error("WarningStyle should render text")
	}
}

func TestTheme_ErrorStyle(t *testing.T) {
	theme := Get("classic")
	style := theme.ErrorStyle()

	result := style.Render("test")
	if result == "" {
		t.Error("ErrorStyle should render text")
	}
}

func TestTheme_InfoStyle(t *testing.T) {
	theme := Get("classic")
	style := theme.InfoStyle()

	result := style.Render("test")
	if result == "" {
		t.Error("InfoStyle should render text")
	}
}

func TestTheme_AllStyleMethods(t *testing.T) {
	themes := []string{
		"classic", "amber", "ice", "cyberpunk", "military",
		"high_contrast", "phosphor", "sunset", "matrix", "ocean",
	}

	for _, name := range themes {
		t.Run(name, func(t *testing.T) {
			theme := Get(name)

			// Test all style methods
			_ = theme.PrimaryStyle()
			_ = theme.PrimaryBrightStyle()
			_ = theme.SecondaryStyle()
			_ = theme.BorderStyle()
			_ = theme.TextStyle()
			_ = theme.TextDimStyle()
			_ = theme.SuccessStyle()
			_ = theme.WarningStyle()
			_ = theme.ErrorStyle()
			_ = theme.InfoStyle()
		})
	}
}

func TestTheme_ColorFields(t *testing.T) {
	theme := Get("classic")

	// Test that all color fields are set
	if theme.Primary == "" {
		t.Error("Primary color should not be empty")
	}
	if theme.PrimaryBright == "" {
		t.Error("PrimaryBright color should not be empty")
	}
	if theme.PrimaryDim == "" {
		t.Error("PrimaryDim color should not be empty")
	}
	if theme.Secondary == "" {
		t.Error("Secondary color should not be empty")
	}
	if theme.SecondaryBright == "" {
		t.Error("SecondaryBright color should not be empty")
	}
	if theme.Success == "" {
		t.Error("Success color should not be empty")
	}
	if theme.Warning == "" {
		t.Error("Warning color should not be empty")
	}
	if theme.Error == "" {
		t.Error("Error color should not be empty")
	}
	if theme.Info == "" {
		t.Error("Info color should not be empty")
	}
	if theme.Military == "" {
		t.Error("Military color should not be empty")
	}
	if theme.Emergency == "" {
		t.Error("Emergency color should not be empty")
	}
	if theme.Selected == "" {
		t.Error("Selected color should not be empty")
	}
	if theme.Border == "" {
		t.Error("Border color should not be empty")
	}
	if theme.BorderDim == "" {
		t.Error("BorderDim color should not be empty")
	}
	if theme.Text == "" {
		t.Error("Text color should not be empty")
	}
	if theme.TextDim == "" {
		t.Error("TextDim color should not be empty")
	}
	if theme.Background == "" {
		t.Error("Background color should not be empty")
	}
	if theme.RadarSweep == "" {
		t.Error("RadarSweep color should not be empty")
	}
	if theme.RadarRing == "" {
		t.Error("RadarRing color should not be empty")
	}
	if theme.RadarTarget == "" {
		t.Error("RadarTarget color should not be empty")
	}
	if theme.RadarTrail == "" {
		t.Error("RadarTrail color should not be empty")
	}
}

func TestTheme_AllThemesHaveColorFields(t *testing.T) {
	themes := []string{
		"classic", "amber", "ice", "cyberpunk", "military",
		"high_contrast", "phosphor", "sunset", "matrix", "ocean",
	}

	for _, name := range themes {
		t.Run(name, func(t *testing.T) {
			theme := Get(name)

			// Verify essential fields are populated
			if theme.Name == "" {
				t.Error("Name should not be empty")
			}
			if theme.Description == "" {
				t.Error("Description should not be empty")
			}
			if theme.Primary == "" {
				t.Error("Primary color should not be empty")
			}
			if theme.Background == "" {
				t.Error("Background color should not be empty")
			}
		})
	}
}

func TestThemeInfo_Struct(t *testing.T) {
	info := ThemeInfo{
		Key:         "test",
		Name:        "Test Theme",
		Description: "A test theme",
	}

	if info.Key != "test" {
		t.Errorf("Key = %q, want %q", info.Key, "test")
	}
	if info.Name != "Test Theme" {
		t.Errorf("Name = %q, want %q", info.Name, "Test Theme")
	}
	if info.Description != "A test theme" {
		t.Errorf("Description = %q, want %q", info.Description, "A test theme")
	}
}

func TestTheme_Struct(t *testing.T) {
	theme := Theme{
		Name:            "Custom",
		Description:     "Custom theme",
		Primary:         lipgloss.Color("1"),
		PrimaryBright:   lipgloss.Color("2"),
		PrimaryDim:      lipgloss.Color("3"),
		Secondary:       lipgloss.Color("4"),
		SecondaryBright: lipgloss.Color("5"),
		Success:         lipgloss.Color("6"),
		Warning:         lipgloss.Color("7"),
		Error:           lipgloss.Color("8"),
		Info:            lipgloss.Color("9"),
		Military:        lipgloss.Color("10"),
		Emergency:       lipgloss.Color("11"),
		Selected:        lipgloss.Color("12"),
		Border:          lipgloss.Color("13"),
		BorderDim:       lipgloss.Color("14"),
		Text:            lipgloss.Color("15"),
		TextDim:         lipgloss.Color("16"),
		Background:      lipgloss.Color("17"),
		RadarSweep:      lipgloss.Color("18"),
		RadarRing:       lipgloss.Color("19"),
		RadarTarget:     lipgloss.Color("20"),
		RadarTrail:      lipgloss.Color("21"),
	}

	if theme.Name != "Custom" {
		t.Error("Name not set correctly")
	}
	if theme.Primary != lipgloss.Color("1") {
		t.Error("Primary not set correctly")
	}
}

func TestList_Consistency(t *testing.T) {
	// Verify List returns themes in a consistent order
	list1 := List()
	list2 := List()

	if len(list1) != len(list2) {
		t.Error("List should return consistent length")
	}

	for i := range list1 {
		if list1[i] != list2[i] {
			t.Errorf("List order inconsistent at index %d: %q vs %q", i, list1[i], list2[i])
		}
	}
}

func TestGetInfo_Consistency(t *testing.T) {
	// Verify GetInfo returns themes in a consistent order
	info1 := GetInfo()
	info2 := GetInfo()

	if len(info1) != len(info2) {
		t.Error("GetInfo should return consistent length")
	}

	for i := range info1 {
		if info1[i].Key != info2[i].Key {
			t.Errorf("GetInfo order inconsistent at index %d: %q vs %q", i, info1[i].Key, info2[i].Key)
		}
	}
}

func TestList_MatchesGetInfo(t *testing.T) {
	list := List()
	info := GetInfo()

	if len(list) != len(info) {
		t.Errorf("List length (%d) != GetInfo length (%d)", len(list), len(info))
	}

	for i := range list {
		if list[i] != info[i].Key {
			t.Errorf("Mismatch at index %d: List=%q, GetInfo=%q", i, list[i], info[i].Key)
		}
	}
}

func TestPhosphorTheme_HexColors(t *testing.T) {
	theme := Get("phosphor")

	// Phosphor theme uses hex colors - verify they work
	if theme.Primary == "" {
		t.Error("Phosphor Primary color should be set")
	}

	// Verify style methods work with hex colors
	_ = theme.PrimaryStyle()
	_ = theme.TextStyle()
}

func TestMatrixTheme_HexColors(t *testing.T) {
	theme := Get("matrix")

	// Matrix theme uses hex colors
	if theme.Primary == "" {
		t.Error("Matrix Primary color should be set")
	}

	_ = theme.PrimaryStyle()
}

func TestOceanTheme_HexColors(t *testing.T) {
	theme := Get("ocean")

	// Ocean theme uses hex colors
	if theme.Primary == "" {
		t.Error("Ocean Primary color should be set")
	}

	_ = theme.PrimaryStyle()
}
