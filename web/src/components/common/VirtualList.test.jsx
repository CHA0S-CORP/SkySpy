import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { VirtualList, useVirtualList } from './VirtualList';
import { renderHook } from '@testing-library/react';

describe('VirtualList', () => {
  const createItems = (count) =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
    }));

  const defaultRenderItem = (item, index) => (
    <div data-testid={`item-${index}`}>{item.name}</div>
  );

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic rendering', () => {
    it('should render container with virtual-list class', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      expect(container.querySelector('.virtual-list')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
          className="custom-class"
        />
      );

      expect(container.querySelector('.virtual-list.custom-class')).toBeInTheDocument();
    });

    it('should render visible items', () => {
      render(
        <VirtualList
          items={createItems(100)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
          overscan={2}
        />
      );

      // With height 200 and itemHeight 50, should show ~4 items + overscan
      expect(screen.getByTestId('item-0')).toBeInTheDocument();
      expect(screen.getByTestId('item-1')).toBeInTheDocument();
      expect(screen.getByTestId('item-2')).toBeInTheDocument();
      expect(screen.getByTestId('item-3')).toBeInTheDocument();
    });

    it('should not render items far outside viewport', () => {
      render(
        <VirtualList
          items={createItems(100)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
          overscan={2}
        />
      );

      // Items far down the list should not be rendered
      expect(screen.queryByTestId('item-50')).not.toBeInTheDocument();
      expect(screen.queryByTestId('item-99')).not.toBeInTheDocument();
    });

    it('should render inner container with correct total height', () => {
      const { container } = render(
        <VirtualList
          items={createItems(100)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      const innerContainer = container.querySelector('.virtual-list-inner');
      expect(innerContainer).toHaveStyle({ height: '5000px' }); // 100 * 50
    });
  });

  describe('item positioning', () => {
    it('should position items absolutely', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      const firstItem = container.querySelector('.virtual-list-item');
      expect(firstItem).toHaveStyle({ position: 'absolute' });
    });

    it('should set correct top position for items', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
          overscan={0}
        />
      );

      const items = container.querySelectorAll('.virtual-list-item');
      expect(items[0]).toHaveStyle({ top: '0px' });
      expect(items[1]).toHaveStyle({ top: '50px' });
      expect(items[2]).toHaveStyle({ top: '100px' });
    });

    it('should set correct height for items', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      const firstItem = container.querySelector('.virtual-list-item');
      expect(firstItem).toHaveStyle({ height: '50px' });
    });
  });

  describe('scrolling', () => {
    it('should update visible items on scroll', () => {
      const { container } = render(
        <VirtualList
          items={createItems(100)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
          overscan={2}
        />
      );

      const scrollContainer = container.querySelector('.virtual-list');

      // Initially item 20 should not be visible
      expect(screen.queryByTestId('item-20')).not.toBeInTheDocument();

      // Scroll down to show items 20-30
      act(() => {
        Object.defineProperty(scrollContainer, 'scrollTop', {
          value: 1000,
          writable: true,
        });
        fireEvent.scroll(scrollContainer, { target: { scrollTop: 1000 } });
      });

      // Items around position 20 (1000/50) should now be visible
      expect(screen.getByTestId('item-20')).toBeInTheDocument();
    });

    it('should call onScroll callback', async () => {
      const onScroll = vi.fn();
      const { container } = render(
        <VirtualList
          items={createItems(100)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
          onScroll={onScroll}
        />
      );

      const scrollContainer = container.querySelector('.virtual-list');

      await act(async () => {
        fireEvent.scroll(scrollContainer, { target: { scrollTop: 500 } });
      });

      expect(onScroll).toHaveBeenCalledWith(
        expect.objectContaining({
          scrollTop: 500,
        })
      );
    });
  });

  describe('overscan', () => {
    it('should render extra items based on overscan value', () => {
      render(
        <VirtualList
          items={createItems(100)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
          overscan={5}
        />
      );

      // With overscan of 5, should render 5 extra items beyond visible area
      // Visible: 4 items, Overscan above: 0 (at top), Overscan below: 5
      expect(screen.getByTestId('item-8')).toBeInTheDocument();
    });

    it('should use default overscan of 5', () => {
      render(
        <VirtualList
          items={createItems(100)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      // Default overscan should render extra items
      expect(screen.getByTestId('item-8')).toBeInTheDocument();
    });
  });

  describe('item keys', () => {
    it('should use item.id as key when available', () => {
      const items = [
        { id: 'unique-1', name: 'Item 1' },
        { id: 'unique-2', name: 'Item 2' },
      ];

      const { container } = render(
        <VirtualList
          items={items}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      // Items should render without key warnings
      expect(container.querySelectorAll('.virtual-list-item')).toHaveLength(2);
    });

    it('should use getItemKey when provided', () => {
      const items = [
        { customId: 'custom-1', name: 'Item 1' },
        { customId: 'custom-2', name: 'Item 2' },
      ];

      const { container } = render(
        <VirtualList
          items={items}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
          getItemKey={(item) => item.customId}
        />
      );

      expect(container.querySelectorAll('.virtual-list-item')).toHaveLength(2);
    });

    it('should fallback to index when no id or key available', () => {
      const items = [{ name: 'Item 1' }, { name: 'Item 2' }];

      const { container } = render(
        <VirtualList
          items={items}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      expect(container.querySelectorAll('.virtual-list-item')).toHaveLength(2);
    });
  });

  describe('empty state', () => {
    it('should render empty container when items is empty', () => {
      const { container } = render(
        <VirtualList
          items={[]}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      expect(container.querySelector('.virtual-list')).toBeInTheDocument();
      expect(container.querySelectorAll('.virtual-list-item')).toHaveLength(0);
    });
  });

  describe('itemHeight validation', () => {
    it('should use fallback height when itemHeight is 0', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={0}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      // Should use default fallback of 50
      const innerContainer = container.querySelector('.virtual-list-inner');
      expect(innerContainer).toHaveStyle({ height: '500px' }); // 10 * 50
    });

    it('should use fallback height when itemHeight is negative', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={-50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      const innerContainer = container.querySelector('.virtual-list-inner');
      expect(innerContainer).toHaveStyle({ height: '500px' }); // 10 * 50 (fallback)
    });

    it('should use fallback height when itemHeight is NaN', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={NaN}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      const innerContainer = container.querySelector('.virtual-list-inner');
      expect(innerContainer).toHaveStyle({ height: '500px' });
    });

    it('should use fallback height when itemHeight is Infinity', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={Infinity}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      const innerContainer = container.querySelector('.virtual-list-inner');
      expect(innerContainer).toHaveStyle({ height: '500px' });
    });
  });

  describe('height prop', () => {
    it('should set container height from height prop', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={300}
        />
      );

      expect(container.querySelector('.virtual-list')).toHaveStyle({ height: '300px' });
    });

    it('should default to 400px when height is auto and parent has no height', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height="auto"
        />
      );

      expect(container.querySelector('.virtual-list')).toHaveStyle({ height: '400px' });
    });
  });

  describe('container styles', () => {
    it('should have overflow auto', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      expect(container.querySelector('.virtual-list')).toHaveStyle({ overflow: 'auto' });
    });

    it('should have position relative', () => {
      const { container } = render(
        <VirtualList
          items={createItems(10)}
          itemHeight={50}
          renderItem={defaultRenderItem}
          height={200}
        />
      );

      expect(container.querySelector('.virtual-list')).toHaveStyle({ position: 'relative' });
    });
  });
});

