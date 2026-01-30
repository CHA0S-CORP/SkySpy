"""
SkysPy Socket.IO module.

Provides real-time WebSocket communication using Socket.IO with Redis
for multi-process support.
"""

from skyspy.socketio.server import sio, socket_app

__all__ = ['sio', 'socket_app']
