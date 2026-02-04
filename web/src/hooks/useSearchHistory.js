import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'adsb-search-history';
const MAX_HISTORY_SIZE = 10;

/**
 * useSearchHistory - Manages recent search history with localStorage persistence
 *
 * @param {Object} options
 * @param {number} options.maxSize - Maximum number of recent searches to store (default: 10)
 * @returns {Object} Search history management functions
 */
export function useSearchHistory({ maxSize = MAX_HISTORY_SIZE } = {}) {
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Validate structure
        if (Array.isArray(parsed)) {
          return parsed.slice(0, maxSize);
        }
      }
    } catch (e) {
      console.warn('Failed to load search history:', e);
    }
    return [];
  });

  // Persist to localStorage when history changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recentSearches));
    } catch (e) {
      console.warn('Failed to save search history:', e);
    }
  }, [recentSearches]);

  /**
   * Add a search to history
   * @param {string} query - The search query
   * @param {Object} result - Optional result metadata (callsign, hex, etc.)
   */
  const addSearch = useCallback((query, result = null) => {
    if (!query || !query.trim()) return;

    const trimmedQuery = query.trim();

    setRecentSearches(prev => {
      // Remove existing entry with same query (case-insensitive)
      const filtered = prev.filter(
        item => item.query.toLowerCase() !== trimmedQuery.toLowerCase()
      );

      // Create new entry
      const newEntry = {
        query: trimmedQuery,
        timestamp: Date.now(),
        callsign: result?.flight?.trim() || result?.callsign || null,
        hex: result?.hex || null,
        type: result?._matchType || null,
      };

      // Add to front and limit size
      return [newEntry, ...filtered].slice(0, maxSize);
    });
  }, [maxSize]);

  /**
   * Remove a specific search from history
   * @param {string} query - The query to remove
   */
  const removeSearch = useCallback((query) => {
    setRecentSearches(prev =>
      prev.filter(item => item.query.toLowerCase() !== query.toLowerCase())
    );
  }, []);

  /**
   * Clear all search history
   */
  const clearHistory = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear search history:', e);
    }
  }, []);

  /**
   * Get searches matching a prefix
   * @param {string} prefix - Prefix to match
   * @returns {Array} Matching recent searches
   */
  const getMatchingHistory = useCallback((prefix) => {
    if (!prefix || !prefix.trim()) return recentSearches;

    const lower = prefix.toLowerCase().trim();
    return recentSearches.filter(item =>
      item.query.toLowerCase().startsWith(lower)
    );
  }, [recentSearches]);

  return {
    recentSearches,
    addSearch,
    removeSearch,
    clearHistory,
    getMatchingHistory,
  };
}

export default useSearchHistory;
