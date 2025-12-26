"""
Safety monitoring API endpoints.

Monitors for aviation safety events including:
- TCAS Resolution Advisories (RA)
- TCAS Traffic Advisories (TA)
- Extreme vertical speed changes
- Aircraft proximity events
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, Path
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.models import SafetyEvent
from app.services.safety import safety_monitor
from app.schemas import (
    SafetyEventsListResponse, SafetyStatsResponse, SafetyEventResponse,
    SuccessResponse, ErrorResponse
)

router = APIRouter(prefix="/api/v1/safety", tags=["Safety"])


@router.get(
    "/events",
    response_model=SafetyEventsListResponse,
    summary="Query Safety Events",
    description="""
Query recorded safety events.

**Event Types:**
- **tcas_ra**: TCAS Resolution Advisory - evasive action recommended
- **tcas_ta**: TCAS Traffic Advisory - traffic alert
- **extreme_vs**: Extreme vertical speed change detected
- **proximity**: Two aircraft in close proximity

**Severity Levels:**
- **info**: Informational event
- **warning**: Potential concern
- **critical**: Immediate attention required

Events are stored when detected by the safety monitor during 
aircraft tracking.
    """,
    responses={
        200: {
            "description": "List of safety events",
            "content": {
                "application/json": {
                    "example": {
                        "events": [
                            {
                                "id": 1,
                                "event_type": "tcas_ra",
                                "severity": "critical",
                                "icao": "A12345",
                                "icao_2": "B67890",
                                "callsign": "UAL123",
                                "callsign_2": "DAL456",
                                "message": "TCAS RA: Aircraft in conflict",
                                "details": {"separation_nm": 0.5},
                                "timestamp": "2024-12-21T12:00:00Z"
                            }
                        ],
                        "count": 1
                    }
                }
            }
        }
    }
)
async def get_events(
    event_type: Optional[str] = Query(
        None,
        description="Filter by event type",
        enum=["tcas_ra", "tcas_ta", "extreme_vs", "proximity"]
    ),
    severity: Optional[str] = Query(
        None,
        description="Filter by severity level",
        enum=["info", "warning", "critical"]
    ),
    icao_hex: Optional[str] = Query(
        None,
        description="Filter by aircraft ICAO hex",
        example="A12345"
    ),
    hours: int = Query(
        24,
        ge=1,
        le=168,
        description="Hours of history to query"
    ),
    limit: int = Query(
        100,
        ge=1,
        le=500,
        description="Maximum events to return"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Query safety events with optional filters."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    
    conditions = [SafetyEvent.timestamp > cutoff]
    
    if event_type:
        conditions.append(SafetyEvent.event_type == event_type)
    if severity:
        conditions.append(SafetyEvent.severity == severity)
    if icao_hex:
        conditions.append(
            (SafetyEvent.icao_hex == icao_hex.upper()) |
            (SafetyEvent.icao_hex_2 == icao_hex.upper())
        )
    
    query = (
        select(SafetyEvent)
        .where(and_(*conditions))
        .order_by(SafetyEvent.timestamp.desc())
        .limit(limit)
    )
    
    result = await db.execute(query)
    events = []
    
    for e in result.scalars():
        events.append({
            "id": e.id,
            "event_type": e.event_type,
            "severity": e.severity,
            "icao": e.icao_hex,
            "icao_2": e.icao_hex_2,
            "callsign": e.callsign,
            "callsign_2": e.callsign_2,
            "message": e.message,
            "details": e.details,
            "timestamp": e.timestamp.isoformat() + "Z",
        })
    
    return {"events": events, "count": len(events)}


@router.get(
    "/events/{event_id}",
    response_model=SafetyEventResponse,
    summary="Get Safety Event",
    description="Get details of a specific safety event by ID.",
    responses={
        200: {"description": "Safety event details"},
        404: {"model": ErrorResponse, "description": "Event not found"}
    }
)
async def get_event(
    event_id: int = Path(..., description="Safety event ID", ge=1),
    db: AsyncSession = Depends(get_db)
):
    """Get a specific safety event by ID."""
    from fastapi import HTTPException
    
    result = await db.execute(
        select(SafetyEvent).where(SafetyEvent.id == event_id)
    )
    event = result.scalar_one_or_none()
    
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    return {
        "id": event.id,
        "event_type": event.event_type,
        "severity": event.severity,
        "icao": event.icao_hex,
        "icao_2": event.icao_hex_2,
        "callsign": event.callsign,
        "callsign_2": event.callsign_2,
        "message": event.message,
        "details": event.details,
        "timestamp": event.timestamp.isoformat() + "Z",
    }


@router.get(
    "/stats",
    response_model=SafetyStatsResponse,
    summary="Get Safety Statistics",
    description="""
