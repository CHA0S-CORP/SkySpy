"""
ACARS and VDL2 message service.
Receives messages from acarsdec/vdlm2dec via acars_router.

acars_router configuration:
  The acars_router container receives messages from decoders and forwards
  them as JSON over UDP. Configure acars_router to send to this service.

  Example docker-compose for acars_router:

  acars_router:
    image: ghcr.io/sdr-enthusiasts/acars_router:latest
    environment:
      - AR_LISTEN_UDP_ACARS=5550
      - AR_LISTEN_UDP_VDLM2=5555
      - AR_SEND_UDP_ACARS=skyspy:5550
      - AR_SEND_UDP_VDLM2=skyspy:5555

Message formats handled:
  - acarsdec: flat JSON with timestamp, freq, tail, flight, text, label, etc.
  - vdlm2dec: flat JSON similar to acarsdec
  - dumpvdl2: nested JSON with vdl2/avlc/acars structure
"""

import asyncio
import contextlib
import hashlib
import json
import logging
import math
import threading
import time
from collections import OrderedDict, defaultdict
from datetime import UTC, datetime, timedelta

from django.db import DatabaseError

from skyspy.services.acars_decoder import enrich_acars_message
from skyspy.socketio.utils import sync_emit

logger = logging.getLogger(__name__)


def _normalize_frequency(freq) -> float | None:
    """Normalize frequency to MHz.

    Handles frequencies that may be in Hz (e.g., 136975000) or MHz (e.g., 136.975).
    VDL2 frequencies are typically in the 118-137 MHz range.
    """
    if freq is None:
        return None

    try:
        freq = float(freq)
    except (TypeError, ValueError):
        return None

    # If frequency is > 1000, assume it's in Hz and convert to MHz
    # (Valid aviation frequencies are in the range ~118-137 MHz)
    if freq > 1000:
        freq = freq / 1_000_000

    # Validate the frequency is in a reasonable aviation range
    if 100 <= freq <= 200:
        return round(freq, 6)

    return None


class LRUCache:
    """Simple LRU cache with TTL for message deduplication."""

    def __init__(self, maxsize: int = 10000, ttl_seconds: int = 30):
        self.maxsize = maxsize
        self.ttl = ttl_seconds
        self._cache: OrderedDict[str, float] = OrderedDict()
        self._lock = threading.Lock()

    def contains(self, key: str) -> bool:
        """Check if key exists and is not expired."""
        with self._lock:
            if key not in self._cache:
                return False
            timestamp = self._cache[key]
            if time.time() - timestamp > self.ttl:
                del self._cache[key]
                return False
            # Move to end (most recently used)
            self._cache.move_to_end(key)
            return True

    def add(self, key: str) -> None:
        """Add key to cache."""
        with self._lock:
            now = time.time()
            # Evict expired entries
            expired = [k for k, t in self._cache.items() if now - t > self.ttl]
            for k in expired:
                del self._cache[k]
            # Add new entry
            self._cache[key] = now
            self._cache.move_to_end(key)
            # Evict oldest if over capacity
            while len(self._cache) > self.maxsize:
                self._cache.popitem(last=False)

    def size(self) -> int:
        with self._lock:
            return len(self._cache)


