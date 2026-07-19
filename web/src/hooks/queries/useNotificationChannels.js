import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

export const channelKeys = {
  all: ['notification-channels'],
  list: () => [...channelKeys.all, 'list'],
  types: () => [...channelKeys.all, 'types'],
};

/** Normalize the channels endpoint (array, {results}, or {channels}) to an array. */
function normalizeChannels(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.channels)) return data.channels;
  return [];
}

export function useNotificationChannels(options = {}) {
  return useQuery({
    queryKey: channelKeys.list(),
    queryFn: () => api.getNotificationChannels(),
    select: normalizeChannels,
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useNotificationChannelTypes(options = {}) {
  return useQuery({
    queryKey: channelKeys.types(),
    queryFn: () => api.getNotificationChannelTypes(),
    // REST /channels/types/ returns [{type, name, ...}]; the socket handler
    // returns [{value, label}]. Normalize both to {value, label} for <Select>.
    select: (data) => {
      const list = Array.isArray(data?.types) ? data.types : Array.isArray(data) ? data : [];
      return list.map((t) => ({ value: t.value ?? t.type, label: t.label ?? t.name ?? t.type }));
    },
    staleTime: 60 * 60 * 1000,
    ...options,
  });
}

export function useCreateNotificationChannel(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.createNotificationChannel(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: channelKeys.list() }),
    ...options,
  });
}

export function useUpdateNotificationChannel(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.updateNotificationChannel(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: channelKeys.list() }),
    ...options,
  });
}

export function useDeleteNotificationChannel(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deleteNotificationChannel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: channelKeys.list() }),
    ...options,
  });
}

export function useTestNotificationChannel(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.testNotificationChannel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: channelKeys.list() }),
    ...options,
  });
}
