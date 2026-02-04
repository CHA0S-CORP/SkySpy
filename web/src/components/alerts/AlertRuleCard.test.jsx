import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertRuleCard } from './AlertRuleCard';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Settings: () => <span data-testid="icon-settings">Settings</span>,
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  Download: () => <span data-testid="icon-download">Download</span>,
  Copy: () => <span data-testid="icon-copy">Copy</span>,
  Clock: () => <span data-testid="icon-clock">Clock</span>,
  Zap: () => <span data-testid="icon-zap">Zap</span>,
  Activity: () => <span data-testid="icon-activity">Activity</span>,
  TestTube2: () => <span data-testid="icon-test">Test</span>,
  FileJson: () => <span data-testid="icon-json">JSON</span>,
  Info: () => <span data-testid="icon-info">Info</span>,
  AlertTriangle: () => <span data-testid="icon-warning">Warning</span>,
  AlertCircle: () => <span data-testid="icon-critical">Critical</span>,
}));

describe('AlertRuleCard', () => {
  const mockRule = {
    id: 1,
    name: 'Military Aircraft Alert',
    priority: 'warning',
    enabled: true,
    cooldown: 300,
    trigger_count: 5,
    last_triggered: '2024-01-15T10:30:00Z',
    description: 'Alert when military aircraft are detected',
    conditions: {
      logic: 'AND',
      groups: [
        {
          logic: 'AND',
          conditions: [{ type: 'military', operator: 'eq', value: 'true' }],
        },
      ],
    },
  };

  const mockHandlers = {
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onTest: vi.fn(),
    onExport: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('should render rule name', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);
      expect(screen.getByText('Military Aircraft Alert')).toBeInTheDocument();
    });

    it('should render rule description', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);
      expect(screen.getByText('Alert when military aircraft are detected')).toBeInTheDocument();
    });

    it('should render priority badge', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);
      // Use getAllByText since icon mock also contains text
      const badges = screen.getAllByText('Warning');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it('should render cooldown information', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);
      expect(screen.getByText('Cooldown: 5m')).toBeInTheDocument();
    });

    it('should render trigger count', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);
      expect(screen.getByText('Triggers: 5')).toBeInTheDocument();
    });

    it('should render conditions summary', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);
      expect(screen.getByText(/military = true/i)).toBeInTheDocument();
    });

    it('should not render description if not provided', () => {
      const ruleWithoutDescription = { ...mockRule, description: undefined };
      render(<AlertRuleCard rule={ruleWithoutDescription} {...mockHandlers} />);
      expect(
        screen.queryByText('Alert when military aircraft are detected')
      ).not.toBeInTheDocument();
    });
  });

  describe('enabled/disabled states', () => {
    it('should show enabled toggle when rule is enabled', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);
      const toggleBtn = screen.getByRole('button', { name: /disable rule/i });
      expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
    });

    it('should show disabled toggle when rule is disabled', () => {
      const disabledRule = { ...mockRule, enabled: false };
      render(<AlertRuleCard rule={disabledRule} {...mockHandlers} />);
      const toggleBtn = screen.getByRole('button', { name: /enable rule/i });
      expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    });

    it('should apply disabled class when rule is disabled', () => {
      const disabledRule = { ...mockRule, enabled: false };
      render(<AlertRuleCard rule={disabledRule} {...mockHandlers} />);
      const article = screen.getByRole('listitem');
      expect(article).toHaveClass('disabled');
    });

    it('should not apply disabled class when rule is enabled', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);
      const article = screen.getByRole('listitem');
      expect(article).not.toHaveClass('disabled');
    });
  });

  describe('action buttons', () => {
    it('should call onToggle when toggle button is clicked', async () => {
      const user = userEvent.setup();
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);

      const toggleBtn = screen.getByRole('button', { name: /disable rule/i });
      await user.click(toggleBtn);

      expect(mockHandlers.onToggle).toHaveBeenCalledWith(mockRule);
      expect(mockHandlers.onToggle).toHaveBeenCalledTimes(1);
    });

    it('should call onEdit when edit button is clicked', async () => {
      const user = userEvent.setup();
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);

      const editBtn = screen.getByRole('button', { name: /edit/i });
      await user.click(editBtn);

      expect(mockHandlers.onEdit).toHaveBeenCalledWith(mockRule);
      expect(mockHandlers.onEdit).toHaveBeenCalledTimes(1);
    });

    it('should call onDuplicate when duplicate button is clicked', async () => {
      const user = userEvent.setup();
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);

      const duplicateBtn = screen.getByRole('button', { name: /duplicate/i });
      await user.click(duplicateBtn);

      expect(mockHandlers.onDuplicate).toHaveBeenCalledWith(mockRule);
      expect(mockHandlers.onDuplicate).toHaveBeenCalledTimes(1);
    });

    it('should call onDelete when delete button is clicked', async () => {
      const user = userEvent.setup();
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);

      const deleteBtn = screen.getByRole('button', { name: /delete/i });
      await user.click(deleteBtn);

      expect(mockHandlers.onDelete).toHaveBeenCalledWith(mockRule);
      expect(mockHandlers.onDelete).toHaveBeenCalledTimes(1);
    });

    it('should call onTest when test button is clicked', async () => {
      const user = userEvent.setup();
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);

      const testBtn = screen.getByRole('button', { name: /test/i });
      await user.click(testBtn);

      expect(mockHandlers.onTest).toHaveBeenCalledWith(mockRule);
      expect(mockHandlers.onTest).toHaveBeenCalledTimes(1);
    });
  });

  describe('export dropdown', () => {
    it('should show export dropdown when export button is clicked', async () => {
      const user = userEvent.setup();
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);

      const exportBtn = screen.getByRole('button', { name: /export/i });
      expect(exportBtn).toHaveAttribute('aria-expanded', 'false');

      await user.click(exportBtn);

      expect(exportBtn).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('menuitem')).toBeInTheDocument();
      expect(screen.getByText(/export as json/i)).toBeInTheDocument();
    });

    it('should call onExport when export as JSON is clicked', async () => {
      const user = userEvent.setup();
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);

      const exportBtn = screen.getByRole('button', { name: /export/i });
      await user.click(exportBtn);

      const jsonExportBtn = screen.getByRole('menuitem');
      await user.click(jsonExportBtn);

      expect(mockHandlers.onExport).toHaveBeenCalledWith(mockRule);
    });

    it('should close dropdown when clicking outside', async () => {
      const user = userEvent.setup();
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);

      const exportBtn = screen.getByRole('button', { name: /export/i });
      await user.click(exportBtn);

      expect(exportBtn).toHaveAttribute('aria-expanded', 'true');

      // Click outside (document body)
      fireEvent.click(document.body);

      await waitFor(() => {
        expect(exportBtn).toHaveAttribute('aria-expanded', 'false');
      });
    });
  });

  describe('priority variants', () => {
    it.each([
      ['info', 'Info'],
      ['warning', 'Warning'],
      ['critical', 'Critical'],
      ['emergency', 'Emergency'],
    ])('should render %s priority correctly', (priority, label) => {
      const rule = { ...mockRule, priority };
      render(<AlertRuleCard rule={rule} {...mockHandlers} />);
      // Use getAllByText since icon mock also contains text
      const badges = screen.getAllByText(label);
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it('should default to info priority for unknown priority', () => {
      const rule = { ...mockRule, priority: 'unknown' };
      render(<AlertRuleCard rule={rule} {...mockHandlers} />);
      // Should use info config as default - use getAllByText since icon mock also contains text
      const badges = screen.getAllByText('Info');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cooldown formatting', () => {
    it('should format cooldown in seconds', () => {
      const rule = { ...mockRule, cooldown: 30 };
      render(<AlertRuleCard rule={rule} {...mockHandlers} />);
      expect(screen.getByText('Cooldown: 30s')).toBeInTheDocument();
    });

    it('should format cooldown in minutes', () => {
      const rule = { ...mockRule, cooldown: 300 };
      render(<AlertRuleCard rule={rule} {...mockHandlers} />);
      expect(screen.getByText('Cooldown: 5m')).toBeInTheDocument();
    });

    it('should format cooldown in hours', () => {
      const rule = { ...mockRule, cooldown: 7200 };
      render(<AlertRuleCard rule={rule} {...mockHandlers} />);
      expect(screen.getByText('Cooldown: 2h')).toBeInTheDocument();
    });

    it('should show None for zero cooldown', () => {
      const rule = { ...mockRule, cooldown: 0 };
      render(<AlertRuleCard rule={rule} {...mockHandlers} />);
      expect(screen.getByText('Cooldown: None')).toBeInTheDocument();
    });
  });

  describe('schedule display', () => {
    it('should show starts_at when provided', () => {
      const rule = { ...mockRule, starts_at: '2024-02-01T00:00:00Z' };
      render(<AlertRuleCard rule={rule} {...mockHandlers} />);
      expect(screen.getByText(/Starts:/i)).toBeInTheDocument();
    });

    it('should show expires_at when provided', () => {
      const rule = { ...mockRule, expires_at: '2024-12-31T23:59:59Z' };
      render(<AlertRuleCard rule={rule} {...mockHandlers} />);
      expect(screen.getByText(/Expires:/i)).toBeInTheDocument();
    });

    it('should not show schedule section when no schedule is set', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);
      expect(screen.queryByText(/Starts:/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Expires:/i)).not.toBeInTheDocument();
    });
  });

  describe('simple condition format', () => {
    it('should render simple condition format when no groups', () => {
      const rule = {
        ...mockRule,
        conditions: undefined,
        type: 'callsign',
        operator: 'contains',
        value: 'UAL',
      };
      render(<AlertRuleCard rule={rule} {...mockHandlers} />);
      expect(screen.getByText(/callsign contains UAL/i)).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have proper aria-label on rule card', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);
      const article = screen.getByRole('listitem');
      expect(article).toHaveAttribute(
        'aria-label',
        expect.stringContaining('Military Aircraft Alert')
      );
      expect(article).toHaveAttribute('aria-label', expect.stringContaining('Warning priority'));
    });

    it('should include disabled in aria-label for disabled rules', () => {
      const disabledRule = { ...mockRule, enabled: false };
      render(<AlertRuleCard rule={disabledRule} {...mockHandlers} />);
      const article = screen.getByRole('listitem');
      expect(article).toHaveAttribute('aria-label', expect.stringContaining('disabled'));
    });

    it('should have proper button labels', () => {
      render(<AlertRuleCard rule={mockRule} {...mockHandlers} />);

      expect(
        screen.getByRole('button', { name: /test.*against current aircraft/i })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /duplicate/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    });
  });
});
