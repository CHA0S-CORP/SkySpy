import { useState, useCallback, useEffect } from 'react';

/**
 * Default scope configurations for different layout modes
 */
const DEFAULT_SCOPE_CONFIGS = {
  single: [
    { id: 1, center: null, range: 50, panOffset: { x: 0, y: 0 } }
  ],
  'split-2': [
    { id: 1, center: null, range: 50, panOffset: { x: 0, y: 0 } },
    { id: 2, center: null, range: 150, panOffset: { x: 0, y: 0 } }
  ],
  'split-4': [
    { id: 1, center: null, range: 25, panOffset: { x: 0, y: 0 } },
    { id: 2, center: null, range: 50, panOffset: { x: 0, y: 0 } },
    { id: 3, center: null, range: 100, panOffset: { x: 0, y: 0 } },
    { id: 4, center: null, range: 250, panOffset: { x: 0, y: 0 } }
  ]
};

/**
 * Hook for managing multi-scope radar layout
 *
 * Features:
 * - Split screen: 2 or 4 independent scopes
 * - Each scope has own center point and range
 * - Sync option: same aircraft selection across scopes
 * - Keyboard shortcuts: Ctrl+1, Ctrl+2, Ctrl+4
 *
 * @param {Object} options - Configuration options
 * @param {string} options.initialLayout - Initial layout mode ('single' | 'split-2' | 'split-4')
 * @param {boolean} options.persistToStorage - Whether to persist layout to localStorage
 * @returns {Object} Scope layout state and controls
 */
