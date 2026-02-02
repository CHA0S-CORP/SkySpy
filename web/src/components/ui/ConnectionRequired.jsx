import React from 'react';
import { WifiOff, RefreshCw, AlertCircle } from 'lucide-react';

/**
 * ConnectionRequired component - displays user-friendly error when socket disconnected
 * Wrap components that require socket connection with this to handle disconnection gracefully.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Content to show when connected
 * @param {boolean} props.connected - Whether socket is connected
 * @param {boolean} props.connecting - Whether socket is currently connecting
 * @param {Function} props.onReconnect - Callback to trigger reconnection
 * @param {string} props.message - Custom disconnection message
 * @param {string} props.className - Additional CSS classes
 * @param {boolean} props.inline - If true, shows inline error instead of centered
 */
export function ConnectionRequired({
  children,
  connected,
  connecting = false,
  onReconnect,
  message = 'Connection lost. Unable to reach server.',
  className = '',
  inline = false,
}) {
  // If connected, render children normally
  if (connected) {
    return children;
  }

  // Show connecting state
  if (connecting) {
    return (
      <div className={`connection-required connecting ${inline ? 'inline' : ''} ${className}`}>
        <RefreshCw size={24} className="spin" aria-hidden="true" />
        <span>Connecting...</span>
      </div>
    );
  }

  // Show disconnected state with reconnect option
  return (
    <div
      className={`connection-required disconnected ${inline ? 'inline' : ''} ${className}`}
      role="alert"
    >
      <WifiOff size={32} aria-hidden="true" />
      <p className="connection-message">{message}</p>
      {onReconnect && (
        <button className="btn-primary reconnect-btn" onClick={onReconnect} type="button">
          <RefreshCw size={16} aria-hidden="true" />
          Reconnect
        </button>
      )}
    </div>
  );
}

/**
 * ConnectionBanner component - shows a banner at top of page when disconnected
 * Use this for pages that can partially function without connection.
 *
 * @param {Object} props
 * @param {boolean} props.connected - Whether socket is connected
 * @param {boolean} props.connecting - Whether socket is currently connecting
 * @param {Function} props.onReconnect - Callback to trigger reconnection
 * @param {string} props.message - Custom disconnection message
 */
export function ConnectionBanner({
  connected,
  connecting = false,
  onReconnect,
  message = 'Connection lost. Some features may be unavailable.',
}) {
  // Don't show banner when connected
  if (connected) {
    return null;
  }

  return (
    <div className="connection-banner" role="alert">
      <div className="connection-banner-content">
        {connecting ? (
          <>
            <RefreshCw size={16} className="spin" aria-hidden="true" />
            <span>Reconnecting...</span>
          </>
        ) : (
          <>
            <AlertCircle size={16} aria-hidden="true" />
            <span>{message}</span>
            {onReconnect && (
              <button className="btn-secondary btn-sm" onClick={onReconnect} type="button">
                Reconnect
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ConnectionRequired;
