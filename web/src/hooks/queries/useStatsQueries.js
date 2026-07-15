import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

export const statsKeys = {
  all: ['stats'],
  current: () => [...statsKeys.all, 'current'],
  session: () => [...statsKeys.all, 'session'],
  records: () => [...statsKeys.all, 'records'],
};

export function useStats(options = {}) {
  return useQuery({
    queryKey: statsKeys.current(),
    // Current stats are served by /history/stats/ (there is no /stats/current/)
    queryFn: () => api.getStats(),
    staleTime: 10 * 1000, // Match refetchInterval
    refetchInterval: 10 * 1000,
    ...options,
  });
}

export function useSessionStats(options = {}) {
  return useQuery({
    queryKey: statsKeys.session(),
    // Session stats are served by /sessions/ (there is no /stats/session/)
    queryFn: () => api.getStatsSession(),
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useRecordStats(options = {}) {
  return useQuery({
    queryKey: statsKeys.records(),
    // Records are served by /history/top-performers/ (there is no /stats/records/)
    queryFn: () => api.getStatsRecords(),
    staleTime: 60 * 1000,
    ...options,
  });
}
