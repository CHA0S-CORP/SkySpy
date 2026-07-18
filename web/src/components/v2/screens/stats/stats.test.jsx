import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatsScreen } from './StatsScreen';
import {
  activityByHour,
  altitudeDistribution,
  categoryDistribution,
  commonTypeBars,
  coverageGapSummary,
  coveragePolygon,
  historyBars,
  liveFeeds,
  qualityGradeRows,
  rssiScatter,
  safetySeverityCounts,
  spark,
  squawkWatchlist,
  typeBreakdown,
} from './statsModel';

const FLEET = [
  { hex: 'a1', flight: 'DAL571', alt: 35000, gs: 480, distance_nm: 2.7, rssi: -8 },
  { hex: 'a2', flight: 'N884SD', alt: 1200, gs: 90, distance_nm: 12, rssi: -22, category: 'A7' },
  {
    hex: 'a3',
    flight: 'RCH471',
    alt: 15000,
    gs: 380,
    distance_nm: 40,
    rssi: -15,
    military: true,
    squawk: '7700',
  },
];

describe('statsModel', () => {
  it('spark produces normalized polyline points', () => {
    const { line, area } = spark([0, 10, 5], 40);
    expect(line.split(' ')).toHaveLength(3);
    expect(area.startsWith('0,40 ')).toBe(true);
    expect(spark([1]).line).toBe('');
  });

  it('liveFeeds ranks closest/fastest/highest', () => {
    const feeds = liveFeeds(FLEET);
    expect(feeds[0].rows[0].cs).toBe('DAL571'); // closest
    expect(feeds[1].rows[0].cs).toBe('DAL571'); // fastest
    expect(feeds[2].rows[0].val).toBe('35.0k ft'); // highest
  });

  it('squawkWatchlist finds emergency squawks', () => {
    expect(squawkWatchlist(FLEET)).toEqual([{ hex: 'a3', cs: 'RCH471', squawk: '7700' }]);
  });

  it('distributions bucket the fleet', () => {
    const alt = altitudeDistribution(FLEET);
    expect(alt.find((b) => b.label === '> 30k ft').count).toBe(1);
    expect(alt.find((b) => b.label === '< 10k ft').count).toBe(1);
    const cats = categoryDistribution(FLEET);
    expect(cats.find((c) => c.label === 'Military').count).toBe(1);
    expect(cats.find((c) => c.label === 'GA').count).toBe(1);
  });

  it('coveragePolygon maps sector ranges to polygon points', () => {
    const pts = coveragePolygon({ 0: 100, 90: 50, 180: 100, 270: 50 }, 90);
    const coords = pts.split(' ');
    expect(coords).toHaveLength(4);
    expect(coords[0]).toBe('100.0,20.0'); // north at full range (r=80)
  });

  it('rssiScatter computes points and negative regression', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      distance_nm: i * 10,
      rssi: -3 - i * 1.2,
    }));
    const { scatter, regY0, regY1, r } = rssiScatter(samples);
    expect(scatter).toHaveLength(20);
    expect(Number(regY1)).toBeGreaterThan(Number(regY0)); // weaker signal further out
    expect(r).toBeLessThan(-0.9);
  });

  it('severity counts and history bars derive from records', () => {
    const sev = safetySeverityCounts([
      { severity: 'critical' },
      { severity: 'warning' },
      { severity: 'info' },
      { severity: 'emergency' },
    ]);
    expect(sev).toEqual({ critical: 2, warning: 1, info: 1 });

    const sessions = [
      {
        callsign: 'AAL1',
        positions: 400,
        max_distance_nm: 30,
        duration_min: 15,
        first_seen: '2026-07-16T08:00:00',
      },
      {
        callsign: 'DAL2',
        positions: 200,
        max_distance_nm: 120,
        duration_min: 45,
        first_seen: '2026-07-16T19:00:00',
      },
    ];
    const top = historyBars(sessions, 'Top Performers');
    expect(top[0].label).toBe('AAL1');
    expect(historyBars(sessions, 'Distance').find((b) => b.label === '100-150 nm').disp).toBe(1);
    expect(activityByHour(sessions)).toHaveLength(24);
    const { types } = typeBreakdown([
      { type: 'A321', duration_min: 30 },
      { type: 'A321', duration_min: 20 },
    ]);
    expect(types[0]).toEqual({ type: 'A321', count: 2, pct: 100 });
  });

  it('qualityGradeRows orders grades and finds the dominant grade', () => {
    const q = qualityGradeRows({ excellent: 6, good: 3, fair: 1, poor: 0 });
    expect(q.total).toBe(10);
    expect(q.rows.map((r) => r.key)).toEqual(['excellent', 'good', 'fair', 'poor']);
    expect(q.rows[0].pct).toBe(60);
    expect(q.dominant.label).toBe('Excellent');
    expect(qualityGradeRows(null)).toBeNull();
    expect(qualityGradeRows({ excellent: 0, good: 0, fair: 0, poor: 0 })).toBeNull();
  });

  it('coverageGapSummary derives completeness and tiles', () => {
    const s = coverageGapSummary({
      sessions_analyzed: 20,
      sessions_with_gaps: 5,
      sessions_with_gaps_pct: 25,
      total_gaps_found: 8,
      avg_gap_seconds: 47.4,
    });
    expect(s.completenessPct).toBe(75);
    expect(s.withGaps).toBe(5);
    expect(s.totalGaps).toBe(8);
    expect(s.avgGapDisp).toBe('47s');
    expect(coverageGapSummary(null)).toBeNull();
    expect(coverageGapSummary({})).toBeNull();
  });

  it('commonTypeBars scales session counts and flags military types', () => {
    const bars = commonTypeBars([
      { type_code: 'A321', type_name: 'Airbus A321', session_count: 40, military_pct: 0 },
      { type_code: 'C130', session_count: 10, military_pct: 100 },
    ]);
    expect(bars[0].label).toBe('A321 · Airbus A321');
    expect(bars[0].pct).toBe(100);
    expect(bars[1].pct).toBe(25);
    expect(bars[1].color).toBe('var(--danger)');
    expect(bars[1].militaryPct).toBe(100);
    expect(commonTypeBars([])).toEqual([]);
    expect(commonTypeBars(null)).toEqual([]);
  });
});

