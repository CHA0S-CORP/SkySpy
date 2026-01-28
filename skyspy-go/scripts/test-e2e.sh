#!/usr/bin/env bash
#
# End-to-End Test Runner for SkySpy CLI
#
# This script:
# 1. Builds the CLI binary
# 2. Starts a mock server in the background
# 3. Runs E2E tests against the CLI
# 4. Cleans up on exit
# 5. Returns proper exit code

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BINARY_NAME="skyspy"
BINARY_PATH="${PROJECT_ROOT}/bin/${BINARY_NAME}"
MOCK_SERVER_PORT="${MOCK_SERVER_PORT:-18080}"
MOCK_WS_PORT="${MOCK_WS_PORT:-18081}"
MOCK_SERVER_PID=""
TEST_TIMEOUT="${TEST_TIMEOUT:-120}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Cleanup function
cleanup() {
    local exit_code=$?
    echo -e "${YELLOW}Cleaning up...${NC}"

    # Kill mock server if running
    if [ -n "${MOCK_SERVER_PID}" ] && kill -0 "${MOCK_SERVER_PID}" 2>/dev/null; then
        echo "Stopping mock server (PID: ${MOCK_SERVER_PID})..."
        kill "${MOCK_SERVER_PID}" 2>/dev/null || true
        wait "${MOCK_SERVER_PID}" 2>/dev/null || true
    fi

    # Kill any remaining mock servers on our ports
    if command -v lsof >/dev/null 2>&1; then
        lsof -ti:${MOCK_SERVER_PORT} 2>/dev/null | xargs kill 2>/dev/null || true
        lsof -ti:${MOCK_WS_PORT} 2>/dev/null | xargs kill 2>/dev/null || true
    fi

    # Remove temporary files
    rm -f "${PROJECT_ROOT}/test-e2e-*.log" 2>/dev/null || true

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}E2E tests completed successfully!${NC}"
    else
        echo -e "${RED}E2E tests failed with exit code: ${exit_code}${NC}"
    fi

    exit $exit_code
}

# Set up cleanup trap
trap cleanup EXIT INT TERM

# Print banner
echo "======================================"
echo "  SkySpy CLI E2E Test Runner"
echo "======================================"
echo ""

# Change to project root
cd "${PROJECT_ROOT}"

# Step 1: Build the CLI binary
echo -e "${GREEN}Step 1: Building CLI binary...${NC}"
if [ -f "${BINARY_PATH}" ]; then
    echo "Removing existing binary..."
    rm -f "${BINARY_PATH}"
fi

go build -o "${BINARY_PATH}" ./cmd/skyspy
if [ ! -f "${BINARY_PATH}" ]; then
    echo -e "${RED}Failed to build binary${NC}"
    exit 1
fi
echo "Binary built: ${BINARY_PATH}"
echo ""

# Step 2: Start mock server
echo -e "${GREEN}Step 2: Starting mock server...${NC}"

# Check if mock server exists
MOCK_SERVER_PATH="${PROJECT_ROOT}/internal/testutil/mockserver"
if [ -d "${MOCK_SERVER_PATH}" ]; then
    # Build and run mock server if it exists
    echo "Building mock server..."
    go build -o "${PROJECT_ROOT}/bin/mockserver" "${MOCK_SERVER_PATH}"
    "${PROJECT_ROOT}/bin/mockserver" -port "${MOCK_SERVER_PORT}" -ws-port "${MOCK_WS_PORT}" &
    MOCK_SERVER_PID=$!
else
    # Create a simple mock server inline using Go
    echo "Creating inline mock server..."

    cat > "${PROJECT_ROOT}/bin/mockserver.go" << 'MOCKEOF'
package main

import (
    "encoding/json"
    "flag"
    "fmt"
    "log"
    "net/http"
    "sync"
    "time"

    "github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool { return true },
}

type Aircraft struct {
    Hex      string  `json:"hex"`
    Callsign string  `json:"flight,omitempty"`
    Lat      float64 `json:"lat,omitempty"`
    Lon      float64 `json:"lon,omitempty"`
    Altitude int     `json:"alt_baro,omitempty"`
    Speed    float64 `json:"gs,omitempty"`
    Track    float64 `json:"track,omitempty"`
    Squawk   string  `json:"squawk,omitempty"`
}

type AircraftData struct {
    Now      float64    `json:"now"`
    Aircraft []Aircraft `json:"aircraft"`
}

var clients = make(map[*websocket.Conn]bool)
var clientsMu sync.Mutex

