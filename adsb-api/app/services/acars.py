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
import hashlib
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict, OrderedDict
import threading

import sentry_sdk
from prometheus_client import Counter, Gauge
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_settings
from app.models import AcarsMessage
from app.services.acars_decoder import enrich_acars_message, parse_callsign, decode_label

logger = logging.getLogger(__name__)

# Prometheus metrics for ACARS
ACARS_MESSAGES_RECEIVED = Counter(
    "skyspy_api_acars_messages_received_total",
    "Total ACARS/VDL2 messages received",
    ["source"]
)
ACARS_ERRORS = Counter(
    "skyspy_api_acars_errors_total",
    "Total ACARS/VDL2 processing errors",
    ["source", "error_type"]
)
ACARS_DECODE_SUCCESS = Counter(
    "skyspy_api_acars_decode_success_total",
    "Messages successfully decoded",
    ["decoder", "message_type"]
)
ACARS_DECODE_FAILURE = Counter(
    "skyspy_api_acars_decode_failure_total",
    "Messages that failed to decode",
    ["label"]
)
ACARS_DUPLICATES = Counter(
    "skyspy_api_acars_duplicates_total",
    "Duplicate messages filtered",
    ["source"]
)
ACARS_FREQUENCY_MESSAGES = Counter(
    "skyspy_api_acars_frequency_messages_total",
    "Messages received by frequency",
    ["frequency_mhz"]
)
ACARS_DEDUP_CACHE_SIZE = Gauge(
    "skyspy_api_acars_dedup_cache_size",
    "Current size of deduplication cache"
)
settings = get_settings()


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
            ACARS_DEDUP_CACHE_SIZE.set(len(self._cache))

    def size(self) -> int:
        with self._lock:
            return len(self._cache)


