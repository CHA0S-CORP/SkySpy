"""
Notification service using Apprise for multi-platform notifications.
"""
import logging
import time
from typing import Optional

import apprise
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import get_settings
from app.models import NotificationConfig, NotificationLog

logger = logging.getLogger(__name__)
settings = get_settings()

# Cooldown tracking
_notification_cooldown: dict[str, float] = {}


class NotificationManager:
    """Manages notifications via Apprise."""
    
    def __init__(self):
        self.apprise = apprise.Apprise()
        self._setup_notifications()
    
    def _setup_notifications(self):
        """Set up notification URLs from environment."""
        if settings.apprise_urls:
            for url in settings.apprise_urls.split(","):
                url = url.strip()
                if url:
                    self.apprise.add(url)
    
    async def reload_from_db(self, db: AsyncSession):
        """Reload URLs from database config."""
        try:
            result = await db.execute(select(NotificationConfig).limit(1))
            config = result.scalar_one_or_none()
            if config and config.apprise_urls:
                self.apprise.clear()
                for url in config.apprise_urls.split(","):
                    url = url.strip()
                    if url:
                        self.apprise.add(url)
        except Exception as e:
            logger.warning(f"Failed to reload notification config: {e}")
    
    def reload_urls(self, urls: str):
        """Reload notification URLs."""
        self.apprise.clear()
        for url in urls.split(","):
            url = url.strip()
            if url:
                self.apprise.add(url)
    
    def can_notify(self, key: str, cooldown: int = None) -> bool:
        """Check if notification can be sent (respects cooldown)."""
        if cooldown is None:
            cooldown = settings.notification_cooldown
        
        now = time.time()
        last_sent = _notification_cooldown.get(key, 0)
        return (now - last_sent) > cooldown
    
    async def send(
        self,
        db: AsyncSession,
        title: str,
        body: str,
        notify_type: str = "info",
        key: Optional[str] = None,
        icao: Optional[str] = None,
        callsign: Optional[str] = None,
        details: Optional[dict] = None,
        api_url: Optional[str] = None
    ) -> bool:
        """Send notification with optional per-rule API URL override."""
        
        # Check if enabled
        try:
            result = await db.execute(select(NotificationConfig).limit(1))
            config = result.scalar_one_or_none()
            if config and not config.enabled:
                return False
            cooldown = config.cooldown_seconds if config else settings.notification_cooldown
        except Exception as e:
            logger.warning(f"Failed to check notification config: {e}")
            cooldown = settings.notification_cooldown
        
        # Use per-rule API URL if provided
        notifier = self.apprise
        if api_url:
            notifier = apprise.Apprise()
            notifier.add(api_url)
        elif not self.apprise.servers:
            await self.reload_from_db(db)
            if not self.apprise.servers:
                return False
        
        cooldown_key = key or f"{notify_type}:{icao}:{callsign}"
        if not self.can_notify(cooldown_key, cooldown):
            return False
        
        try:
            apprise_type = apprise.NotifyType.INFO
            if notify_type == "warning":
                apprise_type = apprise.NotifyType.WARNING
            elif notify_type == "emergency":
                apprise_type = apprise.NotifyType.FAILURE
            
            result = notifier.notify(title=title, body=body, notify_type=apprise_type)
            
            if result:
                _notification_cooldown[cooldown_key] = time.time()
                
                # Log notification
                try:
                    log_entry = NotificationLog(
                        notification_type=notify_type,
                        icao_hex=icao,
                        callsign=callsign,
                        message=f"{title}: {body}",
                        details=details or {}
                    )
                    db.add(log_entry)
                    await db.commit()
                except Exception as e:
                    logger.warning(f"Failed to log notification: {e}")
                    await db.rollback()
                
                logger.info(f"Notification sent: {title}")
            
            return result
        except Exception as e:
            logger.error(f"Notification error: {e}")
            return False
    
    @property
    def server_count(self) -> int:
        """Get number of configured notification servers."""
        return len(self.apprise.servers)


# Global notification manager instance
notifier = NotificationManager()
