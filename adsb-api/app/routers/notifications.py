"""
Notification configuration API endpoints.

Configure push notifications for alerts using Apprise,
which supports 80+ notification services including:
- Pushover, Pushbullet, Telegram
- Slack, Discord, Microsoft Teams
- Email (SMTP), SMS
- And many more
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, Body, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.models import NotificationLog, NotificationConfig
from app.services.notifications import notifier
from app.schemas import (
    NotificationConfigUpdate, NotificationConfigResponse,
    NotificationTestResponse, SuccessResponse
)

router = APIRouter(prefix="/api/v1/notifications", tags=["Notifications"])


@router.get(
    "/config",
    response_model=NotificationConfigResponse,
    summary="Get Notification Configuration",
    description="""
Get the current notification configuration.

Returns:
- **enabled**: Whether notifications are active
- **apprise_urls**: Configured notification service URLs (masked)
- **cooldown_seconds**: Minimum time between notifications
- **server_count**: Number of configured notification servers

Apprise URLs are masked for security.
    """,
    responses={
        200: {
            "description": "Notification configuration",
            "content": {
                "application/json": {
                    "example": {
                        "enabled": True,
                        "apprise_urls": "pover://****;tgram://****",
                        "cooldown_seconds": 300,
                        "server_count": 2
                    }
                }
            }
        }
    }
)
async def get_config(db: AsyncSession = Depends(get_db)):
    """Get current notification configuration."""
    result = await db.execute(select(NotificationConfig).limit(1))
    config = result.scalar_one_or_none()
    
    if not config:
        return {
            "enabled": False,
            "apprise_urls": "",
            "cooldown_seconds": 300,
            "server_count": 0,
        }
    
    # Mask URLs for security
    masked_urls = ""
    if config.apprise_urls:
        urls = config.apprise_urls.split(",")
        masked = []
        for url in urls:
            url = url.strip()
            if "://" in url:
                scheme = url.split("://")[0]
                masked.append(f"{scheme}://****")
            elif url:
                masked.append("****")
        masked_urls = ";".join(masked)
    
    return {
        "enabled": config.enabled,
        "apprise_urls": masked_urls,
        "cooldown_seconds": config.cooldown_seconds,
        "server_count": notifier.server_count,
    }


@router.put(
    "/config",
    response_model=NotificationConfigResponse,
    summary="Update Notification Configuration",
    description="""
Update the notification configuration.

**Apprise URL Format:**
URLs for notification services in Apprise format, separated by commas.

Examples:
- Pushover: `pover://user_key@app_token`
- Telegram: `tgram://bot_token/chat_id`
- Discord: `discord://webhook_id/webhook_token`
- Slack: `slack://token_a/token_b/token_c`
- Email: `mailto://user:pass@gmail.com`

See https://github.com/caronc/apprise for full documentation.

**Cooldown:**
Minimum seconds between notifications to prevent flooding.
Recommended: 300 (5 minutes) for normal use.
    """,
    responses={
        200: {"description": "Configuration updated"}
    }
)
async def update_config(
    config_update: NotificationConfigUpdate = Body(
        ...,
        description="Configuration updates",
        example={
            "apprise_urls": "pover://user@token",
            "cooldown_seconds": 300,
            "enabled": True
        }
    ),
    db: AsyncSession = Depends(get_db)
):
    """Update notification configuration."""
    result = await db.execute(select(NotificationConfig).limit(1))
    config = result.scalar_one_or_none()
    
    if not config:
        config = NotificationConfig()
        db.add(config)
    
    if config_update.apprise_urls is not None:
        config.apprise_urls = config_update.apprise_urls
        notifier.reload_urls(config_update.apprise_urls)
    
    if config_update.cooldown_seconds is not None:
        config.cooldown_seconds = config_update.cooldown_seconds
    
    if config_update.enabled is not None:
        config.enabled = config_update.enabled
    
    await db.commit()
    await db.refresh(config)
    
    return await get_config(db)


@router.post(
    "/test",
    response_model=NotificationTestResponse,
    summary="Send Test Notification",
    description="""
Send a test notification to verify configuration.

Sends a test message to all configured notification services
and returns the result.

