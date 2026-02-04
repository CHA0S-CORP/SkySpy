"""
Tests for the Gamification Service.

Tests scoring algorithms, achievements, personal records, streaks,
rare sighting detection, and collection tracking.
"""

import re
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from skyspy.models import AircraftInfo, AircraftSession, AircraftSighting
from skyspy.models.stats import (
    DailyStats,
    NotableCallsign,
    NotableRegistration,
    PersonalRecord,
    RareAircraftType,
    RareSighting,
    SightingStreak,
    SpottedAircraft,
    SpottedCount,
)
from skyspy.services.gamification import (
    CACHE_KEY_COLLECTION_STATS,
    CACHE_KEY_DAILY_STATS,
    CACHE_KEY_LIFETIME_STATS,
    CACHE_KEY_PERSONAL_RECORDS,
    CACHE_KEY_RARE_SIGHTINGS,
    CACHE_KEY_SPOTTED_BY_OPERATOR,
    CACHE_KEY_SPOTTED_BY_TYPE,
    CACHE_KEY_STREAKS,
    DEFAULT_NOTABLE_CALLSIGNS,
    DEFAULT_NOTABLE_REGISTRATIONS,
    DEFAULT_RARE_TYPES,
    GamificationService,
    gamification_service,
)
from skyspy.tests.factories import (
    AircraftInfoFactory,
    AircraftSessionFactory,
    AircraftSightingFactory,
)


class DefaultPatternsTests(TestCase):
    """Tests for default notable patterns."""

    def test_default_notable_registrations_not_empty(self):
        """Test that default notable registrations are defined."""
        self.assertGreater(len(DEFAULT_NOTABLE_REGISTRATIONS), 0)

    def test_default_notable_registrations_have_required_fields(self):
        """Test that all notable registrations have required fields."""
        required_fields = ["name", "pattern", "pattern_type", "category", "rarity_score"]

        for pattern in DEFAULT_NOTABLE_REGISTRATIONS:
            for field in required_fields:
                self.assertIn(field, pattern, f"Pattern missing field: {field}")

    def test_default_notable_registrations_valid_pattern_types(self):
        """Test that pattern types are valid."""
        valid_types = ["prefix", "contains", "exact", "regex"]

        for pattern in DEFAULT_NOTABLE_REGISTRATIONS:
            self.assertIn(
                pattern["pattern_type"],
                valid_types,
                f"Invalid pattern type: {pattern['pattern_type']}",
            )

    def test_default_notable_callsigns_not_empty(self):
        """Test that default notable callsigns are defined."""
        self.assertGreater(len(DEFAULT_NOTABLE_CALLSIGNS), 0)

    def test_default_notable_callsigns_have_required_fields(self):
        """Test that all notable callsigns have required fields."""
        required_fields = ["name", "pattern", "pattern_type", "category", "rarity_score"]

        for pattern in DEFAULT_NOTABLE_CALLSIGNS:
            for field in required_fields:
                self.assertIn(field, pattern, f"Pattern missing field: {field}")

    def test_default_rare_types_not_empty(self):
        """Test that default rare types are defined."""
        self.assertGreater(len(DEFAULT_RARE_TYPES), 0)

    def test_default_rare_types_have_required_fields(self):
        """Test that all rare types have required fields."""
        required_fields = ["type_code", "type_name", "category", "rarity_score"]

        for rare_type in DEFAULT_RARE_TYPES:
            for field in required_fields:
                self.assertIn(field, rare_type, f"Rare type missing field: {field}")

    def test_regex_patterns_are_valid(self):
        """Test that all regex patterns compile successfully."""
        for pattern in DEFAULT_NOTABLE_REGISTRATIONS:
            if pattern["pattern_type"] == "regex":
                try:
                    re.compile(pattern["pattern"])
                except re.error as e:
                    self.fail(f"Invalid regex pattern '{pattern['pattern']}': {e}")

        for pattern in DEFAULT_NOTABLE_CALLSIGNS:
            if pattern["pattern_type"] == "regex":
                try:
                    re.compile(pattern["pattern"])
                except re.error as e:
                    self.fail(f"Invalid regex pattern '{pattern['pattern']}': {e}")


