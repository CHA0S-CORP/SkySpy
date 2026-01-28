import React, { useState, useEffect } from 'react';

/**
 * DataFreshnessIndicator - Shows data age with color-coded status
 * @param {number} lastUpdated - Unix timestamp in milliseconds
 * @param {number} freshThreshold - Seconds before data is considered stale (default: 30)
 * @param {number} staleThreshold - Seconds before data is considered very stale (default: 120)
 * @param {boolean} showLabel - Whether to show the text label (default: true)
 * @param {string} size - Size variant: 'sm', 'md', 'lg' (default: 'md')
 */
export function DataFreshnessIndicator({
  lastUpdated,
  freshThreshold = 30,
  staleThreshold = 120,
  showLabel = true,
  size = 'md'
}) {
  const [age, setAge] = useState(0);

  useEffect(() => {
    if (!lastUpdated) return;

    const updateAge = () => {
      setAge(Math.floor((Date.now() - lastUpdated) / 1000));
    };

    updateAge();
    const interval = setInterval(updateAge, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  if (!lastUpdated) {
    return (
      <span className={`freshness-indicator freshness-unknown freshness-${size}`}>
        <span className="freshness-dot" />
        {showLabel && <span className="freshness-text">--</span>}
      </span>
    );
  }

  const status = age < freshThreshold ? 'fresh' : age < staleThreshold ? 'stale' : 'very-stale';

  const formatAge = () => {
    if (age < 5) return 'just now';
    if (age < 60) return `${age}s`;
    if (age < 3600) return `${Math.floor(age / 60)}m`;
    return `${Math.floor(age / 3600)}h`;
  };

  return (
    <span className={`freshness-indicator freshness-${status} freshness-${size}`}>
      <span className="freshness-dot" />
      {showLabel && <span className="freshness-text">{formatAge()}</span>}
    </span>
  );
}

/**
 * DataFreshnessBadge - Compact badge variant with status text
 */
export function DataFreshnessBadge({ lastUpdated, label = 'Data' }) {
  const [age, setAge] = useState(0);

  useEffect(() => {
    if (!lastUpdated) return;

    const updateAge = () => {
      setAge(Math.floor((Date.now() - lastUpdated) / 1000));
    };

    updateAge();
    const interval = setInterval(updateAge, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  const getStatus = () => {
    if (!lastUpdated) return { status: 'unknown', text: 'Unknown' };
    if (age < 5) return { status: 'live', text: 'Live' };
    if (age < 30) return { status: 'fresh', text: 'Fresh' };
    if (age < 120) return { status: 'stale', text: 'Delayed' };
    return { status: 'very-stale', text: 'Stale' };
  };

  const { status, text } = getStatus();

  return (
    <div className={`freshness-badge freshness-badge-${status}`}>
      <span className="freshness-dot" />
      <span className="freshness-label">{label}</span>
      <span className="freshness-status">{text}</span>
    </div>
  );
}

export default DataFreshnessIndicator;
