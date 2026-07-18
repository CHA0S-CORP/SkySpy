"""
Airframe information API views.
"""

import logging

from django.conf import settings
from django.http import FileResponse, Http404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from kombu.exceptions import OperationalError as KombuOperationalError
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import FeatureBasedPermission
from skyspy.models import AircraftInfo
from skyspy.serializers.aircraft import (
    AircraftInfoCacheStatsSerializer,
    AircraftInfoSerializer,
    AircraftPhotoSerializer,
    BulkAircraftInfoSerializer,
)

logger = logging.getLogger(__name__)


class PhotoServeView(APIView):
    """Serve cached aircraft photos."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    def get(self, request, icao_hex, photo_type="full"):
        """
        Serve a cached photo by ICAO hex.

        photo_type: 'full' or 'thumb'
        """
        from pathlib import Path

        icao_hex = icao_hex.upper().strip()
        is_thumbnail = photo_type == "thumb"

        # S3-backed cache: stream the object through our own endpoint so the
        # browser always loads a same-origin URL (no redirect to a remote signed
        # URL, which is opaque/expires and reads as a broken image).
        if settings.S3_ENABLED:
            from django.http import HttpResponse

            from skyspy.services.photo_cache import get_photo_bytes

            data = get_photo_bytes(icao_hex, is_thumbnail=is_thumbnail)
            if not data:
                raise Http404("Photo not found")

            response = HttpResponse(data, content_type="image/jpeg")
            response["Cache-Control"] = "public, max-age=86400"  # 1 day cache
            return response

        # Local filesystem
        cache_dir = Path(settings.PHOTO_CACHE_DIR)
        suffix = "_thumb" if is_thumbnail else ""
        photo_path = cache_dir / f"{icao_hex}{suffix}.jpg"

        if not photo_path.exists() or photo_path.stat().st_size == 0:
            raise Http404("Photo not found")

        response = FileResponse(open(photo_path, "rb"), content_type="image/jpeg")  # noqa: SIM115
        response["Cache-Control"] = "public, max-age=86400"  # 1 day cache
        return response


class AirframeViewSet(viewsets.ViewSet):
    """ViewSet for aircraft information and photos."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    # Fields that make an AircraftInfo record "populated" (worth not retrying).
    _AIRFRAME_IDENTITY_FIELDS = ("registration", "type_code", "type_name", "manufacturer", "model", "operator", "owner")
    # Minimum gap between automatic background retries for a failed/empty lookup.
    _AIRFRAME_RETRY_COOLDOWN = 120  # seconds

    def _is_populated_airframe(self, info):
        """True when the record carries at least one meaningful identity field."""
        return any(getattr(info, f, None) for f in self._AIRFRAME_IDENTITY_FIELDS)

    def _requeue_airframe_fetch(self, icao):
        """Queue a background airframe fetch, rate-limited so polling can't spam it."""
        from django.core.cache import cache

        gate_key = f"airframe:refetch:{icao}"
        if not cache.add(gate_key, 1, self._AIRFRAME_RETRY_COOLDOWN):
            return False  # a retry was queued within the cooldown window
        try:
            from skyspy.tasks.external_db import fetch_aircraft_info

            fetch_aircraft_info.delay(icao)
            logger.debug(f"Queued aircraft info lookup for {icao}")
            return True
        except (ConnectionError, OSError, RuntimeError, KombuOperationalError) as e:
            logger.warning(f"Failed to queue aircraft info lookup for {icao}: {e}")
            cache.delete(gate_key)  # let the next poll retry immediately
            return False

    @extend_schema(
        summary="Get aircraft info by ICAO",
        parameters=[
            OpenApiParameter(name="icao", type=str, location=OpenApiParameter.PATH, description="ICAO hex code")
        ],
        responses={200: AircraftInfoSerializer, 404: None},
    )
    def retrieve(self, request, pk=None):
        """Get aircraft information by ICAO hex."""
        icao = pk.upper().strip().lstrip("~")
        try:
            info = AircraftInfo.objects.get(icao_hex__iexact=pk)
        except AircraftInfo.DoesNotExist:
            # No record yet — queue the initial lookup and report not-found.
            self._requeue_airframe_fetch(icao)
            return Response(
                {
                    "error": "Aircraft info not found",
                    "icao_hex": icao,
                    "status": "lookup_queued",
                    "message": "Aircraft info lookup has been queued. Try again shortly.",
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        # The record exists but the external lookup failed or came back empty. The
        # frontend polls this endpoint while the airframe is unpopulated, so re-queue
        # a fetch here (rate-limited) to periodically retry until it fills in.
        if info.fetch_failed or not self._is_populated_airframe(info):
            self._requeue_airframe_fetch(icao)

        return Response(AircraftInfoSerializer(info).data)

    @extend_schema(
        summary="Get aircraft photos",
        parameters=[
            OpenApiParameter(name="icao", type=str, location=OpenApiParameter.PATH, description="ICAO hex code")
        ],
        responses={200: AircraftPhotoSerializer},
    )
    @action(detail=True, methods=["get"])
    def photos(self, request, pk=None):
        """Get aircraft photos."""
        try:
            info = AircraftInfo.objects.get(icao_hex__iexact=pk)
            return Response(
                {
                    "icao_hex": info.icao_hex,
                    "photo_url": info.photo_url,
                    "thumbnail_url": info.photo_thumbnail_url,
                    "photographer": info.photo_photographer,
                    "source": info.photo_source,
                }
            )
        except AircraftInfo.DoesNotExist:
            return Response({"error": "Aircraft not found"}, status=status.HTTP_404_NOT_FOUND)

    @extend_schema(
        summary="Bulk aircraft info lookup",
        description="Get info for multiple aircraft at once",
        parameters=[
            OpenApiParameter(
                name="icao", type=str, location=OpenApiParameter.QUERY, description="Comma-separated ICAO hex codes"
            )
        ],
        responses={200: BulkAircraftInfoSerializer},
    )
    @action(detail=False, methods=["get"])
    def bulk(self, request):
        """Bulk lookup aircraft info."""
        icao_param = request.query_params.get("icao", "")
        icao_list = [i.strip().upper() for i in icao_param.split(",") if i.strip()]

        if not icao_list:
            return Response({"aircraft": {}, "found": 0, "requested": 0})

        # Limit to 100 aircraft
        icao_list = icao_list[:100]

        # Get cached info
        cached = AircraftInfo.objects.filter(icao_hex__in=icao_list)
        result = {}

        for info in cached:
            result[info.icao_hex] = AircraftInfoSerializer(info).data

        return Response({"aircraft": result, "found": len(result), "requested": len(icao_list)})

    @extend_schema(
        summary="Get aircraft by registration",
        parameters=[
            OpenApiParameter(
                name="registration",
                type=str,
                location=OpenApiParameter.PATH,
                description="Aircraft registration number",
            )
        ],
        responses={200: AircraftInfoSerializer, 404: None},
    )
    @action(detail=False, methods=["get"], url_path="registration/(?P<registration>[^/.]+)")
    def by_registration(self, request, registration=None):
        """Resolve a registration to airframe info (or at least an ICAO hex).

        Falls back to deriving the ICAO 24-bit address from a US N-number when
        the aircraft has never been seen by this receiver — otherwise the
        airframe page can't open for any tail we haven't previously cached.
        """
        try:
            info = AircraftInfo.objects.get(registration__iexact=registration)
            return Response(AircraftInfoSerializer(info).data)
        except AircraftInfo.DoesNotExist:
            pass

        # DB miss: US N-numbers map deterministically onto the ICAO A-block, so
        # we can still return a hex the client can open the airframe page with.
        from skyspy.services.nnumber import n_to_icao

        icao_hex = n_to_icao(registration)
        if icao_hex:
            return Response({"icao_hex": icao_hex, "registration": registration.upper(), "source": "n-number"})

        return Response({"error": "Aircraft not found", "registration": registration}, status=status.HTTP_404_NOT_FOUND)

    @extend_schema(
        summary="Search aircraft",
        parameters=[
            OpenApiParameter(name="q", type=str, description="Search query"),
            OpenApiParameter(name="operator", type=str, description="Filter by operator"),
            OpenApiParameter(name="type", type=str, description="Filter by type code"),
        ],
        responses={200: AircraftInfoSerializer(many=True)},
    )
    @action(detail=False, methods=["get"])
    def search(self, request):
        """Search aircraft info."""
        from django.db.models import Q

        queryset = AircraftInfo.objects.all()

        q = request.query_params.get("q")
        if q:
            queryset = queryset.filter(
                Q(registration__icontains=q) | Q(icao_hex__icontains=q) | Q(operator__icontains=q)
            )

        operator = request.query_params.get("operator")
        if operator:
            queryset = queryset.filter(operator__icontains=operator)

        type_code = request.query_params.get("type")
        if type_code:
            queryset = queryset.filter(type_code__iexact=type_code)

        # Safely parse limit with fallback
        try:
            limit = max(0, min(int(request.query_params.get("limit", 50)), 500))
        except (ValueError, TypeError):
            limit = 50

        # Evaluate queryset to list to avoid extra count query
        results = list(queryset[:limit])

        return Response(
            {
                "aircraft": AircraftInfoSerializer(results, many=True).data,
                "count": len(results),
            }
        )

    @extend_schema(summary="Get cache statistics", responses={200: AircraftInfoCacheStatsSerializer})
    @action(detail=False, methods=["get"], url_path="cache/stats")
    def cache_stats(self, request):
        """Get aircraft info cache statistics."""
        from django.db.models import Count

        total = AircraftInfo.objects.count()
        failed = AircraftInfo.objects.filter(fetch_failed=True).count()
        with_photos = AircraftInfo.objects.exclude(photo_url__isnull=True).exclude(photo_url="").count()
        with_local_photos = AircraftInfo.objects.filter(photo_local_path__isnull=False).count()
        military = AircraftInfo.objects.filter(is_military=True).count()

        # By source
        by_source = dict(
            AircraftInfo.objects.exclude(source__isnull=True)
            .exclude(source="")
            .values("source")
            .annotate(count=Count("id"))
            .values_list("source", "count")
        )

        return Response(
            {
                "total_cached": total,
                "failed_lookups": failed,
                "with_photos": with_photos,
                "with_local_photos": with_local_photos,
                "military": military,
                "by_source": by_source,
                "cache_duration_hours": 168,  # 7 days
                "retry_after_hours": 24,
            }
        )

    @extend_schema(
        summary="Refresh aircraft info",
        description="Force refresh aircraft info from external sources",
        parameters=[
            OpenApiParameter(name="icao", type=str, location=OpenApiParameter.PATH, description="ICAO hex code")
        ],
        responses={200: AircraftInfoSerializer, 202: None},
    )
    @action(detail=True, methods=["post"])
    def refresh(self, request, pk=None):
        """Force refresh aircraft info from external sources."""
        from skyspy.services import aircraft_info as aircraft_info_service
        from skyspy.tasks.external_db import fetch_aircraft_info

        icao = pk.upper().strip().lstrip("~")

        # Invalidate in-memory cache first
        aircraft_info_service.invalidate_cache(icao)

        # Delete existing record to force fresh lookup
        AircraftInfo.objects.filter(icao_hex=icao).delete()

        # Queue background fetch
        fetch_aircraft_info.delay(icao)

        return Response(
            {"icao_hex": icao, "status": "queued", "message": "Aircraft info refresh queued"},
            status=status.HTTP_202_ACCEPTED,
        )

    @extend_schema(
        summary="Lookup aircraft info (fetch if not cached)",
        description="Get aircraft info, fetching from external sources if not in cache",
        parameters=[
            OpenApiParameter(name="icao", type=str, location=OpenApiParameter.PATH, description="ICAO hex code"),
            OpenApiParameter(
                name="wait",
                type=bool,
                location=OpenApiParameter.QUERY,
                description="Wait for fetch to complete (default: false)",
            ),
        ],
        responses={200: AircraftInfoSerializer, 202: None, 404: None},
    )
    @action(detail=True, methods=["get"])
    def lookup(self, request, pk=None):
        """
        Look up aircraft info, fetching from external sources if needed.

        If wait=true, waits up to 10 seconds for the fetch to complete.
        Otherwise, returns immediately with 202 Accepted if fetching.
        """
        import select

        from skyspy.tasks.external_db import fetch_aircraft_info

        icao = pk.upper().strip().lstrip("~")
        wait = request.query_params.get("wait", "false").lower() == "true"

        # Check cache first
        try:
            info = AircraftInfo.objects.get(icao_hex=icao)
            if not info.fetch_failed:
                return Response(AircraftInfoSerializer(info).data)
        except AircraftInfo.DoesNotExist:
            pass

        # Queue fetch
        fetch_aircraft_info.delay(icao)

        if wait:
            # Poll for result (up to 10 seconds) using database polling
            # This is more efficient than time.sleep() in async context
            import time

            start_time = time.monotonic()
            timeout = 10.0
            poll_interval = 0.5

            while time.monotonic() - start_time < timeout:
                try:
                    info = AircraftInfo.objects.get(icao_hex=icao)
                    if not info.fetch_failed:
                        return Response(AircraftInfoSerializer(info).data)
                    elif info.fetch_failed:
                        return Response(
                            {
                                "icao_hex": icao,
                                "status": "not_found",
                                "message": "Aircraft not found in external databases",
                            },
                            status=status.HTTP_404_NOT_FOUND,
                        )
                except AircraftInfo.DoesNotExist:
                    pass

                # Use select for non-blocking wait (works better with ASGI)
                try:
                    select.select([], [], [], poll_interval)
                except (OSError, ValueError):
                    # Fallback for systems where select doesn't work on empty lists
                    time.sleep(poll_interval)

            # Timeout
            return Response(
                {"icao_hex": icao, "status": "timeout", "message": "Lookup timed out, please try again"},
                status=status.HTTP_202_ACCEPTED,
            )

        return Response(
            {"icao_hex": icao, "status": "queued", "message": "Aircraft info lookup queued"},
            status=status.HTTP_202_ACCEPTED,
        )

    @extend_schema(
        summary="Fetch aircraft photos",
        description="Trigger photo fetch for an aircraft",
        parameters=[
            OpenApiParameter(name="icao", type=str, location=OpenApiParameter.PATH, description="ICAO hex code"),
            OpenApiParameter(
                name="force", type=bool, location=OpenApiParameter.QUERY, description="Force re-download even if cached"
            ),
        ],
        responses={202: None},
    )
    @action(detail=True, methods=["post"], url_path="photos/fetch")
    def fetch_photos(self, request, pk=None):
        """Trigger photo fetch for an aircraft."""
        from skyspy.tasks.external_db import fetch_aircraft_photos

        icao = pk.upper().strip().lstrip("~")
        force = request.query_params.get("force", "false").lower() == "true"

        fetch_aircraft_photos.delay(icao, force=force)

        return Response(
            {"icao_hex": icao, "status": "queued", "message": "Photo fetch queued", "force": force},
            status=status.HTTP_202_ACCEPTED,
        )

    @extend_schema(
        summary="LLM-generated flight-history summary",
        description=(
            "Plain-English narrative of what this ground station has observed for the "
            "aircraft (session/sighting counts, first/last seen, callsigns, altitude and "
            "distance envelope, ACARS airports). Requires the LLM to be enabled/configured; "
            "returns available=false otherwise. Append-only by default: the stored briefing is "
            "never rewritten. Pass refresh=true to append new activity observed since it was "
            "last generated (no-op if nothing new); pass regenerate=true to rewrite the whole "
            "briefing from scratch."
        ),
        parameters=[
            OpenApiParameter(name="icao", type=str, location=OpenApiParameter.PATH, description="ICAO hex code"),
            OpenApiParameter(
                name="refresh",
                type=bool,
                location=OpenApiParameter.QUERY,
                description="Update from latest: append any new activity, keeping existing history",
            ),
            OpenApiParameter(
                name="regenerate",
                type=bool,
                location=OpenApiParameter.QUERY,
                description="Generate new: rewrite the whole briefing from scratch",
            ),
        ],
    )
    @action(detail=True, methods=["get"], url_path="flight-history")
    def flight_history(self, request, pk=None):
        """Append-only LLM narrative of this station's observation history for one airframe."""
        from django.core.cache import cache
        from django.utils import timezone

        from skyspy.services import aviation_llm

        icao = pk.upper().strip().lstrip("~")

        if not aviation_llm.available():
            return Response({"available": False, "summary": None, "icao_hex": icao})

        # Long TTL: the briefing is durable and only ever appended to, so it should
        # survive normal churn rather than expiring and being rewritten from scratch.
        cache_key = f"airframe:flight_history:{icao}"
        ttl = 30 * 24 * 60 * 60
        # Two explicit user actions:
        #   refresh=true    → "Update from latest": append only new activity, keep history.
        #   regenerate=true → "Generate new": rewrite the whole briefing from scratch.
        refresh = request.query_params.get("refresh", "false").lower() == "true"
        regenerate = request.query_params.get("regenerate", "false").lower() == "true"

        stored = cache.get(cache_key)

        # Normal load never regenerates — return the stored briefing verbatim so old
        # events are never rewritten.
        if stored is not None and stored.get("summary") and not refresh and not regenerate:
            return Response(stored)

        context, based_on, state = self._build_flight_history_context(icao)
        # Real callsigns observed for this airframe — sent to the client so it can badge
        # exactly these strings wherever they appear in the narrative, instead of
        # regex-guessing (which misses some and mis-tags registrations/type codes).
        # Strip + dedupe case-insensitively (DB rows can differ only by trailing space).
        callsigns = []
        _seen_cs = set()
        for cs in context.get("callsigns_seen") or []:
            norm = str(cs or "").strip()
            key = norm.upper()
            if norm and key not in _seen_cs:
                _seen_cs.add(key)
                callsigns.append(norm)
        if not based_on.get("sessions") and not based_on.get("sightings"):
            payload = {"available": True, "summary": None, "icao_hex": icao, "based_on": based_on, "state": state}
            cache.set(cache_key, payload, 60 * 30)
            return Response(payload)

        # Append path: a briefing already exists — add only the sessions observed
        # since it was last written, leaving the prior text untouched. Skipped when
        # the user explicitly asked to regenerate from scratch.
        if stored and stored.get("summary") and not regenerate:
            prior_state = stored.get("state") or {}
            has_new = (state.get("sessions", 0) > prior_state.get("sessions", 0)) or (
                state.get("last_seen")
                and prior_state.get("last_seen")
                and state["last_seen"] > prior_state["last_seen"]
            )
            if not has_new:
                return Response(stored)

            new_context, new_based_on, _ = self._build_flight_history_context(icao, since=prior_state.get("last_seen"))
            if new_based_on.get("sessions", 0) <= 0:
                return Response(stored)

            appended = aviation_llm.flight_history_append(stored["summary"], new_context)
            if not appended:
                return Response(stored)

            summary = (stored["summary"].rstrip() + " " + appended).strip()
            payload = {
                "available": True,
                "summary": summary,
                "icao_hex": icao,
                "based_on": based_on,
                "callsigns": callsigns,
                "state": state,
                "generated_at": timezone.now().isoformat(),
            }
            cache.set(cache_key, payload, ttl)
            return Response(payload)

        # First-time generation: the full initial briefing.
        summary = aviation_llm.flight_history_summary(context)
        payload = {
            "available": True,
            "summary": summary,
            "icao_hex": icao,
            "based_on": based_on,
            "callsigns": callsigns,
            "state": state,
            "generated_at": timezone.now().isoformat(),
        }
        cache.set(cache_key, payload, ttl if summary else 30 * 60)
        return Response(payload)

    def _build_flight_history_context(self, icao, since=None):
        """Gather identity + local observation data for the flight-history LLM.

        When ``since`` (an ISO timestamp) is given, only sessions seen after it are
        included — used to build the delta for an append. Returns
        ``(context_dict, based_on_counts, state_marker)`` where ``state_marker``
        tracks the total session count and latest ``last_seen`` for the airframe.
        """
        from django.db.models import Count, Max, Min, Sum
        from django.utils.dateparse import parse_datetime

        from skyspy.models import AcarsMessage, AircraftSession, AircraftSighting, SafetyEvent

        EMERGENCY_SQUAWKS = {"7500": "hijack", "7600": "radio failure", "7700": "general emergency"}

        info = AircraftInfo.objects.filter(icao_hex__iexact=icao).first()

        # State marker is always over ALL sessions (drives the append decision),
        # independent of the ``since`` delta filter below.
        totals = AircraftSession.objects.filter(icao_hex__iexact=icao).aggregate(
            sessions=Count("id"), last_seen=Max("last_seen")
        )
        state = {
            "sessions": totals["sessions"] or 0,
            "last_seen": totals["last_seen"].isoformat() if totals["last_seen"] else None,
        }

        sessions_qs = AircraftSession.objects.filter(icao_hex__iexact=icao)
        since_dt = parse_datetime(since) if isinstance(since, str) else since
        if since_dt:
            sessions_qs = sessions_qs.filter(last_seen__gt=since_dt)
        agg = sessions_qs.aggregate(
            first_seen=Min("first_seen"),
            last_seen=Max("last_seen"),
            positions=Sum("total_positions"),
            min_alt=Min("min_altitude"),
            max_alt=Max("max_altitude"),
            min_dist=Min("min_distance_nm"),
            max_dist=Max("max_distance_nm"),
            peak_rssi=Max("max_rssi"),
            session_count=Count("id"),
        )
        session_count = agg["session_count"] or 0

        callsigns = list(
            sessions_qs.exclude(callsign__isnull=True)
            .exclude(callsign="")
            .values_list("callsign", flat=True)
            .distinct()[:12]
        )

        # Take the 8 most recent passes, then present them oldest-first so the LLM can
        # narrate the timeline in chronological order (departure → later returns).
        recent_sessions = [
            {
                "first_seen": s.first_seen,
                "last_seen": s.last_seen,
                "callsign": s.callsign,
                "positions": s.total_positions,
                "min_altitude_ft": s.min_altitude,
                "max_altitude_ft": s.max_altitude,
                "closest_nm": s.min_distance_nm,
            }
            for s in reversed(list(sessions_qs.order_by("-last_seen")[:8]))
        ]

        # On a delta build we only count the new sessions; totals come from ``state``.
        sightings_qs = AircraftSighting.objects.filter(icao_hex__iexact=icao)
        if since_dt:
            sightings_qs = sightings_qs.filter(timestamp__gt=since_dt)
        sighting_count = 0 if since_dt else sightings_qs.count()

        # Transponder codes seen for this airframe. Emergency squawks (7500/7600/7700)
        # are the whole point of surfacing this to the briefing, so flag them loudly.
        squawks = [
            sq
            for sq in sightings_qs.exclude(squawk__isnull=True)
            .exclude(squawk="")
            .values_list("squawk", flat=True)
            .distinct()[:30]
            if sq
        ]
        emergency_squawks = sorted({f"{sq} ({EMERGENCY_SQUAWKS[sq]})" for sq in squawks if sq in EMERGENCY_SQUAWKS})

        # Safety events recorded for this airframe (emergency squawks, TCAS RA,
        # proximity, etc.) — real observed events, strongest signal in the history.
        safety_qs = SafetyEvent.objects.filter(icao_hex__iexact=icao)
        if since_dt:
            safety_qs = safety_qs.filter(timestamp__gt=since_dt)
        safety_events = [
            {
                "event_type": e.event_type,
                "severity": e.severity,
                "timestamp": e.timestamp,
                "message": (e.message or "")[:200] or None,
            }
            for e in safety_qs.order_by("-timestamp")[:12]
        ]

        # Airports referenced in this airframe's recent ACARS/VDL2 traffic (skipped on
        # a delta build so the append doesn't re-mention already-covered airports). The
        # airports live inside the model's ``decoded`` JSON blob.
        airports = set()
        if not since_dt:
            for decoded in (
                AcarsMessage.objects.filter(icao_hex__iexact=icao)
                .exclude(decoded__isnull=True)
                .order_by("-timestamp")
                .values_list("decoded", flat=True)[:60]
            ):
                mentioned = (decoded or {}).get("airports_mentioned") or []
                for a in mentioned:
                    if a:
                        airports.add(str(a).upper())
                if len(airports) >= 12:
                    break

        # Give the model everything we know about the airframe, not just a subset.
        identity = {}
        if info:
            identity = {
                "registration": info.registration,
                "type": info.type_name or info.model,
                "type_code": info.type_code,
                "type_name": info.type_name,
                "manufacturer": info.manufacturer,
                "model": info.model,
                "serial_number": info.serial_number,
                "year_built": info.year_built,
                "first_flight_date": info.first_flight_date,
                "delivery_date": info.delivery_date,
                "airframe_hours": info.airframe_hours,
                "operator": info.operator,
                "operator_icao": info.operator_icao,
                "operator_callsign": info.operator_callsign,
                "owner": info.owner,
                "owner_type": info.owner_type,
                "based_city": info.city,
                "based_state": info.state,
                "country": info.country,
                "country_code": info.country_code,
                "category": info.category,
                "is_military": info.is_military or None,
                "is_law_enforcement_or_interesting": info.is_interesting or None,
                "privacy_ladd": info.is_ladd or None,
                "privacy_icao_address": info.is_pia or None,
                "shell_company_suspected": info.is_shell_suspected or None,
                "shell_likelihood": info.shell_score,
                "data_source": info.source,
            }
            # Any additional provider fields we captured but don't model explicitly.
            if isinstance(info.extra_data, dict):
                extra = {
                    k: v
                    for k, v in info.extra_data.items()
                    if v not in (None, "", [], {}) and not isinstance(v, (dict, list))
                }
                if extra:
                    identity["additional"] = dict(list(extra.items())[:20])

        context = {
            "icao_hex": icao,
            "identity": {k: v for k, v in identity.items() if v not in (None, "")},
            "observed": {
                "sessions_tracked": session_count,
                "total_position_reports": agg["positions"],
                "first_seen_here": agg["first_seen"],
                "last_seen_here": agg["last_seen"],
                "altitude_range_ft": [agg["min_alt"], agg["max_alt"]]
                if agg["min_alt"] is not None or agg["max_alt"] is not None
                else None,
                "distance_range_nm": [agg["min_dist"], agg["max_dist"]]
                if agg["min_dist"] is not None or agg["max_dist"] is not None
                else None,
                "peak_rssi_db": agg["peak_rssi"],
            },
            "callsigns_seen": callsigns,
            "squawks_seen": squawks,
            "emergency_squawks": emergency_squawks,
            "safety_events": safety_events,
            "acars_airports": sorted(airports),
            "recent_sessions": recent_sessions,
        }

        based_on = {
            "sessions": session_count,
            "sightings": sighting_count,
            "callsigns": len(callsigns),
            "squawks": len(squawks),
            "safety_events": len(safety_events),
            "acars_airports": len(airports),
        }
        return context, based_on, state

    @extend_schema(
        summary="Upgrade aircraft photo",
        description="Attempt to upgrade to a higher resolution photo",
        parameters=[
            OpenApiParameter(name="icao", type=str, location=OpenApiParameter.PATH, description="ICAO hex code")
        ],
        responses={202: None},
    )
    @action(detail=True, methods=["post"], url_path="photos/upgrade")
    def upgrade_photo(self, request, pk=None):
        """Attempt to upgrade to a higher resolution photo."""
        from skyspy.tasks.external_db import upgrade_aircraft_photo

        icao = pk.upper().strip().lstrip("~")

        upgrade_aircraft_photo.delay(icao)

        return Response(
            {"icao_hex": icao, "status": "queued", "message": "Photo upgrade queued"}, status=status.HTTP_202_ACCEPTED
        )