class GamificationServiceInitTests(TestCase):
    """Tests for GamificationService initialization."""

    def test_service_initializes(self):
        """Test that service initializes correctly."""
        service = GamificationService()
        self.assertIsNone(service._notable_registrations_cache)
        self.assertIsNone(service._notable_callsigns_cache)
        self.assertIsNone(service._rare_types_cache)

    def test_global_service_instance_exists(self):
        """Test that global service instance exists."""
        self.assertIsNotNone(gamification_service)
        self.assertIsInstance(gamification_service, GamificationService)


@pytest.mark.django_db
class PersonalRecordsTests(TestCase):
    """Tests for personal records functionality."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        PersonalRecord.objects.all().delete()
        self.service = GamificationService()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
        PersonalRecord.objects.all().delete()
        AircraftSession.objects.all().delete()
        AircraftInfo.objects.all().delete()

    def test_get_personal_records_empty(self):
        """Test getting personal records when none exist."""
        result = self.service.get_personal_records()

        self.assertEqual(result["records"], [])
        self.assertIn("timestamp", result)

    def test_get_personal_records_with_data(self):
        """Test getting personal records with existing data."""
        PersonalRecord.objects.create(
            record_type="max_distance",
            icao_hex="ABC123",
            callsign="UAL456",
            value=150.0,
            achieved_at=timezone.now(),
        )

        result = self.service.get_personal_records()

        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(result["records"][0]["record_type"], "max_distance")
        self.assertEqual(result["records"][0]["icao_hex"], "ABC123")
        self.assertEqual(result["records"][0]["value"], 150.0)

    def test_get_personal_records_caches_result(self):
        """Test that personal records are cached."""
        PersonalRecord.objects.create(
            record_type="max_distance",
            icao_hex="ABC123",
            value=150.0,
            achieved_at=timezone.now(),
        )

        # First call
        result1 = self.service.get_personal_records()

        # Second call should hit cache
        cached = cache.get(CACHE_KEY_PERSONAL_RECORDS)
        self.assertIsNotNone(cached)
        self.assertEqual(cached, result1)

    def test_get_personal_records_force_refresh(self):
        """Test force refresh bypasses cache."""
        # Pre-populate cache with stale data
        cache.set(CACHE_KEY_PERSONAL_RECORDS, {"records": [], "stale": True})

        PersonalRecord.objects.create(
            record_type="max_distance",
            icao_hex="ABC123",
            value=150.0,
            achieved_at=timezone.now(),
        )

        result = self.service.get_personal_records(force_refresh=True)

        self.assertEqual(len(result["records"]), 1)
        self.assertNotIn("stale", result)

    def test_check_and_update_records_max_distance(self):
        """Test checking and updating max distance record."""
        session = AircraftSessionFactory(max_distance_nm=200.0)

        new_records = self.service.check_and_update_records(session)

        self.assertGreater(len(new_records), 0)
        distance_records = [r for r in new_records if r["record_type"] == "max_distance"]
        self.assertEqual(len(distance_records), 1)
        self.assertEqual(distance_records[0]["value"], 200.0)

    def test_check_and_update_records_max_altitude(self):
        """Test checking and updating max altitude record."""
        session = AircraftSessionFactory(max_altitude=45000)

        new_records = self.service.check_and_update_records(session)

        altitude_records = [r for r in new_records if r["record_type"] == "max_altitude"]
        self.assertEqual(len(altitude_records), 1)
        self.assertEqual(altitude_records[0]["value"], 45000.0)

    def test_check_and_update_records_beats_existing(self):
        """Test that new record beats existing record."""
        # Create existing record
        PersonalRecord.objects.create(
            record_type="max_distance",
            icao_hex="OLD123",
            value=100.0,
            achieved_at=timezone.now() - timedelta(days=1),
        )

        # New session with higher value
        session = AircraftSessionFactory(max_distance_nm=150.0)

        new_records = self.service.check_and_update_records(session)

        distance_records = [r for r in new_records if r["record_type"] == "max_distance"]
        self.assertEqual(len(distance_records), 1)
        self.assertEqual(distance_records[0]["value"], 150.0)
        self.assertEqual(distance_records[0]["previous_value"], 100.0)

    def test_check_and_update_records_does_not_beat_existing(self):
        """Test that lower value doesn't create new record."""
        # Create existing record
        PersonalRecord.objects.create(
            record_type="max_distance",
            icao_hex="OLD123",
            value=200.0,
            achieved_at=timezone.now() - timedelta(days=1),
        )

        # New session with lower value
        session = AircraftSessionFactory(max_distance_nm=100.0)

        new_records = self.service.check_and_update_records(session)

        distance_records = [r for r in new_records if r["record_type"] == "max_distance"]
        self.assertEqual(len(distance_records), 0)

    def test_check_and_update_records_closest_approach_lower_is_better(self):
        """Test that closest approach uses lower is better."""
        session = AircraftSessionFactory(min_distance_nm=5.0)

        new_records = self.service.check_and_update_records(session)

        closest_records = [r for r in new_records if r["record_type"] == "closest_approach"]
        self.assertEqual(len(closest_records), 1)

        # Create existing record with larger distance
        PersonalRecord.objects.all().delete()
        PersonalRecord.objects.create(
            record_type="closest_approach",
            icao_hex="OLD123",
            value=10.0,  # Further away
            achieved_at=timezone.now() - timedelta(days=1),
        )

        session2 = AircraftSessionFactory(min_distance_nm=3.0)  # Closer
        new_records2 = self.service.check_and_update_records(session2)

        closest_records2 = [r for r in new_records2 if r["record_type"] == "closest_approach"]
        self.assertEqual(len(closest_records2), 1)
        self.assertEqual(closest_records2[0]["value"], 3.0)

    def test_check_and_update_records_with_sighting_speed(self):
        """Test checking speed record from sighting."""
        session = AircraftSessionFactory()
        sighting = AircraftSightingFactory(icao_hex=session.icao_hex, ground_speed=550)

        new_records = self.service.check_and_update_records(session, sighting)

        speed_records = [r for r in new_records if r["record_type"] == "max_speed"]
        self.assertEqual(len(speed_records), 1)
        self.assertEqual(speed_records[0]["value"], 550)

    def test_check_and_update_records_with_sighting_vertical_rate(self):
        """Test checking vertical rate record from sighting."""
        session = AircraftSessionFactory()
        sighting = AircraftSightingFactory(icao_hex=session.icao_hex, vertical_rate=4000)

        new_records = self.service.check_and_update_records(session, sighting)

        vr_records = [r for r in new_records if r["record_type"] == "max_vertical_rate"]
        self.assertEqual(len(vr_records), 1)

    def test_check_and_update_records_invalidates_cache(self):
        """Test that new records invalidate cache."""
        cache.set(CACHE_KEY_PERSONAL_RECORDS, {"records": [], "cached": True})

        session = AircraftSessionFactory(max_distance_nm=200.0)
        self.service.check_and_update_records(session)

        cached = cache.get(CACHE_KEY_PERSONAL_RECORDS)
        self.assertIsNone(cached)


