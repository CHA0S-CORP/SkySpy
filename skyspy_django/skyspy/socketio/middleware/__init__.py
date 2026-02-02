"""Socket.IO middleware for authentication and permissions."""

from .auth import authenticate_socket
from .permissions import (
    REQUEST_PERMISSIONS,
    TOPIC_PERMISSIONS,
    check_request_permission,
    check_topic_permission,
    get_allowed_topics,
)

__all__ = [
    "authenticate_socket",
    "check_topic_permission",
    "check_request_permission",
    "get_allowed_topics",
    "TOPIC_PERMISSIONS",
    "REQUEST_PERMISSIONS",
]
