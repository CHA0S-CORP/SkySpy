import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangePicker } from './DateRangePicker';

describe('DateRangePicker', () => {
  const defaultProps = {
    value: '24h',
    onChange: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onChange.mockClear();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic rendering', () => {
    it('should render trigger button', () => {
      render(<DateRangePicker {...defaultProps} />);

      expect(screen.getByRole('button', { name: /24 hours/i })).toBeInTheDocument();
    });

    it('should display current preset label', () => {
      render(<DateRangePicker {...defaultProps} value="1h" />);

      expect(screen.getByText('1 hour')).toBeInTheDocument();
    });

    it('should display custom range label when value is custom', () => {
      const customRange = {
        start: new Date('2024-01-01T00:00:00'),
        end: new Date('2024-01-07T23:59:00'),
      };

      render(<DateRangePicker value="custom" customRange={customRange} onChange={vi.fn()} />);

      // Should show date range in the trigger button
      const triggerButton = screen.getByRole('button');
      // The dates are formatted with toLocaleDateString, so check for presence of start date
      expect(triggerButton.textContent).toMatch(/2024|1\/1/);
    });

    it('should not show dropdown initially', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      expect(container.querySelector('.date-range-dropdown')).not.toBeInTheDocument();
    });
  });

  describe('dropdown behavior', () => {
    it('should open dropdown on trigger click', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));

      expect(container.querySelector('.date-range-dropdown')).toBeInTheDocument();
    });

    it('should close dropdown on second click', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      const trigger = container.querySelector('.date-range-trigger');
      fireEvent.click(trigger);
      expect(container.querySelector('.date-range-dropdown')).toBeInTheDocument();

      fireEvent.click(trigger);
      expect(container.querySelector('.date-range-dropdown')).not.toBeInTheDocument();
    });

    it('should close dropdown when clicking outside', () => {
      const { container } = render(
        <div>
          <DateRangePicker {...defaultProps} />
          <div data-testid="outside">Outside</div>
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      expect(container.querySelector('.date-range-dropdown')).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByTestId('outside'));

      expect(container.querySelector('.date-range-dropdown')).not.toBeInTheDocument();
    });

    it('should close dropdown on Escape key', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      expect(container.querySelector('.date-range-dropdown')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(container.querySelector('.date-range-dropdown')).not.toBeInTheDocument();
    });

    it('should rotate chevron when dropdown is open', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));

      expect(container.querySelector('svg.rotated')).toBeInTheDocument();
    });
  });

  describe('preset mode', () => {
    it('should show preset tab active by default', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));

      const presetsTab = container.querySelector('.date-range-tabs button.active');
      expect(presetsTab).toHaveTextContent('Presets');
    });

    it('should render all preset options', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      const trigger = container.querySelector('.date-range-trigger');
      fireEvent.click(trigger);

      // Check for preset buttons in the presets section
      const presetButtons = container.querySelectorAll('.preset-btn');
      expect(presetButtons.length).toBe(6);
      expect(screen.getByText('1 hour')).toBeInTheDocument();
      expect(screen.getByText('6 hours')).toBeInTheDocument();
      expect(screen.getByText('48 hours')).toBeInTheDocument();
      expect(screen.getByText('7 days')).toBeInTheDocument();
      expect(screen.getByText('30 days')).toBeInTheDocument();
    });

    it('should mark current preset as active', () => {
      const { container } = render(<DateRangePicker {...defaultProps} value="24h" />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));

      const activePreset = container.querySelector('.preset-btn.active');
      expect(activePreset).toHaveTextContent('24 hours');
    });

    it('should call onChange with preset when selected', () => {
      render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: '1 hour' }));

      expect(defaultProps.onChange).toHaveBeenCalledWith({
        preset: '1h',
        customRange: null,
      });
    });

    it('should close dropdown after selecting preset', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: '1 hour' }));

      expect(container.querySelector('.date-range-dropdown')).not.toBeInTheDocument();
    });
  });

  describe('custom mode', () => {
    it('should switch to custom tab when clicked', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /custom/i }));

      expect(container.querySelector('.date-range-custom')).toBeInTheDocument();
    });

    it('should render date and time inputs in custom mode', () => {
      render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /custom/i }));

      expect(screen.getByLabelText('Start')).toBeInTheDocument();
      expect(screen.getByLabelText('End')).toBeInTheDocument();
    });

    it('should render Apply and Cancel buttons', () => {
      render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /custom/i }));

      expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('should close dropdown when Cancel is clicked', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /custom/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(container.querySelector('.date-range-dropdown')).not.toBeInTheDocument();
    });

    it('should call onChange with custom range when Apply is clicked', () => {
      render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /custom/i }));

      // Set dates
      const startDateInput = screen.getByLabelText('Start');
      const endDateInput = screen.getByLabelText('End');

      fireEvent.change(startDateInput, { target: { value: '2024-01-01' } });
      fireEvent.change(endDateInput, { target: { value: '2024-01-07' } });

      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(defaultProps.onChange).toHaveBeenCalledWith({
        preset: 'custom',
        customRange: expect.objectContaining({
          start: expect.any(Date),
          end: expect.any(Date),
        }),
      });
    });

    it('should show alert when start date is after end date', () => {
      render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /custom/i }));

      // Set invalid dates (start after end)
      const startDateInput = screen.getByLabelText('Start');
      const endDateInput = screen.getByLabelText('End');

      fireEvent.change(startDateInput, { target: { value: '2024-01-10' } });
      fireEvent.change(endDateInput, { target: { value: '2024-01-01' } });

      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(window.alert).toHaveBeenCalledWith('Start date must be before end date');
      expect(defaultProps.onChange).not.toHaveBeenCalled();
    });

    it('should update start date when input changes', () => {
      render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /custom/i }));

      const startDateInput = screen.getByLabelText('Start');
      fireEvent.change(startDateInput, { target: { value: '2024-06-15' } });

      expect(startDateInput.value).toBe('2024-06-15');
    });

    it('should update end date when input changes', () => {
      render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /custom/i }));

      const endDateInput = screen.getByLabelText('End');
      fireEvent.change(endDateInput, { target: { value: '2024-06-20' } });

      expect(endDateInput.value).toBe('2024-06-20');
    });
  });

  describe('time inputs', () => {
    it('should render time inputs', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /custom/i }));

      const timeInputs = container.querySelectorAll('input[type="time"]');
      expect(timeInputs).toHaveLength(2);
    });

    it('should update time inputs', () => {
      const { container } = render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));
      fireEvent.click(screen.getByRole('button', { name: /custom/i }));

      const timeInputs = container.querySelectorAll('input[type="time"]');
      fireEvent.change(timeInputs[0], { target: { value: '09:30' } });
      fireEvent.change(timeInputs[1], { target: { value: '17:00' } });

      expect(timeInputs[0].value).toBe('09:30');
      expect(timeInputs[1].value).toBe('17:00');
    });
  });

  describe('initial custom range', () => {
    it('should start in custom mode when value is custom', () => {
      const customRange = {
        start: new Date('2024-01-01T00:00:00'),
        end: new Date('2024-01-07T23:59:00'),
      };

      const { container } = render(
        <DateRangePicker value="custom" customRange={customRange} onChange={vi.fn()} />
      );

      fireEvent.click(screen.getByRole('button'));

      // Should show custom tab as active
      const customTab = container.querySelector('.date-range-tabs button:last-child');
      expect(customTab).toHaveClass('active');
    });

    it('should initialize inputs with custom range values', () => {
      const customRange = {
        start: new Date('2024-01-01T09:30:00'),
        end: new Date('2024-01-07T17:00:00'),
      };

      render(<DateRangePicker value="custom" customRange={customRange} onChange={vi.fn()} />);

      fireEvent.click(screen.getByRole('button'));

      const startDateInput = screen.getByLabelText('Start');
      expect(startDateInput.value).toBe('2024-01-01');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined customRange', () => {
      render(<DateRangePicker {...defaultProps} value="custom" customRange={undefined} />);

      fireEvent.click(screen.getByRole('button'));

      // Should not crash and should show some default dates
      expect(screen.getByLabelText('Start')).toBeInTheDocument();
    });

    it('should handle unknown preset value', () => {
      render(<DateRangePicker {...defaultProps} value="unknown" />);

      // Should display the value as-is
      expect(screen.getByText('unknown')).toBeInTheDocument();
    });

    it('should handle onChange being undefined', () => {
      render(<DateRangePicker value="24h" onChange={undefined} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));

      // Should not crash when clicking preset without onChange
      expect(() => {
        fireEvent.click(screen.getByRole('button', { name: '1 hour' }));
      }).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const { unmount } = render(<DateRangePicker {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /24 hours/i }));

      unmount();

      // Should have removed both mousedown and keydown listeners
      expect(removeEventListenerSpy).toHaveBeenCalled();

      removeEventListenerSpy.mockRestore();
    });
  });
});
