# ADS-B API Tests

Modern test suite for the SkySpy ADS-B API using pytest and FastAPI's test client.

## Structure

```
tests/
├── conftest.py              # Shared fixtures and test configuration
├── unit/                    # Unit tests (no external dependencies)
│   ├── test_utils.py       # Tests for utility functions
│   └── ...
└── integration/             # Integration tests (with database, HTTP)
    ├── test_aircraft_api.py # Aircraft endpoints
    ├── test_alerts_api.py   # Alert rule endpoints
    ├── test_safety_api.py   # Safety monitoring endpoints
    ├── test_history_api.py  # Historical data endpoints
    └── ...
```

## Running Tests

### All tests
```bash
cd adsb-api
pytest
```

### Unit tests only
```bash
pytest tests/unit
```

### Integration tests only
```bash
pytest tests/integration
```

### With coverage
```bash
pytest --cov=app --cov-report=html
```

### Specific test file
```bash
pytest tests/integration/test_aircraft_api.py -v
```

### Specific test class or function
```bash
pytest tests/integration/test_aircraft_api.py::TestAircraftEndpoints::test_get_aircraft_live_empty -v
```

## Writing Tests

### Unit Tests

Unit tests should be fast, isolated, and test individual functions/classes:

```python
from app.core.utils import calculate_distance_nm

def test_calculate_distance_same_point():
    """Distance between same point should be 0"""
    dist = calculate_distance_nm(47.9377, -121.9687, 47.9377, -121.9687)
    assert dist == pytest.approx(0, abs=0.001)
```

### Integration Tests

Integration tests use the FastAPI test client and async database:

```python
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
class TestAircraftEndpoints:
    async def test_get_aircraft_live(self, client: AsyncClient):
        """Test GET /api/v1/aircraft"""
        response = await client.get("/api/v1/aircraft")
        assert response.status_code == 200
        data = response.json()
        assert "aircraft" in data
```

## Fixtures

Common fixtures are defined in `conftest.py`:

- `db_engine` - Async SQLAlchemy engine (SQLite in-memory)
- `db_session` - Async database session
- `client` - AsyncClient for making HTTP requests
- `sample_aircraft_data` - Sample aircraft JSON data
- `sample_uat_data` - Sample UAT aircraft data

## Configuration

Test configuration is in `pytest.ini` which includes:
- Test discovery patterns
- Coverage settings
- HTML report generation
- Async mode configuration

## CI/CD

Tests run automatically on:
- Push to `main` or `develop` branches
- Pull requests
- Manual workflow dispatch

GitHub Actions workflow runs:
1. Unit tests with coverage
2. Integration tests with coverage
3. Uploads coverage to Codecov
4. Uploads test results as artifacts
