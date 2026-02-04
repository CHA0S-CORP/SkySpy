import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HorizontalBarChart, LiveSparkline } from './StatsCharts';

describe('HorizontalBarChart', () => {
  const mockData = [
    { label: 'A320', count: 150, pct: 30 },
    { label: 'B737', count: 120, pct: 24 },
    { label: 'A350', count: 80, pct: 16 },
    { label: 'B777', count: 50, pct: 10 },
    { label: 'E190', count: 100, pct: 20 },
  ];

  describe('rendering', () => {
    it('should render null when data is empty', () => {
      const { container } = render(<HorizontalBarChart data={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('should render null when data is null', () => {
      const { container } = render(<HorizontalBarChart data={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('should render null when data is undefined', () => {
      const { container } = render(<HorizontalBarChart />);
      expect(container.firstChild).toBeNull();
    });

    it('should render the chart with data', () => {
      render(<HorizontalBarChart data={mockData} />);
      expect(screen.getByText('A320')).toBeInTheDocument();
      expect(screen.getByText('B737')).toBeInTheDocument();
    });

    it('should render title when provided', () => {
      render(<HorizontalBarChart title="Aircraft Types" data={mockData} />);
      expect(screen.getByText('Aircraft Types')).toBeInTheDocument();
    });

    it('should not render title when not provided', () => {
      const { container } = render(<HorizontalBarChart data={mockData} />);
      expect(container.querySelector('.bar-chart-title')).toBeNull();
    });
  });

  describe('data display', () => {
    it('should sort data by count descending', () => {
      const { container } = render(<HorizontalBarChart data={mockData} />);
      const items = container.querySelectorAll('.bar-item');
      // First item should be A320 (highest count: 150)
      expect(items[0]).toHaveTextContent('A320');
      expect(items[0]).toHaveTextContent('150');
    });

    it('should limit items based on maxItems prop', () => {
      render(<HorizontalBarChart data={mockData} maxItems={3} />);
      expect(screen.getByText('A320')).toBeInTheDocument();
      expect(screen.getByText('B737')).toBeInTheDocument();
      // E190 should be third after sorting
      expect(screen.getByText('E190')).toBeInTheDocument();
      // A350 and B777 should not appear (lower counts)
      expect(screen.queryByText('B777')).not.toBeInTheDocument();
    });

    it('should display percentage when showPercentage is true', () => {
      render(<HorizontalBarChart data={mockData} showPercentage={true} />);
      expect(screen.getByText('30%')).toBeInTheDocument();
    });

    it('should not display percentage when showPercentage is false', () => {
      render(<HorizontalBarChart data={mockData} showPercentage={false} />);
      expect(screen.queryByText('30%')).not.toBeInTheDocument();
    });
  });

  describe('fallback labels', () => {
    it('should use name property when label is not available', () => {
      const dataWithName = [{ name: 'TestName', count: 100 }];
      render(<HorizontalBarChart data={dataWithName} />);
      expect(screen.getByText('TestName')).toBeInTheDocument();
    });

    it('should use type property when label and name are not available', () => {
      const dataWithType = [{ type: 'TestType', count: 100 }];
      render(<HorizontalBarChart data={dataWithType} />);
      expect(screen.getByText('TestType')).toBeInTheDocument();
    });
  });

  describe('bar width calculation', () => {
    it('should set first bar to 100% width (highest count)', () => {
      const { container } = render(<HorizontalBarChart data={mockData} />);
      const fills = container.querySelectorAll('.bar-item-fill');
      // First item (A320) should have 100% width
      expect(fills[0].style.width).toBe('100%');
    });

    it('should calculate relative widths based on max count', () => {
      const simpleData = [
        { label: 'First', count: 100 },
        { label: 'Second', count: 50 },
      ];
      const { container } = render(<HorizontalBarChart data={simpleData} />);
      const fills = container.querySelectorAll('.bar-item-fill');
      expect(fills[0].style.width).toBe('100%');
      expect(fills[1].style.width).toBe('50%');
    });
  });

  describe('custom colors', () => {
    it('should apply custom color when provided in data', () => {
      const dataWithColor = [{ label: 'Test', count: 100, color: '#ff0000' }];
      const { container } = render(<HorizontalBarChart data={dataWithColor} />);
      const fill = container.querySelector('.bar-item-fill');
      expect(fill.style.backgroundColor).toBe('rgb(255, 0, 0)');
    });
  });
});

describe('LiveSparkline', () => {
  const mockData = [{ count: 10 }, { count: 15 }, { count: 12 }, { count: 18 }, { count: 20 }];

  describe('rendering', () => {
    it('should render empty state when data is empty', () => {
      render(<LiveSparkline data={[]} valueKey="count" color="#00c8ff" label="Test" />);
      expect(screen.getByText('Test')).toBeInTheDocument();
      expect(screen.getByText('--')).toBeInTheDocument();
    });

    it('should render empty state when data is null', () => {
      render(<LiveSparkline data={null} valueKey="count" color="#00c8ff" label="Test" />);
      expect(screen.getByText('--')).toBeInTheDocument();
    });

    it('should render the sparkline with data', () => {
      render(<LiveSparkline data={mockData} valueKey="count" color="#00c8ff" label="Aircraft" />);
      expect(screen.getByText('Aircraft')).toBeInTheDocument();
    });

    it('should render SVG element', () => {
      const { container } = render(
        <LiveSparkline data={mockData} valueKey="count" color="#00c8ff" label="Test" />
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('value display', () => {
    it('should display currentValue when provided', () => {
      render(
        <LiveSparkline
          data={mockData}
          valueKey="count"
          color="#00c8ff"
          label="Test"
          currentValue={25}
        />
      );
      expect(screen.getByText('25')).toBeInTheDocument();
    });

    it('should display last value from data when currentValue is not provided', () => {
      render(<LiveSparkline data={mockData} valueKey="count" color="#00c8ff" label="Test" />);
      // Last value is 20
      expect(screen.getByText('20')).toBeInTheDocument();
    });

    it('should display unit when provided', () => {
      const { container } = render(
        <LiveSparkline
          data={mockData}
          valueKey="count"
          color="#00c8ff"
          label="Test"
          currentValue={100}
          unit=" msg/s"
        />
      );
      const unitSpan = container.querySelector('.sparkline-unit');
      expect(unitSpan).toBeInTheDocument();
      expect(unitSpan.textContent).toBe(' msg/s');
    });
  });

  describe('single data point handling', () => {
    it('should render a circle for single data point', () => {
      const singleData = [{ count: 50 }];
      const { container } = render(
        <LiveSparkline data={singleData} valueKey="count" color="#00c8ff" label="Test" />
      );
      expect(container.querySelector('circle')).toBeInTheDocument();
      // Should not have polyline for single point
      expect(container.querySelector('polyline')).not.toBeInTheDocument();
    });

    it('should display value for single data point', () => {
      const singleData = [{ count: 50 }];
      render(<LiveSparkline data={singleData} valueKey="count" color="#00c8ff" label="Test" />);
      expect(screen.getByText('50')).toBeInTheDocument();
    });
  });

  describe('SVG elements', () => {
    it('should render polyline for multiple data points', () => {
      const { container } = render(
        <LiveSparkline data={mockData} valueKey="count" color="#00c8ff" label="Test" />
      );
      expect(container.querySelector('polyline')).toBeInTheDocument();
    });

    it('should render polygon for area fill', () => {
      const { container } = render(
        <LiveSparkline data={mockData} valueKey="count" color="#00c8ff" label="Test" />
      );
      expect(container.querySelector('polygon')).toBeInTheDocument();
    });

    it('should render end circle indicator', () => {
      const { container } = render(
        <LiveSparkline data={mockData} valueKey="count" color="#00c8ff" label="Test" />
      );
      expect(container.querySelector('circle')).toBeInTheDocument();
    });

    it('should apply correct color to stroke', () => {
      const { container } = render(
        <LiveSparkline data={mockData} valueKey="count" color="#ff0000" label="Test" />
      );
      const polyline = container.querySelector('polyline');
      expect(polyline).toHaveAttribute('stroke', '#ff0000');
    });

    it('should apply correct color to fill polygon', () => {
      const { container } = render(
        <LiveSparkline data={mockData} valueKey="count" color="#ff0000" label="Test" />
      );
      const polygon = container.querySelector('polygon');
      expect(polygon).toHaveAttribute('fill', '#ff0000');
    });
  });

  describe('custom valueKey', () => {
    it('should extract values using custom valueKey', () => {
      const customData = [{ messages: 100 }, { messages: 200 }];
      render(<LiveSparkline data={customData} valueKey="messages" color="#00c8ff" label="Test" />);
      expect(screen.getByText('200')).toBeInTheDocument();
    });

    it('should handle missing values gracefully', () => {
      const dataWithMissing = [{ count: 10 }, { other: 20 }, { count: 30 }];
      const { container } = render(
        <LiveSparkline data={dataWithMissing} valueKey="count" color="#00c8ff" label="Test" />
      );
      // Should still render without crashing
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('height prop', () => {
    it('should use default height of 60', () => {
      const { container } = render(
        <LiveSparkline data={mockData} valueKey="count" color="#00c8ff" label="Test" />
      );
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('viewBox', '0 0 200 60');
    });

    it('should use custom height when provided', () => {
      const { container } = render(
        <LiveSparkline data={mockData} valueKey="count" color="#00c8ff" label="Test" height={100} />
      );
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('viewBox', '0 0 200 100');
    });
  });
});
