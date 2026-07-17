import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon, Switch, toast } from '../../primitives';
import { useAlertRules } from '../../../../hooks/useAlertRules';
import { CreateRuleModal } from './CreateRuleModal';
import { priorityConfig, ruleCondSummary } from './alertsModel';

const RULE_ICONS = {
  emergency: 'alert-triangle',
  critical: 'shield',
  warning: 'shield',
  info: 'map-pin',
};

const CHANNEL_DEFS = [
  {
    id: 'browser',
    name: 'Browser Push',
    detail: 'Desktop notifications',
    color: 'var(--accent2)',
    icon: 'bell',
  },
  {
    id: 'sound',
    name: 'Audio Alerts',
    detail: 'Chime on trigger',
    color: 'var(--accent)',
    icon: 'volume',
  },
  {
    id: 'webhook',
    name: 'Webhook',
    detail: 'POST to configured URL',
    color: 'var(--warn)',
    icon: 'link',
  },
  {
    id: 'email',
    name: 'Email',
    detail: 'Via notification server',
    color: 'var(--mil)',
    icon: 'mail',
  },
];

const CHANNELS_KEY = 'skyspy-alert-channels';

function loadChannels() {
  try {
    return (
      JSON.parse(localStorage.getItem(CHANNELS_KEY)) || {
        browser: false,
        sound: true,
        webhook: false,
        email: false,
      }
    );
  } catch {
    return { browser: false, sound: true, webhook: false, email: false };
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
 * v2 Alerts screen (designs/Alerts.dc.html): Rules / History / Notifications
 * tabs + Create Alert Rule modal. Rules via useAlertRules (REST list +
 * alert-rule-* socket RPC), history via REST seed + live alert:triggered feed.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {Function} props.wsRequest
 * @param {boolean} props.wsConnected
 * @param {object[]} props.aircraft
 */
export function AlertsScreen({ apiBase, wsRequest, wsConnected, aircraft }) {
  const [tab, setTab] = useState('rules');
  const [modalOpen, setModalOpen] = useState(false);
  const [channels, setChannels] = useState(loadChannels);

  const {
    filteredRules,
    rules,
    realtimeAlerts,
    refetch,
    searchQuery,
    setSearchQuery,
    priorityFilter,
    setPriorityFilter,
    statusFilter,
    setStatusFilter,
    handleToggle,
  } = useAlertRules({ apiBase, wsRequest, wsConnected, onToast: (msg) => toast(msg) });

  const { data: historyData } = useQuery({
    queryKey: ['v2-alert-history', apiBase],
    enabled: tab === 'history',
    refetchInterval: 60000,
    queryFn: async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/alerts/history/`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.results || data.alerts || (Array.isArray(data) ? data : []);
      } catch {
        return [];
      }
    },
  });

  const fired = useMemo(() => {
    const seed = historyData || [];
    const live = realtimeAlerts || [];
    const seen = new Set();
    const all = [...live, ...seed].filter((f) => {
      // Live socket payloads carry no id, REST rows do - an id-based key
      // never matches across the two sources and every alert rendered twice.
      // Both share rule_id/icao/timestamp, so dedup on content (bucketed to
      // a minute; rule cooldowns are >= 1 min so this cannot merge two real
      // firings of the same rule+aircraft).
      const ts = Date.parse(f.timestamp ?? f.triggered_at ?? '') || 0;
      const key = `${f.rule_id ?? f.rule_name ?? f.ruleName}-${f.icao ?? f.icao_hex}-${Math.floor(ts / 60000)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return all.slice(0, 100);
  }, [historyData, realtimeAlerts]);

  const setChannel = (id, on) => {
    const next = { ...channels, [id]: on };
    setChannels(next);
    try {
      localStorage.setItem(CHANNELS_KEY, JSON.stringify(next));
    } catch {
      // persistence best-effort
    }
    if (id === 'browser' && on && typeof Notification !== 'undefined') {
      Notification.requestPermission();
    }
    toast(`${CHANNEL_DEFS.find((c) => c.id === id)?.name} ${on ? 'enabled' : 'disabled'}`);
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

  const tabs = [
    { key: 'rules', label: 'Rules', count: rules.length },
    { key: 'history', label: 'History', count: fired.length || null },
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
          onClick={() => setModalOpen(true)}
          data-testid="v2-alerts-new-rule"
        >
          <Icon name="plus" size={15} strokeWidth={2.2} />
          New Rule
        </button>
      </div>

      {/* Rules tab */}
      {tab === 'rules' && (
        <>
          <div className="v2-alerts__filters">
            <div className="v2-alerts__search">
              <Icon name="search" size={15} strokeWidth={1.8} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search rules…"
                aria-label="Search rules"
              />
            </div>
            <select
              className="v2-select"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
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
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
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
                <button
                  type="button"
                  className="v2-alerts__create"
                  onClick={() => setModalOpen(true)}
                >
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

      {/* History tab */}
      {tab === 'history' && (
        <div className="v2-alerts__scroll v2-alerts__scroll--padded">
          {fired.length === 0 ? (
            <div className="v2-alerts__empty">
              <Icon name="clock" size={38} strokeWidth={1.3} />
              <span>No alerts fired yet</span>
            </div>
          ) : (
            <div className="v2-alerts__feed">
              {fired.map((f, i) => {
                const pri = f.priority || f.severity || 'info';
                const pc = priorityConfig(pri);
                const cs = f.callsign || f.aircraft?.flight || f.icao || f.aircraft?.hex || '—';
                const ts = f.timestamp || f.triggered_at || f.created_at;
                return (
                  <div
                    key={f.id ?? i}
                    className="v2-alerts__fired"
                    style={{ borderLeftColor: pc.color }}
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

      {/* Notifications tab */}
      {tab === 'notif' && (
        <div className="v2-alerts__scroll v2-alerts__scroll--padded">
          <div className="v2-alerts__channels">
            {CHANNEL_DEFS.map((c) => (
              <div key={c.id} className="v2-alerts__channel">
                <span className="v2-alerts__channel-icon" style={{ color: c.color }}>
                  <Icon name={c.icon} size={19} strokeWidth={1.7} />
                </span>
                <div className="v2-alerts__channel-body">
                  <div className="v2-alerts__channel-name">{c.name}</div>
                  <div className="v2-alerts__channel-detail">{c.detail}</div>
                </div>
                <Switch
                  checked={!!channels[c.id]}
                  onCheckedChange={(on) => setChannel(c.id, on)}
                  label={c.name}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <CreateRuleModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreate={onCreate}
        aircraft={aircraft}
      />
    </div>
  );
}
