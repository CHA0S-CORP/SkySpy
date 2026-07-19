"""
Tests for assistant map render payloads (services/assistant/agent._map_from_obs).

Covers the aircraft-map tools that carry a radar deep-link filter — the pure
transform from a tool observation to {title, points, filter}.
"""

import json

from skyspy.services.assistant import agent, tools


class TestMapFromObs:
    def test_threat_assessment_builds_aircraft_map_with_filter(self):
        obs = json.dumps(
            {
                "count": 2,
                "threats": [
                    {"hex": "A0E2E5", "callsign": "N1560V", "lat": 32.8, "lon": -117.2, "is_surveillance_type": True},
                    {"hex": "AAAA11", "callsign": "N739MH", "lat": 32.9, "lon": -117.3, "is_law_enforcement": True},
                ],
            }
        )
        m = agent._map_from_obs("threat_assessment", obs)
        assert m["title"] == "Threat & surveillance aircraft"
        assert [p["kind"] for p in m["points"]] == ["aircraft", "aircraft"]
        # LE / surveillance flagged in the alert colour.
        assert all(p["military"] for p in m["points"])
        # filter = the aircraft identifiers, hex preferred.
        assert m["filter"] == ["A0E2E5", "AAAA11"]

    def test_detect_unusual_patterns_uses_center_coords(self):
        obs = json.dumps(
            {
                "count": 1,
                "results": [
                    {
                        "icao_hex": "A11111",
                        "callsign": "N220WC",
                        "center": {"lat": 33.0, "lon": -117.1},
                        "is_military": False,
                    }
                ],
            }
        )
        m = agent._map_from_obs("detect_unusual_patterns", obs)
        assert m["title"] == "Unusual flight patterns"
        assert m["points"][0]["lat"] == 33.0
        assert m["points"][0]["hex"] == "A11111"
        assert m["filter"] == ["A11111"]

    def test_filter_prefers_hex_falls_back_to_callsign_and_dedupes(self):
        points = [
            {"hex": "ABC123", "callsign": "UAL1"},
            {"hex": "", "callsign": "SWA2"},
            {"hex": "abc123", "callsign": "DUP"},  # dup hex (case-insensitive)
        ]
        assert agent._filter_ids(points) == ["ABC123", "SWA2"]

    def test_live_aircraft_map_included_in_aircraft_map_tools(self):
        obs = json.dumps({"count": 1, "aircraft": [{"hex": "DEAD01", "callsign": "TST1", "lat": 1.0, "lon": 2.0}]})
        m = agent._map_from_obs("live_aircraft_map", obs)
        assert m["filter"] == ["DEAD01"]

    def test_track_map_has_no_filter(self):
        obs = json.dumps({"icao_hex": "BEEF01", "track": [{"lat": 1.0, "lon": 2.0}, {"lat": 1.1, "lon": 2.1}]})
        m = agent._map_from_obs("aircraft_track", obs)
        assert m["polyline"] is True
        assert "filter" not in m

    def test_no_positioned_points_returns_none(self):
        obs = json.dumps({"threats": [{"hex": "X", "callsign": "Y"}]})  # no lat/lon
        assert agent._map_from_obs("threat_assessment", obs) is None

    def test_radar_filter_map_carries_radar_spec(self):
        obs = json.dumps(
            {
                "label": "Military",
                "count": 1,
                "aircraft": [{"hex": "AE1234", "callsign": "RCH1", "lat": 33.0, "lon": -117.0, "military": True}],
                "radar": {"label": "Military", "match": {"military": True}, "view": "fit"},
            }
        )
        m = agent._map_from_obs("radar_filter", obs)
        assert m["title"] == "Military"
        assert m["filter"] == ["AE1234"]
        assert m["radar"]["match"] == {"military": True}

    def test_radar_from_obs_extracts_command(self):
        obs = json.dumps({"label": "GA", "count": 5, "radar": {"label": "GA", "match": {"ga": True}, "view": "fit"}})
        cmd = agent._radar_from_obs(obs)
        assert cmd["label"] == "GA"
        assert cmd["match"] == {"ga": True}
        assert cmd["view"] == "fit"
        assert cmd["count"] == 5

    def test_radar_from_obs_none_without_match(self):
        assert agent._radar_from_obs(json.dumps({"count": 0})) is None


