/**
 * useMapScopeLayout - Integrates multi-scope layout with MapView
 *
 * This hook provides the integration between useScopeLayout and MapView's
 * existing state management. It coordinates scope-specific settings like
 * radar range and pan offset for multi-scope configurations.
 *
 * Phase 14.1: Multi-Scope View for Pro Mode
 */

import { useMemo, useCallback, useEffect } from 'react';
import { useScopeLayout } from '../../../hooks/useScopeLayout';

/**
 * Hook to integrate multi-scope layout with MapView state
 *
 * @param {Object} options Configuration options
 * @param {number} options.currentRange - Current radar range from MapView
 * @param {Function} options.setRange - Function to set radar range
 * @param {Object} options.currentPanOffset - Current pan offset { x, y }
 * @param {Function} options.setPanOffset - Function to set pan offset
 * @param {string} options.mapMode - Current map mode ('pro', 'crt', 'map', etc.)
 * @returns {Object} Scope layout state and handlers
 */
export function useMapScopeLayout({
  currentRange = 50,
  setRange,
  currentPanOffset = { x: 0, y: 0 },
  setPanOffset,
  mapMode = 'pro',
}) {
  // Initialize scope layout hook
  const scopeLayout = useScopeLayout({
    initialLayout: 'single',
    persistToStorage: true,
  });

  const {
    layout,
    scopes,
    activeScope,
    syncSelection,
    isMultiScope,
    scopeCount,
    setLayoutMode,
    cycleLayout,
    setScopeRange,
    setScopePanOffset,
    setSyncSelection,
    setActiveScope,
    getScope,
    getActiveScope,
    resetScope,
    resetAllScopes,
  } = scopeLayout;

  // Only enable multi-scope in Pro mode
  const isEnabled = mapMode === 'pro';

  // Get active scope configuration
  const activeScopeConfig = useMemo(() => {
    return getActiveScope();
  }, [activeScope, scopes, getActiveScope]);

  // Sync active scope's range with MapView's radar range
  useEffect(() => {
    if (!isEnabled || !isMultiScope) return;

    // When active scope's range differs from current range, update MapView
    if (activeScopeConfig.range !== currentRange && setRange) {
      setRange(activeScopeConfig.range);
    }
  }, [isEnabled, isMultiScope, activeScopeConfig.range, currentRange, setRange]);

  // Sync active scope's pan offset with MapView's pan offset
  useEffect(() => {
    if (!isEnabled || !isMultiScope) return;

    // When active scope's pan offset differs, update MapView
    const scopePan = activeScopeConfig.panOffset || { x: 0, y: 0 };
    if (
      (scopePan.x !== currentPanOffset.x || scopePan.y !== currentPanOffset.y) &&
      setPanOffset
    ) {
      setPanOffset(scopePan);
    }
  }, [
    isEnabled,
    isMultiScope,
    activeScopeConfig.panOffset,
    currentPanOffset,
    setPanOffset,
  ]);

  // Handle range changes - update both MapView and scope config
  const handleRangeChange = useCallback(
    (newRange) => {
      if (setRange) {
        setRange(newRange);
      }
      if (isEnabled && isMultiScope) {
        setScopeRange(activeScope, newRange);
      }
    },
    [setRange, isEnabled, isMultiScope, activeScope, setScopeRange]
  );

  // Handle pan offset changes - update both MapView and scope config
  const handlePanOffsetChange = useCallback(
    (newOffset) => {
      if (setPanOffset) {
        setPanOffset(newOffset);
      }
      if (isEnabled && isMultiScope) {
        setScopePanOffset(activeScope, newOffset);
      }
    },
    [setPanOffset, isEnabled, isMultiScope, activeScope, setScopePanOffset]
  );

  // Handle scope activation - switch to scope's range/pan
  const handleScopeActivate = useCallback(
    (scopeId) => {
      setActiveScope(scopeId);
      const scopeConfig = getScope(scopeId);
      if (scopeConfig) {
        if (setRange && scopeConfig.range) {
          setRange(scopeConfig.range);
        }
        if (setPanOffset && scopeConfig.panOffset) {
          setPanOffset(scopeConfig.panOffset);
        }
      }
    },
    [setActiveScope, getScope, setRange, setPanOffset]
  );

  // Handle layout change - when switching to multi-scope, apply active scope's settings
  const handleLayoutChange = useCallback(
    (newLayout) => {
      setLayoutMode(newLayout);

      // When entering multi-scope mode, update MapView with active scope's settings
      if (newLayout !== 'single') {
        const newScopes = scopeLayout.DEFAULT_CONFIGS[newLayout];
        if (newScopes && newScopes.length > 0) {
          const firstScope = newScopes[0];
          if (setRange && firstScope.range) {
            setRange(firstScope.range);
          }
          if (setPanOffset) {
            setPanOffset(firstScope.panOffset || { x: 0, y: 0 });
          }
        }
      }
    },
    [setLayoutMode, setRange, setPanOffset, scopeLayout.DEFAULT_CONFIGS]
  );

  // Handle sync toggle
  const handleSyncToggle = useCallback(() => {
    setSyncSelection(!syncSelection);
  }, [syncSelection, setSyncSelection]);

  // Handle scope reset - reset to default and update MapView
  const handleScopeReset = useCallback(
    (scopeId) => {
      resetScope(scopeId);
      // If resetting active scope, also reset MapView's pan offset
      if (scopeId === activeScope && setPanOffset) {
        setPanOffset({ x: 0, y: 0 });
      }
    },
    [resetScope, activeScope, setPanOffset]
  );

  return {
    // State
    isEnabled,
    layout,
    scopes,
    activeScope,
    activeScopeConfig,
    syncSelection,
    isMultiScope,
    scopeCount,

    // Handlers for MapView integration
    handleRangeChange,
    handlePanOffsetChange,
    handleScopeActivate,
    handleLayoutChange,
    handleSyncToggle,
    handleScopeReset,

    // Direct scope layout methods
    cycleLayout,
    resetAllScopes,
    getScope,

    // Layout mode constants
    LAYOUT_MODES: scopeLayout.LAYOUT_MODES,
  };
}

export default useMapScopeLayout;
