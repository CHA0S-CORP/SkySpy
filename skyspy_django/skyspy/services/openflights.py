"""
OpenFlights static data service.

Loads airline and aircraft type data from OpenFlights GitHub repository.
OpenFlights: https://github.com/jpatokal/openflights

This is free static data - no API key required.
"""
import csv
import io
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

import httpx
from django.db import transaction
from django.db.models import Max, Count

from skyspy.models.notams import CachedAirline, CachedAircraftType

logger = logging.getLogger(__name__)

# OpenFlights data URLs
AIRLINES_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat"
AIRCRAFT_TYPES_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/planes.dat"
ROUTES_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat"

# Refresh interval (7 days)
REFRESH_INTERVAL_DAYS = 7


def _fetch_csv_data(url: str) -> Optional[List[List[str]]]:
    """
    Fetch CSV data from a URL.

    Args:
        url: URL to fetch data from

    Returns:
        List of rows (each row is a list of strings) or None if failed
    """
    try:
        with httpx.Client(timeout=60) as client:
            response = client.get(
                url,
                headers={"User-Agent": "SkySpyAPI/2.6 (aircraft-tracker)"}
            )
            response.raise_for_status()

            # Parse CSV
            reader = csv.reader(io.StringIO(response.text))
            rows = list(reader)
            return rows

    except Exception as e:
        logger.error(f"Failed to fetch CSV from {url}: {e}")
        return None


@transaction.atomic
def refresh_airlines() -> int:
    """
    Refresh airline data from OpenFlights.

    OpenFlights airlines.dat format:
    0: Airline ID (ignored)
    1: Name
    2: Alias
    3: IATA code
    4: ICAO code
    5: Callsign
    6: Country
    7: Active (Y/N)

    Returns:
        Number of airlines cached
    """
    logger.info("Refreshing airline data from OpenFlights...")

    rows = _fetch_csv_data(AIRLINES_URL)
    if not rows:
        logger.error("Failed to fetch airline data")
        return 0

    # Clear existing data
    CachedAirline.objects.all().delete()

    airlines = []
    seen_icao = set()
    now = datetime.utcnow()

    for row in rows:
        if len(row) < 8:
            continue

        try:
            icao_code = row[4].strip() if row[4] else None
            if not icao_code or icao_code == '\\N' or icao_code == '-':
                continue

            # Skip duplicates
            if icao_code in seen_icao:
                continue
            seen_icao.add(icao_code)

            iata_code = row[3].strip() if row[3] and row[3] != '\\N' else None
            name = row[1].strip() if row[1] else 'Unknown'
            callsign = row[5].strip() if row[5] and row[5] != '\\N' else None
            country = row[6].strip() if row[6] and row[6] != '\\N' else None
            active = row[7].strip().upper() == 'Y' if row[7] else True

            airlines.append(CachedAirline(
                icao_code=icao_code[:4],
                iata_code=iata_code[:3] if iata_code else None,
                name=name[:200],
                callsign=callsign[:100] if callsign else None,
                country=country[:100] if country else None,
                active=active,
                source_data={'openflights_row': row},
            ))

        except Exception as e:
            logger.warning(f"Failed to parse airline row: {e}")
            continue

    if airlines:
        CachedAirline.objects.bulk_create(airlines)
        logger.info(f"Cached {len(airlines)} airlines")

    return len(airlines)


