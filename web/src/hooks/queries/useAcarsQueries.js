import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

export const acarsKeys = {
  all: ['acars'],
  messages: () => [...acarsKeys.all, 'messages'],
  stats: () => [...acarsKeys.all, 'stats'],
};

export function useAcarsMessages(options = {}) {
  return useQuery({
    queryKey: acarsKeys.messages(),
    queryFn: () => api.get('/acars/messages/'),
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useAcarsStats(options = {}) {
  return useQuery({
    queryKey: acarsKeys.stats(),
    queryFn: () => api.get('/acars/stats/'),
    staleTime: 60 * 1000,
    ...options,
  });
}
