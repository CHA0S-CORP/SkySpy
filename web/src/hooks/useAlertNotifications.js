import { useState, useEffect, useCallback, useRef } from 'react';
import { useToastContext, TOAST_TYPES } from './useToast';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

// Alert severity levels and their configuration
const SEVERITY_CONFIG = {
  critical: {
    sound: '/static/sounds/alert-critical.mp3',
    duration: 0, // Manual dismiss required
    priority: 3,
  },
  high: {
    sound: '/static/sounds/alert-high.mp3',
    duration: 8000,
    priority: 2,
  },
  medium: {
    sound: '/static/sounds/alert-medium.mp3',
    duration: 5000,
    priority: 1,
  },
  low: {
    sound: '/static/sounds/alert-low.mp3',
    duration: 5000,
    priority: 0,
  },
  info: {
    sound: '/static/sounds/alert-info.mp3',
    duration: 5000,
    priority: 0,
  },
};

// Default sound for alerts without specific severity
const DEFAULT_ALERT_SOUND = '/static/sounds/alert-default.mp3';

// Storage key for unacknowledged alerts
const UNACKED_ALERTS_KEY = 'unacknowledged-alerts';

/**
 * Custom hook for managing real-time alert notifications
 * Handles WebSocket subscription, toast notifications, sound alerts,
 * and unacknowledged alert count tracking.
 *
 * @param {Object} options - Configuration options (all optional)
 * @param {Object} options.toast - Toast context (will use useToastContext if not provided)
 * @param {Function} options.onNavigateToAlerts - Callback to navigate to alerts history
 * @param {string} options.apiBase - API base URL for fetching unacknowledged count
 * @param {Function} options.wsRequest - WebSocket request function
 * @param {boolean} options.wsConnected - WebSocket connection status
 * @param {boolean} options.soundEnabled - Whether to play alert sounds (default: true)
 * @returns {Object} Alert notification state and functions
 */
