import { useQuery } from '@tanstack/react-query';

export const RANGE_HOURS = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };

async function getJson(url, fallback) {
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

function milParam(military) {
  if (military === 'mil') return '&military=true';
  if (military === 'civ') return '&military=false';
  return '';
}

/**
 * REST data for the Advanced Analytics screen. New /analytics/ endpoints power
 * the explorer + matrix + cross-domain table; existing stats endpoints power the
 * curated / geographic / time panels. All React Query cached, keyed by inputs.
 *
 * @param {string} apiBase
 * @param {{hours:number, xField:string, yField:string, military:string}} opts
 */
export function useAnalyticsData(apiBase, { hours, xField, yField, military }) {
  const mil = milParam(military);

  const fields = useQuery({
    queryKey: ['v2-analytics-fields', apiBase],
    queryFn: async () => (await getJson(`${apiBase}/api/v1/analytics/`, {})).fields || [],
  });

  const scatter = useQuery({
    queryKey: ['v2-analytics-scatter', apiBase, hours, xField, yField, military],
    queryFn: async () =>
      getJson(
        `${apiBase}/api/v1/analytics/scatter/?x_field=${xField}&y_field=${yField}&hours=${hours}${mil}`,
        {}
      ),
  });

  const matrix = useQuery({
    queryKey: ['v2-analytics-matrix', apiBase, hours, military],
    queryFn: async () => getJson(`${apiBase}/api/v1/analytics/matrix/?hours=${hours}${mil}`, {}),
  });

  const crossDomain = useQuery({
    queryKey: ['v2-analytics-cross', apiBase, hours],
    queryFn: async () =>
      getJson(`${apiBase}/api/v1/analytics/cross-domain/?hours=${hours}&limit=20`, {}),
  });

  const correlation = useQuery({
    queryKey: ['v2-analytics-corr', apiBase, hours],
    queryFn: async () =>
      getJson(`${apiBase}/api/v1/history/analytics/correlation/?hours=${hours}`, {}),
  });

  const geography = useQuery({
    queryKey: ['v2-analytics-geo', apiBase, hours],
    queryFn: async () =>
      getJson(`${apiBase}/api/v1/stats/geographic/countries/?hours=${hours}&limit=8`, {}),
  });

  const operators = useQuery({
    queryKey: ['v2-analytics-ops', apiBase, hours],
    queryFn: async () =>
      getJson(`${apiBase}/api/v1/stats/geographic/operators/?hours=${hours}&limit=8`, {}),
  });

  const busiestHours = useQuery({
    queryKey: ['v2-analytics-hours', apiBase, hours],
    queryFn: async () =>
      getJson(`${apiBase}/api/v1/stats/flight-patterns/busiest-hours/?hours=${hours}`, {}),
  });

  const routes = useQuery({
    queryKey: ['v2-analytics-routes', apiBase, hours],
    queryFn: async () =>
      getJson(`${apiBase}/api/v1/stats/flight-patterns/routes/?hours=${hours}&limit=8`, {}),
  });

  const aircraftTypes = useQuery({
    queryKey: ['v2-analytics-types', apiBase, hours],
    queryFn: async () =>
      getJson(`${apiBase}/api/v1/stats/flight-patterns/aircraft-types/?hours=${hours}&limit=8`, {}),
  });

  const militaryBreakdown = useQuery({
    queryKey: ['v2-analytics-mil', apiBase, hours],
    queryFn: async () =>
      getJson(`${apiBase}/api/v1/stats/geographic/military-breakdown/?hours=${hours}`, {}),
  });

  return {
    fields,
    scatter,
    matrix,
    crossDomain,
    correlation,
    geography,
    operators,
    busiestHours,
    routes,
    aircraftTypes,
    militaryBreakdown,
  };
}