@transaction.atomic
def refresh_aircraft_types() -> int:
    """
    Refresh aircraft type data from OpenFlights.

    OpenFlights planes.dat format:
    0: Name
    1: IATA code
    2: ICAO code

    Returns:
        Number of aircraft types cached
    """
    logger.info("Refreshing aircraft type data from OpenFlights...")

    rows = _fetch_csv_data(AIRCRAFT_TYPES_URL)
    if not rows:
        logger.error("Failed to fetch aircraft type data")
        return 0

    # Clear existing data
    CachedAircraftType.objects.all().delete()

    aircraft_types = []
    seen_icao = set()
    now = datetime.utcnow()

    for row in rows:
        if len(row) < 3:
            continue

        try:
            icao_code = row[2].strip() if row[2] else None
            if not icao_code or icao_code == '\\N':
                continue

            # Skip duplicates
            if icao_code in seen_icao:
                continue
            seen_icao.add(icao_code)

            name = row[0].strip() if row[0] else 'Unknown'
            iata_code = row[1].strip() if row[1] and row[1] != '\\N' else None

            # Try to extract manufacturer from name
            manufacturer = None
            common_manufacturers = [
                'Boeing', 'Airbus', 'Embraer', 'Bombardier', 'Cessna',
                'Beechcraft', 'Piper', 'Lockheed', 'McDonnell Douglas',
                'Fokker', 'ATR', 'Saab', 'de Havilland', 'BAe',
                'Gulfstream', 'Dassault', 'Hawker', 'Learjet',
            ]
            for mfr in common_manufacturers:
                if mfr.lower() in name.lower():
                    manufacturer = mfr
                    break

            aircraft_types.append(CachedAircraftType(
                icao_code=icao_code[:10],
                iata_code=iata_code[:5] if iata_code else None,
                name=name[:200],
                manufacturer=manufacturer,
                source_data={'openflights_row': row},
            ))

        except Exception as e:
            logger.warning(f"Failed to parse aircraft type row: {e}")
            continue

    if aircraft_types:
        CachedAircraftType.objects.bulk_create(aircraft_types)
        logger.info(f"Cached {len(aircraft_types)} aircraft types")

    return len(aircraft_types)


def refresh_all_openflights_data() -> Dict[str, int]:
    """
    Refresh all OpenFlights data (airlines and aircraft types).

    Returns:
        Dictionary with counts of refreshed data
    """
    results = {
        'airlines': refresh_airlines(),
        'aircraft_types': refresh_aircraft_types(),
    }

    logger.info(f"OpenFlights data refresh complete: {results}")
    return results


def get_airline_by_icao(icao_code: str) -> Optional[Dict[str, Any]]:
    """
    Get airline by ICAO code.

    Args:
        icao_code: Airline ICAO code (e.g., 'AAL' for American Airlines)

    Returns:
        Airline data dictionary or None if not found
    """
    try:
        airline = CachedAirline.objects.get(icao_code__iexact=icao_code)
        return {
            'icao_code': airline.icao_code,
            'iata_code': airline.iata_code,
            'name': airline.name,
            'callsign': airline.callsign,
            'country': airline.country,
            'active': airline.active,
        }
    except CachedAirline.DoesNotExist:
        return None


def get_airline_by_callsign(callsign: str) -> Optional[Dict[str, Any]]:
    """
    Get airline by radio callsign.

    Args:
        callsign: Airline radio callsign (e.g., 'AMERICAN')

    Returns:
        Airline data dictionary or None if not found
    """
    try:
        airline = CachedAirline.objects.get(callsign__iexact=callsign)
        return {
            'icao_code': airline.icao_code,
            'iata_code': airline.iata_code,
            'name': airline.name,
            'callsign': airline.callsign,
            'country': airline.country,
            'active': airline.active,
        }
    except CachedAirline.DoesNotExist:
        return None


def get_airline_from_flight_callsign(flight_callsign: str) -> Optional[Dict[str, Any]]:
    """
    Extract airline from a flight callsign.

    Flight callsigns typically have format: AAL123 (ICAO prefix + flight number)

    Args:
        flight_callsign: Flight callsign (e.g., 'AAL123', 'UAL456')

    Returns:
        Airline data dictionary or None if not found
    """
    if not flight_callsign or len(flight_callsign) < 3:
        return None

    # Try 3-character ICAO prefix first
    icao_prefix = flight_callsign[:3].upper()
    airline = get_airline_by_icao(icao_prefix)

    if airline:
        return airline

    # Try 2-character IATA prefix
    iata_prefix = flight_callsign[:2].upper()
    try:
        airline = CachedAirline.objects.get(iata_code__iexact=iata_prefix)
        return {
            'icao_code': airline.icao_code,
            'iata_code': airline.iata_code,
            'name': airline.name,
            'callsign': airline.callsign,
            'country': airline.country,
            'active': airline.active,
        }
    except CachedAirline.DoesNotExist:
        pass

    return None


