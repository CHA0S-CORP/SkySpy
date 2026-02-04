import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavaidPopup } from './NavaidPopup';

describe('NavaidPopup', () => {
  const mockNavaid = {
    id: 'SEA',
    type: 'VORTAC',
    name: 'Seattle',
    freq: 116.8,
    channel: '115X',
    lat: 47.4352,
    lon: -122.3094,
    elev: 350,
  };

  const mockConfig = {
    mapMode: 'crt',
  };

  const defaultProps = {
    navaid: mockNavaid,
    config: mockConfig,
    popupPosition: { x: 100, y: 100 },
    isDragging: false,
    onClose: vi.fn(),
    onMouseDown: vi.fn(),
    getDistanceNm: vi.fn(() => 12.7),
    getBearing: vi.fn(() => 315),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should not render when navaid is null', () => {
      render(<NavaidPopup {...defaultProps} navaid={null} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render when navaid is provided', () => {
      render(<NavaidPopup {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should display navaid identifier', () => {
      render(<NavaidPopup {...defaultProps} />);

      expect(screen.getByText('SEA')).toBeInTheDocument();
    });

    it('should display navaid type badge', () => {
      const { container } = render(<NavaidPopup {...defaultProps} />);

      const badge = container.querySelector('.navaid-type-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('VORTAC');
    });

    it('should display navaid name', () => {
      render(<NavaidPopup {...defaultProps} />);

      expect(screen.getByText('Seattle')).toBeInTheDocument();
    });

    it('should display navaid frequency', () => {
      render(<NavaidPopup {...defaultProps} />);

      expect(screen.getByText('116.8 MHz')).toBeInTheDocument();
    });

    it('should display navaid channel', () => {
      render(<NavaidPopup {...defaultProps} />);

      expect(screen.getByText('115X')).toBeInTheDocument();
    });

    it('should display position coordinates', () => {
      render(<NavaidPopup {...defaultProps} />);

      expect(screen.getByText(/47.4352/)).toBeInTheDocument();
      expect(screen.getByText(/-122.3094/)).toBeInTheDocument();
    });

    it('should display elevation', () => {
      render(<NavaidPopup {...defaultProps} />);

      expect(screen.getByText(/350 ft/)).toBeInTheDocument();
    });

    it('should display distance', () => {
      render(<NavaidPopup {...defaultProps} />);

      expect(screen.getByText('12.7 nm')).toBeInTheDocument();
    });

    it('should display bearing', () => {
      render(<NavaidPopup {...defaultProps} />);

      // Bearing is 315 degrees, check it's in the document
      expect(screen.getByText(/315/)).toBeInTheDocument();
    });
  });

  describe('navaid types', () => {
    it('should display VOR type', () => {
      const { container } = render(
        <NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, type: 'VOR' }} />
      );

      const badge = container.querySelector('.navaid-type-badge');
      expect(badge).toHaveTextContent('VOR');
    });

    it('should display NDB type', () => {
      const { container } = render(
        <NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, type: 'NDB' }} />
      );

      const badge = container.querySelector('.navaid-type-badge');
      expect(badge).toHaveTextContent('NDB');
    });

    it('should display VOR/DME type', () => {
      const { container } = render(
        <NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, type: 'VOR/DME' }} />
      );

      const badge = container.querySelector('.navaid-type-badge');
      expect(badge).toHaveTextContent('VOR/DME');
    });

    it('should display DME type', () => {
      const { container } = render(
        <NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, type: 'DME' }} />
      );

      const badge = container.querySelector('.navaid-type-badge');
      expect(badge).toHaveTextContent('DME');
    });

    it('should display TACAN type', () => {
      const { container } = render(
        <NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, type: 'TACAN' }} />
      );

      const badge = container.querySelector('.navaid-type-badge');
      expect(badge).toHaveTextContent('TACAN');
    });

    it('should show Unknown when type is not available', () => {
      render(<NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, type: undefined }} />);

      // Type row should show "Unknown"
      expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    });

    it('should show NAV badge when type is not available', () => {
      const { container } = render(
        <NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, type: undefined }} />
      );

      const badge = container.querySelector('.navaid-type-badge');
      expect(badge).toHaveTextContent('NAV');
    });
  });

  describe('close button', () => {
    it('should render close button', () => {
      render(<NavaidPopup {...defaultProps} />);

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      render(<NavaidPopup {...defaultProps} />);

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('drag handle', () => {
    it('should have drag handle element', () => {
      const { container } = render(<NavaidPopup {...defaultProps} />);

      const dragHandle = container.querySelector('.popup-drag-handle');
      expect(dragHandle).toBeInTheDocument();
    });

    it('should call onMouseDown when drag handle is pressed', async () => {
      const user = userEvent.setup();
      const { container } = render(<NavaidPopup {...defaultProps} />);

      const dragHandle = container.querySelector('.popup-drag-handle');
      await user.pointer({ keys: '[MouseLeft>]', target: dragHandle });

      expect(defaultProps.onMouseDown).toHaveBeenCalled();
    });
  });

  describe('styling', () => {
    it('should apply crt-popup class for crt mode', () => {
      render(<NavaidPopup {...defaultProps} config={{ mapMode: 'crt' }} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('crt-popup');
    });

    it('should apply pro-popup class for pro mode', () => {
      render(<NavaidPopup {...defaultProps} config={{ mapMode: 'pro' }} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('pro-popup');
    });

    it('should apply dragging class when isDragging is true', () => {
      render(<NavaidPopup {...defaultProps} isDragging={true} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('dragging');
    });

    it('should apply navaid-popup class', () => {
      render(<NavaidPopup {...defaultProps} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('navaid-popup');
    });

    it('should apply popup position from props', () => {
      render(<NavaidPopup {...defaultProps} popupPosition={{ x: 300, y: 200 }} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveStyle({ left: '300px', top: '200px' });
    });
  });

  describe('accessibility', () => {
    it('should have proper dialog role', () => {
      render(<NavaidPopup {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should have aria-label with navaid identifier', () => {
      render(<NavaidPopup {...defaultProps} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveAttribute('aria-label', 'Navaid information for SEA');
    });
  });

  describe('optional fields', () => {
    it('should not display name row when name is not available', () => {
      render(<NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, name: undefined }} />);

      // Should not crash and name field should be absent
      expect(screen.queryByText('Seattle')).not.toBeInTheDocument();
    });

    it('should not display frequency row when freq is not available', () => {
      render(<NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, freq: undefined }} />);

      expect(screen.queryByText(/MHz/)).not.toBeInTheDocument();
    });

    it('should not display channel row when channel is not available', () => {
      render(<NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, channel: undefined }} />);

      expect(screen.queryByText('115X')).not.toBeInTheDocument();
    });

    it('should not display elevation row when elev is not available', () => {
      render(<NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, elev: undefined }} />);

      // Should not show elevation row but still render
      expect(screen.queryByText('350')).not.toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle navaid with only id', () => {
      render(
        <NavaidPopup
          {...defaultProps}
          navaid={{
            id: 'TEST',
            lat: 45.0,
            lon: -122.0,
          }}
        />
      );

      expect(screen.getByText('TEST')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should handle navaid with zero elevation', () => {
      render(<NavaidPopup {...defaultProps} navaid={{ ...mockNavaid, elev: 0 }} />);

      // Zero elevation should not show (falsy check in component)
      expect(screen.queryByText('0 ft')).not.toBeInTheDocument();
    });

    it('should format coordinates correctly', () => {
      render(<NavaidPopup {...defaultProps} />);

      // Check that coordinates are displayed with proper formatting
      const positionRow = screen.getByText('Position').parentElement;
      expect(positionRow).toHaveTextContent('47.4352');
      expect(positionRow).toHaveTextContent('-122.3094');
    });

    it('should handle distance calculation', () => {
      render(<NavaidPopup {...defaultProps} />);

      // Verify getDistanceNm was called with navaid coordinates
      expect(defaultProps.getDistanceNm).toHaveBeenCalledWith(mockNavaid.lat, mockNavaid.lon);
    });

    it('should handle bearing calculation', () => {
      render(<NavaidPopup {...defaultProps} />);

      // Verify getBearing was called with navaid coordinates
      expect(defaultProps.getBearing).toHaveBeenCalledWith(mockNavaid.lat, mockNavaid.lon);
    });
  });
});
