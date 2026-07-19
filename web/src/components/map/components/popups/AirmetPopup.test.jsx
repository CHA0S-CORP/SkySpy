import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AirmetPopup } from './AirmetPopup';

const airmet = {
  id: 'A1',
  hazard: 'TURB-HI',
  meta: { color: '#ff8c1a', label: 'Turbulence (high)', short: 'TURB HI' },
  closed: true,
  severity: 'MOD',
  lowerAltFt: 18000,
  upperAltFt: 42000,
  validTo: '2026-07-19T12:00:00Z',
  rawText: 'TURB FL180-420',
};

const baseProps = {
  config: { mapMode: 'pro' },
  popupPosition: { x: 10, y: 10 },
  isDragging: false,
  onClose: vi.fn(),
  onMouseDown: vi.fn(),
};

describe('AirmetPopup', () => {
  it('renders nothing without an airmet', () => {
    const { container } = render(<AirmetPopup airmet={null} {...baseProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders hazard, severity, geometry and altitude band', () => {
    render(<AirmetPopup airmet={airmet} {...baseProps} />);
    expect(screen.getByText('AIRMET')).toBeInTheDocument();
    expect(screen.getByText('Turbulence (high)')).toBeInTheDocument();
    expect(screen.getByText('TURB-HI')).toBeInTheDocument();
    expect(screen.getByText('Area')).toBeInTheDocument();
    expect(screen.getByText(/FL180 - FL420/)).toBeInTheDocument();
  });

  it('shows Line geometry for open advisories', () => {
    render(<AirmetPopup airmet={{ ...airmet, closed: false }} {...baseProps} />);
    expect(screen.getByText('Line')).toBeInTheDocument();
  });

  it('fires onClose', () => {
    const onClose = vi.fn();
    render(<AirmetPopup airmet={airmet} {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalled();
  });
});
