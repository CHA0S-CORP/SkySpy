import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to fetch and manage safety event data
 * Handles both WebSocket and HTTP fallback for event details and track data
 */
export function useSafetyEventData({ eventId, apiBase, wsRequest, wsConnected }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trackData, setTrackData] = useState({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  // Fetch event data - prefer WebSocket with HTTP fallback
  useEffect(() => {
    const fetchEvent = async () => {
      if (!eventId) {
        setError('No event ID provided');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        let data = null;

        // Prefer WebSocket for event detail
        if (wsRequest && wsConnected) {
          try {
            data = await wsRequest('safety-event-detail', { event_id: eventId, id: eventId });
            if (data?.error || data?.error_type === 'not_found') {
              data = null;
              if (data?.error_type === 'not_found') {
                setError('Safety event not found');
                setLoading(false);
                return;
              }
            }
          } catch (err) {
            console.debug('Safety event WS request failed:', err.message);
          }
        }

        // HTTP fallback - use Django API endpoint
        if (!data) {
          const res = await fetch(`${apiBase}/api/v1/safety/events/${eventId}`);
          if (!res.ok) {
            if (res.status === 404) {
              setError('Safety event not found');
            } else {
              setError('Failed to load safety event');
            }
            setLoading(false);
            return;
          }
          const contentType = res.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            setError('Invalid response from server');
            setLoading(false);
            return;
          }
          data = await res.json();
        }

        // Handle nested data structure from Django REST Framework
        if (data?.data) {
          data = data.data;
        }

        setEvent(data);
        setAcknowledged(data.acknowledged || data.resolved || false);

        // Fetch track data for involved aircraft
        const icaos = [data.icao, data.icao_2].filter(Boolean);
        for (const icao of icaos) {
          try {
            let trackResult = null;

            // Try WebSocket first
            if (wsRequest && wsConnected) {
              try {
                const result = await wsRequest('sightings', { icao_hex: icao, hours: 2, limit: 500 });
                if (result && Array.isArray(result.sightings)) {
                  trackResult = result;
                } else if (result?.data?.sightings && Array.isArray(result.data.sightings)) {
                  trackResult = result.data;
                }
              } catch (wsErr) {
                console.warn('WebSocket sightings request failed, falling back to HTTP:', wsErr.message);
              }
            }

            // Fallback to HTTP if WebSocket failed or unavailable
            if (!trackResult) {
              const trackRes = await fetch(`${apiBase}/api/v1/sightings?icao_hex=${icao}&hours=2&limit=500`);
              if (trackRes.ok) {
                const ct = trackRes.headers.get('content-type');
                if (ct && ct.includes('application/json')) {
                  const httpResult = await trackRes.json();
                  if (httpResult && (Array.isArray(httpResult.sightings) || Array.isArray(httpResult.results))) {
                    trackResult = httpResult;
                  } else if (httpResult?.data?.sightings || httpResult?.data?.results) {
                    trackResult = httpResult.data;
                  }
                }
              }
            }

            const sightings = trackResult?.sightings || trackResult?.results || [];
            if (sightings.length > 0) {
              setTrackData(prev => ({ ...prev, [icao]: sightings }));
            }
          } catch (err) {
            console.error('Failed to fetch track data for', icao, err);
          }
        }
      } catch (err) {
        console.error('Failed to fetch safety event:', err);
        setError('Failed to load safety event');
      }

      setLoading(false);
    };

    fetchEvent();
  }, [eventId, apiBase, wsRequest, wsConnected]);

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

    // Listen for safety event updates from WebSocket (dispatched by useChannelsSocket)
    window.addEventListener('skyspy:safety:event_updated', handleSafetyUpdate);
    window.addEventListener('skyspy:safety:event_resolved', handleSafetyUpdate);

    return () => {
      window.removeEventListener('skyspy:safety:event_updated', handleSafetyUpdate);
      window.removeEventListener('skyspy:safety:event_resolved', handleSafetyUpdate);
    };
  }, [eventId]);

  // Acknowledge event via Django API
  const acknowledgeEvent = useCallback(async () => {
    if (!eventId || acknowledging || acknowledged) return;

    setAcknowledging(true);

    try {
      // Try WebSocket first
      if (wsRequest && wsConnected) {
        try {
          const result = await wsRequest('safety-acknowledge', { event_id: eventId, id: eventId });
          if (result && !result.error) {
            setAcknowledged(true);
            setEvent(prev => prev ? { ...prev, acknowledged: true } : prev);
            setAcknowledging(false);
            return;
          }
        } catch (wsErr) {
          console.debug('WebSocket acknowledge failed, falling back to HTTP:', wsErr.message);
        }
      }

      // HTTP fallback - POST to Django API endpoint
      const res = await fetch(`${apiBase}/api/v1/safety/events/${eventId}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (res.ok) {
        setAcknowledged(true);
        setEvent(prev => prev ? { ...prev, acknowledged: true } : prev);
      } else {
        console.error('Failed to acknowledge event:', res.status);
      }
    } catch (err) {
      console.error('Failed to acknowledge event:', err);
    }

    setAcknowledging(false);
  }, [eventId, apiBase, wsRequest, wsConnected, acknowledging, acknowledged]);

  return {
    event,
    loading,
    error,
    trackData,
    acknowledged,
    acknowledging,
    acknowledgeEvent,
    setEvent
  };
}

export default useSafetyEventData;
