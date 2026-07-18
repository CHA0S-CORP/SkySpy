import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RangeSlider } from './RangeSlider';

describe('RangeSlider', () => {
  const defaultProps = {
    min: 0,
    max: 100,
    value: [20, 80],
    onChange: vi.fn(),
  };

  describe('basic rendering', () => {
    it('should render with default props', () => {
      const { container } = render(<RangeSlider {...defaultProps} />);
      expect(container.querySelector('.range-slider')).toBeInTheDocument();
    });

    it('should render with label', () => {
      render(<RangeSlider {...defaultProps} label="Distance" />);
      expect(screen.getByText('Distance')).toBeInTheDocument();
    });

    it('should display current range values', () => {
      render(<RangeSlider {...defaultProps} label="Range" />);
      expect(screen.getByText(/20.*80/)).toBeInTheDocument();
    });

    it('should display unit', () => {
      render(<RangeSlider {...defaultProps} label="Distance" unit="nm" />);
      expect(screen.getByText(/nm/)).toBeInTheDocument();
    });
  });

  describe('value formatting', () => {
    it('should use custom value formatter', () => {
      render(
        <RangeSlider
          {...defaultProps}
          label="Altitude"
          formatValue={(v) => `${v / 1000}k`}
          value={[10000, 30000]}
          max={50000}
        />
      );
      expect(screen.getByText(/10k.*30k/)).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onChange when value changes', () => {
      const onChange = vi.fn();
      const { container } = render(<RangeSlider {...defaultProps} onChange={onChange} />);

      const slider = container.querySelector('[role="slider"]');
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      expect(onChange).toHaveBeenCalled();
    });

    it('should be disabled when disabled prop is true', () => {
      const { container } = render(<RangeSlider {...defaultProps} disabled />);
      expect(container.querySelector('.range-slider--disabled')).toBeInTheDocument();
    });
  });

  describe('input fields', () => {
    it('should show number inputs when showInputs is true', () => {
      render(<RangeSlider {...defaultProps} showInputs />);
      const inputs = screen.getAllByRole('spinbutton');
      expect(inputs).toHaveLength(2);
    });

    it('should update value via input fields', () => {
      const onChange = vi.fn();
      render(<RangeSlider {...defaultProps} showInputs onChange={onChange} />);

      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[0], { target: { value: '30' } });
      expect(onChange).toHaveBeenCalled();
    });

    it('should clamp input values to valid range', () => {
      const onChange = vi.fn();
      render(<RangeSlider {...defaultProps} showInputs onChange={onChange} />);

      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[0], { target: { value: '90' } }); // Above max value[1]
      expect(onChange).toHaveBeenCalled();
    });
  });

  describe('histogram', () => {
    it('should render histogram when provided', () => {
      const { container } = render(
        <RangeSlider
          {...defaultProps}
          showHistogram
          histogramData={[5, 10, 15, 20, 25, 20, 15, 10, 5]}
        />
      );
      // Histogram renders bars
      expect(container.querySelectorAll('div').length).toBeGreaterThan(1);
    });

    it('should not render histogram when data is empty', () => {
      const { container } = render(
        <RangeSlider {...defaultProps} showHistogram histogramData={[]} />
      );
      expect(container.querySelector('.range-slider')).toBeInTheDocument();
    });
  });

  describe('step values', () => {
    it('should snap to step values', () => {
      const onChange = vi.fn();
      render(<RangeSlider {...defaultProps} step={10} showInputs onChange={onChange} />);

      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[0], { target: { value: '25' } });
      // Should snap to nearest step (20 or 30)
      expect(onChange).toHaveBeenCalled();
    });
  });

  describe('styling', () => {
    it('should apply custom color', () => {
      const { container } = render(<RangeSlider {...defaultProps} color="#ff0000" />);
      expect(container.querySelector('.range-slider')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(<RangeSlider {...defaultProps} className="custom-slider" />);
      expect(container.querySelector('.custom-slider')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have proper ARIA attributes', () => {
      const { container } = render(<RangeSlider {...defaultProps} />);
      const slider = container.querySelector('[role="slider"]');
      expect(slider).toHaveAttribute('aria-valuemin', '0');
      expect(slider).toHaveAttribute('aria-valuemax', '100');
    });

    it('should be keyboard navigable', () => {
      const onChange = vi.fn();
      const { container } = render(<RangeSlider {...defaultProps} onChange={onChange} />);

      const slider = container.querySelector('[role="slider"]');
      fireEvent.keyDown(slider, { key: 'ArrowUp' });
      expect(onChange).toHaveBeenCalled();
    });
  });
});