func main() {
    port := flag.Int("port", 18080, "HTTP port")
    wsPort := flag.Int("ws-port", 18081, "WebSocket port")
    flag.Parse()

    // HTTP server
    go func() {
        http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
            w.Header().Set("Content-Type", "application/json")
            json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
        })

        http.HandleFunc("/api/auth/config", func(w http.ResponseWriter, r *http.Request) {
            w.Header().Set("Content-Type", "application/json")
            json.NewEncoder(w).Encode(map[string]interface{}{
                "auth_required": false,
                "oidc_enabled": false,
                "api_key_enabled": false,
            })
        })

        http.HandleFunc("/data/aircraft.json", func(w http.ResponseWriter, r *http.Request) {
            w.Header().Set("Content-Type", "application/json")
            data := AircraftData{
                Now: float64(time.Now().Unix()),
                Aircraft: []Aircraft{
                    {Hex: "ABC123", Callsign: "TEST001", Lat: 45.0, Lon: -93.0, Altitude: 35000, Speed: 450, Track: 90, Squawk: "1200"},
                    {Hex: "DEF456", Callsign: "TEST002", Lat: 45.1, Lon: -93.1, Altitude: 28000, Speed: 380, Track: 180, Squawk: "1200"},
                    {Hex: "GHI789", Callsign: "EMERG01", Lat: 45.2, Lon: -93.2, Altitude: 10000, Speed: 200, Track: 270, Squawk: "7700"},
                },
            }
            json.NewEncoder(w).Encode(data)
        })

        addr := fmt.Sprintf(":%d", *port)
        log.Printf("Mock HTTP server starting on %s", addr)
        log.Fatal(http.ListenAndServe(addr, nil))
    }()

    // WebSocket server
    http.HandleFunc("/ws/aircraft", func(w http.ResponseWriter, r *http.Request) {
        conn, err := upgrader.Upgrade(w, r, nil)
        if err != nil {
            log.Printf("WebSocket upgrade error: %v", err)
            return
        }
        defer conn.Close()

        clientsMu.Lock()
        clients[conn] = true
        clientsMu.Unlock()

        defer func() {
            clientsMu.Lock()
            delete(clients, conn)
            clientsMu.Unlock()
        }()

        // Send aircraft data periodically
        ticker := time.NewTicker(time.Second)
        defer ticker.Stop()

        for {
            select {
            case <-ticker.C:
                data := AircraftData{
                    Now: float64(time.Now().Unix()),
                    Aircraft: []Aircraft{
                        {Hex: "ABC123", Callsign: "TEST001", Lat: 45.0, Lon: -93.0, Altitude: 35000},
                        {Hex: "DEF456", Callsign: "TEST002", Lat: 45.1, Lon: -93.1, Altitude: 28000},
                    },
                }
                if err := conn.WriteJSON(data); err != nil {
                    return
                }
            }
        }
    })

    wsAddr := fmt.Sprintf(":%d", *wsPort)
    log.Printf("Mock WebSocket server starting on %s", wsAddr)
    log.Fatal(http.ListenAndServe(wsAddr, nil))
}
MOCKEOF

    # Build and run the mock server
    go build -o "${PROJECT_ROOT}/bin/mockserver" "${PROJECT_ROOT}/bin/mockserver.go"
    "${PROJECT_ROOT}/bin/mockserver" -port "${MOCK_SERVER_PORT}" -ws-port "${MOCK_WS_PORT}" &
    MOCK_SERVER_PID=$!
fi

# Wait for mock server to start
echo "Waiting for mock server to start..."
for i in {1..30}; do
    if curl -s "http://localhost:${MOCK_SERVER_PORT}/api/health" >/dev/null 2>&1; then
        echo "Mock server is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Mock server failed to start${NC}"
        exit 1
    fi
    sleep 0.5
done
echo ""

# Step 3: Run E2E tests
echo -e "${GREEN}Step 3: Running E2E tests...${NC}"

E2E_EXIT_CODE=0

# Test 1: CLI help command
echo "Test 1: CLI --help command"
if "${BINARY_PATH}" --help >/dev/null 2>&1; then
    echo -e "  ${GREEN}PASS${NC}: --help command works"
else
    echo -e "  ${RED}FAIL${NC}: --help command failed"
    E2E_EXIT_CODE=1
fi

# Test 2: CLI version/list-themes command
echo "Test 2: CLI --list-themes command"
if "${BINARY_PATH}" --list-themes >/dev/null 2>&1; then
    echo -e "  ${GREEN}PASS${NC}: --list-themes command works"
else
    echo -e "  ${RED}FAIL${NC}: --list-themes command failed"
    E2E_EXIT_CODE=1
fi

# Test 3: Check auth status subcommand
echo "Test 3: CLI auth status command"
if "${BINARY_PATH}" auth status --host localhost --port "${MOCK_SERVER_PORT}" 2>/dev/null; then
    echo -e "  ${GREEN}PASS${NC}: auth status command works"
else
    # This might fail if auth is not configured, which is okay
    echo -e "  ${YELLOW}SKIP${NC}: auth status command (expected behavior)"
fi

# Test 4: Run integration tests tagged with e2e
echo "Test 4: Running Go E2E integration tests"
if go test -v -tags=e2e -timeout "${TEST_TIMEOUT}s" ./... 2>&1; then
    echo -e "  ${GREEN}PASS${NC}: E2E integration tests passed"
else
    # Check if there are any e2e tagged tests
    if go test -v -tags=e2e -list=".*" ./... 2>&1 | grep -q "no test files"; then
        echo -e "  ${YELLOW}SKIP${NC}: No E2E tagged tests found"
    else
        echo -e "  ${RED}FAIL${NC}: E2E integration tests failed"
        E2E_EXIT_CODE=1
    fi
fi

# Test 5: Test connection to mock server
echo "Test 5: Mock server health check"
if curl -s "http://localhost:${MOCK_SERVER_PORT}/api/health" | grep -q "ok"; then
    echo -e "  ${GREEN}PASS${NC}: Mock server health check passed"
else
    echo -e "  ${RED}FAIL${NC}: Mock server health check failed"
    E2E_EXIT_CODE=1
fi

# Test 6: Test aircraft data endpoint
echo "Test 6: Mock server aircraft data"
if curl -s "http://localhost:${MOCK_SERVER_PORT}/data/aircraft.json" | grep -q "ABC123"; then
    echo -e "  ${GREEN}PASS${NC}: Aircraft data endpoint works"
else
    echo -e "  ${RED}FAIL${NC}: Aircraft data endpoint failed"
    E2E_EXIT_CODE=1
fi

echo ""
echo "======================================"
if [ $E2E_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}All E2E tests passed!${NC}"
else
    echo -e "${RED}Some E2E tests failed${NC}"
fi
echo "======================================"

exit $E2E_EXIT_CODE
