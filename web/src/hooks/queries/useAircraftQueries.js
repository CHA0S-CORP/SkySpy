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
    queryFn: () => api.getAircraft(),
    staleTime: 5 * 1000,
    ...options,
  });
}

export function useAircraftDetail(hex, options = {}) {
  return useQuery({
    queryKey: aircraftKeys.detail(hex),
    queryFn: () => api.getAircraftDetail(hex),
    enabled: !!hex,
    ...options,
  });
}

export function useAircraftHistory(hex, options = {}) {
  return useQuery({
    queryKey: aircraftKeys.history(hex),
    // History lives at /sightings/?icao=<hex> (there is no /aircraft/{hex}/history/)
    queryFn: () => api.getAircraftHistory(hex),
    enabled: !!hex,
    ...options,
  });
}
