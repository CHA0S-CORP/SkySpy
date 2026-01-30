import { useState, useEffect, useRef } from 'react';
import { callsignsMatch } from '../../../utils';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

/**
 * Hook for managing ACARS message fetching and display
 */
export function useAircraftAcars({
  hex,
  baseUrl,
  callsign,
  activeTab,
  wsRequest,
  wsConnected,
  onLoaded,
}) {
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [acarsHours, setAcarsHours] = useState(24);
  const [acarsCompactMode, setAcarsCompactMode] = useState(false);
  const [acarsQuickFilters, setAcarsQuickFilters] = useState([]);
  const [expandedMessages, setExpandedMessages] = useState({});
  const [allMessagesExpanded, setAllMessagesExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const prevAcarsHoursRef = useRef(acarsHours);

  // Reset when hex changes
  useEffect(() => {
    setLoaded(false);
    setAcarsMessages([]);
  }, [hex]);

  // Lazy load ACARS data when tab becomes active
  useEffect(() => {
    if (activeTab !== 'acars' || loaded) return;

    const abortController = new AbortController();
    const currentHex = hex;
    const currentCallsign = callsign;

    const fetchAcarsData = async () => {
      try {
        let acarsFound = [];
        if (wsRequest && wsConnected) {
          try {
            let result = await wsRequest('acars-messages', { icao_hex: hex, hours: acarsHours, limit: 50 });
            if (result && !result.error) {
              acarsFound = Array.isArray(result) ? result : (result.messages || []);
            }
            if (acarsFound.length === 0 && currentCallsign) {
              result = await wsRequest('acars-messages', { callsign: currentCallsign, hours: acarsHours, limit: 50 });
              if (result && !result.error) {
                acarsFound = Array.isArray(result) ? result : (result.messages || []);
              }
            }
          } catch (err) {
            console.debug('ACARS WS request failed:', err.message);
          }
        }

        if (abortController.signal.aborted) return;

        if (acarsFound.length === 0) {
          const acarsRes = await fetch(`${baseUrl}/api/v1/acars?icao_hex=${hex}&hours=${acarsHours}&limit=50`, {
            signal: abortController.signal
          });
          const acarsData = await safeJson(acarsRes);
          if (acarsData) acarsFound = acarsData.messages || acarsData.results || (Array.isArray(acarsData) ? acarsData : []);
          if (acarsFound.length === 0 && currentCallsign) {
            const callsignRes = await fetch(`${baseUrl}/api/v1/acars?callsign=${encodeURIComponent(currentCallsign)}&hours=${acarsHours}&limit=50`, {
              signal: abortController.signal
            });
            const callsignData = await safeJson(callsignRes);
            if (callsignData) acarsFound = callsignData.messages || callsignData.results || (Array.isArray(callsignData) ? callsignData : []);
          }
          if (acarsFound.length === 0) {
            const recentRes = await fetch(`${baseUrl}/api/v1/acars?limit=100`, {
              signal: abortController.signal
            });
            const recentData = await safeJson(recentRes);
            const allRecent = recentData?.messages || recentData?.results || (Array.isArray(recentData) ? recentData : []);
            acarsFound = allRecent.filter(msg =>
              (msg.icao_hex && msg.icao_hex.toUpperCase() === currentHex.toUpperCase()) ||
              callsignsMatch(msg.callsign, currentCallsign)
            );
          }
        }

        if (!abortController.signal.aborted) {
          setAcarsMessages(acarsFound);
          setLoaded(true);
          if (onLoaded) onLoaded('acars');
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('ACARS fetch error:', err.message);
      }
    };
    fetchAcarsData();

    return () => {
      abortController.abort();
    };
  }, [activeTab, loaded, hex, baseUrl, acarsHours, callsign, wsRequest, wsConnected, onLoaded]);

  // Refetch ACARS when hours change
  useEffect(() => {
    if (prevAcarsHoursRef.current === acarsHours || !loaded) {
      prevAcarsHoursRef.current = acarsHours;
      return;
    }
    prevAcarsHoursRef.current = acarsHours;

    const abortController = new AbortController();
    const currentHex = hex;
    const currentCallsign = callsign;

    const fetchAcarsMessages = async () => {
      try {
        let acarsFound = [];
        if (wsRequest && wsConnected) {
          try {
            let result = await wsRequest('acars-messages', { icao_hex: hex, hours: acarsHours, limit: 100 });
            if (result && !result.error) {
              acarsFound = Array.isArray(result) ? result : (result.messages || []);
            }
            if (acarsFound.length === 0 && currentCallsign) {
              result = await wsRequest('acars-messages', { callsign: currentCallsign, hours: acarsHours, limit: 100 });
              if (result && !result.error) {
                acarsFound = Array.isArray(result) ? result : (result.messages || []);
              }
            }
          } catch (err) {
            console.debug('ACARS WS request failed:', err.message);
          }
        }

        if (abortController.signal.aborted) return;

        if (acarsFound.length === 0) {
          const acarsRes = await fetch(`${baseUrl}/api/v1/acars?icao_hex=${hex}&hours=${acarsHours}&limit=100`, {
            signal: abortController.signal
          });
          const acarsData = await safeJson(acarsRes);
          if (acarsData) acarsFound = acarsData.messages || acarsData.results || (Array.isArray(acarsData) ? acarsData : []);
          if (acarsFound.length === 0 && currentCallsign) {
            const callsignRes = await fetch(`${baseUrl}/api/v1/acars?callsign=${encodeURIComponent(currentCallsign)}&hours=${acarsHours}&limit=100`, {
              signal: abortController.signal
            });
            const callsignData = await safeJson(callsignRes);
            if (callsignData) acarsFound = callsignData.messages || callsignData.results || (Array.isArray(callsignData) ? callsignData : []);
          }
          if (acarsFound.length === 0) {
            const recentRes = await fetch(`${baseUrl}/api/v1/acars?limit=100`, {
              signal: abortController.signal
            });
            const recentData = await safeJson(recentRes);
            const allRecent = recentData?.messages || recentData?.results || (Array.isArray(recentData) ? recentData : []);
            const cutoffTime = Date.now() - (acarsHours * 60 * 60 * 1000);
            acarsFound = allRecent.filter(msg => {
              const msgTime = typeof msg.timestamp === 'number' ? msg.timestamp * 1000 : new Date(msg.timestamp).getTime();
              const matchesAircraft = (msg.icao_hex && msg.icao_hex.toUpperCase() === currentHex.toUpperCase()) || callsignsMatch(msg.callsign, currentCallsign);
              return matchesAircraft && msgTime >= cutoffTime;
            });
          }
        }

        if (!abortController.signal.aborted) {
          setAcarsMessages(acarsFound);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('ACARS messages fetch error:', err.message);
      }
    };
    fetchAcarsMessages();

    return () => {
      abortController.abort();
    };
  }, [acarsHours, loaded, hex, baseUrl, callsign, wsRequest, wsConnected]);

  return {
    acarsMessages,
    acarsHours,
    setAcarsHours,
    acarsCompactMode,
    setAcarsCompactMode,
    acarsQuickFilters,
    setAcarsQuickFilters,
    expandedMessages,
    setExpandedMessages,
    allMessagesExpanded,
    setAllMessagesExpanded,
    acarsLoaded: loaded,
  };
}
