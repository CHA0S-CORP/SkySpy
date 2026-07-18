import { useQuery } from '@tanstack/react-query';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  return res.json();
}

/**
 * Data for the NOTAM detail page: the full record plus the structured LLM
 * briefing. Both are keyed on the (slash-safe, query-param) notam id.
 *
 * @param {string} apiBase
 * @param {string} notamId
 */
export function useNotamDetail(apiBase, notamId) {
  const enc = encodeURIComponent(notamId || '');

  const record = useQuery({
    queryKey: ['v2-notam-detail', apiBase, notamId],
    enabled: !!notamId,
    queryFn: () => getJson(`${apiBase}/api/v1/notams/detail?notam_id=${enc}`),
  });

  const brief = useQuery({
    queryKey: ['v2-notam-brief', apiBase, notamId],
    enabled: !!notamId,
    // One (cached) LLM call — don't retry the model on transient misses.
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: () => getJson(`${apiBase}/api/v1/notams/brief?notam_id=${enc}`),
  });

  return { record, brief };
}
