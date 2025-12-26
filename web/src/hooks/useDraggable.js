import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook for making elements draggable
 * Returns position state and event handlers for drag functionality
 */
export function useDraggable(initialPosition = { x: null, y: null }) {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });

  const handleMouseDown = useCallback((e) => {
    // Don't drag if clicking on buttons, links, or interactive elements
    if (e.target.closest('button') || 
        e.target.closest('a') || 
        e.target.closest('input') ||
        e.target.closest('select') ||
        e.target.closest('.no-drag')) {
      return;
    }
    
    setIsDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: position.x ?? rect.left,
      startY: position.y ?? rect.top
    };
    e.preventDefault();
  }, [position]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;
    
    setPosition({
      x: Math.max(0, dragStartRef.current.startX + dx),
      y: Math.max(0, dragStartRef.current.startY + dy)
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Global event listeners for drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove);
      window.addEventListener('touchend', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleMouseMove);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const resetPosition = useCallback(() => {
    setPosition(initialPosition);
  }, [initialPosition]);

  return {
    position,
    setPosition,
    isDragging,
    handleMouseDown,
    resetPosition,
    dragProps: {
      onMouseDown: handleMouseDown,
      onTouchStart: handleMouseDown,
      style: position.x !== null ? { 
        position: 'fixed',
        left: position.x, 
        top: position.y 
      } : undefined
    }
  };
}

export default useDraggable;
