import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sparkline } from './Sparkline';

describe('Sparkline', () => {
  describe('basic rendering', () => {
    it('should render with numeric data array', () => {
      const { container } = render(<Sparkline data={[1, 2, 3, 4, 5]} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render empty state when no data provided', () => {
      render(<Sparkline data={[]} />);
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('should render empty state when data is undefined', () => {
      render(<Sparkline />);
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('should handle object data with value property', () => {
      const data = [{ value: 10 }, { value: 20 }, { value: 30 }];
      const { container } = render(<Sparkline data={data} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should handle object data with y property', () => {
      const data = [{ y: 10 }, { y: 20 }, { y: 30 }];
      const { container } = render(<Sparkline data={data} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('chart types', () => {
    it('should render line type by default', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} type="line" />);
      expect(container.querySelector('polyline')).toBeInTheDocument();
    });

    it('should render area type with gradient fill', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} type="area" />);
      expect(container.querySelector('path')).toBeInTheDocument();
      expect(container.querySelector('polyline')).toBeInTheDocument();
    });

    it('should render bar type with rectangles', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} type="bar" />);
      expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
    });
  });

  describe('dimensions', () => {
    it('should apply custom width and height', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} width={100} height={50} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '100');
      expect(svg).toHaveAttribute('height', '50');
    });

    it('should use default dimensions when not specified', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '80');
      expect(svg).toHaveAttribute('height', '24');
    });
  });

  describe('styling', () => {
    it('should apply custom color', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} color="#ff0000" />);
      const polyline = container.querySelector('polyline');
      expect(polyline).toHaveAttribute('stroke', '#ff0000');
    });

    it('should apply custom stroke width', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} strokeWidth={3} />);
      const polyline = container.querySelector('polyline');
      expect(polyline).toHaveAttribute('stroke-width', '3');
    });

    it('should apply custom className', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} className="custom-class" />);
      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });
  });

  describe('features', () => {
    it('should show min/max markers when enabled', () => {
      const { container } = render(<Sparkline data={[1, 5, 2, 8, 3]} showMinMax />);
      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBe(2);
    });

    it('should show last value when enabled', () => {
      render(<Sparkline data={[1, 2, 3, 4, 5]} showLastValue />);
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should format last value with custom formatter', () => {
      render(<Sparkline data={[100, 200, 300]} showLastValue valueFormatter={(v) => `$${v}`} />);
      expect(screen.getByText('$300')).toBeInTheDocument();
    });
  });

  describe('bar chart specific', () => {
    it('should handle negative values in bar chart', () => {
      const { container } = render(<Sparkline data={[-5, 10, -3, 8]} type="bar" />);
      expect(container.querySelectorAll('rect').length).toBe(4);
    });

    it('should apply negative color for negative values', () => {
      const { container } = render(
        <Sparkline data={[-5, 10]} type="bar" negativeColor="#ff0000" />
      );
      const rects = container.querySelectorAll('rect');
      expect(rects.length).toBe(2);
    });

    it('should apply custom bar gap', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} type="bar" barGap={5} />);
      expect(container.querySelectorAll('rect').length).toBe(3);
    });
  });
});
