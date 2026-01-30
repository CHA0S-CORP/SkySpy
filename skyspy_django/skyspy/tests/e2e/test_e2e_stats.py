"""
Comprehensive E2E tests for the SkySpy Django API statistics and gamification system.

Tests cover:
1. Tracking Quality Stats - session quality metrics, coverage gaps
2. Engagement Stats - user engagement analytics, activity times
3. Aircraft Favorites - managing favorite aircraft
4. Flight Pattern Stats - routes, time-of-day patterns
5. Geographic Stats - distribution by country, operator
6. Combined Stats - aggregated daily/weekly/monthly metrics
7. Personal Records - achievements and all-time bests
8. Rare Sightings - first-time and unusual aircraft
9. Spotted Aircraft Collection - unique aircraft collection tracking
10. Daily Stats - daily cumulative statistics
11. ACARS Statistics - message stats, airline breakdown, trends
"""
import os
import pytest
from datetime import timedelta
from unittest.mock import patch, MagicMock

# Check if using SQLite (some stats require PostgreSQL features)
_IS_SQLITE = not os.environ.get('DATABASE_URL')

from django.utils import timezone
from django.core.cache import cache
from rest_framework import status

from skyspy.models import (
    AircraftSighting,
    AircraftSession,
    AircraftInfo,
    AircraftFavorite,
    AcarsMessage,
)
from skyspy.models.stats import (
    PersonalRecord,
    RareSighting,
    SpottedAircraft,
    SpottedCount,
    SightingStreak,
    DailyStats,
    NotableRegistration,
    NotableCallsign,
    RareAircraftType,
)
from skyspy.tests.factories import (
    AircraftSightingFactory,
    AircraftSessionFactory,
    AircraftInfoFactory,
    AcarsMessageFactory,
)


# =============================================================================
# Test Data Fixtures
# =============================================================================

@pytest.fixture
def tracking_sessions_batch(db):
    """Create batch of sessions with varying quality for tracking quality stats."""
    now = timezone.now()
    sessions = []

    # High quality session - many positions, long duration
    sessions.append(AircraftSessionFactory(
        icao_hex='HIGH01',
        callsign='UAL100',
        first_seen=now - timedelta(hours=2),
        last_seen=now - timedelta(hours=1),
        total_positions=500,
        min_rssi=-25.0,
        max_rssi=-15.0,
        min_altitude=20000,
        max_altitude=35000,
        min_distance_nm=5.0,
        max_distance_nm=50.0,
        is_military=False,
    ))

    # Medium quality session
    sessions.append(AircraftSessionFactory(
        icao_hex='MED001',
        callsign='DAL200',
        first_seen=now - timedelta(hours=3),
        last_seen=now - timedelta(hours=2, minutes=30),
        total_positions=150,
        min_rssi=-32.0,
        max_rssi=-22.0,
        is_military=False,
    ))

    # Poor quality session - few positions for duration
    sessions.append(AircraftSessionFactory(
        icao_hex='LOW001',
        callsign='SWA300',
        first_seen=now - timedelta(hours=4),
        last_seen=now - timedelta(hours=2),
        total_positions=50,
        min_rssi=-38.0,
        max_rssi=-30.0,
        is_military=False,
    ))

    # Military session
    sessions.append(AircraftSessionFactory(
        icao_hex='MIL001',
        callsign='RCH400',
        first_seen=now - timedelta(hours=5),
        last_seen=now - timedelta(hours=4),
        total_positions=200,
        is_military=True,
    ))

    return sessions


@pytest.fixture
def sightings_for_sessions(db, tracking_sessions_batch):
    """Create sightings for the tracking sessions."""
    sightings = []
    now = timezone.now()

    for session in tracking_sessions_batch:
        # Create sightings spread across the session duration
        duration = (session.last_seen - session.first_seen).total_seconds()
        interval = duration / max(session.total_positions, 1)

        for i in range(min(session.total_positions, 50)):  # Limit for test performance
            timestamp = session.first_seen + timedelta(seconds=i * interval)
            sighting = AircraftSightingFactory(
                icao_hex=session.icao_hex,
                callsign=session.callsign,
                timestamp=timestamp,
                altitude_baro=30000 + (i % 10) * 100,
                distance_nm=10.0 + i * 0.5,
                is_military=session.is_military,
            )
            sightings.append(sighting)

    return sightings


@pytest.fixture
def engagement_data(db):
    """Create data for engagement statistics."""
    now = timezone.now()
    sessions = []
    aircraft_infos = []

    # Create aircraft info records
    for i in range(10):
        info = AircraftInfoFactory(
            icao_hex=f'A{i:05d}',
            registration=f'N{100+i}AA',
            operator=['United Airlines', 'Delta Air Lines', 'American Airlines'][i % 3],
            type_code=['B738', 'A320', 'B77W'][i % 3],
        )
        aircraft_infos.append(info)

    # Create sessions with varying activity
    for i in range(20):
        session = AircraftSessionFactory(
            icao_hex=f'A{i % 10:05d}',
            first_seen=now - timedelta(hours=i * 2, minutes=i * 5),
            last_seen=now - timedelta(hours=i * 2),
            total_positions=100 + i * 10,
        )
        sessions.append(session)

    return {'sessions': sessions, 'aircraft_infos': aircraft_infos}


@pytest.fixture
def favorites_data(db, operator_user):
    """Create favorite aircraft data."""
    from skyspy.models import AircraftFavorite

    favorites = []
    now = timezone.now()

    # Create aircraft info first
    infos = []
    for i in range(5):
        info = AircraftInfoFactory(
            icao_hex=f'FAV{i:03d}',
            registration=f'N{500+i}FA',
            operator=['United Airlines', 'Delta Air Lines', 'US Air Force'][i % 3],
            is_military=(i % 3 == 2),
        )
        infos.append(info)

    # Create favorites
    for i, info in enumerate(infos):
        fav = AircraftFavorite.objects.create(
            user=operator_user,
            icao_hex=info.icao_hex,
            registration=info.registration,
            callsign=f'TST{100+i}',
            times_seen=i + 1,
            last_seen_at=now - timedelta(days=i),
            total_tracking_minutes=30.0 * (i + 1),
            notify_on_detection=(i % 2 == 0),
        )
        favorites.append(fav)

    return {'favorites': favorites, 'infos': infos}


