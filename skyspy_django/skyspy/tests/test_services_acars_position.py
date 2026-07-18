"""Tests for ACARS coordinate parsing + position-report decoding.

Covers the real position formats seen on labels 20/21/22/ADS that the decoder
previously dropped (only comma-separated decimals were handled), which left the
route map with no data to render.
"""

import pytest

from skyspy.services.acars_decoder import decode_message_text, parse_coordinates


@pytest.mark.parametrize(
    "text,lat,lon",
    [
        ("/ADS N34.0145 W108.9483 32330FT", 34.0145, -108.9483),  # decimal, space sep
        ("/POSN48.5380/W108.7346,ALT41385", 48.538, -108.7346),  # decimal, slash sep
        ("N3417.9,W11645.4", 34.2983, -116.7567),  # DDMM.m
        ("POS N42.7921N 78.6982W FL301", 42.7921, -78.6982),  # hemisphere suffix
        ("N 49.128,W122.374", 49.128, -122.374),  # legacy comma decimal
        ("S33.8688,E151.2093", -33.8688, 151.2093),  # southern/eastern hemisphere
    ],
)
def test_parse_coordinates_formats(text, lat, lon):
    coords = parse_coordinates(text)
    assert coords is not None, text
    assert coords["lat"] == pytest.approx(lat, abs=1e-3)
    assert coords["lon"] == pytest.approx(lon, abs=1e-3)


def test_parse_coordinates_rejects_junk():
    assert parse_coordinates("REQ POS JAWBN") is None
    assert parse_coordinates("HELLO WORLD") is None
    assert parse_coordinates("") is None


def test_decode_position_report_label_20():
    decoded = decode_message_text("/POSN35.7202/W087.8592,ALT31388,SPD495", label="20")
    assert decoded["message_type"] == "Position Report"
    assert decoded["position"]["lat"] == pytest.approx(35.7202, abs=1e-3)
    assert decoded["position"]["lon"] == pytest.approx(-87.8592, abs=1e-3)
    assert decoded["altitude_ft"] == 31388


def test_decode_ads_report_label_22():
    decoded = decode_message_text("/ADS N34.0145 W108.9483 32330FT 501KT", label="22")
    assert decoded["message_type"] == "Position Report"
    assert decoded["position"]["lat"] == pytest.approx(34.0145, abs=1e-3)


def test_decode_position_report_captures_waypoint():
    decoded = decode_message_text("REQ POS JAWBN", label="21")
    # No coordinates, but the requested fix ident is surfaced as a waypoint.
    assert decoded.get("waypoints") == ["JAWBN"]


def test_decode_position_label_without_geo_falls_through():
    # A label-20 message with no coords/fix shouldn't be mislabeled a position report.
    decoded = decode_message_text("OPS NORMAL", label="20")
    assert decoded.get("message_type") != "Position Report"
