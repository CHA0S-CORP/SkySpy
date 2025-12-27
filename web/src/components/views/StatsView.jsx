import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useApi } from '../../hooks';

export function StatsView({ apiBase, onSelectAircraft }) {
  const { data: stats } = useApi('/api/v1/aircraft/stats', 5000, apiBase);
  const { data: top } = useApi('/api/v1/aircraft/top', 5000, apiBase);
  const { data: histStats } = useApi('/api/v1/history/stats?hours=24', 60000, apiBase);

  const emergencyAircraft = stats?.emergency_squawks || [];

  const altitudeData = useMemo(() => {
    if (!stats?.altitude_distribution) return [];
    const dist = stats.altitude_distribution;
    const total = Object.values(dist).reduce((a, b) => a + (b || 0), 0) || 1;
    return [
      { label: 'Ground', value: dist.ground || 0, pct: ((dist.ground || 0) / total) * 100 },
      { label: '< 10k ft', value: dist.low || 0, pct: ((dist.low || 0) / total) * 100 },
      { label: '10-30k ft', value: dist.medium || 0, pct: ((dist.medium || 0) / total) * 100 },
      { label: '> 30k ft', value: dist.high || 0, pct: ((dist.high || 0) / total) * 100 }
    ];
  }, [stats]);

  return (
    <div className="stats-container">
      {emergencyAircraft.length > 0 && (
        <div className="emergency-banner">
          <AlertTriangle size={24} />
          <div>
            <strong>Emergency Squawk Detected</strong>
            <div>
              {emergencyAircraft.map((a, i) => (
                <span key={a.hex}>
                  {i > 0 && ', '}
                  {onSelectAircraft ? (
                    <button className="emergency-aircraft-link" onClick={() => onSelectAircraft(a.hex)}>
                      {a.hex} ({a.squawk})
                    </button>
                  ) : (
                    `${a.hex} (${a.squawk})`
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-label">Current Aircraft</div>
          <div className="stat-card-value">{stats?.total || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">With Position</div>
          <div className="stat-card-value">{stats?.with_position || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Military</div>
          <div className="stat-card-value purple">{stats?.military || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">24h Unique</div>
          <div className="stat-card-value">{histStats?.unique_aircraft || '--'}</div>
        </div>
      </div>

      <div className="distribution-card">
        <div className="card-title">Altitude Distribution</div>
        <div className="bar-chart">
          {altitudeData.map((item, i) => (
            <div key={i} className="bar-row">
              <span className="bar-label">{item.label}</span>
              <div className="bar-container">
                <div className="bar-fill" style={{ width: `${item.pct}%` }} />
              </div>
              <span className="bar-value">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="top-lists">
        <div className="top-list-card">
          <div className="card-title">Closest Aircraft</div>
          <div className="top-list">
            {top?.closest?.slice(0, 5).map((ac, i) => (
              <div
                key={ac.hex}
                className={`top-item ${onSelectAircraft ? 'clickable' : ''}`}
                onClick={() => onSelectAircraft?.(ac.hex)}
              >
                <span className="top-rank">{i + 1}</span>
                <div className="top-info">
                  <div className="top-callsign">{ac.flight || ac.hex}</div>
                  <div className="top-icao">{ac.hex}</div>
                </div>
                <span className="top-value">{ac.distance_nm?.toFixed(1)} nm</span>
              </div>
            ))}
          </div>
        </div>

        <div className="top-list-card">
          <div className="card-title">Highest Aircraft</div>
          <div className="top-list">
            {top?.highest?.slice(0, 5).map((ac, i) => (
              <div
                key={ac.hex}
                className={`top-item ${onSelectAircraft ? 'clickable' : ''}`}
                onClick={() => onSelectAircraft?.(ac.hex)}
              >
                <span className="top-rank">{i + 1}</span>
                <div className="top-info">
                  <div className="top-callsign">{ac.flight || ac.hex}</div>
                  <div className="top-icao">{ac.hex}</div>
                </div>
                <span className="top-value">{ac.alt?.toLocaleString()} ft</span>
              </div>
            ))}
          </div>
        </div>

        <div className="top-list-card">
          <div className="card-title">Fastest Aircraft</div>
          <div className="top-list">
            {top?.fastest?.slice(0, 5).map((ac, i) => (
              <div
                key={ac.hex}
                className={`top-item ${onSelectAircraft ? 'clickable' : ''}`}
                onClick={() => onSelectAircraft?.(ac.hex)}
              >
                <span className="top-rank">{i + 1}</span>
                <div className="top-info">
                  <div className="top-callsign">{ac.flight || ac.hex}</div>
                  <div className="top-icao">{ac.hex}</div>
                </div>
                <span className="top-value">{ac.gs?.toFixed(0)} kts</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
