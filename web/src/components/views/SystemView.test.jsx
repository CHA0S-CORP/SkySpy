import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemView } from './SystemView';

// Mock Leaflet (SystemView renders a feeder mini-map when location is known)
vi.mock('leaflet', () => {
  const mockMapInstance = {
    remove: vi.fn(),
    off: vi.fn(),
    setView: vi.fn(),
    fitBounds: vi.fn(),
  };

  return {
    default: {
      map: vi.fn().mockReturnValue(mockMapInstance),
      tileLayer: vi.fn().mockReturnValue({ addTo: vi.fn() }),
      marker: vi.fn().mockReturnValue({ addTo: vi.fn() }),
      circle: vi.fn().mockReturnValue({ addTo: vi.fn() }),
      divIcon: vi.fn(),
    },
  };
});

describe('SystemView', () => {
  let mockFetch;
  let mockWsRequest;

  const defaultProps = {
    apiBase: 'http://localhost:8000',
    wsConnected: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ success: true }),
    });
    global.fetch = mockFetch;
    // WebSocket path satisfies the periodic data fetches so HTTP fetch calls
    // in these tests come only from the button handlers under test
    mockWsRequest = vi.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('test notification button', () => {
    it('should POST to the slash-terminated notifications test endpoint', async () => {
      const user = userEvent.setup();
      render(<SystemView {...defaultProps} wsRequest={mockWsRequest} />);

      await user.click(screen.getByRole('button', { name: /test notification/i }));

      // DRF DefaultRouter registers the action only at the trailing-slash URL,
      // and non-GET requests are not slash-redirected
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/api/v1/notifications/test/', {
          method: 'POST',
        });
      });

      await waitFor(() => {
        expect(screen.getByText('Notification sent!')).toBeInTheDocument();
      });
    });

    it('should show an error result when the request fails', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({ ok: false, status: 404, headers: new Headers() });

      render(<SystemView {...defaultProps} wsRequest={mockWsRequest} />);

      await user.click(screen.getByRole('button', { name: /test notification/i }));

      await waitFor(() => {
        expect(screen.getByText(/error sending test/i)).toBeInTheDocument();
      });
    });
  });
});
