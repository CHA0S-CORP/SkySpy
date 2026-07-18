import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CannonballScreen } from './CannonballScreen';
import {
  blipPosition,
  displaySpeed,
  fmtElapsed,
  nearestThreat,
  speedDash,
  threatLevelOf,
} from './cannonballModel';

describe('cannonballModel', () => {
  it('threatLevelOf escalates on LE / high threats', () => {
    expect(threatLevelOf([])).toBe('clear');
    expect(threatLevelOf([{ threat_level: 'medium' }])).toBe('caution');
    expect(threatLevelOf([{ threat_level: 'critical' }])).toBe('alert');
    expect(threatLevelOf([{ is_law_enforcement: true }])).toBe('alert');
  });

  it('nearestThreat formats the top threat', () => {
    const n = nearestThreat([
      {
        callsign: 'N911PD',
        distance_nm: 2.1,
        altitude: 1200,
        trend: 'closing',
        is_law_enforcement: true,
      },
    ]);
    expect(n.cs).toBe('N911PD');
    expect(n.tag).toBe('LAW ENFORCEMENT');
    expect(n.dist).toBe('2.1 nm');
    expect(n.alt).toBe('1,200 ft');
    expect(n.closing).toBe(true);
    expect(nearestThreat([])).toBeNull();
  });

  it('nearestThreat surfaces realtime enrichment (agency, urgency, closing, patterns)', () => {
    const n = nearestThreat([
      {
        icao_hex: 'ae1234',
        callsign: 'LAW23',
        distance_nm: 1.4,
        altitude: 900,
        threat_level: 'critical',
        is_law_enforcement: true,
        urgency_score: 87.4,
        closing_speed: 45,
        agency_name: 'FBI',
        agency_type: 'federal',
        identification_reason: 'Known FBI airframe, orbiting overhead',
        patterns: [
          { pattern_type: 'circling', confidence_score: 0.92 },
          { pattern_type: 'speed_trap', confidence: 71 },
        ],
      },
    ]);
    expect(n.agency).toBe('FBI');
    expect(n.agencyType).toBe('FEDERAL');
    expect(n.urgency).toBe(87);
    expect(n.closingKts).toBe(45);
    expect(n.trend).toBe('CLOSING'); // derived from closing_speed
    expect(n.closing).toBe(true);
    expect(n.idReason).toMatch(/orbiting/);
    expect(n.patterns).toEqual([
      { type: 'circling', label: 'CIRCLING', confidence: 92 },
      { type: 'speed_trap', label: 'SPEED TRAP', confidence: 71 },
    ]);
  });

  it('nearestThreat derives DEPARTING/HOLDING from closing speed sign', () => {
    expect(nearestThreat([{ callsign: 'X', closing_speed: -30 }]).trend).toBe('DEPARTING');
    expect(nearestThreat([{ callsign: 'X', closing_speed: 0 }]).trend).toBe('HOLDING');
    // no closing speed and no trend → unknown, no closingKts
    const n = nearestThreat([{ callsign: 'X' }]);
    expect(n.trend).toBe('UNKNOWN');
    expect(n.closingKts).toBeNull();
  });

  it('blipPosition maps bearing/distance to scope percentages', () => {
    const north = blipPosition({ bearing: 0, distance_nm: 15 }, 15);
    expect(north.x).toBeCloseTo(50);
    expect(north.y).toBeCloseTo(6); // 50 - 44
    const east = blipPosition({ bearing: 90, distance_nm: 15 }, 15);
    expect(east.x).toBeCloseTo(94);
    expect(blipPosition({ bearing: null, distance_nm: 5 })).toBeNull();
  });

  it('displaySpeed converts m/s to mph/kmh', () => {
    expect(displaySpeed(10, 'mph')).toBe(22);
    expect(displaySpeed(10, 'kmh')).toBe(36);
    expect(displaySpeed(null, 'mph')).toBe(0);
  });

  it('speedDash clamps to the arc length', () => {
    expect(Number(speedDash(0, 'mph'))).toBe(0);
    expect(Number(speedDash(1000, 'mph'))).toBe(75);
  });

  it('fmtElapsed formats h:mm:ss', () => {
    expect(fmtElapsed(3661)).toBe('1:01:01');
  });
});

