"""
Aircraft tracking API views.
"""
import logging
from datetime import datetime

from django.conf import settings
from django.core.cache import cache
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import AircraftInfo
from skyspy.serializers.aircraft import (
    AircraftSerializer,
    AircraftListSerializer,
    TopAircraftSerializer,
    AircraftStatsSerializer,
)

logger = logging.getLogger(__name__)


class AircraftViewSet(viewsets.ViewSet):
    """
    ViewSet for live aircraft tracking.

    Provides real-time aircraft position data from ADS-B receivers.
    """

    @extend_schema(
        summary="List all aircraft",
        description="Get all currently tracked aircraft with their positions and metadata",
        responses={200: AircraftListSerializer}
    )
    def list(self, request):
        """List all currently tracked aircraft."""
        # Get aircraft from cache (populated by polling task)
        aircraft_list = cache.get("current_aircraft", [])
        now_timestamp = cache.get("aircraft_timestamp")
        messages = cache.get("aircraft_messages", 0)

        return Response({
            "aircraft": aircraft_list,
            "count": len(aircraft_list),
            "now": now_timestamp,
            "messages": messages,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })

    @extend_schema(
        summary="Get aircraft by ICAO hex",
        description="Get details for a specific aircraft by its ICAO hex code",
        parameters=[
            OpenApiParameter(
                name="hex_code",
                type=str,
                location=OpenApiParameter.PATH,
                description="ICAO 24-bit hex identifier"
            )
        ],
        responses={200: AircraftSerializer, 404: None}
    )
    def retrieve(self, request, pk=None):
        """Get a specific aircraft by ICAO hex code."""
        aircraft_list = cache.get("current_aircraft", [])

        # Find aircraft by hex code
        for ac in aircraft_list:
            if ac.get("hex") == pk or ac.get("icao_hex") == pk:
                return Response(ac)

        return Response(
            {"error": "Aircraft not found"},
            status=status.HTTP_404_NOT_FOUND
        )

    @extend_schema(
        summary="Get top aircraft",
        description="Get top aircraft by various categories (closest, highest, fastest, etc.)",
        parameters=[
            OpenApiParameter(
                name="limit",
                type=int,
                location=OpenApiParameter.QUERY,
                description="Number of aircraft per category",
                default=5
            )
        ],
        responses={200: TopAircraftSerializer}
    )
    @action(detail=False, methods=["get"])
    def top(self, request):
        """Get top aircraft by various categories."""
        limit = int(request.query_params.get("limit", 5))
        aircraft_list = cache.get("current_aircraft", [])

        # Filter aircraft with valid data
        with_position = [
            ac for ac in aircraft_list
            if ac.get("lat") is not None and ac.get("lon") is not None
        ]

        # Closest to feeder
        closest = sorted(
            [ac for ac in with_position if ac.get("distance_nm") is not None],
            key=lambda x: x.get("distance_nm", float("inf"))
        )[:limit]

        # Highest altitude
        highest = sorted(
            [ac for ac in with_position if ac.get("alt") is not None],
            key=lambda x: x.get("alt", 0),
            reverse=True
        )[:limit]

        # Fastest
        fastest = sorted(
            [ac for ac in with_position if ac.get("gs") is not None],
            key=lambda x: x.get("gs", 0),
            reverse=True
        )[:limit]

        # Highest climb rate
        climbing = sorted(
            [ac for ac in with_position if ac.get("vr") is not None and ac.get("vr", 0) > 0],
            key=lambda x: x.get("vr", 0),
            reverse=True
        )[:limit]

        # Military aircraft
        military = [
            ac for ac in with_position
            if ac.get("military", False)
        ][:limit]

        return Response({
            "closest": closest,
            "highest": highest,
            "fastest": fastest,
            "climbing": climbing,
            "military": military,
            "total": len(aircraft_list),
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })

    @extend_schema(
        summary="Get aircraft statistics",
        description="Get aggregate statistics for currently tracked aircraft",
        responses={200: AircraftStatsSerializer}
    )
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get aggregate statistics for tracked aircraft."""
        aircraft_list = cache.get("current_aircraft", [])
        messages = cache.get("aircraft_messages", 0)

        # Count aircraft with position
        with_position = sum(
            1 for ac in aircraft_list
            if ac.get("lat") is not None and ac.get("lon") is not None
        )

        # Count military
        military = sum(1 for ac in aircraft_list if ac.get("military", False))

        # Find emergency squawks
        emergency = [
            ac for ac in aircraft_list
            if ac.get("squawk") in ("7500", "7600", "7700")
        ]

        # Count by category
        categories = {}
        for ac in aircraft_list:
            cat = ac.get("category", "unknown")
            categories[cat] = categories.get(cat, 0) + 1

        # Count by altitude bands
        altitude_bands = {
            "ground": 0,
            "low": 0,      # < 10,000
            "medium": 0,   # 10,000 - 30,000
            "high": 0,     # > 30,000
        }
        for ac in aircraft_list:
            alt = ac.get("alt")
            if alt is None or alt < 100:
                altitude_bands["ground"] += 1
            elif alt < 10000:
                altitude_bands["low"] += 1
            elif alt < 30000:
                altitude_bands["medium"] += 1
            else:
                altitude_bands["high"] += 1

        return Response({
            "total": len(aircraft_list),
            "with_position": with_position,
            "military": military,
            "emergency": emergency,
            "categories": categories,
            "altitude": altitude_bands,
            "messages": messages,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })

    @extend_schema(
        summary="List UAT aircraft",
        description="Get aircraft from 978 MHz UAT receiver",
        responses={200: AircraftListSerializer}
    )
    @action(detail=False, methods=["get"], url_path="uat")
    def uat_list(self, request):
        """List aircraft from 978 MHz UAT source."""
        # Get UAT aircraft from cache
        aircraft_list = cache.get("uat_aircraft", [])
        now_timestamp = cache.get("uat_timestamp")

        return Response({
            "aircraft": aircraft_list,
            "count": len(aircraft_list),
            "now": now_timestamp,
            "messages": 0,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })
