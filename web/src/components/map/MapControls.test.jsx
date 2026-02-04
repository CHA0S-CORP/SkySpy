import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapControls } from './MapControls';

describe('MapControls', () => {
  const defaultProps = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onToggleFullscreen: vi.fn(),
    isFullscreen: false,
    onToggleOverlays: vi.fn(),
    showOverlays: false,
    onToggleFilters: vi.fn(),
    showFilters: false,
    onToggleAircraftList: vi.fn(),
    showAircraftList: false,
    onToggleLegend: vi.fn(),
    showLegend: false,
    onToggleAcars: vi.fn(),
    showAcars: false,
    onToggleMute: vi.fn(),
    soundMuted: false,
    onCenterOnFeeder: vi.fn(),
    radarRange: 50,
    onRangeChange: vi.fn(),
    showRangeControl: false,
    mapMode: 'crt',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render all control buttons', () => {
      render(<MapControls {...defaultProps} />);

      expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
      expect(screen.getByTitle('Zoom Out')).toBeInTheDocument();
      expect(screen.getByTitle('Center on Receiver')).toBeInTheDocument();
      expect(screen.getByTitle('Fullscreen')).toBeInTheDocument();
      expect(screen.getByTitle('Map Overlays')).toBeInTheDocument();
      expect(screen.getByTitle('Traffic Filters')).toBeInTheDocument();
      expect(screen.getByTitle('Aircraft List')).toBeInTheDocument();
      expect(screen.getByTitle('Legend')).toBeInTheDocument();
      expect(screen.getByTitle('ACARS Messages')).toBeInTheDocument();
      expect(screen.getByTitle('Mute Alarms')).toBeInTheDocument();
    });

    it('should render range control slider', () => {
      render(<MapControls {...defaultProps} />);

      expect(screen.getByText('Range')).toBeInTheDocument();
      expect(screen.getByRole('slider')).toBeInTheDocument();
      expect(screen.getByText('50 nm')).toBeInTheDocument();
    });

    it('should show Exit Fullscreen title when in fullscreen mode', () => {
      render(<MapControls {...defaultProps} isFullscreen={true} />);

      expect(screen.getByTitle('Exit Fullscreen')).toBeInTheDocument();
    });

    it('should show Mute Alarms title when sound is not muted', () => {
      render(<MapControls {...defaultProps} soundMuted={false} />);

      expect(screen.getByTitle('Mute Alarms')).toBeInTheDocument();
    });

    it('should show Unmute Alarms title when sound is muted', () => {
      render(<MapControls {...defaultProps} soundMuted={true} />);

      expect(screen.getByTitle('Unmute Alarms')).toBeInTheDocument();
    });
  });

  describe('button active states', () => {
    it('should have active class when fullscreen is enabled', () => {
      render(<MapControls {...defaultProps} isFullscreen={true} />);

      const fullscreenBtn = screen.getByTitle('Exit Fullscreen');
      expect(fullscreenBtn).toHaveClass('active');
    });

    it('should have active class when overlays menu is shown', () => {
      render(<MapControls {...defaultProps} showOverlays={true} />);

      const overlaysBtn = screen.getByTitle('Map Overlays');
      expect(overlaysBtn).toHaveClass('active');
    });

    it('should have active class when filters menu is shown', () => {
      render(<MapControls {...defaultProps} showFilters={true} />);

      const filtersBtn = screen.getByTitle('Traffic Filters');
      expect(filtersBtn).toHaveClass('active');
    });

    it('should have active class when aircraft list is shown', () => {
      render(<MapControls {...defaultProps} showAircraftList={true} />);

      const listBtn = screen.getByTitle('Aircraft List');
      expect(listBtn).toHaveClass('active');
    });

    it('should have active class when legend is shown', () => {
      render(<MapControls {...defaultProps} showLegend={true} />);

      const legendBtn = screen.getByTitle('Legend');
      expect(legendBtn).toHaveClass('active');
    });

    it('should have active class when ACARS is shown', () => {
      render(<MapControls {...defaultProps} showAcars={true} />);

      const acarsBtn = screen.getByTitle('ACARS Messages');
      expect(acarsBtn).toHaveClass('active');
    });

    it('should have muted class when sound is muted', () => {
      render(<MapControls {...defaultProps} soundMuted={true} />);

      const muteBtn = screen.getByTitle('Unmute Alarms');
      expect(muteBtn).toHaveClass('muted');
    });
  });

  describe('button click handlers', () => {
    it('should call onZoomIn when zoom in button is clicked', async () => {
      const user = userEvent.setup();
      render(<MapControls {...defaultProps} />);

      await user.click(screen.getByTitle('Zoom In'));

      expect(defaultProps.onZoomIn).toHaveBeenCalledTimes(1);
    });

    it('should call onZoomOut when zoom out button is clicked', async () => {
      const user = userEvent.setup();
      render(<MapControls {...defaultProps} />);

      await user.click(screen.getByTitle('Zoom Out'));

      expect(defaultProps.onZoomOut).toHaveBeenCalledTimes(1);
    });

    it('should call onCenterOnFeeder when center button is clicked', async () => {
      const user = userEvent.setup();
      render(<MapControls {...defaultProps} />);

      await user.click(screen.getByTitle('Center on Receiver'));

      expect(defaultProps.onCenterOnFeeder).toHaveBeenCalledTimes(1);
    });

    it('should call onToggleFullscreen when fullscreen button is clicked', async () => {
      const user = userEvent.setup();
      render(<MapControls {...defaultProps} />);

      await user.click(screen.getByTitle('Fullscreen'));

      expect(defaultProps.onToggleFullscreen).toHaveBeenCalledTimes(1);
    });

    it('should call onToggleOverlays when overlays button is clicked', async () => {
      const user = userEvent.setup();
      render(<MapControls {...defaultProps} />);

      await user.click(screen.getByTitle('Map Overlays'));

      expect(defaultProps.onToggleOverlays).toHaveBeenCalledTimes(1);
    });

    it('should call onToggleFilters when filters button is clicked', async () => {
      const user = userEvent.setup();
      render(<MapControls {...defaultProps} />);

      await user.click(screen.getByTitle('Traffic Filters'));

      expect(defaultProps.onToggleFilters).toHaveBeenCalledTimes(1);
    });

    it('should call onToggleAircraftList when list button is clicked', async () => {
      const user = userEvent.setup();
      render(<MapControls {...defaultProps} />);

      await user.click(screen.getByTitle('Aircraft List'));

      expect(defaultProps.onToggleAircraftList).toHaveBeenCalledTimes(1);
    });

    it('should call onToggleLegend when legend button is clicked', async () => {
      const user = userEvent.setup();
      render(<MapControls {...defaultProps} />);

      await user.click(screen.getByTitle('Legend'));

      expect(defaultProps.onToggleLegend).toHaveBeenCalledTimes(1);
    });

    it('should call onToggleAcars when ACARS button is clicked', async () => {
      const user = userEvent.setup();
      render(<MapControls {...defaultProps} />);

      await user.click(screen.getByTitle('ACARS Messages'));

      expect(defaultProps.onToggleAcars).toHaveBeenCalledTimes(1);
    });

    it('should call onToggleMute when mute button is clicked', async () => {
      const user = userEvent.setup();
      render(<MapControls {...defaultProps} />);

      await user.click(screen.getByTitle('Mute Alarms'));

      expect(defaultProps.onToggleMute).toHaveBeenCalledTimes(1);
    });
  });

  describe('range slider', () => {
    it('should display the current radar range', () => {
      render(<MapControls {...defaultProps} radarRange={100} />);

      expect(screen.getByText('100 nm')).toBeInTheDocument();
    });

    it('should have correct slider value', () => {
      render(<MapControls {...defaultProps} radarRange={75} />);

      const slider = screen.getByRole('slider');
      expect(slider).toHaveValue('75');
    });

    it('should call onRangeChange when slider value changes', () => {
      render(<MapControls {...defaultProps} />);

      const slider = screen.getByRole('slider');
      fireEvent.change(slider, { target: { value: '100' } });

      expect(defaultProps.onRangeChange).toHaveBeenCalledWith(100);
    });

    it('should have slider with correct min and max values', () => {
      render(<MapControls {...defaultProps} />);

      const slider = screen.getByRole('slider');
      expect(slider).toHaveAttribute('min', '10');
      expect(slider).toHaveAttribute('max', '250');
    });

    it('should have visible class when showRangeControl is true', () => {
      const { container } = render(<MapControls {...defaultProps} showRangeControl={true} />);

      const rangeControl = container.querySelector('.range-control');
      expect(rangeControl).toHaveClass('visible');
    });

    it('should not have visible class when showRangeControl is false', () => {
      const { container } = render(<MapControls {...defaultProps} showRangeControl={false} />);

      const rangeControl = container.querySelector('.range-control');
      expect(rangeControl).not.toHaveClass('visible');
    });
  });

  describe('map mode styling', () => {
    it('should apply crt mode class by default', () => {
      const { container } = render(<MapControls {...defaultProps} />);

      const controls = container.querySelector('.map-controls');
      expect(controls).toHaveClass('crt');
    });

    it('should apply pro mode class when mapMode is pro', () => {
      const { container } = render(<MapControls {...defaultProps} mapMode="pro" />);

      const controls = container.querySelector('.map-controls');
      expect(controls).toHaveClass('pro');
    });
  });

  describe('edge cases', () => {
    it('should handle onRangeChange being undefined', () => {
      render(<MapControls {...defaultProps} onRangeChange={undefined} />);

      const slider = screen.getByRole('slider');
      // Should not throw when changing slider
      expect(() => {
        fireEvent.change(slider, { target: { value: '100' } });
      }).not.toThrow();
    });

    it('should handle minimum range value', () => {
      render(<MapControls {...defaultProps} radarRange={10} />);

      expect(screen.getByText('10 nm')).toBeInTheDocument();
    });

    it('should handle maximum range value', () => {
      render(<MapControls {...defaultProps} radarRange={250} />);

      expect(screen.getByText('250 nm')).toBeInTheDocument();
    });
  });
});
