import { useState, useEffect, useCallback, useRef } from 'react';

// Maximum items to keep in memory when streaming
const MAX_STREAMING_ITEMS = 500;

/**
 * useHistoryStream - Hook for real-time streaming of history data
 *
 * Subscribes to Socket.IO messages for live ACARS messages,
 * safety events, etc.
 *
 * @param {Object} options
 * @param {Function} options.subscribeMessages - Message subscriber function from Socket.IO hook
 * @param {boolean} options.enabled - Whether streaming is enabled
 * @param {string} options.type - Stream type: 'acars' | 'safety' | 'sightings' | 'all'
 * @param {Array} options.initialData - Initial data array
 * @param {number} options.maxItems - Maximum items to keep (default: 500)
 * @param {Function} options.onNewItem - Callback when new item arrives
 */
export function useHistoryStream({
  subscribeMessages,
  enabled = true,
  type = 'all',
  initialData = [],
  maxItems = MAX_STREAMING_ITEMS,
  onNewItem,
}) {
  const [items, setItems] = useState(initialData);
  const [isLive, setIsLive] = useState(enabled);
  const [newItemCount, setNewItemCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Event handlers for different stream types
  const eventHandlers = useRef({});
  const isLiveRef = useRef(isLive);

  // Keep isLiveRef in sync
  useEffect(() => {
    isLiveRef.current = isLive;
  }, [isLive]);

  // Add new item to stream
  const addItem = useCallback((item, streamType) => {
    if (!isLiveRef.current) return;

    const newItem = {
      ...item,
      _streamType: streamType,
      _receivedAt: Date.now(),
    };

    setItems(prev => {
      const updated = [newItem, ...prev];
      // Trim to max items
      if (updated.length > maxItems) {
        return updated.slice(0, maxItems);
      }
      return updated;
    });

    setNewItemCount(prev => prev + 1);
    setLastUpdate(Date.now());

    if (onNewItem) {
      onNewItem(newItem, streamType);
    }
  }, [maxItems, onNewItem]);

  // Set up native WebSocket message handler
  useEffect(() => {
    if (!subscribeMessages || !enabled) return;

    const handleMessage = (data) => {
      const { type: msgType } = data;

      // ACARS message - Django Channels uses 'acars.message' or 'message' type
      // Support both old format (acars:message) and new Django format (acars.message)
      if ((type === 'acars' || type === 'all') &&
          (msgType === 'acars:message' || msgType === 'acars.message' || msgType === 'message')) {
        const message = data.data || data;
        addItem(message, 'acars');
      }

      // Safety event - Django Channels uses 'safety.event' or 'event' type
      if ((type === 'safety' || type === 'all') &&
          (msgType === 'safety:event' || msgType === 'safety.event' || msgType === 'event')) {
        const event = data.data || data;
        addItem(event, 'safety');
      }

      // Sighting - Django Channels uses 'sighting.new' or 'position' type
      if ((type === 'sightings' || type === 'all') &&
          (msgType === 'sighting:new' || msgType === 'sighting.new' || msgType === 'position')) {
        const sighting = data.data || data;
        addItem(sighting, 'sighting');
      }
    };

    // Subscribe to messages and get unsubscribe function
    const unsubscribe = subscribeMessages(handleMessage);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [subscribeMessages, enabled, type, addItem]);

  // Toggle live mode
  const toggleLive = useCallback(() => {
    setIsLive(prev => !prev);
    if (!isLive) {
      // Resuming live mode - clear new item count
      setNewItemCount(0);
    }
  }, [isLive]);

  // Enable live mode
  const enableLive = useCallback(() => {
    setIsLive(true);
    setNewItemCount(0);
  }, []);

  // Disable live mode
  const disableLive = useCallback(() => {
    setIsLive(false);
  }, []);

  // Clear items
  const clearItems = useCallback(() => {
    setItems([]);
    setNewItemCount(0);
  }, []);

  // Reset with new initial data
  const resetWithData = useCallback((data) => {
    setItems(data);
    setNewItemCount(0);
  }, []);

  // Mark items as seen (reset new count)
  const markAsSeen = useCallback(() => {
    setNewItemCount(0);
  }, []);

  // Get items by type
  const getItemsByType = useCallback((streamType) => {
    return items.filter(item => item._streamType === streamType);
  }, [items]);

  // Get recent items (last N seconds)
  const getRecentItems = useCallback((seconds) => {
    const cutoff = Date.now() - seconds * 1000;
    return items.filter(item => item._receivedAt >= cutoff);
  }, [items]);

  return {
    items,
    isLive,
    newItemCount,
    lastUpdate,
    toggleLive,
    enableLive,
    disableLive,
    clearItems,
    resetWithData,
    markAsSeen,
    getItemsByType,
    getRecentItems,
  };
}

/**
 * useLiveIndicator - Hook for showing "new items" indicator
 *
 * @param {number} newItemCount - Number of new items
 * @param {number} threshold - Threshold before showing indicator
 */
export function useLiveIndicator(newItemCount, threshold = 1) {
  const [showIndicator, setShowIndicator] = useState(false);

  useEffect(() => {
    setShowIndicator(newItemCount >= threshold);
  }, [newItemCount, threshold]);

  const dismiss = useCallback(() => {
    setShowIndicator(false);
  }, []);

  return { showIndicator, dismiss };
}

export default useHistoryStream;
