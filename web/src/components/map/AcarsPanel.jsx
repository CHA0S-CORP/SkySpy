import React, { useState, useEffect, useMemo } from 'react';
import { MessageCircle, X, Filter } from 'lucide-react';

/**
 * Panel for displaying ACARS/VDL2 messages
 */
export function AcarsPanel({ 
  apiUrl, 
  onClose,
  onSelectAircraft 
}) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [filters, setFilters] = useState(() => {
    const saved = localStorage.getItem('adsb-acars-filters');
    return saved ? JSON.parse(saved) : {
      hideEmpty: true,
      sourceFilter: 'all',
      labelFilter: '',
      callsignFilter: '',
    };
  });

  // Fetch ACARS messages and status
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
    
    fetchAcars();
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
    
    return filtered.slice(0, 50);
  }, [messages, filters]);

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
        <button className="acars-close" onClick={onClose}>
          <X size={16} />
        </button>
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
      
      <div className="acars-filters">
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
        <input 
          type="text"
          className="acars-callsign-filter"
          placeholder="Callsign..."
          value={filters.callsignFilter}
          onChange={(e) => setFilters({...filters, callsignFilter: e.target.value})}
        />
      </div>
      
      <div className="acars-messages">
        {filteredMessages.length === 0 ? (
          <div className="acars-empty">No messages match filters</div>
        ) : (
          filteredMessages.map((msg, i) => (
            <div key={i} className="acars-message">
              <div className="acars-msg-header">
                <span 
                  className="acars-callsign clickable"
                  onClick={() => onSelectAircraft?.(msg.icao_hex)}
                >
                  {msg.callsign || msg.icao_hex || 'Unknown'}
                </span>
                <span className="acars-label">{msg.label || '--'}</span>
                <span className={`acars-source-badge ${msg.source}`}>{msg.source}</span>
                <span className="acars-time">
                  {msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleTimeString() : '--'}
                </span>
              </div>
              {msg.text && <div className="acars-text">{msg.text}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default AcarsPanel;
