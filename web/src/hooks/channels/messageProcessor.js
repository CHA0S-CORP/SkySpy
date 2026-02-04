/**
 * WebSocket message processing utilities
 *
 * Includes batching mechanism to reduce React re-renders by accumulating
 * aircraft updates and flushing them every 50ms (max 20 updates/sec).
 * Safety and alert events remain immediate (no batching).
 */

import { normalizeAircraft } from './aircraftNormalizer';
import { handleAlertTriggered } from './alertHandler';

// ========== AIRCRAFT UPDATE BATCHING ==========
// Batching mechanism to reduce re-renders from high-frequency aircraft updates

// Module-level batch state
let pendingAircraftUpdates = {};
let pendingAircraftRemovals = new Set();
let batchTimeoutId = null;
let batchSetAircraftRef = null;

// Batch flush interval in ms (50ms = 20 flushes/sec max)
const BATCH_FLUSH_INTERVAL = 50;

/**
 * Flush pending aircraft updates to state
 */
function flushAircraftBatch() {
  if (!batchSetAircraftRef) {
    batchTimeoutId = null;
    return;
  }

  const hasUpdates = Object.keys(pendingAircraftUpdates).length > 0;
  const hasRemovals = pendingAircraftRemovals.size > 0;

  if (hasUpdates || hasRemovals) {
    const updates = pendingAircraftUpdates;
    const removals = pendingAircraftRemovals;

    // Reset batch state before calling setAircraft to avoid race conditions
    pendingAircraftUpdates = {};
    pendingAircraftRemovals = new Set();

    if (import.meta.env.DEV) {
      console.log(
        '[batchFlush] Flushing',
        Object.keys(updates).length,
        'updates and',
        removals.size,
        'removals'
      );
    }

    batchSetAircraftRef((prev) => {
      const next = { ...prev, ...updates };
      // Apply removals
      removals.forEach((hex) => {
        delete next[hex];
      });
      return next;
    });
  }

  batchTimeoutId = null;
}

/**
 * Queue aircraft updates to be batched
 * @param {Object} updates - Object of hex -> aircraft data to merge
 * @param {Function} setAircraft - React setState function
 */
function queueAircraftUpdate(updates, setAircraft) {
  // Store setAircraft reference for flush
  batchSetAircraftRef = setAircraft;

  // Merge updates into pending batch
  Object.entries(updates).forEach(([hex, data]) => {
    if (pendingAircraftUpdates[hex]) {
      // Merge with existing pending update
      pendingAircraftUpdates[hex] = { ...pendingAircraftUpdates[hex], ...data };
    } else {
      pendingAircraftUpdates[hex] = data;
    }
    // If this hex was pending removal, cancel it
    pendingAircraftRemovals.delete(hex);
  });

  // Schedule flush if not already scheduled
  if (!batchTimeoutId) {
    batchTimeoutId = setTimeout(flushAircraftBatch, BATCH_FLUSH_INTERVAL);
  }
}

/**
 * Queue aircraft removal to be batched
 * @param {string} hex - ICAO hex to remove
 * @param {Function} setAircraft - React setState function
 */
function queueAircraftRemoval(hex, setAircraft) {
  // Store setAircraft reference for flush
  batchSetAircraftRef = setAircraft;

  // Add to removal set
  pendingAircraftRemovals.add(hex);
  // Remove from pending updates if present
  delete pendingAircraftUpdates[hex];

  // Schedule flush if not already scheduled
  if (!batchTimeoutId) {
    batchTimeoutId = setTimeout(flushAircraftBatch, BATCH_FLUSH_INTERVAL);
  }
}

/**
 * Force immediate flush of pending batched updates
 * Useful for cleanup or when immediate state sync is needed
 */
export function forceFlushAircraftBatch() {
  if (batchTimeoutId) {
    clearTimeout(batchTimeoutId);
    flushAircraftBatch();
  }
}

// ========== AIRCRAFT PROCESSING FUNCTIONS ==========

/**
 * Process aircraft snapshot message
 */
