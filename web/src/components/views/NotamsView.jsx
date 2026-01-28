import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle, FileWarning, MapPin, Clock, Search, Filter, RefreshCw,
  ChevronDown, ChevronUp, ExternalLink, Plane, Calendar, Navigation,
  Info, AlertCircle, Shield, Loader2, X
} from 'lucide-react';
import { useNativeWebSocket } from '../../hooks/useNativeWebSocket';

// NOTAM type icons and colors
const NOTAM_TYPES = {
  D: { label: 'NOTAM D', color: '#60a5fa', icon: Info },
  FDC: { label: 'FDC NOTAM', color: '#f59e0b', icon: AlertCircle },
  TFR: { label: 'TFR', color: '#ef4444', icon: Shield },
  GPS: { label: 'GPS NOTAM', color: '#8b5cf6', icon: Navigation },
  MIL: { label: 'Military', color: '#10b981', icon: Shield },
  POINTER: { label: 'Pointer', color: '#6b7280', icon: ExternalLink },
};

// Format date for display
function formatDate(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

// Format relative time
function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date - now;
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    // Past
    const absDiffHours = Math.abs(diffHours);
    const absDiffDays = Math.abs(diffDays);
    if (absDiffDays > 1) return `${absDiffDays} days ago`;
    if (absDiffHours > 1) return `${absDiffHours} hours ago`;
    return 'recently';
  } else {
    // Future
    if (diffDays > 1) return `in ${diffDays} days`;
    if (diffHours > 1) return `in ${diffHours} hours`;
    return 'soon';
  }
}

