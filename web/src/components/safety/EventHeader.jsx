import React, { useCallback, useState } from 'react';
import { AlertTriangle, ArrowLeft, Copy, Check, Zap, Clock } from 'lucide-react';

/**
 * Event Header Component
 * Displays the top bar with event info, severity, timestamp, share, and acknowledge buttons
 */
export function EventHeader({
  event,
  eventId,
  acknowledged,
  acknowledging,
  onAcknowledge,
  onClose,
  severityColor
}) {
  const [copied, setCopied] = useState(false);

  // Copy link to clipboard
  const copyLink = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}#event?id=${eventId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [eventId]);

  const handleBack = useCallback(() => {
    window.location.hash = '#history?data=safety';
    onClose?.();
  }, [onClose]);

  return (
    <div className="sep-topbar">
      <button className="sep-back-btn" onClick={handleBack}>
        <ArrowLeft size={18} />
      </button>

      <div className="sep-event-badge" style={{ '--badge-color': severityColor }}>
        <AlertTriangle size={16} />
        <span className="sep-event-type">{event.event_type?.replace(/_/g, ' ')}</span>
      </div>

      <div className="sep-severity-indicator" style={{ '--severity-color': severityColor }}>
        <Zap size={14} />
        <span>{event.severity?.toUpperCase()}</span>
      </div>

      <div className="sep-timestamp">
        <Clock size={14} />
        <span>{new Date(event.timestamp).toLocaleString()}</span>
      </div>

      <button className="sep-copy-btn" onClick={copyLink}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
        <span>{copied ? 'Copied!' : 'Share'}</span>
      </button>

      {/* Acknowledge button - only show if not yet acknowledged */}
      {!acknowledged && (
        <button
          className={`sep-acknowledge-btn ${acknowledging ? 'loading' : ''}`}
          onClick={onAcknowledge}
          disabled={acknowledging}
          title="Acknowledge this safety event"
        >
          <Check size={16} />
          <span>{acknowledging ? 'Acknowledging...' : 'Acknowledge'}</span>
        </button>
      )}
      {acknowledged && (
        <div className="sep-acknowledged-badge">
          <Check size={14} />
          <span>Acknowledged</span>
        </div>
      )}
    </div>
  );
}

export default EventHeader;