describe('CannonballScreen', () => {
  beforeEach(() => {
    global.navigator.geolocation = {
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    };
    localStorage.getItem.mockReset?.();
  });
  afterEach(() => {
    // leave a harmless stub so pending-effect cleanup never dereferences undefined
    global.navigator.geolocation = { watchPosition: vi.fn(() => 1), clearWatch: vi.fn() };
  });

  const LE = [
    {
      hex: 'a911pd',
      flight: 'N911PD',
      alt: 1200,
      t: 'AS50',
      ownOp: 'City Police Dept',
      distance_nm: 2.1,
      bearing: 45,
      vr: -300,
      category: 'A7',
    },
  ];

  it('renders threat strip, speedometer, and controls', () => {
    render(<CannonballScreen aircraft={LE} onExit={vi.fn()} />);
    expect(screen.getByText('AIR UNIT ALERT')).toBeInTheDocument();
    expect(screen.getByText('DRIVE FOCUS')).toBeInTheDocument();
    expect(screen.getByTestId('v2-cannonball-speed')).toBeInTheDocument();
    expect(screen.getByText('N911PD')).toBeInTheDocument();
  });

  it('renders the threat dossier (agency, urgency, patterns) from backend threats', () => {
    const threats = [
      {
        icao_hex: 'ae1234',
        callsign: 'LAW23',
        distance_nm: 1.4,
        altitude: 900,
        bearing: 30,
        threat_level: 'critical',
        is_law_enforcement: true,
        urgency_score: 87,
        closing_speed: 45,
        agency_name: 'FBI',
        agency_type: 'federal',
        identification_reason: 'Known FBI airframe, orbiting overhead',
        patterns: [{ pattern_type: 'circling', confidence_score: 0.92 }],
      },
    ];
    render(<CannonballScreen aircraft={[]} threats={threats} onExit={vi.fn()} />);
    expect(screen.getByTestId('v2-cannonball-agency')).toHaveTextContent('FBI');
    expect(screen.getByTestId('v2-cannonball-urgency')).toHaveTextContent('87');
    expect(screen.getByTestId('v2-cannonball-patterns')).toHaveTextContent('CIRCLING');
    expect(screen.getByTestId('v2-cannonball-patterns')).toHaveTextContent('92%');
    expect(screen.getByText(/orbiting overhead/)).toBeInTheDocument();
    expect(screen.getByText('CLOSING')).toBeInTheDocument();
  });

  it('shows SKY CLEAR with no threats', () => {
    render(<CannonballScreen aircraft={[]} onExit={vi.fn()} />);
    expect(screen.getByText('SKY CLEAR')).toBeInTheDocument();
    expect(screen.getByText('0 AIRCRAFT OVERHEAD')).toBeInTheDocument();
  });

  it('enters and exits focus mode', () => {
    render(<CannonballScreen aircraft={[]} onExit={vi.fn()} />);
    fireEvent.click(screen.getByText('DRIVE FOCUS'));
    const focus = screen.getByTestId('v2-cannonball-focus');
    expect(focus).toBeInTheDocument();
    fireEvent.click(focus);
    expect(screen.getByTestId('v2-cannonball')).toBeInTheDocument();
  });

  it('mute toggle updates the label', () => {
    render(<CannonballScreen aircraft={[]} onExit={vi.fn()} />);
    expect(screen.getByText('ALERTS')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ALERTS'));
    expect(screen.getByText('MUTED')).toBeInTheDocument();
  });

  it('exit button fires onExit', () => {
    const onExit = vi.fn();
    render(<CannonballScreen aircraft={[]} onExit={onExit} />);
    fireEvent.click(screen.getByTitle('Exit Cannonball'));
    expect(onExit).toHaveBeenCalled();
  });
});