export function processAircraftSnapshot(data, setAircraft, setStats) {
  if (data?.data?.aircraft && Array.isArray(data.data.aircraft)) {
    if (import.meta.env.DEV) {
      console.log('[processAircraftSnapshot] Processing', data.data.aircraft.length, 'aircraft');
    }
    const newAircraft = {};
    let normalizedCount = 0;
    data.data.aircraft.forEach((ac) => {
      if (ac && typeof ac === 'object') {
        const normalized = normalizeAircraft(ac);
        if (normalized.hex) {
          newAircraft[normalized.hex] = normalized;
          normalizedCount++;
        }
      }
    });
    if (import.meta.env.DEV) {
      console.log(
        '[processAircraftSnapshot] Normalized',
        normalizedCount,
        'aircraft, calling setAircraft'
      );
    }
    setAircraft(newAircraft);
    setStats((prev) => ({ ...prev, count: Object.keys(newAircraft).length }));
  } else if (import.meta.env.DEV) {
    console.warn('[processAircraftSnapshot] Invalid data format:', data);
  }
}

/**
 * Process aircraft update message (batched for performance)
 * Updates are accumulated and flushed every 50ms to reduce re-renders
 *
 * Handles two formats:
 * 1. Full update: { type: "full", aircraft: [...] }
 * 2. Delta update: { type: "delta", added: [...], updated: [...], removed: [...] }
 */
export function processAircraftUpdate(data, setAircraft) {
  const payload = data?.data;
  const updateType = payload?.type;

  // Handle delta updates with added/updated/removed arrays
  if (updateType === 'delta') {
    const added = payload?.added || [];
    const updated = payload?.updated || [];
    const removed = payload?.removed || [];

    if (import.meta.env.DEV) {
      console.log(
        '[processAircraftUpdate] Delta update:',
        added.length,
        'added,',
        updated.length,
        'updated,',
        removed.length,
        'removed'
      );
    }

    // Process added and updated aircraft
    const allUpdates = [...added, ...updated];
    if (allUpdates.length > 0) {
      const updates = {};
      allUpdates.forEach((ac) => {
        if (ac && typeof ac === 'object') {
          const normalized = normalizeAircraft(ac);
          if (normalized.hex) {
            updates[normalized.hex] = normalized;
          }
        }
      });
      if (Object.keys(updates).length > 0) {
        queueAircraftUpdate(updates, setAircraft);
      }
    }

    // Process removed aircraft
    if (removed.length > 0) {
      removed.forEach((hex) => {
        if (hex && typeof hex === 'string') {
          queueAircraftRemoval(hex.toUpperCase(), setAircraft);
        }
      });
    }
    return;
  }

  // Handle full updates and legacy format
  const aircraftData = payload?.aircraft || (payload ? [payload] : []);
  if (import.meta.env.DEV) {
    console.log('[processAircraftUpdate] Full update with', aircraftData?.length ?? 0, 'aircraft');
  }
  if (Array.isArray(aircraftData) && aircraftData.length > 0) {
    const updates = {};
    aircraftData.forEach((ac) => {
      if (ac && typeof ac === 'object') {
        const normalized = normalizeAircraft(ac);
        if (normalized.hex) {
          updates[normalized.hex] = normalized;
        }
      }
    });
    if (Object.keys(updates).length > 0) {
      queueAircraftUpdate(updates, setAircraft);
    }
  }
}

/**
 * Process aircraft new message (batched for performance)
 * New aircraft are accumulated and flushed every 50ms to reduce re-renders
 */
export function processAircraftNew(data, setAircraft) {
  const aircraftData = data?.data?.aircraft || (data?.data ? [data.data] : []);
  if (Array.isArray(aircraftData)) {
    const updates = {};
    aircraftData.forEach((ac) => {
      if (ac && typeof ac === 'object') {
        const normalized = normalizeAircraft(ac);
        if (normalized.hex) {
          updates[normalized.hex] = normalized;
        }
      }
    });
    if (Object.keys(updates).length > 0) {
      queueAircraftUpdate(updates, setAircraft);
    }
  }
}

