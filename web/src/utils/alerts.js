// ============================================================================
// Alert Handling Utilities
// ============================================================================

// Re-export alert evaluation utilities from alerts/ directory
export * from './alerts/index';

export const handleAlertTriggered = (alertData) => {
  // Storage failures must never swallow the alert notification below
  try {
    let history;
    try {
      history = JSON.parse(localStorage.getItem('alert-history') || '[]');
    } catch {
      history = [];
    }
    if (!Array.isArray(history)) history = [];
    history.unshift({
      ...alertData,
      id: Date.now(),
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem('alert-history', JSON.stringify(history.slice(0, 100)));
  } catch (e) {
    console.warn('Alert history storage unavailable:', e);
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(alertData.rule_name || 'ADS-B Alert', {
      body: alertData.message || `Aircraft ${alertData.icao} triggered alert`,
      icon: '/static/favicon.svg',
      tag: `alert-${alertData.icao}`,
      requireInteraction: alertData.priority === 'emergency',
    });
  }
};

export const getAlertHistory = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem('alert-history') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const clearAlertHistory = () => {
  try {
    localStorage.setItem('alert-history', JSON.stringify([]));
  } catch {
    // storage disabled - nothing to clear
  }
};
