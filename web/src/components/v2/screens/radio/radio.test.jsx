import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RadioScreen } from './RadioScreen';
import {
  callsignOf,
  fmtDur,
  fmtFreq,
  fmtSize,
  isEmergency,
  radioStats,
  selectTransmissions,
  statusOf,
  waveHeights,
} from './radioModel';

let mockRealtime = [];
vi.mock('../../../../hooks/socket', () => ({
  useSocketIOAudio: () => ({
    socketConnected: true,
    realtimeTransmissions: mockRealtime,
  }),
}));

const T1 = {
  id: 1,
  channel_name: 'KNZY Tower',
  frequency_mhz: 118.55,
  duration_seconds: 13,
  file_size_bytes: 212070,
  transcription_status: 'completed',
  transcript: 'DAL1490 traffic twelve o’clock, five miles.',
  created_at: '2026-07-16T10:27:27Z',
  s3_url: 'https://example.com/t1.mp3',
};
const T2 = {
  id: 2,
  channel_name: 'KMYF Ground',
  frequency_mhz: 121.7,
  duration_seconds: 12,
  transcription_status: 'pending',
  transcript: 'N512JT roger, squawk seven seven zero zero, emergency descent.',
  created_at: '2026-07-16T10:22:17Z',
};

describe('radioModel', () => {
  it('statusOf maps transcription states', () => {
    expect(statusOf({ transcription_status: 'completed' })).toBe('Transcribed');
    expect(statusOf({ transcription_status: 'processing' })).toBe('Pending');
    expect(statusOf({ transcription_status: 'failed' })).toBe('Failed');
  });

  it('isEmergency detects distress keywords', () => {
    expect(isEmergency(T2)).toBe(true);
    expect(isEmergency(T1)).toBe(false);
    expect(isEmergency({ transcript: 'Mayday mayday' })).toBe(true);
  });

  it('callsignOf extracts airline and N-number callsigns', () => {
    expect(callsignOf(T1)).toBe('DAL1490');
    expect(callsignOf(T2)).toBe('N512JT');
    expect(callsignOf({ identified_airframes: [{ callsign: 'SWA2601' }] })).toBe('SWA2601');
    expect(callsignOf({ transcript: 'unreadable static' })).toBeNull();
  });

  it('formatters render freq/duration/size', () => {
    expect(fmtFreq(118.55)).toBe('118.550 MHz');
    expect(fmtDur(73)).toBe('1:13');
    expect(fmtSize(212070)).toBe('207.1 KB');
  });

  it('selectTransmissions filters by search/status/emergency', () => {
    const all = [T1, T2];
    expect(selectTransmissions(all, { query: 'tower' })).toHaveLength(1);
    expect(selectTransmissions(all, { status: 'Pending' })).toEqual([T2]);
    expect(selectTransmissions(all, { emergency: true })).toEqual([T2]);
  });

  it('radioStats aggregates counts and duration', () => {
    const s = radioStats([T1, T2]);
    expect(s.total).toBe(2);
    expect(s.transcribed).toBe(1);
    expect(s.pending).toBe(1);
  });

  it('waveHeights is deterministic', () => {
    expect(waveHeights(3, 8)).toEqual(waveHeights(3, 8));
    expect(waveHeights(3, 8)).toHaveLength(8);
  });
});

describe('RadioScreen', () => {
  beforeEach(() => {
    mockRealtime = [];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ transmissions: [T1, T2], count: 2, total: 2 }),
    });
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue();
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  const renderScreen = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <RadioScreen apiBase="" aircraft={[]} onSelectAircraft={vi.fn()} />
      </QueryClientProvider>
    );
  };

  it('renders transmissions with stats and emergency badge', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('v2-radio-row-1')).toBeInTheDocument());
    expect(screen.getByText('EMERGENCY')).toBeInTheDocument();
    expect(screen.getByText('118.550 MHz')).toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 2 transmissions')).toBeInTheDocument();
  });

  it('filters with the emergency toggle', async () => {
    renderScreen();
    await waitFor(() => screen.getByTestId('v2-radio-row-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Emergency' }));
    expect(screen.queryByTestId('v2-radio-row-1')).toBeNull();
    expect(screen.getByTestId('v2-radio-row-2')).toBeInTheDocument();
  });

  it('opens the now-playing bar when a row is played', async () => {
    renderScreen();
    await waitFor(() => screen.getByTestId('v2-radio-row-1'));
    fireEvent.click(screen.getAllByLabelText('Play')[0]);
    expect(screen.getByTestId('v2-radio-nowbar')).toBeInTheDocument();
  });

  it('merges realtime transmissions from the audio socket', async () => {
    mockRealtime = [
      {
        id: 3,
        channel_name: 'SoCal Approach',
        frequency_mhz: 124.35,
        transcription_status: 'pending',
        created_at: '2026-07-16T10:30:00Z',
      },
    ];
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('v2-radio-row-3')).toBeInTheDocument());
  });
});
