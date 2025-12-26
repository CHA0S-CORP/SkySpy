"""
ACARS and VDL2 message API endpoints.

ACARS (Aircraft Communications Addressing and Reporting System) is a digital
datalink system for transmission of short messages between aircraft and ground
stations via VHF radio.

VDL Mode 2 (VHF Data Link Mode 2) is a newer, faster data link protocol
operating on dedicated frequencies.
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.services.acars import (
    acars_service, get_acars_messages, get_acars_stats, cleanup_old_messages
)
from app.schemas import (
    AcarsMessagesListResponse, AcarsStatsResponse, AcarsStatusResponse,
    AcarsLabelsReference, DeleteResponse
)

router = APIRouter(prefix="/api/v1/acars", tags=["ACARS"])


@router.get(
    "/messages",
    response_model=AcarsMessagesListResponse,
    summary="Get ACARS Messages",
    description="""
Query ACARS and VDL2 messages from the database.

Filter by:
- **icao_hex**: Aircraft ICAO 24-bit address
- **callsign**: Flight callsign (partial match)
- **label**: ACARS message label code
- **source**: Message source (acars or vdlm2)
- **hours**: Time range to query (1-168 hours)

Common ACARS labels:
- H1: Flight plan / departure clearance
- SA: Position report
- B6: Departure message
- QA: Weather request
- _d: Air-ground voice

Messages are returned newest first.
    """,
    responses={
        200: {
            "description": "List of ACARS messages",
            "content": {
                "application/json": {
                    "example": {
                        "messages": [
                            {
                                "id": 1,
                                "timestamp": "2024-12-21T12:00:00Z",
                                "source": "acars",
                                "frequency": 130.025,
                                "icao_hex": "A12345",
                                "callsign": "UAL123",
                                "label": "H1",
                                "text": "DEPARTURE CLEARANCE..."
                            }
                        ],
                        "count": 1,
                        "filters": {"hours": 24}
                    }
                }
            }
        }
    }
)
async def list_acars_messages(
    icao_hex: Optional[str] = Query(
        None,
        description="Filter by ICAO hex address",
        example="A12345"
    ),
    callsign: Optional[str] = Query(
        None,
        description="Filter by callsign (partial match)",
        example="UAL"
    ),
    label: Optional[str] = Query(
        None,
        description="Filter by ACARS label code",
        example="H1"
    ),
    source: Optional[str] = Query(
        None,
        description="Filter by source type",
        enum=["acars", "vdlm2"]
    ),
    hours: int = Query(
        24,
        ge=1,
        le=168,
        description="Hours of history to query (1-168)"
    ),
    limit: int = Query(
        100,
        ge=1,
        le=500,
        description="Maximum messages to return"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Get ACARS/VDL2 messages from the database with optional filters."""
    messages = await get_acars_messages(
        db=db,
        icao_hex=icao_hex,
        callsign=callsign,
        label=label,
        source=source,
        hours=hours,
        limit=limit,
    )
    
    return {
        "messages": messages,
        "count": len(messages),
        "filters": {
            "icao_hex": icao_hex,
            "callsign": callsign,
            "label": label,
            "source": source,
            "hours": hours,
        }
    }


@router.get(
    "/messages/recent",
    summary="Get Recent Messages (Fast)",
    description="""
Get recent ACARS messages from the in-memory buffer.

This endpoint is faster than the database query but limited to 
approximately the last 100 messages received.

Use this for real-time displays where speed is important.
    """,
    responses={
        200: {
            "description": "Recent messages from memory buffer",
            "content": {
                "application/json": {
                    "example": {
                        "messages": [
                            {
                                "timestamp": 1703145600.123,
                                "source": "acars",
                                "callsign": "UAL123",
                                "text": "POSITION REPORT..."
                            }
                        ],
                        "count": 50,
                        "source": "memory_buffer"
                    }
                }
            }
        }
    }
)
async def get_recent_messages(
    limit: int = Query(
        50,
        ge=1,
        le=100,
        description="Number of messages to return"
    )
):
    """Get recent ACARS messages from the fast in-memory buffer."""
    messages = acars_service.get_recent_messages(limit=limit)
    
    return {
        "messages": messages,
        "count": len(messages),
        "source": "memory_buffer",
    }


