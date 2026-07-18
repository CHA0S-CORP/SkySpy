import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HistoryView } from './HistoryView';
import { useSocketApi } from '../../hooks';

// Mock data + feature hooks — this test targets the sightings response-shape handling
vi.mock('../../hooks', () => ({
  useSocketApi: vi.fn(),
  useSortState: vi.fn(({ data }) => ({
    sortField: 'timestamp',
    sortDirection: 'desc',
    handleSort: vi.fn(),
    sortedData: data,
  })),
  useAcarsData: vi.fn(() => ({
    acarsMessages: [],
    filteredAcarsMessages: [],
  })),
  useReplayState: vi.fn(() => ({
    expandedMaps: {},
    toggleMap: vi.fn(),
    replayState: {},
    handleReplayChange: vi.fn(),
    togglePlay: vi.fn(),
    setReplaySpeed: vi.fn(),
    trackData: {},
  })),
}));
vi.mock('../../hooks/socket', () => ({
  useSocketIO: vi.fn(() => ({
    connected: false,
    emit: vi.fn(),
    reconnect: vi.fn(),
    on: vi.fn(),
  })),
}));
vi.mock('../../hooks/useSavedViews', () => ({
  useSavedViews: vi.fn(() => ({ savedViews: [], saveView: vi.fn(), deleteView: vi.fn() })),
}));
vi.mock('../../hooks/useHistoryFilters', () => ({
  useHistoryFilters: vi.fn(() => ({
    filters: {},
    setFilters: vi.fn(),
    filterSessions: (sessions) => sessions,
    hasActiveFilters: false,
  })),
}));
vi.mock('../history/SightingsTable', () => ({
  SightingsTable: ({ sightings }) => (
    <div data-testid="sightings-table">{sightings.length} sightings</div>
  ),
}));

const SIGHTING_ROWS = [
  { id: 1, icao_hex: 'ABC123', callsign: 'TEST1', timestamp: '2024-01-15T10:00:00Z' },
  { id: 2, icao_hex: 'DEF456', callsign: 'TEST2', timestamp: '2024-01-15T11:00:00Z' },
];

const renderSightingsTab = () =>
  render(
    <HistoryView
      apiBase=""
      initialTab="sightings"
      wsRequest={null}
      wsConnected={false}
      hashParams={{}}
    />
  );

describe('HistoryView sightings tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sightings from the WS response shape ({sightings})', () => {
    useSocketApi.mockReturnValue({
      data: { sightings: SIGHTING_ROWS, count: 2 },
      loading: false,
      refetch: vi.fn(),
    });

    renderSightingsTab();
    expect(screen.getByTestId('sightings-table')).toHaveTextContent('2 sightings');
  });

  it('renders sightings from the REST fallback response shape ({results})', () => {
    // SightingViewSet.list returns {results, count, limited} — no `sightings` key
    useSocketApi.mockReturnValue({
      data: { results: SIGHTING_ROWS, count: 2, limited: false },
      loading: false,
      refetch: vi.fn(),
    });

    renderSightingsTab();
    expect(screen.getByTestId('sightings-table')).toHaveTextContent('2 sightings');
  });

  it('renders an empty table when there is no data', () => {
    useSocketApi.mockReturnValue({ data: null, loading: false, refetch: vi.fn() });

    renderSightingsTab();
    expect(screen.getByTestId('sightings-table')).toHaveTextContent('0 sightings');
  });
});
