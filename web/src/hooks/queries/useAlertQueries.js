import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

export const alertKeys = {
  all: ['alerts'],
  rules: () => [...alertKeys.all, 'rules'],
  history: () => [...alertKeys.all, 'history'],
};

export function useAlertRules(options = {}) {
  return useQuery({
    queryKey: alertKeys.rules(),
    queryFn: () => api.get('/alerts/rules/'),
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useCreateAlertRule(options = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => api.post('/alerts/rules/', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.rules() });
    },
    ...options,
  });
}

export function useUpdateAlertRule(options = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => api.patch(`/alerts/rules/${id}/`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.rules() });
    },
    ...options,
  });
}

export function useDeleteAlertRule(options = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => api.delete(`/alerts/rules/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.rules() });
    },
    ...options,
  });
}

export function useAlertHistory(options = {}) {
  return useQuery({
    queryKey: alertKeys.history(),
    queryFn: () => api.get('/alerts/history/'),
    staleTime: 30 * 1000,
    ...options,
  });
}
