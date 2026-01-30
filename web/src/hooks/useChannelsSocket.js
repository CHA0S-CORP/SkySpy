import { useState, useEffect, useRef, useCallback } from 'react';
import { useNativeWebSocket } from './useNativeWebSocket';
import {
  DEMO_AIRCRAFT,
  generateDemoAircraft,
  normalizeAircraft,
  processAircraftSnapshot,
  processAircraftUpdate,
  processAircraftNew,
  processAircraftRemove,
  processSafetySnapshot,
  processSafetyEvent,
  processSafetyEventUpdated,
  processSafetyEventResolved,
  processAlertTriggered,
  processAlertSnapshot,
  processAcarsMessage,
  processAcarsSnapshot,
  processAudioTransmission,
  processAirspaceData,
} from './channels';

/**
 * Django Channels WebSocket hook for all real-time data.
 */
export function useChannelsSocket(enabled, apiBase, topics = 'all') {
  const [aircraft, setAircraft] = useState({});
  const [stats, setStats] = useState({ count: 0 });
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [audioTransmissions, setAudioTransmissions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [airspaceData, setAirspaceData] = useState({ advisories: [], boundaries: [] });
  const [antennaAnalytics, setAntennaAnalytics] = useState(null);

  const mountedRef = useRef(true);
  const pendingRequests = useRef(new Map());
  const airframeErrorsRef = useRef(new Map());
  const topicsRef = useRef(topics);
  const wsSendRef = useRef(null);

  // Demo mode refs
  const demoTickRef = useRef(0);
  const demoActiveRef = useRef(false);
  const demoIntervalRef = useRef(null);

  useEffect(() => { topicsRef.current = topics; }, [topics]);

  // Debug: Log aircraft state changes
  useEffect(() => {
    const count = Object.keys(aircraft).length;
    if (count > 0) {
      console.log('[useChannelsSocket] Aircraft state updated:', count, 'aircraft in state');
    }
  }, [aircraft]);

  const handleMessage = useCallback((data) => {
    if (!mountedRef.current) return;
    const { type } = data;

    // Debug: Log all incoming messages
    console.log('[useChannelsSocket] Message received:', type, data?.data?.aircraft?.length ?? data?.data?.count ?? '');

    try {
      if (type === 'batch' && Array.isArray(data.messages)) {
        console.log('[useChannelsSocket] Processing batch with', data.messages.length, 'messages');
        data.messages.forEach(msg => { if (msg) handleMessage(msg); });
        return;
      }

      // Aircraft events
      if (type === 'aircraft:snapshot') processAircraftSnapshot(data, setAircraft, setStats);
      else if (type === 'aircraft:update') processAircraftUpdate(data, setAircraft);
      else if (type === 'aircraft:new') processAircraftNew(data, setAircraft);
      else if (type === 'aircraft:remove') processAircraftRemove(data, setAircraft);
      else if (type === 'aircraft:heartbeat') {
        setStats(prev => ({
          ...prev,
          count: data?.data?.count ?? data?.data?.aircraft_count ?? prev.count,
          timestamp: data?.data?.timestamp
        }));
      }

      // Safety events
      else if (type === 'safety:snapshot') processSafetySnapshot(data, setSafetyEvents);
      else if (type === 'safety:event') processSafetyEvent(data, setSafetyEvents);
      else if (type === 'safety:event_updated') processSafetyEventUpdated(data, setSafetyEvents);
      else if (type === 'safety:event_resolved') processSafetyEventResolved(data, setSafetyEvents);

      // Airframe errors
      else if (type === 'airframe:error') {
        if (data?.data?.icao_hex) {
          airframeErrorsRef.current.set(data.data.icao_hex.toUpperCase(), {
            error_type: data.data.error_type,
            error_message: data.data.error_message,
            source: data.data.source,
            details: data.data.details,
            timestamp: data.data.timestamp || new Date().toISOString(),
          });
          if (airframeErrorsRef.current.size > 100) {
            const oldest = airframeErrorsRef.current.keys().next().value;
            airframeErrorsRef.current.delete(oldest);
          }
        }
      }

      // Alerts
      else if (type === 'alert:triggered') processAlertTriggered(data, setAlerts);
      else if (type === 'alert:snapshot') processAlertSnapshot(data, setAlerts);

      // ACARS
      else if (type === 'acars:message') processAcarsMessage(data, setAcarsMessages);
      else if (type === 'acars:snapshot') processAcarsSnapshot(data, setAcarsMessages);

      // Audio
      else if (type === 'audio:transmission') processAudioTransmission(data, setAudioTransmissions);

      // Airspace
      else if (type === 'airspace:snapshot' || type === 'airspace:update') processAirspaceData(data, setAirspaceData);
      else if (type === 'airspace:advisory') {
        if (data?.data?.advisories) setAirspaceData(prev => ({ ...prev, advisories: data.data.advisories }));
      }
      else if (type === 'airspace:boundary') {
        if (data?.data?.boundaries) setAirspaceData(prev => ({ ...prev, boundaries: data.data.boundaries }));
      }

      // Antenna analytics
      else if (type === 'antenna:analytics') {
        if (data?.data) setAntennaAnalytics(data.data);
      }

      // Request/Response
      else if (type === 'response') {
        if (data?.request_id && pendingRequests.current.has(data.request_id)) {
          const { resolve, timeoutId } = pendingRequests.current.get(data.request_id);
          clearTimeout(timeoutId);
          pendingRequests.current.delete(data.request_id);
          resolve(data.data);
        }
      } else if (type === 'error' && data?.request_id) {
        if (pendingRequests.current.has(data.request_id)) {
          const { reject, timeoutId } = pendingRequests.current.get(data.request_id);
          clearTimeout(timeoutId);
          pendingRequests.current.delete(data.request_id);
          reject(new Error(data.message || 'Request failed'));
        }
      }

      else if (type === 'subscribed') console.log('Subscribed to topics:', data.topics);
      else if (type === 'unsubscribed') console.log('Unsubscribed from topics:', data.topics);
    } catch (err) {
      console.error('Error processing message:', type, err);
    }
  }, []);

  const handleConnect = useCallback(() => {
    console.log('[useChannelsSocket] WebSocket connected, subscribing to topics:', topicsRef.current);
    const topicsList = topicsRef.current.split(',').map(t => t.trim());
    if (wsSendRef.current) wsSendRef.current({ action: 'subscribe', topics: topicsList });
  }, []);

  const handleDisconnect = useCallback((code, reason) => {
    console.log('Channels WebSocket disconnected:', code, reason);
    if (mountedRef.current) { setAircraft({}); setStats({ count: 0 }); }
    const pendingEntries = Array.from(pendingRequests.current.entries());
    pendingRequests.current.clear();
    pendingEntries.forEach(([, { reject, timeoutId }]) => {
      clearTimeout(timeoutId);
      if (mountedRef.current) reject(new Error('WebSocket disconnected'));
    });
  }, []);

  const { connected, connecting, error: wsError, send: wsSend, reconnect: wsReconnect } = useNativeWebSocket({
    enabled, apiBase, path: 'all', queryParams: { topics },
    onMessage: handleMessage, onConnect: handleConnect, onDisconnect: handleDisconnect,
  });

  useEffect(() => { wsSendRef.current = wsSend; }, [wsSend]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const pendingEntries = Array.from(pendingRequests.current.entries());
      pendingRequests.current.clear();
      pendingEntries.forEach(([, { timeoutId }]) => clearTimeout(timeoutId));
      if (demoIntervalRef.current) { clearInterval(demoIntervalRef.current); demoIntervalRef.current = null; }
    };
  }, []);

  // Demo mode for development
  useEffect(() => {
    if (import.meta.env.PROD) return;
    if (connected) {
      if (demoActiveRef.current) {
        console.log('Backend connected - stopping demo mode');
        demoActiveRef.current = false;
        if (demoIntervalRef.current) { clearInterval(demoIntervalRef.current); demoIntervalRef.current = null; }
      }
      return;
    }
    const demoTimeout = setTimeout(() => {
      if (connected || demoActiveRef.current || !mountedRef.current) return;
      console.log('Backend unavailable - starting demo mode');
      demoActiveRef.current = true;
      const initialData = generateDemoAircraft(DEMO_AIRCRAFT, 0);
      const initialAircraft = {};
      initialData.forEach(ac => { const n = normalizeAircraft(ac); if (n.hex) initialAircraft[n.hex] = n; });
      setAircraft(initialAircraft);
      setStats({ count: Object.keys(initialAircraft).length, demo: true });
      demoIntervalRef.current = setInterval(() => {
        if (!mountedRef.current || connected) { demoActiveRef.current = false; clearInterval(demoIntervalRef.current); demoIntervalRef.current = null; return; }
        demoTickRef.current += 1;
        const demoData = generateDemoAircraft(DEMO_AIRCRAFT, demoTickRef.current);
        const newAircraft = {};
        demoData.forEach(ac => { const n = normalizeAircraft(ac); if (n.hex) newAircraft[n.hex] = n; });
        setAircraft(newAircraft);
        setStats({ count: Object.keys(newAircraft).length, demo: true });
      }, 2000);
    }, 3000);
    return () => clearTimeout(demoTimeout);
  }, [connected]);

  const request = useCallback((type, params = {}, timeoutMs = 10000) => {
    return new Promise((resolve, reject) => {
      if (!connected) { reject(new Error('WebSocket not connected')); return; }
      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const timeoutId = setTimeout(() => {
        if (pendingRequests.current.has(requestId)) {
          pendingRequests.current.delete(requestId);
          if (mountedRef.current) reject(new Error(`Request timeout: ${type}`));
        }
      }, timeoutMs);
      pendingRequests.current.set(requestId, { resolve, reject, timeoutId });
      wsSend({ action: 'request', type, request_id: requestId, params });
    });
  }, [connected, wsSend]);

  const subscribe = useCallback((newTopics) => {
    if (connected) wsSend({ action: 'subscribe', topics: Array.isArray(newTopics) ? newTopics : [newTopics] });
  }, [connected, wsSend]);

  const unsubscribe = useCallback((removeTopics) => {
    if (connected) wsSend({ action: 'unsubscribe', topics: Array.isArray(removeTopics) ? removeTopics : [removeTopics] });
  }, [connected, wsSend]);

  const getAirframeError = useCallback((icao) => icao ? airframeErrorsRef.current.get(icao.toUpperCase()) || null : null, []);
  const clearAirframeError = useCallback((icao) => { if (icao) airframeErrorsRef.current.delete(icao.toUpperCase()); }, []);
  const getAirframeErrors = useCallback(() => new Map(airframeErrorsRef.current), []);

  return {
    aircraft: Object.values(aircraft), aircraftMap: aircraft, connected, connecting, error: wsError,
    stats, safetyEvents, acarsMessages, audioTransmissions, alerts, airspaceData, antennaAnalytics,
    request, getAirframeError, clearAirframeError, getAirframeErrors, subscribe, unsubscribe,
    reconnect: wsReconnect, send: wsSend,
  };
}

export default useChannelsSocket;
