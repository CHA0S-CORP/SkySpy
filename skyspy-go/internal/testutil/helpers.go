package testutil

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// WaitForCondition waits until the condition function returns true or times out
func WaitForCondition(fn func() bool, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	interval := 10 * time.Millisecond

	// Adjust interval based on timeout for more responsive checks
	if timeout < 100*time.Millisecond {
		interval = 1 * time.Millisecond
	} else if timeout < 1*time.Second {
		interval = 5 * time.Millisecond
	} else if timeout > 10*time.Second {
		interval = 50 * time.Millisecond
	}

	for time.Now().Before(deadline) {
		if fn() {
			return nil
		}
		time.Sleep(interval)
	}

	return fmt.Errorf("condition not met within %v timeout", timeout)
}

// WaitForConditionWithMessage waits until the condition function returns true or times out,
// including a custom message in the error
func WaitForConditionWithMessage(fn func() bool, timeout time.Duration, message string) error {
	err := WaitForCondition(fn, timeout)
	if err != nil {
		return fmt.Errorf("%s: %w", message, err)
	}
	return nil
}

// CaptureOutput captures stdout during the execution of the provided function
func CaptureOutput(fn func()) string {
	// Save the original stdout
	oldStdout := os.Stdout

	// Create a pipe to capture output
	r, w, err := os.Pipe()
	if err != nil {
		return ""
	}

	// Replace stdout with our pipe
	os.Stdout = w

	// Channel to receive captured output
	outCh := make(chan string)
	go func() {
		var buf bytes.Buffer
		io.Copy(&buf, r)
		outCh <- buf.String()
	}()

	// Execute the function
	fn()

	// Restore stdout and close the write end of the pipe
	os.Stdout = oldStdout
	w.Close()

	// Get the captured output
	return <-outCh
}

// CaptureStderr captures stderr during the execution of the provided function
func CaptureStderr(fn func()) string {
	oldStderr := os.Stderr

	r, w, err := os.Pipe()
	if err != nil {
		return ""
	}

	os.Stderr = w

	outCh := make(chan string)
	go func() {
		var buf bytes.Buffer
		io.Copy(&buf, r)
		outCh <- buf.String()
	}()

	fn()

	os.Stderr = oldStderr
	w.Close()

	return <-outCh
}

// CaptureAllOutput captures both stdout and stderr
func CaptureAllOutput(fn func()) (stdout, stderr string) {
	oldStdout := os.Stdout
	oldStderr := os.Stderr

	stdoutR, stdoutW, _ := os.Pipe()
	stderrR, stderrW, _ := os.Pipe()

	os.Stdout = stdoutW
	os.Stderr = stderrW

	stdoutCh := make(chan string)
	stderrCh := make(chan string)

	go func() {
		var buf bytes.Buffer
		io.Copy(&buf, stdoutR)
		stdoutCh <- buf.String()
	}()

	go func() {
		var buf bytes.Buffer
		io.Copy(&buf, stderrR)
		stderrCh <- buf.String()
	}()

	fn()

	os.Stdout = oldStdout
	os.Stderr = oldStderr
	stdoutW.Close()
	stderrW.Close()

	return <-stdoutCh, <-stderrCh
}

// TempConfigDir creates a temporary config directory and returns the path
// and a cleanup function. The cleanup function removes the directory.
func TempConfigDir() (string, func()) {
	dir, err := os.MkdirTemp("", "skyspy-test-config-*")
	if err != nil {
		// If we can't create a temp dir, return a path that won't exist
		return "/tmp/skyspy-test-nonexistent", func() {}
	}

	// Create the nested structure that SkySpy expects
	configDir := filepath.Join(dir, ".config", "skyspy")
	credsDir := filepath.Join(configDir, "credentials")
	os.MkdirAll(credsDir, 0700)

	cleanup := func() {
		os.RemoveAll(dir)
	}

	return dir, cleanup
}

// TempConfigDirWithEnv creates a temporary config directory and sets
// the HOME environment variable to point to it
func TempConfigDirWithEnv() (string, func()) {
	dir, cleanup := TempConfigDir()

	oldHome := os.Getenv("HOME")
	os.Setenv("HOME", dir)

	return dir, func() {
		os.Setenv("HOME", oldHome)
		cleanup()
	}
}

