import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminReviewPanel } from './AdminReviewPanel';

describe('AdminReviewPanel', () => {
  let mockOnApprove;
  let mockOnReject;
  let mockOnMarkDuplicate;
  let mockOnRefresh;

  const mockSubmission = {
    id: 1,
    icao_hex: 'A12345',
    registration: 'N12345',
    agency_name: 'FBI',
    evidence_type: 'flight_pattern',
    evidence_description: 'Observed circling pattern over residential area for 2 hours',
    evidence_url: 'https://example.com/evidence',
    agency_type: 'federal',
    agency_state: 'CA',
    agency_city: 'Los Angeles',
    callsign_observed: 'LAPD1',
    status: 'pending',
    confidence_score: 0.75,
    submitted_at: '2024-01-15T10:30:00Z',
    submitted_by_username: 'testuser',
  };

  const mockStats = {
    total: 100,
    pending: 10,
    approved: 80,
    rejected: 5,
    duplicate: 5,
  };

  beforeEach(() => {
    mockOnApprove = vi.fn();
    mockOnReject = vi.fn();
    mockOnMarkDuplicate = vi.fn();
    mockOnRefresh = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderPanel = (props = {}) => {
    return render(
      <AdminReviewPanel
        submissions={[mockSubmission]}
        stats={mockStats}
        loading={false}
        error={null}
        onApprove={mockOnApprove}
        onReject={mockOnReject}
        onMarkDuplicate={mockOnMarkDuplicate}
        onRefresh={mockOnRefresh}
        {...props}
      />
    );
  };

  describe('initial rendering', () => {
    it('should render stats section', () => {
      renderPanel();

      expect(screen.getByText('100')).toBeInTheDocument(); // Total
      expect(screen.getByText('10')).toBeInTheDocument(); // Pending
      expect(screen.getByText('80')).toBeInTheDocument(); // Approved
      // Both rejected (5) and duplicates (5) have the same value, so use getAllByText
      expect(screen.getAllByText('5').length).toBe(2); // Rejected and Duplicates
    });

    it('should render pending submissions count in header', () => {
      renderPanel();

      expect(screen.getByText(/pending submissions \(1\)/i)).toBeInTheDocument();
    });

    it('should render refresh button', () => {
      renderPanel();

      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    it('should show submission card', () => {
      renderPanel();

      expect(screen.getByText('A12345')).toBeInTheDocument();
      expect(screen.getByText('FBI')).toBeInTheDocument();
      expect(screen.getByText(/flight pattern/i)).toBeInTheDocument();
    });

    it('should show no submissions message when empty', () => {
      renderPanel({ submissions: [] });

      expect(screen.getByText(/no pending submissions/i)).toBeInTheDocument();
    });
  });

  describe('submission card', () => {
    it('should display submission details', () => {
      renderPanel();

      expect(screen.getByText('A12345')).toBeInTheDocument();
      expect(screen.getByText('(N12345)')).toBeInTheDocument();
      expect(screen.getByText('FBI')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument(); // Confidence
    });

    it('should display submitter username', () => {
      renderPanel();

      expect(screen.getByText('testuser')).toBeInTheDocument();
    });

    it('should show status badge', () => {
      renderPanel();

      expect(screen.getByText('pending')).toBeInTheDocument();
    });

    it('should toggle details on click', async () => {
      const user = userEvent.setup();
      renderPanel();

      // Details should be hidden initially
      expect(screen.queryByText(/evidence description/i)).not.toBeInTheDocument();

      // Click show details
      await user.click(screen.getByRole('button', { name: /show details/i }));

      // Details should now be visible
      expect(screen.getByText(/evidence description/i)).toBeInTheDocument();
      expect(screen.getByText(/observed circling pattern/i)).toBeInTheDocument();
    });

    it('should show evidence URL in details', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /show details/i }));

      expect(screen.getByText('https://example.com/evidence')).toBeInTheDocument();
    });

    it('should show callsign in details', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /show details/i }));

      expect(screen.getByText('LAPD1')).toBeInTheDocument();
    });

    it('should show agency metadata in details', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /show details/i }));

      expect(screen.getByText('federal')).toBeInTheDocument();
      expect(screen.getByText('CA')).toBeInTheDocument();
      expect(screen.getByText('Los Angeles')).toBeInTheDocument();
    });
  });

  describe('action buttons', () => {
    it('should render approve, reject, and mark duplicate buttons for pending submissions', () => {
      renderPanel();

      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /mark duplicate/i })).toBeInTheDocument();
    });

    it('should not render action buttons for non-pending submissions', () => {
      const approvedSubmission = { ...mockSubmission, status: 'approved' };
      renderPanel({ submissions: [approvedSubmission] });

      expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mark duplicate/i })).not.toBeInTheDocument();
    });

    it('should call onApprove when approve button is clicked', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /approve/i }));

      expect(mockOnApprove).toHaveBeenCalledWith(1);
    });

    it('should call onMarkDuplicate when mark duplicate button is clicked', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /mark duplicate/i }));

      expect(mockOnMarkDuplicate).toHaveBeenCalledWith(1);
    });
  });

  describe('reject flow', () => {
    it('should show reject form when reject button is clicked', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /^reject$/i }));

      expect(screen.getByPlaceholderText(/enter rejection reason/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm reject/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('should call onReject with reason when confirm is clicked', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /^reject$/i }));
      await user.type(
        screen.getByPlaceholderText(/enter rejection reason/i),
        'Insufficient evidence'
      );
      await user.click(screen.getByRole('button', { name: /confirm reject/i }));

      expect(mockOnReject).toHaveBeenCalledWith(1, 'Insufficient evidence');
    });

    it('should disable confirm button when reason is empty', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /^reject$/i }));

      expect(screen.getByRole('button', { name: /confirm reject/i })).toBeDisabled();
    });

    it('should hide reject form when cancel is clicked', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /^reject$/i }));
      expect(screen.getByPlaceholderText(/enter rejection reason/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(screen.queryByPlaceholderText(/enter rejection reason/i)).not.toBeInTheDocument();
    });
  });

  describe('refresh button', () => {
    it('should call onRefresh when clicked', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /refresh/i }));

      expect(mockOnRefresh).toHaveBeenCalled();
    });

    it('should be disabled when loading', () => {
      renderPanel({ loading: true });

      expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
    });
  });

  describe('loading state', () => {
    it('should show loading indicator in list when loading with no submissions', () => {
      renderPanel({ submissions: [], loading: true });

      expect(screen.getByText(/loading submissions/i)).toBeInTheDocument();
    });

    it('should disable action buttons when loading', () => {
      renderPanel({ loading: true });

      expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^reject$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /mark duplicate/i })).toBeDisabled();
    });
  });

  describe('error handling', () => {
    it('should display error message', () => {
      renderPanel({ error: 'Failed to load submissions' });

      expect(screen.getByText('Failed to load submissions')).toBeInTheDocument();
    });
  });

  describe('multiple submissions', () => {
    it('should render multiple submission cards', () => {
      const submissions = [
        mockSubmission,
        { ...mockSubmission, id: 2, icao_hex: 'B67890', agency_name: 'DEA' },
        { ...mockSubmission, id: 3, icao_hex: 'C11111', agency_name: 'DHS' },
      ];

      renderPanel({ submissions });

      expect(screen.getByText('A12345')).toBeInTheDocument();
      expect(screen.getByText('B67890')).toBeInTheDocument();
      expect(screen.getByText('C11111')).toBeInTheDocument();
      expect(screen.getByText(/pending submissions \(3\)/i)).toBeInTheDocument();
    });
  });

  describe('stats display', () => {
    it('should not render stats when stats is null', () => {
      renderPanel({ stats: null });

      expect(screen.queryByText('Total')).not.toBeInTheDocument();
    });

    it('should render all stat categories', () => {
      renderPanel();

      expect(screen.getByText('Total')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
      expect(screen.getByText('Approved')).toBeInTheDocument();
      expect(screen.getByText('Rejected')).toBeInTheDocument();
      expect(screen.getByText('Duplicates')).toBeInTheDocument();
    });
  });

  describe('status colors', () => {
    it('should apply correct color class for pending status', () => {
      renderPanel();

      const statusBadge = screen.getByText('pending');
      expect(statusBadge.className).toContain('yellow');
    });

    it('should apply correct color class for approved status', () => {
      const approvedSubmission = { ...mockSubmission, status: 'approved' };
      renderPanel({ submissions: [approvedSubmission] });

      const statusBadge = screen.getByText('approved');
      expect(statusBadge.className).toContain('green');
    });

    it('should apply correct color class for rejected status', () => {
      const rejectedSubmission = { ...mockSubmission, status: 'rejected' };
      renderPanel({ submissions: [rejectedSubmission] });

      const statusBadge = screen.getByText('rejected');
      expect(statusBadge.className).toContain('red');
    });
  });

  describe('evidence type labels', () => {
    it('should display human-readable evidence type labels', () => {
      renderPanel();

      // 'flight_pattern' should be displayed as 'Flight Pattern'
      expect(screen.getByText('Flight Pattern')).toBeInTheDocument();
    });

    it('should handle foia evidence type', () => {
      const foiaSubmission = { ...mockSubmission, evidence_type: 'foia' };
      renderPanel({ submissions: [foiaSubmission] });

      expect(screen.getByText('FOIA Document')).toBeInTheDocument();
    });

    it('should handle news evidence type', () => {
      const newsSubmission = { ...mockSubmission, evidence_type: 'news' };
      renderPanel({ submissions: [newsSubmission] });

      expect(screen.getByText('News Report')).toBeInTheDocument();
    });
  });

  describe('date formatting', () => {
    it('should format submission date', () => {
      renderPanel();

      // The date should be formatted (locale-dependent, so just check it's present)
      expect(screen.getByText(/1\/15\/2024|15\/01\/2024|2024/)).toBeInTheDocument();
    });
  });
});
