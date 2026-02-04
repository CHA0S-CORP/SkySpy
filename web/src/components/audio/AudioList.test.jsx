import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import AudioList from './AudioList';

// Mock function to capture props passed to AudioItem
const mockAudioItemProps = [];

// Mock AudioItem to isolate AudioList testing
vi.mock('./AudioItem', () => ({
  default: vi.fn(
    ({
      transmission,
      isPlaying,
      progress,
      duration,
      isExpanded,
      onPlay,
      onSeek,
      onToggleExpand,
      onSelectAircraft,
    }) => {
      mockAudioItemProps.push({
        transmission,
        isPlaying,
        progress,
        duration,
        isExpanded,
        onPlay,
        onSeek,
        onToggleExpand,
        onSelectAircraft,
      });
      return (
        <div data-testid={`audio-item-${transmission.id}`} data-playing={isPlaying}>
          {transmission.channel_name}
        </div>
      );
    }
  ),
}));

describe('AudioList', () => {
  const createTransmission = (id, overrides = {}) => ({
    id,
    channel_name: `Channel ${id}`,
    frequency_mhz: 118.0 + parseInt(id),
    s3_url: `https://example.com/audio${id}.mp3`,
    transcript: `Transcript for ${id}`,
    transcription_status: 'completed',
    duration_seconds: 10,
    created_at: new Date().toISOString(),
    ...overrides,
  });

  const defaultProps = {
    transmissions: [],
    loading: false,
    playingId: null,
    audioProgress: {},
    audioDurations: {},
    expandedTranscript: {},
    onPlay: vi.fn(),
    onSeek: vi.fn(),
    onToggleExpand: vi.fn(),
    onSelectAircraft: vi.fn(),
  };

  let mockIntersectionObserver;
  let intersectionCallback;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAudioItemProps.length = 0; // Clear captured props

    // Mock IntersectionObserver with capture callback
    mockIntersectionObserver = vi.fn((callback) => {
      intersectionCallback = callback;
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      };
    });
    global.IntersectionObserver = mockIntersectionObserver;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loading state', () => {
    it('should show loading indicator when loading with no transmissions', () => {
      render(<AudioList {...defaultProps} loading={true} transmissions={[]} />);

      expect(screen.getByText('Loading transmissions...')).toBeInTheDocument();
    });

    it('should show radar animation during loading', () => {
      render(<AudioList {...defaultProps} loading={true} transmissions={[]} />);

      const loadingContainer = document.querySelector('.audio-loading');
      expect(loadingContainer).toBeInTheDocument();
      expect(document.querySelector('.audio-loading-radar')).toBeInTheDocument();
      expect(document.querySelector('.audio-radar-icon')).toBeInTheDocument();
      expect(document.querySelector('.audio-radar-sweep')).toBeInTheDocument();
    });

    it('should not show loading indicator when not loading', () => {
      render(<AudioList {...defaultProps} loading={false} transmissions={[]} />);

      expect(screen.queryByText('Loading transmissions...')).not.toBeInTheDocument();
    });

    it('should not show loading indicator when has transmissions even if loading', () => {
      const transmissions = [createTransmission('1')];

      render(<AudioList {...defaultProps} loading={true} transmissions={transmissions} />);

      expect(screen.queryByText('Loading transmissions...')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should show empty state when not loading and no transmissions', () => {
      render(<AudioList {...defaultProps} loading={false} transmissions={[]} />);

      expect(screen.getByText('No audio transmissions found')).toBeInTheDocument();
    });

    it('should show help text in empty state', () => {
      render(<AudioList {...defaultProps} loading={false} transmissions={[]} />);

      expect(
        screen.getByText('Transmissions from rtl-airband will appear here')
      ).toBeInTheDocument();
    });

    it('should render Radio icon in empty state', () => {
      render(<AudioList {...defaultProps} loading={false} transmissions={[]} />);

      const emptyContainer = document.querySelector('.audio-empty');
      expect(emptyContainer).toBeInTheDocument();
      expect(emptyContainer.querySelector('svg')).toBeInTheDocument();
    });

    it('should not show empty state when loading', () => {
      render(<AudioList {...defaultProps} loading={true} transmissions={[]} />);

      expect(screen.queryByText('No audio transmissions found')).not.toBeInTheDocument();
    });

    it('should not show empty state when has transmissions', () => {
      const transmissions = [createTransmission('1')];

      render(<AudioList {...defaultProps} loading={false} transmissions={transmissions} />);

      expect(screen.queryByText('No audio transmissions found')).not.toBeInTheDocument();
    });
  });

  describe('transmission list rendering', () => {
    it('should render AudioItem for each transmission', () => {
      const transmissions = [
        createTransmission('1'),
        createTransmission('2'),
        createTransmission('3'),
      ];

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      expect(screen.getByTestId('audio-item-1')).toBeInTheDocument();
      expect(screen.getByTestId('audio-item-2')).toBeInTheDocument();
      expect(screen.getByTestId('audio-item-3')).toBeInTheDocument();
    });

    it('should mark playing transmission as playing', () => {
      const transmissions = [createTransmission('1'), createTransmission('2')];

      render(<AudioList {...defaultProps} transmissions={transmissions} playingId="1" />);

      const playingItem = screen.getByTestId('audio-item-1');
      expect(playingItem).toHaveAttribute('data-playing', 'true');

      const notPlayingItem = screen.getByTestId('audio-item-2');
      expect(notPlayingItem).toHaveAttribute('data-playing', 'false');
    });

    it('should render list container with correct class', () => {
      const transmissions = [createTransmission('1')];

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      const listContainer = document.querySelector('.audio-list');
      expect(listContainer).toBeInTheDocument();
    });
  });

  describe('lazy loading / infinite scroll', () => {
    it('should initially render only first 20 transmissions', () => {
      const transmissions = Array.from({ length: 30 }, (_, i) => createTransmission(String(i + 1)));

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      // First 20 should be visible
      expect(screen.getByTestId('audio-item-1')).toBeInTheDocument();
      expect(screen.getByTestId('audio-item-20')).toBeInTheDocument();

      // Items beyond 20 should not be rendered yet
      expect(screen.queryByTestId('audio-item-21')).not.toBeInTheDocument();
    });

    it('should show load more sentinel when more items available', () => {
      const transmissions = Array.from({ length: 30 }, (_, i) => createTransmission(String(i + 1)));

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      const loadMore = document.querySelector('.audio-load-more');
      expect(loadMore).toBeInTheDocument();
      expect(screen.getByText('Loading more...')).toBeInTheDocument();
    });

    it('should not show load more sentinel when all items visible', () => {
      const transmissions = Array.from({ length: 10 }, (_, i) => createTransmission(String(i + 1)));

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      const loadMore = document.querySelector('.audio-load-more');
      expect(loadMore).not.toBeInTheDocument();
    });

    it('should create IntersectionObserver for infinite scroll', () => {
      const transmissions = Array.from({ length: 30 }, (_, i) => createTransmission(String(i + 1)));

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      expect(mockIntersectionObserver).toHaveBeenCalled();
    });

    it('should load more items when intersection observer triggers', async () => {
      const transmissions = Array.from({ length: 50 }, (_, i) => createTransmission(String(i + 1)));

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      // Initially only 20 visible
      expect(screen.queryByTestId('audio-item-21')).not.toBeInTheDocument();

      // Simulate intersection (scrolling to load more) - wrap in act
      await act(async () => {
        if (intersectionCallback) {
          intersectionCallback([{ isIntersecting: true }]);
        }
      });

      await waitFor(() => {
        expect(screen.getByTestId('audio-item-21')).toBeInTheDocument();
      });
    });
  });

  describe('footer count', () => {
    it('should display correct count when all items visible', () => {
      const transmissions = Array.from({ length: 5 }, (_, i) => createTransmission(String(i + 1)));

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      expect(screen.getByText('Showing 5 of 5 transmissions')).toBeInTheDocument();
    });

    it('should display limited count when not all items visible', () => {
      const transmissions = Array.from({ length: 30 }, (_, i) => createTransmission(String(i + 1)));

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      expect(screen.getByText('Showing 20 of 30 transmissions')).toBeInTheDocument();
    });

    it('should display zero count when no transmissions', () => {
      render(<AudioList {...defaultProps} transmissions={[]} />);

      expect(screen.getByText('Showing 0 of 0 transmissions')).toBeInTheDocument();
    });

    it('should render footer with correct class', () => {
      const transmissions = [createTransmission('1')];

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      const footer = document.querySelector('.audio-footer');
      expect(footer).toBeInTheDocument();
    });
  });

  describe('props passed to AudioItem', () => {
    it('should pass correct progress value to AudioItem', () => {
      const transmissions = [createTransmission('1')];
      const audioProgress = { 1: 50 };

      render(
        <AudioList {...defaultProps} transmissions={transmissions} audioProgress={audioProgress} />
      );

      const lastProps = mockAudioItemProps[mockAudioItemProps.length - 1];
      expect(lastProps.progress).toBe(50);
    });

    it('should pass duration from audioDurations when available', () => {
      const transmissions = [createTransmission('1', { duration_seconds: 10 })];
      const audioDurations = { 1: 15 };

      render(
        <AudioList
          {...defaultProps}
          transmissions={transmissions}
          audioDurations={audioDurations}
        />
      );

      const lastProps = mockAudioItemProps[mockAudioItemProps.length - 1];
      expect(lastProps.duration).toBe(15);
    });

    it('should fall back to transmission duration_seconds when audioDurations not set', () => {
      const transmissions = [createTransmission('1', { duration_seconds: 20 })];

      render(<AudioList {...defaultProps} transmissions={transmissions} audioDurations={{}} />);

      const lastProps = mockAudioItemProps[mockAudioItemProps.length - 1];
      expect(lastProps.duration).toBe(20);
    });

    it('should pass expandedTranscript state to AudioItem', () => {
      const transmissions = [createTransmission('1')];
      const expandedTranscript = { 1: true };

      render(
        <AudioList
          {...defaultProps}
          transmissions={transmissions}
          expandedTranscript={expandedTranscript}
        />
      );

      const lastProps = mockAudioItemProps[mockAudioItemProps.length - 1];
      expect(lastProps.isExpanded).toBe(true);
    });

    it('should pass callback functions to AudioItem', () => {
      const transmissions = [createTransmission('1')];

      render(<AudioList {...defaultProps} transmissions={transmissions} />);

      const lastProps = mockAudioItemProps[mockAudioItemProps.length - 1];
      expect(lastProps.onPlay).toBe(defaultProps.onPlay);
      expect(lastProps.onSeek).toBe(defaultProps.onSeek);
      expect(lastProps.onToggleExpand).toBe(defaultProps.onToggleExpand);
      expect(lastProps.onSelectAircraft).toBe(defaultProps.onSelectAircraft);
    });
  });

  describe('visible count reset', () => {
    it('should reset visible count when transmissions change significantly', async () => {
      const transmissions1 = Array.from({ length: 50 }, (_, i) =>
        createTransmission(String(i + 1))
      );

      const { rerender } = render(<AudioList {...defaultProps} transmissions={transmissions1} />);

      // Trigger load more - wrap in act
      await act(async () => {
        if (intersectionCallback) {
          intersectionCallback([{ isIntersecting: true }]);
        }
      });

      // Now render with different first transmission
      const transmissions2 = Array.from({ length: 50 }, (_, i) =>
        createTransmission(String(i + 100))
      );

      rerender(<AudioList {...defaultProps} transmissions={transmissions2} />);

      // Should show first 20 of new list
      expect(screen.getByTestId('audio-item-100')).toBeInTheDocument();
      expect(screen.queryByTestId('audio-item-121')).not.toBeInTheDocument();
    });
  });
});
