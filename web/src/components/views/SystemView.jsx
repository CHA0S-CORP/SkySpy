import React, { useState } from 'react';
import { Activity, Database, Zap, Bell, MapPin, RefreshCw, TestTube2 } from 'lucide-react';
import { useApi } from '../../hooks';

export function SystemView({ apiBase }) {
  const { data: status, refetch: refetchStatus } = useApi('/api/v1/status', 10000, apiBase);
  const { data: health } = useApi('/api/v1/health', 10000, apiBase);
  const { data: wsStatus } = useApi('/api/v1/ws/status', 5000, apiBase);
  const { data: notifConfig } = useApi('/api/v1/notifications/config', null, apiBase);
  const [testResult, setTestResult] = useState(null);

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

  return (
    <div className="system-container">
      <div className="system-grid">
        <div className="system-card">
          <div className="card-header"><Activity size={20} /><span>Services</span></div>
          <div className="status-list">
            <div className="status-item">
              <span>ADS-B Receiver</span>
              <span className={`status-badge ${status?.adsb_online ? 'online' : 'offline'}`}>
                {status?.adsb_online ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="status-item">
              <span>Database</span>
              <span className={`status-badge ${health?.services?.database ? 'online' : 'offline'}`}>
                {health?.services?.database ? 'Connected' : 'Error'}
              </span>
            </div>
            <div className="status-item">
              <span>Redis</span>
              <span className={`status-badge ${health?.services?.redis || wsStatus?.redis_enabled ? 'online' : 'warning'}`}>
                {health?.services?.redis || wsStatus?.redis_enabled ? 'Connected' : 'Disabled'}
              </span>
            </div>
            <div className="status-item">
              <span>WebSocket</span>
              <span className={`status-badge ${wsStatus?.redis_enabled ? 'online' : 'warning'}`}>
                {wsStatus?.mode || 'Unknown'}
              </span>
            </div>
            <div className="status-item">
              <span>Scheduler</span>
              <span className={`status-badge ${status?.scheduler_running ? 'online' : 'offline'}`}>
                {status?.scheduler_running ? 'Running' : 'Stopped'}
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
        <button className="btn-icon" onClick={() => refetchStatus()}><RefreshCw size={16} /></button>
      </div>
    </div>
  );
}
