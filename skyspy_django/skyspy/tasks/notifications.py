"""
Celery tasks for notification delivery with retry support.

Provides asynchronous notification delivery with:
- Automatic retry with exponential backoff
- Dead letter queue for failed notifications
- Notification log tracking
- Rate limiting per channel
"""

import contextlib
import logging
import time
from datetime import timedelta
from typing import Any

import apprise
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


# NOTE: No Celery autoretry here. Retries are driven exclusively by
# process_notification_queue via the NotificationLog status/next_retry_at
# fields; combining both mechanisms caused duplicate deliveries.
@shared_task(bind=True, max_retries=5)
def send_notification_task(
    self,
    channel_url: str,
    title: str,
    body: str,
    priority: str = "info",
    event_type: str = "alert",
    channel_type: str = "webhook",
    channel_id: int | None = None,
    rich_payload: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
    notification_log_id: int = None,
):
    """
    Send a notification with automatic retry on failure.

    Args:
        channel_url: Apprise-compatible URL for the channel
        title: Notification title
        body: Notification body
        priority: Priority level (info, warning, critical)
        event_type: Event type (alert, safety, etc.)
        channel_type: Channel type for formatting
        channel_id: Optional channel ID for tracking
        rich_payload: Optional rich formatting payload
        context: Optional context data for logging
        notification_log_id: Optional existing log ID to update
    """
    from skyspy.models.notifications import NotificationChannel, NotificationLog

    start_time = time.perf_counter()

    # Get or create log entry
    log_entry = None
    if notification_log_id:
        with contextlib.suppress(NotificationLog.DoesNotExist):
            log_entry = NotificationLog.objects.get(id=notification_log_id)

    if not log_entry:
        # Create new log entry
        channel = None
        if channel_id:
            with contextlib.suppress(NotificationChannel.DoesNotExist):
                channel = NotificationChannel.objects.get(id=channel_id)

        log_entry = NotificationLog.objects.create(
            notification_type=event_type,
            icao_hex=context.get("icao") if context else None,
            callsign=context.get("callsign") if context else None,
            message=body[:500] if body else None,
            details=context,
            channel=channel,
            channel_url=channel_url,
            status="pending",
            max_retries=self.max_retries,
        )

    try:
        apobj = apprise.Apprise()
        apobj.add(channel_url)

        # Map priority to apprise notification type
        notify_type = apprise.NotifyType.INFO
        if priority == "warning":
            notify_type = apprise.NotifyType.WARNING
        elif priority == "critical":
            notify_type = apprise.NotifyType.FAILURE

        # Send notification
        # If rich payload is provided and channel supports it, we may need
        # to use channel-specific sending methods
        result = apobj.notify(
            title=title,
            body=body,
            notify_type=notify_type,
        )

        if result:
            # Success
            duration_ms = int((time.perf_counter() - start_time) * 1000)
            log_entry.mark_sent(duration_ms=duration_ms)

            # Update channel success timestamp
            if channel_id:
                NotificationChannel.objects.filter(id=channel_id).update(
                    last_success=timezone.now(),
                    verified=True,
                )

            logger.info(f"Notification sent successfully to {channel_type}")
            return {"status": "sent", "duration_ms": duration_ms}
        else:
            raise Exception("Apprise returned False - delivery may have failed")

    except ImportError:
        logger.error("Apprise not installed")
        log_entry.mark_failed("Apprise library not installed")
        return {"status": "failed", "error": "Apprise not installed"}

    except Exception as e:  # broad: Celery task guard; apprise delivery has unknowable failure modes, re-raises for retry
        error_msg = str(e)
        # Track attempts on the log entry (self.request.retries is always 0
        # here because redelivery happens via process_notification_queue,
        # which dispatches a fresh task)
        retry_count = (log_entry.retry_count or 0) + 1
        logger.warning(f"Notification failed (attempt {retry_count}/{log_entry.max_retries + 1}): {error_msg}")

        # Update log entry
        log_entry.retry_count = retry_count
        log_entry.last_error = error_msg

        if retry_count <= log_entry.max_retries:
            log_entry.status = "retrying"
            # Calculate next retry time (exponential backoff, capped at 1 hour)
            countdown = min(self.default_retry_delay * (2 ** (retry_count - 1)), 3600)
            log_entry.next_retry_at = timezone.now() + timedelta(seconds=countdown)
        else:
            log_entry.status = "failed"
            log_entry.next_retry_at = None

            # Update channel failure timestamp
            if channel_id:
                NotificationChannel.objects.filter(id=channel_id).update(
                    last_failure=timezone.now(),
                    last_error=error_msg,
                )

        log_entry.save()
        raise


