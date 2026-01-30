import React from 'react';
import { Cpu, HardDrive, Thermometer, Wifi, Shield, CheckCircle, Radio } from 'lucide-react';

/**
 * SystemStatusCard - Compact system health display
 */
export function SystemStatusCard({ systemData }) {
  const getStatusColor = (value, thresholds) => {
    if (value >= thresholds.critical) return 'critical';
    if (value >= thresholds.warning) return 'warning';
    return 'normal';
  };

  const metrics = [
    {
      icon: Cpu,
      label: 'CPU',
      value: systemData?.cpu_percent ?? '--',
      unit: '%',
      status: getStatusColor(systemData?.cpu_percent || 0, { warning: 70, critical: 90 })
    },
    {
      icon: HardDrive,
      label: 'RAM',
      value: systemData?.memory_percent ?? '--',
      unit: '%',
      status: getStatusColor(systemData?.memory_percent || 0, { warning: 80, critical: 95 })
    },
    {
      icon: Thermometer,
      label: 'SDR Temp',
      value: systemData?.sdr_temp ?? '--',
      unit: 'C',
      status: getStatusColor(systemData?.sdr_temp || 0, { warning: 55, critical: 70 })
    },
    {
      icon: Wifi,
      label: 'Gain',
      value: systemData?.sdr_gain ?? '--',
      unit: 'dB',
      status: 'normal'
    }
  ];

  return (
    <div className="system-status-card">
      <div className="system-status-header">
        <Cpu size={16} />
        <span>System Health</span>
      </div>
      <div className="system-metrics">
        {metrics.map((metric, i) => (
          <div key={i} className={`system-metric ${metric.status}`}>
            <metric.icon size={14} />
            <span className="system-metric-label">{metric.label}</span>
            <span className="system-metric-value">
              {metric.value}{metric.value !== '--' ? metric.unit : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * SafetyAlertsSummary - Compact safety events summary for right sidebar
 */
export function SafetyAlertsSummary({ safetyStats, timeRange }) {
  const hasEvents = safetyStats?.total_events > 0;
  const criticalCount = safetyStats?.events_by_severity?.critical || 0;
  const warningCount = safetyStats?.events_by_severity?.warning || 0;

  return (
    <div className={`safety-alerts-summary ${criticalCount > 0 ? 'has-critical' : ''}`}>
      <div className="safety-summary-header">
        <Shield size={16} />
        <span>Safety Events</span>
        <span className="safety-period">{timeRange}</span>
      </div>
      {!hasEvents ? (
        <div className="safety-all-clear">
          <CheckCircle size={18} />
          <span>No Events</span>
        </div>
      ) : (
        <div className="safety-counts">
          {criticalCount > 0 && (
            <div className="safety-count critical">
              <span className="count-value">{criticalCount}</span>
              <span className="count-label">Critical</span>
            </div>
          )}
          {warningCount > 0 && (
            <div className="safety-count warning">
              <span className="count-value">{warningCount}</span>
              <span className="count-label">Warning</span>
            </div>
          )}
          <div className="safety-count info">
            <span className="count-value">{safetyStats?.events_by_severity?.low || 0}</span>
            <span className="count-label">Info</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ConnectionStatusCard - WebSocket connection status display
 */
export function ConnectionStatusCard({ wsConnected }) {
  return (
    <div className="connection-status-card">
      <div className="connection-header">
        <Wifi size={16} />
        <span>Connection</span>
      </div>
      <div className={`connection-indicator ${wsConnected ? 'connected' : 'disconnected'}`}>
        <span className="connection-dot"></span>
        <span>{wsConnected ? 'WebSocket Active' : 'Polling Mode'}</span>
      </div>
    </div>
  );
}

/**
 * AcarsServiceCard - ACARS service status display
 */
export function AcarsServiceCard({ acarsStats }) {
  if (!acarsStats) return null;

  return (
    <div className="service-status-card">
      <div className="service-header">
        <Radio size={16} />
        <span>ACARS Service</span>
      </div>
      <div className={`service-indicator ${acarsStats.service_stats?.running ? 'running' : 'stopped'}`}>
        <span className="service-dot"></span>
        <span>{acarsStats.service_stats?.running ? 'Running' : 'Stopped'}</span>
      </div>
      <div className="service-stats">
        <div className="service-stat">
          <span className="service-stat-value">{acarsStats.last_hour || 0}</span>
          <span className="service-stat-label">Last Hour</span>
        </div>
      </div>
    </div>
  );
}

/**
 * SafetyMonitorCard - Safety monitor status display
 */
export function SafetyMonitorCard({ safetyStats }) {
  if (!safetyStats) return null;

  return (
    <div className="monitor-status-card">
      <div className="monitor-header">
        <Shield size={16} />
        <span>Safety Monitor</span>
      </div>
      <div className={`monitor-indicator ${safetyStats.monitoring_enabled ? 'active' : 'inactive'}`}>
        <span className="monitor-dot"></span>
        <span>{safetyStats.monitoring_enabled ? 'Active' : 'Inactive'}</span>
      </div>
      {safetyStats.monitor_state?.tracked_aircraft && (
        <div className="monitor-tracking">
          Tracking {safetyStats.monitor_state.tracked_aircraft} aircraft
        </div>
      )}
    </div>
  );
}
