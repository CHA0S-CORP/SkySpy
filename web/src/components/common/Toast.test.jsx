import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Toast, ToastContainer } from './Toast';

// Mock the TOAST_TYPES from useToast
vi.mock('../../hooks/useToast', () => ({
  TOAST_TYPES: {
    SUCCESS: 'success',
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info',
  },
}));

describe('Toast', () => {
  const defaultToast = {
    id: 1,
    message: 'Test message',
    type: 'info',
    duration: 3000,
  };

  const mockOnRemove = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockOnRemove.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic rendering', () => {
    it('should render toast with message', () => {
      render(<Toast toast={defaultToast} onRemove={mockOnRemove} />);

      expect(screen.getByText('Test message')).toBeInTheDocument();
    });

    it('should render with correct type class', () => {
      const { container } = render(
        <Toast toast={{ ...defaultToast, type: 'success' }} onRemove={mockOnRemove} />
      );

      expect(container.querySelector('.toast-success')).toBeInTheDocument();
    });

    it('should render error type toast', () => {
      const { container } = render(
        <Toast toast={{ ...defaultToast, type: 'error' }} onRemove={mockOnRemove} />
      );

      expect(container.querySelector('.toast-error')).toBeInTheDocument();
    });

    it('should render warning type toast', () => {
      const { container } = render(
        <Toast toast={{ ...defaultToast, type: 'warning' }} onRemove={mockOnRemove} />
      );

      expect(container.querySelector('.toast-warning')).toBeInTheDocument();
    });

    it('should have close button', () => {
      render(<Toast toast={defaultToast} onRemove={mockOnRemove} />);

      expect(screen.getByRole('button', { name: /dismiss notification/i })).toBeInTheDocument();
    });

    it('should have alert role by default', () => {
      render(<Toast toast={defaultToast} onRemove={mockOnRemove} />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('close functionality', () => {
    it('should call onRemove when close button is clicked', async () => {
      render(<Toast toast={defaultToast} onRemove={mockOnRemove} />);

      const closeButton = screen.getByRole('button', { name: /dismiss notification/i });
      fireEvent.click(closeButton);

      // Wait for exit animation timeout
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(mockOnRemove).toHaveBeenCalledWith(defaultToast.id);
    });

    it('should add exit class before removing', () => {
      const { container } = render(<Toast toast={defaultToast} onRemove={mockOnRemove} />);

      const closeButton = screen.getByRole('button', { name: /dismiss notification/i });
      fireEvent.click(closeButton);

      expect(container.querySelector('.toast-exit')).toBeInTheDocument();
    });
  });

  describe('auto-dismiss', () => {
    it('should start exit animation before duration ends', async () => {
      const { container } = render(
        <Toast toast={{ ...defaultToast, duration: 3000 }} onRemove={mockOnRemove} />
      );

      // Should have enter class initially
      expect(container.querySelector('.toast-enter')).toBeInTheDocument();

      // Advance to just before exit animation (300ms before duration)
      await act(async () => {
        vi.advanceTimersByTime(2700);
      });

      expect(container.querySelector('.toast-exit')).toBeInTheDocument();
    });

    it('should not auto-dismiss when duration is 0', async () => {
      const { container } = render(
        <Toast toast={{ ...defaultToast, duration: 0 }} onRemove={mockOnRemove} />
      );

      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      // Should still be visible
      expect(container.querySelector('.toast-enter')).toBeInTheDocument();
      expect(container.querySelector('.toast-exit')).not.toBeInTheDocument();
    });

    it('should not auto-dismiss when duration is negative', async () => {
      const { container } = render(
        <Toast toast={{ ...defaultToast, duration: -1 }} onRemove={mockOnRemove} />
      );

      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      expect(container.querySelector('.toast-exit')).not.toBeInTheDocument();
    });

    it('should not auto-dismiss when duration is undefined', async () => {
      const { container } = render(
        <Toast toast={{ ...defaultToast, duration: undefined }} onRemove={mockOnRemove} />
      );

      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      expect(container.querySelector('.toast-exit')).not.toBeInTheDocument();
    });
  });

  describe('clickable toast', () => {
    it('should be clickable when onClick is provided', () => {
      const onClick = vi.fn();
      const { container } = render(
        <Toast toast={{ ...defaultToast, onClick }} onRemove={mockOnRemove} />
      );

      expect(container.querySelector('.toast-clickable')).toBeInTheDocument();
    });

    it('should have button role when clickable', () => {
      const onClick = vi.fn();
      render(<Toast toast={{ ...defaultToast, onClick }} onRemove={mockOnRemove} />);

      expect(screen.getByRole('button', { name: /test message/i })).toBeInTheDocument();
    });

    it('should call onClick and remove when toast is clicked', async () => {
      const onClick = vi.fn();
      render(<Toast toast={{ ...defaultToast, onClick }} onRemove={mockOnRemove} />);

      const toastElement = screen.getByRole('button', { name: /test message/i });
      fireEvent.click(toastElement);

      expect(onClick).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(mockOnRemove).toHaveBeenCalledWith(defaultToast.id);
    });

    it('should support keyboard navigation when clickable', async () => {
      const onClick = vi.fn();
      render(<Toast toast={{ ...defaultToast, onClick }} onRemove={mockOnRemove} />);

      const toastElement = screen.getByRole('button', { name: /test message/i });
      fireEvent.keyDown(toastElement, { key: 'Enter' });

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should support space key when clickable', async () => {
      const onClick = vi.fn();
      render(<Toast toast={{ ...defaultToast, onClick }} onRemove={mockOnRemove} />);

      const toastElement = screen.getByRole('button', { name: /test message/i });
      fireEvent.keyDown(toastElement, { key: ' ' });

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should have tabIndex when clickable', () => {
      const onClick = vi.fn();
      render(<Toast toast={{ ...defaultToast, onClick }} onRemove={mockOnRemove} />);

      const toastElement = screen.getByRole('button', { name: /test message/i });
      expect(toastElement).toHaveAttribute('tabIndex', '0');
    });
  });

  describe('action button', () => {
    it('should render action button when actionLabel and onAction provided', () => {
      const onAction = vi.fn();
      render(
        <Toast
          toast={{ ...defaultToast, actionLabel: 'Undo', onAction }}
          onRemove={mockOnRemove}
        />
      );

      expect(screen.getByText('Undo')).toBeInTheDocument();
    });

    it('should call onAction when action button is clicked', async () => {
      const onAction = vi.fn();
      render(
        <Toast
          toast={{ ...defaultToast, actionLabel: 'Undo', onAction }}
          onRemove={mockOnRemove}
        />
      );

      const actionButton = screen.getByText('Undo');
      fireEvent.click(actionButton);

      expect(onAction).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(mockOnRemove).toHaveBeenCalledWith(defaultToast.id);
    });

    it('should not render action button without actionLabel', () => {
      const onAction = vi.fn();
      render(<Toast toast={{ ...defaultToast, onAction }} onRemove={mockOnRemove} />);

      expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
    });

    it('should not render action button without onAction', () => {
      render(
        <Toast toast={{ ...defaultToast, actionLabel: 'Undo' }} onRemove={mockOnRemove} />
      );

      expect(screen.queryByText('Undo')).not.toBeInTheDocument();
    });

    it('should stop propagation when action button is clicked', () => {
      const onClick = vi.fn();
      const onAction = vi.fn();
      render(
        <Toast
          toast={{ ...defaultToast, onClick, actionLabel: 'Undo', onAction }}
          onRemove={mockOnRemove}
        />
      );

      const actionButton = screen.getByText('Undo');
      fireEvent.click(actionButton);

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('close button event handling', () => {
    it('should stop propagation when close button is clicked on clickable toast', () => {
      const onClick = vi.fn();
      render(<Toast toast={{ ...defaultToast, onClick }} onRemove={mockOnRemove} />);

      const closeButton = screen.getByRole('button', { name: /dismiss notification/i });
      fireEvent.click(closeButton);

      expect(onClick).not.toHaveBeenCalled();
    });
  });
});

describe('ToastContainer', () => {
  const mockRemoveToast = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    mockRemoveToast.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('should render nothing when toasts array is empty', () => {
      const { container } = render(<ToastContainer toasts={[]} removeToast={mockRemoveToast} />);

      expect(container.firstChild).toBeNull();
    });

    it('should render nothing when toasts is null', () => {
      const { container } = render(<ToastContainer toasts={null} removeToast={mockRemoveToast} />);

      expect(container.firstChild).toBeNull();
    });

    it('should render nothing when toasts is undefined', () => {
      const { container } = render(
        <ToastContainer toasts={undefined} removeToast={mockRemoveToast} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render container with toasts', () => {
      const toasts = [
        { id: 1, message: 'Toast 1', type: 'info', duration: 3000 },
        { id: 2, message: 'Toast 2', type: 'success', duration: 3000 },
      ];

      render(<ToastContainer toasts={toasts} removeToast={mockRemoveToast} />);

      expect(screen.getByText('Toast 1')).toBeInTheDocument();
      expect(screen.getByText('Toast 2')).toBeInTheDocument();
    });

    it('should render toast container with correct class', () => {
      const toasts = [{ id: 1, message: 'Toast 1', type: 'info', duration: 3000 }];

      const { container } = render(<ToastContainer toasts={toasts} removeToast={mockRemoveToast} />);

      expect(container.querySelector('.toast-container')).toBeInTheDocument();
    });

    it('should have aria-live polite attribute', () => {
      const toasts = [{ id: 1, message: 'Toast 1', type: 'info', duration: 3000 }];

      const { container } = render(<ToastContainer toasts={toasts} removeToast={mockRemoveToast} />);

      expect(container.querySelector('.toast-container')).toHaveAttribute('aria-live', 'polite');
    });

    it('should have aria-label for accessibility', () => {
      const toasts = [{ id: 1, message: 'Toast 1', type: 'info', duration: 3000 }];

      const { container } = render(<ToastContainer toasts={toasts} removeToast={mockRemoveToast} />);

      expect(container.querySelector('.toast-container')).toHaveAttribute(
        'aria-label',
        'Notifications'
      );
    });
  });

  describe('toast management', () => {
    it('should pass removeToast to each Toast', async () => {
      const toasts = [{ id: 1, message: 'Toast 1', type: 'info', duration: 3000 }];

      render(<ToastContainer toasts={toasts} removeToast={mockRemoveToast} />);

      const closeButton = screen.getByRole('button', { name: /dismiss notification/i });
      fireEvent.click(closeButton);

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(mockRemoveToast).toHaveBeenCalledWith(1);
    });

    it('should render multiple toasts with unique keys', () => {
      const toasts = [
        { id: 1, message: 'Toast 1', type: 'info', duration: 3000 },
        { id: 2, message: 'Toast 2', type: 'error', duration: 3000 },
        { id: 3, message: 'Toast 3', type: 'warning', duration: 3000 },
      ];

      const { container } = render(<ToastContainer toasts={toasts} removeToast={mockRemoveToast} />);

      const toastElements = container.querySelectorAll('.toast');
      expect(toastElements).toHaveLength(3);
    });
  });
});
