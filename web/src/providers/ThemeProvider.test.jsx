import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme, V2_THEMES } from './ThemeProvider';

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      {V2_THEMES.map((t) => (
        <button key={t} onClick={() => setTheme(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    // test setup.js replaces localStorage with vi.fn() stubs — configure, don't rely on storage
    localStorage.getItem.mockReset().mockReturnValue(null);
    localStorage.setItem.mockReset();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to radar with no data-theme attribute', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByTestId('theme').textContent).toBe('radar');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('applies and persists a selected theme', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByText('amber'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber');
    expect(localStorage.setItem).toHaveBeenCalledWith('skyspy-theme', 'amber');
  });

  it('restores persisted theme and clears attribute back on radar', () => {
    localStorage.getItem.mockReturnValue('slate');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('slate');
    fireEvent.click(screen.getByText('radar'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
