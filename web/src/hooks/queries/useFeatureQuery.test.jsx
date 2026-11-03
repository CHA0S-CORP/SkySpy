import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFeatureQuery } from './useFeatureQuery';
import { useAnalyticsData } from '../../components/v2/screens/analytics/useAnalyticsData';
import { usePointTurbulence } from '../usePointTurbulence';
import { useAssistantChat } from '../../components/v2/screens/assistant/useAssistantChat';

const state = vi.hoisted(() => ({ auth: null }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => state.auth,
  useOptionalAuth: () => state.auth,
}));
vi.mock('../../lib/api', () => ({ default: {} }));

function wrapper({ children }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => ({ fields: ['altitude'], score: 2 }),
  });
  state.auth = {
    status: 'authenticated',
    isAuthenticated: true,
    isLoading: false,
    user: { id: 1 },
    config: { assistantEnabled: true, devMode: false },
    canAccessFeature: vi.fn(() => true),
    authFetch: vi.fn((url, options = {}) =>
      fetch(url, {
        ...options,
        headers: { ...options.headers, Authorization: 'Bearer test-token' },
      })
    ),
  };
});

describe('permission-aware dashboard queries', () => {
  it('uses the authenticated helper for analytics and turbulence', async () => {
    renderHook(
      () => {
        useAnalyticsData('', { hours: 24, xField: 'alt', yField: 'rssi', military: 'all' });
        return usePointTurbulence({ lat: 30, lon: -97 });
      },
      { wrapper }
    );
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(10));
    for (const [url, options] of fetch.mock.calls) {
      expect(options.headers.Authorization).toBe('Bearer test-token');
      expect(url).not.toMatch(/turbulence\?/);
    }
  });

  it.each(['loading', 'forbidden'])('does not request protected data while %s', async (mode) => {
    state.auth.isLoading = mode === 'loading';
    state.auth.canAccessFeature = () => mode !== 'forbidden';
    renderHook(() => useAnalyticsData('', { hours: 24 }), { wrapper });
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows anonymous reads only when the feature is public', async () => {
    state.auth.status = 'anonymous';
    state.auth.user = null;
    state.auth.isAuthenticated = false;
    renderHook(() => usePointTurbulence({ lat: 30, lon: -97 }), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(state.auth.canAccessFeature).toHaveBeenCalledWith('aircraft');
  });

  it('does not request turbulence when explicitly disabled', async () => {
    renderHook(() => usePointTurbulence({ lat: 30, lon: -97, enabled: false }), { wrapper });
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hides cached protected data when access is revoked', async () => {
    const options = { queryKey: ['protected-test'], queryFn: async () => 'private-data' };
    const { result, rerender } = renderHook(() => useFeatureQuery('system', options), { wrapper });
    await waitFor(() => expect(result.current.data).toBe('private-data'));
    state.auth.canAccessFeature = () => false;
    rerender();
    expect(result.current.data).toBeUndefined();
  });

  it('preserves a real authorization error without retrying', async () => {
    const denied = new Error('HTTP 403');
    const queryFn = vi.fn().mockRejectedValue(denied);
    const { result } = renderHook(
      () =>
        useFeatureQuery('system', {
          queryKey: ['denied'],
          queryFn,
        }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.error).toBe(denied));
    expect(queryFn).toHaveBeenCalledOnce();
  });
});

describe('assistant startup probes', () => {
  it.each(['disabled', 'anonymous', 'loading'])('does not probe while %s', async (mode) => {
    if (mode === 'disabled') state.auth.config.assistantEnabled = false;
    if (mode === 'anonymous') state.auth.isAuthenticated = false;
    if (mode === 'loading') state.auth.isLoading = true;
    const { result } = renderHook(() => useAssistantChat(), { wrapper });
    await waitFor(() => expect(result.current.locked).toBe(true));
    expect(fetch).not.toHaveBeenCalled();
  });
});