/**
 * Process aircraft remove message (batched for performance)
 * Removals are accumulated and flushed every 50ms to reduce re-renders
 */
export function processAircraftRemove(data, setAircraft) {
  const hexList =
    data?.data?.icaos ||
    data?.data?.icao_list ||
    data?.data?.hex_list ||
    (data?.data?.hex ? [data.data.hex] : []);
  if (Array.isArray(hexList) && hexList.length > 0) {
    hexList.forEach((hex) => {
      if (hex && typeof hex === 'string') {
        queueAircraftRemoval(hex.toUpperCase(), setAircraft);
      }
    });
  }
}

/**
 * Process safety event snapshot
 */
export function processSafetySnapshot(data, setSafetyEvents) {
  if (data?.data?.events && Array.isArray(data.data.events)) {
    if (import.meta.env.DEV) {
      console.log('Safety snapshot received:', data.data.events.length, 'events');
    }
    setSafetyEvents(data.data.events.slice(0, 100));
  }
}

/**
 * Process safety event
 */
export function processSafetyEvent(data, setSafetyEvents) {
  if (data?.data && typeof data.data === 'object') {
    if (import.meta.env.DEV) {
      console.log('Safety event received:', data.data);
    }
    setSafetyEvents((prev) => [data.data, ...prev].slice(0, 100));
  }
}

/**
 * Process safety event updated
 */
export function processSafetyEventUpdated(data, setSafetyEvents) {
  if (data?.data && typeof data.data === 'object') {
    if (import.meta.env.DEV) {
      console.log('Safety event updated:', data.data);
    }
    setSafetyEvents((prev) => {
      const eventId = data.data.id || data.data.event_id;
      if (!eventId) return prev;
      return prev.map((event) =>
        event.id === eventId || event.event_id === eventId ? { ...event, ...data.data } : event
      );
    });
    window.dispatchEvent(
      new CustomEvent('skyspy:safety:event_updated', {
        detail: data.data,
      })
    );
  }
}

/**
 * Process safety event resolved
 */
export function processSafetyEventResolved(data, setSafetyEvents) {
  if (data?.data && typeof data.data === 'object') {
    if (import.meta.env.DEV) {
      console.log('Safety event resolved:', data.data);
    }
    const eventId = data.data.id || data.data.event_id;
    if (eventId) {
      setSafetyEvents((prev) =>
        prev.map((event) =>
          event.id === eventId || event.event_id === eventId
            ? { ...event, ...data.data, resolved: true }
            : event
        )
      );
      window.dispatchEvent(
        new CustomEvent('skyspy:safety:event_resolved', {
          detail: { ...data.data, resolved: true },
        })
      );
    }
  }
}

/**
 * Process alert triggered
 */
export function processAlertTriggered(data, setAlerts) {
  if (data?.data) {
    if (import.meta.env.DEV) {
      console.log('Alert triggered:', data.data);
    }
    handleAlertTriggered(data.data);
    setAlerts((prev) => [data.data, ...prev].slice(0, 100));
  }
}

/**
 * Process alert snapshot
 */
export function processAlertSnapshot(data, setAlerts) {
  if (data?.data?.alerts && Array.isArray(data.data.alerts)) {
    if (import.meta.env.DEV) {
      console.log('Alert snapshot received:', data.data.alerts.length, 'alerts');
    }
    setAlerts(data.data.alerts.slice(0, 100));
  }
}

/**
 * Process ACARS message
 */
export function processAcarsMessage(data, setAcarsMessages) {
  if (data?.data) {
    const newMessages = Array.isArray(data.data) ? data.data : [data.data];
    const validMessages = newMessages.filter((m) => m && typeof m === 'object');
    if (validMessages.length > 0) {
      setAcarsMessages((prev) => [...validMessages, ...prev].slice(0, 100));
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
    if (import.meta.env.DEV) {
      console.log('Audio transmission received:', data.data);
    }
    const transmission = data.data;
    setAudioTransmissions((prev) => [transmission, ...prev].slice(0, 50));
    window.dispatchEvent(
      new CustomEvent('skyspy:audio:transmission', {
        detail: transmission,
      })
    );
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
