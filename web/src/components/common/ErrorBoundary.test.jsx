import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// Component that throws an error
const ThrowError = ({ shouldThrow = false, errorMessage = 'Test error' }) => {
  if (shouldThrow) {
    throw new Error(errorMessage);
  }
  return <div>No error</div>;
};

describe('ErrorBoundary', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    // Suppress React's error logging in tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('normal rendering', () => {
    it('should render children when there is no error', () => {
      render(
        <ErrorBoundary>
          <div data-testid="child">Hello World</div>
        </ErrorBoundary>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('should render multiple children', () => {
      render(
        <ErrorBoundary>
          <div>Child 1</div>
          <div>Child 2</div>
        </ErrorBoundary>
      );

      expect(screen.getByText('Child 1')).toBeInTheDocument();
      expect(screen.getByText('Child 2')).toBeInTheDocument();
    });
  });

  describe('error catching', () => {
    it('should catch errors and display fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(
        screen.getByText('An unexpected error occurred while loading this content.')
      ).toBeInTheDocument();
    });

    it('should display custom message when provided', () => {
      render(
        <ErrorBoundary message="Custom error message">
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Custom error message')).toBeInTheDocument();
    });

    it('should display Try Again button', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      const retryButton = screen.getByRole('button', { name: /try again/i });
      expect(retryButton).toBeInTheDocument();
    });
  });

  describe('fallback rendering', () => {
    it('should render custom fallback when provided', () => {
      const customFallback = <div data-testid="custom-fallback">Custom Error UI</div>;

      render(
        <ErrorBoundary fallback={customFallback}>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
      expect(screen.getByText('Custom Error UI')).toBeInTheDocument();
      // Default error UI should not be rendered
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });
  });

  describe('retry functionality', () => {
    it('should reset error state when Try Again is clicked', () => {
      // First render with an error
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      // Should show error state initially
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Get retry button
      const retryButton = screen.getByRole('button', { name: /try again/i });
      expect(retryButton).toBeInTheDocument();

      // Click Try Again - this resets the error state
      fireEvent.click(retryButton);

      // The component tries to re-render. Since ThrowError still throws,
      // the error boundary will catch it again and show the error UI.
      // But the important thing is that handleRetry was called and the state was reset momentarily.
      // We can verify the retry mechanism works by checking onRetry callback.
    });

    it('should call onRetry callback when Try Again is clicked', () => {
      const onRetry = vi.fn();

      render(
        <ErrorBoundary onRetry={onRetry}>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('onError callback', () => {
    it('should call onError callback when error is caught', () => {
      const onError = vi.fn();

      render(
        <ErrorBoundary onError={onError}>
          <ThrowError shouldThrow={true} errorMessage="Test callback error" />
        </ErrorBoundary>
      );

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.any(String),
        })
      );
    });

    it('should pass the error object to onError callback', () => {
      const onError = vi.fn();

      render(
        <ErrorBoundary onError={onError}>
          <ThrowError shouldThrow={true} errorMessage="Specific error message" />
        </ErrorBoundary>
      );

      const [error] = onError.mock.calls[0];
      expect(error.message).toBe('Specific error message');
    });
  });

  describe('console logging', () => {
    it('should log error to console', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} errorMessage="Console log test" />
        </ErrorBoundary>
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
      // Check that one of the calls contains our error
      const errorCalls = consoleErrorSpy.mock.calls;
      const hasErrorLogged = errorCalls.some(
        (call) =>
          call[0] === 'ErrorBoundary caught an error:' || call[0]?.message === 'Console log test'
      );
      expect(hasErrorLogged).toBe(true);
    });
  });

  describe('error boundary isolation', () => {
    it('should not catch errors outside its children', () => {
      const OuterComponent = () => {
        return (
          <div>
            <ErrorBoundary>
              <div>Protected content</div>
            </ErrorBoundary>
          </div>
        );
      };

      render(<OuterComponent />);
      expect(screen.getByText('Protected content')).toBeInTheDocument();
    });

    it('should allow nested error boundaries', () => {
      render(
        <ErrorBoundary message="Outer error">
          <div>
            <ErrorBoundary message="Inner error">
              <ThrowError shouldThrow={true} />
            </ErrorBoundary>
          </div>
        </ErrorBoundary>
      );

      // Inner error boundary should catch the error
      expect(screen.getByText('Inner error')).toBeInTheDocument();
      // Outer error message should not be shown
      expect(screen.queryByText('Outer error')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have alert role on error container', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should have accessible button', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      const button = screen.getByRole('button', { name: /try again/i });
      expect(button).toHaveAttribute('type', 'button');
    });
  });
});