// AssertContains fails the test if haystack does not contain needle
func AssertContains(t *testing.T, haystack, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Errorf("expected string to contain %q, but it didn't.\nFull string:\n%s", needle, haystack)
	}
}

// AssertNotContains fails the test if haystack contains needle
func AssertNotContains(t *testing.T, haystack, needle string) {
	t.Helper()
	if strings.Contains(haystack, needle) {
		t.Errorf("expected string to NOT contain %q, but it did.\nFull string:\n%s", needle, haystack)
	}
}

// AssertEqual fails the test if expected != actual
func AssertEqual(t *testing.T, expected, actual interface{}) {
	t.Helper()
	if expected != actual {
		t.Errorf("expected %v, got %v", expected, actual)
	}
}

// AssertNotEqual fails the test if expected == actual
func AssertNotEqual(t *testing.T, expected, actual interface{}) {
	t.Helper()
	if expected == actual {
		t.Errorf("expected values to be different, but both were %v", expected)
	}
}

// AssertNil fails the test if value is not nil
func AssertNil(t *testing.T, value interface{}) {
	t.Helper()
	if value != nil {
		t.Errorf("expected nil, got %v", value)
	}
}

// AssertNotNil fails the test if value is nil
func AssertNotNil(t *testing.T, value interface{}) {
	t.Helper()
	if value == nil {
		t.Error("expected non-nil value, got nil")
	}
}

// AssertNoError fails the test if err is not nil
func AssertNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

// AssertError fails the test if err is nil
func AssertError(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Error("expected an error, got nil")
	}
}

// AssertErrorContains fails the test if err is nil or doesn't contain the message
func AssertErrorContains(t *testing.T, err error, message string) {
	t.Helper()
	if err == nil {
		t.Errorf("expected an error containing %q, got nil", message)
		return
	}
	if !strings.Contains(err.Error(), message) {
		t.Errorf("expected error to contain %q, got: %v", message, err)
	}
}

// AssertTrue fails the test if condition is false
func AssertTrue(t *testing.T, condition bool, message string) {
	t.Helper()
	if !condition {
		t.Errorf("expected true: %s", message)
	}
}

// AssertFalse fails the test if condition is true
func AssertFalse(t *testing.T, condition bool, message string) {
	t.Helper()
	if condition {
		t.Errorf("expected false: %s", message)
	}
}

// AssertLen fails the test if the slice/map/string doesn't have the expected length
func AssertLen(t *testing.T, obj interface{}, expected int) {
	t.Helper()
	var actual int
	switch v := obj.(type) {
	case string:
		actual = len(v)
	case []interface{}:
		actual = len(v)
	case []Aircraft:
		actual = len(v)
	case []ACARSMessage:
		actual = len(v)
	case []ReceivedMessage:
		actual = len(v)
	case map[string]interface{}:
		actual = len(v)
	default:
		t.Errorf("AssertLen: unsupported type %T", obj)
		return
	}
	if actual != expected {
		t.Errorf("expected length %d, got %d", expected, actual)
	}
}

// AssertContainsAll fails the test if haystack doesn't contain all needles
func AssertContainsAll(t *testing.T, haystack string, needles ...string) {
	t.Helper()
	for _, needle := range needles {
		if !strings.Contains(haystack, needle) {
			t.Errorf("expected string to contain %q, but it didn't.\nFull string:\n%s", needle, haystack)
		}
	}
}

// AssertContainsAny fails the test if haystack doesn't contain any of the needles
func AssertContainsAny(t *testing.T, haystack string, needles ...string) {
	t.Helper()
	for _, needle := range needles {
		if strings.Contains(haystack, needle) {
			return
		}
	}
	t.Errorf("expected string to contain at least one of %v, but it didn't.\nFull string:\n%s", needles, haystack)
}

// RequireNoError fails the test immediately if err is not nil
func RequireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// RequireEqual fails the test immediately if expected != actual
func RequireEqual(t *testing.T, expected, actual interface{}) {
	t.Helper()
	if expected != actual {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}

// Eventually retries the assertion function until it succeeds or times out
func Eventually(t *testing.T, fn func() bool, timeout, interval time.Duration, message string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(interval)
	}
	t.Errorf("condition not met within %v: %s", timeout, message)
}

