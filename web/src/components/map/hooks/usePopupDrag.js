import { useCallback, useEffect, useRef } from 'react';

/**
 * Hook that manages drag behavior for popup, legend, and aircraft list panels.
 * Extracted from MapView.jsx — handles mousedown initiation, global mousemove/mouseup
 * listeners, and touch event support for legend and list panels.
 *
 * @param {Object} params
 * @param {{ x: number, y: number }} params.popupPosition
 * @param {Function} params.setPopupPosition
 * @param {boolean} params.isDragging
 * @param {Function} params.setIsDragging
 * @param {{ x: number|null, y: number|null }} params.legendPosition
 * @param {Function} params.setLegendPosition
 * @param {boolean} params.isLegendDragging
 * @param {Function} params.setIsLegendDragging
 * @param {React.MutableRefObject} params.legendDragStartRef
 * @param {{ x: number|null, y: number|null }} params.listPosition
 * @param {Function} params.setListPosition
 * @param {boolean} params.isListDragging
 * @param {Function} params.setIsListDragging
 * @param {React.MutableRefObject} params.listDragStartRef
 *
 * @returns {{
 *   handlePopupMouseDown: Function,
 *   handleLegendMouseDown: Function,
 *   handleListMouseDown: Function,
 * }}
 */
export function usePopupDrag({
  popupPosition,
  setPopupPosition,
  isDragging,
  setIsDragging,
  legendPosition,
  setLegendPosition,
  isLegendDragging,
  setIsLegendDragging,
  legendDragStartRef,
  listPosition,
  setListPosition,
  isListDragging,
  setIsListDragging,
  listDragStartRef,
}) {
  // ── Popup drag handlers ──────────────────────────────────────────────
  const dragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });

  const handlePopupMouseDown = (e) => {
    if (e.target.closest('.popup-close') || e.target.closest('a') || e.target.closest('button'))
      return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: popupPosition.x,
      startY: popupPosition.y,
    };
    e.preventDefault();
  };

  const handlePopupMouseMove = useCallback(
    (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPopupPosition({
        x: Math.max(0, dragStartRef.current.startX + dx),
        y: Math.max(0, dragStartRef.current.startY + dy),
      });
    },
    [isDragging]
  );

  const handlePopupMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global mouse handlers for dragging
  // Use refs to avoid stale closure issues with event handlers
  const handlePopupMouseMoveRef = useRef(handlePopupMouseMove);
  const handlePopupMouseUpRef = useRef(handlePopupMouseUp);
  handlePopupMouseMoveRef.current = handlePopupMouseMove;
  handlePopupMouseUpRef.current = handlePopupMouseUp;

  useEffect(() => {
    if (isDragging) {
      const moveHandler = (e) => handlePopupMouseMoveRef.current(e);
      const upHandler = (e) => handlePopupMouseUpRef.current(e);
      window.addEventListener('mousemove', moveHandler);
      window.addEventListener('mouseup', upHandler);
      return () => {
        window.removeEventListener('mousemove', moveHandler);
        window.removeEventListener('mouseup', upHandler);
      };
    }
  }, [isDragging]);

  // ── Legend drag handlers ─────────────────────────────────────────────
  const handleLegendMouseDown = (e) => {
    if (e.target.closest('button')) return;
    setIsLegendDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    legendDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: legendPosition.x ?? rect.left,
      startY: legendPosition.y ?? rect.top,
    };
    e.preventDefault();
  };

  const handleLegendMouseMove = useCallback(
    (e) => {
      if (!isLegendDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - legendDragStartRef.current.x;
      const dy = clientY - legendDragStartRef.current.y;
      setLegendPosition({
        x: Math.max(0, legendDragStartRef.current.startX + dx),
        y: Math.max(0, legendDragStartRef.current.startY + dy),
      });
    },
    [isLegendDragging]
  );

  const handleLegendMouseUp = useCallback(() => {
    setIsLegendDragging(false);
  }, []);

  // Add global mouse/touch handlers for legend dragging
  useEffect(() => {
    if (isLegendDragging) {
      window.addEventListener('mousemove', handleLegendMouseMove);
      window.addEventListener('mouseup', handleLegendMouseUp);
      window.addEventListener('touchmove', handleLegendMouseMove);
      window.addEventListener('touchend', handleLegendMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleLegendMouseMove);
        window.removeEventListener('mouseup', handleLegendMouseUp);
        window.removeEventListener('touchmove', handleLegendMouseMove);
        window.removeEventListener('touchend', handleLegendMouseUp);
      };
    }
  }, [isLegendDragging, handleLegendMouseMove, handleLegendMouseUp]);

  // ── Aircraft list drag handlers ──────────────────────────────────────
  const handleListMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('.aircraft-list-item')) return;
    setIsListDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    listDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: listPosition.x ?? rect.left,
      startY: listPosition.y ?? rect.top,
    };
    e.preventDefault();
  };

  const handleListMouseMove = useCallback(
    (e) => {
      if (!isListDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - listDragStartRef.current.x;
      const dy = clientY - listDragStartRef.current.y;
      setListPosition({
        x: Math.max(0, listDragStartRef.current.startX + dx),
        y: Math.max(0, listDragStartRef.current.startY + dy),
      });
    },
    [isListDragging]
  );

  const handleListMouseUp = useCallback(() => {
    setIsListDragging(false);
  }, []);

  // Add global mouse/touch handlers for list dragging
  useEffect(() => {
    if (isListDragging) {
      window.addEventListener('mousemove', handleListMouseMove);
      window.addEventListener('mouseup', handleListMouseUp);
      window.addEventListener('touchmove', handleListMouseMove);
      window.addEventListener('touchend', handleListMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleListMouseMove);
        window.removeEventListener('mouseup', handleListMouseUp);
        window.removeEventListener('touchmove', handleListMouseMove);
        window.removeEventListener('touchend', handleListMouseUp);
      };
    }
  }, [isListDragging, handleListMouseMove, handleListMouseUp]);

  return {
    handlePopupMouseDown,
    handleLegendMouseDown,
    handleListMouseDown,
  };
}
