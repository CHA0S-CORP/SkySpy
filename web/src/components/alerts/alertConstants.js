import { Info, AlertTriangle, AlertCircle } from 'lucide-react';

// Undo grace period in milliseconds
export const UNDO_GRACE_PERIOD = 5000;

// Priority configuration with colors and icons
export const PRIORITY_CONFIG = {
  info: {
    label: 'Info',
    color: 'var(--accent-cyan)',
    bgColor: 'rgba(0, 200, 255, 0.15)',
    Icon: Info
  },
  warning: {
    label: 'Warning',
    color: 'var(--accent-yellow)',
    bgColor: 'rgba(210, 153, 34, 0.15)',
    Icon: AlertTriangle
  },
  critical: {
    label: 'Critical',
    color: 'var(--accent-red)',
    bgColor: 'rgba(248, 81, 73, 0.15)',
    Icon: AlertCircle
  },
  emergency: {
    label: 'Emergency',
    color: '#dc2626',
    bgColor: 'rgba(220, 38, 38, 0.15)',
    Icon: AlertCircle
  }
};

// Format condition for readable display
export function formatCondition(condition) {
  const { type, operator, value } = condition;
  const operatorMap = {
    'eq': '=',
    'ne': '!=',
    'neq': '!=',
    'gt': '>',
    'lt': '<',
    'gte': '>=',
    'lte': '<=',
    'contains': 'contains',
    'starts_with': 'starts with',
    'startswith': 'starts with',
    'ends_with': 'ends with',
    'endswith': 'ends with',
    'in': 'in',
    'not_in': 'not in',
    'regex': 'matches'
  };
  const readableOp = operatorMap[operator] || operator;
  return `${type} ${readableOp} ${value}`;
}

// Format cooldown for display
export function formatCooldown(seconds) {
  if (!seconds) return 'None';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

// Format relative time
export function formatRelativeTime(dateString) {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}
