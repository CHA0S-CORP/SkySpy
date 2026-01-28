"""
SkysPy Django Test Suite.

This package contains comprehensive tests for the SkysPy Django application:

Modules:
- test_settings: Test-specific Django settings for isolated testing
- factories: Factory Boy factories for generating realistic test data
- conftest: pytest fixtures for database, API, WebSocket, and mocked services
- test_integration: End-to-end integration tests for all major workflows

Test Coverage:
- REST API endpoints
- WebSocket consumers (aircraft, safety, ACARS, audio)
- Celery background tasks (aircraft polling, transcription)
- Alert rule evaluation and notifications
- Safety event detection and monitoring
- ACARS message processing

Usage:
    # Run all tests with pytest
    pytest skyspy/tests/ --ds=skyspy.tests.test_settings

    # Run with coverage
    pytest skyspy/tests/ --ds=skyspy.tests.test_settings --cov=skyspy

    # Run specific test class
    pytest skyspy/tests/test_integration.py::TestAircraftPollingFlow -v

    # Run async tests
    pytest skyspy/tests/test_integration.py::TestWebSocketIntegration -v

Requirements:
    - pytest
    - pytest-django
    - pytest-asyncio
    - factory-boy
    - channels[daphne]
"""
