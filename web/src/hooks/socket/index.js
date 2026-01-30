/**
 * Socket.IO hooks for SkysPy React application.
 *
 * These hooks provide Socket.IO-based real-time communication as an alternative
 * to the Django Channels WebSocket hooks. They maintain the same message format
 * and event types for compatibility.
 *
 * @module hooks/socket
 */

// Core connection hook
export { useSocketIO, default as useSocketIODefault } from './useSocketIO';

// Main data stream hook (replaces useChannelsSocket)
export { useSocketIOData } from './useSocketIOData';

// High-frequency position updates (replaces usePositionChannels)
export { useSocketIOPositions } from './useSocketIOPositions';

// Audio namespace hook (replaces useAudioSocket)
export { useSocketIOAudio, retrySocketIOAudio } from './useSocketIOAudio';

// Request/response pattern hook
export { useSocketIOApi } from './useSocketIOApi';

// Cannonball mode hook (replaces native WebSocket in useCannonballAPI)
export { useSocketIOCannonball } from './useSocketIOCannonball';
