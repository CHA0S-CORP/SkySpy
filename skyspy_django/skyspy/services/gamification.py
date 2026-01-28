"""
Gamification Service for SkysPy.

Handles personal records, rare sightings detection, collection tracking, and streak management.
All expensive queries are cached with configurable TTLs.
"""
import logging
import re
from datetime import datetime, timedelta, date
from typing import Optional

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Avg, Max, Min, Sum, F, Q
from django.db.models.functions import TruncDate
from django.utils import timezone

from skyspy.models import (
    AircraftSighting, AircraftSession, AircraftInfo,
)
from skyspy.models.stats import (
    PersonalRecord, RareSighting, SpottedCount, SpottedAircraft,
    SightingStreak, DailyStats, NotableRegistration, NotableCallsign, RareAircraftType,
)

logger = logging.getLogger(__name__)

# Cache keys
CACHE_KEY_PERSONAL_RECORDS = 'gamification:personal_records'
CACHE_KEY_RARE_SIGHTINGS = 'gamification:rare_sightings'
CACHE_KEY_COLLECTION_STATS = 'gamification:collection_stats'
CACHE_KEY_SPOTTED_BY_TYPE = 'gamification:spotted_by_type'
CACHE_KEY_SPOTTED_BY_OPERATOR = 'gamification:spotted_by_operator'
CACHE_KEY_STREAKS = 'gamification:streaks'
CACHE_KEY_DAILY_STATS = 'gamification:daily_stats'
CACHE_KEY_ACHIEVEMENTS = 'gamification:achievements'
CACHE_KEY_LIFETIME_STATS = 'gamification:lifetime_stats'

# Cache timeouts (seconds)
PERSONAL_RECORDS_TIMEOUT = 300  # 5 minutes
RARE_SIGHTINGS_TIMEOUT = 120  # 2 minutes
COLLECTION_STATS_TIMEOUT = 300  # 5 minutes
STREAKS_TIMEOUT = 600  # 10 minutes
DAILY_STATS_TIMEOUT = 300  # 5 minutes
LIFETIME_STATS_TIMEOUT = 600  # 10 minutes

# Default notable patterns
DEFAULT_NOTABLE_REGISTRATIONS = [
    # US Government
    {'name': 'US Government (N1xx)', 'pattern': r'^N1[0-9]{2}$', 'pattern_type': 'regex', 'category': 'government', 'rarity_score': 9},
    {'name': 'Air Force One/Two', 'pattern': r'^(SAM|AF1|AF2)', 'pattern_type': 'regex', 'category': 'government', 'rarity_score': 10},
    # Test Flights
    {'name': 'Boeing Test (N7xx)', 'pattern': r'^N7[0-9]{2}', 'pattern_type': 'regex', 'category': 'test_flight', 'rarity_score': 7},
    {'name': 'Airbus Test (F-WWxx)', 'pattern': 'F-WW', 'pattern_type': 'prefix', 'category': 'test_flight', 'rarity_score': 7},
    # NASA
    {'name': 'NASA Aircraft', 'pattern': 'NASA', 'pattern_type': 'contains', 'category': 'government', 'rarity_score': 8},
]

DEFAULT_NOTABLE_CALLSIGNS = [
    # Military
    {'name': 'USAF Heavy', 'pattern': r'^RCH', 'pattern_type': 'regex', 'category': 'military', 'rarity_score': 6},
    {'name': 'USAF Tanker', 'pattern': r'^PACK|^TREK', 'pattern_type': 'regex', 'category': 'military', 'rarity_score': 6},
    {'name': 'Navy Aircraft', 'pattern': r'^NAVY', 'pattern_type': 'regex', 'category': 'military', 'rarity_score': 6},
    # Special
    {'name': 'Air Ambulance', 'pattern': r'^MEDEVAC|^EVAC|^LIFE', 'pattern_type': 'regex', 'category': 'air_ambulance', 'rarity_score': 5},
    {'name': 'Coast Guard', 'pattern': r'^USCG|^COAST', 'pattern_type': 'regex', 'category': 'law_enforcement', 'rarity_score': 6},
    {'name': 'Law Enforcement', 'pattern': r'^N\d+SP$|^POLICE', 'pattern_type': 'regex', 'category': 'law_enforcement', 'rarity_score': 5},
    # Test
    {'name': 'Boeing Test', 'pattern': r'^BOE|^BFT', 'pattern_type': 'regex', 'category': 'test_flight', 'rarity_score': 7},
    {'name': 'Airbus Test', 'pattern': r'^AIB', 'pattern_type': 'regex', 'category': 'test_flight', 'rarity_score': 7},
]

