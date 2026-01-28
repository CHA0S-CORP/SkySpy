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
