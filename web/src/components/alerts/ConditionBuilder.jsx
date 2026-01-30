import React from 'react';
import { X, Plus } from 'lucide-react';
import { CONDITION_TYPES, getOperatorsForType, DEFAULT_CONDITION, DEFAULT_GROUP } from './RuleFormConstants';

/**
 * ConditionRow component - renders a single condition with type, operator, and value selectors
 */
function ConditionRow({
  condition,
  groupIndex,
  condIndex,
  hasError,
  errorMessage,
  onUpdate,
  onRemove,
}) {
  const condType = CONDITION_TYPES.find(t => t.value === condition.type);
  const operators = getOperatorsForType(condition.type);

  return (
    <div className={`condition-row ${hasError ? 'has-error' : ''}`}>
      <select
        value={condition.type}
        onChange={e => onUpdate(groupIndex, condIndex, 'type', e.target.value)}
        aria-label="Condition type"
      >
        {CONDITION_TYPES.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      <select
        value={condition.operator}
        onChange={e => onUpdate(groupIndex, condIndex, 'operator', e.target.value)}
        aria-label="Operator"
      >
        {operators.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {!condType?.isBoolean && (
        <input
          type={condType?.type === 'number' ? 'number' : 'text'}
          value={condition.value || ''}
          onChange={e => onUpdate(groupIndex, condIndex, 'value', e.target.value)}
          placeholder={condType?.placeholder || 'Value'}
          aria-label="Value"
          aria-invalid={!!hasError}
        />
      )}

      <button
        type="button"
        className="remove-condition-btn"
        onClick={() => onRemove(groupIndex, condIndex)}
        aria-label="Remove condition"
      >
        <X size={16} />
      </button>

      {hasError && (
        <span className="condition-error">{errorMessage}</span>
      )}
    </div>
  );
}

/**
 * ConditionGroup component - renders a group of conditions with logic selector
 */
function ConditionGroup({
  group,
  groupIndex,
  topLevelLogic,
  validationErrors,
  onUpdateGroupLogic,
  onUpdateTopLevelLogic,
  onUpdateCondition,
  onAddCondition,
  onRemoveCondition,
}) {
  return (
    <div className="condition-group">
      <div className="condition-group-header">
        {groupIndex > 0 && (
          <select
            className="logic-select"
            value={topLevelLogic || 'AND'}
            onChange={e => onUpdateTopLevelLogic(e.target.value)}
            aria-label="Logic between groups"
          >
            <option value="AND">AND</option>
            <option value="OR">OR</option>
          </select>
        )}
        <span className="group-label">Group {groupIndex + 1}</span>
        {group.conditions.length > 1 && (
          <select
            className="logic-select"
            value={group.logic}
            onChange={e => onUpdateGroupLogic(groupIndex, e.target.value)}
            aria-label="Logic within group"
          >
            <option value="AND">Match ALL</option>
            <option value="OR">Match ANY</option>
          </select>
        )}
      </div>

      <div className="condition-rows">
        {group.conditions.map((cond, ci) => (
          <ConditionRow
            key={ci}
            condition={cond}
            groupIndex={groupIndex}
            condIndex={ci}
            hasError={!!validationErrors[`cond_${groupIndex}_${ci}`]}
            errorMessage={validationErrors[`cond_${groupIndex}_${ci}`]}
            onUpdate={onUpdateCondition}
            onRemove={onRemoveCondition}
          />
        ))}
      </div>

      <button
        type="button"
        className="add-condition-btn"
        onClick={() => onAddCondition(groupIndex)}
      >
        <Plus size={14} /> Add Condition
      </button>
    </div>
  );
}

/**
 * ConditionBuilder component - full conditions builder with multiple groups
 */
export function ConditionBuilder({
  conditions,
  validationErrors,
  onChange,
  onValidationErrorsClear,
}) {
  const groups = conditions?.groups || [];
  const topLevelLogic = conditions?.logic || 'AND';

  // Update group logic (AND/OR within a group)
  const updateGroupLogic = (groupIndex, logic) => {
    const newGroups = [...groups];
    newGroups[groupIndex] = { ...newGroups[groupIndex], logic };
    onChange({ ...conditions, groups: newGroups });
  };

  // Update top-level logic (between groups)
  const updateTopLevelLogic = (logic) => {
    onChange({ ...conditions, logic });
  };

  // Update a single condition
  const updateCondition = (groupIndex, condIndex, field, value) => {
    const newGroups = [...groups];
    const newConditions = [...newGroups[groupIndex].conditions];
    newConditions[condIndex] = { ...newConditions[condIndex], [field]: value };
    newGroups[groupIndex] = { ...newGroups[groupIndex], conditions: newConditions };
    onChange({ ...conditions, groups: newGroups });

    // Clear validation error for this field
    if (onValidationErrorsClear) {
      onValidationErrorsClear(`cond_${groupIndex}_${condIndex}`);
    }
  };

  // Add a condition to a group
  const addCondition = (groupIndex) => {
    const newGroups = [...groups];
    newGroups[groupIndex] = {
      ...newGroups[groupIndex],
      conditions: [...newGroups[groupIndex].conditions, { ...DEFAULT_CONDITION }]
    };
    onChange({ ...conditions, groups: newGroups });
  };

  // Remove a condition
  const removeCondition = (groupIndex, condIndex) => {
    let newGroups = [...groups];
    newGroups[groupIndex] = {
      ...newGroups[groupIndex],
      conditions: newGroups[groupIndex].conditions.filter((_, i) => i !== condIndex)
    };
    // If group is now empty, remove it
    if (newGroups[groupIndex].conditions.length === 0) {
      newGroups = newGroups.filter((_, i) => i !== groupIndex);
    }
    // Ensure at least one group exists
    if (newGroups.length === 0) {
      newGroups = [{ ...DEFAULT_GROUP }];
    }
    onChange({ ...conditions, groups: newGroups });
  };

  // Add a new condition group
  const addGroup = () => {
    onChange({
      ...conditions,
      groups: [...groups, { ...DEFAULT_GROUP }]
    });
  };

  return (
    <div className="conditions-builder">
      {validationErrors?.conditions && (
        <span className="field-error">{validationErrors.conditions}</span>
      )}
      <div className="condition-groups">
        {groups.map((group, gi) => (
          <ConditionGroup
            key={gi}
            group={group}
            groupIndex={gi}
            topLevelLogic={topLevelLogic}
            validationErrors={validationErrors}
            onUpdateGroupLogic={updateGroupLogic}
            onUpdateTopLevelLogic={updateTopLevelLogic}
            onUpdateCondition={updateCondition}
            onAddCondition={addCondition}
            onRemoveCondition={removeCondition}
          />
        ))}
      </div>

      <button type="button" className="add-group-btn" onClick={addGroup}>
        <Plus size={14} /> Add Condition Group (OR)
      </button>
    </div>
  );
}

export default ConditionBuilder;
