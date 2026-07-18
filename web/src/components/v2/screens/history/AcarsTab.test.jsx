import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AcarsTab } from './AcarsTab';

// The route map is vanilla Leaflet (needs a real DOM/canvas); stub it so the
// tab logic — toggle button, point count, expand/collapse — can be tested.
vi.mock('./AcarsRouteMap', () => ({
  AcarsRouteMap: ({ points }) => <div data-testid="route-map">points:{points.length}</div>,
}));
vi.mock('../../../shared/AcarsAiAnalysis', () => ({
  AcarsAiAnalysis: () => null,
}));

const ROUTE = {
  has_route: true,
  points: [
    { name: 'KLAX', role: 'origin', lat: 33.9, lon: -118.4, type: 'airport', label: 'LAX' },
    { name: 'SLI', role: 'waypoint', lat: 33.7, lon: -118.0, type: 'vortac', label: 'Seal Beach' },
  ],
};

const withRoute = { id: 1, callsign: 'ASA518', label: 'H1', text: 'FPN/…', route: ROUTE };
const noRoute = {
  id: 2,
  callsign: 'UAL42',
  label: '44',
  text: 'METAR KLAX',
  route: { has_route: false, points: [] },
};

describe('AcarsTab route map', () => {
  it('shows a route toggle only for messages with a resolved route', () => {
    render(<AcarsTab messages={[withRoute, noRoute]} apiBase="/api/v1" />);
    const toggles = screen.getAllByRole('button', { name: /Route ·/ });
    expect(toggles).toHaveLength(1);
    expect(toggles[0]).toHaveTextContent('Route · 2 pt');
  });

  it('expands and collapses the map on click', () => {
    render(<AcarsTab messages={[withRoute]} apiBase="/api/v1" />);
    expect(screen.queryByTestId('route-map')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Route ·/ }));
    expect(screen.getByTestId('route-map')).toHaveTextContent('points:2');

    fireEvent.click(screen.getByRole('button', { name: /Hide route/ }));
    expect(screen.queryByTestId('route-map')).toBeNull();
  });
});