Use this to verify your notification setup is working correctly.
    """,
    responses={
        200: {
            "description": "Test result",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "message": "Test notification sent",
                        "servers_notified": 2
                    }
                }
            }
        }
    }
)
async def send_test(
    message: str = Query(
        "Test notification from ADS-B API",
        description="Test message to send"
    ),
    db: AsyncSession = Depends(get_db)
):
    """Send a test notification."""
    if notifier.server_count == 0:
        await notifier.reload_from_db(db)
    
    if notifier.server_count == 0:
        return {
            "success": False,
            "message": "No notification servers configured",
            "servers_notified": 0,
        }
    
    result = await notifier.send(
        db=db,
        title="ADS-B API Test",
        body=message,
        notify_type="info",
        key="test_notification"
    )
    
    return {
        "success": result,
        "message": "Test notification sent" if result else "Failed to send notification",
        "servers_notified": notifier.server_count if result else 0,
    }


@router.get(
    "/history",
    summary="Get Notification History",
    description="""
Get history of sent notifications.

Returns recent notification logs including:
- Timestamp
- Alert rule that triggered it
- Message content
- Delivery status
    """,
    responses={
        200: {
            "description": "Notification history",
            "content": {
                "application/json": {
                    "example": {
                        "notifications": [
                            {
                                "id": 1,
                                "notification_type": "alert",
                                "icao_hex": "A12345",
                                "callsign": "UAL123",
                                "message": "Aircraft UAL123 below 3000ft",
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
    hours: int = Query(24, ge=1, le=168, description="Hours of history"),
    limit: int = Query(50, ge=1, le=200, description="Maximum entries"),
    db: AsyncSession = Depends(get_db)
):
    """Get notification history."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    
    query = (
        select(NotificationLog)
        .where(NotificationLog.timestamp > cutoff)
        .order_by(NotificationLog.timestamp.desc())
        .limit(limit)
    )
    
    result = await db.execute(query)
    notifications = []
    
    for n in result.scalars():
        notifications.append({
            "id": n.id,
            "notification_type": n.notification_type,
            "icao_hex": n.icao_hex,
            "callsign": n.callsign,
            "message": n.message,
            "details": n.details,
            "timestamp": n.timestamp.isoformat() + "Z",
        })
    
    return {"notifications": notifications, "count": len(notifications)}


@router.get(
    "/stats",
    summary="Get Notification Statistics",
    description="""
Get notification delivery statistics.

Returns:
- Total notifications sent
- Recent activity summary
    """,
    responses={
        200: {
            "description": "Notification statistics",
            "content": {
                "application/json": {
                    "example": {
                        "total_sent": 156,
                        "last_24h": 23,
                        "last_notification": "2024-12-21T12:00:00Z"
                    }
                }
            }
        }
    }
)
async def get_stats(
    db: AsyncSession = Depends(get_db)
):
    """Get notification statistics."""
    # Total counts
    total = (await db.execute(
        select(func.count(NotificationLog.id))
    )).scalar()
    
    # Last 24 hours
    cutoff = datetime.utcnow() - timedelta(hours=24)
    last_24h = (await db.execute(
        select(func.count(NotificationLog.id))
        .where(NotificationLog.timestamp > cutoff)
    )).scalar()
    
    # Last notification
    last = (await db.execute(
        select(NotificationLog)
        .order_by(NotificationLog.timestamp.desc())
        .limit(1)
    )).scalar_one_or_none()
    
    return {
        "total_sent": total,
        "last_24h": last_24h,
        "last_notification": last.timestamp.isoformat() + "Z" if last else None,
        "server_count": notifier.server_count,
    }


@router.post(
    "/enable",
    response_model=SuccessResponse,
    summary="Enable Notifications",
    description="Enable the notification system.",
    responses={200: {"description": "Notifications enabled"}}
)
async def enable_notifications(db: AsyncSession = Depends(get_db)):
    """Enable notifications."""
    result = await db.execute(select(NotificationConfig).limit(1))
    config = result.scalar_one_or_none()
    
    if not config:
        config = NotificationConfig(enabled=True)
        db.add(config)
    else:
        config.enabled = True
    
    await db.commit()
    return {"success": True, "message": "Notifications enabled"}


@router.post(
    "/disable",
    response_model=SuccessResponse,
    summary="Disable Notifications",
    description="Disable the notification system.",
    responses={200: {"description": "Notifications disabled"}}
)
async def disable_notifications(db: AsyncSession = Depends(get_db)):
    """Disable notifications."""
    result = await db.execute(select(NotificationConfig).limit(1))
    config = result.scalar_one_or_none()
    
    if not config:
        config = NotificationConfig(enabled=False)
        db.add(config)
    else:
        config.enabled = False
    
    await db.commit()
    return {"success": True, "message": "Notifications disabled"}
