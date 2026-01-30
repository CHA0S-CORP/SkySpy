import React from 'react';
import { MessageCircle, X } from 'lucide-react';
import { callsignsMatch } from '../../../utils';

/**
 * AcarsPanel component - displays ACARS messages
 */
export function AcarsPanel({
  showAcarsPanel,
  setShowAcarsPanel,
  acarsMessages,
  acarsStatus,
  acarsFilters,
  setAcarsFilters,
  aircraft,
  callsignHexCache,
  setAircraftDetailHex,
}) {
  if (!showAcarsPanel) return null;

  // Filter messages
  let filtered = acarsMessages;

  // Hide empty messages
  if (acarsFilters.hideEmpty) {
    filtered = filtered.filter(msg => msg.text && msg.text.trim().length > 0);
  }

  // Source filter
  if (acarsFilters.sourceFilter !== 'all') {
    filtered = filtered.filter(msg => msg.source === acarsFilters.sourceFilter);
  }

  // Callsign filter
  if (acarsFilters.callsignFilter) {
    const cf = acarsFilters.callsignFilter.toLowerCase();
    filtered = filtered.filter(msg =>
      (msg.callsign && msg.callsign.toLowerCase().includes(cf)) ||
      (msg.icao_hex && msg.icao_hex.toLowerCase().includes(cf))
    );
  }

  return (
    <div className="acars-panel">
      <div className="acars-panel-header">
        <div className="acars-panel-title">
          <MessageCircle size={18} />
          <span>ACARS Messages</span>
          {acarsStatus && (
            <span className={`acars-status-dot ${acarsStatus.running ? 'active' : ''}`} />
          )}
        </div>
        <button className="acars-close" onClick={() => setShowAcarsPanel(false)}>
          <X size={16} />
        </button>
      </div>

      {acarsStatus && (
        <div className="acars-stats">
          <div className="acars-stat">
            <span>Buffer</span>
            <span>{acarsStatus.buffer_size || 0}</span>
          </div>
          <div className="acars-stat">
            <span>ACARS</span>
            <span>{acarsStatus.acars?.total_received || 0}</span>
          </div>
          <div className="acars-stat">
            <span>VDL2</span>
            <span>{acarsStatus.vdlm2?.total_received || 0}</span>
          </div>
        </div>
      )}

      {/* ACARS Filters */}
      <div className="acars-filters">
        <label className="acars-filter-toggle">
          <input
            type="checkbox"
            checked={acarsFilters.hideEmpty}
            onChange={(e) => setAcarsFilters({...acarsFilters, hideEmpty: e.target.checked})}
          />
          <span>Hide empty</span>
        </label>
        <select
          className="acars-source-filter"
          value={acarsFilters.sourceFilter}
          onChange={(e) => setAcarsFilters({...acarsFilters, sourceFilter: e.target.value})}
        >
          <option value="all">All Sources</option>
          <option value="acars">ACARS Only</option>
          <option value="vdlm2">VDL2 Only</option>
        </select>
        <input
          type="text"
          className="acars-callsign-filter"
          placeholder="Callsign..."
          value={acarsFilters.callsignFilter}
          onChange={(e) => setAcarsFilters({...acarsFilters, callsignFilter: e.target.value})}
        />
      </div>

      <div className="acars-messages">
        {filtered.length === 0 ? (
          <div className="acars-empty">No messages match filters</div>
        ) : (
          filtered.slice(0, 50).map((msg, i) => {
            // Find matching aircraft by ICAO hex or callsign
            const matchingAircraft = aircraft.find(ac =>
              (msg.icao_hex && ac.hex?.toUpperCase() === msg.icao_hex.toUpperCase()) ||
              callsignsMatch(msg.callsign, ac.flight)
            );

            // Check cache for hex lookup by callsign
            const cachedHex = msg.callsign ? callsignHexCache[msg.callsign.trim().toUpperCase()] : null;

            // Get hex for linking
            const linkHex = matchingAircraft?.hex || msg.icao_hex || cachedHex;
            const canLink = !!linkHex;
            const isMatched = !!matchingAircraft;
            const isFromHistory = !isMatched && !msg.icao_hex && cachedHex;

            return (
              <div
                key={i}
                className={`acars-message ${canLink ? 'clickable' : ''} ${isMatched ? 'matched' : ''}`}
                onClick={() => {
                  if (canLink) {
                    setAircraftDetailHex(linkHex);
                  }
                }}
                title={isMatched ? 'Click to view aircraft (in range)' : isFromHistory ? 'Click to view aircraft (from history)' : canLink ? 'Click to view aircraft details' : 'Aircraft not in range - no ICAO hex'}
              >
                <div className="acars-msg-header">
                  <span className={`acars-callsign ${canLink ? 'clickable' : ''}`}>{msg.callsign || msg.icao_hex || 'Unknown'}</span>
                  <span className="acars-label">{msg.label || '--'}</span>
                  <span className={`acars-source-badge ${msg.source}`}>{msg.source}</span>
                  <span className="acars-time">
                    {msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleTimeString() : '--'}
                  </span>
                </div>
                {msg.text && <div className="acars-text">{msg.text}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