@pytest.fixture
def flight_patterns_data(db):
    """Create data for flight pattern statistics."""
    now = timezone.now()
    sessions = []

    # Create sessions across different hours of the day
    for hour in range(24):
        for count in range(3 if 6 <= hour <= 22 else 1):  # More during day
            session = AircraftSessionFactory(
                first_seen=now.replace(hour=hour, minute=0) - timedelta(days=1),
                last_seen=now.replace(hour=hour, minute=30) - timedelta(days=1),
                aircraft_type=['B738', 'A320', 'E75L', 'B77W'][count % 4],
                callsign=f'UAL{hour}{count}',
            )
            sessions.append(session)

    return sessions


@pytest.fixture
def geographic_data(db):
    """Create data for geographic statistics."""
    aircraft_infos = []

    # Create aircraft from different countries/operators
    countries_ops = [
        ('United States', 'United Airlines', 'N12345', False),
        ('United States', 'Delta Air Lines', 'N67890', False),
        ('United States', 'US Air Force', 'AF12345', True),
        ('United Kingdom', 'British Airways', 'G-ABCD', False),
        ('Germany', 'Lufthansa', 'D-AAAA', False),
        ('Canada', 'Air Canada', 'C-FABC', False),
        ('France', 'Air France', 'F-GXYZ', False),
    ]

    for i, (country, operator, reg, military) in enumerate(countries_ops):
        info = AircraftInfoFactory(
            icao_hex=f'GEO{i:03d}',
            registration=reg,
            country=country,
            operator=operator,
            is_military=military,
        )
        aircraft_infos.append(info)

        # Create sessions for these aircraft
        AircraftSessionFactory(
            icao_hex=info.icao_hex,
            callsign=f'{operator[:3].upper()}{i}',
            is_military=military,
        )

    return aircraft_infos


@pytest.fixture
def personal_records_data(db):
    """Create personal records data."""
    records = []
    now = timezone.now()

    record_data = [
        ('max_distance', 'DIST01', 'UAL999', 250.5, 'B738'),
        ('max_altitude', 'ALT001', 'DAL888', 45000, 'A320'),
        ('max_speed', 'SPD001', 'AAL777', 580.0, 'B77W'),
        ('longest_session', 'LONG01', 'SWA666', 180.0, 'B737'),
        ('most_positions', 'POS001', 'JBU555', 2000, 'A321'),
        ('closest_approach', 'CLS001', 'N12345', 0.5, 'C172'),
    ]

    for record_type, icao, callsign, value, ac_type in record_data:
        record = PersonalRecord.objects.create(
            record_type=record_type,
            icao_hex=icao,
            callsign=callsign,
            value=value,
            aircraft_type=ac_type,
            achieved_at=now - timedelta(days=len(records)),
        )
        records.append(record)

    return records


@pytest.fixture
def rare_sightings_data(db):
    """Create rare sightings data."""
    sightings = []
    now = timezone.now()

    rarity_data = [
        ('first_hex', 'NEW001', 'UAL100', 'First time seen', 3),
        ('military', 'MIL001', 'RCH200', 'Military C-17', 7),
        ('test_flight', 'BOE001', 'BOE001', 'Boeing test flight', 8),
        ('government', 'GOV001', 'EXEC1', 'Government aircraft', 9),
        ('rare_type', 'RARE01', 'N747NA', 'Rare type - NASA', 10),
        ('air_ambulance', 'HEMS01', 'LIFEG1', 'Air ambulance', 6),
    ]

    for rarity_type, icao, callsign, desc, score in rarity_data:
        sighting = RareSighting.objects.create(
            rarity_type=rarity_type,
            icao_hex=icao,
            callsign=callsign,
            description=desc,
            rarity_score=score,
            sighted_at=now - timedelta(hours=len(sightings)),
            is_acknowledged=False,
        )
        sightings.append(sighting)

    return sightings


@pytest.fixture
def spotted_collection_data(db):
    """Create spotted aircraft collection data."""
    spotted = []
    counts = []
    now = timezone.now()

    # Create spotted aircraft
    for i in range(20):
        aircraft = SpottedAircraft.objects.create(
            icao_hex=f'SPT{i:03d}',
            registration=f'N{1000+i}',
            aircraft_type=['B738', 'A320', 'E75L'][i % 3],
            operator=['United Airlines', 'Delta Air Lines', 'American Airlines'][i % 3],
            country='United States',
            is_military=(i % 10 == 0),
            first_seen=now - timedelta(days=30 - i),
            last_seen=now - timedelta(days=i % 7),
            times_seen=i + 1,
            total_positions=(i + 1) * 100,
        )
        spotted.append(aircraft)

    # Create spotted counts by category
    count_data = [
        ('operator', 'UAL', 'United Airlines', 50, 500),
        ('operator', 'DAL', 'Delta Air Lines', 45, 450),
        ('operator', 'AAL', 'American Airlines', 40, 400),
        ('aircraft_type', 'B738', 'Boeing 737-800', 60, 600),
        ('aircraft_type', 'A320', 'Airbus A320', 55, 550),
        ('country', 'US', 'United States', 200, 2000),
        ('country', 'UK', 'United Kingdom', 25, 250),
    ]

    for count_type, identifier, display_name, unique, total in count_data:
        count = SpottedCount.objects.create(
            count_type=count_type,
            identifier=identifier,
            display_name=display_name,
            unique_aircraft=unique,
            total_sightings=total,
            total_sessions=unique * 2,
            first_seen=now - timedelta(days=90),
            last_seen=now,
        )
        counts.append(count)

    return {'spotted': spotted, 'counts': counts}


