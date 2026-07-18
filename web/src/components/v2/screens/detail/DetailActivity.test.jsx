import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AcarsActivityCard } from './DetailActivity';

const MSG = {
  id: 42,
  label: '20',
  callsign: 'SWA3838',
  text: '/POSN35.7202/W087.8592,ALT31388',
  source: 'acars',
  timestamp: '2026-07-17T10:00:00Z',
};

describe('AcarsActivityCard AI analysis', () => {
  // apiBase is always '' (same-origin/relative). The AI-analysis accordion must
  // still render — gating it on a truthy apiBase hid it on the airframe page.
  it('renders the AI Analysis toggle even when apiBase is empty', () => {
    render(<AcarsActivityCard messages={[MSG]} apiBase="" />);
    expect(screen.getByRole('button', { name: /AI Analysis/i })).toBeInTheDocument();
  });

  it('omits the toggle for messages with no id', () => {
    render(<AcarsActivityCard messages={[{ ...MSG, id: undefined }]} apiBase="" />);
    expect(screen.queryByRole('button', { name: /AI Analysis/i })).toBeNull();
  });
});
