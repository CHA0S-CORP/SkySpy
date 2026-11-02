import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiveRadioPanel } from './LiveRadioPanel';

beforeEach(() => {
  const storage = new Map();
  localStorage.getItem.mockImplementation((key) => storage.get(key) ?? null);
  localStorage.setItem.mockImplementation((key, value) => storage.set(key, value));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
    fireEvent.playing(this);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function addRadio(key, label) {
  fireEvent.change(screen.getByLabelText('Stream URL'), { target: { value: key } });
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: label } });
  fireEvent.click(screen.getByText('Add radio'));
}

describe('live radios', () => {
  it('starts empty without automatically playing audio', () => {
    const { container } = render(<LiveRadioPanel />);
    expect(container.querySelectorAll('audio')).toHaveLength(0);
    expect(screen.getByText(/No radios added/)).toBeTruthy();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it('plays simultaneous feeds with independent volume and disconnects on stop/removal', () => {
    const { container } = render(<LiveRadioPanel />);
    addRadio('https://radio.example.org/tower', 'Tower');
    addRadio('https://radio.example.org/ground?token=abc', 'Ground');
    fireEvent.click(screen.getByRole('button', { name: 'Play Tower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play Ground' }));
    const [tower, ground] = container.querySelectorAll('audio');
    expect(tower.src).toBe('https://radio.example.org/tower');
    expect(ground.src).toBe('https://radio.example.org/ground?token=abc');
    fireEvent.change(screen.getByLabelText('Ground volume'), { target: { value: '20' } });
    expect(ground.volume).toBe(0.2);
    expect(tower.volume).toBe(0.7);
    fireEvent.click(screen.getByRole('button', { name: 'Stop Tower' }));
    expect(tower.hasAttribute('src')).toBe(false);
    expect(ground.hasAttribute('src')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ground' }));
    expect(ground.hasAttribute('src')).toBe(false);
  });

  it('persists selection and volume without restoring playback', () => {
    const first = render(<LiveRadioPanel />);
    addRadio('https://radio.example.org/ground?token=abc', 'Ground');
    fireEvent.change(screen.getByLabelText('Ground volume'), { target: { value: '0' } });
    first.unmount();
    const second = render(<LiveRadioPanel />);
    expect(screen.getByLabelText('Ground volume').value).toBe('0');
    expect(
      [...second.container.querySelectorAll('audio')].every((audio) => !audio.hasAttribute('src'))
    ).toBe(true);
  });

  it('rejects unsafe URLs and duplicates, and allows retry after playback fails', async () => {
    render(<LiveRadioPanel />);
    addRadio('javascript:alert(1)', 'Invalid');
    expect(screen.getByRole('alert').textContent).toContain('HTTP or HTTPS');
    addRadio('https://radio.example.org/tower', 'Tower');
    addRadio('https://radio.example.org/tower', 'Duplicate');
    expect(screen.getByRole('alert').textContent).toContain('already');
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Play Tower' }));
    await waitFor(() => expect(screen.getByText(/Unable to play/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Play Tower' }));
    expect(screen.getByRole('button', { name: 'Stop Tower' })).toBeTruthy();
  });
});
