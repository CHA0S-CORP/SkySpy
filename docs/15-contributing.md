---
title: Contributing Guide
slug: contributing
category:
  uri: development
position: 1
privacy:
  view: public
---

# Contributing to SkySpy

Welcome to the SkySpy contributor community! We're thrilled you're interested in helping build the future of aircraft tracking.

> **New to Contributing?** This guide covers everything you need to know, from setting up your environment to getting your first PR merged.

---

## Quick Start

[SkySpy Repository](https://github.com/your-org/skyspy)

![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg) ![License](https://img.shields.io/badge/License-MIT-blue.svg) ![Code Style: Black](https://img.shields.io/badge/code%20style-black-000000.svg) ![Code Style: Prettier](https://img.shields.io/badge/code%20style-prettier-ff69b4.svg)

> **Ways to Contribute**
>
> - **Bug Reports** - Found an issue? Let us know!
> - **Feature Ideas** - Have a great idea? We'd love to hear it!
> - **Code** - Submit PRs for bug fixes or new features
> - **Documentation** - Help improve our docs
> - **Testing** - Write tests and improve coverage
> - **Code Review** - Review open pull requests

---

## Project Architecture

SkySpy is a sophisticated real-time ADS-B aircraft tracking platform with multiple components:

| Component | Technology | Location | Badge |
|-----------|------------|----------|-------|
| Backend API | Django 5.0+ / Django Channels | `skyspy_django/` | ![Python](https://img.shields.io/badge/python-3.12+-blue?logo=python&logoColor=white) |
| Web Dashboard | React 18 / Vite 5 | `web/` | ![React](https://img.shields.io/badge/react-18+-61dafb?logo=react&logoColor=white) |
| CLI Tools | Go 1.23+ | `skyspy-go/` | ![Go](https://img.shields.io/badge/go-1.23+-00add8?logo=go&logoColor=white) |
| Shared Libraries | Python | `skyspy_common/` | ![Python](https://img.shields.io/badge/python-lib-blue?logo=python&logoColor=white) |
| Mock Services | Docker | `test/` | ![Docker](https://img.shields.io/badge/docker-compose-2496ed?logo=docker&logoColor=white) |

---

## Before You Start

> **Warning: Prerequisites Checklist**
>
> - Read through this contributing guide
> - Check existing issues and PRs for similar work
> - For major changes, open an issue first to discuss
> - Sign off on the Developer Certificate of Origin (DCO)

---

## Development Environment Setup

### Step 1: Install Prerequisites

| Tool | Version | Purpose | Required |
|------|---------|---------|----------|
| Docker | Latest | Container orchestration | Yes |
| Docker Compose | v2+ | Multi-container development | Yes |
| Python | 3.12+ | Backend development | Yes |
| Node.js | 20+ | Frontend development | Yes |
| Go | 1.23+ | CLI development | Optional |
| Git | Latest | Version control | Yes |

### Step 2: Clone & Configure

```bash
# Clone the repository
git clone https://github.com/your-org/skyspy.git
cd skyspy

# Copy environment template
cp .env.example .env
```

> **Essential Environment Variables**
>
> Edit `.env` with your configuration:
>
> ```bash
> # Required: Feeder location (your antenna position)
> FEEDER_LAT=47.9377
> FEEDER_LON=-121.9687
>
> # Required: ADS-B receiver host
> ULTRAFEEDER_HOST=ultrafeeder
> ULTRAFEEDER_PORT=80
>
> # For development, use public auth mode
> AUTH_MODE=public
> ```

> **Full Configuration**
>
> The `.env.example` file contains extensive documentation for all available options including authentication, OIDC SSO, notifications, transcription, and external data sources.

### Step 3: Database Setup

> **Recommended: Docker Setup**
>
> The development environment automatically provisions PostgreSQL and Redis:
>
> ```bash
> # Start all services including database
> make dev
>
> # Database is automatically migrated on startup
> ```

<details>
<summary>Alternative: Local PostgreSQL</summary>

If running PostgreSQL locally:

```bash
# Set your database URL
export DATABASE_URL=postgresql://user:password@localhost:5432/skyspy

# Run migrations
cd skyspy_django
python manage.py migrate
```

</details>

### Step 4: Start Development Services

```bash
# Start full development environment with mock data
make dev

# Services available:
#   Dashboard:     http://localhost:3000
#   Django API:    http://localhost:8000
#   PostgreSQL:    localhost:5432 (via pgbouncer)
#   Redis:         localhost:6379
#   Ultrafeeder:   http://localhost:18080
#   Dump978:       http://localhost:18081

# View logs
make dev-logs

# Stop services
make dev-down
```

<details>
<summary>Running Components Individually</summary>

#### Backend API (Django)

```bash
cd skyspy_django

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -e ../skyspy_common
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Start development server
python manage.py runserver 0.0.0.0:8000

# Or with Daphne for WebSocket support
daphne -b 0.0.0.0 -p 8000 skyspy.asgi:application
```

#### Celery Worker (Background Tasks)

```bash
# In a separate terminal
cd skyspy_django
celery -A skyspy worker --loglevel=info --pool=gevent --concurrency=10
```

#### Celery Beat (Scheduled Tasks)

```bash
# In a separate terminal
cd skyspy_django
celery -A skyspy beat --loglevel=info
```

#### Frontend Dashboard (React)

```bash
cd web

# Install dependencies
npm install

# Start development server
npm run dev

# Dashboard available at http://localhost:3000
```

#### Go CLI

```bash
cd skyspy-go

# Download dependencies
make deps

# Build binary
make build

# Run
./bin/skyspy --help
```

</details>

---

## Code Style Guidelines

### Python (Backend)

![Code Style: Black](https://img.shields.io/badge/code%20style-black-000000.svg) ![Linting: Ruff](https://img.shields.io/badge/linting-ruff-261230.svg?logo=ruff) ![Typing: mypy](https://img.shields.io/badge/typing-mypy-blue.svg) ![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg?logo=python&logoColor=white)

| Tool | Purpose | Command |
|------|---------|---------|
| Ruff | Linting + import sorting | `ruff check .` |
| Black | Code formatting | `black .` |
| mypy | Static type checking | `mypy .` |

> **Configuration (pyproject.toml)**
>
> ```toml
> [tool.ruff]
> target-version = "py312"
> line-length = 120
>
> [tool.black]
> target-version = ["py312"]
> line-length = 120
> ```

**Key Rules:**
- Line length: 120 characters maximum
- Use type hints for function signatures
- Follow PEP 8 naming conventions
- Avoid unused imports and variables
- Use `isort`-compatible import ordering

```bash
# Check for issues
ruff check .
black --check --diff .
mypy --ignore-missing-imports .

# Auto-fix issues
ruff check --fix .
black .
```

---

### JavaScript/React (Frontend)

![Code Style: Prettier](https://img.shields.io/badge/code%20style-prettier-ff69b4.svg) ![Linting: ESLint](https://img.shields.io/badge/linting-eslint-4B32C3.svg?logo=eslint) ![React 18](https://img.shields.io/badge/react-18-61dafb.svg?logo=react&logoColor=white)

| Tool | Config File | Command |
|------|-------------|---------|
| ESLint | `.eslintrc.cjs` | `npm run lint` |
| Prettier | `.prettierrc` | `npm run format` |

<details>
<summary>Prettier Configuration</summary>

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

</details>

**ESLint Rules:**
- React Hooks rules enforced (`rules-of-hooks`, `exhaustive-deps`)
- No `console.log` (use `console.warn` or `console.error`)
- Prefer `const` over `let`
- Use strict equality (`===`)

```bash
cd web

# Check for issues
npm run lint
npm run format:check

# Auto-fix issues
npm run lint:fix
npm run format
```

---

### Go (CLI)

![Linting: golangci-lint](https://img.shields.io/badge/linting-golangci--lint-00add8.svg?logo=go&logoColor=white) ![Go 1.23+](https://img.shields.io/badge/go-1.23+-00add8.svg?logo=go&logoColor=white)

**Enabled Linters:**

| Linter | Purpose |
|--------|---------|
| `errcheck` | Check for unchecked errors |
| `gosec` | Security-oriented checks |
| `gocyclo` | Cyclomatic complexity (max 20) |
| `dupl` | Duplicate code detection |
| `misspell` | Common misspellings |
| `revive` | Go best practices |

```bash
cd skyspy-go

# Run all linters
make lint

# Format code
make fmt

# Check formatting
make fmt-check

# Run go vet
make vet
```

---

## Git Workflow

### Branch Strategy

```mermaid
gitGraph
    commit id: "main"
    branch develop
    checkout develop
    commit id: "integration"
    branch feature/new-alerts
    checkout feature/new-alerts
    commit id: "add alerts"
    commit id: "add tests"
    checkout develop
    merge feature/new-alerts
    branch fix/websocket-bug
    checkout fix/websocket-bug
    commit id: "fix bug"
    checkout develop
    merge fix/websocket-bug
    checkout main
    merge develop tag: "v2.6.0"
```

| Branch | Purpose | Protection |
|--------|---------|------------|
| `main` | Production-ready code | Protected, requires PR |
| `develop` | Integration branch | Protected, requires PR |
| `feature/*` | New features | None |
| `fix/*` | Bug fixes | None |
| `docs/*` | Documentation updates | None |
| `refactor/*` | Code refactoring | None |

### Creating a Branch

```bash
# Update your local main
git checkout main
git pull origin main

# Create a feature branch
git checkout -b feature/amazing-feature

# Or for bug fixes
git checkout -b fix/bug-description
```

---

## Commit Messages

Follow **Conventional Commits** for clear history:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Commit Types

| Type | Emoji | Description | Example |
|------|-------|-------------|---------|
| `feat` | | New feature | Add proximity alert configuration |
| `fix` | | Bug fix | Handle reconnection on timeout |
| `docs` | | Documentation only | Update API endpoint examples |
| `style` | | Formatting, no code change | Format with Black |
| `refactor` | | Code restructuring | Extract safety monitoring logic |
| `test` | | Adding or updating tests | Add WebSocket integration tests |
| `chore` | | Build process, tooling | Update CI workflow |
| `perf` | | Performance improvement | Optimize database queries |

### Commit Examples

```bash
# Feature
git commit -m "feat(alerts): add proximity alert distance configuration"

# Bug fix
git commit -m "fix(websocket): handle reconnection on network timeout"

# Documentation
git commit -m "docs(api): update alert rule endpoint examples"

# Refactoring
git commit -m "refactor(services): extract safety monitoring logic"
```

---

## Pull Request Process

### PR Workflow

```mermaid
flowchart LR
    A[Make Changes] --> B[Run Tests]
    B --> C[Push Branch]
    C --> D[Create PR]
    D --> E[CI Checks]
    E --> F{Pass?}
    F -->|No| A
    F -->|Yes| G[Code Review]
    G --> H{Approved?}
    H -->|No| A
    H -->|Yes| I[Merge]
```

### PR Checklist

> **Warning: Before Submitting Your PR**
>
> - All tests pass locally (`make test`)
> - Code follows project style guidelines
> - Documentation updated (if needed)
> - No `console.log` or debug code
> - No hardcoded secrets or credentials
> - Code is performant (no N+1 queries)
> - New functionality has tests

### Running Tests Before PR

```bash
# Full test suite in Docker (recommended)
make test

# Backend tests only
cd skyspy_django && pytest

# Frontend linting
cd web && npm run lint

# Go tests
cd skyspy-go && make test
```

```bash
# Python
ruff check . && black --check .

# JavaScript
cd web && npm run lint && npm run format:check

# Go
cd skyspy-go && make lint
```

### PR Description Template

```markdown
## Summary

Brief description of changes and motivation.

## Changes

- Bullet points of specific changes
- Include file paths for major modifications

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Manual testing completed

## Documentation

- [ ] Code comments updated
- [ ] README/docs updated (if applicable)
- [ ] API documentation updated (if applicable)

## Screenshots (if UI changes)

Before/after screenshots for visual changes.
```

### PR Requirements

| Requirement | Description | Status |
|-------------|-------------|--------|
| CI Pipeline | All automated checks pass | Required |
| Code Review | At least one approving review | Required |
| Coverage | Maintain 40% minimum (60% target) | Required |
| No Conflicts | Mergeable with target branch | Required |

---

## Code Review Process

### Review Flow

```mermaid
flowchart TB
    subgraph Author
        A1[Submit PR] --> A2[Address Feedback]
        A2 --> A3[Push Updates]
    end

    subgraph Reviewer
        R1[Review Code] --> R2{Issues Found?}
        R2 -->|Yes| R3[Request Changes]
        R2 -->|No| R4[Approve PR]
    end

    subgraph CI
        C1[Run Tests] --> C2[Run Linters]
        C2 --> C3[Security Scan]
    end

    A1 --> R1
    A1 --> C1
    R3 --> A2
    A3 --> R1
    R4 --> M[Merge]
    C3 --> M
```

### For Authors

> **Before Requesting Review**
>
> - Code follows project style guidelines
> - All tests pass locally
> - New functionality has tests
> - Documentation updated
> - No debug code or console.log statements
> - No hardcoded secrets or credentials
> - Error handling is appropriate
> - Code is performant (no N+1 queries)

### For Reviewers

> **Review Checklist**
>
> **Functionality**
> - Code does what it claims to do
> - Edge cases are handled
> - Error conditions handled gracefully
>
> **Code Quality**
> - Code is readable and maintainable
> - No code duplication
> - Functions are focused and appropriately sized
>
> **Testing**
> - Tests are meaningful and comprehensive
> - Test coverage is adequate
>
> **Security**
> - No SQL injection vulnerabilities
> - No XSS vulnerabilities
> - Auth/authz is correct

> **Warning: Review Etiquette**
>
> - Be constructive and specific
> - Explain the "why" behind suggestions
> - Distinguish between required changes and suggestions
> - Approve when satisfied, request changes when needed

---

## Issue Guidelines

### Bug Reports

> **Bug Report Template**
>
> **Title:** `[BUG] Brief description`
>
> **Include:**
> - Environment (OS, Docker version, Browser)
> - SkySpy version or commit hash
> - Steps to reproduce
> - Expected vs actual behavior
> - Relevant logs/screenshots

### Feature Requests

> **Feature Request Template**
>
> **Title:** `[FEATURE] Brief description`
>
> **Include:**
> - Problem statement
> - Proposed solution
> - Alternatives considered
> - Mockups or examples (if applicable)

### Issue Labels

| Label | Description | Color |
|-------|-------------|-------|
| `bug` | Something isn't working | Red |
| `enhancement` | New feature or improvement | Blue |
| `documentation` | Documentation updates | Green |
| `good first issue` | Good for newcomers | Purple |
| `help wanted` | Extra attention needed | Yellow |
| `priority: high` | Critical issue | Red |

---

## Release Process

### Semantic Versioning

```mermaid
flowchart LR
    subgraph Version[" "]
        direction TB
        M[MAJOR x.0.0] --- |Breaking changes| M1[API incompatible]
        N[MINOR 0.x.0] --- |Features| N1[Backward compatible]
        P[PATCH 0.0.x] --- |Fixes| P1[Backward compatible]
    end
```

| Version | Change Type | Example |
|---------|-------------|---------|
| **MAJOR** (x.0.0) | Breaking API changes | `1.0.0` -> `2.0.0` |
| **MINOR** (0.x.0) | New features | `2.5.0` -> `2.6.0` |
| **PATCH** (0.0.x) | Bug fixes | `2.6.0` -> `2.6.1` |

### CI/CD Pipeline

```mermaid
flowchart LR
    subgraph Trigger
        PR[PR/Push]
        Tag[Git Tag]
    end

    subgraph Tests
        UT[Unit Tests]
        LT[Lint]
        E2E[E2E Tests]
        SEC[Security Scan]
    end

    subgraph Deploy
        BUILD[Build Images]
        PUSH[Push to GHCR]
    end

    PR --> UT --> LT --> E2E --> SEC
    Tag --> BUILD --> PUSH
```

| Stage | Trigger | Actions |
|-------|---------|---------|
| Test | All PRs, pushes | Run pytest, coverage |
| Lint Python | All PRs, pushes | Ruff, Black, mypy |
| Lint Frontend | All PRs, pushes | ESLint, Prettier |
| Test Go | All PRs, pushes | golangci-lint, go test |
| E2E Tests | After unit tests | Playwright tests |
| Security Scan | All PRs, pushes | Bandit, pip-audit, npm audit |
| Build & Push | Push to main/develop, tags | Multi-arch images to GHCR |

### Docker Images

> **Published Images**
>
> - `ghcr.io/{org}/skyspy` - Main API image
> - `ghcr.io/{org}/skyspy-rtl-airband-uploader` - RTL-Airband uploader
> - `ghcr.io/{org}/skyspy-1090-mock` - Mock ADS-B receiver
> - `ghcr.io/{org}/skyspy-acarshub-mock` - Mock ACARS hub

---

## Quick Reference

### Common Commands

| Task | Command |
|------|---------|
| Start dev environment | `make dev` |
| View logs | `make dev-logs` |
| Stop services | `make dev-down` |
| Run all tests | `make test` |
| Python lint | `ruff check . && black .` |
| JS lint | `cd web && npm run lint` |
| Go lint | `cd skyspy-go && make lint` |
| Build images | `make build` |

### Service URLs (Development)

| Service | URL | Port |
|---------|-----|------|
| Dashboard | http://localhost:3000 | 3000 |
| Django API | http://localhost:8000 | 8000 |
| PostgreSQL | localhost:5432 | 5432 |
| Redis | localhost:6379 | 6379 |
| Ultrafeeder | http://localhost:18080 | 18080 |

---

## Community Guidelines

> **Be Welcoming**
>
> We welcome contributors of all experience levels. Everyone was new once!

> **Be Respectful**
>
> Treat everyone with respect. Constructive criticism is welcome; personal attacks are not.

> **Warning: Communicate Clearly**
>
> When in doubt, over-communicate. Ask questions if something is unclear.

---

## Getting Help

| Resource | Description | Link |
|----------|-------------|------|
| Documentation | Check the docs/ directory | README |
| Issues | Search existing issues first | GitHub Issues |
| Discussions | Ask questions | GitHub Discussions |
| Code of Conduct | Be respectful and inclusive | CODE_OF_CONDUCT.md |

---

> **Thank You!**
>
> Thank you for contributing to SkySpy! Your contributions help make aircraft tracking better for everyone.
