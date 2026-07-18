import React from 'react';
import { Icon } from '../v2/primitives';

/**
 * Live Map 56px toolbar (design SkySpy.dc.html): search, label toggles,
 * Filters + Layers menus, zoom slider, recenter, fullscreen, legend, count.
 */
export function LiveMapToolbar({
  search,
  onSearch,
  onSubmit,
  labelMode,
  setLabelMode,
  labelDensity,
  setLabelDensity,
  filtersOn,
  overlaysCount,
  onToggleFilters,
  onToggleLayers,
  onToggleLegend,
  zoom,
  minZoom = 3,
  maxZoom = 18,
  onZoom,
  onRecenter,
  onFullscreen,
}) {
  return (
    <div className="lm__toolbar">
      <form className="lm__search" onSubmit={onSubmit}>
        <Icon name="search" size={15} strokeWidth={1.8} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search callsign or hex…"
          aria-label="Search aircraft"
        />
        <kbd className="lm__kbd">/</kbd>
      </form>

      <div className="lm__spacer" />

      <div className="lm__cluster">
        <div className="lm__seg" role="group" aria-label="Label visibility">
          <button
            type="button"
            className={labelMode === 'auto' ? 'lm__seg-on' : ''}
            onClick={() => setLabelMode('auto')}
          >
            Auto
          </button>
          <button
            type="button"
            className={labelMode === 'all' ? 'lm__seg-on' : ''}
            onClick={() => setLabelMode('all')}
          >
            All
          </button>
        </div>
        <div className="lm__seg" role="group" aria-label="Label density">
          <button
            type="button"
            className={labelDensity === 'full' ? 'lm__seg-on' : ''}
            onClick={() => setLabelDensity('full')}
          >
            Full
          </button>
          <button
            type="button"
            className={labelDensity === 'minimal' ? 'lm__seg-on' : ''}
            onClick={() => setLabelDensity('minimal')}
          >
            Min
          </button>
        </div>
      </div>

      <div className="lm__divider" />

      <div className="lm__cluster">
        <button
          type="button"
          className={`lm__tbtn ${filtersOn ? 'lm__tbtn--on' : ''}`}
          onClick={onToggleFilters}
          title="Traffic filters"
          data-testid="lm-filters-btn"
        >
          <Icon name="filter" size={16} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          className={`lm__tbtn ${overlaysCount ? 'lm__tbtn--on' : ''}`}
          onClick={onToggleLayers}
          title="Map layers"
          data-testid="lm-layers-btn"
        >
          <Icon name="layers" size={16} strokeWidth={1.7} />
          {overlaysCount > 0 && <span className="lm__tbadge">{overlaysCount}</span>}
        </button>
        <button type="button" className="lm__tbtn" onClick={onToggleLegend} title="Legend">
          <Icon name="info" size={16} strokeWidth={1.7} />
        </button>
      </div>

      <div className="lm__divider" />

      <div className="lm__zoom">
        <Icon name="search" size={13} strokeWidth={1.8} style={{ color: 'var(--dim)' }} />
        <input
          type="range"
          min={minZoom}
          max={maxZoom}
          value={zoom}
          onChange={(e) => onZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="lm__zoom-slider"
        />
        <span className="lm__zoom-val">{zoom}</span>
      </div>

      <div className="lm__cluster">
        <button type="button" className="lm__tbtn" onClick={onRecenter} title="Recenter on feeder">
          <Icon name="crosshair" size={16} strokeWidth={1.7} />
        </button>
        <button type="button" className="lm__tbtn" onClick={onFullscreen} title="Fullscreen">
          <Icon name="fullscreen" size={16} strokeWidth={1.7} />
        </button>
      </div>
    </div>
  );
}
