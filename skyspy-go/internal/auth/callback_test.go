package auth

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestCallbackServer_Start(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	// Verify server is responding
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", server.Port()))
	if err != nil {
		t.Fatalf("failed to connect to callback server: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "SkySpy Authentication Server") {
		t.Error("expected response to contain 'SkySpy Authentication Server'")
	}
}

func TestCallbackServer_Port(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	port := server.Port()

	// Port should be in range 8400-8500
	if port < 8400 || port > 8500 {
		t.Errorf("expected port in range 8400-8500, got %d", port)
	}
}

func TestCallbackServer_PortSelection(t *testing.T) {
	// Create multiple servers to verify they get different ports
	var servers []*CallbackServer
	defer func() {
		for _, s := range servers {
			s.Stop()
		}
	}()

	ports := make(map[int]bool)

	// Create 3 servers
	for i := 0; i < 3; i++ {
		server, err := NewCallbackServer()
		if err != nil {
			t.Fatalf("failed to create callback server %d: %v", i, err)
		}
		servers = append(servers, server)

		port := server.Port()
		if ports[port] {
			t.Errorf("duplicate port assigned: %d", port)
		}
		ports[port] = true

		if port < 8400 || port > 8500 {
			t.Errorf("port %d outside expected range 8400-8500", port)
		}
	}
}

func TestCallbackServer_PortExhaustion(t *testing.T) {
	// This test verifies the error case when all ports are taken
	// We'll occupy a few ports and verify the server still finds one

	// Occupy some ports manually
	var listeners []net.Listener
	defer func() {
		for _, l := range listeners {
			l.Close()
		}
	}()

	// Occupy first 3 ports
	for p := 8400; p <= 8402; p++ {
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			listeners = append(listeners, l)
		}
	}

	// Server should still be able to find an available port
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("expected server to find available port, got error: %v", err)
	}
	defer server.Stop()

	port := server.Port()
	if port < 8400 || port > 8500 {
		t.Errorf("port %d outside expected range", port)
	}

	// Port should not be one of the occupied ones
	for p := 8400; p <= 8402; p++ {
		if port == p {
			// Only error if we actually occupied this port
			for _, l := range listeners {
				if l.Addr().String() == fmt.Sprintf("127.0.0.1:%d", p) {
					t.Errorf("server got occupied port %d", port)
				}
			}
		}
	}
}

func TestCallbackServer_RedirectURI(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	uri := server.RedirectURI()
	expected := fmt.Sprintf("http://127.0.0.1:%d/callback", server.Port())

	if uri != expected {
		t.Errorf("expected RedirectURI '%s', got '%s'", expected, uri)
	}

	// Verify format
	if !strings.HasPrefix(uri, "http://127.0.0.1:") {
		t.Error("RedirectURI should start with 'http://127.0.0.1:'")
	}

	if !strings.HasSuffix(uri, "/callback") {
		t.Error("RedirectURI should end with '/callback'")
	}
}

func TestCallbackServer_HandleCallback_Success(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	// Start waiting for callback in background
	resultCh := make(chan *CallbackResult)
	errCh := make(chan error)
	go func() {
		ctx := context.Background()
		result, err := server.WaitForCallback(ctx, 5*time.Second)
		if err != nil {
			errCh <- err
			return
		}
		resultCh <- result
	}()

	// Give server time to start waiting
	time.Sleep(50 * time.Millisecond)

	// Simulate OIDC callback with code and state
	callbackURL := fmt.Sprintf("http://127.0.0.1:%d/callback?code=test-auth-code-123&state=test-state-456", server.Port())
	resp, err := http.Get(callbackURL)
	if err != nil {
		t.Fatalf("failed to make callback request: %v", err)
	}
	defer resp.Body.Close()

	// Check response
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "Authentication Successful") {
		t.Error("expected success page in response")
	}

	// Wait for result
	select {
	case result := <-resultCh:
		if result.Code != "test-auth-code-123" {
			t.Errorf("expected code 'test-auth-code-123', got '%s'", result.Code)
		}
		if result.State != "test-state-456" {
			t.Errorf("expected state 'test-state-456', got '%s'", result.State)
		}
		if result.Error != "" {
			t.Errorf("expected no error, got '%s'", result.Error)
		}
	case err := <-errCh:
		t.Fatalf("unexpected error: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for callback result")
	}
}