class AcarsService:
    """Service for receiving and processing ACARS/VDL2 messages."""

    def __init__(self):
        self._running = False
        self._acars_task: Optional[asyncio.Task] = None
        self._vdlm2_task: Optional[asyncio.Task] = None

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

        # Recent messages buffer for SSE
        self._recent_messages: list[dict] = []
        self._recent_lock = threading.Lock()
        self._max_recent = 100

        # Database session factory (set by caller)
        self._db_session_factory = None

        # Callback for SSE publishing
        self._sse_callback = None
    
    def set_sse_callback(self, callback):
        """Set callback function for publishing to SSE."""
        self._sse_callback = callback

    def set_db_session_factory(self, factory):
        """Set database session factory for message persistence."""
        self._db_session_factory = factory

    def _compute_message_hash(self, msg: dict) -> str:
        """Compute hash for message deduplication.

        Uses timestamp (rounded to second), icao_hex, label, and first 50 chars of text.
        """
        ts = msg.get("timestamp", 0)
        if isinstance(ts, float):
            ts = int(ts)  # Round to second
        icao = msg.get("icao_hex", "") or ""
        label = msg.get("label", "") or ""
        text = (msg.get("text", "") or "")[:50]

        key = f"{ts}:{icao}:{label}:{text}"
        return hashlib.md5(key.encode(), usedforsecurity=False).hexdigest()

    def _is_duplicate(self, msg: dict, source: str) -> bool:
        """Check if message is a duplicate."""
        msg_hash = self._compute_message_hash(msg)
        if self._dedup_cache.contains(msg_hash):
            with self._stats_lock:
                self._stats[source]["duplicates"] += 1
            ACARS_DUPLICATES.labels(source=source).inc()
            return True
        self._dedup_cache.add(msg_hash)
        return False
    
    async def start(self, acars_port: int = 5550, vdlm2_port: int = 5555):
        """Start listening for ACARS and VDL2 messages."""
        if self._running:
            logger.warning("ACARS service already running, ignoring start request")
            return

        self._running = True
        logger.info("Starting ACARS service...")

        # Start UDP listeners
        if acars_port:
            self._acars_task = asyncio.create_task(
                self._udp_listener(acars_port, "acars")
            )
            logger.info(f"ACARS UDP listener started on 0.0.0.0:{acars_port}")

        if vdlm2_port:
            self._vdlm2_task = asyncio.create_task(
                self._udp_listener(vdlm2_port, "vdlm2")
            )
            logger.info(f"VDL2 UDP listener started on 0.0.0.0:{vdlm2_port}")

        logger.info("ACARS service started successfully")
    
    async def stop(self):
        """Stop all listeners."""
        logger.info("Stopping ACARS service...")
        self._running = False

        if self._acars_task:
            self._acars_task.cancel()
            try:
                await self._acars_task
            except asyncio.CancelledError:
                pass
            logger.debug("ACARS listener stopped")

        if self._vdlm2_task:
            self._vdlm2_task.cancel()
            try:
                await self._vdlm2_task
            except asyncio.CancelledError:
                pass
            logger.debug("VDL2 listener stopped")

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
        service = self  # Capture reference for inner class

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

                asyncio.create_task(
                    self.service._process_message(data, self.source)
                )

            def error_received(self, exc):
                logger.error(f"UDP error on {self.source} listener: {exc}")

        try:
            transport, protocol = await loop.create_datagram_endpoint(
                lambda: UDPProtocol(service, source),
                local_addr=('0.0.0.0', port)
            )
            logger.debug(f"UDP endpoint created for {source} on port {port}")
        except Exception as e:
            logger.error(f"Failed to create UDP listener for {source} on port {port}: {e}")
            return

        try:
            while self._running:
                await asyncio.sleep(1)
        finally:
            transport.close()
            logger.debug(f"UDP transport closed for {source}")
    
    async def _process_message(self, data: bytes, source: str):
        """Process a received message."""
        try:
            # Parse JSON message
            raw_text = data.decode('utf-8')
            msg = json.loads(raw_text)

            # Debug: log raw message keys to help troubleshoot format issues
            logger.debug(f"Received {source} message with keys: {list(msg.keys())}")

            # Normalize message format
            normalized = self._normalize_message(msg, source)

            if normalized:
                # Check for duplicate messages
                if self._is_duplicate(normalized, source):
                    logger.debug(f"Duplicate {source} message filtered")
                    return

                # Track frequency statistics
                freq = normalized.get('frequency')
                if freq:
                    freq_mhz = f"{freq:.3f}"
                    with self._stats_lock:
                        self._frequency_counts[freq_mhz] += 1
                    ACARS_FREQUENCY_MESSAGES.labels(frequency_mhz=freq_mhz).inc()

                # Enrich message with airline and label info
                enriched = enrich_acars_message(normalized)

                # Track decode success/failure metrics
                label = normalized.get('label') or 'unknown'
                decoded_text = enriched.get('decoded_text', {})
                if decoded_text and decoded_text.get('message_type'):
                    msg_type = decoded_text.get('message_type', 'unknown')
                    decoder = 'libacars' if decoded_text.get('libacars_decoded') else 'regex'
                    ACARS_DECODE_SUCCESS.labels(decoder=decoder, message_type=msg_type).inc()
                else:
                    ACARS_DECODE_FAILURE.labels(label=label).inc()

                # Update statistics and Prometheus metrics
                with self._stats_lock:
                    self._stats[source]["total"] += 1
                    self._hourly_counts[source].append(datetime.utcnow())
                    total = self._stats[source]["total"]
                ACARS_MESSAGES_RECEIVED.labels(source=source).inc()

                # Add to recent buffer
                with self._recent_lock:
                    self._recent_messages.append(enriched)
                    if len(self._recent_messages) > self._max_recent:
                        self._recent_messages.pop(0)

                # Persist to database if session factory is configured
                if self._db_session_factory:
                    try:
                        async with self._db_session_factory() as db:
                            await store_acars_message(db, enriched)
                    except Exception as e:
                        logger.warning(f"Failed to persist {source} message: {e}")

                # Publish to SSE
                if self._sse_callback:
                    await self._sse_callback(enriched)

                # Log message details
                flight = normalized.get('callsign') or normalized.get('registration') or 'unknown'
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
                ACARS_ERRORS.labels(source=source, error_type="normalize_failed").inc()

        except json.JSONDecodeError as e:
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            ACARS_ERRORS.labels(source=source, error_type="json_decode").inc()
            # Log first 100 chars of bad data for debugging
            preview = data[:100].decode('utf-8', errors='replace')
            logger.warning(f"Invalid JSON from {source}: {e} | Data preview: {preview!r}")
        except UnicodeDecodeError as e:
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            ACARS_ERRORS.labels(source=source, error_type="unicode_decode").inc()
            logger.warning(f"Unicode decode error from {source}: {e}")
        except Exception as e:
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            ACARS_ERRORS.labels(source=source, error_type="unknown").inc()
            sentry_sdk.capture_exception(e)
            logger.error(f"Error processing {source} message: {e}", exc_info=True)
    
    def _normalize_message(self, msg: dict, source: str) -> Optional[dict]:
        """Normalize message to common format.

        Handles message formats from acars_router which forwards messages from:
        - acarsdec: flat JSON with fields like timestamp, freq, tail, flight, text, etc.
        - vdlm2dec/dumpvdl2: can be flat or nested with vdl2/avlc/acars structure
        """
        try:
            # ACARS format from acarsdec via acars_router
            # Fields: timestamp, station_id, channel, freq, level, noise, error, mode, label,
            #         tail, flight, msgno, block_id, ack, text, end, sublabel, mfi, depa, dsta,
            #         eta, gtout, gtin, wloff, wlin, libacars, app{name,ver}
            if source == "acars":
                # Get ICAO from various possible fields
                icao = msg.get("icao") or msg.get("icao_hex") or msg.get("hex")
                if icao:
                    icao = str(icao).upper()

                # Get station_id from message or app info
                station_id = msg.get("station_id")
                if not station_id:
                    app = msg.get("app", {})
                    if isinstance(app, dict):
                        station_id = app.get("name")

                # ack can be False (bool) or a string - convert to string if present
                ack_val = msg.get("ack")
                if ack_val is not None:
                    ack_val = str(ack_val) if ack_val else None

                return {
                    "timestamp": msg.get("timestamp", datetime.utcnow().timestamp()),
                    "source": "acars",
                    "channel": str(msg.get("channel", "")),
                    "frequency": msg.get("freq"),
                    "icao_hex": icao,
                    "registration": msg.get("tail"),
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
                    # Additional fields from acarsdec
                    "depa": msg.get("depa"),
                    "dsta": msg.get("dsta"),
                    "eta": msg.get("eta"),
                    "libacars": msg.get("libacars"),
                }

            # VDL2 format from vdlm2dec/dumpvdl2 via acars_router
            # Can be flat (vdlm2dec style) or nested (dumpvdl2 style with vdl2/avlc/acars)
            elif source == "vdlm2":
                # Check if it's dumpvdl2 nested format or vdlm2dec flat format
                if "vdl2" in msg:
                    # dumpvdl2 nested format: {"vdl2": {"freq": ..., "avlc": {"acars": {...}}}}
                    vdl2 = msg.get("vdl2", {})
                    avlc = vdl2.get("avlc", {})
                    acars_data = avlc.get("acars", {})

                    # Get ICAO from src address
                    icao = None
                    src = avlc.get("src", {})
                    if isinstance(src, dict):
                        icao = src.get("addr")
                    if icao:
                        icao = str(icao).upper()

                    # Get station_id
                    station_id = msg.get("station_id")
                    if not station_id:
                        app = msg.get("app", {})
                        if isinstance(app, dict):
                            station_id = app.get("name")

                    # ack can be False (bool) or a string - convert to string if present
                    ack_val = acars_data.get("ack")
                    if ack_val is not None:
                        ack_val = str(ack_val) if ack_val else None

                    return {
                        "timestamp": msg.get("timestamp", vdl2.get("t", {}).get("sec", datetime.utcnow().timestamp())),
                        "source": "vdlm2",
                        "channel": str(vdl2.get("channel", vdl2.get("idx", ""))),
                        "frequency": vdl2.get("freq"),
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
                        "error_count": vdl2.get("noise_level"),
                        "station_id": station_id,
                        "libacars": msg.get("libacars") or vdl2.get("libacars"),
                    }
                else:
                    # vdlm2dec flat format (similar to acarsdec)
                    # Fields: timestamp, freq, icao/hex, tail, flight, label, mode, text, etc.
                    icao = msg.get("icao") or msg.get("hex") or msg.get("icao_hex")
                    if icao:
                        # Handle numeric ICAO from vdlm2dec
                        if isinstance(icao, int):
                            icao = format(icao, '06X')
                        else:
                            icao = str(icao).upper()

                    # Get station_id
                    station_id = msg.get("station_id")
                    if not station_id:
                        app = msg.get("app", {})
                        if isinstance(app, dict):
                            station_id = app.get("name")

                    # ack can be False (bool) or a string - convert to string if present
                    ack_val = msg.get("ack")
                    if ack_val is not None:
                        ack_val = str(ack_val) if ack_val else None

                    return {
                        "timestamp": msg.get("timestamp", datetime.utcnow().timestamp()),
                        "source": "vdlm2",
                        "channel": str(msg.get("channel", "")),
                        "frequency": msg.get("freq"),
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

        except Exception as e:
            logger.error(f"Error normalizing {source} message: {e}", exc_info=True)
            return None

    def get_recent_messages(self, limit: int = 50) -> list[dict]:
        """Get recent messages from buffer."""
        with self._recent_lock:
            return list(reversed(self._recent_messages[-limit:]))
    
    def get_stats(self) -> dict:
        """Get ACARS service statistics."""
        now = datetime.utcnow()
        hour_ago = now - timedelta(hours=1)

        with self._stats_lock:
            # Clean up old hourly counts
            for source in ["acars", "vdlm2"]:
                self._hourly_counts[source] = [
                    t for t in self._hourly_counts[source] if t > hour_ago
                ]
                self._stats[source]["last_hour"] = len(self._hourly_counts[source])

            # Get top frequencies by message count
            top_frequencies = sorted(
                self._frequency_counts.items(),
                key=lambda x: x[1],
                reverse=True
            )[:10]

            return {
                "acars": dict(self._stats["acars"]),
                "vdlm2": dict(self._stats["vdlm2"]),
                "running": self._running,
                "recent_buffer_size": len(self._recent_messages),
                "dedup_cache_size": self._dedup_cache.size(),
                "top_frequencies": [
                    {"frequency_mhz": f, "count": c} for f, c in top_frequencies
                ],
            }


# Global instance
acars_service = AcarsService()


async def store_acars_message(db: AsyncSession, msg: dict) -> Optional[int]:
    """Store an ACARS message in the database."""
    try:
        # Parse timestamp
        ts = msg.get("timestamp")
        if isinstance(ts, (int, float)):
            ts = datetime.utcfromtimestamp(ts)
        elif isinstance(ts, str):
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        else:
            ts = datetime.utcnow()

        record = AcarsMessage(
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
            decoded=msg.get("decoded"),
            signal_level=msg.get("signal_level"),
            error_count=msg.get("error_count"),
            station_id=msg.get("station_id"),
        )

        db.add(record)
        await db.commit()
        await db.refresh(record)

        logger.debug(
            f"Stored {msg.get('source', 'acars')} message id={record.id} "
            f"flight={msg.get('callsign') or msg.get('registration') or 'N/A'}"
        )
        return record.id

    except Exception as e:
        logger.error(f"Error storing ACARS message: {e}", exc_info=True)
        await db.rollback()
        return None


async def get_acars_messages(
    db: AsyncSession,
    icao_hex: Optional[str] = None,
    callsign: Optional[str] = None,
    airline: Optional[str] = None,
    label: Optional[str] = None,
    source: Optional[str] = None,
    hours: int = 24,
    limit: int = 100,
) -> list[dict]:
    """Query ACARS messages from database."""
    from sqlalchemy import or_

    query = select(AcarsMessage).order_by(AcarsMessage.timestamp.desc())

    # Apply filters
    if icao_hex:
        query = query.where(AcarsMessage.icao_hex == icao_hex.upper())
    if callsign:
        query = query.where(AcarsMessage.callsign.ilike(f"%{callsign}%"))
    if airline:
        # Match airline code at start of callsign (ICAO 3-letter or IATA 2-letter)
        airline_upper = airline.upper()
        query = query.where(
            or_(
                AcarsMessage.callsign.ilike(f"{airline_upper}%"),
                AcarsMessage.callsign.ilike(f"{airline_upper[:2]}%") if len(airline_upper) >= 2 else False
            )
        )
    if label:
        # Support comma-separated labels
        labels = [l.strip() for l in label.split(",")]
        if len(labels) == 1:
            query = query.where(AcarsMessage.label == labels[0])
        else:
            query = query.where(AcarsMessage.label.in_(labels))
    if source:
        query = query.where(AcarsMessage.source == source)
    
    # Time filter
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    query = query.where(AcarsMessage.timestamp > cutoff)
    
    # Limit
    query = query.limit(limit)
    
    result = await db.execute(query)
    messages = []

    for msg in result.scalars():
        msg_dict = {
            "id": msg.id,
            "timestamp": msg.timestamp.isoformat() + "Z",
            "source": msg.source,
            "channel": msg.channel,
            "frequency": msg.frequency,
            "icao_hex": msg.icao_hex,
            "registration": msg.registration,
            "callsign": msg.callsign,
            "label": msg.label,
            "block_id": msg.block_id,
            "msg_num": msg.msg_num,
            "ack": msg.ack,
            "mode": msg.mode,
            "text": msg.text,
            "decoded": msg.decoded,
            "signal_level": msg.signal_level,
            "error_count": msg.error_count,
            "station_id": msg.station_id,
        }

        # Enrich with airline and label info
        enriched = enrich_acars_message(msg_dict)
        messages.append(enriched)

    return messages


async def get_acars_stats(
    db: AsyncSession,
    hours: int = 24,
    source: str = None,
    label: str = None,
    icao_hex: str = None,
    callsign: str = None
) -> dict:
    """Get ACARS database statistics with optional filters."""
    from sqlalchemy import and_

    now = datetime.utcnow()
    hour_ago = now - timedelta(hours=1)
    cutoff = now - timedelta(hours=hours)

    filters_applied = {}

    # Build base conditions
    base_conditions = [AcarsMessage.timestamp > cutoff]
    if source:
        base_conditions.append(AcarsMessage.source == source)
        filters_applied["source"] = source
    if label:
        labels = [l.strip() for l in label.split(",")]
        if len(labels) == 1:
            base_conditions.append(AcarsMessage.label == labels[0])
        else:
            base_conditions.append(AcarsMessage.label.in_(labels))
        filters_applied["label"] = labels
    if icao_hex:
        base_conditions.append(AcarsMessage.icao_hex == icao_hex.upper())
        filters_applied["icao_hex"] = icao_hex.upper()
    if callsign:
        base_conditions.append(AcarsMessage.callsign.ilike(f"%{callsign}%"))
        filters_applied["callsign"] = callsign

    # Total messages (all time, no filters except source/label/icao)
    total = (await db.execute(select(func.count(AcarsMessage.id)))).scalar()

    # Count with filters
    filtered_count = (await db.execute(
        select(func.count(AcarsMessage.id)).where(and_(*base_conditions))
    )).scalar()

    # Last hour (with filters)
    hour_conditions = base_conditions.copy()
    hour_conditions[0] = AcarsMessage.timestamp > hour_ago
    last_hour = (await db.execute(
        select(func.count(AcarsMessage.id)).where(and_(*hour_conditions))
    )).scalar()

    # Count by source (within time range)
    acars_count = (await db.execute(
        select(func.count(AcarsMessage.id)).where(
            and_(AcarsMessage.timestamp > cutoff, AcarsMessage.source == "acars")
        )
    )).scalar()

    vdlm2_count = (await db.execute(
        select(func.count(AcarsMessage.id)).where(
            and_(AcarsMessage.timestamp > cutoff, AcarsMessage.source == "vdlm2")
        )
    )).scalar()

    # Top labels (with filters)
    label_query = await db.execute(
        select(AcarsMessage.label, func.count(AcarsMessage.id).label("count"))
        .where(and_(*base_conditions))
        .group_by(AcarsMessage.label)
        .order_by(func.count(AcarsMessage.id).desc())
        .limit(10)
    )
    top_labels = [{"label": r[0], "count": r[1]} for r in label_query if r[0]]

    # Top aircraft by message count
    aircraft_query = await db.execute(
        select(
            AcarsMessage.icao_hex,
            AcarsMessage.callsign,
            func.count(AcarsMessage.id).label("count")
        )
        .where(and_(*base_conditions, AcarsMessage.icao_hex.isnot(None)))
        .group_by(AcarsMessage.icao_hex, AcarsMessage.callsign)
        .order_by(func.count(AcarsMessage.id).desc())
        .limit(10)
    )
    top_aircraft = [
        {"icao_hex": r[0], "callsign": r[1], "count": r[2]}
        for r in aircraft_query if r[0]
    ]

    # Top airlines by message count (extracted from callsigns)
    # Group by first 3 characters of callsign (ICAO code) or first 2 (IATA code)
    from app.data.airlines import find_airline_by_icao, find_airline_by_iata

    airline_query = await db.execute(
        select(
            AcarsMessage.callsign,
            func.count(AcarsMessage.id).label("count")
        )
        .where(and_(*base_conditions, AcarsMessage.callsign.isnot(None)))
        .group_by(AcarsMessage.callsign)
    )

    # Aggregate by airline
    # Note: find_airline_by_icao returns (iata_code, name) tuple
    #       find_airline_by_iata returns (icao_code, name) tuple
    airline_counts = {}
    for row in airline_query:
        callsign = row[0]
        count = row[1]
        if not callsign:
            continue

        # Try to extract airline code from callsign
        key = None
        icao_code = None
        iata_code = None
        airline_name = None

        if len(callsign) >= 3 and callsign[:3].isalpha():
            # Try ICAO (3-letter) first
            icao_code = callsign[:3].upper()
            iata_result, name_result = find_airline_by_icao(icao_code)
            if name_result != "Unknown Airline":
                key = icao_code
                iata_code = iata_result if iata_result != icao_code else None
                airline_name = name_result

        if not key and len(callsign) >= 2:
            # Try IATA (2-letter)
            iata_code = callsign[:2].upper()
            icao_result, name_result = find_airline_by_iata(iata_code)
            if name_result != "Unknown Airline":
                key = icao_result
                icao_code = icao_result if icao_result != iata_code else None
                airline_name = name_result

        if key and airline_name:
            if key not in airline_counts:
                airline_counts[key] = {
                    "icao": icao_code,
                    "iata": iata_code,
                    "name": airline_name,
                    "count": 0
                }
            airline_counts[key]["count"] += count

    # Sort by count and take top 10
    top_airlines = sorted(
        airline_counts.values(),
        key=lambda x: x["count"],
        reverse=True
    )[:10]

    # Hourly distribution
    hour_trunc = func.date_trunc('hour', AcarsMessage.timestamp)
    hourly_query = await db.execute(
        select(
            hour_trunc.label('hour'),
            func.count(AcarsMessage.id).label('count')
        )
        .where(and_(*base_conditions))
        .group_by(hour_trunc)
        .order_by(hour_trunc)
    )
    hourly_distribution = [
        {"hour": r[0].isoformat() + "Z" if r[0] else None, "count": r[1]}
        for r in hourly_query
    ]

    return {
        "total_messages": total,
        "filtered_count": filtered_count,
        "last_hour": last_hour,
        "last_24h": filtered_count if hours == 24 else None,
        "time_range_hours": hours,
        "by_source": {
            "acars": acars_count,
            "vdlm2": vdlm2_count,
        },
        "top_labels": top_labels,
        "top_aircraft": top_aircraft,
        "top_airlines": top_airlines,
        "hourly_distribution": hourly_distribution,
        "service_stats": acars_service.get_stats(),
        "filters_applied": filters_applied if filters_applied else None,
    }


async def cleanup_old_messages(db: AsyncSession, days: int = 7) -> int:
    """Delete messages older than specified days."""
    cutoff = datetime.utcnow() - timedelta(days=days)

    logger.info(f"Cleaning up ACARS messages older than {days} days (before {cutoff.isoformat()})")

    result = await db.execute(
        delete(AcarsMessage).where(AcarsMessage.timestamp < cutoff)
    )
    await db.commit()

    deleted = result.rowcount
    if deleted > 0:
        logger.info(f"Deleted {deleted} old ACARS messages")
    else:
        logger.debug("No old ACARS messages to delete")

    return deleted