@pytest.mark.django_db
class RareSightingsTests(TestCase):
    """Tests for rare sighting detection functionality."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        RareSighting.objects.all().delete()
        SpottedAircraft.objects.all().delete()
        self.service = GamificationService()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
        RareSighting.objects.all().delete()
        SpottedAircraft.objects.all().delete()
        AircraftSession.objects.all().delete()
        AircraftInfo.objects.all().delete()

    def test_get_rare_sightings_empty(self):
        """Test getting rare sightings when none exist."""
        result = self.service.get_rare_sightings()

        self.assertEqual(result["sightings"], [])
        self.assertEqual(result["total_count"], 0)

    def test_get_rare_sightings_with_data(self):
        """Test getting rare sightings with existing data."""
        RareSighting.objects.create(
            rarity_type="military",
            icao_hex="ABC123",
            callsign="REACH123",
            description="Military aircraft",
            rarity_score=6,
            sighted_at=timezone.now(),
        )

        result = self.service.get_rare_sightings()

        self.assertEqual(len(result["sightings"]), 1)
        self.assertEqual(result["sightings"][0]["rarity_type"], "military")

    def test_get_rare_sightings_excludes_acknowledged(self):
        """Test that acknowledged sightings are excluded by default."""
        RareSighting.objects.create(
            rarity_type="military",
            icao_hex="ABC123",
            description="Test",
            rarity_score=5,
            sighted_at=timezone.now(),
            is_acknowledged=True,
        )
        RareSighting.objects.create(
            rarity_type="government",
            icao_hex="DEF456",
            description="Test2",
            rarity_score=8,
            sighted_at=timezone.now(),
            is_acknowledged=False,
        )

        result = self.service.get_rare_sightings(include_acknowledged=False)

        self.assertEqual(len(result["sightings"]), 1)
        self.assertEqual(result["sightings"][0]["icao_hex"], "DEF456")

    def test_get_rare_sightings_includes_acknowledged_when_requested(self):
        """Test that acknowledged sightings can be included."""
        RareSighting.objects.create(
            rarity_type="military",
            icao_hex="ABC123",
            description="Test",
            rarity_score=5,
            sighted_at=timezone.now(),
            is_acknowledged=True,
        )

        result = self.service.get_rare_sightings(include_acknowledged=True)

        self.assertEqual(len(result["sightings"]), 1)

    def test_check_for_rare_sighting_first_hex(self):
        """Test detection of first-time sighting."""
        session = AircraftSessionFactory()

        rare_sightings = self.service.check_for_rare_sighting(session)

        first_hex = [s for s in rare_sightings if s["rarity_type"] == "first_hex"]
        self.assertEqual(len(first_hex), 1)

    def test_check_for_rare_sighting_military(self):
        """Test detection of military aircraft."""
        session = AircraftSessionFactory(is_military=True)

        rare_sightings = self.service.check_for_rare_sighting(session)

        military = [s for s in rare_sightings if s["rarity_type"] == "military"]
        self.assertEqual(len(military), 1)

    def test_check_notable_registration_us_government(self):
        """Test detection of US government registration."""
        result = self.service._check_notable_registration("N100")

        self.assertIsNotNone(result)
        self.assertEqual(result["category"], "government")

    def test_check_notable_registration_boeing_test(self):
        """Test detection of Boeing test flight."""
        result = self.service._check_notable_registration("N700")

        self.assertIsNotNone(result)
        self.assertEqual(result["category"], "test_flight")

    def test_check_notable_registration_no_match(self):
        """Test no match for normal registration."""
        result = self.service._check_notable_registration("N12345")

        self.assertIsNone(result)

    def test_check_notable_callsign_military_reach(self):
        """Test detection of REACH military callsign."""
        result = self.service._check_notable_callsign("RCH123")

        self.assertIsNotNone(result)
        self.assertEqual(result["category"], "military")

    def test_check_notable_callsign_medevac(self):
        """Test detection of air ambulance callsign."""
        result = self.service._check_notable_callsign("MEDEVAC1")

        self.assertIsNotNone(result)
        self.assertEqual(result["category"], "air_ambulance")

    def test_check_notable_callsign_coast_guard(self):
        """Test detection of Coast Guard callsign."""
        result = self.service._check_notable_callsign("COAST1")

        self.assertIsNotNone(result)
        self.assertEqual(result["category"], "law_enforcement")

    def test_check_rare_type_b748(self):
        """Test detection of rare 747-8."""
        result = self.service._check_rare_type("B748")

        self.assertIsNotNone(result)
        self.assertEqual(result["type_code"], "B748")

    def test_check_rare_type_a380(self):
        """Test detection of rare A380."""
        result = self.service._check_rare_type("A380")

        self.assertIsNotNone(result)

    def test_check_rare_type_common(self):
        """Test no match for common type."""
        result = self.service._check_rare_type("B738")

        self.assertIsNone(result)

    def test_acknowledge_rare_sighting(self):
        """Test acknowledging a rare sighting."""
        sighting = RareSighting.objects.create(
            rarity_type="military",
            icao_hex="ABC123",
            description="Test",
            rarity_score=5,
            sighted_at=timezone.now(),
            is_acknowledged=False,
        )

        result = self.service.acknowledge_rare_sighting(sighting.id)

        self.assertTrue(result)
        sighting.refresh_from_db()
        self.assertTrue(sighting.is_acknowledged)

    def test_acknowledge_rare_sighting_not_found(self):
        """Test acknowledging non-existent sighting."""
        result = self.service.acknowledge_rare_sighting(99999)
        self.assertFalse(result)


@pytest.mark.django_db
class CollectionStatsTests(TestCase):
    """Tests for collection/spotting statistics."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        SpottedAircraft.objects.all().delete()
        SpottedCount.objects.all().delete()
        self.service = GamificationService()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
        SpottedAircraft.objects.all().delete()
        SpottedCount.objects.all().delete()
        AircraftSession.objects.all().delete()
        AircraftInfo.objects.all().delete()

    def test_get_collection_stats_empty(self):
        """Test collection stats when empty."""
        result = self.service.get_collection_stats()

        self.assertEqual(result["total_unique_aircraft"], 0)
        self.assertEqual(result["military_aircraft"], 0)

    def test_get_collection_stats_with_data(self):
        """Test collection stats with data."""
        SpottedAircraft.objects.create(
            icao_hex="ABC123",
            registration="N12345",
            aircraft_type="B738",
            operator="United Airlines",
            is_military=False,
            first_seen=timezone.now() - timedelta(days=1),
            last_seen=timezone.now(),
            times_seen=5,
        )
        SpottedAircraft.objects.create(
            icao_hex="MIL123",
            registration="MIL123",
            is_military=True,
            first_seen=timezone.now(),
            last_seen=timezone.now(),
            times_seen=1,
        )

        result = self.service.get_collection_stats()

        self.assertEqual(result["total_unique_aircraft"], 2)
        self.assertEqual(result["military_aircraft"], 1)

    def test_get_collection_stats_caches_result(self):
        """Test that collection stats are cached."""
        SpottedAircraft.objects.create(
            icao_hex="ABC123",
            first_seen=timezone.now(),
            last_seen=timezone.now(),
            times_seen=1,
        )

        self.service.get_collection_stats()

        cached = cache.get(CACHE_KEY_COLLECTION_STATS)
        self.assertIsNotNone(cached)

    def test_get_spotted_by_type_empty(self):
        """Test spotted by type when empty."""
        result = self.service.get_spotted_by_type()

        self.assertEqual(result["types"], [])

    def test_get_spotted_by_type_with_data(self):
        """Test spotted by type with data."""
        SpottedCount.objects.create(
            count_type="aircraft_type",
            identifier="B738",
            display_name="Boeing 737-800",
            unique_aircraft=10,
            total_sessions=50,
            total_sightings=500,
            first_seen=timezone.now() - timedelta(days=30),
            last_seen=timezone.now(),
        )

        result = self.service.get_spotted_by_type()

        self.assertEqual(len(result["types"]), 1)
        self.assertEqual(result["types"][0]["type_code"], "B738")
        self.assertEqual(result["types"][0]["unique_aircraft"], 10)

    def test_get_spotted_by_operator_empty(self):
        """Test spotted by operator when empty."""
        result = self.service.get_spotted_by_operator()

        self.assertEqual(result["operators"], [])

    def test_update_spotted_aircraft_new(self):
        """Test updating spotted aircraft for new aircraft."""
        session = AircraftSessionFactory(
            first_seen=timezone.now() - timedelta(hours=1),
            last_seen=timezone.now(),
            total_positions=100,
            max_distance_nm=50.0,
            max_altitude=35000,
        )

        self.service.update_spotted_aircraft(session)

        spotted = SpottedAircraft.objects.get(icao_hex=session.icao_hex)
        self.assertEqual(spotted.times_seen, 1)
        self.assertEqual(spotted.total_positions, 100)

    def test_update_spotted_aircraft_existing(self):
        """Test updating spotted aircraft for existing aircraft."""
        session = AircraftSessionFactory(
            first_seen=timezone.now() - timedelta(hours=1),
            last_seen=timezone.now(),
            total_positions=100,
            max_distance_nm=50.0,
        )

        # Create existing spotted record
        SpottedAircraft.objects.create(
            icao_hex=session.icao_hex,
            first_seen=timezone.now() - timedelta(days=1),
            last_seen=timezone.now() - timedelta(hours=2),
            times_seen=5,
            total_positions=200,
            max_distance_nm=30.0,
        )

        self.service.update_spotted_aircraft(session)

        spotted = SpottedAircraft.objects.get(icao_hex=session.icao_hex)
        self.assertEqual(spotted.times_seen, 6)
        self.assertEqual(spotted.total_positions, 300)
        self.assertEqual(spotted.max_distance_nm, 50.0)  # Updated to higher value