DEFAULT_RARE_TYPES = [
    {'type_code': 'B748', 'type_name': 'Boeing 747-8', 'category': 'rare', 'rarity_score': 6},
    {'type_code': 'A380', 'type_name': 'Airbus A380', 'category': 'rare', 'rarity_score': 6},
    {'type_code': 'A225', 'type_name': 'Antonov An-225', 'category': 'historic', 'rarity_score': 10},
    {'type_code': 'CONC', 'type_name': 'Concorde', 'category': 'historic', 'rarity_score': 10},
    {'type_code': 'C5M', 'type_name': 'Lockheed C-5M Super Galaxy', 'category': 'military', 'rarity_score': 7},
    {'type_code': 'B52', 'type_name': 'Boeing B-52 Stratofortress', 'category': 'military', 'rarity_score': 8},
    {'type_code': 'E6B', 'type_name': 'Boeing E-6B Mercury', 'category': 'military', 'rarity_score': 9},
    {'type_code': 'E4B', 'type_name': 'Boeing E-4B Nightwatch', 'category': 'military', 'rarity_score': 10},
    {'type_code': 'B1', 'type_name': 'Rockwell B-1 Lancer', 'category': 'military', 'rarity_score': 8},
    {'type_code': 'F22', 'type_name': 'Lockheed F-22 Raptor', 'category': 'military', 'rarity_score': 8},
    {'type_code': 'F35', 'type_name': 'Lockheed F-35', 'category': 'military', 'rarity_score': 7},
    {'type_code': 'SR71', 'type_name': 'Lockheed SR-71', 'category': 'historic', 'rarity_score': 10},
    {'type_code': 'U2', 'type_name': 'Lockheed U-2', 'category': 'military', 'rarity_score': 9},
    {'type_code': 'DC3', 'type_name': 'Douglas DC-3', 'category': 'historic', 'rarity_score': 7},
    {'type_code': 'B17', 'type_name': 'Boeing B-17', 'category': 'historic', 'rarity_score': 8},
    {'type_code': 'B29', 'type_name': 'Boeing B-29', 'category': 'historic', 'rarity_score': 9},
    {'type_code': 'P51', 'type_name': 'North American P-51 Mustang', 'category': 'historic', 'rarity_score': 7},
]


