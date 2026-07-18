"""Tests for US N-number ↔ ICAO address conversion (services/nnumber.py)."""

import pytest

from skyspy.services.nnumber import icao_to_n, n_to_icao


@pytest.mark.parametrize(
    "reg,hexid",
    [
        ("N1", "a00001"),  # first US address (definitional anchor)
        ("N10", "a0025a"),
        ("N871AA", "abfa0e"),
        ("N99999", "adf7af"),
    ],
)
def test_known_pairs(reg, hexid):
    assert n_to_icao(reg) == hexid
    assert icao_to_n(hexid) == reg


def test_case_insensitive_and_whitespace():
    assert n_to_icao(" n871aa ") == "abfa0e"


@pytest.mark.parametrize(
    "bad",
    ["", None, "N", "N0", "N1I", "N1O", "G-ABCD", "D-1234", "NABCDE", "N123456"],
)
def test_invalid_inputs_return_none(bad):
    assert n_to_icao(bad) is None


@pytest.mark.parametrize("out_of_block", ["000000", "a00000", "adf7c8", "c0ffee"])
def test_icao_to_n_out_of_us_block(out_of_block):
    assert icao_to_n(out_of_block) is None


def test_round_trip_sample():
    """Every N-number derived from the US block must convert back exactly."""
    for icao in range(0xA00001, 0xA00001 + 5000):
        reg = icao_to_n(icao)
        assert reg is not None
        assert int(n_to_icao(reg), 16) == icao
