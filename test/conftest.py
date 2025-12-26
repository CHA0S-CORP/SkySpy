#!/usr/bin/env python3
"""
Pytest configuration and shared fixtures for ADS-B API tests.
Supports both SQLite (local) and PostgreSQL (Docker) backends.
"""

import pytest
import sys
import os

# Determine if we're running in Docker (PostgreSQL) or locally (SQLite)
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///:memory:')

# Set environment variables BEFORE importing the app
# Use setdefault to avoid overriding Docker/CI environment variables
os.environ.setdefault('DATABASE_URL', DATABASE_URL)
os.environ.setdefault('ULTRAFEEDER_HOST', 'ultrafeeder')
os.environ.setdefault('ULTRAFEEDER_PORT', '80')
os.environ.setdefault('DUMP978_HOST', 'dump978')
os.environ.setdefault('DUMP978_PORT', '80')
os.environ.setdefault('FEEDER_LAT', '47.9377')
os.environ.setdefault('FEEDER_LON', '-121.9687')
os.environ.setdefault('APPRISE_URLS', '')
os.environ.setdefault('NOTIFICATION_COOLDOWN', '300')

# Ensure the app module is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def pytest_configure(config):
    """Configure pytest"""
    config.addinivalue_line("markers", "slow: mark test as slow running")
    config.addinivalue_line("markers", "integration: mark as integration test")
    config.addinivalue_line("markers", "docker: mark as requiring Docker services")


def pytest_collection_modifyitems(config, items):
    """Modify test collection to handle markers"""
    for item in items:
        if "Performance" in item.nodeid:
            item.add_marker(pytest.mark.slow)
        if "Integration" in item.nodeid:
            item.add_marker(pytest.mark.integration)


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """Setup test environment"""
    print(f"\n📊 Using database: {DATABASE_URL[:50]}...")
    yield
    print("\n✅ Tests completed")