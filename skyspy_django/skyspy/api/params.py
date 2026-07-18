"""Shared query-parameter parsing helpers for API views.

Bare ``int()``/``float()`` casts on raw query params raise ValueError, which
DRF's default exception handler turns into HTTP 500. These helpers fall back
to the caller's default and clamp to sane bounds instead (matching the
established try/except idiom in api/stats.py).
"""


def parse_int(params, name, default, *, min_value=None, max_value=None):
    """Parse an integer query param, falling back to ``default`` and clamping."""
    try:
        value = int(params.get(name, default))
    except (ValueError, TypeError):
        value = default
    if min_value is not None:
        value = max(value, min_value)
    if max_value is not None:
        value = min(value, max_value)
    return value


def parse_float(params, name, default, *, min_value=None, max_value=None):
    """Parse a float query param, falling back to ``default`` and clamping."""
    try:
        value = float(params.get(name, default))
    except (ValueError, TypeError):
        value = default
    if min_value is not None:
        value = max(value, min_value)
    if max_value is not None:
        value = min(value, max_value)
    return value
