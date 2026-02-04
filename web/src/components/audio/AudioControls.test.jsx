import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioControls from './AudioControls';

describe('AudioControls', () => {
  const defaultProps = {
    audioVolume: 0.8,
    isMuted: false,
    onVolumeChange: vi.fn(),
    onToggleMute: vi.fn(),
    timeRange: '24h',
    onTimeRangeChange: vi.fn(),
    autoplay: false,
    onToggleAutoplay: vi.fn(),
    loading: false,
    onRefresh: vi.fn(),
    socketConnected: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('volume control', () => {
    it('should render volume button with Volume2 icon when not muted', () => {
      render(<AudioControls {...defaultProps} />);

      const volumeBtn = screen.getByRole('button', { name: '' });
      expect(volumeBtn).toBeInTheDocument();
      expect(volumeBtn.closest('.volume-control')).toBeInTheDocument();
    });

    it('should render VolumeX icon when muted', () => {
      render(<AudioControls {...defaultProps} isMuted={true} />);

      const volumeBtn = screen.getByRole('button', { name: '' });
      expect(volumeBtn).toBeInTheDocument();
    });

    it('should call onToggleMute when volume button is clicked', () => {
      render(<AudioControls {...defaultProps} />);

      const volumeBtn = document.querySelector('.volume-btn');
      fireEvent.click(volumeBtn);

      expect(defaultProps.onToggleMute).toHaveBeenCalledTimes(1);
    });

    it('should render volume slider with correct value', () => {
      render(<AudioControls {...defaultProps} audioVolume={0.5} />);

      const slider = screen.getByRole('slider');
      expect(slider).toHaveValue('0.5');
      expect(slider).toHaveAttribute('min', '0');
      expect(slider).toHaveAttribute('max', '1');
      expect(slider).toHaveAttribute('step', '0.1');
    });

    it('should call onVolumeChange when volume slider is changed', () => {
      render(<AudioControls {...defaultProps} />);

      const slider = screen.getByRole('slider');
      fireEvent.change(slider, { target: { value: '0.3' } });

      expect(defaultProps.onVolumeChange).toHaveBeenCalledWith(0.3);
    });

    it('should render slider at zero volume', () => {
      render(<AudioControls {...defaultProps} audioVolume={0} />);

      const slider = screen.getByRole('slider');
      expect(slider).toHaveValue('0');
    });

    it('should render slider at max volume', () => {
      render(<AudioControls {...defaultProps} audioVolume={1} />);

      const slider = screen.getByRole('slider');
      expect(slider).toHaveValue('1');
    });
  });

  describe('time range selector', () => {
    it('should render all time range buttons', () => {
      render(<AudioControls {...defaultProps} />);

      expect(screen.getByText('1h')).toBeInTheDocument();
      expect(screen.getByText('6h')).toBeInTheDocument();
      expect(screen.getByText('24h')).toBeInTheDocument();
      expect(screen.getByText('48h')).toBeInTheDocument();
      expect(screen.getByText('7d')).toBeInTheDocument();
    });

    it('should mark the active time range button', () => {
      render(<AudioControls {...defaultProps} timeRange="24h" />);

      const activeBtn = screen.getByText('24h');
      expect(activeBtn).toHaveClass('active');
    });

    it('should not mark inactive time range buttons as active', () => {
      render(<AudioControls {...defaultProps} timeRange="24h" />);

      const inactiveBtn = screen.getByText('1h');
      expect(inactiveBtn).not.toHaveClass('active');
    });

    it('should call onTimeRangeChange when a time button is clicked', () => {
      render(<AudioControls {...defaultProps} />);

      fireEvent.click(screen.getByText('6h'));

      expect(defaultProps.onTimeRangeChange).toHaveBeenCalledWith('6h');
    });

    it('should call onTimeRangeChange with correct value for each button', () => {
      render(<AudioControls {...defaultProps} />);

      const timeRanges = ['1h', '6h', '24h', '48h', '7d'];

      timeRanges.forEach((range) => {
        fireEvent.click(screen.getByText(range));
        expect(defaultProps.onTimeRangeChange).toHaveBeenCalledWith(range);
      });

      expect(defaultProps.onTimeRangeChange).toHaveBeenCalledTimes(5);
    });
  });

  describe('autoplay toggle', () => {
    it('should render autoplay button with label', () => {
      render(<AudioControls {...defaultProps} />);

      expect(screen.getByText('Auto')).toBeInTheDocument();
    });

    it('should mark autoplay button as active when autoplay is enabled', () => {
      render(<AudioControls {...defaultProps} autoplay={true} />);

      const autoplayBtn = screen.getByText('Auto').closest('button');
      expect(autoplayBtn).toHaveClass('active');
    });

    it('should not mark autoplay button as active when autoplay is disabled', () => {
      render(<AudioControls {...defaultProps} autoplay={false} />);

      const autoplayBtn = screen.getByText('Auto').closest('button');
      expect(autoplayBtn).not.toHaveClass('active');
    });

    it('should call onToggleAutoplay when autoplay button is clicked', () => {
      render(<AudioControls {...defaultProps} />);

      const autoplayBtn = screen.getByText('Auto').closest('button');
      fireEvent.click(autoplayBtn);

      expect(defaultProps.onToggleAutoplay).toHaveBeenCalledTimes(1);
    });

    it('should have correct title when autoplay is disabled', () => {
      render(<AudioControls {...defaultProps} autoplay={false} />);

      const autoplayBtn = screen.getByText('Auto').closest('button');
      expect(autoplayBtn).toHaveAttribute('title', 'Enable autoplay for new transmissions');
    });

    it('should have correct title when autoplay is enabled', () => {
      render(<AudioControls {...defaultProps} autoplay={true} />);

      const autoplayBtn = screen.getByText('Auto').closest('button');
      expect(autoplayBtn).toHaveAttribute('title', 'Disable autoplay');
    });
  });

  describe('refresh button', () => {
    it('should render refresh button', () => {
      render(<AudioControls {...defaultProps} />);

      const refreshBtn = document.querySelector('.refresh-btn');
      expect(refreshBtn).toBeInTheDocument();
      expect(refreshBtn).toHaveAttribute('title', 'Refresh');
    });

    it('should call onRefresh when refresh button is clicked', () => {
      render(<AudioControls {...defaultProps} />);

      const refreshBtn = document.querySelector('.refresh-btn');
      fireEvent.click(refreshBtn);

      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
    });

    it('should add spinning class to icon when loading', () => {
      render(<AudioControls {...defaultProps} loading={true} />);

      const refreshBtn = document.querySelector('.refresh-btn');
      const icon = refreshBtn.querySelector('svg');
      expect(icon).toHaveClass('spinning');
    });

    it('should not add spinning class to icon when not loading', () => {
      render(<AudioControls {...defaultProps} loading={false} />);

      const refreshBtn = document.querySelector('.refresh-btn');
      const icon = refreshBtn.querySelector('svg');
      expect(icon).not.toHaveClass('spinning');
    });
  });

  describe('socket connection status', () => {
    it('should render socket status indicator', () => {
      render(<AudioControls {...defaultProps} />);

      const socketStatus = document.querySelector('.socket-status');
      expect(socketStatus).toBeInTheDocument();
    });

    it('should show connected state when socket is connected', () => {
      render(<AudioControls {...defaultProps} socketConnected={true} />);

      const socketStatus = document.querySelector('.socket-status');
      expect(socketStatus).toHaveClass('connected');
      expect(socketStatus).toHaveAttribute('title', 'Live updates active');
    });

    it('should show disconnected state when socket is not connected', () => {
      render(<AudioControls {...defaultProps} socketConnected={false} />);

      const socketStatus = document.querySelector('.socket-status');
      expect(socketStatus).toHaveClass('disconnected');
      expect(socketStatus).toHaveAttribute('title', 'Disconnected');
    });

    it('should render socket dot inside status indicator', () => {
      render(<AudioControls {...defaultProps} />);

      const socketDot = document.querySelector('.socket-dot');
      expect(socketDot).toBeInTheDocument();
    });
  });

  describe('component structure', () => {
    it('should render with correct class name', () => {
      render(<AudioControls {...defaultProps} />);

      const container = document.querySelector('.audio-controls-right');
      expect(container).toBeInTheDocument();
    });

    it('should render all control sections', () => {
      render(<AudioControls {...defaultProps} />);

      expect(document.querySelector('.volume-control')).toBeInTheDocument();
      expect(document.querySelector('.time-range-selector')).toBeInTheDocument();
      expect(document.querySelector('.autoplay-btn')).toBeInTheDocument();
      expect(document.querySelector('.refresh-btn')).toBeInTheDocument();
      expect(document.querySelector('.socket-status')).toBeInTheDocument();
    });
  });
});
