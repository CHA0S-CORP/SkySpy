import React, { useState, useEffect } from 'react';
import { useApi } from '../../hooks';

export function HistoryView({ apiBase }) {
  const [viewType, setViewType] = useState('sessions');
  const [timeRange, setTimeRange] = useState('24h');

  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };
  const endpoint = viewType === 'sessions'
    ? `/api/v1/history/sessions?hours=${hours[timeRange]}`
    : `/api/v1/history/sightings?hours=${hours[timeRange]}&limit=100`;

  const { data, refetch } = useApi(endpoint, null, apiBase);

  useEffect(() => { refetch(); }, [timeRange, viewType, refetch]);

  return (
    <div className="history-container">
      <div className="history-toolbar">
        <div className="view-toggle">
          <button className={`time-btn ${viewType === 'sessions' ? 'active' : ''}`} onClick={() => setViewType('sessions')}>
            Sessions
          </button>
          <button className={`time-btn ${viewType === 'sightings' ? 'active' : ''}`} onClick={() => setViewType('sightings')}>
            Sightings
          </button>
        </div>

        <div className="time-range-selector">
          {['1h', '6h', '24h', '48h', '7d'].map(range => (
            <button
              key={range}
              className={`time-btn ${timeRange === range ? 'active' : ''}`}
              onClick={() => setTimeRange(range)}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {viewType === 'sessions' ? (
        <div className="sessions-grid">
          {data?.sessions?.map((session, i) => (
            <div key={i} className={`session-card ${session.military ? 'military' : ''}`}>
              <div className="session-header">
                <div>
                  <div className="session-callsign">{session.callsign || session.icao_hex}</div>
                  <div className="session-icao">{session.icao_hex}</div>
                </div>
                <div className="session-duration">{Math.round((session.duration_seconds || 0) / 60)}m</div>
              </div>
              <div className="session-stats">
                <div className="session-stat">
                  <span className="session-stat-label">Distance</span>
                  <span className="session-stat-value">{session.min_distance?.toFixed(1) || '--'} nm</span>
                </div>
                <div className="session-stat">
                  <span className="session-stat-label">Altitude</span>
                  <span className="session-stat-value">{session.min_altitude?.toLocaleString() || '--'} - {session.max_altitude?.toLocaleString() || '--'}</span>
                </div>
                <div className="session-stat">
                  <span className="session-stat-label">First Seen</span>
                  <span className="session-stat-value">{new Date(session.first_seen).toLocaleTimeString()}</span>
                </div>
                <div className="session-stat">
                  <span className="session-stat-label">Last Seen</span>
                  <span className="session-stat-value">{new Date(session.last_seen).toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sightings-table-wrapper">
          <table className="sightings-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>ICAO</th>
                <th>Callsign</th>
                <th>Altitude</th>
                <th>Speed</th>
                <th>Distance</th>
              </tr>
            </thead>
            <tbody>
              {data?.sightings?.map((s, i) => (
                <tr key={i}>
                  <td>{new Date(s.timestamp).toLocaleTimeString()}</td>
                  <td className="mono">{s.icao_hex}</td>
                  <td>{s.callsign || '--'}</td>
                  <td className="mono">{s.altitude?.toLocaleString() || '--'}</td>
                  <td className="mono">{s.gs?.toFixed(0) || '--'}</td>
                  <td className="mono">{s.distance_nm?.toFixed(1) || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
