.PHONY: test test-docker test-local test-verbose clean build help test-common test-python eval-assistant lint lint-python lint-go lint-frontend docs docs-openapi docs-storybook docs-go docs-socketio docs-screenshots dev dev-down dev-logs dev-auth dev-auth-down dev-auth-seed dev-public dev-public-down

# Default target
help:
	@echo "SkySpy Test Commands:"
	@echo ""
	@echo "  make test          - Run tests in Docker (recommended)"
	@echo "  make test-common   - Run common package tests"
	@echo "  make test-python   - Run all Python package tests"
	@echo "  make lint          - Run all linters (Python + Go + Frontend)"
	@echo "  make lint-python   - Run Python linter (ruff)"
	@echo "  make lint-go       - Run Go linter (go vet)"
	@echo "  make lint-frontend - Run frontend linter (eslint)"
	@echo "  make dev           - Start dev services"
	@echo "  make dev-down      - Remove dev services"
	@echo "  make build         - Build Docker images only"
	@echo "  make clean         - Clean up containers and volumes"
	@echo "  make logs          - Show test container logs"
	@echo "  make docs          - Generate OpenAPI schema, Go CLI + Socket.IO docs"
	@echo "  make docs-storybook- Build the Storybook static site"
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

# Start dev stack with AUTH ENFORCED (AUTH_MODE=hybrid, DEV_MODE=False) and seed
# a local admin + regular user, for testing login / roles / the AI + sensitive gates.
dev-auth:
	@echo "🔐 Starting dev services with auth ENFORCED..."
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml -f ./docker-compose.dev-auth.yaml --profile dev up --build -d
	@echo "⏳ Waiting for API to become healthy..."
	@until [ "$$(docker inspect -f '{{.State.Health.Status}}' skyspy_api_dev 2>/dev/null)" = "healthy" ]; do sleep 3; done
	@echo "👤 Seeding admin + test user..."
	docker exec skyspy_api_dev python manage.py seed_dev_users
	@echo ""
	@echo "✅ Auth-enforced dev running (AUTH_MODE=hybrid, DEV_MODE=False):"
	@echo "   Dashboard:    http://localhost:3000  (login required)"
	@echo "   Django Admin: http://localhost:8000/admin/"
	@echo "   admin / admin  → superuser, full access (AI/LLM works)"
	@echo "   user  / user   → viewer role, AI/LLM + system gated (403)"
	@echo ""
	@echo "Override creds/role via env: DEV_ADMIN_PASSWORD, DEV_USER_PASSWORD, DEV_USER_ROLE (viewer|operator|analyst|admin)"
	@echo "Stop with: make dev-auth-down"

# Start dev stack PUBLIC (map/dashboard open to anon) but with AI + sensitive
# endpoints requiring sign-in (AUTH_MODE=public, DEV_MODE=False) — mirrors the
# real public deployment. Seeds admin/admin so you can sign in to use the AI.
dev-public:
	@echo "🌐 Starting dev services: PUBLIC map, sign-in for AI..."
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml -f ./docker-compose.public-auth.yaml --profile dev up --build -d
	@echo "⏳ Waiting for API to become healthy..."
	@until [ "$$(docker inspect -f '{{.State.Health.Status}}' skyspy_api_dev 2>/dev/null)" = "healthy" ]; do sleep 3; done
	@echo "👤 Seeding admin + test user..."
	docker exec skyspy_api_dev python manage.py seed_dev_users
	@echo ""
	@echo "✅ Public dev running (AUTH_MODE=public, DEV_MODE=False):"
	@echo "   Dashboard:  http://localhost:3000  (map + dashboard open, no login)"
	@echo "   AI/assistant, chat, AI summaries → sign in (admin/admin or user/user)"
	@echo "Stop with: make dev-public-down"

# Stop the public-auth dev stack
dev-public-down:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml -f ./docker-compose.public-auth.yaml --profile dev down
	@echo "🛬 Public dev stopped"

# Stop the auth-enforced dev stack
dev-auth-down:
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml -f ./docker-compose.dev-auth.yaml --profile dev down
	@echo "🛬 Auth-enforced dev stopped"

# Re-seed the local admin + test user without restarting the stack
dev-auth-seed:
	docker exec skyspy_api_dev python manage.py seed_dev_users

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
# Documentation
# =============================================================================

# Validate + export the drf-spectacular OpenAPI schema
docs-openapi:
	cd skyspy_django && bash scripts/check_schema.sh --out openapi.json

# Build the Storybook static site into web/storybook-static/
docs-storybook:
	cd web && npm run build-storybook

# Generate the Go CLI Markdown reference into docs/cli/
docs-go:
	cd skyspy-go && $(MAKE) docs

# Generate the Socket.IO event reference from the namespace/mixin source
# (pure stdlib AST introspection — no Django import, so python3 is fine)
docs-socketio:
	cd skyspy_django && python3 scripts/gen_socketio_events.py

# Regenerate the doc screenshot/animation assets (slow; excluded from `docs`)
docs-screenshots:
	cd web && npm run docs:generate

# Generate all committed docs artifacts (schema, CLI ref, Socket.IO ref).
# Storybook + screenshots are omitted here because they are heavy; run them
# explicitly (docs-storybook / docs-screenshots) when needed.
docs: docs-openapi docs-go docs-socketio
	@echo "Generated OpenAPI schema, Go CLI reference, and Socket.IO event reference."

# =============================================================================
# Python Package Tests
# =============================================================================

# Run common package tests
test-common:
	@echo "🧪 Running common package tests..."
	cd skyspy_common && pip install -e ".[dev]" && pytest -v

# Run all Python package tests
test-python: test-common
	@echo "✅ All Python package tests completed"

# =============================================================================
# Assistant Evals (real LLM — never CI)
# =============================================================================

# Run the golden assistant evals against a real vLLM endpoint (e.g. the Spark).
# Usage: make eval-assistant ASSISTANT_EVAL_URL=http://spark:8000/v1
# Optional: ASSISTANT_EVAL_MODEL / ASSISTANT_EVAL_API_KEY / ASSISTANT_EVAL_TIMEOUT.
# Reports land in ./test-results/assistant-evals/ (one JSON per run, for drift diffs).
eval-assistant:
	@test -n "$(ASSISTANT_EVAL_URL)" || (echo "Set ASSISTANT_EVAL_URL (OpenAI-compatible base URL, e.g. http://spark:8000/v1)"; exit 1)
	docker compose --env-file ./.env.test -f ./docker-compose.test.yaml --profile test run --rm \
		-e ASSISTANT_EVAL_URL="$(ASSISTANT_EVAL_URL)" \
		-e ASSISTANT_EVAL_MODEL="$(ASSISTANT_EVAL_MODEL)" \
		-e ASSISTANT_EVAL_API_KEY="$(ASSISTANT_EVAL_API_KEY)" \
		-e ASSISTANT_EVAL_TIMEOUT="$(ASSISTANT_EVAL_TIMEOUT)" \
		-e EVAL_REPORT_DIR=/app/test-results/assistant-evals \
		api-test pytest skyspy/tests/evals -m eval -v --tb=short -s -p no:cacheprovider

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
