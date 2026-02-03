import React, { useState, useCallback, useMemo } from 'react';
import { Save, Loader2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { FormField, FormLabel, FormInput, FormError, FormDescription } from '../ui/form';
import { Switch } from '../ui/switch';
import { cn } from '../ui/cn';

/**
 * ConfigItem - Individual configuration field with save button
 */
function ConfigItem({ config, onUpdate, disabled = false }) {
  const [localValue, setLocalValue] = useState(config.value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [isDirty, setIsDirty] = useState(false);

  const handleValueChange = useCallback((newValue) => {
    setLocalValue(newValue);
    setIsDirty(newValue !== config.value);
    setError(null);
  }, [config.value]);

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return;

    setSaving(true);
    setError(null);

    try {
      await onUpdate(config.key, localValue);
      setIsDirty(false);
    } catch (err) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }, [config.key, localValue, isDirty, saving, onUpdate]);

  const renderControl = () => {
    const { value_type, validation_rules = {} } = config;

    switch (value_type) {
      case 'boolean':
        return (
          <div className="flex items-center gap-3">
            <Switch
              id={`config-${config.key}`}
              checked={localValue === true || localValue === 'true' || localValue === 'True' || localValue === '1'}
              onCheckedChange={(checked) => handleValueChange(checked)}
              disabled={disabled || config.is_readonly}
            />
            <span className="text-sm text-text-secondary">
              {localValue === true || localValue === 'true' || localValue === 'True' || localValue === '1'
                ? 'Enabled'
                : 'Disabled'}
            </span>
          </div>
        );

      case 'integer':
      case 'float':
        return (
          <FormInput
            id={`config-${config.key}`}
            type="number"
            value={localValue ?? ''}
            onChange={(e) => handleValueChange(value_type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
            disabled={disabled || config.is_readonly}
            min={validation_rules.min}
            max={validation_rules.max}
            step={value_type === 'float' ? 0.1 : 1}
            hasError={!!error}
            className={cn(isDirty && 'border-accent-yellow')}
          />
        );

      case 'string':
      default:
        // Check if choices are defined for select dropdown
        if (validation_rules.choices && validation_rules.choices.length > 0) {
          return (
            <select
              id={`config-${config.key}`}
              value={localValue ?? ''}
              onChange={(e) => handleValueChange(e.target.value)}
              disabled={disabled || config.is_readonly}
              className={cn(
                'flex h-10 w-full',
                'rounded-md border bg-bg-card px-3 py-2',
                'text-sm text-text-primary',
                'transition-colors duration-200',
                'border-border',
                'hover:border-border-hover',
                'focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:ring-offset-2 focus:ring-offset-bg-dark',
                'disabled:cursor-not-allowed disabled:opacity-50',
                isDirty && 'border-accent-yellow',
                error && 'border-accent-red'
              )}
            >
              <option value="">Select...</option>
              {validation_rules.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          );
        }

        return (
          <FormInput
            id={`config-${config.key}`}
            type="text"
            value={localValue ?? ''}
            onChange={(e) => handleValueChange(e.target.value)}
            disabled={disabled || config.is_readonly}
            hasError={!!error}
            className={cn(isDirty && 'border-accent-yellow')}
          />
        );
    }
  };

  return (
    <div
      className={cn(
        'p-4 rounded-lg border transition-colors duration-200',
        'bg-bg-card border-border',
        isDirty && 'border-accent-yellow/50',
        error && 'border-accent-red/50'
      )}
    >
      <FormField>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <FormLabel htmlFor={`config-${config.key}`} className="flex items-center gap-2">
              {config.display_name}
              {config.is_readonly && (
                <span className="px-1.5 py-0.5 text-xs rounded bg-bg-hover text-text-secondary">
                  Read-only
                </span>
              )}
              {config.has_env_override && (
                <span className="px-1.5 py-0.5 text-xs rounded bg-accent-cyan/20 text-accent-cyan">
                  ENV
                </span>
              )}
            </FormLabel>
            {config.description && (
              <FormDescription className="mt-1">{config.description}</FormDescription>
            )}
          </div>
          {config.value_type !== 'boolean' && isDirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || disabled}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium',
                'transition-colors duration-200',
                'bg-accent-cyan text-white',
                'hover:bg-accent-cyan/90',
                'focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:ring-offset-2 focus:ring-offset-bg-dark',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              aria-busy={saving}
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Save size={14} aria-hidden="true" />
              )}
              Save
            </button>
          )}
        </div>

        <div className="mt-3">
          {renderControl()}
        </div>

        {/* Save button for boolean switches - placed below the switch */}
        {config.value_type === 'boolean' && isDirty && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || disabled}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium',
                'transition-colors duration-200',
                'bg-accent-cyan text-white',
                'hover:bg-accent-cyan/90',
                'focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:ring-offset-2 focus:ring-offset-bg-dark',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              aria-busy={saving}
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Save size={14} aria-hidden="true" />
              )}
              Save
            </button>
          </div>
        )}

        {error && <FormError className="mt-2">{error}</FormError>}

        {/* Show validation range info */}
        {config.validation_rules &&
          (config.validation_rules.min !== undefined || config.validation_rules.max !== undefined) && (
            <p className="mt-1.5 text-xs text-text-secondary">
              Range: {config.validation_rules.min ?? '-\u221E'} to {config.validation_rules.max ?? '\u221E'}
            </p>
          )}
      </FormField>
    </div>
  );
}

