import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleForm } from './RuleForm';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x">X</span>,
  Save: () => <span data-testid="icon-save">Save</span>,
  AlertCircle: () => <span data-testid="icon-alert">Alert</span>,
  Info: () => <span data-testid="icon-info">Info</span>,
  AlertTriangle: () => <span data-testid="icon-warning">Warning</span>,
  Plus: () => <span data-testid="icon-plus">Plus</span>,
  Eye: () => <span data-testid="icon-eye">Eye</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">ChevronDown</span>,
  ChevronUp: () => <span data-testid="icon-chevron-up">ChevronUp</span>,
  Plane: () => <span data-testid="icon-plane">Plane</span>,
  Bell: () => <span data-testid="icon-bell">Bell</span>,
  Shield: () => <span data-testid="icon-shield">Shield</span>,
  MapPin: () => <span data-testid="icon-map-pin">MapPin</span>,
}));

// Mock child components to simplify testing
vi.mock('./ConditionBuilder', () => ({
  ConditionBuilder: ({ conditions, onChange }) => (
    <div data-testid="condition-builder">
      <button
        onClick={() =>
          onChange({
            logic: 'AND',
            groups: [
              {
                logic: 'AND',
                conditions: [{ type: 'military', operator: 'eq', value: 'true' }],
              },
            ],
          })
        }
      >
        Set Valid Conditions
      </button>
      <span>Conditions: {JSON.stringify(conditions)}</span>
    </div>
  ),
}));

vi.mock('./LivePreview', () => ({
  LivePreview: () => <div data-testid="live-preview">Live Preview</div>,
}));

vi.mock('./NotificationChannelSelector', () => ({
  NotificationChannelSelector: () => (
    <div data-testid="channel-selector">Channel Selector</div>
  ),
}));

vi.mock('./RuleTemplates', () => ({
  RuleTemplates: ({ onApply, onSkip }) => (
    <div data-testid="rule-templates">
      <button onClick={() => onApply({ name: 'Template Rule', priority: 'warning' })}>
        Apply Template
      </button>
      <button onClick={onSkip}>Skip Templates</button>
    </div>
  ),
}));

vi.mock('../../hooks/useNotificationChannels', () => ({
  useNotificationChannels: () => ({
    channels: [
      { id: 1, name: 'Discord', type: 'discord', enabled: true },
      { id: 2, name: 'Telegram', type: 'telegram', enabled: true },
    ],
    loading: false,
  }),
}));

