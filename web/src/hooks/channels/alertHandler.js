/**
 * Alert handling utilities
 * Handles alert storage and event dispatch
 */

const ALERT_HISTORY_KEY = 'alert-history';
const MAX_ALERT_HISTORY = 100;

/**
 * Handle alert triggered - store in localStorage and emit custom event
 */
export function handleAlertTriggered(alertData) {
  const history = JSON.parse(localStorage.getItem(ALERT_HISTORY_KEY) || '[]');
  history.unshift({
    ...alertData,
    id: Date.now(),
    timestamp: new Date().toISOString()
  });
  localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_ALERT_HISTORY)));

  // Emit custom event for useAlertNotifications to handle toasts and sounds
  window.dispatchEvent(new CustomEvent('skyspy:alert:triggered', {
    detail: alertData
  }));
}

/**
 * Get alert history from localStorage
 */
export function getAlertHistory() {
  return JSON.parse(localStorage.getItem(ALERT_HISTORY_KEY) || '[]');
}

/**
 * Clear alert history
 */
export function clearAlertHistory() {
  localStorage.removeItem(ALERT_HISTORY_KEY);
}
