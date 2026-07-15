"""
Watch list API views.
"""

import logging

from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import FeatureBasedPermission
from skyspy.models.watch_list import WatchedAircraft
from skyspy.serializers.watch_list import WatchedAircraftSerializer, WatchListImportSerializer

logger = logging.getLogger(__name__)


class WatchListViewSet(viewsets.ViewSet):
    """ViewSet for aircraft watch list management.

    Reads follow AUTH_MODE (public in public/hybrid mode); writes
    (create/destroy/import/clear) require authentication outside public mode
    via FeatureBasedPermission (mapped to the 'aircraft' feature).
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @extend_schema(
        summary="List watched aircraft",
        description="Get all aircraft on the watch list",
        responses={200: WatchedAircraftSerializer(many=True)},
    )
    def list(self, request):
        """List all watched aircraft."""
        queryset = WatchedAircraft.objects.all()
        serializer = WatchedAircraftSerializer(queryset, many=True)
        return Response({"watchList": serializer.data, "count": queryset.count()})

    @extend_schema(
        summary="Add aircraft to watch list",
        description="Add a new aircraft to the watch list",
        request=WatchedAircraftSerializer,
        responses={201: WatchedAircraftSerializer},
    )
    def create(self, request):
        """Add an aircraft to the watch list."""
        hex_code = request.data.get("hex", "").upper().strip()
        if not hex_code:
            return Response({"error": "hex is required"}, status=status.HTTP_400_BAD_REQUEST)

        # Upsert - update if exists, create if not
        obj, created = WatchedAircraft.objects.update_or_create(
            hex=hex_code,
            defaults={
                "callsign": request.data.get("callsign", "").strip(),
                "registration": request.data.get("registration", "").strip(),
                "type_code": request.data.get("type_code", "").strip(),
                "notes": request.data.get("notes", "").strip(),
            },
        )

        serializer = WatchedAircraftSerializer(obj)
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @extend_schema(
        summary="Remove aircraft from watch list",
        description="Remove an aircraft from the watch list by hex code",
    )
    def destroy(self, request, pk=None):
        """Remove an aircraft from the watch list by hex code."""
        hex_code = pk.upper().strip() if pk else None
        if not hex_code:
            return Response({"error": "hex is required"}, status=status.HTTP_400_BAD_REQUEST)

        deleted, _ = WatchedAircraft.objects.filter(hex=hex_code).delete()
        if deleted:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response({"error": "Aircraft not found in watch list"}, status=status.HTTP_404_NOT_FOUND)

    @extend_schema(
        summary="Import watch list",
        description="Bulk import aircraft to the watch list",
        request=WatchListImportSerializer,
    )
    @action(detail=False, methods=["post"], url_path="import")
    def import_list(self, request):
        """Bulk import aircraft to watch list."""
        items = request.data.get("watchList", [])
        if not isinstance(items, list):
            return Response({"error": "watchList must be an array"}, status=status.HTTP_400_BAD_REQUEST)

        added = 0
        updated = 0
        for item in items:
            hex_code = (item.get("hex") or "").upper().strip()
            if not hex_code:
                continue

            _, created = WatchedAircraft.objects.update_or_create(
                hex=hex_code,
                defaults={
                    "callsign": (item.get("callsign") or "").strip(),
                    "registration": (item.get("registration") or "").strip(),
                    "type_code": (item.get("type_code") or item.get("type") or "").strip(),
                    "notes": (item.get("notes") or "").strip(),
                },
            )
            if created:
                added += 1
            else:
                updated += 1

        return Response({"added": added, "updated": updated, "total": WatchedAircraft.objects.count()})

    @extend_schema(
        summary="Export watch list",
        description="Export all watched aircraft as JSON",
    )
    @action(detail=False, methods=["get"], url_path="export")
    def export_list(self, request):
        """Export watch list as JSON."""
        from django.utils import timezone

        queryset = WatchedAircraft.objects.all()
        serializer = WatchedAircraftSerializer(queryset, many=True)
        return Response(
            {
                "version": 1,
                "exported": timezone.now().isoformat().replace("+00:00", "Z"),
                "watchList": serializer.data,
                "count": queryset.count(),
            }
        )

    @extend_schema(
        summary="Clear watch list",
        description="Remove all aircraft from the watch list",
    )
    @action(detail=False, methods=["delete"], url_path="clear")
    def clear_list(self, request):
        """Clear the entire watch list."""
        deleted, _ = WatchedAircraft.objects.all().delete()
        return Response({"deleted": deleted})
