"""
Map data and SSE streaming API endpoints.

Provides GeoJSON format aircraft data for map displays and
Server-Sent Events (SSE) for real-time streaming updates.
"""
from datetime import datetime
from typing import Optional
import asyncio

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from app.core import get_settings, cached, safe_request, calculate_distance_nm, is_valid_position
from app.services.sse import get_sse_manager
from app.schemas import GeoJSONFeatureCollection

router = APIRouter(prefix="/api/v1/map", tags=["Map"])
settings = get_settings()


@router.get(
    "/geojson",
    response_model=GeoJSONFeatureCollection,
    summary="Get Aircraft as GeoJSON",
    description="""
Get all aircraft positions as a GeoJSON FeatureCollection.

Each aircraft is represented as a Point feature with properties:
- **icao**: ICAO hex address
- **callsign**: Flight callsign
- **altitude**: Barometric altitude in feet
- **speed**: Ground speed in knots
- **track**: Ground track in degrees
- **vrate**: Vertical rate in ft/min
- **squawk**: Transponder code
- **type**: Aircraft type code
- **category**: Aircraft category
- **military**: Military flag
- **emergency**: Emergency flag
- **distance_nm**: Distance from feeder

Perfect for use with mapping libraries like Leaflet, MapLibre, or OpenLayers.
    """,
    responses={
        200: {
            "description": "GeoJSON FeatureCollection",
            "content": {
                "application/json": {
                    "example": {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "id": "A12345",
                                "geometry": {
                                    "type": "Point",
                                    "coordinates": [-122.3321, 47.6062]
                                },
                                "properties": {
                                    "icao": "A12345",
                                    "callsign": "UAL123",
                                    "altitude": 35000,
                                    "speed": 450,
                                    "track": 270
                                }
                            }
                        ],
                        "metadata": {
                            "count": 1,
                            "timestamp": "2024-12-21T12:00:00Z"
                        }
                    }
                }
            }
        }
    }
)
@cached(ttl_seconds=2)
async def get_geojson():
    """Get aircraft positions as GeoJSON FeatureCollection."""
    url = f"{settings.ultrafeeder_url}/tar1090/data/aircraft.json"
    data = await safe_request(url)
    
    features = []
    
    if data:
        for ac in data.get("aircraft", []):
            lat, lon = ac.get("lat"), ac.get("lon")
            if not is_valid_position(lat, lon):
                continue
            
            distance = calculate_distance_nm(
                settings.feeder_lat, settings.feeder_lon, lat, lon
            )
            
            features.append({
                "type": "Feature",
                "id": ac.get("hex"),
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat]
                },
                "properties": {
                    "icao": ac.get("hex"),
                    "callsign": ac.get("flight", "").strip() if ac.get("flight") else None,
                    "altitude": ac.get("alt_baro") if isinstance(ac.get("alt_baro"), int) else None,
                    "speed": ac.get("gs"),
                    "track": ac.get("track"),
                    "vrate": ac.get("baro_rate"),
                    "squawk": ac.get("squawk"),
                    "type": ac.get("t"),
                    "category": ac.get("category"),
                    "military": bool(ac.get("dbFlags", 0) & 1),
                    "emergency": ac.get("squawk") in ["7500", "7600", "7700"],
                    "distance_nm": round(distance, 1),
                }
            })
    
    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "count": len(features),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "feeder_location": {
                "lat": settings.feeder_lat,
                "lon": settings.feeder_lon
            }
        }
    }


@router.get(
    "/sse",
    summary="SSE Aircraft Stream",
    description="""
Server-Sent Events stream for real-time aircraft updates.

**Event Types:**
- `aircraft_update`: Periodic aircraft position updates
- `alert_triggered`: When an alert rule matches
- `safety_event`: TCAS/safety event detected
- `acars_message`: ACARS/VDL2 message received

**Connection:**
```javascript
const sse = new EventSource('/api/v1/map/sse');
sse.addEventListener('aircraft_update', (e) => {
    const data = JSON.parse(e.data);
    console.log(data.aircraft);
});
```

**Query Parameters:**
- `replay_history=true`: Receive recent events on connect

The connection will send a heartbeat every 30 seconds to keep alive.
    """,
    responses={
        200: {
            "description": "SSE event stream",
            "content": {
                "text/event-stream": {
                    "example": "event: aircraft_update\ndata: {\"aircraft\": [...], \"count\": 45}\n\n"
                }
            }
        }
    }
)
async def sse_stream(
    request: Request,
    replay_history: bool = Query(
        False,
        description="Replay recent events on connection"
    )
):
    """Stream real-time aircraft updates via Server-Sent Events."""
    sse_manager = get_sse_manager()
    queue = await sse_manager.subscribe()
    
    async def event_generator():
        try:
            # Replay history if requested
            if replay_history and hasattr(sse_manager, "get_history"):
                history = await sse_manager.get_history(limit=50)
                for event in history:
                    yield event
            
            # Stream live events
            while True:
                if await request.is_disconnected():
                    break
                
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=30)
                    yield message
                except asyncio.TimeoutError:
                    # Send heartbeat
                    yield ": heartbeat\n\n"
        
        finally:
            await sse_manager.unsubscribe(queue)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get(
    "/sse/status",
    summary="Get SSE Status",
    description="""
Get the current status of the SSE service.

Returns:
- **mode**: Operating mode (memory or redis)
- **subscribers**: Current subscriber count
- **tracked_aircraft**: Aircraft in state cache
- **last_publish**: Time of last broadcast
- **history**: Event history buffer info
    """,
    responses={
        200: {
            "description": "SSE service status",
            "content": {
                "application/json": {
                    "example": {
                        "mode": "redis",
                        "redis_enabled": True,
                        "subscribers": 3,
                        "subscribers_local": 2,
                        "tracked_aircraft": 45,
                        "last_publish": "2024-12-21T12:00:00Z",
                        "history": {"size": 1000, "max_size": 5000},
                        "timestamp": "2024-12-21T12:00:00Z"
                    }
                }
            }
        }
    }
)
async def get_sse_status():
    """Get SSE service status and statistics."""
    sse_manager = get_sse_manager()
    
    last_publish = None
    if sse_manager._last_publish_time:
        last_publish = datetime.utcfromtimestamp(
            sse_manager._last_publish_time
        ).isoformat() + "Z"
    
    history_info = {}
    if hasattr(sse_manager, "_history"):
        history_info = {
            "size": len(sse_manager._history) if sse_manager._history else 0,
            "max_size": getattr(sse_manager, "HISTORY_SIZE", 5000)
        }
    
    return {
        "mode": "redis" if sse_manager._using_redis else "memory",
        "redis_enabled": sse_manager._using_redis,
        "subscribers": await sse_manager.get_subscriber_count(),
        "subscribers_local": len(sse_manager._subscribers),
        "tracked_aircraft": len(sse_manager._last_aircraft_state),
        "last_publish": last_publish,
        "history": history_info,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
