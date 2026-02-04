import React from 'react';
import PropTypes from 'prop-types';
import { LayoutGrid, Maximize2, Minus, Plus, RotateCcw, Link2, Link2Off } from 'lucide-react';

/**
 * Grid class mapping for different layout modes
 */
const GRID_CLASSES = {
  single: 'scope-grid-single',
  'split-2': 'scope-grid-split-2',
  'split-4': 'scope-grid-split-4',
};

/**
 * Scope pane controls component
 * Mini controls for each individual scope pane
 */
function ScopeControls({ scope, isActive, onRangeChange, onReset, onActivate, isPro = true }) {
  const rangePresets = [10, 25, 50, 100, 150, 250];

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={`scope-controls ${isPro ? 'pro-style' : ''} ${isActive ? 'active' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
    >
      {/* Active indicator */}
      <div className={`scope-active-indicator ${isActive ? 'active' : ''}`} />

      {/* Range display */}
      <div className="scope-range-display">
        <span className="scope-range-value">{scope.range}</span>
        <span className="scope-range-unit">nm</span>
      </div>

      {/* Range adjust buttons */}
      <div className="scope-range-buttons">
        <button
          className="scope-btn scope-range-minus"
          onClick={(e) => {
            e.stopPropagation();
            const newRange = Math.max(5, scope.range - (scope.range >= 100 ? 25 : 10));
            onRangeChange(scope.id, newRange);
          }}
          title="Decrease range"
        >
          <Minus size={12} />
        </button>
        <button
          className="scope-btn scope-range-plus"
          onClick={(e) => {
            e.stopPropagation();
            const newRange = Math.min(500, scope.range + (scope.range >= 100 ? 25 : 10));
            onRangeChange(scope.id, newRange);
          }}
          title="Increase range"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Quick range presets dropdown */}
      <select
        className="scope-range-select"
        value={scope.range}
        onChange={(e) => {
          e.stopPropagation();
          onRangeChange(scope.id, Number(e.target.value));
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {rangePresets.map((r) => (
          <option key={r} value={r}>
            {r}nm
          </option>
        ))}
        {!rangePresets.includes(scope.range) && (
          <option value={scope.range}>{scope.range}nm</option>
        )}
      </select>

      {/* Reset button */}
      <button
        className="scope-btn scope-reset"
        onClick={(e) => {
          e.stopPropagation();
          onReset(scope.id);
        }}
        title="Reset scope (center view)"
      >
        <RotateCcw size={12} />
      </button>

      {/* Scope ID label */}
      <div className="scope-id-label">S{scope.id}</div>
    </div>
  );
}

ScopeControls.propTypes = {
  scope: PropTypes.shape({
    id: PropTypes.number.isRequired,
    range: PropTypes.number.isRequired,
    panOffset: PropTypes.shape({
      x: PropTypes.number,
      y: PropTypes.number,
    }),
    center: PropTypes.shape({
      lat: PropTypes.number,
      lon: PropTypes.number,
    }),
  }).isRequired,
  isActive: PropTypes.bool,
  onRangeChange: PropTypes.func.isRequired,
  onReset: PropTypes.func.isRequired,
  onActivate: PropTypes.func.isRequired,
  isPro: PropTypes.bool,
};

/**
 * Layout toggle button component
 * Allows switching between single, split-2, and split-4 layouts
 */
function LayoutToggle({ layout, onLayoutChange, syncSelection, onSyncToggle, isPro = true }) {
  return (
    <div className={`scope-layout-toggle ${isPro ? 'pro-style' : ''}`}>
      {/* Layout buttons */}
      <div className="layout-buttons">
        <button
          className={`layout-btn ${layout === 'single' ? 'active' : ''}`}
          onClick={() => onLayoutChange('single')}
          title="Single scope (Ctrl+1)"
        >
          <Maximize2 size={14} />
        </button>
        <button
          className={`layout-btn ${layout === 'split-2' ? 'active' : ''}`}
          onClick={() => onLayoutChange('split-2')}
          title="Split 2 scopes (Ctrl+2)"
        >
          <div className="layout-icon-split-2">
            <div className="layout-cell" />
            <div className="layout-cell" />
          </div>
        </button>
        <button
          className={`layout-btn ${layout === 'split-4' ? 'active' : ''}`}
          onClick={() => onLayoutChange('split-4')}
          title="Split 4 scopes (Ctrl+4)"
        >
          <LayoutGrid size={14} />
        </button>
      </div>

      {/* Sync toggle (only show in multi-scope mode) */}
      {layout !== 'single' && (
        <button
          className={`sync-btn ${syncSelection ? 'active' : ''}`}
          onClick={onSyncToggle}
          title={
            syncSelection ? 'Selection synced across scopes' : 'Selection independent per scope'
          }
        >
          {syncSelection ? <Link2 size={14} /> : <Link2Off size={14} />}
          <span className="sync-label">{syncSelection ? 'Synced' : 'Independent'}</span>
        </button>
      )}
    </div>
  );
}

LayoutToggle.propTypes = {
  layout: PropTypes.oneOf(['single', 'split-2', 'split-4']).isRequired,
  onLayoutChange: PropTypes.func.isRequired,
  syncSelection: PropTypes.bool.isRequired,
  onSyncToggle: PropTypes.func.isRequired,
  isPro: PropTypes.bool,
};

/**
 * MultiScopeContainer component
 *
 * Container for multiple independent radar scope views.
 * Handles layout grid, scope controls, and coordinates between scopes.
 */
function MultiScopeContainer({
  layout,
  scopes,
  activeScope,
  syncSelection,
  onLayoutChange,
  onSyncToggle,
  onScopeRangeChange,
  onScopeReset,
  onScopeActivate,
  children,
  isPro = true,
  className = '',
}) {
  const gridClass = GRID_CLASSES[layout] || GRID_CLASSES.single;

  // If single scope, render without grid wrapper for backward compatibility
  if (layout === 'single') {
    return (
      <div className={`scope-container single-scope ${isPro ? 'pro-mode' : ''} ${className}`}>
        {/* Layout toggle in corner */}
        <LayoutToggle
          layout={layout}
          onLayoutChange={onLayoutChange}
          syncSelection={syncSelection}
          onSyncToggle={onSyncToggle}
          isPro={isPro}
        />

        {/* Single scope content */}
        <div className="scope-pane single">
          {typeof children === 'function'
            ? children({ scope: scopes[0], isActive: true, index: 0 })
            : children}
        </div>
      </div>
    );
  }

  return (
    <div className={`scope-container multi-scope ${isPro ? 'pro-mode' : ''} ${className}`}>
      {/* Layout toggle in corner */}
      <LayoutToggle
        layout={layout}
        onLayoutChange={onLayoutChange}
        syncSelection={syncSelection}
        onSyncToggle={onSyncToggle}
        isPro={isPro}
      />

      {/* Grid of scopes */}
      <div className={`scope-grid ${gridClass}`}>
        {scopes.map((scope, index) => {
          const isActive = scope.id === activeScope;

          return (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
            <div
              key={scope.id}
              className={`scope-pane ${isActive ? 'active' : ''}`}
              onClick={() => onScopeActivate(scope.id)}
            >
              {/* Scope controls */}
              <ScopeControls
                scope={scope}
                isActive={isActive}
                onRangeChange={onScopeRangeChange}
                onReset={onScopeReset}
                onActivate={() => onScopeActivate(scope.id)}
                isPro={isPro}
              />

              {/* Scope content - render function or element */}
              <div className="scope-content">
                {typeof children === 'function' ? children({ scope, isActive, index }) : children}
              </div>

              {/* Active border indicator */}
              {isActive && <div className="scope-active-border" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

MultiScopeContainer.propTypes = {
  layout: PropTypes.oneOf(['single', 'split-2', 'split-4']).isRequired,
  scopes: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      range: PropTypes.number.isRequired,
      panOffset: PropTypes.shape({
        x: PropTypes.number,
        y: PropTypes.number,
      }),
      center: PropTypes.shape({
        lat: PropTypes.number,
        lon: PropTypes.number,
      }),
    })
  ).isRequired,
  activeScope: PropTypes.number.isRequired,
  syncSelection: PropTypes.bool.isRequired,
  onLayoutChange: PropTypes.func.isRequired,
  onSyncToggle: PropTypes.func.isRequired,
  onScopeRangeChange: PropTypes.func.isRequired,
  onScopeReset: PropTypes.func.isRequired,
  onScopeActivate: PropTypes.func.isRequired,
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]).isRequired,
  isPro: PropTypes.bool,
  className: PropTypes.string,
};

export { MultiScopeContainer, ScopeControls, LayoutToggle };
export default MultiScopeContainer;
