import React from 'react';
import {
  Plane, Activity, AlertTriangle, Radio, BarChart3,
  Target, Zap, Shield, Clock, Search, Database
} from 'lucide-react';

/**
 * EmptyState - Illustrated empty state component with configurable types
 * @param {string} type - Type of empty state to display
 * @param {string} title - Optional custom title override
 * @param {string} message - Optional custom message override
 * @param {function} action - Optional action callback
 * @param {string} actionLabel - Optional action button label
 */
export function EmptyState({
  type = 'generic',
  title,
  message,
  action,
  actionLabel = 'Refresh'
}) {
  const configs = {
    aircraft: {
      icon: Plane,
      title: 'No aircraft detected',
      message: 'Aircraft will appear here when they come within range of your receiver.',
      color: 'cyan'
    },
    leaderboard: {
      icon: Activity,
      title: 'No data yet',
      message: 'Rankings will populate as aircraft are tracked over time.',
      color: 'cyan'
    },
    emergencies: {
      icon: AlertTriangle,
      title: 'All clear',
      message: 'No emergency squawk codes detected.',
      color: 'green'
    },
    safety: {
      icon: Shield,
      title: 'No safety events',
      message: 'No safety events have been recorded in this time period.',
      color: 'green'
    },
    acars: {
      icon: Radio,
      title: 'No ACARS messages',
      message: 'ACARS/VDL2 messages will appear when received.',
      color: 'cyan'
    },
    analytics: {
      icon: BarChart3,
      title: 'Insufficient data',
      message: 'More tracking data is needed to generate analytics.',
      color: 'purple'
    },
    trends: {
      icon: Activity,
      title: 'No trend data',
      message: 'Trend data will be available after more tracking time.',
      color: 'cyan'
    },
    distance: {
      icon: Target,
      title: 'No distance data',
      message: 'Distance analytics require position data from tracked aircraft.',
      color: 'green'
    },
    speed: {
      icon: Zap,
      title: 'No speed data',
      message: 'Speed analytics require ground speed data from tracked aircraft.',
      color: 'orange'
    },
    history: {
      icon: Clock,
      title: 'No history',
      message: 'Historical data will appear as aircraft are tracked.',
      color: 'cyan'
    },
    search: {
      icon: Search,
      title: 'No results',
      message: 'Try adjusting your search or filter criteria.',
      color: 'cyan'
    },
    filtered: {
      icon: Search,
      title: 'No matches',
      message: 'No aircraft match the current filter criteria.',
      color: 'cyan'
    },
    generic: {
      icon: Database,
      title: 'No data available',
      message: 'Data will appear here when available.',
      color: 'cyan'
    }
  };

  const config = configs[type] || configs.generic;
  const Icon = config.icon;
  const displayTitle = title || config.title;
  const displayMessage = message || config.message;

  const colorClasses = {
    cyan: 'empty-state-cyan',
    green: 'empty-state-green',
    purple: 'empty-state-purple',
    orange: 'empty-state-orange'
  };

  return (
    <div className={`empty-state-illustrated ${colorClasses[config.color]}`}>
      <div className="empty-state-icon">
        <Icon size={32} />
      </div>
      <h4 className="empty-state-title">{displayTitle}</h4>
      <p className="empty-state-message">{displayMessage}</p>
      {action && (
        <button className="empty-state-action" onClick={action}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * EmptyStateInline - Compact inline empty state for smaller spaces
 */
export function EmptyStateInline({ message = 'No data', icon: Icon = Database }) {
  return (
    <div className="empty-state-inline">
      <Icon size={16} />
      <span>{message}</span>
    </div>
  );
}

export default EmptyState;
