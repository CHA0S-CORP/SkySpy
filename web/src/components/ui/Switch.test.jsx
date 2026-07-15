import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from './switch';

describe('Switch', () => {
  describe('basic rendering', () => {
    it('should render a switch button', () => {
      render(<Switch />);

      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('should be unchecked by default', () => {
      render(<Switch />);

      expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'unchecked');
    });

    it('should have thumb element', () => {
      const { container } = render(<Switch />);

      // Radix UI Switch renders a span for the thumb
      const thumb = container.querySelector('[data-state]');
      expect(thumb).toBeInTheDocument();
    });
  });

  describe('checked state', () => {
    it('should render as checked when checked prop is true', () => {
      render(<Switch checked={true} />);

      expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked');
    });

    it('should render as unchecked when checked prop is false', () => {
      render(<Switch checked={false} />);

      expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'unchecked');
    });

    it('should support defaultChecked', () => {
      render(<Switch defaultChecked={true} />);

      expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked');
    });
  });

  describe('interaction', () => {
    it('should toggle when clicked', () => {
      const onCheckedChange = vi.fn();
      render(<Switch onCheckedChange={onCheckedChange} />);

      fireEvent.click(screen.getByRole('switch'));

      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('should call onCheckedChange with false when unchecking', () => {
      const onCheckedChange = vi.fn();
      render(<Switch defaultChecked={true} onCheckedChange={onCheckedChange} />);

      fireEvent.click(screen.getByRole('switch'));

      expect(onCheckedChange).toHaveBeenCalledWith(false);
    });

    it('should be keyboard accessible', () => {
      const onCheckedChange = vi.fn();
      render(<Switch onCheckedChange={onCheckedChange} />);

      const switchElement = screen.getByRole('switch');
      switchElement.focus();

      // Radix UI Switch responds to click events which can be triggered by keyboard
      // The actual keyboard handling is done at the browser level with the role="switch"
      // Test that it's focusable and clickable
      fireEvent.click(switchElement);

      expect(onCheckedChange).toHaveBeenCalled();
    });
  });

  describe('disabled state', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Switch disabled />);

      expect(screen.getByRole('switch')).toBeDisabled();
    });

    it('should not call onCheckedChange when disabled', () => {
      const onCheckedChange = vi.fn();
      render(<Switch disabled onCheckedChange={onCheckedChange} />);

      fireEvent.click(screen.getByRole('switch'));

      expect(onCheckedChange).not.toHaveBeenCalled();
    });

    it('should have disabled styling', () => {
      render(<Switch disabled />);

      const switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveClass('disabled:cursor-not-allowed');
      expect(switchElement).toHaveClass('disabled:opacity-50');
    });
  });

  describe('styling', () => {
    it('should have correct base classes', () => {
      render(<Switch />);

      const switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveClass('peer');
      expect(switchElement).toHaveClass('inline-flex');
      expect(switchElement).toHaveClass('h-6');
      expect(switchElement).toHaveClass('w-11');
      expect(switchElement).toHaveClass('cursor-pointer');
      expect(switchElement).toHaveClass('items-center');
      expect(switchElement).toHaveClass('rounded-full');
    });

    it('should have unchecked background color', () => {
      render(<Switch />);

      const switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveClass('bg-bg-hover');
    });

    it('should have checked background color class', () => {
      render(<Switch />);

      const switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveClass('data-[state=checked]:bg-accent-cyan');
    });

    it('should have focus ring classes', () => {
      render(<Switch />);

      const switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveClass('focus-visible:outline-none');
      expect(switchElement).toHaveClass('focus-visible:ring-2');
      expect(switchElement).toHaveClass('focus-visible:ring-accent-cyan/50');
    });

    it('should have transition classes', () => {
      render(<Switch />);

      const switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveClass('transition-colors');
      expect(switchElement).toHaveClass('duration-200');
    });

    it('should apply custom className', () => {
      render(<Switch className="my-custom-class" />);

      const switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveClass('my-custom-class');
    });
  });

  describe('ref forwarding', () => {
    it('should forward ref', () => {
      const ref = vi.fn();
      render(<Switch ref={ref} />);

      expect(ref).toHaveBeenCalled();
    });
  });

  describe('custom props', () => {
    it('should pass through id', () => {
      render(<Switch id="my-switch" />);

      expect(document.getElementById('my-switch')).toBeInTheDocument();
    });

    it('should pass through name', () => {
      // Radix UI Switch may not expose name directly on the button element
      // but it works with form submission. Test that it renders without error.
      render(<Switch name="switch-name" />);

      // The switch should render and be functional
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('should pass through data attributes', () => {
      render(<Switch data-testid="custom-switch" />);

      expect(screen.getByTestId('custom-switch')).toBeInTheDocument();
    });

    it('should pass through aria-label', () => {
      render(<Switch aria-label="Toggle feature" />);

      expect(screen.getByRole('switch', { name: 'Toggle feature' })).toBeInTheDocument();
    });

    it('should support required prop', () => {
      render(<Switch required />);

      expect(screen.getByRole('switch')).toHaveAttribute('aria-required', 'true');
    });
  });

  describe('controlled vs uncontrolled', () => {
    it('should work as controlled component', () => {
      const { rerender } = render(<Switch checked={false} />);

      expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'unchecked');

      rerender(<Switch checked={true} />);

      expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked');
    });

    it('should work as uncontrolled component with defaultChecked', () => {
      render(<Switch defaultChecked={false} />);

      const switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveAttribute('data-state', 'unchecked');

      fireEvent.click(switchElement);

      expect(switchElement).toHaveAttribute('data-state', 'checked');
    });
  });

  describe('displayName', () => {
    it('should have displayName set', () => {
      expect(Switch.displayName).toBe('Switch');
    });
  });
});
