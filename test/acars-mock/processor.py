#!/usr/bin/env python3
"""
Example ACARS Processor Service

This is a simple example service that demonstrates how to receive and process
ACARS messages from the acarshub-mock service (or real ACARSHUB).

It receives messages via UDP and provides a simple REST API for querying them.
Replace this with your actual processing logic.
"""

import asyncio
import json
import logging
import os
import socket
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

# Configuration
UDP_PORT = int(os.getenv("UDP_PORT", "5000"))
API_PORT = int(os.getenv("API_PORT", "5001"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
MAX_MESSAGES = int(os.getenv("MAX_MESSAGES", "500"))

# Logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("acars-processor")


class MessageStore:
    """Store for received ACARS messages"""
    
    def __init__(self, max_size: int = 500):
        self.messages: deque = deque(maxlen=max_size)
        self.stats = {
            "total_received": 0,
            "acars_count": 0,
            "vdlm2_count": 0,
            "flights_seen": set(),
            "airlines_seen": set(),
        }
    
    def add(self, msg: dict):
        """Add a message and update statistics"""
        processed = self._process_message(msg)
        self.messages.append(processed)
        self.stats["total_received"] += 1
        
        # Extract message type
        if "vdl2" in msg:
            self.stats["vdlm2_count"] += 1
            acars = msg.get("vdl2", {}).get("avlc", {}).get("acars", {})
            flight = acars.get("flight", "")
        else:
            self.stats["acars_count"] += 1
            flight = msg.get("flight", "")
        
        if flight:
            self.stats["flights_seen"].add(flight)
            # Extract airline code (first 2-3 chars)
            airline = flight[:3] if len(flight) >= 3 else flight
            self.stats["airlines_seen"].add(airline)
    
    def _process_message(self, msg: dict) -> dict:
        """Process and normalize a message"""
        # Add processing timestamp
        processed = {
            "received_at": datetime.now(timezone.utc).isoformat(),
            "raw": msg,
        }
        
        # Extract common fields based on message type
        if "vdl2" in msg:
            acars = msg.get("vdl2", {}).get("avlc", {}).get("acars", {})
            processed["type"] = "vdlm2"
            processed["tail"] = acars.get("reg", "").lstrip(".")
            processed["flight"] = acars.get("flight", "")
            processed["label"] = acars.get("label", "")
            processed["text"] = acars.get("msg_text", "")
            processed["frequency"] = msg.get("vdl2", {}).get("freq", 0) / 1000000
        else:
            processed["type"] = "acars"
            processed["tail"] = msg.get("tail", "")
            processed["flight"] = msg.get("flight", "")
            processed["label"] = msg.get("label", "")
            processed["text"] = msg.get("text", "")
            processed["frequency"] = msg.get("freq", 0)
        
        return processed
    
    def get_stats(self) -> dict:
        return {
            "total_received": self.stats["total_received"],
            "acars_count": self.stats["acars_count"],
            "vdlm2_count": self.stats["vdlm2_count"],
            "unique_flights": len(self.stats["flights_seen"]),
            "unique_airlines": len(self.stats["airlines_seen"]),
            "buffer_size": len(self.messages),
        }
    
    def get_messages(self, limit: int = 50) -> list:
        return list(self.messages)[-limit:]
    
    def search(self, flight: Optional[str] = None, tail: Optional[str] = None) -> list:
        results = []
        for msg in self.messages:
            if flight and flight.upper() in msg.get("flight", "").upper():
                results.append(msg)
            elif tail and tail.upper() in msg.get("tail", "").upper():
                results.append(msg)
        return results


store = MessageStore(MAX_MESSAGES)


class UDPReceiver:
    """Async UDP receiver for ACARS messages"""
    
    def __init__(self, port: int):
        self.port = port
        self.running = False
        self._task: Optional[asyncio.Task] = None
    
    async def start(self):
        self.running = True
        self._task = asyncio.create_task(self._receive_loop())
        logger.info(f"UDP receiver started on port {self.port}")
    
    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("UDP receiver stopped")
    
    async def _receive_loop(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(('0.0.0.0', self.port))
        sock.setblocking(False)
        
        loop = asyncio.get_event_loop()
        
        while self.running:
            try:
                data = await loop.sock_recv(sock, 65535)
                if data:
                    await self._handle_message(data)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error receiving UDP: {e}")
                await asyncio.sleep(0.1)
        
        sock.close()
    
    async def _handle_message(self, data: bytes):
        try:
            msg_str = data.decode('utf-8').strip()
            for line in msg_str.split('\n'):
                if line:
                    msg = json.loads(line)
                    store.add(msg)
                    
                    # Log interesting messages
                    if "vdl2" in msg:
                        acars = msg.get("vdl2", {}).get("avlc", {}).get("acars", {})
                        logger.info(f"VDLM2: {acars.get('flight', 'N/A')} - {acars.get('label', '')}")
                    else:
                        logger.info(f"ACARS: {msg.get('flight', 'N/A')} - {msg.get('label', '')}")
        
        except json.JSONDecodeError as e:
            logger.warning(f"Invalid JSON: {e}")
        except Exception as e:
            logger.error(f"Error processing message: {e}")


receiver = UDPReceiver(UDP_PORT)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    await receiver.start()
    yield
    await receiver.stop()


app = FastAPI(
    title="ACARS Processor",
    description="Example service for processing ACARS messages",
    version="1.0.0",
    lifespan=lifespan
)


@app.get("/")
async def root():
    return {
        "service": "ACARS Processor",
        "status": "running",
        "udp_port": UDP_PORT,
    }


@app.get("/api/stats")
async def get_stats():
    """Get processing statistics"""
    return store.get_stats()


@app.get("/api/messages")
async def get_messages(limit: int = 50):
    """Get recent messages"""
    return store.get_messages(limit)


@app.get("/api/search")
async def search_messages(flight: Optional[str] = None, tail: Optional[str] = None):
    """Search messages by flight or tail number"""
    if not flight and not tail:
        return {"error": "Provide 'flight' or 'tail' parameter"}
    return store.search(flight=flight, tail=tail)


@app.get("/api/flights")
async def get_flights():
    """Get list of unique flights seen"""
    return {"flights": list(store.stats["flights_seen"])}


@app.get("/api/airlines")
async def get_airlines():
    """Get list of unique airlines seen"""
    return {"airlines": list(store.stats["airlines_seen"])}


if __name__ == "__main__":
    uvicorn.run(
        "processor:app",
        host="0.0.0.0",
        port=API_PORT,
        log_level=LOG_LEVEL.lower()
    )
