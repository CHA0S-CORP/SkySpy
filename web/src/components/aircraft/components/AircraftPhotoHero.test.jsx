import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AircraftPhotoHero } from './AircraftPhotoHero';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Camera: () => <span data-testid="camera-icon">Camera</span>,
  RefreshCw: () => <span data-testid="refresh-icon">RefreshCw</span>,
  Radar: () => <span data-testid="radar-icon">Radar</span>,
}));

describe('AircraftPhotoHero', () => {
  const defaultProps = {
    hex: 'abc123',
    info: {
      registration: 'N12345',
      type_name: 'Boeing 737-800',
      operator: 'United Airlines',
    },
    photoInfo: {
      photo_url: 'https://example.com/photo.jpg',
      thumbnail_url: 'https://example.com/thumb.jpg',
      photographer: 'Test Photographer',
      source: 'planespotters.net',
    },
    photoUrl: 'https://example.com/photo.jpg',
    photoState: 'loaded',
    photoRetryCount: 0,
    useThumbnail: false,
    photoStatus: null,
    onPhotoLoad: vi.fn(),
    onPhotoError: vi.fn(),
    onRetry: vi.fn(),
  };

  describe('loading state', () => {
    it('should render loading indicator when photoState is loading', () => {
      render(<AircraftPhotoHero {...defaultProps} photoState="loading" />);

      expect(screen.getByText('Loading photo...')).toBeInTheDocument();
      expect(screen.getByTestId('radar-icon')).toBeInTheDocument();
    });

    it('should render aircraft silhouette watermark when loading', () => {
      const { container } = render(<AircraftPhotoHero {...defaultProps} photoState="loading" />);

      expect(container.querySelector('.photo-silhouette-watermark')).toBeInTheDocument();
      expect(container.querySelector('.aircraft-silhouette')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should render error message when photoState is error', () => {
      render(<AircraftPhotoHero {...defaultProps} photoState="error" />);

      expect(screen.getByText('No photo available')).toBeInTheDocument();
      expect(screen.getByTestId('camera-icon')).toBeInTheDocument();
    });

    it('should render retry button when in error state', () => {
      render(<AircraftPhotoHero {...defaultProps} photoState="error" />);

      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('should call onRetry when retry button is clicked', () => {
      const mockOnRetry = vi.fn();
      render(<AircraftPhotoHero {...defaultProps} photoState="error" onRetry={mockOnRetry} />);

      fireEvent.click(screen.getByRole('button', { name: /retry/i }));

      expect(mockOnRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('loaded state', () => {
    it('should render photo when photoState is loaded', () => {
      render(<AircraftPhotoHero {...defaultProps} />);

      const img = screen.getByAltText(/aircraft/i);
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg');
    });

    it('should set opacity to 1 when loaded', () => {
      render(<AircraftPhotoHero {...defaultProps} />);

      const img = screen.getByAltText(/aircraft/i);
      expect(img).toHaveStyle({ opacity: 1 });
    });

    it('should render photo credit when photographer is available', () => {
      render(<AircraftPhotoHero {...defaultProps} />);

      expect(screen.getByText(/Test Photographer/)).toBeInTheDocument();
      expect(screen.getByText(/planespotters.net/)).toBeInTheDocument();
    });

    it('should use default source when not specified', () => {
      const propsWithoutSource = {
        ...defaultProps,
        photoInfo: { ...defaultProps.photoInfo, source: null },
      };

      render(<AircraftPhotoHero {...propsWithoutSource} />);

      expect(screen.getByText(/planespotters.net/)).toBeInTheDocument();
    });

    it('should not render photo credit when photographer is not available', () => {
      const propsWithoutPhotographer = {
        ...defaultProps,
        photoInfo: { ...defaultProps.photoInfo, photographer: null },
      };

      render(<AircraftPhotoHero {...propsWithoutPhotographer} />);

      expect(screen.queryByText(/via/)).not.toBeInTheDocument();
    });

    it('should render refresh button when loaded', () => {
      render(<AircraftPhotoHero {...defaultProps} />);

      expect(screen.getByRole('button', { name: /refresh photo/i })).toBeInTheDocument();
    });

    it('should call onRetry when refresh button is clicked', () => {
      const mockOnRetry = vi.fn();
      render(<AircraftPhotoHero {...defaultProps} onRetry={mockOnRetry} />);

      fireEvent.click(screen.getByRole('button', { name: /refresh photo/i }));

      expect(mockOnRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('overlay card', () => {
    it('should render overlay card when loaded', () => {
      const { container } = render(<AircraftPhotoHero {...defaultProps} />);

      expect(container.querySelector('.photo-overlay-card')).toBeInTheDocument();
    });

    it('should display type name in overlay', () => {
      render(<AircraftPhotoHero {...defaultProps} />);

      expect(screen.getByText('Boeing 737-800')).toBeInTheDocument();
    });

    it('should display operator in overlay', () => {
      render(<AircraftPhotoHero {...defaultProps} />);

      expect(screen.getByText('United Airlines')).toBeInTheDocument();
    });

    it('should not display type when not available', () => {
      const propsWithoutType = {
        ...defaultProps,
        info: { ...defaultProps.info, type_name: null },
      };

      render(<AircraftPhotoHero {...propsWithoutType} />);

      expect(screen.queryByText('Boeing 737-800')).not.toBeInTheDocument();
    });
  });

  describe('photo events', () => {
    it('should call onPhotoLoad when image loads', () => {
      const mockOnPhotoLoad = vi.fn();
      render(<AircraftPhotoHero {...defaultProps} onPhotoLoad={mockOnPhotoLoad} />);

      const img = screen.getByAltText(/aircraft/i);
      fireEvent.load(img);

      expect(mockOnPhotoLoad).toHaveBeenCalledTimes(1);
    });

    it('should call onPhotoError when image fails to load', () => {
      const mockOnPhotoError = vi.fn();
      render(<AircraftPhotoHero {...defaultProps} onPhotoError={mockOnPhotoError} />);

      const img = screen.getByAltText(/aircraft/i);
      fireEvent.error(img);

      expect(mockOnPhotoError).toHaveBeenCalledTimes(1);
    });
  });

  describe('photo status message', () => {
    it('should display status message when provided', () => {
      const propsWithStatus = {
        ...defaultProps,
        photoStatus: { type: 'info', message: 'Using cached photo' },
      };

      render(<AircraftPhotoHero {...propsWithStatus} />);

      expect(screen.getByText('Using cached photo')).toBeInTheDocument();
    });

    it('should apply correct class for status type', () => {
      const propsWithWarning = {
        ...defaultProps,
        photoStatus: { type: 'warning', message: 'Low quality image' },
      };

      const { container } = render(<AircraftPhotoHero {...propsWithWarning} />);

      expect(container.querySelector('.photo-status-warning')).toBeInTheDocument();
    });

    it('should not render status when not provided', () => {
      const { container } = render(<AircraftPhotoHero {...defaultProps} />);

      expect(container.querySelector('.photo-status')).not.toBeInTheDocument();
    });
  });

  describe('image key for re-rendering', () => {
    it('should include retry count in image key', () => {
      const { rerender } = render(<AircraftPhotoHero {...defaultProps} photoRetryCount={0} />);

      let img = screen.getByAltText(/aircraft/i);
      expect(img).toBeInTheDocument();

      rerender(<AircraftPhotoHero {...defaultProps} photoRetryCount={1} />);

      // The component re-renders with new key based on retry count
      img = screen.getByAltText(/aircraft/i);
      expect(img).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have correct img role and alt text', () => {
      render(<AircraftPhotoHero {...defaultProps} />);

      const container = screen.getByRole('img', { name: /photo of aircraft/i });
      expect(container).toHaveAttribute('aria-label', 'Photo of aircraft N12345');
    });

    it('should use hex as fallback in alt text when no registration', () => {
      const propsWithoutRegistration = {
        ...defaultProps,
        info: { ...defaultProps.info, registration: null },
      };

      render(<AircraftPhotoHero {...propsWithoutRegistration} />);

      const container = screen.getByRole('img', { name: /photo of aircraft abc123/i });
      expect(container).toBeInTheDocument();
    });

    it('should have accessible retry button in error state', () => {
      render(<AircraftPhotoHero {...defaultProps} photoState="error" />);

      expect(screen.getByRole('button', { name: /retry loading photo/i })).toBeInTheDocument();
    });

    it('should have live region for status messages', () => {
      const propsWithStatus = {
        ...defaultProps,
        photoStatus: { type: 'info', message: 'Photo updated' },
      };

      render(<AircraftPhotoHero {...propsWithStatus} />);

      const statusRegion = screen.getByRole('status');
      expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('edge cases', () => {
    it('should handle null photoUrl', () => {
      const propsWithNullUrl = {
        ...defaultProps,
        photoUrl: null,
      };

      render(<AircraftPhotoHero {...propsWithNullUrl} />);

      // Should render without crashing (no img element when photoUrl is null)
      expect(screen.queryByAltText(/aircraft/i)).not.toBeInTheDocument();
    });

    it('should handle null info', () => {
      const propsWithNullInfo = {
        ...defaultProps,
        info: null,
      };

      render(<AircraftPhotoHero {...propsWithNullInfo} />);

      const container = screen.getByRole('img', { name: /photo of aircraft abc123/i });
      expect(container).toBeInTheDocument();
    });

    it('should handle thumbnail mode', () => {
      const propsWithThumbnail = {
        ...defaultProps,
        useThumbnail: true,
        photoUrl: 'https://example.com/thumb.jpg',
      };

      render(<AircraftPhotoHero {...propsWithThumbnail} />);

      const img = screen.getByAltText(/aircraft/i);
      expect(img).toHaveAttribute('src', 'https://example.com/thumb.jpg');
    });
  });
});
