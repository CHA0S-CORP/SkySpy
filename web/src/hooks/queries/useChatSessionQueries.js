import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

export const chatSessionKeys = {
  all: ['chatSessions'],
  list: () => [...chatSessionKeys.all, 'list'],
  detail: (id) => [...chatSessionKeys.all, 'detail', id],
};

/** List saved chat sessions (newest first). Returns a plain array. */
export function useChatSessions(options = {}) {
  return useQuery({
    queryKey: chatSessionKeys.list(),
    queryFn: () => api.getChatSessions(),
    // The list endpoint is DRF-paginated; expose just the rows.
    select: (data) => (Array.isArray(data) ? data : (data?.results ?? [])),
    staleTime: 30 * 1000,
    ...options,
  });
}

/** Fetch one session with its ordered messages. */
export function useChatSession(id, options = {}) {
  return useQuery({
    queryKey: chatSessionKeys.detail(id),
    queryFn: () => api.getChatSession(id),
    enabled: !!id,
    ...options,
  });
}

export function useCreateChatSession(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.createChatSession(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatSessionKeys.list() });
    },
    onError: (error) => {
      console.error('Failed to create chat session:', error);
    },
    ...options,
  });
}

export function useAppendChatMessages(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, messages }) => api.appendChatMessages(id, messages),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: chatSessionKeys.list() });
      queryClient.invalidateQueries({ queryKey: chatSessionKeys.detail(id) });
    },
    onError: (error) => {
      console.error('Failed to append chat messages:', error);
    },
    ...options,
  });
}

export function useDeleteChatSession(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deleteChatSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatSessionKeys.list() });
    },
    onError: (error) => {
      console.error('Failed to delete chat session:', error);
    },
    ...options,
  });
}
