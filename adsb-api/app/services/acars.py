"""
ACARS and VDL2 message service.
Receives messages from acarsdec/vdlm2dec via acars_router.

acars_router configuration:
  The acars_router container outputs JSON messages over UDP or TCP.
  Configure it to send to this API.

  Example docker-compose for acars_router:
  
  acars_router:
    image: ghcr.io/sdr-enthusiasts/docker-acarshub:latest
    environment:
      - FEED_ID=my-station
      - ENABLE_ACARS=true
      - ENABLE_VDLM2=true
      # Output to our API
      - AR_SEND_UDP_ACARS=adsb-api:5555
      - AR_SEND_UDP_VDLM2=adsb-api:5556
    depends_on:
      - adsb-api
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
    
    async def start(self, acars_port: int = 5555, vdlm2_port: int = 5556):
        """Start listening for ACARS and VDL2 messages."""
        if self._running:
            return
        
        self._running = True
        
        # Start UDP listeners
        if acars_port:
            self._acars_task = asyncio.create_task(
                self._udp_listener(acars_port, "acars")
            )
            logger.info(f"ACARS UDP listener started on port {acars_port}")
        
        if vdlm2_port:
            self._vdlm2_task = asyncio.create_task(
                self._udp_listener(vdlm2_port, "vdlm2")
            )
            logger.info(f"VDL2 UDP listener started on port {vdlm2_port}")
    
    async def stop(self):
        """Stop all listeners."""
        self._running = False
        
        if self._acars_task:
            self._acars_task.cancel()
            try:
                await self._acars_task
            except asyncio.CancelledError:
                pass
        
        if self._vdlm2_task:
            self._vdlm2_task.cancel()
            try:
                await self._vdlm2_task
            except asyncio.CancelledError:
                pass
        
        logger.info("ACARS service stopped")
    
    async def _udp_listener(self, port: int, source: str):
        """Listen for UDP messages on a port."""
        loop = asyncio.get_event_loop()
        
        class UDPProtocol(asyncio.DatagramProtocol):
            def __init__(self, service, source):
                self.service = service
                self.source = source
            
            def datagram_received(self, data, addr):
                asyncio.create_task(
                    self.service._process_message(data, self.source)
                )
        
        transport, protocol = await loop.create_datagram_endpoint(
            lambda: UDPProtocol(self, source),
            local_addr=('0.0.0.0', port)
        )
        
        try:
            while self._running:
                await asyncio.sleep(1)
        finally:
            transport.close()
    
    async def _process_message(self, data: bytes, source: str):
        """Process a received message."""
        try:
            # Parse JSON message
            msg = json.loads(data.decode('utf-8'))
            
            # Normalize message format
            normalized = self._normalize_message(msg, source)
            
            if normalized:
                # Update statistics
                with self._stats_lock:
                    self._stats[source]["total"] += 1
                    self._hourly_counts[source].append(datetime.utcnow())
                
                # Add to recent buffer
                with self._recent_lock:
                    self._recent_messages.append(normalized)
                    if len(self._recent_messages) > self._max_recent:
                        self._recent_messages.pop(0)
                
                # Publish to SSE
                if self._sse_callback:
                    await self._sse_callback(normalized)
                
                logger.debug(f"Processed {source} message: {normalized.get('callsign', 'N/A')}")
        
        except json.JSONDecodeError as e:
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            logger.warning(f"Invalid JSON from {source}: {e}")
        except Exception as e:
            with self._stats_lock:
                self._stats[source]["errors"] += 1
            logger.error(f"Error processing {source} message: {e}")
    
    def _normalize_message(self, msg: dict, source: str) -> Optional[dict]:
        """Normalize message to common format."""
        try:
            # Handle different message formats from acarsdec/vdlm2dec
            
            # ACARS format from acarsdec
            if source == "acars":
                return {
                    "timestamp": msg.get("timestamp", datetime.utcnow().timestamp()),
                    "source": "acars",
                    "channel": str(msg.get("channel", "")),
                    "frequency": msg.get("freq"),
                    "icao_hex": msg.get("icao", "").upper() if msg.get("icao") else None,
                    "registration": msg.get("tail", msg.get("reg")),
                    "callsign": msg.get("flight", "").strip() if msg.get("flight") else None,
                    "label": msg.get("label"),
                    "block_id": msg.get("block_id"),
                    "msg_num": msg.get("msgno"),
                    "ack": msg.get("ack"),
                    "mode": msg.get("mode"),
                    "text": msg.get("text", msg.get("message", "")),
                    "signal_level": msg.get("level"),
                    "error_count": msg.get("err"),
                    "station_id": msg.get("station_id", msg.get("app", {}).get("name")),
                }
            
            # VDL2 format from vdlm2dec
            elif source == "vdlm2":
                vdl2 = msg.get("vdl2", msg)
                avlc = vdl2.get("avlc", {})
                acars = avlc.get("acars", {})
                
                return {
                    "timestamp": msg.get("timestamp", datetime.utcnow().timestamp()),
                    "source": "vdlm2",
                    "channel": str(vdl2.get("channel", "")),
                    "frequency": vdl2.get("freq"),
                    "icao_hex": avlc.get("src", {}).get("addr", "").upper() if avlc.get("src") else None,
                    "registration": acars.get("reg", "").replace(".", "") if acars.get("reg") else None,
                    "callsign": acars.get("flight", "").strip() if acars.get("flight") else None,
                    "label": acars.get("label"),
                    "block_id": acars.get("blk_id"),
                    "msg_num": acars.get("msg_num"),
                    "ack": acars.get("ack"),
                    "mode": acars.get("mode"),
                    "text": acars.get("msg_text", ""),
                    "signal_level": vdl2.get("sig_level"),
                    "error_count": vdl2.get("noise_level"),
                    "station_id": msg.get("station_id", msg.get("app", {}).get("name")),
                }
            
            return None
        
        except Exception as e:
            logger.error(f"Error normalizing {source} message: {e}")
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
        return record.id
    
    except Exception as e:
        logger.error(f"Error storing ACARS message: {e}")
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
    
    result = await db.execute(
        delete(AcarsMessage).where(AcarsMessage.timestamp < cutoff)
    )
    await db.commit()
    
    return result.rowcount
