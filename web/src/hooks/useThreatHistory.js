/**
 * useThreatHistory - Hook for tracking threat encounters
 *
 * Provides encounter history for Cannonball mode with:
 * - Persistent storage option
 * - Encounter logging
 * - History management
 */
import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'cannonball-threat-history';
const MAX_HISTORY_SIZE = 100;

/**
 * Threat history hook for encounter logging
 *
 * @param {Object} options Configuration options
 * @param {boolean} options.persistent Whether to save to localStorage
 * @param {number} options.maxEntries Maximum history entries to keep
 * @returns {Object} History state and controls
 */
export function useThreatHistory({
  persistent = true,
  maxEntries = MAX_HISTORY_SIZE,
} = {}) {
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({
    totalEncounters: 0,
    lawEnforcementCount: 0,
    helicopterCount: 0,
    closestApproach: null,
    mostRecent: null,
  });

  // Load history from localStorage on mount
  useEffect(() => {
    if (persistent) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          setHistory(parsed);
          updateStats(parsed);
        }
      } catch (err) {
        console.warn('Failed to load threat history:', err);
      }
    }
  }, [persistent]);

  // Save history to localStorage when it changes
  useEffect(() => {
    if (persistent && history.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      } catch (err) {
        console.warn('Failed to save threat history:', err);
      }
    }
  }, [persistent, history]);

  // Update statistics
  const updateStats = useCallback((entries) => {
    if (!entries || entries.length === 0) {
      setStats({
        totalEncounters: 0,
        lawEnforcementCount: 0,
        helicopterCount: 0,
        closestApproach: null,
        mostRecent: null,
      });
      return;
    }

    const lawEnforcementCount = entries.filter(e => e.is_law_enforcement).length;
    const helicopterCount = entries.filter(e => e.is_helicopter).length;

    // Find closest approach
    const closestEntry = entries.reduce((closest, entry) => {
      if (!closest || entry.closest_distance < closest.closest_distance) {
        return entry;
      }
      return closest;
    }, null);

    setStats({
      totalEncounters: entries.length,
      lawEnforcementCount,
      helicopterCount,
      closestApproach: closestEntry ? {
        distance: closestEntry.closest_distance,
        callsign: closestEntry.callsign,
        timestamp: closestEntry.closest_time,
      } : null,
      mostRecent: entries[0] || null,
    });
  }, []);

  // Log a new threat encounter
  const logThreat = useCallback((threat) => {
    if (!threat) return;

    const entry = {
      id: `${threat.hex}-${Date.now()}`,
      hex: threat.hex,
      callsign: threat.callsign,
      category: threat.category,
      description: threat.description,
      is_law_enforcement: threat.is_law_enforcement,
      is_helicopter: threat.is_helicopter,
      threat_level: threat.threat_level,
      aircraft_type: threat.aircraft_type,
      registration: threat.registration,

      // Encounter details
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      closest_distance: threat.distance_nm,
      closest_time: new Date().toISOString(),
      initial_bearing: threat.bearing,
      initial_trend: threat.trend,

      // Position at first sight
      first_position: threat.lat && threat.lon ? {
        lat: threat.lat,
        lon: threat.lon,
        altitude: threat.altitude,
      } : null,
    };

    setHistory(prev => {
      // Check if this threat already exists (update instead of add)
      const existingIndex = prev.findIndex(e => e.hex === threat.hex);

      let updated;
      if (existingIndex >= 0) {
        // Update existing entry
        const existing = prev[existingIndex];
        const updatedEntry = {
          ...existing,
          last_seen: new Date().toISOString(),
          closest_distance: Math.min(existing.closest_distance, threat.distance_nm),
          closest_time: threat.distance_nm < existing.closest_distance
            ? new Date().toISOString()
            : existing.closest_time,
        };
        updated = [
          updatedEntry,
          ...prev.slice(0, existingIndex),
          ...prev.slice(existingIndex + 1),
        ];
      } else {
        // Add new entry at beginning
        updated = [entry, ...prev].slice(0, maxEntries);
      }

      updateStats(updated);
      return updated;
    });

    return entry;
  }, [maxEntries, updateStats]);

  // Update an existing encounter (e.g., when it gets closer)
  const updateThreat = useCallback((hex, updates) => {
    setHistory(prev => {
      const index = prev.findIndex(e => e.hex === hex);
      if (index < 0) return prev;

      const existing = prev[index];
      const updated = {
        ...existing,
        ...updates,
        last_seen: new Date().toISOString(),
      };

      // Update closest distance if applicable
      if (updates.distance_nm !== undefined && updates.distance_nm < existing.closest_distance) {
        updated.closest_distance = updates.distance_nm;
        updated.closest_time = new Date().toISOString();
      }

      const newHistory = [
        updated,
        ...prev.slice(0, index),
        ...prev.slice(index + 1),
      ];

      updateStats(newHistory);
      return newHistory;
    });
  }, [updateStats]);

  // Clear all history
  const clearHistory = useCallback(() => {
    setHistory([]);
    setStats({
      totalEncounters: 0,
      lawEnforcementCount: 0,
      helicopterCount: 0,
      closestApproach: null,
      mostRecent: null,
    });

    if (persistent) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        console.warn('Failed to clear threat history:', err);
      }
    }
  }, [persistent]);

  // Remove a specific entry
  const removeEntry = useCallback((id) => {
    setHistory(prev => {
      const filtered = prev.filter(e => e.id !== id);
      updateStats(filtered);
      return filtered;
    });
  }, [updateStats]);

  // Export history as JSON
  const exportHistory = useCallback(() => {
    const data = {
      exported_at: new Date().toISOString(),
      entries: history,
      stats,
    };
    return JSON.stringify(data, null, 2);
  }, [history, stats]);

  // Import history from JSON
  const importHistory = useCallback((jsonString) => {
    try {
      const data = JSON.parse(jsonString);
      if (data.entries && Array.isArray(data.entries)) {
        setHistory(data.entries.slice(0, maxEntries));
        updateStats(data.entries);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to import history:', err);
      return false;
    }
  }, [maxEntries, updateStats]);

  // Get encounters by threat level
  const getByThreatLevel = useCallback((level) => {
    return history.filter(e => e.threat_level === level);
  }, [history]);

  // Get law enforcement encounters
  const getLawEnforcementEncounters = useCallback(() => {
    return history.filter(e => e.is_law_enforcement);
  }, [history]);

  return {
    // History data
    history,
    stats,

    // Actions
    logThreat,
    updateThreat,
    clearHistory,
    removeEntry,

    // Import/Export
    exportHistory,
    importHistory,

    // Queries
    getByThreatLevel,
    getLawEnforcementEncounters,
  };
}

export default useThreatHistory;
