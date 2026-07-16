"""Aircraft data handlers for MainNamespace."""

import logging
from datetime import datetime, timedelta

from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError
from django.utils import timezone

from skyspy.socketio.namespaces.mixins import parse_int_param

logger = logging.getLogger(__name__)


def _numeric_altitude(ac: dict) -> int:
    """Best-effort numeric altitude in ft; readsb reports "ground" for on-ground."""
    for key in ("alt_baro", "alt", "alt_geom"):
        alt = ac.get(key)
        if isinstance(alt, (int, float)):
            return int(alt)
        if alt == "ground":
            return 0
    return 0


class AircraftHandlerMixin:
    """Aircraft lookup, listing, stats, sightings, and photo handlers."""

    async def _handle_aircraft(self, params: dict):
        """Return single aircraft by ICAO."""
        icao = params.get("icao") or params.get("hex")
        if not icao:
            raise ValueError("Missing icao parameter")
        return await self._get_aircraft_by_icao(icao)

    async def _handle_aircraft_snapshot(self, params: dict):
        """Return current aircraft snapshot."""
        aircraft_list = await self._get_current_aircraft()
        return {"aircraft": aircraft_list, "count": len(aircraft_list), "timestamp": timezone.now().isoformat()}

    async def _handle_aircraft_list(self, params: dict):
        """Return list of aircraft with optional filters."""
        return await self._get_aircraft_list(params)

    async def _handle_aircraft_info(self, params: dict):
        """Get detailed aircraft info."""
        icao = params.get("icao") or params.get("hex")
        if not icao:
            raise ValueError("Missing icao parameter")
        return await self._get_aircraft_info(icao)

    async def _handle_aircraft_info_bulk(self, params: dict):
        """Get detailed aircraft info for multiple ICAOs."""
        icaos = params.get("icaos", [])
        if not icaos or not isinstance(icaos, list):
            raise ValueError("Missing or invalid icaos parameter (expected list)")
        return await self._get_aircraft_info_bulk(icaos)

    async def _handle_aircraft_stats(self, params: dict):
        """Get live aircraft statistics."""
        return await self._get_aircraft_stats()

    async def _handle_aircraft_top(self, params: dict):
        """Get top aircraft by category."""
        return await self._get_top_aircraft()

    async def _handle_sightings(self, params: dict):
        """Get historical sightings."""
        return await self._get_sightings(params)

    async def _handle_photo(self, params: dict):
        """Get aircraft photo URL."""
        icao = params.get("icao") or params.get("hex")
        if not icao:
            raise ValueError("Missing icao parameter")
        return await self._get_aircraft_photo(icao, params)

    # -----------------------------------------------------------------
    # Data access
    # -----------------------------------------------------------------

    @sync_to_async
    def _get_current_aircraft(self):
        """Get current tracked aircraft from cache."""
        cached = cache.get("current_aircraft")
        if cached:
            return cached
        return []

    @sync_to_async
    def _get_aircraft_by_icao(self, icao: str):
        """Get single aircraft by ICAO hex code."""
        cached = cache.get("current_aircraft")
        if cached:
            for ac in cached:
                if ac.get("hex") == icao or ac.get("icao_hex") == icao:
                    return ac
        return None

    @sync_to_async
    def _get_aircraft_list(self, filters: dict):
        """Get filtered aircraft list."""
        cached = cache.get("current_aircraft")
        if not cached:
            return []

        military_only = filters.get("military_only")
        category = filters.get("category")
        min_alt = filters.get("min_altitude")
        max_alt = filters.get("max_altitude")

        if not any([military_only, category, min_alt is not None, max_alt is not None]):
            return cached

        def matches(ac):
            # Aircraft cache writers set "military" (see tasks/aircraft.py)
            if military_only and not ac.get("military"):
                return False
            if category and ac.get("category") != category:
                return False
            alt = ac.get("alt_baro") or 0
            if min_alt is not None and alt < min_alt:
                return False
            return not (max_alt is not None and alt > max_alt)

        return [ac for ac in cached if matches(ac)]

    @sync_to_async
    def _get_aircraft_info(self, icao: str):
        """Get detailed aircraft info from database."""
        from skyspy.models import AircraftInfo

        try:
            info = AircraftInfo.objects.get(icao_hex=icao.upper())
            return {
                "icao_hex": info.icao_hex,
                "registration": info.registration,
                "type_code": info.type_code,
                "manufacturer": info.manufacturer,
                "model": info.model,
                "operator": info.operator,
                "operator_icao": info.operator_icao,
                "owner": info.owner,
                "year_built": info.year_built,
                "serial_number": info.serial_number,
                "country": info.country,
                "category": info.category,
                "is_military": info.is_military,
                "photo_url": info.photo_url,
                "photo_photographer": info.photo_photographer,
                "source": info.source,
            }
        except AircraftInfo.DoesNotExist:
            return None

    @sync_to_async
    def _get_aircraft_info_bulk(self, icaos: list):
        """Get detailed aircraft info for multiple ICAOs."""
        from skyspy.models import AircraftInfo

        icaos = (icaos or [])[:100]
        icao_list = [i.upper().strip() for i in icaos if i and not i.startswith("~")]
        if not icao_list:
            return {"aircraft": {}, "found": 0, "requested": 0}

        infos = AircraftInfo.objects.filter(icao_hex__in=icao_list).values(
            "icao_hex",
            "registration",
            "type_code",
            "manufacturer",
            "model",
            "operator",
            "operator_icao",
            "owner",
            "year_built",
            "serial_number",
            "country",
            "category",
            "is_military",
            "photo_url",
            "photo_photographer",
            "source",
        )

        result = {info["icao_hex"]: info for info in infos}

        return {"aircraft": result, "found": len(result), "requested": len(icao_list)}

    @sync_to_async
    def _get_aircraft_stats(self):
        """Get live aircraft statistics."""
        cached = cache.get("current_aircraft", [])

        military = sum(1 for ac in cached if ac.get("military"))
        emergency = sum(1 for ac in cached if ac.get("emergency"))

        categories = {}
        for ac in cached:
            cat = ac.get("category", "Unknown")
            categories[cat] = categories.get(cat, 0) + 1

        altitude_bands = {"ground": 0, "low": 0, "medium": 0, "high": 0}
        for ac in cached:
            alt = _numeric_altitude(ac)
            if alt < 500:
                altitude_bands["ground"] += 1
            elif alt < 10000:
                altitude_bands["low"] += 1
            elif alt < 30000:
                altitude_bands["medium"] += 1
            else:
                altitude_bands["high"] += 1

        return {
            "total": len(cached),
            "with_position": sum(1 for ac in cached if ac.get("lat")),
            "military": military,
            "emergency": emergency,
            "categories": categories,
            "altitude_bands": altitude_bands,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    @sync_to_async
    def _get_top_aircraft(self):
        """Get top 5 aircraft by various metrics."""
        cached = cache.get("current_aircraft", [])
        with_position = [ac for ac in cached if ac.get("lat") and ac.get("lon")]

        closest = sorted(
            [ac for ac in with_position if ac.get("distance_nm")], key=lambda x: x.get("distance_nm", 999)
        )[:5]

        fastest = sorted([ac for ac in with_position if ac.get("gs")], key=lambda x: x.get("gs", 0), reverse=True)[:5]

        highest = sorted(
            [ac for ac in with_position if ac.get("alt_baro") or ac.get("alt")],
            key=_numeric_altitude,
            reverse=True,
        )[:5]

        return {
            "closest": closest,
            "fastest": fastest,
            "highest": highest,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    @sync_to_async
    def _get_sightings(self, params: dict):
        """Get historical sightings."""
        from skyspy.models import AircraftSighting

        hours = parse_int_param(params.get("hours"), 24, min_val=1, max_val=720)
        limit = parse_int_param(params.get("limit"), 100, min_val=1, max_val=500)
        offset = parse_int_param(params.get("offset"), 0, min_val=0)
        icao_hex = params.get("icao_hex")
        callsign = params.get("callsign")

        cutoff = timezone.now() - timedelta(hours=hours)
        queryset = AircraftSighting.objects.filter(timestamp__gte=cutoff)

        if icao_hex:
            queryset = queryset.filter(icao_hex=icao_hex.upper())
        if callsign:
            queryset = queryset.filter(callsign__icontains=callsign)

        sightings_raw = list(
            queryset.order_by("-timestamp")[offset : offset + limit].values(
                "id",
                "timestamp",
                "icao_hex",
                "callsign",
                "latitude",
                "longitude",
                "altitude_baro",
                "ground_speed",
                "track",
                "vertical_rate",
                "distance_nm",
                "rssi",
                "is_military",
            )
        )

        sightings = [
            {
                "id": s["id"],
                "timestamp": s["timestamp"].isoformat() if s["timestamp"] else None,
                "icao_hex": s["icao_hex"],
                "callsign": s["callsign"],
                "lat": s["latitude"],
                "lon": s["longitude"],
                "altitude": s["altitude_baro"],
                "gs": s["ground_speed"],
                "track": s["track"],
                "vr": s["vertical_rate"],
                "distance_nm": s["distance_nm"],
                "rssi": s["rssi"],
                "is_military": s["is_military"],
            }
            for s in sightings_raw
        ]

        return {"sightings": sightings, "count": len(sightings), "hours": hours, "offset": offset, "limit": limit}

    async def _get_aircraft_photo(self, icao: str, params: dict):
        """Get aircraft photo URL."""
        icao = icao.upper()

        photo_url, thumbnail_url = await self._resolve_photo_urls(icao)
        photographer, source, page_link = await self._get_photo_attribution(icao)

        return {
            "icao": icao,
            "photo_url": photo_url,
            "photo_thumbnail_url": thumbnail_url,
            "photo_page_link": page_link,
            "photo_photographer": photographer,
            "photo_source": source,
        }

    # thread_sensitive=False: S3 existence checks are network-bound and must
    # not block Django's single shared sync thread. No ORM access here.
    @sync_to_async(thread_sensitive=False)
    def _resolve_photo_urls(self, icao: str):
        """Resolve cached photo/thumbnail URLs (S3 HEAD checks or filesystem)."""
        from pathlib import Path

        photo_url = None
        thumbnail_url = None

        if getattr(settings, "PHOTO_CACHE_ENABLED", False):
            if getattr(settings, "S3_ENABLED", False):
                from concurrent.futures import ThreadPoolExecutor

                from skyspy.services.photo_cache import get_photo_url as get_cached_url

                # Run the full + thumbnail existence checks concurrently. Each
                # is an independent Wasabi HEAD (~40-260ms cold); running them
                # serially doubled the resolve latency. The signed URL is
                # returned directly so the browser hits Wasabi without a
                # redundant 3rd HEAD + presign via PhotoServeView.
                def _resolve(is_thumbnail: bool):
                    return get_cached_url(icao, is_thumbnail=is_thumbnail, signed=True, verify_exists=True)

                with ThreadPoolExecutor(max_workers=2) as pool:
                    full_future = pool.submit(_resolve, False)
                    thumb_future = pool.submit(_resolve, True)
                    photo_url = full_future.result()
                    thumbnail_url = thumb_future.result()
            else:
                cache_dir = Path(settings.PHOTO_CACHE_DIR)
                photo_path = cache_dir / f"{icao}.jpg"
                thumb_path = cache_dir / f"{icao}_thumb.jpg"
                if photo_path.exists() and photo_path.stat().st_size > 0:
                    photo_url = f"/api/v1/photos/{icao}"
                if thumb_path.exists() and thumb_path.stat().st_size > 0:
                    thumbnail_url = f"/api/v1/photos/{icao}/thumb"

        return photo_url, thumbnail_url

    @sync_to_async
    def _get_photo_attribution(self, icao: str):
        """Get photo attribution details from the database (ORM access)."""
        from skyspy.models import AircraftInfo

        photographer = None
        source = None
        page_link = None

        try:
            info = AircraftInfo.objects.filter(icao_hex=icao).first()
            if info:
                photographer = info.photo_photographer
                source = info.photo_source
                page_link = info.photo_page_link
        except DatabaseError:
            pass

        return photographer, source, page_link
