"""
Mixin modules for MainNamespace decomposition.

Each mixin provides a group of related request handlers and their
data-access methods. MainNamespace composes all mixins via multiple
inheritance; Python's MRO resolves ``self._handle_*`` calls at runtime.
"""


def parse_int_param(value, default: int, min_val: int = None, max_val: int = None) -> int:
    """
    Safely parse an integer parameter with bounds checking.

    Args:
        value: The value to parse (can be str, int, or None)
        default: Default value if parsing fails
        min_val: Minimum allowed value (optional)
        max_val: Maximum allowed value (optional)

    Returns:
        Validated integer within bounds
    """
    try:
        result = int(value) if value is not None else default
    except (ValueError, TypeError):
        result = default

    if min_val is not None and result < min_val:
        result = min_val
    if max_val is not None and result > max_val:
        result = max_val

    return result
