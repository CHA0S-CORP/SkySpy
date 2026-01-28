import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'audio-history';
const MAX_HISTORY = 50;

/**
 * Hook for tracking audio transmission listening history
 * Stores the last 50 played transmissions in localStorage
 */
export function useAudioHistory() {
  const [history, setHistory] = useState([]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setHistory(parsed);
        }
      }
    } catch (error) {
      console.error('Failed to load audio history:', error);
    }
  }, []);

  // Save history to localStorage whenever it changes
  const saveHistory = useCallback((newHistory) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    } catch (error) {
      console.error('Failed to save audio history:', error);
    }
  }, []);

  // Add a transmission to history (called when playback starts)
  const addToHistory = useCallback((transmission) => {
    if (!transmission || !transmission.id) return;

    // Remove existing entry if present (will be moved to top)
    const filtered = history.filter(item => item.id !== transmission.id);

    // Extract relevant fields to store
    const historyItem = {
      id: transmission.id,
      callsign: transmission.identified_airframes?.[0]?.callsign || null,
      timestamp: transmission.created_at || new Date().toISOString(),
      channel: transmission.channel_name || 'Unknown Channel',
      frequency_mhz: transmission.frequency_mhz || null,
      transcript: transmission.transcript || null,
      s3_url: transmission.s3_url || null,
      duration_seconds: transmission.duration_seconds || null,
      identified_airframes: transmission.identified_airframes || [],
      playedAt: new Date().toISOString(),
    };

    // Add to beginning, limit to MAX_HISTORY
    const newHistory = [historyItem, ...filtered].slice(0, MAX_HISTORY);
    setHistory(newHistory);
    saveHistory(newHistory);
  }, [history, saveHistory]);

  // Check if a transmission is in history
  const isInHistory = useCallback((transmissionId) => {
    return history.some(item => item.id === transmissionId);
  }, [history]);

  // Remove a transmission from history
  const removeFromHistory = useCallback((transmissionId) => {
    const newHistory = history.filter(item => item.id !== transmissionId);
    setHistory(newHistory);
    saveHistory(newHistory);
  }, [history, saveHistory]);

  // Clear all history
  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, [saveHistory]);

  // Get a history item by ID
  const getHistoryItem = useCallback((transmissionId) => {
    return history.find(item => item.id === transmissionId) || null;
  }, [history]);

  return {
    history,
    addToHistory,
    isInHistory,
    removeFromHistory,
    clearHistory,
    getHistoryItem,
    historyCount: history.length,
  };
}

export default useAudioHistory;
