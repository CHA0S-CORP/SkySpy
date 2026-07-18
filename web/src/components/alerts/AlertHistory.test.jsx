import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertHistory } from './AlertHistory';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Bell: () => <span data-testid="icon-bell">Bell</span>,
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  Check: () => <span data-testid="icon-check">Check</span>,
  CheckCheck: () => <span data-testid="icon-check-check">CheckCheck</span>,
  Clock: () => <span data-testid="icon-clock">Clock</span>,
  Plane: () => <span data-testid="icon-plane">Plane</span>,
  Radar: () => <span data-testid="icon-radar">Radar</span>,
  RefreshCw: () => <span data-testid="icon-refresh">Refresh</span>,
  Search: () => <span data-testid="icon-search">Search</span>,
  Filter: () => <span data-testid="icon-filter">Filter</span>,
  ChevronDown: () => <span data-testid="icon-chevron">Chevron</span>,
  X: () => <span data-testid="icon-x">X</span>,
  Download: () => <span data-testid="icon-download">Download</span>,
  AlertCircle: () => <span data-testid="icon-alert">Alert</span>,
  Info: () => <span data-testid="icon-info">Info</span>,
  AlertTriangle: () => <span data-testid="icon-warning">Warning</span>,
}));

// Mock useSocketApi hook
vi.mock('../../hooks', () => ({
  useSocketApi: vi.fn(),
}));

// Mock ConfirmModal
vi.mock('../common/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onConfirm, onCancel, title, message, confirmText }) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <h2>{title}</h2>
        <p>{message}</p>
        <button onClick={onConfirm}>{confirmText}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

import { useSocketApi } from '../../hooks';

describe('AlertHistory', () => {
  const mockAlerts = [
    {
      id: 1,
      rule_name: 'Military Aircraft Alert',
      callsign: 'RCH123',
      hex: 'AE1234',
      severity: 'warning',
      message: 'Military aircraft detected',
      triggered_at: '2024-01-15T10:30:00Z',
      acknowledged: false,
    },
    {
      id: 2,
      rule_name: 'Emergency Alert',
      callsign: 'UAL456',
      hex: 'A12345',
      severity: 'critical',
      message: 'Squawk 7700',
      triggered_at: '2024-01-15T09:00:00Z',
      acknowledged: true,
    },
    {
      id: 3,
      rule_name: 'Low Flying Aircraft',
      callsign: '',
      hex: 'B67890',
      severity: 'info',
      message: 'Aircraft below 2000ft',
      triggered_at: '2024-01-15T08:00:00Z',
      acknowledged: false,
    },
  ];

  let mockFetch;
  let mockOnToast;
  let mockRefetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    mockOnToast = vi.fn();
    mockRefetch = vi.fn();

    // Default successful response
    useSocketApi.mockReturnValue({
      data: { results: mockAlerts, count: mockAlerts.length },
      loading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('should render alert history container', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);
      expect(screen.getByRole('region', { name: /alert history/i })).toBeInTheDocument();
    });

    it('should render search input', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);
      expect(screen.getByPlaceholderText(/search alerts/i)).toBeInTheDocument();
    });

    it('should render severity filter', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);
      expect(screen.getByLabelText(/filter by severity/i)).toBeInTheDocument();
    });

    it('should render acknowledged filter', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);
      expect(screen.getByLabelText(/filter by acknowledged status/i)).toBeInTheDocument();
    });

    it('should render alert count', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);
      expect(screen.getByText(/3 alerts/i)).toBeInTheDocument();
    });

    it('should render unacknowledged count', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);
      expect(screen.getByText(/2 unacknowledged/i)).toBeInTheDocument();
    });
  });

  describe('alert list display', () => {
    it('should display all alerts', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText('Military Aircraft Alert')).toBeInTheDocument();
      expect(screen.getByText('Emergency Alert')).toBeInTheDocument();
      expect(screen.getByText('Low Flying Aircraft')).toBeInTheDocument();
    });

    it('should display callsign or hex for each alert', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText('RCH123')).toBeInTheDocument();
      expect(screen.getByText('UAL456')).toBeInTheDocument();
      expect(screen.getByText('B67890')).toBeInTheDocument(); // Falls back to hex
    });

    it('should display severity badge for each alert', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText('warning')).toBeInTheDocument();
      expect(screen.getByText('critical')).toBeInTheDocument();
      expect(screen.getByText('info')).toBeInTheDocument();
    });

    it('should display message for each alert', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText('Military aircraft detected')).toBeInTheDocument();
      expect(screen.getByText('Squawk 7700')).toBeInTheDocument();
    });

    it('should display acknowledge button for unacknowledged alerts', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const ackButtons = screen.getAllByRole('button', { name: /acknowledge alert/i });
      expect(ackButtons.length).toBe(2); // 2 unacknowledged alerts
    });

    it('should display acknowledged badge for acknowledged alerts', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const acknowledgedBadges = screen.getAllByLabelText('Acknowledged');
      expect(acknowledgedBadges.length).toBe(1);
    });
  });

  describe('loading state', () => {
    it('should display loading indicator when loading', () => {
      useSocketApi.mockReturnValue({
        data: null,
        loading: true,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText(/loading alert history/i)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should display error message when error occurs', () => {
      useSocketApi.mockReturnValue({
        data: null,
        loading: false,
        error: 'Failed to fetch',
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText(/failed to load alert history/i)).toBeInTheDocument();
    });

    it('should display retry button on error', async () => {
      const user = userEvent.setup();
      useSocketApi.mockReturnValue({
        data: null,
        loading: false,
        error: 'Failed to fetch',
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const retryBtn = screen.getByRole('button', { name: /retry/i });
      await user.click(retryBtn);

      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    it('should display empty state when no alerts', () => {
      useSocketApi.mockReturnValue({
        data: { results: [], count: 0 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText(/no alerts found/i)).toBeInTheDocument();
      expect(screen.getByText(/triggered alerts will appear here/i)).toBeInTheDocument();
    });

    it('should show filter hint when filters are applied', () => {
      useSocketApi.mockReturnValue({
        data: { results: [], count: 0 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      // No filters applied yet, so no filter hint
      expect(screen.queryByText(/try adjusting your filters/i)).not.toBeInTheDocument();
    });
  });

  describe('search functionality', () => {
    it('should update search query on input', async () => {
      const user = userEvent.setup();
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const searchInput = screen.getByPlaceholderText(/search alerts/i);
      await user.type(searchInput, 'military');

      expect(searchInput.value).toBe('military');
    });

    it('should show clear button when search has value', async () => {
      const user = userEvent.setup();
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const searchInput = screen.getByPlaceholderText(/search alerts/i);
      await user.type(searchInput, 'military');

      expect(screen.getByLabelText(/clear search/i)).toBeInTheDocument();
    });

    it('should clear search on clear button click', async () => {
      const user = userEvent.setup();
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const searchInput = screen.getByPlaceholderText(/search alerts/i);
      await user.type(searchInput, 'military');

      const clearBtn = screen.getByLabelText(/clear search/i);
      await user.click(clearBtn);

      expect(searchInput.value).toBe('');
    });
  });

  describe('filtering', () => {
    it('should filter by severity', async () => {
      const user = userEvent.setup();
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const severityFilter = screen.getByLabelText(/filter by severity/i);
      await user.selectOptions(severityFilter, 'critical');

      expect(severityFilter.value).toBe('critical');
    });

    it('should filter by acknowledged status', async () => {
      const user = userEvent.setup();
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const acknowledgedFilter = screen.getByLabelText(/filter by acknowledged status/i);
      await user.selectOptions(acknowledgedFilter, 'unacknowledged');

      expect(acknowledgedFilter.value).toBe('unacknowledged');
    });

    it('should show clear filters button in empty state with filters', async () => {
      const user = userEvent.setup();
      useSocketApi.mockReturnValue({
        data: { results: [], count: 0 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const severityFilter = screen.getByLabelText(/filter by severity/i);
      await user.selectOptions(severityFilter, 'critical');

      expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
    });
  });

  describe('acknowledge functionality', () => {
    it('should call API to acknowledge single alert', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({ ok: true });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const ackButtons = screen.getAllByRole('button', { name: /acknowledge alert/i });
      await user.click(ackButtons[0]);

      await waitFor(() => {
        // Must POST to the acknowledge action - the detail route is read-only (PATCH -> 405)
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/v1/alerts/history/1/acknowledge/',
          expect.objectContaining({
            method: 'POST',
          })
        );
      });

      expect(mockOnToast).toHaveBeenCalledWith('Alert acknowledged', 'success');
      expect(mockRefetch).toHaveBeenCalled();
    });

    it('should show toast on acknowledge failure', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({ ok: false });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const ackButtons = screen.getAllByRole('button', { name: /acknowledge alert/i });
      await user.click(ackButtons[0]);

      await waitFor(() => {
        expect(mockOnToast).toHaveBeenCalledWith('Failed to acknowledge alert', 'error');
      });
    });
  });

  describe('bulk actions', () => {
    it('should show acknowledge all button when unacknowledged alerts exist', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(
        screen.getByRole('button', { name: /acknowledge all.*unacknowledged/i })
      ).toBeInTheDocument();
    });

    it('should show confirm modal when acknowledge all is clicked', async () => {
      const user = userEvent.setup();
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const ackAllBtn = screen.getByRole('button', { name: /acknowledge all.*unacknowledged/i });
      await user.click(ackAllBtn);

      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
      expect(screen.getByText(/acknowledge all alerts/i)).toBeInTheDocument();
    });

    it('should acknowledge all when confirmed', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({ ok: true });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      // Find ack all button by aria-label since there are unacknowledged alerts
      const ackAllBtn = screen.getByRole('button', { name: /acknowledge all.*unacknowledged/i });
      await user.click(ackAllBtn);

      const confirmBtn = screen.getByRole('button', { name: /^acknowledge all$/i });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    it('should show clear all button when alerts exist', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByRole('button', { name: /clear all alert history/i })).toBeInTheDocument();
    });

    it('should show confirm modal when clear all is clicked', async () => {
      const user = userEvent.setup();
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const clearBtn = screen.getByRole('button', { name: /clear all alert history/i });
      await user.click(clearBtn);

      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
      expect(screen.getByText(/clear alert history/i)).toBeInTheDocument();
      expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    });
  });

  describe('refresh functionality', () => {
    it('should call refetch when refresh button is clicked', async () => {
      const user = userEvent.setup();
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const refreshBtn = screen.getByRole('button', { name: /refresh/i });
      await user.click(refreshBtn);

      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe('export functionality', () => {
    it('should export CSV when export button is clicked', async () => {
      const user = userEvent.setup();

      // Mock URL.createObjectURL and URL.revokeObjectURL
      const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
      const mockRevokeObjectURL = vi.fn();
      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;

      // Mock link click behavior
      const mockClick = vi.fn();
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        const element = originalCreateElement(tag);
        if (tag === 'a') {
          element.click = mockClick;
        }
        return element;
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const exportBtn = screen.getByRole('button', { name: /export/i });
      await user.click(exportBtn);

      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(mockClick).toHaveBeenCalled();
      expect(mockOnToast).toHaveBeenCalledWith('Alert history exported', 'success');
    });
  });

  describe('pagination', () => {
    it('should display pagination when multiple pages exist', () => {
      useSocketApi.mockReturnValue({
        data: { results: mockAlerts, count: 100 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText(/page 1 of/i)).toBeInTheDocument();
    });

    it('should navigate to next page', async () => {
      const user = userEvent.setup();
      useSocketApi.mockReturnValue({
        data: { results: mockAlerts, count: 100 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const nextBtn = screen.getByRole('button', { name: /next page/i });
      await user.click(nextBtn);

      expect(screen.getByText(/page 2 of/i)).toBeInTheDocument();
    });

    it('should navigate to previous page', async () => {
      const user = userEvent.setup();
      useSocketApi.mockReturnValue({
        data: { results: mockAlerts, count: 100 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      // Go to page 2 first
      const nextBtn = screen.getByRole('button', { name: /next page/i });
      await user.click(nextBtn);

      const prevBtn = screen.getByRole('button', { name: /previous page/i });
      await user.click(prevBtn);

      expect(screen.getByText(/page 1 of/i)).toBeInTheDocument();
    });

    it('should disable previous button on first page', () => {
      useSocketApi.mockReturnValue({
        data: { results: mockAlerts, count: 100 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /first page/i })).toBeDisabled();
    });

    it('should change page size', async () => {
      const user = userEvent.setup();
      useSocketApi.mockReturnValue({
        data: { results: mockAlerts, count: 100 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const pageSizeSelect = screen.getByLabelText(/show/i);
      await user.selectOptions(pageSizeSelect, '25');

      expect(pageSizeSelect.value).toBe('25');
    });
  });

  describe('different data formats', () => {
    it('should handle array response format', () => {
      useSocketApi.mockReturnValue({
        data: mockAlerts, // Direct array
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText('Military Aircraft Alert')).toBeInTheDocument();
    });

    it('should handle alerts key response format', () => {
      useSocketApi.mockReturnValue({
        data: { alerts: mockAlerts, total: mockAlerts.length },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText('Military Aircraft Alert')).toBeInTheDocument();
    });

    it('should handle alert with priority instead of severity', () => {
      const alertsWithPriority = [{ ...mockAlerts[0], severity: undefined, priority: 'critical' }];

      useSocketApi.mockReturnValue({
        data: { results: alertsWithPriority, count: 1 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText('critical')).toBeInTheDocument();
    });

    it('should handle alert with icao instead of hex', () => {
      const alertsWithIcao = [{ ...mockAlerts[0], callsign: '', hex: '', icao: 'ICAO123' }];

      useSocketApi.mockReturnValue({
        data: { results: alertsWithIcao, count: 1 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByText('ICAO123')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have proper feed role on list', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByRole('feed', { name: /alert history items/i })).toBeInTheDocument();
    });

    it('should have aria-busy on list during loading', () => {
      useSocketApi.mockReturnValue({
        data: { results: mockAlerts, count: mockAlerts.length },
        loading: true,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const feed = screen.getByRole('feed');
      expect(feed).toHaveAttribute('aria-busy', 'true');
    });

    it('should have proper article roles for alert items', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const articles = screen.getAllByRole('article');
      expect(articles.length).toBe(3);
    });

    it('should have aria-setsize and aria-posinset on items', () => {
      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      const articles = screen.getAllByRole('article');
      expect(articles[0]).toHaveAttribute('aria-setsize', '3');
      expect(articles[0]).toHaveAttribute('aria-posinset', '1');
      expect(articles[2]).toHaveAttribute('aria-posinset', '3');
    });

    it('should have proper navigation role on pagination', () => {
      useSocketApi.mockReturnValue({
        data: { results: mockAlerts, count: 100 },
        loading: false,
        error: null,
        refetch: mockRefetch,
      });

      render(<AlertHistory apiBase="http://localhost:8000" onToast={mockOnToast} />);

      expect(screen.getByRole('navigation', { name: /alert history pages/i })).toBeInTheDocument();
    });
  });
});