class GamificationService:
    """Service for managing gamification features."""

    def __init__(self):
        self._notable_registrations_cache = None
        self._notable_callsigns_cache = None
        self._rare_types_cache = None

    # ==========================================================================
    # Personal Records
    # ==========================================================================

    def get_personal_records(self, force_refresh: bool = False) -> dict:
        """Get all personal records."""
        if not force_refresh:
            cached = cache.get(CACHE_KEY_PERSONAL_RECORDS)
            if cached:
                return cached

        records = PersonalRecord.objects.all()
        result = {
            'records': [],
            'timestamp': timezone.now().isoformat() + 'Z'
        }

        for record in records:
            result['records'].append({
                'record_type': record.record_type,
                'record_type_display': record.get_record_type_display(),
                'icao_hex': record.icao_hex,
                'callsign': record.callsign,
                'aircraft_type': record.aircraft_type,
                'registration': record.registration,
                'operator': record.operator,
                'value': record.value,
                'achieved_at': record.achieved_at.isoformat() + 'Z' if record.achieved_at else None,
                'previous_value': record.previous_value,
                'previous_icao_hex': record.previous_icao_hex,
            })

        cache.set(CACHE_KEY_PERSONAL_RECORDS, result, timeout=PERSONAL_RECORDS_TIMEOUT)
        return result

    def check_and_update_records(self, session: AircraftSession, sighting: AircraftSighting = None) -> list:
        """
        Check if a session or sighting sets any new personal records.
        Returns list of newly set records.
        """
        new_records = []

        # Get aircraft info for enrichment
        aircraft_info = None
        try:
            aircraft_info = AircraftInfo.objects.get(icao_hex=session.icao_hex)
        except AircraftInfo.DoesNotExist:
            logger.debug(f"No aircraft info found for {session.icao_hex}, proceeding without enrichment")

        # Check max distance
        if session.max_distance_nm:
            record = self._check_record(
                record_type='max_distance',
                value=session.max_distance_nm,
                session=session,
                aircraft_info=aircraft_info
            )
            if record:
                new_records.append(record)

        # Check max altitude
        if session.max_altitude:
            record = self._check_record(
                record_type='max_altitude',
                value=float(session.max_altitude),
                session=session,
                aircraft_info=aircraft_info
            )
            if record:
                new_records.append(record)

        # Check longest session (by duration in minutes)
        if session.first_seen and session.last_seen:
            duration_min = (session.last_seen - session.first_seen).total_seconds() / 60
            if duration_min >= 1:  # At least 1 minute
                record = self._check_record(
                    record_type='longest_session',
                    value=duration_min,
                    session=session,
                    aircraft_info=aircraft_info
                )
                if record:
                    new_records.append(record)

        # Check most positions
        if session.total_positions:
            record = self._check_record(
                record_type='most_positions',
                value=float(session.total_positions),
                session=session,
                aircraft_info=aircraft_info
            )
            if record:
                new_records.append(record)

        # Check closest approach
        if session.min_distance_nm and session.min_distance_nm > 0:
            # For closest approach, lower is better
            record = self._check_record(
                record_type='closest_approach',
                value=session.min_distance_nm,
                session=session,
                aircraft_info=aircraft_info,
                lower_is_better=True
            )
            if record:
                new_records.append(record)

        # Check max vertical rate (if available from sighting)
        if sighting and sighting.vertical_rate:
            if sighting.vertical_rate > 0:
                record = self._check_record(
                    record_type='max_vertical_rate',
                    value=float(sighting.vertical_rate),
                    session=session,
                    aircraft_info=aircraft_info
                )
                if record:
                    new_records.append(record)
            elif sighting.vertical_rate < 0:
                record = self._check_record(
                    record_type='max_descent_rate',
                    value=float(abs(sighting.vertical_rate)),
                    session=session,
                    aircraft_info=aircraft_info
                )
                if record:
                    new_records.append(record)

        # Check fastest speed (from sighting)
        if sighting and sighting.ground_speed:
            record = self._check_record(
                record_type='max_speed',
                value=sighting.ground_speed,
                session=session,
                aircraft_info=aircraft_info
            )
            if record:
                new_records.append(record)

        # Invalidate cache if any new records
        if new_records:
            cache.delete(CACHE_KEY_PERSONAL_RECORDS)

        return new_records

    def _check_record(
        self,
        record_type: str,
        value: float,
        session: AircraftSession,
        aircraft_info: Optional[AircraftInfo] = None,
        lower_is_better: bool = False
    ) -> Optional[dict]:
        """Check if value beats existing record and update if so."""
        try:
            with transaction.atomic():
                # Lock the row during check-then-act to prevent race conditions
                existing = PersonalRecord.objects.select_for_update().filter(
                    record_type=record_type
                ).first()

                is_new_record = False
                if existing is None:
                    is_new_record = True
                elif lower_is_better:
                    is_new_record = value < existing.value
                else:
                    is_new_record = value > existing.value

                if is_new_record:
                    if existing:
                        # Store previous record info
                        previous_value = existing.value
                        previous_icao = existing.icao_hex
                        previous_achieved = existing.achieved_at
                        existing.delete()
                    else:
                        previous_value = None
                        previous_icao = None
                        previous_achieved = None

                    # Create new record
                    record = PersonalRecord.objects.create(
                        record_type=record_type,
                        icao_hex=session.icao_hex,
                        callsign=session.callsign,
                        aircraft_type=session.aircraft_type,
                        registration=aircraft_info.registration if aircraft_info else None,
                        operator=aircraft_info.operator if aircraft_info else None,
                        value=value,
                        session_id=session.id,
                        achieved_at=timezone.now(),
                        previous_value=previous_value,
                        previous_icao_hex=previous_icao,
                        previous_achieved_at=previous_achieved,
                    )

                    return {
                        'record_type': record_type,
                        'record_type_display': record.get_record_type_display(),
                        'value': value,
                        'icao_hex': session.icao_hex,
                        'previous_value': previous_value,
                    }

        except Exception as e:
            logger.error(f"Error checking record {record_type}: {e}")

        return None

    # ==========================================================================
    # Rare Sightings Detection
    # ==========================================================================

    def get_rare_sightings(
        self,
        hours: int = 24,
        limit: int = 50,
        include_acknowledged: bool = False,
        force_refresh: bool = False
    ) -> dict:
        """Get recent rare/notable sightings."""
        cache_key = f"{CACHE_KEY_RARE_SIGHTINGS}:{hours}:{limit}:{include_acknowledged}"

        if not force_refresh:
            cached = cache.get(cache_key)
            if cached:
                return cached

        cutoff = timezone.now() - timedelta(hours=hours)
        qs = RareSighting.objects.filter(sighted_at__gte=cutoff)

        if not include_acknowledged:
            qs = qs.filter(is_acknowledged=False)

        qs = qs.order_by('-rarity_score', '-sighted_at')[:limit]

        result = {
            'sightings': [],
            'total_count': qs.count(),
            'time_range_hours': hours,
            'timestamp': timezone.now().isoformat() + 'Z'
        }

        for sighting in qs:
            result['sightings'].append({
                'id': sighting.id,
                'rarity_type': sighting.rarity_type,
                'rarity_type_display': sighting.get_rarity_type_display(),
                'icao_hex': sighting.icao_hex,
                'callsign': sighting.callsign,
                'registration': sighting.registration,
                'aircraft_type': sighting.aircraft_type,
                'operator': sighting.operator,
                'sighted_at': sighting.sighted_at.isoformat() + 'Z' if sighting.sighted_at else None,
                'description': sighting.description,
                'rarity_score': sighting.rarity_score,
                'times_seen': sighting.times_seen,
                'is_acknowledged': sighting.is_acknowledged,
            })

        cache.set(cache_key, result, timeout=RARE_SIGHTINGS_TIMEOUT)
        return result

    def check_for_rare_sighting(
        self,
        session: AircraftSession,
        aircraft_info: Optional[AircraftInfo] = None
    ) -> list:
        """
        Check if an aircraft qualifies as a rare/notable sighting.
        Returns list of rare sighting records created.
        """
        rare_sightings = []

        # Check if first time seeing this hex
        existing_spotted = SpottedAircraft.objects.filter(icao_hex=session.icao_hex).exists()
        if not existing_spotted:
            sighting = self._create_rare_sighting(
                rarity_type='first_hex',
                session=session,
                aircraft_info=aircraft_info,
                description=f"First time tracking aircraft {session.icao_hex}",
                rarity_score=3
            )
            if sighting:
                rare_sightings.append(sighting)

        # Check registration patterns
        if aircraft_info and aircraft_info.registration:
            reg_match = self._check_notable_registration(aircraft_info.registration)
            if reg_match:
                sighting = self._create_rare_sighting(
                    rarity_type=reg_match['category'],
                    session=session,
                    aircraft_info=aircraft_info,
                    description=f"Notable registration: {reg_match['name']}",
                    rarity_score=reg_match['rarity_score']
                )
                if sighting:
                    rare_sightings.append(sighting)

        # Check callsign patterns
        if session.callsign:
            callsign_match = self._check_notable_callsign(session.callsign)
            if callsign_match:
                sighting = self._create_rare_sighting(
                    rarity_type=callsign_match['category'],
                    session=session,
                    aircraft_info=aircraft_info,
                    description=f"Notable callsign: {callsign_match['name']}",
                    rarity_score=callsign_match['rarity_score']
                )
                if sighting:
                    rare_sightings.append(sighting)

        # Check for rare aircraft type
        aircraft_type = session.aircraft_type or (aircraft_info.type_code if aircraft_info else None)
        if aircraft_type:
            type_match = self._check_rare_type(aircraft_type)
            if type_match:
                sighting = self._create_rare_sighting(
                    rarity_type='rare_type',
                    session=session,
                    aircraft_info=aircraft_info,
                    description=f"Rare aircraft type: {type_match['type_name'] or type_match['type_code']}",
                    rarity_score=type_match['rarity_score']
                )
                if sighting:
                    rare_sightings.append(sighting)

        # Check for military
        if session.is_military and not any(s['rarity_type'] == 'military' for s in rare_sightings):
            sighting = self._create_rare_sighting(
                rarity_type='military',
                session=session,
                aircraft_info=aircraft_info,
                description="Military aircraft detected",
                rarity_score=4
            )
            if sighting:
                rare_sightings.append(sighting)

        # Invalidate cache if new sightings
        if rare_sightings:
            self._invalidate_rare_sightings_cache()

        return rare_sightings

    def _check_notable_registration(self, registration: str) -> Optional[dict]:
        """Check if registration matches any notable patterns."""
        patterns = self._get_notable_registrations()

        for pattern in patterns:
            if pattern['pattern_type'] == 'prefix':
                if registration.upper().startswith(pattern['pattern'].upper()):
                    return pattern
            elif pattern['pattern_type'] == 'contains':
                if pattern['pattern'].upper() in registration.upper():
                    return pattern
            elif pattern['pattern_type'] == 'exact':
                if registration.upper() == pattern['pattern'].upper():
                    return pattern
            elif pattern['pattern_type'] == 'regex':
                if re.match(pattern['pattern'], registration, re.IGNORECASE):
                    return pattern

        return None

    def _check_notable_callsign(self, callsign: str) -> Optional[dict]:
        """Check if callsign matches any notable patterns."""
        patterns = self._get_notable_callsigns()

        for pattern in patterns:
            if pattern['pattern_type'] == 'prefix':
                if callsign.upper().startswith(pattern['pattern'].upper()):
                    return pattern
            elif pattern['pattern_type'] == 'contains':
                if pattern['pattern'].upper() in callsign.upper():
                    return pattern
            elif pattern['pattern_type'] == 'exact':
                if callsign.upper() == pattern['pattern'].upper():
                    return pattern
            elif pattern['pattern_type'] == 'regex':
                if re.match(pattern['pattern'], callsign, re.IGNORECASE):
                    return pattern

        return None

    def _check_rare_type(self, aircraft_type: str) -> Optional[dict]:
        """Check if aircraft type is considered rare."""
        rare_types = self._get_rare_types()

        for rt in rare_types:
            if rt['type_code'].upper() == aircraft_type.upper():
                return rt

        return None

    def _get_notable_registrations(self) -> list:
        """Get notable registration patterns (cached)."""
        if self._notable_registrations_cache is None:
            db_patterns = list(NotableRegistration.objects.filter(is_active=True).values(
                'name', 'pattern', 'pattern_type', 'category', 'rarity_score'
            ))
            if db_patterns:
                self._notable_registrations_cache = db_patterns
            else:
                self._notable_registrations_cache = DEFAULT_NOTABLE_REGISTRATIONS
        return self._notable_registrations_cache

    def _get_notable_callsigns(self) -> list:
        """Get notable callsign patterns (cached)."""
        if self._notable_callsigns_cache is None:
            db_patterns = list(NotableCallsign.objects.filter(is_active=True).values(
                'name', 'pattern', 'pattern_type', 'category', 'rarity_score'
            ))
            if db_patterns:
                self._notable_callsigns_cache = db_patterns
            else:
                self._notable_callsigns_cache = DEFAULT_NOTABLE_CALLSIGNS
        return self._notable_callsigns_cache

    def _get_rare_types(self) -> list:
        """Get rare aircraft types (cached)."""
        if self._rare_types_cache is None:
            db_types = list(RareAircraftType.objects.filter(is_active=True).values(
                'type_code', 'type_name', 'category', 'rarity_score'
            ))
            if db_types:
                self._rare_types_cache = db_types
            else:
                self._rare_types_cache = DEFAULT_RARE_TYPES
        return self._rare_types_cache

    def _create_rare_sighting(
        self,
        rarity_type: str,
        session: AircraftSession,
        aircraft_info: Optional[AircraftInfo],
        description: str,
        rarity_score: int
    ) -> Optional[dict]:
        """Create a rare sighting record."""
        try:
            # Check if we've already recorded this exact sighting type for this aircraft recently
            recent_cutoff = timezone.now() - timedelta(hours=24)

            with transaction.atomic():
                # Lock the row during check-then-act to prevent race conditions
                existing = RareSighting.objects.select_for_update().filter(
                    icao_hex=session.icao_hex,
                    rarity_type=rarity_type,
                    sighted_at__gte=recent_cutoff
                ).first()

                if existing:
                    # Update times_seen and last_seen
                    existing.times_seen += 1
                    existing.last_seen = timezone.now()
                    existing.save()
                    return None

                sighting = RareSighting.objects.create(
                    rarity_type=rarity_type,
                    icao_hex=session.icao_hex,
                    callsign=session.callsign,
                    registration=aircraft_info.registration if aircraft_info else None,
                    aircraft_type=session.aircraft_type or (aircraft_info.type_code if aircraft_info else None),
                    operator=aircraft_info.operator if aircraft_info else None,
                    sighted_at=timezone.now(),
                    session_id=session.id,
                    description=description,
                    rarity_score=rarity_score,
                )

            return {
                'id': sighting.id,
                'rarity_type': rarity_type,
                'icao_hex': session.icao_hex,
                'description': description,
                'rarity_score': rarity_score,
            }

        except Exception as e:
            logger.error(f"Error creating rare sighting: {e}")
            return None

    def acknowledge_rare_sighting(self, sighting_id: int) -> bool:
        """Mark a rare sighting as acknowledged."""
        try:
            sighting = RareSighting.objects.get(id=sighting_id)
            sighting.is_acknowledged = True
            sighting.save()
            self._invalidate_rare_sightings_cache()
            return True
        except RareSighting.DoesNotExist:
            return False

    def _invalidate_rare_sightings_cache(self):
        """Invalidate all rare sightings cache entries."""
        # Simple invalidation - delete known patterns
        for hours in [1, 6, 12, 24, 48, 168]:
            for limit in [10, 25, 50, 100]:
                for ack in [True, False]:
                    cache.delete(f"{CACHE_KEY_RARE_SIGHTINGS}:{hours}:{limit}:{ack}")

    # ==========================================================================
    # Collection / Spotting Stats
    # ==========================================================================

    def get_collection_stats(self, force_refresh: bool = False) -> dict:
        """Get overall collection statistics."""
        if not force_refresh:
            cached = cache.get(CACHE_KEY_COLLECTION_STATS)
            if cached:
                return cached

        total_unique = SpottedAircraft.objects.count()
        military_count = SpottedAircraft.objects.filter(is_military=True).count()

        # Types spotted
        types_count = SpottedAircraft.objects.filter(
            aircraft_type__isnull=False
        ).values('aircraft_type').distinct().count()

        # Operators spotted
        operators_count = SpottedAircraft.objects.filter(
            operator__isnull=False
        ).values('operator').distinct().count()

        # Countries
        countries_count = SpottedAircraft.objects.filter(
            country__isnull=False
        ).values('country').distinct().count()

        # First and last
        first_ever = SpottedAircraft.objects.order_by('first_seen').first()
        last_seen = SpottedAircraft.objects.order_by('-last_seen').first()

        # Most seen aircraft
        most_seen = SpottedAircraft.objects.order_by('-times_seen')[:5]

        result = {
            'total_unique_aircraft': total_unique,
            'military_aircraft': military_count,
            'unique_types': types_count,
            'unique_operators': operators_count,
            'unique_countries': countries_count,
            'first_aircraft': {
                'icao_hex': first_ever.icao_hex,
                'registration': first_ever.registration,
                'first_seen': first_ever.first_seen.isoformat() + 'Z' if first_ever.first_seen else None,
            } if first_ever else None,
            'last_aircraft': {
                'icao_hex': last_seen.icao_hex,
                'registration': last_seen.registration,
                'last_seen': last_seen.last_seen.isoformat() + 'Z' if last_seen.last_seen else None,
            } if last_seen else None,
            'most_seen': [
                {
                    'icao_hex': ac.icao_hex,
                    'registration': ac.registration,
                    'operator': ac.operator,
                    'times_seen': ac.times_seen,
                }
                for ac in most_seen
            ],
            'timestamp': timezone.now().isoformat() + 'Z'
        }

        cache.set(CACHE_KEY_COLLECTION_STATS, result, timeout=COLLECTION_STATS_TIMEOUT)
        return result

    def get_spotted_by_type(self, limit: int = 50, force_refresh: bool = False) -> dict:
        """Get spotted counts grouped by aircraft type."""
        cache_key = f"{CACHE_KEY_SPOTTED_BY_TYPE}:{limit}"

        if not force_refresh:
            cached = cache.get(cache_key)
            if cached:
                return cached

        counts = SpottedCount.objects.filter(
            count_type='aircraft_type'
        ).order_by('-unique_aircraft')[:limit]

        result = {
            'types': [
                {
                    'type_code': c.identifier,
                    'type_name': c.display_name,
                    'unique_aircraft': c.unique_aircraft,
                    'total_sightings': c.total_sightings,
                    'total_sessions': c.total_sessions,
                    'first_seen': c.first_seen.isoformat() + 'Z' if c.first_seen else None,
                    'last_seen': c.last_seen.isoformat() + 'Z' if c.last_seen else None,
                }
                for c in counts
            ],
            'total_types': SpottedCount.objects.filter(count_type='aircraft_type').count(),
            'timestamp': timezone.now().isoformat() + 'Z'
        }

        cache.set(cache_key, result, timeout=COLLECTION_STATS_TIMEOUT)
        return result

    def get_spotted_by_operator(self, limit: int = 50, force_refresh: bool = False) -> dict:
        """Get spotted counts grouped by operator."""
        cache_key = f"{CACHE_KEY_SPOTTED_BY_OPERATOR}:{limit}"

        if not force_refresh:
            cached = cache.get(cache_key)
            if cached:
                return cached

        counts = SpottedCount.objects.filter(
            count_type='operator'
        ).order_by('-unique_aircraft')[:limit]

        result = {
            'operators': [
                {
                    'operator_code': c.identifier,
                    'operator_name': c.display_name,
                    'unique_aircraft': c.unique_aircraft,
                    'total_sightings': c.total_sightings,
                    'total_sessions': c.total_sessions,
                    'first_seen': c.first_seen.isoformat() + 'Z' if c.first_seen else None,
                    'last_seen': c.last_seen.isoformat() + 'Z' if c.last_seen else None,
                }
                for c in counts
            ],
            'total_operators': SpottedCount.objects.filter(count_type='operator').count(),
            'timestamp': timezone.now().isoformat() + 'Z'
        }

        cache.set(cache_key, result, timeout=COLLECTION_STATS_TIMEOUT)
        return result

    def update_spotted_aircraft(self, session: AircraftSession, aircraft_info: Optional[AircraftInfo] = None):
        """Update spotted aircraft and counts from a session."""
        try:
            # Update or create spotted aircraft
            spotted, created = SpottedAircraft.objects.get_or_create(
                icao_hex=session.icao_hex,
                defaults={
                    'registration': aircraft_info.registration if aircraft_info else None,
                    'aircraft_type': session.aircraft_type or (aircraft_info.type_code if aircraft_info else None),
                    'manufacturer': aircraft_info.manufacturer if aircraft_info else None,
                    'model': aircraft_info.model if aircraft_info else None,
                    'operator': aircraft_info.operator if aircraft_info else None,
                    'operator_icao': aircraft_info.operator_icao if aircraft_info else None,
                    'country': aircraft_info.country if aircraft_info else None,
                    'is_military': session.is_military,
                    'first_seen': session.first_seen,
                    'last_seen': session.last_seen,
                    'times_seen': 1,
                    'total_positions': session.total_positions,
                    'max_distance_nm': session.max_distance_nm,
                    'max_altitude': session.max_altitude,
                }
            )

            if not created:
                # Update existing record
                spotted.times_seen += 1
                spotted.last_seen = session.last_seen
                spotted.total_positions += session.total_positions or 0

                # Update maximums
                if session.max_distance_nm:
                    if spotted.max_distance_nm is None or session.max_distance_nm > spotted.max_distance_nm:
                        spotted.max_distance_nm = session.max_distance_nm
                if session.max_altitude:
                    if spotted.max_altitude is None or session.max_altitude > spotted.max_altitude:
                        spotted.max_altitude = session.max_altitude

                # Update info if we have it now but didn't before
                if aircraft_info:
                    if not spotted.registration:
                        spotted.registration = aircraft_info.registration
                    if not spotted.operator:
                        spotted.operator = aircraft_info.operator

                spotted.save()

            # Update count tables
            self._update_spotted_counts(session, aircraft_info, is_new=created)

            # Invalidate collection cache
            cache.delete(CACHE_KEY_COLLECTION_STATS)

        except Exception as e:
            logger.error(f"Error updating spotted aircraft: {e}")

    def _update_spotted_counts(
        self,
        session: AircraftSession,
        aircraft_info: Optional[AircraftInfo],
        is_new: bool
    ):
        """Update spotted count aggregations."""
        now = timezone.now()

        # Update by aircraft type
        aircraft_type = session.aircraft_type or (aircraft_info.type_code if aircraft_info else None)
        if aircraft_type:
            count, _ = SpottedCount.objects.get_or_create(
                count_type='aircraft_type',
                identifier=aircraft_type.upper(),
                defaults={
                    'display_name': aircraft_info.type_name if aircraft_info else None,
                    'first_seen': session.first_seen,
                }
            )
            if is_new:
                count.unique_aircraft += 1
            count.total_sessions += 1
            count.total_sightings += session.total_positions or 0
            count.last_seen = now
            count.save()

        # Update by operator
        operator = aircraft_info.operator_icao if aircraft_info else None
        operator_name = aircraft_info.operator if aircraft_info else None
        if operator:
            count, _ = SpottedCount.objects.get_or_create(
                count_type='operator',
                identifier=operator.upper(),
                defaults={
                    'display_name': operator_name,
                    'first_seen': session.first_seen,
                }
            )
            if is_new:
                count.unique_aircraft += 1
            count.total_sessions += 1
            count.total_sightings += session.total_positions or 0
            count.last_seen = now
            count.save()

        # Update by manufacturer
        manufacturer = aircraft_info.manufacturer if aircraft_info else None
        if manufacturer:
            count, _ = SpottedCount.objects.get_or_create(
                count_type='manufacturer',
                identifier=manufacturer.upper()[:100],
                defaults={
                    'display_name': manufacturer,
                    'first_seen': session.first_seen,
                }
            )
            if is_new:
                count.unique_aircraft += 1
            count.total_sessions += 1
            count.total_sightings += session.total_positions or 0
            count.last_seen = now
            count.save()

        # Update by country
        country = aircraft_info.country if aircraft_info else None
        if country:
            count, _ = SpottedCount.objects.get_or_create(
                count_type='country',
                identifier=country.upper()[:100],
                defaults={
                    'display_name': country,
                    'first_seen': session.first_seen,
                }
            )
            if is_new:
                count.unique_aircraft += 1
            count.total_sessions += 1
            count.total_sightings += session.total_positions or 0
            count.last_seen = now
            count.save()

    # ==========================================================================
    # Streak Tracking
    # ==========================================================================

    def get_streaks(self, force_refresh: bool = False) -> dict:
        """Get all streak statistics."""
        if not force_refresh:
            cached = cache.get(CACHE_KEY_STREAKS)
            if cached:
                return cached

        streaks = SightingStreak.objects.all()
        result = {
            'streaks': [],
            'timestamp': timezone.now().isoformat() + 'Z'
        }

        for streak in streaks:
            result['streaks'].append({
                'streak_type': streak.streak_type,
                'streak_type_display': streak.get_streak_type_display(),
                'current_streak_days': streak.current_streak_days,
                'current_streak_start': streak.current_streak_start.isoformat() if streak.current_streak_start else None,
                'last_qualifying_date': streak.last_qualifying_date.isoformat() if streak.last_qualifying_date else None,
                'best_streak_days': streak.best_streak_days,
                'best_streak_start': streak.best_streak_start.isoformat() if streak.best_streak_start else None,
                'best_streak_end': streak.best_streak_end.isoformat() if streak.best_streak_end else None,
            })

        cache.set(CACHE_KEY_STREAKS, result, timeout=STREAKS_TIMEOUT)
        return result

    def update_streaks(self, session: AircraftSession, aircraft_info: Optional[AircraftInfo] = None):
        """Update streaks based on a new session."""
        today = timezone.now().date()

        # Check any_sighting streak
        self._update_streak('any_sighting', today, qualifies=True)

        # Check military streak
        if session.is_military:
            self._update_streak('military', today, qualifies=True)

        # Check if it's a new unique aircraft
        is_new = not SpottedAircraft.objects.filter(icao_hex=session.icao_hex).exclude(
            first_seen__date=today
        ).exists()
        if is_new:
            self._update_streak('unique_new', today, qualifies=True)

        # Check high altitude
        if session.max_altitude and session.max_altitude >= 40000:
            self._update_streak('high_altitude', today, qualifies=True)

        # Check long range
        if session.max_distance_nm and session.max_distance_nm >= 100:
            self._update_streak('long_range', today, qualifies=True)

        # Check rare type
        aircraft_type = session.aircraft_type or (aircraft_info.type_code if aircraft_info else None)
        if aircraft_type and self._check_rare_type(aircraft_type):
            self._update_streak('rare_type', today, qualifies=True)

        cache.delete(CACHE_KEY_STREAKS)

    def _update_streak(self, streak_type: str, today: date, qualifies: bool):
        """Update a specific streak type."""
        try:
            streak, created = SightingStreak.objects.get_or_create(
                streak_type=streak_type,
                defaults={
                    'current_streak_days': 1 if qualifies else 0,
                    'current_streak_start': today if qualifies else None,
                    'last_qualifying_date': today if qualifies else None,
                    'best_streak_days': 1 if qualifies else 0,
                    'best_streak_start': today if qualifies else None,
                    'best_streak_end': today if qualifies else None,
                }
            )

            if not created and qualifies:
                yesterday = today - timedelta(days=1)

                if streak.last_qualifying_date == today:
                    # Already logged today, no change
                    return
                elif streak.last_qualifying_date == yesterday:
                    # Continuing streak
                    streak.current_streak_days += 1
                    streak.last_qualifying_date = today

                    # Check if this is a new best
                    if streak.current_streak_days > streak.best_streak_days:
                        streak.best_streak_days = streak.current_streak_days
                        streak.best_streak_end = today
                else:
                    # Streak broken, start new one
                    streak.current_streak_days = 1
                    streak.current_streak_start = today
                    streak.last_qualifying_date = today

                streak.save()

        except Exception as e:
            logger.error(f"Error updating streak {streak_type}: {e}")

    # ==========================================================================
    # Daily Stats
    # ==========================================================================

    def get_daily_stats(self, days: int = 30, force_refresh: bool = False) -> dict:
        """Get daily statistics for the specified number of days."""
        cache_key = f"{CACHE_KEY_DAILY_STATS}:{days}"

        if not force_refresh:
            cached = cache.get(cache_key)
            if cached:
                return cached

        cutoff = timezone.now().date() - timedelta(days=days)
        stats = DailyStats.objects.filter(date__gte=cutoff).order_by('-date')

        result = {
            'days': [
                {
                    'date': s.date.isoformat(),
                    'unique_aircraft': s.unique_aircraft,
                    'new_aircraft': s.new_aircraft,
                    'total_sessions': s.total_sessions,
                    'total_positions': s.total_positions,
                    'military_count': s.military_count,
                    'max_distance_nm': s.max_distance_nm,
                    'max_altitude': s.max_altitude,
                    'max_speed': s.max_speed,
                    'top_types': dict(list(s.aircraft_types.items())[:5]) if s.aircraft_types else {},
                    'top_operators': dict(list(s.operators.items())[:5]) if s.operators else {},
                }
                for s in stats
            ],
            'total_days': stats.count(),
            'timestamp': timezone.now().isoformat() + 'Z'
        }

        cache.set(cache_key, result, timeout=DAILY_STATS_TIMEOUT)
        return result

    def update_daily_stats(self, for_date: date = None):
        """Update daily statistics for a specific date (default: today)."""
        if for_date is None:
            for_date = timezone.now().date()

        try:
            # Get sessions for the day
            day_start = timezone.make_aware(datetime.combine(for_date, datetime.min.time()))
            day_end = day_start + timedelta(days=1)

            sessions = AircraftSession.objects.filter(
                first_seen__gte=day_start,
                first_seen__lt=day_end
            )

            # Calculate stats
            unique_hexes = sessions.values('icao_hex').distinct().count()
            military_count = sessions.filter(is_military=True).count()
            total_sessions = sessions.count()
            total_positions = sessions.aggregate(total=Sum('total_positions'))['total'] or 0

            # Count new aircraft (first ever seen) - batch query to avoid N+1
            day_hexes = list(sessions.values_list('icao_hex', flat=True).distinct())
            # Batch fetch all SpottedAircraft records for these hexes
            spotted_map = {
                s.icao_hex: s.first_seen
                for s in SpottedAircraft.objects.filter(icao_hex__in=day_hexes)
                if s.first_seen
            }
            new_aircraft = sum(
                1 for hex_code in day_hexes
                if hex_code in spotted_map and spotted_map[hex_code].date() == for_date
            )

            # Get maximums
            max_distance = sessions.aggregate(max=Max('max_distance_nm'))['max']
            max_altitude = sessions.aggregate(max=Max('max_altitude'))['max']

            # Get max speed from sightings
            sightings = AircraftSighting.objects.filter(
                timestamp__gte=day_start,
                timestamp__lt=day_end
            )
            max_speed = sightings.aggregate(max=Max('ground_speed'))['max']

            # Aircraft type counts
            type_counts = sessions.filter(
                aircraft_type__isnull=False
            ).values('aircraft_type').annotate(
                count=Count('id')
            ).order_by('-count')[:20]
            aircraft_types = {t['aircraft_type']: t['count'] for t in type_counts}

            # Operator counts (from aircraft info) - batch query to avoid N+1
            session_icaos = list(sessions.values_list('icao_hex', flat=True))
            # Batch fetch all AircraftInfo records for these ICAOs
            info_map = {
                info.icao_hex: info.operator
                for info in AircraftInfo.objects.filter(icao_hex__in=session_icaos)
                if info.operator
            }
            # Count operators using the pre-fetched data
            operator_counts = {}
            for icao in session_icaos:
                operator = info_map.get(icao)
                if operator:
                    operator_counts[operator] = operator_counts.get(operator, 0) + 1

            # Sort and limit operators
            operators = dict(sorted(operator_counts.items(), key=lambda x: x[1], reverse=True)[:20])

            # Update or create daily stats
            stats, _ = DailyStats.objects.update_or_create(
                date=for_date,
                defaults={
                    'unique_aircraft': unique_hexes,
                    'new_aircraft': new_aircraft,
                    'total_sessions': total_sessions,
                    'total_positions': total_positions,
                    'military_count': military_count,
                    'max_distance_nm': max_distance,
                    'max_altitude': max_altitude,
                    'max_speed': max_speed,
                    'aircraft_types': aircraft_types,
                    'operators': operators,
                }
            )

            # Invalidate cache
            for days in [7, 14, 30, 90]:
                cache.delete(f"{CACHE_KEY_DAILY_STATS}:{days}")

            logger.debug(f"Updated daily stats for {for_date}: {unique_hexes} aircraft")

        except Exception as e:
            logger.error(f"Error updating daily stats for {for_date}: {e}")

    # ==========================================================================
    # Lifetime Stats
    # ==========================================================================

    def get_lifetime_stats(self, force_refresh: bool = False) -> dict:
        """Get all-time lifetime statistics."""
        if not force_refresh:
            cached = cache.get(CACHE_KEY_LIFETIME_STATS)
            if cached:
                return cached

        # Total counts
        total_aircraft = SpottedAircraft.objects.count()
        total_sessions = AircraftSession.objects.count()
        total_positions = AircraftSighting.objects.count()

        # Unique counts
        unique_types = SpottedAircraft.objects.filter(
            aircraft_type__isnull=False
        ).values('aircraft_type').distinct().count()

        unique_operators = SpottedAircraft.objects.filter(
            operator__isnull=False
        ).values('operator').distinct().count()

        unique_countries = SpottedAircraft.objects.filter(
            country__isnull=False
        ).values('country').distinct().count()

        # All-time records from personal records
        records = PersonalRecord.objects.all()
        all_time_records = {
            r.record_type: {
                'value': r.value,
                'icao_hex': r.icao_hex,
                'callsign': r.callsign,
                'achieved_at': r.achieved_at.isoformat() + 'Z' if r.achieved_at else None,
            }
            for r in records
        }

        # First ever sighting
        first_session = AircraftSession.objects.order_by('first_seen').first()
        first_sighting = {
            'icao_hex': first_session.icao_hex,
            'callsign': first_session.callsign,
            'timestamp': first_session.first_seen.isoformat() + 'Z' if first_session else None,
        } if first_session else None

        # Active tracking days
        active_days = DailyStats.objects.filter(unique_aircraft__gt=0).count()

        # Total rare sightings
        total_rare = RareSighting.objects.count()

        result = {
            'total_unique_aircraft': total_aircraft,
            'total_sessions': total_sessions,
            'total_positions': total_positions,
            'unique_aircraft_types': unique_types,
            'unique_operators': unique_operators,
            'unique_countries': unique_countries,
            'active_tracking_days': active_days,
            'total_rare_sightings': total_rare,
            'all_time_records': all_time_records,
            'first_sighting': first_sighting,
            'timestamp': timezone.now().isoformat() + 'Z'
        }

        cache.set(CACHE_KEY_LIFETIME_STATS, result, timeout=LIFETIME_STATS_TIMEOUT)
        return result


# Global service instance
gamification_service = GamificationService()
