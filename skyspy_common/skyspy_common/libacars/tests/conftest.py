"""
Pytest configuration and fixtures for libacars tests.
"""

import pytest
from unittest.mock import MagicMock, patch

# Fixed: Import api instead of binding
from skyspy_common.libacars import api as binding_module
from skyspy_common.libacars.cache import reset_caches
from skyspy_common.libacars.circuit_breaker import reset_circuit_breaker
from skyspy_common.libacars.metrics import reset_metrics
from skyspy_common.libacars.pool import reset_pools


@pytest.fixture(autouse=True)
def reset_binding_state():
    """Reset binding module state before each test."""
    # Save original state
    # Note: _libacars_available is now a function call is_available(), but internal state
    # might be in core.py. For high level tests, we focus on resetting stats/circuit.
    
    # Reset all state
    binding_module.reset_stats()
    reset_circuit_breaker()
    reset_caches()
    reset_metrics()
    reset_pools()

    yield

    # Restore/Cleanup
    binding_module.reset_stats()
    reset_circuit_breaker()
    reset_caches()
    reset_metrics()
    reset_pools()


@pytest.fixture
def mock_libacars_available():
    """Fixture to mock libacars as available."""
    # Patch the is_available check and the loader in core
    with patch('skyspy_common.libacars.core.load_libacars', return_value=True):
        with patch('skyspy_common.libacars.core._backend', 'ctypes'):
             with patch('skyspy_common.libacars.core._lib', MagicMock()):
                yield


@pytest.fixture
def mock_libacars_unavailable():
    """Fixture to mock libacars as unavailable."""
    with patch('skyspy_common.libacars.core.load_libacars', return_value=False):
        with patch('skyspy_common.libacars.core._backend', 'unavailable'):
            with patch('skyspy_common.libacars.core._lib', None):
                yield


@pytest.fixture
def mock_successful_decode():
    """Fixture to mock a successful decode operation."""
    mock_lib = MagicMock()

    # Create mock vstring with JSON output
    mock_vstr = MagicMock()
    mock_vstr.contents.str = b'{"acars": {"label": "H1", "decoded": true}}'
    
    # Mock the context manager helper in api.py directly or the core library calls
    # For simplicity, we patch get_lib to return our mock
    
    with patch('skyspy_common.libacars.api.get_lib', return_value=(mock_lib, None, 'ctypes')):
        with patch('skyspy_common.libacars.api.vstring_context') as mock_ctx:
            # Setup vstring context to yield our mock vstring
            mock_ctx.return_value.__enter__.return_value = (mock_vstr, 'ctypes')
            
            # Create mock node (non-null)
            mock_node = MagicMock()
            mock_lib.la_acars_decode_apps.return_value = mock_node
            mock_lib.la_vstring_new.return_value = mock_vstr
            
            yield mock_lib


@pytest.fixture
def mock_failed_decode():
    """Fixture to mock a failed decode operation (returns null node)."""
    mock_lib = MagicMock()
    mock_lib.la_acars_decode_apps.return_value = None

    with patch('skyspy_common.libacars.api.get_lib', return_value=(mock_lib, None, 'ctypes')):
        yield mock_lib