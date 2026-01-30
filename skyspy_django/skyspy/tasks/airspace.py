"""
Airspace advisory and boundary refresh tasks.
"""
import logging
from datetime import datetime

import httpx
from celery import shared_task
from django.db import transaction
from django.utils import timezone

from skyspy.models import AirspaceAdvisory, AirspaceBoundary
from skyspy.socketio.utils import sync_emit

logger = logging.getLogger(__name__)


@shared_task
def refresh_airspace_advisories():
    """
    Refresh airspace advisories from Aviation Weather Center.

    Fetches G-AIRMETs, SIGMETs, and other advisories.
    Runs every 5 minutes.
    """
    try:
        # Fetch G-AIRMETs
        url = "https://aviationweather.gov/api/data/gairmet"
        response = httpx.get(url, timeout=30.0, params={
            'format': 'json',
            'type': 'all',
        })

        if response.status_code == 200:
            data = response.json()
            advisories = data if isinstance(data, list) else []

            with transaction.atomic():
                # Find and broadcast expired advisories before deleting
                old_cutoff = timezone.now()
                expired_advisories = AirspaceAdvisory.objects.filter(valid_to__lt=old_cutoff)
                expired_ids = list(expired_advisories.values_list('advisory_id', flat=True))
                expired_count = expired_advisories.count()
                expired_advisories.delete()

                # Broadcast advisory expirations via Socket.IO
                if expired_count > 0:
                    try:
                        sync_emit(
                            'airspace:advisory_expired',
                            {
                                'advisory_ids': expired_ids,
                                'count': expired_count,
                                'timestamp': datetime.utcnow().isoformat() + 'Z'
                            },
                            room='topic_aircraft'
                        )
                        logger.debug(f"Broadcast {expired_count} expired advisories")
                    except Exception as e:
                        logger.warning(f"Failed to broadcast advisory expiration: {e}")

                # Process new advisories
                for adv in advisories:
                    advisory_id = adv.get('airSigmetId') or adv.get('gairmetId')
                    if not advisory_id:
                        continue

                    # Parse times
                    valid_from = None
                    valid_to = None

                    if adv.get('validTimeFrom'):
                        try:
                            valid_from = datetime.fromisoformat(
                                adv['validTimeFrom'].replace('Z', '+00:00')
                            )
                        except (ValueError, TypeError) as e:
                            logger.debug(f"Invalid validTimeFrom format: {adv.get('validTimeFrom')} - {e}")

                    if adv.get('validTimeTo'):
                        try:
                            valid_to = datetime.fromisoformat(
                                adv['validTimeTo'].replace('Z', '+00:00')
                            )
                        except (ValueError, TypeError) as e:
                            logger.debug(f"Invalid validTimeTo format: {adv.get('validTimeTo')} - {e}")

                    # Parse geometry
                    polygon = None
                    if adv.get('geometry') and adv['geometry'].get('coordinates'):
                        polygon = {
                            'type': adv['geometry'].get('type', 'Polygon'),
                            'coordinates': adv['geometry']['coordinates']
                        }

                    AirspaceAdvisory.objects.update_or_create(
                        advisory_id=advisory_id,
                        defaults={
                            'advisory_type': adv.get('hazard', 'GAIRMET'),
                            'hazard': adv.get('hazard'),
                            'severity': adv.get('severity'),
                            'valid_from': valid_from,
                            'valid_to': valid_to,
                            'lower_alt_ft': adv.get('altitudeLow1'),
                            'upper_alt_ft': adv.get('altitudeHi1'),
                            'region': adv.get('region'),
                            'polygon': polygon,
                            'raw_text': adv.get('rawAirSigmet'),
                            'source_data': adv,
                        }
                    )

            logger.info(f"Refreshed {len(advisories)} airspace advisories")

            # Broadcast update to WebSocket clients via Socket.IO
            try:
                sync_emit(
                    'airspace:advisory',
                    {
                        'count': len(advisories),
                        'timestamp': datetime.utcnow().isoformat() + 'Z'
                    },
                    room='topic_aircraft'
                )
            except Exception as e:
                logger.warning(f"Failed to broadcast advisory update: {e}")

        else:
            logger.warning(f"Failed to fetch advisories: HTTP {response.status_code}")

    except httpx.HTTPError as e:
        logger.error(f"HTTP error fetching advisories: {e}")
    except Exception as e:
        logger.exception(f"Error refreshing advisories: {e}")


