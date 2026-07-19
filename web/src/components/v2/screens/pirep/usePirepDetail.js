import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

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

function asList(data) {
  if (Array.isArray(data)) return data;
  for (const k of ['data', 'pireps', 'results']) if (Array.isArray(data?.[k])) return data[k];
  return [];
}

/**
 * Data for the PIREP detail page. All three feeds already exist — no PIREP-
 * specific detail/brief endpoints are needed:
 *  - `listQ`  the full PIREP set (record lookup + adjacent-report distance calc)
 *  - `record` the matched report (`pirep_id === pirepId`)
 *  - `summaryQ` the opt-in LLM/rule summary (`{ summary, source, severity, hazards }`)
 *  - `aircraftQ` current live traffic (closest-planes list + map darts)
 *
 * @param {string} apiBase
 * @param {string} pirepId
 */
export function usePirepDetail(apiBase, pirepId) {
  const listQ = useQuery({
    queryKey: ['v2-pireps-all', apiBase],
    queryFn: () => getJson(`${apiBase}/api/v1/aviation/pireps/?limit=200`),
    staleTime: 60 * 1000,
  });

  const list = useMemo(() => asList(listQ.data), [listQ.data]);
  const record = useMemo(
    () => list.find((p) => (p.pirep_id ?? String(p.id)) === pirepId) || null,
    [list, pirepId]
  );

  const summaryQ = useQuery({
    queryKey: ['v2-pirep-summary', apiBase, pirepId],
    enabled: !!pirepId,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      getJson(`${apiBase}/api/v1/aviation/pireps/${encodeURIComponent(pirepId)}/summary`),
  });

  const aircraftQ = useQuery({
    queryKey: ['v2-pirep-aircraft', apiBase],
    queryFn: async () => {
      const json = await getJson(`${apiBase}/api/v1/aircraft/`);
      return Array.isArray(json?.aircraft) ? json.aircraft : [];
    },
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
  });

  return { listQ, list, record, summaryQ, aircraftQ };
}

export default usePirepDetail;
