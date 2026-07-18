import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAircraftRadio } from './useAircraftRadio';

vi.mock('../../views/AudioView', () => ({
  getGlobalAudioState: () => ({
    playingId: null,
    audioProgress: {},
    audioDurations: {},
    autoplay: false,
    autoplayFilter: null,
    audioRefs: {},
    progressIntervalRef: null,
  }),
  subscribeToAudioStateChanges: () => () => {},
  setAutoplay: vi.fn(),
  setAutoplayFilter: vi.fn(),
  clearAutoplayFilter: vi.fn(),
}));

const jsonResponse = (body) => ({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => body,
});

const defaultProps = {
  hex: 'A1B2C3',
  baseUrl: '',
  callsign: 'UAL123',
  activeTab: 'radio',
  wsRequest: null,
  wsConnected: false,
  onLoaded: undefined,
};

describe('useAircraftRadio', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ matched_calls: [] }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('HTTP fallback query params', () => {
    it('sends hours/limit params that /api/v1/audio/matched/ actually reads', async () => {
      renderHook(() => useAircraftRadio(defaultProps));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      const url = new URL(fetchMock.mock.calls[0][0], 'http://localhost');
      expect(url.pathname).toBe('/api/v1/audio/matched/');
      expect(url.searchParams.get('hours')).toBe('24');
      expect(url.searchParams.get('limit')).toBe('50');
      expect(url.searchParams.get('callsign')).toBe('UAL123');
      // The backend ignores these names — sending them means the user's
      // selection is silently dropped (hours=24/limit=10 defaults apply)
      expect(url.searchParams.has('radio_hours')).toBe(false);
      expect(url.searchParams.has('radio_limit')).toBe(false);
      expect(url.searchParams.has('include_radio_calls')).toBe(false);
    });

    it('refetches with the newly selected hours value', async () => {
      const { result } = renderHook(() => useAircraftRadio(defaultProps));

      await waitFor(() => expect(result.current.radioLoaded).toBe(true));

      act(() => {
        result.current.setRadioHours(6);
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      const url = new URL(fetchMock.mock.calls[1][0], 'http://localhost');
      expect(url.pathname).toBe('/api/v1/audio/matched/');
      expect(url.searchParams.get('hours')).toBe('6');
      expect(url.searchParams.get('limit')).toBe('50');
      expect(url.searchParams.has('radio_hours')).toBe(false);
    });

    it('stores matched calls from the HTTP fallback response', async () => {
      const calls = [{ id: 1, transcript: 'united one twenty three contact tower' }];
      fetchMock.mockResolvedValue(jsonResponse({ matched_calls: calls }));

      const { result } = renderHook(() => useAircraftRadio(defaultProps));

      await waitFor(() => expect(result.current.radioLoaded).toBe(true));
      expect(result.current.radioTransmissions).toEqual(calls);
    });
  });
});
