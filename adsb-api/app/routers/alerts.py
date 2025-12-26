"""
Alert rules API endpoints.

Create, manage, and monitor custom alert rules for aircraft events.
Supports simple conditions and complex AND/OR logic with scheduling.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Path, Body
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.models import AlertRule, AlertHistory
from app.schemas import (
    AlertRuleCreate, AlertRuleUpdate, AlertRuleResponse,
    AlertRulesListResponse, AlertHistoryEntry, AlertHistoryResponse,
    SuccessResponse, ErrorResponse
)

router = APIRouter(prefix="/api/v1/alerts", tags=["Alerts"])


@router.get(
    "/rules",
    response_model=AlertRulesListResponse,
    summary="List Alert Rules",
    description="""
Get all configured alert rules.

Alert rules define conditions that trigger notifications when aircraft
match specified criteria.

Rule types:
- **icao**: Match specific ICAO hex address
- **callsign**: Match flight callsign
- **squawk**: Match transponder code
- **altitude**: Compare altitude (lt, gt, le, ge)
- **distance**: Compare distance from feeder
- **type**: Match aircraft type code
- **military**: Match military aircraft flag

Complex rules support AND/OR logic with multiple condition groups.
    """,
    responses={
        200: {
            "description": "List of alert rules",
            "content": {
                "application/json": {
                    "example": {
                        "rules": [
                            {
                                "id": 1,
                                "name": "Low Altitude Alert",
                                "type": "altitude",
                                "operator": "lt",
                                "value": "3000",
                                "enabled": True,
                                "priority": "warning"
                            }
                        ],
                        "count": 1
                    }
                }
            }
        }
    }
)
async def get_rules(
    enabled_only: bool = Query(False, description="Return only enabled rules"),
    db: AsyncSession = Depends(get_db)
):
    """Get all configured alert rules."""
    query = select(AlertRule).order_by(AlertRule.id)
    if enabled_only:
        query = query.where(AlertRule.enabled == True)
    
    result = await db.execute(query)
    rules = []
    
    for rule in result.scalars():
        rules.append({
            "id": rule.id,
            "name": rule.name,
            "type": rule.rule_type,
            "operator": rule.operator,
            "value": rule.value,
            "conditions": rule.conditions,
            "description": rule.description,
            "enabled": rule.enabled,
            "priority": rule.priority,
            "starts_at": rule.starts_at.isoformat() + "Z" if rule.starts_at else None,
            "expires_at": rule.expires_at.isoformat() + "Z" if rule.expires_at else None,
            "api_url": rule.api_url,
            "created_at": rule.created_at.isoformat() + "Z" if rule.created_at else None,
            "updated_at": rule.updated_at.isoformat() + "Z" if rule.updated_at else None,
        })
    
    return {"rules": rules, "count": len(rules)}


@router.post(
    "/rules",
    response_model=AlertRuleResponse,
    status_code=201,
    summary="Create Alert Rule",
    description="""
Create a new alert rule.

**Simple rules** use type/operator/value:
```json
{
    "name": "Low Altitude",
    "type": "altitude",
    "operator": "lt",
    "value": "3000",
    "priority": "warning"
}
```

**Complex rules** use conditions with AND/OR logic:
```json
{
    "name": "Military Low Approach",
    "conditions": {
        "logic": "AND",
        "groups": [
            {"logic": "AND", "conditions": [
                {"type": "military", "operator": "eq", "value": "true"},
                {"type": "altitude", "operator": "lt", "value": "5000"}
            ]}
        ]
    },
    "priority": "critical"
}
```

