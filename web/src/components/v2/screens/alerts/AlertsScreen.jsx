import React, { useEffect, useRef, useState } from 'react';
import { Icon, Switch, toast } from '../../primitives';
import { useHashParamState } from '../../../../hooks/useHashParamState';
import { useAlertRules } from '../../../../hooks/useAlertRules';
import { useAlertInbox, inboxKey } from '../../../../hooks/useAlertInbox';
import { playAlertSound } from '../../../../utils/alertSound';
import { CreateRuleModal } from './CreateRuleModal';
import { NotificationsTab } from './NotificationsTab';
import { InboxTab } from './InboxTab';
import { AlertDetailModal } from './AlertDetailModal';
import { priorityConfig, ruleCondSummary } from './alertsModel';

const RULE_ICONS = {
  emergency: 'alert-triangle',
  critical: 'shield',
  warning: 'shield',
  info: 'map-pin',
};

// Local-sink settings (client-side): browser push + chime on trigger.
const LOCAL_KEY = 'skyspy-alert-channels';

function loadLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY));
    return { sound: true, browser: false, ...(v && typeof v === 'object' ? v : {}) };
  } catch {
    return { sound: true, browser: false };
  }
}

function relTime(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(s)) return 'never';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * v2 Alerts screen: Rules / Inbox / History / Notifications tabs + Create Rule
 * modal + rich Alert Detail modal. Rules via useAlertRules; inbox (local sink)
 * via useAlertInbox (AlertHistory seed + live alert:triggered), with an optional
 * chime + browser push; notification channels (custom targets) via NotificationsTab.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {Function} props.wsRequest
 * @param {boolean} props.wsConnected
 * @param {object[]} props.aircraft
 * @param {(hex: string, callsign?: string) => void} [props.onOpenMap]
 * @param {(hex: string, callsign?: string) => void} [props.onFullDetail]
 */
