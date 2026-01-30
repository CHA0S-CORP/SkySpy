/**
 * Safety tab constants and utilities
 */

// Event type labels for display
export const EVENT_TYPE_LABELS = {
  'tcas_ra': 'TCAS RA',
  'tcas_ta': 'TCAS TA',
  'extreme_vs': 'Extreme VS',
  'vs_reversal': 'VS Reversal',
  'proximity_conflict': 'Proximity',
  'squawk_hijack': 'Squawk 7500',
  'squawk_radio_failure': 'Squawk 7600',
  'squawk_emergency': 'Squawk 7700'
};

/**
 * Get severity class for styling
 */
export function getSeverityClass(severity) {
  switch (severity) {
    case 'critical': return 'severity-critical';
    case 'warning': return 'severity-warning';
    case 'low': return 'severity-low';
    default: return '';
  }
}

/**
 * Format event type for display
 */
export function formatEventType(type) {
  return EVENT_TYPE_LABELS[type] || type;
}
