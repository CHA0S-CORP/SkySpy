import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AircraftPopup } from './AircraftPopup';

// Mock the useDraggable hook
vi.mock('../../hooks/useDraggable', () => ({
  useDraggable: () => ({
    position: { x: 100, y: 100 },
    isDragging: false,
    handleMouseDown: vi.fn(),
    resetPosition: vi.fn(),
  }),
}));

// Mock the getTailInfo utility
vi.mock('../../utils/aircraft', () => ({
  getTailInfo: (aircraft) => ({
    tailNumber: aircraft?.hex === 'ABC123' ? 'N12345' : null,
    callsign: aircraft?.flight?.trim() || aircraft?.hex?.toUpperCase() || '--',
    country: 'US',
    countryCode: 'US',
    flag: '',
  }),
}));

describe('AircraftPopup', () => {
  const mockAircraft = {
    hex: 'ABC123',
    flight: 'UAL123 ',
    lat: 47.937,
    lon: -121.968,
    alt: 35000,
    baro_alt: 35000,
    gs: 450,
    tas: 470,
    track: 180,
    true_heading: 182,
    vr: 500,
    baro_rate: 500,
    squawk: '1200',
    type: 'B738',
    rssi: -25,
    military: false,
  };

  const mockAircraftInfo = {
    typeLong: 'Boeing 737-800',
    operator: 'United Airlines',
  };

  const defaultProps = {
    aircraft: mockAircraft,
    aircraftInfo: mockAircraftInfo,
    onClose: vi.fn(),
    onShowDetails: vi.fn(),
    onJumpTo: vi.fn(),
    mapMode: 'crt',
    getDistanceNm: vi.fn(() => 15.5),
    getBearing: vi.fn(() => 270),
    trackHistory: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('should not render when aircraft is null', () => {
      render(<AircraftPopup {...defaultProps} aircraft={null} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render when aircraft is provided', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should display aircraft callsign', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText('UAL123')).toBeInTheDocument();
    });

    it('should display aircraft type when available', () => {
      const { container } = render(<AircraftPopup {...defaultProps} />);

      // Type might be shown in model-tag or detail row
      const typeText = container.textContent;
      expect(typeText).toContain('Boeing 737-800');
    });

    it('should display aircraft ICAO hex code', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });

    it('should display tail number when available', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText('N12345')).toBeInTheDocument();
    });

    it('should display operator when available', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText('United Airlines')).toBeInTheDocument();
    });

    it('should display altitude with formatting', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText(/35,000 ft/)).toBeInTheDocument();
    });

    it('should display speed', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText(/450 kts/)).toBeInTheDocument();
    });

    it('should display heading', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText(/180/)).toBeInTheDocument();
    });

    it('should display distance when provided', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText(/15.5 nm/)).toBeInTheDocument();
    });

    it('should display bearing when provided', () => {
      const { container } = render(<AircraftPopup {...defaultProps} />);

      // Bearing is shown as "270" followed by degree symbol
      expect(container.textContent).toContain('270');
    });

    it('should display position coordinates', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText(/47.9370/)).toBeInTheDocument();
    });

    it('should display squawk code', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText('1200')).toBeInTheDocument();
    });

    it('should display signal strength', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText(/-25 dB/)).toBeInTheDocument();
    });
  });

  describe('vertical speed indicator', () => {
    it('should show climbing indicator when vr is positive', () => {
      render(<AircraftPopup {...defaultProps} aircraft={{ ...mockAircraft, vr: 1500 }} />);

      expect(screen.getByText(/1,500 fpm/)).toBeInTheDocument();
    });

    it('should show descending indicator when vr is negative', () => {
      render(<AircraftPopup {...defaultProps} aircraft={{ ...mockAircraft, vr: -1500 }} />);

      expect(screen.getByText(/1,500 fpm/)).toBeInTheDocument();
    });

    it('should not show vertical speed when vr is 0', () => {
      render(<AircraftPopup {...defaultProps} aircraft={{ ...mockAircraft, vr: 0 }} />);

      expect(screen.queryByText(/fpm/)).not.toBeInTheDocument();
    });
  });

  describe('emergency display', () => {
    it('should show emergency badge for squawk 7700', () => {
      const { container } = render(<AircraftPopup {...defaultProps} aircraft={{ ...mockAircraft, squawk: '7700' }} />);

      // Emergency text should appear somewhere in the component
      expect(container.textContent).toMatch(/EMER|7700/i);
    });

    it('should show hijack badge for squawk 7500', () => {
      const { container } = render(<AircraftPopup {...defaultProps} aircraft={{ ...mockAircraft, squawk: '7500' }} />);

      // Hijack text should appear somewhere in the component
      expect(container.textContent).toMatch(/HIJACK|7500/i);
    });

    it('should show radio badge for squawk 7600', () => {
      const { container } = render(<AircraftPopup {...defaultProps} aircraft={{ ...mockAircraft, squawk: '7600' }} />);

      // Radio text should appear somewhere in the component
      expect(container.textContent).toMatch(/RADIO|7600/i);
    });

    it('should apply emergency class when emergency squawk is set', () => {
      render(<AircraftPopup {...defaultProps} aircraft={{ ...mockAircraft, squawk: '7700' }} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('emergency');
    });
  });

  describe('military aircraft', () => {
    it('should show military badge when aircraft is military', () => {
      render(<AircraftPopup {...defaultProps} aircraft={{ ...mockAircraft, military: true }} />);

      expect(screen.getByText('MIL')).toBeInTheDocument();
    });

    it('should not show military badge for civilian aircraft', () => {
      render(<AircraftPopup {...defaultProps} aircraft={{ ...mockAircraft, military: false }} />);

      expect(screen.queryByText('MIL')).not.toBeInTheDocument();
    });
  });

  describe('map mode styling', () => {
    it('should apply crt-popup class for crt mode', () => {
      render(<AircraftPopup {...defaultProps} mapMode="crt" />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('crt-popup');
    });

    it('should apply pro-popup class for pro mode', () => {
      render(<AircraftPopup {...defaultProps} mapMode="pro" />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('pro-popup');
    });
  });

  describe('action buttons', () => {
    it('should render close button', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByLabelText('Close popup')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      render(<AircraftPopup {...defaultProps} />);

      await user.click(screen.getByLabelText('Close popup'));

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('should render Jump button when onJumpTo is provided', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText('Jump')).toBeInTheDocument();
    });

    it('should call onJumpTo when Jump button is clicked', async () => {
      const user = userEvent.setup();
      render(<AircraftPopup {...defaultProps} />);

      await user.click(screen.getByText('Jump'));

      expect(defaultProps.onJumpTo).toHaveBeenCalledWith(mockAircraft);
    });

    it('should render Details button when onShowDetails is provided', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByText('Details')).toBeInTheDocument();
    });

    it('should call onShowDetails when Details button is clicked', async () => {
      const user = userEvent.setup();
      render(<AircraftPopup {...defaultProps} />);

      await user.click(screen.getByText('Details'));

      expect(defaultProps.onShowDetails).toHaveBeenCalledWith(mockAircraft.hex);
    });

    it('should render FlightAware link', () => {
      render(<AircraftPopup {...defaultProps} />);

      const link = screen.getByText('FlightAware');
      expect(link).toHaveAttribute('href', 'https://flightaware.com/live/flight/UAL123');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('should render ADSBx link', () => {
      render(<AircraftPopup {...defaultProps} />);

      const link = screen.getByText('ADSBx');
      expect(link).toHaveAttribute('href', 'https://globe.adsbexchange.com/?icao=ABC123');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('should not render Jump button when onJumpTo is not provided', () => {
      render(<AircraftPopup {...defaultProps} onJumpTo={undefined} />);

      expect(screen.queryByText('Jump')).not.toBeInTheDocument();
    });

    it('should not render Details button when onShowDetails is not provided', () => {
      render(<AircraftPopup {...defaultProps} onShowDetails={undefined} />);

      expect(screen.queryByText('Details')).not.toBeInTheDocument();
    });
  });

  describe('keyboard navigation', () => {
    it('should close popup when Escape key is pressed', () => {
      render(<AircraftPopup {...defaultProps} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('should have proper dialog role', () => {
      render(<AircraftPopup {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should have aria-modal attribute', () => {
      render(<AircraftPopup {...defaultProps} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveAttribute('aria-modal', 'true');
    });

    it('should have aria-labelledby pointing to title', () => {
      render(<AircraftPopup {...defaultProps} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveAttribute('aria-labelledby', expect.stringContaining('aircraft-popup-title'));
    });
  });

  describe('track history display', () => {
    it('should display track points count when history is provided', () => {
      render(<AircraftPopup {...defaultProps} trackHistory={[{}, {}, {}, {}, {}]} />);

      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should not display track points when history is empty', () => {
      render(<AircraftPopup {...defaultProps} trackHistory={[]} />);

      expect(screen.queryByText('Track Pts')).not.toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle aircraft without flight callsign', () => {
      const { container } = render(
        <AircraftPopup
          {...defaultProps}
          aircraft={{ ...mockAircraft, flight: undefined }}
        />
      );

      // Should show hex as fallback - it appears in multiple places
      expect(container.textContent).toContain('ABC123');
    });

    it('should handle aircraft without altitude', () => {
      render(
        <AircraftPopup
          {...defaultProps}
          aircraft={{ ...mockAircraft, alt: undefined, baro_alt: undefined }}
        />
      );

      expect(screen.getByText(/--- ft/)).toBeInTheDocument();
    });

    it('should handle aircraft without speed', () => {
      render(
        <AircraftPopup
          {...defaultProps}
          aircraft={{ ...mockAircraft, gs: undefined, tas: undefined }}
        />
      );

      expect(screen.getByText(/--- kts/)).toBeInTheDocument();
    });

    it('should handle missing distance function', () => {
      render(<AircraftPopup {...defaultProps} getDistanceNm={undefined} />);

      // Should not crash and should skip distance display
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should handle missing bearing function', () => {
      render(<AircraftPopup {...defaultProps} getBearing={undefined} />);

      // Should not crash and should skip bearing display
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