@pytest.mark.django_db
class StreakTests(TestCase):
    """Tests for streak tracking functionality."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        SightingStreak.objects.all().delete()
        SpottedAircraft.objects.all().delete()
        self.service = GamificationService()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
        SightingStreak.objects.all().delete()
        SpottedAircraft.objects.all().delete()
        AircraftSession.objects.all().delete()

    def test_get_streaks_empty(self):
        """Test getting streaks when none exist."""
        result = self.service.get_streaks()

        self.assertEqual(result["streaks"], [])

    def test_get_streaks_with_data(self):
        """Test getting streaks with existing data."""
        SightingStreak.objects.create(
            streak_type="any_sighting",
            current_streak_days=5,
            current_streak_start=date.today() - timedelta(days=5),
            last_qualifying_date=date.today(),
            best_streak_days=10,
            best_streak_start=date.today() - timedelta(days=20),
            best_streak_end=date.today() - timedelta(days=10),
        )

        result = self.service.get_streaks()

        self.assertEqual(len(result["streaks"]), 1)
        self.assertEqual(result["streaks"][0]["streak_type"], "any_sighting")
        self.assertEqual(result["streaks"][0]["current_streak_days"], 5)
        self.assertEqual(result["streaks"][0]["best_streak_days"], 10)

    def test_update_streaks_creates_new(self):
        """Test that update_streaks creates new streak."""
        session = AircraftSessionFactory()

        self.service.update_streaks(session)

        streak = SightingStreak.objects.get(streak_type="any_sighting")
        self.assertEqual(streak.current_streak_days, 1)
        self.assertEqual(streak.last_qualifying_date, timezone.now().date())

    def test_update_streaks_continues_streak(self):
        """Test that update_streaks continues existing streak."""
        yesterday = date.today() - timedelta(days=1)
        SightingStreak.objects.create(
            streak_type="any_sighting",
            current_streak_days=3,
            current_streak_start=date.today() - timedelta(days=3),
            last_qualifying_date=yesterday,
            best_streak_days=3,
        )

        session = AircraftSessionFactory()
        self.service.update_streaks(session)

        streak = SightingStreak.objects.get(streak_type="any_sighting")
        self.assertEqual(streak.current_streak_days, 4)
        self.assertEqual(streak.last_qualifying_date, date.today())

    def test_update_streaks_resets_broken_streak(self):
        """Test that broken streak is reset."""
        two_days_ago = date.today() - timedelta(days=2)
        SightingStreak.objects.create(
            streak_type="any_sighting",
            current_streak_days=5,
            current_streak_start=date.today() - timedelta(days=7),
            last_qualifying_date=two_days_ago,  # Missed yesterday
            best_streak_days=5,
        )

        session = AircraftSessionFactory()
        self.service.update_streaks(session)

        streak = SightingStreak.objects.get(streak_type="any_sighting")
        self.assertEqual(streak.current_streak_days, 1)
        self.assertEqual(streak.current_streak_start, date.today())

    def test_update_streaks_military(self):
        """Test military streak tracking."""
        session = AircraftSessionFactory(is_military=True)

        self.service.update_streaks(session)

        streak = SightingStreak.objects.get(streak_type="military")
        self.assertEqual(streak.current_streak_days, 1)

    def test_update_streaks_high_altitude(self):
        """Test high altitude streak tracking."""
        session = AircraftSessionFactory(max_altitude=42000)

        self.service.update_streaks(session)

        streak = SightingStreak.objects.get(streak_type="high_altitude")
        self.assertEqual(streak.current_streak_days, 1)

    def test_update_streaks_long_range(self):
        """Test long range streak tracking."""
        session = AircraftSessionFactory(max_distance_nm=150.0)

        self.service.update_streaks(session)

        streak = SightingStreak.objects.get(streak_type="long_range")
        self.assertEqual(streak.current_streak_days, 1)


@pytest.mark.django_db
class DailyStatsTests(TestCase):
    """Tests for daily statistics."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        DailyStats.objects.all().delete()
        self.service = GamificationService()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
        DailyStats.objects.all().delete()
        AircraftSession.objects.all().delete()
        AircraftSighting.objects.all().delete()
        SpottedAircraft.objects.all().delete()

    def test_get_daily_stats_empty(self):
        """Test getting daily stats when none exist."""
        result = self.service.get_daily_stats()

        self.assertEqual(result["days"], [])

    def test_get_daily_stats_with_data(self):
        """Test getting daily stats with data."""
        DailyStats.objects.create(
            date=date.today(),
            unique_aircraft=50,
            new_aircraft=5,
            total_sessions=75,
            total_positions=1000,
            military_count=3,
            max_distance_nm=100.0,
            max_altitude=45000,
            max_speed=550,
            aircraft_types={"B738": 10, "A320": 8},
            operators={"United Airlines": 5, "Delta": 4},
        )

        result = self.service.get_daily_stats(days=7)

        self.assertEqual(len(result["days"]), 1)
        self.assertEqual(result["days"][0]["unique_aircraft"], 50)
        self.assertEqual(result["days"][0]["military_count"], 3)

    def test_update_daily_stats(self):
        """Test updating daily stats."""
        now = timezone.now()
        day_start = timezone.make_aware(timezone.datetime.combine(now.date(), timezone.datetime.min.time()))

        # Create some sessions for today
        AircraftSessionFactory(
            first_seen=day_start + timedelta(hours=1),
            last_seen=day_start + timedelta(hours=2),
            total_positions=100,
            max_distance_nm=50.0,
            max_altitude=35000,
            is_military=False,
            aircraft_type="B738",
        )
        AircraftSessionFactory(
            first_seen=day_start + timedelta(hours=3),
            last_seen=day_start + timedelta(hours=4),
            total_positions=150,
            max_distance_nm=75.0,
            max_altitude=40000,
            is_military=True,
            aircraft_type="A320",
        )

        self.service.update_daily_stats(for_date=now.date())

        stats = DailyStats.objects.get(date=now.date())
        self.assertEqual(stats.unique_aircraft, 2)
        self.assertEqual(stats.total_sessions, 2)
        self.assertEqual(stats.military_count, 1)
        self.assertEqual(stats.max_distance_nm, 75.0)
        self.assertEqual(stats.max_altitude, 40000)


