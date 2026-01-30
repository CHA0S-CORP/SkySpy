import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle, FileWarning, Search, RefreshCw, X,
  Plane, Shield, Loader2
} from 'lucide-react';
import { useSocketIO } from '../../hooks/socket';
import { NotamCard, TfrCard, NotamStats, AirportSearch, NOTAM_TYPES } from '../notams';

// Main NotamsView component
export function NotamsView({ apiBase }) {
  const [notams, setNotams] = useState([]);
  const [tfrs, setTfrs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [airportNotams, setAirportNotams] = useState(null);
  const [airportLoading, setAirportLoading] = useState(false);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [httpFallbackAttempted, setHttpFallbackAttempted] = useState(false);

  const requestIdRef = React.useRef(0);
  const pendingRequestsRef = React.useRef(new Map());

  // HTTP fallback to fetch NOTAMs if WebSocket doesn't provide data
  const fetchNotamsHttp = useCallback(async () => {
    if (httpFallbackAttempted) return;
    setHttpFallbackAttempted(true);

    const base = (apiBase || '').replace(/\/$/, '');
    try {
      const [notamsRes, tfrsRes, statsRes] = await Promise.all([
        fetch(`${base}/api/v1/notams/?active_only=true&limit=100`),
        fetch(`${base}/api/v1/notams/tfrs/?active_only=true`),
        fetch(`${base}/api/v1/notams/stats/`),
      ]);

      const notamsData = notamsRes.ok ? await notamsRes.json() : null;
      const tfrsData = tfrsRes.ok ? await tfrsRes.json() : null;
      const statsData = statsRes.ok ? await statsRes.json() : null;

      if (notamsData?.notams) {
        const mappedNotams = notamsData.notams.map(n => ({ ...n, type: n.notam_type }));
        setNotams(mappedNotams);
      }

      if (tfrsData?.tfrs) {
        const mappedTfrs = tfrsData.tfrs.map(t => ({ ...t, type: 'TFR' }));
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
        if (data.data?.type === 'TFR') setTfrs(prev => [data.data, ...prev]);
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

  // Socket.IO connection using main namespace with notams topic subscription
  // Note: Backend handles notams via main namespace '/' topics, not a separate namespace
  const { connected, emit, reconnect, on } = useSocketIO({
    enabled: true,
    apiBase,
    namespace: '/',
    path: '/socket.io',
    onConnect: () => {
      setLoading(true);
      setError(null);
      // Subscribe to notams topic on the main namespace
      emit('subscribe', { topics: ['notams'] });
    },
    onDisconnect: () => {
      if (notams.length === 0 && !httpFallbackAttempted) fetchNotamsHttp();
    },
    onError: (err) => {
      setError(err.message || 'Connection error');
      if (!httpFallbackAttempted) fetchNotamsHttp();
    },
  });

  // Set up message event listeners
  useEffect(() => {
    if (!connected) return;

    const eventTypes = [
      'notams:snapshot',
      'notams:new',
      'notams:update',
      'notams:expired',
      'notams:tfr_expired',
      'notams:tfr_new',
      'notams:stats',
      'response',
      'error',
    ];

    const unsubscribers = eventTypes.map(eventType => {
      return on(eventType, (data) => {
        handleMessage({ type: eventType, data });
      });
    });

    return () => {
      unsubscribers.forEach(unsub => unsub && unsub());
    };
  }, [connected, on, handleMessage]);

  // Send helper that wraps emit for compatibility
  const send = useCallback((data) => {
    if (data.action === 'request') {
      emit('request', { type: data.type, request_id: data.request_id, params: data.params });
    } else {
      emit(data.action || 'message', data);
    }
  }, [emit]);

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

      setTimeout(() => {
        if (pendingRequestsRef.current.has(requestId)) {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 30000);

      send({ action: 'request', type, request_id: requestId, params });
    });
  }, [send]);

  // Search for airport NOTAMs
  const handleAirportSearch = useCallback(async (icao) => {
    setAirportLoading(true);
    setSelectedAirport(icao);
    const base = (apiBase || '').replace(/\/$/, '');

    try {
      let data = null;
      if (connected) {
        try {
          data = await request('airport', { icao });
        } catch (wsErr) {
          console.debug('WebSocket airport request failed, trying HTTP');
        }
      }

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
      if (connected) {
        try { await request('refresh'); } catch (wsErr) {
          console.debug('WebSocket refresh failed, trying HTTP');
        }
      }
      await fetch(`${base}/api/v1/notams/refresh/`, { method: 'POST' });
      setHttpFallbackAttempted(false);
      setTimeout(() => fetchNotamsHttp(), 2000);
    } catch (err) {
      console.error('Refresh failed:', err);
    }
  }, [apiBase, connected, request, fetchNotamsHttp]);

  // Filter notams based on search and type
  const filteredNotams = useMemo(() => {
    let list = activeTab === 'tfrs' ? tfrs : notams;
    if (typeFilter !== 'all') list = list.filter(n => n.type === typeFilter);
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
          <button className="refresh-btn" onClick={handleRefresh} disabled={!connected} title="Refresh NOTAMs">
            <RefreshCw size={16} />
          </button>
          {!connected && <button className="reconnect-btn" onClick={reconnect}>Reconnect</button>}
        </div>
      </div>

      <NotamStats stats={stats} />

      <div className="notams-toolbar">
        <div className="tab-buttons">
          <button className={activeTab === 'all' ? 'active' : ''} onClick={() => setActiveTab('all')}>
            <FileWarning size={16} /> All NOTAMs <span className="count">{notams.length}</span>
          </button>
          <button className={activeTab === 'tfrs' ? 'active' : ''} onClick={() => setActiveTab('tfrs')}>
            <Shield size={16} /> TFRs <span className="count">{tfrs.length}</span>
          </button>
          {selectedAirport && (
            <button className={activeTab === 'airport' ? 'active' : ''} onClick={() => setActiveTab('airport')}>
              <Plane size={16} /> {selectedAirport}
              <span className="count">{airportNotams?.length || 0}</span>
              <X size={14} className="close-tab" onClick={(e) => {
                e.stopPropagation();
                setSelectedAirport(null);
                setAirportNotams(null);
                if (activeTab === 'airport') setActiveTab('all');
              }} />
            </button>
          )}
        </div>
        <div className="filter-controls">
          <div className="search-box">
            <Search size={16} />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search NOTAMs..." />
            {searchQuery && <button className="clear-search" onClick={() => setSearchQuery('')}><X size={14} /></button>}
          </div>
          {activeTab === 'all' && (
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="type-filter">
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