Get comprehensive safety monitoring statistics.

Returns:
- Current monitoring status and thresholds
- Event counts by type and severity
- Recent events summary
- Monitor internal state (tracked aircraft count)
    """,
    responses={
        200: {
            "description": "Safety statistics",
            "content": {
                "application/json": {
                    "example": {
                        "monitoring_enabled": True,
                        "thresholds": {
                            "vs_change": 3000,
                            "vs_extreme": 4500,
                            "proximity_nm": 1.0,
                            "altitude_diff_ft": 1000
                        },
                        "time_range_hours": 24,
                        "events_by_type": {"tcas_ra": 2, "extreme_vs": 5},
                        "events_by_severity": {"critical": 2, "warning": 5},
                        "total_events": 7,
                        "recent_events": [],
                        "monitor_state": {"tracked_aircraft": 45},
                        "timestamp": "2024-12-21T12:00:00Z"
                    }
                }
            }
        }
    }
)
async def get_stats(
    hours: int = Query(24, ge=1, le=168, description="Time range for statistics"),
    db: AsyncSession = Depends(get_db)
):
    """Get safety monitoring statistics."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    
    # Events by type
    type_query = (
        select(SafetyEvent.event_type, func.count(SafetyEvent.id))
        .where(SafetyEvent.timestamp > cutoff)
        .group_by(SafetyEvent.event_type)
    )
    type_result = await db.execute(type_query)
    events_by_type = {row[0]: row[1] for row in type_result}
    
    # Events by severity
    severity_query = (
        select(SafetyEvent.severity, func.count(SafetyEvent.id))
        .where(SafetyEvent.timestamp > cutoff)
        .group_by(SafetyEvent.severity)
    )
    severity_result = await db.execute(severity_query)
    events_by_severity = {row[0]: row[1] for row in severity_result}
    
    # Recent events
    recent_query = (
        select(SafetyEvent)
        .where(SafetyEvent.timestamp > cutoff)
        .order_by(SafetyEvent.timestamp.desc())
        .limit(10)
    )
    recent_result = await db.execute(recent_query)
    recent_events = [
        {
            "id": e.id,
            "event_type": e.event_type,
            "severity": e.severity,
            "message": e.message,
            "timestamp": e.timestamp.isoformat() + "Z",
        }
        for e in recent_result.scalars()
    ]
    
    total_events = sum(events_by_type.values())
    
    return {
        "monitoring_enabled": safety_monitor.enabled,
        "thresholds": safety_monitor.get_thresholds(),
        "time_range_hours": hours,
        "events_by_type": events_by_type,
        "events_by_severity": events_by_severity,
        "total_events": total_events,
        "recent_events": recent_events,
        "monitor_state": safety_monitor.get_state(),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@router.post(
    "/monitor/enable",
    response_model=SuccessResponse,
    summary="Enable Safety Monitor",
    description="Enable the real-time safety monitoring system.",
    responses={
        200: {"description": "Monitor enabled"}
    }
)
async def enable_monitor():
    """Enable safety monitoring."""
    safety_monitor.enabled = True
    return {"success": True, "message": "Safety monitoring enabled"}


@router.post(
    "/monitor/disable",
    response_model=SuccessResponse,
    summary="Disable Safety Monitor",
    description="Disable the real-time safety monitoring system.",
    responses={
        200: {"description": "Monitor disabled"}
    }
)
async def disable_monitor():
    """Disable safety monitoring."""
    safety_monitor.enabled = False
    return {"success": True, "message": "Safety monitoring disabled"}


@router.get(
    "/monitor/status",
    summary="Get Monitor Status",
    description="""
Get the current status of the safety monitor.

Returns whether monitoring is enabled and the current thresholds
being used for event detection.
    """,
    responses={
        200: {
            "description": "Monitor status",
            "content": {
                "application/json": {
                    "example": {
                        "enabled": True,
                        "tracked_aircraft": 45,
                        "thresholds": {
                            "vs_change": 3000,
                            "vs_extreme": 4500,
                            "proximity_nm": 1.0,
                            "altitude_diff_ft": 1000
                        }
                    }
                }
            }
        }
    }
)
async def get_monitor_status():
    """Get current safety monitor status."""
    return {
        "enabled": safety_monitor.enabled,
        "tracked_aircraft": len(safety_monitor._aircraft_state),
        "thresholds": safety_monitor.get_thresholds(),
    }
