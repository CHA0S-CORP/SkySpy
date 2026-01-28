# Testing Guide for SkySpy Go CLI

This document describes how to run tests, the test structure, and how to add new tests to the SkySpy Go CLI project.

## Table of Contents

- [Quick Start](#quick-start)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Coverage Requirements](#coverage-requirements)
- [CI/CD Pipeline](#cicd-pipeline)
- [Troubleshooting](#troubleshooting)

## Quick Start

```bash
# Run all tests
make test

# Run tests with coverage
make test-coverage

# Run the full CI pipeline locally
make ci
```

## Test Structure

The test files are organized alongside their corresponding source files following Go conventions:

```
skyspy-go/
├── cmd/
│   └── skyspy/
│       └── main.go
├── internal/
│   ├── alerts/
│   │   ├── engine.go
│   │   ├── engine_test.go      # Unit tests for alert engine
│   │   ├── geofence.go
│   │   ├── geofence_test.go    # Unit tests for geofencing
│   │   ├── rules.go
│   │   └── rules_test.go       # Unit tests for alert rules
│   ├── geo/
│   │   ├── kml.go
│   │   ├── kml_test.go         # Unit tests for KML parsing
│   │   ├── shapefile.go
│   │   └── shapefile_test.go   # Unit tests for shapefile parsing
│   ├── trails/
│   │   ├── tracker.go
│   │   └── tracker_test.go     # Unit tests for trail tracking
│   └── ...
├── scripts/
│   └── test-e2e.sh             # End-to-end test runner
└── coverage/                    # Generated coverage reports
```

### Test Categories

1. **Unit Tests**: Test individual functions and methods in isolation
   - Located in `*_test.go` files alongside source files
   - Run with `make test-unit`

2. **Integration Tests**: Test component interactions
   - Use the `Integration` prefix in test names
   - Run with `make test-integration`

3. **End-to-End Tests**: Test the complete CLI workflow
   - Run with `make test-e2e`
   - Use build tag `//go:build e2e`

4. **Benchmarks**: Performance tests
   - Use `Benchmark` prefix in function names
   - Run with `make test-bench`

## Running Tests

### Basic Test Commands

```bash
# Run all tests
make test

# Run unit tests only (fast, excludes integration tests)
make test-unit

# Run integration tests only
make test-integration

# Run tests with race detector (catches data races)
make test-race

# Run tests with coverage report
make test-coverage
# Opens coverage/coverage.html for detailed view

# Run benchmarks
make test-bench

# Run end-to-end tests
make test-e2e
```

### Using Go Directly

```bash
# Run all tests
go test ./...

# Run tests in a specific package
go test ./internal/alerts/...

# Run a specific test
go test -run TestAlertEngine ./internal/alerts/

# Run tests with verbose output
go test -v ./...

# Run tests with coverage
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out

# Run with race detector
go test -race ./...

# Run benchmarks
go test -bench=. -benchmem ./...
```

### Test Flags

| Flag | Description |
|------|-------------|
| `-v` | Verbose output |
| `-race` | Enable race detector |
| `-short` | Run only short tests (unit tests) |
| `-cover` | Enable coverage analysis |
| `-coverprofile=file` | Write coverage to file |
| `-run regex` | Run only matching tests |
| `-bench regex` | Run matching benchmarks |
| `-benchmem` | Print memory allocation stats |
| `-timeout duration` | Test timeout (default 10m) |
| `-count n` | Run tests n times |
| `-parallel n` | Allow parallel test execution |

## Writing Tests

### Unit Test Template

```go
package mypackage

import (
    "testing"
)

func TestFunctionName(t *testing.T) {
    // Arrange
    input := "test input"
    expected := "expected output"

    // Act
    result := FunctionName(input)

    // Assert
    if result != expected {
        t.Errorf("FunctionName(%q) = %q, want %q", input, result, expected)
    }
}
```

### Table-Driven Tests

This project uses table-driven tests for comprehensive coverage:

```go
func TestMatchesWildcard(t *testing.T) {
    tests := []struct {
        name     string
        pattern  string
        value    string
        expected bool
    }{
        {"exact match", "7700", "7700", true},
        {"prefix wildcard", "77*", "7700", true},
        {"suffix wildcard", "*00", "7700", true},
        {"no match", "77*", "7600", false},
        {"empty pattern", "", "TEST", false},
    }

    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            result := MatchesWildcard(tc.pattern, tc.value)
            if result != tc.expected {
                t.Errorf("MatchesWildcard(%q, %q) = %v, want %v",
                    tc.pattern, tc.value, result, tc.expected)
            }
        })
    }
}
```

### Integration Tests

```go
func TestIntegrationAlertEngine(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping integration test in short mode")
    }

    // Integration test code here
}
```

### E2E Tests (Build Tagged)

```go
//go:build e2e

package e2e

import (
    "testing"
)

func TestE2EFullWorkflow(t *testing.T) {
    // End-to-end test code here
}
```

### Benchmarks

```go
func BenchmarkAlertEngine(b *testing.B) {
    engine := NewAlertEngineWithDefaults()
    state := &AircraftState{
        Hex:      "TEST01",
        Callsign: "TEST001",
        Squawk:   "1200",
    }

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        engine.CheckAircraft(state, nil)
    }
}
```

### Test Helpers

Create test helpers in a `testutil` package or as unexported functions in test files:

```go
// internal/testutil/testutil.go
package testutil

import (
    "os"
    "testing"
)

// CreateTempFile creates a temporary file for testing
func CreateTempFile(t *testing.T, content string) string {
    t.Helper()

    f, err := os.CreateTemp("", "test_*")
    if err != nil {
        t.Fatalf("Failed to create temp file: %v", err)
    }

    if _, err := f.WriteString(content); err != nil {
        f.Close()
        os.Remove(f.Name())
        t.Fatalf("Failed to write temp file: %v", err)
    }

    f.Close()

    t.Cleanup(func() {
        os.Remove(f.Name())
    })

    return f.Name()
}
```

### Mocking

For testing components with external dependencies, use interfaces and mock implementations:

```go
// Define interface
type WebSocketClient interface {
    Connect(url string) error
    Send(data []byte) error
    Receive() ([]byte, error)
    Close() error
}

// Mock implementation for testing
type MockWebSocketClient struct {
    ConnectFunc func(url string) error
    SendFunc    func(data []byte) error
    ReceiveFunc func() ([]byte, error)
    CloseFunc   func() error
}

func (m *MockWebSocketClient) Connect(url string) error {
    if m.ConnectFunc != nil {
        return m.ConnectFunc(url)
    }
    return nil
}
// ... other methods
```

## Coverage Requirements

### Minimum Coverage Targets

| Package | Minimum Coverage |
|---------|------------------|
| `internal/alerts` | 80% |
| `internal/geo` | 75% |
| `internal/trails` | 80% |
| `internal/config` | 70% |
| Overall | 70% |

### Checking Coverage

```bash
# Generate coverage report
make test-coverage

# View coverage in terminal
go tool cover -func=coverage/coverage.out

# View detailed HTML report
open coverage/coverage.html
```

### Improving Coverage

1. Identify uncovered code:
   ```bash
   go tool cover -html=coverage/coverage.out
   ```

2. Focus on:
   - Error handling paths
   - Edge cases
   - Branch conditions
   - Public API functions

## CI/CD Pipeline

### GitHub Actions Workflow

The CI pipeline runs on every push to `main` and on all pull requests:

1. **Test Job** (Matrix: Go 1.21, 1.22 on Ubuntu and macOS)
   - Checkout code
   - Set up Go with module caching
   - Download dependencies
   - Run golangci-lint
   - Run `go vet`
   - Check code formatting
   - Run tests with race detector
   - Run tests with coverage
   - Upload coverage to Codecov

2. **Build Job** (after tests pass)
   - Build binary for current platform
   - Cross-compile for all platforms
   - Upload build artifacts

### Running CI Locally

```bash
# Run the full CI pipeline locally
make ci

# This runs:
# - deps (download dependencies)
# - fmt-check (check formatting)
# - vet (run go vet)
# - lint (run golangci-lint)
# - test-race (tests with race detector)
# - test-coverage (tests with coverage)
```

### Release Pipeline

Triggered on version tags (`v*`):

1. Run tests
2. Build binaries for all platforms
3. Create checksums
4. Generate changelog
5. Create GitHub release with assets
6. Build and push Docker image

## Troubleshooting

### Common Issues

#### Tests Timeout

```bash
# Increase timeout
go test -timeout 5m ./...
```

#### Race Detector Issues

```bash
# Race conditions are often in concurrent code
# Look for shared state without proper synchronization
go test -race -v ./... 2>&1 | grep -A 10 "WARNING: DATA RACE"
```

#### Coverage Not Generating

```bash
# Make sure coverage directory exists
mkdir -p coverage

# Run with explicit output file
go test -coverprofile=coverage/coverage.out ./...
```

#### Linter Failures

```bash
# See specific linter errors
golangci-lint run --verbose ./...

# Fix auto-fixable issues
golangci-lint run --fix ./...
```

### Getting Help

- Check existing test files for examples
- Run tests with `-v` for verbose output
- Use `t.Log()` for debugging test output
- Check the CI logs for failures in the pipeline

## Best Practices

1. **Keep tests fast**: Unit tests should run in milliseconds
2. **Test one thing per test**: Each test should verify one behavior
3. **Use descriptive names**: `TestAlertEngine_EmergencySquawk_TriggersAlert`
4. **Avoid test interdependence**: Tests should run in any order
5. **Clean up resources**: Use `t.Cleanup()` for deferred cleanup
6. **Use `t.Helper()`**: Mark helper functions for better error reporting
7. **Test error cases**: Verify error handling works correctly
8. **Use subtests**: Group related tests with `t.Run()`
9. **Benchmark critical paths**: Identify performance issues early
10. **Keep coverage high**: Aim for at least 70% coverage
