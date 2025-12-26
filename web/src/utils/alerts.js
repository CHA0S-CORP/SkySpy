// ============================================================================
// Alert Handling Utilities
// ============================================================================

export const handleAlertTriggered = (alertData) => {
  const history = JSON.parse(localStorage.getItem('alert-history') || '[]');
  history.unshift({
    ...alertData,
    id: Date.now(),
    timestamp: new Date().toISOString()
  });
  localStorage.setItem('alert-history', JSON.stringify(history.slice(0, 100)));

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(alertData.rule_name || 'ADS-B Alert', {
      body: alertData.message || `Aircraft ${alertData.icao} triggered alert`,
      icon: '/static/favicon.svg',
      tag: `alert-${alertData.icao}`,
      requireInteraction: alertData.priority === 'emergency'
    });
  }
};

export const getAlertHistory = () => {
  return JSON.parse(localStorage.getItem('alert-history') || '[]');
};

export const clearAlertHistory = () => {
  localStorage.setItem('alert-history', JSON.stringify([]));
};
