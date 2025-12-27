.PHONY: test test-docker test-local test-verbose clean build help

# Default target
help:
	@echo "SkySpy Test Commands:"
	@echo ""
	@echo "  make test          - Run tests in Docker (recommended)"
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
