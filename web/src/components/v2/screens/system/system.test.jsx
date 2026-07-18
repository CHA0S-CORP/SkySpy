import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SystemScreen } from './SystemScreen';
import {
  deriveServices,
  deriveBanner,
  deriveGauges,
  deriveAntenna,
  deriveLibacars,
  sevColor,
} from './systemModel';

const HEALTH_OK = {
  services: {
    database: { status: 'up', latency_ms: 3 },
    cache: { status: 'up', latency_ms: 1 },
    celery: { status: 'up' },
    adsb: { status: 'up' },
  },
};
const STATUS_OK = {
  version: '2.6.0',
  receiver_online: true,
  websocket_connections: 3,
  aircraft_count: 187,
  cpu_percent: 34,
  memory_percent: 61,
  sdr_temp: 52,
  sdr_gain: 42,
  alert_history_count: 1420,
  safety_event_count: 88,
  antenna: {
    max_range_nm: 214.7,
    avg_range_nm: 96.3,
    coverage_percentage: 72,
  },
  libacars: {
    available: true,
    stats: { messages_decoded: 512, decode_errors: 3 },
  },
};

describe('systemModel', () => {
  it('deriveServices maps healthy payloads to ok severities', () => {
    const services = deriveServices({ status: STATUS_OK, health: HEALTH_OK, wsConnected: true });
    expect(services).toHaveLength(7);
    expect(services.filter((s) => s.sev === 'danger')).toHaveLength(0);
    const adsb = services.find((s) => s.id === 'adsb');
    expect(adsb.status).toBe('CONNECTED');
  });

  it('deriveServices flags offline receiver as danger', () => {
    const services = deriveServices({
      status: { ...STATUS_OK, receiver_online: false },
      health: { services: { ...HEALTH_OK.services, adsb: { status: 'down' } } },
      wsConnected: true,
    });
    expect(services.find((s) => s.id === 'adsb').sev).toBe('danger');
  });

  it('deriveBanner computes operational vs degraded', () => {
    const ok = deriveBanner([
      { sev: 'ok', name: 'A' },
      { sev: 'info', name: 'B' },
    ]);
    expect(ok.title).toBe('All Systems Operational');
    const bad = deriveBanner([
      { sev: 'ok', name: 'A' },
      { sev: 'danger', name: 'ADS-B Receiver' },
    ]);
    expect(bad.title).toBe('Degraded Performance');
    expect(bad.sub).toContain('ADS-B Receiver');
    expect(bad.sub).toContain('1 of 2');
  });

  it('deriveGauges maps values and thresholds', () => {
    const gauges = deriveGauges({ status: STATUS_OK });
    expect(gauges.find((g) => g.key === 'cpu').value).toBe(34);
    expect(gauges.find((g) => g.key === 'cpu').color).toBe('var(--accent)');
    const hot = deriveGauges({ status: { ...STATUS_OK, cpu_percent: 95, sdr_temp: 72 } });
    expect(hot.find((g) => g.key === 'cpu').color).toBe('var(--danger)');
    expect(hot.find((g) => g.key === 'temp').color).toBe('var(--danger)');
  });

  it('sevColor maps severities', () => {
    expect(sevColor('danger')).toBe('var(--danger)');
    expect(sevColor('info')).toBe('var(--accent2)');
  });

  it('deriveAntenna formats ranges/coverage and returns null when absent', () => {
    const a = deriveAntenna({ status: STATUS_OK });
    expect(a.maxRange).toBe('214.7 nm');
    expect(a.avgRange).toBe('96.3 nm');
    expect(a.coverage).toBe('72%');
    expect(a.coveragePct).toBe(72);
    expect(deriveAntenna({ status: {} })).toBeNull();
    expect(deriveAntenna({ status: { antenna: {} } })).toBeNull();
  });

  it('deriveLibacars merges status stats with health issues/errors', () => {
    const ok = deriveLibacars({ status: STATUS_OK, health: HEALTH_OK });
    expect(ok.available).toBe(true);
    expect(ok.stats.messages_decoded).toBe(512);
    expect(ok.issues).toEqual([]);

    const bad = deriveLibacars({
      status: { libacars: { available: false, error: 'Could not load libacars' } },
      health: { services: { libacars: { status: 'error', issues: ['circuit open'] } } },
    });
    expect(bad.available).toBe(false);
    expect(bad.error).toBe('Could not load libacars');
    expect(bad.issues).toEqual(['circuit open']);

    expect(deriveLibacars({ status: {}, health: {} })).toBeNull();
  });
});

describe('SystemScreen', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      const respond = (body) =>
        Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(body),
        });
      const u = String(url);
      if (u.includes('/system/status')) return respond(STATUS_OK);
      if (u.includes('/system/health')) return respond(HEALTH_OK);
      if (u.includes('/system/info'))
        return respond({ version: '2.6.0', django_version: '5.2', python_version: '3.12' });
      if (u.includes('/notifications/test')) return respond({ success: true });
      return respond({});
    });
  });

  const renderScreen = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <SystemScreen apiBase="" wsConnected feederLocation={{ lat: 32.8, lon: -117.2 }} />
      </QueryClientProvider>
    );
  };

  it('renders operational banner from healthy services', async () => {
    renderScreen();
    await waitFor(() =>
      expect(screen.getByTestId('v2-system-banner')).toHaveTextContent('All Systems Operational')
    );
    expect(screen.getByText('7/7 services online')).toBeInTheDocument();
  });

  it('expands a service row on click', async () => {
    renderScreen();
    await waitFor(() => screen.getByText('Database'));
    fireEvent.click(screen.getByText('Database'));
    expect(screen.getByText('LATENCY')).toBeInTheDocument();
    expect(screen.getByText('3 ms')).toBeInTheDocument();
  });

  it('test notification action adds an event', async () => {
    renderScreen();
    await waitFor(() => screen.getByText('Test Notification'));
    fireEvent.click(screen.getByText('Test Notification'));
    await waitFor(() =>
      expect(screen.getByText('Test notification dispatched')).toBeInTheDocument()
    );
  });

  it('shows feeder coordinates', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('32.8000')).toBeInTheDocument());
    expect(screen.getByText('-117.2000')).toBeInTheDocument();
  });

  it('renders the app version in the footer', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('SkySpy v2.6.0')).toBeInTheDocument());
  });

  it('renders the antenna coverage card from status.antenna', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Antenna')).toBeInTheDocument());
    expect(screen.getByText('214.7 nm')).toBeInTheDocument();
    expect(screen.getByText('96.3 nm')).toBeInTheDocument();
    expect(screen.getAllByText('72%').length).toBeGreaterThan(0);
  });

  it('surfaces libacars decoder status and stats on the ACARS card', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Decoder (libacars)')).toBeInTheDocument());
    expect(screen.getByText('AVAILABLE')).toBeInTheDocument();
    expect(screen.getByText('512')).toBeInTheDocument();
    expect(screen.getByText('Messages Decoded')).toBeInTheDocument();
  });

  it('renders historical alert/safety totals', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Alerts Fired')).toBeInTheDocument());
    expect(screen.getByText('1,420')).toBeInTheDocument();
    expect(screen.getByText('Total Events')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
  });
});
