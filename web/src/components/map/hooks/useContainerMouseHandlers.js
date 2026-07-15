import { useCallback, useEffect, useRef } from 'react';

/**
 * Mouse event handlers for the radar container.
 *
 * Handles Pro mode cursor tracking (mouse position to radar coordinates),
 * cursor info display, aircraft hover detection with debounce, range control
 * visibility, and data block drag cleanup.
 *
 * @param {object} options
 * @param {object} options.config - Map configuration (mapMode, etc.)
 * @param {number} options.radarRange - Current radar range in NM
 * @param {object} options.proPanOffset - Pro mode pan offset { x, y }
 * @param {number} options.feederLat - Feeder latitude
 * @param {number} options.feederLon - Feeder longitude
 * @param {Array} options.aircraft - Array of aircraft objects
 * @param {object} options.canvasRef - Ref to the canvas element
 * @param {object} options.containerRef - Ref to the container element
 * @param {boolean} options.isDataBlockDragging - Whether a data block is being dragged
 * @param {Function} options.handleDataBlockDragMove - Handler for data block drag move
 * @param {Function} options.handleDataBlockDragEnd - Handler for data block drag end
 * @param {object|null} options.hoverInfo - Current hover info state
 * @param {Function} options.setHoverInfo - Setter for hover info
 * @param {object} options.hoverTimeoutRef - Ref for hover timeout
 * @param {Function} options.setCursorInfo - Setter for cursor info
 * @param {Function} options.setShowRangeControl - Setter for range control visibility
 * @returns {{ handleContainerMouseMove: Function, handleContainerMouseLeave: Function }}
 */
export function useContainerMouseHandlers({
  config,
  radarRange,
  proPanOffset,
  feederLat,
  feederLon,
  aircraft,
  canvasRef,
  containerRef,
  isDataBlockDragging,
  handleDataBlockDragMove,
  handleDataBlockDragEnd,
  hoverInfo,
  setHoverInfo,
  hoverTimeoutRef,
  setCursorInfo,
  setShowRangeControl,
}) {
  const cursorPosRef = useRef({ x: 0, y: 0 });
  const lastHoverCheckRef = useRef(0);

  // Handle mouse move on radar container to show/hide range control and track cursor
  const handleContainerMouseMove = useCallback(
    (e) => {
      // Phase 14.3: Handle data block dragging
      if (isDataBlockDragging) {
        handleDataBlockDragMove(e);
        return; // Don't process other move logic while dragging
      }

      const container = e.currentTarget;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const containerHeight = rect.height;
      const containerWidth = rect.width;

      // Show range control when mouse is in bottom 15% of container
      const showThreshold = containerHeight * 0.85;
      setShowRangeControl(mouseY > showThreshold);

      // Store cursor position for draw loop
      cursorPosRef.current = { x: mouseX, y: mouseY };

      // Calculate cursor lat/lon/distance/bearing for Pro mode
      if (config.mapMode === 'pro' && canvasRef.current) {
        const centerX = containerWidth / 2;
        const centerY = containerHeight / 2;
        const maxRadius = Math.min(containerWidth, containerHeight) * 0.45;
        const pixelsPerNm = maxRadius / radarRange;

        // Convert screen position to nm offset (accounting for pan)
        const nmX = (mouseX - centerX - proPanOffset.x) / pixelsPerNm;
        const nmY = -(mouseY - centerY - proPanOffset.y) / pixelsPerNm; // Flip Y

        // Convert nm offset to lat/lon
        const cursorLat = feederLat + nmY / 60;
        const cursorLon = feederLon + nmX / (60 * Math.cos((feederLat * Math.PI) / 180));

        // Calculate distance and bearing from feeder
        const distance = Math.sqrt(nmX * nmX + nmY * nmY);
        const bearing = ((Math.atan2(nmX, nmY) * 180) / Math.PI + 360) % 360;

        setCursorInfo({
          x: mouseX,
          y: mouseY,
          lat: cursorLat,
          lon: cursorLon,
          distance: distance,
          bearing: bearing,
        });

        // Check for aircraft hover (with debounce)
        const now = Date.now();
        if (now - lastHoverCheckRef.current > 100) {
          // 100ms debounce
          lastHoverCheckRef.current = now;

          // Clear any pending hover timeout
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
          }

          // Find aircraft under cursor
          let foundHover = null;
          const hoverThreshold = 25; // pixels

          aircraft.forEach((ac) => {
            if (!ac.lat || !ac.lon) return;
            const acNmX = (ac.lon - feederLon) * 60 * Math.cos((feederLat * Math.PI) / 180);
            const acNmY = (ac.lat - feederLat) * 60;
            const acX = centerX + acNmX * pixelsPerNm + proPanOffset.x;
            const acY = centerY - acNmY * pixelsPerNm + proPanOffset.y;

            const dist = Math.sqrt((mouseX - acX) ** 2 + (mouseY - acY) ** 2);
            if (dist < hoverThreshold && (!foundHover || dist < foundHover.dist)) {
              foundHover = { aircraft: ac, x: acX, y: acY, dist };
            }
          });

          if (foundHover) {
            // Set hover info after 500ms delay
            hoverTimeoutRef.current = setTimeout(() => {
              setHoverInfo({ aircraft: foundHover.aircraft, x: foundHover.x, y: foundHover.y });
            }, 500);
          } else {
            setHoverInfo(null);
          }
        }
      }
    },
    [
      config.mapMode,
      radarRange,
      proPanOffset,
      feederLat,
      feederLon,
      aircraft,
      isDataBlockDragging,
      handleDataBlockDragMove,
    ]
  );

  const handleContainerMouseLeave = useCallback(() => {
    setShowRangeControl(false);
    setCursorInfo(null);
    setHoverInfo(null);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    // Phase 14.3: End data block drag on mouse leave
    if (isDataBlockDragging) {
      handleDataBlockDragEnd();
    }
  }, [isDataBlockDragging, handleDataBlockDragEnd]);

  // Phase 14.3: Global mouse up handler for data block dragging
  useEffect(() => {
    if (isDataBlockDragging) {
      const handleGlobalMouseUp = () => handleDataBlockDragEnd();
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDataBlockDragging, handleDataBlockDragEnd]);

  return { handleContainerMouseMove, handleContainerMouseLeave, cursorPosRef };
}
