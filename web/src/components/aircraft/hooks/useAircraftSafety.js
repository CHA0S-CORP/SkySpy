import { useState, useEffect, useRef } from 'react';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

/**
 * Hook for managing aircraft safety events fetching and display
 */
export function useAircraftSafety({ hex, baseUrl, activeTab, wsRequest, wsConnected, onLoaded }) {
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [safetyHours, setSafetyHours] = useState(24);
  const [expandedSnapshots, setExpandedSnapshots] = useState({});
  const [expandedSafetyMaps, setExpandedSafetyMaps] = useState({});
  const [safetyTrackData, setSafetyTrackData] = useState({});
  const [safetyReplayState, setSafetyReplayState] = useState({});
  const [loaded, setLoaded] = useState(false);

  // Track the last fetched hours value to avoid redundant fetches
  // Uses a ref that's only updated after successful fetch initiation
  const lastFetchedHoursRef = useRef(safetyHours);

  // Reset when hex changes
  useEffect(() => {
    setLoaded(false);
    setSafetyEvents([]);
    setExpandedSnapshots({});
    setExpandedSafetyMaps({});
    setSafetyTrackData({});
    setSafetyReplayState({});
  }, [hex]);

  // Lazy load safety events when tab becomes active
  useEffect(() => {
    if (activeTab !== 'safety' || loaded) return;

    const abortController = new AbortController();

    const fetchSafetyData = async () => {
      try {
        let safetyData = null;
        if (wsRequest && wsConnected) {
          try {
            safetyData = await wsRequest('safety-events', {
              icao_hex: hex,
              hours: safetyHours,
              limit: 100,
            });
            if (safetyData?.error) safetyData = null;
          } catch (err) {
            console.debug('Safety events WS request failed:', err.message);
          }
        }

        if (abortController.signal.aborted) return;

        if (!safetyData) {
          const safetyRes = await fetch(
            `${baseUrl}/api/v1/safety/events?icao_hex=${hex}&hours=${safetyHours}&limit=100`,
            {
              signal: abortController.signal,
            }
          );
          safetyData = await safeJson(safetyRes);
        }

        if (!abortController.signal.aborted) {
          if (safetyData) setSafetyEvents(safetyData.events || []);
          setLoaded(true);
          if (onLoaded) onLoaded('safety');
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Safety events fetch error:', err.message);
      }
    };
    fetchSafetyData();

    return () => {
      abortController.abort();
    };
  }, [activeTab, loaded, hex, baseUrl, safetyHours, wsRequest, wsConnected, onLoaded]);

  // Refetch safety events when hours change
  useEffect(() => {
    // Skip if hours haven't changed or data not yet loaded
    // Compare against last fetched value to ensure proper dependency tracking
    if (lastFetchedHoursRef.current === safetyHours || !loaded) {
      return;
    }
    // Update ref immediately when we decide to fetch to prevent duplicate fetches
    lastFetchedHoursRef.current = safetyHours;

    const abortController = new AbortController();

    const fetchSafetyEvents = async () => {
      try {
        let safetyData = null;
        if (wsRequest && wsConnected) {
          try {
            safetyData = await wsRequest('safety-events', {
              icao_hex: hex,
              hours: safetyHours,
              limit: 100,
            });
            if (safetyData?.error) safetyData = null;
          } catch (err) {
            console.debug('Safety events WS request failed:', err.message);
          }
        }

        if (abortController.signal.aborted) return;

        if (!safetyData) {
          const safetyRes = await fetch(
            `${baseUrl}/api/v1/safety/events?icao_hex=${hex}&hours=${safetyHours}&limit=100`,
            {
              signal: abortController.signal,
            }
          );
          safetyData = await safeJson(safetyRes);
        }

        if (!abortController.signal.aborted && safetyData) {
          setSafetyEvents(safetyData.events || []);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Safety events fetch error:', err.message);
      }
    };
    fetchSafetyEvents();

    return () => {
      abortController.abort();
    };
  }, [safetyHours, loaded, hex, baseUrl, wsRequest, wsConnected]);

  return {
    safetyEvents,
    safetyHours,
    setSafetyHours,
    expandedSnapshots,
    setExpandedSnapshots,
    expandedSafetyMaps,
    setExpandedSafetyMaps,
    safetyTrackData,
    setSafetyTrackData,
    safetyReplayState,
    setSafetyReplayState,
    safetyLoaded: loaded,
  };
}
