import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AircraftHeader } from './AircraftHeader';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="x-icon">X</span>,
  Share2: () => <span data-testid="share-icon">Share2</span>,
  Check: () => <span data-testid="check-icon">Check</span>,
}));

describe('AircraftHeader', () => {
  const defaultProps = {
    hex: 'abc123',
    aircraft: {
      hex: 'abc123',
      flight: 'UAL123  ',
    },
    info: {
      type_name: 'Boeing 737-800',
      registration: 'N12345',
      is_military: false,
      operator: 'United Airlines',
    },
    tailInfo: {
      flag: '🇺🇸',
      country: '🇺🇸 US',
      tailNumber: 'N12345',
    },
    shareSuccess: false,
    onShare: vi.fn(),
    onClose: vi.fn(),
  };

  describe('rendering', () => {
    it('should render with banner role', () => {
      render(<AircraftHeader {...defaultProps} />);

      expect(screen.getByRole('banner')).toBeInTheDocument();
    });

    it('should display the callsign as main heading', () => {
      render(<AircraftHeader {...defaultProps} />);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('UAL123');
    });

    it('should display hex code when no callsign', () => {
      const propsWithoutFlight = {
        ...defaultProps,
        aircraft: { hex: 'abc123', flight: null },
      };

      render(<AircraftHeader {...propsWithoutFlight} />);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ABC123');
    });

    it('should trim whitespace from callsign', () => {
      render(<AircraftHeader {...defaultProps} />);

      // The callsign has trailing spaces that should be trimmed
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('UAL123');
      expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain('  ');
    });

    it('should display the flag', () => {
      render(<AircraftHeader {...defaultProps} />);

      expect(screen.getByLabelText(/flag/i)).toHaveTextContent('🇺🇸');
    });

    it('should display hex code in uppercase', () => {
      render(<AircraftHeader {...defaultProps} />);

      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });
  });

  describe('tail number display', () => {
    it('should display tail number when available', () => {
      render(<AircraftHeader {...defaultProps} />);

      // Tail number appears in the subtitles
      const tailNumbers = screen.getAllByText('N12345');
      expect(tailNumbers.length).toBeGreaterThan(0);
    });

    it('should not display tail number when not available', () => {
      const propsWithoutTail = {
        ...defaultProps,
        tailInfo: { ...defaultProps.tailInfo, tailNumber: null },
        info: { ...defaultProps.info, registration: null },
      };

      render(<AircraftHeader {...propsWithoutTail} />);

      expect(screen.queryByText('N12345')).not.toBeInTheDocument();
    });
  });

  describe('aircraft type display', () => {
    it('should display type name', () => {
      render(<AircraftHeader {...defaultProps} />);

      expect(screen.getByText('Boeing 737-800')).toBeInTheDocument();
    });

    it('should display model as fallback for type_name', () => {
      const propsWithModel = {
        ...defaultProps,
        info: { ...defaultProps.info, type_name: null, model: '737-800' },
      };

      render(<AircraftHeader {...propsWithModel} />);

      expect(screen.getByText('737-800')).toBeInTheDocument();
    });

    it('should not display type when neither type_name nor model is available', () => {
      const propsWithoutType = {
        ...defaultProps,
        info: { ...defaultProps.info, type_name: null, model: null },
      };

      render(<AircraftHeader {...propsWithoutType} />);

      expect(screen.queryByText('Boeing 737-800')).not.toBeInTheDocument();
    });
  });

  describe('military badge', () => {
    it('should display MILITARY badge for military aircraft', () => {
      const militaryProps = {
        ...defaultProps,
        info: { ...defaultProps.info, is_military: true },
      };

      render(<AircraftHeader {...militaryProps} />);

      expect(screen.getByText('MILITARY')).toBeInTheDocument();
    });

    it('should not display operator for military aircraft', () => {
      const militaryProps = {
        ...defaultProps,
        info: { ...defaultProps.info, is_military: true, operator: 'US Air Force' },
      };

      render(<AircraftHeader {...militaryProps} />);

      // Operator badge should not be shown for military
      const operatorBadge = screen.queryByTitle('US Air Force');
      expect(operatorBadge).not.toBeInTheDocument();
    });

    it('should add military class to type tag for military aircraft', () => {
      const militaryProps = {
        ...defaultProps,
        info: { ...defaultProps.info, is_military: true },
      };

      const { container } = render(<AircraftHeader {...militaryProps} />);

      expect(container.querySelector('.detail-model-tag.military')).toBeInTheDocument();
    });
  });

  describe('operator display', () => {
    it('should display operator badge for civil aircraft', () => {
      render(<AircraftHeader {...defaultProps} />);

      expect(screen.getByTitle('United Airlines')).toBeInTheDocument();
    });

    it('should display CIVIL badge when no operator and not military', () => {
      const propsWithoutOperator = {
        ...defaultProps,
        info: { ...defaultProps.info, operator: null, is_military: false },
      };

      render(<AircraftHeader {...propsWithoutOperator} />);

      expect(screen.getByText('CIVIL')).toBeInTheDocument();
    });
  });

  describe('share button', () => {
    it('should render share button', () => {
      render(<AircraftHeader {...defaultProps} />);

      expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();
    });

    it('should call onShare when clicked', () => {
      const mockOnShare = vi.fn();
      render(<AircraftHeader {...defaultProps} onShare={mockOnShare} />);

      fireEvent.click(screen.getByRole('button', { name: /share/i }));

      expect(mockOnShare).toHaveBeenCalledTimes(1);
    });

    it('should show success state when shareSuccess is true', () => {
      render(<AircraftHeader {...defaultProps} shareSuccess={true} />);

      const shareButton = screen.getByRole('button', { name: /link copied/i });
      expect(shareButton).toHaveClass('success');
      expect(screen.getByTestId('check-icon')).toBeInTheDocument();
    });

    it('should show share icon when shareSuccess is false', () => {
      render(<AircraftHeader {...defaultProps} shareSuccess={false} />);

      expect(screen.getByTestId('share-icon')).toBeInTheDocument();
    });
  });

  describe('close button', () => {
    it('should render close button', () => {
      render(<AircraftHeader {...defaultProps} />);

      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    it('should call onClose when clicked', () => {
      const mockOnClose = vi.fn();
      render(<AircraftHeader {...defaultProps} onClose={mockOnClose} />);

      fireEvent.click(screen.getByRole('button', { name: /close/i }));

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('should handle null info gracefully', () => {
      const propsWithNullInfo = {
        ...defaultProps,
        info: null,
      };

      render(<AircraftHeader {...propsWithNullInfo} />);

      // Should still render without crashing
      expect(screen.getByRole('banner')).toBeInTheDocument();
    });

    it('should handle empty aircraft object', () => {
      const propsWithEmptyAircraft = {
        ...defaultProps,
        aircraft: {},
      };

      render(<AircraftHeader {...propsWithEmptyAircraft} />);

      // Should show hex as fallback
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ABC123');
    });

    it('should handle undefined tailInfo properties', () => {
      const propsWithPartialTailInfo = {
        ...defaultProps,
        tailInfo: { flag: '🏳️' },
      };

      render(<AircraftHeader {...propsWithPartialTailInfo} />);

      expect(screen.getByLabelText(/flag/i)).toHaveTextContent('🏳️');
    });
  });

  describe('accessibility', () => {
    it('should have accessible share button', () => {
      render(<AircraftHeader {...defaultProps} />);

      const shareButton = screen.getByRole('button', { name: /share/i });
      expect(shareButton).toHaveAttribute('title', 'Share link to this aircraft');
    });

    it('should have accessible close button', () => {
      render(<AircraftHeader {...defaultProps} />);

      const closeButton = screen.getByRole('button', { name: /close aircraft details/i });
      expect(closeButton).toBeInTheDocument();
    });

    it('should have accessible flag display', () => {
      render(<AircraftHeader {...defaultProps} />);

      // The flag has an aria-label describing the country
      const flagElement = screen.getByLabelText(/flag/i);
      expect(flagElement).toBeInTheDocument();
    });

    it('should render icons', () => {
      render(<AircraftHeader {...defaultProps} />);

      // Icons should be rendered (mocked as test spans)
      expect(screen.getByTestId('share-icon')).toBeInTheDocument();
      expect(screen.getByTestId('x-icon')).toBeInTheDocument();
    });
  });
});
