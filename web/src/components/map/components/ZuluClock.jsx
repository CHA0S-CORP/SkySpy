import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

/**
 * ZuluClock - Live-updating UTC time display
 *
 * Displays current UTC (Zulu) time with 1-second update interval.
 * Used in Pro mode search bar header.
 */
export function ZuluClock({ className = '' }) {
  // Initialize with placeholder to avoid SSR hydration mismatch
  const [time, setTime] = useState('--:--:--');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Set initial time on mount to avoid hydration mismatch
    setTime(new Date().toISOString().slice(11, 19));
    setMounted(true);

    const interval = setInterval(() => {
      setTime(new Date().toISOString().slice(11, 19));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`pro-time ${className}`.trim()}>
      <Clock size={14} />
      <span>{mounted ? `${time} Z` : '--:--:-- Z'}</span>
    </div>
  );
}

export default ZuluClock;
