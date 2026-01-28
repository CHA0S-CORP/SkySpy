import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'audio-favorites';
const MAX_FAVORITES = 100;

/**
 * Hook for managing audio transmission favorites
 * Stores favorites in localStorage with a limit of 100 items
 */
export function useAudioFavorites() {
  const [favorites, setFavorites] = useState([]);

  // Load favorites from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setFavorites(parsed);
        }
      }
    } catch (error) {
      console.error('Failed to load audio favorites:', error);
    }
  }, []);

  // Save favorites to localStorage whenever they change
  const saveFavorites = useCallback((newFavorites) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newFavorites));
    } catch (error) {
      console.error('Failed to save audio favorites:', error);
    }
  }, []);

  // Check if a transmission is favorited
  const isFavorite = useCallback((transmissionId) => {
    return favorites.some(fav => fav.id === transmissionId);
  }, [favorites]);

  // Add a transmission to favorites
  const addFavorite = useCallback((transmission) => {
    if (!transmission || !transmission.id) return;

    // Don't add duplicates
    if (favorites.some(fav => fav.id === transmission.id)) return;

    // Extract relevant fields to store
    const favoriteItem = {
      id: transmission.id,
      callsign: transmission.identified_airframes?.[0]?.callsign || null,
      timestamp: transmission.created_at || new Date().toISOString(),
      channel: transmission.channel_name || 'Unknown Channel',
      frequency_mhz: transmission.frequency_mhz || null,
      transcript: transmission.transcript || null,
      s3_url: transmission.s3_url || null,
      duration_seconds: transmission.duration_seconds || null,
      identified_airframes: transmission.identified_airframes || [],
      addedAt: new Date().toISOString(),
    };

    // Add to beginning, limit to MAX_FAVORITES
    const newFavorites = [favoriteItem, ...favorites].slice(0, MAX_FAVORITES);
    setFavorites(newFavorites);
    saveFavorites(newFavorites);
  }, [favorites, saveFavorites]);

  // Remove a transmission from favorites
  const removeFavorite = useCallback((transmissionId) => {
    const newFavorites = favorites.filter(fav => fav.id !== transmissionId);
    setFavorites(newFavorites);
    saveFavorites(newFavorites);
  }, [favorites, saveFavorites]);

  // Toggle favorite status
  const toggleFavorite = useCallback((transmission) => {
    if (!transmission || !transmission.id) return;

    if (isFavorite(transmission.id)) {
      removeFavorite(transmission.id);
    } else {
      addFavorite(transmission);
    }
  }, [isFavorite, addFavorite, removeFavorite]);

  // Clear all favorites
  const clearFavorites = useCallback(() => {
    setFavorites([]);
    saveFavorites([]);
  }, [saveFavorites]);

  // Get a favorite by ID (returns the stored favorite object)
  const getFavorite = useCallback((transmissionId) => {
    return favorites.find(fav => fav.id === transmissionId) || null;
  }, [favorites]);

  return {
    favorites,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    clearFavorites,
    getFavorite,
    favoritesCount: favorites.length,
  };
}

export default useAudioFavorites;
