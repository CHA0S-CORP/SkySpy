/**
 * HistoryPanel - Enhanced encounter history with timeline
 *
 * Features:
 * - Visual timeline of encounters
 * - Session statistics
 * - Encounter details
 * - Export functionality
 * - Heatmap visualization (simplified)
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  X, Trash2, Download, Share2, Clock, MapPin,
  Shield, Navigation2, AlertTriangle, ChevronRight,
  BarChart2, Map as MapIcon
} from 'lucide-react';
import { formatETA } from '../../utils/threatPrediction';

const THREAT_COLORS = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#22c55e',
};

function StatCard({ value, label, icon: Icon, color }) {
  return (
    <div className="stat-card" style={{ '--stat-color': color }}>
      {Icon && <Icon size={16} />}
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function TimelineEntry({ entry, onSelect }) {
  const time = new Date(entry.first_seen || entry.timestamp);
  const color = THREAT_COLORS[entry.threat_level] || THREAT_COLORS.info;

  return (
    <button
      className={`timeline-entry threat-${entry.threat_level}`}
      onClick={() => onSelect?.(entry)}
      style={{ '--entry-color': color }}
    >
      <div className="entry-time">
        <span className="time-value">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className="entry-marker" />
      <div className="entry-content">
        <div className="entry-header">
          <span className="entry-category">{entry.category || 'Aircraft'}</span>
          {entry.callsign && <span className="entry-callsign">{entry.callsign}</span>}
        </div>
        <div className="entry-details">
          <span className="detail">
            <Navigation2 size={12} />
            {entry.closest_distance?.toFixed(1) || entry.distance_nm?.toFixed(1)} nm closest
          </span>
          {entry.duration && (
            <span className="detail">
              <Clock size={12} />
              {Math.round(entry.duration / 60)} min
            </span>
          )}
          {entry.is_law_enforcement && (
            <span className="detail le-badge">
              <Shield size={12} />
              LE
            </span>
          )}
        </div>
      </div>
      <ChevronRight size={16} className="entry-arrow" />
    </button>
  );
}

function SessionStats({ stats, sessionStart }) {
  const duration = sessionStart
    ? Math.round((Date.now() - new Date(sessionStart).getTime()) / 60000)
    : 0;

  return (
    <div className="session-stats">
      <StatCard
        value={stats.totalEncounters || 0}
        label="Encounters"
        icon={AlertTriangle}
        color="#3b82f6"
      />
      <StatCard
        value={stats.lawEnforcementCount || 0}
        label="Law Enf."
        icon={Shield}
        color="#ef4444"
      />
      <StatCard
        value={stats.helicopterCount || 0}
        label="Helicopters"
        icon={Navigation2}
        color="#f59e0b"
      />
      <StatCard
        value={stats.closestApproach?.distance?.toFixed(1) || '--'}
        label="Closest (nm)"
        icon={MapPin}
        color="#22c55e"
      />
      <StatCard
        value={duration}
        label="Duration (min)"
        icon={Clock}
        color="#8b5cf6"
      />
    </div>
  );
}

function HourlyChart({ history }) {
  // Group encounters by hour
  const hourlyData = useMemo(() => {
    const hours = Array(24).fill(0);
    history.forEach(entry => {
      const hour = new Date(entry.first_seen || entry.timestamp).getHours();
      hours[hour]++;
    });
    return hours;
  }, [history]);

  const maxCount = Math.max(...hourlyData, 1);

  return (
    <div className="hourly-chart">
      <div className="chart-header">
        <BarChart2 size={14} />
        <span>Encounters by Hour</span>
      </div>
      <div className="chart-bars">
        {hourlyData.map((count, hour) => (
          <div key={hour} className="chart-bar-container">
            <div
              className="chart-bar"
              style={{ height: `${(count / maxCount) * 100}%` }}
              title={`${hour}:00 - ${count} encounters`}
            />
            {hour % 6 === 0 && (
              <span className="hour-label">{hour}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EncounterDetail({ entry, onClose }) {
  if (!entry) return null;

  const time = new Date(entry.first_seen || entry.timestamp);

  return (
    <div className="encounter-detail">
      <div className="detail-header">
        <h4>{entry.category || 'Aircraft'}</h4>
        <button className="close-btn" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="detail-content">
        {entry.callsign && (
          <div className="detail-row">
            <span className="label">Callsign</span>
            <span className="value">{entry.callsign}</span>
          </div>
        )}
        {entry.hex && (
          <div className="detail-row">
            <span className="label">ICAO</span>
            <span className="value mono">{entry.hex}</span>
          </div>
        )}
        <div className="detail-row">
          <span className="label">First Seen</span>
          <span className="value">{time.toLocaleString()}</span>
        </div>
        <div className="detail-row">
          <span className="label">Closest Approach</span>
          <span className="value">{entry.closest_distance?.toFixed(2) || entry.distance_nm?.toFixed(2)} nm</span>
        </div>
        {entry.altitude && (
          <div className="detail-row">
            <span className="label">Altitude</span>
            <span className="value">{entry.altitude.toLocaleString()} ft</span>
          </div>
        )}
        {entry.lat && entry.lon && (
          <div className="detail-row">
            <span className="label">Position</span>
            <span className="value mono">{entry.lat.toFixed(4)}, {entry.lon.toFixed(4)}</span>
          </div>
        )}
        <div className="detail-row">
          <span className="label">Threat Level</span>
          <span className={`value threat-badge threat-${entry.threat_level}`}>
            {entry.threat_level?.toUpperCase()}
          </span>
        </div>
      </div>

      {entry.lat && entry.lon && (
        <div className="detail-actions">
          <button
            className="action-btn"
            onClick={() => {
              const url = `https://maps.google.com/maps?q=${entry.lat},${entry.lon}`;
              window.open(url, '_blank');
            }}
          >
            <MapIcon size={16} />
            Open in Maps
          </button>
        </div>
      )}
    </div>
  );
}

export function HistoryPanel({
  history = [],
  stats = {},
  sessionStart,
  sessionName,
  onClear,
  onClose,
  onExport,
  onShare,
}) {
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [view, setView] = useState('timeline'); // timeline, chart

  // Export history to JSON
  const handleExport = useCallback(() => {
    if (onExport) {
      onExport();
      return;
    }

    const data = {
      session: {
        name: sessionName || 'Cannonball Session',
        start: sessionStart,
        end: new Date().toISOString(),
      },
      stats,
      encounters: history,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cannonball-session-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [history, stats, sessionName, sessionStart, onExport]);

  // Share via Web Share API
  const handleShare = useCallback(async () => {
    if (onShare) {
      onShare();
      return;
    }

    const text = `Cannonball Session Summary:
- ${stats.totalEncounters || 0} encounters
- ${stats.lawEnforcementCount || 0} law enforcement
- ${stats.helicopterCount || 0} helicopters
- Closest: ${stats.closestApproach?.distance?.toFixed(1) || '--'} nm`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Cannonball Session', text });
      } catch (err) {
        console.warn('Share failed:', err);
      }
    } else {
      navigator.clipboard.writeText(text);
    }
  }, [stats, onShare]);

  return (
    <div className="history-panel enhanced">
      <div className="history-header">
        <h3>Encounter History</h3>
        <div className="header-actions">
          <button className="icon-btn" onClick={handleExport} title="Export">
            <Download size={18} />
          </button>
          <button className="icon-btn" onClick={handleShare} title="Share">
            <Share2 size={18} />
          </button>
          <button className="icon-btn danger" onClick={onClear} title="Clear">
            <Trash2 size={18} />
          </button>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Session Stats */}
      <SessionStats stats={stats} sessionStart={sessionStart} />

      {/* View Toggle */}
      <div className="view-toggle">
        <button
          className={view === 'timeline' ? 'active' : ''}
          onClick={() => setView('timeline')}
        >
          <Clock size={14} />
          Timeline
        </button>
        <button
          className={view === 'chart' ? 'active' : ''}
          onClick={() => setView('chart')}
        >
          <BarChart2 size={14} />
          Charts
        </button>
      </div>

      {/* Content */}
      <div className="history-content">
        {view === 'timeline' ? (
          <div className="timeline">
            {history.length === 0 ? (
              <div className="empty-state">
                <AlertTriangle size={32} />
                <p>No encounters recorded</p>
              </div>
            ) : (
              history.map((entry, index) => (
                <TimelineEntry
                  key={entry.id || index}
                  entry={entry}
                  onSelect={setSelectedEntry}
                />
              ))
            )}
          </div>
        ) : (
          <div className="charts">
            <HourlyChart history={history} />
          </div>
        )}
      </div>

      {/* Selected Entry Detail */}
      {selectedEntry && (
        <EncounterDetail
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </div>
  );
}

export default HistoryPanel;
