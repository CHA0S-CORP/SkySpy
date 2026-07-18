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
    // Messages are served by /acars/ (there is no /acars/messages/)
    queryFn: () => api.getAcarsMessages(),
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useAcarsStats(options = {}) {
  return useQuery({
    queryKey: acarsKeys.stats(),
    queryFn: () => api.getAcarsStats(),
    staleTime: 60 * 1000,
    ...options,
  });
}
