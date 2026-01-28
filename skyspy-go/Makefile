# SkySpy Go CLI Makefile
# Build, test, and development automation

# Binary name
BINARY_NAME := skyspy
BINARY_DIR := bin

# Go parameters
GOCMD := go
GOBUILD := $(GOCMD) build
GOTEST := $(GOCMD) test
GOVET := $(GOCMD) vet
GOFMT := gofmt
GOMOD := $(GOCMD) mod
GOGET := $(GOCMD) get

# Main package path
MAIN_PACKAGE := ./cmd/skyspy

# Build flags
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
LDFLAGS := -ldflags "-X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.buildTime=$(BUILD_TIME)"

# Test flags
COVERAGE_DIR := coverage
COVERAGE_FILE := $(COVERAGE_DIR)/coverage.out
COVERAGE_HTML := $(COVERAGE_DIR)/coverage.html

# Platforms for cross-compilation
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64

# Colors for output
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m

.PHONY: all build build-all test test-unit test-integration test-coverage test-race test-bench \
        lint vet fmt fmt-check run clean deps ci help install

# Default target
all: build

## Build targets

# Build the CLI binary for current platform
build:
	@echo "$(GREEN)Building $(BINARY_NAME)...$(NC)"
	@mkdir -p $(BINARY_DIR)
	$(GOBUILD) $(LDFLAGS) -o $(BINARY_DIR)/$(BINARY_NAME) $(MAIN_PACKAGE)
	@echo "$(GREEN)Built $(BINARY_DIR)/$(BINARY_NAME)$(NC)"

# Build for all platforms (linux, darwin, windows - amd64 and arm64)
build-all:
	@echo "$(GREEN)Building for all platforms...$(NC)"
	@mkdir -p $(BINARY_DIR)
	@for platform in $(PLATFORMS); do \
		GOOS=$${platform%/*}; \
		GOARCH=$${platform#*/}; \
		output="$(BINARY_DIR)/$(BINARY_NAME)-$${GOOS}-$${GOARCH}"; \
		if [ "$${GOOS}" = "windows" ]; then \
			output="$${output}.exe"; \
		fi; \
		echo "Building $${output}..."; \
		GOOS=$${GOOS} GOARCH=$${GOARCH} $(GOBUILD) $(LDFLAGS) -o $${output} $(MAIN_PACKAGE); \
	done
	@echo "$(GREEN)All binaries built in $(BINARY_DIR)/$(NC)"

# Install binary to GOPATH/bin
install:
	@echo "$(GREEN)Installing $(BINARY_NAME)...$(NC)"
	$(GOBUILD) $(LDFLAGS) -o $(GOPATH)/bin/$(BINARY_NAME) $(MAIN_PACKAGE)
	@echo "$(GREEN)Installed to $(GOPATH)/bin/$(BINARY_NAME)$(NC)"

## Test targets

# Run all tests
test:
	@echo "$(GREEN)Running all tests...$(NC)"
	$(GOTEST) -v ./...

# Run unit tests only (exclude integration tests)
test-unit:
	@echo "$(GREEN)Running unit tests...$(NC)"
	$(GOTEST) -v -short ./...

# Run integration tests only
test-integration:
	@echo "$(GREEN)Running integration tests...$(NC)"
	$(GOTEST) -v -run Integration ./...

# Run tests with coverage report
test-coverage:
	@echo "$(GREEN)Running tests with coverage...$(NC)"
	@mkdir -p $(COVERAGE_DIR)
	$(GOTEST) -v -coverprofile=$(COVERAGE_FILE) -covermode=atomic ./...
	$(GOCMD) tool cover -html=$(COVERAGE_FILE) -o $(COVERAGE_HTML)
	$(GOCMD) tool cover -func=$(COVERAGE_FILE)
	@echo "$(GREEN)Coverage report: $(COVERAGE_HTML)$(NC)"

# Run tests with race detector
test-race:
	@echo "$(GREEN)Running tests with race detector...$(NC)"
	$(GOTEST) -v -race ./...

# Run benchmarks
test-bench:
	@echo "$(GREEN)Running benchmarks...$(NC)"
	$(GOTEST) -v -bench=. -benchmem ./...

