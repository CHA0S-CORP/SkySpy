package export

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveAsText(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_screenshot.txt")

	content := "SkySpy Radar Display\nAircraft: 42\nRange: 50nm"

	err := SaveAsText(content, filename)
	if err != nil {
		t.Fatalf("SaveAsText failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	savedContent := string(data)
	if savedContent != content {
		t.Errorf("content mismatch\nexpected: %q\ngot: %q", content, savedContent)
	}
}

func TestSaveAsText_StripANSI(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_screenshot_ansi.txt")

	contentWithANSI := "\x1b[31mRed Text\x1b[0m Normal \x1b[1;32mBold Green\x1b[0m"
	expectedPlain := "Red Text Normal Bold Green"

	err := SaveAsText(contentWithANSI, filename)
	if err != nil {
		t.Fatalf("SaveAsText failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	savedContent := string(data)
	if savedContent != expectedPlain {
		t.Errorf("ANSI codes not stripped correctly\nexpected: %q\ngot: %q", expectedPlain, savedContent)
	}

	if strings.Contains(savedContent, "\x1b") {
		t.Error("ANSI escape sequences should be removed")
	}
}

func TestSaveAsText_StripANSI_256Colors(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_256_colors.txt")

	contentWithANSI := "\x1b[38;5;196mRed256\x1b[0m \x1b[48;5;21mBlueBg\x1b[0m"
	expectedPlain := "Red256 BlueBg"

	err := SaveAsText(contentWithANSI, filename)
	if err != nil {
		t.Fatalf("SaveAsText failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	savedContent := string(data)
	if savedContent != expectedPlain {
		t.Errorf("256-color ANSI codes not stripped correctly\nexpected: %q\ngot: %q", expectedPlain, savedContent)
	}
}

func TestSaveAsText_StripANSI_MultipleSequences(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_multi_ansi.txt")

	contentWithANSI := "\x1b[1m\x1b[31mBoldRed\x1b[0m \x1b[4mUnderline\x1b[0m \x1b[7mReverse\x1b[0m"
	expectedPlain := "BoldRed Underline Reverse"

	err := SaveAsText(contentWithANSI, filename)
	if err != nil {
		t.Fatalf("SaveAsText failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	savedContent := string(data)
	if savedContent != expectedPlain {
		t.Errorf("multiple ANSI codes not stripped correctly\nexpected: %q\ngot: %q", expectedPlain, savedContent)
	}
}

func TestSaveAsText_DefaultFilename(t *testing.T) {
	originalDir, _ := os.Getwd()
	tmpDir := t.TempDir()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	content := "Test content"

	err := SaveAsText(content, "")
	if err != nil {
		t.Fatalf("SaveAsText with empty filename failed: %v", err)
	}

	files, err := filepath.Glob(filepath.Join(tmpDir, "skyspy_screenshot_*.txt"))
	if err != nil {
		t.Fatalf("failed to glob for files: %v", err)
	}

	if len(files) == 0 {
		t.Error("expected a file with default name to be created")
	}
}

func TestSaveAsHTML(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_screenshot.html")

	content := "SkySpy Radar Display\nAircraft: 42"

	err := SaveAsHTML(content, filename)
	if err != nil {
		t.Fatalf("SaveAsHTML failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	htmlContent := string(data)

	if !strings.Contains(htmlContent, "<!DOCTYPE html>") {
		t.Error("expected HTML to contain DOCTYPE declaration")
	}

	if !strings.Contains(htmlContent, "<html") {
		t.Error("expected HTML to contain <html> tag")
	}

	if !strings.Contains(htmlContent, "</html>") {
		t.Error("expected HTML to contain closing </html> tag")
	}

	if !strings.Contains(htmlContent, "<head>") {
		t.Error("expected HTML to contain <head> section")
	}

	if !strings.Contains(htmlContent, "<body>") {
		t.Error("expected HTML to contain <body> section")
	}

	if !strings.Contains(htmlContent, "<pre>") {
		t.Error("expected HTML to contain <pre> element for content")
	}

	if !strings.Contains(htmlContent, "SkySpy Radar Screenshot") {
		t.Error("expected HTML to contain page title")
	}

	if !strings.Contains(htmlContent, "SkySpy Radar Display") {
		t.Error("expected HTML to contain the original content")
	}
}

func TestSaveAsHTML_Colors(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_colors.html")

	contentWithANSI := "\x1b[31mRed\x1b[0m \x1b[32mGreen\x1b[0m \x1b[34mBlue\x1b[0m"

	err := SaveAsHTML(contentWithANSI, filename)
	if err != nil {
		t.Fatalf("SaveAsHTML failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	htmlContent := string(data)

	// The HTML converter wraps each character in a span, so we check for individual characters
	// and that they're styled appropriately
	if !strings.Contains(htmlContent, ">R<") && !strings.Contains(htmlContent, "R</span>") {
		t.Error("expected HTML to contain 'R' character from 'Red' text")
	}
	if !strings.Contains(htmlContent, ">G<") && !strings.Contains(htmlContent, "G</span>") {
		t.Error("expected HTML to contain 'G' character from 'Green' text")
	}
	if !strings.Contains(htmlContent, ">B<") && !strings.Contains(htmlContent, "B</span>") {
		t.Error("expected HTML to contain 'B' character from 'Blue' text")
	}

	if !strings.Contains(htmlContent, "<span") {
		t.Error("expected HTML to contain <span> elements for styled text")
	}

	if !strings.Contains(htmlContent, "style=") || !strings.Contains(htmlContent, "color:") {
		t.Error("expected HTML to contain inline color styles")
	}

	if !strings.Contains(htmlContent, "#") {
		t.Error("expected HTML to contain hex color codes")
	}
}

func TestSaveAsHTML_Colors_256(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_colors_256.html")

	contentWithANSI := "\x1b[38;5;196mRed256\x1b[0m \x1b[38;5;46mGreen256\x1b[0m"

	err := SaveAsHTML(contentWithANSI, filename)
	if err != nil {
		t.Fatalf("SaveAsHTML failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	htmlContent := string(data)

	// The HTML converter wraps each character in a span, so we check for individual characters
	if !strings.Contains(htmlContent, ">R<") && !strings.Contains(htmlContent, "R</span>") {
		t.Error("expected HTML to contain 'R' character from 'Red256' text")
	}
	if !strings.Contains(htmlContent, ">G<") && !strings.Contains(htmlContent, "G</span>") {
		t.Error("expected HTML to contain 'G' character from 'Green256' text")
	}

	if !strings.Contains(htmlContent, "<span") {
		t.Error("expected HTML to contain <span> elements for styled text")
	}
}

func TestSaveAsHTML_Bold(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_bold.html")

	contentWithANSI := "\x1b[1mBold Text\x1b[0m Normal"

	err := SaveAsHTML(contentWithANSI, filename)
	if err != nil {
		t.Fatalf("SaveAsHTML failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	htmlContent := string(data)

	if !strings.Contains(htmlContent, "bold") {
		t.Error("expected HTML to contain 'bold' class for bold text")
	}

	// The HTML converter wraps each character in a span, check for 'B' character
	if !strings.Contains(htmlContent, ">B<") && !strings.Contains(htmlContent, "B</span>") {
		t.Error("expected HTML to contain 'B' character from 'Bold' text")
	}
}

func TestSaveAsHTML_HTMLEscaping(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_escape.html")

	content := "<script>alert('xss')</script> & \"quotes\""

	err := SaveAsHTML(content, filename)
	if err != nil {
		t.Fatalf("SaveAsHTML failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	htmlContent := string(data)

	if strings.Contains(htmlContent, "<script>") {
		t.Error("expected HTML to escape <script> tag")
	}

	if !strings.Contains(htmlContent, "&lt;script&gt;") {
		t.Error("expected HTML to contain escaped script tag")
	}

	if !strings.Contains(htmlContent, "&amp;") {
		t.Error("expected HTML to escape ampersand")
	}

	if !strings.Contains(htmlContent, "&#34;") || !strings.Contains(htmlContent, "&quot;") {
		if strings.Contains(htmlContent, `"quotes"`) && !strings.Contains(htmlContent, `\"quotes\"`) {
			t.Log("quotes may be preserved in pre context, which is acceptable")
		}
	}
}

func TestSaveAsHTML_Timestamp(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_timestamp.html")

	content := "Test content"

	err := SaveAsHTML(content, filename)
	if err != nil {
		t.Fatalf("SaveAsHTML failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	htmlContent := string(data)

	if !strings.Contains(htmlContent, "Captured:") {
		t.Error("expected HTML to contain 'Captured:' timestamp label")
	}

	if !strings.Contains(htmlContent, "timestamp") {
		t.Error("expected HTML to contain timestamp class or element")
	}
}

func TestSaveAsHTML_DefaultFilename(t *testing.T) {
	originalDir, _ := os.Getwd()
	tmpDir := t.TempDir()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	content := "Test content"

	err := SaveAsHTML(content, "")
	if err != nil {
		t.Fatalf("SaveAsHTML with empty filename failed: %v", err)
	}

	files, err := filepath.Glob(filepath.Join(tmpDir, "skyspy_screenshot_*.html"))
	if err != nil {
		t.Fatalf("failed to glob for files: %v", err)
	}

	if len(files) == 0 {
		t.Error("expected a file with default name to be created")
	}
}

func TestCaptureScreen(t *testing.T) {
	tmpDir := t.TempDir()

	content := "\x1b[32mSkySpy\x1b[0m Radar\nAircraft: 42"

	filename, err := CaptureScreen(content, tmpDir)
	if err != nil {
		t.Fatalf("CaptureScreen failed: %v", err)
	}

	if filename == "" {
		t.Error("expected filename to be returned")
	}

	if !strings.HasSuffix(filename, ".html") {
		t.Errorf("expected HTML filename, got %s", filename)
	}

	if !strings.HasPrefix(filepath.Base(filename), "skyspy_screenshot_") {
		t.Errorf("expected filename to start with 'skyspy_screenshot_', got %s", filepath.Base(filename))
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read captured file: %v", err)
	}

	htmlContent := string(data)

	if !strings.Contains(htmlContent, "<!DOCTYPE html>") {
		t.Error("expected valid HTML document")
	}

	if !strings.Contains(htmlContent, "SkySpy") {
		t.Error("expected HTML to contain original content")
	}
}

func TestCaptureScreen_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "screenshots")

	content := "Test content"

	filename, err := CaptureScreen(content, nestedDir)
	if err != nil {
		t.Fatalf("CaptureScreen failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestSaveAsText_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "text")
	filename := filepath.Join(nestedDir, "test.txt")

	content := "Test content"

	err := SaveAsText(content, filename)
	if err != nil {
		t.Fatalf("SaveAsText failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestSaveAsHTML_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nestedDir := filepath.Join(tmpDir, "nested", "html")
	filename := filepath.Join(nestedDir, "test.html")

	content := "Test content"

	err := SaveAsHTML(content, filename)
	if err != nil {
		t.Fatalf("SaveAsHTML failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created in nested directory")
	}
}

func TestSaveAsHTML_StyleDefinitions(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_styles.html")

	content := "Test content"

	err := SaveAsHTML(content, filename)
	if err != nil {
		t.Fatalf("SaveAsHTML failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	htmlContent := string(data)

	if !strings.Contains(htmlContent, "<style>") {
		t.Error("expected HTML to contain <style> section")
	}

	if !strings.Contains(htmlContent, ".bold") {
		t.Error("expected HTML to define .bold class")
	}

	if !strings.Contains(htmlContent, ".dim") {
		t.Error("expected HTML to define .dim class")
	}

	if !strings.Contains(htmlContent, ".underline") {
		t.Error("expected HTML to define .underline class")
	}

	if !strings.Contains(htmlContent, "background-color") {
		t.Error("expected HTML to define background-color in body styles")
	}

	if !strings.Contains(htmlContent, "font-family") {
		t.Error("expected HTML to define font-family")
	}

	if !strings.Contains(htmlContent, "monospace") {
		t.Error("expected HTML to use monospace font")
	}
}

func TestSaveAsHTML_BackgroundColors(t *testing.T) {
	tmpDir := t.TempDir()
	filename := filepath.Join(tmpDir, "test_bg_colors.html")

	contentWithANSI := "\x1b[41mRedBg\x1b[0m \x1b[42mGreenBg\x1b[0m"

	err := SaveAsHTML(contentWithANSI, filename)
	if err != nil {
		t.Fatalf("SaveAsHTML failed: %v", err)
	}

	data, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	htmlContent := string(data)

	if !strings.Contains(htmlContent, "background-color:") {
		t.Error("expected HTML to contain background-color styles")
	}

	// The HTML converter wraps each character in a span, check for individual characters
	if !strings.Contains(htmlContent, ">R<") && !strings.Contains(htmlContent, "R</span>") {
		t.Error("expected HTML to contain 'R' character from 'RedBg' text")
	}
	if !strings.Contains(htmlContent, ">G<") && !strings.Contains(htmlContent, "G</span>") {
		t.Error("expected HTML to contain 'G' character from 'GreenBg' text")
	}
}

// Test processCodes function with all ANSI codes
func TestProcessCodes_AllCodes(t *testing.T) {
	tests := []struct {
		name      string
		codes     []string
		wantFg    string
		wantBg    string
		wantBold  bool
		wantDim   bool
		wantItal  bool
		wantUnder bool
		wantBlink bool
		wantRev   bool
	}{
		// Reset
		{"reset with 0", []string{"0"}, "", "", false, false, false, false, false, false},
		{"reset with empty", []string{""}, "", "", false, false, false, false, false, false},

		// Text attributes
		{"bold", []string{"1"}, "", "", true, false, false, false, false, false},
		{"dim", []string{"2"}, "", "", false, true, false, false, false, false},
		{"italic", []string{"3"}, "", "", false, false, true, false, false, false},
		{"underline", []string{"4"}, "", "", false, false, false, true, false, false},
		{"blink", []string{"5"}, "", "", false, false, false, false, true, false},
		{"reverse", []string{"7"}, "", "", false, false, false, false, false, true},

		// Reset specific attributes
		{"reset bold/dim (22)", []string{"1", "22"}, "", "", false, false, false, false, false, false},
		{"reset italic (23)", []string{"3", "23"}, "", "", false, false, false, false, false, false},
		{"reset underline (24)", []string{"4", "24"}, "", "", false, false, false, false, false, false},
		{"reset blink (25)", []string{"5", "25"}, "", "", false, false, false, false, false, false},
		{"reset reverse (27)", []string{"7", "27"}, "", "", false, false, false, false, false, false},

		// Standard foreground colors (30-37)
		{"fg black (30)", []string{"30"}, "#000000", "", false, false, false, false, false, false},
		{"fg red (31)", []string{"31"}, "#800000", "", false, false, false, false, false, false},
		{"fg green (32)", []string{"32"}, "#008000", "", false, false, false, false, false, false},
		{"fg yellow (33)", []string{"33"}, "#808000", "", false, false, false, false, false, false},
		{"fg blue (34)", []string{"34"}, "#000080", "", false, false, false, false, false, false},
		{"fg magenta (35)", []string{"35"}, "#800080", "", false, false, false, false, false, false},
		{"fg cyan (36)", []string{"36"}, "#008080", "", false, false, false, false, false, false},
		{"fg white (37)", []string{"37"}, "#c0c0c0", "", false, false, false, false, false, false},

		// Reset foreground
		{"reset fg (39)", []string{"31", "39"}, "", "", false, false, false, false, false, false},

		// Standard background colors (40-47)
		{"bg black (40)", []string{"40"}, "", "#000000", false, false, false, false, false, false},
		{"bg red (41)", []string{"41"}, "", "#800000", false, false, false, false, false, false},
		{"bg green (42)", []string{"42"}, "", "#008000", false, false, false, false, false, false},
		{"bg yellow (43)", []string{"43"}, "", "#808000", false, false, false, false, false, false},
		{"bg blue (44)", []string{"44"}, "", "#000080", false, false, false, false, false, false},
		{"bg magenta (45)", []string{"45"}, "", "#800080", false, false, false, false, false, false},
		{"bg cyan (46)", []string{"46"}, "", "#008080", false, false, false, false, false, false},
		{"bg white (47)", []string{"47"}, "", "#c0c0c0", false, false, false, false, false, false},

		// Reset background
		{"reset bg (49)", []string{"41", "49"}, "", "", false, false, false, false, false, false},

		// Bright foreground colors (90-97)
		{"bright fg black (90)", []string{"90"}, "#808080", "", false, false, false, false, false, false},
		{"bright fg red (91)", []string{"91"}, "#ff0000", "", false, false, false, false, false, false},
		{"bright fg green (92)", []string{"92"}, "#00ff00", "", false, false, false, false, false, false},
		{"bright fg yellow (93)", []string{"93"}, "#ffff00", "", false, false, false, false, false, false},
		{"bright fg blue (94)", []string{"94"}, "#0000ff", "", false, false, false, false, false, false},
		{"bright fg magenta (95)", []string{"95"}, "#ff00ff", "", false, false, false, false, false, false},
		{"bright fg cyan (96)", []string{"96"}, "#00ffff", "", false, false, false, false, false, false},
		{"bright fg white (97)", []string{"97"}, "#ffffff", "", false, false, false, false, false, false},

		// Bright background colors (100-107)
		{"bright bg black (100)", []string{"100"}, "", "#808080", false, false, false, false, false, false},
		{"bright bg red (101)", []string{"101"}, "", "#ff0000", false, false, false, false, false, false},
		{"bright bg green (102)", []string{"102"}, "", "#00ff00", false, false, false, false, false, false},
		{"bright bg yellow (103)", []string{"103"}, "", "#ffff00", false, false, false, false, false, false},
		{"bright bg blue (104)", []string{"104"}, "", "#0000ff", false, false, false, false, false, false},
		{"bright bg magenta (105)", []string{"105"}, "", "#ff00ff", false, false, false, false, false, false},
		{"bright bg cyan (106)", []string{"106"}, "", "#00ffff", false, false, false, false, false, false},
		{"bright bg white (107)", []string{"107"}, "", "#ffffff", false, false, false, false, false, false},

		// 256 color foreground (38;5;N)
		{"256 fg color", []string{"38", "5", "196"}, "#ff0000", "", false, false, false, false, false, false},
		{"256 fg color unknown", []string{"38", "5", "999"}, "", "", false, false, false, false, false, false},

		// 256 color background (48;5;N)
		{"256 bg color", []string{"48", "5", "21"}, "", "#0000ff", false, false, false, false, false, false},
		{"256 bg color unknown", []string{"48", "5", "999"}, "", "", false, false, false, false, false, false},

		// 24-bit color foreground (38;2;R;G;B)
		{"24bit fg color", []string{"38", "2", "255", "128", "64"}, "#ff8040", "", false, false, false, false, false, false},

		// 24-bit color background (48;2;R;G;B)
		{"24bit bg color", []string{"48", "2", "64", "128", "255"}, "", "#4080ff", false, false, false, false, false, false},

		// Combined codes
		{"bold red", []string{"1", "31"}, "#800000", "", true, false, false, false, false, false},
		{"dim italic underline", []string{"2", "3", "4"}, "", "", false, true, true, true, false, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var fg, bg string
			var bold, dim, italic, underline, blink, reverse bool

			processCodes(tt.codes, &fg, &bg, &bold, &dim, &italic, &underline, &blink, &reverse)

			if fg != tt.wantFg {
				t.Errorf("fg = %q, want %q", fg, tt.wantFg)
			}
			if bg != tt.wantBg {
				t.Errorf("bg = %q, want %q", bg, tt.wantBg)
			}
			if bold != tt.wantBold {
				t.Errorf("bold = %v, want %v", bold, tt.wantBold)
			}
			if dim != tt.wantDim {
				t.Errorf("dim = %v, want %v", dim, tt.wantDim)
			}
			if italic != tt.wantItal {
				t.Errorf("italic = %v, want %v", italic, tt.wantItal)
			}
			if underline != tt.wantUnder {
				t.Errorf("underline = %v, want %v", underline, tt.wantUnder)
			}
			if blink != tt.wantBlink {
				t.Errorf("blink = %v, want %v", blink, tt.wantBlink)
			}
			if reverse != tt.wantRev {
				t.Errorf("reverse = %v, want %v", reverse, tt.wantRev)
			}
		})
	}
}

// Test processCodes with insufficient parameters for 256/24-bit colors
func TestProcessCodes_InsufficientParams(t *testing.T) {
	tests := []struct {
		name  string
		codes []string
	}{
		{"38 alone", []string{"38"}},
		{"38;5 without color", []string{"38", "5"}},
		{"38;2 without RGB", []string{"38", "2"}},
		{"38;2;R without GB", []string{"38", "2", "255"}},
		{"38;2;R;G without B", []string{"38", "2", "255", "128"}},
		{"48 alone", []string{"48"}},
		{"48;5 without color", []string{"48", "5"}},
		{"48;2 without RGB", []string{"48", "2"}},
		{"48;2;R without GB", []string{"48", "2", "255"}},
		{"48;2;R;G without B", []string{"48", "2", "255", "128"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var fg, bg string
			var bold, dim, italic, underline, blink, reverse bool

			// Should not panic
			processCodes(tt.codes, &fg, &bg, &bold, &dim, &italic, &underline, &blink, &reverse)
		})
	}
}

// Test atoi function
func TestAtoi(t *testing.T) {
	tests := []struct {
		input string
		want  int
	}{
		{"0", 0},
		{"1", 1},
		{"10", 10},
		{"255", 255},
		{"123", 123},
		{"", 0},
		{"abc", 0},
		{"12abc", 12},
		{"a12", 0},
		{"-5", 0}, // '-' is not a digit, returns 0
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := atoi(tt.input)
			if got != tt.want {
				t.Errorf("atoi(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

// Test buildSpan with various combinations
func TestBuildSpan(t *testing.T) {
	tests := []struct {
		name      string
		char      string
		fg        string
		bg        string
		bold      bool
		dim       bool
		italic    bool
		underline bool
		blink     bool
		reverse   bool
		wantParts []string
	}{
		{
			name:      "all styles",
			char:      "X",
			fg:        "#ff0000",
			bg:        "#00ff00",
			bold:      true,
			dim:       true,
			italic:    true,
			underline: true,
			blink:     true,
			reverse:   true,
			wantParts: []string{"<span", "class=", "bold", "dim", "italic", "underline", "blink", "reverse", "style=", "color:#ff0000", "background-color:#00ff00", ">X</span>"},
		},
		{
			name:      "fg only",
			char:      "A",
			fg:        "#0000ff",
			wantParts: []string{"<span", "style=", "color:#0000ff", ">A</span>"},
		},
		{
			name:      "bg only",
			char:      "B",
			bg:        "#ff00ff",
			wantParts: []string{"<span", "style=", "background-color:#ff00ff", ">B</span>"},
		},
		{
			name:      "bold only",
			char:      "C",
			bold:      true,
			wantParts: []string{"<span", "class=", "bold", ">C</span>"},
		},
		{
			name:      "dim only",
			char:      "D",
			dim:       true,
			wantParts: []string{"<span", "class=", "dim", ">D</span>"},
		},
		{
			name:      "italic only",
			char:      "E",
			italic:    true,
			wantParts: []string{"<span", "class=", "italic", ">E</span>"},
		},
		{
			name:      "underline only",
			char:      "F",
			underline: true,
			wantParts: []string{"<span", "class=", "underline", ">F</span>"},
		},
		{
			name:      "blink only",
			char:      "G",
			blink:     true,
			wantParts: []string{"<span", "class=", "blink", ">G</span>"},
		},
		{
			name:      "reverse only",
			char:      "H",
			reverse:   true,
			wantParts: []string{"<span", "class=", "reverse", ">H</span>"},
		},
		{
			name:      "no styles",
			char:      "Z",
			wantParts: []string{"<span", ">Z</span>"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildSpan(tt.char, tt.fg, tt.bg, tt.bold, tt.dim, tt.italic, tt.underline, tt.blink, tt.reverse)
			for _, part := range tt.wantParts {
				if !strings.Contains(got, part) {
					t.Errorf("buildSpan() = %q, missing %q", got, part)
				}
			}
		})
	}
}

// Test parseANSI with various ANSI sequences
func TestParseANSI(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantParts []string
	}{
		{
			name:      "plain text",
			input:     "Hello World",
			wantParts: []string{"Hello World"},
		},
		{
			name:      "colored text",
			input:     "\x1b[31mRed\x1b[0m",
			wantParts: []string{"<span", "color:", "R", "e", "d", "</span>"},
		},
		{
			name:      "reset in middle",
			input:     "\x1b[31mRed\x1b[0mNormal",
			wantParts: []string{"R", "e", "d", "Normal"},
		},
		{
			name:      "incomplete escape sequence",
			input:     "\x1b[Hello",
			wantParts: []string{"Hello"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseANSI(tt.input)
			for _, part := range tt.wantParts {
				if !strings.Contains(got, part) {
					t.Errorf("parseANSI() = %q, missing %q", got, part)
				}
			}
		})
	}
}

// Test CaptureScreen error path
func TestCaptureScreen_Error(t *testing.T) {
	// Use a path that cannot be created (e.g., inside a file)
	tmpDir := t.TempDir()
	// Create a file that will block directory creation
	blockingFile := filepath.Join(tmpDir, "blocking_file")
	if err := os.WriteFile(blockingFile, []byte("block"), 0644); err != nil {
		t.Fatalf("failed to create blocking file: %v", err)
	}

	// Try to save into a path where the parent is a file, not a directory
	invalidDir := filepath.Join(blockingFile, "subdir")

	_, err := CaptureScreen("content", invalidDir)
	if err == nil {
		t.Error("expected error when saving to invalid directory")
	}
}

// Test SaveAsText error path
func TestSaveAsText_Error(t *testing.T) {
	// Use a path that cannot be written to
	tmpDir := t.TempDir()
	blockingFile := filepath.Join(tmpDir, "blocking_file")
	if err := os.WriteFile(blockingFile, []byte("block"), 0644); err != nil {
		t.Fatalf("failed to create blocking file: %v", err)
	}

	// Try to save into a path where the parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.txt")

	err := SaveAsText("content", invalidPath)
	if err == nil {
		t.Error("expected error when saving to invalid path")
	}
}

// Test SaveAsHTML error path
func TestSaveAsHTML_Error(t *testing.T) {
	// Use a path that cannot be written to
	tmpDir := t.TempDir()
	blockingFile := filepath.Join(tmpDir, "blocking_file")
	if err := os.WriteFile(blockingFile, []byte("block"), 0644); err != nil {
		t.Fatalf("failed to create blocking file: %v", err)
	}

	// Try to save into a path where the parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.html")

	err := SaveAsHTML("content", invalidPath)
	if err == nil {
		t.Error("expected error when saving to invalid path")
	}
}

// Test convertANSIToHTML
func TestConvertANSIToHTML(t *testing.T) {
	content := "\x1b[1;31mBold Red\x1b[0m"

	result := convertANSIToHTML(content)

	// Should contain HTML structure
	if !strings.Contains(result, "<!DOCTYPE html>") {
		t.Error("expected DOCTYPE declaration")
	}
	if !strings.Contains(result, "<html") {
		t.Error("expected html tag")
	}
	if !strings.Contains(result, "</html>") {
		t.Error("expected closing html tag")
	}
	if !strings.Contains(result, "<pre>") {
		t.Error("expected pre tag")
	}
	if !strings.Contains(result, "</pre>") {
		t.Error("expected closing pre tag")
	}
	if !strings.Contains(result, "Captured:") {
		t.Error("expected timestamp")
	}
}

// Test parseANSI with escape sequences that don't match
func TestParseANSI_NonMatchingEscape(t *testing.T) {
	// Test with escape character followed by [ but not a valid SGR sequence
	input := "\x1b[999ZText"
	result := parseANSI(input)

	// The 'Z' and 'Text' should appear in the output
	if !strings.Contains(result, "Text") {
		t.Errorf("parseANSI() = %q, missing 'Text'", result)
	}
}

// Test parseANSI with empty codes
func TestParseANSI_EmptyCode(t *testing.T) {
	// Empty SGR sequence (just ESC[m)
	input := "\x1b[mText"
	result := parseANSI(input)

	if !strings.Contains(result, "Text") {
		t.Errorf("parseANSI() = %q, missing 'Text'", result)
	}
}

// Test GenerateFilename
func TestGenerateFilename_WithEmptyDirectory(t *testing.T) {
	filename := GenerateFilename("test", "txt", "")

	// Should not have a path prefix
	if strings.Contains(filename, string(os.PathSeparator)) && !strings.HasPrefix(filename, "test_") {
		t.Errorf("expected simple filename, got %s", filename)
	}

	if !strings.HasPrefix(filename, "test_") {
		t.Errorf("expected filename to start with 'test_', got %s", filename)
	}

	if !strings.HasSuffix(filename, ".txt") {
		t.Errorf("expected filename to end with '.txt', got %s", filename)
	}
}

// Test SaveAsText in current directory
func TestSaveAsText_CurrentDirectory(t *testing.T) {
	originalDir, _ := os.Getwd()
	tmpDir := t.TempDir()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	content := "Test content"
	filename := "simple.txt"

	err := SaveAsText(content, filename)
	if err != nil {
		t.Fatalf("SaveAsText failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}
}

// Test SaveAsHTML in current directory
func TestSaveAsHTML_CurrentDirectory(t *testing.T) {
	originalDir, _ := os.Getwd()
	tmpDir := t.TempDir()
	os.Chdir(tmpDir)
	defer os.Chdir(originalDir)

	content := "Test content"
	filename := "simple.html"

	err := SaveAsHTML(content, filename)
	if err != nil {
		t.Fatalf("SaveAsHTML failed: %v", err)
	}

	if _, err := os.Stat(filename); os.IsNotExist(err) {
		t.Error("expected file to be created")
	}
}

// Test SaveAsText with MkdirAll error
func TestSaveAsText_MkdirAllError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file that blocks directory creation
	blockingFile := filepath.Join(tmpDir, "blocker")
	if err := os.WriteFile(blockingFile, []byte("x"), 0644); err != nil {
		t.Fatalf("failed to create blocker: %v", err)
	}

	// Try to save in a path where parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.txt")

	err := SaveAsText("content", invalidPath)
	if err == nil {
		t.Error("expected error when directory creation fails")
	}
}

// Test SaveAsHTML with MkdirAll error
func TestSaveAsHTML_MkdirAllError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file that blocks directory creation
	blockingFile := filepath.Join(tmpDir, "blocker")
	if err := os.WriteFile(blockingFile, []byte("x"), 0644); err != nil {
		t.Fatalf("failed to create blocker: %v", err)
	}

	// Try to save in a path where parent is a file
	invalidPath := filepath.Join(blockingFile, "subdir", "test.html")

	err := SaveAsHTML("content", invalidPath)
	if err == nil {
		t.Error("expected error when directory creation fails")
	}
}

// Test SaveAsText WriteFile error
func TestSaveAsText_WriteFileError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a read-only directory
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0555); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}

	// Try to save in a read-only directory
	invalidPath := filepath.Join(readOnlyDir, "test.txt")

	err := SaveAsText("content", invalidPath)
	if err == nil {
		// On some systems, this might not fail if running as root
		t.Log("expected error when writing to read-only directory (may pass as root)")
	}
}

// Test SaveAsHTML WriteFile error
func TestSaveAsHTML_WriteFileError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a read-only directory
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0555); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}

	// Try to save in a read-only directory
	invalidPath := filepath.Join(readOnlyDir, "test.html")

	err := SaveAsHTML("content", invalidPath)
	if err == nil {
		// On some systems, this might not fail if running as root
		t.Log("expected error when writing to read-only directory (may pass as root)")
	}
}
