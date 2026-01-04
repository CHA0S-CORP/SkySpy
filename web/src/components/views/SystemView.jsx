import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Database, Zap, Bell, MapPin, RefreshCw, TestTube2, AlertTriangle, Wifi, WifiOff } from 'lucide-react';
import { useSocketApi } from '../../hooks';

export function SystemView({ apiBase, wsRequest, wsConnected }) {
  // Local state for data - will be populated by WebSocket or HTTP fallback
  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [wsStatus, setWsStatus] = useState(null);
  const [notifConfig, setNotifConfig] = useState(null);
  const [safetyStatus, setSafetyStatus] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [safetyTestResult, setSafetyTestResult] = useState(null);

  // Socket options for useSocketApi
  const socketOpts = { wsRequest, wsConnected };
  // When socket is connected, use longer polling intervals since we fetch via socket primarily
  const pollInterval = wsConnected ? 30000 : 10000;
  const fastPollInterval = wsConnected ? 15000 : 5000;

  // HTTP fetchers with socket.io preference - used as fallback/supplement
  const { data: httpStatus, refetch: refetchHttpStatus } = useSocketApi('/api/v1/status', pollInterval, apiBase, socketOpts);
  const { data: httpHealth } = useSocketApi('/api/v1/health', pollInterval, apiBase, socketOpts);
  const { data: httpWsStatus } = useSocketApi('/api/v1/ws/status', fastPollInterval, apiBase, socketOpts);
  const { data: httpNotifConfig } = useSocketApi('/api/v1/notifications/config', null, apiBase, socketOpts);
  const { data: httpSafetyStatus } = useSocketApi('/api/v1/safety/monitor/status', pollInterval, apiBase, socketOpts);

  // Fetch all status data via WebSocket
  const fetchViaSocket = useCallback(async () => {
    if (!wsRequest || !wsConnected) return false;

    try {
      setLoading(true);
      setError(null);

      // Fetch all data in parallel via WebSocket
      const [statusData, healthData, wsStatusData, safetyData] = await Promise.all([
        wsRequest('status', {}).catch(() => null),
        wsRequest('health', {}).catch(() => null),
        wsRequest('ws-status', {}).catch(() => null),
        wsRequest('safety-status', {}).catch(() => null),
      ]);

      if (statusData && !statusData.error) setStatus(statusData);
      if (healthData && !healthData.error) setHealth(healthData);
      if (wsStatusData && !wsStatusData.error) setWsStatus(wsStatusData);
      if (safetyData && !safetyData.error) setSafetyStatus(safetyData);

      setLastUpdate(new Date());
      setLoading(false);
      return true;
    } catch (err) {
      console.error('SystemView WebSocket fetch error:', err);
      setError('WebSocket fetch failed');
      setLoading(false);
      return false;
    }
  }, [wsRequest, wsConnected]);

  // Use HTTP data as fallback/supplement (updates state if not already set or newer)
  useEffect(() => {
    if (httpStatus && !status) setStatus(httpStatus);
    if (httpHealth && !health) setHealth(httpHealth);
    if (httpWsStatus && !wsStatus) setWsStatus(httpWsStatus);
    if (httpSafetyStatus && !safetyStatus) setSafetyStatus(httpSafetyStatus);
    if (httpStatus || httpHealth || httpWsStatus || httpSafetyStatus) {
      setLoading(false);
    }
  }, [httpStatus, httpHealth, httpWsStatus, httpSafetyStatus, status, health, wsStatus, safetyStatus]);

  // Always use HTTP for notification config (not available via WebSocket)
  useEffect(() => {
    if (httpNotifConfig) setNotifConfig(httpNotifConfig);
  }, [httpNotifConfig]);

  // Initial fetch and periodic refresh via WebSocket
  useEffect(() => {
    if (!wsConnected || !wsRequest) return;

    // Initial fetch
    fetchViaSocket();

    // Refresh every 15 seconds via WebSocket (reduced from 5s)
    const interval = setInterval(fetchViaSocket, 15000);
    return () => clearInterval(interval);
  }, [wsConnected, wsRequest, fetchViaSocket]);

  // Manual refresh handler
  const handleRefresh = useCallback(() => {
    if (wsConnected && wsRequest) {
      fetchViaSocket();
    } else {
      refetchHttpStatus?.();
    }
  }, [wsConnected, wsRequest, fetchViaSocket, refetchHttpStatus]);

  const handleTestNotification = async () => {
    setTestResult('Sending...');
    try {
      const res = await fetch(`${apiBase}/api/v1/notifications/test`, { method: 'POST' });
      const data = await res.json();
      setTestResult(data.success ? 'Sent successfully!' : 'Failed to send');
    } catch {
      setTestResult('Error sending test');
    }
    setTimeout(() => setTestResult(null), 3000);
  };

  const handleTestSafetyEvents = async () => {
    setSafetyTestResult('Generating...');
    try {
      const res = await fetch(`${apiBase}/api/v1/safety/test`, { method: 'POST' });
      const data = await res.json();
      setSafetyTestResult(data.success ? `Generated ${data.count} events` : 'Failed to generate');
    } catch {
      setSafetyTestResult('Error generating events');
    }
    setTimeout(() => setSafetyTestResult(null), 3000);
  };

  return (
    <div className="system-container">
      <div className="system-grid">
        <div className="system-card">
          <div className="card-header"><Activity size={20} /><span>Services</span></div>
          <div className="status-list">
            <div className="status-item">
              <span>Client Connection</span>
              <span className={`status-badge ${wsConnected ? 'online' : 'warning'}`}>
                {wsConnected ? (
                  <><Wifi size={12} style={{ marginRight: 4 }} /> Socket.IO</>
                ) : (
                  <><WifiOff size={12} style={{ marginRight: 4 }} /> HTTP Polling</>
                )}
              </span>
            </div>
            <div className="status-item">
              <span>ADS-B Receiver</span>
              <span className={`status-badge ${status?.adsb_online ? 'online' : 'offline'}`}>
                {status?.adsb_online ? 'Online' : status === null ? 'Loading...' : 'Offline'}
              </span>
            </div>
            <div className="status-item">
              <span>Database</span>
              <span className={`status-badge ${health?.services?.database?.status === 'up' ? 'online' : health === null ? 'warning' : 'offline'}`}>
                {health?.services?.database?.status === 'up' ? 'Connected' : health === null ? 'Loading...' : 'Error'}
              </span>
            </div>
            <div className="status-item">
              <span>Redis</span>
              <span className={`status-badge ${health?.services?.redis?.status === 'up' || wsStatus?.redis_enabled ? 'online' : 'warning'}`}>
                {health?.services?.redis?.status === 'up' || wsStatus?.redis_enabled ? 'Connected' : (health?.services?.redis?.status === 'not_configured' ? 'Not Configured' : 'Disabled')}
              </span>
            </div>
            <div className="status-item">
              <span>WebSocket Server</span>
              <span className={`status-badge ${wsStatus?.mode ? 'online' : wsStatus === null ? 'warning' : 'offline'}`}>
                {wsStatus?.mode ? (wsStatus.mode === 'redis' ? 'Redis Mode' : 'Memory Mode') : (wsStatus === null ? 'Loading...' : 'Unknown')}
              </span>
            </div>
            <div className="status-item">
              <span>Scheduler</span>
              <span className={`status-badge ${status?.scheduler_running ? 'online' : status === null ? 'warning' : 'offline'}`}>
                {status?.scheduler_running ? 'Running' : status === null ? 'Loading...' : 'Stopped'}
              </span>
            </div>
          </div>
        </div>

        <div className="system-card">
          <div className="card-header"><Database size={20} /><span>Database Stats</span></div>
          <div className="stats-list">
            <div className="stat-row"><span>Total Sightings</span><span className="mono">{status?.total_sightings?.toLocaleString() || '--'}</span></div>
            <div className="stat-row"><span>Total Sessions</span><span className="mono">{status?.total_sessions?.toLocaleString() || '--'}</span></div>
            <div className="stat-row"><span>Active Rules</span><span className="mono">{status?.active_rules || 0}</span></div>
          </div>
        </div>

        <div className="system-card">
          <div className="card-header"><Zap size={20} /><span>Real-time</span></div>
          <div className="stats-list">
            <div className="stat-row"><span>WS Clients</span><span className="mono">{wsStatus?.subscribers || 0}</span></div>
            <div className="stat-row"><span>Tracked Aircraft</span><span className="mono">{wsStatus?.tracked_aircraft || 0}</span></div>
            <div className="stat-row"><span>Poll Interval</span><span className="mono">{status?.polling_interval_seconds || '--'}s</span></div>
            <div className="stat-row"><span>DB Store Interval</span><span className="mono">{status?.db_store_interval_seconds || '--'}s</span></div>
            {wsStatus?.redis_enabled && (
              <>
                <div className="stat-row"><span>Redis Pub/Sub</span><span className="mono">Active</span></div>
                <div className="stat-row"><span>Last Publish</span><span className="mono">{wsStatus?.last_publish ? new Date(wsStatus.last_publish).toLocaleTimeString() : '--'}</span></div>
              </>
            )}
          </div>
        </div>

        <div className="system-card">
          <div className="card-header"><Bell size={20} /><span>Notifications</span></div>
          <div className="stats-list">
            <div className="stat-row">
              <span>Status</span>
              <span className={`status-badge ${notifConfig?.enabled ? 'online' : 'offline'}`}>
                {notifConfig?.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="stat-row"><span>Servers</span><span className="mono">{notifConfig?.server_count || 0}</span></div>
            <div className="stat-row"><span>Cooldown</span><span className="mono">{notifConfig?.cooldown_seconds || 300}s</span></div>
            <div className="stat-row">
              <span>Browser</span>
              <span className={`status-badge ${typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'online' : 'warning'}`}>
                {typeof Notification !== 'undefined' ? (Notification.permission === 'granted' ? 'Enabled' : Notification.permission === 'denied' ? 'Blocked' : 'Not Set') : 'N/A'}
              </span>
            </div>
          </div>
          <button className="btn-secondary test-btn" onClick={handleTestNotification}>
            <TestTube2 size={16} /> Test Notification
          </button>
          {testResult && <div className="test-result">{testResult}</div>}
        </div>

        <div className="system-card">
          <div className="card-header"><AlertTriangle size={20} /><span>Safety Monitor</span></div>
          <div className="stats-list">
            <div className="stat-row">
              <span>Status</span>
              <span className={`status-badge ${safetyStatus?.enabled ? 'online' : 'offline'}`}>
                {safetyStatus?.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="stat-row"><span>Tracked Aircraft</span><span className="mono">{safetyStatus?.tracked_aircraft || 0}</span></div>
          </div>
          <button className="btn-secondary test-btn" onClick={handleTestSafetyEvents}>
            <TestTube2 size={16} /> Test Safety Events
          </button>
          {safetyTestResult && <div className="test-result">{safetyTestResult}</div>}
        </div>

        <div className="system-card wide">
          <div className="card-header"><MapPin size={20} /><span>Feeder Location</span></div>
          <div className="location-info">
            <div className="coord">
              <span className="coord-label">Latitude</span>
              <span className="coord-value">{status?.location?.lat?.toFixed(6) || '--'}</span>
            </div>
            <div className="coord">
              <span className="coord-label">Longitude</span>
              <span className="coord-value">{status?.location?.lon?.toFixed(6) || '--'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="system-footer">
        <span>API Version: {status?.version || '--'}</span>
        <span>Worker PID: {status?.worker_pid || '--'}</span>
        {lastUpdate && (
          <span className="last-update">
            Updated: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
        <span className={`connection-indicator ${wsConnected ? 'connected' : 'disconnected'}`}>
          {wsConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
        </span>
        <button
          className={`btn-icon ${loading ? 'loading' : ''}`}
          onClick={handleRefresh}
          disabled={loading}
          title={wsConnected ? 'Refresh via WebSocket' : 'Refresh via HTTP'}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>
    </div>
  );
}
