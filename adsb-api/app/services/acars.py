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
import json
import logging
from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict
import threading

from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_settings
from app.models import AcarsMessage

logger = logging.getLogger(__name__)
settings = get_settings()


class AcarsService:
    """Service for receiving and processing ACARS/VDL2 messages."""
    
    def __init__(self):
        self._running = False
        self._acars_task: Optional[asyncio.Task] = None
        self._vdlm2_task: Optional[asyncio.Task] = None
        
        # Statistics
        self._stats_lock = threading.Lock()
        self._stats = {
            "acars": {"total": 0, "last_hour": 0, "errors": 0},
            "vdlm2": {"total": 0, "last_hour": 0, "errors": 0},
        }
        self._hourly_counts: dict[str, list] = defaultdict(list)
        
        # Recent messages buffer for SSE
        self._recent_messages: list[dict] = []
        self._recent_lock = threading.Lock()
        self._max_recent = 100
        
        # Callback for SSE publishing
        self._sse_callback = None
    
    def set_sse_callback(self, callback):
        """Set callback function for publishing to SSE."""
        self._sse_callback = callback
    
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
                # Update statistics
                with self._stats_lock:
                    self._stats[source]["total"] += 1
                    self._hourly_counts[source].append(datetime.utcnow())
                    total = self._stats[source]["total"]

                # Add to recent buffer
                with self._recent_lock:
                    self._recent_messages.append(normalized)
                    if len(self._recent_messages) > self._max_recent:
                        self._recent_messages.pop(0)

                # Publish to SSE
                if self._sse_callback:
                    await self._sse_callback(normalized)

                # Log message details
                flight = normalized.get('callsign') or normalized.get('registration') or 'unknown'
                label = normalized.get('label') or '-'
                freq = normalized.get('frequency')
                freq_str = f"{freq:.3f}MHz" if freq else "unknown freq"
                logger.debug(f"[{source.upper()}] #{total} {flight} label={label} @ {freq_str}")

                # Periodic info-level summary
                if total == 1:
                    logger.info(f"First {source.upper()} message received: {flight}")
                elif total % 100 == 0:
                    errors = self._stats[source]["errors"]
                    logger.info(f"{source.upper()} milestone: {total} messages processed ({errors} errors)")
            else:
                logger.warning(f"Failed to normalize {source} message: {list(msg.keys())}")

        except json.JSONDecodeError as e:
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            # Log first 100 chars of bad data for debugging
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
                    "ack": msg.get("ack"),
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
                        "ack": acars_data.get("ack"),
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
                        "ack": msg.get("ack"),
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
            
            return {
                "acars": dict(self._stats["acars"]),
                "vdlm2": dict(self._stats["vdlm2"]),
                "running": self._running,
                "recent_buffer_size": len(self._recent_messages),
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
    label: Optional[str] = None,
    source: Optional[str] = None,
    hours: int = 24,
    limit: int = 100,
) -> list[dict]:
    """Query ACARS messages from database."""
    
    query = select(AcarsMessage).order_by(AcarsMessage.timestamp.desc())
    
    # Apply filters
    if icao_hex:
        query = query.where(AcarsMessage.icao_hex == icao_hex.upper())
    if callsign:
        query = query.where(AcarsMessage.callsign.ilike(f"%{callsign}%"))
    if label:
        query = query.where(AcarsMessage.label == label)
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
        messages.append({
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
        })
    
    return messages


async def get_acars_stats(db: AsyncSession) -> dict:
    """Get ACARS database statistics."""
    now = datetime.utcnow()
    hour_ago = now - timedelta(hours=1)
    day_ago = now - timedelta(days=1)
    
    total = (await db.execute(select(func.count(AcarsMessage.id)))).scalar()
    
    last_hour = (await db.execute(
        select(func.count(AcarsMessage.id)).where(AcarsMessage.timestamp > hour_ago)
    )).scalar()
    
    last_24h = (await db.execute(
        select(func.count(AcarsMessage.id)).where(AcarsMessage.timestamp > day_ago)
    )).scalar()
    
    # Count by source
    acars_count = (await db.execute(
        select(func.count(AcarsMessage.id)).where(AcarsMessage.source == "acars")
    )).scalar()
    
    vdlm2_count = (await db.execute(
        select(func.count(AcarsMessage.id)).where(AcarsMessage.source == "vdlm2")
    )).scalar()
    
    # Top labels
    label_query = await db.execute(
        select(AcarsMessage.label, func.count(AcarsMessage.id).label("count"))
        .where(AcarsMessage.timestamp > day_ago)
        .group_by(AcarsMessage.label)
        .order_by(func.count(AcarsMessage.id).desc())
        .limit(10)
    )
    top_labels = [{"label": r[0], "count": r[1]} for r in label_query if r[0]]
    
    return {
        "total_messages": total,
        "last_hour": last_hour,
        "last_24h": last_24h,
        "by_source": {
            "acars": acars_count,
            "vdlm2": vdlm2_count,
        },
        "top_labels": top_labels,
        "service_stats": acars_service.get_stats(),
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
