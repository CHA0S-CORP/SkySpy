import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHistoryStream, useLiveIndicator } from './useHistoryStream';

describe('useHistoryStream', () => {
  let mockSubscribeMessages;
  let messageHandler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    // Mock subscribe function that captures the handler
    mockSubscribeMessages = vi.fn((handler) => {
      messageHandler = handler;
      return vi.fn(); // Unsubscribe function
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    messageHandler = null;
  });

  describe('initial state', () => {
    it('should initialize with empty state', () => {
      const { result } = renderHook(() =>
        useHistoryStream({ subscribeMessages: mockSubscribeMessages })
      );

      expect(result.current.items).toEqual([]);
      expect(result.current.isLive).toBe(true);
      expect(result.current.newItemCount).toBe(0);
      expect(result.current.lastUpdate).toBeNull();
    });

    it('should initialize with provided initial data', () => {
      const initialData = [
        { id: 1, type: 'acars' },
        { id: 2, type: 'safety' },
      ];

      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          initialData,
        })
      );

      expect(result.current.items).toEqual(initialData);
    });

    it('should start disabled when enabled is false', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          enabled: false,
        })
      );

      expect(result.current.isLive).toBe(false);
    });
  });

  describe('message subscription', () => {
    it('should subscribe to messages on mount', () => {
      renderHook(() =>
        useHistoryStream({ subscribeMessages: mockSubscribeMessages })
      );

      expect(mockSubscribeMessages).toHaveBeenCalled();
    });

    it('should not subscribe when disabled', () => {
      renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          enabled: false,
        })
      );

      expect(mockSubscribeMessages).not.toHaveBeenCalled();
    });

    it('should unsubscribe on unmount', () => {
      const unsubscribe = vi.fn();
      mockSubscribeMessages.mockReturnValue(unsubscribe);

      const { unmount } = renderHook(() =>
        useHistoryStream({ subscribeMessages: mockSubscribeMessages })
      );

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('ACARS message handling', () => {
    it('should handle acars:message type', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({
          type: 'acars:message',
          data: { id: 1, text: 'Test message' },
        });
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].text).toBe('Test message');
      expect(result.current.items[0]._streamType).toBe('acars');
    });

    it('should handle acars.message type (Django format)', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({
          type: 'acars.message',
          data: { id: 1, text: 'Django message' },
        });
      });

      expect(result.current.items).toHaveLength(1);
    });

    it('should handle message type (legacy)', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({
          type: 'message',
          data: { id: 1, text: 'Legacy message' },
        });
      });

      expect(result.current.items).toHaveLength(1);
    });
  });

  describe('safety event handling', () => {
    it('should handle safety:event type', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'safety',
        })
      );

      act(() => {
        messageHandler({
          type: 'safety:event',
          data: { id: 1, event_type: 'proximity' },
        });
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0]._streamType).toBe('safety');
    });

    it('should handle safety.event type (Django format)', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'safety',
        })
      );

      act(() => {
        messageHandler({
          type: 'safety.event',
          data: { id: 1, event_type: 'tcas' },
        });
      });

      expect(result.current.items).toHaveLength(1);
    });
  });

  describe('sighting handling', () => {
    it('should handle sighting:new type', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'sightings',
        })
      );

      act(() => {
        messageHandler({
          type: 'sighting:new',
          data: { hex: 'ABC123', lat: 37.5, lon: -122.5 },
        });
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0]._streamType).toBe('sighting');
    });

    it('should handle sighting.new type (Django format)', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'sightings',
        })
      );

      act(() => {
        messageHandler({
          type: 'sighting.new',
          data: { hex: 'ABC123' },
        });
      });

      expect(result.current.items).toHaveLength(1);
    });

    it('should handle position type', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'sightings',
        })
      );

      act(() => {
        messageHandler({
          type: 'position',
          data: { hex: 'ABC123' },
        });
      });

      expect(result.current.items).toHaveLength(1);
    });
  });

  describe('all type handling', () => {
    it('should handle all message types when type is all', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'all',
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
        messageHandler({ type: 'safety:event', data: { id: 2 } });
        messageHandler({ type: 'sighting:new', data: { id: 3 } });
      });

      expect(result.current.items).toHaveLength(3);
    });

    it('should not handle mismatched message types', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({ type: 'safety:event', data: { id: 1 } });
      });

      expect(result.current.items).toHaveLength(0);
    });
  });

  describe('item management', () => {
    it('should add items to beginning of list', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1, text: 'First' } });
      });

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 2, text: 'Second' } });
      });

      expect(result.current.items[0].text).toBe('Second');
      expect(result.current.items[1].text).toBe('First');
    });

    it('should trim items to maxItems', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
          maxItems: 3,
        })
      );

      for (let i = 0; i < 5; i++) {
        act(() => {
          messageHandler({ type: 'acars:message', data: { id: i } });
        });
      }

      expect(result.current.items).toHaveLength(3);
    });

    it('should add metadata to items', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
      });

      expect(result.current.items[0]._streamType).toBe('acars');
      expect(result.current.items[0]._receivedAt).toBeDefined();
    });

    it('should update newItemCount', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
        messageHandler({ type: 'acars:message', data: { id: 2 } });
      });

      expect(result.current.newItemCount).toBe(2);
    });

    it('should update lastUpdate', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      expect(result.current.lastUpdate).toBeNull();

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
      });

      expect(result.current.lastUpdate).toBe(Date.now());
    });

    it('should call onNewItem callback', () => {
      const onNewItem = vi.fn();

      renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
          onNewItem,
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
      });

      expect(onNewItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, _streamType: 'acars' }),
        'acars'
      );
    });
  });

  describe('live mode controls', () => {
    it('should toggle live mode', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
        })
      );

      expect(result.current.isLive).toBe(true);

      act(() => {
        result.current.toggleLive();
      });

      expect(result.current.isLive).toBe(false);

      act(() => {
        result.current.toggleLive();
      });

      expect(result.current.isLive).toBe(true);
    });

    it('should reset newItemCount when resuming live mode', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
      });

      expect(result.current.newItemCount).toBe(1);

      act(() => {
        result.current.toggleLive(); // Disable
      });

      act(() => {
        result.current.toggleLive(); // Enable
      });

      expect(result.current.newItemCount).toBe(0);
    });

    it('should enable live mode', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          enabled: false,
        })
      );

      expect(result.current.isLive).toBe(false);

      act(() => {
        result.current.enableLive();
      });

      expect(result.current.isLive).toBe(true);
      expect(result.current.newItemCount).toBe(0);
    });

    it('should disable live mode', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
        })
      );

      expect(result.current.isLive).toBe(true);

      act(() => {
        result.current.disableLive();
      });

      expect(result.current.isLive).toBe(false);
    });

    it('should not add items when live mode is disabled', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        result.current.disableLive();
      });

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
      });

      expect(result.current.items).toHaveLength(0);
    });
  });

  describe('clearing and resetting', () => {
    it('should clear items', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
        messageHandler({ type: 'acars:message', data: { id: 2 } });
      });

      expect(result.current.items).toHaveLength(2);

      act(() => {
        result.current.clearItems();
      });

      expect(result.current.items).toHaveLength(0);
      expect(result.current.newItemCount).toBe(0);
    });

    it('should reset with new data', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
      });

      expect(result.current.newItemCount).toBe(1);

      const newData = [
        { id: 10, text: 'New item 1' },
        { id: 11, text: 'New item 2' },
      ];

      act(() => {
        result.current.resetWithData(newData);
      });

      expect(result.current.items).toEqual(newData);
      expect(result.current.newItemCount).toBe(0);
    });

    it('should mark items as seen', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
        messageHandler({ type: 'acars:message', data: { id: 2 } });
      });

      expect(result.current.newItemCount).toBe(2);

      act(() => {
        result.current.markAsSeen();
      });

      expect(result.current.newItemCount).toBe(0);
    });
  });

  describe('query functions', () => {
    it('should get items by type', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'all',
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
        messageHandler({ type: 'safety:event', data: { id: 2 } });
        messageHandler({ type: 'acars:message', data: { id: 3 } });
      });

      const acarsItems = result.current.getItemsByType('acars');
      expect(acarsItems).toHaveLength(2);

      const safetyItems = result.current.getItemsByType('safety');
      expect(safetyItems).toHaveLength(1);
    });

    it('should get recent items', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler({ type: 'acars:message', data: { id: 1 } });
      });

      act(() => {
        vi.advanceTimersByTime(30000); // 30 seconds
        messageHandler({ type: 'acars:message', data: { id: 2 } });
      });

      const recentItems = result.current.getRecentItems(60); // Last 60 seconds
      expect(recentItems).toHaveLength(2);

      const veryRecentItems = result.current.getRecentItems(10); // Last 10 seconds
      expect(veryRecentItems).toHaveLength(1);
    });
  });

  describe('null/undefined handling', () => {
    it('should ignore null data', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler(null);
      });

      expect(result.current.items).toHaveLength(0);
    });

    it('should ignore undefined data', () => {
      const { result } = renderHook(() =>
        useHistoryStream({
          subscribeMessages: mockSubscribeMessages,
          type: 'acars',
        })
      );

      act(() => {
        messageHandler(undefined);
      });

      expect(result.current.items).toHaveLength(0);
    });
  });
});

describe('useLiveIndicator', () => {
  it('should show indicator when count exceeds threshold', () => {
    const { result, rerender } = renderHook(
      ({ count }) => useLiveIndicator(count, 5),
      { initialProps: { count: 0 } }
    );

    expect(result.current.showIndicator).toBe(false);

    rerender({ count: 5 });
    expect(result.current.showIndicator).toBe(true);

    rerender({ count: 10 });
    expect(result.current.showIndicator).toBe(true);
  });

  it('should not show indicator when count is below threshold', () => {
    const { result } = renderHook(() => useLiveIndicator(3, 5));

    expect(result.current.showIndicator).toBe(false);
  });

  it('should use default threshold of 1', () => {
    const { result, rerender } = renderHook(
      ({ count }) => useLiveIndicator(count),
      { initialProps: { count: 0 } }
    );

    expect(result.current.showIndicator).toBe(false);

    rerender({ count: 1 });
    expect(result.current.showIndicator).toBe(true);
  });

  it('should dismiss indicator', () => {
    const { result } = renderHook(() => useLiveIndicator(5, 1));

    expect(result.current.showIndicator).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.showIndicator).toBe(false);
  });
});
