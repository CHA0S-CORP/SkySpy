package auth

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"
)

// CallbackServer is a local HTTP server that handles OIDC callbacks
type CallbackServer struct {
	port       int
	server     *http.Server
	listener   net.Listener
	resultCh   chan CallbackResult
	shutdownCh chan struct{}
	wg         sync.WaitGroup
}

// CallbackResult contains the result of an OIDC callback
type CallbackResult struct {
	Code  string
	State string
	Error string
}

// NewCallbackServer creates a new callback server
func NewCallbackServer() (*CallbackServer, error) {
	// Find an available port in the range 8400-8500
	var listener net.Listener
	var err error
	var port int

	for p := 8400; p <= 8500; p++ {
		listener, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			port = p
			break
		}
	}

	if listener == nil {
		return nil, fmt.Errorf("could not find available port in range 8400-8500")
	}

	return &CallbackServer{
		port:       port,
		listener:   listener,
		resultCh:   make(chan CallbackResult, 1),
		shutdownCh: make(chan struct{}),
	}, nil
}

// Port returns the port the server is listening on
func (s *CallbackServer) Port() int {
	return s.port
}

// RedirectURI returns the full redirect URI for OIDC
func (s *CallbackServer) RedirectURI() string {
	return fmt.Sprintf("http://127.0.0.1:%d/callback", s.port)
}

// Start starts the callback server
func (s *CallbackServer) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", s.handleCallback)
	mux.HandleFunc("/", s.handleRoot)

	s.server = &http.Server{
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		if err := s.server.Serve(s.listener); err != http.ErrServerClosed {
			// Log error but don't fail - server might be intentionally closed
		}
	}()

	return nil
}

// WaitForCallback waits for the OIDC callback with a timeout
func (s *CallbackServer) WaitForCallback(ctx context.Context, timeout time.Duration) (*CallbackResult, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case result := <-s.resultCh:
		if result.Error != "" {
			return nil, fmt.Errorf("authentication error: %s", result.Error)
		}
		return &result, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("authentication timed out")
	case <-s.shutdownCh:
		return nil, fmt.Errorf("server shutdown")
	}
}

// Stop stops the callback server
func (s *CallbackServer) Stop() error {
	close(s.shutdownCh)
	if s.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.server.Shutdown(ctx); err != nil {
			return err
		}
	}
	s.wg.Wait()
	return nil
}

func (s *CallbackServer) handleCallback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	// Check for error response
	if errMsg := query.Get("error"); errMsg != "" {
		errDesc := query.Get("error_description")
		if errDesc != "" {
			errMsg = errMsg + ": " + errDesc
		}
		s.resultCh <- CallbackResult{Error: errMsg}
		s.renderError(w, errMsg)
		return
	}

	code := query.Get("code")
	state := query.Get("state")

	if code == "" {
		s.resultCh <- CallbackResult{Error: "no authorization code received"}
		s.renderError(w, "No authorization code received")
		return
	}

	s.resultCh <- CallbackResult{
		Code:  code,
		State: state,
	}

	s.renderSuccess(w)
}

func (s *CallbackServer) handleRoot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, `<!DOCTYPE html>
<html>
<head>
    <title>SkySpy Authentication</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
        }
        .container { text-align: center; }
        h1 { color: #00d4aa; }
    </style>
</head>
<body>
    <div class="container">
        <h1>SkySpy Authentication Server</h1>
        <p>Waiting for authentication callback...</p>
    </div>
</body>
</html>`)
}

func (s *CallbackServer) renderSuccess(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, `<!DOCTYPE html>
<html>
<head>
    <title>SkySpy - Authentication Successful</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
        }
        .container { text-align: center; padding: 40px; }
        .icon {
            font-size: 72px;
            margin-bottom: 20px;
            animation: pulse 1s ease-in-out;
        }
        @keyframes pulse {
            0% { transform: scale(0); opacity: 0; }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); opacity: 1; }
        }
        h1 { color: #00ff88; margin-bottom: 10px; }
        p { color: #8892b0; font-size: 16px; }
        .hint {
            margin-top: 30px;
            padding: 15px 25px;
            background: rgba(0, 255, 136, 0.1);
            border-radius: 8px;
            border: 1px solid rgba(0, 255, 136, 0.3);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✓</div>
        <h1>Authentication Successful</h1>
        <p>You have been successfully authenticated.</p>
        <div class="hint">
            <p>You can close this window and return to the terminal.</p>
        </div>
    </div>
    <script>
        // Auto-close after 3 seconds
        setTimeout(function() {
            window.close();
        }, 3000);
    </script>
</body>
</html>`)
}

func (s *CallbackServer) renderError(w http.ResponseWriter, errorMsg string) {
	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusBadRequest)
	fmt.Fprintf(w, `<!DOCTYPE html>
<html>
<head>
    <title>SkySpy - Authentication Failed</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a2e 0%%, #16213e 100%%);
            color: #fff;
        }
        .container { text-align: center; padding: 40px; }
        .icon { font-size: 72px; margin-bottom: 20px; }
        h1 { color: #ff4444; margin-bottom: 10px; }
        p { color: #8892b0; font-size: 16px; }
        .error {
            margin-top: 20px;
            padding: 15px 25px;
            background: rgba(255, 68, 68, 0.1);
            border-radius: 8px;
            border: 1px solid rgba(255, 68, 68, 0.3);
            color: #ff6b6b;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✗</div>
        <h1>Authentication Failed</h1>
        <p>An error occurred during authentication.</p>
        <div class="error">
            <p>%s</p>
        </div>
        <p style="margin-top: 20px;">Please close this window and try again.</p>
    </div>
</body>
</html>`, errorMsg)
}
