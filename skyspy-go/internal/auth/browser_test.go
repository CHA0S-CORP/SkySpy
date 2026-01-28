package auth

import (
	"runtime"
	"testing"
)

func TestOpenBrowser(t *testing.T) {
	// Test with a valid URL - we can't fully test browser opening,
	// but we can verify it doesn't panic and handles the platform correctly
	url := "http://example.com/test"

	// We just test that it doesn't panic - actual browser opening
	// behavior depends on the system state
	err := OpenBrowser(url)

	// On some systems without display (CI), this might fail, which is expected
	// We're mainly testing that the function runs without panicking
	switch runtime.GOOS {
	case "darwin", "windows", "linux":
		// These platforms are supported, error might occur if no browser is available
		// but the code path was executed
		_ = err // Acknowledge we're not checking the error in this case
	default:
		// Unsupported platforms should return an error
		if err == nil {
			t.Error("expected error for unsupported platform")
		}
	}
}

func TestCanOpenBrowser(t *testing.T) {
	result := CanOpenBrowser()

	switch runtime.GOOS {
	case "darwin", "windows":
		// These platforms always return true
		if !result {
			t.Errorf("expected CanOpenBrowser to return true on %s", runtime.GOOS)
		}
	case "linux":
		// On Linux, it depends on whether a browser is available
		// We just verify it doesn't panic and returns a boolean
		_ = result
	default:
		// Unsupported platforms should return false
		if result {
			t.Errorf("expected CanOpenBrowser to return false on unsupported platform %s", runtime.GOOS)
		}
	}
}

func TestOpenBrowser_URLFormats(t *testing.T) {
	testURLs := []string{
		"http://localhost:8080/callback",
		"https://auth.example.com/authorize?client_id=test",
		"http://127.0.0.1:8400/callback?code=abc&state=xyz",
	}

	for _, url := range testURLs {
		// We're testing that different URL formats don't cause issues
		_ = OpenBrowser(url)
	}
}