class TestRadarMatch:
    def _ac(self, **kw):
        base = {"hex": "A11111", "flight": "N123", "category": "A1", "t": "C172", "military": False}
        base.update(kw)
        return base

    def test_ga_matches_light_category_non_military(self):
        m = tools._build_radar_match(
            military=False,
            law_enforcement=False,
            emergency=False,
            classes="",
            type_prefix="",
            general_aviation=True,
            categories="",
            types="",
            callsigns="",
            hexes="",
            callsign_prefix="",
            alt_min=0,
            alt_max=0,
            dist_max=0,
        )
        assert m == {"ga": True}
        assert tools._match_live_aircraft(self._ac(category="A1"), m) is True
        assert tools._match_live_aircraft(self._ac(category="A5"), m) is False  # heavy
        assert tools._match_live_aircraft(self._ac(category="A1", military=True), m) is False

    def test_emergency_matches_squawk(self):
        m = {"emergency": True}
        assert tools._match_live_aircraft(self._ac(squawk="7700"), m) is True
        assert tools._match_live_aircraft(self._ac(squawk="1200"), m) is False
        assert tools._match_live_aircraft(self._ac(emergency=True), m) is True

    def test_type_and_altitude_and_distance_band(self):
        m = tools._build_radar_match(
            military=False,
            law_enforcement=False,
            emergency=False,
            classes="",
            type_prefix="",
            general_aviation=False,
            categories="",
            types="C172,PA28",
            callsigns="",
            hexes="",
            callsign_prefix="",
            alt_min=0,
            alt_max=5000,
            dist_max=50,
        )
        assert m == {"types": ["C172", "PA28"], "altMax": 5000, "distMax": 50.0}
        assert tools._match_live_aircraft(self._ac(t="C172", alt_baro=3000, distance_nm=10), m) is True
        assert tools._match_live_aircraft(self._ac(t="B738", alt_baro=3000, distance_nm=10), m) is False  # type
        assert tools._match_live_aircraft(self._ac(t="C172", alt_baro=9000, distance_nm=10), m) is False  # alt
        assert tools._match_live_aircraft(self._ac(t="C172", alt_baro=3000, distance_nm=99), m) is False  # dist

    def test_callsign_prefix(self):
        m = tools._build_radar_match(
            military=False,
            law_enforcement=False,
            emergency=False,
            classes="",
            type_prefix="",
            general_aviation=False,
            categories="",
            types="",
            callsigns="",
            hexes="",
            callsign_prefix="CHP",
            alt_min=0,
            alt_max=0,
            dist_max=0,
        )
        assert tools._match_live_aircraft(self._ac(flight="CHP50"), m) is True
        assert tools._match_live_aircraft(self._ac(flight="N123"), m) is False

    def _class_match(self, classes):
        return tools._build_radar_match(
            military=False,
            law_enforcement=False,
            emergency=False,
            general_aviation=False,
            classes=classes,
            type_prefix="",
            categories="",
            types="",
            callsigns="",
            hexes="",
            callsign_prefix="",
            alt_min=0,
            alt_max=0,
            dist_max=0,
        )

    def test_widebody_class_matches_variant_types_and_heavy_category(self):
        m = self._class_match("widebody")
        assert "anyOf" in m
        # Variant type designators the model's base-code list would MISS.
        for t in ("B77W", "A359", "B789", "A388", "B763"):
            assert tools._match_live_aircraft(self._ac(t=t, category=None), m) is True, t
        # Heavy category also matches even if type is unknown.
        assert tools._match_live_aircraft(self._ac(t=None, category="A5"), m) is True
        # A narrowbody is excluded.
        assert tools._match_live_aircraft(self._ac(t="B738", category="A3"), m) is False

    def test_helicopter_class_matches_rotorcraft_category(self):
        m = self._class_match("helicopter")
        assert tools._match_live_aircraft(self._ac(t="AS50", category="A7"), m) is True
        assert tools._match_live_aircraft(self._ac(t="C172", category="A1"), m) is False

    def test_type_prefix_matches_family(self):
        m = tools._build_radar_match(
            military=False,
            law_enforcement=False,
            emergency=False,
            general_aviation=False,
            classes="",
            type_prefix="B73",
            categories="",
            types="",
            callsigns="",
            hexes="",
            callsign_prefix="",
            alt_min=0,
            alt_max=0,
            dist_max=0,
        )
        assert m == {"typePrefixes": ["B73"]}
        assert tools._match_live_aircraft(self._ac(t="B738"), m) is True
        assert tools._match_live_aircraft(self._ac(t="B38M"), m) is False  # not B73*
        assert tools._match_live_aircraft(self._ac(t="A320"), m) is False
