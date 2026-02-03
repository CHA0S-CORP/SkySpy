import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';

/**
 * Virtual scrolling list component for efficient rendering of large datasets
 * Pure React implementation with no external dependencies
 *
 * @param {Object} props
 * @param {Array} props.items - Array of items to render
 * @param {number} props.itemHeight - Fixed height of each item in pixels
 * @param {number} props.overscan - Number of items to render above/below visible area (default: 5)
 * @param {Function} props.renderItem - Function to render each item: (item, index) => React.Node
 * @param {string} props.className - Additional CSS class for container
 * @param {number} props.height - Container height in pixels (or 'auto' for parent height)
 * @param {Function} props.onScroll - Callback when scrolling (scrollTop, scrollHeight, clientHeight)
 * @param {Function} props.getItemKey - Function to get unique key for item (item, index) => string
 */
export function VirtualList({
  items = [],
  itemHeight,
  overscan = 5,
  renderItem,
  className = '',
  height = 400,
  onScroll,
  getItemKey,
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef(null);
  const [containerHeight, setContainerHeight] = useState(height === 'auto' ? 400 : height);

  // Validate itemHeight to prevent division by zero and invalid calculations
  const safeItemHeight =
    typeof itemHeight === 'number' && itemHeight > 0 && isFinite(itemHeight) ? itemHeight : 50; // Default fallback height

  // Update container height when 'auto' or on resize
  useEffect(() => {
    if (height === 'auto' && containerRef.current) {
      const updateHeight = () => {
        const parent = containerRef.current?.parentElement;
        if (parent) {
          setContainerHeight(parent.clientHeight || 400);
        }
      };

      updateHeight();
      window.addEventListener('resize', updateHeight);
      return () => window.removeEventListener('resize', updateHeight);
    } else if (height !== 'auto') {
      setContainerHeight(height);
    }
  }, [height]);

  // Calculate total height
  const totalHeight = items.length * safeItemHeight;

  // Calculate visible range with overscan
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / safeItemHeight) - overscan);
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / safeItemHeight) + overscan
    );

    return { startIndex, endIndex };
  }, [scrollTop, containerHeight, safeItemHeight, items.length, overscan]);

  // Get visible items
  const visibleItems = useMemo(() => {
    const result = [];
    for (let i = visibleRange.startIndex; i <= visibleRange.endIndex; i++) {
      if (items[i] !== undefined) {
        result.push({
          item: items[i],
          index: i,
          style: {
            position: 'absolute',
            top: i * safeItemHeight,
            left: 0,
            right: 0,
            height: safeItemHeight,
          },
        });
      }
    }
    return result;
  }, [items, visibleRange, safeItemHeight]);

  // Handle scroll
  const handleScroll = useCallback(
    (e) => {
      const newScrollTop = e.target.scrollTop;
      setScrollTop(newScrollTop);

      if (onScroll) {
        onScroll({
          scrollTop: newScrollTop,
          scrollHeight: e.target.scrollHeight,
          clientHeight: e.target.clientHeight,
        });
      }
    },
    [onScroll]
  );

  // Scroll to index (available for external use via ref if needed)
  const _scrollToIndex = useCallback(
    (index, align = 'start') => {
      if (!containerRef.current) return;

      let targetScrollTop;
      if (align === 'start') {
        targetScrollTop = index * safeItemHeight;
      } else if (align === 'center') {
        targetScrollTop = index * safeItemHeight - containerHeight / 2 + safeItemHeight / 2;
      } else if (align === 'end') {
        targetScrollTop = (index + 1) * safeItemHeight - containerHeight;
      }

      containerRef.current.scrollTop = Math.max(
        0,
        Math.min(totalHeight - containerHeight, targetScrollTop)
      );
    },
    [safeItemHeight, containerHeight, totalHeight]
  );

  // Get item key
  const getKey = useCallback(
    (item, index) => {
      if (getItemKey) return getItemKey(item, index);
      if (item.id !== undefined) return item.id;
      if (item.key !== undefined) return item.key;
      return index;
    },
    [getItemKey]
  );

  return (
    <div
      ref={containerRef}
      className={`virtual-list ${className}`}
      style={{
        height: containerHeight,
        overflow: 'auto',
        position: 'relative',
      }}
      onScroll={handleScroll}
    >
      <div
        className="virtual-list-inner"
        style={{
          height: totalHeight,
          position: 'relative',
        }}
      >
        {visibleItems.map(({ item, index, style }) => (
          <div key={getKey(item, index)} className="virtual-list-item" style={style}>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Hook for virtual list functionality (for custom implementations)
 */
export function useVirtualList({ itemCount, itemHeight, containerHeight, overscan = 5 }) {
  const [scrollTop, setScrollTop] = useState(0);

  // Validate itemHeight to prevent division by zero and invalid calculations
  const safeItemHeight =
    typeof itemHeight === 'number' && itemHeight > 0 && isFinite(itemHeight) ? itemHeight : 50; // Default fallback height

  const totalHeight = itemCount * safeItemHeight;

  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / safeItemHeight) - overscan);
    const endIndex = Math.min(
      itemCount - 1,
      Math.ceil((scrollTop + containerHeight) / safeItemHeight) + overscan
    );

    return { startIndex, endIndex };
  }, [scrollTop, containerHeight, safeItemHeight, itemCount, overscan]);

  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  const scrollToIndex = useCallback(
    (index, align = 'start') => {
      let targetScrollTop;
      if (align === 'start') {
        targetScrollTop = index * safeItemHeight;
      } else if (align === 'center') {
        targetScrollTop = index * safeItemHeight - containerHeight / 2 + safeItemHeight / 2;
      } else if (align === 'end') {
        targetScrollTop = (index + 1) * safeItemHeight - containerHeight;
      }

      setScrollTop(Math.max(0, Math.min(totalHeight - containerHeight, targetScrollTop)));
      return targetScrollTop;
    },
    [safeItemHeight, containerHeight, totalHeight]
  );

  return {
    visibleRange,
    totalHeight,
    scrollTop,
    handleScroll,
    scrollToIndex,
  };
}

export default VirtualList;