export function useScopeLayout(options = {}) {
  const {
    initialLayout = 'single',
    persistToStorage = true
  } = options;

  // Load initial state from localStorage if persisting
  const [layout, setLayout] = useState(() => {
    if (persistToStorage) {
      try {
        const saved = localStorage.getItem('adsb-scope-layout');
        if (saved && ['single', 'split-2', 'split-4'].includes(saved)) {
          return saved;
        }
      } catch {
        // Ignore localStorage errors
      }
    }
    return initialLayout;
  });

  const [scopes, setScopes] = useState(() => {
    if (persistToStorage) {
      try {
        const saved = localStorage.getItem('adsb-scope-configs');
        if (saved) {
          const parsed = JSON.parse(saved);
          // Validate structure
          if (Array.isArray(parsed) && parsed.every(s =>
            typeof s.id === 'number' &&
            typeof s.range === 'number' &&
            s.panOffset && typeof s.panOffset.x === 'number'
          )) {
            return parsed;
          }
        }
      } catch {
        // Ignore localStorage errors
      }
    }
    return DEFAULT_SCOPE_CONFIGS[initialLayout] || DEFAULT_SCOPE_CONFIGS.single;
  });

  const [syncSelection, setSyncSelection] = useState(() => {
    if (persistToStorage) {
      try {
        const saved = localStorage.getItem('adsb-scope-sync-selection');
        return saved === null ? true : saved === 'true';
      } catch {
        return true;
      }
    }
    return true;
  });

  const [activeScope, setActiveScope] = useState(1);

  // Persist layout changes to localStorage
  useEffect(() => {
    if (persistToStorage) {
      try {
        localStorage.setItem('adsb-scope-layout', layout);
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [layout, persistToStorage]);

  // Persist scope configs to localStorage
  useEffect(() => {
    if (persistToStorage) {
      try {
        localStorage.setItem('adsb-scope-configs', JSON.stringify(scopes));
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [scopes, persistToStorage]);

  // Persist sync selection preference
  useEffect(() => {
    if (persistToStorage) {
      try {
        localStorage.setItem('adsb-scope-sync-selection', String(syncSelection));
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [syncSelection, persistToStorage]);

  /**
   * Update a specific scope's configuration
   */
  const updateScope = useCallback((id, updates) => {
    setScopes(prev => prev.map(s =>
      s.id === id ? { ...s, ...updates } : s
    ));
  }, []);

  /**
   * Update the range for a specific scope
   */
  const setScopeRange = useCallback((id, range) => {
    updateScope(id, { range: Math.max(5, Math.min(500, range)) });
  }, [updateScope]);

  /**
   * Update the pan offset for a specific scope
   */
  const setScopePanOffset = useCallback((id, panOffset) => {
    updateScope(id, { panOffset });
  }, [updateScope]);

  /**
   * Reset a scope to default (center at feeder, default range)
   */
  const resetScope = useCallback((id) => {
    const defaultConfig = DEFAULT_SCOPE_CONFIGS[layout]?.find(s => s.id === id);
    if (defaultConfig) {
      updateScope(id, {
        center: null,
        panOffset: { x: 0, y: 0 },
        range: defaultConfig.range
      });
    }
  }, [layout, updateScope]);

  /**
   * Reset all scopes to defaults
   */
  const resetAllScopes = useCallback(() => {
    setScopes(DEFAULT_SCOPE_CONFIGS[layout] || DEFAULT_SCOPE_CONFIGS.single);
  }, [layout]);

  /**
   * Set the layout mode (single, split-2, split-4)
   */
  const setLayoutMode = useCallback((mode) => {
    if (!['single', 'split-2', 'split-4'].includes(mode)) {
      console.warn(`Invalid layout mode: ${mode}`);
      return;
    }

    setLayout(mode);

    // Get default configs for the new layout
    const newScopes = DEFAULT_SCOPE_CONFIGS[mode];

    // Try to preserve existing scope settings where possible
    setScopes(prev => {
      return newScopes.map(newScope => {
        // Try to find existing scope with same id
        const existing = prev.find(s => s.id === newScope.id);
        if (existing) {
          // Preserve pan offset and custom center, but may need to adjust range
          return {
            ...newScope,
            panOffset: existing.panOffset,
            center: existing.center,
            // Use existing range if reasonable, otherwise use default
            range: existing.range || newScope.range
          };
        }
        return newScope;
      });
    });

    // Ensure active scope is valid for new layout
    const maxScopeId = newScopes.length;
    setActiveScope(prev => prev > maxScopeId ? 1 : prev);
  }, []);

  /**
   * Cycle through layout modes
   */
  const cycleLayout = useCallback(() => {
    setLayoutMode(layout === 'single' ? 'split-2' : layout === 'split-2' ? 'split-4' : 'single');
  }, [layout, setLayoutMode]);

  /**
   * Get the configuration for a specific scope
   */
  const getScope = useCallback((id) => {
    return scopes.find(s => s.id === id) || scopes[0];
  }, [scopes]);

  /**
   * Get the active scope configuration
   */
  const getActiveScope = useCallback(() => {
    return getScope(activeScope);
  }, [activeScope, getScope]);

  /**
   * Check if multi-scope mode is active
   */
  const isMultiScope = layout !== 'single';

  /**
   * Get the number of scopes in current layout
   */
  const scopeCount = scopes.length;

  // Keyboard shortcut handler for layout switching
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle Ctrl+number combinations
      if (!e.ctrlKey && !e.metaKey) return;

      // Prevent if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case '1':
          e.preventDefault();
          setLayoutMode('single');
          break;
        case '2':
          e.preventDefault();
          setLayoutMode('split-2');
          break;
        case '4':
          e.preventDefault();
          setLayoutMode('split-4');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setLayoutMode]);

  return {
    // State
    layout,
    scopes,
    syncSelection,
    activeScope,
    isMultiScope,
    scopeCount,

    // Setters
    setLayoutMode,
    cycleLayout,
    updateScope,
    setScopeRange,
    setScopePanOffset,
    setSyncSelection,
    setActiveScope,

    // Utilities
    getScope,
    getActiveScope,
    resetScope,
    resetAllScopes,

    // Constants
    LAYOUT_MODES: ['single', 'split-2', 'split-4'],
    DEFAULT_CONFIGS: DEFAULT_SCOPE_CONFIGS
  };
}

export default useScopeLayout;
