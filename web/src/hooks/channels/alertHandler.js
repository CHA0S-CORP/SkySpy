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
  // Storage failures (disabled localStorage, corrupt/non-array value) must
  // never swallow the alert itself - the event dispatch below drives toasts
  try {
    let history;
    try {
      history = JSON.parse(localStorage.getItem(ALERT_HISTORY_KEY) || '[]');
    } catch {
      history = [];
    }
    if (!Array.isArray(history)) history = [];
    history.unshift({
      ...alertData,
      id: Date.now(),
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_ALERT_HISTORY)));
  } catch (e) {
    console.warn('Alert history storage unavailable:', e);
  }

  // Emit custom event for useAlertNotifications to handle toasts and sounds
  window.dispatchEvent(
    new CustomEvent('skyspy:alert:triggered', {
      detail: alertData,
    })
  );
}

/**
 * Get alert history from localStorage
 */
export function getAlertHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ALERT_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Clear alert history
 */
export function clearAlertHistory() {
  try {
    localStorage.removeItem(ALERT_HISTORY_KEY);
  } catch {
    // storage disabled - nothing to clear
  }
}
