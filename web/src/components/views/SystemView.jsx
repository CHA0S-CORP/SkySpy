import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity, Database, Zap, Bell, MapPin, RefreshCw, TestTube2, AlertTriangle, Wifi, WifiOff,
  HardDrive, CheckCircle, XCircle, ChevronDown, ChevronRight, Clock, Radio, Cpu,
  Thermometer, Copy, History, AlertCircle, Loader2
} from 'lucide-react';
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
  const [acarsStats, setAcarsStats] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [, setError] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [safetyTestResult, setSafetyTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  const [safetyTestLoading, setSafetyTestLoading] = useState(false);
  const [expandedService, setExpandedService] = useState(null);
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [systemEvents, setSystemEvents] = useState([]);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  // Socket options for useSocketApi
  const socketOpts = { wsRequest, wsConnected };
  // When socket is connected, use longer polling intervals since we fetch via socket primarily
  const pollInterval = wsConnected ? 30000 : 10000;

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
  const { data: httpAcarsStats } = useSocketApi('/api/v1/acars/stats?hours=1', pollInterval, apiBase, socketOpts);

  // Fetch all status data via WebSocket - using Django API events
  const fetchViaSocket = useCallback(async () => {
    if (!wsRequest || !wsConnected) return false;

    try {
      setLoading(true);
      setError(null);

      // Fetch all data in parallel via WebSocket
      // Django WebSocket events map to: system-status, system-health, system-info, system-databases
      const [statusData, healthData, infoData, dbData, safetyData, acarsData] = await Promise.all([
        wsRequest('system-status', {}).catch(() => null),
        wsRequest('system-health', {}).catch(() => null),
        wsRequest('system-info', {}).catch(() => null),
        wsRequest('system-databases', {}).catch(() => null),
        wsRequest('safety-status', {}).catch(() => null),
        wsRequest('acars-stats', { hours: 1 }).catch(() => null),
      ]);

      if (statusData && !statusData.error) setStatus(statusData);
      if (healthData && !healthData.error) setHealth(healthData);
      if (infoData && !infoData.error) setSystemInfo(infoData);
      if (dbData && !dbData.error) setDatabaseStats(dbData);
      if (safetyData && !safetyData.error) setSafetyStatus(safetyData);
      if (acarsData && !acarsData.error) setAcarsStats(acarsData);

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
    if (httpAcarsStats && !acarsStats) setAcarsStats(httpAcarsStats);
    if (httpStatus || httpHealth || httpHealthRoot || httpSafetyStatus) {
      setLoading(false);
    }
  }, [httpStatus, httpHealth, httpHealthRoot, httpSystemInfo, httpDatabaseStats, httpSafetyStatus, httpAcarsStats, status, health, systemInfo, databaseStats, wsStatus, safetyStatus, acarsStats]);

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

  // Track system events for timeline
  const addSystemEvent = useCallback((type, message, severity = 'info') => {
    const event = {
      id: Date.now(),
      type,
      message,
      severity,
      timestamp: new Date(),
    };
    setSystemEvents(prev => [event, ...prev].slice(0, 10));
  }, []);

  // Helper to check service status from Django health response
  const getServiceStatus = useCallback((serviceName) => {
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
  }, [health, status]);

  // Track service status changes for events timeline
  const prevStatusRef = useRef({});
  useEffect(() => {
    if (!status && !health) return;

    const currentServices = {
      adsb: getServiceStatus('adsb'),
      database: getServiceStatus('database'),
      redis: getServiceStatus('redis'),
      celery: getServiceStatus('celery'),
      websocket: status?.websocket?.active || wsStatus?.mode ? 'online' : 'offline',
    };

    Object.entries(currentServices).forEach(([service, currentStatus]) => {
      const prevStatus = prevStatusRef.current[service];
      if (prevStatus && prevStatus !== currentStatus) {
        const serviceName = service.charAt(0).toUpperCase() + service.slice(1);
        if (currentStatus === 'online') {
          addSystemEvent('service_up', `${serviceName} came online`, 'success');
        } else if (currentStatus === 'offline') {
          addSystemEvent('service_down', `${serviceName} went offline`, 'error');
        }
      }
    });

    prevStatusRef.current = currentServices;
  }, [status, health, wsStatus, addSystemEvent, getServiceStatus]);

  const handleTestNotification = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/notifications/test`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response');
      }
      const data = await res.json();
      setTestResult({ success: data.success, message: data.success ? 'Notification sent!' : 'Failed to send' });
      addSystemEvent('notification_test', data.success ? 'Test notification sent' : 'Test notification failed', data.success ? 'success' : 'error');
    } catch {
      setTestResult({ success: false, message: 'Error sending test' });
      addSystemEvent('notification_test', 'Test notification error', 'error');
    }
    setTestLoading(false);
    setTimeout(() => setTestResult(null), 4000);
  };

  const handleTestSafetyEvents = async () => {
    setSafetyTestLoading(true);
    setSafetyTestResult(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/safety/test`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response');
      }
      const data = await res.json();
      setSafetyTestResult({ success: data.success, message: data.success ? `Generated ${data.count} events` : 'Failed to generate' });
      addSystemEvent('safety_test', data.success ? `Generated ${data.count} test events` : 'Safety test failed', data.success ? 'success' : 'error');
    } catch {
      setSafetyTestResult({ success: false, message: 'Error generating events' });
      addSystemEvent('safety_test', 'Safety test error', 'error');
    }
    setSafetyTestLoading(false);
    setTimeout(() => setSafetyTestResult(null), 4000);
  };

  // Get service details (for expanded view)
  const getServiceDetails = useCallback((serviceName) => {
    const serviceHealth = health?.services?.[serviceName] || health?.components?.[serviceName] || {};
    return {
      lastCheck: serviceHealth.last_check || lastUpdate?.toISOString(),
      latency: serviceHealth.latency_ms || serviceHealth.response_time_ms,
      error: serviceHealth.error || serviceHealth.message,
      version: serviceHealth.version,
    };
  }, [health, lastUpdate]);

  // Get database stats from databaseStats or status
  const dbStats = databaseStats || status?.database || {};

  // Calculate overall health for banner
  const healthSummary = useMemo(() => {
    const services = [
      { name: 'ADS-B Receiver', status: getServiceStatus('adsb') },
      { name: 'Database', status: getServiceStatus('database') },
      { name: 'Redis', status: getServiceStatus('redis') },
      { name: 'WebSocket Server', status: status?.websocket?.active || wsStatus?.mode ? 'online' : (status === null ? 'warning' : 'offline') },
      { name: 'Celery Workers', status: getServiceStatus('celery') },
    ];

    const online = services.filter(s => s.status === 'online').length;
    const offline = services.filter(s => s.status === 'offline').length;
    const warning = services.filter(s => s.status === 'warning').length;
    const total = services.length;

    let overallStatus = 'healthy';
    let statusText = 'All Systems Operational';

    if (warning > 0 && offline === 0) {
      overallStatus = 'loading';
      statusText = 'Checking Services...';
    } else if (offline > 0 && offline < total) {
      overallStatus = 'degraded';
      statusText = `${offline} Service${offline > 1 ? 's' : ''} Degraded`;
    } else if (offline === total) {
      overallStatus = 'critical';
      statusText = 'System Offline';
    }

    return { services, online, offline, warning, total, overallStatus, statusText };
  }, [getServiceStatus, status, wsStatus]);

  // Copy coordinates to clipboard
  const handleCopyCoords = useCallback(() => {
    const lat = status?.location?.lat;
    const lon = status?.location?.lon;
    if (lat && lon) {
      navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
      setCopiedCoords(true);
      setTimeout(() => setCopiedCoords(false), 2000);
    }
  }, [status?.location?.lat, status?.location?.lon]);

  // Initialize mini-map for Feeder Location
  useEffect(() => {
    const lat = status?.location?.lat;
    const lon = status?.location?.lon;

    if (!mapContainerRef.current || !lat || !lon) return;

    // Clean up existing map
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    // Initialize map
    const map = L.map(mapContainerRef.current, {
      center: [lat, lon],
      zoom: 9,
      zoomControl: false,
      dragging: true,
      scrollWheelZoom: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);

    // Custom marker icon
    const markerIcon = L.divIcon({
      className: 'feeder-marker-icon',
      html: '<div class="feeder-marker-pulse"></div><div class="feeder-marker-dot"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    L.marker([lat, lon], { icon: markerIcon }).addTo(map);

    // Coverage circle (assuming ~250nm range)
    const rangeNm = status?.coverage_range_nm || 250;
    L.circle([lat, lon], {
      radius: rangeNm * 1852, // Convert nm to meters
      color: '#00ff88',
      fillColor: '#00ff88',
      fillOpacity: 0.05,
      weight: 1,
      dashArray: '4, 4',
    }).addTo(map);

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [status?.location?.lat, status?.location?.lon, status?.coverage_range_nm]);

  // Toggle service expansion
  const toggleServiceExpand = useCallback((serviceName) => {
    setExpandedService(prev => prev === serviceName ? null : serviceName);
  }, []);

  // Get system metrics from status
  const systemMetrics = useMemo(() => {
    const getStatusColor = (value, thresholds) => {
      if (value >= thresholds.critical) return 'critical';
      if (value >= thresholds.warning) return 'warning';
      return 'normal';
    };

    return [
      {
        icon: Cpu,
        label: 'CPU',
        value: status?.cpu_percent ?? systemInfo?.cpu_percent ?? '--',
        unit: '%',
        status: getStatusColor(status?.cpu_percent || systemInfo?.cpu_percent || 0, { warning: 70, critical: 90 }),
      },
      {
        icon: HardDrive,
        label: 'RAM',
        value: status?.memory_percent ?? systemInfo?.memory_percent ?? '--',
        unit: '%',
        status: getStatusColor(status?.memory_percent || systemInfo?.memory_percent || 0, { warning: 80, critical: 95 }),
      },
      {
        icon: Thermometer,
        label: 'SDR Temp',
        value: status?.sdr_temp ?? '--',
        unit: '°C',
        status: getStatusColor(status?.sdr_temp || 0, { warning: 55, critical: 70 }),
      },
      {
        icon: Wifi,
        label: 'Gain',
        value: status?.sdr_gain ?? '--',
        unit: 'dB',
        status: 'normal',
      },
    ];
  }, [status, systemInfo]);

  // Render service status item with expand capability
  const renderServiceItem = (name, displayName, statusValue, statusLabel, extraContent = null) => {
    const isExpanded = expandedService === name;
    const details = getServiceDetails(name);
    const isOnline = statusValue === 'online';

    return (
      <div key={name} className={`status-item expandable ${isExpanded ? 'expanded' : ''}`}>
        <div className="status-item-header" onClick={() => toggleServiceExpand(name)}>
          <span className="service-name">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {displayName}
          </span>
          <span className={`status-badge ${statusValue} ${isOnline ? 'pulse' : ''}`}>
            {isOnline ? <CheckCircle size={12} /> : statusValue === 'warning' ? <Clock size={12} /> : <XCircle size={12} />}
            {statusLabel}
          </span>
        </div>
        {isExpanded && (
          <div className="status-item-details">
            {details.lastCheck && (
              <div className="detail-row">
                <span className="detail-label">Last Check</span>
                <span className="detail-value">{new Date(details.lastCheck).toLocaleTimeString()}</span>
              </div>
            )}
            {details.latency && (
              <div className="detail-row">
                <span className="detail-label">Latency</span>
                <span className="detail-value">{details.latency}ms</span>
              </div>
            )}
            {details.error && (
              <div className="detail-row error">
                <span className="detail-label">Error</span>
                <span className="detail-value">{details.error}</span>
              </div>
            )}
            {details.version && (
              <div className="detail-row">
                <span className="detail-label">Version</span>
                <span className="detail-value">{details.version}</span>
              </div>
            )}
            {extraContent}
          </div>
        )}
      </div>
    );
  };

  // Get event icon
  const getEventIcon = (type) => {
    switch (type) {
      case 'service_up':
        return <CheckCircle size={14} className="event-icon success" />;
      case 'service_down':
        return <XCircle size={14} className="event-icon error" />;
      case 'notification_test':
        return <Bell size={14} className="event-icon info" />;
      case 'safety_test':
        return <AlertTriangle size={14} className="event-icon warning" />;
      default:
        return <AlertCircle size={14} className="event-icon info" />;
    }
  };

  return (
    <div className="system-container">
      {/* Health Summary Banner */}
      <div className={`health-summary-banner ${healthSummary.overallStatus}`}>
        <div className="health-indicator">
          {healthSummary.overallStatus === 'healthy' && <CheckCircle size={28} />}
          {healthSummary.overallStatus === 'degraded' && <AlertTriangle size={28} />}
          {healthSummary.overallStatus === 'critical' && <XCircle size={28} />}
          {healthSummary.overallStatus === 'loading' && <Loader2 size={28} className="spin" />}
        </div>
        <div className="health-text">
          <span className="health-title">{healthSummary.statusText}</span>
          <span className="health-detail">
            {healthSummary.overallStatus === 'loading'
              ? 'Connecting to services...'
              : `${healthSummary.online}/${healthSummary.total} services online`}
          </span>
        </div>
        <div className="health-services-quick">
          {healthSummary.services.map(s => (
            <div
              key={s.name}
              className={`health-service-dot ${s.status}`}
              title={`${s.name}: ${s.status}`}
            />
          ))}
        </div>
      </div>

      <div className="system-grid">
        {/* Services Card */}
        <div className="system-card">
          <div className="card-header"><Activity size={20} /><span>Services</span></div>
          <div className="status-list">
            <div className={`status-item expandable ${expandedService === 'client' ? 'expanded' : ''}`}>
              <div className="status-item-header" onClick={() => toggleServiceExpand('client')}>
                <span className="service-name">
                  {expandedService === 'client' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Client Connection
                </span>
                <span className={`status-badge ${wsConnected ? 'online pulse' : 'warning'}`}>
                  {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
                  {wsConnected ? 'WebSocket' : 'HTTP Polling'}
                </span>
              </div>
              {expandedService === 'client' && (
                <div className="status-item-details">
                  <div className="detail-row">
                    <span className="detail-label">Mode</span>
                    <span className="detail-value">{wsConnected ? 'Real-time WebSocket' : 'HTTP Polling'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Poll Interval</span>
                    <span className="detail-value">{pollInterval / 1000}s</span>
                  </div>
                </div>
              )}
            </div>

            {renderServiceItem(
              'adsb',
              'ADS-B Receiver',
              getServiceStatus('adsb'),
              status?.adsb_online || status?.adsb_status === 'online' ? 'Online' : status === null ? 'Loading...' : 'Offline'
            )}

            {renderServiceItem(
              'database',
              'Database',
              getServiceStatus('database'),
              getServiceStatus('database') === 'online' ? 'Connected' : health === null && status === null ? 'Loading...' : 'Error'
            )}

            {renderServiceItem(
              'redis',
              'Redis',
              getServiceStatus('redis'),
              getServiceStatus('redis') === 'online' ? 'Connected' : (health?.services?.redis?.status === 'not_configured' ? 'Not Configured' : 'Disabled')
            )}

            {renderServiceItem(
              'websocket',
              'WebSocket Server',
              status?.websocket?.active || wsStatus?.mode ? 'online' : status === null ? 'warning' : 'offline',
              status?.websocket?.mode || wsStatus?.mode
                ? ((status?.websocket?.mode || wsStatus?.mode) === 'redis' ? 'Redis Mode' : 'Memory Mode')
                : (status === null ? 'Loading...' : 'Unknown')
            )}

            {renderServiceItem(
              'celery',
              'Celery Workers',
              getServiceStatus('celery'),
              getServiceStatus('celery') === 'online' ? 'Running' : status === null ? 'Loading...' : 'Stopped'
            )}
          </div>
        </div>

        {/* System Metrics Card */}
        <div className="system-card">
          <div className="card-header"><Cpu size={20} /><span>System Health</span></div>
          <div className="system-metrics-grid">
            {systemMetrics.map((metric, i) => (
              <div key={i} className={`system-metric-item ${metric.status}`}>
                <metric.icon size={16} />
                <span className="metric-label">{metric.label}</span>
                <span className="metric-value">
                  {metric.value}{metric.value !== '--' ? metric.unit : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Database Stats Card */}
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

        {/* Real-time Card */}
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

        {/* Notifications Card */}
        <div className="system-card">
          <div className="card-header"><Bell size={20} /><span>Notifications</span></div>
          <div className="stats-list">
            <div className="stat-row">
              <span>Status</span>
              <span className={`status-badge ${notifConfig?.enabled ? 'online' : 'offline'}`}>
                {notifConfig?.enabled ? <CheckCircle size={12} /> : <XCircle size={12} />}
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
          <button
            className={`btn-secondary test-btn ${testLoading ? 'loading' : ''}`}
            onClick={handleTestNotification}
            disabled={testLoading}
          >
            {testLoading ? <Loader2 size={16} className="spin" /> : <TestTube2 size={16} />}
            {testLoading ? 'Sending...' : 'Test Notification'}
          </button>
          {testResult && (
            <div className={`test-result-toast ${testResult.success ? 'success' : 'error'}`}>
              {testResult.success ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {testResult.message}
            </div>
          )}
        </div>

        {/* Safety Monitor Card */}
        <div className="system-card">
          <div className="card-header"><AlertTriangle size={20} /><span>Safety Monitor</span></div>
          <div className="stats-list">
            <div className="stat-row">
              <span>Status</span>
              <span className={`status-badge ${safetyStatus?.enabled ? 'online' : 'offline'}`}>
                {safetyStatus?.enabled ? <CheckCircle size={12} /> : <XCircle size={12} />}
                {safetyStatus?.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="stat-row"><span>Tracked Aircraft</span><span className="mono">{safetyStatus?.tracked_aircraft || 0}</span></div>
          </div>
          <button
            className={`btn-secondary test-btn ${safetyTestLoading ? 'loading' : ''}`}
            onClick={handleTestSafetyEvents}
            disabled={safetyTestLoading}
          >
            {safetyTestLoading ? <Loader2 size={16} className="spin" /> : <TestTube2 size={16} />}
            {safetyTestLoading ? 'Generating...' : 'Test Safety Events'}
          </button>
          {safetyTestResult && (
            <div className={`test-result-toast ${safetyTestResult.success ? 'success' : 'error'}`}>
              {safetyTestResult.success ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {safetyTestResult.message}
            </div>
          )}
        </div>

        {/* ACARS Service Card */}
        <div className="system-card">
          <div className="card-header"><Radio size={20} /><span>ACARS Service</span></div>
          <div className="stats-list">
            <div className="stat-row">
              <span>Status</span>
              <span className={`status-badge ${acarsStats?.service_stats?.running ? 'online' : 'offline'}`}>
                {acarsStats?.service_stats?.running ? <CheckCircle size={12} /> : <XCircle size={12} />}
                {acarsStats?.service_stats?.running ? 'Running' : 'Stopped'}
              </span>
            </div>
            <div className="stat-row"><span>Last Hour</span><span className="mono">{acarsStats?.last_hour || 0}</span></div>
            <div className="stat-row"><span>Today</span><span className="mono">{acarsStats?.today || 0}</span></div>
            {acarsStats?.total && (
              <div className="stat-row"><span>Total</span><span className="mono">{acarsStats.total.toLocaleString()}</span></div>
            )}
          </div>
        </div>

        {/* Recent Events Timeline Card */}
        <div className="system-card">
          <div className="card-header"><History size={20} /><span>Recent Events</span></div>
          <div className="events-timeline">
            {systemEvents.length === 0 ? (
              <div className="events-empty">
                <Clock size={24} />
                <span>No recent events</span>
              </div>
            ) : (
              systemEvents.map(event => (
                <div key={event.id} className={`event-item ${event.severity}`}>
                  {getEventIcon(event.type)}
                  <span className="event-message">{event.message}</span>
                  <span className="event-time">{event.timestamp.toLocaleTimeString()}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Feeder Location Card with Mini-Map */}
        <div className="system-card wide feeder-location-card">
          <div className="card-header"><MapPin size={20} /><span>Feeder Location</span></div>
          <div className="feeder-location-content">
            <div className="feeder-mini-map-container">
              <div ref={mapContainerRef} className="feeder-mini-map" />
            </div>
            <div className="feeder-info">
              <div className="location-coords">
                <div className="coord">
                  <span className="coord-label">Latitude</span>
                  <span className="coord-value">{status?.location?.lat?.toFixed(6) || '--'}</span>
                </div>
                <div className="coord">
                  <span className="coord-label">Longitude</span>
                  <span className="coord-value">{status?.location?.lon?.toFixed(6) || '--'}</span>
                </div>
                <button
                  className={`copy-coords-btn ${copiedCoords ? 'copied' : ''}`}
                  onClick={handleCopyCoords}
                  disabled={!status?.location?.lat}
                  title="Copy coordinates"
                >
                  {copiedCoords ? <CheckCircle size={14} /> : <Copy size={14} />}
                  {copiedCoords ? 'Copied!' : 'Copy'}
                </button>
              </div>
              {status?.coverage_range_nm && (
                <div className="coverage-stats">
                  <div className="coverage-stat">
                    <span className="coverage-label">Coverage Radius</span>
                    <span className="coverage-value">{status.coverage_range_nm} nm</span>
                  </div>
                </div>
              )}
              {status?.elevation_ft && (
                <div className="coverage-stats">
                  <div className="coverage-stat">
                    <span className="coverage-label">Elevation</span>
                    <span className="coverage-value">{status.elevation_ft} ft</span>
                  </div>
                </div>
              )}
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
