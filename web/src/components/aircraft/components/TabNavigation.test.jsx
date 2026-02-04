import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabNavigation } from './TabNavigation';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  LayoutDashboard: () => <span data-testid="layout-icon">LayoutDashboard</span>,
  MessageSquare: () => <span data-testid="message-icon">MessageSquare</span>,
  AlertTriangle: () => <span data-testid="alert-icon">AlertTriangle</span>,
  Map: () => <span data-testid="map-icon">Map</span>,
}));

describe('TabNavigation', () => {
  const defaultProps = {
    activeTab: 'overview',
    onTabChange: vi.fn(),
    radioCount: 0,
    acarsCount: 0,
    safetyCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render navigation element with correct aria label', () => {
      render(<TabNavigation {...defaultProps} />);

      expect(
        screen.getByRole('navigation', { name: /aircraft information tabs/i })
      ).toBeInTheDocument();
    });

    it('should render tablist', () => {
      render(<TabNavigation {...defaultProps} />);

      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    it('should render all 4 tabs', () => {
      render(<TabNavigation {...defaultProps} />);

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(4);
      expect(screen.getByText('Overview')).toBeInTheDocument();
      expect(screen.getByText('Comms')).toBeInTheDocument();
      expect(screen.getByText('Safety')).toBeInTheDocument();
      expect(screen.getByText('Track')).toBeInTheDocument();
    });

    it('should render tab icons', () => {
      render(<TabNavigation {...defaultProps} />);

      expect(screen.getByTestId('layout-icon')).toBeInTheDocument();
      expect(screen.getByTestId('message-icon')).toBeInTheDocument();
      expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
      expect(screen.getByTestId('map-icon')).toBeInTheDocument();
    });
  });

  describe('active tab', () => {
    it('should mark active tab with aria-selected true', () => {
      render(<TabNavigation {...defaultProps} activeTab="overview" />);

      const overviewTab = screen.getByRole('tab', { name: /overview/i });
      expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    });

    it('should mark inactive tabs with aria-selected false', () => {
      render(<TabNavigation {...defaultProps} activeTab="overview" />);

      const tabs = screen.getAllByRole('tab');
      // First tab (overview) should be selected
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
      // Others should not be selected
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
      expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
      expect(tabs[3]).toHaveAttribute('aria-selected', 'false');
    });

    it('should add active class to active tab', () => {
      render(<TabNavigation {...defaultProps} activeTab="safety" />);

      const safetyTab = screen.getByRole('tab', { name: /safety/i });
      expect(safetyTab).toHaveClass('active');
    });

    it('should render indicator on active tab', () => {
      const { container } = render(<TabNavigation {...defaultProps} activeTab="track" />);

      const trackTab = screen.getByRole('tab', { name: /track/i });
      const indicator = trackTab.querySelector('.tab-indicator');
      expect(indicator).toBeInTheDocument();
    });
  });

  describe('tab click', () => {
    it('should call onTabChange with tab id when clicked', () => {
      const mockOnTabChange = vi.fn();
      render(<TabNavigation {...defaultProps} onTabChange={mockOnTabChange} />);

      fireEvent.click(screen.getByRole('tab', { name: /safety/i }));

      expect(mockOnTabChange).toHaveBeenCalledWith('safety');
    });

    it('should call onTabChange for each different tab', () => {
      const mockOnTabChange = vi.fn();
      render(<TabNavigation {...defaultProps} onTabChange={mockOnTabChange} />);

      const tabs = screen.getAllByRole('tab');

      fireEvent.click(tabs[1]); // Communications
      expect(mockOnTabChange).toHaveBeenCalledWith('communications');

      fireEvent.click(tabs[3]); // Track
      expect(mockOnTabChange).toHaveBeenCalledWith('track');

      fireEvent.click(tabs[0]); // Overview
      expect(mockOnTabChange).toHaveBeenCalledWith('overview');
    });
  });

  describe('keyboard navigation', () => {
    it('should move to next tab on ArrowRight', () => {
      const mockOnTabChange = vi.fn();
      render(
        <TabNavigation {...defaultProps} activeTab="overview" onTabChange={mockOnTabChange} />
      );

      const tablist = screen.getByRole('tablist');
      fireEvent.keyDown(tablist, { key: 'ArrowRight' });

      expect(mockOnTabChange).toHaveBeenCalledWith('communications');
    });

    it('should move to previous tab on ArrowLeft', () => {
      const mockOnTabChange = vi.fn();
      render(
        <TabNavigation {...defaultProps} activeTab="communications" onTabChange={mockOnTabChange} />
      );

      const tablist = screen.getByRole('tablist');
      fireEvent.keyDown(tablist, { key: 'ArrowLeft' });

      expect(mockOnTabChange).toHaveBeenCalledWith('overview');
    });

    it('should wrap around from last to first on ArrowRight', () => {
      const mockOnTabChange = vi.fn();
      render(<TabNavigation {...defaultProps} activeTab="track" onTabChange={mockOnTabChange} />);

      const tablist = screen.getByRole('tablist');
      fireEvent.keyDown(tablist, { key: 'ArrowRight' });

      expect(mockOnTabChange).toHaveBeenCalledWith('overview');
    });

    it('should wrap around from first to last on ArrowLeft', () => {
      const mockOnTabChange = vi.fn();
      render(
        <TabNavigation {...defaultProps} activeTab="overview" onTabChange={mockOnTabChange} />
      );

      const tablist = screen.getByRole('tablist');
      fireEvent.keyDown(tablist, { key: 'ArrowLeft' });

      expect(mockOnTabChange).toHaveBeenCalledWith('track');
    });

    it('should go to first tab on Home', () => {
      const mockOnTabChange = vi.fn();
      render(<TabNavigation {...defaultProps} activeTab="safety" onTabChange={mockOnTabChange} />);

      const tablist = screen.getByRole('tablist');
      fireEvent.keyDown(tablist, { key: 'Home' });

      expect(mockOnTabChange).toHaveBeenCalledWith('overview');
    });

    it('should go to last tab on End', () => {
      const mockOnTabChange = vi.fn();
      render(
        <TabNavigation {...defaultProps} activeTab="overview" onTabChange={mockOnTabChange} />
      );

      const tablist = screen.getByRole('tablist');
      fireEvent.keyDown(tablist, { key: 'End' });

      expect(mockOnTabChange).toHaveBeenCalledWith('track');
    });

    it('should handle arrow key navigation', () => {
      const mockOnTabChange = vi.fn();
      render(
        <TabNavigation {...defaultProps} activeTab="overview" onTabChange={mockOnTabChange} />
      );

      const tablist = screen.getByRole('tablist');
      fireEvent.keyDown(tablist, { key: 'ArrowRight' });

      // Should navigate to next tab
      expect(mockOnTabChange).toHaveBeenCalledWith('communications');
    });
  });

  describe('badge counts', () => {
    it('should display combined radio and ACARS count on communications tab', () => {
      render(<TabNavigation {...defaultProps} radioCount={5} acarsCount={3} />);

      expect(screen.getByLabelText(/8 comms/i)).toBeInTheDocument();
    });

    it('should not display badge when communications count is 0', () => {
      render(<TabNavigation {...defaultProps} radioCount={0} acarsCount={0} />);

      expect(screen.queryByLabelText(/0 comms/i)).not.toBeInTheDocument();
    });

    it('should display safety count badge', () => {
      render(<TabNavigation {...defaultProps} safetyCount={12} />);

      expect(screen.getByLabelText(/12 safety/i)).toBeInTheDocument();
    });

    it('should not display safety badge when count is 0', () => {
      render(<TabNavigation {...defaultProps} safetyCount={0} />);

      expect(screen.queryByLabelText(/0 safety/i)).not.toBeInTheDocument();
    });

    it('should add alert class to safety badge when count > 0', () => {
      const { container } = render(<TabNavigation {...defaultProps} safetyCount={5} />);

      const safetyBadge = container.querySelector('.tab-badge.alert');
      expect(safetyBadge).toBeInTheDocument();
    });

    it('should not add alert class to communications badge', () => {
      const { container } = render(<TabNavigation {...defaultProps} radioCount={10} />);

      const commsBadge = container.querySelector('.tab-badge:not(.alert)');
      expect(commsBadge).toBeInTheDocument();
    });
  });

  describe('tabindex', () => {
    it('should set tabindex 0 on active tab', () => {
      render(<TabNavigation {...defaultProps} activeTab="safety" />);

      const safetyTab = screen.getByRole('tab', { name: /safety/i });
      expect(safetyTab).toHaveAttribute('tabindex', '0');
    });

    it('should set tabindex -1 on inactive tabs', () => {
      render(<TabNavigation {...defaultProps} activeTab="safety" />);

      const tabs = screen.getAllByRole('tab');
      // Overview, Comms, Track should have tabindex -1
      expect(tabs[0]).toHaveAttribute('tabindex', '-1');
      expect(tabs[1]).toHaveAttribute('tabindex', '-1');
      expect(tabs[3]).toHaveAttribute('tabindex', '-1');
      // Safety should have tabindex 0
      expect(tabs[2]).toHaveAttribute('tabindex', '0');
    });
  });

  describe('aria-controls', () => {
    it('should have aria-controls matching panel ids', () => {
      render(<TabNavigation {...defaultProps} />);

      const tabs = screen.getAllByRole('tab');
      expect(tabs[0]).toHaveAttribute('aria-controls', 'panel-overview');
      expect(tabs[1]).toHaveAttribute('aria-controls', 'panel-communications');
      expect(tabs[2]).toHaveAttribute('aria-controls', 'panel-safety');
      expect(tabs[3]).toHaveAttribute('aria-controls', 'panel-track');
    });
  });

  describe('tab ids', () => {
    it('should have correct id attributes', () => {
      render(<TabNavigation {...defaultProps} />);

      const tabs = screen.getAllByRole('tab');
      expect(tabs[0]).toHaveAttribute('id', 'tab-overview');
      expect(tabs[1]).toHaveAttribute('id', 'tab-communications');
      expect(tabs[2]).toHaveAttribute('id', 'tab-safety');
      expect(tabs[3]).toHaveAttribute('id', 'tab-track');
    });
  });

  describe('tab labels', () => {
    it('should display abbreviated label for communications', () => {
      render(<TabNavigation {...defaultProps} />);

      // The visible label is "Comms" not "Communications"
      expect(screen.getByText('Comms')).toBeInTheDocument();
    });

    it('should have tab labels visible', () => {
      render(<TabNavigation {...defaultProps} />);

      // Visible tab labels
      expect(screen.getByText('Overview')).toBeInTheDocument();
      expect(screen.getByText('Comms')).toBeInTheDocument();
      expect(screen.getByText('Safety')).toBeInTheDocument();
      expect(screen.getByText('Track')).toBeInTheDocument();
    });
  });
});
