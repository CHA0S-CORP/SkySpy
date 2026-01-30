import { useState, useEffect, useRef } from 'react';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

/**
 * Hook for managing aircraft track/sightings data and replay controls
 */
export function useAircraftTrack({
  hex,
  baseUrl,
  activeTab,
  wsRequest,
  wsConnected,
  onLoaded,
}) {
  // History/sightings state
  const [sightings, setSightings] = useState([]);
  const [showTrackMap, setShowTrackMap] = useState(false);
  const [replayPosition, setReplayPosition] = useState(100);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Track tab state
  const [trackReplayPosition, setTrackReplayPosition] = useState(100);
  const [trackIsPlaying, setTrackIsPlaying] = useState(false);
  const [trackReplaySpeed, setTrackReplaySpeed] = useState(1);
  const [showTrackPoints, setShowTrackPoints] = useState(false);
  const [trackLiveMode, setTrackLiveMode] = useState(true);
  const [showTelemOverlay, setShowTelemOverlay] = useState(true);

  // Graph zoom state
  const [graphZoom, setGraphZoom] = useState(1);
  const [graphScrollOffset, setGraphScrollOffset] = useState(0);

  // Track all intervals for cleanup
  const intervalsRef = useRef(new Set());

  // Reset when hex changes
  useEffect(() => {
    setLoaded(false);
    setSightings([]);
    setShowTrackMap(false);
    setReplayPosition(100);
    setIsPlaying(false);
    setTrackReplayPosition(100);
    setTrackIsPlaying(false);
    setTrackLiveMode(true);
  }, [hex]);

  // Lazy load sightings when tab becomes active
  useEffect(() => {
    if ((activeTab !== 'track' && activeTab !== 'history') || loaded) return;

    const abortController = new AbortController();

    const fetchSightingsData = async () => {
      try {
        let sightingsData;
        if (wsRequest && wsConnected) {
          try {
            const result = await wsRequest('sightings', { icao_hex: hex, hours: 24, limit: 100 });
            if (result && (result.sightings || result.results)) sightingsData = result;
          } catch (err) {
            console.debug('Sightings WS request failed:', err.message);
          }
        }

        if (abortController.signal.aborted) return;

        if (!sightingsData) {
          const sightingsRes = await fetch(`${baseUrl}/api/v1/sightings?icao_hex=${hex}&hours=24&limit=100`, {
            signal: abortController.signal
          });
          sightingsData = await safeJson(sightingsRes);
        }

        if (!abortController.signal.aborted) {
          if (sightingsData) setSightings(sightingsData.sightings || sightingsData.results || []);
          setLoaded(true);
          if (onLoaded) onLoaded('sightings');
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Sightings fetch error:', err.message);
      }
    };
    fetchSightingsData();

    return () => {
      abortController.abort();
    };
  }, [activeTab, loaded, hex, baseUrl, wsRequest, wsConnected, onLoaded]);

  // Periodically refresh sightings in live mode on Track tab
  useEffect(() => {
    if (activeTab !== 'track' || !trackLiveMode) return;

    const abortController = new AbortController();

    const refreshSightings = async () => {
      if (abortController.signal.aborted) return;
      try {
        let data;
        if (wsRequest && wsConnected) {
          const result = await wsRequest('sightings', { icao_hex: hex, hours: 24, limit: 100 });
          if (result && (result.sightings || result.results)) data = result;
          else throw new Error('Invalid sightings response');
        } else {
          const res = await fetch(`${baseUrl}/api/v1/sightings?icao_hex=${hex}&hours=24&limit=100`, {
            signal: abortController.signal
          });
          data = await safeJson(res);
          if (!data) throw new Error('HTTP request failed');
        }
        if (!abortController.signal.aborted && data) {
          setSightings(data.sightings || data.results || []);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Sightings refresh error:', err.message);
      }
    };

    const interval = setInterval(refreshSightings, 30000);
    intervalsRef.current.add(interval);

    return () => {
      abortController.abort();
      clearInterval(interval);
      intervalsRef.current.delete(interval);
    };
  }, [activeTab, trackLiveMode, hex, baseUrl, wsRequest, wsConnected]);

  // Global cleanup for all intervals on unmount
  useEffect(() => {
    return () => {
      intervalsRef.current.forEach(intervalId => {
        clearInterval(intervalId);
      });
      intervalsRef.current.clear();
    };
  }, []);

  return {
    // History/sightings
    sightings,
    setSightings,
    showTrackMap,
    setShowTrackMap,
    replayPosition,
    setReplayPosition,
    isPlaying,
    setIsPlaying,
    sightingsLoaded: loaded,

    // Track tab
    trackReplayPosition,
    setTrackReplayPosition,
    trackIsPlaying,
    setTrackIsPlaying,
    trackReplaySpeed,
    setTrackReplaySpeed,
    showTrackPoints,
    setShowTrackPoints,
    trackLiveMode,
    setTrackLiveMode,
    showTelemOverlay,
    setShowTelemOverlay,

    // Graphs
    graphZoom,
    setGraphZoom,
    graphScrollOffset,
    setGraphScrollOffset,
  };
}
