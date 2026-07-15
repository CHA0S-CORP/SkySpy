import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlaybackMode } from './usePlaybackMode';

const HOUR_MS = 60 * 60 * 1000;

const jsonResponse = (body) => ({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => body,
});

const makeSighting = (overrides = {}) => ({
  id: 1,
  icao_hex: 'ABC123',
  callsign: 'TEST1',
  lat: 47.5,
  lon: -122.3,
  altitude: 10000,
  gs: 250,
  track: 90,
  vr: 0,
  squawk: '1200',
  timestamp: new Date().toISOString(),
  ...overrides,
});

describe('usePlaybackMode', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderPlayback = () =>
    renderHook(() =>
      usePlaybackMode({
        apiBaseUrl: '',
        wsRequest: null,
        wsConnected: false,
      })
    );

  describe('setTimeRange (custom range)', () => {
    it('scrubs over the custom window instead of a now-anchored one', async () => {
      // A window from 26h ago to 24h ago — nowhere near "now"
      const start = new Date(Date.now() - 26 * HOUR_MS);
      const end = new Date(Date.now() - 24 * HOUR_MS);
      const inWindow = new Date(start.getTime() + 30 * 60 * 1000); // 30 min in

      fetchMock.mockResolvedValue(
        jsonResponse({
          results: [
            makeSighting({ id: 1, timestamp: inWindow.toISOString() }),
            // Recent sighting outside the requested window (must be clipped)
            makeSighting({
              id: 2,
              icao_hex: 'DEF456',
              timestamp: new Date(Date.now() - 60 * 1000).toISOString(),
            }),
          ],
        })
      );

      const { result } = renderPlayback();

      await act(async () => {
        await result.current.setTimeRange(start.toISOString(), end.toISOString());
      });

      // timeRange must reflect the requested window, not [now - hours, now]
      expect(result.current.isPlayback).toBe(true);
      expect(result.current.timeRange.start.getTime()).toBe(start.getTime());
      expect(result.current.timeRange.end.getTime()).toBe(end.getTime());

      // The fetch must reach back far enough to cover the window start
      // (the sightings endpoints only support a now-anchored `hours` param)
      const url = new URL(fetchMock.mock.calls[0][0], 'http://localhost');
      expect(Number(url.searchParams.get('hours'))).toBeGreaterThanOrEqual(26);

      // Sightings outside the requested window are clipped
      expect(result.current.historySightings).toHaveLength(1);
      expect(result.current.historySightings[0].icao_hex).toBe('ABC123');

      // Seek to 25% of the 2h window = start + 30 min = the sighting's time.
      // With a now-anchored window, the 5-minute staleness filter would drop
      // every aircraft and the map would be empty.
      act(() => {
        result.current.seekPercent(25);
      });
      const aircraft = result.current.getPlaybackAircraft();
      expect(aircraft).toHaveLength(1);
      expect(aircraft[0].hex).toBe('ABC123');
      expect(aircraft[0].isPlayback).toBe(true);
    });

    it('clears the custom range on exit and preset playback is now-anchored again', async () => {
      const start = new Date(Date.now() - 26 * HOUR_MS);
      const end = new Date(Date.now() - 24 * HOUR_MS);

      const { result } = renderPlayback();

      await act(async () => {
        await result.current.setTimeRange(start.toISOString(), end.toISOString());
      });

      act(() => {
        result.current.exitPlayback();
      });
      expect(result.current.isPlayback).toBe(false);
      expect(result.current.timeRange).toBeNull();

      await act(async () => {
        await result.current.enterPlayback(1);
      });

      const { timeRange } = result.current;
      expect(timeRange.end.getTime() - timeRange.start.getTime()).toBe(HOUR_MS);
      // End should be "now", not the stale custom end from yesterday
      expect(Date.now() - timeRange.end.getTime()).toBeLessThan(10 * 1000);
    });

    it('exits playback if the custom-range fetch fails', async () => {
      fetchMock.mockResolvedValue({ ok: false, headers: { get: () => null } });

      const { result } = renderPlayback();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await act(async () => {
        await result.current.setTimeRange(
          new Date(Date.now() - 2 * HOUR_MS).toISOString(),
          new Date(Date.now() - HOUR_MS).toISOString()
        );
      });

      expect(result.current.isPlayback).toBe(false);
      expect(result.current.error).toBeTruthy();
      consoleSpy.mockRestore();
    });
  });
});
