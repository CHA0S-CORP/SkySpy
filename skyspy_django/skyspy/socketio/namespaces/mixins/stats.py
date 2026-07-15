"""Statistics and analytics handlers for MainNamespace.

Covers history stats/trends/sessions, distance/speed/correlation analytics,
antenna analytics, ACARS stats, and extended stats (flight patterns,
geographic, tracking quality, engagement, favorites, time comparison).
"""

import logging
import statistics as stats_lib
from datetime import datetime, timedelta

from asgiref.sync import sync_to_async
from django.db.models import Avg, Case, CharField, Count, F, Max, Min, Value, When
from django.db.models.functions import ExtractHour, Floor, TruncHour
from django.utils import timezone

from skyspy.socketio.namespaces.mixins import parse_int_param

logger = logging.getLogger(__name__)


class StatsHandlerMixin:
    """History, analytics, antenna, ACARS, and extended stats handlers."""

    # -----------------------------------------------------------------
    # Thin handler methods (route → data access)
    # -----------------------------------------------------------------

    async def _handle_history_stats(self, params: dict):
        """Get history statistics."""
        return await self._get_history_stats(params)

    async def _handle_history_trends(self, params: dict):
        """Get traffic trends."""
        return await self._get_history_trends(params)

    async def _handle_history_top(self, params: dict):
        """Get top performers."""
        return await self._get_history_top(params)

    async def _handle_history_sessions(self, params: dict):
        """Get aircraft sessions."""
        return await self._get_history_sessions(params)

    async def _handle_distance_analytics(self, params: dict):
        """Get distance analytics."""
        return await self._get_distance_analytics(params)

    async def _handle_speed_analytics(self, params: dict):
        """Get speed analytics."""
        return await self._get_speed_analytics(params)

    async def _handle_correlation_analytics(self, params: dict):
        """Get correlation analytics."""
        return await self._get_correlation_analytics(params)

    async def _handle_antenna_polar(self, params: dict):
        """Get antenna polar coverage."""
        return await self._get_antenna_polar(params)

    async def _handle_antenna_rssi(self, params: dict):
        """Get RSSI vs distance data."""
        return await self._get_antenna_rssi(params)

    async def _handle_antenna_summary(self, params: dict):
        """Get antenna performance summary."""
        return await self._get_antenna_summary(params)

    async def _handle_antenna_analytics(self, params: dict):
        """Get all antenna analytics data."""
        return await self._get_antenna_analytics(params)

    async def _handle_acars_stats(self, params: dict):
        """Get ACARS statistics."""
        return await self._get_acars_stats()

    async def _handle_acars_snapshot(self, params: dict):
        """Get ACARS messages snapshot."""
        return await self._get_acars_snapshot(params)

    async def _handle_flight_patterns(self, params: dict):
        """Get flight pattern statistics."""
        return await self._get_flight_patterns(params)

    async def _handle_geographic_stats(self, params: dict):
        """Get geographic statistics."""
        return await self._get_geographic_stats(params)

    async def _handle_tracking_quality(self, params: dict):
        """Get tracking quality metrics."""
        return await self._get_tracking_quality(params)

    async def _handle_engagement_stats(self, params: dict):
        """Get engagement statistics."""
        return await self._get_engagement_stats(params)

    async def _handle_favorites_stats(self, params: dict):
        """Get favorites statistics."""
        return await self._get_favorites_stats(params)

    async def _handle_time_comparison(self, params: dict):
        """Get time comparison statistics."""
        return await self._get_time_comparison(params)

    # -----------------------------------------------------------------
    # Data access — history stats
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_history_stats(self, params: dict):
        """Get history statistics."""
        from skyspy.models import AircraftSighting

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        military_only = params.get("military_only", False)

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = AircraftSighting.objects.filter(timestamp__gte=cutoff)

        if military_only:
            queryset = queryset.filter(is_military=True)

        stats = queryset.aggregate(
            total_sightings=Count("id"),
            unique_aircraft=Count("icao_hex", distinct=True),
            avg_altitude=Avg("altitude_baro"),
            max_altitude=Max("altitude_baro"),
            avg_distance=Avg("distance_nm"),
            max_distance=Max("distance_nm"),
        )

        return {**stats, "hours": hours, "timestamp": datetime.utcnow().isoformat() + "Z"}

    @sync_to_async
    def _get_history_trends(self, params: dict):
        """Get traffic trends."""
        from skyspy.models import AircraftSighting

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        military_only = params.get("military_only", False)

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = AircraftSighting.objects.filter(timestamp__gte=cutoff)

        if military_only:
            queryset = queryset.filter(is_military=True)

        hourly = list(
            queryset.annotate(hour=TruncHour("timestamp"))
            .values("hour")
            .annotate(count=Count("id"), unique_aircraft=Count("icao_hex", distinct=True))
            .order_by("hour")
        )

        return {"hourly": hourly, "hours": hours, "timestamp": datetime.utcnow().isoformat() + "Z"}

    @sync_to_async
    def _get_history_top(self, params: dict):
        """Get top performers."""
        from skyspy.models import AircraftSession

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        limit = parse_int_param(params.get("limit"), 10, min_val=1, max_val=50)

        cutoff = timezone.now() - timedelta(hours=hours)
        sessions = AircraftSession.objects.filter(last_seen__gte=cutoff)

        longest = [
            {
                **row,
                # datetimes must be serialized - the payload goes straight to JSON
                "first_seen": row["first_seen"].isoformat().replace("+00:00", "Z") if row["first_seen"] else None,
                "last_seen": row["last_seen"].isoformat().replace("+00:00", "Z") if row["last_seen"] else None,
            }
            for row in sessions.order_by("-total_positions")[:limit].values(
                "icao_hex", "callsign", "total_positions", "first_seen", "last_seen"
            )
        ]

        furthest = list(
            sessions.filter(max_distance_nm__isnull=False)
            .order_by("-max_distance_nm")[:limit]
            .values("icao_hex", "callsign", "max_distance_nm")
        )

        highest = list(
            sessions.filter(max_altitude__isnull=False)
            .order_by("-max_altitude")[:limit]
            .values("icao_hex", "callsign", "max_altitude")
        )

        return {"longest": longest, "furthest": furthest, "highest": highest, "hours": hours, "limit": limit}

    @sync_to_async
    def _get_history_sessions(self, params: dict):
        """Get aircraft sessions."""
        from django.db.models import Count

        from skyspy.models import AircraftSession, SafetyEvent

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        limit = parse_int_param(params.get("limit"), 50, min_val=1, max_val=200)
        icao_hex = params.get("icao_hex")

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = AircraftSession.objects.filter(last_seen__gte=cutoff)

        if icao_hex:
            queryset = queryset.filter(icao_hex=icao_hex.upper())

        safety_counts = {}
        safety_events = SafetyEvent.objects.filter(timestamp__gte=cutoff).values("icao_hex").annotate(count=Count("id"))
        for item in safety_events:
            if item["icao_hex"]:
                safety_counts[item["icao_hex"]] = item["count"]

        raw_sessions = list(
            queryset.order_by("-last_seen")[:limit].values(
                "id",
                "icao_hex",
                "callsign",
                "first_seen",
                "last_seen",
                "total_positions",
                "min_altitude",
                "max_altitude",
                "min_distance_nm",
                "max_distance_nm",
                "max_vertical_rate",
                "min_rssi",
                "max_rssi",
                "is_military",
                "aircraft_type",
            )
        )

        sessions = []
        for s in raw_sessions:
            duration_min = 0.0
            if s["first_seen"] and s["last_seen"]:
                delta = s["last_seen"] - s["first_seen"]
                duration_min = round(delta.total_seconds() / 60, 1)

            sessions.append(
                {
                    "id": s["id"],
                    "icao_hex": s["icao_hex"],
                    "callsign": s["callsign"],
                    "first_seen": s["first_seen"].isoformat() if s["first_seen"] else None,
                    "last_seen": s["last_seen"].isoformat() if s["last_seen"] else None,
                    "duration_min": duration_min,
                    "message_count": s["total_positions"],
                    "min_distance_nm": s["min_distance_nm"],
                    "max_distance_nm": s["max_distance_nm"],
                    "min_alt": s["min_altitude"],
                    "max_alt": s["max_altitude"],
                    "max_vr": s["max_vertical_rate"],
                    "min_rssi": s["min_rssi"],
                    "max_rssi": s["max_rssi"],
                    "is_military": s["is_military"],
                    "type": s["aircraft_type"],
                    "safety_event_count": safety_counts.get(s["icao_hex"], 0),
                }
            )

        return {"sessions": sessions, "count": len(sessions), "hours": hours}

    # -----------------------------------------------------------------
    # Data access — distance / speed / correlation analytics
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_distance_analytics(self, params: dict):
        """Get distance analytics."""
        from skyspy.models import AircraftSession

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sessions = AircraftSession.objects.filter(last_seen__gte=cutoff, max_distance_nm__isnull=False)

        distances = list(sessions.values_list("max_distance_nm", flat=True))

        distribution = {
            "0-25nm": sum(1 for d in distances if d < 25),
            "25-50nm": sum(1 for d in distances if 25 <= d < 50),
            "50-100nm": sum(1 for d in distances if 50 <= d < 100),
            "100-150nm": sum(1 for d in distances if 100 <= d < 150),
            "150-200nm": sum(1 for d in distances if 150 <= d < 200),
            "200+nm": sum(1 for d in distances if d >= 200),
        }

        statistics = {}
        if distances:
            statistics = {
                "count": len(distances),
                "mean_nm": round(stats_lib.mean(distances), 1),
                "median_nm": round(stats_lib.median(distances), 1),
                "max_nm": round(max(distances), 1),
            }

        return {"distribution": distribution, "statistics": statistics, "hours": hours}

    @sync_to_async
    def _get_speed_analytics(self, params: dict):
        """Get speed analytics."""
        from skyspy.models import AircraftSighting

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff, ground_speed__isnull=False, ground_speed__gt=0
        )

        speeds = list(sightings.values_list("ground_speed", flat=True)[:1000])

        distribution = {
            "0-100kt": sum(1 for s in speeds if s < 100),
            "100-200kt": sum(1 for s in speeds if 100 <= s < 200),
            "200-300kt": sum(1 for s in speeds if 200 <= s < 300),
            "300-400kt": sum(1 for s in speeds if 300 <= s < 400),
            "400-500kt": sum(1 for s in speeds if 400 <= s < 500),
            "500+kt": sum(1 for s in speeds if s >= 500),
        }

        statistics = {}
        if speeds:
            statistics = {
                "count": len(speeds),
                "mean_kt": round(stats_lib.mean(speeds)),
                "median_kt": round(stats_lib.median(speeds)),
                "max_kt": round(max(speeds)),
            }

        return {"distribution": distribution, "statistics": statistics, "hours": hours}

    @sync_to_async
    def _get_correlation_analytics(self, params: dict):
        """Get correlation analytics."""
        from skyspy.models import AircraftSighting

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(timestamp__gte=cutoff)

        altitude_bands = (
            sightings.filter(altitude_baro__isnull=False, ground_speed__isnull=False)
            .annotate(
                altitude_band=Case(
                    When(altitude_baro__lt=10000, then=Value("0-10k")),
                    When(altitude_baro__lt=20000, then=Value("10-20k")),
                    When(altitude_baro__lt=30000, then=Value("20-30k")),
                    When(altitude_baro__lt=40000, then=Value("30-40k")),
                    default=Value("40k+"),
                    output_field=CharField(),
                )
            )
            .values("altitude_band")
            .annotate(avg_speed=Avg("ground_speed"), sample_count=Count("id"))
        )

        altitude_vs_speed = [
            {
                "altitude_band": row["altitude_band"],
                "avg_speed": round(row["avg_speed"]) if row["avg_speed"] else None,
                "sample_count": row["sample_count"],
            }
            for row in altitude_bands
        ]

        hourly = (
            sightings.annotate(hour=ExtractHour("timestamp"))
            .values("hour")
            .annotate(unique_aircraft=Count("icao_hex", distinct=True), position_count=Count("id"))
            .order_by("hour")
        )

        time_patterns = list(hourly)

        return {"altitude_vs_speed": altitude_vs_speed, "time_of_day_patterns": time_patterns, "hours": hours}

    # -----------------------------------------------------------------
    # Data access — antenna analytics
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_antenna_polar(self, params: dict):
        """Get antenna polar coverage data."""
        from skyspy.models import AircraftSighting

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff, track__isnull=False, distance_nm__isnull=False
        )

        bearing_data_raw = (
            sightings.annotate(bearing_sector=Floor(F("track") / 10) * 10)
            .values("bearing_sector")
            .annotate(
                count=Count("id"),
                avg_distance=Avg("distance_nm"),
                max_distance=Max("distance_nm"),
                unique_aircraft=Count("icao_hex", distinct=True),
            )
            .order_by("bearing_sector")
        )

        bearing_data = []
        for row in bearing_data_raw:
            sector = int(row["bearing_sector"]) if row["bearing_sector"] else 0
            bearing_data.append(
                {
                    "bearing_start": sector,
                    "bearing_end": (sector + 10) % 360,
                    "count": row["count"] or 0,
                    "avg_distance_nm": round(row["avg_distance"], 1) if row["avg_distance"] else None,
                    "max_distance_nm": round(row["max_distance"], 1) if row["max_distance"] else None,
                    "unique_aircraft": row["unique_aircraft"] or 0,
                }
            )

        return {"bearing_data": bearing_data, "hours": hours}

    @sync_to_async
    def _get_antenna_rssi(self, params: dict):
        """Get RSSI vs distance data."""
        from skyspy.models import AircraftSighting

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        sample_size = parse_int_param(params.get("sample_size"), 500, min_val=1, max_val=1000)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff, rssi__isnull=False, distance_nm__isnull=False, distance_nm__gt=0
        )

        scatter_data = list(
            sightings.order_by("-timestamp").values("distance_nm", "rssi", "altitude_baro", "icao_hex")[:sample_size]
        )

        scatter_result = [
            {
                "distance_nm": round(row["distance_nm"], 1),
                "rssi": round(row["rssi"], 1),
                "altitude": row["altitude_baro"],
                "icao": row["icao_hex"],
            }
            for row in scatter_data
        ]

        return {"scatter_data": scatter_result, "sample_size": len(scatter_result), "hours": hours}

    @sync_to_async
    def _get_antenna_summary(self, params: dict):
        """Get antenna performance summary."""
        from skyspy.models import AircraftSighting

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(timestamp__gte=cutoff, distance_nm__isnull=False)

        range_stats = sightings.aggregate(
            total_sightings=Count("id"),
            unique_aircraft=Count("icao_hex", distinct=True),
            avg_distance=Avg("distance_nm"),
            max_distance=Max("distance_nm"),
            min_distance=Min("distance_nm"),
        )

        rssi_stats = sightings.filter(rssi__isnull=False).aggregate(
            avg_rssi=Avg("rssi"), min_rssi=Min("rssi"), max_rssi=Max("rssi")
        )

        return {
            "range": {
                "total_sightings": range_stats["total_sightings"] or 0,
                "unique_aircraft": range_stats["unique_aircraft"] or 0,
                "avg_nm": round(range_stats["avg_distance"], 1) if range_stats["avg_distance"] else None,
                "max_nm": round(range_stats["max_distance"], 1) if range_stats["max_distance"] else None,
            },
            "signal": {
                "avg_rssi": round(rssi_stats["avg_rssi"], 1) if rssi_stats["avg_rssi"] else None,
                "best_rssi": round(rssi_stats["max_rssi"], 1) if rssi_stats["max_rssi"] else None,
                "worst_rssi": round(rssi_stats["min_rssi"], 1) if rssi_stats["min_rssi"] else None,
            },
            "hours": hours,
        }

    async def _get_antenna_analytics(self, params: dict):
        """Get all antenna analytics combined."""
        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)

        polar_data = await self._get_polar_sync(hours)
        rssi_data = await self._get_rssi_sync(hours)
        summary_data = await self._get_summary_sync(hours)

        return {"polar": polar_data, "rssi": rssi_data, "summary": summary_data, "hours": hours}

    @sync_to_async
    def _get_polar_sync(self, hours):
        """Synchronous polar data fetch."""
        from skyspy.models import AircraftSighting

        cutoff = timezone.now() - timedelta(hours=hours)
        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff, track__isnull=False, distance_nm__isnull=False
        )
        return list(
            sightings.annotate(bearing_sector=Floor(F("track") / 10) * 10)
            .values("bearing_sector")
            .annotate(count=Count("id"), max_distance=Max("distance_nm"))
        )

    @sync_to_async
    def _get_rssi_sync(self, hours):
        """Synchronous RSSI data fetch."""
        from skyspy.models import AircraftSighting

        cutoff = timezone.now() - timedelta(hours=hours)
        return list(
            AircraftSighting.objects.filter(timestamp__gte=cutoff, rssi__isnull=False, distance_nm__isnull=False)
            .order_by("-timestamp")
            .values("distance_nm", "rssi")[:200]
        )

    @sync_to_async
    def _get_summary_sync(self, hours):
        """Synchronous summary data fetch."""
        from skyspy.models import AircraftSighting

        cutoff = timezone.now() - timedelta(hours=hours)
        return AircraftSighting.objects.filter(timestamp__gte=cutoff).aggregate(
            total=Count("id"), max_range=Max("distance_nm"), avg_rssi=Avg("rssi")
        )

    # -----------------------------------------------------------------
    # Data access — ACARS
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_acars_stats(self):
        """Get ACARS statistics."""
        from skyspy.models import AcarsMessage

        cutoff = timezone.now() - timedelta(hours=24)
        messages = AcarsMessage.objects.filter(timestamp__gte=cutoff)
        total = messages.count()

        by_label = dict(messages.values("label").annotate(count=Count("id")).values_list("label", "count")[:20])

        return {
            "total_24h": total,
            "by_label": by_label,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    @sync_to_async
    def _get_acars_snapshot(self, params: dict):
        """Get recent ACARS messages."""
        from skyspy.models import AcarsMessage

        hours = parse_int_param(params.get("hours"), 1, min_val=1, max_val=24)
        limit = parse_int_param(params.get("limit"), 50, min_val=1, max_val=200)

        cutoff = timezone.now() - timedelta(hours=hours)

        messages = []
        for msg in AcarsMessage.objects.filter(timestamp__gte=cutoff).order_by("-timestamp")[:limit]:
            messages.append(
                {
                    "id": msg.id,
                    "timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
                    "icao_hex": msg.icao_hex,
                    "callsign": msg.callsign,
                    "registration": msg.registration,
                    "label": msg.label,
                    "text": msg.text,
                    "mode": msg.mode,
                    "block_id": msg.block_id,
                }
            )

        return {"messages": messages, "count": len(messages)}

    # -----------------------------------------------------------------
    # Data access — extended stats
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_flight_patterns(self, params: dict):
        """Get flight pattern statistics from cache or calculate."""
        from skyspy.services.stats_cache import get_flight_patterns_stats

        return get_flight_patterns_stats() or {}

    @sync_to_async
    def _get_geographic_stats(self, params: dict):
        """Get geographic statistics from cache or calculate."""
        from skyspy.services.stats_cache import get_geographic_stats

        return get_geographic_stats() or {}

    @sync_to_async
    def _get_tracking_quality(self, params: dict):
        """Get tracking quality metrics from cache or calculate."""
        from skyspy.services.stats_cache import get_tracking_quality_stats

        return get_tracking_quality_stats() or {}

    @sync_to_async
    def _get_engagement_stats(self, params: dict):
        """Get engagement statistics from cache or calculate."""
        from skyspy.services.stats_cache import get_engagement_stats

        return get_engagement_stats() or {}

    @sync_to_async
    def _get_favorites_stats(self, params: dict):
        """Get favorites statistics."""
        from skyspy.models import AircraftFavorite

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        favorites = (
            AircraftFavorite.objects.filter(created_at__gte=cutoff).select_related("user").order_by("-created_at")[:50]
        )

        return {
            "favorites": [
                {
                    "icao_hex": f.icao_hex,
                    "nickname": f.nickname,
                    "created_at": f.created_at.isoformat() if f.created_at else None,
                }
                for f in favorites
            ],
            "count": favorites.count() if hasattr(favorites, "count") else len(favorites),
            "hours": hours,
        }

    @sync_to_async
    def _get_time_comparison(self, params: dict):
        """Get time comparison statistics."""
        from skyspy.services.time_comparison_stats import get_all_time_comparison_stats

        return get_all_time_comparison_stats() or {}