export function useAlertNotifications(options = {}) {
  const {
    toast: toastProp,
    onNavigateToAlerts,
    apiBase,
    wsRequest,
    wsConnected,
    soundEnabled = true,
  } = options;

  // Try to use toast context if not provided as prop
  let toastContext = null;
  try {
    toastContext = useToastContext();
  } catch (e) {
    // Not wrapped in ToastProvider, toastContext will be null
  }
  const toast = toastProp || toastContext;
  const [unacknowledgedCount, setUnacknowledgedCount] = useState(0);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const mountedRef = useRef(true);
  const audioRef = useRef(null);
  const lastFetchRef = useRef(0);

  // Load unacknowledged alerts from localStorage on mount
  useEffect(() => {
    mountedRef.current = true;
    try {
      const stored = localStorage.getItem(UNACKED_ALERTS_KEY);
      if (stored) {
        const alerts = JSON.parse(stored);
        if (Array.isArray(alerts)) {
          setUnacknowledgedCount(alerts.length);
          setRecentAlerts(alerts.slice(0, 20));
        }
      }
    } catch (e) {
      console.warn('Failed to load unacknowledged alerts from localStorage:', e);
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Fetch unacknowledged alert count from API
   */
  const fetchUnacknowledgedCount = useCallback(async () => {
    // Rate limit to once per 5 seconds
    const now = Date.now();
    if (now - lastFetchRef.current < 5000) return;
    lastFetchRef.current = now;

    try {
      let data;
      if (wsRequest && wsConnected) {
        data = await wsRequest('alert-count', { acknowledged: false });
      } else if (apiBase) {
        const res = await fetch(`${apiBase}/api/v1/alerts/count?acknowledged=false`);
        data = await safeJson(res);
      }

      if (data && typeof data.count === 'number' && mountedRef.current) {
        setUnacknowledgedCount(data.count);
      }
    } catch (err) {
      console.warn('Failed to fetch unacknowledged alert count:', err.message);
    }
  }, [apiBase, wsRequest, wsConnected]);

  // Fetch count on mount and when connection changes
  useEffect(() => {
    if (wsConnected || apiBase) {
      fetchUnacknowledgedCount();
    }
  }, [wsConnected, apiBase, fetchUnacknowledgedCount]);

  // Periodically refresh the count
  useEffect(() => {
    const interval = setInterval(() => {
      fetchUnacknowledgedCount();
    }, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [fetchUnacknowledgedCount]);

  /**
   * Play alert sound based on severity
   */
  const playAlertSound = useCallback((severity) => {
    if (!soundEnabled) return;

    try {
      const config = SEVERITY_CONFIG[severity] || {};
      const soundUrl = config.sound || DEFAULT_ALERT_SOUND;

      // Create audio element if needed
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.volume = 0.5;
      }

      // Play sound
      audioRef.current.src = soundUrl;
      audioRef.current.play().catch(err => {
        // Silently fail if autoplay is blocked
        console.debug('Alert sound blocked:', err.message);
      });
    } catch (err) {
      console.warn('Failed to play alert sound:', err.message);
    }
  }, [soundEnabled]);

  /**
   * Show toast notification for a triggered alert
   */
  const showAlertToast = useCallback((alertData) => {
    if (!toast) return;

    const severity = alertData.severity || alertData.priority || 'info';
    const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
    const ruleName = alertData.rule_name || 'Alert';
    const aircraft = alertData.callsign || alertData.hex || alertData.icao || 'Unknown';
    const message = `${ruleName}: ${aircraft}`;

    // Map severity to toast type
    let toastType = 'info';
    if (severity === 'critical' || severity === 'emergency') {
      toastType = 'error';
    } else if (severity === 'high' || severity === 'warning') {
      toastType = 'warning';
    }

    // Show toast with appropriate duration and click handler to navigate to alerts
    const toastId = toast.addToast(message, toastType, config.duration, {
      onClick: onNavigateToAlerts,
      actionLabel: 'View Alerts',
      onAction: onNavigateToAlerts,
    });

    return toastId;
  }, [toast, onNavigateToAlerts]);

  /**
   * Handle incoming alert:triggered event (internal implementation)
   */
  const handleAlertTriggeredInternal = useCallback((alertData) => {
    if (!mountedRef.current) return;

    console.log('Alert notification received:', alertData);

    // Update unacknowledged count
    setUnacknowledgedCount(prev => prev + 1);

    // Add to recent alerts
    const newAlert = {
      ...alertData,
      id: alertData.id || Date.now(),
      triggered_at: alertData.triggered_at || new Date().toISOString(),
    };

    setRecentAlerts(prev => {
      const updated = [newAlert, ...prev].slice(0, 20);
      // Persist to localStorage
      try {
        localStorage.setItem(UNACKED_ALERTS_KEY, JSON.stringify(updated));
      } catch (e) {
        // Ignore storage errors
      }
      return updated;
    });

    // Show toast notification
    showAlertToast(alertData);

    // Play alert sound
    playAlertSound(alertData.severity || alertData.priority);

    // Show browser notification if enabled
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const severity = alertData.severity || alertData.priority || 'info';
      new Notification(alertData.rule_name || 'SkySpy Alert', {
        body: alertData.message || `Aircraft ${alertData.callsign || alertData.hex} triggered alert`,
        icon: '/static/favicon.svg',
        tag: `alert-${alertData.id || Date.now()}`,
        requireInteraction: severity === 'critical' || severity === 'emergency',
      });
    }
  }, [showAlertToast, playAlertSound]);

  // Listen for WebSocket alert events via custom event
  useEffect(() => {
    const handleAlertEvent = (event) => {
      if (event.detail && mountedRef.current) {
        handleAlertTriggeredInternal(event.detail);
      }
    };

    window.addEventListener('skyspy:alert:triggered', handleAlertEvent);

    return () => {
      window.removeEventListener('skyspy:alert:triggered', handleAlertEvent);
    };
  }, [handleAlertTriggeredInternal]);

  // Public handler that can be called externally
  const handleAlertTriggered = handleAlertTriggeredInternal;

  /**
   * Mark an alert as acknowledged
   */
  const acknowledgeAlert = useCallback(async (alertId) => {
    try {
      // Update local state
      setRecentAlerts(prev => {
        const updated = prev.filter(a => a.id !== alertId);
        try {
          localStorage.setItem(UNACKED_ALERTS_KEY, JSON.stringify(updated));
        } catch (e) {
          // Ignore
        }
        return updated;
      });
      setUnacknowledgedCount(prev => Math.max(0, prev - 1));

      // Send to server if connected
      if (wsRequest && wsConnected) {
        await wsRequest('acknowledge-alert', { id: alertId });
      } else if (apiBase) {
        await fetch(`${apiBase}/api/v1/alerts/history/${alertId}/acknowledge`, {
          method: 'POST',
        });
      }
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
    }
  }, [apiBase, wsRequest, wsConnected]);

  /**
   * Mark all alerts as acknowledged
   */
  const acknowledgeAll = useCallback(async () => {
    try {
      // Clear local state
      setRecentAlerts([]);
      setUnacknowledgedCount(0);
      localStorage.removeItem(UNACKED_ALERTS_KEY);

      // Send to server
      if (wsRequest && wsConnected) {
        await wsRequest('acknowledge-all-alerts', {});
      } else if (apiBase) {
        await fetch(`${apiBase}/api/v1/alerts/acknowledge-all`, {
          method: 'POST',
        });
      }
    } catch (err) {
      console.error('Failed to acknowledge all alerts:', err);
    }
  }, [apiBase, wsRequest, wsConnected]);

  /**
   * Request browser notification permission
   */
  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      return 'unsupported';
    }
    if (Notification.permission === 'granted') {
      return 'granted';
    }
    if (Notification.permission === 'denied') {
      return 'denied';
    }
    return await Notification.requestPermission();
  }, []);

  /**
   * Get notification permission status
   */
  const getNotificationPermission = useCallback(() => {
    if (typeof Notification === 'undefined') {
      return 'unsupported';
    }
    return Notification.permission;
  }, []);

  return {
    // State
    unacknowledgedCount,
    recentAlerts,

    // Actions
    handleAlertTriggered,
    acknowledgeAlert,
    acknowledgeAll,
    markAllAsRead: acknowledgeAll, // Alias for convenience
    fetchUnacknowledgedCount,

    // Browser notifications
    requestNotificationPermission,
    getNotificationPermission,

    // Sound control
    playAlertSound,
  };
}

export default useAlertNotifications;