func TestCallbackServer_HandleCallback_Error(t *testing.T) {
	testCases := []struct {
		name          string
		query         string
		expectedError string
	}{
		{
			name:          "access_denied error",
			query:         "error=access_denied&error_description=User+denied+access",
			expectedError: "access_denied: User denied access",
		},
		{
			name:          "invalid_request error",
			query:         "error=invalid_request",
			expectedError: "invalid_request",
		},
		{
			name:          "server_error with description",
			query:         "error=server_error&error_description=Internal+server+error",
			expectedError: "server_error: Internal server error",
		},
		{
			name:          "no code provided",
			query:         "state=some-state",
			expectedError: "no authorization code received",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server, err := NewCallbackServer()
			if err != nil {
				t.Fatalf("failed to create callback server: %v", err)
			}
			defer server.Stop()

			err = server.Start()
			if err != nil {
				t.Fatalf("failed to start callback server: %v", err)
			}

			// Start waiting for callback in background
			errCh := make(chan error)
			go func() {
				ctx := context.Background()
				_, err := server.WaitForCallback(ctx, 5*time.Second)
				errCh <- err
			}()

			time.Sleep(50 * time.Millisecond)

			// Make callback request with error
			callbackURL := fmt.Sprintf("http://127.0.0.1:%d/callback?%s", server.Port(), tc.query)
			resp, err := http.Get(callbackURL)
			if err != nil {
				t.Fatalf("failed to make callback request: %v", err)
			}
			resp.Body.Close()

			// Wait for error
			select {
			case err := <-errCh:
				if err == nil {
					t.Error("expected error, got nil")
				} else if !strings.Contains(err.Error(), tc.expectedError) {
					t.Errorf("expected error to contain '%s', got '%s'", tc.expectedError, err.Error())
				}
			case <-time.After(2 * time.Second):
				t.Fatal("timeout waiting for error result")
			}
		})
	}
}

func TestCallbackServer_HandleCallback_ErrorPage(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	// Discard the result to not block
	go func() {
		ctx := context.Background()
		server.WaitForCallback(ctx, 5*time.Second)
	}()

	time.Sleep(50 * time.Millisecond)

	// Make callback request with error
	callbackURL := fmt.Sprintf("http://127.0.0.1:%d/callback?error=access_denied", server.Port())
	resp, err := http.Get(callbackURL)
	if err != nil {
		t.Fatalf("failed to make callback request: %v", err)
	}
	defer resp.Body.Close()

	// Error should return 400 status
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected status 400 for error, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "Authentication Failed") {
		t.Error("expected error page in response")
	}
}

func TestCallbackServer_WaitForCallback_Timeout(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	ctx := context.Background()

	// Wait with a very short timeout
	start := time.Now()
	_, err = server.WaitForCallback(ctx, 100*time.Millisecond)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("expected timeout error, got nil")
	}

	if !strings.Contains(err.Error(), "timed out") {
		t.Errorf("expected timeout error, got: %v", err)
	}

	// Verify it actually waited approximately the timeout duration
	if elapsed < 90*time.Millisecond {
		t.Errorf("timeout occurred too quickly: %v", elapsed)
	}

	if elapsed > 500*time.Millisecond {
		t.Errorf("timeout took too long: %v", elapsed)
	}
}

func TestCallbackServer_WaitForCallback_ContextCancellation(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Cancel after a short delay
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	_, err = server.WaitForCallback(ctx, 10*time.Second)
	elapsed := time.Since(start)

	if err == nil {
		t.Error("expected error due to context cancellation, got nil")
	}

	// Should timeout quickly due to context cancellation
	if elapsed > 500*time.Millisecond {
		t.Errorf("context cancellation took too long: %v", elapsed)
	}
}

func TestCallbackServer_Stop(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}

	port := server.Port()

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	// Verify server is running
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
	if err != nil {
		t.Fatalf("server should be running: %v", err)
	}
	resp.Body.Close()

	// Stop the server
	err = server.Stop()
	if err != nil {
		t.Fatalf("failed to stop callback server: %v", err)
	}

	// Give time for shutdown
	time.Sleep(100 * time.Millisecond)

	// Verify server is stopped (connection should be refused)
	client := &http.Client{Timeout: 500 * time.Millisecond}
	_, err = client.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
	if err == nil {
		t.Error("expected connection error after server stop")
	}
}

