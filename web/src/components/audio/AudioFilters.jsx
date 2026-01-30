/**
 * AudioFilters component for filtering audio transmissions.
 *
 * Features:
 * - Text search
 * - Status filter (transcribed, processing, etc.)
 * - Channel filter
 * - Flight match filter
 * - Airline filter
 * - Flight type filter
 * - Callsign filter
 * - Emergency filter toggle
 */

import React from 'react';
import { Search, Plane, Filter, X, AlertCircle } from 'lucide-react';

function AudioFilters({
  // Text search
  searchQuery,
  onSearchChange,
  // Status filter
  statusFilter,
  onStatusFilterChange,
  // Channel filter
  channelFilter,
  onChannelFilterChange,
  availableChannels,
  // Flight match filter
  flightMatchFilter,
  onFlightMatchFilterChange,
  // Airline filter
  airlineFilter,
  onAirlineFilterChange,
  availableAirlines,
  // Flight type filter
  flightTypeFilter,
  onFlightTypeFilterChange,
  // Callsign filter
  callsignFilter,
  onCallsignFilterChange,
  // Emergency filter
  emergencyFilter,
  onEmergencyFilterChange,
  // Clear all filters
  onClearFilters
}) {
  const hasActiveFilters = (
    flightMatchFilter !== 'all' ||
    airlineFilter !== 'all' ||
    flightTypeFilter !== 'all' ||
    callsignFilter ||
    emergencyFilter
  );

  return (
    <div className="audio-filters">
      {/* Text Search */}
      <div className="search-box">
        <Search size={16} />
        <input
          type="text"
          placeholder="Search transcripts, channels, frequencies..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Status Filter */}
      <select
        className="audio-select"
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value)}
      >
        <option value="all">All Status</option>
        <option value="completed">Transcribed</option>
        <option value="processing">Processing</option>
        <option value="queued">Queued</option>
        <option value="pending">Pending</option>
        <option value="failed">Failed</option>
      </select>

      {/* Channel Filter */}
      <select
        className="audio-select"
        value={channelFilter}
        onChange={(e) => onChannelFilterChange(e.target.value)}
      >
        <option value="all">All Channels</option>
        {availableChannels.map(channel => (
          <option key={channel} value={channel}>{channel}</option>
        ))}
      </select>

      {/* Flight Match Filter */}
      <select
        className="audio-select"
        value={flightMatchFilter}
        onChange={(e) => onFlightMatchFilterChange(e.target.value)}
      >
        <option value="all">All Transmissions</option>
        <option value="matched">With Flights</option>
        <option value="unmatched">No Flights</option>
      </select>

      {/* Airline Filter */}
      <select
        className="audio-select"
        value={airlineFilter}
        onChange={(e) => onAirlineFilterChange(e.target.value)}
        disabled={availableAirlines.length === 0}
      >
        <option value="all">All Airlines</option>
        {availableAirlines.map(airline => (
          <option key={airline.icao} value={airline.icao}>
            {airline.name} ({airline.icao})
          </option>
        ))}
      </select>

      {/* Flight Type Filter */}
      <select
        className="audio-select"
        value={flightTypeFilter}
        onChange={(e) => onFlightTypeFilterChange(e.target.value)}
      >
        <option value="all">All Types</option>
        <option value="airline">Commercial</option>
        <option value="general_aviation">General Aviation</option>
        <option value="military">Military</option>
      </select>

      {/* Callsign Filter */}
      <div className="callsign-filter">
        <Plane size={14} />
        <input
          type="text"
          placeholder="Callsign..."
          value={callsignFilter}
          onChange={(e) => onCallsignFilterChange(e.target.value)}
        />
        {callsignFilter && (
          <button
            className="clear-callsign-btn"
            onClick={() => onCallsignFilterChange('')}
            title="Clear callsign filter"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Emergency Filter Toggle */}
      <button
        className={`emergency-filter-btn ${emergencyFilter ? 'active' : ''}`}
        onClick={() => onEmergencyFilterChange(!emergencyFilter)}
        title={emergencyFilter ? 'Show all transmissions' : 'Show only emergency transmissions (mayday, pan pan, etc.)'}
      >
        <AlertCircle size={14} />
        <span>Emergency</span>
      </button>

      {/* Active Filters Indicator / Clear Button */}
      {hasActiveFilters && (
        <button
          className="clear-filters-btn"
          onClick={onClearFilters}
          title="Clear all flight filters"
        >
          <Filter size={14} />
          <X size={10} className="clear-icon" />
        </button>
      )}
    </div>
  );
}

export default AudioFilters;