describe('useVirtualList', () => {
  it('should return visible range based on scroll position', () => {
    const { result } = renderHook(() =>
      useVirtualList({
        itemCount: 100,
        itemHeight: 50,
        containerHeight: 200,
        overscan: 2,
      })
    );

    expect(result.current.visibleRange.startIndex).toBe(0);
    expect(result.current.visibleRange.endIndex).toBeLessThanOrEqual(10);
  });

  it('should calculate total height correctly', () => {
    const { result } = renderHook(() =>
      useVirtualList({
        itemCount: 100,
        itemHeight: 50,
        containerHeight: 200,
      })
    );

    expect(result.current.totalHeight).toBe(5000);
  });

  it('should update visible range on scroll', () => {
    const { result } = renderHook(() =>
      useVirtualList({
        itemCount: 100,
        itemHeight: 50,
        containerHeight: 200,
        overscan: 2,
      })
    );

    act(() => {
      result.current.handleScroll({ target: { scrollTop: 500 } });
    });

    // Should show items around index 10 (500/50)
    expect(result.current.visibleRange.startIndex).toBeGreaterThan(0);
  });

  it('should provide scrollToIndex function', () => {
    const { result } = renderHook(() =>
      useVirtualList({
        itemCount: 100,
        itemHeight: 50,
        containerHeight: 200,
      })
    );

    expect(typeof result.current.scrollToIndex).toBe('function');
  });

  it('should handle invalid itemHeight', () => {
    const { result } = renderHook(() =>
      useVirtualList({
        itemCount: 100,
        itemHeight: 0,
        containerHeight: 200,
      })
    );

    // Should use fallback height of 50
    expect(result.current.totalHeight).toBe(5000);
  });

  it('should handle scrollToIndex with start alignment', () => {
    const { result } = renderHook(() =>
      useVirtualList({
        itemCount: 100,
        itemHeight: 50,
        containerHeight: 200,
      })
    );

    act(() => {
      result.current.scrollToIndex(10, 'start');
    });

    expect(result.current.scrollTop).toBe(500); // 10 * 50
  });

  it('should handle scrollToIndex with center alignment', () => {
    const { result } = renderHook(() =>
      useVirtualList({
        itemCount: 100,
        itemHeight: 50,
        containerHeight: 200,
      })
    );

    act(() => {
      result.current.scrollToIndex(10, 'center');
    });

    // 10 * 50 - 200/2 + 50/2 = 500 - 100 + 25 = 425
    expect(result.current.scrollTop).toBe(425);
  });

  it('should handle scrollToIndex with end alignment', () => {
    const { result } = renderHook(() =>
      useVirtualList({
        itemCount: 100,
        itemHeight: 50,
        containerHeight: 200,
      })
    );

    act(() => {
      result.current.scrollToIndex(10, 'end');
    });

    // (10 + 1) * 50 - 200 = 550 - 200 = 350
    expect(result.current.scrollTop).toBe(350);
  });

  it('should clamp scrollToIndex to valid range', () => {
    const { result } = renderHook(() =>
      useVirtualList({
        itemCount: 100,
        itemHeight: 50,
        containerHeight: 200,
      })
    );

    act(() => {
      result.current.scrollToIndex(0, 'start');
    });

    expect(result.current.scrollTop).toBe(0);
  });
});
