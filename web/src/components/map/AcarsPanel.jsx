import React, { useState, useEffect, useMemo } from 'react';
import { MessageCircle, X, Filter, Plane } from 'lucide-react';

/**
 * Panel for displaying ACARS/VDL2 messages with decoded airline and label info
 */
export function AcarsPanel({
  apiUrl,
  onClose,
  onSelectAircraft
}) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [labels, setLabels] = useState({});
  const [filters, setFilters] = useState(() => {
    const saved = localStorage.getItem('adsb-acars-filters');
    return saved ? JSON.parse(saved) : {
      hideEmpty: true,
      sourceFilter: 'all',
      labelFilter: '',
      callsignFilter: '',
      airlineFilter: '',
    };
  });
  const [showFilters, setShowFilters] = useState(false);

  // Fetch ACARS messages, status, and labels
  useEffect(() => {
    const fetchAcars = async () => {
      const baseUrl = apiUrl || '';
      try {
        const msgRes = await fetch(`${baseUrl}/api/v1/acars/messages/recent?limit=50`);
        if (msgRes.ok) {
          const data = await msgRes.json();
          setMessages(data.messages || []);
        }

        const statusRes = await fetch(`${baseUrl}/api/v1/acars/status`);
        if (statusRes.ok) {
          const data = await statusRes.json();
          setStatus(data);
        }
      } catch (err) {
        console.log('ACARS fetch error:', err.message);
      }
    };

    // Fetch label reference once
    const fetchLabels = async () => {
      const baseUrl = apiUrl || '';
      try {
        const res = await fetch(`${baseUrl}/api/v1/acars/labels`);
        if (res.ok) {
          const data = await res.json();
          setLabels(data.labels || {});
        }
      } catch (err) {
        console.log('Labels fetch error:', err.message);
      }
    };

    fetchAcars();
    fetchLabels();
    const interval = setInterval(fetchAcars, 5000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  // Save filters to localStorage
  useEffect(() => {
    localStorage.setItem('adsb-acars-filters', JSON.stringify(filters));
  }, [filters]);

  // Filter messages
  const filteredMessages = useMemo(() => {
    let filtered = messages;

    if (filters.hideEmpty) {
      filtered = filtered.filter(msg => msg.text && msg.text.trim().length > 0);
    }

    if (filters.sourceFilter !== 'all') {
      filtered = filtered.filter(msg => msg.source === filters.sourceFilter);
    }

    if (filters.callsignFilter) {
      const cf = filters.callsignFilter.toLowerCase();
      filtered = filtered.filter(msg =>
        (msg.callsign && msg.callsign.toLowerCase().includes(cf)) ||
        (msg.icao_hex && msg.icao_hex.toLowerCase().includes(cf))
      );
    }

    if (filters.airlineFilter) {
      const af = filters.airlineFilter.toLowerCase();
      filtered = filtered.filter(msg =>
        (msg.airline?.icao && msg.airline.icao.toLowerCase().includes(af)) ||
        (msg.airline?.iata && msg.airline.iata.toLowerCase().includes(af)) ||
        (msg.airline?.name && msg.airline.name.toLowerCase().includes(af))
      );
    }

    if (filters.labelFilter) {
      const lf = filters.labelFilter.toUpperCase();
      filtered = filtered.filter(msg => msg.label === lf);
    }

    return filtered.slice(0, 50);
  }, [messages, filters]);

  // Get label display name
  const getLabelName = (label) => {
    if (!label) return null;
    const info = labels[label];
    return info?.name || null;
  };

  return (
    <div className="acars-panel">
      <div className="acars-panel-header">
        <div className="acars-panel-title">
          <MessageCircle size={18} />
          <span>ACARS Messages</span>
          {status && (
            <span className={`acars-status-dot ${status.running ? 'active' : ''}`} />
          )}
        </div>
        <div className="acars-header-actions">
          <button
            className={`acars-filter-btn ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
            title="Toggle filters"
          >
            <Filter size={14} />
          </button>
          <button className="acars-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      {status && (
        <div className="acars-stats">
          <div className="acars-stat">
            <span>Buffer</span>
            <span>{status.buffer_size || 0}</span>
          </div>
          <div className="acars-stat">
            <span>ACARS</span>
            <span>{status.acars?.total_received || 0}</span>
          </div>
          <div className="acars-stat">
            <span>VDL2</span>
            <span>{status.vdlm2?.total_received || 0}</span>
          </div>
        </div>
      )}

      {showFilters && (
        <div className="acars-filters">
          <div className="acars-filter-row">
            <label className="acars-filter-toggle">
              <input
                type="checkbox"
                checked={filters.hideEmpty}
                onChange={(e) => setFilters({...filters, hideEmpty: e.target.checked})}
              />
              <span>Hide empty</span>
            </label>
            <select
              className="acars-source-filter"
              value={filters.sourceFilter}
              onChange={(e) => setFilters({...filters, sourceFilter: e.target.value})}
            >
              <option value="all">All Sources</option>
              <option value="acars">ACARS Only</option>
              <option value="vdlm2">VDL2 Only</option>
            </select>
          </div>
          <div className="acars-filter-row">
            <input
              type="text"
              className="acars-filter-input"
              placeholder="Callsign..."
              value={filters.callsignFilter}
              onChange={(e) => setFilters({...filters, callsignFilter: e.target.value})}
            />
            <input
              type="text"
              className="acars-filter-input"
              placeholder="Airline..."
              value={filters.airlineFilter}
              onChange={(e) => setFilters({...filters, airlineFilter: e.target.value})}
            />
            <input
              type="text"
              className="acars-filter-input"
              placeholder="Label..."
              value={filters.labelFilter}
              onChange={(e) => setFilters({...filters, labelFilter: e.target.value})}
              style={{ width: '60px' }}
            />
          </div>
        </div>
      )}

      {/* Quick filter bar when filters hidden */}
      {!showFilters && (
        <div className="acars-quick-filters">
          <input
            type="text"
            className="acars-callsign-filter"
            placeholder="Filter callsign..."
            value={filters.callsignFilter}
            onChange={(e) => setFilters({...filters, callsignFilter: e.target.value})}
          />
        </div>
      )}

      <div className="acars-messages">
        {filteredMessages.length === 0 ? (
          <div className="acars-empty">No messages match filters</div>
        ) : (
          filteredMessages.map((msg, i) => (
            <div key={i} className="acars-message">
              <div className="acars-msg-header">
                <div className="acars-msg-flight">
                  <span
                    className="acars-callsign clickable"
                    onClick={() => onSelectAircraft?.(msg.icao_hex)}
                    title={msg.airline?.name || 'Click to select aircraft'}
                  >
                    {msg.callsign || msg.icao_hex || 'Unknown'}
                  </span>
                  {msg.airline?.name && (
                    <span className="acars-airline" title={`${msg.airline.icao || msg.airline.iata}`}>
                      <Plane size={10} />
                      {msg.airline.name}
                    </span>
                  )}
                </div>
                <div className="acars-msg-meta">
                  <span
                    className="acars-label"
                    title={msg.label_info?.description || getLabelName(msg.label) || msg.label}
                  >
                    {msg.label || '--'}
                    {(msg.label_info?.name || getLabelName(msg.label)) && (
                      <span className="acars-label-name">
                        {msg.label_info?.name || getLabelName(msg.label)}
                      </span>
                    )}
                  </span>
                  <span className={`acars-source-badge ${msg.source}`}>{msg.source}</span>
                  <span className="acars-time">
                    {msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleTimeString() : '--'}
                  </span>
                </div>
              </div>
              {msg.text && <div className="acars-text">{msg.text}</div>}
              {msg.decoded_text && Object.keys(msg.decoded_text).length > 0 && (
                <div className="acars-decoded">
                  {msg.decoded_text.airports_mentioned && (
                    <span className="acars-decoded-item" title="Airports mentioned">
                      ✈ {msg.decoded_text.airports_mentioned.join(', ')}
                    </span>
                  )}
                  {msg.decoded_text.flight_levels && (
                    <span className="acars-decoded-item" title="Flight levels">
                      ⬆ FL{msg.decoded_text.flight_levels.join(', FL')}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default AcarsPanel;