# Run E2E tests
test-e2e:
	@echo "$(GREEN)Running E2E tests...$(NC)"
	@chmod +x scripts/test-e2e.sh
	./scripts/test-e2e.sh

## Quality targets

# Run golangci-lint
lint:
	@echo "$(GREEN)Running linter...$(NC)"
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run ./...; \
	else \
		echo "$(YELLOW)golangci-lint not installed. Install with: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest$(NC)"; \
		exit 1; \
	fi

# Run go vet
vet:
	@echo "$(GREEN)Running go vet...$(NC)"
	$(GOVET) ./...

# Run go fmt
fmt:
	@echo "$(GREEN)Running go fmt...$(NC)"
	$(GOFMT) -w -s .

# Check formatting without modifying files
fmt-check:
	@echo "$(GREEN)Checking formatting...$(NC)"
	@if [ -n "$$($(GOFMT) -l .)" ]; then \
		echo "$(RED)The following files need formatting:$(NC)"; \
		$(GOFMT) -l .; \
		exit 1; \
	fi
	@echo "$(GREEN)All files properly formatted$(NC)"

## Development targets

# Build and run the CLI
run: build
	@echo "$(GREEN)Running $(BINARY_NAME)...$(NC)"
	./$(BINARY_DIR)/$(BINARY_NAME)

# Remove build artifacts
clean:
	@echo "$(GREEN)Cleaning build artifacts...$(NC)"
	@rm -rf $(BINARY_DIR)
	@rm -rf $(COVERAGE_DIR)
	@rm -f $(BINARY_NAME)
	@echo "$(GREEN)Clean complete$(NC)"

# Download dependencies
deps:
	@echo "$(GREEN)Downloading dependencies...$(NC)"
	$(GOMOD) download
	$(GOMOD) tidy
	@echo "$(GREEN)Dependencies up to date$(NC)"

# Verify dependencies
deps-verify:
	@echo "$(GREEN)Verifying dependencies...$(NC)"
	$(GOMOD) verify
	@echo "$(GREEN)Dependencies verified$(NC)"

## CI target

# Run all checks (used in CI pipeline)
ci: deps fmt-check vet lint test-race test-coverage
	@echo "$(GREEN)All CI checks passed$(NC)"

## Utility targets

# Generate mocks (if using mockgen)
mocks:
	@echo "$(GREEN)Generating mocks...$(NC)"
	@if command -v mockgen >/dev/null 2>&1; then \
		go generate ./...; \
	else \
		echo "$(YELLOW)mockgen not installed. Install with: go install github.com/golang/mock/mockgen@latest$(NC)"; \
	fi

# Update dependencies to latest versions
update:
	@echo "$(GREEN)Updating dependencies...$(NC)"
	$(GOGET) -u ./...
	$(GOMOD) tidy

# Show help
help:
	@echo "SkySpy Go CLI Makefile"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Build targets:"
	@echo "  build        Build the CLI binary for current platform"
	@echo "  build-all    Build for all platforms (linux, darwin, windows)"
	@echo "  install      Install binary to GOPATH/bin"
	@echo ""
	@echo "Test targets:"
	@echo "  test              Run all tests"
	@echo "  test-unit         Run unit tests only (excludes integration tests)"
	@echo "  test-integration  Run integration tests only"
	@echo "  test-coverage     Run tests with coverage report"
	@echo "  test-race         Run tests with race detector"
	@echo "  test-bench        Run benchmarks"
	@echo "  test-e2e          Run end-to-end tests"
	@echo ""
	@echo "Quality targets:"
	@echo "  lint         Run golangci-lint"
	@echo "  vet          Run go vet"
	@echo "  fmt          Run go fmt (modifies files)"
	@echo "  fmt-check    Check formatting without modifying files"
	@echo ""
	@echo "Development targets:"
	@echo "  run          Build and run the CLI"
	@echo "  clean        Remove build artifacts"
	@echo "  deps         Download and tidy dependencies"
	@echo "  deps-verify  Verify dependencies"
	@echo "  update       Update dependencies to latest versions"
	@echo "  mocks        Generate mocks (requires mockgen)"
	@echo ""
	@echo "CI targets:"
	@echo "  ci           Run all checks (fmt-check, vet, lint, test-race, test-coverage)"
	@echo ""
	@echo "Other:"
	@echo "  help         Show this help message"
