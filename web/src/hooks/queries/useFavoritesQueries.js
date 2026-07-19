import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import api from '../../lib/api';

export const favoriteKeys = {
  all: ['favorites'],
  list: () => [...favoriteKeys.all, 'list'],
};

/**
 * The current user's favorited aircraft. Returns the raw rows plus `hexSet`, an
 * uppercase Set of ICAO hexes for O(1) "is this a favorite?" checks (used by the
 * detail star and the History favorites filter). Favorites are user-scoped for
 * signed-in users (session-scoped for anonymous).
 */
export function useFavorites(options = {}) {
  const query = useQuery({
    queryKey: favoriteKeys.list(),
    queryFn: () => api.getFavorites(),
    select: (data) => data?.favorites ?? [],
    staleTime: 30 * 1000,
    ...options,
  });

  const hexSet = useMemo(
    () => new Set((query.data ?? []).map((f) => (f.icao_hex || '').toUpperCase())),
    [query.data]
  );

  return { ...query, favorites: query.data ?? [], hexSet };
}

/**
 * Toggle a favorite by ICAO hex with an optimistic hexSet flip so the star
 * responds instantly, rolling back on error.
 */
export function useToggleFavorite(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (icaoHex) => api.toggleFavorite(icaoHex),
    onMutate: async (icaoHex) => {
      const hex = (icaoHex || '').toUpperCase();
      await queryClient.cancelQueries({ queryKey: favoriteKeys.list() });
      const prev = queryClient.getQueryData(favoriteKeys.list());
      const rows = prev?.favorites ?? [];
      const exists = rows.some((f) => (f.icao_hex || '').toUpperCase() === hex);
      const next = exists
        ? rows.filter((f) => (f.icao_hex || '').toUpperCase() !== hex)
        : [...rows, { icao_hex: hex, id: `optimistic-${hex}` }];
      queryClient.setQueryData(favoriteKeys.list(), { ...(prev ?? {}), favorites: next });
      return { prev };
    },
    onError: (error, _icao, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(favoriteKeys.list(), ctx.prev);
      console.error('Failed to toggle favorite:', error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: favoriteKeys.list() });
    },
    ...options,
  });
}
