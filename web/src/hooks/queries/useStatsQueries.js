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
    queryFn: () => api.get('/stats/current/'),
    staleTime: 10 * 1000, // Match refetchInterval
    refetchInterval: 10 * 1000,
    ...options,
  });
}

export function useSessionStats(options = {}) {
  return useQuery({
    queryKey: statsKeys.session(),
    queryFn: () => api.get('/stats/session/'),
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useRecordStats(options = {}) {
  return useQuery({
    queryKey: statsKeys.records(),
    queryFn: () => api.get('/stats/records/'),
    staleTime: 60 * 1000,
    ...options,
  });
}
