.PHONY: test test-docker test-local test-verbose clean build help test-cli test-common test-python install-cli lint lint-python lint-go lint-frontend

# Default target
help:
	@echo "SkySpy Test Commands:"
	@echo ""
	@echo "  make test          - Run tests in Docker (recommended)"
	@echo "  make test-cli      - Run CLI package tests"
	@echo "  make test-common   - Run common package tests"
	@echo "  make test-python   - Run all Python package tests (CLI + common)"
	@echo "  make lint          - Run all linters (Python + Go + Frontend)"
	@echo "  make lint-python   - Run Python linter (ruff)"
	@echo "  make lint-go       - Run Go linter (go vet)"
	@echo "  make lint-frontend - Run frontend linter (eslint)"
	@echo "  make install-cli   - Install CLI package locally"
	@echo "  make dev           - Start dev services"
	@echo "  make dev-down      - Remove dev services"
	@echo "  make build         - Build Docker images only"
	@echo "  make clean         - Clean up containers and volumes"
	@echo "  make logs          - Show test container logs"
	@echo ""

# Run tests in Docker
test:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile test up --build --quiet-build --quiet-pull --abort-on-container-exit --attach api-test --exit-code-from api-test 

	@echo ""
	@echo "📊 Test results available in ./test-results/"
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile test down > /dev/null 2>&1

# =============================================================================
# Mock Server Commands
# =============================================================================

# Start dev servers for dashboard development
dev:
	@echo "🛫 Starting dev services..."
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile dev up --build -d
	@echo ""
	@echo "✅ Services running:"
	@echo ""
	@echo "   Dashboard:     http://localhost:3000"
	@echo "   Django API:    http://localhost:8000"
	@echo "   Django Admin:  http://localhost:8000/admin/ (admin/admin)"
	@echo "   PostgreSQL:    localhost:5432 (via pgbouncer)"
	@echo "   Redis:         localhost:6379"
	@echo "   Ultrafeeder:   http://localhost:18080"
	@echo "   Dump978:       http://localhost:18081"
	@echo ""
	@echo "API Endpoints:"
	@echo "   GET http://localhost:8000/api/v1/aircraft/"
	@echo "   GET http://localhost:8000/api/v1/system/status/"
	@echo "   GET http://localhost:8000/health/"
	@echo "   WS  ws://localhost:8000/ws/all/"
	@echo ""
	@echo "Stop with: make dev-down"

# Stop mock servers
dev-down:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile dev down
	@echo "🛬 Mock servers stopped"

# Show mock server logs
dev-logs:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile dev logs -f

# Build Docker images
build:
	docker build -f Dockerfile -t adsb_api .
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml build

# Clean up
clean:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml down -v --remove-orphans
	rm -rf test-results/__pycache__
	rm -rf __pycache__
	rm -rf .pytest_cache

# Show logs
logs:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile test logs -f test

# =============================================================================
# Python Package Installation
# =============================================================================

# Install CLI package
install-cli:
	@echo "📦 Installing CLI package..."
	pip install -e ./skyspy-cli
	@echo "✅ CLI installed. Available commands: skyspy-radio, skyspy-radio-pro, skyspy-radar"

# =============================================================================
# Python Package Tests
# =============================================================================

# Run CLI tests
test-cli:
	@echo "🧪 Running CLI tests..."
	cd skyspy-cli && pip install -e . && pytest -v

# Run common package tests
test-common:
	@echo "🧪 Running common package tests..."
	cd skyspy_common && pip install -e ".[dev]" && pytest -v

# Run all Python package tests (CLI + common)
test-python: test-common test-cli
	@echo "✅ All Python package tests completed"

# =============================================================================
# Linting
# =============================================================================

# Run Python linter
lint-python:
	@echo "🔍 Linting Python..."
	skyspy_django/.venv/bin/ruff check skyspy_django/
	@echo "✅ Python lint passed"

# Run Go linter
lint-go:
	@echo "🔍 Linting Go..."
	cd skyspy-go && go vet ./... && test -z "$$(gofmt -l .)"
	@echo "✅ Go lint passed"

# Run frontend linter
lint-frontend:
	@echo "🔍 Linting Frontend..."
	cd web && npm run lint
	@echo "✅ Frontend lint passed"

# Run all linters
lint: lint-python lint-go lint-frontend
	@echo "✅ All linters passed"