@shared_task
def process_notification_queue():
    """
    Process pending notification retries.

    Called periodically to check for notifications that need to be retried.
    """
    from skyspy.models.notifications import NotificationLog

    now = timezone.now()

    # Find notifications ready for retry
    pending_ids = list(
        NotificationLog.objects.filter(
            status="retrying",
            next_retry_at__lte=now,
        ).values_list("id", flat=True)[:50]  # Process up to 50 at a time
    )

    processed = 0
    for log_id in pending_ids:
        # Atomically claim the row by pushing next_retry_at forward so
        # overlapping/subsequent beat runs don't re-enqueue the same
        # notification while the dispatched task is still in flight.
        # If the task is lost, the row becomes eligible again after the
        # claim window expires.
        claimed = NotificationLog.objects.filter(
            id=log_id,
            status="retrying",
            next_retry_at__lte=now,
        ).update(next_retry_at=now + timedelta(minutes=10))

        if not claimed:
            continue

        log_entry = NotificationLog.objects.select_related("channel").get(id=log_id)

        try:
            # Re-queue for delivery
            send_notification_task.delay(
                channel_url=log_entry.channel_url,
                title="SkysPy Notification",  # Original title not stored
                body=log_entry.message or "",
                priority="warning",
                event_type=log_entry.notification_type,
                channel_type=log_entry.channel.channel_type if log_entry.channel else "webhook",
                channel_id=log_entry.channel_id,
                context=log_entry.details,
                notification_log_id=log_entry.id,
            )
            processed += 1
        except Exception as e:  # broad: background loop must keep processing remaining items on per-item failure
            logger.error(f"Failed to re-queue notification {log_entry.id}: {e}")

    return {"processed": processed}


@shared_task
def cleanup_old_notification_logs(days: int = 30):
    """
    Clean up old notification logs.

    Removes logs older than the specified number of days.
    """
    from skyspy.models.notifications import NotificationLog

    cutoff = timezone.now() - timedelta(days=days)
    deleted, _ = NotificationLog.objects.filter(timestamp__lt=cutoff).delete()

    logger.info(f"Cleaned up {deleted} old notification logs")
    return {"deleted": deleted}


@shared_task
def verify_notification_channel(channel_id: int) -> dict[str, Any]:
    """
    Send a test notification to verify a channel configuration.

    Args:
        channel_id: ID of the NotificationChannel to test

    Returns:
        Dict with test result
    """
    from skyspy.models.notifications import NotificationChannel

    try:
        channel = NotificationChannel.objects.get(id=channel_id)
    except NotificationChannel.DoesNotExist:
        return {"success": False, "error": "Channel not found"}

    try:
        apobj = apprise.Apprise()
        apobj.add(channel.apprise_url)

        result = apobj.notify(
            title="SkysPy Test Notification",
            body="This is a test notification from SkysPy. If you receive this, your channel is configured correctly!",
            notify_type=apprise.NotifyType.INFO,
        )

        if result:
            channel.verified = True
            channel.last_success = timezone.now()
            channel.last_error = None
            channel.save(update_fields=["verified", "last_success", "last_error"])
            return {"success": True, "message": "Test notification sent successfully"}
        else:
            channel.last_failure = timezone.now()
            channel.last_error = "Apprise returned False"
            channel.save(update_fields=["last_failure", "last_error"])
            return {"success": False, "error": "Notification delivery failed"}

    except ImportError:
        return {"success": False, "error": "Apprise library not installed"}
    except Exception as e:  # broad: apprise notify() has unknowable failure modes; records failure and returns result
        channel.last_failure = timezone.now()
        channel.last_error = str(e)
        channel.save(update_fields=["last_failure", "last_error"])
        return {"success": False, "error": str(e)}


