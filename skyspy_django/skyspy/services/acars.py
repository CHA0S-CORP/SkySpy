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
import threading
from collections import defaultdict, OrderedDict
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Optional

from django.conf import settings
from django.utils import timezone as dj_timezone
from channels.layers import get_channel_layer

from skyspy.services.acars_decoder import enrich_acars_message

logger = logging.getLogger(__name__)


def _normalize_frequency(freq) -> Optional[float]:
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
            ts = int(ts)  # Round to second
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

                # Enrich message with airline and label info
                enriched = enrich_acars_message(normalized)

                # Update statistics
                with self._stats_lock:
                    self._stats[source]["total"] += 1
                    self._hourly_counts[source].append(datetime.now(dt_timezone.utc))
                    total = self._stats[source]["total"]

                # Add to recent buffer
                with self._recent_lock:
                    self._recent_messages.append(enriched)
                    if len(self._recent_messages) > self._max_recent:
                        self._recent_messages.pop(0)

                # Persist to database
                await self._store_message(enriched)

                # Broadcast via Channels
                await self._broadcast_message(enriched)

                # Log message details
                flight = normalized.get('callsign') or normalized.get('registration') or 'unknown'
                label = normalized.get('label') or 'unknown'
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
            preview = data[:100].decode('utf-8', errors='replace')
            logger.warning(f"Invalid JSON from {source}: {e} | Data preview: {preview!r}")
        except UnicodeDecodeError as e:
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            logger.warning(f"Unicode decode error from {source}: {e}")
        except Exception as e:
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            logger.error(f"Error processing {source} message: {e}", exc_info=True)

    def _normalize_message(self, msg: dict, source: str) -> Optional[dict]:
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
                    "timestamp": msg.get("timestamp", datetime.now(dt_timezone.utc).timestamp()),
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
                        "timestamp": msg.get("timestamp", vdl2.get("t", {}).get("sec", datetime.now(dt_timezone.utc).timestamp())),
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
                        "error_count": vdl2.get("noise_level"),
                        "station_id": station_id,
                        "libacars": msg.get("libacars") or vdl2.get("libacars"),
                    }
                else:
                    # vdlm2dec flat format
                    icao = msg.get("icao") or msg.get("hex") or msg.get("icao_hex")
                    if icao:
                        if isinstance(icao, int):
                            icao = format(icao, '06X')
                        else:
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
                        "timestamp": msg.get("timestamp", datetime.now(dt_timezone.utc).timestamp()),
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

        except Exception as e:
            logger.error(f"Error normalizing {source} message: {e}", exc_info=True)
            return None

    async def _store_message(self, msg: dict):
        """Store an ACARS message in the database."""
        from skyspy.models import AcarsMessage
        from asgiref.sync import sync_to_async

        try:
            # Parse timestamp
            ts = msg.get("timestamp")
            if isinstance(ts, (int, float)):
                ts = datetime.fromtimestamp(ts, tz=dt_timezone.utc)
            elif isinstance(ts, str):
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            else:
                ts = datetime.now(dt_timezone.utc)

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
                    decoded=msg.get("decoded_text"),
                    signal_level=msg.get("signal_level"),
                    error_count=msg.get("error_count"),
                    station_id=msg.get("station_id"),
                )

            record = await create_record()
            logger.debug(
                f"Stored {msg.get('source', 'acars')} message id={record.id} "
                f"flight={msg.get('callsign') or msg.get('registration') or 'N/A'}"
            )

        except Exception as e:
            logger.error(f"Error storing ACARS message: {e}", exc_info=True)

    async def _broadcast_message(self, msg: dict):
        """Broadcast ACARS message to WebSocket clients."""
        try:
            channel_layer = get_channel_layer()

            # Add timestamp if not present
            if 'timestamp' not in msg or not isinstance(msg['timestamp'], str):
                ts = msg.get('timestamp')
                if isinstance(ts, (int, float)):
                    msg['timestamp'] = datetime.fromtimestamp(ts, tz=dt_timezone.utc).isoformat().replace('+00:00', 'Z')
                else:
                    msg['timestamp'] = datetime.now(dt_timezone.utc).isoformat().replace('+00:00', 'Z')

            await channel_layer.group_send(
                'acars_all',
                {
                    'type': 'acars_message',
                    'data': msg
                }
            )

            # Also send to aircraft-specific group if we have ICAO
            icao = msg.get('icao_hex')
            if icao:
                await channel_layer.group_send(
                    f'acars_{icao.lower()}',
                    {
                        'type': 'acars_message',
                        'data': msg
                    }
                )

        except Exception as e:
            logger.warning(f"Failed to broadcast ACARS message: {e}")

    def get_recent_messages(self, limit: int = 50) -> list[dict]:
        """Get recent messages from buffer."""
        with self._recent_lock:
            return list(reversed(self._recent_messages[-limit:]))

    def get_stats(self) -> dict:
        """Get ACARS service statistics."""
        now = datetime.now(dt_timezone.utc)
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


# Global singleton
acars_service = AcarsService()
