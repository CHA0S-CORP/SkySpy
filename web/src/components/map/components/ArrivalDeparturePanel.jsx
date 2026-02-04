import React, { useState, useMemo, memo } from 'react';
import {
  PlaneLanding,
  PlaneTakeoff,
  X,
  GripHorizontal,
  Clock,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  MapPin,
  RefreshCw,
  Plane,
} from 'lucide-react';
import { useDraggable } from '../../../hooks/useDraggable';

// Time window filter options
const TIME_WINDOW_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hr' },
  { value: 120, label: '2 hr' },
];

/**
 * Format ETA for display
 */
function formatETA(minutes) {
  if (minutes === null || minutes === undefined) return '--';
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

/**
 * Format departure time for display (minutes ago)
 */
function formatDepartureTime(minutesAgo) {
  if (minutesAgo === null || minutesAgo === undefined) return '--';
  if (minutesAgo < 1) return 'Just now';
  if (minutesAgo < 60) return `${Math.round(minutesAgo)}m ago`;
  const hrs = Math.floor(minutesAgo / 60);
  const mins = Math.round(minutesAgo % 60);
  return mins > 0 ? `${hrs}h ${mins}m ago` : `${hrs}h ago`;
}

/**
 * Format altitude for display
 */
function formatAltitude(alt) {
  if (alt === null || alt === undefined) return '--';
  if (alt < 1000) return `${alt}`;
  return `${Math.round(alt / 100)}`;
}

/**
 * Format distance for display
 */
function formatDistance(dist) {
  if (dist === null || dist === undefined) return '--';
  return dist.toFixed(1);
}

/**
 * AircraftRow component - single row in the traffic table
 */
const AircraftRow = memo(function AircraftRow({ aircraft, isInbound, onSelect, isSelected }) {
  const callsign = aircraft.flight?.trim() || aircraft.hex?.toUpperCase() || '--';
  const altitude = aircraft.alt_baro || aircraft.alt_geom || aircraft.alt;
  const distance = isInbound ? aircraft.distanceToAirport : aircraft.distanceFromAirport;
  const timeValue = isInbound ? aircraft.eta : aircraft.minutesSinceDeparture;

  return (
    <tr
      className={`arrival-departure-row ${isSelected ? 'selected' : ''} ${aircraft.outOfRange ? 'out-of-range' : ''}`}
      onClick={() => onSelect?.(aircraft)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect?.(aircraft)}
    >
      <td className="col-callsign">
        <span className="callsign-text">{callsign}</span>
      </td>
      <td className="col-type">{aircraft.type || '--'}</td>
      <td className="col-origin">
        {isInbound ? aircraft.origin || '--' : aircraft.destination || '--'}
      </td>
      <td className="col-altitude">{aircraft.outOfRange ? '--' : formatAltitude(altitude)}</td>
      <td className="col-distance">{aircraft.outOfRange ? '--' : formatDistance(distance)}</td>
      <td className={`col-time ${isInbound ? 'eta' : 'departure'}`}>
        {isInbound ? formatETA(timeValue) : formatDepartureTime(timeValue)}
      </td>
    </tr>
  );
});

/**
 * AirportSection - collapsible section for a single airport
 */
const AirportSection = memo(function AirportSection({
  airport,
  inbound,
  outbound,
  onSelectAircraft,
  selectedHex,
  defaultExpanded = true,
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [activeTab, setActiveTab] = useState('inbound');

  const airportCode = airport.icao || airport.id || airport.icaoId || 'APT';
  const airportName = airport.name || airport.site || '';

  const displayList = activeTab === 'inbound' ? inbound : outbound;

  return (
    <div className="arrival-departure-airport-section">
      <button
        className="airport-section-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="airport-icon">
          <MapPin size={14} />
        </span>
        <span className="airport-code">{airportCode}</span>
        {airportName && <span className="airport-name">{airportName}</span>}
        <span className="airport-counts">
          <span className="count-inbound" title="Inbound">
            <ArrowDown size={12} /> {inbound.length}
          </span>
          <span className="count-outbound" title="Outbound">
            <ArrowUp size={12} /> {outbound.length}
          </span>
        </span>
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>

      {isExpanded && (
        <div className="airport-section-content">
          {/* Tab bar */}
          <div className="traffic-tabs" role="tablist">
            <button
              className={`traffic-tab ${activeTab === 'inbound' ? 'active' : ''}`}
              onClick={() => setActiveTab('inbound')}
              role="tab"
              aria-selected={activeTab === 'inbound'}
            >
              <PlaneLanding size={14} />
              <span>Arrivals ({inbound.length})</span>
            </button>
            <button
              className={`traffic-tab ${activeTab === 'outbound' ? 'active' : ''}`}
              onClick={() => setActiveTab('outbound')}
              role="tab"
              aria-selected={activeTab === 'outbound'}
            >
              <PlaneTakeoff size={14} />
              <span>Departures ({outbound.length})</span>
            </button>
          </div>

          {/* Traffic table */}
          <div className="traffic-table-container">
            {displayList.length === 0 ? (
              <div className="traffic-empty">
                <Plane size={20} />
                <span>No {activeTab === 'inbound' ? 'arrivals' : 'departures'}</span>
              </div>
            ) : (
              <table className="traffic-table">
                <thead>
                  <tr>
                    <th className="col-callsign">Callsign</th>
                    <th className="col-type">Type</th>
                    <th className="col-origin">{activeTab === 'inbound' ? 'Origin' : 'Dest'}</th>
                    <th className="col-altitude">FL</th>
                    <th className="col-distance">Dist</th>
                    <th className="col-time">{activeTab === 'inbound' ? 'ETA' : 'Dep'}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayList.map((ac) => (
                    <AircraftRow
                      key={ac.hex}
                      aircraft={ac}
                      isInbound={activeTab === 'inbound'}
                      onSelect={onSelectAircraft}
                      isSelected={selectedHex === ac.hex}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * AirportSelector - dropdown to select airports to monitor
 */
const AirportSelector = memo(function AirportSelector({
  airports,
  selectedAirports,
  onToggleAirport,
  onClearAll,
}) {
  const [isOpen, setIsOpen] = useState(false);

  // Sort airports by code
  const sortedAirports = useMemo(() => {
    return [...airports].sort((a, b) => {
      const codeA = a.icao || a.id || a.icaoId || '';
      const codeB = b.icao || b.id || b.icaoId || '';
      return codeA.localeCompare(codeB);
    });
  }, [airports]);

  return (
    <div className="airport-selector">
      <button
        className="airport-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <MapPin size={14} />
        <span>
          {selectedAirports.length === 0
            ? 'Select Airports'
            : `${selectedAirports.length} airport${selectedAirports.length > 1 ? 's' : ''}`}
        </span>
        <ChevronDown size={14} className={isOpen ? 'rotated' : ''} />
      </button>

      {isOpen && (
        <div className="airport-selector-dropdown">
          <div className="airport-selector-header">
            <span>Available Airports</span>
            {selectedAirports.length > 0 && (
              <button className="clear-all-btn" onClick={onClearAll}>
                Clear All
              </button>
            )}
          </div>
          <div className="airport-selector-list">
            {sortedAirports.length === 0 ? (
              <div className="no-airports">No airports in range</div>
            ) : (
              sortedAirports.map((apt) => {
                const code = apt.icao || apt.id || apt.icaoId || apt.faaId;
                const isSelected = selectedAirports.includes(code);
                return (
                  <label key={code} className={`airport-option ${isSelected ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleAirport(code)}
                    />
                    <span className="airport-code">{code}</span>
                    {apt.name && <span className="airport-name">{apt.name}</span>}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * ArrivalDeparturePanel - Main panel component showing airport traffic lists
 */
export function ArrivalDeparturePanel({
  show,
  onClose,
  airports = [],
  inboundAircraft = {},
  outboundAircraft = {},
  counts = { inbound: 0, outbound: 0, total: 0 },
  selectedAirports = [],
  onToggleAirport,
  onClearAirports,
  onSelectAircraft,
  selectedHex,
  timeWindow = 60,
  onTimeWindowChange,
  onRefresh,
  loading = false,
}) {
  // Draggable panel behavior
  const { position, handleMouseDown } = useDraggable(
    { x: null, y: null },
    { width: 420, height: 500 }
  );

  // Get monitored airport objects
  const monitoredAirports = useMemo(() => {
    return airports.filter(
      (apt) =>
        selectedAirports.includes(apt.icao) ||
        selectedAirports.includes(apt.id) ||
        selectedAirports.includes(apt.icaoId) ||
        selectedAirports.includes(apt.faaId)
    );
  }, [airports, selectedAirports]);

  if (!show) return null;

  const panelStyle =
    position.x !== null
      ? {
          position: 'fixed',
          left: position.x,
          top: position.y,
        }
      : {};

  return (
    <div className="arrival-departure-panel pro-style" style={panelStyle}>
      {/* Drag handle header */}
      <div
        className="arrival-departure-header"
        role="toolbar"
        aria-label="Airport traffic panel controls"
        onMouseDown={handleMouseDown}
      >
        <div className="panel-drag-handle">
          <GripHorizontal size={16} />
        </div>

        <div className="panel-title">
          <PlaneLanding size={16} />
          <span>AIRPORT TRAFFIC</span>
          {counts.total > 0 && <span className="traffic-count-badge">{counts.total}</span>}
        </div>

        <div className="panel-actions">
          <button className="panel-btn" onClick={onRefresh} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          </button>
          <button className="panel-btn close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Controls bar */}
      <div className="arrival-departure-controls">
        <AirportSelector
          airports={airports}
          selectedAirports={selectedAirports}
          onToggleAirport={onToggleAirport}
          onClearAll={onClearAirports}
        />

        <div className="time-window-selector">
          <Clock size={14} />
          <select
            value={timeWindow}
            onChange={(e) => onTimeWindowChange?.(parseInt(e.target.value, 10))}
          >
            {TIME_WINDOW_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary bar */}
      {selectedAirports.length > 0 && (
        <div className="arrival-departure-summary">
          <div className="summary-item inbound">
            <ArrowDown size={14} />
            <span className="summary-count">{counts.inbound}</span>
            <span className="summary-label">Inbound</span>
          </div>
          <div className="summary-item outbound">
            <ArrowUp size={14} />
            <span className="summary-count">{counts.outbound}</span>
            <span className="summary-label">Outbound</span>
          </div>
        </div>
      )}

      {/* Airport sections */}
      <div className="arrival-departure-content">
        {selectedAirports.length === 0 ? (
          <div className="no-airports-selected">
            <MapPin size={24} />
            <span>Select airports to monitor</span>
            <p>
              Choose one or more airports from the dropdown above to see arrival and departure
              traffic.
            </p>
          </div>
        ) : (
          monitoredAirports.map((airport) => {
            const code = airport.icao || airport.id || airport.icaoId;
            return (
              <AirportSection
                key={code}
                airport={airport}
                inbound={inboundAircraft[code] || []}
                outbound={outboundAircraft[code] || []}
                onSelectAircraft={onSelectAircraft}
                selectedHex={selectedHex}
                defaultExpanded={monitoredAirports.length <= 2}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

export default ArrivalDeparturePanel;