@shared_task
def send_bulk_notifications(notifications: list, delay_between_ms: int = 100):
    """
    Send multiple notifications with rate limiting.

    Args:
        notifications: List of notification dicts with channel_url, title, body
        delay_between_ms: Delay between sends to avoid rate limiting
    """
    results = []
    for i, notif in enumerate(notifications):
        try:
            result = send_notification_task.delay(**notif)
            results.append({"index": i, "task_id": result.id})
        except Exception as e:  # broad: loop must continue queueing remaining notifications on per-item failure
            results.append({"index": i, "error": str(e)})

        # Rate limiting delay
        if delay_between_ms > 0 and i < len(notifications) - 1:
            time.sleep(delay_between_ms / 1000)

    return {"queued": len([r for r in results if "task_id" in r]), "results": results}


@shared_task
def cleanup_notification_cooldowns():
    """
    Clean up old notification cooldown entries to prevent memory growth.

    This task runs every 30 minutes (configured in celery.py beat_schedule)
    and removes cooldown entries older than 10 minutes (2x the default cooldown).

    RPi Optimization: Prevents unbounded memory growth from cooldown tracking.
    """
    try:
        from skyspy.services.notifications import cleanup_cooldowns

        cleanup_cooldowns()
        logger.debug("Notification cooldowns cleaned up")
        return {"status": "success"}
    except ImportError:
        logger.debug("Notifications service not available")
        return {"status": "skipped", "reason": "module not available"}
    except Exception as e:  # broad: periodic beat task guard; must never crash the worker
        logger.warning(f"Failed to cleanup notification cooldowns: {e}")
        return {"status": "error", "error": str(e)}


@shared_task(
    bind=True,
    max_retries=5,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=3600,
    retry_jitter=True,
)
def send_webhook_task(
    self,
    url: str,
    data: dict,
    timeout: float = 10.0,
    rule_id: int = None,
    rule_name: str = None,
):
    """
    Send webhook notification asynchronously with retry support.

    This task handles webhook delivery asynchronously so that alert processing
    isn't blocked by slow or failing webhooks.

    Args:
        url: Webhook URL to POST to
        data: JSON payload to send
        timeout: Request timeout in seconds
        rule_id: Alert rule ID for logging
        rule_name: Alert rule name for logging

    Returns:
        Dict with delivery status
    """
    import httpx

    from skyspy.services.notifications import _is_safe_url

    # Validate URL safety (SSRF prevention)
    if not _is_safe_url(url):
        logger.warning(f"Blocked unsafe webhook URL for rule {rule_id}: {url[:100]}")
        return {"status": "blocked", "reason": "unsafe_url"}

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=data)
            response.raise_for_status()

            logger.debug(f"Webhook delivered to {url[:50]}... status={response.status_code}")
            return {
                "status": "delivered",
                "status_code": response.status_code,
                "rule_id": rule_id,
            }

    except httpx.TimeoutException:
        logger.warning(f"Webhook timeout for rule {rule_id}: {url[:50]}...")
        raise  # Will trigger retry

    except httpx.HTTPStatusError as e:
        logger.warning(f"Webhook HTTP error for rule {rule_id}: {e.response.status_code}")
        if e.response.status_code >= 500:
            raise  # Retry on 5xx errors
        # Don't retry on 4xx errors (client errors)
        return {
            "status": "failed",
            "status_code": e.response.status_code,
            "rule_id": rule_id,
        }

    except Exception as e:  # broad: catch-all fallback after specific httpx handlers; re-raises to trigger Celery retry
        logger.error(f"Webhook failed for rule {rule_id}: {e}")
        raise  # Will trigger retry
