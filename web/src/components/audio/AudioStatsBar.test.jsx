import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AudioStatsBar from './AudioStatsBar';

describe('AudioStatsBar', () => {
  const defaultProps = {
    statsData: {
      total_transmissions: 150,
      total_transcribed: 120,
      pending_transcription: 10,
      total_duration_hours: 5.5,
    },
    statusData: {
      radio_enabled: true,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('total transmissions stat', () => {
    it('should display total transmissions count', () => {
      render(<AudioStatsBar {...defaultProps} />);

      expect(screen.getByText('150')).toBeInTheDocument();
      expect(screen.getByText('Total')).toBeInTheDocument();
    });

    it('should display 0 when statsData is null', () => {
      render(<AudioStatsBar statsData={null} statusData={defaultProps.statusData} />);

      const stats = document.querySelectorAll('.stat-value');
      expect(stats[0].textContent).toBe('0');
    });

    it('should display 0 when total_transmissions is undefined', () => {
      render(<AudioStatsBar statsData={{}} statusData={defaultProps.statusData} />);

      const stats = document.querySelectorAll('.stat-value');
      expect(stats[0].textContent).toBe('0');
    });
  });

  describe('transcribed stat', () => {
    it('should display transcribed count', () => {
      render(<AudioStatsBar {...defaultProps} />);

      expect(screen.getByText('120')).toBeInTheDocument();
      expect(screen.getByText('Transcribed')).toBeInTheDocument();
    });

    it('should have green styling class on icon', () => {
      render(<AudioStatsBar {...defaultProps} />);

      const stats = document.querySelectorAll('.audio-stat');
      const transcribedStat = stats[1];
      const icon = transcribedStat.querySelector('svg');
      expect(icon).toHaveClass('text-green');
    });

    it('should display 0 when total_transcribed is undefined', () => {
      render(
        <AudioStatsBar
          statsData={{ total_transmissions: 100 }}
          statusData={defaultProps.statusData}
        />
      );

      const stats = document.querySelectorAll('.stat-value');
      expect(stats[1].textContent).toBe('0');
    });
  });

  describe('pending stat', () => {
    it('should display pending count', () => {
      render(<AudioStatsBar {...defaultProps} />);

      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('should have yellow styling class on icon', () => {
      render(<AudioStatsBar {...defaultProps} />);

      const stats = document.querySelectorAll('.audio-stat');
      const pendingStat = stats[2];
      const icon = pendingStat.querySelector('svg');
      expect(icon).toHaveClass('text-yellow');
    });

    it('should display 0 when pending_transcription is undefined', () => {
      render(
        <AudioStatsBar
          statsData={{ total_transmissions: 100, total_transcribed: 80 }}
          statusData={defaultProps.statusData}
        />
      );

      const stats = document.querySelectorAll('.stat-value');
      expect(stats[2].textContent).toBe('0');
    });
  });

  describe('duration stat', () => {
    it('should display total duration in hours', () => {
      render(<AudioStatsBar {...defaultProps} />);

      expect(screen.getByText('5.5h')).toBeInTheDocument();
      expect(screen.getByText('Duration')).toBeInTheDocument();
    });

    it('should have cyan styling class on icon', () => {
      render(<AudioStatsBar {...defaultProps} />);

      const stats = document.querySelectorAll('.audio-stat');
      const durationStat = stats[3];
      const icon = durationStat.querySelector('svg');
      expect(icon).toHaveClass('text-cyan');
    });

    it('should display 0h when total_duration_hours is undefined', () => {
      render(
        <AudioStatsBar
          statsData={{ total_transmissions: 100 }}
          statusData={defaultProps.statusData}
        />
      );

      const stats = document.querySelectorAll('.stat-value');
      expect(stats[3].textContent).toBe('0h');
    });

    it('should format duration to one decimal place', () => {
      render(
        <AudioStatsBar
          statsData={{ ...defaultProps.statsData, total_duration_hours: 12.789 }}
          statusData={defaultProps.statusData}
        />
      );

      expect(screen.getByText('12.8h')).toBeInTheDocument();
    });

    it('should handle zero duration', () => {
      render(
        <AudioStatsBar
          statsData={{ ...defaultProps.statsData, total_duration_hours: 0 }}
          statusData={defaultProps.statusData}
        />
      );

      // When 0, .toFixed(1) produces "0.0", so check for that
      expect(screen.getByText('0.0h')).toBeInTheDocument();
    });
  });

  describe('radio status', () => {
    it('should display Active when radio is enabled', () => {
      render(<AudioStatsBar {...defaultProps} />);

      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Radio')).toBeInTheDocument();
    });

    it('should display Disabled when radio is not enabled', () => {
      render(
        <AudioStatsBar statsData={defaultProps.statsData} statusData={{ radio_enabled: false }} />
      );

      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('should have green text class when radio is active', () => {
      render(<AudioStatsBar {...defaultProps} />);

      const stats = document.querySelectorAll('.audio-stat');
      const radioStat = stats[4];
      const value = radioStat.querySelector('.stat-value');
      expect(value).toHaveClass('text-green');
    });

    it('should have red text class when radio is disabled', () => {
      render(
        <AudioStatsBar statsData={defaultProps.statsData} statusData={{ radio_enabled: false }} />
      );

      const stats = document.querySelectorAll('.audio-stat');
      const radioStat = stats[4];
      const value = radioStat.querySelector('.stat-value');
      expect(value).toHaveClass('text-red');
    });

    it('should display Disabled when statusData is null', () => {
      render(<AudioStatsBar statsData={defaultProps.statsData} statusData={null} />);

      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('should display Disabled when radio_enabled is undefined', () => {
      render(<AudioStatsBar statsData={defaultProps.statsData} statusData={{}} />);

      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });
  });

  describe('component structure', () => {
    it('should render with correct container class', () => {
      render(<AudioStatsBar {...defaultProps} />);

      const container = document.querySelector('.audio-stats-bar');
      expect(container).toBeInTheDocument();
    });

    it('should render 5 stat items', () => {
      render(<AudioStatsBar {...defaultProps} />);

      const stats = document.querySelectorAll('.audio-stat');
      expect(stats).toHaveLength(5);
    });

    it('should render icons for each stat', () => {
      render(<AudioStatsBar {...defaultProps} />);

      const icons = document.querySelectorAll('.audio-stat svg');
      expect(icons).toHaveLength(5);
    });

    it('should render stat values', () => {
      render(<AudioStatsBar {...defaultProps} />);

      const values = document.querySelectorAll('.stat-value');
      expect(values).toHaveLength(5);
    });

    it('should render stat labels', () => {
      render(<AudioStatsBar {...defaultProps} />);

      const labels = document.querySelectorAll('.stat-label');
      expect(labels).toHaveLength(5);
    });
  });

  describe('null/undefined data handling', () => {
    it('should handle completely null data gracefully', () => {
      render(<AudioStatsBar statsData={null} statusData={null} />);

      // Should not throw and render defaults
      expect(screen.getByText('Total')).toBeInTheDocument();
      expect(screen.getByText('Transcribed')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
      expect(screen.getByText('Duration')).toBeInTheDocument();
      expect(screen.getByText('Radio')).toBeInTheDocument();
    });

    it('should handle undefined data gracefully', () => {
      render(<AudioStatsBar statsData={undefined} statusData={undefined} />);

      expect(document.querySelector('.audio-stats-bar')).toBeInTheDocument();
    });
  });

  describe('large numbers', () => {
    it('should display large transmission counts', () => {
      render(
        <AudioStatsBar
          statsData={{
            total_transmissions: 999999,
            total_transcribed: 888888,
            pending_transcription: 11111,
            total_duration_hours: 1234.5,
          }}
          statusData={defaultProps.statusData}
        />
      );

      expect(screen.getByText('999999')).toBeInTheDocument();
      expect(screen.getByText('888888')).toBeInTheDocument();
      expect(screen.getByText('11111')).toBeInTheDocument();
      expect(screen.getByText('1234.5h')).toBeInTheDocument();
    });
  });
});
