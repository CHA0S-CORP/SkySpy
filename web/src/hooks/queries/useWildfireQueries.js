import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

export const wildfireKeys = {
  all: ['wildfires'],
  near: (lat, lon, radius) => [...wildfireKeys.all, 'near', lat, lon, radius],
  bundle: (id) => [...wildfireKeys.all, 'bundle', id],
};

/**
 * Active wildfires near a point (cached Watch Duty markers). Refetches on the
 * same 5-min cadence the backend refreshes the cache on.
 */
export function useWildfires({ lat, lon, radiusNm = 250 } = {}, options = {}) {
  return useQuery({
    queryKey: wildfireKeys.near(lat, lon, radiusNm),
    queryFn: () => api.getWildfires({ lat, lon, radius_nm: radiusNm }),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    ...options,
  });
}

/**
 * Per-fire detail bundle (reports feed, PTZ camera stills, scanner feeds).
 * Only enabled once an eventId is selected.
 */
export function useWildfireBundle(eventId, options = {}) {
  return useQuery({
    queryKey: wildfireKeys.bundle(eventId),
    queryFn: () => api.getWildfireBundle(eventId),
    enabled: eventId != null,
    staleTime: 90 * 1000,
    ...options,
  });
}