Operators: eq, ne, lt, gt, le, ge, contains, startswith
Priorities: info, warning, critical
    """,
    responses={
        201: {"description": "Rule created successfully"},
        400: {"model": ErrorResponse, "description": "Invalid rule configuration"}
    }
)
async def create_rule(
    rule: AlertRuleCreate = Body(..., description="Alert rule configuration"),
    db: AsyncSession = Depends(get_db)
):
    """Create a new alert rule."""
    db_rule = AlertRule(
        name=rule.name,
        rule_type=rule.type,
        operator=rule.operator,
        value=rule.value,
        conditions=rule.conditions.model_dump() if rule.conditions else None,
        description=rule.description,
        enabled=rule.enabled,
        priority=rule.priority,
        starts_at=rule.starts_at,
        expires_at=rule.expires_at,
        api_url=rule.api_url,
    )
    
    db.add(db_rule)
    await db.commit()
    await db.refresh(db_rule)
    
    return {
        "id": db_rule.id,
        "name": db_rule.name,
        "type": db_rule.rule_type,
        "operator": db_rule.operator,
        "value": db_rule.value,
        "conditions": db_rule.conditions,
        "description": db_rule.description,
        "enabled": db_rule.enabled,
        "priority": db_rule.priority,
        "starts_at": db_rule.starts_at.isoformat() + "Z" if db_rule.starts_at else None,
        "expires_at": db_rule.expires_at.isoformat() + "Z" if db_rule.expires_at else None,
        "api_url": db_rule.api_url,
        "created_at": db_rule.created_at.isoformat() + "Z" if db_rule.created_at else None,
        "updated_at": db_rule.updated_at.isoformat() + "Z" if db_rule.updated_at else None,
    }


@router.get(
    "/rules/{rule_id}",
    response_model=AlertRuleResponse,
    summary="Get Alert Rule",
    description="Get a specific alert rule by ID.",
    responses={
        200: {"description": "Alert rule details"},
        404: {"model": ErrorResponse, "description": "Rule not found"}
    }
)
async def get_rule(
    rule_id: int = Path(..., description="Alert rule ID", ge=1),
    db: AsyncSession = Depends(get_db)
):
    """Get a specific alert rule by ID."""
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    return {
        "id": rule.id,
        "name": rule.name,
        "type": rule.rule_type,
        "operator": rule.operator,
        "value": rule.value,
        "conditions": rule.conditions,
        "description": rule.description,
        "enabled": rule.enabled,
        "priority": rule.priority,
        "starts_at": rule.starts_at.isoformat() + "Z" if rule.starts_at else None,
        "expires_at": rule.expires_at.isoformat() + "Z" if rule.expires_at else None,
        "api_url": rule.api_url,
        "created_at": rule.created_at.isoformat() + "Z" if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() + "Z" if rule.updated_at else None,
    }


@router.put(
    "/rules/{rule_id}",
    response_model=AlertRuleResponse,
    summary="Update Alert Rule",
    description="Update an existing alert rule. Only provided fields are updated.",
    responses={
        200: {"description": "Rule updated successfully"},
        404: {"model": ErrorResponse, "description": "Rule not found"}
    }
)
async def update_rule(
    rule_id: int = Path(..., description="Alert rule ID", ge=1),
    update: AlertRuleUpdate = Body(..., description="Fields to update"),
    db: AsyncSession = Depends(get_db)
):
    """Update an existing alert rule."""
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(rule, field, value)
    
    rule.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(rule)
    
    return {
        "id": rule.id,
        "name": rule.name,
        "type": rule.rule_type,
        "operator": rule.operator,
        "value": rule.value,
        "conditions": rule.conditions,
        "description": rule.description,
        "enabled": rule.enabled,
        "priority": rule.priority,
        "starts_at": rule.starts_at.isoformat() + "Z" if rule.starts_at else None,
        "expires_at": rule.expires_at.isoformat() + "Z" if rule.expires_at else None,
        "api_url": rule.api_url,
        "created_at": rule.created_at.isoformat() + "Z" if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() + "Z" if rule.updated_at else None,
    }


@router.delete(
    "/rules/{rule_id}",
    response_model=SuccessResponse,
    summary="Delete Alert Rule",
    description="Delete an alert rule by ID.",
    responses={
        200: {"description": "Rule deleted successfully"},
        404: {"model": ErrorResponse, "description": "Rule not found"}
    }
)
async def delete_rule(
    rule_id: int = Path(..., description="Alert rule ID", ge=1),
    db: AsyncSession = Depends(get_db)
):
    """Delete an alert rule."""
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    await db.delete(rule)
    await db.commit()
    
    return {"success": True, "message": f"Rule {rule_id} deleted"}


@router.post(
    "/rules/{rule_id}/toggle",
    response_model=AlertRuleResponse,
    summary="Toggle Alert Rule",
    description="Toggle the enabled/disabled state of an alert rule.",
    responses={
        200: {"description": "Rule toggled successfully"},
        404: {"model": ErrorResponse, "description": "Rule not found"}
    }
)
async def toggle_rule(
    rule_id: int = Path(..., description="Alert rule ID", ge=1),
    db: AsyncSession = Depends(get_db)
):
    """Toggle an alert rule on/off."""
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    rule.enabled = not rule.enabled
    rule.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(rule)
    
    return {
        "id": rule.id,
        "name": rule.name,
        "type": rule.rule_type,
        "operator": rule.operator,
        "value": rule.value,
        "conditions": rule.conditions,
        "description": rule.description,
        "enabled": rule.enabled,
        "priority": rule.priority,
        "starts_at": rule.starts_at.isoformat() + "Z" if rule.starts_at else None,
        "expires_at": rule.expires_at.isoformat() + "Z" if rule.expires_at else None,
        "api_url": rule.api_url,
        "created_at": rule.created_at.isoformat() + "Z" if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() + "Z" if rule.updated_at else None,
    }


@router.get(
    "/history",
    response_model=AlertHistoryResponse,
    summary="Get Alert History",
    description="""