@pytest.mark.django_db
class LifetimeStatsTests(TestCase):
    """Tests for lifetime statistics."""

    def setUp(self):
        """Set up test fixtures."""
        cache.clear()
        self.service = GamificationService()

    def tearDown(self):
        """Clean up after tests."""
        cache.clear()
        SpottedAircraft.objects.all().delete()
        AircraftSession.objects.all().delete()
        AircraftSighting.objects.all().delete()
        PersonalRecord.objects.all().delete()
        RareSighting.objects.all().delete()
        DailyStats.objects.all().delete()

    def test_get_lifetime_stats_empty(self):
        """Test getting lifetime stats when empty."""
        result = self.service.get_lifetime_stats()

        self.assertEqual(result["total_unique_aircraft"], 0)
        self.assertEqual(result["total_sessions"], 0)
        self.assertEqual(result["total_positions"], 0)

    def test_get_lifetime_stats_with_data(self):
        """Test getting lifetime stats with data."""
        SpottedAircraft.objects.create(
            icao_hex="ABC123",
            aircraft_type="B738",
            operator="United Airlines",
            country="United States",
            first_seen=timezone.now(),
            last_seen=timezone.now(),
            times_seen=1,
        )

        PersonalRecord.objects.create(
            record_type="max_distance",
            icao_hex="ABC123",
            value=150.0,
            achieved_at=timezone.now(),
        )

        result = self.service.get_lifetime_stats()

        self.assertEqual(result["total_unique_aircraft"], 1)
        self.assertIn("max_distance", result["all_time_records"])

    def test_get_lifetime_stats_caches_result(self):
        """Test that lifetime stats are cached."""
        self.service.get_lifetime_stats()

        cached = cache.get(CACHE_KEY_LIFETIME_STATS)
        self.assertIsNotNone(cached)


