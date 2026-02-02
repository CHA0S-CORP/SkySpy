import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook to fetch and manage safety event data via Socket.IO (no HTTP fallback)
 * All data fetching requires WebSocket connection
 */
export function useSafetyEventData({ eventId, apiBase, wsRequest, wsConnected }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trackData, setTrackData] = useState({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  // Request counter to handle race conditions when eventId changes rapidly
  const requestCounterRef = useRef(0);

  // Fetch event data via WebSocket only
  useEffect(() => {
    // Increment request counter to track this specific fetch
    const currentRequestId = ++requestCounterRef.current;

    const fetchEvent = async () => {
      if (!eventId) {
        setError('No event ID provided');
        setLoading(false);
        return;
      }

      // Check socket connection
      if (!wsRequest || !wsConnected) {
        setError('Socket not connected');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Fetch event detail via WebSocket
        const data = await wsRequest('safety-event-detail', { event_id: eventId, id: eventId });

        // Check if this request is still current (eventId may have changed)
        if (currentRequestId !== requestCounterRef.current) {
          return; // Stale request, discard results
        }

        if (data?.error || data?.error_type === 'not_found') {
          setError('Safety event not found');
          setLoading(false);
          return;
        }

        // Handle nested data structure from Django REST Framework
        const eventData = data?.data || data;

        setEvent(eventData);
        setAcknowledged(eventData.acknowledged || eventData.resolved || false);

        // Fetch track data for involved aircraft
        const icaos = [eventData.icao, eventData.icao_hex, eventData.icao_2].filter(Boolean);
        for (const icao of icaos) {
          // Check if request is still current before each fetch
          if (currentRequestId !== requestCounterRef.current) {
            return; // Stale request, stop fetching
          }
          try {
            const result = await wsRequest('sightings', { icao_hex: icao, hours: 2, limit: 500 });
            // Check if still current after fetch
            if (currentRequestId !== requestCounterRef.current) {
              return; // Stale request, discard results
            }
            const sightings = result?.sightings || result?.data?.sightings || result?.results || [];
            if (sightings.length > 0) {
              setTrackData(prev => ({ ...prev, [icao]: sightings }));
            }
          } catch (err) {
            console.error('Failed to fetch track data for', icao, err);
          }
        }
      } catch (err) {
        // Check if request is still current before setting error state
        if (currentRequestId !== requestCounterRef.current) {
          return; // Stale request, discard error
        }
        console.error('Failed to fetch safety event:', err);
        setError(err.message || 'Failed to load safety event');
      }

      // Only update loading state if request is still current
      if (currentRequestId === requestCounterRef.current) {
        setLoading(false);
      }
    };

    fetchEvent();
  }, [eventId, wsRequest, wsConnected]);

  // Listen for real-time updates to this specific event via custom events
  useEffect(() => {
    if (!eventId) return;

    const handleSafetyUpdate = (e) => {
      const data = e.detail;
      if (!data) return;

      const updatedEventId = data.id || data.event_id;
      if (updatedEventId === eventId || String(updatedEventId) === String(eventId)) {
        setEvent(prev => prev ? { ...prev, ...data } : prev);
        if (data.acknowledged || data.resolved) {
          setAcknowledged(true);
        }
      }
    };

    // Listen for safety event updates from Socket.IO (dispatched by useSocketIOData)
    window.addEventListener('skyspy:safety:event_updated', handleSafetyUpdate);
    window.addEventListener('skyspy:safety:event_resolved', handleSafetyUpdate);

    return () => {
      window.removeEventListener('skyspy:safety:event_updated', handleSafetyUpdate);
      window.removeEventListener('skyspy:safety:event_resolved', handleSafetyUpdate);
    };
  }, [eventId]);

  // Acknowledge event via WebSocket
  const acknowledgeEvent = useCallback(async () => {
    if (!eventId || acknowledging || acknowledged) return;

    // Check socket connection
    if (!wsRequest || !wsConnected) {
      console.error('Socket not connected');
      return;
    }

    setAcknowledging(true);

    try {
      const result = await wsRequest('safety-acknowledge', { event_id: eventId, id: eventId });
      if (result && !result.error) {
        setAcknowledged(true);
        setEvent(prev => prev ? { ...prev, acknowledged: true } : prev);
      } else {
        console.error('Failed to acknowledge event:', result?.error);
      }
    } catch (err) {
      console.error('Failed to acknowledge event:', err);
    }

    setAcknowledging(false);
  }, [eventId, wsRequest, wsConnected, acknowledging, acknowledged]);

  return {
    event,
    loading,
    error,
    trackData,
    acknowledged,
    acknowledging,
    acknowledgeEvent,
    setEvent,
    connected: wsConnected,
  };
}

export default useSafetyEventData;
