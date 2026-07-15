import { useState, useEffect, useRef } from 'react';
import { callsignsMatch } from '../../../utils';

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
 * Hook for managing ACARS data on the map view.
 * Handles ACARS status polling, real-time WS messages, initial history fetch,
 * HTTP fallback polling, and callsign-to-hex lookups.
 */
export function useMapAcarsData({
  wsAcarsMessages,
  wsConnected,
  wsRequest,
  showAcarsPanel,
  config,
  aircraft,
}) {
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [acarsStatus, setAcarsStatus] = useState(null);
  const [callsignHexCache, setCallsignHexCache] = useState({});

  // Fetch ACARS status via WebSocket (with HTTP fallback)
  useEffect(() => {
    const fetchAcarsStatus = async () => {
      if (wsRequest && wsConnected) {
        try {
          const data = await wsRequest('acars-status', {});
          if (data && !data.error) {
            setAcarsStatus(data);
            return;
          }
        } catch (err) {
          console.debug('ACARS status WS request failed:', err.message);
          return;
        }
      }

      if (!wsConnected) {
        const baseUrl = config.apiBaseUrl || '';
        try {
          const statusRes = await fetch(`${baseUrl}/api/v1/acars/status`);
          const statusData = await safeJson(statusRes);
          if (statusData) setAcarsStatus(statusData);
        } catch (err) {
          // Silently fail - ACARS may not be available
        }
      }
    };

    fetchAcarsStatus();
    const pollInterval = wsConnected ? 30000 : 10000;
    const interval = setInterval(fetchAcarsStatus, pollInterval);
    return () => clearInterval(interval);
  }, [config.apiBaseUrl, wsRequest, wsConnected]);

  // Use real-time ACARS messages from socket when connected
  useEffect(() => {
    if (wsConnected && wsAcarsMessages && wsAcarsMessages.length > 0) {
      setAcarsMessages(wsAcarsMessages);
    }
  }, [wsConnected, wsAcarsMessages]);

  // Fetch initial ACARS history once when panel opens
  const acarsInitialFetchRef = useRef(false);
  useEffect(() => {
    if (!showAcarsPanel) {
      acarsInitialFetchRef.current = false;
      return;
    }
    if (acarsInitialFetchRef.current) return;

    const fetchInitialAcars = async () => {
      const baseUrl = config.apiBaseUrl || '';
      try {
        const msgRes = await fetch(`${baseUrl}/api/v1/acars?limit=50`);
        const msgData = await safeJson(msgRes);
        if (msgData) {
          setAcarsMessages(
            msgData.messages || msgData.results || (Array.isArray(msgData) ? msgData : [])
          );
          acarsInitialFetchRef.current = true;
        }
      } catch (err) {
        console.warn('ACARS messages fetch error:', err.message);
      }
    };

    fetchInitialAcars();
  }, [showAcarsPanel, config.apiBaseUrl]);

  // HTTP fallback polling only when socket is not connected
  useEffect(() => {
    if (!showAcarsPanel || wsConnected) return;

    const fetchAcarsMessages = async () => {
      const baseUrl = config.apiBaseUrl || '';
      try {
        const msgRes = await fetch(`${baseUrl}/api/v1/acars?limit=50`);
        const data = await safeJson(msgRes);
        if (data) {
          setAcarsMessages(data.messages || data.results || (Array.isArray(data) ? data : []));
        }
      } catch (err) {
        console.warn('ACARS messages fetch error:', err.message);
      }
    };

    const interval = setInterval(fetchAcarsMessages, 10000);
    return () => clearInterval(interval);
  }, [showAcarsPanel, config.apiBaseUrl, wsConnected]);

  // Lookup hex values from history API for ACARS messages with callsign but no icao_hex
  useEffect(() => {
    if (!showAcarsPanel || acarsMessages.length === 0) return;

    const callsignsToLookup = new Set();
    for (const msg of acarsMessages) {
      if (msg.callsign && !msg.icao_hex) {
        const cs = msg.callsign.trim().toUpperCase();
        if (callsignHexCache[cs]) continue;
        const hasMatch = aircraft.some((ac) => callsignsMatch(cs, ac.flight));
        if (!hasMatch) {
          callsignsToLookup.add(cs);
        }
      }
    }

    if (callsignsToLookup.size === 0) return;

    const lookupCallsigns = async () => {
      const baseUrl = config.apiBaseUrl || '';
      const lookups = Array.from(callsignsToLookup).slice(0, 10);

      for (const callsign of lookups) {
        try {
          let data;
          if (wsRequest && wsConnected) {
            const result = await wsRequest('sightings', {
              callsign: callsign,
              hours: 24,
              limit: 1,
            });
            if (result && (result.sightings || result.results)) {
              data = result;
            } else {
              throw new Error('Invalid sightings response');
            }
          } else {
            const res = await fetch(
              `${baseUrl}/api/v1/sightings?callsign=${encodeURIComponent(callsign)}&hours=24&limit=1`
            );
            data = await safeJson(res);
            if (!data) throw new Error('HTTP request failed');
          }
          const sightings = data?.sightings || data?.results || [];
          if (sightings.length > 0 && sightings[0].icao_hex) {
            setCallsignHexCache((prev) => ({
              ...prev,
              [callsign]: sightings[0].icao_hex,
            }));
          } else {
            setCallsignHexCache((prev) => ({ ...prev, [callsign]: null }));
          }
        } catch (err) {
          // Silently fail - link just won't work for this callsign
        }
      }
    };

    lookupCallsigns();
  }, [showAcarsPanel, acarsMessages, aircraft, config.apiBaseUrl, wsRequest, wsConnected]);

  return {
    acarsMessages,
    acarsStatus,
    callsignHexCache,
  };
}
