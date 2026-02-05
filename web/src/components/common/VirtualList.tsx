import React, { useState, useRef, useCallback, useMemo } from 'react';

interface VirtualListProps<T> {
  /** Array of items to render */
  items: T[];
  /** Fixed height of each item in pixels */
  itemHeight: number;
  /** Height of the scrollable container in pixels */
  containerHeight: number;
  /** Function to render each item */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Number of items to render above/below visible area for smooth scrolling */
  overscan?: number;
  /** Additional CSS class for container */
  className?: string;
  /** Function to get unique key for item */
  getItemKey?: (item: T, index: number) => string | number;
}

/**
 * A virtualized list component that only renders items visible in the viewport.
 * This improves performance when rendering large lists by reducing DOM nodes.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 3,
  className = '',
  getItemKey,
}: VirtualListProps<T>): React.ReactElement {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ensure itemHeight is valid to prevent division by zero
  const safeItemHeight = itemHeight > 0 ? itemHeight : 50;

  // Calculate total scrollable height
  const totalHeight = items.length * safeItemHeight;

  // Calculate which items are visible based on scroll position
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / safeItemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / safeItemHeight);
    const endIndex = Math.min(
      items.length - 1,
      Math.floor(scrollTop / safeItemHeight) + visibleCount + overscan
    );

    return { startIndex, endIndex };
  }, [scrollTop, containerHeight, safeItemHeight, items.length, overscan]);

  // Build array of visible items with their positioning
  const visibleItems = useMemo(() => {
    const result: { item: T; index: number; top: number }[] = [];

    for (let i = visibleRange.startIndex; i <= visibleRange.endIndex; i++) {
      if (i >= 0 && i < items.length) {
        result.push({
          item: items[i],
          index: i,
          top: i * safeItemHeight,
        });
      }
    }

    return result;
  }, [items, visibleRange, safeItemHeight]);

  // Handle scroll events efficiently
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);
  }, []);

  // Type guard to check if value is a non-null object
  const isNonNullObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
  };

  // Get unique key for each item
  const getKey = useCallback(
    (item: T, index: number): string | number => {
      if (getItemKey) {
        return getItemKey(item, index);
      }
      // Try common key properties using type guard
      if (isNonNullObject(item)) {
        if ('id' in item && (typeof item.id === 'string' || typeof item.id === 'number')) {
          return item.id;
        }
        if ('key' in item && (typeof item.key === 'string' || typeof item.key === 'number')) {
          return item.key;
        }
      }
      return index;
    },
    [getItemKey]
  );

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        height: containerHeight,
        overflow: 'auto',
        position: 'relative',
      }}
      onScroll={handleScroll}
    >
      {/* Inner container that represents total scrollable area */}
      <div
        style={{
          height: totalHeight,
          position: 'relative',
        }}
      >
        {/* Only render visible items */}
        {visibleItems.map(({ item, index, top }) => (
          <div
            key={getKey(item, index)}
            style={{
              position: 'absolute',
              top,
              left: 0,
              right: 0,
              height: safeItemHeight,
            }}
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default VirtualList;