export function AlertsScreen({
  apiBase,
  wsRequest,
  wsConnected,
  aircraft,
  onOpenMap,
  onFullDetail,
}) {
  // Deep-linked view state (#alerts?tab=&q=&priority=&status=). The rule
  // filters live in useAlertRules; the URL is the source of truth and its
  // values are pushed into the hook's setters below.
  const [tab, setTab] = useHashParamState('tab', 'rules', { replace: false });
  const [q, setQ] = useHashParamState('q', '');
  const [priority, setPriority] = useHashParamState('priority', 'all');
  const [statusF, setStatusF] = useHashParamState('status', 'all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [local, setLocal] = useState(loadLocal);
  const [detailAlert, setDetailAlert] = useState(null);

  const {
    filteredRules,
    rules,
    realtimeAlerts,
    refetch,
    setSearchQuery,
    setPriorityFilter,
    setStatusFilter,
    handleToggle,
    handleDelete,
    pendingDelete,
    handleUndoDelete,
  } = useAlertRules({ apiBase, wsRequest, wsConnected, onToast: (msg) => toast(msg) });

  // Mirror the URL-backed filters into useAlertRules (one-way: URL → hook) so
  // filteredRules recomputes on deep-link, reload, and back/forward.
  useEffect(() => setSearchQuery(q), [q, setSearchQuery]);
  useEffect(() => setPriorityFilter(priority), [priority, setPriorityFilter]);
  useEffect(() => setStatusFilter(statusF), [statusF, setStatusFilter]);

  const { items, unreadCount, markRead, markAllRead, clear } = useAlertInbox({
    realtimeAlerts,
    enabled: true,
  });

  // Local sink: chime + browser push on each newly-arrived live alert.
  const lastSeenKeyRef = useRef(null);
  useEffect(() => {
    const top = (realtimeAlerts || [])[0];
    if (!top) return;
    const key = inboxKey(top);
    if (lastSeenKeyRef.current === null) {
      // Prime on first render so we don't chime for the initial snapshot.
      lastSeenKeyRef.current = key;
      return;
    }
    if (key === lastSeenKeyRef.current) return;
    lastSeenKeyRef.current = key;

    if (local.sound) playAlertSound(top.priority);
    if (
      local.browser &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      const cs = top.callsign || top.icao || top.aircraft?.hex || 'aircraft';
      new Notification(top.rule_name || 'SkySpy Alert', {
        body: top.message || `${cs} triggered an alert`,
        icon: '/static/favicon.svg',
        tag: `alert-${key}`,
      });
    }
  }, [realtimeAlerts, local.sound, local.browser]);

  const setLocalSetting = (id, on) => {
    const next = { ...local, [id]: on };
    setLocal(next);
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
    } catch {
      // persistence best-effort
    }
    if (id === 'browser' && on && typeof Notification !== 'undefined') {
      Notification.requestPermission();
    }
    toast(
      `${id === 'sound' ? 'Alert sound' : 'Desktop notifications'} ${on ? 'enabled' : 'disabled'}`
    );
  };

  const onCreate = async (payload) => {
    if (!wsRequest || !wsConnected) {
      toast('Not connected to server');
      return;
    }
    const result = await wsRequest('alert-rule-create', payload);
    if (result?.error) {
      toast('Failed to create rule');
      return;
    }
    toast('Alert rule created');
    refetch();
  };

  const onUpdate = async (payload) => {
    if (!wsRequest || !wsConnected) {
      toast('Not connected to server');
      return;
    }
    const result = await wsRequest('alert-rule-update', payload);
    if (result?.error) {
      toast('Failed to update rule');
      return;
    }
    toast('Alert rule updated');
    refetch();
  };

  const openCreate = () => {
    setEditingRule(null);
    setModalOpen(true);
  };
  const openEdit = (rule) => {
    setEditingRule(rule);
    setModalOpen(true);
  };

  const openDetail = (alert) => {
    setDetailAlert(alert);
    // Mark read when opened (server ack + local fallback).
    if (alert?.__unread) markRead(alert);
  };

  const tabs = [
    { key: 'rules', label: 'Rules', count: rules.length },
    { key: 'inbox', label: 'Inbox', count: unreadCount || null },
    { key: 'history', label: 'History', count: items.length || null },
    { key: 'notif', label: 'Notifications', count: null },
  ];

  return (
    <div className="v2-alerts" data-testid="v2-alerts">
      {/* Tabs + actions */}
      <div className="v2-alerts__topbar">
        <div className="v2-alerts__tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`v2-alerts__tab ${tab === t.key ? 'v2-alerts__tab--on' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.count != null && <span className="v2-alerts__tab-count">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="v2-alerts__topbar-spacer" />
        <button
          type="button"
          className="v2-btn"
          onClick={openCreate}
          data-testid="v2-alerts-new-rule"
        >
          <Icon name="plus" size={15} strokeWidth={2.2} />
          New Rule
        </button>
      </div>

      {/* Undo bar for a pending rule delete */}
      {pendingDelete?.rule && (
        <div className="v2-alerts__undo" role="status">
          <Icon name="trash" size={15} strokeWidth={1.8} />
          <span>
            Rule <strong>{pendingDelete.rule.name}</strong> deleted
          </span>
          <button type="button" className="v2-btn v2-alerts__undo-btn" onClick={handleUndoDelete}>
            <Icon name="refresh-cw" size={13} strokeWidth={1.9} />
            Undo
          </button>
        </div>
      )}

      {/* Rules tab */}
      {tab === 'rules' && (
        <>
          <div className="v2-alerts__filters">
            <div className="v2-alerts__search">
              <Icon name="search" size={15} strokeWidth={1.8} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search rules…"
                aria-label="Search rules"
              />
            </div>
            <select
              className="v2-select"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              aria-label="Priority filter"
            >
              <option value="all">All Priorities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
              <option value="emergency">Emergency</option>
            </select>
            <select
              className="v2-select"
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
              aria-label="Status filter"
            >
              <option value="all">All Status</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            <div className="v2-alerts__topbar-spacer" />
            <span className="v2-alerts__shown">{filteredRules.length} rules</span>
          </div>

          <div className="v2-alerts__scroll">
            {filteredRules.length === 0 ? (
              <div className="v2-alerts__empty">
                <Icon name="bell" size={38} strokeWidth={1.3} />
                <span>No rules match your filters</span>
                <button type="button" className="v2-alerts__create" onClick={openCreate}>
                  <Icon name="plus" size={15} strokeWidth={2.2} />
                  Create Rule
                </button>
              </div>
            ) : (
              <div className="v2-alerts__grid">
                {filteredRules.map((r) => {
                  const pc = priorityConfig(r.priority);
                  return (
                    <div
                      key={r.id}
                      className="v2-alerts__rule"
                      style={{ borderLeftColor: pc.color, opacity: r.enabled ? 1 : 0.55 }}
                      data-testid={`v2-alerts-rule-${r.id}`}
                    >
                      <div className="v2-alerts__rule-head">
                        <span
                          className="v2-alerts__rule-icon"
                          style={{
                            color: pc.color,
                            background: `color-mix(in srgb, ${pc.color} 14%, transparent)`,
                          }}
                        >
                          <Icon
                            name={RULE_ICONS[r.priority] || 'bell'}
                            size={18}
                            strokeWidth={1.8}
                          />
                        </span>
                        <div className="v2-alerts__rule-titles">
                          <div className="v2-alerts__rule-name">{r.name}</div>
                          <div className="v2-alerts__rule-desc">
                            {r.description || 'Custom rule'}
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
                      </div>
                      <div className="v2-alerts__rule-cond">{ruleCondSummary(r)}</div>
                      <div className="v2-alerts__rule-foot">
                        <span className="v2-alerts__rule-stat">
                          <Icon name="zap" size={13} strokeWidth={1.7} />
                          <strong className="v2-mono">
                            {r.trigger_count ?? r.triggers ?? 0}
                          </strong>{' '}
                          triggers
                        </span>
                        <span className="v2-alerts__rule-stat">
                          <Icon name="clock" size={13} strokeWidth={1.7} />
                          {relTime(r.last_triggered)}
                        </span>
                        <div className="v2-alerts__topbar-spacer" />
                        <button
                          type="button"
                          className="v2-iconbtn"
                          onClick={() => openEdit(r)}
                          aria-label={`Edit ${r.name}`}
                          title="Edit rule"
                        >
                          <Icon name="edit" size={15} strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          className="v2-iconbtn v2-alerts__rule-del"
                          onClick={() => handleDelete(r)}
                          aria-label={`Delete ${r.name}`}
                          title="Delete rule"
                        >
                          <Icon name="trash" size={15} strokeWidth={1.8} />
                        </button>
                        <Switch
                          checked={!!r.enabled}
                          onCheckedChange={() => handleToggle(r)}
                          label={`Toggle ${r.name}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Inbox tab (local sink) */}
      {tab === 'inbox' && (
        <InboxTab
          items={items}
          unreadCount={unreadCount}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
          onClear={clear}
          onOpen={openDetail}
        />
      )}

      {/* History tab (chronological log) */}
      {tab === 'history' && (
        <div className="v2-alerts__scroll v2-alerts__scroll--padded">
          {items.length === 0 ? (
            <div className="v2-alerts__empty">
              <Icon name="clock" size={38} strokeWidth={1.3} />
              <span>No alerts fired yet</span>
            </div>
          ) : (
            <div className="v2-alerts__feed">
              {items.map((f) => {
                const pri = f.priority || f.severity || 'info';
                const pc = priorityConfig(pri);
                const cs = f.callsign || f.aircraft?.flight || f.icao || f.aircraft?.hex || '—';
                const ts = f.timestamp || f.triggered_at || f.created_at;
                return (
                  <div
                    key={f.__key}
                    className="v2-alerts__fired v2-alerts__fired--click"
                    style={{ borderLeftColor: pc.color }}
                    onClick={() => openDetail(f)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openDetail(f);
                      }
                    }}
                  >
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
                        Triggered by{' '}
                        <span className="v2-alerts__fired-cs">{String(cs).trim()}</span>
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
                    <span className="v2-alerts__fired-time">
                      {ts ? new Date(ts).toLocaleTimeString('en-US', { hour12: false }) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Notifications tab (local sink toggles + channel manager) */}
      {tab === 'notif' && <NotificationsTab local={local} onLocalChange={setLocalSetting} />}

      <CreateRuleModal
        open={modalOpen}
        onOpenChange={(o) => {
          setModalOpen(o);
          if (!o) setEditingRule(null);
        }}
        onCreate={onCreate}
        onUpdate={onUpdate}
        rule={editingRule}
        aircraft={aircraft}
      />

      <AlertDetailModal
        open={!!detailAlert}
        onOpenChange={(o) => !o && setDetailAlert(null)}
        alert={detailAlert}
        apiBase={apiBase}
        onOpenMap={(hex, call) => {
          setDetailAlert(null);
          onOpenMap?.(hex, call);
        }}
        onFullDetail={(hex, call) => {
          setDetailAlert(null);
          onFullDetail?.(hex, call);
        }}
      />
    </div>
  );
}
