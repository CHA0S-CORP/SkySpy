"""
Regression tests for the crash-isolated libacars decode wrapper.

The bug these guard: the ``spawn`` child unpickles the Process target by
qualified name, so it imports the module the target is defined in. When that
module lived under ``skyspy.services``, the import ran
``skyspy/services/__init__.py`` (Django models) before ``django.setup()`` and
raised ``AppRegistryNotReady`` on every decode — silently disabling all ACARS
application decoding. The target must therefore live in a Django-free package.
"""

from skyspy.services import acars_safe_decode


def test_spawn_target_is_django_free_module():
    # The Process target must not live under skyspy.services (or any skyspy.*
    # package whose __init__ pulls in Django) — otherwise the spawn child hits
    # AppRegistryNotReady on import.
    mod = acars_safe_decode.decode_child.__module__
    assert mod == "skyspy_common.subprocess_decode", mod
    assert not mod.startswith("skyspy."), f"spawn child would import Django via {mod}"


def test_undecodable_message_returns_none_without_raising():
    # Junk payload libacars can't decode → graceful None, never an exception.
    result = acars_safe_decode.safe_decode_acars_apps("H1", "not a real acars payload", direction=0, timeout=4.0)
    assert result is None
