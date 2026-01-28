"""
Airspace WebSocket consumer for advisories and boundaries.
"""
import logging
from datetime import datetime
from channels.db import database_sync_to_async
from django.utils import timezone
from django.conf import settings

from skyspy.channels.consumers.base import BaseConsumer
from skyspy.models import AirspaceAdvisory, AirspaceBoundary, CachedAirport, CachedNavaid

logger = logging.getLogger(__name__)


class AirspaceConsumer(BaseConsumer):
    """
    WebSocket consumer for airspace data.

    Events:
    - airspace:snapshot - Initial airspace state on connect
    - airspace:advisory - New or updated advisory
    - airspace:boundary - Boundary update
    - airspace:advisory_expired - Advisory has expired

    Topics:
    - advisories - G-AIRMETs, SIGMETs
    - boundaries - Class B/C/D, MOAs
    - all - All airspace data
    """

    group_name_prefix = 'airspace'
    supported_topics = ['advisories', 'boundaries', 'all']

    async def send_initial_state(self):
        """Send initial airspace snapshot on connect."""
        advisories = await self.get_active_advisories()
        boundaries = await self.get_boundaries()

        await self.send_json({
            'type': 'airspace:snapshot',
            'data': {
                'advisories': advisories,
                'boundaries': boundaries,
                'timestamp': datetime.utcnow().isoformat()
            }
        })

    async def handle_request(self, request_type: str, request_id: str, params: dict):
        """Handle request/response messages."""
        if request_type == 'advisories':
            # Return active advisories with optional filters
            advisories = await self.get_active_advisories(
                hazard=params.get('hazard'),
                advisory_type=params.get('advisory_type')
            )
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'advisories',
                'data': advisories
            })

        elif request_type == 'boundaries' or request_type == 'airspace-boundaries':
            # Return boundaries with optional filters
            boundaries = await self.get_boundaries(
                airspace_class=params.get('airspace_class'),
                lat=params.get('lat'),
                lon=params.get('lon'),
                radius_nm=params.get('radius_nm') or params.get('radius', 100)
            )
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': request_type,
                'data': boundaries
            })

        elif request_type == 'airspaces':
            # Return both advisories and boundaries for location
            lat = params.get('lat')
            lon = params.get('lon')
            radius_nm = params.get('radius_nm', 100)

            advisories = await self.get_active_advisories()
            boundaries = await self.get_boundaries(lat=lat, lon=lon, radius_nm=radius_nm)

            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'airspaces',
                'data': {
                    'advisories': advisories,
                    'boundaries': boundaries
                }
            })

        elif request_type == 'metars':
            # Return METAR observations
            lat = params.get('lat', settings.FEEDER_LAT)
            lon = params.get('lon', settings.FEEDER_LON)
            radius_nm = params.get('radius_nm', 100)
            limit = min(int(params.get('limit', 20)), 50)

            metars = await self.get_metars(lat, lon, radius_nm, limit)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'metars',
                'data': metars
            })

        elif request_type == 'metar':
            # Return single METAR for station
            station = params.get('station') or params.get('icao')
            if station:
                metar = await self.get_metar(station)
                await self.send_json({
                    'type': 'response',
                    'request_id': request_id,
                    'request_type': 'metar',
                    'data': metar
                })
            else:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing station parameter'
                })

        elif request_type == 'taf':
            # Return TAF for station
            station = params.get('station') or params.get('icao')
            if station:
                taf = await self.get_taf(station)
                await self.send_json({
                    'type': 'response',
                    'request_id': request_id,
                    'request_type': 'taf',
                    'data': taf
                })
            else:
                await self.send_json({
                    'type': 'error',
                    'request_id': request_id,
                    'message': 'Missing station parameter'
                })

        elif request_type == 'pireps':
            # Return PIREPs
            lat = params.get('lat', settings.FEEDER_LAT)
            lon = params.get('lon', settings.FEEDER_LON)
            radius_nm = params.get('radius_nm', 200)
            hours = int(params.get('hours', 6))

            pireps = await self.get_pireps(lat, lon, radius_nm, hours)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'pireps',
                'data': pireps
            })

        elif request_type == 'sigmets':
            # Return SIGMETs
            hazard = params.get('hazard')
            sigmets = await self.get_sigmets(hazard)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'sigmets',
                'data': sigmets
            })

        elif request_type == 'airports':
            # Return nearby airports
            lat = params.get('lat', settings.FEEDER_LAT)
            lon = params.get('lon', settings.FEEDER_LON)
            radius_nm = params.get('radius_nm', 50)
            limit = min(int(params.get('limit', 20)), 100)

            airports = await self.get_airports(lat, lon, radius_nm, limit)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'airports',
                'data': airports
            })

        elif request_type == 'navaids':
            # Return nearby navaids
            lat = params.get('lat', settings.FEEDER_LAT)
            lon = params.get('lon', settings.FEEDER_LON)
            radius_nm = params.get('radius_nm', 100)
            navaid_type = params.get('type')
            limit = min(int(params.get('limit', 50)), 200)

            navaids = await self.get_navaids(lat, lon, radius_nm, navaid_type, limit)
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'navaids',
                'data': navaids
            })

        else:
            await super().handle_request(request_type, request_id, params)

    @database_sync_to_async
    def get_active_advisories(self, hazard=None, advisory_type=None):
        """Get active airspace advisories."""
        now = timezone.now()
        queryset = AirspaceAdvisory.objects.filter(
            valid_from__lte=now,
            valid_to__gte=now
        )

        if hazard:
            queryset = queryset.filter(hazard=hazard)
        if advisory_type:
            queryset = queryset.filter(advisory_type=advisory_type)

        advisories = []
        for adv in queryset[:100]:
            advisories.append({
                'id': adv.id,
                'advisory_id': adv.advisory_id,
                'advisory_type': adv.advisory_type,
                'hazard': adv.hazard,
                'severity': adv.severity,
                'valid_from': adv.valid_from.isoformat() if adv.valid_from else None,
                'valid_to': adv.valid_to.isoformat() if adv.valid_to else None,
                'lower_alt_ft': adv.lower_alt_ft,
                'upper_alt_ft': adv.upper_alt_ft,
                'region': adv.region,
                'polygon': adv.polygon,
                'raw_text': adv.raw_text,
            })
        return advisories

    @database_sync_to_async
    def get_boundaries(self, airspace_class=None, lat=None, lon=None, radius_nm=100):
        """Get airspace boundaries."""
        queryset = AirspaceBoundary.objects.all()

        if airspace_class:
            queryset = queryset.filter(airspace_class=airspace_class)

        # Simple bounding box filter if location provided
        if lat is not None and lon is not None:
            # Rough conversion: 1 degree ~ 60nm
            lat_delta = radius_nm / 60
            lon_delta = radius_nm / 60

            queryset = queryset.filter(
                center_lat__gte=lat - lat_delta,
                center_lat__lte=lat + lat_delta,
                center_lon__gte=lon - lon_delta,
                center_lon__lte=lon + lon_delta
            )

        boundaries = []
        for boundary in queryset[:200]:
            boundaries.append({
                'id': boundary.id,
                'name': boundary.name,
                'icao': boundary.icao,
                'airspace_class': boundary.airspace_class,
                'floor_ft': boundary.floor_ft,
                'ceiling_ft': boundary.ceiling_ft,
                'center_lat': boundary.center_lat,
                'center_lon': boundary.center_lon,
                'radius_nm': boundary.radius_nm,
                'polygon': boundary.polygon,
                'controlling_agency': boundary.controlling_agency,
                'schedule': boundary.schedule,
            })
        return boundaries

    @database_sync_to_async
    def get_metars(self, lat, lon, radius_nm, limit):
        """Get METAR observations from weather service cache."""
        from skyspy.services.weather_cache import get_metars_near
        try:
            return get_metars_near(lat, lon, radius_nm, limit)
        except Exception as e:
            logger.error(f"Error fetching METARs: {e}")
            return []

    @database_sync_to_async
    def get_metar(self, station):
        """Get single METAR for station."""
        from skyspy.services.weather_cache import get_metar
        try:
            return get_metar(station.upper())
        except Exception as e:
            logger.error(f"Error fetching METAR for {station}: {e}")
            return None

    @database_sync_to_async
    def get_taf(self, station):
        """Get TAF for station."""
        from skyspy.services.weather_cache import get_taf
        try:
            return get_taf(station.upper())
        except Exception as e:
            logger.error(f"Error fetching TAF for {station}: {e}")
            return None

    @database_sync_to_async
    def get_pireps(self, lat, lon, radius_nm, hours):
        """Get PIREPs."""
        from skyspy.services.weather_cache import get_pireps_near
        try:
            return get_pireps_near(lat, lon, radius_nm, hours)
        except Exception as e:
            logger.error(f"Error fetching PIREPs: {e}")
            return []

    @database_sync_to_async
    def get_sigmets(self, hazard=None):
        """Get SIGMETs."""
        now = timezone.now()
        queryset = AirspaceAdvisory.objects.filter(
            advisory_type__in=['SIGMET', 'AIRMET'],
            valid_from__lte=now,
            valid_to__gte=now
        )

        if hazard:
            queryset = queryset.filter(hazard=hazard)

        sigmets = []
        for sig in queryset[:50]:
            sigmets.append({
                'id': sig.id,
                'advisory_id': sig.advisory_id,
                'advisory_type': sig.advisory_type,
                'hazard': sig.hazard,
                'severity': sig.severity,
                'valid_from': sig.valid_from.isoformat() if sig.valid_from else None,
                'valid_to': sig.valid_to.isoformat() if sig.valid_to else None,
                'lower_alt_ft': sig.lower_alt_ft,
                'upper_alt_ft': sig.upper_alt_ft,
                'polygon': sig.polygon,
                'raw_text': sig.raw_text,
            })
        return sigmets

    @database_sync_to_async
    def get_airports(self, lat, lon, radius_nm, limit):
        """Get nearby airports."""
        # Rough bounding box filter
        lat_delta = radius_nm / 60
        lon_delta = radius_nm / 60

        queryset = CachedAirport.objects.filter(
            latitude__gte=lat - lat_delta,
            latitude__lte=lat + lat_delta,
            longitude__gte=lon - lon_delta,
            longitude__lte=lon + lon_delta
        )

        airports = []
        for apt in queryset[:limit]:
            airports.append({
                'icao': apt.icao_id,
                'name': apt.name,
                'latitude': apt.latitude,
                'longitude': apt.longitude,
                'elevation_ft': apt.elevation_ft,
                'type': apt.airport_type,
                'country': apt.country,
                'region': apt.region,
            })
        return airports

    @database_sync_to_async
    def get_navaids(self, lat, lon, radius_nm, navaid_type, limit):
        """Get nearby navigation aids."""
        lat_delta = radius_nm / 60
        lon_delta = radius_nm / 60

        queryset = CachedNavaid.objects.filter(
            latitude__gte=lat - lat_delta,
            latitude__lte=lat + lat_delta,
            longitude__gte=lon - lon_delta,
            longitude__lte=lon + lon_delta
        )

        if navaid_type:
            queryset = queryset.filter(navaid_type=navaid_type)

        navaids = []
        for nav in queryset[:limit]:
            navaids.append({
                'identifier': nav.ident,
                'name': nav.name,
                'type': nav.navaid_type,
                'latitude': nav.latitude,
                'longitude': nav.longitude,
                'frequency_khz': nav.frequency,
            })
        return navaids

    # Channel layer message handlers

    async def airspace_snapshot(self, event):
        """Handle airspace snapshot broadcast."""
        await self.send_json({
            'type': 'airspace:snapshot',
            'data': event['data']
        })

    async def airspace_advisory(self, event):
        """Handle advisory update broadcast."""
        await self.send_json({
            'type': 'airspace:advisory',
            'data': event['data']
        })

    async def airspace_boundary(self, event):
        """Handle boundary update broadcast."""
        await self.send_json({
            'type': 'airspace:boundary',
            'data': event['data']
        })

    async def airspace_advisory_expired(self, event):
        """Handle advisory expiration broadcast."""
        await self.send_json({
            'type': 'airspace:advisory_expired',
            'data': event['data']
        })