def get_aircraft_type_by_icao(icao_code: str) -> Optional[Dict[str, Any]]:
    """
    Get aircraft type by ICAO code.

    Args:
        icao_code: Aircraft type ICAO code (e.g., 'B738' for Boeing 737-800)

    Returns:
        Aircraft type data dictionary or None if not found
    """
    try:
        ac_type = CachedAircraftType.objects.get(icao_code__iexact=icao_code)
        return {
            'icao_code': ac_type.icao_code,
            'iata_code': ac_type.iata_code,
            'name': ac_type.name,
            'manufacturer': ac_type.manufacturer,
        }
    except CachedAircraftType.DoesNotExist:
        return None


def search_airlines(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Search airlines by name, ICAO, IATA, or callsign.

    Args:
        query: Search query
        limit: Maximum results

    Returns:
        List of matching airline dictionaries
    """
    from django.db.models import Q

    airlines = CachedAirline.objects.filter(
        Q(name__icontains=query) |
        Q(icao_code__icontains=query) |
        Q(iata_code__icontains=query) |
        Q(callsign__icontains=query)
    )[:limit]

    return [
        {
            'icao_code': a.icao_code,
            'iata_code': a.iata_code,
            'name': a.name,
            'callsign': a.callsign,
            'country': a.country,
            'active': a.active,
        }
        for a in airlines
    ]


def search_aircraft_types(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Search aircraft types by name, ICAO, or IATA code.

    Args:
        query: Search query
        limit: Maximum results

    Returns:
        List of matching aircraft type dictionaries
    """
    from django.db.models import Q

    types = CachedAircraftType.objects.filter(
        Q(name__icontains=query) |
        Q(icao_code__icontains=query) |
        Q(iata_code__icontains=query) |
        Q(manufacturer__icontains=query)
    )[:limit]

    return [
        {
            'icao_code': t.icao_code,
            'iata_code': t.iata_code,
            'name': t.name,
            'manufacturer': t.manufacturer,
        }
        for t in types
    ]


def get_cache_stats() -> Dict[str, Any]:
    """
    Get statistics about cached OpenFlights data.

    Returns:
        Statistics dictionary
    """
    airline_count = CachedAirline.objects.count()
    aircraft_type_count = CachedAircraftType.objects.count()

    airline_last = CachedAirline.objects.aggregate(Max('fetched_at'))['fetched_at__max']
    type_last = CachedAircraftType.objects.aggregate(Max('fetched_at'))['fetched_at__max']

    return {
        'airlines': {
            'count': airline_count,
            'last_refresh': airline_last.isoformat() if airline_last else None,
        },
        'aircraft_types': {
            'count': aircraft_type_count,
            'last_refresh': type_last.isoformat() if type_last else None,
        },
        'refresh_interval_days': REFRESH_INTERVAL_DAYS,
    }


def should_refresh() -> bool:
    """Check if OpenFlights data should be refreshed."""
    stats = get_cache_stats()

    # Refresh if no data
    if stats['airlines']['count'] == 0 or stats['aircraft_types']['count'] == 0:
        return True

    # Check last refresh time
    last_refresh = stats['airlines'].get('last_refresh')
    if not last_refresh:
        return True

    try:
        last_dt = datetime.fromisoformat(last_refresh)
        age = datetime.utcnow() - last_dt
        return age.days >= REFRESH_INTERVAL_DAYS
    except (ValueError, TypeError):
        return True
