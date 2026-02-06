import { useState, useCallback } from 'react';

/**
 * @typedef {Object} DataBlockOffset
 * @property {number} x - X offset from default position (pixels)
 * @property {number} y - Y offset from default position (pixels)
 */

/**
 * @typedef {Object} DragState
 * @property {string|null} aircraftHex - Hex of aircraft being dragged
 * @property {number} startX - Initial mouse X position
 * @property {number} startY - Initial mouse Y position
 * @property {number} startOffsetX - Initial block X offset
 * @property {number} startOffsetY - Initial block Y offset
 */

/**
 * @typedef {Object} UseDataBlockPositionsReturn
 * @property {Object<string, DataBlockOffset>} positions - Map of aircraft hex to offset
 * @property {DragState} dragState - Current drag operation state
 * @property {function(string): DataBlockOffset} getOffset - Get offset for an aircraft
 * @property {function(string, number, number): void} setOffset - Set offset for an aircraft
 * @property {function(string): void} resetOffset - Reset offset for an aircraft to default
 * @property {function(): void} resetAllOffsets - Reset all offsets to default
 * @property {function(MouseEvent, string): boolean} handleMouseDown - Handle Shift+click drag start
 * @property {function(MouseEvent): void} handleMouseMove - Handle drag movement
 * @property {function(): void} handleMouseUp - Handle drag end
 * @property {boolean} isDragging - Whether a drag operation is in progress
 * @property {function(Set<string>): void} pruneStaleAircraft - Remove offsets for aircraft no longer visible
 */

// const STORAGE_KEY = 'adsb-pro-datablock-positions'; // Available for persistence if needed
const DEFAULT_OFFSET = { x: 0, y: 0 };

// Default data block position relative to aircraft icon
export const DATA_BLOCK_DEFAULT_X = 14;
export const DATA_BLOCK_DEFAULT_Y = -10;

/**
 * Hook to manage data block position offsets for Pro mode
 * Allows users to Shift+drag data blocks to custom positions
 * Positions are stored per-session in memory (not persisted to localStorage to avoid clutter)
 *
 * @returns {UseDataBlockPositionsReturn}
 */
export function useDataBlockPositions() {
  // Map of aircraft hex -> { x, y } offset from default position
  const [positions, setPositions] = useState(() => {
    // Session-only storage - don't persist to localStorage
    // This prevents stale positions from accumulating
    return {};
  });

  // Current drag operation state
  const [dragState, setDragState] = useState({
    aircraftHex: null,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
  });

  const isDragging = dragState.aircraftHex !== null;

  // Get offset for an aircraft (returns default if not set)
  const getOffset = useCallback(
    (hex) => {
      if (!hex) return DEFAULT_OFFSET;
      const key = hex.toUpperCase();
      return positions[key] || DEFAULT_OFFSET;
    },
    [positions]
  );

  // Set offset for an aircraft
  const setOffset = useCallback((hex, x, y) => {
    if (!hex) return;
    const key = hex.toUpperCase();
    setPositions((prev) => ({
      ...prev,
      [key]: { x, y },
    }));
  }, []);

  // Reset offset for a single aircraft
  const resetOffset = useCallback((hex) => {
    if (!hex) return;
    const key = hex.toUpperCase();
    setPositions((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Reset all offsets
  const resetAllOffsets = useCallback(() => {
    setPositions({});
  }, []);

  // Check if a point is within a data block's bounds
  // Returns the aircraft hex if hit, null otherwise
  const hitTestDataBlock = useCallback(
    (mouseX, mouseY, aircraftPositions, _dataBlockDimensions) => {
      // aircraftPositions is an array of { hex, screenX, screenY, blockWidth, blockHeight }
      // Check in reverse order (top-most first for overlapping blocks)
      for (let i = aircraftPositions.length - 1; i >= 0; i--) {
        const ac = aircraftPositions[i];
        const offset = getOffset(ac.hex);

        const blockX = ac.screenX + DATA_BLOCK_DEFAULT_X + offset.x;
        const blockY = ac.screenY + DATA_BLOCK_DEFAULT_Y + offset.y;
        const blockWidth = ac.blockWidth || 100;
        const blockHeight = ac.blockHeight || 40;

        // Add some padding for easier clicking
        const padding = 4;
        if (
          mouseX >= blockX - padding &&
          mouseX <= blockX + blockWidth + padding &&
          mouseY >= blockY - padding &&
          mouseY <= blockY + blockHeight + padding
        ) {
          return ac.hex;
        }
      }
      return null;
    },
    [getOffset]
  );

  // Handle Shift+mousedown to start dragging a data block
  // Returns true if drag started, false otherwise
  const handleMouseDown = useCallback(
    (e, hitAircraftHex) => {
      if (!e.shiftKey || !hitAircraftHex) return false;

      const offset = getOffset(hitAircraftHex);

      setDragState({
        aircraftHex: hitAircraftHex,
        startX: e.clientX,
        startY: e.clientY,
        startOffsetX: offset.x,
        startOffsetY: offset.y,
      });

      return true;
    },
    [getOffset]
  );

  // Handle mouse move during drag
  const handleMouseMove = useCallback(
    (e) => {
      if (!dragState.aircraftHex) return;

      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;

      setOffset(dragState.aircraftHex, dragState.startOffsetX + dx, dragState.startOffsetY + dy);
    },
    [dragState, setOffset]
  );

  // Handle mouse up to end drag
  const handleMouseUp = useCallback(() => {
    if (dragState.aircraftHex) {
      setDragState({
        aircraftHex: null,
        startX: 0,
        startY: 0,
        startOffsetX: 0,
        startOffsetY: 0,
      });
    }
  }, [dragState.aircraftHex]);

  // Prune positions for aircraft that are no longer visible
  // Call periodically to prevent memory buildup
  const pruneStaleAircraft = useCallback((activeHexes) => {
    setPositions((prev) => {
      const next = {};
      for (const hex of Object.keys(prev)) {
        if (activeHexes.has(hex)) {
          next[hex] = prev[hex];
        }
      }
      // Only update if something changed
      if (Object.keys(next).length !== Object.keys(prev).length) {
        return next;
      }
      return prev;
    });
  }, []);

  // Check if an aircraft has a custom offset
  const hasCustomOffset = useCallback(
    (hex) => {
      if (!hex) return false;
      const key = hex.toUpperCase();
      return key in positions;
    },
    [positions]
  );

  // Get count of aircraft with custom positions
  const customPositionCount = Object.keys(positions).length;

  return {
    positions,
    dragState,
    getOffset,
    setOffset,
    resetOffset,
    resetAllOffsets,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    isDragging,
    hitTestDataBlock,
    hasCustomOffset,
    pruneStaleAircraft,
    customPositionCount,
    // Constants for external use
    DATA_BLOCK_DEFAULT_X,
    DATA_BLOCK_DEFAULT_Y,
  };
}

export default useDataBlockPositions;
