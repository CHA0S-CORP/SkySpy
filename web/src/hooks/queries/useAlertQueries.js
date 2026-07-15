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
    queryFn: () => api.getAlertRules(),
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useCreateAlertRule(options = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => api.createAlertRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.rules() });
    },
    onError: (error) => {
      console.error('Failed to create alert rule:', error);
    },
    ...options,
  });
}

export function useUpdateAlertRule(options = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => api.updateAlertRule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.rules() });
    },
    onError: (error) => {
      console.error('Failed to update alert rule:', error);
    },
    ...options,
  });
}

export function useDeleteAlertRule(options = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => api.deleteAlertRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.rules() });
    },
    onError: (error) => {
      console.error('Failed to delete alert rule:', error);
    },
    ...options,
  });
}

export function useAlertHistory(options = {}) {
  return useQuery({
    queryKey: alertKeys.history(),
    queryFn: () => api.getAlertHistory(),
    staleTime: 30 * 1000,
    ...options,
  });
}
