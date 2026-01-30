"""
Socket.IO AsyncServer configuration for SkysPy.

This module sets up the Socket.IO server with:
- Redis manager for multi-process support
- CORS configuration from Django settings
- ASGI integration for use with Uvicorn/Daphne
"""

import logging

import socketio
from django.conf import settings

logger = logging.getLogger(__name__)

# Determine CORS allowed origins from settings
def _get_cors_origins():
    """
    Get CORS allowed origins from Django settings.

    Returns a list of allowed origins, '*' for all origins,
    or an empty list if CORS is not configured.
    """
    if getattr(settings, 'CORS_ALLOW_ALL_ORIGINS', False):
        return '*'

    origins = getattr(settings, 'CORS_ALLOWED_ORIGINS', [])
    if origins:
        return origins

    # Fallback for development: allow localhost
    if getattr(settings, 'DEBUG', False):
        return [
            'http://localhost:3000',
            'http://localhost:5173',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:5173',
        ]

    return []


def _create_client_manager():
    """
    Create the appropriate client manager based on environment.

    Uses Redis for production (multi-process support) or
    in-memory for development/testing.
    """
    redis_url = getattr(settings, 'REDIS_URL', None)
    build_mode = getattr(settings, 'BUILD_MODE', False)

    if build_mode or not redis_url:
        logger.info("Socket.IO using in-memory client manager")
        return None  # Uses default in-memory manager

    try:
        manager = socketio.AsyncRedisManager(redis_url)
        logger.info(f"Socket.IO using Redis client manager: {redis_url}")
        return manager
    except Exception as e:
        logger.warning(f"Failed to create Redis manager, falling back to in-memory: {e}")
        return None


# Create the Socket.IO AsyncServer
cors_origins = _get_cors_origins()
client_manager = _create_client_manager()

sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=cors_origins,
    client_manager=client_manager,
    logger=logger,
    engineio_logger=logger if getattr(settings, 'DEBUG', False) else False,
)

# Create ASGI application for mounting in Django ASGI config
socket_app = socketio.ASGIApp(
    sio,
    socketio_path='socket.io',
)

logger.info(f"Socket.IO server initialized (CORS origins: {cors_origins})")

# NOTE: Connection handlers are defined in namespaces (MainNamespace, etc.)
# Do NOT add global @sio.event connect/disconnect handlers here as they
# override the namespace handlers.
