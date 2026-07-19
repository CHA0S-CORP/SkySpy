import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the API layer so the screen/modal fetch deterministic seen data.
vi.mock('../../../../lib/api', () => ({
  api: {
    getSeenAirframeTypes: vi.fn(),
    getSeenAirframesByType: vi.fn(),
    getGeneratedAirframeCards: vi.fn(() => Promise.resolve({ cards: [] })),
    generateAirframeCard: vi.fn(() => Promise.resolve({})),
  },
}));

// Auth mirror for LLM card generation — default to unlocked (dev). Reassign
// authState in a test to exercise the "sign in to generate" gate.
let authState = { config: { devMode: true }, hasPermission: () => true };
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

import { api } from '../../../../lib/api';
import { AirframesScreen } from './AirframesScreen';

function renderScreen(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AirframesScreen {...props} />
    </QueryClientProvider>
  );
}

describe('AirframesScreen seen window filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getSeenAirframeTypes.mockResolvedValue({ types: { B738: 3 } });
    api.getSeenAirframesByType.mockResolvedValue({ results: [], count: 0, next_offset: null });
  });

  it('fetches all-time seen at mount and flags never-seen types', async () => {
    renderScreen();
    // B738 is in the all-time seen set (mock), A320 is not.
    const seen = await screen.findByTestId('af-card-B738');
    const unseen = await screen.findByTestId('af-card-A320');
    // All-time set fetched once (no hours), even without a window selected.
    await waitFor(() => expect(api.getSeenAirframeTypes).toHaveBeenCalledWith({}));
    expect(unseen.textContent).toContain('NEVER SEEN');
    expect(seen.textContent).not.toContain('NEVER SEEN');
  });

  it('renders a seen-count badge once a window is active', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: '1h' }));
    const card = await screen.findByTestId('af-card-B738');
    await waitFor(() => expect(card.textContent).toContain('3 seen'));
    expect(api.getSeenAirframeTypes).toHaveBeenCalledWith({ hours: 1 });
  });

  it('filters to only seen types when a window is selected', async () => {
    renderScreen();
    // A320 has no seen count in the mock, B738 does.
    expect(await screen.findByTestId('af-card-A320')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '24h' }));

    // Once seen data resolves, only B738 (the seen type) remains.
    await screen.findByTestId('af-card-B738');
    expect(screen.queryByTestId('af-card-A320')).toBeNull();
    expect(api.getSeenAirframeTypes).toHaveBeenCalledWith({ hours: 24 });
  });

  it('All window sends no hours cutoff', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await screen.findByTestId('af-card-B738');
    expect(api.getSeenAirframeTypes).toHaveBeenCalledWith({});
  });
});

describe('AirframesScreen LLM card-generation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A type this station has seen but that has no static reference card → a
    // GenerateTile is rendered for it.
    api.getSeenAirframeTypes.mockResolvedValue({ types: { ZZZZ: 2 } });
    api.getSeenAirframesByType.mockResolvedValue({ results: [], count: 0, next_offset: null });
  });
  afterEach(() => {
    authState = { config: { devMode: true }, hasPermission: () => true };
  });

  it('shows a generate button when the user can use the LLM', async () => {
    authState = { config: { devMode: true }, hasPermission: () => false };
    renderScreen();
    const tile = await screen.findByTestId('af-ghost-ZZZZ');
    expect(tile.textContent).toContain('GENERATE CARD');
    expect(tile.textContent).not.toContain('SIGN IN TO GENERATE');
  });

  it('shows a sign-in CTA when LLM generation is gated (anonymous)', async () => {
    authState = { config: { devMode: false }, hasPermission: () => false };
    renderScreen();
    const tile = await screen.findByTestId('af-ghost-ZZZZ');
    expect(tile.textContent).toContain('Sign in to generate');
    expect(tile.textContent).toContain('SIGN IN TO GENERATE');
    expect(tile.textContent).not.toContain('No blueprint or specs yet');
  });
});

describe('AirframeModal seen tails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getSeenAirframeTypes.mockResolvedValue({ types: { B738: 1 } });
    api.getSeenAirframesByType.mockResolvedValue({
      results: [
        {
          icao_hex: 'A00001',
          registration: 'N123AB',
          operator: 'United',
          last_seen: null,
          times_seen: 2,
        },
      ],
      count: 1,
      next_offset: null,
    });
  });

  it('lists seen tails and navigates on click', async () => {
    const onSelectAircraft = vi.fn();
    renderScreen({ onSelectAircraft });

    fireEvent.click(await screen.findByTestId('af-card-B738'));

    const reg = await screen.findByText('N123AB');
    expect(reg).toBeTruthy();
    expect(api.getSeenAirframesByType).toHaveBeenCalledWith('B738', { limit: 25, offset: 0 });

    fireEvent.click(reg);
    expect(onSelectAircraft).toHaveBeenCalledWith('A00001');
  });
});
