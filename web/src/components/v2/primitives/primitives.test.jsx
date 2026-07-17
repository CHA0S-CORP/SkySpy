import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Icon } from './Icon';
import { ICONS } from './icons';
import { Card } from './Card';
import { Chip } from './Chip';
import { Switch } from './Switch';
import { SegmentedControl } from './SegmentedControl';
import { Tabs } from './Tabs';
import { Select } from './Select';
import { EmptyState } from './EmptyState';
import { StatCard } from './StatCard';
import { Sparkline } from './Sparkline';
import { Gauge } from './Gauge';
import { ToastHost, toast } from './Toast';

describe('Icon', () => {
  it('renders known icons with feather-style attrs', () => {
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('1.7');
    expect(svg.getAttribute('fill')).toBe('none');
  });

  it('renders null for unknown icon', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(<Icon name="nope-not-real" />);
    expect(container.querySelector('svg')).toBeNull();
    warn.mockRestore();
  });

  it('every registry entry renders', () => {
    for (const name of Object.keys(ICONS)) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg'), name).toBeTruthy();
      unmount();
    }
  });
});

describe('Card / Chip / StatCard / EmptyState', () => {
  it('Card applies variant and accent bar', () => {
    const { container } = render(<Card variant="raised" accentColor="#f00" />);
    const el = container.firstChild;
    expect(el.className).toContain('v2-card--raised');
    expect(el.className).toContain('v2-card--accent-left');
    expect(el.style.getPropertyValue('--v2-accent-bar')).toBe('#f00');
  });

  it('Chip renders button when interactive and toggles aria-pressed', () => {
    const onClick = vi.fn();
    render(
      <Chip onClick={onClick} active color="#0f0">
        Military
      </Chip>
    );
    const btn = screen.getByRole('button', { name: 'Military' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('StatCard shows label, value, sub', () => {
    render(<StatCard label="Aircraft" value="142" sub="+3" />);
    expect(screen.getByText('Aircraft')).toBeTruthy();
    expect(screen.getByText('142')).toBeTruthy();
    expect(screen.getByText('+3')).toBeTruthy();
  });

  it('EmptyState renders icon + message', () => {
    render(<EmptyState icon="radar" message="No sessions in range" />);
    expect(screen.getByText('No sessions in range')).toBeTruthy();
  });
});

describe('Switch', () => {
  it('toggles via click and keyboard', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} label="Enable rule" />);
    const sw = screen.getByRole('switch', { name: 'Enable rule' });
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects checked state', () => {
    render(<Switch checked onCheckedChange={() => {}} label="On" />);
    expect(screen.getByRole('switch').getAttribute('data-state')).toBe('checked');
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'info', label: 'Info' },
    { value: 'warn', label: 'Warning' },
    { value: 'crit', label: 'Critical' },
  ];

  it('selects on click', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="info" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Critical' }));
    expect(onChange).toHaveBeenCalledWith('crit');
  });

  it('arrow keys cycle', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="crit" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Critical' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('info');
  });
});

describe('Tabs', () => {
  const tabs = [
    { value: 'rules', label: 'Rules' },
    { value: 'history', label: 'History' },
  ];

  it('marks active tab and switches', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="rules" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(onChange).toHaveBeenCalledWith('history');
  });
});

describe('Select', () => {
  it('renders native select with options', () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Priority"
        value="all"
        onChange={onChange}
        options={[
          { value: 'all', label: 'All Priorities' },
          { value: 'crit', label: 'Critical' },
        ]}
      />
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), {
      target: { value: 'crit' },
    });
    expect(onChange).toHaveBeenCalledWith('crit');
  });
});

describe('Sparkline', () => {
  it('renders a polyline spanning the series', () => {
    const { container } = render(<Sparkline data={[1, 5, 3, 8]} width={100} height={30} />);
    const line = container.querySelector('polyline');
    expect(line).toBeTruthy();
    expect(line.getAttribute('points').split(' ')).toHaveLength(4);
  });

  it('renders nothing for short series', () => {
    const { container } = render(<Sparkline data={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('Gauge', () => {
  it('clamps and exposes progressbar semantics', () => {
    render(<Gauge label="CPU" value={130} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows latest message and auto-dismisses', () => {
    render(<ToastHost />);
    act(() => toast('First'));
    act(() => toast('Rule created'));
    expect(screen.getByTestId('v2-toast').textContent).toContain('Rule created');
    expect(screen.queryByText('First')).toBeNull();
    act(() => vi.advanceTimersByTime(2300));
    expect(screen.queryByTestId('v2-toast')).toBeNull();
  });
});
