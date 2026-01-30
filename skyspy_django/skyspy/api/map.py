"""
Map data API views for GeoJSON output.
"""
import logging
from datetime import datetime

from django.conf import settings
from django.core.cache import cache
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.serializers.common import GeoJSONFeatureCollectionSerializer
from skyspy.auth.authentication import OptionalJWTAuthentication, APIKeyAuthentication
from skyspy.auth.permissions import FeatureBasedPermission

logger = logging.getLogger(__name__)


class MapViewSet(viewsets.ViewSet):
    """ViewSet for map data and GeoJSON output."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="Get GeoJSON aircraft data",
        description="Get all aircraft as a GeoJSON FeatureCollection",
        responses={200: GeoJSONFeatureCollectionSerializer}
    )
    @action(detail=False, methods=['get'])
    def geojson(self, request):
        """Get aircraft as GeoJSON FeatureCollection."""
        aircraft_list = cache.get("current_aircraft", [])

        features = []
        for ac in aircraft_list:
            lat = ac.get('lat')
            lon = ac.get('lon')

            # Skip aircraft without position
            if lat is None or lon is None:
                continue

            feature = {
                'type': 'Feature',
                'id': ac.get('hex'),
                'geometry': {
                    'type': 'Point',
                    'coordinates': [lon, lat]
                },
                'properties': {
                    'hex': ac.get('hex'),
                    'flight': ac.get('flight'),
                    'type': ac.get('type'),
                    'altitude': ac.get('alt'),
                    'speed': ac.get('gs'),
                    'track': ac.get('track'),
                    'vr': ac.get('vr'),
                    'squawk': ac.get('squawk'),
                    'category': ac.get('category'),
                    'military': ac.get('military', False),
                    'emergency': ac.get('emergency', False),
                    'distance_nm': ac.get('distance_nm'),
                    'rssi': ac.get('rssi'),
                }
            }
            features.append(feature)

        return Response({
            'type': 'FeatureCollection',
            'features': features,
            'metadata': {
                'count': len(features),
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'feeder_location': {
                    'latitude': settings.FEEDER_LAT,
                    'longitude': settings.FEEDER_LON,
                }
            }
        })

    @extend_schema(
        summary="Get map bounds",
        description="Get bounding box of current aircraft positions"
    )
    @action(detail=False, methods=['get'])
    def bounds(self, request):
        """Get bounding box of current aircraft."""
        aircraft_list = cache.get("current_aircraft", [])

        positions = [
            (ac.get('lat'), ac.get('lon'))
            for ac in aircraft_list
            if ac.get('lat') is not None and ac.get('lon') is not None
        ]

        if not positions:
            # Return bounds around feeder location
            return Response({
                'bounds': {
                    'min_lat': settings.FEEDER_LAT - 1,
                    'max_lat': settings.FEEDER_LAT + 1,
                    'min_lon': settings.FEEDER_LON - 1,
                    'max_lon': settings.FEEDER_LON + 1,
                },
                'center': {
                    'latitude': settings.FEEDER_LAT,
                    'longitude': settings.FEEDER_LON,
                },
                'aircraft_count': 0,
            })

        lats = [p[0] for p in positions]
        lons = [p[1] for p in positions]

        return Response({
            'bounds': {
                'min_lat': min(lats),
                'max_lat': max(lats),
                'min_lon': min(lons),
                'max_lon': max(lons),
            },
            'center': {
                'latitude': sum(lats) / len(lats),
                'longitude': sum(lons) / len(lons),
            },
            'aircraft_count': len(positions),
        })

    @extend_schema(
        summary="Get clustered aircraft data",
        description="Get aircraft clustered by location for map display",
        parameters=[
            OpenApiParameter(name='zoom', type=int, description='Map zoom level'),
            OpenApiParameter(name='cluster_distance', type=float, description='Clustering distance'),
        ]
    )
    @action(detail=False, methods=['get'])
    def cluster(self, request):
        """Get clustered aircraft data."""
        aircraft_list = cache.get("current_aircraft", [])
        zoom = int(request.query_params.get('zoom', 8))

        # Simple clustering based on grid
        # Higher zoom = smaller clusters
        grid_size = max(0.1, 10.0 / (2 ** (zoom - 5)))

        clusters = {}
        unclustered = []

        for ac in aircraft_list:
            lat = ac.get('lat')
            lon = ac.get('lon')

            if lat is None or lon is None:
                continue

            # Calculate grid cell
            grid_lat = int(lat / grid_size)
            grid_lon = int(lon / grid_size)
            key = (grid_lat, grid_lon)

            if key not in clusters:
                clusters[key] = {
                    'center_lat': (grid_lat + 0.5) * grid_size,
                    'center_lon': (grid_lon + 0.5) * grid_size,
                    'aircraft': [],
                }

            clusters[key]['aircraft'].append(ac)

        # Convert clusters to list
        result = []
        for key, cluster in clusters.items():
            if len(cluster['aircraft']) == 1:
                # Single aircraft - don't cluster
                unclustered.append(cluster['aircraft'][0])
            else:
                result.append({
                    'type': 'cluster',
                    'latitude': cluster['center_lat'],
                    'longitude': cluster['center_lon'],
                    'count': len(cluster['aircraft']),
                    'aircraft': cluster['aircraft'],
                })

        return Response({
            'clusters': result,
            'unclustered': unclustered,
            'total_aircraft': len(aircraft_list),
            'cluster_count': len(result),
            'zoom': zoom,
        })

    @extend_schema(
        summary="Get SSE/WebSocket status",
        description="Get the current status of the real-time streaming service"
    )
    @action(detail=False, methods=['get'], url_path='sse/status')
    def sse_status(self, request):
        """Get SSE/WebSocket service status and statistics."""
        from channels.layers import get_channel_layer

        aircraft_list = cache.get("current_aircraft", [])

        # Try to get channel layer stats
        channel_layer = get_channel_layer()
        redis_enabled = channel_layer is not None

        # Get subscriber count from cache (updated by consumers)
        subscriber_count = cache.get("websocket_subscribers", 0)
        aircraft_consumers = cache.get("aircraft_consumer_count", 0)
        safety_consumers = cache.get("safety_consumer_count", 0)
        acars_consumers = cache.get("acars_consumer_count", 0)

        # Get last broadcast time
        last_broadcast = cache.get("last_aircraft_broadcast")

        return Response({
            'mode': 'redis' if redis_enabled else 'memory',
            'redis_enabled': redis_enabled,
            'subscribers': subscriber_count,
            'subscribers_by_type': {
                'aircraft': aircraft_consumers,
                'safety': safety_consumers,
                'acars': acars_consumers,
            },
            'tracked_aircraft': len(aircraft_list),
            'last_publish': last_broadcast,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })
