import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'skyspy_saved_views';

/**
 * useSavedViews - Hook for managing saved filter views with localStorage persistence
 */
export function useSavedViews(namespace = 'history') {
  // Initialize from localStorage synchronously to avoid race conditions
  const [savedViews, setSavedViews] = useState(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY}_${namespace}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (err) {
      console.error('Failed to load saved views:', err);
    }
    return [];
  });

  // Save to localStorage whenever views change
  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_KEY}_${namespace}`, JSON.stringify(savedViews));
    } catch (err) {
      console.error('Failed to save views:', err);
    }
  }, [savedViews, namespace]);

  const saveView = useCallback((view) => {
    setSavedViews((prev) => {
      // Check for duplicate name
      const existingIndex = prev.findIndex((v) => v.name === view.name);
      if (existingIndex >= 0) {
        // Update existing view
        const updated = [...prev];
        updated[existingIndex] = {
          ...view,
          id: prev[existingIndex].id,
          updatedAt: new Date().toISOString(),
        };
        return updated;
      }
      // Add new view
      return [
        ...prev,
        {
          ...view,
          id: view.id || Date.now().toString(),
          createdAt: view.createdAt || new Date().toISOString(),
        },
      ];
    });
  }, []);

  const deleteView = useCallback((viewId) => {
    setSavedViews((prev) => prev.filter((v) => v.id !== viewId));
  }, []);

  const getView = useCallback((viewId) => savedViews.find((v) => v.id === viewId), [savedViews]);

  const renameView = useCallback((viewId, newName) => {
    setSavedViews((prev) =>
      prev.map((v) =>
        v.id === viewId ? { ...v, name: newName, updatedAt: new Date().toISOString() } : v
      )
    );
  }, []);

  const clearAllViews = useCallback(() => {
    setSavedViews([]);
  }, []);

  return {
    savedViews,
    saveView,
    deleteView,
    getView,
    renameView,
    clearAllViews,
  };
}

export default useSavedViews;
