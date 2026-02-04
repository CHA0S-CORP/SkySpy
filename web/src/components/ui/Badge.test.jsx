import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge';

describe('Badge', () => {
  describe('basic rendering', () => {
    it('should render children', () => {
      render(<Badge>Test Badge</Badge>);

      expect(screen.getByText('Test Badge')).toBeInTheDocument();
    });

    it('should render as a span element', () => {
      render(<Badge>Badge</Badge>);

      expect(screen.getByText('Badge').tagName).toBe('SPAN');
    });

    it('should apply base styles', () => {
      const { container } = render(<Badge>Badge</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('inline-flex');
      expect(badge).toHaveClass('items-center');
      expect(badge).toHaveClass('justify-center');
      expect(badge).toHaveClass('rounded-full');
    });
  });

  describe('variants', () => {
    it('should render default variant', () => {
      const { container } = render(<Badge variant="default">Default</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-accent-cyan/10');
      expect(badge).toHaveClass('text-accent-cyan');
    });

    it('should render military variant', () => {
      const { container } = render(<Badge variant="military">Military</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-accent-red/10');
      expect(badge).toHaveClass('text-accent-red');
    });

    it('should render success variant', () => {
      const { container } = render(<Badge variant="success">Success</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-accent-green/10');
      expect(badge).toHaveClass('text-accent-green');
    });

    it('should render warning variant', () => {
      const { container } = render(<Badge variant="warning">Warning</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-accent-yellow/10');
      expect(badge).toHaveClass('text-accent-yellow');
    });

    it('should render source variant', () => {
      const { container } = render(<Badge variant="source">Source</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-white/5');
      expect(badge).toHaveClass('text-text-secondary');
    });

    it('should render faa variant', () => {
      const { container } = render(<Badge variant="faa">FAA</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-blue-500/10');
      expect(badge).toHaveClass('text-blue-400');
    });

    it('should render adsbx variant', () => {
      const { container } = render(<Badge variant="adsbx">ADSBx</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-purple-500/10');
      expect(badge).toHaveClass('text-purple-400');
    });

    it('should render tar1090 variant', () => {
      const { container } = render(<Badge variant="tar1090">tar1090</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-green-500/10');
      expect(badge).toHaveClass('text-green-400');
    });

    it('should render opensky variant', () => {
      const { container } = render(<Badge variant="opensky">OpenSky</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-orange-500/10');
      expect(badge).toHaveClass('text-orange-400');
    });

    it('should render hexdb variant', () => {
      const { container } = render(<Badge variant="hexdb">HexDB</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-pink-500/10');
      expect(badge).toHaveClass('text-pink-400');
    });

    it('should render adsblol variant', () => {
      const { container } = render(<Badge variant="adsblol">ADSBLol</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-teal-500/10');
      expect(badge).toHaveClass('text-teal-400');
    });

    it('should render planespotters variant', () => {
      const { container } = render(<Badge variant="planespotters">Planespotters</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-yellow-500/10');
      expect(badge).toHaveClass('text-yellow-400');
    });

    it('should use default variant when none specified', () => {
      const { container } = render(<Badge>No Variant</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('bg-accent-cyan/10');
    });
  });

  describe('sizes', () => {
    it('should render default size', () => {
      const { container } = render(<Badge size="default">Default Size</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('text-xs');
      expect(badge).toHaveClass('px-2.5');
      expect(badge).toHaveClass('py-0.5');
    });

    it('should render sm size', () => {
      const { container } = render(<Badge size="sm">Small</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('text-[10px]');
      expect(badge).toHaveClass('px-2');
    });

    it('should render lg size', () => {
      const { container } = render(<Badge size="lg">Large</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('text-sm');
      expect(badge).toHaveClass('px-3');
      expect(badge).toHaveClass('py-1');
    });

    it('should use default size when none specified', () => {
      const { container } = render(<Badge>No Size</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('text-xs');
      expect(badge).toHaveClass('px-2.5');
    });
  });

  describe('custom props', () => {
    it('should apply custom className', () => {
      const { container } = render(<Badge className="my-custom-class">Custom</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('my-custom-class');
    });

    it('should merge custom className with variant classes', () => {
      const { container } = render(
        <Badge variant="success" className="extra-class">
          Merged
        </Badge>
      );

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('extra-class');
      expect(badge).toHaveClass('bg-accent-green/10');
    });

    it('should pass through HTML attributes', () => {
      render(<Badge data-testid="custom-badge">With Attribute</Badge>);

      expect(screen.getByTestId('custom-badge')).toBeInTheDocument();
    });

    it('should pass through onClick handler', () => {
      const onClick = vi.fn();
      render(<Badge onClick={onClick}>Clickable</Badge>);

      screen.getByText('Clickable').click();

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should pass through id', () => {
      render(<Badge id="my-badge">With ID</Badge>);

      expect(document.getElementById('my-badge')).toBeInTheDocument();
    });
  });

  describe('transition styles', () => {
    it('should have transition classes', () => {
      const { container } = render(<Badge>Transition</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('transition-colors');
      expect(badge).toHaveClass('duration-200');
    });
  });

  describe('border styles', () => {
    it('should have border class for default variant', () => {
      const { container } = render(<Badge variant="default">Bordered</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('border');
      expect(badge).toHaveClass('border-accent-cyan/20');
    });

    it('should have border class for source variants', () => {
      const { container } = render(<Badge variant="faa">FAA</Badge>);

      const badge = container.querySelector('span');
      expect(badge).toHaveClass('border');
      expect(badge).toHaveClass('border-blue-500/20');
    });
  });

  describe('combining variant and size', () => {
    it('should apply both variant and size styles', () => {
      const { container } = render(
        <Badge variant="military" size="lg">
          Combined
        </Badge>
      );

      const badge = container.querySelector('span');
      // Variant styles
      expect(badge).toHaveClass('bg-accent-red/10');
      expect(badge).toHaveClass('text-accent-red');
      // Size styles
      expect(badge).toHaveClass('text-sm');
      expect(badge).toHaveClass('px-3');
    });
  });
});