@pytest.mark.django_db
class PatternCachingTests(TestCase):
    """Tests for pattern caching in the service."""

    def setUp(self):
        """Set up test fixtures."""
        NotableRegistration.objects.all().delete()
        NotableCallsign.objects.all().delete()
        RareAircraftType.objects.all().delete()
        self.service = GamificationService()
        # Reset caches
        self.service._notable_registrations_cache = None
        self.service._notable_callsigns_cache = None
        self.service._rare_types_cache = None

    def tearDown(self):
        """Clean up after tests."""
        NotableRegistration.objects.all().delete()
        NotableCallsign.objects.all().delete()
        RareAircraftType.objects.all().delete()

    def test_get_notable_registrations_uses_defaults(self):
        """Test that defaults are used when no DB patterns."""
        patterns = self.service._get_notable_registrations()

        self.assertEqual(patterns, DEFAULT_NOTABLE_REGISTRATIONS)

    def test_get_notable_registrations_uses_db(self):
        """Test that DB patterns override defaults."""
        NotableRegistration.objects.create(
            name="Custom Pattern",
            pattern="CUSTOM",
            pattern_type="prefix",
            category="custom",
            rarity_score=5,
            is_active=True,
        )

        # Reset cache
        self.service._notable_registrations_cache = None
        patterns = self.service._get_notable_registrations()

        self.assertEqual(len(patterns), 1)
        self.assertEqual(patterns[0]["name"], "Custom Pattern")

    def test_get_notable_callsigns_uses_defaults(self):
        """Test that defaults are used when no DB patterns."""
        patterns = self.service._get_notable_callsigns()

        self.assertEqual(patterns, DEFAULT_NOTABLE_CALLSIGNS)

    def test_get_rare_types_uses_defaults(self):
        """Test that defaults are used when no DB types."""
        types = self.service._get_rare_types()

        self.assertEqual(types, DEFAULT_RARE_TYPES)

    def test_get_rare_types_uses_db(self):
        """Test that DB rare types override defaults."""
        RareAircraftType.objects.create(
            type_code="CUSTOM",
            type_name="Custom Type",
            category="custom",
            rarity_score=7,
            is_active=True,
        )

        # Reset cache
        self.service._rare_types_cache = None
        types = self.service._get_rare_types()

        self.assertEqual(len(types), 1)
        self.assertEqual(types[0]["type_code"], "CUSTOM")

    def test_patterns_are_cached(self):
        """Test that patterns are cached after first access."""
        # First access
        self.service._get_notable_registrations()

        self.assertIsNotNone(self.service._notable_registrations_cache)

        # Modify cache to verify it's used
        self.service._notable_registrations_cache = [{"cached": True}]

        # Second access should return cached value
        patterns = self.service._get_notable_registrations()
        self.assertEqual(patterns, [{"cached": True}])