// Single NOTAM Card component
function NotamCard({ notam, expanded, onToggle }) {
  const typeInfo = NOTAM_TYPES[notam.type] || NOTAM_TYPES.D;
  const TypeIcon = typeInfo.icon;
  const isActive = new Date(notam.effective_start) <= new Date();
  const isPermanent = notam.is_permanent;

  return (
    <div
      className={`notam-card ${notam.type?.toLowerCase()} ${expanded ? 'expanded' : ''} ${isActive ? 'active' : 'upcoming'}`}
      onClick={onToggle}
    >
      <div className="notam-card-header">
        <div className="notam-type-badge" style={{ backgroundColor: typeInfo.color }}>
          <TypeIcon size={14} />
          <span>{typeInfo.label}</span>
        </div>
        <div className="notam-location">
          <MapPin size={14} />
          <span>{notam.location || 'Unknown'}</span>
        </div>
        <div className="notam-id">{notam.notam_id}</div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      <div className="notam-card-summary">
        <p className="notam-text-preview">
          {notam.text?.slice(0, 150)}{notam.text?.length > 150 ? '...' : ''}
        </p>
      </div>

      <div className="notam-card-meta">
        <div className="notam-time">
          <Clock size={12} />
          <span>
            {isActive ? 'Active' : 'Starts'}: {formatDate(notam.effective_start)}
          </span>
        </div>
        {!isPermanent && notam.effective_end && (
          <div className="notam-time expires">
            <Calendar size={12} />
            <span>Expires: {formatDate(notam.effective_end)}</span>
          </div>
        )}
        {isPermanent && (
          <div className="notam-permanent">
            <AlertTriangle size={12} />
            <span>Permanent</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="notam-card-details">
          <div className="notam-full-text">
            <h4>Full Text</h4>
            <pre>{notam.text}</pre>
          </div>

          {(notam.floor_ft != null || notam.ceiling_ft != null) && (
            <div className="notam-altitude">
              <h4>Altitude Restrictions</h4>
              <div className="altitude-range">
                {notam.floor_ft != null && <span>Floor: {notam.floor_ft} ft</span>}
                {notam.ceiling_ft != null && <span>Ceiling: {notam.ceiling_ft} ft</span>}
              </div>
            </div>
          )}

          {notam.radius_nm && (
            <div className="notam-radius">
              <h4>Radius</h4>
              <span>{notam.radius_nm} NM</span>
            </div>
          )}

          {(notam.latitude && notam.longitude) && (
            <div className="notam-coords">
              <h4>Coordinates</h4>
              <span>{notam.latitude.toFixed(4)}, {notam.longitude.toFixed(4)}</span>
            </div>
          )}

          {notam.reason && (
            <div className="notam-reason">
              <h4>Reason</h4>
              <span>{notam.reason}</span>
            </div>
          )}

          {notam.keywords && notam.keywords.length > 0 && (
            <div className="notam-keywords">
              <h4>Keywords</h4>
              <div className="keyword-tags">
                {notam.keywords.map((kw, i) => (
                  <span key={i} className="keyword-tag">{kw}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// TFR Summary Card
function TfrCard({ tfr, onViewDetails }) {
  return (
    <div className="tfr-card" onClick={onViewDetails}>
      <div className="tfr-header">
        <Shield size={18} className="tfr-icon" />
        <div className="tfr-info">
          <span className="tfr-location">{tfr.location}</span>
          <span className="tfr-id">{tfr.notam_id}</span>
        </div>
      </div>
      <div className="tfr-details">
        {tfr.reason && <p className="tfr-reason">{tfr.reason}</p>}
        <div className="tfr-altitude">
          {tfr.floor_ft != null && <span>SFC - {tfr.floor_ft}ft</span>}
          {tfr.ceiling_ft != null && <span>to {tfr.ceiling_ft}ft</span>}
        </div>
        <div className="tfr-time">
          <Clock size={12} />
          <span>{formatDate(tfr.effective_start)}</span>
          {tfr.effective_end && (
            <>
              <span>→</span>
              <span>{formatDate(tfr.effective_end)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Stats Summary
function NotamStats({ stats }) {
  if (!stats) return null;

  return (
    <div className="notam-stats">
      <div className="stat-item">
        <span className="stat-value">{stats.total_active || 0}</span>
        <span className="stat-label">Active NOTAMs</span>
      </div>
      <div className="stat-item tfr">
        <span className="stat-value">{stats.tfr_count || 0}</span>
        <span className="stat-label">Active TFRs</span>
      </div>
      {stats.by_type && Object.entries(stats.by_type).map(([type, count]) => (
        <div key={type} className="stat-item mini">
          <span className="stat-value">{count}</span>
          <span className="stat-label">{NOTAM_TYPES[type]?.label || type}</span>
        </div>
      ))}
      {stats.last_update && (
        <div className="stat-item update-time">
          <RefreshCw size={12} />
          <span>Updated {formatRelativeTime(stats.last_update)}</span>
        </div>
      )}
    </div>
  );
}

// Airport Search component
function AirportSearch({ onSearch, loading }) {
  const [icao, setIcao] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (icao.trim()) {
      onSearch(icao.trim().toUpperCase());
    }
  };

  return (
    <form className="airport-search" onSubmit={handleSubmit}>
      <div className="search-input-wrapper">
        <Plane size={16} />
        <input
          type="text"
          value={icao}
          onChange={(e) => setIcao(e.target.value.toUpperCase())}
          placeholder="Search by airport (e.g., KJFK)"
          maxLength={4}
        />
      </div>
      <button type="submit" disabled={loading || !icao.trim()}>
        {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
        <span>Search</span>
      </button>
    </form>
  );
}

// Main NotamsView component
export function NotamsView({ apiBase }) {
  const [notams, setNotams] = useState([]);
  const [tfrs, setTfrs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'tfrs', 'airport'
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [airportNotams, setAirportNotams] = useState(null);
  const [airportLoading, setAirportLoading] = useState(false);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [httpFallbackAttempted, setHttpFallbackAttempted] = useState(false);

  // Request ID counter for WebSocket requests
  const requestIdRef = React.useRef(0);
  const pendingRequestsRef = React.useRef(new Map());

  // HTTP fallback to fetch NOTAMs if WebSocket doesn't provide data
  const fetchNotamsHttp = useCallback(async () => {
    if (httpFallbackAttempted) return;
    setHttpFallbackAttempted(true);

    const base = (apiBase || '').replace(/\/$/, '');
    try {
      // Fetch NOTAMs, TFRs, and stats in parallel
      const [notamsRes, tfrsRes, statsRes] = await Promise.all([
        fetch(`${base}/api/v1/notams/?active_only=true&limit=100`),
        fetch(`${base}/api/v1/notams/tfrs/?active_only=true`),
        fetch(`${base}/api/v1/notams/stats/`),
      ]);

      const notamsData = notamsRes.ok ? await notamsRes.json() : null;
      const tfrsData = tfrsRes.ok ? await tfrsRes.json() : null;
      const statsData = statsRes.ok ? await statsRes.json() : null;

      if (notamsData?.notams) {
        // Map API response to expected format
        const mappedNotams = notamsData.notams.map(n => ({
          ...n,
          type: n.notam_type,
        }));
        setNotams(mappedNotams);
      }

      if (tfrsData?.tfrs) {
        const mappedTfrs = tfrsData.tfrs.map(t => ({
          ...t,
          type: 'TFR',
        }));
        setTfrs(mappedTfrs);
      }

      if (statsData) {
        setStats({
          total_active: statsData.active_notams || 0,
          tfr_count: statsData.active_tfrs || 0,
          by_type: statsData.by_type || {},
          last_update: statsData.last_refresh,
        });
      }

      setLoading(false);
      setError(null);
    } catch (err) {
      console.error('HTTP fallback failed:', err);
      setError('Failed to load NOTAMs');
      setLoading(false);
    }
  }, [apiBase, httpFallbackAttempted]);

  // WebSocket message handler
  const handleMessage = useCallback((data) => {
    switch (data.type) {
      case 'notams:snapshot':
        setNotams(data.data?.notams || []);
        setTfrs(data.data?.tfrs || []);
        setStats(data.data?.stats || null);
        setLoading(false);
        setError(null);
        break;

      case 'notams:new':
        setNotams(prev => [data.data, ...prev]);
        if (data.data?.type === 'TFR') {
          setTfrs(prev => [data.data, ...prev]);
        }
        break;

      case 'notams:update':
        setNotams(prev => prev.map(n =>
          n.notam_id === data.data?.notam_id ? { ...n, ...data.data } : n
        ));
        if (data.data?.type === 'TFR') {
          setTfrs(prev => prev.map(t =>
            t.notam_id === data.data?.notam_id ? { ...t, ...data.data } : t
          ));
        }
        break;

      case 'notams:expired':
      case 'notams:tfr_expired':
        setNotams(prev => prev.filter(n => n.notam_id !== data.data?.notam_id));
        setTfrs(prev => prev.filter(t => t.notam_id !== data.data?.notam_id));
        break;

      case 'notams:tfr_new':
        setTfrs(prev => [data.data, ...prev]);
        setNotams(prev => [data.data, ...prev]);
        break;

      case 'notams:stats':
        setStats(data.data);
        break;

      case 'response':
        // Handle response to a request
        const resolver = pendingRequestsRef.current.get(data.request_id);
        if (resolver) {
          resolver.resolve(data.data);
          pendingRequestsRef.current.delete(data.request_id);
        }
        break;

      case 'error':
        if (data.request_id) {
          const resolver = pendingRequestsRef.current.get(data.request_id);
          if (resolver) {
            resolver.reject(new Error(data.message));
            pendingRequestsRef.current.delete(data.request_id);
          }
        } else {
          setError(data.message);
        }
        break;

      default:
        break;
    }
  }, []);

  // WebSocket connection
  const { connected, send, reconnect } = useNativeWebSocket({
    enabled: true,
    apiBase,
    path: 'notams',
    onMessage: handleMessage,
    onConnect: () => {
      setLoading(true);
      setError(null);
    },
    onDisconnect: () => {
      // If we have no data, try HTTP fallback
      if (notams.length === 0 && !httpFallbackAttempted) {
        fetchNotamsHttp();
      }
    },
    onError: (err) => {
      setError(err.message || 'Connection error');
      // Try HTTP fallback on WebSocket error
      if (!httpFallbackAttempted) {
        fetchNotamsHttp();
      }
    },
  });

  // If WebSocket connected but no data after 5 seconds, try HTTP fallback
  useEffect(() => {
    if (connected && loading && notams.length === 0) {
      const timeout = setTimeout(() => {
        if (notams.length === 0 && !httpFallbackAttempted) {
          console.log('WebSocket connected but no NOTAMs received, trying HTTP fallback');
          fetchNotamsHttp();
        }
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [connected, loading, notams.length, httpFallbackAttempted, fetchNotamsHttp]);

  // Make a request and wait for response
  const request = useCallback(async (type, params = {}) => {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++requestIdRef.current}`;
      pendingRequestsRef.current.set(requestId, { resolve, reject });

      // Set timeout for request
      setTimeout(() => {
        if (pendingRequestsRef.current.has(requestId)) {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 30000);

      send({
        action: 'request',
        type,
        request_id: requestId,
        params,
      });
    });
  }, [send]);

  // Search for airport NOTAMs
  const handleAirportSearch = useCallback(async (icao) => {
    setAirportLoading(true);
    setSelectedAirport(icao);

    const base = (apiBase || '').replace(/\/$/, '');

    try {
      // Try WebSocket first, fall back to HTTP
      let data = null;
      if (connected) {
        try {
          data = await request('airport', { icao });
        } catch (wsErr) {
          console.debug('WebSocket airport request failed, trying HTTP');
        }
      }

      // HTTP fallback
      if (!data) {
        const res = await fetch(`${base}/api/v1/notams/airport/${icao.toUpperCase()}/`);
        if (res.ok) {
          const json = await res.json();
          data = (json.notams || []).map(n => ({ ...n, type: n.notam_type }));
        }
      }

      setAirportNotams(data || []);
      setActiveTab('airport');
    } catch (err) {
      setError(`Failed to load NOTAMs for ${icao}: ${err.message}`);
    } finally {
      setAirportLoading(false);
    }
  }, [apiBase, connected, request]);

  // Refresh NOTAMs
  const handleRefresh = useCallback(async () => {
    const base = (apiBase || '').replace(/\/$/, '');

    try {
      // Try WebSocket first
      if (connected) {
        try {
          await request('refresh');
        } catch (wsErr) {
          console.debug('WebSocket refresh failed, trying HTTP');
        }
      }

      // Also trigger HTTP refresh
      await fetch(`${base}/api/v1/notams/refresh/`, { method: 'POST' });

      // Reset fallback flag and refetch
      setHttpFallbackAttempted(false);
      setTimeout(() => fetchNotamsHttp(), 2000); // Wait for refresh to complete
    } catch (err) {
      console.error('Refresh failed:', err);
    }
  }, [apiBase, connected, request, fetchNotamsHttp]);

  // Filter notams based on search and type
  const filteredNotams = useMemo(() => {
    let list = activeTab === 'tfrs' ? tfrs : notams;

    if (typeFilter !== 'all') {
      list = list.filter(n => n.type === typeFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      list = list.filter(n =>
        n.location?.toLowerCase().includes(query) ||
        n.notam_id?.toLowerCase().includes(query) ||
        n.text?.toLowerCase().includes(query) ||
        n.reason?.toLowerCase().includes(query)
      );
    }

    return list;
  }, [activeTab, notams, tfrs, typeFilter, searchQuery]);

  // Display content based on active tab
  const displayList = activeTab === 'airport' ? (airportNotams || []) : filteredNotams;

  return (
    <div className="notams-view">
      <div className="notams-header">
        <div className="header-title">
          <FileWarning size={24} />
          <h2>NOTAMs & TFRs</h2>
          <div className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? 'Live' : 'Offline'}
          </div>
        </div>

        <div className="header-actions">
          <button
            className="refresh-btn"
            onClick={handleRefresh}
            disabled={!connected}
            title="Refresh NOTAMs"
          >
            <RefreshCw size={16} />
          </button>
          {!connected && (
            <button className="reconnect-btn" onClick={reconnect}>
              Reconnect
            </button>
          )}
        </div>
      </div>

      <NotamStats stats={stats} />

      <div className="notams-toolbar">
        <div className="tab-buttons">
          <button
            className={activeTab === 'all' ? 'active' : ''}
            onClick={() => setActiveTab('all')}
          >
            <FileWarning size={16} />
            All NOTAMs
            <span className="count">{notams.length}</span>
          </button>
          <button
            className={activeTab === 'tfrs' ? 'active' : ''}
            onClick={() => setActiveTab('tfrs')}
          >
            <Shield size={16} />
            TFRs
            <span className="count">{tfrs.length}</span>
          </button>
          {selectedAirport && (
            <button
              className={activeTab === 'airport' ? 'active' : ''}
              onClick={() => setActiveTab('airport')}
            >
              <Plane size={16} />
              {selectedAirport}
              <span className="count">{airportNotams?.length || 0}</span>
              <X
                size={14}
                className="close-tab"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedAirport(null);
                  setAirportNotams(null);
                  if (activeTab === 'airport') setActiveTab('all');
                }}
              />
            </button>
          )}
        </div>

        <div className="filter-controls">
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search NOTAMs..."
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>

          {activeTab === 'all' && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="type-filter"
            >
              <option value="all">All Types</option>
              {Object.entries(NOTAM_TYPES).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <AirportSearch onSearch={handleAirportSearch} loading={airportLoading} />

      <div className="notams-content">
        {loading && !notams.length ? (
          <div className="loading-state">
            <Loader2 size={32} className="spin" />
            <p>Loading NOTAMs...</p>
          </div>
        ) : error && !notams.length ? (
          <div className="error-state">
            <AlertTriangle size={32} />
            <p>{error}</p>
            <button onClick={reconnect}>Retry Connection</button>
          </div>
        ) : displayList.length === 0 ? (
          <div className="empty-state">
            <FileWarning size={48} />
            <p>No NOTAMs found</p>
            {searchQuery && <span>Try adjusting your search criteria</span>}
          </div>
        ) : (
          <div className="notams-list">
            {activeTab === 'tfrs' ? (
              // TFR grid view
              <div className="tfr-grid">
                {displayList.map(tfr => (
                  <TfrCard
                    key={tfr.notam_id}
                    tfr={tfr}
                    onViewDetails={() => setExpandedId(expandedId === tfr.notam_id ? null : tfr.notam_id)}
                  />
                ))}
              </div>
            ) : (
              // Standard NOTAM list
              displayList.map(notam => (
                <NotamCard
                  key={notam.notam_id}
                  notam={notam}
                  expanded={expandedId === notam.notam_id}
                  onToggle={() => setExpandedId(expandedId === notam.notam_id ? null : notam.notam_id)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default NotamsView;
