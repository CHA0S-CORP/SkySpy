import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExternalLinks } from './ExternalLinks';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  ExternalLink: () => <span data-testid="external-link-icon">ExternalLink</span>,
}));

describe('ExternalLinks', () => {
  const defaultProps = {
    hex: 'abc123',
    callsign: 'UAL123',
  };

  describe('rendering', () => {
    it('should render navigation element with correct aria label', () => {
      render(<ExternalLinks {...defaultProps} />);

      expect(screen.getByRole('navigation', { name: /external resources/i })).toBeInTheDocument();
    });

    it('should render all external links', () => {
      render(<ExternalLinks {...defaultProps} />);

      expect(screen.getByRole('link', { name: /flightaware/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /adsbexchange/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /flightradar24/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /planespotters/i })).toBeInTheDocument();
    });

    it('should render external link icons', () => {
      render(<ExternalLinks {...defaultProps} />);

      const icons = screen.getAllByTestId('external-link-icon');
      expect(icons).toHaveLength(4); // One for each link
    });
  });

  describe('link URLs', () => {
    it('should use callsign in FlightAware URL when available', () => {
      render(<ExternalLinks {...defaultProps} />);

      const flightAwareLink = screen.getByRole('link', { name: /flightaware/i });
      expect(flightAwareLink).toHaveAttribute(
        'href',
        'https://flightaware.com/live/flight/UAL123'
      );
    });

    it('should use hex in FlightAware URL when callsign is not available', () => {
      render(<ExternalLinks hex="abc123" callsign={null} />);

      const flightAwareLink = screen.getByRole('link', { name: /flightaware/i });
      expect(flightAwareLink).toHaveAttribute(
        'href',
        'https://flightaware.com/live/flight/abc123'
      );
    });

    it('should use hex in ADSBexchange URL', () => {
      render(<ExternalLinks {...defaultProps} />);

      const adsbLink = screen.getByRole('link', { name: /adsbexchange/i });
      expect(adsbLink).toHaveAttribute(
        'href',
        'https://globe.adsbexchange.com/?icao=abc123'
      );
    });

    it('should use hex in Flightradar24 URL', () => {
      render(<ExternalLinks {...defaultProps} />);

      const fr24Link = screen.getByRole('link', { name: /flightradar24/i });
      expect(fr24Link).toHaveAttribute(
        'href',
        'https://www.flightradar24.com/abc123'
      );
    });

    it('should use hex in Planespotters URL', () => {
      render(<ExternalLinks {...defaultProps} />);

      const planespottersLink = screen.getByRole('link', { name: /planespotters/i });
      expect(planespottersLink).toHaveAttribute(
        'href',
        'https://planespotters.net/hex/abc123'
      );
    });
  });

  describe('URL encoding', () => {
    it('should encode special characters in callsign', () => {
      render(<ExternalLinks hex="abc123" callsign="UAL 123" />);

      const flightAwareLink = screen.getByRole('link', { name: /flightaware/i });
      expect(flightAwareLink).toHaveAttribute(
        'href',
        'https://flightaware.com/live/flight/UAL%20123'
      );
    });

    it('should encode special characters in hex', () => {
      render(<ExternalLinks hex="ab&c123" callsign={null} />);

      const adsbLink = screen.getByRole('link', { name: /adsbexchange/i });
      expect(adsbLink).toHaveAttribute(
        'href',
        'https://globe.adsbexchange.com/?icao=ab%26c123'
      );
    });
  });

  describe('link attributes', () => {
    it('should open links in new tab', () => {
      render(<ExternalLinks {...defaultProps} />);

      const links = screen.getAllByRole('link');
      links.forEach((link) => {
        expect(link).toHaveAttribute('target', '_blank');
      });
    });

    it('should have noopener noreferrer for security', () => {
      render(<ExternalLinks {...defaultProps} />);

      const links = screen.getAllByRole('link');
      links.forEach((link) => {
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      });
    });
  });

  describe('accessibility', () => {
    it('should have descriptive aria labels indicating new tab', () => {
      render(<ExternalLinks {...defaultProps} />);

      expect(
        screen.getByRole('link', { name: /view on flightaware.*opens in new tab/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /view on adsbexchange.*opens in new tab/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /view on flightradar24.*opens in new tab/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /view on planespotters.*opens in new tab/i })
      ).toBeInTheDocument();
    });

    it('should render external link icons', () => {
      render(<ExternalLinks {...defaultProps} />);

      // Each link should have an icon
      const icons = screen.getAllByTestId('external-link-icon');
      expect(icons.length).toBe(4);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined callsign', () => {
      render(<ExternalLinks hex="abc123" callsign={undefined} />);

      const flightAwareLink = screen.getByRole('link', { name: /flightaware/i });
      expect(flightAwareLink).toHaveAttribute(
        'href',
        'https://flightaware.com/live/flight/abc123'
      );
    });

    it('should handle empty callsign string', () => {
      render(<ExternalLinks hex="abc123" callsign="" />);

      const flightAwareLink = screen.getByRole('link', { name: /flightaware/i });
      // Empty string is falsy, so should use hex
      expect(flightAwareLink).toHaveAttribute(
        'href',
        'https://flightaware.com/live/flight/abc123'
      );
    });

    it('should render with uppercase hex', () => {
      render(<ExternalLinks hex="ABC123" callsign={null} />);

      const planespottersLink = screen.getByRole('link', { name: /planespotters/i });
      expect(planespottersLink).toHaveAttribute(
        'href',
        'https://planespotters.net/hex/ABC123'
      );
    });
  });

  describe('link count', () => {
    it('should render exactly 4 external links', () => {
      render(<ExternalLinks {...defaultProps} />);

      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(4);
    });
  });
});
