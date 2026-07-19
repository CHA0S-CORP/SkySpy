import React from 'react';
import { Icon } from '../../primitives';
import { priorityConfig } from './alertsModel';

function timeLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Inbox tab: the local notification sink. Received alerts (server AlertHistory
 * seed + live alert:triggered) with unread emphasis, per-item mark-read, and a
 * click that opens the rich AlertDetailModal.
 *
 * @param {object} props
 * @param {object[]} props.items - merged alerts, each with __unread + __key
 * @param {number} props.unreadCount
 * @param {(alert: object) => void} props.onMarkRead
 * @param {() => void} props.onMarkAllRead
 * @param {() => void} props.onClear
 * @param {(alert: object) => void} props.onOpen - open the detail modal
 */
export function InboxTab({ items, unreadCount, onMarkRead, onMarkAllRead, onClear, onOpen }) {
  return (
    <div className="v2-alerts__scroll v2-alerts__scroll--padded" data-testid="v2-alerts-inbox">
      <div className="v2-alerts__inbox-bar">
        <span className="v2-alerts__inbox-count">
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        </span>
        <div className="v2-alerts__topbar-spacer" />
        <button
          type="button"
          className="v2-btn"
          onClick={onMarkAllRead}
          disabled={unreadCount === 0}
        >
          <Icon name="check" size={14} strokeWidth={2.2} />
          Mark all read
        </button>
        <button type="button" className="v2-btn" onClick={onClear} disabled={items.length === 0}>
          <Icon name="x" size={14} strokeWidth={2.2} />
          Clear
        </button>
      </div>

      {items.length === 0 ? (
        <div className="v2-alerts__empty">
          <Icon name="inbox" size={38} strokeWidth={1.3} />
          <span>Inbox empty — no alerts received yet</span>
        </div>
      ) : (
        <div className="v2-alerts__feed">
          {items.map((f) => {
            const pc = priorityConfig(f.priority || f.severity || 'info');
            const cs =
              f.callsign || f.aircraft?.flight || f.icao || f.icao_hex || f.aircraft?.hex || '—';
            const ts = f.timestamp || f.triggered_at || f.created_at;
            return (
              <div
                key={f.__key}
                className={`v2-alerts__fired v2-alerts__inbox-item ${f.__unread ? 'v2-alerts__inbox-item--unread' : ''}`}
                style={{ borderLeftColor: pc.color }}
                onClick={() => onOpen(f)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(f);
                  }
                }}
                data-testid="v2-inbox-item"
              >
                {f.__unread && <span className="v2-alerts__inbox-dot" aria-label="unread" />}
                <span
                  className="v2-alerts__fired-icon"
                  style={{
                    color: pc.color,
                    background: `color-mix(in srgb, ${pc.color} 14%, transparent)`,
                  }}
                >
                  <Icon name="bell" size={16} strokeWidth={1.8} />
                </span>
                <div className="v2-alerts__fired-body">
                  <div className="v2-alerts__fired-rule">
                    {f.rule_name || f.ruleName || 'Alert'}
                  </div>
                  <div className="v2-alerts__fired-detail">
                    Triggered by <span className="v2-alerts__fired-cs">{String(cs).trim()}</span>
                    {f.message ? ` · ${f.message}` : ''}
                  </div>
                </div>
                <span
                  className="v2-alerts__rule-pri"
                  style={{
                    color: pc.color,
                    background: `color-mix(in srgb, ${pc.color} 15%, transparent)`,
                  }}
                >
                  {pc.label}
                </span>
                <span className="v2-alerts__fired-time">{timeLabel(ts)}</span>
                {f.__unread && (
                  <button
                    type="button"
                    className="v2-iconbtn v2-alerts__inbox-read"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkRead(f);
                    }}
                    aria-label="Mark read"
                    title="Mark read"
                  >
                    <Icon name="check" size={15} strokeWidth={2.2} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
