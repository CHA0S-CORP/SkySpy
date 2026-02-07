import React, { useMemo, useRef, useState } from 'react';
import { Star, X, ChevronDown, ChevronUp, EyeOff, Trash2, Clock, Crosshair, Download, Upload } from 'lucide-react';

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * WatchListPanel - collapsible sidebar panel for watched aircraft
 *
 * Features:
 * - Shows mini data block for each watched aircraft
 * - Click to center view on aircraft
 * - Remove button for each item
 * - Clear all button
 * - Collapsed/expanded state
 */
export function WatchListPanel({
  // Watch list data
  watchList,
  panelVisible,
  // Callbacks
  onRemove,
  onClear,
  onTogglePanel: _onTogglePanel,
  onHidePanel,
  onCenterAircraft,
  onSelectAircraft,
  onExport,
  onImport,
  // Live aircraft data
  aircraft = [],
  // UI state
  isProMode = false,
  expanded = true,
  onToggleExpanded,
  // Dragging support
  position = { x: null, y: null },
  isDragging = false,
  onMouseDown,
}) {
  const fileInputRef = useRef(null);
  const [importStatus, setImportStatus] = useState(null);

  const handleFileImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const result = onImport?.(evt.target.result);
      if (result?.success) {
        setImportStatus(`Imported ${result.added} aircraft`);
      } else {
        setImportStatus(`Import failed: ${result?.error || 'Unknown error'}`);
      }
      setTimeout(() => setImportStatus(null), 3000);
    };
    reader.readAsText(file);
    // Reset input so same file can be re-imported
    e.target.value = '';
  };

  // Merge watch list with live aircraft data
  const watchedAircraft = useMemo(() => {
    return watchList.map((entry) => {
      const liveAircraft = aircraft.find(
        (ac) => ac.hex?.toUpperCase() === entry.hex?.toUpperCase()
      );

      return {
        ...entry,
        callsign: liveAircraft?.flight?.trim() || entry.callsign,
        live: liveAircraft || null,
        isLive: !!liveAircraft,
        addedAgo: Date.now() - entry.addedAt,
      };
    });
  }, [watchList, aircraft]);

  // Count of currently live/visible watched aircraft
  const liveCount = watchedAircraft.filter((w) => w.isLive).length;

  if (!panelVisible) return null;

  return (
    <div
      className={`watch-list-panel ${isProMode ? 'pro-style' : ''} ${isDragging ? 'dragging' : ''} ${expanded ? 'expanded' : 'collapsed'}`}
      style={
        position.x !== null
          ? {
              left: position.x,
              top: position.y,
              right: 'auto',
              bottom: 'auto',
            }
          : {}
      }
    >
      {/* Header */}
      <div
        className="watch-list-header"
        role="toolbar"
        aria-label="Watch list controls"
        onMouseDown={onMouseDown}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          onMouseDown?.({
            clientX: touch.clientX,
            clientY: touch.clientY,
            currentTarget: e.currentTarget.parentElement,
            preventDefault: () => {},
          });
        }}
      >
        <button
          className="watch-list-toggle"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls="watch-list-content"
        >
          <Star size={14} className="watch-icon" />
          <span>Watch List ({watchList.length})</span>
          {liveCount > 0 && (
            <span className="live-badge" title={`${liveCount} currently visible`}>
              {liveCount} live
            </span>
          )}
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <div className="watch-list-header-actions">
          <button
            className="watch-list-action-btn"
            onClick={onExport}
            title="Export watch list"
            aria-label="Export watch list"
            disabled={watchList.length === 0}
          >
            <Download size={14} />
          </button>
          <button
            className="watch-list-action-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Import watch list"
            aria-label="Import watch list"
          >
            <Upload size={14} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileImport}
            style={{ display: 'none' }}
            aria-hidden="true"
          />
        </div>
        <button
          className="watch-list-close"
          onClick={onHidePanel}
          title="Hide watch list panel (W)"
          aria-label="Hide watch list panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Import status feedback */}
      {importStatus && (
        <div className="watch-list-import-status">
          {importStatus}
        </div>
      )}

      {/* Content */}
      {expanded && (
        <div id="watch-list-content" className="watch-list-content">
          {watchedAircraft.length === 0 ? (
            <div className="watch-list-empty">
              <Star size={24} className="empty-icon" />
              <p>No aircraft watched</p>
              <p className="hint">Press N to add selected aircraft</p>
            </div>
          ) : (
            <>
              {watchedAircraft.map((item) => (
                <WatchListItem
                  key={item.hex}
                  item={item}
                  onRemove={() => onRemove(item.hex)}
                  onCenter={() => onCenterAircraft(item)}
                  onSelect={() => onSelectAircraft(item.live || item)}
                  isProMode={isProMode}
                />
              ))}

              {/* Clear all button */}
              {watchList.length > 1 && (
                <button
                  className="watch-list-clear-all"
                  onClick={onClear}
                  title="Clear all watched aircraft"
                >
                  <Trash2 size={12} />
                  Clear All
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Individual watch list item with mini data block
 */
function WatchListItem({ item, onRemove, onCenter, onSelect, isProMode }) {
  const { hex, callsign, type, live, isLive, addedAgo } = item;

  return (
    <div
      className={`watch-list-item ${isLive ? 'live' : 'stale'} ${isProMode ? 'pro-style' : ''}`}
      onClick={isLive ? onSelect : undefined}
      onKeyDown={(e) => e.key === 'Enter' && isLive && onSelect()}
      role={isLive ? 'button' : 'listitem'}
      tabIndex={isLive ? 0 : -1}
      aria-label={`${callsign || hex}${isLive ? ', click to select' : ', not visible'}`}
    >
      {/* Star indicator */}
      <div className={`watch-star ${isLive ? 'active' : ''}`}>
        <Star size={12} fill={isLive ? 'currentColor' : 'none'} />
      </div>

      {/* Main info */}
      <div className="watch-item-info">
        <div className="watch-item-primary">
          <span className="watch-callsign">{callsign || hex}</span>
          {type && <span className="watch-type">{type}</span>}
        </div>

        {/* Live data block */}
        {isLive && live && (
          <div className="watch-item-data">
            <span className="data-alt" title="Altitude">
              {live.alt ? `${(live.alt / 1000).toFixed(1)}k` : '--'}
            </span>
            <span className="data-speed" title="Ground speed">
              {live.gs ? `${Math.round(live.gs)}kt` : '--'}
            </span>
            <span className="data-dist" title="Distance">
              {live.distance_nm?.toFixed(1) || '--'}nm
            </span>
          </div>
        )}

        {/* Stale indicator */}
        {!isLive && (
          <div className="watch-item-stale">
            <EyeOff size={10} />
            <span>Not visible</span>
          </div>
        )}

        {/* Time since added */}
        <div className="watch-item-time">
          <Clock size={10} />
          <span>{formatDuration(addedAgo)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="watch-item-actions">
        {isLive && (
          <button
            className="watch-action-btn center-btn"
            onClick={(e) => {
              e.stopPropagation();
              onCenter();
            }}
            title="Center view on aircraft"
            aria-label="Center view on aircraft"
          >
            <Crosshair size={12} />
          </button>
        )}
        <button
          className="watch-action-btn remove-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove from watch list"
          aria-label="Remove from watch list"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

/**
 * Show Watch List Button (when panel is hidden)
 */
export function WatchListShowButton({ count = 0, liveCount = 0, onClick, isProMode = false }) {
  return (
    <button
      className={`watch-list-show-btn ${isProMode ? 'pro-style' : ''}`}
      onClick={onClick}
      title="Show watch list (W)"
      aria-label={`Show watch list, ${count} aircraft watched`}
    >
      <Star size={14} />
      <span>{count}</span>
      {liveCount > 0 && <span className="live-indicator">{liveCount}</span>}
    </button>
  );
}

export default WatchListPanel;
