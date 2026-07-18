"""
US N-number ↔ ICAO 24-bit address conversion.

FAA-registered aircraft (tail numbers starting with ``N``) map bijectively onto
the ICAO address block ``0xA00001``–``0xADF7C7``. This lets the app resolve a
registration to an ICAO hex — and open the airframe page — even when the
aircraft has never been seen by this receiver (so it isn't in ``AircraftInfo``).

Algorithm ported from the widely-used reference implementation
(guillaumemichel/icao-nnumber_converter, MIT). ``n_to_icao`` round-trips with
``icao_to_n`` for every valid N-number, which we assert in the tests.
"""

from __future__ import annotations

# Alphabet used in N-numbers: A–Z excluding I and O (24 letters).
_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_DIGITSET = "0123456789"
# 5th-position alphabet: a single trailing digit (0–9) sorts before letters.
_ALLCHARS = _DIGITSET + _CHARSET

# Size of each positional "bucket" in the encoding (see module docstring ref).
_SUFFIX_SIZE = 601  # '' + 24 single letters + 24*24 double letters
_BUCKET4 = 35  # '' + 24 letters + 10 digits
_BUCKET3 = 951  # 10*_BUCKET4 + _SUFFIX_SIZE
_BUCKET2 = 10111  # 10*_BUCKET3 + _SUFFIX_SIZE
_BUCKET1 = 101711  # 10*_BUCKET2 + _SUFFIX_SIZE


def _suffix_offset(s: str) -> int:
    """Offset for a 0–2 letter alpha suffix (e.g. '', 'A', 'AB')."""
    if not s:
        return 0
    total = 1 + _CHARSET.index(s[0]) * (len(_CHARSET) + 1)
    if len(s) == 1:
        return total
    return total + _CHARSET.index(s[1]) + 1


def n_to_icao(nnumber: str | None) -> str | None:
    """Convert a US N-number to a lowercase 6-hex ICAO address, or ``None``.

    Returns ``None`` for anything that isn't a syntactically valid N-number
    (wrong prefix, bad characters, out of range).
    """
    if not nnumber:
        return None
    nnumber = nnumber.strip().upper()
    if len(nnumber) < 2 or len(nnumber) > 6 or nnumber[0] != "N":
        return None

    body = nnumber[1:]
    # First char after N must be a digit 1-9.
    if body[0] not in "123456789":
        return None

    offset = 0
    for index, char in enumerate(body):
        if index == 0:
            offset += (int(char) - 1) * _BUCKET1
        elif index == 4:
            # Trailing 5th character: a single digit or letter (no further suffix).
            if char not in _ALLCHARS:
                return None
            offset += _ALLCHARS.index(char) + 1
        elif char in _CHARSET:
            # A letter here ends the number as a 1–2 char alpha suffix.
            offset += _suffix_offset(body[index:])
            break
        elif char in _DIGITSET:
            # A digit skips this level's suffix block, then indexes the bucket.
            bucket = {1: _BUCKET2, 2: _BUCKET3, 3: _BUCKET4}[index]
            offset += _SUFFIX_SIZE + int(char) * bucket
        else:
            return None

    icao = offset + 0xA00001
    if icao < 0xA00001 or icao > 0xADF7C7:
        return None
    return format(icao, "06x")


def _get_suffix(offset: int) -> str:
    """Inverse of :func:`_suffix_offset`."""
    if offset == 0:
        return ""
    char0 = _CHARSET[(offset - 1) // (len(_CHARSET) + 1)]
    rem = (offset - 1) % (len(_CHARSET) + 1)
    if rem == 0:
        return char0
    return char0 + _CHARSET[rem - 1]


def icao_to_n(icao: str | int | None) -> str | None:
    """Convert an ICAO hex (str or int) in the US block back to an N-number."""
    if icao is None:
        return None
    try:
        val = int(icao, 16) if isinstance(icao, str) else int(icao)
    except (ValueError, TypeError):
        return None
    if val < 0xA00001 or val > 0xADF7C7:
        return None

    offset = val - 0xA00001
    output = "N"

    digit1 = offset // _BUCKET1 + 1
    rem = offset % _BUCKET1
    output += str(digit1)
    if rem < _SUFFIX_SIZE:
        return output + _get_suffix(rem)

    rem -= _SUFFIX_SIZE
    output += str(rem // _BUCKET2)
    rem %= _BUCKET2
    if rem < _SUFFIX_SIZE:
        return output + _get_suffix(rem)

    rem -= _SUFFIX_SIZE
    output += str(rem // _BUCKET3)
    rem %= _BUCKET3
    if rem < _SUFFIX_SIZE:
        return output + _get_suffix(rem)

    rem -= _SUFFIX_SIZE
    output += str(rem // _BUCKET4)
    rem %= _BUCKET4
    if rem == 0:
        return output
    return output + _ALLCHARS[rem - 1]
