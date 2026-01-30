import React from 'react';
import { Plane, Shield, AlertTriangle, Zap, ChevronDown, ChevronUp, X, ExternalLink } from 'lucide-react';
import { getTailInfo } from '../../../utils';
import { getSeverityClass, getEventTypeName } from './ConflictBanner';

/**
 * Aircraft List Panel component - collapsible sidebar with aircraft list
 */
export function AircraftListPanel({
  config,
  showAircraftList,
  setShowAircraftList,
  listExpanded,
  setListExpanded,
  listDisplayCount,
  setListDisplayCount,
  sortedAircraft,
  selectedAircraft,
  selectAircraft,
  activeConflicts,
  radarRange,
  inRangeCount,
  openAircraftDetail,
  // Dragging
  aircraftListPosition,
  isListDragging,
  handleListMouseDown,
}) {
  if (!showAircraftList) return null;
  if (config.mapMode !== 'crt' && config.mapMode !== 'pro') return null;

  // Filter aircraft in range
  const inRangeAircraft = sortedAircraft.filter(ac => {
    const dist = ac.distance_nm || 0;
    return config.mapMode === 'pro' ? dist <= radarRange * 1.5 : dist <= radarRange;
  });

  // Sort: emergencies first, then conflicts, then by distance
  const prioritySorted = [...inRangeAircraft].sort((a, b) => {
    const aEmergency = a.emergency || ['7500', '7600', '7700'].includes(a.squawk);
    const bEmergency = b.emergency || ['7500', '7600', '7700'].includes(b.squawk);
    const aConflict = activeConflicts.some(e =>
      e.icao?.toUpperCase() === a.hex?.toUpperCase() ||
      e.icao_2?.toUpperCase() === a.hex?.toUpperCase()
    );
    const bConflict = activeConflicts.some(e =>
      e.icao?.toUpperCase() === b.hex?.toUpperCase() ||
      e.icao_2?.toUpperCase() === b.hex?.toUpperCase()
    );

    // Emergency first
    if (aEmergency && !bEmergency) return -1;
    if (!aEmergency && bEmergency) return 1;
    // Then conflicts
    if (aConflict && !bConflict) return -1;
    if (!aConflict && bConflict) return 1;
    // Then by distance
    return (a.distance_nm || 999) - (b.distance_nm || 999);
  });

  // Lazy load - show initial batch plus loaded items
  const displayCount = Math.min(listDisplayCount, prioritySorted.length);
  const displayAircraft = prioritySorted.slice(0, displayCount);
  const hasMore = prioritySorted.length > displayCount;

  return (
    <div
      className={`radar-aircraft-list expanded ${config.mapMode === 'pro' ? 'pro-style' : ''} ${isListDragging ? 'dragging' : ''}`}
      style={aircraftListPosition.x !== null ? {
        left: aircraftListPosition.x,
        top: aircraftListPosition.y,
        right: 'auto',
        bottom: 'auto'
      } : {}}
    >
      <div
        className="aircraft-list-header"
        onMouseDown={handleListMouseDown}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          handleListMouseDown({ clientX: touch.clientX, clientY: touch.clientY, currentTarget: e.currentTarget.parentElement, preventDefault: () => {} });
        }}
      >
        <button
          className="aircraft-list-toggle"
          onClick={() => setListExpanded(!listExpanded)}
        >
          <Plane size={14} />
          <span>Aircraft ({inRangeCount})</span>
          {listExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button
          className="aircraft-list-close"
          onClick={() => setShowAircraftList(false)}
          title="Hide aircraft list"
        >
          <X size={14} />
        </button>
      </div>

      {listExpanded && (
        <div className="aircraft-list-content">
          {displayAircraft.map(ac => {
            const tailInfo = getTailInfo(ac.hex, ac.flight);
            const isEmergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
            const safetyEvent = activeConflicts.find(e =>
              e.icao?.toUpperCase() === ac.hex?.toUpperCase() ||
              e.icao_2?.toUpperCase() === ac.hex?.toUpperCase()
            );
            const isConflict = !!safetyEvent;
            const conflictSeverity = safetyEvent?.severity || null;

            return (
              <div
                key={ac.hex}
                className={`aircraft-list-item ${selectedAircraft?.hex === ac.hex ? 'selected' : ''} ${isEmergency ? 'emergency flash-emergency' : ''} ${isConflict ? `conflict flash-conflict ${getSeverityClass(conflictSeverity)}` : ''} ${ac.military ? 'military' : ''}`}
                onClick={() => selectAircraft(ac)}
                title={safetyEvent ? `${getEventTypeName(safetyEvent.event_type)}: ${safetyEvent.message}` : ''}
              >
                <div className="aircraft-list-primary">
                  <span className="aircraft-flag">{tailInfo.flag}</span>
                  <span className="aircraft-callsign">{ac.flight?.trim() || ac.hex}</span>
                  {tailInfo.tailNumber && <span className="aircraft-tail">({tailInfo.tailNumber})</span>}
                  {ac.military && <Shield size={10} className="mil-icon" />}
                  {isEmergency && <AlertTriangle size={10} className="emerg-icon" />}
                  {isConflict && <Zap size={10} className={`conflict-icon ${getSeverityClass(conflictSeverity)}`} />}
                </div>
                <div className="aircraft-list-secondary">
                  <span className="aircraft-alt">{ac.alt ? `${(ac.alt/1000).toFixed(1)}k` : '--'}</span>
                  <span className="aircraft-speed">{ac.gs ? `${Math.round(ac.gs)}kt` : '--'}</span>
                  <span className="aircraft-dist">{ac.distance_nm?.toFixed(1) || '--'}nm</span>
                  <button
                    className="aircraft-detail-link"
                    onClick={(e) => { e.stopPropagation(); openAircraftDetail(ac.hex); }}
                    title="View full details"
                  >
                    <ExternalLink size={10} />
                  </button>
                </div>
              </div>
            );
          })}
          {hasMore && (
            <button
              className="aircraft-list-load-more"
              onClick={(e) => {
                e.stopPropagation();
                setListDisplayCount(prev => prev + 20);
              }}
            >
              Load more ({prioritySorted.length - displayCount} remaining)
            </button>
          )}
          {prioritySorted.length === 0 && (
            <div className="aircraft-list-empty">No aircraft in range</div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Show Aircraft List Button (when hidden)
 */
export function AircraftListShowButton({
  config,
  showAircraftList,
  setShowAircraftList,
  inRangeCount,
}) {
  if (showAircraftList) return null;
  if (config.mapMode !== 'crt' && config.mapMode !== 'pro') return null;

  return (
    <button
      className={`aircraft-list-show-btn ${config.mapMode === 'pro' ? 'pro-style' : ''}`}
      onClick={() => setShowAircraftList(true)}
    >
      <Plane size={14} />
      <span>{inRangeCount}</span>
      <ChevronUp size={14} />
    </button>
  );
}
