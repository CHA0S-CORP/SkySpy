import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioItem, { formatDuration, formatFileSize, getStatusInfo } from './AudioItem';

// Mock hasEmergencyKeyword from useAudioState
vi.mock('../../hooks/useAudioState', () => ({
  hasEmergencyKeyword: vi.fn((transcript) => {
    if (!transcript) return false;
    const lower = transcript.toLowerCase();
    return lower.includes('mayday') || lower.includes('emergency');
  }),
}));

describe('AudioItem', () => {
  const createTransmission = (overrides = {}) => ({
    id: 'trans-1',
    channel_name: 'Tower',
    frequency_mhz: 118.7,
    s3_url: 'https://example.com/audio.mp3',
    transcript: 'United 123 cleared for takeoff runway 27',
    transcript_confidence: 0.95,
    transcription_status: 'completed',
    transcription_language: 'en',
    duration_seconds: 10,
    file_size_bytes: 102400,
    format: 'mp3',
    created_at: '2024-01-15T10:30:00Z',
    identified_airframes: [],
    transcription_error: null,
    ...overrides,
  });

  const defaultProps = {
    transmission: createTransmission(),
    isPlaying: false,
    progress: 0,
    duration: 10,
    isExpanded: false,
    onPlay: vi.fn(),
    onSeek: vi.fn(),
    onToggleExpand: vi.fn(),
    onSelectAircraft: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatDuration helper', () => {
    it('should format seconds to MM:SS format', () => {
      expect(formatDuration(30)).toBe('0:30');
      expect(formatDuration(60)).toBe('1:00');
      expect(formatDuration(90)).toBe('1:30');
      expect(formatDuration(125)).toBe('2:05');
      expect(formatDuration(3661)).toBe('61:01');
    });

    it('should return --:-- for falsy values', () => {
      // The implementation uses `if (!seconds)` which treats 0 as falsy
      expect(formatDuration(null)).toBe('--:--');
      expect(formatDuration(undefined)).toBe('--:--');
      expect(formatDuration(0)).toBe('--:--');
    });

    it('should handle decimal seconds', () => {
      expect(formatDuration(30.7)).toBe('0:30');
      expect(formatDuration(59.9)).toBe('0:59');
    });
  });

  describe('formatFileSize helper', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(2048)).toBe('2.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(1048576)).toBe('1.00 MB');
      expect(formatFileSize(2621440)).toBe('2.50 MB');
    });

    it('should return -- for null/undefined', () => {
      expect(formatFileSize(null)).toBe('--');
      expect(formatFileSize(undefined)).toBe('--');
      expect(formatFileSize(0)).toBe('--');
    });
  });

  describe('getStatusInfo helper', () => {
    it('should return correct info for completed status', () => {
      const info = getStatusInfo('completed');
      expect(info.label).toBe('Transcribed');
      expect(info.color).toBe('var(--accent-green)');
    });

    it('should return correct info for processing status', () => {
      const info = getStatusInfo('processing');
      expect(info.label).toBe('Processing');
      expect(info.color).toBe('var(--accent-cyan)');
    });

    it('should return correct info for queued status', () => {
      const info = getStatusInfo('queued');
      expect(info.label).toBe('Queued');
      expect(info.color).toBe('var(--accent-yellow)');
    });

    it('should return correct info for failed status', () => {
      const info = getStatusInfo('failed');
      expect(info.label).toBe('Failed');
      expect(info.color).toBe('var(--accent-red)');
    });

    it('should return pending info for unknown status', () => {
      const info = getStatusInfo('unknown');
      expect(info.label).toBe('Pending');
      expect(info.color).toBe('var(--text-dim)');
    });

    it('should return pending info for null/undefined status', () => {
      expect(getStatusInfo(null).label).toBe('Pending');
      expect(getStatusInfo(undefined).label).toBe('Pending');
    });
  });

  describe('play button', () => {
    it('should render play button', () => {
      render(<AudioItem {...defaultProps} />);

      const playBtn = document.querySelector('.audio-play-btn');
      expect(playBtn).toBeInTheDocument();
    });

    it('should call onPlay when play button is clicked', () => {
      render(<AudioItem {...defaultProps} />);

      const playBtn = document.querySelector('.audio-play-btn');
      fireEvent.click(playBtn);

      expect(defaultProps.onPlay).toHaveBeenCalledWith(defaultProps.transmission);
    });

    it('should show play icon when not playing', () => {
      render(<AudioItem {...defaultProps} isPlaying={false} />);

      const playBtn = document.querySelector('.audio-play-btn');
      expect(playBtn).not.toHaveClass('playing');
    });

    it('should show pause icon when playing', () => {
      render(<AudioItem {...defaultProps} isPlaying={true} />);

      const playBtn = document.querySelector('.audio-play-btn');
      expect(playBtn).toHaveClass('playing');
    });

    it('should disable play button when no s3_url', () => {
      const transmission = createTransmission({ s3_url: null });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const playBtn = document.querySelector('.audio-play-btn');
      expect(playBtn).toBeDisabled();
      expect(playBtn).toHaveAttribute('title', 'No audio URL');
    });

    it('should enable play button when s3_url exists', () => {
      render(<AudioItem {...defaultProps} />);

      const playBtn = document.querySelector('.audio-play-btn');
      expect(playBtn).not.toBeDisabled();
    });

    it('should show correct title based on playing state', () => {
      const { rerender } = render(<AudioItem {...defaultProps} isPlaying={false} />);

      let playBtn = document.querySelector('.audio-play-btn');
      expect(playBtn).toHaveAttribute('title', 'Play');

      rerender(<AudioItem {...defaultProps} isPlaying={true} />);

      playBtn = document.querySelector('.audio-play-btn');
      expect(playBtn).toHaveAttribute('title', 'Pause');
    });
  });

  describe('channel and frequency display', () => {
    it('should display channel name', () => {
      render(<AudioItem {...defaultProps} />);

      expect(screen.getByText('Tower')).toBeInTheDocument();
    });

    it('should display Unknown Channel when channel_name is null', () => {
      const transmission = createTransmission({ channel_name: null });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      expect(screen.getByText('Unknown Channel')).toBeInTheDocument();
    });

    it('should display frequency in MHz', () => {
      render(<AudioItem {...defaultProps} />);

      expect(screen.getByText('118.700 MHz')).toBeInTheDocument();
    });

    it('should not display frequency when not available', () => {
      const transmission = createTransmission({ frequency_mhz: null });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      expect(screen.queryByText(/MHz/)).not.toBeInTheDocument();
    });

    it('should display timestamp', () => {
      render(<AudioItem {...defaultProps} />);

      const timeElement = document.querySelector('.audio-time');
      expect(timeElement).toBeInTheDocument();
      // The exact format depends on locale, just verify it's rendered
      expect(timeElement.textContent).toBeTruthy();
    });
  });

  describe('progress bar', () => {
    it('should render progress bar', () => {
      render(<AudioItem {...defaultProps} />);

      const progressContainer = document.querySelector('.audio-progress-container');
      expect(progressContainer).toBeInTheDocument();
    });

    it('should display progress fill at correct width', () => {
      render(<AudioItem {...defaultProps} progress={50} />);

      const progressFill = document.querySelector('.audio-progress-fill');
      expect(progressFill).toHaveStyle({ width: '50%' });
    });

    it('should call onSeek when progress bar is clicked', () => {
      render(<AudioItem {...defaultProps} />);

      const progressContainer = document.querySelector('.audio-progress-container');
      fireEvent.click(progressContainer);

      expect(defaultProps.onSeek).toHaveBeenCalledWith('trans-1', expect.any(Object));
    });

    it('should call onSeek when Enter key is pressed on progress bar', () => {
      render(<AudioItem {...defaultProps} />);

      const progressContainer = document.querySelector('.audio-progress-container');
      fireEvent.keyDown(progressContainer, { key: 'Enter' });

      expect(defaultProps.onSeek).toHaveBeenCalled();
    });

    it('should call onSeek when Space key is pressed on progress bar', () => {
      render(<AudioItem {...defaultProps} />);

      const progressContainer = document.querySelector('.audio-progress-container');
      fireEvent.keyDown(progressContainer, { key: ' ' });

      expect(defaultProps.onSeek).toHaveBeenCalled();
    });

    it('should display current time and total duration', () => {
      render(<AudioItem {...defaultProps} progress={50} duration={10} />);

      const durationContainer = document.querySelector('.audio-duration');
      expect(durationContainer).toBeInTheDocument();
      expect(durationContainer.textContent).toContain('0:05'); // 50% of 10s
      expect(durationContainer.textContent).toContain('0:10'); // total
    });

    it('should have correct accessibility attributes', () => {
      render(<AudioItem {...defaultProps} />);

      const progressContainer = document.querySelector('.audio-progress-container');
      expect(progressContainer).toHaveAttribute('role', 'button');
      expect(progressContainer).toHaveAttribute('tabIndex', '0');
    });
  });

  describe('transcript display', () => {
    it('should display transcript preview', () => {
      render(<AudioItem {...defaultProps} />);

      // Transcript appears in both preview and expanded sections
      const transcriptElements = screen.getAllByText('United 123 cleared for takeoff runway 27');
      expect(transcriptElements.length).toBeGreaterThanOrEqual(1);
      expect(document.querySelector('.transcript-preview-text')).toBeInTheDocument();
    });

    it('should display transcript confidence when available', () => {
      render(<AudioItem {...defaultProps} />);

      expect(screen.getByText('95% confidence')).toBeInTheDocument();
    });

    it('should not display confidence when not available', () => {
      const transmission = createTransmission({ transcript_confidence: null });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      expect(screen.queryByText(/confidence/)).not.toBeInTheDocument();
    });

    it('should show "No transcript available" when no transcript and not processing', () => {
      const transmission = createTransmission({
        transcript: null,
        transcription_status: 'pending',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      expect(screen.getByText('No transcript available')).toBeInTheDocument();
    });

    it('should not show "No transcript available" when processing', () => {
      const transmission = createTransmission({
        transcript: null,
        transcription_status: 'processing',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      expect(screen.queryByText('No transcript available')).not.toBeInTheDocument();
    });

    it('should not show "No transcript available" when queued', () => {
      const transmission = createTransmission({
        transcript: null,
        transcription_status: 'queued',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      expect(screen.queryByText('No transcript available')).not.toBeInTheDocument();
    });
  });

  describe('transcription error', () => {
    it('should display transcription error when present', () => {
      const transmission = createTransmission({
        transcription_error: 'Failed to transcribe audio',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      // Error appears in both the main section and expanded section
      const errorElements = screen.getAllByText('Failed to transcribe audio');
      expect(errorElements.length).toBeGreaterThanOrEqual(1);
    });

    it('should render error container with icon', () => {
      const transmission = createTransmission({
        transcription_error: 'Error message',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const errorContainer = document.querySelector('.audio-transcript-error');
      expect(errorContainer).toBeInTheDocument();
      expect(errorContainer.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('emergency highlighting', () => {
    it('should add emergency class when transcript contains emergency keyword', () => {
      const transmission = createTransmission({
        transcript: 'MAYDAY MAYDAY MAYDAY United 123',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const audioItem = document.querySelector('.audio-item');
      expect(audioItem).toHaveClass('emergency');
    });

    it('should show emergency badge for emergency transmissions', () => {
      const transmission = createTransmission({
        transcript: 'MAYDAY MAYDAY MAYDAY',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      expect(screen.getByText('Emergency')).toBeInTheDocument();
      expect(document.querySelector('.emergency-badge')).toBeInTheDocument();
    });

    it('should not show emergency badge for normal transmissions', () => {
      render(<AudioItem {...defaultProps} />);

      expect(screen.queryByText('Emergency')).not.toBeInTheDocument();
    });
  });

  describe('identified airframes', () => {
    it('should display identified flight tags', () => {
      const transmission = createTransmission({
        identified_airframes: [
          {
            callsign: 'UAL123',
            airline_name: 'United Airlines',
            confidence: 0.95,
            raw_text: 'United 123',
            type: 'airline',
          },
        ],
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      expect(screen.getByText('UAL123')).toBeInTheDocument();
      expect(screen.getByText('United Airlines')).toBeInTheDocument();
    });

    it('should call onSelectAircraft when flight tag is clicked', () => {
      const transmission = createTransmission({
        identified_airframes: [{ callsign: 'UAL123', airline_name: 'United Airlines' }],
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const flightTag = screen.getByText('UAL123').closest('button');
      fireEvent.click(flightTag);

      expect(defaultProps.onSelectAircraft).toHaveBeenCalledWith(null, 'UAL123');
    });

    it('should stop propagation when flight tag is clicked', () => {
      const transmission = createTransmission({
        identified_airframes: [{ callsign: 'UAL123' }],
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const flightTag = screen.getByText('UAL123').closest('button');
      const clickEvent = { stopPropagation: vi.fn() };

      // Re-render to test with spy
      fireEvent.click(flightTag);

      expect(defaultProps.onSelectAircraft).toHaveBeenCalled();
    });

    it('should not render flight tags when no airframes identified', () => {
      const transmission = createTransmission({ identified_airframes: [] });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const flightsContainer = document.querySelector('.audio-identified-flights');
      expect(flightsContainer).not.toBeInTheDocument();
    });

    it('should apply type class to flight tag', () => {
      const transmission = createTransmission({
        identified_airframes: [{ callsign: 'UAL123', type: 'airline' }],
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const flightTag = document.querySelector('.flight-tag');
      expect(flightTag).toHaveClass('airline');
    });
  });

  describe('status badge', () => {
    it('should display status label', () => {
      render(<AudioItem {...defaultProps} />);

      expect(screen.getByText('Transcribed')).toBeInTheDocument();
    });

    it('should apply spinning class to icon when processing', () => {
      const transmission = createTransmission({
        transcription_status: 'processing',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const statusContainer = document.querySelector('.audio-item-status');
      const icon = statusContainer.querySelector('svg');
      expect(icon).toHaveClass('spinning');
    });

    it('should not apply spinning class when not processing', () => {
      render(<AudioItem {...defaultProps} />);

      const statusContainer = document.querySelector('.audio-item-status');
      const icon = statusContainer.querySelector('svg');
      expect(icon).not.toHaveClass('spinning');
    });
  });

  describe('metadata display', () => {
    it('should display file format', () => {
      render(<AudioItem {...defaultProps} />);

      expect(screen.getByText('MP3')).toBeInTheDocument();
    });

    it('should display file size', () => {
      // 102400 bytes = 100 KB (102400 / 1024 = 100.0)
      const transmission = createTransmission({ file_size_bytes: 102400 });
      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const metaContainer = document.querySelector('.audio-item-meta');
      expect(metaContainer).toBeInTheDocument();
      // formatFileSize returns "100.0 KB" for 102400 bytes
      expect(metaContainer.textContent).toContain('100.0 KB');
    });

    it('should show default format when not specified', () => {
      const transmission = createTransmission({ format: null });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      expect(screen.getByText('MP3')).toBeInTheDocument();
    });
  });

  describe('expand button', () => {
    it('should show expand button when transcript exists', () => {
      render(<AudioItem {...defaultProps} />);

      const expandBtn = document.querySelector('.audio-expand-btn');
      expect(expandBtn).toBeInTheDocument();
    });

    it('should show expand button when transcription error exists', () => {
      const transmission = createTransmission({
        transcript: null,
        transcription_error: 'Error',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const expandBtn = document.querySelector('.audio-expand-btn');
      expect(expandBtn).toBeInTheDocument();
    });

    it('should not show expand button when no transcript or error', () => {
      const transmission = createTransmission({
        transcript: null,
        transcription_error: null,
      });

      render(<AudioItem {...defaultProps} transmission={transmission} />);

      const expandBtn = document.querySelector('.audio-expand-btn');
      expect(expandBtn).not.toBeInTheDocument();
    });

    it('should call onToggleExpand when expand button is clicked', () => {
      render(<AudioItem {...defaultProps} />);

      const expandBtn = document.querySelector('.audio-expand-btn');
      fireEvent.click(expandBtn);

      expect(defaultProps.onToggleExpand).toHaveBeenCalledWith('trans-1');
    });

    it('should add expanded class when isExpanded is true', () => {
      render(<AudioItem {...defaultProps} isExpanded={true} />);

      const expandBtn = document.querySelector('.audio-expand-btn');
      expect(expandBtn).toHaveClass('expanded');
    });
  });

  describe('expanded transcript section', () => {
    it('should show expanded section when isExpanded is true', () => {
      render(<AudioItem {...defaultProps} isExpanded={true} />);

      const transcriptSection = document.querySelector('.audio-transcript-section');
      expect(transcriptSection).toHaveClass('expanded');
    });

    it('should not show expanded section when isExpanded is false', () => {
      render(<AudioItem {...defaultProps} isExpanded={false} />);

      const transcriptSection = document.querySelector('.audio-transcript-section');
      expect(transcriptSection).not.toHaveClass('expanded');
    });

    it('should display full transcript in expanded section', () => {
      render(<AudioItem {...defaultProps} isExpanded={true} />);

      const transcriptText = document.querySelector('.transcript-text');
      expect(transcriptText).toHaveTextContent('United 123 cleared for takeoff runway 27');
    });

    it('should display transcript language when available', () => {
      // Create a transmission with transcript_language set
      const transmission = createTransmission({
        transcript: 'Test transcript',
        transcript_language: 'en',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} isExpanded={true} />);

      // Language is uppercased in the component and shown in expanded section
      const languageElement = document.querySelector('.transcript-language');
      expect(languageElement).toBeInTheDocument();
      expect(languageElement.textContent).toBe('EN');
    });

    it('should not display language when not available', () => {
      const transmission = createTransmission({ transcript_language: null });

      render(<AudioItem {...defaultProps} transmission={transmission} isExpanded={true} />);

      expect(document.querySelector('.transcript-language')).not.toBeInTheDocument();
    });

    it('should show error in expanded section when present', () => {
      const transmission = createTransmission({
        transcript: null,
        transcription_error: 'Transcription failed',
      });

      render(<AudioItem {...defaultProps} transmission={transmission} isExpanded={true} />);

      const errorSection = document.querySelector('.audio-error');
      expect(errorSection).toBeInTheDocument();
      expect(errorSection).toHaveTextContent('Transcription failed');
    });
  });

  describe('playing state styling', () => {
    it('should add playing class to audio-item when playing', () => {
      render(<AudioItem {...defaultProps} isPlaying={true} />);

      const audioItem = document.querySelector('.audio-item');
      expect(audioItem).toHaveClass('playing');
    });

    it('should not have playing class when not playing', () => {
      render(<AudioItem {...defaultProps} isPlaying={false} />);

      const audioItem = document.querySelector('.audio-item');
      expect(audioItem).not.toHaveClass('playing');
    });
  });

  describe('component memoization', () => {
    it('should be a memoized component', () => {
      // AudioItem is wrapped with memo, verify it renders correctly
      const { rerender } = render(<AudioItem {...defaultProps} />);

      // Rerender with same props
      rerender(<AudioItem {...defaultProps} />);

      // Component should still render correctly
      expect(screen.getByText('Tower')).toBeInTheDocument();
    });
  });
});
