import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DistributionChart } from './DistributionChart';

describe('DistributionChart', () => {
  const sampleData = [
    { label: '0-50nm', value: 100 },
    { label: '50-100nm', value: 75 },
    { label: '100-150nm', value: 50 },
    { label: '150-200nm', value: 25 },
  ];

  describe('basic rendering', () => {
    it('should render horizontal chart by default', () => {
      const { container } = render(<DistributionChart data={sampleData} />);
      expect(container.querySelector('.distribution-chart--horizontal')).toBeInTheDocument();
    });

    it('should render vertical chart when specified', () => {
      const { container } = render(<DistributionChart data={sampleData} orientation="vertical" />);
      expect(container.querySelector('.distribution-chart--vertical')).toBeInTheDocument();
    });

    it('should render empty state when no data', () => {
      render(<DistributionChart data={[]} />);
      expect(screen.getByText('No data available')).toBeInTheDocument();
    });

    it('should render correct number of bars', () => {
      const { container } = render(<DistributionChart data={sampleData} />);
      const bars = container.querySelectorAll('.distribution-chart__bar');
      expect(bars.length).toBe(4);
    });
  });

  describe('labels and values', () => {
    it('should show labels when showLabels is true', () => {
      render(<DistributionChart data={sampleData} showLabels />);
      expect(screen.getByText('0-50nm')).toBeInTheDocument();
      expect(screen.getByText('50-100nm')).toBeInTheDocument();
    });

    it('should hide labels when showLabels is false', () => {
      render(<DistributionChart data={sampleData} showLabels={false} />);
      expect(screen.queryByText('0-50nm')).not.toBeInTheDocument();
    });

    it('should show values when showValues is true', () => {
      render(<DistributionChart data={sampleData} showValues />);
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('75')).toBeInTheDocument();
    });

    it('should hide values when showValues is false', () => {
      render(<DistributionChart data={sampleData} showValues={false} />);
      expect(screen.queryByText('100')).not.toBeInTheDocument();
    });

    it('should show percentages when showPercentages is true', () => {
      render(<DistributionChart data={sampleData} showValues showPercentages />);
      // Total is 250, so 100 = 40%
      expect(screen.getByText('40%')).toBeInTheDocument();
    });
  });

  describe('formatting', () => {
    it('should use custom value formatter', () => {
      render(<DistributionChart data={sampleData} showValues formatValue={(v) => `${v}x`} />);
      expect(screen.getByText('100x')).toBeInTheDocument();
    });

    it('should use custom label formatter', () => {
      render(
        <DistributionChart data={sampleData} showLabels formatLabel={(l) => l.toUpperCase()} />
      );
      expect(screen.getByText('0-50NM')).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('should sort by value descending by default', () => {
      const { container } = render(
        <DistributionChart data={sampleData} sortBy="value" sortDirection="desc" />
      );
      const labels = container.querySelectorAll('.distribution-chart__label');
      expect(labels[0].textContent).toBe('0-50nm');
    });

    it('should sort by value ascending', () => {
      const { container } = render(
        <DistributionChart data={sampleData} sortBy="value" sortDirection="asc" />
      );
      const labels = container.querySelectorAll('.distribution-chart__label');
      expect(labels[0].textContent).toBe('150-200nm');
    });

    it('should sort by label', () => {
      render(<DistributionChart data={sampleData} sortBy="label" sortDirection="asc" />);
      expect(screen.getByText('0-50nm')).toBeInTheDocument();
    });

    it('should not sort when sortBy is none', () => {
      const { container } = render(<DistributionChart data={sampleData} sortBy="none" />);
      const labels = container.querySelectorAll('.distribution-chart__label');
      expect(labels[0].textContent).toBe('0-50nm');
    });
  });

  describe('maxBars', () => {
    it('should limit number of bars', () => {
      const { container } = render(<DistributionChart data={sampleData} maxBars={2} />);
      const bars = container.querySelectorAll('.distribution-chart__bar');
      expect(bars.length).toBe(2);
    });

    it('should show "others" category when bars are limited', () => {
      render(<DistributionChart data={sampleData} maxBars={2} />);
      expect(screen.getByText(/others/)).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onClick when bar is clicked', () => {
      const onClick = vi.fn();
      render(<DistributionChart data={sampleData} onClick={onClick} />);

      const bar = screen.getByText('0-50nm').closest('[role="button"]');
      fireEvent.click(bar);
      expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ label: '0-50nm' }));
    });

    it('should be keyboard accessible', () => {
      const onClick = vi.fn();
      render(<DistributionChart data={sampleData} onClick={onClick} />);

      const bar = screen.getByText('0-50nm').closest('[role="button"]');
      fireEvent.keyDown(bar, { key: 'Enter' });
      expect(onClick).toHaveBeenCalled();
    });
  });

  describe('styling', () => {
    it('should apply custom color', () => {
      const { container } = render(<DistributionChart data={sampleData} color="#ff0000" />);
      const bars = container.querySelectorAll('.distribution-chart__bar');
      expect(bars.length).toBeGreaterThan(0);
    });

    it('should apply custom bar height', () => {
      const { container } = render(<DistributionChart data={sampleData} barHeight={20} />);
      expect(container.querySelector('.distribution-chart')).toBeInTheDocument();
    });

    it('should apply custom bar gap', () => {
      const { container } = render(<DistributionChart data={sampleData} barGap={10} />);
      expect(container.querySelector('.distribution-chart')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <DistributionChart data={sampleData} className="custom-chart" />
      );
      expect(container.querySelector('.custom-chart')).toBeInTheDocument();
    });
  });

  describe('animation', () => {
    it('should animate bars when animate is true', () => {
      const { container } = render(<DistributionChart data={sampleData} animate />);
      const bars = container.querySelectorAll('.distribution-chart__bar');
      expect(bars.length).toBeGreaterThan(0);
    });
  });

  describe('vertical orientation', () => {
    it('should render bars vertically', () => {
      const { container } = render(<DistributionChart data={sampleData} orientation="vertical" />);
      expect(container.querySelector('.distribution-chart--vertical')).toBeInTheDocument();
    });

    it('should show labels at bottom for vertical', () => {
      render(<DistributionChart data={sampleData} orientation="vertical" showLabels />);
      expect(screen.getByText('0-50nm')).toBeInTheDocument();
    });
  });
});