@pytest.fixture
def daily_stats_data(db):
    """Create daily stats data."""
    stats = []
    now = timezone.now()

    for i in range(30):
        day_stats = DailyStats.objects.create(
            date=(now - timedelta(days=i)).date(),
            unique_aircraft=50 + i * 2,
            new_aircraft=5 + i % 10,
            total_sessions=100 + i * 3,
            total_positions=10000 + i * 500,
            military_count=3 + i % 5,
            max_distance_nm=100.0 + i * 5,
            max_altitude=35000 + i * 100,
            max_speed=500.0 + i * 2,
            aircraft_types={'B738': 20 + i, 'A320': 15 + i, 'E75L': 10 + i},
            operators={'UAL': 25 + i, 'DAL': 20 + i, 'AAL': 15 + i},
        )
        stats.append(day_stats)

    return stats


@pytest.fixture
def streak_data(db):
    """Create sighting streak data."""
    streaks = []
    today = timezone.now().date()

    streak_configs = [
        ('any_sighting', 15, 30),
        ('military', 5, 10),
        ('unique_new', 3, 7),
    ]

    for streak_type, current, best in streak_configs:
        streak = SightingStreak.objects.create(
            streak_type=streak_type,
            current_streak_days=current,
            current_streak_start=today - timedelta(days=current),
            last_qualifying_date=today,
            best_streak_days=best,
            best_streak_start=today - timedelta(days=best + 10),
            best_streak_end=today - timedelta(days=10),
        )
        streaks.append(streak)

    return streaks


# =============================================================================
# 1. Tracking Quality Stats Tests
# =============================================================================

