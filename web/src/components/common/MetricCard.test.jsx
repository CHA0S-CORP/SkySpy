import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetricCard } from './MetricCard';

describe('MetricCard', () => {
  describe('basic rendering', () => {
    it('should render label and value', () => {
      render(<MetricCard label="Sessions" value={100} />);
      expect(screen.getByText('Sessions')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('should render with unit', () => {
      render(<MetricCard label="Duration" value={45} unit="min" />);
      expect(screen.getByText('45')).toBeInTheDocument();
      expect(screen.getByText('min')).toBeInTheDocument();
    });

    it('should render with icon', () => {
      render(<MetricCard label="Test" value={10} icon={<span data-testid="icon">📊</span>} />);
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('should format numeric values with locale', () => {
      render(<MetricCard label="Count" value={1000000} />);
      expect(screen.getByText('1,000,000')).toBeInTheDocument();
    });

    it('should use custom value formatter', () => {
      render(
        <MetricCard
          label="Price"
          value={99.99}
          valueFormatter={(v) => `$${v.toFixed(2)}`}
        />
      );
      expect(screen.getByText('$99.99')).toBeInTheDocument();
    });
  });

  describe('trend indicator', () => {
    it('should show positive trend', () => {
      render(<MetricCard label="Sales" value={100} trend={15.5} />);
      expect(screen.getByText(/15\.5%/)).toBeInTheDocument();
      expect(screen.getByText('↑')).toBeInTheDocument();
    });

    it('should show negative trend', () => {
      render(<MetricCard label="Errors" value={50} trend={-10.2} />);
      expect(screen.getByText(/10\.2%/)).toBeInTheDocument();
      expect(screen.getByText('↓')).toBeInTheDocument();
    });

    it('should calculate trend from previous value', () => {
      render(<MetricCard label="Users" value={120} previousValue={100} />);
      expect(screen.getByText(/20\.0%/)).toBeInTheDocument();
    });

    it('should show neutral trend for zero change', () => {
      render(<MetricCard label="Stable" value={100} trend={0} />);
      expect(screen.getByText('→')).toBeInTheDocument();
    });
  });

  describe('sizes', () => {
    it('should render compact size', () => {
      const { container } = render(<MetricCard label="Test" value={10} size="compact" />);
      expect(container.querySelector('.metric-card--compact')).toBeInTheDocument();
    });

    it('should render normal size', () => {
      const { container } = render(<MetricCard label="Test" value={10} size="normal" />);
      expect(container.querySelector('.metric-card--normal')).toBeInTheDocument();
    });

    it('should render large size', () => {
      const { container } = render(<MetricCard label="Test" value={10} size="large" />);
      expect(container.querySelector('.metric-card--large')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('should render loading skeleton', () => {
      const { container } = render(<MetricCard label="Test" value={10} loading />);
      expect(container.querySelector('.metric-card--loading')).toBeInTheDocument();
    });

    it('should not show value when loading', () => {
      render(<MetricCard label="Test" value={10} loading />);
      expect(screen.queryByText('10')).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onClick when clicked', () => {
      const handleClick = vi.fn();
      render(<MetricCard label="Clickable" value={5} onClick={handleClick} />);
      fireEvent.click(screen.getByText('Clickable').closest('.metric-card'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should be keyboard accessible when clickable', () => {
      const handleClick = vi.fn();
      render(<MetricCard label="Keyboard" value={5} onClick={handleClick} />);
      const card = screen.getByText('Keyboard').closest('.metric-card');
      fireEvent.keyDown(card, { key: 'Enter' });
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should not be clickable when onClick not provided', () => {
      const { container } = render(<MetricCard label="Static" value={5} />);
      expect(container.querySelector('.metric-card--clickable')).not.toBeInTheDocument();
    });
  });

  describe('sparkline integration', () => {
    it('should render sparkline with trend data', () => {
      const { container } = render(
        <MetricCard label="Activity" value={100} trendData={[10, 20, 30, 40, 50]} />
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should support different sparkline types', () => {
      const { container } = render(
        <MetricCard label="Bars" value={50} trendData={[1, 2, 3]} trendType="bar" />
      );
      expect(container.querySelector('rect')).toBeInTheDocument();
    });
  });

  describe('custom styling', () => {
    it('should apply custom color', () => {
      const { container } = render(
        <MetricCard label="Custom" value={10} color="#ff0000" />
      );
      expect(container.querySelector('.metric-card')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <MetricCard label="Test" value={10} className="my-custom-card" />
      );
      expect(container.querySelector('.my-custom-card')).toBeInTheDocument();
    });
  });
});
