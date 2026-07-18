import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

export const historyKeys = {
  all: ['history'],
  flights: () => [...historyKeys.all, 'flights'],
  flight: (params) => [...historyKeys.all, 'flights', params],
};

export function useHistoryFlights(params = {}, options = {}) {
  return useQuery({
    queryKey: historyKeys.flight(params),
    // Flight history is served by /sightings/ (there is no /history/flights/)
    queryFn: () => api.getHistoryFlights(params),
    staleTime: 60 * 1000,
    keepPreviousData: true,
    ...options,
  });
}
