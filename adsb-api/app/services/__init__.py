"""Services package."""
from app.services.sse import SSEManager, get_sse_manager, create_sse_manager, check_redis_health
from app.services.websocket import (
    ConnectionManager, get_ws_manager, create_ws_manager, handle_websocket
)
from app.services.notifications import NotificationManager, notifier
from app.services.safety import SafetyMonitor, safety_monitor
from app.services.alerts import check_alerts, store_alert_history, evaluate_rule
from app.services.aircraft_info import (
    get_aircraft_info, get_bulk_aircraft_info, refresh_aircraft_info,
    check_and_queue_new_aircraft, get_seen_aircraft_count
)
from app.services.acars import acars_service, store_acars_message, get_acars_messages, get_acars_stats
from app.services.photo_cache import (
    get_cached_photo, download_photo, get_cache_stats as get_photo_cache_stats
)
from app.services import external_db
from app.services import airspace as airspace_service

__all__ = [
    # SSE (legacy, still supported)
    "SSEManager",
    "get_sse_manager",
    "create_sse_manager",
    "check_redis_health",
    # WebSocket (primary)
    "ConnectionManager",
    "get_ws_manager",
    "create_ws_manager",
    "handle_websocket",
    # Other services
    "NotificationManager",
    "notifier",
    "SafetyMonitor",
    "safety_monitor",
    "check_alerts",
    "store_alert_history",
    "evaluate_rule",
    "get_aircraft_info",
    "get_bulk_aircraft_info",
    "refresh_aircraft_info",
    "check_and_queue_new_aircraft",
    "get_seen_aircraft_count",
    "acars_service",
    "store_acars_message",
    "get_acars_messages",
    "get_acars_stats",
    "get_cached_photo",
    "download_photo",
    "get_photo_cache_stats",
    "external_db",
    "airspace_service",
]
