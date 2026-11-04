import { useFeatureQuery } from '../../../../hooks/queries/useFeatureQuery';

export const RANGE_HOURS = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };

async function getJson(fetch, url, fallback = []) {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    const ct = res.headers.get('content-type');
    if (!ct || !ct.includes('application/json')) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

function asList(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  return [];
}

/**
 * REST data for the History screen, one query per tab (React Query cached,
 * keyed by time range). All client-side filtering happens in historyModel.
 *
 * @param {string} apiBase
 * @param {string} range - '1h' | '6h' | '24h' | '48h' | '7d'
 * @param {string} tab
 * @param {string} [archiveIcao] - optional airport ICAO filter for the Archive tab
 */
export function useHistoryData(apiBase, range, tab, archiveIcao = '') {
  const hours = RANGE_HOURS[range] ?? 24;

  const sessions = useFeatureQuery('history', {
    queryKey: ['v2-history-sessions', apiBase, hours],
    queryFn: async ({ fetch }) =>
      asList(
        await getJson(fetch, `${apiBase}/api/v1/sessions/?hours=${hours}&limit=200`),
        'sessions',
        'results'
      ),
  });

  const safety = useFeatureQuery('safety', {
    queryKey: ['v2-history-safety', apiBase, hours],
    queryFn: async ({ fetch }) =>
      asList(
        await getJson(fetch, `${apiBase}/api/v1/safety/events/?hours=${hours}&limit=200`),
        'events',
        'results'
      ),
  });

  const stats = useFeatureQuery('history', {
    queryKey: ['v2-history-stats', apiBase, hours],
    queryFn: async ({ fetch }) =>
      getJson(fetch, `${apiBase}/api/v1/history/stats/?hours=${hours}`, {}),
  });

  const sightings = useFeatureQuery('history', {
    queryKey: ['v2-history-sightings', apiBase, hours],
    enabled: tab === 'sightings',
    queryFn: async ({ fetch }) =>
      asList(
        await getJson(fetch, `${apiBase}/api/v1/sightings/?hours=${hours}&limit=200`),
        'sightings',
        'results'
      ),
  });

  const acars = useFeatureQuery('acars', {
    queryKey: ['v2-history-acars', apiBase, hours],
    enabled: tab === 'acars',
    queryFn: async ({ fetch }) =>
      asList(
        await getJson(fetch, `${apiBase}/api/v1/acars/?hours=${hours}&limit=100`),
        'messages',
        'results'
      ),
  });

  const notams = useFeatureQuery('aircraft', {
    queryKey: ['v2-history-notams', apiBase],
    enabled: tab === 'notams',
    queryFn: async ({ fetch }) => {
      const data = await getJson(fetch, `${apiBase}/api/v1/notams/?limit=300`, {});
      return asList(data, 'notams', 'results');
    },
  });

  // The NOTAMs archive tab also surfaces national TFRs (separate feed).
  const notamTfrs = useFeatureQuery('aircraft', {
    queryKey: ['v2-history-notam-tfrs', apiBase],
    enabled: tab === 'notams',
    queryFn: async ({ fetch }) => {
      const data = await getJson(fetch, `${apiBase}/api/v1/notams/tfrs/`, {});
      return asList(data, 'tfrs', 'results');
    },
  });

  const pireps = useFeatureQuery('weather', {
    queryKey: ['v2-history-pireps', apiBase],
    enabled: tab === 'pireps',
    queryFn: async ({ fetch }) => {
      const data = await getJson(fetch, `${apiBase}/api/v1/aviation/pireps/`, {});
      return asList(data, 'data', 'pireps', 'results');
    },
  });

  // --- Archive tab (searchable NOTAM + PIREP archive) ---
  const archiveEnabled = tab === 'archive';
  const icao = (archiveIcao || '').trim().toUpperCase();

  const notamStats = useFeatureQuery('aircraft', {
    queryKey: ['v2-archive-notam-stats', apiBase],
    enabled: archiveEnabled,
    queryFn: async ({ fetch }) => getJson(fetch, `${apiBase}/api/v1/notams/stats/`, {}),
  });

  const archiveNotams = useFeatureQuery('aircraft', {
    queryKey: ['v2-archive-notams', apiBase, icao],
    enabled: archiveEnabled,
    queryFn: async ({ fetch }) => {
      // When an airport is entered use the dedicated airport endpoint, else the
      // general NOTAM list (both return { notams: [...] }).
      const url = icao
        ? `${apiBase}/api/v1/notams/airport/${encodeURIComponent(icao)}/`
        : `${apiBase}/api/v1/notams/?limit=200`;
      const data = await getJson(fetch, url, {});
      return asList(data, 'notams', 'results');
    },
  });

  const tfrs = useFeatureQuery('aircraft', {
    queryKey: ['v2-archive-tfrs', apiBase],
    enabled: archiveEnabled,
    queryFn: async ({ fetch }) => {
      const data = await getJson(fetch, `${apiBase}/api/v1/notams/tfrs/`, {});
      return asList(data, 'tfrs', 'results');
    },
  });

  const archivePireps = useFeatureQuery(icao ? 'history' : 'weather', {
    queryKey: ['v2-archive-pireps', apiBase, icao],
    enabled: archiveEnabled,
    queryFn: async ({ fetch }) => {
      // The rich /aviation/pireps/ payload carries the backend `decoded` block
      // and hazard bands the viz components need; the archive endpoint is the
      // filterable fallback when an airport is selected.
      const url = icao
        ? `${apiBase}/api/v1/archive/pireps/?icao=${encodeURIComponent(icao)}&limit=200`
        : `${apiBase}/api/v1/aviation/pireps/?limit=200`;
      const data = await getJson(fetch, url, {});
      return asList(data, 'data', 'pireps', 'results');
    },
  });

  return {
    sessions,
    safety,
    stats,
    sightings,
    acars,
    notams,
    notamTfrs,
    pireps,
    notamStats,
    archiveNotams,
    tfrs,
    archivePireps,
  };
}
