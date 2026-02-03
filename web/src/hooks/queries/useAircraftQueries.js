import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

export const aircraftKeys = {
  all: ['aircraft'],
  lists: () => [...aircraftKeys.all, 'list'],
  list: (filters) => [...aircraftKeys.lists(), filters],
  details: () => [...aircraftKeys.all, 'detail'],
  detail: (hex) => [...aircraftKeys.details(), hex],
  history: (hex) => [...aircraftKeys.all, 'history', hex],
};

export function useAircraft(options = {}) {
  return useQuery({
    queryKey: aircraftKeys.lists(),
    queryFn: () => api.get('/aircraft/'),
    staleTime: 5 * 1000,
    ...options,
  });
}

export function useAircraftDetail(hex, options = {}) {
  return useQuery({
    queryKey: aircraftKeys.detail(hex),
    queryFn: () => api.get(`/aircraft/${hex}/`),
    enabled: !!hex,
    ...options,
  });
}

export function useAircraftHistory(hex, options = {}) {
  return useQuery({
    queryKey: aircraftKeys.history(hex),
    queryFn: () => api.get(`/aircraft/${hex}/history/`),
    enabled: !!hex,
    ...options,
  });
}
