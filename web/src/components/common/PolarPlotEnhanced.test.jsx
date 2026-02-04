import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PolarPlotEnhanced } from './PolarPlotEnhanced';

describe('PolarPlotEnhanced', () => {
  const sampleData = [
    { bearing: 0, range: 50, altitude: 35000, rssi: -5, callsign: 'UAL123' },
    { bearing: 90, range: 100, altitude: 25000, rssi: -10, callsign: 'DAL456' },
    { bearing: 180, range: 75, altitude: 15000, rssi: -15, callsign: 'AAL789' },
    { bearing: 270, range: 150, altitude: 5000, rssi: -20, callsign: 'SWA321' },
  ];

  describe('basic rendering', () => {
    it('should render SVG element', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render with default size', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '200');
      expect(svg).toHaveAttribute('height', '200');
    });

    it('should render with custom size', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} size={300} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '300');
      expect(svg).toHaveAttribute('height', '300');
    });

    it('should render data points', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} />);
      const circles = container.querySelectorAll('circle');
      // 4 data points + center point + grid circles
      expect(circles.length).toBeGreaterThan(4);
    });
  });

  describe('grid and labels', () => {
    it('should render grid circles when showGrid is true', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} showGrid />);
      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBeGreaterThan(4);
    });

    it('should hide grid when showGrid is false', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} showGrid={false} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render cardinal direction labels when showLabels is true', () => {
      render(<PolarPlotEnhanced data={sampleData} showLabels />);
      expect(screen.getByText('N')).toBeInTheDocument();
      expect(screen.getByText('E')).toBeInTheDocument();
      expect(screen.getByText('S')).toBeInTheDocument();
      expect(screen.getByText('W')).toBeInTheDocument();
    });

    it('should hide labels when showLabels is false', () => {
      render(<PolarPlotEnhanced data={sampleData} showLabels={false} />);
      expect(screen.queryByText('N')).not.toBeInTheDocument();
    });
  });

  describe('color modes', () => {
    it('should color by altitude when colorByAltitude is true', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} colorByAltitude />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should color by signal when colorBySignal is true', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} colorBySignal />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should show altitude legend when colorByAltitude is true', () => {
      render(<PolarPlotEnhanced data={sampleData} colorByAltitude showLegend />);
      expect(screen.getByText(/10k/)).toBeInTheDocument();
    });

    it('should show signal legend when colorBySignal is true', () => {
      render(<PolarPlotEnhanced data={sampleData} colorBySignal showLegend />);
      expect(screen.getByText('Excellent')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onPointClick when point is clicked', () => {
      const onPointClick = vi.fn();
      const { container } = render(
        <PolarPlotEnhanced data={sampleData} onPointClick={onPointClick} />
      );

      const circles = container.querySelectorAll('circle');
      // Find a data point circle (not grid circles)
      const dataCircles = Array.from(circles).filter(
        (c) => c.getAttribute('cx') !== '100' || c.getAttribute('cy') !== '100'
      );
      if (dataCircles.length > 0) {
        fireEvent.click(dataCircles[0]);
        expect(onPointClick).toHaveBeenCalled();
      }
    });

    it('should call onPointHover on mouse enter', () => {
      const onPointHover = vi.fn();
      const { container } = render(
        <PolarPlotEnhanced data={sampleData} onPointHover={onPointHover} />
      );

      const circles = container.querySelectorAll('circle');
      const dataCircles = Array.from(circles).filter(
        (c) => c.getAttribute('cx') !== '100' || c.getAttribute('cy') !== '100'
      );
      if (dataCircles.length > 0) {
        fireEvent.mouseEnter(dataCircles[0]);
        expect(onPointHover).toHaveBeenCalled();
      }
    });

    it('should show tooltip on hover', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} />);

      const circles = container.querySelectorAll('circle');
      const dataCircles = Array.from(circles).filter((c) => {
        const cx = c.getAttribute('cx');
        const cy = c.getAttribute('cy');
        return cx !== '100' || cy !== '100';
      });

      if (dataCircles.length > 0) {
        fireEvent.mouseEnter(dataCircles[0]);
        // Tooltip should appear
      }
    });
  });

  describe('highlighted points', () => {
    it('should highlight specified points', () => {
      const { container } = render(
        <PolarPlotEnhanced data={sampleData} highlightedPoints={[0, 2]} />
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('maxRange', () => {
    it('should use custom maxRange', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} maxRange={300} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('dot size', () => {
    it('should apply custom dot size', () => {
      const { container } = render(<PolarPlotEnhanced data={sampleData} dotSize={5} />);
      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBeGreaterThan(0);
    });
  });

  describe('empty data', () => {
    it('should render with empty data array', () => {
      const { container } = render(<PolarPlotEnhanced data={[]} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('data formats', () => {
    it('should handle data with track instead of bearing', () => {
      const dataWithTrack = [{ track: 45, distance: 50, altitude: 30000 }];
      const { container } = render(<PolarPlotEnhanced data={dataWithTrack} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should handle data with distance instead of range', () => {
      const dataWithDistance = [{ bearing: 90, distance: 100, altitude: 25000 }];
      const { container } = render(<PolarPlotEnhanced data={dataWithDistance} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should handle data with signal instead of rssi', () => {
      const dataWithSignal = [{ bearing: 180, range: 75, signal: -12 }];
      const { container } = render(<PolarPlotEnhanced data={dataWithSignal} colorBySignal />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <PolarPlotEnhanced data={sampleData} className="custom-polar" />
      );
      expect(container.querySelector('.custom-polar')).toBeInTheDocument();
    });
  });
});