/**
 * CategorySection - Collapsible category group
 */
function CategorySection({ category, configs, onUpdate, disabled = false, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={toggleExpanded}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3',
          'bg-bg-hover text-left',
          'transition-colors duration-200',
          'hover:bg-bg-card',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-cyan/50'
        )}
        aria-expanded={expanded}
      >
        <span className="text-text-secondary">
          {expanded ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
        </span>
        <span className="flex-1 font-medium text-text-primary">{category.display_name || category.name}</span>
        <span className="text-sm text-text-secondary">{configs.length} settings</span>
      </button>

      {expanded && (
        <div className="p-4 space-y-4 bg-bg-dark">
          {configs.map((config) => (
            <ConfigItem
              key={config.key}
              config={config}
              onUpdate={onUpdate}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * AdminConfigForm - Configuration form with grouped settings
 *
 * @param {Array} configs - Array of configuration items
 * @param {Array} categories - Array of category definitions
 * @param {Function} onUpdate - Callback when a config value is updated (key, value) => Promise
 * @param {boolean} loading - Loading state
 * @param {string} error - Error message to display
 */
export function AdminConfigForm({
  configs = [],
  categories = [],
  onUpdate,
  loading = false,
  error = null,
}) {
  // Group configs by category
  const groupedConfigs = useMemo(() => {
    const groups = new Map();

    // Initialize groups from categories
    categories.forEach((category) => {
      groups.set(category.key || category.name, {
        category,
        configs: [],
      });
    });

    // Add an "Other" category for uncategorized configs
    if (!groups.has('other')) {
      groups.set('other', {
        category: { key: 'other', name: 'Other', display_name: 'Other' },
        configs: [],
      });
    }

    // Assign configs to their categories
    configs.forEach((config) => {
      const categoryKey = config.category || 'other';
      if (groups.has(categoryKey)) {
        groups.get(categoryKey).configs.push(config);
      } else {
        groups.get('other').configs.push(config);
      }
    });

    // Filter out empty categories and convert to array
    return Array.from(groups.values()).filter((group) => group.configs.length > 0);
  }, [configs, categories]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-text-secondary">
          <Loader2 size={24} className="animate-spin" aria-hidden="true" />
          <span>Loading configuration...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 p-4 rounded-lg',
          'bg-accent-red/10 border border-accent-red/30'
        )}
        role="alert"
      >
        <AlertCircle size={20} className="text-accent-red shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium text-accent-red">Failed to load configuration</p>
          <p className="text-sm text-text-secondary mt-1">{error}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (configs.length === 0) {
    return (
      <div className="text-center py-12 text-text-secondary">
        <p>No configuration items available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groupedConfigs.map((group, index) => (
        <CategorySection
          key={group.category.key || group.category.name}
          category={group.category}
          configs={group.configs}
          onUpdate={onUpdate}
          defaultExpanded={index === 0}
        />
      ))}
    </div>
  );
}

export default AdminConfigForm;
