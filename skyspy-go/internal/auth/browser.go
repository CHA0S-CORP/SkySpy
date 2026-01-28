package auth

import (
	"fmt"
	"os/exec"
	"runtime"
)

// OpenBrowser opens the default web browser to the specified URL
func OpenBrowser(url string) error {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		// Try xdg-open first, then common browsers
		if _, err := exec.LookPath("xdg-open"); err == nil {
			cmd = exec.Command("xdg-open", url)
		} else if _, err := exec.LookPath("x-www-browser"); err == nil {
			cmd = exec.Command("x-www-browser", url)
		} else if _, err := exec.LookPath("sensible-browser"); err == nil {
			cmd = exec.Command("sensible-browser", url)
		} else if _, err := exec.LookPath("firefox"); err == nil {
			cmd = exec.Command("firefox", url)
		} else if _, err := exec.LookPath("chromium-browser"); err == nil {
			cmd = exec.Command("chromium-browser", url)
		} else if _, err := exec.LookPath("google-chrome"); err == nil {
			cmd = exec.Command("google-chrome", url)
		} else {
			return fmt.Errorf("no browser found - please open this URL manually:\n%s", url)
		}
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	default:
		return fmt.Errorf("unsupported platform - please open this URL manually:\n%s", url)
	}

	return cmd.Start()
}

// CanOpenBrowser returns true if we can open a browser on this system
func CanOpenBrowser() bool {
	switch runtime.GOOS {
	case "darwin", "windows":
		return true
	case "linux":
		browsers := []string{"xdg-open", "x-www-browser", "sensible-browser", "firefox", "chromium-browser", "google-chrome"}
		for _, browser := range browsers {
			if _, err := exec.LookPath(browser); err == nil {
				return true
			}
		}
		return false
	default:
		return false
	}
}