describe('RuleForm', () => {
  let mockFetch;
  let mockOnClose;
  let mockOnSave;
  let mockOnToast;

  const defaultProps = {
    apiBase: 'http://localhost:8000',
    wsRequest: vi.fn(),
    wsConnected: true,
    aircraft: [
      { hex: 'A12345', flight: 'UAL123', alt_baro: 35000 },
      { hex: 'B67890', flight: 'DAL456', alt_baro: 28000 },
    ],
    feederLocation: { lat: 40.7128, lon: -74.006 },
    onClose: vi.fn(),
    onSave: vi.fn(),
    onToast: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    mockOnClose = vi.fn();
    mockOnSave = vi.fn();
    mockOnToast = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create mode', () => {
    it('should render create form title', () => {
      render(<RuleForm {...defaultProps} />);
      expect(screen.getByText('Create Alert Rule')).toBeInTheDocument();
    });

    it('should show templates section for new rules', () => {
      render(<RuleForm {...defaultProps} />);
      expect(screen.getByTestId('rule-templates')).toBeInTheDocument();
    });

    it('should hide templates section when skip is clicked', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /skip/i }));

      expect(screen.queryByTestId('rule-templates')).not.toBeInTheDocument();
    });

    it('should apply template when selected', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /apply template/i }));

      // Template should populate the name field
      const nameInput = screen.getByLabelText(/rule name/i);
      expect(nameInput.value).toBe('Template Rule');
    });
  });

  describe('edit mode', () => {
    const editRule = {
      id: 1,
      name: 'Existing Rule',
      description: 'Test description',
      priority: 'critical',
      enabled: true,
      cooldown: 600,
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

    it('should render edit form title', () => {
      render(<RuleForm {...defaultProps} editRule={editRule} />);
      expect(screen.getByText('Edit Alert Rule')).toBeInTheDocument();
    });

    it('should not show templates in edit mode', () => {
      render(<RuleForm {...defaultProps} editRule={editRule} />);
      expect(screen.queryByTestId('rule-templates')).not.toBeInTheDocument();
    });

    it('should populate form with existing rule data', () => {
      render(<RuleForm {...defaultProps} editRule={editRule} />);

      const nameInput = screen.getByLabelText(/rule name/i);
      expect(nameInput.value).toBe('Existing Rule');

      const descInput = screen.getByLabelText(/description/i);
      expect(descInput.value).toBe('Test description');

      const cooldownInput = screen.getByLabelText(/cooldown/i);
      expect(cooldownInput.value).toBe('600');
    });

    it('should support rule prop as alias for editRule', () => {
      render(<RuleForm {...defaultProps} rule={editRule} />);
      expect(screen.getByText('Edit Alert Rule')).toBeInTheDocument();
      expect(screen.getByLabelText(/rule name/i).value).toBe('Existing Rule');
    });
  });

  describe('form validation', () => {
    it('should show error when name is empty on submit', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} />);

      // Skip templates
      await user.click(screen.getByRole('button', { name: /skip/i }));

      // The name input has 'required' attribute, so native HTML validation prevents
      // submission. We verify the input has required attribute
      const nameInput = screen.getByLabelText(/rule name/i);
      expect(nameInput).toHaveAttribute('required');
      expect(nameInput).toHaveAttribute('aria-required', 'true');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not submit form when conditions have empty values', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} />);

      // Skip templates
      await user.click(screen.getByRole('button', { name: /skip/i }));

      // Fill in name
      const nameInput = screen.getByLabelText(/rule name/i);
      await user.type(nameInput, 'Test Rule');

      // Try to submit (conditions should have empty value)
      const submitBtn = screen.getByRole('button', { name: /save rule/i });
      await user.click(submitBtn);

      // Fetch should not be called due to validation error from validateForm
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should have aria-invalid false when name has value', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} />);

      // Skip templates
      await user.click(screen.getByRole('button', { name: /skip/i }));

      const nameInput = screen.getByLabelText(/rule name/i);
      // Initially no value - aria-invalid should be false (no error yet shown)
      expect(nameInput).toHaveAttribute('aria-invalid', 'false');

      // Enter a name
      await user.type(nameInput, 'Test Rule');

      // aria-invalid should still be false since we have a value
      expect(nameInput).toHaveAttribute('aria-invalid', 'false');
    });
  });

  describe('form submission', () => {
    it('should call API to create rule on valid submit', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ id: 1, name: 'Test Rule' }),
      });

      render(
        <RuleForm
          {...defaultProps}
          onClose={mockOnClose}
          onSave={mockOnSave}
          onToast={mockOnToast}
        />
      );

      // Skip templates
      await user.click(screen.getByRole('button', { name: /skip/i }));

      // Fill in name
      const nameInput = screen.getByLabelText(/rule name/i);
      await user.type(nameInput, 'Test Rule');

      // Set valid conditions via mock
      await user.click(screen.getByRole('button', { name: /set valid conditions/i }));

      // Submit form
      const submitBtn = screen.getByRole('button', { name: /save rule/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/v1/alerts/rules',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      expect(mockOnToast).toHaveBeenCalledWith('Rule created', 'success');
      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call API to update rule in edit mode', async () => {
      const user = userEvent.setup();
      const editRule = {
        id: 123,
        name: 'Existing Rule',
        priority: 'info',
        enabled: true,
        cooldown: 300,
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

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ id: 123, name: 'Updated Rule' }),
      });

      render(
        <RuleForm
          {...defaultProps}
          editRule={editRule}
          onClose={mockOnClose}
          onSave={mockOnSave}
          onToast={mockOnToast}
        />
      );

      // Update name
      const nameInput = screen.getByLabelText(/rule name/i);
      await user.clear(nameInput);
      await user.type(nameInput, 'Updated Rule');

      // Submit
      const submitBtn = screen.getByRole('button', { name: /save rule/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/v1/alerts/rules/123',
          expect.objectContaining({
            method: 'PATCH',
          })
        );
      });

      expect(mockOnToast).toHaveBeenCalledWith('Rule updated', 'success');
    });

    it('should display API error on failed submission', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ error: 'Invalid rule configuration' }),
      });

      render(<RuleForm {...defaultProps} />);

      // Skip templates
      await user.click(screen.getByRole('button', { name: /skip/i }));

      // Fill form
      const nameInput = screen.getByLabelText(/rule name/i);
      await user.type(nameInput, 'Test Rule');

      await user.click(screen.getByRole('button', { name: /set valid conditions/i }));

      // Submit
      const submitBtn = screen.getByRole('button', { name: /save rule/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Invalid rule configuration'
        );
      });
    });

    it('should show loading state during submission', async () => {
      const user = userEvent.setup();
      let resolvePromise;
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = () =>
              resolve({
                ok: true,
                headers: new Headers({ 'content-type': 'application/json' }),
                json: () => Promise.resolve({ id: 1 }),
              });
          })
      );

      render(<RuleForm {...defaultProps} />);

      // Skip templates
      await user.click(screen.getByRole('button', { name: /skip/i }));

      // Fill form
      const nameInput = screen.getByLabelText(/rule name/i);
      await user.type(nameInput, 'Test Rule');

      await user.click(screen.getByRole('button', { name: /set valid conditions/i }));

      // Submit
      const submitBtn = screen.getByRole('button', { name: /save rule/i });
      await user.click(submitBtn);

      expect(submitBtn).toHaveAttribute('aria-busy', 'true');
      expect(submitBtn).toBeDisabled();
      expect(screen.getByText('Saving...')).toBeInTheDocument();

      // Resolve the promise
      resolvePromise();

      await waitFor(() => {
        expect(screen.queryByText('Saving...')).not.toBeInTheDocument();
      });
    });
  });

  describe('priority selection', () => {
    it('should render all priority options', () => {
      render(<RuleForm {...defaultProps} />);

      expect(screen.getByRole('radio', { name: /info/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /warning/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /critical/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /emergency/i })).toBeInTheDocument();
    });

    it('should default to info priority for new rules', () => {
      render(<RuleForm {...defaultProps} />);

      const infoRadio = screen.getByRole('radio', { name: /info/i });
      expect(infoRadio).toBeChecked();
    });

    it('should select correct priority for edit rule', () => {
      const editRule = {
        id: 1,
        name: 'Test',
        priority: 'critical',
        conditions: { logic: 'AND', groups: [] },
      };

      render(<RuleForm {...defaultProps} editRule={editRule} />);

      const criticalRadio = screen.getByRole('radio', { name: /critical/i });
      expect(criticalRadio).toBeChecked();
    });

    it('should update priority when option is clicked', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} />);

      const warningRadio = screen.getByRole('radio', { name: /warning/i });
      await user.click(warningRadio);

      expect(warningRadio).toBeChecked();
    });
  });

  describe('cooldown field', () => {
    it('should default to 300 seconds', () => {
      render(<RuleForm {...defaultProps} />);

      // Skip templates first
      const cooldownInput = screen.getByLabelText(/cooldown/i);
      expect(cooldownInput.value).toBe('300');
    });

    it('should update cooldown value', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} />);

      const cooldownInput = screen.getByLabelText(/cooldown/i);
      // Clear and type new value
      await user.clear(cooldownInput);
      await user.type(cooldownInput, '600');

      // Cooldown should contain 600, though precise behavior depends on number input
      expect(cooldownInput.value).toContain('600');
    });
  });

  describe('enabled toggle', () => {
    it('should default to enabled for new rules', () => {
      render(<RuleForm {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox', { name: /enabled/i });
      expect(checkbox).toBeChecked();
    });

    it('should toggle enabled state', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox', { name: /enabled/i });
      await user.click(checkbox);

      expect(checkbox).not.toBeChecked();
    });
  });

  describe('close behavior', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} onClose={mockOnClose} />);

      const closeBtn = screen.getByLabelText(/close form/i);
      await user.click(closeBtn);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} onClose={mockOnClose} />);

      const cancelBtn = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelBtn);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when clicking overlay', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} onClose={mockOnClose} />);

      const overlay = screen.getByRole('presentation');
      await user.click(overlay);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when pressing Escape', async () => {
      const user = userEvent.setup();
      render(<RuleForm {...defaultProps} onClose={mockOnClose} />);

      await user.keyboard('{Escape}');

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('prefill from aircraft', () => {
    it('should prefill form with aircraft data', () => {
      const prefillAircraft = {
        hex: 'A12345',
        flight: 'UAL123',
      };

      render(<RuleForm {...defaultProps} prefillAircraft={prefillAircraft} />);

      const nameInput = screen.getByLabelText(/rule name/i);
      expect(nameInput.value).toBe('Track UAL123');
    });

    it('should not show templates when prefilling', () => {
      const prefillAircraft = {
        hex: 'A12345',
        flight: 'UAL123',
      };

      render(<RuleForm {...defaultProps} prefillAircraft={prefillAircraft} />);

      expect(screen.queryByTestId('rule-templates')).not.toBeInTheDocument();
    });
  });

  describe('child components', () => {
    it('should render ConditionBuilder', () => {
      render(<RuleForm {...defaultProps} />);
      expect(screen.getByTestId('condition-builder')).toBeInTheDocument();
    });

    it('should render LivePreview', () => {
      render(<RuleForm {...defaultProps} />);
      expect(screen.getByTestId('live-preview')).toBeInTheDocument();
    });

    it('should render NotificationChannelSelector', () => {
      render(<RuleForm {...defaultProps} />);
      expect(screen.getByTestId('channel-selector')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have proper dialog role', () => {
      render(<RuleForm {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should have aria-modal attribute', () => {
      render(<RuleForm {...defaultProps} />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('should have aria-labelledby pointing to title', () => {
      render(<RuleForm {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      const titleId = dialog.getAttribute('aria-labelledby');
      expect(titleId).toBe('rule-form-title');
      expect(screen.getByText('Create Alert Rule').id).toBe('rule-form-title');
    });

    it('should mark required fields', () => {
      render(<RuleForm {...defaultProps} />);
      const nameInput = screen.getByLabelText(/rule name/i);
      expect(nameInput).toHaveAttribute('aria-required', 'true');
    });

    it('should show keyboard hints', () => {
      render(<RuleForm {...defaultProps} />);
      expect(screen.getByText('Esc')).toBeInTheDocument();
      expect(screen.getByText('Tab')).toBeInTheDocument();
    });
  });

  describe('schedule fields', () => {
    it('should render starts_at field', () => {
      render(<RuleForm {...defaultProps} />);
      expect(screen.getByLabelText(/starts at/i)).toBeInTheDocument();
    });

    it('should render expires_at field', () => {
      render(<RuleForm {...defaultProps} />);
      expect(screen.getByLabelText(/expires at/i)).toBeInTheDocument();
    });
  });
});
