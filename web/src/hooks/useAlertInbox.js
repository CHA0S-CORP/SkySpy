import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

const READ_KEY = 'skyspy-alert-read';
const READ_CAP = 500;

/**
 * Stable content key for an alert. Live socket payloads carry no id and REST
 * rows do, so an id-based key never matches across the two sources. Both share
 * rule + aircraft + minute bucket (rule cooldowns are >= 1 min, so this cannot
 * merge two real firings of the same rule+aircraft). Matches the dedupe key the
 * v2 History tab used.
 */
export function inboxKey(a) {
  const ts = Date.parse(a?.timestamp ?? a?.triggered_at ?? '') || 0;
  const rule = a?.rule_id ?? a?.rule_name ?? a?.ruleName ?? '?';
  const icao = a?.icao ?? a?.icao_hex ?? a?.aircraft?.hex ?? '?';
  return `${rule}-${icao}-${Math.floor(ts / 60000)}`;
}

function loadReadSet() {
  try {
    const arr = JSON.parse(localStorage.getItem(READ_KEY));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistReadSet(set) {
  try {
    // Cap growth: keep the most recent keys (Set preserves insertion order).
    const arr = [...set].slice(-READ_CAP);
    localStorage.setItem(READ_KEY, JSON.stringify(arr));
  } catch {
    // best-effort
  }
}

/**
 * Server-backed notification inbox built on AlertHistory. Seeds from
 * GET /api/v1/alerts/history/, merges live alert:triggered events, and tracks
 * read state via the acknowledge API with a localStorage fallback for the
 * anonymous/public-mode case (where the server may refuse the mutation).
 *
 * @param {object} opts
 * @param {object[]} opts.realtimeAlerts - live alert:triggered payloads (newest first)
 * @param {boolean} [opts.enabled] - gate the history fetch
 */
export function useAlertInbox({ realtimeAlerts = [], enabled = true }) {
  const queryClient = useQueryClient();
  const [readSet, setReadSet] = useState(loadReadSet);

  const { data: historyData, refetch } = useQuery({
    queryKey: ['alert-inbox', 'history'],
    enabled,
    refetchInterval: 60000,
    queryFn: () => api.getAlertHistory({ hours: 168, limit: 200 }),
  });

  const historyItems = useMemo(() => {
    const d = historyData;
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (Array.isArray(d.results)) return d.results;
    if (Array.isArray(d.history)) return d.history;
    if (Array.isArray(d.alerts)) return d.alerts;
    return [];
  }, [historyData]);

  // Merge live + server rows, dedup on content key (prefer the server row so we
  // keep its id + acknowledged flag).
  const items = useMemo(() => {
    const byKey = new Map();
    for (const a of realtimeAlerts || []) {
      const k = inboxKey(a);
      if (!byKey.has(k)) byKey.set(k, { ...a, __key: k });
    }
    for (const row of historyItems) {
      const k = inboxKey(row);
      // Server row wins (has id/acknowledged); merge over any live entry.
      byKey.set(k, { ...(byKey.get(k) || {}), ...row, __key: k });
    }
    const merged = [...byKey.values()].map((a) => {
      const acknowledged = a.acknowledged === true || readSet.has(a.__key);
      return { ...a, __unread: !acknowledged };
    });
    merged.sort(
      (x, y) =>
        (Date.parse(y.timestamp ?? y.triggered_at ?? '') || 0) -
        (Date.parse(x.timestamp ?? x.triggered_at ?? '') || 0)
    );
    return merged.slice(0, 200);
  }, [realtimeAlerts, historyItems, readSet]);

  const unreadCount = useMemo(() => items.filter((a) => a.__unread).length, [items]);

  const markLocalRead = useCallback((keys) => {
    // Keep the updater pure — the effect below persists on every readSet change,
    // so persisting inside the updater was redundant AND double-wrote in
    // StrictMode (updaters run twice in dev).
    setReadSet((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  }, []);

  const markRead = useCallback(
    async (alert) => {
      const key = alert.__key || inboxKey(alert);
      markLocalRead([key]); // optimistic + anon fallback
      // Server rows have a numeric id → acknowledge server-side (best-effort).
      // Live-only events (no id) rely on the localStorage read set above.
      if (alert.id != null) {
        try {
          await api.acknowledgeAlert(alert.id);
          queryClient.invalidateQueries({ queryKey: ['alert-inbox', 'history'] });
        } catch {
          // anon/public mode may 401/403 — localStorage fallback already applied
        }
      }
    },
    [markLocalRead, queryClient]
  );

  const markAllRead = useCallback(async () => {
    markLocalRead(items.map((a) => a.__key));
    try {
      await api.acknowledgeAllAlerts();
      queryClient.invalidateQueries({ queryKey: ['alert-inbox', 'history'] });
    } catch {
      // localStorage fallback already applied
    }
  }, [items, markLocalRead, queryClient]);

  const clear = useCallback(async () => {
    try {
      await api.clearAlertHistory();
    } catch {
      // best-effort
    }
    setReadSet(new Set());
    // The readSet effect persists this change; no explicit write needed here.
    queryClient.invalidateQueries({ queryKey: ['alert-inbox', 'history'] });
    refetch();
  }, [queryClient, refetch]);

  // Trim readSet if history has rotated away (avoid unbounded growth handled by cap).
  useEffect(() => {
    persistReadSet(readSet);
  }, [readSet]);

  return { items, unreadCount, markRead, markAllRead, clear, refetch };
}
