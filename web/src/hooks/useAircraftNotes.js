import { useState, useCallback, useEffect } from 'react';

/**
 * Hook for managing per-aircraft notes/scratchpad with localStorage persistence.
 *
 * Notes are stored by aircraft hex (ICAO) code and persist across sessions.
 *
 * @example
 * const { notes, getNote, setNote, deleteNote, hasNote, getAllNotesCount } = useAircraftNotes();
 *
 * // Add/update a note
 * setNote('A12345', 'VIP flight - private charter');
 *
 * // Get a note
 * const note = getNote('A12345'); // 'VIP flight - private charter'
 *
 * // Check if note exists
 * if (hasNote('A12345')) { ... }
 *
 * // Get abbreviated note for data block (first 10 chars + "...")
 * const abbreviated = getAbbreviatedNote('A12345'); // 'VIP flight...'
 */

const STORAGE_KEY = 'skyspy-aircraft-notes';

/**
 * Load notes from localStorage
 * @returns {Object} Object mapping hex codes to notes
 */
const loadNotesFromStorage = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate structure - should be an object with string values
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('[useAircraftNotes] Failed to load notes from localStorage:', error);
  }
  return {};
};

/**
 * Save notes to localStorage
 * @param {Object} notes - Object mapping hex codes to notes
 */
const saveNotesToStorage = (notes) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (error) {
    console.warn('[useAircraftNotes] Failed to save notes to localStorage:', error);
  }
};

export function useAircraftNotes() {
  // Initialize state from localStorage
  const [notes, setNotes] = useState(() => loadNotesFromStorage());

  // Persist to localStorage whenever notes change
  useEffect(() => {
    saveNotesToStorage(notes);
  }, [notes]);

  /**
   * Get the note for a specific aircraft
   * @param {string} hex - Aircraft ICAO hex code
   * @returns {string|null} The note, or null if none exists
   */
  const getNote = useCallback(
    (hex) => {
      if (!hex) return null;
      const normalizedHex = hex.toUpperCase();
      return notes[normalizedHex] || null;
    },
    [notes]
  );

  /**
   * Set/update the note for a specific aircraft
   * @param {string} hex - Aircraft ICAO hex code
   * @param {string} note - The note text (empty string or null will delete the note)
   */
  const setNote = useCallback((hex, note) => {
    if (!hex) return;
    const normalizedHex = hex.toUpperCase();

    setNotes((prev) => {
      // If note is empty or null, remove the entry
      if (!note || note.trim() === '') {
        const { [normalizedHex]: removed, ...rest } = prev;
        return rest;
      }

      // Otherwise, add/update the note
      return {
        ...prev,
        [normalizedHex]: note.trim(),
      };
    });
  }, []);

  /**
   * Delete the note for a specific aircraft
   * @param {string} hex - Aircraft ICAO hex code
   */
  const deleteNote = useCallback((hex) => {
    if (!hex) return;
    const normalizedHex = hex.toUpperCase();

    setNotes((prev) => {
      const { [normalizedHex]: removed, ...rest } = prev;
      return rest;
    });
  }, []);

  /**
   * Check if an aircraft has a note
   * @param {string} hex - Aircraft ICAO hex code
   * @returns {boolean} True if the aircraft has a note
   */
  const hasNote = useCallback(
    (hex) => {
      if (!hex) return false;
      const normalizedHex = hex.toUpperCase();
      return normalizedHex in notes && notes[normalizedHex]?.trim().length > 0;
    },
    [notes]
  );

  /**
   * Get an abbreviated version of the note for display in data blocks
   * Returns first 10 characters + "..." if longer
   * @param {string} hex - Aircraft ICAO hex code
   * @param {number} maxLength - Maximum length before truncation (default: 10)
   * @returns {string|null} Abbreviated note, or null if none exists
   */
  const getAbbreviatedNote = useCallback(
    (hex, maxLength = 10) => {
      const note = getNote(hex);
      if (!note) return null;

      if (note.length <= maxLength) {
        return note;
      }

      return note.substring(0, maxLength) + '...';
    },
    [getNote]
  );

  /**
   * Get all notes (for debugging or export)
   * @returns {Object} All notes object
   */
  const getAllNotes = useCallback(() => {
    return { ...notes };
  }, [notes]);

  /**
   * Get count of aircraft with notes
   * @returns {number} Number of aircraft with notes
   */
  const getAllNotesCount = useCallback(() => {
    return Object.keys(notes).length;
  }, [notes]);

  /**
   * Clear all notes (with confirmation callback)
   * @returns {void}
   */
  const clearAllNotes = useCallback(() => {
    setNotes({});
  }, []);

  /**
   * Import notes (merge with existing)
   * @param {Object} importedNotes - Notes to import
   * @param {boolean} overwrite - If true, overwrite existing notes for same hex
   */
  const importNotes = useCallback((importedNotes, overwrite = true) => {
    if (typeof importedNotes !== 'object' || importedNotes === null) {
      console.warn('[useAircraftNotes] Invalid import data');
      return;
    }

    setNotes((prev) => {
      if (overwrite) {
        return { ...prev, ...importedNotes };
      }

      // Only add notes that don't exist
      const merged = { ...prev };
      for (const [hex, note] of Object.entries(importedNotes)) {
        if (!(hex in merged)) {
          merged[hex] = note;
        }
      }
      return merged;
    });
  }, []);

  /**
   * Export notes as JSON string
   * @returns {string} JSON string of all notes
   */
  const exportNotes = useCallback(() => {
    return JSON.stringify(notes, null, 2);
  }, [notes]);

  return {
    notes,
    getNote,
    setNote,
    deleteNote,
    hasNote,
    getAbbreviatedNote,
    getAllNotes,
    getAllNotesCount,
    clearAllNotes,
    importNotes,
    exportNotes,
  };
}

export default useAircraftNotes;
