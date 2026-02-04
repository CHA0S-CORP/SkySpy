import React, { useState, useMemo, useCallback } from 'react';
import {
  Highlighter,
  X,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Check,
  RotateCcw,
  Eye,
  EyeOff,
  Edit2,
  GripVertical,
  Palette,
} from 'lucide-react';
import {
  RULE_FIELDS,
  RULE_OPERATORS,
  COLOR_PALETTE,
  parseInValue,
  formatInValue,
} from '../../../hooks/useHighlightGroups';

/**
 * Highlight Groups Panel - collapsible sidebar for managing aircraft highlight groups
 */
export function HighlightGroupsPanel({
  groups,
  onToggle,
  onAdd,
  onRemove,
  onUpdate,
  onReorder,
  onDisableAll,
  onResetDefaults,
  expanded,
  onToggleExpanded,
  onClose,
  isProMode = false,
  aircraft = [],
  groupCounts = {},
  // Dragging
  position,
  isDragging,
  onMouseDown,
}) {
  const [editingGroup, setEditingGroup] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Count enabled groups
  const enabledCount = useMemo(
    () => groups.filter(g => g.enabled).length,
    [groups]
  );

  // Handle drag-and-drop reorder
  const [draggedIndex, setDraggedIndex] = useState(null);

  const handleDragStart = (e, index) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    onReorder?.(draggedIndex, index);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div
      className={`highlight-groups-panel ${isProMode ? 'pro-style' : ''} ${isDragging ? 'dragging' : ''}`}
      style={
        position?.x !== null && position?.x !== undefined
          ? {
              left: position.x,
              top: position.y,
              right: 'auto',
              bottom: 'auto',
            }
          : {}
      }
    >
      {/* Header */}
      <div
        className="highlight-groups-header"
        role="toolbar"
        aria-label="Highlight groups controls"
        onMouseDown={onMouseDown}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          onMouseDown?.({
            clientX: touch.clientX,
            clientY: touch.clientY,
            currentTarget: e.currentTarget.parentElement,
            preventDefault: () => {},
          });
        }}
      >
        <button
          className="highlight-groups-toggle"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls="highlight-groups-content"
        >
          <Highlighter size={14} className="highlight-icon" />
          <span>
            Highlight Groups
            {enabledCount > 0 && (
              <span className="enabled-badge">{enabledCount}</span>
            )}
          </span>
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        <div className="highlight-groups-header-actions">
          {/* Disable all */}
          {enabledCount > 0 && (
            <button
              className="highlight-action-btn"
              onClick={onDisableAll}
              title="Disable all groups"
            >
              <EyeOff size={14} />
            </button>
          )}

          {/* Reset to defaults */}
          <button
            className="highlight-action-btn"
            onClick={onResetDefaults}
            title="Reset to defaults"
          >
            <RotateCcw size={14} />
          </button>

          {/* Close */}
          <button
            className="highlight-close-btn"
            onClick={onClose}
            title="Hide highlight panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div id="highlight-groups-content" className="highlight-groups-content">
          {/* Group list */}
          <div className="highlight-groups-list">
            {groups.map((group, index) => (
              <HighlightGroupItem
                key={group.id}
                group={group}
                count={groupCounts[group.id] || 0}
                isEditing={editingGroup === group.id}
                onToggle={() => onToggle?.(group.id)}
                onEdit={() => setEditingGroup(editingGroup === group.id ? null : group.id)}
                onRemove={() => onRemove?.(group.id)}
                onUpdate={(updates) => onUpdate?.(group.id, updates)}
                onCancelEdit={() => setEditingGroup(null)}
                isProMode={isProMode}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                isDraggedOver={draggedIndex !== null && draggedIndex !== index}
              />
            ))}
          </div>

          {/* Add new group button/form */}
          {showAddForm ? (
            <AddGroupForm
              onAdd={(group) => {
                onAdd?.(group);
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
              isProMode={isProMode}
            />
          ) : (
            <button
              className="highlight-add-btn"
              onClick={() => setShowAddForm(true)}
            >
              <Plus size={14} />
              <span>Add Custom Group</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Individual highlight group item
 */
function HighlightGroupItem({
  group,
  count,
  isEditing,
  onToggle,
  onEdit,
  onRemove,
  onUpdate,
  onCancelEdit,
  isProMode,
  draggable,
  onDragStart,
  onDragOver,
  onDragEnd,
}) {
  return (
    <div
      className={`highlight-group-item ${group.enabled ? 'enabled' : ''} ${isEditing ? 'editing' : ''}`}
      draggable={draggable && !isEditing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      {!isEditing ? (
        <>
          {/* Drag handle */}
          <div className="highlight-drag-handle" title="Drag to reorder">
            <GripVertical size={12} />
          </div>

          {/* Checkbox */}
          <button
            className={`highlight-checkbox ${group.enabled ? 'checked' : ''}`}
            onClick={onToggle}
            aria-label={`${group.enabled ? 'Disable' : 'Enable'} ${group.name}`}
          >
            {group.enabled && <Check size={10} />}
          </button>

          {/* Color swatch */}
          <div
            className="highlight-color-swatch"
            style={{ backgroundColor: group.color }}
            title={group.color}
          />

          {/* Name and count */}
          <div className="highlight-group-info">
            <span className="highlight-group-name">{group.name}</span>
            <span className="highlight-group-count">({count})</span>
          </div>

          {/* Actions */}
          <div className="highlight-group-actions">
            <button
              className="highlight-group-action edit"
              onClick={onEdit}
              title="Edit group"
            >
              <Edit2 size={12} />
            </button>
            <button
              className="highlight-group-action remove"
              onClick={onRemove}
              title="Remove group"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </>
      ) : (
        <EditGroupForm
          group={group}
          onSave={onUpdate}
          onCancel={onCancelEdit}
          isProMode={isProMode}
        />
      )}
    </div>
  );
}

/**
 * Form for editing an existing group
 */
function EditGroupForm({ group, onSave, onCancel, isProMode }) {
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color);
  const [field, setField] = useState(group.rule?.field || 'operator');
  const [operator, setOperator] = useState(group.rule?.operator || 'contains');
  const [value, setValue] = useState(
    group.rule?.operator === 'in'
      ? formatInValue(group.rule?.value)
      : String(group.rule?.value ?? '')
  );
  const [showColorPicker, setShowColorPicker] = useState(false);

  const fieldDef = RULE_FIELDS.find(f => f.value === field);
  const fieldType = fieldDef?.type || 'string';
  const operators = RULE_OPERATORS[fieldType] || RULE_OPERATORS.string;

  // Reset operator if it doesn't apply to new field type
  const handleFieldChange = (newField) => {
    setField(newField);
    const newFieldDef = RULE_FIELDS.find(f => f.value === newField);
    const newFieldType = newFieldDef?.type || 'string';
    const newOperators = RULE_OPERATORS[newFieldType];
    if (!newOperators.find(o => o.value === operator)) {
      setOperator(newOperators[0].value);
    }
    // Reset value for boolean fields
    if (newFieldType === 'boolean') {
      setValue('true');
    }
  };

  const handleSave = () => {
    let parsedValue = value;

    // Parse value based on field type and operator
    if (fieldType === 'number') {
      if (operator === 'between') {
        const parts = value.split(',').map(v => parseFloat(v.trim()));
        parsedValue = parts.filter(n => !isNaN(n));
      } else {
        parsedValue = parseFloat(value);
      }
    } else if (fieldType === 'boolean') {
      parsedValue = value === 'true';
    } else if (operator === 'in') {
      parsedValue = parseInValue(value);
    }

    onSave({
      name,
      color,
      rule: { field, operator, value: parsedValue },
    });
    onCancel();
  };

  return (
    <div className="highlight-edit-form">
      {/* Name input */}
      <div className="highlight-form-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          className="highlight-input highlight-name-input"
        />

        {/* Color picker */}
        <div className="highlight-color-picker-container">
          <button
            className="highlight-color-btn"
            style={{ backgroundColor: color }}
            onClick={() => setShowColorPicker(!showColorPicker)}
            title="Change color"
          >
            <Palette size={10} />
          </button>
          {showColorPicker && (
            <div className="highlight-color-dropdown">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c}
                  className={`highlight-color-option ${c === color ? 'selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    setColor(c);
                    setShowColorPicker(false);
                  }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  setShowColorPicker(false);
                }}
                className="highlight-color-custom"
                title="Custom color"
              />
            </div>
          )}
        </div>
      </div>

      {/* Rule builder */}
      <div className="highlight-form-row highlight-rule-row">
        {/* Field selector */}
        <select
          value={field}
          onChange={(e) => handleFieldChange(e.target.value)}
          className="highlight-select highlight-field-select"
        >
          {RULE_FIELDS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        {/* Operator selector */}
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          className="highlight-select highlight-operator-select"
        >
          {operators.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Value input */}
        {fieldType === 'boolean' ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="highlight-select highlight-value-select"
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        ) : (
          <input
            type={fieldType === 'number' ? 'text' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={operator === 'in' ? 'val1, val2, ...' : 'Value'}
            className="highlight-input highlight-value-input"
          />
        )}
      </div>

      {/* Form actions */}
      <div className="highlight-form-actions">
        <button className="highlight-form-btn cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="highlight-form-btn save"
          onClick={handleSave}
          disabled={!name.trim()}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * Form for adding a new group
 */
function AddGroupForm({ onAdd, onCancel, isProMode }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]);
  const [field, setField] = useState('operator');
  const [operator, setOperator] = useState('contains');
  const [value, setValue] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);

  const fieldDef = RULE_FIELDS.find(f => f.value === field);
  const fieldType = fieldDef?.type || 'string';
  const operators = RULE_OPERATORS[fieldType] || RULE_OPERATORS.string;

  const handleFieldChange = (newField) => {
    setField(newField);
    const newFieldDef = RULE_FIELDS.find(f => f.value === newField);
    const newFieldType = newFieldDef?.type || 'string';
    const newOperators = RULE_OPERATORS[newFieldType];
    if (!newOperators.find(o => o.value === operator)) {
      setOperator(newOperators[0].value);
    }
    if (newFieldType === 'boolean') {
      setValue('true');
    } else {
      setValue('');
    }
  };

  const handleAdd = () => {
    let parsedValue = value;

    if (fieldType === 'number') {
      if (operator === 'between') {
        const parts = value.split(',').map(v => parseFloat(v.trim()));
        parsedValue = parts.filter(n => !isNaN(n));
      } else {
        parsedValue = parseFloat(value);
      }
    } else if (fieldType === 'boolean') {
      parsedValue = value === 'true';
    } else if (operator === 'in') {
      parsedValue = parseInValue(value);
    }

    onAdd({
      name,
      color,
      enabled: true,
      rule: { field, operator, value: parsedValue },
    });
  };

  return (
    <div className="highlight-add-form">
      <div className="highlight-add-form-header">
        <span>New Highlight Group</span>
        <button className="highlight-add-form-close" onClick={onCancel}>
          <X size={14} />
        </button>
      </div>

      {/* Name input */}
      <div className="highlight-form-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name (e.g., 'FedEx Aircraft')"
          className="highlight-input highlight-name-input"
          autoFocus
        />

        {/* Color picker */}
        <div className="highlight-color-picker-container">
          <button
            className="highlight-color-btn"
            style={{ backgroundColor: color }}
            onClick={() => setShowColorPicker(!showColorPicker)}
            title="Choose color"
          >
            <Palette size={10} />
          </button>
          {showColorPicker && (
            <div className="highlight-color-dropdown">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c}
                  className={`highlight-color-option ${c === color ? 'selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    setColor(c);
                    setShowColorPicker(false);
                  }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  setShowColorPicker(false);
                }}
                className="highlight-color-custom"
                title="Custom color"
              />
            </div>
          )}
        </div>
      </div>

      {/* Rule builder */}
      <div className="highlight-form-row highlight-rule-row">
        <select
          value={field}
          onChange={(e) => handleFieldChange(e.target.value)}
          className="highlight-select highlight-field-select"
        >
          {RULE_FIELDS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          className="highlight-select highlight-operator-select"
        >
          {operators.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {fieldType === 'boolean' ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="highlight-select highlight-value-select"
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={operator === 'in' ? 'val1, val2, ...' : 'Value'}
            className="highlight-input highlight-value-input"
          />
        )}
      </div>

      {/* Form actions */}
      <div className="highlight-form-actions">
        <button className="highlight-form-btn cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="highlight-form-btn save"
          onClick={handleAdd}
          disabled={!name.trim() || (!value && fieldType !== 'boolean')}
        >
          Add Group
        </button>
      </div>
    </div>
  );
}

/**
 * Show Highlight Groups Button (when panel is hidden)
 */
export function HighlightGroupsShowButton({ enabledCount, onClick, isProMode = false }) {
  return (
    <button
      className={`highlight-groups-show-btn ${isProMode ? 'pro-style' : ''} ${enabledCount > 0 ? 'has-enabled' : ''}`}
      onClick={onClick}
      title="Show highlight groups (H)"
    >
      <Highlighter size={14} />
      {enabledCount > 0 && <span className="enabled-badge">{enabledCount}</span>}
    </button>
  );
}

export default HighlightGroupsPanel;
