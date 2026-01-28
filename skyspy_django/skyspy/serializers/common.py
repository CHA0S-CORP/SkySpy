"""
Common serializers used across multiple endpoints.
"""
from rest_framework import serializers


class SuccessResponseSerializer(serializers.Serializer):
    """Generic success response."""

    success = serializers.BooleanField(default=True, help_text="Operation success status")
    message = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Optional message"
    )


class DeleteResponseSerializer(serializers.Serializer):
    """Response for delete operations."""

    deleted = serializers.IntegerField(help_text="Number of items deleted")
    message = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Additional information"
    )


class ErrorResponseSerializer(serializers.Serializer):
    """Error response."""

    error = serializers.CharField(help_text="Error type")
    detail = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Error details"
    )


class GeoJSONGeometrySerializer(serializers.Serializer):
    """GeoJSON geometry object."""

    type = serializers.CharField(help_text="Geometry type")
    coordinates = serializers.ListField(help_text="Coordinate array [lon, lat]")


class GeoJSONFeatureSerializer(serializers.Serializer):
    """GeoJSON Feature for a single aircraft."""

    type = serializers.CharField(default="Feature", help_text="GeoJSON type")
    id = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Feature ID (ICAO hex)"
    )
    geometry = GeoJSONGeometrySerializer(
        required=False,
        allow_null=True,
        help_text="Point geometry"
    )
    properties = serializers.DictField(help_text="Aircraft properties")


class GeoJSONFeatureCollectionSerializer(serializers.Serializer):
    """GeoJSON FeatureCollection containing all aircraft."""

    type = serializers.CharField(default="FeatureCollection", help_text="GeoJSON type")
    features = GeoJSONFeatureSerializer(many=True, help_text="Aircraft features")
    metadata = serializers.DictField(help_text="Collection metadata")


class PaginatedResponseSerializer(serializers.Serializer):
    """Base class for paginated responses."""

    count = serializers.IntegerField(help_text="Total count")
    next = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Next page URL"
    )
    previous = serializers.CharField(
        required=False,
        allow_null=True,
        help_text="Previous page URL"
    )
    results = serializers.ListField(help_text="Page results")