@router.get(
    "/messages/{icao_hex}",
    summary="Get Messages for Aircraft",
    description="""
Get all ACARS messages for a specific aircraft.

Returns messages from both ACARS and VDL2 sources for the given
ICAO hex address, sorted by timestamp (newest first).
    """,
    responses={
        200: {
            "description": "Messages for aircraft",
            "content": {
                "application/json": {
                    "example": {
                        "icao_hex": "A12345",
                        "messages": [
                            {"timestamp": "2024-12-21T12:00:00Z", "label": "H1", "text": "..."}
                        ],
                        "count": 5
                    }
                }
            }
        }
    }
)
async def get_aircraft_acars(
    icao_hex: str = Path(
        ...,
        description="ICAO 24-bit hex address",
        example="A12345"
    ),
    hours: int = Query(
        24,
        ge=1,
        le=168,
        description="Hours of history"
    ),
    limit: int = Query(
        50,
        ge=1,
        le=200,
        description="Maximum messages"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Get ACARS messages for a specific aircraft by ICAO hex."""
    messages = await get_acars_messages(
        db=db,
        icao_hex=icao_hex.upper(),
        hours=hours,
        limit=limit,
    )
    
    return {
        "icao_hex": icao_hex.upper(),
        "messages": messages,
        "count": len(messages),
    }


@router.get(
    "/stats",
    response_model=AcarsStatsResponse,
    summary="Get ACARS Statistics",
    description="""
Get comprehensive ACARS service and database statistics.

Includes:
- Total message counts (all time, last hour, last 24h)
- Breakdown by source (ACARS vs VDL2)
- Top 10 most common message labels
- Real-time receiver service statistics
    """,
    responses={
        200: {
            "description": "ACARS statistics",
            "content": {
                "application/json": {
                    "example": {
                        "total_messages": 15234,
                        "last_hour": 523,
                        "last_24h": 12456,
                        "by_source": {"acars": 8000, "vdlm2": 7234},
                        "top_labels": [
                            {"label": "H1", "count": 2345},
                            {"label": "SA", "count": 1234}
                        ],
                        "service_stats": {
                            "running": True,
                            "acars": {"total": 8000, "last_hour": 256, "errors": 12},
                            "vdlm2": {"total": 7234, "last_hour": 267, "errors": 5}
                        }
                    }
                }
            }
        }
    }
)
async def acars_statistics(db: AsyncSession = Depends(get_db)):
    """Get ACARS service and database statistics."""
    return await get_acars_stats(db)


@router.get(
    "/status",
    response_model=AcarsStatusResponse,
    summary="Get ACARS Service Status",
    description="""
Get the current status of the ACARS receiver service.

Shows:
- Whether the UDP listeners are running
- Message counts for ACARS and VDL2 channels
- Error counts for each channel
- Memory buffer size
    """,
    responses={
        200: {
            "description": "ACARS service status",
            "content": {
                "application/json": {
                    "example": {
                        "running": True,
                        "acars": {"total_received": 8000, "last_hour": 256, "errors": 12},
                        "vdlm2": {"total_received": 7234, "last_hour": 267, "errors": 5},
                        "buffer_size": 85
                    }
                }
            }
        }
    }
)
async def acars_status():
    """Get ACARS receiver service status and health."""
    stats = acars_service.get_stats()
    
    return {
        "running": stats["running"],
        "acars": {
            "total_received": stats["acars"]["total"],
            "last_hour": stats["acars"]["last_hour"],
            "errors": stats["acars"]["errors"],
        },
        "vdlm2": {
            "total_received": stats["vdlm2"]["total"],
            "last_hour": stats["vdlm2"]["last_hour"],
            "errors": stats["vdlm2"]["errors"],
        },
        "buffer_size": stats["recent_buffer_size"],
    }


@router.delete(
    "/messages/cleanup",
    response_model=DeleteResponse,
    summary="Clean Up Old Messages",
    description="""
Delete ACARS messages older than the specified number of days.

Use this to manage database size by removing old messages.
Default retention is 7 days.
    """,
    responses={
        200: {
            "description": "Cleanup result",
            "content": {
                "application/json": {
                    "example": {
                        "deleted": 5234,
                        "older_than_days": 7
                    }
                }
            }
        }
    }
)
async def cleanup_messages(
    days: int = Query(
        7,
        ge=1,
        le=30,
        description="Delete messages older than N days"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Clean up old ACARS messages from the database."""
    deleted = await cleanup_old_messages(db, days=days)
    
    return {
        "deleted": deleted,
        "message": f"Deleted {deleted} messages older than {days} days",
    }


@router.get(
    "/labels",
    response_model=AcarsLabelsReference,
    summary="Get ACARS Label Reference",
    description="""
Get a reference guide for common ACARS message labels.

ACARS labels are 2-character codes that identify the message type.
This endpoint provides descriptions for the most common labels.
    """,
    responses={
        200: {
            "description": "Label reference",
            "content": {
                "application/json": {
                    "example": {
                        "labels": {
                            "H1": "Flight plan / Departure clearance",
                            "SA": "Position report",
                            "B6": "Departure message"
                        },
                        "sources": {
                            "acars": "VHF ACARS (118-137 MHz)",
                            "vdlm2": "VDL Mode 2 data link"
                        }
                    }
                }
            }
        }
    }
)
async def get_label_reference():
    """Get reference for common ACARS message labels."""
    return {
        "labels": {
            "H1": "Flight plan / Departure clearance",
            "H2": "Flight plan update",
            "5Z": "Squawk code assignment",
            "SA": "Position report",
            "SQ": "Position request",
            "B6": "Departure message",
            "BA": "Arrival message",
            "QA": "Weather request (ATIS/METAR)",
            "QB": "Weather response",
            "Q0": "Airline-specific",
            "_d": "Air-ground voice / Data",
            "80": "OOOI message (Out/Off/On/In times)",
            "44": "Weather data",
            "10": "Crew terminal message",
            "15": "TWIP (Terminal Weather)",
            "20": "Crew scheduling",
            "RA": "ACARS link test",
        },
        "sources": {
            "acars": "VHF ACARS (118-137 MHz)",
            "vdlm2": "VDL Mode 2 data link",
        }
    }
