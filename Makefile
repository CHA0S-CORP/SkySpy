.PHONY: test test-docker test-local test-verbose clean build help

# Default target
help:
	@echo "SkySpy Test Commands:"
	@echo ""
	@echo "  make test          - Run tests in Docker (recommended)"
	@echo "  make test-local    - Run tests locally with SQLite"
	@echo "  make test-verbose  - Run tests with verbose output"
	@echo "  make test-html     - Run tests and generate HTML report"
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

# Start mock servers for dashboard development
mock:
	@echo "🛫 Starting mock ADS-B servers..."
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile dev up --build -d
	@echo ""
	@echo "✅ Services running:"
	@echo ""
	@echo "   ADS-B API:     http://localhost:5000"
	@echo "   PostgreSQL:    localhost:5432"
	@echo "   Ultrafeeder:   http://localhost:8080"
	@echo "   Dump978:       http://localhost:8081"
	@echo ""
	@echo "API Endpoints:"
	@echo "   GET http://localhost:5000/api/v1/aircraft"
	@echo "   GET http://localhost:5000/api/v1/aircraft/top"
	@echo "   GET http://localhost:5000/api/v1/aircraft/stats"
	@echo "   GET http://localhost:5000/api/v1/history/sightings"
	@echo "   GET http://localhost:5000/api/v1/history/sessions"
	@echo "   GET http://localhost:5000/api/v1/alerts/rules"
	@echo "   GET http://localhost:5000/api/v1/health"
	@echo "   GET http://localhost:5000/api/v1/status"
	@echo ""
	@echo "Stop with: make mock-down"

# Stop mock servers
mock-down:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile dev down
	@echo "🛬 Mock servers stopped"

# Show mock server logs
mock-logs:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile dev logs -f

# Run tests with verbose output
test-verbose:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile test up --build test pytest test_adsb_api.py -v --tb=long

# Generate HTML report
test-html:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile test up --build --abort-on-container-exit --exit-code-from test
	@echo ""
	@echo "📊 HTML report: ./test-results/report.html"

# Run tests locally (requires Python environment)
test-local:
	DATABASE_URL=sqlite:///:memory: \
	ULTRAFEEDER_HOST=localhost \
	DUMP978_HOST=localhost \
	pytest test/test_adsb_api.py -v --tb=short

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
