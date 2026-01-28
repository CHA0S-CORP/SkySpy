"""
Pytest configuration and fixtures for libacars tests.
"""

import pytest
from unittest.mock import MagicMock, patch

from skyspy_common.libacars import binding as binding_module
from skyspy_common.libacars.cache import reset_caches
from skyspy_common.libacars.circuit_breaker import reset_circuit_breaker
from skyspy_common.libacars.metrics import reset_metrics
from skyspy_common.libacars.pool import reset_pools


@pytest.fixture(autouse=True)
def reset_binding_state():
    """Reset binding module state before each test."""
    # Save original state
    original_available = binding_module._libacars_available
    original_stats = binding_module._stats

    # Reset all state
    binding_module.reset_stats()
    reset_circuit_breaker()
    reset_caches()
    reset_metrics()
    reset_pools()

    yield

    # Restore original state
    binding_module._libacars_available = original_available
    reset_circuit_breaker()
    reset_caches()
    reset_metrics()
    reset_pools()


@pytest.fixture
def mock_libacars_available():
    """Fixture to mock libacars as available."""
    with patch.object(binding_module, '_libacars_available', True):
        with patch.object(binding_module, '_load_libacars', return_value=True):
            yield


@pytest.fixture
def mock_libacars_unavailable():
    """Fixture to mock libacars as unavailable."""
    with patch.object(binding_module, '_libacars_available', False):
        with patch.object(binding_module, '_load_libacars', return_value=False):
            yield


@pytest.fixture
def mock_successful_decode():
    """Fixture to mock a successful decode operation."""
    mock_lib = MagicMock()

    # Create mock vstring with JSON output
    mock_vstr = MagicMock()
    mock_vstr_contents = MagicMock()
    mock_vstr_contents.str = b'{"acars": {"label": "H1", "decoded": true}}'
    mock_vstr.contents = mock_vstr_contents

    mock_lib.la_vstring_new.return_value = mock_vstr

    # Create mock node (non-null)
    mock_node = MagicMock()
    mock_lib.la_acars_decode_apps.return_value = mock_node

    with patch.object(binding_module, '_libacars', mock_lib):
        with patch.object(binding_module, '_libacars_available', True):
            with patch.object(binding_module, '_use_cffi', False):
                with patch.object(binding_module, '_load_libacars', return_value=True):
                    yield mock_lib


@pytest.fixture
def mock_failed_decode():
    """Fixture to mock a failed decode operation (returns null node)."""
    mock_lib = MagicMock()

    # Return null node
    mock_lib.la_acars_decode_apps.return_value = None

    with patch.object(binding_module, '_libacars', mock_lib):
        with patch.object(binding_module, '_libacars_available', True):
            with patch.object(binding_module, '_use_cffi', False):
                with patch.object(binding_module, '_load_libacars', return_value=True):
                    yield mock_lib
