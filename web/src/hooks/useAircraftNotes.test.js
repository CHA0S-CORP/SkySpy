import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAircraftNotes } from './useAircraftNotes';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('useAircraftNotes', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with empty notes when localStorage is empty', () => {
      const { result } = renderHook(() => useAircraftNotes());

      expect(result.current.getAllNotesCount()).toBe(0);
      expect(result.current.getNote('ABC123')).toBeNull();
    });

    it('should load existing notes from localStorage', () => {
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({ ABC123: 'Test note' }));

      const { result } = renderHook(() => useAircraftNotes());

      expect(result.current.getNote('ABC123')).toBe('Test note');
      expect(result.current.getAllNotesCount()).toBe(1);
    });

    it('should handle corrupted localStorage data gracefully', () => {
      localStorageMock.getItem.mockReturnValueOnce('invalid json');

      const { result } = renderHook(() => useAircraftNotes());

      expect(result.current.getAllNotesCount()).toBe(0);
    });
  });

  describe('setNote', () => {
    it('should add a new note', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'VIP flight');
      });

      expect(result.current.getNote('ABC123')).toBe('VIP flight');
      expect(result.current.hasNote('ABC123')).toBe(true);
    });

    it('should update an existing note', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Original note');
      });

      act(() => {
        result.current.setNote('ABC123', 'Updated note');
      });

      expect(result.current.getNote('ABC123')).toBe('Updated note');
    });

    it('should normalize hex codes to uppercase', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('abc123', 'Test note');
      });

      expect(result.current.getNote('ABC123')).toBe('Test note');
      expect(result.current.getNote('abc123')).toBe('Test note');
    });

    it('should trim whitespace from notes', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', '  Trimmed note  ');
      });

      expect(result.current.getNote('ABC123')).toBe('Trimmed note');
    });

    it('should remove note when set to empty string', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Test note');
      });

      act(() => {
        result.current.setNote('ABC123', '');
      });

      expect(result.current.hasNote('ABC123')).toBe(false);
    });

    it('should handle null hex gracefully', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote(null, 'Test note');
      });

      expect(result.current.getAllNotesCount()).toBe(0);
    });
  });

  describe('deleteNote', () => {
    it('should delete an existing note', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Test note');
      });

      act(() => {
        result.current.deleteNote('ABC123');
      });

      expect(result.current.hasNote('ABC123')).toBe(false);
      expect(result.current.getNote('ABC123')).toBeNull();
    });

    it('should handle deleting non-existent note gracefully', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.deleteNote('NONEXISTENT');
      });

      expect(result.current.getAllNotesCount()).toBe(0);
    });
  });

  describe('hasNote', () => {
    it('should return true for aircraft with notes', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Test note');
      });

      expect(result.current.hasNote('ABC123')).toBe(true);
    });

    it('should return false for aircraft without notes', () => {
      const { result } = renderHook(() => useAircraftNotes());

      expect(result.current.hasNote('ABC123')).toBe(false);
    });

    it('should handle null/undefined hex', () => {
      const { result } = renderHook(() => useAircraftNotes());

      expect(result.current.hasNote(null)).toBe(false);
      expect(result.current.hasNote(undefined)).toBe(false);
    });
  });

  describe('getAbbreviatedNote', () => {
    it('should return full note if under max length', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Short');
      });

      expect(result.current.getAbbreviatedNote('ABC123')).toBe('Short');
    });

    it('should truncate and add ellipsis for long notes', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'This is a very long note that should be truncated');
      });

      expect(result.current.getAbbreviatedNote('ABC123')).toBe('This is a ...');
      expect(result.current.getAbbreviatedNote('ABC123', 20)).toBe('This is a very long ...');
    });

    it('should return null for non-existent notes', () => {
      const { result } = renderHook(() => useAircraftNotes());

      expect(result.current.getAbbreviatedNote('NONEXISTENT')).toBeNull();
    });
  });

  describe('getAllNotes', () => {
    it('should return all notes as an object', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Note 1');
        result.current.setNote('DEF456', 'Note 2');
      });

      const allNotes = result.current.getAllNotes();

      expect(allNotes).toEqual({
        ABC123: 'Note 1',
        DEF456: 'Note 2',
      });
    });

    it('should return a copy, not the original object', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Note 1');
      });

      const allNotes = result.current.getAllNotes();
      allNotes.ABC123 = 'Modified';

      expect(result.current.getNote('ABC123')).toBe('Note 1');
    });
  });

  describe('clearAllNotes', () => {
    it('should remove all notes', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Note 1');
        result.current.setNote('DEF456', 'Note 2');
      });

      act(() => {
        result.current.clearAllNotes();
      });

      expect(result.current.getAllNotesCount()).toBe(0);
    });
  });

  describe('importNotes', () => {
    it('should import notes with overwrite', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Original');
      });

      act(() => {
        result.current.importNotes({
          ABC123: 'Imported',
          DEF456: 'New note',
        });
      });

      expect(result.current.getNote('ABC123')).toBe('Imported');
      expect(result.current.getNote('DEF456')).toBe('New note');
    });

    it('should import notes without overwrite', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Original');
      });

      act(() => {
        result.current.importNotes(
          {
            ABC123: 'Should not overwrite',
            DEF456: 'New note',
          },
          false
        );
      });

      expect(result.current.getNote('ABC123')).toBe('Original');
      expect(result.current.getNote('DEF456')).toBe('New note');
    });
  });

  describe('exportNotes', () => {
    it('should export notes as JSON string', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Test note');
      });

      const exported = result.current.exportNotes();
      const parsed = JSON.parse(exported);

      expect(parsed).toEqual({ ABC123: 'Test note' });
    });
  });

  describe('localStorage persistence', () => {
    it('should save to localStorage when notes change', () => {
      const { result } = renderHook(() => useAircraftNotes());

      act(() => {
        result.current.setNote('ABC123', 'Test note');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'skyspy-aircraft-notes',
        expect.any(String)
      );
    });
  });
});
