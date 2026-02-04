import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';

// Mock the saveConfig function
vi.mock('../../utils/config', () => ({
  saveConfig: vi.fn(),
}));

describe('SettingsModal', () => {
  const defaultConfig = {
    apiBaseUrl: 'http://localhost:8000',
    mapMode: 'pro',
    mapDarkMode: true,
  };

  const defaultProps = {
    config: defaultConfig,
    setConfig: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('should render the modal overlay', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(document.querySelector('.modal-overlay')).toBeInTheDocument();
    });

    it('should render the modal dialog', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should render the modal title', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('should render close button', () => {
      render(<SettingsModal {...defaultProps} />);
      const closeButton = screen.getByRole('button', { name: '' }); // X button has no text
      expect(closeButton).toBeInTheDocument();
    });

    it('should render API Configuration section', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(screen.getByText('API Configuration')).toBeInTheDocument();
    });

    it('should render Map Display section', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(screen.getByText('Map Display')).toBeInTheDocument();
    });

    it('should render API Base URL input', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(screen.getByLabelText('API Base URL')).toBeInTheDocument();
    });

    it('should render Map Mode select', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(screen.getByLabelText('Map Mode')).toBeInTheDocument();
    });

    it('should render Map Theme select', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(screen.getByLabelText('Map Theme')).toBeInTheDocument();
    });

    it('should render Cancel button', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('should render Save Settings button', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(screen.getByText('Save Settings')).toBeInTheDocument();
    });
  });

  describe('form values', () => {
    it('should display current API Base URL', () => {
      render(<SettingsModal {...defaultProps} />);
      const input = screen.getByLabelText('API Base URL');
      expect(input.value).toBe('http://localhost:8000');
    });

    it('should display current Map Mode', () => {
      render(<SettingsModal {...defaultProps} />);
      const select = screen.getByLabelText('Map Mode');
      expect(select.value).toBe('pro');
    });

    it('should display Dark Mode for mapDarkMode=true', () => {
      render(<SettingsModal {...defaultProps} />);
      const select = screen.getByLabelText('Map Theme');
      expect(select.value).toBe('dark');
    });

    it('should display Light Mode for mapDarkMode=false', () => {
      render(<SettingsModal {...defaultProps} config={{ ...defaultConfig, mapDarkMode: false }} />);
      const select = screen.getByLabelText('Map Theme');
      expect(select.value).toBe('light');
    });
  });

  describe('form interactions', () => {
    it('should update API Base URL when typed', () => {
      render(<SettingsModal {...defaultProps} />);
      const input = screen.getByLabelText('API Base URL');

      fireEvent.change(input, { target: { value: 'http://new-api.com' } });

      expect(input.value).toBe('http://new-api.com');
    });

    it('should update Map Mode when changed', () => {
      render(<SettingsModal {...defaultProps} />);
      const select = screen.getByLabelText('Map Mode');

      fireEvent.change(select, { target: { value: 'radar' } });

      expect(select.value).toBe('radar');
    });

    it('should update Map Theme when changed', () => {
      render(<SettingsModal {...defaultProps} />);
      const select = screen.getByLabelText('Map Theme');

      fireEvent.change(select, { target: { value: 'light' } });

      expect(select.value).toBe('light');
    });

    it('should have all Map Mode options', () => {
      render(<SettingsModal {...defaultProps} />);
      const select = screen.getByLabelText('Map Mode');

      expect(select.querySelector('option[value="pro"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="radar"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="crt"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="map"]')).toBeInTheDocument();
    });
  });

  describe('save functionality', () => {
    it('should call setConfig with form values when saved', async () => {
      const setConfig = vi.fn();
      const { saveConfig } = await import('../../utils/config');

      render(<SettingsModal {...defaultProps} setConfig={setConfig} />);

      // Change a value
      const input = screen.getByLabelText('API Base URL');
      fireEvent.change(input, { target: { value: 'http://new-api.com' } });

      // Click save
      fireEvent.click(screen.getByText('Save Settings'));

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          apiBaseUrl: 'http://new-api.com',
        })
      );
    });

    it('should call saveConfig when saved', async () => {
      const { saveConfig } = await import('../../utils/config');

      render(<SettingsModal {...defaultProps} />);
      fireEvent.click(screen.getByText('Save Settings'));

      expect(saveConfig).toHaveBeenCalled();
    });

    it('should call onClose after saving', () => {
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByText('Save Settings'));

      expect(onClose).toHaveBeenCalled();
    });

    it('should save mapDarkMode as true for dark theme', () => {
      const setConfig = vi.fn();
      render(
        <SettingsModal
          {...defaultProps}
          setConfig={setConfig}
          config={{ ...defaultConfig, mapDarkMode: false }}
        />
      );

      const select = screen.getByLabelText('Map Theme');
      fireEvent.change(select, { target: { value: 'dark' } });
      fireEvent.click(screen.getByText('Save Settings'));

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mapDarkMode: true,
        })
      );
    });

    it('should save mapDarkMode as false for light theme', () => {
      const setConfig = vi.fn();
      render(<SettingsModal {...defaultProps} setConfig={setConfig} />);

      const select = screen.getByLabelText('Map Theme');
      fireEvent.change(select, { target: { value: 'light' } });
      fireEvent.click(screen.getByText('Save Settings'));

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          mapDarkMode: false,
        })
      );
    });
  });

  describe('cancel functionality', () => {
    it('should call onClose when Cancel is clicked', () => {
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByText('Cancel'));

      expect(onClose).toHaveBeenCalled();
    });

    it('should not call setConfig when Cancel is clicked', () => {
      const setConfig = vi.fn();
      render(<SettingsModal {...defaultProps} setConfig={setConfig} />);

      // Make a change
      const input = screen.getByLabelText('API Base URL');
      fireEvent.change(input, { target: { value: 'http://changed.com' } });

      // Cancel
      fireEvent.click(screen.getByText('Cancel'));

      expect(setConfig).not.toHaveBeenCalled();
    });
  });

  describe('close button', () => {
    it('should call onClose when X button is clicked', () => {
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      // Find the X button in the modal header
      const headerButtons = document.querySelector('.modal-header').querySelectorAll('button');
      fireEvent.click(headerButtons[0]);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('overlay click', () => {
    it('should call onClose when overlay is clicked', () => {
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      const overlay = document.querySelector('.modal-overlay');
      fireEvent.click(overlay);

      expect(onClose).toHaveBeenCalled();
    });

    it('should not call onClose when modal content is clicked', () => {
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      const modal = document.querySelector('.modal');
      fireEvent.click(modal);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('escape key', () => {
    it('should call onClose when Escape key is pressed', () => {
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });

    it('should not call onClose for other keys', () => {
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Enter' });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('should remove event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      const { unmount } = render(<SettingsModal {...defaultProps} />);

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('accessibility', () => {
    it('should have aria-modal attribute', () => {
      render(<SettingsModal {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('should have aria-labelledby pointing to title', () => {
      render(<SettingsModal {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby', 'settings-modal-title');
    });

    it('should have proper id on title element', () => {
      render(<SettingsModal {...defaultProps} />);
      const title = screen.getByText('Settings');
      expect(title).toHaveAttribute('id', 'settings-modal-title');
    });

    it('should have proper labels on form inputs', () => {
      render(<SettingsModal {...defaultProps} />);
      expect(screen.getByLabelText('API Base URL')).toBeInTheDocument();
      expect(screen.getByLabelText('Map Mode')).toBeInTheDocument();
      expect(screen.getByLabelText('Map Theme')).toBeInTheDocument();
    });

    it('should have placeholder text for API URL', () => {
      render(<SettingsModal {...defaultProps} config={{ ...defaultConfig, apiBaseUrl: '' }} />);
      const input = screen.getByLabelText('API Base URL');
      expect(input).toHaveAttribute('placeholder', 'Leave empty for same origin');
    });
  });
});
