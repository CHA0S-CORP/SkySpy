import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSocketIOAudio } from '../../../../hooks/socket';

const RANGE_HOURS = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };

/**
 * Radio feed: REST seed (/api/v1/audio) merged with live audio:transmission /
 * audio:transcription_* events from the /audio socket namespace
 * (via the existing useSocketIOAudio hook). Live records win on id collisions
 * so transcript fills replace pending rows.
 *
 * @param {string} apiBase
 * @param {string} range - '1h' | '6h' | '24h' | '48h' | '7d'
 */
export function useRadioFeed(apiBase, range) {
  const hours = RANGE_HOURS[range] ?? 24;
  const { socketConnected, realtimeTransmissions } = useSocketIOAudio(apiBase);

  const { data: seed, isLoading } = useQuery({
    queryKey: ['v2-radio', apiBase, hours],
    refetchInterval: 60000,
    queryFn: async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/audio?hours=${hours}&limit=100`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.transmissions || data.results || (Array.isArray(data) ? data : []);
      } catch {
        return [];
      }
    },
  });

  const transmissions = useMemo(() => {
    const byId = new Map();
    for (const t of seed || []) byId.set(t.id, t);
    for (const t of realtimeTransmissions || []) {
      if (t?.id != null) byId.set(t.id, { ...byId.get(t.id), ...t });
    }
    return [...byId.values()].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
  }, [seed, realtimeTransmissions]);

  return { transmissions, socketConnected, isLoading };
}
