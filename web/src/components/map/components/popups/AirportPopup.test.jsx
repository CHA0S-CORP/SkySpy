import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AirportPopup } from './AirportPopup';

describe('AirportPopup', () => {
  const mockAirport = {
    icao: 'KSEA',
    name: 'Seattle-Tacoma International Airport',
    city: 'Seattle',
    state: 'WA',
    lat: 47.4502,
    lon: -122.3088,
    elev: 433,
    rwy_length: 11900,
    class: 'B',
  };

  const mockConfig = {
    mapMode: 'crt',
  };

  const defaultProps = {
    airport: mockAirport,
    config: mockConfig,
    popupPosition: { x: 100, y: 100 },
    isDragging: false,
    onClose: vi.fn(),
    onMouseDown: vi.fn(),
    getDistanceNm: vi.fn(() => 25.3),
    getBearing: vi.fn(() => 180),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should not render when airport is null', () => {
      render(<AirportPopup {...defaultProps} airport={null} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render when airport is provided', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should display airport ICAO code', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByText('KSEA')).toBeInTheDocument();
    });

    it('should display airport name', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByText('Seattle-Tacoma International Airport')).toBeInTheDocument();
    });

    it('should display city', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByText('Seattle')).toBeInTheDocument();
    });

    it('should display state', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByText('WA')).toBeInTheDocument();
    });

    it('should display position coordinates', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByText(/47.4502/)).toBeInTheDocument();
      expect(screen.getByText(/-122.3088/)).toBeInTheDocument();
    });

    it('should display elevation', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByText(/433 ft/)).toBeInTheDocument();
    });

    it('should display longest runway length', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByText(/11,900 ft/)).toBeInTheDocument();
    });

    it('should display distance', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByText('25.3 nm')).toBeInTheDocument();
    });

    it('should display bearing', () => {
      const { container } = render(<AirportPopup {...defaultProps} />);

      // Bearing is shown as "180" followed by degree symbol
      expect(container.textContent).toContain('180');
    });

    it('should display airspace class badge', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByText('Class B')).toBeInTheDocument();
    });
  });

  describe('alternate field names', () => {
    it('should use icaoId when icao is not available', () => {
      render(
        <AirportPopup
          {...defaultProps}
          airport={{ ...mockAirport, icao: undefined, icaoId: 'KPAE' }}
        />
      );

      expect(screen.getByText('KPAE')).toBeInTheDocument();
    });

    it('should use faaId when icao/icaoId not available', () => {
      render(
        <AirportPopup
          {...defaultProps}
          airport={{ ...mockAirport, icao: undefined, icaoId: undefined, faaId: 'SEA' }}
        />
      );

      expect(screen.getByText('SEA')).toBeInTheDocument();
    });

    it('should use site when name is not available', () => {
      render(
        <AirportPopup
          {...defaultProps}
          airport={{ ...mockAirport, name: undefined, site: 'Seattle Tacoma Intl' }}
        />
      );

      expect(screen.getByText('Seattle Tacoma Intl')).toBeInTheDocument();
    });

    it('should use assocCity when city is not available', () => {
      render(
        <AirportPopup
          {...defaultProps}
          airport={{ ...mockAirport, city: undefined, assocCity: 'SeaTac' }}
        />
      );

      expect(screen.getByText('SeaTac')).toBeInTheDocument();
    });

    it('should use stateProv when state is not available', () => {
      render(
        <AirportPopup
          {...defaultProps}
          airport={{ ...mockAirport, state: undefined, stateProv: 'Washington' }}
        />
      );

      expect(screen.getByText('Washington')).toBeInTheDocument();
    });

    it('should use elev_ft when elev is not available', () => {
      render(
        <AirportPopup
          {...defaultProps}
          airport={{ ...mockAirport, elev: undefined, elev_ft: 450 }}
        />
      );

      expect(screen.getByText(/450 ft/)).toBeInTheDocument();
    });
  });

  describe('external links', () => {
    it('should render AirNav link with correct URL', () => {
      render(<AirportPopup {...defaultProps} />);

      const link = screen.getByText('AirNav');
      expect(link).toHaveAttribute('href', 'https://www.airnav.com/airport/KSEA');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should render SkyVector link with correct URL', () => {
      render(<AirportPopup {...defaultProps} />);

      const link = screen.getByText('SkyVector');
      expect(link).toHaveAttribute('href', 'https://skyvector.com/airport/KSEA');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('close button', () => {
    it('should render close button', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      render(<AirportPopup {...defaultProps} />);

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('drag handle', () => {
    it('should call onMouseDown when drag handle is clicked', async () => {
      const user = userEvent.setup();
      const { container } = render(<AirportPopup {...defaultProps} />);

      const dragHandle = container.querySelector('.popup-drag-handle');
      await user.pointer({ keys: '[MouseLeft>]', target: dragHandle });

      expect(defaultProps.onMouseDown).toHaveBeenCalled();
    });
  });

  describe('styling', () => {
    it('should apply crt-popup class for crt mode', () => {
      render(<AirportPopup {...defaultProps} config={{ mapMode: 'crt' }} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('crt-popup');
    });

    it('should apply pro-popup class for pro mode', () => {
      render(<AirportPopup {...defaultProps} config={{ mapMode: 'pro' }} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('pro-popup');
    });

    it('should apply dragging class when isDragging is true', () => {
      render(<AirportPopup {...defaultProps} isDragging={true} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('dragging');
    });

    it('should apply popup position from props', () => {
      render(<AirportPopup {...defaultProps} popupPosition={{ x: 200, y: 150 }} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveStyle({ left: '200px', top: '150px' });
    });

    it('should apply class badge styling based on airspace class', () => {
      const { container } = render(<AirportPopup {...defaultProps} />);

      const badge = container.querySelector('.airport-class-badge');
      expect(badge).toHaveClass('class-b');
    });
  });

  describe('accessibility', () => {
    it('should have proper dialog role', () => {
      render(<AirportPopup {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should have aria-label with airport code', () => {
      render(<AirportPopup {...defaultProps} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveAttribute('aria-label', 'Airport information for KSEA');
    });
  });

  describe('edge cases', () => {
    it('should handle airport without class', () => {
      render(
        <AirportPopup
          {...defaultProps}
          airport={{ ...mockAirport, class: undefined }}
        />
      );

      expect(screen.queryByText(/Class/)).not.toBeInTheDocument();
    });

    it('should handle airport without runway length', () => {
      render(
        <AirportPopup
          {...defaultProps}
          airport={{ ...mockAirport, rwy_length: undefined }}
        />
      );

      expect(screen.queryByText('Longest Runway')).not.toBeInTheDocument();
    });

    it('should handle airport with zero elevation', () => {
      const { container } = render(
        <AirportPopup
          {...defaultProps}
          airport={{ ...mockAirport, elev: 0 }}
        />
      );

      // Zero elevation should be displayed
      expect(container.textContent).toContain('0');
      expect(container.textContent).toContain('ft');
    });

    it('should handle missing city and state', () => {
      render(
        <AirportPopup
          {...defaultProps}
          airport={{ ...mockAirport, city: undefined, state: undefined }}
        />
      );

      // Should not crash and should skip these fields
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.queryByText('City')).not.toBeInTheDocument();
      expect(screen.queryByText('State')).not.toBeInTheDocument();
    });
  });
});
