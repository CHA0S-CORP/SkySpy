import { useQuery } from '@tanstack/react-query';

const REFETCH_MS = 15000;

async function getJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type');
    if (!ct || !ct.includes('application/json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * All System-screen data via REST + React Query (15s refetch).
 * Individual endpoint failures resolve to null — the screen renders what it has.
 *
 * @param {string} apiBase
 */
export function useSystemData(apiBase) {
  return useQuery({
    queryKey: ['v2-system', apiBase],
    refetchInterval: REFETCH_MS,
    queryFn: async () => {
      const [status, health, info, databases, safetyStatus, acarsStats, acarsStatus, notifConfig] =
        await Promise.all([
          getJson(`${apiBase}/api/v1/system/status`),
          getJson(`${apiBase}/api/v1/system/health`),
          getJson(`${apiBase}/api/v1/system/info`),
          getJson(`${apiBase}/api/v1/system/databases`),
          getJson(`${apiBase}/api/v1/safety/events/monitor/status`),
          getJson(`${apiBase}/api/v1/acars/stats?hours=1`),
          getJson(`${apiBase}/api/v1/acars/status`),
          getJson(`${apiBase}/api/v1/notifications/config`),
        ]);
      return {
        status,
        health,
        info,
        databases,
        safetyStatus,
        acarsStats,
        acarsStatus,
        notifConfig,
      };
    },
  });
}

/** POST helper for the Test/Start actions (trailing slash required by DRF router). */
export async function postAction(url) {
  try {
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type');
    if (!ct || !ct.includes('application/json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}
