import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConditionBuilder } from './ConditionBuilder';
import { CONDITION_TYPES } from './RuleFormConstants';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x">X</span>,
  Plus: () => <span data-testid="icon-plus">Plus</span>,
}));

describe('ConditionBuilder', () => {
  const defaultConditions = {
    logic: 'AND',
    groups: [
      {
        logic: 'AND',
        conditions: [{ type: 'icao', operator: 'eq', value: '' }],
      },
    ],
  };

  const multipleConditionsInGroup = {
    logic: 'AND',
    groups: [
      {
        logic: 'AND',
        conditions: [
          { type: 'icao', operator: 'eq', value: 'A12345' },
          { type: 'callsign', operator: 'contains', value: 'UAL' },
        ],
      },
    ],
  };

  const multipleGroups = {
    logic: 'OR',
    groups: [
      {
        logic: 'AND',
        conditions: [{ type: 'military', operator: 'eq', value: 'true' }],
      },
      {
        logic: 'AND',
        conditions: [{ type: 'emergency', operator: 'eq', value: 'true' }],
      },
    ],
  };

  let mockOnChange;
  let mockOnValidationErrorsClear;

  beforeEach(() => {
    mockOnChange = vi.fn();
    mockOnValidationErrorsClear = vi.fn();
  });

  describe('rendering', () => {
    it('should render a single condition group', () => {
      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText('Group 1')).toBeInTheDocument();
      expect(screen.getByLabelText('Condition type')).toBeInTheDocument();
      expect(screen.getByLabelText('Operator')).toBeInTheDocument();
      expect(screen.getByLabelText('Value')).toBeInTheDocument();
    });

    it('should render multiple condition groups', () => {
      render(
        <ConditionBuilder
          conditions={multipleGroups}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText('Group 1')).toBeInTheDocument();
      expect(screen.getByText('Group 2')).toBeInTheDocument();
    });

    it('should render all condition types in dropdown', () => {
      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const typeSelect = screen.getByLabelText('Condition type');
      const options = within(typeSelect).getAllByRole('option');

      // Verify some key condition types are present
      expect(options.length).toBe(CONDITION_TYPES.length);
      expect(within(typeSelect).getByText('ICAO Hex')).toBeInTheDocument();
      expect(within(typeSelect).getByText('Callsign')).toBeInTheDocument();
      expect(within(typeSelect).getByText('Military Aircraft')).toBeInTheDocument();
    });

    it('should show logic select between groups', () => {
      render(
        <ConditionBuilder
          conditions={multipleGroups}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const logicSelects = screen.getAllByLabelText('Logic between groups');
      expect(logicSelects.length).toBe(1); // Only appears before second group
    });

    it('should show group logic select when multiple conditions in group', () => {
      render(
        <ConditionBuilder
          conditions={multipleConditionsInGroup}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const groupLogicSelect = screen.getByLabelText('Logic within group');
      expect(groupLogicSelect).toBeInTheDocument();
      expect(groupLogicSelect.value).toBe('AND');
    });

    it('should not show value input for boolean condition types', () => {
      const booleanCondition = {
        logic: 'AND',
        groups: [
          {
            logic: 'AND',
            conditions: [{ type: 'military', operator: 'eq', value: 'true' }],
          },
        ],
      };

      render(
        <ConditionBuilder
          conditions={booleanCondition}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const valueInputs = screen.queryAllByLabelText('Value');
      expect(valueInputs.length).toBe(0);
    });

    it('should show number input for numeric condition types', () => {
      const numericCondition = {
        logic: 'AND',
        groups: [
          {
            logic: 'AND',
            conditions: [{ type: 'altitude_above', operator: 'gt', value: '10000' }],
          },
        ],
      };

      render(
        <ConditionBuilder
          conditions={numericCondition}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const valueInput = screen.getByLabelText('Value');
      expect(valueInput).toHaveAttribute('type', 'number');
    });
  });

  describe('condition type selection', () => {
    it('should call onChange when condition type is changed', async () => {
      const user = userEvent.setup();

      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const typeSelect = screen.getByLabelText('Condition type');
      await user.selectOptions(typeSelect, 'callsign');

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: expect.arrayContaining([
            expect.objectContaining({
              conditions: expect.arrayContaining([expect.objectContaining({ type: 'callsign' })]),
            }),
          ]),
        })
      );
    });
  });

  describe('operator selection', () => {
    it('should call onChange when operator is changed', async () => {
      const user = userEvent.setup();

      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const operatorSelect = screen.getByLabelText('Operator');
      await user.selectOptions(operatorSelect, 'contains');

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: expect.arrayContaining([
            expect.objectContaining({
              conditions: expect.arrayContaining([
                expect.objectContaining({ operator: 'contains' }),
              ]),
            }),
          ]),
        })
      );
    });

    it('should show string operators for string condition types', () => {
      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const operatorSelect = screen.getByLabelText('Operator');
      within(operatorSelect).getAllByRole('option');

      // String operators
      expect(within(operatorSelect).getByText('equals')).toBeInTheDocument();
      expect(within(operatorSelect).getByText('not equals')).toBeInTheDocument();
      expect(within(operatorSelect).getByText('contains')).toBeInTheDocument();
    });

    it('should show numeric operators for numeric condition types', () => {
      const numericCondition = {
        logic: 'AND',
        groups: [
          {
            logic: 'AND',
            conditions: [{ type: 'altitude_above', operator: 'gt', value: '10000' }],
          },
        ],
      };

      render(
        <ConditionBuilder
          conditions={numericCondition}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const operatorSelect = screen.getByLabelText('Operator');
      expect(within(operatorSelect).getByText('=')).toBeInTheDocument();
      expect(within(operatorSelect).getByText('<')).toBeInTheDocument();
      expect(within(operatorSelect).getByText('>')).toBeInTheDocument();
      expect(within(operatorSelect).getByText('<=')).toBeInTheDocument();
      expect(within(operatorSelect).getByText('>=')).toBeInTheDocument();
    });
  });

  describe('value input', () => {
    it('should call onChange when value is changed', async () => {
      const user = userEvent.setup();

      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const valueInput = screen.getByLabelText('Value');
      await user.type(valueInput, 'A12345');

      // Each keystroke triggers onChange, so check that onChange was called
      expect(mockOnChange).toHaveBeenCalled();
      // The final call should have the full typed value
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      expect(lastCall.groups[0].conditions[0].value).toContain('5'); // Last character
    });

    it('should clear validation error when value changes', async () => {
      const user = userEvent.setup();

      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{ cond_0_0: 'Value is required' }}
          onChange={mockOnChange}
          onValidationErrorsClear={mockOnValidationErrorsClear}
        />
      );

      const valueInput = screen.getByLabelText('Value');
      await user.type(valueInput, 'A');

      expect(mockOnValidationErrorsClear).toHaveBeenCalledWith('cond_0_0');
    });

    it('should show placeholder based on condition type', () => {
      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const valueInput = screen.getByLabelText('Value');
      expect(valueInput).toHaveAttribute('placeholder', 'e.g., A12345');
    });
  });

  describe('adding conditions', () => {
    it('should call onChange with new condition when add button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      // Get the "Add Condition" button by its class (add-condition-btn, not add-group-btn)
      const addBtns = screen.getAllByRole('button', { name: /add condition/i });
      const addConditionBtn = addBtns.find((btn) => btn.classList.contains('add-condition-btn'));
      await user.click(addConditionBtn);

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: [
            expect.objectContaining({
              conditions: expect.arrayContaining([
                expect.any(Object),
                expect.objectContaining({ type: 'icao', operator: 'eq' }),
              ]),
            }),
          ],
        })
      );
    });
  });

  describe('removing conditions', () => {
    it('should call onChange with condition removed', async () => {
      const user = userEvent.setup();

      render(
        <ConditionBuilder
          conditions={multipleConditionsInGroup}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const removeButtons = screen.getAllByLabelText('Remove condition');
      await user.click(removeButtons[0]);

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: [
            expect.objectContaining({
              conditions: [expect.objectContaining({ type: 'callsign', value: 'UAL' })],
            }),
          ],
        })
      );
    });

    it('should create default group when removing last condition in last group', async () => {
      const user = userEvent.setup();

      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const removeBtn = screen.getByLabelText('Remove condition');
      await user.click(removeBtn);

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: [expect.objectContaining({ logic: 'AND' })],
        })
      );
    });
  });

  describe('adding groups', () => {
    it('should add a new condition group when add group button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const addGroupBtn = screen.getByRole('button', {
        name: /add condition group/i,
      });
      await user.click(addGroupBtn);

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: expect.arrayContaining([
            expect.any(Object),
            expect.objectContaining({ logic: 'AND' }),
          ]),
        })
      );
    });
  });

  describe('group logic', () => {
    it('should update group logic when changed', async () => {
      const user = userEvent.setup();

      render(
        <ConditionBuilder
          conditions={multipleConditionsInGroup}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const groupLogicSelect = screen.getByLabelText('Logic within group');
      await user.selectOptions(groupLogicSelect, 'OR');

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: [expect.objectContaining({ logic: 'OR' })],
        })
      );
    });

    it('should update top-level logic when changed', async () => {
      const user = userEvent.setup();

      render(
        <ConditionBuilder
          conditions={multipleGroups}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      const topLogicSelect = screen.getByLabelText('Logic between groups');
      await user.selectOptions(topLogicSelect, 'AND');

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          logic: 'AND',
        })
      );
    });
  });

  describe('validation errors', () => {
    it('should display validation error for condition', () => {
      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{ cond_0_0: 'Value is required' }}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText('Value is required')).toBeInTheDocument();
    });

    it('should display general conditions error', () => {
      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{ conditions: 'At least one condition is required' }}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText('At least one condition is required')).toBeInTheDocument();
    });

    it('should mark value input as invalid when has error', () => {
      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{ cond_0_0: 'Value is required' }}
          onChange={mockOnChange}
        />
      );

      const valueInput = screen.getByLabelText('Value');
      expect(valueInput).toHaveAttribute('aria-invalid', 'true');
    });

    it('should apply error class to condition row', () => {
      render(
        <ConditionBuilder
          conditions={defaultConditions}
          validationErrors={{ cond_0_0: 'Value is required' }}
          onChange={mockOnChange}
        />
      );

      const conditionRow = screen.getByLabelText('Value').closest('.condition-row');
      expect(conditionRow).toHaveClass('has-error');
    });
  });

  describe('empty conditions', () => {
    it('should handle null conditions', () => {
      render(<ConditionBuilder conditions={null} validationErrors={{}} onChange={mockOnChange} />);

      // Should render without crashing
      expect(screen.getByRole('button', { name: /add condition group/i })).toBeInTheDocument();
    });

    it('should handle conditions without groups', () => {
      render(
        <ConditionBuilder
          conditions={{ logic: 'AND' }}
          validationErrors={{}}
          onChange={mockOnChange}
        />
      );

      // Should render without crashing
      expect(screen.getByRole('button', { name: /add condition group/i })).toBeInTheDocument();
    });
  });
});