// Never asserts that a condition never becomes true within the timeout
func Never(t *testing.T, fn func() bool, timeout, interval time.Duration, message string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			t.Errorf("condition became true within %v (should have stayed false): %s", timeout, message)
			return
		}
		time.Sleep(interval)
	}
}

// WithTimeout runs a function with a timeout, returning an error if it times out
func WithTimeout(fn func(), timeout time.Duration) error {
	done := make(chan struct{})
	go func() {
		fn()
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-time.After(timeout):
		return fmt.Errorf("function timed out after %v", timeout)
	}
}

// FreePort returns an available TCP port (best effort, may race)
func FreePort() int {
	// Start from a random port in the dynamic range
	basePort := 49152 + int(time.Now().UnixNano()%1000)

	for port := basePort; port < 65535; port++ {
		// Try to use the port with a quick check
		// Note: This is racy but good enough for tests
		if isPortAvailable(port) {
			return port
		}
	}

	// Fallback to a random port in a different range
	return 30000 + int(time.Now().UnixNano()%10000)
}

// isPortAvailable checks if a port is likely available
func isPortAvailable(port int) bool {
	// For simplicity, we just try common test port ranges
	// In a real scenario, we'd try to bind to the port
	return port > 1024 && port < 65535
}

// SetEnv sets an environment variable and returns a cleanup function
func SetEnv(key, value string) func() {
	oldValue, hadOld := os.LookupEnv(key)
	os.Setenv(key, value)

	return func() {
		if hadOld {
			os.Setenv(key, oldValue)
		} else {
			os.Unsetenv(key)
		}
	}
}

// UnsetEnv unsets an environment variable and returns a cleanup function
func UnsetEnv(key string) func() {
	oldValue, hadOld := os.LookupEnv(key)
	os.Unsetenv(key)

	return func() {
		if hadOld {
			os.Setenv(key, oldValue)
		}
	}
}

// TempFile creates a temporary file with the given content and returns its path
// and a cleanup function
func TempFile(content string) (string, func()) {
	f, err := os.CreateTemp("", "skyspy-test-*")
	if err != nil {
		return "", func() {}
	}

	f.WriteString(content)
	f.Close()

	return f.Name(), func() {
		os.Remove(f.Name())
	}
}

// TempFileWithName creates a temporary file with a specific name in a temp directory
func TempFileWithName(name, content string) (string, func()) {
	dir, err := os.MkdirTemp("", "skyspy-test-*")
	if err != nil {
		return "", func() {}
	}

	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		os.RemoveAll(dir)
		return "", func() {}
	}

	return path, func() {
		os.RemoveAll(dir)
	}
}

// MockTime provides a controllable time source for testing
type MockTime struct {
	current time.Time
}

// NewMockTime creates a new MockTime starting at the given time
func NewMockTime(start time.Time) *MockTime {
	return &MockTime{current: start}
}

// Now returns the current mock time
func (m *MockTime) Now() time.Time {
	return m.current
}

// Advance moves the mock time forward by the given duration
func (m *MockTime) Advance(d time.Duration) {
	m.current = m.current.Add(d)
}

// Set sets the mock time to a specific value
func (m *MockTime) Set(t time.Time) {
	m.current = t
}

// RetryFunc retries a function until it succeeds or max attempts are reached
func RetryFunc(fn func() error, maxAttempts int, delay time.Duration) error {
	var lastErr error
	for i := 0; i < maxAttempts; i++ {
		if err := fn(); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if i < maxAttempts-1 {
			time.Sleep(delay)
		}
	}
	return fmt.Errorf("failed after %d attempts: %w", maxAttempts, lastErr)
}

// PollUntil polls a function until it returns true or times out
func PollUntil(fn func() bool, timeout time.Duration) bool {
	return WaitForCondition(fn, timeout) == nil
}

// StringPtr returns a pointer to a string
func StringPtr(s string) *string {
	return &s
}

// IntPtr returns a pointer to an int
func IntPtr(i int) *int {
	return &i
}

// Float64Ptr returns a pointer to a float64
func Float64Ptr(f float64) *float64 {
	return &f
}

// BoolPtr returns a pointer to a bool
func BoolPtr(b bool) *bool {
	return &b
}
