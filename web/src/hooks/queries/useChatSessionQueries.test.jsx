import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useChatSessions,
  useChatSession,
  useCreateChatSession,
  useAppendChatMessages,
  useDeleteChatSession,
  chatSessionKeys,
} from './useChatSessionQueries';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  default: {
    getChatSessions: vi.fn(),
    getChatSession: vi.fn(),
    createChatSession: vi.fn(),
    appendChatMessages: vi.fn(),
    deleteChatSession: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'QueryWrapper';
  return Wrapper;
}

describe('useChatSessionQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates correct query keys', () => {
    expect(chatSessionKeys.all).toEqual(['chatSessions']);
    expect(chatSessionKeys.list()).toEqual(['chatSessions', 'list']);
    expect(chatSessionKeys.detail(9)).toEqual(['chatSessions', 'detail', 9]);
  });

  it('unwraps the DRF paginated list to an array', async () => {
    api.getChatSessions.mockResolvedValue({
      results: [{ id: 1, title: 'a' }],
      count: 1,
    });
    const { result } = renderHook(() => useChatSessions(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1, title: 'a' }]);
  });

  it('passes through an already-array response', async () => {
    api.getChatSessions.mockResolvedValue([{ id: 2, title: 'b' }]);
    const { result } = renderHook(() => useChatSessions(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 2, title: 'b' }]);
  });

  it('does not fetch a session detail without an id', () => {
    const { result } = renderHook(() => useChatSession(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.getChatSession).not.toHaveBeenCalled();
  });

  it('creates a session', async () => {
    api.createChatSession.mockResolvedValue({ id: 5 });
    const { result } = renderHook(() => useCreateChatSession(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ title: 'hi', surface: 'screen' });
    });
    expect(api.createChatSession).toHaveBeenCalledWith({ title: 'hi', surface: 'screen' });
  });

  it('appends messages to a session', async () => {
    api.appendChatMessages.mockResolvedValue({ id: 5, messages: [] });
    const { result } = renderHook(() => useAppendChatMessages(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: 5, messages: [{ role: 'user', text: 'x' }] });
    });
    expect(api.appendChatMessages).toHaveBeenCalledWith(5, [{ role: 'user', text: 'x' }]);
  });

  it('deletes a session', async () => {
    api.deleteChatSession.mockResolvedValue(null);
    const { result } = renderHook(() => useDeleteChatSession(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync(5);
    });
    expect(api.deleteChatSession).toHaveBeenCalledWith(5);
  });
});