class AcarsService:
    """Service for receiving and processing ACARS/VDL2 messages."""

    def __init__(self):
        self._running = False
        self._acars_task: asyncio.Task | None = None
        self._vdlm2_task: asyncio.Task | None = None
        self._airframes_task: asyncio.Task | None = None
        # Airframes.io poller config (loaded from settings in start())
        self._af_airports: set[str] = set()
        self._af_lat: float | None = None
        self._af_lon: float | None = None
        self._af_radius_nm: float = 0.0

        # Statistics
        self._stats_lock = threading.Lock()
        self._stats = {
            "acars": {"total": 0, "last_hour": 0, "errors": 0, "duplicates": 0},
            "vdlm2": {"total": 0, "last_hour": 0, "errors": 0, "duplicates": 0},
        }
        self._hourly_counts: dict[str, list] = defaultdict(list)

        # Frequency statistics
        self._frequency_counts: dict[str, int] = defaultdict(int)

        # Message deduplication cache (30 second TTL)
        self._dedup_cache = LRUCache(maxsize=10000, ttl_seconds=30)

        # ICAO hexes already queued for airframe-info enrichment this process, so
        # a plane heard repeatedly over ACARS doesn't enqueue a lookup per message
        # (the batch task itself also skips hexes already stored). Bounded set.
        self._info_seen: set[str] = set()
        self._info_seen_lock = threading.Lock()

        # Recent messages buffer for initial load
        self._recent_messages: list[dict] = []
        self._recent_lock = threading.Lock()
        self._max_recent = 100

    def _compute_message_hash(self, msg: dict) -> str:
        """Compute hash for message deduplication.

        Uses timestamp (rounded to second), icao_hex, label, and first 50 chars of text.
        """
        ts = msg.get("timestamp", 0)
        if isinstance(ts, float):
            ts = int(ts)  # Truncate to second for consistent deduplication
        icao = msg.get("icao_hex", "") or ""
        label = msg.get("label", "") or ""
        text = (msg.get("text", "") or "")[:50]

        key = f"{ts}:{icao}:{label}:{text}"
        return hashlib.sha256(key.encode()).hexdigest()[:32]  # Truncate to 32 chars for efficiency

    def _is_duplicate(self, msg: dict, source: str) -> bool:
        """Check if message is a duplicate."""
        msg_hash = self._compute_message_hash(msg)
        if self._dedup_cache.contains(msg_hash):
            with self._stats_lock:
                self._stats[source]["duplicates"] += 1
            return True
        self._dedup_cache.add(msg_hash)
        return False

    async def start(self, acars_port: int = 5550, vdlm2_port: int = 5555, airframes: bool | None = None):
        """Start listening for ACARS and VDL2 messages."""
        if self._running:
            logger.warning("ACARS service already running, ignoring start request")
            return

        self._running = True
        logger.info("Starting ACARS service...")

        # Start UDP listeners
        if acars_port:
            self._acars_task = asyncio.create_task(self._udp_listener(acars_port, "acars"))
            logger.info(f"ACARS UDP listener started on 0.0.0.0:{acars_port}")

        if vdlm2_port:
            self._vdlm2_task = asyncio.create_task(self._udp_listener(vdlm2_port, "vdlm2"))
            logger.info(f"VDL2 UDP listener started on 0.0.0.0:{vdlm2_port}")

        # Start the airframes.io firehose poller (open LAX-area ACARS source)
        from django.conf import settings

        if airframes is None:
            airframes = getattr(settings, "AIRFRAMES_ACARS_ENABLED", False)
        if airframes:
            self._af_airports = {
                a.strip().upper()
                for a in (getattr(settings, "AIRFRAMES_ACARS_AIRPORTS", "") or "").split(",")
                if a.strip()
            }
            self._af_lat = getattr(settings, "AIRFRAMES_ACARS_CENTER_LAT", None)
            self._af_lon = getattr(settings, "AIRFRAMES_ACARS_CENTER_LON", None)
            self._af_radius_nm = getattr(settings, "AIRFRAMES_ACARS_RADIUS_NM", 0.0) or 0.0
            self._airframes_task = asyncio.create_task(self._airframes_poll_loop())
            logger.info(
                "Airframes ACARS poller started (airports=%s, center=%s,%s r=%snm)",
                sorted(self._af_airports),
                self._af_lat,
                self._af_lon,
                self._af_radius_nm,
            )

        logger.info("ACARS service started successfully")

    async def stop(self):
        """Stop all listeners."""
        logger.info("Stopping ACARS service...")
        self._running = False

        if self._acars_task:
            self._acars_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._acars_task
            logger.debug("ACARS listener stopped")

        if self._vdlm2_task:
            self._vdlm2_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._vdlm2_task
            logger.debug("VDL2 listener stopped")

        if self._airframes_task:
            self._airframes_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._airframes_task
            logger.debug("Airframes poller stopped")

        # Log final stats
        stats = self.get_stats()
        logger.info(
            f"ACARS service stopped. Final stats: "
            f"ACARS={stats['acars']['total']} msgs ({stats['acars']['errors']} errors), "
            f"VDL2={stats['vdlm2']['total']} msgs ({stats['vdlm2']['errors']} errors)"
        )

    async def _udp_listener(self, port: int, source: str):
        """Listen for UDP messages on a port."""
        loop = asyncio.get_event_loop()
        service = self

        class UDPProtocol(asyncio.DatagramProtocol):
            def __init__(self, svc, src):
                self.service = svc
                self.source = src
                self.packet_count = 0

            def connection_made(self, transport):
                logger.info(f"UDP listener for {self.source} ready to receive")

            def datagram_received(self, data, addr):
                self.packet_count += 1
                if self.packet_count == 1:
                    logger.info(f"First {self.source} packet received from {addr[0]}:{addr[1]}")
                elif self.packet_count % 100 == 0:
                    logger.debug(f"Received {self.packet_count} {self.source} packets so far")

                task = asyncio.create_task(self.service._process_message(data, self.source))
                # Add error callback to prevent silent exception loss
                task.add_done_callback(self._handle_task_exception)

            def _handle_task_exception(self, task):
                """Handle exceptions from message processing tasks."""
                try:
                    # This will raise the exception if one occurred
                    task.result()
                except asyncio.CancelledError:
                    pass  # Task was cancelled, not an error
                except Exception as e:  # broad: error-reporting callback surfacing any task failure
                    logger.error(f"Unhandled exception in {self.source} message processing: {e}", exc_info=True)

            def error_received(self, exc):
                logger.error(f"UDP error on {self.source} listener: {exc}")

        try:
            transport, protocol = await loop.create_datagram_endpoint(
                lambda: UDPProtocol(service, source),
                local_addr=("0.0.0.0", port),  # nosec B104 - intentional bind to all interfaces for UDP listener
            )
            logger.debug(f"UDP endpoint created for {source} on port {port}")
        except OSError as e:
            logger.error(f"Failed to create UDP listener for {source} on port {port}: {e}")
            return

        try:
            while self._running:
                await asyncio.sleep(1)
        finally:
            transport.close()
            logger.debug(f"UDP transport closed for {source}")

    # ------------------------------------------------------------------
    # Airframes.io firehose poller (open, no-hardware ACARS source)
    # ------------------------------------------------------------------

    @staticmethod
    def _haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Great-circle distance in nautical miles."""
        r = 3440.065  # earth radius in nm
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlmb = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
        return 2 * r * math.asin(min(1.0, math.sqrt(a)))

    def _airframes_station_ok(self, station: dict) -> bool:
        """Keep only LAX-area ground stations (by nearest-airport ICAO or radius)."""
        icao = (station.get("nearestAirportIcao") or "").upper()
        if self._af_airports and icao in self._af_airports:
            return True
        lat = station.get("latitude")
        lon = station.get("longitude")
        if lat is None or lon is None:
            lat, lon = station.get("geoipLatitude"), station.get("geoipLongitude")
        if lat is not None and lon is not None and self._af_radius_nm > 0 and self._af_lat is not None:
            return self._haversine_nm(self._af_lat, self._af_lon, lat, lon) <= self._af_radius_nm
        return False

    @staticmethod
    def _airframes_to_flat(m: dict) -> tuple[str, dict]:
        """Reshape an airframes.io message into the flat acarsdec/vdlm2dec JSON
        that _normalize_message already understands."""
        station = m.get("station") or {}
        airframe = m.get("airframe") or {}
        flight = m.get("flight") or {}
        source_type = (m.get("sourceType") or "").lower()
        source = "vdlm2" if source_type == "vdl" or "vdl" in (m.get("source") or "").lower() else "acars"
        flat = {
            "timestamp": m.get("timestamp"),
            "freq": m.get("frequency"),
            "channel": m.get("channel"),
            "icao": airframe.get("icao") or m.get("fromHex") or m.get("icao"),
            "tail": m.get("tail") or airframe.get("tail"),
            "flight": m.get("flightNumber") or flight.get("flight"),
            "label": m.get("label"),
            "block_id": m.get("blockId"),
            "msgno": m.get("messageNumber"),
            "ack": m.get("ack"),
            "mode": m.get("mode"),
            "text": m.get("text") or "",
            "level": m.get("level"),
            "error": m.get("error"),
            "station_id": station.get("ident"),
            "depa": m.get("departingAirport"),
            "dsta": m.get("destinationAirport"),
        }
        return source, flat

    async def _airframes_poll_loop(self):
        """Poll the airframes.io firehose, filter to LAX-area stations, and feed
        matching messages through the normal processing pipeline."""
        import httpx
        from django.conf import settings

        url = getattr(settings, "AIRFRAMES_ACARS_URL", "https://api.airframes.io/v1/messages")
        interval = max(2, getattr(settings, "AIRFRAMES_ACARS_POLL_INTERVAL", 4))
        headers = {"User-Agent": "skyspy-acars/1.0"}
        key = getattr(settings, "AIRFRAMES_ACARS_API_KEY", "")
        if key:
            headers["Authorization"] = f"Bearer {key}"

        async with httpx.AsyncClient(timeout=15, headers=headers) as client:
            while self._running:
                try:
                    resp = await client.get(url, params={"limit": 100})
                    resp.raise_for_status()
                    payload = resp.json()
                    messages = (
                        payload if isinstance(payload, list) else payload.get("messages") or payload.get("results", [])
                    )
                    kept = 0
                    for m in messages:
                        if not self._airframes_station_ok(m.get("station") or {}):
                            continue
                        source, flat = self._airframes_to_flat(m)
                        await self._process_message(json.dumps(flat).encode(), source)
                        kept += 1
                    logger.debug("Airframes poll: kept %d/%d messages (LAX-area)", kept, len(messages))
                except httpx.HTTPError as e:
                    logger.warning("Airframes poll HTTP error: %s", e)
                except (ValueError, KeyError, TypeError) as e:
                    logger.warning("Airframes poll parse error: %s", e)
                except Exception as e:  # broad: poll loop must survive any single-cycle failure
                    logger.error("Airframes poll unexpected error: %s", e, exc_info=True)
                await asyncio.sleep(interval)

    async def _process_message(self, data: bytes, source: str):
        """Process a received message."""
        try:
            # Parse JSON message
            raw_text = data.decode("utf-8")
            msg = json.loads(raw_text)

            logger.debug(f"Received {source} message with keys: {list(msg.keys())}")

            # Normalize message format
            normalized = self._normalize_message(msg, source)

            if normalized:
                # Check for duplicate messages
                if self._is_duplicate(normalized, source):
                    logger.debug(f"Duplicate {source} message filtered")
                    return

                # Track frequency statistics
                freq = normalized.get("frequency")
                if freq:
                    freq_mhz = f"{freq:.3f}"
                    with self._stats_lock:
                        self._frequency_counts[freq_mhz] += 1

                # Enrich message with airline and label info (skip text decode - done
                # via Celery). Enrichment hits the ORM (airline lookup), which Django
                # forbids from an async context - run it on the sync thread.
                from asgiref.sync import sync_to_async

                enriched = await sync_to_async(enrich_acars_message)(normalized, decode_text=False)

                # Update statistics
                with self._stats_lock:
                    self._stats[source]["total"] += 1
                    self._hourly_counts[source].append(datetime.now(UTC))
                    total = self._stats[source]["total"]

                # Add to recent buffer
                with self._recent_lock:
                    self._recent_messages.append(enriched)
                    if len(self._recent_messages) > self._max_recent:
                        self._recent_messages.pop(0)

                # Persist to database
                await self._store_message(enriched)

                # Enrich the airframe: an aircraft heard only over ACARS (never on
                # the ADS-B hot stream) would otherwise never get an AircraftInfo
                # row, so its type/operator/registration stay unstored. Queue its
                # ICAO for the same batch lookup the stream uses.
                self._queue_info_lookup(normalized.get("icao_hex"))

                # Broadcast via Channels
                await self._broadcast_message(enriched)

                # Log message details
                flight = normalized.get("callsign") or normalized.get("registration") or "unknown"
                label = normalized.get("label") or "unknown"
                freq_str = f"{freq:.3f}MHz" if freq else "unknown freq"
                logger.debug(f"[{source.upper()}] #{total} {flight} label={label} @ {freq_str}")

                # Periodic info-level summary
                if total == 1:
                    logger.info(f"First {source.upper()} message received: {flight}")
                elif total % 100 == 0:
                    errors = self._stats[source]["errors"]
                    dupes = self._stats[source]["duplicates"]
                    logger.info(f"{source.upper()} milestone: {total} messages ({errors} errors, {dupes} duplicates)")
            else:
                logger.warning(f"Failed to normalize {source} message: {list(msg.keys())}")

        except json.JSONDecodeError as e:
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            preview = data[:100].decode("utf-8", errors="replace")
            logger.warning(f"Invalid JSON from {source}: {e} | Data preview: {preview!r}")
        except UnicodeDecodeError as e:
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            logger.warning(f"Unicode decode error from {source}: {e}")
        except Exception as e:  # broad: per-message resilience boundary - one bad message must not stop the listener
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            logger.error(f"Error processing {source} message: {e}", exc_info=True)

    def _normalize_message(self, msg: dict, source: str) -> dict | None:
        """Normalize message to common format.

        Handles message formats from acars_router which forwards messages from:
        - acarsdec: flat JSON with fields like timestamp, freq, tail, flight, text, etc.
        - vdlm2dec/dumpvdl2: can be flat or nested with vdl2/avlc/acars structure
        """
        try:
            # ACARS format from acarsdec via acars_router
            if source == "acars":
                icao = msg.get("icao") or msg.get("icao_hex") or msg.get("hex")
                if icao:
                    icao = str(icao).upper()

                station_id = msg.get("station_id")
                if not station_id:
                    app = msg.get("app", {})
                    if isinstance(app, dict):
                        station_id = app.get("name")

                ack_val = msg.get("ack")
                if ack_val is not None:
                    ack_val = str(ack_val) if ack_val else None

                return {
                    "timestamp": msg.get("timestamp", datetime.now(UTC).timestamp()),
                    "source": "acars",
                    "channel": str(msg.get("channel", "")),
                    "frequency": _normalize_frequency(msg.get("freq")),
                    "icao_hex": icao,
                    "registration": msg.get("tail", "").replace(".", "") if msg.get("tail") else None,
                    "callsign": msg.get("flight", "").strip() if msg.get("flight") else None,
                    "label": msg.get("label"),
                    "block_id": msg.get("block_id"),
                    "msg_num": msg.get("msgno"),
                    "ack": ack_val,
                    "mode": msg.get("mode"),
                    "text": msg.get("text", ""),
                    "signal_level": msg.get("level"),
                    "error_count": msg.get("error"),
                    "station_id": station_id,
                    "depa": msg.get("depa"),
                    "dsta": msg.get("dsta"),
                    "eta": msg.get("eta"),
                    "libacars": msg.get("libacars"),
                }

            # VDL2 format from vdlm2dec/dumpvdl2 via acars_router
            elif source == "vdlm2":
                if "vdl2" in msg:
                    # dumpvdl2 nested format
                    vdl2 = msg.get("vdl2", {})
                    avlc = vdl2.get("avlc", {})
                    acars_data = avlc.get("acars", {})

                    icao = None
                    src = avlc.get("src", {})
                    if isinstance(src, dict):
                        icao = src.get("addr")
                    if icao:
                        icao = str(icao).upper()

                    station_id = msg.get("station_id")
                    if not station_id:
                        app = msg.get("app", {})
                        if isinstance(app, dict):
                            station_id = app.get("name")

                    ack_val = acars_data.get("ack")
                    if ack_val is not None:
                        ack_val = str(ack_val) if ack_val else None

                    return {
                        "timestamp": msg.get("timestamp", vdl2.get("t", {}).get("sec", datetime.now(UTC).timestamp())),
                        "source": "vdlm2",
                        "channel": str(vdl2.get("channel", vdl2.get("idx", ""))),
                        "frequency": _normalize_frequency(vdl2.get("freq")),
                        "icao_hex": icao,
                        "registration": acars_data.get("reg", "").replace(".", "") if acars_data.get("reg") else None,
                        "callsign": acars_data.get("flight", "").strip() if acars_data.get("flight") else None,
                        "label": acars_data.get("label"),
                        "block_id": acars_data.get("blk_id"),
                        "msg_num": acars_data.get("msg_num"),
                        "ack": ack_val,
                        "mode": acars_data.get("mode"),
                        "text": acars_data.get("msg_text", ""),
                        "signal_level": vdl2.get("sig_level"),
                        # dumpvdl2's noise_level is a dBm float, not an error count
                        "noise_level": vdl2.get("noise_level"),
                        "error_count": None,
                        "station_id": station_id,
                        "libacars": msg.get("libacars") or vdl2.get("libacars"),
                    }
                else:
                    # vdlm2dec flat format
                    icao = msg.get("icao") or msg.get("hex") or msg.get("icao_hex")
                    if icao:
                        icao = format(icao, "06X") if isinstance(icao, int) else str(icao).upper()

                    station_id = msg.get("station_id")
                    if not station_id:
                        app = msg.get("app", {})
                        if isinstance(app, dict):
                            station_id = app.get("name")

                    ack_val = msg.get("ack")
                    if ack_val is not None:
                        ack_val = str(ack_val) if ack_val else None

                    return {
                        "timestamp": msg.get("timestamp", datetime.now(UTC).timestamp()),
                        "source": "vdlm2",
                        "channel": str(msg.get("channel", "")),
                        "frequency": _normalize_frequency(msg.get("freq")),
                        "icao_hex": icao,
                        "registration": msg.get("tail", "").replace(".", "") if msg.get("tail") else None,
                        "callsign": msg.get("flight", "").strip() if msg.get("flight") else None,
                        "label": msg.get("label"),
                        "block_id": msg.get("block_id"),
                        "msg_num": msg.get("msgno"),
                        "ack": ack_val,
                        "mode": msg.get("mode"),
                        "text": msg.get("text", ""),
                        "signal_level": msg.get("level"),
                        "error_count": msg.get("error"),
                        "station_id": station_id,
                        "libacars": msg.get("libacars"),
                    }

            logger.debug(f"Unknown source type: {source}")
            return None

        except (AttributeError, TypeError, KeyError, ValueError) as e:
            logger.error(f"Error normalizing {source} message: {e}", exc_info=True)
            return None

    async def _store_message(self, msg: dict) -> int | None:
        """Store an ACARS message in the database and queue for decoding.

        Returns:
            The message ID if stored successfully, None otherwise.
        """
        from asgiref.sync import sync_to_async

        from skyspy.models import AcarsMessage

        try:
            # Parse timestamp
            ts = msg.get("timestamp")
            if isinstance(ts, (int, float)):
                ts = datetime.fromtimestamp(ts, tz=UTC)
            elif isinstance(ts, str):
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            else:
                ts = datetime.now(UTC)

            @sync_to_async
            def create_record():
                return AcarsMessage.objects.create(
                    timestamp=ts,
                    source=msg.get("source", "acars"),
                    channel=msg.get("channel"),
                    frequency=msg.get("frequency"),
                    icao_hex=msg.get("icao_hex"),
                    registration=msg.get("registration"),
                    callsign=msg.get("callsign"),
                    label=msg.get("label"),
                    block_id=msg.get("block_id"),
                    msg_num=msg.get("msg_num"),
                    ack=msg.get("ack"),
                    mode=msg.get("mode"),
                    text=msg.get("text"),
                    decoded=None,  # Decoded in background via Celery
                    signal_level=msg.get("signal_level"),
                    noise_level=msg.get("noise_level"),
                    error_count=msg.get("error_count"),
                    station_id=msg.get("station_id"),
                )

            record = await create_record()
            logger.debug(
                f"Stored {msg.get('source', 'acars')} message id={record.id} "
                f"flight={msg.get('callsign') or msg.get('registration') or 'N/A'}"
            )

            # Queue for libacars decoding in background
            self._queue_decode_task(record.id, msg.get("label"))

            return record.id

        except (DatabaseError, ValueError, TypeError, OSError) as e:
            logger.error(f"Error storing ACARS message: {e}", exc_info=True)
            return None

    def _queue_info_lookup(self, icao_hex: str | None):
        """Queue an airframe-info lookup for an ACARS-heard ICAO hex.

        Deduped per-process so a repeatedly-heard aircraft enqueues at most one
        task; the batch task additionally skips hexes already in AircraftInfo, so
        this only does real work for genuinely new airframes.
        """
        if not icao_hex:
            return
        icao = icao_hex.upper().strip()
        # Non-ICAO (~ TIS-B/anonymized) addresses have no registry entry.
        if not icao or icao.startswith("~"):
            return

        with self._info_seen_lock:
            if icao in self._info_seen:
                return
            self._info_seen.add(icao)
            # Bound the set; drop everything and restart tracking if it grows huge.
            if len(self._info_seen) > 10000:
                self._info_seen = {icao}

        try:
            from skyspy.tasks.external_db import fetch_aircraft_info_batch

            fetch_aircraft_info_batch.delay([icao])
        except Exception as e:  # broad: enqueue must never break message processing (eager mode can raise)
            logger.debug(f"Failed to queue airframe-info lookup for {icao}: {e}")

    def _queue_decode_task(self, message_id: int, label: str | None):
        """Queue a Celery task to decode the message with libacars.

        Only queues for labels that can be meaningfully decoded.
        """
        # Labels that benefit from libacars/custom decoding
        decodable_labels = {
            "H1",
            "H2",  # FANS-1/A (ADS-C, CPDLC)
            "SA",
            "S1",
            "S2",  # System address messages
            "AA",
            "AB",
            "AC",  # ARINC 622 messages
            "BA",
            "B1",
            "B2",
            "B3",
            "B4",
            "B5",
            "B6",  # Various airline formats
            "_d",
            "2Z",
            "5Z",  # MIAM compressed messages
            "10",
            "11",
            "12",
            "13",
            "80",  # OOOI events
            "15",
            "16",
            "17",  # ETA/Departure/Arrival
            "44",
            "QA",
            "QB",
            "QC",
            "QD",
            "QE",
            "QF",  # Weather
        }

        if label and label in decodable_labels:
            try:
                from skyspy.tasks.acars import decode_acars_message

                decode_acars_message.delay(message_id)
            except (
                Exception
            ) as e:  # broad: enqueue must never break message storage (eager mode can raise SynchronousOnlyOperation)
                logger.warning(f"Failed to queue decode task for message {message_id}: {e}")

    async def _broadcast_message(self, msg: dict):
        """Broadcast ACARS message to WebSocket clients via Socket.IO."""
        try:
            # Add timestamp if not present
            if "timestamp" not in msg or not isinstance(msg["timestamp"], str):
                ts = msg.get("timestamp")
                if isinstance(ts, (int, float)):
                    msg["timestamp"] = datetime.fromtimestamp(ts, tz=UTC).isoformat().replace("+00:00", "Z")
                else:
                    msg["timestamp"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")

            # Broadcast to all ACARS subscribers on /acars namespace
            sync_emit("acars:message", msg, room="acars_all", namespace="/acars")

            # Also broadcast to main namespace for frontend compatibility
            sync_emit("acars:message", msg, room="topic_acars", namespace="/")

            # Also send to aircraft-specific room if we have ICAO
            icao = msg.get("icao_hex")
            if icao:
                sync_emit("acars:message", msg, room=f"acars_{icao.lower()}", namespace="/acars")

        except Exception as e:  # broad: broadcast must never raise into the caller
            logger.warning(f"Failed to broadcast ACARS message: {e}")

    def get_recent_messages(self, limit: int = 50) -> list[dict]:
        """Get recent messages from buffer."""
        with self._recent_lock:
            return list(reversed(self._recent_messages[-limit:]))

    def get_stats(self) -> dict:
        """Get ACARS service statistics."""
        now = datetime.now(UTC)
        hour_ago = now - timedelta(hours=1)

        with self._stats_lock:
            # Clean up old hourly counts
            for source in ["acars", "vdlm2"]:
                self._hourly_counts[source] = [t for t in self._hourly_counts[source] if t > hour_ago]
                self._stats[source]["last_hour"] = len(self._hourly_counts[source])

            # Get top frequencies by message count
            top_frequencies = sorted(self._frequency_counts.items(), key=lambda x: x[1], reverse=True)[:10]

            return {
                "acars": dict(self._stats["acars"]),
                "vdlm2": dict(self._stats["vdlm2"]),
                "running": self._running,
                "recent_buffer_size": len(self._recent_messages),
                "dedup_cache_size": self._dedup_cache.size(),
                "top_frequencies": [{"frequency_mhz": f, "count": c} for f, c in top_frequencies],
            }


# Global singleton
acars_service = AcarsService()
