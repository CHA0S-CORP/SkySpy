/**
 * Phase 9.3: Aircraft Notes integration hook for MapView
 *
 * This hook provides all the state and handlers needed for the aircraft
 * notes/scratchpad feature in the map view.
 */
import { useState, useCallback } from 'react';
import { useAircraftNotes } from '../../../hooks/useAircraftNotes';

/**
 * Hook that integrates aircraft notes functionality into MapView
 * Provides state management for context menu and note modal
 *
 * @param {Object} options
 * @param {Object} options.toastContext - Toast context for notifications
 * @returns {Object} Notes state and handlers
 */
export function useMapAircraftNotes({ toastContext } = {}) {
  // Context menu state
  const [contextMenuState, setContextMenuState] = useState({
    isOpen: false,
    position: { x: 0, y: 0 },
    aircraft: null,
  });

  // Note modal state
  const [noteModalState, setNoteModalState] = useState({
    isOpen: false,
    aircraft: null,
  });

  // Use the core aircraft notes hook
  const {
    getNote,
    setNote,
    deleteNote,
    hasNote,
    getAbbreviatedNote,
    getAllNotesCount,
  } = useAircraftNotes();

  // Context menu handlers
  const handleAircraftContextMenu = useCallback((e, aircraft) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuState({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      aircraft,
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenuState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Note modal handlers
  const openNoteModal = useCallback(
    (aircraft) => {
      setNoteModalState({
        isOpen: true,
        aircraft,
      });
      closeContextMenu();
    },
    [closeContextMenu]
  );

  const closeNoteModal = useCallback(() => {
    setNoteModalState({ isOpen: false, aircraft: null });
  }, []);

  const handleSaveNote = useCallback(
    (noteText) => {
      if (noteModalState.aircraft?.hex) {
        setNote(noteModalState.aircraft.hex, noteText);
        toastContext?.success?.('Note saved');
      }
    },
    [noteModalState.aircraft?.hex, setNote, toastContext]
  );

  const handleDeleteNote = useCallback(() => {
    if (noteModalState.aircraft?.hex) {
      deleteNote(noteModalState.aircraft.hex);
      toastContext?.info?.('Note deleted');
    }
  }, [noteModalState.aircraft?.hex, deleteNote, toastContext]);

  return {
    // State
    contextMenuState,
    noteModalState,

    // Context menu
    handleAircraftContextMenu,
    closeContextMenu,

    // Note modal
    openNoteModal,
    closeNoteModal,
    handleSaveNote,
    handleDeleteNote,

    // Note data access
    getNote,
    setNote,
    deleteNote,
    hasNote,
    getAbbreviatedNote,
    getAllNotesCount,
  };
}

export default useMapAircraftNotes;