@shared_task(bind=True, max_retries=3)
def refresh_airspace_boundaries(self):
    """
    Refresh static airspace boundaries from OpenAIP.

    Fetches Class B/C/D airspace boundaries from OpenAIP.
    Runs daily at 3 AM.
    """
    from skyspy.services import openaip

    logger.info("Starting airspace boundary refresh from OpenAIP")

    # Check if OpenAIP is enabled
    if not openaip._is_enabled():
        logger.info("OpenAIP is not enabled, skipping boundary refresh")
        boundary_count = AirspaceBoundary.objects.count()
        return {'status': 'disabled', 'count': boundary_count}

    try:
        # Define regions to fetch (CONUS grid for comprehensive coverage)
        regions = [
            # Western US
            (37.0, -122.0, 300),  # California/Nevada
            (47.0, -122.0, 300),  # Pacific Northwest
            (33.0, -112.0, 300),  # Arizona/New Mexico
            (40.0, -105.0, 300),  # Colorado/Wyoming
            # Central US
            (35.0, -97.0, 300),   # Texas/Oklahoma
            (41.0, -95.0, 300),   # Midwest
            (45.0, -93.0, 300),   # Upper Midwest
            # Eastern US
            (33.0, -84.0, 300),   # Southeast
            (40.0, -75.0, 300),   # Northeast
            (42.0, -83.0, 300),   # Great Lakes
            (28.0, -82.0, 300),   # Florida
        ]

        total_stored = 0

        with transaction.atomic():
            for lat, lon, radius_nm in regions:
                logger.debug(f"Fetching airspaces for region ({lat}, {lon})")

                # Fetch airspaces from OpenAIP
                airspaces = openaip.get_airspaces(lat, lon, radius_nm)

                for airspace in airspaces:
                    # Skip if no geometry
                    geometry = airspace.get('geometry')
                    if not geometry:
                        continue

                    airspace_id = airspace.get('id', '')
                    if not airspace_id:
                        continue

                    # Map OpenAIP type to airspace class
                    airspace_type = airspace.get('type', 'OTHER')
                    airspace_class = _map_openaip_type_to_class(airspace_type)

                    # Calculate center from geometry
                    center_lat, center_lon = _calculate_geometry_center(geometry)

                    # Create or update boundary
                    AirspaceBoundary.objects.update_or_create(
                        source='openaip',
                        source_id=airspace_id,
                        defaults={
                            'name': airspace.get('name', 'Unknown'),
                            'airspace_class': airspace_class,
                            'floor_ft': airspace.get('floor_ft') or 0,
                            'ceiling_ft': airspace.get('ceiling_ft') or 0,
                            'center_lat': center_lat,
                            'center_lon': center_lon,
                            'polygon': geometry,
                        }
                    )
                    total_stored += 1

        boundary_count = AirspaceBoundary.objects.count()
        logger.info(f"Airspace boundary refresh complete. Processed {total_stored} airspaces, {boundary_count} total in database.")

        # Broadcast update via Socket.IO
        try:
            sync_emit(
                'airspace:boundary',
                {
                    'count': boundary_count,
                    'new': total_stored,
                    'timestamp': datetime.utcnow().isoformat() + 'Z'
                },
                room='topic_aircraft'
            )
        except Exception as e:
            logger.warning(f"Failed to broadcast boundary update: {e}")

        return {'status': 'complete', 'processed': total_stored, 'total': boundary_count}

    except Exception as e:
        logger.error(f"Failed to refresh airspace boundaries: {e}")
        raise self.retry(exc=e, countdown=300)


def _map_openaip_type_to_class(airspace_type: str) -> str:
    """Map OpenAIP airspace type to standard class."""
    type_mapping = {
        'CTR': 'D',
        'TMA': 'C',
        'CTA': 'C',
        'ATZ': 'D',
        'MATZ': 'D',
        'RESTRICTED': 'RESTRICTED',
        'PROHIBITED': 'PROHIBITED',
        'DANGER': 'WARNING',
        'WARNING': 'WARNING',
        'ALERT': 'ALERT',
        'MOA': 'MOA',
        'TFR': 'TFR',
        'FIR': 'E',
        'UIR': 'E',
        'ADIZ': 'E',
        'GLIDING': 'E',
        'PARACHUTE': 'E',
        'MTR': 'E',
        'AIRWAY': 'E',
    }
    return type_mapping.get(airspace_type, 'E')


def _calculate_geometry_center(geometry: dict) -> tuple:
    """Calculate the center point of a GeoJSON geometry."""
    coords = []

    def extract_coords(geom):
        geom_type = geom.get('type', '')
        coordinates = geom.get('coordinates', [])

        if geom_type == 'Point':
            coords.append(coordinates)
        elif geom_type in ('LineString', 'MultiPoint'):
            coords.extend(coordinates)
        elif geom_type in ('Polygon', 'MultiLineString'):
            for ring in coordinates:
                if isinstance(ring, list):
                    coords.extend(ring)
        elif geom_type == 'MultiPolygon':
            for polygon in coordinates:
                if isinstance(polygon, list):
                    for ring in polygon:
                        if isinstance(ring, list):
                            coords.extend(ring)
        elif geom_type == 'GeometryCollection':
            for g in geom.get('geometries', []):
                extract_coords(g)

    extract_coords(geometry)

    if not coords:
        return (0.0, 0.0)

    # Calculate average (centroid approximation)
    lons = [c[0] for c in coords if isinstance(c, (list, tuple)) and len(c) >= 2]
    lats = [c[1] for c in coords if isinstance(c, (list, tuple)) and len(c) >= 2]

    if not lons or not lats:
        return (0.0, 0.0)

    return (sum(lats) / len(lats), sum(lons) / len(lons))
