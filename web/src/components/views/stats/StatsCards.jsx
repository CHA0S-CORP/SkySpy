import React, { useMemo, useState, useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';

/**
 * KPICard - Consolidated Key Performance Indicator card
 * Groups related metrics into logical clusters
 */
export function KPICard({ title, icon: Icon, metrics, accentColor = 'cyan' }) {
  const colorClasses = {
    cyan: 'kpi-accent-cyan',
    green: 'kpi-accent-green',
    purple: 'kpi-accent-purple',
    orange: 'kpi-accent-orange',
    red: 'kpi-accent-red'
  };

  return (
    <div className={`kpi-card ${colorClasses[accentColor]}`}>
      <div className="kpi-header">
        <Icon size={16} />
        <span className="kpi-title">{title}</span>
      </div>
      <div className="kpi-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="kpi-metric">
            <span className="kpi-metric-value">{metric.value}</span>
            <span className="kpi-metric-label">{metric.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * LeaderboardCard - Live feed metric with pulse animation on update
 */
export function LeaderboardCard({ title, icon: Icon, items, onSelect, valueFormatter, emptyText = "No data" }) {
  const [pulse, setPulse] = useState(false);
  const prevItemsRef = useRef([]);

  useEffect(() => {
    if (!items?.length) return;

    // Efficient comparison: check length first, then compare first item's key properties
    const prevItems = prevItemsRef.current;
    const hasChanged = items.length !== prevItems.length ||
      (items[0]?.hex !== prevItems[0]?.hex) ||
      (items[0]?.distance !== prevItems[0]?.distance) ||
      (items[0]?.gs !== prevItems[0]?.gs) ||
      (items[0]?.alt_baro !== prevItems[0]?.alt_baro);

    if (hasChanged) {
      setPulse(true);
      prevItemsRef.current = items;
      const timer = setTimeout(() => setPulse(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [items]);

  return (
    <div className={`leaderboard-card ${pulse ? 'pulse' : ''}`}>
      <div className="leaderboard-header">
        <Icon size={16} />
        <span>{title}</span>
      </div>
      <div className="leaderboard-list">
        {!items?.length ? (
          <div className="leaderboard-empty">{emptyText}</div>
        ) : (
          items.slice(0, 3).map((item, i) => (
            <div
              key={item.hex || i}
              className={`leaderboard-item ${onSelect ? 'clickable' : ''}`}
              onClick={() => onSelect?.(item.hex)}
            >
              <span className="leaderboard-rank">{i + 1}</span>
              <div className="leaderboard-info">
                <span className="leaderboard-callsign">{item.flight || item.hex}</span>
              </div>
              <span className="leaderboard-value">{valueFormatter(item)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * SquawkWatchlist - Special squawk code monitor (emergency-focused)
 */
export function SquawkWatchlist({ aircraftData, onSelect }) {
  const specialSquawks = useMemo(() => {
    const aircraft = Array.isArray(aircraftData) ? aircraftData : aircraftData?.aircraft;
    if (!aircraft?.length) return { active: [], allClear: true };

    const watchCodes = {
      '7700': { label: 'EMERGENCY', severity: 'critical', description: 'General Emergency' },
      '7600': { label: 'RADIO FAIL', severity: 'warning', description: 'Radio Failure' },
      '7500': { label: 'HIJACK', severity: 'critical', description: 'Hijacking' }
    };

    const active = aircraft
      .filter(ac => ac.squawk && watchCodes[ac.squawk])
      .map(ac => ({
        ...ac,
        ...watchCodes[ac.squawk]
      }));

    return { active, allClear: active.length === 0 };
  }, [aircraftData]);

  return (
    <div className="squawk-watchlist">
      <div className="watchlist-header">
        <AlertTriangle size={16} />
        <span>Squawk Watchlist</span>
      </div>
      {specialSquawks.allClear ? (
        <div className="watchlist-clear">
          <CheckCircle size={20} />
          <span>All Clear</span>
          <span className="watchlist-subtext">No emergency squawks active</span>
        </div>
      ) : (
        <div className="watchlist-alerts">
          {specialSquawks.active.map((ac, i) => (
            <div
              key={i}
              className={`watchlist-alert ${ac.severity}`}
              onClick={() => onSelect?.(ac.hex)}
            >
              <div className="alert-badge">{ac.squawk}</div>
              <div className="alert-info">
                <span className="alert-label">{ac.label}</span>
                <span className="alert-callsign">{ac.flight || ac.hex}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
