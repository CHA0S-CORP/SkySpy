/**
 * MultiScopeWrapper - Wrapper component for multi-scope radar view
 *
 * This component wraps the Pro Mode radar view to add multi-scope functionality.
 * It provides the layout toggle UI and coordinates scope-specific settings.
 *
 * Phase 14.1: Multi-Scope View for Pro Mode
 *
 * Usage:
 * This component can be used to wrap the radar container when in Pro mode,
 * providing the scope layout toggle and managing scope-specific state.
 */

import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { useScopeLayout } from '../../hooks/useScopeLayout';
import { LayoutToggle, MultiScopeContainer } from './components/MultiScopeContainer';

/**
 * MultiScopeWrapper component
 *
 * Provides multi-scope layout controls for the radar view.
 * Can be used in two ways:
 * 1. As a wrapper around existing radar content (children)
 * 2. As a standalone layout toggle component
 */
function MultiScopeWrapper({
  children,
  isPro = true,
  currentRange = 50,
  onRangeChange,
  currentPanOffset = { x: 0, y: 0 },
  onPanOffsetChange,
  className = '',
  showLayoutToggleOnly = false,
}) {
  // Initialize scope layout
  const {
    layout,
    scopes,
    activeScope,
    syncSelection,
    isMultiScope,
    setLayoutMode,
    setScopeRange,
    setScopePanOffset,
    setSyncSelection,
    setActiveScope,
    resetScope,
    getScope,
  } = useScopeLayout({
    initialLayout: 'single',
    persistToStorage: true,
  });

  // Handle layout change
  const handleLayoutChange = useCallback(
    (newLayout) => {
      setLayoutMode(newLayout);

      // When entering multi-scope mode, update with first scope's settings
      if (newLayout !== 'single' && onRangeChange) {
        const firstScope = scopes[0];
        if (firstScope) {
          onRangeChange(firstScope.range);
        }
      }
    },
    [setLayoutMode, scopes, onRangeChange]
  );

  // Handle sync toggle
  const handleSyncToggle = useCallback(() => {
    setSyncSelection(!syncSelection);
  }, [syncSelection, setSyncSelection]);

  // Handle scope range change
  const handleScopeRangeChange = useCallback(
    (scopeId, newRange) => {
      setScopeRange(scopeId, newRange);
      // If this is the active scope, also update the main radar
      if (scopeId === activeScope && onRangeChange) {
        onRangeChange(newRange);
      }
    },
    [setScopeRange, activeScope, onRangeChange]
  );

  // Handle scope reset
  const handleScopeReset = useCallback(
    (scopeId) => {
      resetScope(scopeId);
      // Reset pan offset if this is active scope
      if (scopeId === activeScope && onPanOffsetChange) {
        onPanOffsetChange({ x: 0, y: 0 });
      }
    },
    [resetScope, activeScope, onPanOffsetChange]
  );

  // Handle scope activation
  const handleScopeActivate = useCallback(
    (scopeId) => {
      setActiveScope(scopeId);
      const scopeConfig = getScope(scopeId);
      if (scopeConfig) {
        if (onRangeChange) {
          onRangeChange(scopeConfig.range);
        }
        if (onPanOffsetChange && scopeConfig.panOffset) {
          onPanOffsetChange(scopeConfig.panOffset);
        }
      }
    },
    [setActiveScope, getScope, onRangeChange, onPanOffsetChange]
  );

  // If only showing the layout toggle, render just that
  if (showLayoutToggleOnly) {
    return (
      <LayoutToggle
        layout={layout}
        onLayoutChange={handleLayoutChange}
        syncSelection={syncSelection}
        onSyncToggle={handleSyncToggle}
        isPro={isPro}
      />
    );
  }

  // If in single scope mode, just render children with layout toggle
  if (!isMultiScope) {
    return (
      <div className={`scope-wrapper single-mode ${className}`}>
        <LayoutToggle
          layout={layout}
          onLayoutChange={handleLayoutChange}
          syncSelection={syncSelection}
          onSyncToggle={handleSyncToggle}
          isPro={isPro}
        />
        {children}
      </div>
    );
  }

  // Multi-scope mode: use MultiScopeContainer
  return (
    <MultiScopeContainer
      layout={layout}
      scopes={scopes}
      activeScope={activeScope}
      syncSelection={syncSelection}
      onLayoutChange={handleLayoutChange}
      onSyncToggle={handleSyncToggle}
      onScopeRangeChange={handleScopeRangeChange}
      onScopeReset={handleScopeReset}
      onScopeActivate={handleScopeActivate}
      isPro={isPro}
      className={className}
    >
      {({ scope, isActive, index }) => {
        // In multi-scope mode, render children for each scope
        // Children can be a function that receives scope config
        if (typeof children === 'function') {
          return children({
            scope,
            isActive,
            index,
            range: scope.range,
            panOffset: scope.panOffset,
          });
        }
        // Or just render children as-is (all scopes show same content)
        return children;
      }}
    </MultiScopeContainer>
  );
}

MultiScopeWrapper.propTypes = {
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
  isPro: PropTypes.bool,
  currentRange: PropTypes.number,
  onRangeChange: PropTypes.func,
  currentPanOffset: PropTypes.shape({
    x: PropTypes.number,
    y: PropTypes.number,
  }),
  onPanOffsetChange: PropTypes.func,
  className: PropTypes.string,
  showLayoutToggleOnly: PropTypes.bool,
};

/**
 * useScopeLayoutIntegration - Hook for integrating scope layout into existing components
 *
 * This hook provides a simpler API for components that just need the layout toggle
 * without the full MultiScopeContainer wrapper.
 */
export function useScopeLayoutIntegration({
  currentRange,
  setRange,
  currentPanOffset,
  setPanOffset,
}) {
  const scopeLayout = useScopeLayout({
    initialLayout: 'single',
    persistToStorage: true,
  });

  // Sync active scope's range with component's range
  const handleRangeSync = useCallback(
    (newRange) => {
      if (setRange) {
        setRange(newRange);
      }
      if (scopeLayout.isMultiScope) {
        scopeLayout.setScopeRange(scopeLayout.activeScope, newRange);
      }
    },
    [setRange, scopeLayout]
  );

  return {
    ...scopeLayout,
    handleRangeSync,
    // Convenience method for rendering LayoutToggle
    renderLayoutToggle: (isPro = true) => (
      <LayoutToggle
        layout={scopeLayout.layout}
        onLayoutChange={scopeLayout.setLayoutMode}
        syncSelection={scopeLayout.syncSelection}
        onSyncToggle={() => scopeLayout.setSyncSelection(!scopeLayout.syncSelection)}
        isPro={isPro}
      />
    ),
  };
}

export { MultiScopeWrapper };
export default MultiScopeWrapper;