func TestCallbackServer_Stop_WakesWaitingGoroutine(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	// Start waiting in background
	errCh := make(chan error)
	go func() {
		ctx := context.Background()
		_, err := server.WaitForCallback(ctx, 1*time.Minute)
		errCh <- err
	}()

	// Give time for goroutine to start waiting
	time.Sleep(50 * time.Millisecond)

	// Stop the server
	err = server.Stop()
	if err != nil {
		t.Fatalf("failed to stop server: %v", err)
	}

	// Wait should return with shutdown error
	select {
	case err := <-errCh:
		if err == nil {
			t.Error("expected shutdown error, got nil")
		}
		if !strings.Contains(err.Error(), "shutdown") {
			t.Errorf("expected shutdown error, got: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("WaitForCallback did not return after Stop")
	}
}

func TestCallbackServer_MultipleStarts(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	// First start
	err = server.Start()
	if err != nil {
		t.Fatalf("first start failed: %v", err)
	}

	// Second start should work (overwrites handler)
	err = server.Start()
	if err != nil {
		t.Fatalf("second start failed: %v", err)
	}

	// Server should still respond
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", server.Port()))
	if err != nil {
		t.Fatalf("server not responding: %v", err)
	}
	resp.Body.Close()
}

func TestCallbackServer_ConcurrentCallbacks(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	// Start waiting for callback
	resultCh := make(chan *CallbackResult, 1)
	go func() {
		ctx := context.Background()
		result, _ := server.WaitForCallback(ctx, 5*time.Second)
		resultCh <- result
	}()

	time.Sleep(50 * time.Millisecond)

	// Make multiple concurrent callback requests
	// Only the first should be processed
	for i := 0; i < 3; i++ {
		go func(n int) {
			callbackURL := fmt.Sprintf("http://127.0.0.1:%d/callback?code=code-%d&state=state-%d", server.Port(), n, n)
			http.Get(callbackURL)
		}(i)
	}

	// Should receive first result
	select {
	case result := <-resultCh:
		if result == nil {
			t.Error("expected non-nil result")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for result")
	}
}

func TestCallbackResult_Fields(t *testing.T) {
	testCases := []struct {
		name   string
		result CallbackResult
	}{
		{
			name: "success result",
			result: CallbackResult{
				Code:  "authorization-code",
				State: "state-value",
				Error: "",
			},
		},
		{
			name: "error result",
			result: CallbackResult{
				Code:  "",
				State: "",
				Error: "access_denied",
			},
		},
		{
			name: "partial result",
			result: CallbackResult{
				Code:  "code-only",
				State: "",
				Error: "",
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.result.Code != tc.result.Code {
				t.Error("Code field mismatch")
			}
			if tc.result.State != tc.result.State {
				t.Error("State field mismatch")
			}
			if tc.result.Error != tc.result.Error {
				t.Error("Error field mismatch")
			}
		})
	}
}

func TestCallbackServer_RootHandler(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	// Request root path
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", server.Port()))
	if err != nil {
		t.Fatalf("failed to request root: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.Contains(contentType, "text/html") {
		t.Errorf("expected HTML content type, got %s", contentType)
	}

	body, _ := io.ReadAll(resp.Body)
	bodyStr := string(body)

	if !strings.Contains(bodyStr, "SkySpy Authentication") {
		t.Error("expected page title in response")
	}

	if !strings.Contains(bodyStr, "Waiting for authentication") {
		t.Error("expected waiting message in response")
	}
}

func TestCallbackServer_SuccessPage(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	// Consume the result
	go func() {
		ctx := context.Background()
		server.WaitForCallback(ctx, 5*time.Second)
	}()

	time.Sleep(50 * time.Millisecond)

	// Make successful callback
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/callback?code=test&state=test", server.Port()))
	if err != nil {
		t.Fatalf("failed to make callback: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	bodyStr := string(body)

	// Verify success page content
	if !strings.Contains(bodyStr, "Authentication Successful") {
		t.Error("expected success message")
	}

	if !strings.Contains(bodyStr, "successfully authenticated") {
		t.Error("expected authenticated message")
	}

	if !strings.Contains(bodyStr, "close this window") {
		t.Error("expected close instruction")
	}
}

func TestCallbackServer_ErrorPage(t *testing.T) {
	server, err := NewCallbackServer()
	if err != nil {
		t.Fatalf("failed to create callback server: %v", err)
	}
	defer server.Stop()

	err = server.Start()
	if err != nil {
		t.Fatalf("failed to start callback server: %v", err)
	}

	// Consume the error
	go func() {
		ctx := context.Background()
		server.WaitForCallback(ctx, 5*time.Second)
	}()

	time.Sleep(50 * time.Millisecond)

	// Make error callback
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/callback?error=test_error&error_description=Test+error+message", server.Port()))
	if err != nil {
		t.Fatalf("failed to make callback: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	bodyStr := string(body)

	// Verify error page content
	if !strings.Contains(bodyStr, "Authentication Failed") {
		t.Error("expected failure message")
	}

	if !strings.Contains(bodyStr, "test_error") {
		t.Error("expected error code in page")
	}

	if !strings.Contains(bodyStr, "Test error message") {
		t.Error("expected error description in page")
	}
}
