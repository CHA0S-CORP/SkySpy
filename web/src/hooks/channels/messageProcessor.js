/**
 * WebSocket message processing utilities
 */

import { normalizeAircraft } from './aircraftNormalizer';
import { handleAlertTriggered } from './alertHandler';

/**
 * Process aircraft snapshot message
 */
export function processAircraftSnapshot(data, setAircraft, setStats) {
  if (data?.data?.aircraft && Array.isArray(data.data.aircraft)) {
    console.log('[processAircraftSnapshot] Processing', data.data.aircraft.length, 'aircraft');
    const newAircraft = {};
    let normalizedCount = 0;
    data.data.aircraft.forEach(ac => {
      if (ac && typeof ac === 'object') {
        const normalized = normalizeAircraft(ac);
        if (normalized.hex) {
          newAircraft[normalized.hex] = normalized;
          normalizedCount++;
        }
      }
    });
    console.log('[processAircraftSnapshot] Normalized', normalizedCount, 'aircraft, calling setAircraft');
    setAircraft(newAircraft);
    setStats(prev => ({ ...prev, count: Object.keys(newAircraft).length }));
  } else {
    console.warn('[processAircraftSnapshot] Invalid data format:', data);
  }
}

/**
 * Process aircraft update message
 */
export function processAircraftUpdate(data, setAircraft) {
  const aircraftData = data?.data?.aircraft || (data?.data ? [data.data] : []);
  console.log('[processAircraftUpdate] Received update with', aircraftData?.length ?? 0, 'aircraft');
  if (Array.isArray(aircraftData) && aircraftData.length > 0) {
    setAircraft(prev => {
      const updated = { ...prev };
      let updateCount = 0;
      aircraftData.forEach(ac => {
        if (ac && typeof ac === 'object') {
          const normalized = normalizeAircraft(ac);
          if (normalized.hex) {
            updated[normalized.hex] = { ...updated[normalized.hex], ...normalized };
            updateCount++;
          }
        }
      });
      console.log('[processAircraftUpdate] Updated', updateCount, 'aircraft in state');
      return updated;
    });
  }
}

/**
 * Process aircraft new message
 */
export function processAircraftNew(data, setAircraft) {
  const aircraftData = data?.data?.aircraft || (data?.data ? [data.data] : []);
  if (Array.isArray(aircraftData)) {
    setAircraft(prev => {
      const updated = { ...prev };
      aircraftData.forEach(ac => {
        if (ac && typeof ac === 'object') {
          const normalized = normalizeAircraft(ac);
          if (normalized.hex) {
            updated[normalized.hex] = normalized;
          }
        }
      });
      return updated;
    });
  }
}

/**
 * Process aircraft remove message
 */
export function processAircraftRemove(data, setAircraft) {
  const hexList = data?.data?.icaos || data?.data?.icao_list || data?.data?.hex_list ||
                 (data?.data?.hex ? [data.data.hex] : []);
  if (Array.isArray(hexList) && hexList.length > 0) {
    setAircraft(prev => {
      const next = { ...prev };
      hexList.forEach(hex => {
        if (hex && typeof hex === 'string') {
          delete next[hex.toUpperCase()];
        }
      });
      return next;
    });
  }
}

/**
 * Process safety event snapshot
 */
export function processSafetySnapshot(data, setSafetyEvents) {
  if (data?.data?.events && Array.isArray(data.data.events)) {
    console.log('Safety snapshot received:', data.data.events.length, 'events');
    setSafetyEvents(data.data.events.slice(0, 100));
  }
}

/**
 * Process safety event
 */
export function processSafetyEvent(data, setSafetyEvents) {
  if (data?.data && typeof data.data === 'object') {
    console.log('Safety event received:', data.data);
    setSafetyEvents(prev => [data.data, ...prev].slice(0, 100));
  }
}

/**
 * Process safety event updated
 */
export function processSafetyEventUpdated(data, setSafetyEvents) {
  if (data?.data && typeof data.data === 'object') {
    console.log('Safety event updated:', data.data);
    setSafetyEvents(prev => {
      const eventId = data.data.id || data.data.event_id;
      if (!eventId) return prev;
      return prev.map(event =>
        (event.id === eventId || event.event_id === eventId)
          ? { ...event, ...data.data }
          : event
      );
    });
    window.dispatchEvent(new CustomEvent('skyspy:safety:event_updated', {
      detail: data.data
    }));
  }
}

/**
 * Process safety event resolved
 */
export function processSafetyEventResolved(data, setSafetyEvents) {
  if (data?.data && typeof data.data === 'object') {
    console.log('Safety event resolved:', data.data);
    const eventId = data.data.id || data.data.event_id;
    if (eventId) {
      setSafetyEvents(prev =>
        prev.map(event =>
          (event.id === eventId || event.event_id === eventId)
            ? { ...event, ...data.data, resolved: true }
            : event
        )
      );
      window.dispatchEvent(new CustomEvent('skyspy:safety:event_resolved', {
        detail: { ...data.data, resolved: true }
      }));
    }
  }
}

/**
 * Process alert triggered
 */
export function processAlertTriggered(data, setAlerts) {
  if (data?.data) {
    console.log('Alert triggered:', data.data);
    handleAlertTriggered(data.data);
    setAlerts(prev => [data.data, ...prev].slice(0, 100));
  }
}

/**
 * Process alert snapshot
 */
export function processAlertSnapshot(data, setAlerts) {
  if (data?.data?.alerts && Array.isArray(data.data.alerts)) {
    console.log('Alert snapshot received:', data.data.alerts.length, 'alerts');
    setAlerts(data.data.alerts.slice(0, 100));
  }
}

/**
 * Process ACARS message
 */
export function processAcarsMessage(data, setAcarsMessages) {
  if (data?.data) {
    const newMessages = Array.isArray(data.data) ? data.data : [data.data];
    const validMessages = newMessages.filter(m => m && typeof m === 'object');
    if (validMessages.length > 0) {
      setAcarsMessages(prev => [...validMessages, ...prev].slice(0, 100));
    }
  }
}

/**
 * Process ACARS snapshot
 */
export function processAcarsSnapshot(data, setAcarsMessages) {
  if (data?.data?.messages && Array.isArray(data.data.messages)) {
    setAcarsMessages(data.data.messages.slice(0, 100));
  }
}

/**
 * Process audio transmission
 */
export function processAudioTransmission(data, setAudioTransmissions) {
  if (data?.data) {
    console.log('Audio transmission received:', data.data);
    const transmission = data.data;
    setAudioTransmissions(prev => [transmission, ...prev].slice(0, 50));
    window.dispatchEvent(new CustomEvent('skyspy:audio:transmission', {
      detail: transmission
    }));
  }
}

/**
 * Process airspace data
 */
export function processAirspaceData(data, setAirspaceData) {
  if (data?.data) {
    setAirspaceData({
      advisories: Array.isArray(data.data.advisories) ? data.data.advisories : [],
      boundaries: Array.isArray(data.data.boundaries) ? data.data.boundaries : [],
    });
  }
}