describe('StatsScreen', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ sessions: [], events: [] }),
    });
  });

  const renderScreen = (props = {}) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <StatsScreen
          apiBase=""
          aircraft={FLEET}
          statsTick={{
            traffic: { aircraft: 3, with_position: 3, military: 1, msg_rate: 6.2 },
            reception: { max_range_nm: 150.4, avg_rssi: -15 },
            system: { load: 0.8, mem: 61, adsb_online: true, celery_ok: true },
            series: [
              { aircraft: 100, max_range_nm: 120, load: 0.5, msg_rate: 4 },
              { aircraft: 140, max_range_nm: 150, load: 0.8, msg_rate: 6 },
            ],
          }}
          antennaAnalytics={{
            max_range_by_direction: { 0: 100, 90: 80, 180: 60, 270: 90 },
            sectors_with_data: 4,
            total_positions: 3182,
          }}
          connected
          onSelectAircraft={vi.fn()}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  it('renders KPI values from statsTick', async () => {
    const { container } = renderScreen();
    expect(screen.getByText('TRAFFIC')).toBeInTheDocument();
    const v2s = [...container.querySelectorAll('.v2-stats__kpi-v2')].map((el) => el.textContent);
    expect(v2s).toEqual(['6', '150', '1']); // msg/s, nm max, military
    expect(screen.getByText('msg/s')).toBeInTheDocument();
  });

  it('shows squawk watchlist entry for emergency aircraft', () => {
    renderScreen();
    expect(screen.getAllByText('RCH471').length).toBeGreaterThan(0);
    expect(screen.getByText('7700')).toBeInTheDocument();
  });

  it('renders coverage polygon from antenna analytics', () => {
    const { container } = renderScreen();
    expect(container.querySelector('polygon')).toBeTruthy();
  });

  it('shows connection state', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('WebSocket Active')).toBeInTheDocument());
  });

  it('renders session-quality, coverage-gap and aircraft-type panels from analytics endpoints', async () => {
    global.fetch = vi.fn((url) => {
      const json = () => {
        if (url.includes('/tracking-quality/gaps')) {
          return Promise.resolve({
            sessions_analyzed: 20,
            sessions_with_gaps: 4,
            sessions_with_gaps_pct: 20,
            total_gaps_found: 9,
            avg_gap_seconds: 55,
          });
        }
        if (url.includes('/tracking-quality/')) {
          return Promise.resolve({
            quality_breakdown: { excellent: 8, good: 5, fair: 2, poor: 1 },
          });
        }
        if (url.includes('/flight-patterns/aircraft-types')) {
          return Promise.resolve({
            aircraft_types: [
              {
                type_code: 'B738',
                type_name: 'Boeing 737-800',
                session_count: 30,
                military_pct: 0,
              },
              { type_code: 'C130', session_count: 6, military_pct: 100 },
            ],
          });
        }
        return Promise.resolve({ sessions: [], events: [] });
      };
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json,
      });
    });

    renderScreen();

    await waitFor(() => expect(screen.getByText('Session Quality')).toBeInTheDocument());
    // "Excellent" appears in both the headline and the grade bar row.
    expect(screen.getAllByText('Excellent').length).toBeGreaterThan(0);

    expect(screen.getByText('Coverage Gaps')).toBeInTheDocument();
    expect(screen.getByTestId('v2-stats-completeness')).toHaveTextContent('80%');

    expect(screen.getByText('Common Aircraft Types')).toBeInTheDocument();
    expect(screen.getByText(/Boeing 737-800/)).toBeInTheDocument();
    expect(screen.getByText('100% mil')).toBeInTheDocument();
  });
});
