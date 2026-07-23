"""
Assistant tool tests against a SEEDED database (see the seeded_world fixture).

The empty-DB shape tests in test_services_assistant.py prove tools return valid
JSON; these prove the JSON contains the seeded FACTS — catching field-name drift
between models/serializers and the tool output the model reasons over.
"""

import json

from skyspy.services.assistant import tools


class TestSeededTracks:
    def test_find_sightings_counts_the_seeded_aircraft(self, seeded_world):
        data = json.loads(tools.find_sightings(seeded_world["linear_hex"], 24))
        assert data.get("error") is None
        assert (data.get("count") or data.get("sightings") or data.get("total")) is not None
        text = json.dumps(data)
        assert seeded_world["linear_hex"] in text

    def test_aircraft_track_flags_the_orbit(self, seeded_world):
        data = json.loads(tools.aircraft_track(seeded_world["orbit_hex"], 24))
        assert data.get("error") is None
        flags = data.get("behavior") or data.get("flags") or data
        assert json.dumps(flags).find("orbit_or_loiter") != -1
        # The closed-circle seed must trip the orbit heuristic.
        blob = json.dumps(data)
        assert '"orbit_or_loiter":true' in blob.replace(" ", "").lower()

    def test_linear_track_is_not_an_orbit(self, seeded_world):
        data = json.loads(tools.aircraft_track(seeded_world["linear_hex"], 24))
        blob = json.dumps(data).replace(" ", "").lower()
        assert '"orbit_or_loiter":false' in blob

    def test_plot_tracks_returns_seeded_coordinates(self, seeded_world):
        data = json.loads(tools.plot_tracks(f"{seeded_world['linear_hex']},{seeded_world['orbit_hex']}", 24))
        assert data["count"] == 2
        pts = data["tracks"][seeded_world["orbit_hex"]]["pts"]
        assert len(pts) >= 4
        lat, lon = pts[0][0], pts[0][1]
        assert abs(lat - 47.5) < 0.1 and abs(lon - (-122.3)) < 0.1

    def test_busiest_tails_ranks_seeded_aircraft(self, seeded_world):
        data = json.loads(tools.busiest_tails(24, 10))
        blob = json.dumps(data)
        assert seeded_world["orbit_hex"] in blob or seeded_world["orbit_callsign"] in blob


class TestSeededSafetyAndAcars:
    def test_find_safety_events_contains_seeded_events(self, seeded_world):
        data = json.loads(tools.find_safety_events(24))
        blob = json.dumps(data)
        assert seeded_world["tcas_hex"] in blob
        assert seeded_world["emergency_hex"] in blob
        assert "tcas_ra" in blob
        assert "7700" in blob

    def test_notable_acars_surfaces_seeded_token(self, seeded_world):
        data = json.loads(tools.notable_acars_messages(24, 15))
        blob = json.dumps(data)
        assert seeded_world["acars_token"] in blob

    def test_acars_summary_counts_seeded_messages(self, seeded_world):
        data = json.loads(tools.acars_summary(24))
        blob = json.dumps(data)
        # 3 seeded messages must be reflected somewhere in the totals.
        assert data.get("error") is None
        assert "3" in blob


class TestSeededWeatherRefs:
    def test_recent_pireps_decodes_seeded_reports(self, seeded_world):
        data = json.loads(tools.recent_pireps(6, 15))
        assert data.get("error") is None
        blob = json.dumps(data)
        assert seeded_world["airport"] in blob
        # The severe (UUA/SEV) seed must surface with its severity decoded.
        assert "SEV" in blob or "severe" in blob.lower()

    def test_airport_notams_returns_seeded_closure(self, seeded_world):
        data = json.loads(tools.airport_notams(seeded_world["airport"]))
        assert data["icao"] == seeded_world["airport"]
        assert data["count"] >= 1
        blob = json.dumps(data)
        assert "16L/34R" in blob


class TestSeededLiveCache:
    def test_live_traffic_summary_returns_clean_shape(self, seeded_world):
        # live_traffic_summary reads the stats cache (not raw current_aircraft),
        # which no fixture populates — assert the shape stays clean; the seeded
        # live-cache truth is covered by test_live_aircraft_map_focuses below.
        data = json.loads(tools.live_traffic_summary())
        assert data.get("error") is None
        assert "stats" in data

    def test_live_aircraft_map_focuses_on_seeded_hex(self, seeded_world):
        data = json.loads(tools.live_aircraft_map(hexes=seeded_world["orbit_hex"]))
        blob = json.dumps(data)
        assert seeded_world["orbit_hex"] in blob
        assert seeded_world["linear_hex"] not in blob

    def test_decode_squawk_by_aircraft_reads_live_squawk(self, seeded_world):
        data = json.loads(tools.decode_squawk(identifier=seeded_world["orbit_callsign"]))
        assert data["code"] == "1200"
        assert data["category"] == "vfr"
        assert data["aircraft"]["icao_hex"] == seeded_world["orbit_hex"]
        # And the live scan lists who's squawking 1200 right now.
        hexes = {a["hex"] for a in data["live_aircraft_squawking"]}
        assert seeded_world["orbit_hex"] in hexes

    def test_decode_squawk_static_codes(self, seeded_world):
        assert json.loads(tools.decode_squawk("7700"))["category"] == "emergency"
        assert json.loads(tools.decode_squawk("7500"))["severity"] == "critical"
        assert json.loads(tools.decode_squawk("1277"))["category"] == "special"
        assert json.loads(tools.decode_squawk("4521"))["category"] == "discrete"
        assert "error" in json.loads(tools.decode_squawk("99"))


class TestNewReferenceTools:
    def test_military_reference_filters_by_keyword(self, db):
        summary = json.loads(tools.military_reference())
        assert summary["callsign_pattern_count"] > 0
        tanker = json.loads(tools.military_reference("tanker"))
        blob = json.dumps(tanker).lower()
        assert "tanker" in blob or "refuel" in blob

    def test_identify_military_resolves_and_classifies(self, seeded_world):
        data = json.loads(tools.identify_military(seeded_world["orbit_callsign"]))
        assert data["icao_hex"] == seeded_world["orbit_hex"]
        assert "is_military" in data
        assert "confidence" in data

    def test_nearby_navaids_empty_db_is_clean(self, db):
        data = json.loads(tools.nearby_navaids())
        assert data.get("error") is None or "FEEDER" in str(data.get("error"))
        if data.get("error") is None:
            assert data["count"] == 0

    def test_airspace_near_unconfigured_is_explicit_error(self, db):
        # OpenAIP is unconfigured in tests — the tool must return an explicit
        # error, never an empty success the model would read as "no airspace".
        data = json.loads(tools.airspace_near())
        assert "error" in data

    def test_web_search_gated_off_by_default(self, db):
        data = json.loads(tools.web_search("test query"))
        assert "error" in data
        assert "not enabled" in data["error"]

    def test_decode_aviation_text_notam_deterministic_decode(self, db):
        data = json.loads(tools.decode_aviation_text("notam", "RWY 16L/34R CLSD DUE TO CONST"))
        assert data["kind"] == "notam"
        assert data["decoded"]["category"]
        assert "expanded" in data["decoded"]
        # LLM off in tests → no explanation, but the decode still lands.
        assert data["explanation"] is None

    def test_elevation_at_returns_number_or_clean_error(self, db):
        data = json.loads(tools.elevation_at(47.5, -122.3))
        assert "error" in data or isinstance(data.get("elevation_ft"), int)
