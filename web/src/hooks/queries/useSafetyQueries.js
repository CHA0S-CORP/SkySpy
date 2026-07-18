import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

export const safetyKeys = {
  all: ['safety'],
  events: () => [...safetyKeys.all, 'events'],
};

export function useSafetyEvents(options = {}) {
  return useQuery({
    queryKey: safetyKeys.events(),
    queryFn: () => api.getSafetyEvents(),
    staleTime: 30 * 1000,
    ...options,
  });
}
