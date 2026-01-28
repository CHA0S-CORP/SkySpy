import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Database, Zap, Bell, MapPin, RefreshCw, TestTube2, AlertTriangle, Wifi, WifiOff, Server, HardDrive } from 'lucide-react';
import { useSocketApi } from '../../hooks';

/**
 * SystemView Component
 *
 * Django API endpoints for system:
 * - /api/v1/system/status - System status
 * - /api/v1/system/health - Health check
 * - /api/v1/system/info - System info
 * - /api/v1/system/databases - Database stats
 * - /health - Health endpoint (root level)
 * - /metrics - Prometheus metrics
 */
export function SystemView({ apiBase, wsRequest, wsConnected }) {
  // Local state for data - will be populated by WebSocket or HTTP fallback
  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [databaseStats, setDatabaseStats] = useState(null);
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

  // HTTP fetchers with WebSocket preference - using Django API endpoints
  // Django system endpoints:
  // - /api/v1/system/status - System status
  // - /api/v1/system/health - Health check
  // - /api/v1/system/info - System info
  // - /api/v1/system/databases - Database stats
  const { data: httpStatus, refetch: refetchHttpStatus } = useSocketApi('/api/v1/system/status', pollInterval, apiBase, socketOpts);
  const { data: httpHealth } = useSocketApi('/api/v1/system/health', pollInterval, apiBase, socketOpts);
  const { data: httpSystemInfo } = useSocketApi('/api/v1/system/info', pollInterval, apiBase, socketOpts);
  const { data: httpDatabaseStats } = useSocketApi('/api/v1/system/databases', pollInterval, apiBase, socketOpts);
  // Legacy fallback endpoints (try both old and new)
  const { data: httpHealthRoot } = useSocketApi('/health', pollInterval, apiBase, socketOpts);
  const { data: httpNotifConfig } = useSocketApi('/api/v1/notifications/config', null, apiBase, socketOpts);
  const { data: httpSafetyStatus } = useSocketApi('/api/v1/safety/monitor/status', pollInterval, apiBase, socketOpts);

  // Fetch all status data via WebSocket - using Django API events
  const fetchViaSocket = useCallback(async () => {
    if (!wsRequest || !wsConnected) return false;

    try {
      setLoading(true);
      setError(null);

      // Fetch all data in parallel via WebSocket
      // Django WebSocket events map to: system-status, system-health, system-info, system-databases
      const [statusData, healthData, infoData, dbData, safetyData] = await Promise.all([
        wsRequest('system-status', {}).catch(() => null),
        wsRequest('system-health', {}).catch(() => null),
        wsRequest('system-info', {}).catch(() => null),
        wsRequest('system-databases', {}).catch(() => null),
        wsRequest('safety-status', {}).catch(() => null),
      ]);

      if (statusData && !statusData.error) setStatus(statusData);
      if (healthData && !healthData.error) setHealth(healthData);
      if (infoData && !infoData.error) setSystemInfo(infoData);
      if (dbData && !dbData.error) setDatabaseStats(dbData);
      if (safetyData && !safetyData.error) setSafetyStatus(safetyData);

      // Derive wsStatus from status or health data if available
      if (statusData?.websocket || healthData?.websocket) {
        setWsStatus(statusData?.websocket || healthData?.websocket || {});
      }

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
    // Use Django health endpoint, fallback to root /health
    if ((httpHealth || httpHealthRoot) && !health) setHealth(httpHealth || httpHealthRoot);
    if (httpSystemInfo && !systemInfo) setSystemInfo(httpSystemInfo);
    if (httpDatabaseStats && !databaseStats) setDatabaseStats(httpDatabaseStats);
    // Derive wsStatus from status data if available
    if (httpStatus?.websocket && !wsStatus) setWsStatus(httpStatus.websocket);
    if (httpSafetyStatus && !safetyStatus) setSafetyStatus(httpSafetyStatus);
    if (httpStatus || httpHealth || httpHealthRoot || httpSafetyStatus) {
      setLoading(false);
    }
  }, [httpStatus, httpHealth, httpHealthRoot, httpSystemInfo, httpDatabaseStats, httpSafetyStatus, status, health, systemInfo, databaseStats, wsStatus, safetyStatus]);

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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response');
      }
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response');
      }
      const data = await res.json();
      setSafetyTestResult(data.success ? `Generated ${data.count} events` : 'Failed to generate');
    } catch {
      setSafetyTestResult('Error generating events');
    }
    setTimeout(() => setSafetyTestResult(null), 3000);
  };

  // Helper to check service status from Django health response
  const getServiceStatus = (serviceName) => {
    // Check health.services structure (Django format)
    if (health?.services?.[serviceName]?.status === 'up' || health?.services?.[serviceName]?.status === 'healthy') {
      return 'online';
    }
    // Check health.components structure (alternate format)
    if (health?.components?.[serviceName]?.status === 'up' || health?.components?.[serviceName]?.status === 'healthy') {
      return 'online';
    }
    // Check status object directly
    if (status?.[`${serviceName}_online`] || status?.[`${serviceName}_status`] === 'online') {
      return 'online';
    }
    // Loading state
    if (health === null && status === null) {
      return 'warning';
    }
    return 'offline';
  };

  // Get database stats from databaseStats or status
  const dbStats = databaseStats || status?.database || {};

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
                  <><Wifi size={12} style={{ marginRight: 4 }} /> WebSocket</>
                ) : (
                  <><WifiOff size={12} style={{ marginRight: 4 }} /> HTTP Polling</>
                )}
              </span>
            </div>
            <div className="status-item">
              <span>ADS-B Receiver</span>
              <span className={`status-badge ${getServiceStatus('adsb')}`}>
                {status?.adsb_online || status?.adsb_status === 'online' ? 'Online' : status === null ? 'Loading...' : 'Offline'}
              </span>
            </div>
            <div className="status-item">
              <span>Database</span>
              <span className={`status-badge ${getServiceStatus('database')}`}>
                {getServiceStatus('database') === 'online' ? 'Connected' : health === null && status === null ? 'Loading...' : 'Error'}
              </span>
            </div>
            <div className="status-item">
              <span>Redis</span>
              <span className={`status-badge ${getServiceStatus('redis')}`}>
                {getServiceStatus('redis') === 'online' ? 'Connected' : (health?.services?.redis?.status === 'not_configured' ? 'Not Configured' : 'Disabled')}
              </span>
            </div>
            <div className="status-item">
              <span>WebSocket Server</span>
              <span className={`status-badge ${status?.websocket?.active || wsStatus?.mode ? 'online' : status === null ? 'warning' : 'offline'}`}>
                {status?.websocket?.mode || wsStatus?.mode ? (
                  (status?.websocket?.mode || wsStatus?.mode) === 'redis' ? 'Redis Mode' : 'Memory Mode'
                ) : (status === null ? 'Loading...' : 'Unknown')}
              </span>
            </div>
            <div className="status-item">
              <span>Celery Workers</span>
              <span className={`status-badge ${getServiceStatus('celery')}`}>
                {getServiceStatus('celery') === 'online' ? 'Running' : status === null ? 'Loading...' : 'Stopped'}
              </span>
            </div>
          </div>
        </div>

        <div className="system-card">
          <div className="card-header"><Database size={20} /><span>Database Stats</span></div>
          <div className="stats-list">
            <div className="stat-row"><span>Total Sightings</span><span className="mono">{dbStats?.total_sightings?.toLocaleString() || status?.total_sightings?.toLocaleString() || '--'}</span></div>
            <div className="stat-row"><span>Total Sessions</span><span className="mono">{dbStats?.total_sessions?.toLocaleString() || status?.total_sessions?.toLocaleString() || '--'}</span></div>
            <div className="stat-row"><span>Active Rules</span><span className="mono">{dbStats?.active_rules || status?.active_rules || 0}</span></div>
            {dbStats?.table_counts && (
              <>
                <div className="stat-row"><span>Aircraft</span><span className="mono">{dbStats.table_counts?.aircraft?.toLocaleString() || '--'}</span></div>
                <div className="stat-row"><span>Alerts</span><span className="mono">{dbStats.table_counts?.alerts?.toLocaleString() || '--'}</span></div>
              </>
            )}
          </div>
        </div>

        <div className="system-card">
          <div className="card-header"><Zap size={20} /><span>Real-time</span></div>
          <div className="stats-list">
            <div className="stat-row"><span>WS Clients</span><span className="mono">{status?.websocket?.clients || wsStatus?.subscribers || 0}</span></div>
            <div className="stat-row"><span>Tracked Aircraft</span><span className="mono">{status?.websocket?.tracked_aircraft || wsStatus?.tracked_aircraft || 0}</span></div>
            <div className="stat-row"><span>Poll Interval</span><span className="mono">{status?.polling_interval_seconds || systemInfo?.poll_interval || '--'}s</span></div>
            <div className="stat-row"><span>DB Store Interval</span><span className="mono">{status?.db_store_interval_seconds || systemInfo?.db_store_interval || '--'}s</span></div>
            {(status?.websocket?.redis_enabled || wsStatus?.redis_enabled) && (
              <>
                <div className="stat-row"><span>Redis Pub/Sub</span><span className="mono">Active</span></div>
                <div className="stat-row"><span>Last Publish</span><span className="mono">{(status?.websocket?.last_publish || wsStatus?.last_publish) ? new Date(status?.websocket?.last_publish || wsStatus?.last_publish).toLocaleTimeString() : '--'}</span></div>
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
        <span>API Version: {status?.version || systemInfo?.version || '--'}</span>
        <span>Django: {systemInfo?.django_version || '--'}</span>
        <span>Python: {systemInfo?.python_version || '--'}</span>
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
