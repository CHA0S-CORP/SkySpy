"""
Watch list serializers.
"""

from rest_framework import serializers

from skyspy.models.watch_list import WatchedAircraft


class WatchedAircraftSerializer(serializers.ModelSerializer):
    class Meta:
        model = WatchedAircraft
        fields = ["id", "hex", "callsign", "registration", "type_code", "notes", "added_at"]
        read_only_fields = ["id", "added_at"]


class WatchListImportSerializer(serializers.Serializer):
    """Serializer for bulk import."""

    watchList = serializers.ListField(child=serializers.DictField(), required=True)