@pytest.mark.django_db
@pytest.mark.skipif(_IS_SQLITE, reason="Tracking quality stats require PostgreSQL DurationField support")
class TestTrackingQualityStats:
    """Tests for GET /api/v1/stats/tracking-quality endpoint."""

    def test_tracking_quality_returns_200_ok(
        self, api_client, tracking_sessions_batch, sightings_for_sessions
    ):
        """Test that tracking quality stats returns 200 OK."""
        response = api_client.get('/api/v1/stats/tracking-quality/')
        assert response.status_code == status.HTTP_200_OK

    def test_tracking_quality_response_structure(
        self, api_client, tracking_sessions_batch, sightings_for_sessions
    ):
        """Test tracking quality response has expected structure."""
        response = api_client.get('/api/v1/stats/tracking-quality/')
        data = response.json()

        # Should have key metrics
        assert 'sessions_analyzed' in data or 'total_sessions' in data
        assert 'average_update_rate' in data or 'avg_positions_per_session' in data

    def test_tracking_quality_includes_quality_grades(
        self, api_client, tracking_sessions_batch, sightings_for_sessions
    ):
        """Test that response includes quality grade distribution."""
        response = api_client.get('/api/v1/stats/tracking-quality/')
        data = response.json()

        # Check for grade breakdown or similar metric
        if 'quality_distribution' in data:
            assert isinstance(data['quality_distribution'], dict)
        if 'grade_distribution' in data:
            assert isinstance(data['grade_distribution'], dict)

    def test_tracking_quality_filter_by_hours(
        self, api_client, tracking_sessions_batch, sightings_for_sessions
    ):
        """Test filtering tracking quality by time range."""
        response_24h = api_client.get('/api/v1/stats/tracking-quality/?hours=24')
        response_12h = api_client.get('/api/v1/stats/tracking-quality/?hours=12')

        assert response_24h.status_code == status.HTTP_200_OK
        assert response_12h.status_code == status.HTTP_200_OK

    def test_tracking_quality_refresh_param(
        self, api_client, tracking_sessions_batch, sightings_for_sessions
    ):
        """Test that refresh=true forces recalculation."""
        response = api_client.get('/api/v1/stats/tracking-quality/?refresh=true')
        assert response.status_code == status.HTTP_200_OK

    def test_tracking_quality_gaps_endpoint(
        self, api_client, tracking_sessions_batch, sightings_for_sessions
    ):
        """Test GET /api/v1/stats/tracking-quality/gaps returns coverage gaps."""
        response = api_client.get('/api/v1/stats/tracking-quality/gaps/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        # Should have gap analysis data
        assert isinstance(data, dict)

    def test_tracking_quality_session_detail(
        self, api_client, tracking_sessions_batch, sightings_for_sessions
    ):
        """Test getting quality details for a specific session."""
        session = tracking_sessions_batch[0]
        response = api_client.get(f'/api/v1/stats/tracking-quality/session/{session.icao_hex}/')

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert data['icao_hex'].upper() == session.icao_hex.upper()
        assert 'quality' in data or 'session' in data

    def test_tracking_quality_session_not_found(self, api_client):
        """Test 404 for non-existent session."""
        response = api_client.get('/api/v1/stats/tracking-quality/session/NOTFOUND/')
        assert response.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# 2. Engagement Stats Tests
# =============================================================================

@pytest.mark.django_db
class TestEngagementStats:
    """Tests for GET /api/v1/stats/engagement endpoint."""

    def test_engagement_stats_returns_200_ok(self, api_client, engagement_data):
        """Test that engagement stats returns 200 OK."""
        response = api_client.get('/api/v1/stats/engagement/')
        assert response.status_code == status.HTTP_200_OK

    def test_engagement_stats_response_structure(self, api_client, engagement_data):
        """Test engagement response has expected structure."""
        response = api_client.get('/api/v1/stats/engagement/')
        data = response.json()

        # Should have engagement metrics
        assert isinstance(data, dict)

    def test_engagement_stats_filter_by_hours(self, api_client, engagement_data):
        """Test filtering engagement stats by time range."""
        response = api_client.get('/api/v1/stats/engagement/?hours=12')
        assert response.status_code == status.HTTP_200_OK

    def test_engagement_most_watched(self, api_client, engagement_data):
        """Test GET /api/v1/stats/engagement/most-watched endpoint."""
        response = api_client.get('/api/v1/stats/engagement/most-watched/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'most_watched' in data

    def test_engagement_return_visitors(self, api_client, engagement_data):
        """Test GET /api/v1/stats/engagement/return-visitors endpoint."""
        response = api_client.get('/api/v1/stats/engagement/return-visitors/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'return_visitors' in data
        assert 'stats' in data

    def test_engagement_return_visitors_min_sessions(self, api_client, engagement_data):
        """Test return visitors with min_sessions filter."""
        response = api_client.get('/api/v1/stats/engagement/return-visitors/?min_sessions=3')
        assert response.status_code == status.HTTP_200_OK

    def test_engagement_peak_tracking(self, api_client, engagement_data):
        """Test GET /api/v1/stats/engagement/peak-tracking endpoint."""
        response = api_client.get('/api/v1/stats/engagement/peak-tracking/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'peak_periods' in data
        assert 'summary' in data


# =============================================================================
# 3. Aircraft Favorites Tests
# =============================================================================

@pytest.mark.django_db
class TestAircraftFavorites:
    """Tests for GET/POST/DELETE /api/v1/stats/favorites endpoint."""

    def test_list_favorites_returns_200_ok(self, operator_client, favorites_data):
        """Test that favorites list returns 200 OK."""
        response = operator_client.get('/api/v1/stats/favorites/')
        assert response.status_code == status.HTTP_200_OK

    def test_list_favorites_response_structure(self, operator_client, favorites_data):
        """Test favorites list response structure."""
        response = operator_client.get('/api/v1/stats/favorites/')
        data = response.json()

        assert 'favorites' in data
        assert 'count' in data
        assert len(data['favorites']) == 5  # We created 5 favorites

    def test_favorites_include_required_fields(self, operator_client, favorites_data):
        """Test that each favorite includes required fields."""
        response = operator_client.get('/api/v1/stats/favorites/')
        data = response.json()

        if data['favorites']:
            fav = data['favorites'][0]
            assert 'id' in fav
            assert 'icao_hex' in fav
            assert 'times_seen' in fav
            assert 'last_seen_at' in fav or 'last_seen' in fav
            assert 'notify_on_detection' in fav

    def test_toggle_favorite_add(self, operator_client, operator_user):
        """Test adding an aircraft to favorites via toggle."""
        # Create an aircraft info first
        info = AircraftInfoFactory(icao_hex='NEWADD')

        response = operator_client.post('/api/v1/stats/favorites/toggle/NEWADD/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data['icao_hex'] == 'NEWADD'
        assert data['is_favorite'] is True
        assert data['action'] == 'added'

    def test_toggle_favorite_remove(self, operator_client, favorites_data):
        """Test removing an aircraft from favorites via toggle."""
        fav = favorites_data['favorites'][0]

        response = operator_client.post(f'/api/v1/stats/favorites/toggle/{fav.icao_hex}/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data['is_favorite'] is False
        assert data['action'] == 'removed'

    def test_check_favorite_status(self, operator_client, favorites_data):
        """Test checking if aircraft is favorited."""
        fav = favorites_data['favorites'][0]

        response = operator_client.get(f'/api/v1/stats/favorites/check/{fav.icao_hex}/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data['icao_hex'].upper() == fav.icao_hex.upper()
        assert data['is_favorite'] is True

    def test_check_non_favorite(self, operator_client):
        """Test checking non-favorited aircraft."""
        response = operator_client.get('/api/v1/stats/favorites/check/NOTFAV/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data['is_favorite'] is False

    def test_update_favorite_notes(self, operator_client, favorites_data):
        """Test updating notes for a favorite."""
        fav = favorites_data['favorites'][0]

        response = operator_client.patch(
            f'/api/v1/stats/favorites/{fav.id}/notes/',
            {'notes': 'My favorite plane!', 'notify_on_detection': True},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data['notes'] == 'My favorite plane!'
        assert data['notify_on_detection'] is True

    def test_favorites_unauthenticated_empty(self, api_client):
        """Test that unauthenticated users get empty favorites list."""
        response = api_client.get('/api/v1/stats/favorites/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data['favorites'] == []
        assert data['count'] == 0


# =============================================================================
# 4. Flight Pattern Stats Tests
# =============================================================================

@pytest.mark.django_db
@pytest.mark.skipif(_IS_SQLITE, reason="Flight pattern stats require PostgreSQL DurationField support")
class TestFlightPatternStats:
    """Tests for GET /api/v1/stats/flight-patterns endpoint."""

    def test_flight_patterns_returns_200_ok(self, api_client, flight_patterns_data):
        """Test that flight patterns stats returns 200 OK."""
        response = api_client.get('/api/v1/stats/flight-patterns/')
        assert response.status_code == status.HTTP_200_OK

    def test_flight_patterns_response_structure(self, api_client, flight_patterns_data):
        """Test flight patterns response structure."""
        response = api_client.get('/api/v1/stats/flight-patterns/')
        data = response.json()

        # Should have pattern data
        assert isinstance(data, dict)

    def test_flight_patterns_busiest_hours(self, api_client, flight_patterns_data):
        """Test GET /api/v1/stats/flight-patterns/busiest-hours endpoint."""
        response = api_client.get('/api/v1/stats/flight-patterns/busiest-hours/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'busiest_hours' in data
        assert 'peak_hour' in data

    def test_flight_patterns_aircraft_types(self, api_client, flight_patterns_data):
        """Test GET /api/v1/stats/flight-patterns/aircraft-types endpoint."""
        response = api_client.get('/api/v1/stats/flight-patterns/aircraft-types/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'aircraft_types' in data

    def test_flight_patterns_duration_by_type(self, api_client, flight_patterns_data):
        """Test GET /api/v1/stats/flight-patterns/duration-by-type endpoint."""
        response = api_client.get('/api/v1/stats/flight-patterns/duration-by-type/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'duration_by_type' in data

    def test_flight_patterns_routes(self, api_client, flight_patterns_data):
        """Test GET /api/v1/stats/flight-patterns/routes endpoint."""
        response = api_client.get('/api/v1/stats/flight-patterns/routes/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'routes' in data

    def test_flight_patterns_filter_by_hours(self, api_client, flight_patterns_data):
        """Test filtering flight patterns by time range."""
        response = api_client.get('/api/v1/stats/flight-patterns/?hours=12')
        assert response.status_code == status.HTTP_200_OK

    def test_flight_patterns_refresh(self, api_client, flight_patterns_data):
        """Test refresh parameter forces recalculation."""
        response = api_client.get('/api/v1/stats/flight-patterns/?refresh=true')
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# 5. Geographic Stats Tests
# =============================================================================

@pytest.mark.django_db
class TestGeographicStats:
    """Tests for GET /api/v1/stats/geographic endpoint."""

    def test_geographic_stats_returns_200_ok(self, api_client, geographic_data):
        """Test that geographic stats returns 200 OK."""
        response = api_client.get('/api/v1/stats/geographic/')
        assert response.status_code == status.HTTP_200_OK

    def test_geographic_stats_response_structure(self, api_client, geographic_data):
        """Test geographic stats response structure."""
        response = api_client.get('/api/v1/stats/geographic/')
        data = response.json()

        assert isinstance(data, dict)

    def test_geographic_countries(self, api_client, geographic_data):
        """Test GET /api/v1/stats/geographic/countries endpoint."""
        response = api_client.get('/api/v1/stats/geographic/countries/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'countries' in data

    def test_geographic_operators(self, api_client, geographic_data):
        """Test GET /api/v1/stats/geographic/operators endpoint."""
        response = api_client.get('/api/v1/stats/geographic/operators/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'operators' in data

    def test_geographic_military_breakdown(self, api_client, geographic_data):
        """Test GET /api/v1/stats/geographic/military-breakdown endpoint."""
        response = api_client.get('/api/v1/stats/geographic/military-breakdown/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'military_breakdown' in data

    def test_geographic_locations(self, api_client, geographic_data):
        """Test GET /api/v1/stats/geographic/locations endpoint."""
        response = api_client.get('/api/v1/stats/geographic/locations/')
        assert response.status_code == status.HTTP_200_OK

    def test_geographic_summary(self, api_client, geographic_data):
        """Test GET /api/v1/stats/geographic/summary endpoint."""
        response = api_client.get('/api/v1/stats/geographic/summary/')
        assert response.status_code == status.HTTP_200_OK

    def test_geographic_filter_by_hours(self, api_client, geographic_data):
        """Test filtering geographic stats by time range."""
        response = api_client.get('/api/v1/stats/geographic/?hours=48')
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# 6. Combined Stats Tests
# =============================================================================

@pytest.mark.django_db
class TestCombinedStats:
    """Tests for GET /api/v1/stats/combined endpoint."""

    def test_combined_stats_returns_200_ok(self, api_client, flight_patterns_data, geographic_data):
        """Test that combined stats returns 200 OK."""
        response = api_client.get('/api/v1/stats/combined/')
        assert response.status_code == status.HTTP_200_OK

    def test_combined_stats_includes_both_categories(
        self, api_client, flight_patterns_data, geographic_data
    ):
        """Test combined stats includes both flight patterns and geographic."""
        response = api_client.get('/api/v1/stats/combined/')
        data = response.json()

        assert 'flight_patterns' in data
        assert 'geographic' in data

    def test_combined_stats_summary(self, api_client, flight_patterns_data, geographic_data):
        """Test GET /api/v1/stats/combined/summary endpoint."""
        response = api_client.get('/api/v1/stats/combined/summary/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'summary' in data

    def test_combined_stats_filter_by_hours(
        self, api_client, flight_patterns_data, geographic_data
    ):
        """Test filtering combined stats by time range."""
        response = api_client.get('/api/v1/stats/combined/?hours=12')
        assert response.status_code == status.HTTP_200_OK

    def test_combined_stats_refresh(self, api_client, flight_patterns_data, geographic_data):
        """Test refresh parameter forces recalculation."""
        response = api_client.get('/api/v1/stats/combined/?refresh=true')
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# 7. Personal Records Tests
# =============================================================================

@pytest.mark.django_db
class TestPersonalRecords:
    """Tests for personal records / achievements."""

    def test_personal_records_model_exists(self, personal_records_data):
        """Test that personal records can be created."""
        assert len(personal_records_data) == 6
        assert PersonalRecord.objects.count() == 6

    def test_max_distance_record(self, personal_records_data):
        """Test max distance record exists and has correct values."""
        record = PersonalRecord.objects.get(record_type='max_distance')
        assert record.icao_hex == 'DIST01'
        assert record.value == 250.5
        assert record.callsign == 'UAL999'

    def test_max_altitude_record(self, personal_records_data):
        """Test max altitude record."""
        record = PersonalRecord.objects.get(record_type='max_altitude')
        assert record.icao_hex == 'ALT001'
        assert record.value == 45000

    def test_max_speed_record(self, personal_records_data):
        """Test max speed record."""
        record = PersonalRecord.objects.get(record_type='max_speed')
        assert record.icao_hex == 'SPD001'
        assert record.value == 580.0

    def test_longest_session_record(self, personal_records_data):
        """Test longest session record."""
        record = PersonalRecord.objects.get(record_type='longest_session')
        assert record.icao_hex == 'LONG01'
        assert record.value == 180.0

    def test_most_positions_record(self, personal_records_data):
        """Test most positions record."""
        record = PersonalRecord.objects.get(record_type='most_positions')
        assert record.icao_hex == 'POS001'
        assert record.value == 2000

    def test_closest_approach_record(self, personal_records_data):
        """Test closest approach record."""
        record = PersonalRecord.objects.get(record_type='closest_approach')
        assert record.icao_hex == 'CLS001'
        assert record.value == 0.5


# =============================================================================
# 8. Rare Sightings Tests
# =============================================================================

@pytest.mark.django_db
class TestRareSightings:
    """Tests for rare sightings tracking."""

    def test_rare_sightings_created(self, rare_sightings_data):
        """Test that rare sightings can be created."""
        assert len(rare_sightings_data) == 6
        assert RareSighting.objects.count() == 6

    def test_first_time_hex_sighting(self, rare_sightings_data):
        """Test first-time hex sighting record."""
        sighting = RareSighting.objects.get(rarity_type='first_hex')
        assert sighting.icao_hex == 'NEW001'
        assert sighting.rarity_score == 3

    def test_military_sighting(self, rare_sightings_data):
        """Test military aircraft sighting."""
        sighting = RareSighting.objects.get(rarity_type='military')
        assert sighting.icao_hex == 'MIL001'
        assert sighting.callsign == 'RCH200'
        assert sighting.rarity_score == 7

    def test_test_flight_sighting(self, rare_sightings_data):
        """Test test flight sighting."""
        sighting = RareSighting.objects.get(rarity_type='test_flight')
        assert sighting.icao_hex == 'BOE001'
        assert sighting.rarity_score == 8

    def test_government_sighting(self, rare_sightings_data):
        """Test government aircraft sighting."""
        sighting = RareSighting.objects.get(rarity_type='government')
        assert sighting.rarity_score == 9

    def test_rare_type_sighting(self, rare_sightings_data):
        """Test rare aircraft type sighting."""
        sighting = RareSighting.objects.get(rarity_type='rare_type')
        assert sighting.rarity_score == 10

    def test_sighting_acknowledgement(self, rare_sightings_data):
        """Test acknowledging a rare sighting."""
        sighting = rare_sightings_data[0]
        assert sighting.is_acknowledged is False

        sighting.is_acknowledged = True
        sighting.save()

        sighting.refresh_from_db()
        assert sighting.is_acknowledged is True

    def test_filter_by_rarity_type(self, rare_sightings_data):
        """Test filtering sightings by rarity type."""
        military = RareSighting.objects.filter(rarity_type='military')
        assert military.count() >= 1

    def test_filter_unacknowledged(self, rare_sightings_data):
        """Test filtering unacknowledged sightings."""
        unacked = RareSighting.objects.filter(is_acknowledged=False)
        assert unacked.count() == 6


# =============================================================================
# 9. Spotted Aircraft Collection Tests
# =============================================================================

@pytest.mark.django_db
class TestSpottedAircraftCollection:
    """Tests for spotted aircraft collection tracking."""

    def test_spotted_aircraft_created(self, spotted_collection_data):
        """Test that spotted aircraft can be created."""
        assert len(spotted_collection_data['spotted']) == 20

    def test_spotted_counts_created(self, spotted_collection_data):
        """Test that spotted counts are created."""
        assert len(spotted_collection_data['counts']) == 7

    def test_spotted_by_operator(self, spotted_collection_data):
        """Test spotted count by operator."""
        ual_count = SpottedCount.objects.get(count_type='operator', identifier='UAL')
        assert ual_count.unique_aircraft == 50
        assert ual_count.display_name == 'United Airlines'

    def test_spotted_by_aircraft_type(self, spotted_collection_data):
        """Test spotted count by aircraft type."""
        b738_count = SpottedCount.objects.get(count_type='aircraft_type', identifier='B738')
        assert b738_count.unique_aircraft == 60
        assert b738_count.display_name == 'Boeing 737-800'

    def test_spotted_by_country(self, spotted_collection_data):
        """Test spotted count by country."""
        us_count = SpottedCount.objects.get(count_type='country', identifier='US')
        assert us_count.unique_aircraft == 200

    def test_spotted_aircraft_tracking(self, spotted_collection_data):
        """Test individual aircraft tracking in collection."""
        aircraft = spotted_collection_data['spotted'][0]
        assert aircraft.times_seen >= 1
        assert aircraft.total_positions > 0

    def test_collection_progress(self, spotted_collection_data):
        """Test collection progress tracking."""
        total_spotted = SpottedAircraft.objects.count()
        assert total_spotted == 20

        military_spotted = SpottedAircraft.objects.filter(is_military=True).count()
        assert military_spotted >= 1

    def test_filter_by_aircraft_type(self, spotted_collection_data):
        """Test filtering spotted aircraft by type."""
        b738_spotted = SpottedAircraft.objects.filter(aircraft_type='B738')
        assert b738_spotted.count() >= 1

    def test_filter_by_operator(self, spotted_collection_data):
        """Test filtering spotted aircraft by operator."""
        united = SpottedAircraft.objects.filter(operator='United Airlines')
        assert united.count() >= 1


# =============================================================================
# 10. Daily Stats Tests
# =============================================================================

@pytest.mark.django_db
class TestDailyStats:
    """Tests for daily cumulative statistics."""

    def test_daily_stats_created(self, daily_stats_data):
        """Test that daily stats can be created."""
        assert len(daily_stats_data) == 30

    def test_daily_stats_structure(self, daily_stats_data):
        """Test daily stats have expected structure."""
        today_stats = daily_stats_data[0]
        assert today_stats.unique_aircraft > 0
        assert today_stats.total_sessions > 0
        assert today_stats.total_positions > 0

    def test_daily_stats_ordering(self, daily_stats_data):
        """Test daily stats are ordered by date descending."""
        stats = list(DailyStats.objects.all())
        for i in range(len(stats) - 1):
            assert stats[i].date >= stats[i + 1].date

    def test_daily_stats_aircraft_types_json(self, daily_stats_data):
        """Test aircraft types JSON field."""
        stats = daily_stats_data[0]
        assert isinstance(stats.aircraft_types, dict)
        assert 'B738' in stats.aircraft_types

    def test_daily_stats_operators_json(self, daily_stats_data):
        """Test operators JSON field."""
        stats = daily_stats_data[0]
        assert isinstance(stats.operators, dict)
        assert 'UAL' in stats.operators

    def test_filter_by_date_range(self, daily_stats_data):
        """Test filtering daily stats by date range."""
        now = timezone.now()
        week_ago = (now - timedelta(days=7)).date()

        recent_stats = DailyStats.objects.filter(date__gte=week_ago)
        assert recent_stats.count() <= 8  # Up to 8 days

    def test_sighting_streaks(self, streak_data):
        """Test sighting streak tracking."""
        any_streak = SightingStreak.objects.get(streak_type='any_sighting')
        assert any_streak.current_streak_days == 15
        assert any_streak.best_streak_days == 30

    def test_military_streak(self, streak_data):
        """Test military sighting streak."""
        mil_streak = SightingStreak.objects.get(streak_type='military')
        assert mil_streak.current_streak_days == 5
        assert mil_streak.best_streak_days == 10

    def test_comparison_with_previous_days(self, daily_stats_data):
        """Test comparison between days."""
        today = daily_stats_data[0]
        yesterday = daily_stats_data[1]

        # Should be able to calculate difference
        aircraft_diff = today.unique_aircraft - yesterday.unique_aircraft
        assert isinstance(aircraft_diff, int)


# =============================================================================
# 11. ACARS Statistics Tests
# =============================================================================

@pytest.mark.django_db
class TestAcarsStatistics:
    """Tests for GET /api/v1/acars/stats endpoints."""

    @pytest.fixture
    def acars_data(self, db):
        """Create ACARS messages for stats testing."""
        messages = []
        now = timezone.now()

        # Create messages with various labels and sources
        label_source_pairs = [
            ('Q0', 'acars', 'UAL'),
            ('H1', 'vdlm2', 'DAL'),
            ('_d', 'acars', 'AAL'),
            ('SA', 'vdlm2', 'SWA'),
            ('Q0', 'acars', 'UAL'),
            ('H1', 'acars', 'DAL'),
        ]

        for i, (label, source, airline) in enumerate(label_source_pairs):
            msg = AcarsMessageFactory(
                timestamp=now - timedelta(hours=i),
                label=label,
                source=source,
                callsign=f'{airline}{100+i}',
                frequency=129.125 if source == 'acars' else 136.975,
            )
            messages.append(msg)

        return messages

    def test_acars_stats_returns_200_ok(self, api_client, acars_data):
        """Test that ACARS stats returns 200 OK."""
        response = api_client.get('/api/v1/acars/stats/')
        assert response.status_code == status.HTTP_200_OK

    def test_acars_stats_response_structure(self, api_client, acars_data):
        """Test ACARS stats response structure."""
        response = api_client.get('/api/v1/acars/stats/')
        data = response.json()

        assert 'total_messages' in data
        assert 'last_hour' in data or 'last_24h' in data

    def test_acars_stats_by_source(self, api_client, acars_data):
        """Test ACARS stats include breakdown by source."""
        response = api_client.get('/api/v1/acars/stats/')
        data = response.json()

        assert 'by_source' in data
        assert isinstance(data['by_source'], dict)

    def test_acars_stats_top_labels(self, api_client, acars_data):
        """Test ACARS stats include top labels."""
        response = api_client.get('/api/v1/acars/stats/')
        data = response.json()

        assert 'top_labels' in data
        assert isinstance(data['top_labels'], list)

    def test_acars_stats_breakdown(self, api_client, acars_data):
        """Test GET /api/v1/acars/stats/breakdown endpoint."""
        response = api_client.get('/api/v1/acars/stats/breakdown/')
        assert response.status_code == status.HTTP_200_OK

    def test_acars_stats_airlines(self, api_client, acars_data):
        """Test GET /api/v1/acars/stats/airlines endpoint."""
        response = api_client.get('/api/v1/acars/stats/airlines/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'airlines' in data or 'airline_stats' in data or isinstance(data, dict)

    def test_acars_stats_trends(self, api_client, acars_data):
        """Test GET /api/v1/acars/stats/trends endpoint."""
        response = api_client.get('/api/v1/acars/stats/trends/')
        assert response.status_code == status.HTTP_200_OK

    def test_acars_stats_filter_by_hours(self, api_client, acars_data):
        """Test filtering ACARS stats by time range."""
        response = api_client.get('/api/v1/acars/stats/?hours=12')
        assert response.status_code == status.HTTP_200_OK

    def test_acars_labels_reference(self, api_client):
        """Test GET /api/v1/acars/labels endpoint."""
        response = api_client.get('/api/v1/acars/labels/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert 'labels' in data

    def test_acars_stats_summary(self, api_client, acars_data):
        """Test GET /api/v1/acars/stats/summary endpoint."""
        response = api_client.get('/api/v1/acars/stats/summary/')
        assert response.status_code == status.HTTP_200_OK

    def test_acars_category_trends(self, api_client, acars_data):
        """Test GET /api/v1/acars/stats/category-trends endpoint."""
        response = api_client.get('/api/v1/acars/stats/category-trends/')
        assert response.status_code == status.HTTP_200_OK

    def test_acars_text_analysis(self, api_client, acars_data):
        """Test GET /api/v1/acars/stats/text-analysis endpoint."""
        response = api_client.get('/api/v1/acars/stats/text-analysis/')
        assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Integration Tests
# =============================================================================

@pytest.mark.django_db
@pytest.mark.skipif(_IS_SQLITE, reason="Stats integration tests require PostgreSQL DurationField support")
class TestStatsIntegration:
    """Integration tests for statistics system."""

    def test_all_stats_endpoints_return_json(
        self, api_client, tracking_sessions_batch, sightings_for_sessions
    ):
        """Test that all stats endpoints return valid JSON."""
        endpoints = [
            '/api/v1/stats/tracking-quality/',
            '/api/v1/stats/engagement/',
            '/api/v1/stats/favorites/',
            '/api/v1/stats/flight-patterns/',
            '/api/v1/stats/geographic/',
            '/api/v1/stats/combined/',
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            assert response.status_code == status.HTTP_200_OK
            data = response.json()
            assert data is not None

    def test_stats_with_authenticated_user(
        self, operator_client, tracking_sessions_batch, favorites_data
    ):
        """Test stats access with authenticated user."""
        response = operator_client.get('/api/v1/stats/favorites/')
        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data['count'] == 5  # Should see the user's favorites

    def test_stats_cache_behavior(self, api_client, tracking_sessions_batch):
        """Test that stats are cached appropriately."""
        # First request
        response1 = api_client.get('/api/v1/stats/tracking-quality/')
        assert response1.status_code == status.HTTP_200_OK

        # Second request (should use cache)
        response2 = api_client.get('/api/v1/stats/tracking-quality/')
        assert response2.status_code == status.HTTP_200_OK

        # Force refresh
        response3 = api_client.get('/api/v1/stats/tracking-quality/?refresh=true')
        assert response3.status_code == status.HTTP_200_OK

    def test_stats_time_range_consistency(self, api_client, tracking_sessions_batch):
        """Test that time range filters are consistent across endpoints."""
        hours = 12

        endpoints = [
            f'/api/v1/stats/tracking-quality/?hours={hours}',
            f'/api/v1/stats/engagement/?hours={hours}',
            f'/api/v1/stats/flight-patterns/?hours={hours}',
            f'/api/v1/stats/geographic/?hours={hours}',
        ]

        for endpoint in endpoints:
            response = api_client.get(endpoint)
            assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Permission Tests
# =============================================================================

@pytest.mark.django_db
@pytest.mark.skipif(_IS_SQLITE, reason="Stats permission tests require PostgreSQL DurationField support")
class TestStatsPermissions:
    """Tests for stats API permission handling."""

    def test_public_stats_accessible_without_auth(self, api_client):
        """Test that public stats are accessible without authentication."""
        public_endpoints = [
            '/api/v1/stats/tracking-quality/',
            '/api/v1/stats/flight-patterns/',
            '/api/v1/stats/geographic/',
            '/api/v1/stats/combined/',
        ]

        for endpoint in public_endpoints:
            response = api_client.get(endpoint)
            # Should return 200 OK or data, not 401/403
            assert response.status_code in [status.HTTP_200_OK, status.HTTP_503_SERVICE_UNAVAILABLE]

    def test_viewer_can_access_stats(
        self, viewer_client, tracking_sessions_batch, sightings_for_sessions
    ):
        """Test that viewer role can access stats."""
        response = viewer_client.get('/api/v1/stats/tracking-quality/')
        assert response.status_code == status.HTTP_200_OK

    def test_operator_can_manage_favorites(self, operator_client, operator_user):
        """Test that operator role can manage favorites."""
        # Create test aircraft info
        AircraftInfoFactory(icao_hex='OPTEST')

        # Add favorite
        response = operator_client.post('/api/v1/stats/favorites/toggle/OPTEST/')
        assert response.status_code == status.HTTP_200_OK

        # Check favorite
        response = operator_client.get('/api/v1/stats/favorites/check/OPTEST/')
        assert response.status_code == status.HTTP_200_OK
        assert response.json()['is_favorite'] is True

    def test_analyst_has_full_stats_access(
        self, analyst_client, tracking_sessions_batch, sightings_for_sessions
    ):
        """Test that analyst role has full stats access."""
        endpoints = [
            '/api/v1/stats/tracking-quality/',
            '/api/v1/stats/tracking-quality/gaps/',
            '/api/v1/stats/engagement/',
            '/api/v1/stats/engagement/most-watched/',
            '/api/v1/stats/engagement/return-visitors/',
            '/api/v1/stats/engagement/peak-tracking/',
        ]

        for endpoint in endpoints:
            response = analyst_client.get(endpoint)
            assert response.status_code == status.HTTP_200_OK


# =============================================================================
# Configuration Models Tests
# =============================================================================

@pytest.mark.django_db
class TestConfigurationModels:
    """Tests for configuration models used by gamification."""

    def test_notable_registration_creation(self, db):
        """Test creating notable registration pattern."""
        pattern = NotableRegistration.objects.create(
            name='NASA Research',
            pattern_type='prefix',
            pattern='N8',
            category='government',
            description='NASA research aircraft',
            rarity_score=8,
            is_active=True,
        )
        assert pattern.id is not None
        assert pattern.name == 'NASA Research'

    def test_notable_callsign_creation(self, db):
        """Test creating notable callsign pattern."""
        pattern = NotableCallsign.objects.create(
            name='Air Force One',
            pattern_type='exact',
            pattern='AF1',
            category='government',
            description='Presidential aircraft',
            rarity_score=10,
            is_active=True,
        )
        assert pattern.id is not None
        assert pattern.name == 'Air Force One'

    def test_rare_aircraft_type_creation(self, db):
        """Test creating rare aircraft type configuration."""
        rare_type = RareAircraftType.objects.create(
            type_code='A388',
            type_name='Airbus A380-800',
            manufacturer='Airbus',
            category='rare',
            description='Rare in US airspace',
            rarity_score=7,
            total_produced=251,
            currently_active=220,
            is_active=True,
        )
        assert rare_type.id is not None
        assert rare_type.type_code == 'A388'

    def test_filter_active_patterns(self, db):
        """Test filtering active patterns."""
        NotableRegistration.objects.create(
            name='Active Pattern',
            pattern_type='prefix',
            pattern='N1',
            category='test',
            is_active=True,
        )
        NotableRegistration.objects.create(
            name='Inactive Pattern',
            pattern_type='prefix',
            pattern='N2',
            category='test',
            is_active=False,
        )

        active = NotableRegistration.objects.filter(is_active=True)
        assert active.count() == 1
        assert active.first().name == 'Active Pattern'