Get history of triggered alerts.

Filters:
- **rule_id**: Filter by specific rule
- **hours**: Time range (1-168 hours)
- **limit**: Maximum entries to return

Returns alerts sorted by timestamp (newest first).
    """,
    responses={
        200: {
            "description": "Alert history",
            "content": {
                "application/json": {
                    "example": {
                        "history": [
                            {
                                "id": 1,
                                "rule_id": 1,
                                "rule_name": "Low Altitude",
                                "icao": "A12345",
                                "callsign": "UAL123",
                                "message": "Aircraft below 3000ft",
                                "priority": "warning",
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
async def get_history(
    rule_id: Optional[int] = Query(None, description="Filter by rule ID"),
    hours: int = Query(24, ge=1, le=168, description="Hours of history"),
    limit: int = Query(100, ge=1, le=500, description="Maximum entries"),
    db: AsyncSession = Depends(get_db)
):
    """Get alert trigger history."""
    from datetime import timedelta
    
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    query = select(AlertHistory).where(AlertHistory.triggered_at > cutoff)
    
    if rule_id:
        query = query.where(AlertHistory.rule_id == rule_id)
    
    query = query.order_by(AlertHistory.triggered_at.desc()).limit(limit)
    
    result = await db.execute(query)
    history = []
    
    for entry in result.scalars():
        history.append({
            "id": entry.id,
            "rule_id": entry.rule_id,
            "rule_name": entry.rule_name,
            "icao": entry.icao_hex,
            "callsign": entry.callsign,
            "message": entry.message,
            "priority": entry.priority,
            "aircraft_data": entry.aircraft_data,
            "timestamp": entry.triggered_at.isoformat() + "Z",
        })
    
    return {"history": history, "count": len(history)}


@router.delete(
    "/history",
    response_model=SuccessResponse,
    summary="Clear Alert History",
    description="Delete all alert history entries older than specified days.",
    responses={
        200: {"description": "History cleared"}
    }
)
async def clear_history(
    days: int = Query(7, ge=1, le=30, description="Delete entries older than N days"),
    db: AsyncSession = Depends(get_db)
):
    """Clear old alert history entries."""
    from datetime import timedelta
    
    cutoff = datetime.utcnow() - timedelta(days=days)
    result = await db.execute(
        delete(AlertHistory).where(AlertHistory.triggered_at < cutoff)
    )
    await db.commit()
    
    return {"success": True, "message": f"Deleted {result.rowcount} entries"}
